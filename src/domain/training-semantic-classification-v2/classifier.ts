import { classifyTrainingSemanticProduct } from '../training-semantic-classification/classifier.js';
import type { TrainingSemanticClassificationInput, TrainingSemanticClassificationOptions } from '../training-semantic-classification/contracts.js';
import {
  computeTrainingSemanticRegistryV2Hash,
  getTrainingSemanticRegistryV2,
  validateProductTrainingFunctionAssignment,
  type ProductTrainingExerciseCapabilityAssignment,
  type ProductTrainingFunctionAssignment,
} from '../training-semantics-v2/index.js';
import {
  deterministicTrainingClassificationV2GeneratedAt,
  trainingSemanticClassifierV2Version,
  type TrainingSemanticClassificationV2Result,
  type TrainingSemanticV2ReviewCandidate,
} from './contracts.js';
import { computeTrainingSemanticClassifierV2RulesHash, evaluateTrainingSemanticV2Rules } from './rules.js';
import { validateTrainingSemanticClassificationV2Result } from './validation.js';

const registry = getTrainingSemanticRegistryV2();
const registryHash = computeTrainingSemanticRegistryV2Hash(registry);
const rulesHash = computeTrainingSemanticClassifierV2RulesHash();
const v2ExerciseCodes = new Set<string>(registry.exerciseCapabilities.map((definition) => definition.code));

function assignmentFromExerciseMatch(input: TrainingSemanticClassificationInput, match: ReturnType<typeof evaluateTrainingSemanticV2Rules>['exerciseMatches'][number], generatedAt: string, sourceCatalogExport?: string): ProductTrainingExerciseCapabilityAssignment {
  return {
    productId: input.productId,
    capabilityCode: match.code,
    relationType: match.relationType,
    classificationConfidence: match.confidence,
    evidence: match.evidence,
    reviewState: 'AUTO',
    provenance: {
      classifierVersion: trainingSemanticClassifierV2Version,
      generatedAt,
      ...(sourceCatalogExport ? { sourceCatalogExport } : {}),
    },
  };
}

function assignmentFromFunctionMatch(input: TrainingSemanticClassificationInput, match: ReturnType<typeof evaluateTrainingSemanticV2Rules>['functionMatches'][number], generatedAt: string, sourceCatalogExport?: string): ProductTrainingFunctionAssignment {
  const assignment: ProductTrainingFunctionAssignment = {
    productId: input.productId,
    functionCode: match.code,
    relationType: match.relationType,
    ...(match.productFamily ? { productFamily: match.productFamily } : {}),
    classificationConfidence: match.confidence,
    evidence: match.evidence.filter((evidence) => match.relationType === 'FAMILY_DERIVED' || evidence.kind !== 'FAMILY_DERIVATION'),
    reviewState: 'AUTO',
    provenance: {
      classifierVersion: trainingSemanticClassifierV2Version,
      generatedAt,
      ...(sourceCatalogExport ? { sourceCatalogExport } : {}),
    },
  };
  validateProductTrainingFunctionAssignment(assignment);
  return assignment;
}

function exerciseReviewCandidate(match: ReturnType<typeof evaluateTrainingSemanticV2Rules>['exerciseReviewCandidates'][number]): TrainingSemanticV2ReviewCandidate {
  return {
    semanticType: 'EXERCISE_CAPABILITY',
    code: match.code,
    capabilityCode: match.code,
    relationType: match.relationType,
    classificationConfidence: match.confidence as 'MEDIUM' | 'LOW',
    reviewState: 'HUMAN_REVIEW',
    evidence: match.evidence,
    reason: 'Medium/low evidence is retained as a review candidate and is not auto-published.',
  };
}

function functionReviewCandidate(match: ReturnType<typeof evaluateTrainingSemanticV2Rules>['functionReviewCandidates'][number]): TrainingSemanticV2ReviewCandidate {
  return {
    semanticType: 'TRAINING_FUNCTION',
    code: match.code,
    functionCode: match.code,
    relationType: match.relationType,
    classificationConfidence: match.confidence as 'MEDIUM' | 'LOW',
    reviewState: 'HUMAN_REVIEW',
    evidence: match.evidence,
    reason: 'Medium/low evidence is retained as a review candidate and is not auto-published.',
  };
}

function dedupeExerciseAssignments(assignments: readonly ProductTrainingExerciseCapabilityAssignment[]): readonly ProductTrainingExerciseCapabilityAssignment[] {
  const byCode = new Map<string, ProductTrainingExerciseCapabilityAssignment>();
  for (const assignment of assignments) if (!byCode.has(assignment.capabilityCode)) byCode.set(assignment.capabilityCode, assignment);
  return [...byCode.values()].sort((left, right) => left.capabilityCode.localeCompare(right.capabilityCode));
}

function dedupeFunctionAssignments(assignments: readonly ProductTrainingFunctionAssignment[]): readonly ProductTrainingFunctionAssignment[] {
  const byCode = new Map<string, ProductTrainingFunctionAssignment>();
  for (const assignment of assignments) {
    const current = byCode.get(assignment.functionCode);
    if (!current || (current.relationType === 'FAMILY_DERIVED' && assignment.relationType === 'DIRECT')) byCode.set(assignment.functionCode, assignment);
  }
  return [...byCode.values()].sort((left, right) => left.functionCode.localeCompare(right.functionCode));
}

export function classifyTrainingSemanticProductV2(
  input: TrainingSemanticClassificationInput,
  options: TrainingSemanticClassificationOptions = {},
): TrainingSemanticClassificationV2Result {
  const generatedAt = options.generatedAt ?? deterministicTrainingClassificationV2GeneratedAt;
  const v1 = classifyTrainingSemanticProduct(input, options);
  const evaluation = evaluateTrainingSemanticV2Rules(input);
  const v1Assignments = v1.assignments.map((assignment) => assignment as ProductTrainingExerciseCapabilityAssignment);
  const addedExerciseAssignments = evaluation.exerciseMatches.map((match) => assignmentFromExerciseMatch(input, match, generatedAt, options.sourceCatalogExport));
  const exerciseCapabilities = dedupeExerciseAssignments([...v1Assignments, ...addedExerciseAssignments]);
  const trainingFunctions = dedupeFunctionAssignments(evaluation.functionMatches.map((match) => assignmentFromFunctionMatch(input, match, generatedAt, options.sourceCatalogExport)));
  const reviewCandidates: TrainingSemanticV2ReviewCandidate[] = [
    ...v1.reviewCandidates.map((candidate) => ({
      semanticType: 'EXERCISE_CAPABILITY' as const,
      code: candidate.capabilityCode,
      capabilityCode: candidate.capabilityCode,
      relationType: candidate.relationType,
      classificationConfidence: candidate.classificationConfidence as 'MEDIUM' | 'LOW',
      reviewState: 'HUMAN_REVIEW' as const,
      evidence: candidate.evidence,
      reason: candidate.reason,
    })),
    ...evaluation.exerciseReviewCandidates.map(exerciseReviewCandidate),
    ...evaluation.functionReviewCandidates.map(functionReviewCandidate),
  ].sort((left, right) => left.semanticType.localeCompare(right.semanticType) || left.code.localeCompare(right.code));
  const warnings = [...v1.warnings];
  if (trainingFunctions.length > 0 && exerciseCapabilities.length === 0) warnings.push('Training Function assignment does not imply complete exercise semantic coverage.');
  const coverageStatus = reviewCandidates.length > 0 || exerciseCapabilities.length > 6 ? 'NEEDS_REVIEW' : v1.coverageStatus;
  const deferredFindings = v1.deferredFindings
    .filter((finding) => !v2ExerciseCodes.has(finding.candidateCode) || !exerciseCapabilities.some((assignment) => assignment.capabilityCode === finding.candidateCode))
    .map((finding) => ({ ...finding, productId: input.productId }));
  const result: TrainingSemanticClassificationV2Result = {
    productId: input.productId,
    classifierVersion: trainingSemanticClassifierV2Version,
    registryVersion: registry.registryVersion,
    registryHash,
    rulesHash,
    exerciseCapabilities,
    trainingFunctions,
    coverageStatus,
    reviewCandidates,
    warnings: [...new Set(warnings)],
    deferredFindings,
  };
  validateTrainingSemanticClassificationV2Result(result);
  return result;
}

export function classifyTrainingSemanticProductsV2(
  inputs: readonly TrainingSemanticClassificationInput[],
  options: TrainingSemanticClassificationOptions = {},
): readonly TrainingSemanticClassificationV2Result[] {
  return inputs.map((input) => classifyTrainingSemanticProductV2(input, options));
}

export const classifyTrainingSemanticV2 = classifyTrainingSemanticProductV2;
export const classifyTrainingProductsV2 = classifyTrainingSemanticProductsV2;

export { rulesHash as trainingSemanticClassifierV2RulesHash };
