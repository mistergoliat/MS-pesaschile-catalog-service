import { computeTrainingSemanticClassifierRulesHash, trainingSemanticClassifierVersion, type TrainingSemanticClassificationResult } from '../training-semantic-classification/index.js';
import { computeTrainingSemanticRegistryHash, getTrainingCapability, getTrainingSemanticRegistry, trainingSemanticRegistryVersion, trainingCapabilityCodes, trainingCoverageStatuses, type TrainingSemanticEvidence } from '../training-semantics/index.js';
import { canonicalizeTrainingSnapshotJson, cloneTrainingSnapshotJson, deepFreezeTrainingSnapshot, hashTrainingSnapshotCanonical } from './canonicalJson.js';
import { trainingSemanticSnapshotBuildParametersSchema, trainingSemanticSnapshotSchema, type TrainingSemanticSnapshot, type TrainingSemanticSnapshotAssignment, type TrainingSemanticSnapshotBuildParameters, type TrainingSemanticSnapshotCounts, type TrainingSemanticSnapshotRecord, type TrainingSemanticSnapshotBuilder } from './contracts.js';
import { TrainingSemanticSnapshotError } from './errors.js';

const expectedRegistryHash = computeTrainingSemanticRegistryHash(getTrainingSemanticRegistry());
const expectedRulesHash = computeTrainingSemanticClassifierRulesHash();

function compareStrings(left: string, right: string): number { return left.localeCompare(right); }
function evidenceKey(evidence: TrainingSemanticEvidence): string { return [evidence.kind, evidence.sourceId ?? '', evidence.matchedText ?? '', evidence.ruleId ?? '', evidence.note ?? ''].join('\u0000'); }
function assignmentKey(assignment: { capabilityCode: string; relationType: string }): string { return `${assignment.capabilityCode}\u0000${assignment.relationType}`; }
function canonicalEvidence(evidence: readonly TrainingSemanticEvidence[]): TrainingSemanticSnapshotAssignment['evidence'] {
  return [...evidence].map((item) => ({ ...item })).sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b)));
}

function validateResult(result: TrainingSemanticClassificationResult, index: number): void {
  if (!Number.isInteger(result.productId) || result.productId <= 0) throw new TrainingSemanticSnapshotError('INVALID_CLASSIFICATION_RESULT', 'productId must be a positive integer', { index });
  if (result.classifierVersion !== trainingSemanticClassifierVersion) throw new TrainingSemanticSnapshotError('LINEAGE_MISMATCH', 'classifier version mismatch', { index, expected: trainingSemanticClassifierVersion, actual: result.classifierVersion });
  if (result.registryVersion !== trainingSemanticRegistryVersion || result.registryHash !== expectedRegistryHash) throw new TrainingSemanticSnapshotError('LINEAGE_MISMATCH', 'registry lineage mismatch', { index, expected: { registryVersion: trainingSemanticRegistryVersion, registryHash: expectedRegistryHash }, actual: { registryVersion: result.registryVersion, registryHash: result.registryHash } });
  if (result.rulesHash !== expectedRulesHash) throw new TrainingSemanticSnapshotError('LINEAGE_MISMATCH', 'classifier rules hash mismatch', { index, expected: expectedRulesHash, actual: result.rulesHash });
  if (result.coverageStatus === 'NEEDS_REVIEW' || result.reviewCandidates.length > 0) throw new TrainingSemanticSnapshotError('INVALID_CLASSIFICATION_RESULT', 'NEEDS_REVIEW is not publishable in A00.5', { index, productId: result.productId });
  for (const assignment of result.assignments) {
    if (!getTrainingCapability(assignment.capabilityCode) || getTrainingCapability(assignment.capabilityCode)?.status !== 'ACTIVE') throw new TrainingSemanticSnapshotError('UNKNOWN_CAPABILITY', 'assignment references an unknown or deprecated capability', { index, productId: result.productId, capabilityCode: assignment.capabilityCode });
    if (!assignment.evidence.length) throw new TrainingSemanticSnapshotError('INVALID_CLASSIFICATION_RESULT', 'assignment evidence must not be empty', { index, productId: result.productId, capabilityCode: assignment.capabilityCode });
    const duplicateEvidence = new Set(assignment.evidence.map(evidenceKey)).size !== assignment.evidence.length;
    if (duplicateEvidence) throw new TrainingSemanticSnapshotError('INVALID_CLASSIFICATION_RESULT', 'assignment evidence contains duplicates', { index, productId: result.productId, capabilityCode: assignment.capabilityCode });
  }
  const keys = result.assignments.map((assignment) => assignmentKey(assignment));
  if (new Set(keys).size !== keys.length) throw new TrainingSemanticSnapshotError('DUPLICATE_ASSIGNMENT', 'duplicate assignment detected', { index, productId: result.productId });
}

function toRecord(result: TrainingSemanticClassificationResult): TrainingSemanticSnapshotRecord {
  const assignments = result.assignments.map((assignment) => ({
    capabilityCode: assignment.capabilityCode,
    relationType: assignment.relationType,
    classificationConfidence: assignment.classificationConfidence,
    evidence: canonicalEvidence(assignment.evidence),
    reviewState: assignment.reviewState,
    ...(assignment.moduleId ? { moduleId: assignment.moduleId } : {}),
    ...(assignment.modifierCodes?.length ? { modifierCodes: [...assignment.modifierCodes].sort(compareStrings) } : {}),
  })).sort((left, right) => assignmentKey(left).localeCompare(assignmentKey(right)));
  return {
    productId: result.productId,
    assignments,
    coverageStatus: result.coverageStatus,
    warnings: [...result.warnings].sort(compareStrings),
  };
}

export function calculateTrainingSemanticSnapshotCounts(records: readonly TrainingSemanticSnapshotRecord[]): TrainingSemanticSnapshotCounts {
  const coverageCounts = Object.fromEntries(trainingCoverageStatuses.map((status) => [status, 0])) as TrainingSemanticSnapshotCounts['coverageCounts'];
  const assignmentCountsByCapability = Object.fromEntries(trainingCapabilityCodes.map((code) => [code, 0]));
  let directAssignments = 0;
  let supportedAssignments = 0;
  let assignmentCount = 0;
  let multiAssignmentProducts = 0;
  for (const record of records) {
    coverageCounts[record.coverageStatus] += 1;
    if (record.assignments.length > 1) multiAssignmentProducts += 1;
    for (const assignment of record.assignments) {
      assignmentCount += 1;
      assignmentCountsByCapability[assignment.capabilityCode] = (assignmentCountsByCapability[assignment.capabilityCode] ?? 0) + 1;
      if (assignment.relationType === 'DIRECT') directAssignments += 1;
      if (assignment.relationType === 'SUPPORTED') supportedAssignments += 1;
    }
  }
  return {
    sourceProducts: records.length,
    productsWithAssignments: records.filter((record) => record.assignments.length > 0).length,
    productsWithoutAssignments: records.filter((record) => record.assignments.length === 0).length,
    assignmentCount,
    directAssignments,
    supportedAssignments,
    multiAssignmentProducts,
    coverageCounts,
    assignmentCountsByCapability,
  };
}

export function createTrainingSemanticSnapshotSemanticPayload(records: readonly TrainingSemanticSnapshotRecord[]) {
  return { records: [...records].sort((left, right) => left.productId - right.productId) };
}

export function createTrainingSemanticSnapshotId(input: { readonly registryVersion: string; readonly registryHash: string; readonly classifierVersion: string; readonly rulesHash: string; readonly semanticChecksum: string; readonly counts: TrainingSemanticSnapshotCounts; readonly sourceProductSemanticSnapshotId?: string }): string {
  return `sha256:${hashTrainingSnapshotCanonical({
    schemaVersion: '1',
    registryVersion: input.registryVersion,
    registryHash: input.registryHash,
    classifierVersion: input.classifierVersion,
    rulesHash: input.rulesHash,
    semanticChecksum: input.semanticChecksum,
    counts: input.counts,
    ...(input.sourceProductSemanticSnapshotId ? { sourceProductSemanticSnapshotId: input.sourceProductSemanticSnapshotId } : {}),
  })}`;
}

export function recomputeTrainingSemanticSnapshotIdentity(snapshot: TrainingSemanticSnapshot): { readonly semanticChecksum: string; readonly snapshotId: string } {
  const records = [...snapshot.records].sort((left, right) => left.productId - right.productId);
  const semanticChecksum = hashTrainingSnapshotCanonical(createTrainingSemanticSnapshotSemanticPayload(records));
  const snapshotId = createTrainingSemanticSnapshotId({ ...snapshot, semanticChecksum, counts: snapshot.counts });
  return { semanticChecksum, snapshotId };
}

export function validateTrainingSemanticSnapshot(snapshot: TrainingSemanticSnapshot): void {
  const parsed = trainingSemanticSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new TrainingSemanticSnapshotError('INVALID_SNAPSHOT', 'Snapshot does not satisfy its contract', parsed.error.issues);
  const expectedCounts = calculateTrainingSemanticSnapshotCounts(snapshot.records);
  if (canonicalizeTrainingSnapshotJson(expectedCounts) !== canonicalizeTrainingSnapshotJson(snapshot.counts)) throw new TrainingSemanticSnapshotError('COUNTS_INCONSISTENT', 'Snapshot counts do not match its records');
  const identity = recomputeTrainingSemanticSnapshotIdentity(snapshot);
  if (identity.semanticChecksum !== snapshot.semanticChecksum || identity.snapshotId !== snapshot.snapshotId) throw new TrainingSemanticSnapshotError('INVALID_SNAPSHOT', 'Snapshot identity does not match its content');
}

export class DefaultTrainingSemanticSnapshotBuilder implements TrainingSemanticSnapshotBuilder {
  build(input: { readonly results: readonly TrainingSemanticClassificationResult[]; readonly parameters: TrainingSemanticSnapshotBuildParameters }): TrainingSemanticSnapshot {
    const parameters = trainingSemanticSnapshotBuildParametersSchema.parse(input.parameters);
    if (!input.results.length) throw new TrainingSemanticSnapshotError('EMPTY_SOURCE_PRODUCTS', 'Training semantic snapshot requires at least one product');
    if (input.results.length !== parameters.sourceProductCount) throw new TrainingSemanticSnapshotError('COUNTS_INCONSISTENT', 'sourceProductCount does not equal classification result count', { expected: parameters.sourceProductCount, actual: input.results.length });
    const seen = new Set<number>();
    for (const [index, result] of input.results.entries()) {
      if (seen.has(result.productId)) throw new TrainingSemanticSnapshotError('DUPLICATE_PRODUCT_ID', 'duplicate productId detected', { productId: result.productId, index });
      seen.add(result.productId);
      validateResult(result, index);
    }
    const records = input.results.map(toRecord).sort((left, right) => left.productId - right.productId).map((record) => cloneTrainingSnapshotJson(record));
    const counts = calculateTrainingSemanticSnapshotCounts(records);
    const semanticChecksum = hashTrainingSnapshotCanonical(createTrainingSemanticSnapshotSemanticPayload(records));
    const snapshotId = createTrainingSemanticSnapshotId({ registryVersion: trainingSemanticRegistryVersion, registryHash: expectedRegistryHash, classifierVersion: trainingSemanticClassifierVersion, rulesHash: expectedRulesHash, semanticChecksum, counts, sourceProductSemanticSnapshotId: parameters.sourceProductSemanticSnapshotId });
    const snapshot: TrainingSemanticSnapshot = {
      schemaVersion: '1',
      snapshotId,
      registryVersion: trainingSemanticRegistryVersion,
      registryHash: expectedRegistryHash,
      classifierVersion: trainingSemanticClassifierVersion,
      rulesHash: expectedRulesHash,
      semanticChecksum,
      ...(parameters.sourceProductSemanticSnapshotId ? { sourceProductSemanticSnapshotId: parameters.sourceProductSemanticSnapshotId } : {}),
      generatedAt: parameters.generatedAt ?? new Date().toISOString(),
      counts,
      records,
    };
    validateTrainingSemanticSnapshot(snapshot);
    try { canonicalizeTrainingSnapshotJson(snapshot); } catch (error) { throw new TrainingSemanticSnapshotError('INVALID_SNAPSHOT', 'snapshot contains non-serializable content', { cause: error }); }
    return deepFreezeTrainingSnapshot(snapshot);
  }
}
