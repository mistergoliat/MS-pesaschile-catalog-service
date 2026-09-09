import {
  trainingClassificationConfidenceLevels,
  trainingCoverageStatuses,
  trainingRelationTypes,
  trainingReviewStates,
} from '../training-semantics/contracts.js';
import {
  exerciseCapabilityCodesV2,
  getTrainingSemanticRegistryV2,
  trainingFunctionCodesV2,
  trainingFunctionEvidenceKinds,
  trainingFunctionRelationTypes,
  validateProductTrainingFunctionAssignment,
} from '../training-semantics-v2/index.js';
import type { TrainingSemanticClassificationV2Result } from './contracts.js';

export function validateTrainingSemanticClassificationV2Result(result: TrainingSemanticClassificationV2Result): void {
  const issues: string[] = [];
  if (!Number.isInteger(result.productId) || result.productId <= 0) issues.push('productId must be a positive integer');
  if (result.classifierVersion !== 'training-semantic-classifier-v2') issues.push('classifierVersion must be training-semantic-classifier-v2');
  if (result.registryVersion !== 'training-semantic-registry-v2') issues.push('registryVersion must be training-semantic-registry-v2');
  if (result.registryHash !== getTrainingSemanticRegistryV2().registryHash) issues.push('registryHash does not match registry V2');
  if (!/^[a-f0-9]{64}$/u.test(result.rulesHash)) issues.push('rulesHash must be a SHA-256 hex string');
  if (!trainingCoverageStatuses.includes(result.coverageStatus)) issues.push(`unknown coverage status ${result.coverageStatus}`);
  const exerciseCodes = result.exerciseCapabilities.map((assignment) => assignment.capabilityCode);
  if (new Set(exerciseCodes).size !== exerciseCodes.length) issues.push('exerciseCapabilities must contain at most one assignment per capability');
  for (const assignment of result.exerciseCapabilities) {
    if (!exerciseCapabilityCodesV2.includes(assignment.capabilityCode)) issues.push(`unknown exercise capability ${assignment.capabilityCode}`);
    if (!trainingRelationTypes.includes(assignment.relationType)) issues.push(`invalid exercise relation ${assignment.relationType}`);
    if (!trainingClassificationConfidenceLevels.includes(assignment.classificationConfidence)) issues.push(`invalid exercise confidence ${assignment.classificationConfidence}`);
    if (!trainingReviewStates.includes(assignment.reviewState)) issues.push(`invalid exercise reviewState ${assignment.reviewState}`);
    if (!assignment.evidence.length) issues.push(`exercise ${assignment.capabilityCode} needs evidence`);
    if (assignment.reviewState === 'AUTO' && !['EXPLICIT', 'HIGH'].includes(assignment.classificationConfidence)) issues.push(`AUTO exercise ${assignment.capabilityCode} must be EXPLICIT or HIGH`);
  }
  const functionKeys = result.trainingFunctions.map((assignment) => `${assignment.functionCode}\u0000${assignment.relationType}`);
  if (new Set(functionKeys).size !== functionKeys.length) issues.push('trainingFunctions must not contain duplicate function/relation assignments');
  for (const assignment of result.trainingFunctions) {
    if (!trainingFunctionCodesV2.includes(assignment.functionCode)) issues.push(`unknown training function ${assignment.functionCode}`);
    if (!trainingFunctionRelationTypes.includes(assignment.relationType)) issues.push(`invalid training function relation ${assignment.relationType}`);
    if (!trainingClassificationConfidenceLevels.includes(assignment.classificationConfidence)) issues.push(`invalid function confidence ${assignment.classificationConfidence}`);
    if (!trainingReviewStates.includes(assignment.reviewState)) issues.push(`invalid function reviewState ${assignment.reviewState}`);
    for (const evidence of assignment.evidence) if (!trainingFunctionEvidenceKinds.includes(evidence.kind)) issues.push(`invalid function evidence kind ${evidence.kind}`);
    try { validateProductTrainingFunctionAssignment(assignment); } catch (error) { issues.push(error instanceof Error ? error.message : 'invalid training function assignment'); }
  }
  for (const candidate of result.reviewCandidates) {
    if (!['EXERCISE_CAPABILITY', 'TRAINING_FUNCTION'].includes(candidate.semanticType)) issues.push(`invalid review semanticType ${candidate.semanticType}`);
    if (candidate.reviewState !== 'HUMAN_REVIEW') issues.push(`review candidate ${candidate.code} must have HUMAN_REVIEW state`);
    if (!['MEDIUM', 'LOW'].includes(candidate.classificationConfidence)) issues.push(`review candidate ${candidate.code} must be MEDIUM or LOW`);
    if (!candidate.evidence.length) issues.push(`review candidate ${candidate.code} needs evidence`);
  }
  if (result.coverageStatus === 'NEEDS_REVIEW' && result.reviewCandidates.length === 0 && result.exerciseCapabilities.length <= 6) issues.push('NEEDS_REVIEW requires reviewCandidates or an excessive-assignment warning');
  if (issues.length > 0) throw new Error(`Training Semantic Classification V2 validation failed:\n- ${issues.join('\n- ')}`);
}
