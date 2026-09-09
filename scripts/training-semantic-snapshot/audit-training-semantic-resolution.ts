import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyProduct, type ProductSemanticClassificationInput } from '../../src/domain/product-semantic-classification/index.js';
import { DefaultActiveTrainingSemanticSnapshotReader, type TrainingSemanticSnapshot, type TrainingSemanticRuntimeFact } from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotStore } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotStore.js';
import { trainingCapabilityCodes, type TrainingCapabilityCode } from '../../src/domain/training-semantics/index.js';
import { resolveTrainingSemanticSnapshotDir } from '../../src/shared/trainingSemanticSnapshotConfig.js';
import { parseCsvRecords, writeCsv } from '../product-semantic-classification/lib/csv.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from '../product-semantic-classification/lib/load-input.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.6.2');
const SNAPSHOT_ID = 'sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d';
const SEMANTIC_CHECKSUM = '08fdd83e95d6f682527187fd6e2caff25f52107dc4bf63edd1abd87511eb741e';
const REGISTRY_VERSION = 'training-semantic-registry-v1';
const REGISTRY_HASH = '82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f';
const CLASSIFIER_VERSION = 'training-semantic-classifier-v1.1';
const RULES_HASH = '83007958a40fd29a87eb01d1fe159812587876c5e57295d7344024bda0123248';
const EXPECTED_ACTIVE_TRAINING_RELEVANT = 240;
const TARGET_RESOLVED_PRODUCTS = 228;

const NON_TRAINING_FAMILIES = new Set(['APPAREL', 'FLOORING', 'PROTECTIVE_GEAR', 'STORAGE', 'BARBELL', 'DUMBBELL', 'KETTLEBELL', 'BAND', 'BENCH']);
const TRAINING_FAMILIES = new Set(['SELECTORIZED_MACHINE', 'PLATE_LOADED_MACHINE', 'CABLE_MACHINE', 'BODYWEIGHT_GYMNASTICS', 'RACK_CAGE', 'CARDIO_MACHINE', 'MACHINE_ATTACHMENT']);
const EQUIPMENT_FAMILIES = new Set(['SELECTORIZED_MACHINE', 'PLATE_LOADED_MACHINE', 'CABLE_MACHINE', 'BODYWEIGHT_GYMNASTICS', 'RACK_CAGE']);
const V1_CAPABILITY_PATTERNS: Readonly<Record<TrainingCapabilityCode, RegExp>> = {
  LEG_EXTENSION: /\b(?:leg extension|extension de cuadriceps|extension de piernas?|cuadriceps)\b/u,
  LEG_CURL: /\b(?:leg curl|curl femoral|curl de femoral|femoral)\b/u,
  HIP_THRUST: /\bhip thrust\b/u,
  CHEST_PRESS: /\b(?:chest press|press pectoral|press de pectoral|press de pecho|press pecho)\b/u,
  PEC_DECK: /\b(?:pec deck|contractora(?: de pectoral| pectoral)?)\b/u,
  LAT_PULLDOWN: /\b(?:lat pulldown|pulldown|jalon al pecho|polea alta)\b/u,
  ROW: /\b(?:t[ -]?bar row|remo|rowing|row)\b/u,
  SHOULDER_PRESS: /\b(?:shoulder press|press de hombros?|press hombros?|hombros?)\b/u,
  PULL_UP: /\b(?:pull up|pull-up|dominadas?|barra de dominadas)\b/u,
  DIP: /\b(?:dip|fondos?|paralelas)\b/u,
  ABDOMINAL_CRUNCH: /\b(?:abdominal crunch|crunch abdominal|maquina abdominal)\b/u,
  ADDUCTOR: /\baductora?\b/u,
  ABDUCTOR: /\babductora?\b/u,
};
const DEFERRED_PATTERNS: Readonly<Record<string, RegExp>> = {
  SQUAT: /\b(?:squat|sentadilla|hack squat|v-squat|belt squat)\b/u,
  LEG_PRESS: /\bleg press\b/u,
  BICEPS_CURL: /\b(?:biceps curl|curl de biceps)\b/u,
  GLUTE_KICKBACK: /\b(?:glute kickback|patada de gluteo)\b/u,
  TRICEPS_EXTENSION: /\b(?:triceps extension|extension de triceps)\b/u,
  DEADLIFT: /\bdeadlift\b/u,
};
const ACCESSORY_PATTERN = /\b(?:accesorio|attachment|agarre|grip|handle|pad|almohadilla|cinturon|correa|strap|soporte|support|rueda|abmat|barra olimpica)\b/u;
const PACK_PATTERN = /\b(?:pack|set|kit|duo|trio|combo|multi|dual|multifuncional|crossover|estacion|station)\b/u;
const MULTIFUNCTION_PATTERN = /\b(?:dual|duo|trio|multi|multifuncional|crossover|estacion|station|combinad[oa])\b/u;

type ResolutionState = 'SEMANTIC_COMPLETE' | 'SEMANTIC_PARTIAL' | 'VERIFIED_NO_APPLICABLE_CAPABILITY' | 'ONTOLOGY_GAP' | 'RULE_GAP' | 'DATA_GAP' | 'AMBIGUOUS' | 'NEEDS_REVIEW';
type GapType = 'RULE_GAP' | 'ONTOLOGY_GAP' | 'DATA_GAP' | 'AMBIGUITY' | 'QUALITY_REVIEW' | null;
type CatalogRow = Record<string, string>;
type DeferredRow = { readonly productId: number; readonly candidateCode: string; readonly bucket: string; readonly decision: string };
type Context = {
  readonly productId: number;
  readonly name: string;
  readonly active: boolean;
  readonly catalogPresence: string;
  readonly revenue: number | null;
  readonly unitsSold: number | null;
  readonly orderLines: number | null;
  readonly productFamily: string;
  readonly input: ProductSemanticClassificationInput;
  readonly trustedText: string;
};
type AssignmentView = { readonly capabilityCode: string; readonly relationType: string };
type ResolutionRecord = {
  readonly productId: number;
  readonly name: string;
  readonly active: boolean;
  readonly productFamily: string;
  readonly currentCoverageStatus: string;
  readonly currentAssignments: readonly AssignmentView[];
  readonly resolutionState: ResolutionState;
  readonly candidateCapabilities: readonly string[];
  readonly missingCapabilities: readonly string[];
  readonly evidenceSummary: readonly string[];
  readonly gapType: GapType;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly commercialContext: { readonly revenue: number | null; readonly orderLines: number | null; readonly unitsSold: number | null };
  readonly reason: string;
};

function parseArgs(argv: readonly string[]) {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(arg);
    if (!match) throw new Error(`Unsupported argument: ${arg}`);
    values[match[1]!] = match[2]!;
  }
  return {
    inputDir: values['input-dir'],
    catalog: values.catalog,
    categoryTrustMap: values['category-trust-map'],
    featureTrustMap: values['feature-trust-map'],
    snapshotDir: values['snapshot-dir'],
    outputDir: path.resolve(values['output-dir'] ?? DEFAULT_OUTPUT_DIR),
  };
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
}

function numberOrNull(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number(((numerator / denominator) * 100).toFixed(2));
}

function sum(values: readonly (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function canonicalList(values: readonly string[]): string {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right)).join('|');
}

function trustedText(input: ProductSemanticClassificationInput): string {
  const categories = input.categories.filter((category) => category.trustClass === 'SEMANTIC_STRONG' || category.trustClass === 'SEMANTIC_WEAK').map((category) => category.name);
  const features = input.features.filter((feature) => feature.trustClass === 'SEMANTIC').flatMap((feature) => [feature.featureName, feature.value]);
  return normalizeText([input.productName, ...categories, ...features].join(' '));
}

function productFamily(input: ProductSemanticClassificationInput): string {
  return classifyProduct(input).primaryProductFamily?.code ?? 'UNKNOWN';
}

function buildContexts(rows: readonly CatalogRow[], inputs: readonly ProductSemanticClassificationInput[]): readonly Context[] {
  const rowsById = new Map(rows.map((row) => [Number(row.productId), row] as const));
  return inputs.map((input) => {
    const productId = Number(input.productId);
    const row = rowsById.get(productId);
    return {
      productId,
      name: input.productName,
      active: input.activeStatus === true,
      catalogPresence: input.catalogPresence,
      revenue: numberOrNull(row?.totalRevenueTaxIncl),
      unitsSold: numberOrNull(row?.unitsSold),
      orderLines: numberOrNull(row?.validOrderCount),
      productFamily: productFamily(input),
      input,
      trustedText: trustedText(input),
    };
  }).sort((left, right) => left.productId - right.productId);
}

function recordMap(snapshot: TrainingSemanticSnapshot): ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]> {
  return new Map(snapshot.records.map((record) => [record.productId, record] as const));
}

function explicitCandidates(context: Context): readonly TrainingCapabilityCode[] {
  return trainingCapabilityCodes.filter((code) => V1_CAPABILITY_PATTERNS[code].test(context.trustedText));
}

function deferredCandidates(context: Context): readonly string[] {
  return Object.entries(DEFERRED_PATTERNS).filter(([, pattern]) => pattern.test(context.trustedText)).map(([code]) => code);
}

function likelyV1Candidates(context: Context): readonly TrainingCapabilityCode[] {
  if (NON_TRAINING_FAMILIES.has(context.productFamily) || ACCESSORY_PATTERN.test(context.trustedText)) return [];
  return explicitCandidates(context).filter((code) => {
    if (code === 'ROW' && (context.productFamily === 'CARDIO_MACHINE' || /\b(?:rower|ergometro|ergometer|remo cardio|remo indoor)\b/u.test(context.trustedText))) return false;
    if (code === 'HIP_THRUST' && /\b(?:cajon|caja|box|pad|almohadilla|cinturon|barra)\b/u.test(context.trustedText)) return false;
    if (code === 'ABDOMINAL_CRUNCH' && /\b(?:rueda|wheel|abmat|banco|bench)\b/u.test(context.trustedText)) return false;
    if ((code === 'PULL_UP' || code === 'DIP') && !/\b(?:barra|bar|station|estacion|paralelas|dedicado|dedicada|modulo|module)\b/u.test(context.trustedText)) return false;
    return true;
  });
}

function isStructuredEvidenceAvailable(context: Context): boolean {
  return context.input.categories.some((category) => category.trustClass === 'SEMANTIC_STRONG' || category.trustClass === 'SEMANTIC_WEAK') || context.input.features.some((feature) => feature.trustClass === 'SEMANTIC');
}

function isTrainingEquipmentWording(context: Context): boolean {
  return /\b(?:maquina|machine|gym|rack|cable|polea|estacion|station|banco|bench|press|curl|remo|row|pulldown|dominada|dip|fondos)\b/u.test(context.trustedText);
}

function eligibleForResolution(context: Context, record: TrainingSemanticSnapshot['records'][number]): boolean {
  return record.assignments.length > 0 || (!NON_TRAINING_FAMILIES.has(context.productFamily) && (
    record.assignments.length > 0 ||
    TRAINING_FAMILIES.has(context.productFamily) ||
    likelyV1Candidates(context).length > 0 ||
    deferredCandidates(context).length > 0 ||
    isTrainingEquipmentWording(context)
  ));
}

function assignmentViews(fact: TrainingSemanticRuntimeFact | TrainingSemanticSnapshot['records'][number]): readonly AssignmentView[] {
  return fact.assignments.map((assignment) => ({ capabilityCode: assignment.capabilityCode, relationType: assignment.relationType })).sort((left, right) => left.capabilityCode.localeCompare(right.capabilityCode) || left.relationType.localeCompare(right.relationType));
}

function evidenceSummary(context: Context, candidates: readonly string[], deferred: readonly DeferredRow[]): readonly string[] {
  const summary: string[] = [];
  summary.push(`PRODUCT_FAMILY:${context.productFamily}`);
  if (context.catalogPresence !== 'current_catalog') summary.push(`CATALOG_PRESENCE:${context.catalogPresence}`);
  if (candidates.length > 0) summary.push(`TRUSTED_V1_SIGNAL:${canonicalList(candidates)}`);
  if (deferred.length > 0) summary.push(`DEFERRED_SIGNAL:${canonicalList(deferred.map((row) => row.candidateCode))}`);
  if (isStructuredEvidenceAvailable(context)) summary.push('STRUCTURED_SEMANTIC_EVIDENCE:AVAILABLE');
  else summary.push('STRUCTURED_SEMANTIC_EVIDENCE:MISSING');
  if (ACCESSORY_PATTERN.test(context.trustedText)) summary.push('ACCESSORY_OR_SUPPORT_SIGNAL:AVAILABLE');
  if (MULTIFUNCTION_PATTERN.test(context.trustedText)) summary.push('MULTIFUNCTION_SIGNAL:AVAILABLE');
  return summary.sort((left, right) => left.localeCompare(right));
}

function deferredRowsByProduct(rows: readonly CatalogRow[]): ReadonlyMap<number, readonly DeferredRow[]> {
  const result = new Map<number, DeferredRow[]>();
  for (const row of rows) {
    const productId = Number(row.productId);
    const parsed: DeferredRow = { productId, candidateCode: row.candidateCode ?? '', bucket: row.bucket ?? '', decision: row.decision ?? '' };
    const values = result.get(productId) ?? [];
    values.push(parsed);
    result.set(productId, values);
  }
  return result;
}

function classifyResolution(context: Context, record: TrainingSemanticSnapshot['records'][number], deferred: readonly DeferredRow[]): ResolutionRecord {
  const currentAssignments = assignmentViews(record);
  const assignedCodes = new Set(currentAssignments.map((assignment) => assignment.capabilityCode));
  const candidates = likelyV1Candidates(context);
  const deferredCodes = [...new Set(deferred.map((row) => row.candidateCode))].sort((left, right) => left.localeCompare(right));
  const missingCapabilities = candidates.filter((candidate) => !assignedCodes.has(candidate));
  const evidence = evidenceSummary(context, candidates, deferred);
  const multifunction = MULTIFUNCTION_PATTERN.test(context.trustedText) || candidates.length > 1;
  let resolutionState: ResolutionState;
  let gapType: GapType = null;
  let confidence: ResolutionRecord['confidence'];
  let reason: string;

  if (currentAssignments.length > 0) {
    if (missingCapabilities.length > 0) {
      resolutionState = 'SEMANTIC_PARTIAL';
      gapType = 'RULE_GAP';
      confidence = 'MEDIUM';
      reason = `Published assignment exists, but trusted V1 evidence also indicates missing capability ${missingCapabilities.join(', ')}.`;
    } else if (deferred.some((row) => row.bucket === 'DEDICATED_MACHINE')) {
      resolutionState = 'ONTOLOGY_GAP';
      gapType = 'ONTOLOGY_GAP';
      confidence = 'HIGH';
      reason = `Published V1 assignment is valid, but the product also carries deferred function ${deferredCodes.join(', ')} outside the current registry.`;
    } else {
      resolutionState = 'SEMANTIC_COMPLETE';
      confidence = 'HIGH';
      reason = 'Published assignments cover the trusted V1 capability signals observed for the product.';
    }
  } else if (candidates.length > 0 && multifunction) {
    resolutionState = 'NEEDS_REVIEW';
    gapType = 'QUALITY_REVIEW';
    confidence = 'MEDIUM';
    reason = `Multiple or multifunction V1 signals require product-level adjudication before publishing ${candidates.join(', ')}.`;
  } else if (candidates.length > 0) {
    resolutionState = 'RULE_GAP';
    gapType = 'RULE_GAP';
    confidence = 'HIGH';
    reason = `Trusted product evidence indicates ${candidates.join(', ')} but the published snapshot has no assignment.`;
  } else if (deferred.some((row) => row.bucket === 'DEDICATED_MACHINE')) {
    resolutionState = 'ONTOLOGY_GAP';
    gapType = 'ONTOLOGY_GAP';
    confidence = 'HIGH';
    reason = `Product is a credible dedicated machine for deferred capability ${deferredCodes.join(', ')}; the current V1 registry intentionally cannot represent it.`;
  } else if (deferred.length > 0 || context.productFamily === 'CARDIO_MACHINE' || context.productFamily === 'MACHINE_ATTACHMENT' || ACCESSORY_PATTERN.test(context.trustedText)) {
    resolutionState = 'VERIFIED_NO_APPLICABLE_CAPABILITY';
    confidence = 'HIGH';
    reason = deferred.length > 0 ? `Deferred evidence is classified as non-publishable (${canonicalList(deferred.map((row) => row.bucket))}); no V1 assignment is applicable.` : 'Catalog evidence identifies a cardio/accessory/support product without a current V1 strength capability.';
  } else if (PACK_PATTERN.test(context.trustedText) && !multifunction) {
    resolutionState = 'AMBIGUOUS';
    gapType = 'AMBIGUITY';
    confidence = 'MEDIUM';
    reason = 'Pack or multi-use wording prevents a deterministic product-level capability decision.';
  } else if (context.productFamily === 'UNKNOWN' || !isStructuredEvidenceAvailable(context) || record.coverageStatus === 'INSUFFICIENT_EVIDENCE') {
    resolutionState = 'DATA_GAP';
    gapType = 'DATA_GAP';
    confidence = 'LOW';
    reason = context.productFamily === 'UNKNOWN' ? 'Product Family is UNKNOWN; exact missing data: trusted semantic category and/or structured feature evidence needed to distinguish training function from generic merchandise.' : 'Exact missing data: trusted structured category or semantic feature evidence needed to decide whether a V1 capability applies.';
  } else if (EQUIPMENT_FAMILIES.has(context.productFamily)) {
    resolutionState = 'ONTOLOGY_GAP';
    gapType = 'ONTOLOGY_GAP';
    confidence = 'MEDIUM';
    reason = 'Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set.';
  } else if (record.coverageStatus === 'NO_CAPABILITY_APPLICABLE') {
    resolutionState = 'VERIFIED_NO_APPLICABLE_CAPABILITY';
    confidence = 'MEDIUM';
    reason = 'Available catalog evidence was reviewed and no current V1 capability applies.';
  } else {
    resolutionState = 'AMBIGUOUS';
    gapType = 'AMBIGUITY';
    confidence = 'LOW';
    reason = 'Current evidence does not support a unique V1 resolution.';
  }

  return {
    productId: context.productId,
    name: context.name,
    active: context.active,
    productFamily: context.productFamily,
    currentCoverageStatus: record.coverageStatus,
    currentAssignments,
    resolutionState,
    candidateCapabilities: candidates,
    missingCapabilities,
    evidenceSummary: evidence,
    gapType,
    confidence,
    commercialContext: { revenue: context.revenue, orderLines: context.orderLines, unitsSold: context.unitsSold },
    reason,
  };
}

function assertSnapshotBaseline(snapshot: TrainingSemanticSnapshot): void {
  const counts = snapshot.counts;
  const matches = snapshot.snapshotId === SNAPSHOT_ID && snapshot.semanticChecksum === SEMANTIC_CHECKSUM && snapshot.registryVersion === REGISTRY_VERSION && snapshot.registryHash === REGISTRY_HASH && snapshot.classifierVersion === CLASSIFIER_VERSION && snapshot.rulesHash === RULES_HASH && counts.sourceProducts === 2011 && counts.assignmentCount === 180 && counts.directAssignments === 157 && counts.supportedAssignments === 23 && counts.multiAssignmentProducts === 23 && counts.coverageCounts.NO_CAPABILITY_APPLICABLE === 881 && counts.coverageCounts.UNMODELED === 1086 && counts.coverageCounts.INSUFFICIENT_EVIDENCE === 44 && counts.coverageCounts.NEEDS_REVIEW === 0;
  if (!matches) throw new Error(`TRAINING_SEMANTIC_RESOLUTION_BLOCKED: A00.5 baseline mismatch: ${safeJson({ snapshotId: snapshot.snapshotId, semanticChecksum: snapshot.semanticChecksum, registryVersion: snapshot.registryVersion, registryHash: snapshot.registryHash, classifierVersion: snapshot.classifierVersion, rulesHash: snapshot.rulesHash, counts })}`);
}

function compareCommercial(left: ResolutionRecord, right: ResolutionRecord): number {
  return Number(right.active) - Number(left.active) || (right.commercialContext.revenue ?? -1) - (left.commercialContext.revenue ?? -1) || (right.commercialContext.orderLines ?? -1) - (left.commercialContext.orderLines ?? -1) || (right.commercialContext.unitsSold ?? -1) - (left.commercialContext.unitsSold ?? -1) || left.productId - right.productId;
}

function csvValue(value: unknown): string | number | boolean | null {
  if (Array.isArray(value)) return value.map((entry) => typeof entry === 'object' && entry !== null ? JSON.stringify(entry) : String(entry)).join('|');
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

function csvRows(records: readonly ResolutionRecord[]): readonly Record<string, string | number | boolean | null>[] {
  return records.map((record) => ({
    productId: record.productId,
    name: record.name,
    active: record.active,
    productFamily: record.productFamily,
    currentCoverageStatus: record.currentCoverageStatus,
    currentAssignments: csvValue(record.currentAssignments),
    resolutionState: record.resolutionState,
    candidateCapabilities: record.candidateCapabilities.join('|'),
    missingCapabilities: record.missingCapabilities.join('|'),
    evidenceSummary: record.evidenceSummary.join('|'),
    gapType: record.gapType,
    confidence: record.confidence,
    revenue: record.commercialContext.revenue,
    orderLines: record.commercialContext.orderLines,
    unitsSold: record.commercialContext.unitsSold,
    reason: record.reason,
  }));
}

function objectCsvRows(rows: readonly Record<string, unknown>[]): readonly Record<string, string | number | boolean | null>[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, csvValue(value)])));
}

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  return Object.fromEntries([...new Set(values)].sort((left, right) => left.localeCompare(right)).map((value) => [value, values.filter((candidate) => candidate === value).length]));
}

function resolutionByFamily(records: readonly ResolutionRecord[]): readonly Record<string, unknown>[] {
  return [...new Set(records.map((record) => record.productFamily))].sort((left, right) => left.localeCompare(right)).map((productFamily) => {
    const values = records.filter((record) => record.productFamily === productFamily);
    const states = countBy(values.map((record) => record.resolutionState));
    return { productFamily, products: values.length, semanticComplete: states.SEMANTIC_COMPLETE ?? 0, semanticPartial: states.SEMANTIC_PARTIAL ?? 0, verifiedNoApplicableCapability: states.VERIFIED_NO_APPLICABLE_CAPABILITY ?? 0, ontologyGap: states.ONTOLOGY_GAP ?? 0, ruleGap: states.RULE_GAP ?? 0, dataGap: states.DATA_GAP ?? 0, ambiguous: states.AMBIGUOUS ?? 0, needsReview: states.NEEDS_REVIEW ?? 0, realSemanticResolutionRate: percent((states.SEMANTIC_COMPLETE ?? 0) + (states.VERIFIED_NO_APPLICABLE_CAPABILITY ?? 0), values.length) };
  });
}

function resolutionByGap(records: readonly ResolutionRecord[]): readonly Record<string, unknown>[] {
  const gaps = [...new Set(records.map((record) => record.gapType ?? 'NONE'))].sort((left, right) => left.localeCompare(right));
  return gaps.map((gapType) => {
    const values = records.filter((record) => (record.gapType ?? 'NONE') === gapType);
    return { gapType, products: values.length, activeProducts: values.filter((record) => record.active).length, revenue: Number(sum(values.map((record) => record.commercialContext.revenue)).toFixed(2)), orderLines: sum(values.map((record) => record.commercialContext.orderLines)), unitsSold: sum(values.map((record) => record.commercialContext.unitsSold)), productIds: values.map((record) => record.productId).join('|') };
  });
}

function capabilityAudit(resolutions: readonly ResolutionRecord[], recordsById: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>): readonly Record<string, unknown>[] {
  return trainingCapabilityCodes.map((capabilityCode) => {
    const assigned = resolutions.filter((record) => record.currentAssignments.some((assignment) => assignment.capabilityCode === capabilityCode));
    const candidates = resolutions.filter((record) => record.candidateCapabilities.includes(capabilityCode));
    const unassignedCandidates = candidates.filter((record) => !record.currentAssignments.some((assignment) => assignment.capabilityCode === capabilityCode));
    return {
      capabilityCode,
      publishedAssignments: [...recordsById.values()].reduce((count, record) => count + record.assignments.filter((assignment) => assignment.capabilityCode === capabilityCode).length, 0),
      activeAssignedProducts: assigned.length,
      activeCompleteProducts: assigned.filter((record) => record.resolutionState === 'SEMANTIC_COMPLETE').length,
      activePartialProducts: assigned.filter((record) => record.resolutionState === 'SEMANTIC_PARTIAL').length,
      activeCandidateProducts: candidates.length,
      activeUnassignedCandidateProducts: unassignedCandidates.length,
      unassignedCandidateProductIds: unassignedCandidates.map((record) => record.productId).sort((left, right) => left - right).join('|'),
      assessment: unassignedCandidates.length === 0 ? 'NO_ACTIVE_UNASSIGNED_V1_SIGNAL' : 'ACTIVE_V1_SIGNAL_REQUIRES_REVIEW',
    };
  });
}

function renderMarkdown(report: Record<string, unknown>, records: readonly ResolutionRecord[], families: readonly Record<string, unknown>[], gaps: readonly Record<string, unknown>[]): string {
  const kpis = report.kpis as Record<string, unknown>;
  const authority = report.authority as Record<string, unknown>;
  const feasibility = report.feasibility as Record<string, unknown>;
  const stateCounts = report.resolutionStateCounts as Record<string, unknown>;
  const unresolved = records.filter((record) => !['SEMANTIC_COMPLETE', 'VERIFIED_NO_APPLICABLE_CAPABILITY'].includes(record.resolutionState));
  const table = (headers: readonly string[], rows: readonly (readonly unknown[])[]) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map((value) => String(value ?? '').replace(/\|/gu, '\\|')).join(' | ')} |`)].join('\n');
  const lines = [
    '# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.6.2 — Semantic Resolution Quality Model',
    '',
    `## Decision: ${report.decision}`,
    '',
    'This audit evaluates the published A00.5 Product Truth without changing the registry, classifier, snapshot, API, Sales Agent or Customer Profile. Every active training-relevant product receives exactly one product-level resolution state.',
    '',
    '## Snapshot authority',
    '',
    `- snapshotId: \`${authority.snapshotId}\``,
    `- semanticChecksum: \`${authority.semanticChecksum}\``,
    `- registry: \`${authority.registryVersion}\` / \`${authority.registryHash}\``,
    `- classifier: \`${authority.classifierVersion}\` / \`${authority.rulesHash}\``,
    '- A00.5 baseline guard matched: 2011 products, 180 assignments, 157 DIRECT, 23 SUPPORTED, 0 NEEDS_REVIEW.',
    '',
    '## Resolution model',
    '',
    'Resolution is intentionally stricter than snapshot assignment coverage. Only SEMANTIC_COMPLETE and VERIFIED_NO_APPLICABLE_CAPABILITY count as REAL_SEMANTIC_RESOLUTION. SEMANTIC_PARTIAL, ONTOLOGY_GAP, RULE_GAP, DATA_GAP, AMBIGUOUS and NEEDS_REVIEW are unresolved for the target KPI.',
    '',
    'States:',
    '',
    '- SEMANTIC_COMPLETE — published assignments are correct and exhaustive for trusted V1 evidence.',
    '- SEMANTIC_PARTIAL — a published assignment exists but trusted V1 evidence indicates a missing capability.',
    '- VERIFIED_NO_APPLICABLE_CAPABILITY — evidence is sufficient to exclude every current V1 capability.',
    '- ONTOLOGY_GAP — the product has a credible training function not representable by the current registry.',
    '- RULE_GAP — trusted V1 evidence is present but the classifier produced no assignment.',
    '- DATA_GAP — exact structured evidence needed for resolution is missing.',
    '- AMBIGUOUS — evidence supports multiple interpretations without a safe deterministic choice.',
    '- NEEDS_REVIEW — a product-level adjudication is required before publication.',
    '',
    '## KPI result',
    '',
    table(['Metric', 'Value'], [
      ['Active training-relevant denominator', kpis.activeTrainingRelevant],
      ['Target resolved products (95%)', kpis.targetResolvedProducts],
      ['Resolved products', kpis.resolvedProducts],
      ['Products short of 95% target', kpis.productsShortOfTarget],
      ['REAL_SEMANTIC_RESOLUTION_RATE', `${kpis.realSemanticResolutionRate}%`],
      ['Gap to 95% target', kpis.gapTo95PercentagePoints === null ? 'n/a' : `${kpis.gapTo95PercentagePoints} percentage points`],
      ['Unresolved products allowed', kpis.unresolvedAllowed],
      ['Unresolved products', kpis.unresolvedProducts],
      ['Positive classification rate', `${kpis.positiveClassificationRate}%`],
      ['Complete positive rate', `${kpis.completePositiveRate}%`],
      ['Complete positive rate among published positives', `${kpis.completePositiveRateOfPositiveClassifications}%`],
      ['Verified negative rate', `${kpis.verifiedNegativeRate}%`],
    ]),
    '',
    `Feasibility gate: **${feasibility.CAN_CURRENT_V1_REACH_95_PERCENT}**. ${feasibility.rationale}`,
    '',
    'Resolution-state counts:',
    '',
    table(['State', 'Products'], Object.entries(stateCounts).map(([key, value]) => [key, value])),
    '',
    '## Active unresolved products',
    '',
    'The unresolved file is ordered by active status, revenue, order lines, units, then productId. This is prioritization context only and is not semantic scoring.',
    '',
    table(['Product', 'Family', 'State', 'Candidates', 'Missing', 'Gap', 'Revenue', 'Reason'], unresolved.slice().sort(compareCommercial).slice(0, 40).map((record) => [record.productId, record.productFamily, record.resolutionState, record.candidateCapabilities.join('|'), record.missingCapabilities.join('|'), record.gapType, record.commercialContext.revenue, record.reason])),
    '',
    `The complete product-level analysis is in \`training-semantic-resolution-active.csv\` and the full JSON report. ${unresolved.length} products remain unresolved for the KPI.`,
    '',
    '## Known named cases',
    '',
    table(['Product', 'Expected review focus', 'Observed state'], [
      [1270, 'Curl de Femoral Acostado → LEG_CURL', records.find((record) => record.productId === 1270)?.resolutionState],
      [1504, 'Dual Cuádriceps / Femoral Sentado → LEG_EXTENSION + LEG_CURL', records.find((record) => record.productId === 1504)?.resolutionState],
      [1508, 'Dual Press Pectoral / Hombros → CHEST_PRESS + SHOULDER_PRESS', records.find((record) => record.productId === 1508)?.resolutionState],
      [2203, 'Dual Cuádriceps / Femoral Acostado → LEG_EXTENSION + LEG_CURL', records.find((record) => record.productId === 2203)?.resolutionState],
      [2092, 'T-Bar Row Beast → ROW rule gap', records.find((record) => record.productId === 2092)?.resolutionState],
    ]),
    '',
    '## Resolution by Product Family',
    '',
    table(['Family', 'Products', 'Complete', 'Partial', 'Verified no V1', 'Ontology', 'Rule', 'Data', 'Ambiguous', 'Review', 'REAL rate %'], families.map((row) => [row.productFamily, row.products, row.semanticComplete, row.semanticPartial, row.verifiedNoApplicableCapability, row.ontologyGap, row.ruleGap, row.dataGap, row.ambiguous, row.needsReview, row.realSemanticResolutionRate])),
    '',
    '## Gap inventory',
    '',
    table(['Gap', 'Products', 'Active', 'Revenue', 'Order lines', 'Units'], gaps.map((row) => [row.gapType, row.products, row.activeProducts, row.revenue, row.orderLines, row.unitsSold])),
    '',
    '## V1 capability review',
    '',
    'All 13 active V1 capabilities were reviewed for published positives and active unassigned trusted signals. No capability was added to Product Truth by this audit.',
    '',
    table(['Capability', 'Published', 'Active assigned', 'Complete', 'Partial', 'Active candidate', 'Unassigned candidate', 'Assessment'], (report.capabilityAudit as readonly Record<string, unknown>[]).map((row) => [row.capabilityCode, row.publishedAssignments, row.activeAssignedProducts, row.activeCompleteProducts, row.activePartialProducts, row.activeCandidateProducts, row.activeUnassignedCandidateProducts, row.assessment])),
    '',
    '## Denominator and generic equipment decision',
    '',
    `The denominator is the A00.6 definition reevaluated against the same catalog: ${kpis.activeTrainingRelevant} active products with a V1 assignment, a training-equipment Product Family, a trusted V1 signal, a deferred signal, or trusted training-equipment wording; clearly non-training families are excluded. No product was removed merely because it was difficult to classify.`,
    '',
    'Generic equipment is not auto-converted into movement capabilities. Where the current V1 registry cannot express a credible equipment function, the product is ONTOLOGY_GAP; where evidence is sufficient to exclude V1 (for example cardio-only or accessory/support products), it is VERIFIED_NO_APPLICABLE_CAPABILITY; where family or structured evidence is missing, it is DATA_GAP.',
    '',
    '## Feasibility and next action',
    '',
    `Current decision: ${report.decision}. ${feasibility.nextAction}`,
    '',
    'Future model candidates are documented but not implemented: TRAINING_FUNCTION, EQUIPMENT_CAPABILITY, SUPPORTED_MOVEMENT_PATTERN and LOAD_MODALITY. Deferred SQUAT and other candidates remain outside Product Truth.',
    '',
    'Artifacts:',
    '',
    '- `training-semantic-resolution-quality.md`',
    '- `training-semantic-resolution-active.csv`',
    '- `training-semantic-resolution-unresolved.csv`',
    '- `training-semantic-resolution-by-family.csv`',
    '- `training-semantic-resolution-by-gap.csv`',
    '- `training-semantic-resolution-report.json`',
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const snapshotDirectory = resolveTrainingSemanticSnapshotDir({ cwd: path.resolve(SCRIPT_DIR, '../..'), directory: args.snapshotDir });
  const store = new FileTrainingSemanticSnapshotStore(snapshotDirectory);
  const reader = new DefaultActiveTrainingSemanticSnapshotReader(store);
  await reader.refresh();
  const snapshot = await store.getActive();
  if (!snapshot) throw new Error('TRAINING_SEMANTIC_RESOLUTION_BLOCKED: no active Training Semantic Snapshot');
  assertSnapshotBaseline(snapshot);

  const inputPaths = await resolveProductSemanticInputPaths({ inputDir: args.inputDir, catalogCsvPath: args.catalog, categoryTrustMapCsvPath: args.categoryTrustMap, featureTrustMapCsvPath: args.featureTrustMap });
  const [{ inputs }, catalogText, deferredText] = await Promise.all([
    loadProductSemanticClassificationInputs(inputPaths),
    readFile(inputPaths.catalogCsvPath, 'utf8'),
    readFile(path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.4.1/deferred-capability-adjudication-detail.csv'), 'utf8'),
  ]);
  const contexts = buildContexts(parseCsvRecords(catalogText), inputs);
  const recordsById = recordMap(snapshot);
  if (contexts.length !== snapshot.counts.sourceProducts || contexts.some((context) => !recordsById.has(context.productId))) throw new Error('TRAINING_SEMANTIC_RESOLUTION_BLOCKED: catalog and snapshot product universes differ');
  const observedUnknownFamily = contexts.filter((context) => context.productFamily === 'UNKNOWN');
  if (observedUnknownFamily.length !== 330 || observedUnknownFamily.filter((context) => context.active).length !== 89 || observedUnknownFamily.filter((context) => recordsById.get(context.productId)!.assignments.length > 0).length !== 21) throw new Error('TRAINING_SEMANTIC_RESOLUTION_BLOCKED: UNKNOWN Product Family baseline drifted from 330 total / 89 active / 21 assigned');
  const deferredById = deferredRowsByProduct(parseCsvRecords(deferredText));
  const eligible = contexts.filter((context) => eligibleForResolution(context, recordsById.get(context.productId)!));
  const activeEligible = eligible.filter((context) => context.active);
  if (activeEligible.length !== EXPECTED_ACTIVE_TRAINING_RELEVANT) throw new Error(`TRAINING_SEMANTIC_RESOLUTION_BLOCKED: active denominator drifted from ${EXPECTED_ACTIVE_TRAINING_RELEVANT} to ${activeEligible.length}`);
  const resolutions = activeEligible.map((context) => classifyResolution(context, recordsById.get(context.productId)!, deferredById.get(context.productId) ?? []));
  if (new Set(resolutions.map((record) => record.productId)).size !== resolutions.length || resolutions.some((record) => !record.resolutionState)) throw new Error('TRAINING_SEMANTIC_RESOLUTION_BLOCKED: resolution cardinality/state invariant failed');

  const resolutionStateList: readonly ResolutionState[] = ['SEMANTIC_COMPLETE', 'SEMANTIC_PARTIAL', 'VERIFIED_NO_APPLICABLE_CAPABILITY', 'ONTOLOGY_GAP', 'RULE_GAP', 'DATA_GAP', 'AMBIGUOUS', 'NEEDS_REVIEW'];
  const observedStateCounts = countBy(resolutions.map((record) => record.resolutionState));
  const stateCounts = Object.fromEntries(resolutionStateList.map((state) => [state, observedStateCounts[state] ?? 0]));
  const resolvedProducts = (stateCounts.SEMANTIC_COMPLETE ?? 0) + (stateCounts.VERIFIED_NO_APPLICABLE_CAPABILITY ?? 0);
  const unresolvedProducts = resolutions.length - resolvedProducts;
  const ruleGapProducts = resolutions.filter((record) => record.resolutionState === 'RULE_GAP' || record.gapType === 'RULE_GAP');
  const ontologyGapProducts = resolutions.filter((record) => record.resolutionState === 'ONTOLOGY_GAP');
  const feasibleWithoutOntology = resolvedProducts + ruleGapProducts.length;
  const feasibilityCode = feasibleWithoutOntology >= TARGET_RESOLVED_PRODUCTS ? 'YES_WITH_CLASSIFIER_FIXES' : 'NO_REQUIRES_ONTOLOGY_EXPANSION';
  const decision = resolvedProducts >= TARGET_RESOLVED_PRODUCTS ? 'TRAINING_SEMANTIC_RESOLUTION_ACCEPTED' : feasibilityCode === 'YES_WITH_CLASSIFIER_FIXES' ? 'TRAINING_SEMANTIC_RESOLUTION_NEEDS_CLASSIFIER_FIXES' : 'TRAINING_SEMANTIC_RESOLUTION_NEEDS_ONTOLOGY_EXPANSION';
  const kpis = {
    activeTrainingRelevant: resolutions.length,
    targetResolvedProducts: TARGET_RESOLVED_PRODUCTS,
    resolvedProducts,
    unresolvedProducts,
    unresolvedAllowed: resolutions.length - TARGET_RESOLVED_PRODUCTS,
    productsShortOfTarget: Math.max(0, TARGET_RESOLVED_PRODUCTS - resolvedProducts),
    realSemanticResolutionRate: percent(resolvedProducts, resolutions.length),
    gapTo95PercentagePoints: Number((95 - (percent(resolvedProducts, resolutions.length) ?? 0)).toFixed(2)),
    positiveClassificationProducts: resolutions.filter((record) => record.currentAssignments.length > 0).length,
    positiveClassificationRate: percent(resolutions.filter((record) => record.currentAssignments.length > 0).length, resolutions.length),
    completePositiveProducts: stateCounts.SEMANTIC_COMPLETE ?? 0,
    completePositiveRate: percent(stateCounts.SEMANTIC_COMPLETE ?? 0, resolutions.length),
    completePositiveRateOfPositiveClassifications: percent(stateCounts.SEMANTIC_COMPLETE ?? 0, resolutions.filter((record) => record.currentAssignments.length > 0).length),
    verifiedNegativeProducts: stateCounts.VERIFIED_NO_APPLICABLE_CAPABILITY ?? 0,
    verifiedNegativeRate: percent(stateCounts.VERIFIED_NO_APPLICABLE_CAPABILITY ?? 0, resolutions.length),
    partialProducts: stateCounts.SEMANTIC_PARTIAL ?? 0,
    partialRate: percent(stateCounts.SEMANTIC_PARTIAL ?? 0, resolutions.length),
    ontologyGapProducts: stateCounts.ONTOLOGY_GAP ?? 0,
    ontologyGapRate: percent(stateCounts.ONTOLOGY_GAP ?? 0, resolutions.length),
    ruleGapProducts: stateCounts.RULE_GAP ?? 0,
    ruleGapRate: percent(stateCounts.RULE_GAP ?? 0, resolutions.length),
    dataGapProducts: stateCounts.DATA_GAP ?? 0,
    dataGapRate: percent(stateCounts.DATA_GAP ?? 0, resolutions.length),
    ambiguousProducts: stateCounts.AMBIGUOUS ?? 0,
    ambiguousRate: percent(stateCounts.AMBIGUOUS ?? 0, resolutions.length),
    needsReviewProducts: stateCounts.NEEDS_REVIEW ?? 0,
    needsReviewRate: percent(stateCounts.NEEDS_REVIEW ?? 0, resolutions.length),
  };
  const familyRows = resolutionByFamily(resolutions);
  const gapRows = resolutionByGap(resolutions);
  const capabilityRows = capabilityAudit(resolutions, recordsById);
  const report = {
    auditVersion: 'training-semantic-resolution-quality-v1',
    decision,
    authority: { snapshotId: snapshot.snapshotId, semanticChecksum: snapshot.semanticChecksum, registryVersion: snapshot.registryVersion, registryHash: snapshot.registryHash, classifierVersion: snapshot.classifierVersion, rulesHash: snapshot.rulesHash },
    contextualSources: { catalogExport: path.basename(inputPaths.catalogCsvPath), deferredAdjudication: 'deferred-capability-adjudication-detail.csv', productFamilyJoin: 'Product Semantic classifier context only; Training Semantic classifier was not rerun.' },
    denominator: { definition: 'A00.6 active training-relevant definition reevaluated without arbitrary exclusions.', allProducts: contexts.length, activeProducts: contexts.filter((context) => context.active).length, activeTrainingRelevantProducts: resolutions.length, eligibleProducts: eligible.length, excludedNonTrainingWithoutAssignments: contexts.filter((context) => !eligible.includes(context) && !NON_TRAINING_FAMILIES.has(context.productFamily)).length, unknownFamilyActiveTrainingRelevant: resolutions.filter((record) => record.productFamily === 'UNKNOWN').length },
    unknownFamilyAudit: { baselineTotalProducts: 330, baselineActiveProducts: 89, baselineAssignedProducts: 21, observedTotalProducts: contexts.filter((context) => context.productFamily === 'UNKNOWN').length, observedActiveProducts: contexts.filter((context) => context.productFamily === 'UNKNOWN' && context.active).length, observedAssignedProducts: contexts.filter((context) => context.productFamily === 'UNKNOWN' && recordsById.get(context.productId)!.assignments.length > 0).length, activeTrainingRelevantProducts: resolutions.filter((record) => record.productFamily === 'UNKNOWN').length, activeTrainingRelevantRecords: resolutions.filter((record) => record.productFamily === 'UNKNOWN') },
    resolutionStates: ['SEMANTIC_COMPLETE', 'SEMANTIC_PARTIAL', 'VERIFIED_NO_APPLICABLE_CAPABILITY', 'ONTOLOGY_GAP', 'RULE_GAP', 'DATA_GAP', 'AMBIGUOUS', 'NEEDS_REVIEW'],
    resolutionStateCounts: stateCounts,
    kpis,
    feasibility: { CAN_CURRENT_V1_REACH_95_PERCENT: feasibilityCode, currentV1ResolvedCeiling: percent(feasibleWithoutOntology, resolutions.length), currentV1ResolvedCeilingProducts: feasibleWithoutOntology, ruleGapProducts: ruleGapProducts.map((record) => record.productId), ontologyGapProducts: ontologyGapProducts.map((record) => record.productId), rationale: feasibilityCode === 'YES_WITH_CLASSIFIER_FIXES' ? 'The target is mathematically reachable within the current registry if the identified V1 rule gaps are corrected and validated.' : `Even after resolving all current rule-gap candidates, ${ontologyGapProducts.length} ontology-gap products remain outside the V1 model; the 95% target requires an ontology expansion or denominator policy decision.`, nextAction: feasibilityCode === 'YES_WITH_CLASSIFIER_FIXES' ? 'A classifier-fix slice must resolve and regression-test every listed rule gap before API work.' : 'Do not patch classifier rules to encode deferred or generic equipment semantics. Run an explicit ontology decision slice first.' },
    resolutionByFamily: familyRows,
    resolutionByGap: gapRows,
    capabilityAudit: capabilityRows,
    records: resolutions,
    commercialPrioritization: resolutions.filter((record) => !['SEMANTIC_COMPLETE', 'VERIFIED_NO_APPLICABLE_CAPABILITY'].includes(record.resolutionState)).sort(compareCommercial).map((record) => ({ productId: record.productId, name: record.name, resolutionState: record.resolutionState, gapType: record.gapType, revenue: record.commercialContext.revenue, orderLines: record.commercialContext.orderLines, unitsSold: record.commercialContext.unitsSold })),
    architecturalFinding: { currentV1RepresentsMovementCapabilities: true, genericEquipmentRepresentation: 'incomplete', futureCandidates: ['TRAINING_FUNCTION', 'EQUIPMENT_CAPABILITY', 'SUPPORTED_MOVEMENT_PATTERN', 'LOAD_MODALITY'], implementation: 'not_implemented' },
    namedCases: [1270, 1504, 1508, 2203, 2092].map((productId) => resolutions.find((record) => record.productId === productId)).filter((record): record is ResolutionRecord => record !== undefined),
    changes: { registryChanged: false, classifierChanged: false, snapshotChanged: false, apiChanged: false, salesAgentChanged: false, customerProfileChanged: false },
  };

  await mkdir(args.outputDir, { recursive: true });
  const activeCsv = csvRows(resolutions.slice().sort((left, right) => left.productId - right.productId));
  const unresolvedCsv = csvRows(resolutions.filter((record) => !['SEMANTIC_COMPLETE', 'VERIFIED_NO_APPLICABLE_CAPABILITY'].includes(record.resolutionState)).sort(compareCommercial));
  await writeFile(path.join(args.outputDir, 'training-semantic-resolution-active.csv'), writeCsv(Object.keys(activeCsv[0] ?? {}), activeCsv), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-resolution-unresolved.csv'), writeCsv(Object.keys(unresolvedCsv[0] ?? {}), unresolvedCsv), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-resolution-by-family.csv'), writeCsv(['productFamily', 'products', 'semanticComplete', 'semanticPartial', 'verifiedNoApplicableCapability', 'ontologyGap', 'ruleGap', 'dataGap', 'ambiguous', 'needsReview', 'realSemanticResolutionRate'], objectCsvRows(familyRows)), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-resolution-by-gap.csv'), writeCsv(['gapType', 'products', 'activeProducts', 'revenue', 'orderLines', 'unitsSold', 'productIds'], objectCsvRows(gapRows)), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-resolution-report.json'), `${safeJson(report)}\n`, 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-resolution-quality.md'), `${renderMarkdown(report, resolutions, familyRows, gapRows)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'ok', decision, snapshotId: snapshot.snapshotId, outputDir: args.outputDir, activeTrainingRelevant: resolutions.length, resolutionStateCounts: stateCounts, realSemanticResolutionRate: kpis.realSemanticResolutionRate, gapTo95PercentagePoints: kpis.gapTo95PercentagePoints, feasibility: feasibilityCode }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: 'failed', error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'Unknown training semantic resolution audit error' } }, null, 2));
  process.exitCode = 1;
});
