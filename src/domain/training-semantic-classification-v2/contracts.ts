import type {
  TrainingCoverageStatus,
  TrainingSemanticEvidence,
} from '../training-semantics/contracts.js';
import type {
  ExerciseCapabilityCodeV2,
  ProductTrainingExerciseCapabilityAssignment,
  ProductTrainingFunctionAssignment,
  TrainingFunctionCode,
  TrainingFunctionEvidence,
  TrainingFunctionRelationType,
} from '../training-semantics-v2/contracts.js';
import type { TrainingSemanticClassificationInput } from '../training-semantic-classification/contracts.js';

export const trainingSemanticClassifierV2Version = 'training-semantic-classifier-v2' as const;
export type TrainingSemanticClassifierV2Version = typeof trainingSemanticClassifierV2Version;

export const deterministicTrainingClassificationV2GeneratedAt = '1970-01-01T00:00:00.000Z' as const;

export type TrainingSemanticClassificationV2Input = TrainingSemanticClassificationInput;

export type TrainingSemanticV2ReviewCandidate = {
  readonly semanticType: 'EXERCISE_CAPABILITY' | 'TRAINING_FUNCTION';
  readonly code: ExerciseCapabilityCodeV2 | TrainingFunctionCode;
  readonly capabilityCode?: ExerciseCapabilityCodeV2;
  readonly functionCode?: TrainingFunctionCode;
  readonly relationType: 'DIRECT' | 'SUPPORTED' | TrainingFunctionRelationType;
  readonly classificationConfidence: 'MEDIUM' | 'LOW';
  readonly reviewState: 'HUMAN_REVIEW';
  readonly evidence: readonly (TrainingSemanticEvidence | TrainingFunctionEvidence)[];
  readonly reason: string;
};

export type TrainingSemanticV2DeferredFinding = {
  readonly productId: number;
  readonly candidateCode: string;
  readonly matchedText: string;
  readonly reason: string;
};

export type TrainingSemanticClassificationV2Result = {
  readonly productId: number;
  readonly classifierVersion: TrainingSemanticClassifierV2Version;
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly rulesHash: string;
  readonly exerciseCapabilities: readonly ProductTrainingExerciseCapabilityAssignment[];
  readonly trainingFunctions: readonly ProductTrainingFunctionAssignment[];
  readonly coverageStatus: TrainingCoverageStatus;
  readonly reviewCandidates: readonly TrainingSemanticV2ReviewCandidate[];
  readonly warnings: readonly string[];
  readonly deferredFindings: readonly TrainingSemanticV2DeferredFinding[];
};
