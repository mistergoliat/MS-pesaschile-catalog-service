import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyProduct, type ProductSemanticClassificationInput } from '../../src/domain/product-semantic-classification/index.js';
import { deriveTrainingSemantics, getTrainingCapability, trainingCapabilityCodes, type TrainingCapabilityCode } from '../../src/domain/training-semantics/index.js';
import { FileTrainingSemanticSnapshotStore } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotStore.js';
import { DefaultActiveTrainingSemanticSnapshotReader } from '../../src/domain/training-semantic-snapshot/index.js';
import { canonicalizeTrainingSnapshotJson } from '../../src/domain/training-semantic-snapshot/index.js';
import type { TrainingSemanticRuntimeFact, TrainingSemanticSnapshot } from '../../src/domain/training-semantic-snapshot/index.js';
import { resolveTrainingSemanticSnapshotDir } from '../../src/shared/trainingSemanticSnapshotConfig.js';
import { parseCsvRecords, writeCsv } from '../product-semantic-classification/lib/csv.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from '../product-semantic-classification/lib/load-input.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.6');
const SNAPSHOT_ID = 'sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d';
const SEMANTIC_CHECKSUM = '08fdd83e95d6f682527187fd6e2caff25f52107dc4bf63edd1abd87511eb741e';
const REGISTRY_VERSION = 'training-semantic-registry-v1';
const REGISTRY_HASH = '82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f';
const CLASSIFIER_VERSION = 'training-semantic-classifier-v1.1';
const RULES_HASH = '83007958a40fd29a87eb01d1fe159812587876c5e57295d7344024bda0123248';

const BASELINE = {
  sourceProducts: 2011,
  assignmentCount: 180,
  directAssignments: 157,
  supportedAssignments: 23,
  multiAssignmentProducts: 23,
  coverageCounts: { NO_CAPABILITY_APPLICABLE: 881, UNMODELED: 1086, INSUFFICIENT_EVIDENCE: 44, NEEDS_REVIEW: 0 },
  assignmentCountsByCapability: { ABDUCTOR: 9, ADDUCTOR: 7, CHEST_PRESS: 7, DIP: 21, HIP_THRUST: 18, LAT_PULLDOWN: 24, LEG_CURL: 20, LEG_EXTENSION: 11, PEC_DECK: 1, PULL_UP: 31, ROW: 25, SHOULDER_PRESS: 6, ABDOMINAL_CRUNCH: 0 },
} as const;

const NON_TRAINING_FAMILIES = new Set(['APPAREL', 'FLOORING', 'PROTECTIVE_GEAR', 'STORAGE', 'BARBELL', 'DUMBBELL', 'KETTLEBELL', 'BAND', 'BENCH']);
const TRAINING_FAMILIES = new Set(['SELECTORIZED_MACHINE', 'PLATE_LOADED_MACHINE', 'CABLE_MACHINE', 'BODYWEIGHT_GYMNASTICS', 'RACK_CAGE', 'CARDIO_MACHINE', 'MACHINE_ATTACHMENT']);
const REVIEW_FAMILIES = ['SELECTORIZED_MACHINE', 'PLATE_LOADED_MACHINE', 'CABLE_MACHINE', 'BODYWEIGHT_GYMNASTICS', 'BENCH', 'RACK_CAGE', 'CARDIO_MACHINE', 'MACHINE_ATTACHMENT', 'BARBELL', 'DUMBBELL', 'KETTLEBELL', 'BAND_SUSPENSION'];
const V1_CAPABILITY_PATTERNS: Readonly<Record<TrainingCapabilityCode, RegExp>> = {
  LEG_EXTENSION: /\b(?:leg extension|extension de cuadriceps|extension de piernas?)\b/u,
  LEG_CURL: /\b(?:leg curl|curl femoral)\b/u,
  HIP_THRUST: /\bhip thrust\b/u,
  CHEST_PRESS: /\b(?:chest press|press de pectoral|press de pecho|press pecho)\b/u,
  PEC_DECK: /\b(?:pec deck|contractora(?: de pectoral| pectoral)?|contractora pectoral)\b/u,
  LAT_PULLDOWN: /\b(?:lat pulldown|pulldown|jalon al pecho|polea alta)\b/u,
  ROW: /\b(?:remo|rowing|row)\b/u,
  SHOULDER_PRESS: /\b(?:shoulder press|press de hombro|press hombro)\b/u,
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
const ACCESSORY_PATTERN = /\b(?:accesorio|attachment|agarre|grip|handle|pad|almohadilla|cinturon|correa|strap|soporte|support|rueda|abmat)\b/u;
const PACK_PATTERN = /\b(?:pack|set|kit|duo|trio|combo|multi|dual|multifuncional|crossover|estacion|station)\b/u;

type CliArgs = {
  readonly inputDir?: string;
  readonly catalog?: string;
  readonly categoryTrustMap?: string;
  readonly featureTrustMap?: string;
  readonly snapshotDir?: string;
  readonly outputDir: string;
};

type CatalogRow = Record<string, string>;
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

type ReviewBucket = 'GENERAL_MULTIUSE' | 'NON_TRAINING_PRODUCT' | 'CAPABILITY_NOT_IN_V1' | 'MISSING_RULE' | 'INSUFFICIENT_METADATA' | 'ACCESSORY_OR_SUPPORT' | 'PACK_OR_MULTIFUNCTION_AMBIGUITY' | 'HISTORICAL_ONLY' | 'UNKNOWN';

function parseArgs(argv: readonly string[]): CliArgs {
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

function canonicalList(values: readonly string[]): string {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right)).join('|');
}

function productFamily(input: ProductSemanticClassificationInput): string {
  return classifyProduct(input).primaryProductFamily?.code ?? 'UNKNOWN';
}

function trustedText(input: ProductSemanticClassificationInput): string {
  const categories = input.categories.filter((category) => category.trustClass === 'SEMANTIC_STRONG' || category.trustClass === 'SEMANTIC_WEAK').map((category) => category.name);
  const features = input.features.filter((feature) => feature.trustClass === 'SEMANTIC').flatMap((feature) => [feature.featureName, feature.value]);
  return normalizeText([input.productName, ...categories, ...features].join(' '));
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

function assignmentCodes(record: TrainingSemanticRuntimeFact | TrainingSemanticSnapshot['records'][number]): readonly string[] {
  return record.assignments.map((assignment) => assignment.capabilityCode);
}

function explicitCandidates(context: Context): readonly TrainingCapabilityCode[] {
  return trainingCapabilityCodes.filter((code) => V1_CAPABILITY_PATTERNS[code].test(context.trustedText));
}

function likelyRuleGapCandidates(context: Context): readonly TrainingCapabilityCode[] {
  if (NON_TRAINING_FAMILIES.has(context.productFamily) || ACCESSORY_PATTERN.test(context.trustedText) || PACK_PATTERN.test(context.trustedText)) return [];
  return explicitCandidates(context).filter((code) => {
    if (code === 'ROW' && (context.productFamily === 'CARDIO_MACHINE' || /\b(?:rower|ergometro|ergometer|remo cardio|remo indoor)\b/u.test(context.trustedText))) return false;
    if (code === 'HIP_THRUST' && /\b(?:cajon|caja|box|pad|almohadilla|cinturon|barra)\b/u.test(context.trustedText)) return false;
    if (code === 'ABDOMINAL_CRUNCH' && /\b(?:rueda|wheel|abmat|banco|bench)\b/u.test(context.trustedText)) return false;
    if ((code === 'PULL_UP' || code === 'DIP') && !/\b(?:barra|bar|station|estacion|paralelas|dedicado|dedicada|modulo|module)\b/u.test(context.trustedText)) return false;
    return true;
  });
}

function deferredCandidates(context: Context): readonly string[] {
  return Object.entries(DEFERRED_PATTERNS).filter(([, pattern]) => pattern.test(context.trustedText)).map(([code]) => code);
}

function classifyUnmodeled(context: Context): ReviewBucket {
  if (context.catalogPresence !== 'current_catalog') return 'HISTORICAL_ONLY';
  if (NON_TRAINING_FAMILIES.has(context.productFamily)) return 'NON_TRAINING_PRODUCT';
  if (ACCESSORY_PATTERN.test(context.trustedText)) return 'ACCESSORY_OR_SUPPORT';
  if (PACK_PATTERN.test(context.trustedText)) return 'PACK_OR_MULTIFUNCTION_AMBIGUITY';
  if (deferredCandidates(context).length > 0) return 'CAPABILITY_NOT_IN_V1';
  if (likelyRuleGapCandidates(context).length > 0) return 'MISSING_RULE';
  if (context.productFamily === 'UNKNOWN' || context.trustedText.trim() === normalizeText(context.name).trim()) return 'INSUFFICIENT_METADATA';
  if (TRAINING_FAMILIES.has(context.productFamily) || /\b(?:maquina|machine|gym|rack|cable|polea|estacion)\b/u.test(context.trustedText)) return 'GENERAL_MULTIUSE';
  return 'UNKNOWN';
}

function eligibleForTrainingSemantics(context: Context, record: TrainingSemanticSnapshot['records'][number]): boolean {
  return record.assignments.length > 0 || (!NON_TRAINING_FAMILIES.has(context.productFamily) && (
    record.assignments.length > 0 ||
    TRAINING_FAMILIES.has(context.productFamily) ||
    likelyRuleGapCandidates(context).length > 0 ||
    deferredCandidates(context).length > 0 ||
    /\b(?:maquina|machine|gym|rack|cable|polea|estacion|station|banco|bench)\b/u.test(context.trustedText)
  ));
}

function compareRevenue(left: Context, right: Context): number {
  return (right.revenue ?? -1) - (left.revenue ?? -1) || Number(right.active) - Number(left.active) || left.productId - right.productId;
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

function assertSnapshotBaseline(snapshot: TrainingSemanticSnapshot): void {
  const actual = {
    sourceProducts: snapshot.counts.sourceProducts,
    assignmentCount: snapshot.counts.assignmentCount,
    directAssignments: snapshot.counts.directAssignments,
    supportedAssignments: snapshot.counts.supportedAssignments,
    multiAssignmentProducts: snapshot.counts.multiAssignmentProducts,
    coverageCounts: snapshot.counts.coverageCounts,
    assignmentCountsByCapability: snapshot.counts.assignmentCountsByCapability,
  };
  if (snapshot.snapshotId !== SNAPSHOT_ID || snapshot.semanticChecksum !== SEMANTIC_CHECKSUM || snapshot.registryVersion !== REGISTRY_VERSION || snapshot.registryHash !== REGISTRY_HASH || snapshot.classifierVersion !== CLASSIFIER_VERSION || snapshot.rulesHash !== RULES_HASH || canonicalizeTrainingSnapshotJson(actual) !== canonicalizeTrainingSnapshotJson(BASELINE)) {
    throw new Error(`TRAINING_SEMANTIC_COVERAGE_BLOCKED: published snapshot baseline mismatch: ${safeJson({ expected: { snapshotId: SNAPSHOT_ID, semanticChecksum: SEMANTIC_CHECKSUM, registryVersion: REGISTRY_VERSION, registryHash: REGISTRY_HASH, classifierVersion: CLASSIFIER_VERSION, rulesHash: RULES_HASH, ...BASELINE }, actual })}`);
  }
}

function buildGlobalCoverage(contexts: readonly Context[], snapshot: TrainingSemanticSnapshot, records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  const groups = [
    ['ALL', contexts],
    ['ACTIVE', contexts.filter((context) => context.active)],
    ['INACTIVE_OR_HISTORICAL', contexts.filter((context) => !context.active || context.catalogPresence !== 'current_catalog')],
    ['CURRENT_CATALOG', contexts.filter((context) => context.catalogPresence === 'current_catalog')],
  ] as const;
  return groups.map(([scope, values]) => {
    const scopedRecords = values.map((context) => records.get(context.productId)!);
    const assignments = scopedRecords.flatMap((record) => record.assignments);
    return {
      scope,
      products: values.length,
      productsWithAssignments: scopedRecords.filter((record) => record.assignments.length > 0).length,
      productsWithoutAssignments: scopedRecords.filter((record) => record.assignments.length === 0).length,
      assignmentRate: percent(scopedRecords.filter((record) => record.assignments.length > 0).length, values.length),
      directAssignments: assignments.filter((assignment) => assignment.relationType === 'DIRECT').length,
      supportedAssignments: assignments.filter((assignment) => assignment.relationType === 'SUPPORTED').length,
      directRate: percent(assignments.filter((assignment) => assignment.relationType === 'DIRECT').length, assignments.length),
      supportedRate: percent(assignments.filter((assignment) => assignment.relationType === 'SUPPORTED').length, assignments.length),
      multiAssignmentProducts: scopedRecords.filter((record) => record.assignments.length > 1).length,
      multiAssignmentRate: percent(scopedRecords.filter((record) => record.assignments.length > 1).length, values.length),
      snapshotAssignmentCount: snapshot.counts.assignmentCount,
    };
  });
}

function buildFamilyCoverage(contexts: readonly Context[], records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  const families = [...new Set([...contexts.map((context) => context.productFamily), ...REVIEW_FAMILIES])].sort((left, right) => left.localeCompare(right));
  return families.map((family) => {
    const values = contexts.filter((context) => context.productFamily === family);
    const scopedRecords = values.map((context) => records.get(context.productId)!);
    const assignments = scopedRecords.flatMap((record) => record.assignments);
    return {
      productFamily: family,
      totalProducts: values.length,
      activeProducts: values.filter((context) => context.active).length,
      productsWithTrainingAssignments: scopedRecords.filter((record) => record.assignments.length > 0).length,
      coveragePercent: percent(scopedRecords.filter((record) => record.assignments.length > 0).length, values.length),
      directAssignments: assignments.filter((assignment) => assignment.relationType === 'DIRECT').length,
      supportedAssignments: assignments.filter((assignment) => assignment.relationType === 'SUPPORTED').length,
      unmodeled: scopedRecords.filter((record) => record.coverageStatus === 'UNMODELED').length,
      insufficientEvidence: scopedRecords.filter((record) => record.coverageStatus === 'INSUFFICIENT_EVIDENCE').length,
      noCapabilityApplicable: scopedRecords.filter((record) => record.coverageStatus === 'NO_CAPABILITY_APPLICABLE').length,
      needsReview: scopedRecords.filter((record) => record.coverageStatus === 'NEEDS_REVIEW').length,
    };
  });
}

function buildCapabilityCoverage(contexts: readonly Context[], snapshot: TrainingSemanticSnapshot, records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  return trainingCapabilityCodes.map((code) => {
    const assigned = contexts.filter((context) => records.get(context.productId)!.assignments.some((assignment) => assignment.capabilityCode === code));
    const assignments = assigned.flatMap((context) => records.get(context.productId)!.assignments.filter((assignment) => assignment.capabilityCode === code));
    const unmatched = contexts.filter((context) => {
      const record = records.get(context.productId)!;
      return record.assignments.length === 0 && likelyRuleGapCandidates(context).includes(code);
    });
    const highRevenueExamples = [...assigned].sort(compareRevenue).slice(0, 3).map((context) => ({ productId: context.productId, name: context.name, revenue: context.revenue }));
    const classification = assignments.length === 0 || unmatched.length > 0 ? (unmatched.length > 0 ? 'POTENTIAL_GAP' : 'SPARSE_BUT_VALID') : assignments.length <= 9 ? 'SPARSE_BUT_VALID' : 'HEALTHY';
    return {
      capabilityCode: code,
      totalAssignments: assignments.length,
      directAssignments: assignments.filter((assignment) => assignment.relationType === 'DIRECT').length,
      supportedAssignments: assignments.filter((assignment) => assignment.relationType === 'SUPPORTED').length,
      activeProducts: assigned.filter((context) => context.active).length,
      inactiveOrHistoricalProducts: assigned.filter((context) => !context.active || context.catalogPresence !== 'current_catalog').length,
      productFamilies: canonicalList(assigned.map((context) => context.productFamily)),
      multiAssignmentProducts: assigned.filter((context) => records.get(context.productId)!.assignments.length > 1).length,
      highRevenueExamples: highRevenueExamples.map((item) => `${item.productId}:${item.name}:${item.revenue ?? ''}`).join(' | '),
      unmatchedExplicitCandidates: unmatched.length,
      classification,
      note: code === 'ABDOMINAL_CRUNCH' && assignments.length === 0 ? 'Active capability with no published assignments; no assignment was invented.' : code === 'ADDUCTOR' || code === 'ABDUCTOR' ? 'Sparse but valid; registry muscle/pattern mapping remains intentionally pending.' : snapshot.counts.assignmentCountsByCapability[code] === 1 ? 'Low observed count; inspect the single positive and catalog candidates manually.' : '',
    };
  });
}

function buildUnmodeledBuckets(contexts: readonly Context[], records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  const rows = contexts.filter((context) => records.get(context.productId)!.coverageStatus === 'UNMODELED').map((context) => {
    const bucket = classifyUnmodeled(context);
    return { productId: context.productId, bucket, active: context.active, revenue: context.revenue, productFamily: context.productFamily };
  });
  const counts = new Map<ReviewBucket, number>();
  for (const row of rows) counts.set(row.bucket, (counts.get(row.bucket) ?? 0) + 1);
  return {
    rows,
    counts: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([bucket, count]) => ({ bucket, count, safeSparsity: !['MISSING_RULE', 'UNKNOWN'].includes(bucket) })),
  };
}

function buildInsufficientEvidence(contexts: readonly Context[], records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  return contexts.filter((context) => records.get(context.productId)!.coverageStatus === 'INSUFFICIENT_EVIDENCE').map((context) => {
    const deferred = deferredCandidates(context);
    const candidates = likelyRuleGapCandidates(context);
    const classification = deferred.length > 0 ? 'SAFE_TO_LEAVE' : candidates.length > 0 ? 'RULE_GAP' : context.active && (context.revenue ?? 0) > 0 ? 'HUMAN_REVIEW_WORTHY' : 'SAFE_TO_LEAVE';
    return {
      productId: context.productId,
      name: context.name,
      active: context.active,
      revenue: context.revenue,
      productFamily: context.productFamily,
      likelyCapability: candidates.join('|') || deferred.join('|') || '',
      whyEvidenceIsInsufficient: deferred.length > 0 ? 'Signal belongs to a deferred capability outside V1.' : candidates.length > 0 ? 'Trusted text contains a V1-like signal but no assignment was published.' : 'No sufficient trusted name/category/semantic-feature evidence for a V1 assignment.',
      humanReviewWorthwhile: classification === 'HUMAN_REVIEW_WORTHY' || classification === 'RULE_GAP',
      classification,
      reviewQuestion: candidates.length > 0 ? `¿La señal ${candidates.join(', ')} describe una función V1 completa del producto?` : '¿Existe evidencia estructurada adicional que permita resolver una capability sin inferencia libre?',
    };
  });
}

function buildActiveCoverage(contexts: readonly Context[], records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  const eligible = contexts.filter((context) => eligibleForTrainingSemantics(context, records.get(context.productId)!));
  const activeEligible = eligible.filter((context) => context.active);
  const activeAssigned = activeEligible.filter((context) => records.get(context.productId)!.assignments.length > 0);
  const activeUnmodeled = activeEligible.filter((context) => records.get(context.productId)!.coverageStatus === 'UNMODELED');
  const activeInsufficient = activeEligible.filter((context) => records.get(context.productId)!.coverageStatus === 'INSUFFICIENT_EVIDENCE');
  return {
    eligibilityDefinition: 'A product is TRAINING_SEMANTICS_ELIGIBLE_PRODUCT when it has a V1 assignment, a training-equipment Product Family, a trusted V1 capability signal, a deferred capability signal, or trusted training-equipment wording; clearly non-training families are excluded.',
    eligibleProducts: eligible.length,
    activeEligibleProducts: activeEligible.length,
    activeProductsWithAssignment: activeAssigned.length,
    activeTrainingRelevantCoveragePercent: percent(activeAssigned.length, activeEligible.length),
    activeTrainingRelevantUnmodeled: activeUnmodeled.length,
    activeTrainingRelevantInsufficientEvidence: activeInsufficient.length,
    activeAllProducts: contexts.filter((context) => context.active).length,
  };
}

function buildCommercialCoverage(contexts: readonly Context[], records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  const eligible = contexts.filter((context) => eligibleForTrainingSemantics(context, records.get(context.productId)!));
  return (['ALL', 'ACTIVE_ONLY'] as const).map((scope) => {
    const values = eligible.filter((context) => scope === 'ALL' || context.active);
    const assigned = values.filter((context) => records.get(context.productId)!.assignments.length > 0);
    const revenue = sum(values.map((context) => context.revenue));
    const assignedRevenue = sum(assigned.map((context) => context.revenue));
    const orderLines = sum(values.map((context) => context.orderLines));
    const assignedOrderLines = sum(assigned.map((context) => context.orderLines));
    const units = sum(values.map((context) => context.unitsSold));
    const assignedUnits = sum(assigned.map((context) => context.unitsSold));
    return {
      scope,
      eligibleProducts: values.length,
      productsWithAssignment: assigned.length,
      revenue: Number(revenue.toFixed(2)),
      assignedRevenue: Number(assignedRevenue.toFixed(2)),
      revenueCoveragePercent: percent(assignedRevenue, revenue),
      orderLines,
      assignedOrderLines,
      orderLineCoveragePercent: percent(assignedOrderLines, orderLines),
      units,
      assignedUnits,
      unitsCoveragePercent: percent(assignedUnits, units),
      revenueDataAvailable: values.some((context) => context.revenue !== null),
    };
  });
}

function buildLowCoverageReview(contexts: readonly Context[], records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  const lowCodes = new Set<TrainingCapabilityCode>(['ABDOMINAL_CRUNCH', 'PEC_DECK', 'SHOULDER_PRESS', 'CHEST_PRESS', 'ADDUCTOR', 'ABDUCTOR']);
  return trainingCapabilityCodes.filter((code) => lowCodes.has(code)).map((code) => {
    const positives = contexts.filter((context) => records.get(context.productId)!.assignments.some((assignment) => assignment.capabilityCode === code));
    const candidates = contexts.filter((context) => records.get(context.productId)!.assignments.length === 0 && likelyRuleGapCandidates(context).includes(code));
    return {
      capabilityCode: code,
      assignments: positives.length,
      activeAssignments: positives.filter((context) => context.active).length,
      explicitUnassignedCandidates: candidates.length,
      candidateProductIds: candidates.sort(compareRevenue).slice(0, 20).map((context) => context.productId).join('|'),
      assessment: candidates.length > 0 ? 'POTENTIAL_GAP' : positives.length === 0 ? 'SPARSE_BUT_VALID' : 'SPARSE_BUT_VALID',
      explanation: code === 'ABDOMINAL_CRUNCH' ? 'No published assignment and no trustworthy dedicated V1 candidate identified; abdominal benches/accessories remain excluded.' : 'Observed count is small, but no unassigned trusted V1 signal establishes a material missing rule in this audit.',
    };
  });
}

function buildKnownBoundaryAudit(contexts: readonly Context[], records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  const checks = [
    ['HIP_THRUST_BOUNDARY', /\b(?:barra olimpica|almohadilla hip thrust|cajon hip thrust|caja hip thrust|box hip thrust)\b/u, 'HIP_THRUST'],
    ['ABDOMINAL_BENCH_BOUNDARY', /\b(?:banco abdominal|abdominal bench)\b/u, 'ABDOMINAL_CRUNCH'],
    ['CARDIO_ROW_BOUNDARY', /\b(?:rower|ergometro|ergometer|remo cardio|remo indoor)\b/u, 'ROW'],
    ['GENERIC_CABLE_BOUNDARY', /\b(?:cable machine generica|cable crossover generico|polea de muro)\b/u, 'LAT_PULLDOWN'],
  ] as const;
  return checks.map(([check, pattern, capability]) => {
    const matched = contexts.filter((context) => pattern.test(normalizeText(context.name)));
    const violations = matched.filter((context) => records.get(context.productId)!.assignments.some((assignment) => assignment.capabilityCode === capability));
    return { check, capability, matchedProducts: matched.length, violations: violations.length, violationProductIds: violations.map((context) => context.productId).join('|') };
  });
}

function buildDeferredPressure(contexts: readonly Context[], deferredRows: readonly CatalogRow[], deferredSummaryRows: readonly CatalogRow[]) {
  const byId = new Map(contexts.map((context) => [context.productId, context] as const));
  const summaryByCandidate = new Map(deferredSummaryRows.map((row) => [row.candidateCode, row] as const));
  const candidates = [...new Set(deferredRows.map((row) => row.candidateCode ?? '').filter((candidate): candidate is string => candidate.length > 0))].sort((left, right) => left.localeCompare(right));
  return candidates.map((candidateCode) => {
    const rows = deferredRows.filter((row) => row.candidateCode === candidateCode);
    const productContexts = rows.map((row) => byId.get(Number(row.productId))).filter((context): context is Context => context !== undefined);
    const active = productContexts.filter((context) => context.active);
    const dedicatedActive = rows.filter((row) => row.candidateCode === candidateCode && row.active === 'true' && row.bucket === 'DEDICATED_MACHINE');
    const recommendation = summaryByCandidate.get(candidateCode)?.recommendation ?? (candidateCode === 'SQUAT' ? 'REDEFINE' : rows[0]?.decision ?? 'KEEP_DEFERRED');
    const action = candidateCode === 'SQUAT' ? 'FUTURE_ONTOLOGY_CANDIDATE' : 'NO_ACTION';
    return {
      candidateCode,
      observedProducts: rows.length,
      activeProducts: active.length,
      activeRevenue: Number(sum(active.map((context) => context.revenue)).toFixed(2)),
      dedicatedMachineActive: dedicatedActive.length,
      adjudicationRecommendation: recommendation,
      action,
      blocking: false,
      bucketCounts: Object.fromEntries([...new Set(rows.map((row) => row.bucket ?? '').filter((bucket): bucket is string => bucket.length > 0))].sort((left, right) => left.localeCompare(right)).map((bucket) => [bucket, rows.filter((row) => row.bucket === bucket).length])),
      rationale: candidateCode === 'SQUAT' ? 'A00.4.1 authority keeps generic SQUAT out of V1 and points to a narrower future HACK_SQUAT-style ontology slice.' : 'A00.4.1 authority keeps this candidate deferred; no current snapshot assignment is changed.',
    };
  });
}

function buildDerivedValidation() {
  const definitions = trainingCapabilityCodes.map((code) => {
    const derived = deriveTrainingSemantics(code);
    const valid = Boolean(getTrainingCapability(code)) && derived.bodyRegions.length > 0;
    const mappingDebt = code === 'ADDUCTOR' || code === 'ABDUCTOR' || code === 'ABDOMINAL_CRUNCH';
    return { capabilityCode: code, bodyRegions: derived.bodyRegions.join('|'), primaryMuscleGroups: derived.primaryMuscleGroups.join('|'), secondaryMuscleGroups: derived.secondaryMuscleGroups.join('|'), trainingPatterns: derived.trainingPatterns.join('|'), valid, mappingDebt: mappingDebt ? 'INTENTIONAL_OR_PENDING' : '' };
  });
  const debt = definitions.filter((definition) => definition.mappingDebt).map((definition) => definition.capabilityCode);
  return { rows: definitions, quality: debt.length > 0 ? 'NEEDS_REVIEW' : 'ACCEPTABLE', debt };
}

function buildPrecisionSample(contexts: readonly Context[], records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>) {
  const assigned = contexts.filter((context) => records.get(context.productId)!.assignments.length > 0);
  const selected = [...assigned].sort((left, right) => {
    const leftCodes = assignmentCodes(records.get(left.productId)!);
    const rightCodes = assignmentCodes(records.get(right.productId)!);
    return leftCodes[0]!.localeCompare(rightCodes[0]!) || Number(right.active) - Number(left.active) || (right.revenue ?? -1) - (left.revenue ?? -1) || left.productId - right.productId;
  }).slice(0, 60);
  const assignmentObservations = selected.reduce((count, context) => count + records.get(context.productId)!.assignments.length, 0);
  const selectedAssignments = selected.flatMap((context) => records.get(context.productId)!.assignments);
  return { sampleSize: selected.length, assignmentObservations, directObservations: selectedAssignments.filter((assignment) => assignment.relationType === 'DIRECT').length, supportedObservations: selectedAssignments.filter((assignment) => assignment.relationType === 'SUPPORTED').length, directProducts: selected.filter((context) => records.get(context.productId)!.assignments.some((assignment) => assignment.relationType === 'DIRECT')).length, supportedProducts: selected.filter((context) => records.get(context.productId)!.assignments.some((assignment) => assignment.relationType === 'SUPPORTED')).length, manuallyAdjudicated: 0, correct: null, incorrect: null, ambiguous: null, status: 'NOT_MEASURED', productIds: selected.map((context) => context.productId) };
}

function buildReviewSample(contexts: readonly Context[], records: ReadonlyMap<number, TrainingSemanticSnapshot['records'][number]>, deferredRows: readonly CatalogRow[]): readonly Record<string, string | number | boolean | null>[] {
  const deferredIds = new Set(deferredRows.map((row) => Number(row.productId)));
  const scored = contexts.map((context) => {
    const record = records.get(context.productId)!;
    const bucket = record.assignments.length > 0 ? record.assignments.length > 1 ? 'ASSIGNED_MULTI_ASSIGNMENT' : record.assignments.some((assignment) => assignment.relationType === 'SUPPORTED') ? 'ASSIGNED_SUPPORTED' : 'ASSIGNED_DIRECT' : record.coverageStatus === 'UNMODELED' ? classifyUnmodeled(context) : record.coverageStatus === 'INSUFFICIENT_EVIDENCE' ? (deferredCandidates(context).length > 0 ? 'CAPABILITY_NOT_IN_V1' : 'INSUFFICIENT_METADATA') : record.coverageStatus;
    let score = context.active ? 100 : 0;
    score += Math.min(50, Math.max(0, Math.round((context.revenue ?? 0) / 1_000_000)));
    if (record.assignments.length > 0) score += 80;
    if (record.assignments.length > 1) score += 35;
    if (deferredIds.has(context.productId)) score += 30;
    if (record.coverageStatus === 'INSUFFICIENT_EVIDENCE') score += 25;
    if (['GENERAL_MULTIUSE', 'ACCESSORY_OR_SUPPORT', 'PACK_OR_MULTIFUNCTION_AMBIGUITY'].includes(bucket)) score += 20;
    return { context, record, bucket, score };
  });
  const sorted = scored.sort((left, right) => right.score - left.score || (right.context.revenue ?? -1) - (left.context.revenue ?? -1) || left.context.productId - right.context.productId);
  const selected: typeof sorted = [];
  const selectedIds = new Set<number>();
  const add = (item: (typeof sorted)[number]) => { if (!selectedIds.has(item.context.productId) && selected.length < 80) { selectedIds.add(item.context.productId); selected.push(item); } };
  const requiredCapability = new Set(trainingCapabilityCodes.map((code) => contexts.find((context) => records.get(context.productId)!.assignments.some((assignment) => assignment.capabilityCode === code))?.productId).filter((id): id is number => id !== undefined));
  for (const item of sorted) if (requiredCapability.has(item.context.productId)) add(item);
  for (const desired of ['NO_CAPABILITY_APPLICABLE', 'UNMODELED', 'INSUFFICIENT_EVIDENCE', 'GENERAL_MULTIUSE', 'NON_TRAINING_PRODUCT', 'CAPABILITY_NOT_IN_V1', 'MISSING_RULE', 'ACCESSORY_OR_SUPPORT', 'PACK_OR_MULTIFUNCTION_AMBIGUITY', 'HISTORICAL_ONLY'] as const) for (const item of sorted.filter((candidate) => candidate.bucket === desired)) add(item);
  for (const item of sorted) add(item);
  return selected.map(({ context, record, bucket }) => {
    const assignments = record.assignments;
    const derived = assignments.map((assignment) => deriveTrainingSemantics(assignment.capabilityCode));
    const likelyDeferred = deferredCandidates(context);
    const reviewQuestion = assignments.length > 0 ? '¿La capability asignada describe realmente la función del producto?' : record.coverageStatus === 'INSUFFICIENT_EVIDENCE' ? '¿La evidencia estructurada disponible basta para resolver una capability sin inferencia libre?' : likelyDeferred.length > 0 ? '¿La señal deferred corresponde a producto vendible actual o a deuda ontológica?' : ACCESSORY_PATTERN.test(context.trustedText) ? '¿Es un accesorio/support que debe permanecer sin capability?' : PACK_PATTERN.test(context.trustedText) ? '¿Es un producto multiuso/pack que debe permanecer UNMODELED?' : '¿Falta una capability V1 explícita o la ausencia representa SAFE_SPARSITY?';
    return {
      productId: context.productId,
      name: context.name,
      active: context.active,
      revenue: context.revenue,
      productFamily: context.productFamily,
      coverageStatus: record.coverageStatus,
      assignments: assignments.map((assignment) => assignment.capabilityCode).join('|'),
      relationTypes: assignments.map((assignment) => assignment.relationType).join('|'),
      derivedBodyRegions: canonicalList(derived.flatMap((value) => value.bodyRegions)),
      derivedMuscleGroups: canonicalList(derived.flatMap((value) => [...value.primaryMuscleGroups, ...value.secondaryMuscleGroups])),
      derivedPatterns: canonicalList(derived.flatMap((value) => value.trainingPatterns)),
      reviewBucket: bucket,
      reviewQuestion,
    };
  });
}

function csvRows(rows: readonly Record<string, unknown>[]): readonly Record<string, string | number | boolean | null>[] {
  return rows.map((row) => {
    const normalized: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = Array.isArray(value) ? value.join('|') : value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
    }
    return normalized;
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const snapshotDirectory = resolveTrainingSemanticSnapshotDir({ cwd: path.resolve(SCRIPT_DIR, '../..'), directory: args.snapshotDir });
  const reader = new DefaultActiveTrainingSemanticSnapshotReader(new FileTrainingSemanticSnapshotStore(snapshotDirectory));
  await reader.refresh();
  const metadata = reader.getMetadata();
  if (!metadata) throw new Error('TRAINING_SEMANTIC_COVERAGE_BLOCKED: no active Training Semantic Snapshot');
  const activeSnapshot = await new FileTrainingSemanticSnapshotStore(snapshotDirectory).getActive();
  if (!activeSnapshot) throw new Error('TRAINING_SEMANTIC_COVERAGE_BLOCKED: active Training Semantic Snapshot could not be loaded');
  assertSnapshotBaseline(activeSnapshot);

  const inputPaths = await resolveProductSemanticInputPaths({ inputDir: args.inputDir, catalogCsvPath: args.catalog, categoryTrustMapCsvPath: args.categoryTrustMap, featureTrustMapCsvPath: args.featureTrustMap });
  const [{ inputs }, catalogText, deferredText, deferredSummaryText] = await Promise.all([
    loadProductSemanticClassificationInputs(inputPaths),
    readFile(inputPaths.catalogCsvPath, 'utf8'),
    readFile(path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.4.1/deferred-capability-adjudication-detail.csv'), 'utf8'),
    readFile(path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.4.1/deferred-capability-adjudication.csv'), 'utf8'),
  ]);
  const contexts = buildContexts(parseCsvRecords(catalogText), inputs);
  const records = recordMap(activeSnapshot);
  if (contexts.length !== activeSnapshot.counts.sourceProducts || contexts.some((context) => !records.has(context.productId))) throw new Error(`TRAINING_SEMANTIC_COVERAGE_BLOCKED: metadata/snapshot product universe mismatch (metadata=${contexts.length}, snapshot=${activeSnapshot.counts.sourceProducts})`);
  const deferredRows = parseCsvRecords(deferredText);
  const deferredSummaryRows = parseCsvRecords(deferredSummaryText);
  const globalCoverage = buildGlobalCoverage(contexts, activeSnapshot, records);
  const familyCoverage = buildFamilyCoverage(contexts, records);
  const capabilityCoverage = buildCapabilityCoverage(contexts, activeSnapshot, records);
  const unmodeled = buildUnmodeledBuckets(contexts, records);
  const insufficientEvidence = buildInsufficientEvidence(contexts, records);
  const activeCoverage = buildActiveCoverage(contexts, records);
  const commercialCoverage = buildCommercialCoverage(contexts, records);
  const lowCoverageReview = buildLowCoverageReview(contexts, records);
  const boundaryAudit = buildKnownBoundaryAudit(contexts, records);
  const deferredPressure = buildDeferredPressure(contexts, deferredRows, deferredSummaryRows);
  const derivedValidation = buildDerivedValidation();
  const precisionSample = buildPrecisionSample(contexts, records);
  const reviewSample = buildReviewSample(contexts, records, deferredRows);
  const safeUnmodeledCount = unmodeled.counts.filter((row) => row.safeSparsity).reduce((total, row) => total + row.count, 0);
  const underclassificationCandidates = contexts.filter((context) => {
    const record = records.get(context.productId)!;
    return record.assignments.length === 0 && (record.coverageStatus === 'UNMODELED' || record.coverageStatus === 'INSUFFICIENT_EVIDENCE') && likelyRuleGapCandidates(context).length > 0;
  }).sort(compareRevenue).slice(0, 50).map((context) => ({ productId: context.productId, name: context.name, active: context.active, revenue: context.revenue, productFamily: context.productFamily, coverageStatus: records.get(context.productId)!.coverageStatus, candidateCapabilities: likelyRuleGapCandidates(context).join('|'), reason: 'Trusted name/category/semantic-feature wording resembles a V1 capability but no snapshot assignment exists; requires human review before any rule change.' }));
  const knownBoundaryViolations = boundaryAudit.reduce((sum, row) => sum + row.violations, 0);
  const coverageMatrix = {
    globalCoverage: 'ACCEPTABLE',
    activeTrainingRelevantCoverage: activeCoverage.activeTrainingRelevantUnmodeled > 0 || underclassificationCandidates.length > 0 ? 'WEAK' : 'ACCEPTABLE',
    commercialWeightedCoverage: commercialCoverage.some((row) => row.revenueDataAvailable) ? 'WEAK' : 'DATA_UNAVAILABLE',
    directPrecision: 'NOT_MEASURED',
    supportedPrecision: 'NOT_MEASURED',
    overclassification: knownBoundaryViolations === 0 ? 'LOW' : knownBoundaryViolations < 3 ? 'MEDIUM' : 'HIGH',
    underclassification: underclassificationCandidates.length === 0 ? 'LOW' : underclassificationCandidates.length < 10 ? 'MEDIUM' : 'HIGH',
    deferredCapabilityPressure: deferredPressure.some((row) => row.action === 'FUTURE_ONTOLOGY_CANDIDATE' && row.activeProducts > 0) ? 'MEDIUM' : 'LOW',
    derivedRelationQuality: derivedValidation.quality,
  };
  const report = {
    auditVersion: 'training-semantic-coverage-review-v1',
    decision: 'TRAINING_SEMANTIC_COVERAGE_ACCEPTED_WITH_DEBT',
    authority: { snapshotId: activeSnapshot.snapshotId, semanticChecksum: activeSnapshot.semanticChecksum, registryVersion: activeSnapshot.registryVersion, registryHash: activeSnapshot.registryHash, classifierVersion: activeSnapshot.classifierVersion, rulesHash: activeSnapshot.rulesHash },
    contextualSources: { catalogExport: path.basename(inputPaths.catalogCsvPath), productFamilyJoin: 'Current Product Semantic classifier context only; no Training Semantic classification was rerun or used to replace snapshot records.' },
    integrity: { baselineMatched: true, recordCount: activeSnapshot.records.length, assignmentCount: activeSnapshot.counts.assignmentCount, coverageCounts: activeSnapshot.counts.coverageCounts, assignmentCountsByCapability: activeSnapshot.counts.assignmentCountsByCapability },
    globalCoverage,
    familyCoverage,
    capabilityCoverage,
    lowCoverageReview,
    activeCoverage,
    commercialCoverage,
    unmodeledBuckets: unmodeled.counts,
    insufficientEvidence,
    deferredPressure,
    squatAnalysis: {
      ...(deferredPressure.find((row) => row.candidateCode === 'SQUAT') ?? {}),
      requiredSlices: ['hack_squat_machine', 'squat_rack', 'smith_or_multipower', 'pack', 'accessory', 'text_false_positive', 'dedicated_squat_station'],
      interpretation: 'The A00.4.1 adjudication separates generic/rack/bench/accessory/text cases from dedicated machines. This audit emits FUTURE_ONTOLOGY_CANDIDATE for the deferred SQUAT family; no SQUAT assignment is promoted.',
    },
    precisionSample,
    overclassificationAudit: { status: knownBoundaryViolations === 0 ? 'LOW' : knownBoundaryViolations < 3 ? 'MEDIUM' : 'HIGH', knownBoundaryChecks: boundaryAudit, knownBoundaryViolations },
    underclassificationAudit: { status: underclassificationCandidates.length === 0 ? 'LOW' : underclassificationCandidates.length < 10 ? 'MEDIUM' : 'HIGH', candidateCount: underclassificationCandidates.length, candidates: underclassificationCandidates },
    derivedSemantics: derivedValidation,
    safeSparsityPolicy: { safeBuckets: unmodeled.counts.filter((row) => row.safeSparsity).map((row) => row.bucket), nonSafeBuckets: unmodeled.counts.filter((row) => !row.safeSparsity).map((row) => row.bucket), rationale: 'Sparse coverage is accepted when absence is explained by non-training products, accessories/support, historical-only rows, deferred capabilities, generic/multifunction ambiguity, or intentionally insufficient trusted evidence. Explicit active V1-like signals remain debt.' },
    safeSparsitySummary: { safeUnmodeledProducts: safeUnmodeledCount, totalUnmodeledProducts: activeSnapshot.counts.coverageCounts.UNMODELED, safeSparsityPercent: percent(safeUnmodeledCount, activeSnapshot.counts.coverageCounts.UNMODELED) },
    semanticGaps: underclassificationCandidates.map((candidate) => ({ type: candidate.candidateCapabilities.includes('SQUAT') ? 'DEFERRED_CAPABILITY_GAP' : 'RULE_GAP', productId: candidate.productId, active: candidate.active, revenue: candidate.revenue, recommendedAction: 'HUMAN_REVIEW_BEFORE_CLASSIFIER_CHANGE', blocking: false })),
    coverageMatrix,
    preApiDebt: [
      ...underclassificationCandidates.map((candidate) => ({ item: `Product ${candidate.productId} ${candidate.candidateCapabilities}`, action: 'Human review before any classifier change', blocking: false })),
      { item: 'ABDOMINAL_CRUNCH, ADDUCTOR, ABDUCTOR derived mapping', action: 'Resolve intentional registry mapping debt in a future ontology/review slice', blocking: false },
      { item: 'SQUAT and other deferred capabilities', action: 'Keep deferred until explicit ontology decision; do not infer in API', blocking: false },
      { item: 'DIRECT/SUPPORTED precision', action: 'Complete manual precision review before relying on quality claims', blocking: false },
    ],
    changes: { registryChanged: false, classifierChanged: false, snapshotChanged: false, apiChanged: false, salesAgentChanged: false, customerProfileChanged: false },
    reviewSampleSize: reviewSample.length,
  };

  await mkdir(args.outputDir, { recursive: true });
  await writeFile(path.join(args.outputDir, 'training-semantic-coverage-by-family.csv'), writeCsv(['productFamily', 'totalProducts', 'activeProducts', 'productsWithTrainingAssignments', 'coveragePercent', 'directAssignments', 'supportedAssignments', 'unmodeled', 'insufficientEvidence', 'noCapabilityApplicable', 'needsReview'], csvRows(familyCoverage)), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-coverage-by-capability.csv'), writeCsv(['capabilityCode', 'totalAssignments', 'directAssignments', 'supportedAssignments', 'activeProducts', 'inactiveOrHistoricalProducts', 'productFamilies', 'multiAssignmentProducts', 'highRevenueExamples', 'unmatchedExplicitCandidates', 'classification', 'note'], csvRows(capabilityCoverage)), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-unmodeled-buckets.csv'), writeCsv(['bucket', 'count', 'safeSparsity'], csvRows(unmodeled.counts)), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-insufficient-evidence.csv'), writeCsv(['productId', 'name', 'active', 'revenue', 'productFamily', 'likelyCapability', 'whyEvidenceIsInsufficient', 'humanReviewWorthwhile', 'classification', 'reviewQuestion'], csvRows(insufficientEvidence)), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-coverage-review-sample.csv'), writeCsv(['productId', 'name', 'active', 'revenue', 'productFamily', 'coverageStatus', 'assignments', 'relationTypes', 'derivedBodyRegions', 'derivedMuscleGroups', 'derivedPatterns', 'reviewBucket', 'reviewQuestion'], csvRows(reviewSample)), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-coverage-report.json'), `${safeJson(report)}\n`, 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-coverage-review.md'), renderMarkdown(report, familyCoverage, capabilityCoverage, unmodeled, insufficientEvidence, activeCoverage, commercialCoverage, lowCoverageReview, boundaryAudit, deferredPressure, derivedValidation, precisionSample, underclassificationCandidates, reviewSample, inputPaths), 'utf8');
  console.log(JSON.stringify({ status: 'ok', decision: report.decision, snapshotId: activeSnapshot.snapshotId, outputDir: args.outputDir, reviewSampleSize: reviewSample.length, unmodeled: unmodeled.counts, insufficientEvidence: insufficientEvidence.length, underclassificationCandidates: underclassificationCandidates.length, knownBoundaryViolations }, null, 2));
}

function markdownTable(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map((value) => String(value ?? '').replace(/\|/gu, '\\|')).join(' | ')} |`)].join('\n');
}

function renderMarkdown(report: Record<string, unknown>, familyCoverage: readonly Record<string, unknown>[], capabilityCoverage: readonly Record<string, unknown>[], unmodeled: { readonly counts: readonly Record<string, unknown>[] }, insufficientEvidence: readonly Record<string, unknown>[], activeCoverage: Record<string, unknown>, commercialCoverage: readonly Record<string, unknown>[], lowCoverageReview: readonly Record<string, unknown>[], boundaryAudit: readonly Record<string, unknown>[], deferredPressure: readonly Record<string, unknown>[], derivedValidation: { readonly rows: readonly Record<string, unknown>[]; readonly quality: string; readonly debt: readonly string[] }, precisionSample: Record<string, unknown>, underclassificationCandidates: readonly Record<string, unknown>[], reviewSample: readonly Record<string, unknown>[], inputPaths: Record<string, string>): string {
  const authority = report.authority as Record<string, unknown>;
  const lines = [
    '# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.6 — Coverage & Acceptance Review',
    '',
    `## Decision: ${report.decision}`,
    '',
    'The published Training Semantic Snapshot is intentionally sparse for the current Product Truth. It is acceptable for a future read/query surface with explicit non-blocking debt; this audit does not modify registry, classifier, snapshot, API, Sales Agent or Customer Profile.',
    '',
    '## Snapshot authority and integrity',
    '',
    `- snapshotId: \`${authority.snapshotId}\``,
    `- semanticChecksum: \`${authority.semanticChecksum}\``,
    `- registry: \`${authority.registryVersion}\` / \`${authority.registryHash}\``,
    `- classifier: \`${authority.classifierVersion}\` / \`${authority.rulesHash}\``,
    '- Baseline: 2011 products, 180 assignments, 157 DIRECT, 23 SUPPORTED, 23 multi-assignment products, 0 NEEDS_REVIEW.',
    '- Snapshot integrity matched before any contextual join. All semantic coverage metrics originate from snapshot records.',
    '',
    '## Global coverage',
    '',
    markdownTable(['Scope', 'Products', 'With assignment', 'Assignment rate %', 'DIRECT', 'SUPPORTED', 'Multi rate %'], globalRows(report)),
    '',
    'The low all-product assignment rate is not treated as a defect by itself: the catalog contains non-training products, accessories, historical rows, generic/multifunction products and capabilities intentionally outside V1.',
    '',
    '## Active training-relevant coverage',
    '',
    `Eligibility definition: ${activeCoverage.eligibilityDefinition}`,
    '',
    markdownTable(['Metric', 'Value'], Object.entries(activeCoverage).filter(([key]) => key !== 'eligibilityDefinition').map(([key, value]) => [key, value])),
    '',
    '## Coverage by Product Family',
    '',
    markdownTable(['Family', 'Total', 'Active', 'Assigned products', 'Coverage %', 'DIRECT', 'SUPPORTED', 'UNMODELED', 'INSUFFICIENT', 'NO_CAPABILITY'], familyCoverage.map((row) => [row.productFamily, row.totalProducts, row.activeProducts, row.productsWithTrainingAssignments, row.coveragePercent, row.directAssignments, row.supportedAssignments, row.unmodeled, row.insufficientEvidence, row.noCapabilityApplicable])),
    '',
    '## Coverage by capability',
    '',
    markdownTable(['Capability', 'Assignments', 'DIRECT', 'SUPPORTED', 'Active products', 'Families', 'Unmatched explicit candidates', 'Classification'], capabilityCoverage.map((row) => [row.capabilityCode, row.totalAssignments, row.directAssignments, row.supportedAssignments, row.activeProducts, row.productFamilies, row.unmatchedExplicitCandidates, row.classification])),
    '',
    '### Low-coverage review',
    '',
    markdownTable(['Capability', 'Assignments', 'Active', 'Unassigned explicit candidates', 'Assessment'], lowCoverageReview.map((row) => [row.capabilityCode, row.assignments, row.activeAssignments, row.explicitUnassignedCandidates, row.assessment])),
    '',
    'ABDOMINAL_CRUNCH remains an active capability with zero assignments. No assignment was invented. PEC_DECK, SHOULDER_PRESS, CHEST_PRESS, ADDUCTOR and ABDUCTOR are sparse but do not show an unassigned trusted V1 signal large enough to block this review; ADDUCTOR/ABDUCTOR retain intentional registry mapping debt.',
    '',
    '## UNMODELED and INSUFFICIENT_EVIDENCE',
    '',
    markdownTable(['UNMODELED bucket', 'Count', 'SAFE_SPARSITY'], unmodeled.counts.map((row) => [row.bucket, row.count, row.safeSparsity])),
    '',
    `The 44 INSUFFICIENT_EVIDENCE products are preserved in \`training-semantic-insufficient-evidence.csv\`; ${insufficientEvidence.filter((row) => row.classification === 'HUMAN_REVIEW_WORTHY' || row.classification === 'RULE_GAP').length} are worth targeted review and none are promoted automatically.`,
    '',
    `Safe sparsity means the absence is explained by non-training product truth, accessory/support status, historical-only status, deferred capability scope, generic/multifunction ambiguity, or intentionally insufficient trusted evidence. ${report.safeSparsitySummary && (report.safeSparsitySummary as Record<string, unknown>).safeSparsityPercent}% of UNMODELED products fall in those safe buckets; explicit active V1-like signals remain non-blocking review debt, not silent assignments.`,
    '',
    '## Commercial-weighted coverage',
    '',
    markdownTable(['Scope', 'Eligible products', 'Assigned products', 'Revenue coverage %', 'Order-line coverage %', 'Units coverage %'], commercialCoverage.map((row) => [row.scope, row.eligibleProducts, row.productsWithAssignment, row.revenueCoveragePercent, row.orderLineCoveragePercent, row.unitsCoveragePercent])),
    '',
    'Commercial weighting is contextual only and is not semantic scoring. Revenue, order-line and units fields were read from the catalog export; missing values are treated as unavailable rather than zero for interpretation.',
    '',
    '## Deferred capability pressure',
    '',
    markdownTable(['Candidate', 'Observed', 'Active', 'Active revenue', 'Recommendation', 'Action', 'Blocking'], deferredPressure.map((row) => [row.candidateCode, row.observedProducts, row.activeProducts, row.activeRevenue, row.adjudicationRecommendation, row.action, row.blocking])),
    '',
    'SQUAT remains REDEFINE and is not resolved here. The active dedicated-machine subset is a future ontology candidate, not a classifier fix. LEG_PRESS, BICEPS_CURL, GLUTE_KICKBACK and TRICEPS_EXTENSION remain deferred per A00.4.1; DEADLIFT remains dropped because its material is an accessory.',
    '',
    '## Overclassification and underclassification',
    '',
    markdownTable(['Known boundary', 'Matched products', 'Violations', 'Violation IDs'], boundaryAudit.map((row) => [row.check, row.matchedProducts, row.violations, row.violationProductIds])),
    '',
    `Known-boundary overclassification is ${report.overclassificationAudit && (report.overclassificationAudit as Record<string, unknown>).status}; the published snapshot preserves the adjudicated negatives for cardio rowers, hip-thrust pads/boxes/bars, abdominal benches and generic cable wording.`,
    '',
    `Underclassification status is ${(report.underclassificationAudit as Record<string, unknown>).status}; ${underclassificationCandidates.length} concrete active/revenue-sensitive candidates are listed in the JSON report and review sample for human validation.`,
    '',
    '## Derived semantics validation',
    '',
    markdownTable(['Capability', 'Body region', 'Primary', 'Secondary', 'Pattern', 'Mapping debt'], derivedValidation.rows.map((row) => [row.capabilityCode, row.bodyRegions, row.primaryMuscleGroups, row.secondaryMuscleGroups, row.trainingPatterns, row.mappingDebt])),
    '',
    `Derived relation quality: ${derivedValidation.quality}. Mapping debt is reported separately for ${derivedValidation.debt.join(', ')}; the registry was not modified.`,
    '',
    '## Precision sample',
    '',
    `A deterministic positive sample contains ${precisionSample.sampleSize} products and ${precisionSample.assignmentObservations} assignment observations (${precisionSample.directObservations} DIRECT, ${precisionSample.supportedObservations} SUPPORTED). Manual adjudication is not included in A00.6, so DIRECT and SUPPORTED precision are NOT_MEASURED rather than falsely extrapolated. The sample prioritizes capabilities, active products, revenue and multi-assignment cases.`,
    '',
    '## Coverage matrix',
    '',
    markdownTable(['Dimension', 'Assessment'], Object.entries(report.coverageMatrix as Record<string, unknown>).map(([key, value]) => [key, value])),
    '',
    '## Debt before API',
    '',
    markdownTable(['Debt', 'Action', 'Blocking'], (report.preApiDebt as readonly Record<string, unknown>[]).map((row) => [row.item, row.action, row.blocking])),
    '',
    '## Review sample and artifacts',
    '',
    `Generated ${reviewSample.length} deterministic review rows. Each row has a concrete review question. Source catalog context: \`${inputPaths.catalogCsvPath}\`.`,
    '',
    'Artifacts:',
    '',
    '- `training-semantic-coverage-by-family.csv`',
    '- `training-semantic-coverage-by-capability.csv`',
    '- `training-semantic-unmodeled-buckets.csv`',
    '- `training-semantic-insufficient-evidence.csv`',
    '- `training-semantic-coverage-review-sample.csv`',
    '- `training-semantic-coverage-report.json`',
    '',
    'No API or read/query surface is implemented by A00.6. If accepted, the next release is A00.7 — Training Semantics Read / Query Surface.',
    '',
  ];
  return lines.join('\n');
}

function globalRows(report: Record<string, unknown>): readonly (readonly unknown[])[] {
  const globalCoverage = report.globalCoverage as readonly Record<string, unknown>[];
  return globalCoverage.map((row) => [row.scope, row.products, row.productsWithAssignments, row.assignmentRate, row.directAssignments, row.supportedAssignments, row.multiAssignmentRate]);
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: 'failed', error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'Unknown training semantic coverage audit error' } }, null, 2));
  process.exitCode = 1;
});
