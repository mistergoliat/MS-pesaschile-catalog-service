import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTrainingSemanticProductsV2, type TrainingSemanticClassificationV2Result } from '../../src/domain/training-semantic-classification-v2/index.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { parseCsvRecords, writeCsv } from '../product-semantic-classification/lib/csv.js';
import { loadTrainingSemanticClassificationInputs } from '../training-semantic-classification/lib/load-input.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.6.6');
const BASELINE_ACTIVE_PATH = path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.6.2/training-semantic-resolution-active.csv');
const ONTOLOGY_GAP_PATH = path.resolve(SCRIPT_DIR, '../../docs/design/training-semantics/a00.6.4/ontology-gap-products.csv');
const ACTIVE_DENOMINATOR = 240;
const RULE_CLOSURES = [388, 1270, 2089, 2092] as const;
const V1_EXERCISE_CAPABILITIES = new Set([
  'ABDUCTOR',
  'ADDUCTOR',
  'CHEST_PRESS',
  'DIP',
  'HIP_THRUST',
  'LAT_PULLDOWN',
  'LEG_CURL',
  'LEG_EXTENSION',
  'PEC_DECK',
  'PULL_UP',
  'ROW',
  'SHOULDER_PRESS',
  'TRICEPS_EXTENSION',
]);

type BaselineRecord = {
  readonly productId: number;
  readonly currentCoverageStatus: string;
  readonly resolutionState: string;
  readonly candidateCapabilities: readonly string[];
  readonly missingCapabilities: readonly string[];
  readonly gapType: string;
  readonly name: string;
  readonly productFamily: string;
  readonly active: boolean;
};

type ResolutionState = 'SEMANTIC_COMPLETE' | 'SEMANTIC_PARTIAL' | 'VERIFIED_NO_APPLICABLE_CAPABILITY' | 'ONTOLOGY_GAP' | 'RULE_GAP' | 'DATA_GAP' | 'AMBIGUOUS' | 'NEEDS_REVIEW';

function parseArgs(argv: readonly string[]): { readonly outputDir: string } {
  const argument = argv.find((value) => value.startsWith('--output-dir='));
  return { outputDir: path.resolve(argument?.slice('--output-dir='.length) ?? DEFAULT_OUTPUT_DIR) };
}

function splitCodes(value: string | undefined): readonly string[] {
  return (value ?? '').split('|').map((item) => item.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function parseBaselineRow(row: Record<string, string>): BaselineRecord {
  return {
    productId: Number(row.productId),
    currentCoverageStatus: row.currentCoverageStatus ?? '',
    resolutionState: row.resolutionState ?? 'DATA_GAP',
    candidateCapabilities: splitCodes(row.candidateCapabilities),
    missingCapabilities: splitCodes(row.missingCapabilities),
    gapType: row.gapType ?? '',
    name: row.name ?? '',
    productFamily: row.productFamily ?? '',
    active: row.active === 'true',
  };
}

function assignedCodes(result: TrainingSemanticClassificationV2Result): readonly string[] {
  return [...result.exerciseCapabilities.map((assignment) => assignment.capabilityCode), ...result.trainingFunctions.map((assignment) => assignment.functionCode)].sort((left, right) => left.localeCompare(right));
}

function isResolved(record: BaselineRecord, result: TrainingSemanticClassificationV2Result, expectedConcepts: readonly string[]): boolean {
  const assigned = new Set(assignedCodes(result));
  if (record.resolutionState === 'SEMANTIC_COMPLETE' || record.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY') return true;
  if (record.resolutionState === 'SEMANTIC_PARTIAL' || record.resolutionState === 'RULE_GAP') return record.missingCapabilities.every((code) => assigned.has(code));
  if (record.resolutionState === 'ONTOLOGY_GAP') return expectedConcepts.length > 0 && expectedConcepts.every((code) => assigned.has(code));
  return false;
}

function resolutionState(record: BaselineRecord, resolved: boolean): ResolutionState {
  if (resolved && (record.resolutionState === 'SEMANTIC_PARTIAL' || record.resolutionState === 'RULE_GAP' || record.resolutionState === 'ONTOLOGY_GAP')) return 'SEMANTIC_COMPLETE';
  return record.resolutionState as ResolutionState;
}

function assignmentJson(result: TrainingSemanticClassificationV2Result): string {
  return JSON.stringify(result.exerciseCapabilities.map((assignment) => ({ capabilityCode: assignment.capabilityCode, relationType: assignment.relationType, classificationConfidence: assignment.classificationConfidence })).sort((left, right) => left.capabilityCode.localeCompare(right.capabilityCode)));
}

function functionJson(result: TrainingSemanticClassificationV2Result): string {
  return JSON.stringify(result.trainingFunctions.map((assignment) => ({ functionCode: assignment.functionCode, relationType: assignment.relationType, classificationConfidence: assignment.classificationConfidence })).sort((left, right) => left.functionCode.localeCompare(right.functionCode)));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [baselineText, ontologyText] = await Promise.all([readFile(BASELINE_ACTIVE_PATH, 'utf8'), readFile(ONTOLOGY_GAP_PATH, 'utf8')]);
  const baseline = parseCsvRecords(baselineText).map(parseBaselineRow).sort((left, right) => left.productId - right.productId);
  const ontologyRows = parseCsvRecords(ontologyText);
  const expectedByProduct = new Map(ontologyRows.map((row) => [Number(row.productId), splitCodes(row.candidateSemanticConcept)] as const));
  if (baseline.length !== ACTIVE_DENOMINATOR || baseline.some((record) => !record.active)) throw new Error(`A00.6.6 denominator must contain exactly ${ACTIVE_DENOMINATOR} active baseline products.`);

  const inputPaths = await resolveProductSemanticInputPaths();
  const { inputs, warnings: loaderWarnings } = await loadTrainingSemanticClassificationInputs(inputPaths);
  const results = classifyTrainingSemanticProductsV2(inputs, { sourceCatalogExport: path.basename(inputPaths.catalogCsvPath) });
  const resultById = new Map(results.map((result) => [result.productId, result] as const));
  const activeBaselineIds = new Set(baseline.map((record) => record.productId));
  if (results.length !== 2011 || baseline.some((record) => !resultById.has(record.productId))) throw new Error('A00.6.6 product universe does not match the V1 baseline.');

  const classificationRows = results.slice().sort((left, right) => left.productId - right.productId).map((result) => ({
    productId: result.productId,
    classifierVersion: result.classifierVersion,
    registryVersion: result.registryVersion,
    registryHash: result.registryHash,
    rulesHash: result.rulesHash,
    exerciseCapabilities: assignmentJson(result),
    trainingFunctions: functionJson(result),
    coverageStatus: result.coverageStatus,
    reviewCandidates: result.reviewCandidates.map((candidate) => `${candidate.semanticType}:${candidate.code}`).join('|'),
    warnings: result.warnings.join(' | '),
    deferredFindings: result.deferredFindings.map((finding) => `${finding.candidateCode}:${finding.matchedText}`).join(' | '),
  }));
  const functionRows = results.flatMap((result) => result.trainingFunctions.map((assignment) => ({
    productId: result.productId,
    productFamily: assignment.productFamily ?? '',
    functionCode: assignment.functionCode,
    relationType: assignment.relationType,
    classificationConfidence: assignment.classificationConfidence,
    evidence: assignment.evidence.map((evidence) => `${evidence.kind}:${evidence.sourceId ?? ''}:${evidence.matchedText ?? ''}`).join(' | '),
    reviewState: assignment.reviewState,
  }))).sort((left, right) => left.productId - right.productId || left.functionCode.localeCompare(right.functionCode));

  const resolutions = baseline.map((record) => {
    const result = resultById.get(record.productId)!;
    const expectedConcepts = expectedByProduct.get(record.productId) ?? [];
    const resolved = isResolved(record, result, expectedConcepts);
    return {
      productId: record.productId,
      name: record.name,
      active: record.active,
      productFamily: record.productFamily,
      baselineResolutionState: record.resolutionState,
      resolutionState: resolutionState(record, resolved),
      resolved,
      baselineCandidateCapabilities: record.candidateCapabilities.join('|'),
      expectedV2Concepts: expectedConcepts.join('|'),
      v2ExerciseCapabilities: result.exerciseCapabilities.map((assignment) => assignment.capabilityCode).join('|'),
      v2TrainingFunctions: result.trainingFunctions.map((assignment) => assignment.functionCode).join('|'),
      v2ReviewCandidates: result.reviewCandidates.map((candidate) => candidate.code).join('|'),
      gapType: record.gapType,
      currentCoverageStatus: record.currentCoverageStatus,
      reason: resolved ? 'V2 Product Truth is covered by preserved V1 semantics, an approved V2 capability/function, or a validated rule closure.' : 'Evidence remains unresolved under precision-first policy; no weak assignment was forced.',
    };
  });
  const unresolved = resolutions.filter((record) => !record.resolved);
  const stateList: readonly ResolutionState[] = ['SEMANTIC_COMPLETE', 'SEMANTIC_PARTIAL', 'VERIFIED_NO_APPLICABLE_CAPABILITY', 'ONTOLOGY_GAP', 'RULE_GAP', 'DATA_GAP', 'AMBIGUOUS', 'NEEDS_REVIEW'];
  const resolutionStateCounts = Object.fromEntries(stateList.map((state) => [state, resolutions.filter((record) => record.resolutionState === state).length]));
  const ontologyTargetRows = ontologyRows.filter((row) => row.candidateAxis !== 'RULE_CLOSURE');
  const ontologyTargetResults = ontologyTargetRows.map((row) => resolutions.find((record) => record.productId === Number(row.productId))).filter((record): record is typeof resolutions[number] => record !== undefined);
  const ruleClosureResults = RULE_CLOSURES.map((productId) => resolutions.find((record) => record.productId === productId)).filter((record): record is typeof resolutions[number] => record !== undefined);
  const report = {
    auditVersion: 'training-semantic-classifier-v2-resolution-v1',
    decision: unresolved.length <= 16 ? 'TRAINING_SEMANTIC_CLASSIFIER_V2_READY_WITH_DEBT' : 'TRAINING_SEMANTIC_CLASSIFIER_V2_NEEDS_FIXES',
    authority: {
      registryVersion: 'training-semantic-registry-v2',
      registryHash: results[0]?.registryHash,
      classifierVersion: 'training-semantic-classifier-v2',
      rulesHash: results[0]?.rulesHash,
      v1RegistryHash: '82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f',
      v1SnapshotId: 'sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d',
    },
    denominator: { activeTrainingRelevant: ACTIVE_DENOMINATOR, classifiedProductUniverse: results.length },
    counts: {
      v1AssignmentsPreserved: results.reduce((total, result) => total + result.exerciseCapabilities.filter((assignment) => assignment.provenance.classifierVersion === 'training-semantic-classifier-v1.1').length, 0),
      newExerciseCapabilityAssignments: results.reduce((total, result) => total + result.exerciseCapabilities.filter((assignment) => assignment.provenance.classifierVersion === 'training-semantic-classifier-v2' && !V1_EXERCISE_CAPABILITIES.has(assignment.capabilityCode)).length, 0),
      existingExerciseRuleClosureAssignments: results.reduce((total, result) => total + result.exerciseCapabilities.filter((assignment) => assignment.provenance.classifierVersion === 'training-semantic-classifier-v2' && V1_EXERCISE_CAPABILITIES.has(assignment.capabilityCode)).length, 0),
      trainingFunctionAssignments: results.reduce((total, result) => total + result.trainingFunctions.length, 0),
      resolvedOntologyGaps: ontologyTargetResults.filter((record) => record.resolved).length,
      expectedOntologyGaps: ontologyTargetRows.length,
      completedRuleClosures: ruleClosureResults.filter((record) => record.resolved).length,
      expectedRuleClosures: RULE_CLOSURES.length,
      activeTrainingRelevantResolved: resolutions.filter((record) => record.resolved).length,
      unresolved: unresolved.length,
      remainingDataGap: resolutions.filter((record) => record.resolutionState === 'DATA_GAP').length,
      remainingAmbiguous: resolutions.filter((record) => record.resolutionState === 'AMBIGUOUS').length,
      remainingNeedsReview: resolutions.filter((record) => record.resolutionState === 'NEEDS_REVIEW').length,
    },
    REAL_SEMANTIC_RESOLUTION_RATE: Number(((resolutions.filter((record) => record.resolved).length / ACTIVE_DENOMINATOR) * 100).toFixed(2)),
    resolutionStateCounts,
    ontologyClosure: { expectedNewOntologyClosures: ontologyTargetRows.map((row) => Number(row.productId)).sort((left, right) => left - right), resolvedNewOntologyClosures: ontologyTargetResults.filter((record) => record.resolved).map((record) => record.productId), discrepancyProductIds: ontologyTargetResults.filter((record) => !record.resolved).map((record) => record.productId) },
    ruleClosures: ruleClosureResults.map((record) => ({ productId: record.productId, resolved: record.resolved, v2ExerciseCapabilities: record.v2ExerciseCapabilities })),
    changes: { productAssignmentsPublished: false, v1SnapshotChanged: false, v2SnapshotBuilt: false, apiChanged: false, semanticDiscoveryChanged: false },
    loaderWarnings: loaderWarnings.length,
    activeBaselineIds: [...activeBaselineIds].sort((left, right) => left - right),
  };

  await mkdir(args.outputDir, { recursive: true });
  await writeFile(path.join(args.outputDir, 'training-semantic-v2-classification.csv'), writeCsv(Object.keys(classificationRows[0] ?? {}), classificationRows), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-v2-training-functions.csv'), writeCsv(Object.keys(functionRows[0] ?? { productId: '', productFamily: '', functionCode: '', relationType: '', classificationConfidence: '', evidence: '', reviewState: '' }), functionRows), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-v2-resolution-active.csv'), writeCsv(Object.keys(resolutions[0] ?? {}), resolutions), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-v2-resolution-unresolved.csv'), writeCsv(Object.keys(unresolved[0] ?? {}), unresolved), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-v2-resolution-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'ok', decision: report.decision, registryHash: report.authority.registryHash, rulesHash: report.authority.rulesHash, ...report.counts, REAL_SEMANTIC_RESOLUTION_RATE: report.REAL_SEMANTIC_RESOLUTION_RATE, outputDir: args.outputDir }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: 'failed', error: error instanceof Error ? error.message : 'Unknown A00.6.6 error' }, null, 2));
  process.exitCode = 1;
});
