import {
  trainingClassificationConfidenceLevels,
  trainingCoverageStatuses,
  trainingRelationTypes,
  trainingSemanticEvidenceKinds,
  trainingReviewStates,
  validateProductTrainingCapabilityAssignment,
  type ProductTrainingCapabilityAssignment,
} from '../training-semantics/index.js';
import type { TrainingSemanticClassificationResult } from './contracts.js';

export function validateTrainingSemanticClassificationResult(result: TrainingSemanticClassificationResult): void {
  const issues: string[] = [];
  if (!Number.isInteger(result.productId) || result.productId <= 0) issues.push('productId must be a positive integer');
  if (!result.classifierVersion.trim()) issues.push('classifierVersion must not be empty');
  if (!result.registryVersion.trim()) issues.push('registryVersion must not be empty');
  if (!/^[a-f0-9]{64}$/.test(result.registryHash)) issues.push('registryHash must be a SHA-256 hex string');
  if (!/^[a-f0-9]{64}$/.test(result.rulesHash)) issues.push('rulesHash must be a SHA-256 hex string');
  if (!trainingCoverageStatuses.includes(result.coverageStatus)) issues.push(`unknown coverage status ${result.coverageStatus}`);
  const codes = result.assignments.map((assignment) => assignment.capabilityCode);
  if (new Set(codes).size !== codes.length) issues.push('assignments must contain at most one row per capability');
  for (const assignment of result.assignments) {
    validateProductTrainingCapabilityAssignment(assignment);
    if (assignment.reviewState === 'AUTO' && !['EXPLICIT', 'HIGH'].includes(assignment.classificationConfidence)) issues.push(`AUTO assignment ${assignment.capabilityCode} must be EXPLICIT or HIGH`);
    if (assignment.reviewState === 'AUTO' && assignment.relationType !== 'DIRECT' && assignment.relationType !== 'SUPPORTED') issues.push(`assignment ${assignment.capabilityCode} has invalid relation type`);
    for (const evidence of assignment.evidence) {
      if (!trainingSemanticEvidenceKinds.includes(evidence.kind)) issues.push(`invalid evidence kind ${evidence.kind}`);
      if (evidence.kind === 'MANUAL_OVERRIDE' && assignment.reviewState !== 'MANUAL_OVERRIDE') issues.push('MANUAL_OVERRIDE evidence requires MANUAL_OVERRIDE reviewState');
    }
  }
  for (const candidate of result.reviewCandidates) {
    if (candidate.reviewState !== 'HUMAN_REVIEW') issues.push(`review candidate ${candidate.capabilityCode} must have HUMAN_REVIEW state`);
    if (!trainingRelationTypes.includes(candidate.relationType)) issues.push(`invalid review relation type ${candidate.relationType}`);
    if (!trainingClassificationConfidenceLevels.includes(candidate.classificationConfidence)) issues.push(`invalid review confidence ${candidate.classificationConfidence}`);
    if (candidate.classificationConfidence !== 'MEDIUM' && candidate.classificationConfidence !== 'LOW') issues.push(`review candidate ${candidate.capabilityCode} must be MEDIUM or LOW`);
    if (candidate.evidence.length === 0) issues.push(`review candidate ${candidate.capabilityCode} needs evidence`);
    for (const evidence of candidate.evidence) {
      if (!trainingSemanticEvidenceKinds.includes(evidence.kind)) issues.push(`invalid review evidence kind ${evidence.kind}`);
    }
  }
  if (result.coverageStatus === 'NEEDS_REVIEW' && result.reviewCandidates.length === 0 && !result.warnings.some((warning) => warning.includes('More than 6'))) issues.push('NEEDS_REVIEW requires reviewCandidates or an excessive-assignment warning');
  if (issues.length > 0) throw new Error(`Training Semantic Classification validation failed:\n- ${issues.join('\n- ')}`);
}

export function validateTrainingSemanticAssignmentForClassifier(assignment: ProductTrainingCapabilityAssignment): void {
  validateProductTrainingCapabilityAssignment(assignment);
  if (assignment.reviewState === 'AUTO' && !['EXPLICIT', 'HIGH'].includes(assignment.classificationConfidence)) {
    throw new Error('Automatic classifier assignments require EXPLICIT or HIGH confidence');
  }
  if (assignment.reviewState === 'AUTO' && assignment.evidence.some((evidence) => evidence.kind === 'MANUAL_OVERRIDE')) {
    throw new Error('Automatic classifier assignments cannot contain manual override evidence');
  }
}
