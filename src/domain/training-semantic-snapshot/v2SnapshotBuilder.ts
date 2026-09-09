import {
  computeTrainingSemanticRegistryV2Hash,
  getTrainingSemanticRegistryV2,
  trainingFunctionCodesV2,
  exerciseCapabilityCodesV2,
  type ProductTrainingExerciseCapabilityAssignment,
  type ProductTrainingFunctionAssignment,
} from '../training-semantics-v2/index.js';
import { trainingSemanticClassifierV21RulesHash, trainingSemanticClassifierV21Version, type TrainingSemanticClassificationV21Result } from '../training-semantic-classification-v2-1/index.js';
import { trainingSemanticClassifierV2Version } from '../training-semantic-classification-v2/index.js';
import { canonicalizeTrainingSnapshotJson, cloneTrainingSnapshotJson, hashTrainingSnapshotCanonical } from './canonicalJson.js';
import { trainingSemanticSnapshotV2Schema, trainingSemanticResolutionStates, type TrainingSemanticResolutionState, type TrainingSemanticSnapshotV2, type TrainingSemanticSnapshotV2BuildParameters, type TrainingSemanticSnapshotV2Counts, type TrainingSemanticSnapshotV2Record } from './v2-contracts.js';
import type { TrainingSemanticSnapshot } from './contracts.js';

export const TRAINING_SEMANTIC_V1_SNAPSHOT_ID = 'sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d';
export const TRAINING_SEMANTIC_V1_REGISTRY_HASH = '82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f';
export const ACTIVE_TRAINING_RELEVANT_BASELINE = 240;
export const RESOLVED_TRAINING_RELEVANT_BASELINE = 234;
export const ACCEPTED_RESOLUTION_STATE_COUNTS = Object.freeze({ SEMANTIC_COMPLETE: 122, VERIFIED_NO_APPLICABLE_CAPABILITY: 112, DATA_GAP: 2, AMBIGUOUS: 4, NEEDS_REVIEW: 0 });

const registry = getTrainingSemanticRegistryV2();
const registryHash = computeTrainingSemanticRegistryV2Hash(registry);

function compare(left: string, right: string): number { return left.localeCompare(right); }
function assignmentKey(value: { capabilityCode?: string; functionCode?: string; relationType: string }): string { return `${value.capabilityCode ?? value.functionCode}\u0000${value.relationType}`; }
function evidenceKey(value: { kind: string; sourceId?: string; matchedText?: string; ruleId?: string; note?: string }): string { return [value.kind, value.sourceId ?? '', value.matchedText ?? '', value.ruleId ?? '', value.note ?? ''].join('\u0000'); }
function resolutionStateFor(result: TrainingSemanticClassificationV21Result, parameters: TrainingSemanticSnapshotV2BuildParameters): TrainingSemanticResolutionState {
  const map = parameters.resolutionStates;
  const value = map instanceof Map ? map.get(result.productId) : map ? (map as Readonly<Record<number, TrainingSemanticResolutionState>>)[result.productId] : undefined;
  if (value) return value;
  if (result.reviewCandidates.length > 0 || result.coverageStatus === 'NEEDS_REVIEW') return 'NEEDS_REVIEW';
  if (result.exerciseCapabilities.length > 0 || result.trainingFunctions.length > 0) return 'SEMANTIC_COMPLETE';
  if (result.coverageStatus === 'NO_CAPABILITY_APPLICABLE') return 'VERIFIED_NO_APPLICABLE_CAPABILITY';
  if (result.coverageStatus === 'INSUFFICIENT_EVIDENCE') return 'DATA_GAP';
  return 'ONTOLOGY_GAP';
}
function resolutionEvidenceFor(result: TrainingSemanticClassificationV21Result, parameters: TrainingSemanticSnapshotV2BuildParameters) {
  const map = parameters.resolutionEvidence;
  const value = map instanceof Map ? map.get(result.productId) : undefined;
  return value ? [...value].sort((left, right) => `${left.kind}\u0000${left.sourceId ?? ''}\u0000${left.note ?? ''}`.localeCompare(`${right.kind}\u0000${right.sourceId ?? ''}\u0000${right.note ?? ''}`)) : undefined;
}
function provenance(value: { classifierVersion: string; generatedAt: string; sourceCatalogExport?: string; sourceProductSemanticSnapshotId?: string; overrideId?: string }) {
  return { classifierVersion: value.classifierVersion, ...(value.sourceCatalogExport ? { sourceCatalogExport: value.sourceCatalogExport } : {}), ...(value.sourceProductSemanticSnapshotId ? { sourceProductSemanticSnapshotId: value.sourceProductSemanticSnapshotId } : {}), ...(value.overrideId ? { overrideId: value.overrideId } : {}) };
}
function exerciseAssignment(value: ProductTrainingExerciseCapabilityAssignment) {
  return {
    capabilityCode: value.capabilityCode, relationType: value.relationType, classificationConfidence: value.classificationConfidence,
    evidence: [...value.evidence].map((item) => ({ ...item })).sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right))), reviewState: value.reviewState,
    ...(value.moduleId ? { moduleId: value.moduleId } : {}), ...(value.modifierCodes?.length ? { modifierCodes: [...value.modifierCodes].sort(compare) } : {}),
    provenance: provenance(value.provenance),
  };
}
function functionAssignment(value: ProductTrainingFunctionAssignment) {
  return {
    functionCode: value.functionCode, relationType: value.relationType, ...(value.productFamily ? { productFamily: value.productFamily } : {}), classificationConfidence: value.classificationConfidence,
    evidence: [...value.evidence].map((item) => ({ ...item })).sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right))), reviewState: value.reviewState, provenance: provenance(value.provenance),
  };
}
function semanticRecord(result: TrainingSemanticClassificationV21Result, parameters: TrainingSemanticSnapshotV2BuildParameters): TrainingSemanticSnapshotV2Record {
  const resolutionState = resolutionStateFor(result, parameters);
  const activeIds = parameters.activeTrainingRelevantProductIds;
  return {
    productId: result.productId,
    exerciseCapabilities: [...result.exerciseCapabilities].map(exerciseAssignment).sort((left, right) => assignmentKey(left).localeCompare(assignmentKey(right))),
    trainingFunctions: [...result.trainingFunctions].map(functionAssignment).sort((left, right) => assignmentKey(left).localeCompare(assignmentKey(right))),
    coverageStatus: result.coverageStatus,
    resolutionState,
    ...(resolutionEvidenceFor(result, parameters) ? { resolutionEvidence: resolutionEvidenceFor(result, parameters) } : {}),
    resolved: resolutionState === 'SEMANTIC_COMPLETE' || resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY',
    ...(activeIds ? { activeTrainingRelevant: activeIds.includes(result.productId) } : {}),
    warnings: [...new Set(result.warnings)].sort(compare),
  };
}
function projection(assignment: { capabilityCode: string; relationType: string; classificationConfidence: string; evidence: readonly unknown[]; reviewState: string; moduleId?: string; modifierCodes?: readonly string[] }) {
  return { capabilityCode: assignment.capabilityCode, relationType: assignment.relationType, classificationConfidence: assignment.classificationConfidence, evidence: assignment.evidence, reviewState: assignment.reviewState, ...(assignment.moduleId ? { moduleId: assignment.moduleId } : {}), ...(assignment.modifierCodes?.length ? { modifierCodes: assignment.modifierCodes } : {}) };
}
function assertV1Lineage(results: readonly TrainingSemanticClassificationV21Result[], source: TrainingSemanticSnapshot): number {
  if (source.snapshotId !== TRAINING_SEMANTIC_V1_SNAPSHOT_ID) throw new Error(`V1 source snapshot mismatch: expected ${TRAINING_SEMANTIC_V1_SNAPSHOT_ID}, got ${source.snapshotId}`);
  if (source.registryHash !== TRAINING_SEMANTIC_V1_REGISTRY_HASH) throw new Error(`V1 registry hash mismatch: expected ${TRAINING_SEMANTIC_V1_REGISTRY_HASH}, got ${source.registryHash}`);
  const sourceAssignments = source.records.flatMap((record) => record.assignments.map((assignment) => ({ productId: record.productId, assignment: projection(assignment) })));
  const v2Assignments = results.flatMap((result) => result.exerciseCapabilities.filter((assignment) => assignment.provenance.classifierVersion === 'training-semantic-classifier-v1.1').map((assignment) => ({ productId: result.productId, assignment: projection(assignment) })));
  if (sourceAssignments.length !== 180 || v2Assignments.length !== sourceAssignments.length) throw new Error(`V1 projection count drift: expected 180, source=${sourceAssignments.length}, V2=${v2Assignments.length}`);
  const left = canonicalizeTrainingSnapshotJson(sourceAssignments.sort((a, b) => a.productId - b.productId || assignmentKey(a.assignment).localeCompare(assignmentKey(b.assignment))));
  const right = canonicalizeTrainingSnapshotJson(v2Assignments.sort((a, b) => a.productId - b.productId || assignmentKey(a.assignment).localeCompare(assignmentKey(b.assignment))));
  if (left !== right) throw new Error('V1 projection drift: V2 does not preserve the accepted V1 exercise assignments');
  return sourceAssignments.length;
}

export function calculateTrainingSemanticSnapshotV2Counts(records: readonly TrainingSemanticSnapshotV2Record[], parameters: TrainingSemanticSnapshotV2BuildParameters): TrainingSemanticSnapshotV2Counts {
  const exerciseCounts = Object.fromEntries(exerciseCapabilityCodesV2.map((code) => [code, 0]));
  const functionCounts = Object.fromEntries(trainingFunctionCodesV2.map((code) => [code, 0]));
  const resolutionCounts = Object.fromEntries(trainingSemanticResolutionStates.map((state) => [state, 0]));
  const coverageCounts = Object.fromEntries(['NO_CAPABILITY_APPLICABLE', 'UNMODELED', 'INSUFFICIENT_EVIDENCE', 'NEEDS_REVIEW'].map((state) => [state, 0]));
  const activeIds = parameters.activeTrainingRelevantProductIds;
  for (const record of records) {
    record.exerciseCapabilities.forEach((assignment) => { exerciseCounts[assignment.capabilityCode] = (exerciseCounts[assignment.capabilityCode] ?? 0) + 1; });
    record.trainingFunctions.forEach((assignment) => { functionCounts[assignment.functionCode] = (functionCounts[assignment.functionCode] ?? 0) + 1; });
    if (record.resolutionState && (activeIds ? activeIds.includes(record.productId) : record.activeTrainingRelevant === true)) resolutionCounts[record.resolutionState] = (resolutionCounts[record.resolutionState] ?? 0) + 1;
    coverageCounts[record.coverageStatus] = (coverageCounts[record.coverageStatus] ?? 0) + 1;
  }
  const activeRecords = parameters.activeTrainingRelevantProductIds ? records.filter((record) => parameters.activeTrainingRelevantProductIds!.includes(record.productId)) : records.filter((record) => record.activeTrainingRelevant === true);
  const active = parameters.activeTrainingRelevant ?? activeRecords.length;
  const resolved = activeRecords.filter((record) => record.resolved).length;
  const v1 = records.flatMap((record) => record.exerciseCapabilities).filter((assignment) => assignment.provenance?.classifierVersion === 'training-semantic-classifier-v1.1').length;
  const v2New = records.flatMap((record) => record.exerciseCapabilities).filter((assignment) => assignment.provenance?.classifierVersion === trainingSemanticClassifierV21Version).length;
  const existingRule = records.flatMap((record) => record.exerciseCapabilities).filter((assignment) => assignment.provenance?.classifierVersion === trainingSemanticClassifierV2Version).length;
  return {
    sourceProducts: records.length, productsWithExerciseCapabilities: records.filter((record) => record.exerciseCapabilities.length > 0).length, productsWithTrainingFunctions: records.filter((record) => record.trainingFunctions.length > 0).length,
    exerciseCapabilityAssignmentCount: records.reduce((sum, record) => sum + record.exerciseCapabilities.length, 0), exerciseAssignmentCount: records.reduce((sum, record) => sum + record.exerciseCapabilities.length, 0), trainingFunctionAssignmentCount: records.reduce((sum, record) => sum + record.trainingFunctions.length, 0),
    activeTrainingRelevant: active, resolvedActiveTrainingRelevant: resolved, resolutionRate: active ? Number(((resolved / active) * 100).toFixed(2)) : 0, resolvedCount: resolved, unresolvedCount: Math.max(0, active - resolved),
    resolutionStateCounts: resolutionCounts, coverageStateCounts: coverageCounts, assignmentCountsByExerciseCapability: exerciseCounts, assignmentCountsByTrainingFunction: functionCounts,
    v1ExerciseCapabilityAssignmentsPreserved: v1, v1AssignmentsPreserved: v1, v2NewExerciseCapabilityAssignments: v2New, existingRuleClosureAssignments: existingRule, totalExerciseCapabilityAssignments: records.reduce((sum, record) => sum + record.exerciseCapabilities.length, 0), totalTrainingFunctionAssignments: records.reduce((sum, record) => sum + record.trainingFunctions.length, 0),
    multiCapabilityProducts: records.filter((record) => record.exerciseCapabilities.length > 1).length, multiFunctionProducts: records.filter((record) => record.trainingFunctions.length > 1).length,
  };
}

export function createTrainingSemanticSnapshotV2SemanticPayload(records: readonly TrainingSemanticSnapshotV2Record[]) {
  return { records: [...records].sort((a, b) => a.productId - b.productId).map((record) => ({ ...record, exerciseCapabilities: [...record.exerciseCapabilities].sort((a, b) => assignmentKey(a).localeCompare(assignmentKey(b))), trainingFunctions: [...record.trainingFunctions].sort((a, b) => assignmentKey(a).localeCompare(assignmentKey(b))), warnings: [...record.warnings].sort(compare), ...(record.resolutionEvidence ? { resolutionEvidence: [...record.resolutionEvidence].sort((a, b) => `${a.kind}\u0000${a.sourceId ?? ''}\u0000${a.note ?? ''}`.localeCompare(`${b.kind}\u0000${b.sourceId ?? ''}\u0000${b.note ?? ''}`)) } : {}) })) };
}
export function createTrainingSemanticSnapshotV2Id(input: { readonly registryVersion: string; readonly registryHash: string; readonly classifierVersion: string; readonly rulesHash: string; readonly sourceV1SnapshotId: string; readonly semanticChecksum: string; readonly counts: TrainingSemanticSnapshotV2Counts }): string {
  return `sha256:${hashTrainingSnapshotCanonical({ schemaVersion: '2', registryVersion: input.registryVersion, registryHash: input.registryHash, classifierVersion: input.classifierVersion, rulesHash: input.rulesHash, sourceV1SnapshotId: input.sourceV1SnapshotId, semanticChecksum: input.semanticChecksum, counts: input.counts })}`;
}
export function recomputeTrainingSemanticSnapshotV2Identity(snapshot: TrainingSemanticSnapshotV2) {
  const semanticChecksum = hashTrainingSnapshotCanonical(createTrainingSemanticSnapshotV2SemanticPayload(snapshot.records));
  const snapshotId = createTrainingSemanticSnapshotV2Id({ registryVersion: snapshot.registryVersion, registryHash: snapshot.registryHash, classifierVersion: snapshot.classifierVersion, rulesHash: snapshot.rulesHash ?? snapshot.classifierV2RulesHash, sourceV1SnapshotId: snapshot.sourceV1SnapshotId, semanticChecksum, counts: snapshot.counts });
  return { semanticChecksum, snapshotId };
}
export function validateTrainingSemanticSnapshotV2(snapshot: TrainingSemanticSnapshotV2): void {
  const parsed = trainingSemanticSnapshotV2Schema.safeParse(snapshot);
  if (!parsed.success) throw new Error(`Training Semantic Snapshot V2 contract invalid: ${parsed.error.message}`);
  if (snapshot.registryHash !== registryHash) throw new Error(`Training Semantic Snapshot V2 registry hash mismatch: expected ${registryHash}`);
  if (snapshot.classifierVersion !== trainingSemanticClassifierV21Version) throw new Error('Training Semantic Snapshot V2 classifier lineage mismatch');
  if ((snapshot.rulesHash ?? snapshot.classifierV2RulesHash) !== trainingSemanticClassifierV21RulesHash) throw new Error('Training Semantic Snapshot V2 rules hash mismatch');
  if (snapshot.records.some((record) => !record.resolutionState)) throw new Error('Training Semantic Snapshot V2 records must persist resolutionState');
  if (new Set(snapshot.records.map((record) => record.productId)).size !== snapshot.records.length) throw new Error('Training Semantic Snapshot V2 contains duplicate productId');
  for (const record of snapshot.records) {
    if (new Set(record.exerciseCapabilities.map((assignment) => assignmentKey(assignment))).size !== record.exerciseCapabilities.length) throw new Error(`Training Semantic Snapshot V2 contains duplicate exercise assignment for ${record.productId}`);
    if (new Set(record.trainingFunctions.map((assignment) => assignmentKey(assignment))).size !== record.trainingFunctions.length) throw new Error(`Training Semantic Snapshot V2 contains duplicate training function assignment for ${record.productId}`);
    for (const assignment of [...record.exerciseCapabilities, ...record.trainingFunctions]) if (new Set(assignment.evidence.map(evidenceKey)).size !== assignment.evidence.length) throw new Error(`Training Semantic Snapshot V2 contains duplicate evidence for ${record.productId}`);
  }
  const counts = calculateTrainingSemanticSnapshotV2Counts(snapshot.records, { sourceProductCount: snapshot.records.length, sourceV1SnapshotId: snapshot.sourceV1SnapshotId, sourceV1Snapshot: {} as TrainingSemanticSnapshot, activeTrainingRelevant: snapshot.counts.activeTrainingRelevant });
  if (canonicalizeTrainingSnapshotJson(counts) !== canonicalizeTrainingSnapshotJson(snapshot.counts)) throw new Error(`Training Semantic Snapshot V2 counts are inconsistent: actual=${canonicalizeTrainingSnapshotJson(counts)} expected=${canonicalizeTrainingSnapshotJson(snapshot.counts)}`);
  if ((snapshot.counts.activeTrainingRelevant ?? 0) === ACTIVE_TRAINING_RELEVANT_BASELINE && (snapshot.counts.resolutionRate ?? 0) < 95) throw new Error('Training Semantic Snapshot V2 resolution rate is below the accepted gate');
  const identity = recomputeTrainingSemanticSnapshotV2Identity(snapshot);
  if (identity.semanticChecksum !== snapshot.semanticChecksum || identity.snapshotId !== snapshot.snapshotId) throw new Error('Training Semantic Snapshot V2 identity does not match canonical semantic content');
}

export class DefaultTrainingSemanticSnapshotV2Builder {
  build(input: { readonly results: readonly TrainingSemanticClassificationV21Result[]; readonly parameters: TrainingSemanticSnapshotV2BuildParameters }): TrainingSemanticSnapshotV2 {
    const { results, parameters } = input;
    if (results.length === 0) throw new Error('Training Semantic Snapshot V2 cannot be built from an empty source');
    if (results.length !== parameters.sourceProductCount) throw new Error(`sourceProductCount mismatch: ${parameters.sourceProductCount} != ${results.length}`);
    if (parameters.sourceV1SnapshotId !== TRAINING_SEMANTIC_V1_SNAPSHOT_ID) throw new Error('V1 source snapshot missing or not accepted');
    if (parameters.sourceV1Snapshot.snapshotId !== parameters.sourceV1SnapshotId) throw new Error('V1 source snapshot id mismatch');
    if (computeTrainingSemanticRegistryV2Hash(registry) !== '7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8') throw new Error('Training Semantic Registry V2 authority hash drifted');
    const seen = new Set<number>();
    for (const result of results) {
      if (seen.has(result.productId)) throw new Error(`duplicate productId: ${result.productId}`);
      seen.add(result.productId);
      if (result.classifierVersion !== trainingSemanticClassifierV21Version || result.registryHash !== registryHash || result.rulesHash !== trainingSemanticClassifierV21RulesHash) throw new Error(`classifier lineage mismatch for product ${result.productId}`);
      if (result.reviewCandidates.length > 0 || result.coverageStatus === 'NEEDS_REVIEW') throw new Error(`NEEDS_REVIEW is not publishable for product ${result.productId}`);
      if (resolutionStateFor(result, parameters) === 'NEEDS_REVIEW' && (parameters.acceptedResolutionStates?.NEEDS_REVIEW ?? 0) === 0) throw new Error(`NEEDS_REVIEW exceeds accepted baseline for product ${result.productId}`);
      const exerciseKeys = result.exerciseCapabilities.map((item) => item.capabilityCode);
      const functionKeys = result.trainingFunctions.map((item) => item.functionCode);
      if (new Set(exerciseKeys).size !== exerciseKeys.length || new Set(functionKeys).size !== functionKeys.length) throw new Error(`duplicate semantic assignment for product ${result.productId}`);
    }
    const v1Assignments = assertV1Lineage(results, parameters.sourceV1Snapshot);
    const records = results.map((result) => cloneTrainingSnapshotJson(semanticRecord(result, parameters))).sort((a, b) => a.productId - b.productId);
    const counts = calculateTrainingSemanticSnapshotV2Counts(records, parameters);
    const active = parameters.activeTrainingRelevant ?? 0;
    const resolved = counts.resolvedActiveTrainingRelevant ?? 0;
    if (parameters.acceptedResolvedCount !== undefined && resolved !== parameters.acceptedResolvedCount) throw new Error(`accepted resolution baseline drift: expected ${parameters.acceptedResolvedCount}, got ${resolved}`);
    if (parameters.acceptedResolutionStates) for (const [state, expected] of Object.entries(parameters.acceptedResolutionStates)) if ((counts.resolutionStateCounts?.[state] ?? 0) !== expected) throw new Error(`accepted resolution state drift for ${state}: expected ${expected}, got ${counts.resolutionStateCounts?.[state] ?? 0}`);
    if (active > 0 && counts.resolutionRate !== 97.5 && active === ACTIVE_TRAINING_RELEVANT_BASELINE) throw new Error(`accepted resolution rate drift: expected 97.50%, got ${counts.resolutionRate}%`);
    counts.v1ExerciseCapabilityAssignmentsPreserved = v1Assignments;
    const semanticChecksum = hashTrainingSnapshotCanonical(createTrainingSemanticSnapshotV2SemanticPayload(records));
    const snapshotId = createTrainingSemanticSnapshotV2Id({ registryVersion: registry.registryVersion, registryHash: registryHash, classifierVersion: trainingSemanticClassifierV21Version, rulesHash: trainingSemanticClassifierV21RulesHash, sourceV1SnapshotId: parameters.sourceV1SnapshotId, semanticChecksum, counts });
    const snapshot: TrainingSemanticSnapshotV2 = { schemaVersion: '2', snapshotId, registryVersion: registry.registryVersion, registryHash, classifierVersion: trainingSemanticClassifierV21Version, classifierV2RulesHash: trainingSemanticClassifierV21RulesHash, rulesHash: trainingSemanticClassifierV21RulesHash, semanticChecksum, sourceV1SnapshotId: parameters.sourceV1SnapshotId, generatedAt: parameters.generatedAt ?? new Date().toISOString(), counts, records };
    validateTrainingSemanticSnapshotV2(snapshot);
    return snapshot;
  }
}

export const DefaultTrainingSemanticSnapshotV2BuilderClass = DefaultTrainingSemanticSnapshotV2Builder;
