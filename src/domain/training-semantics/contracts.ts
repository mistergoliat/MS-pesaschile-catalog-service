/**
 * Versioned Training Semantics domain contracts.
 *
 * This module describes product capabilities and deterministic relations from
 * a capability to training concepts. It does not classify products or model
 * customer intent.
 */

export const trainingSemanticRegistryVersion = 'training-semantic-registry-v1' as const;
export type TrainingSemanticRegistryVersion = typeof trainingSemanticRegistryVersion;

export const trainingSemanticRegistryStatus = 'PUBLISHED' as const;
export type TrainingSemanticRegistryStatus = typeof trainingSemanticRegistryStatus;

export const trainingCapabilityCodes = [
  'LEG_EXTENSION',
  'LEG_CURL',
  'HIP_THRUST',
  'CHEST_PRESS',
  'PEC_DECK',
  'LAT_PULLDOWN',
  'ROW',
  'SHOULDER_PRESS',
  'PULL_UP',
  'DIP',
  'ABDOMINAL_CRUNCH',
  'ADDUCTOR',
  'ABDUCTOR',
] as const;
export type TrainingCapabilityCode = (typeof trainingCapabilityCodes)[number];

export const bodyRegionCodes = ['UPPER_BODY', 'LOWER_BODY', 'CORE', 'FULL_BODY'] as const;
export type BodyRegionCode = (typeof bodyRegionCodes)[number];

export const muscleGroupCodes = [
  'CHEST',
  'BACK',
  'SHOULDERS',
  'BICEPS',
  'TRICEPS',
  'QUADRICEPS',
  'HAMSTRINGS',
  'GLUTES',
  'CALVES',
  'CORE',
] as const;
export type MuscleGroupCode = (typeof muscleGroupCodes)[number];

export const trainingPatternCodes = [
  'PRESS',
  'PULL',
  'KNEE_EXTENSION',
  'KNEE_FLEXION',
  'HIP_EXTENSION',
] as const;
export type TrainingPatternCode = (typeof trainingPatternCodes)[number];

export const trainingCapabilityStatuses = ['ACTIVE', 'DEPRECATED'] as const;
export type TrainingCapabilityStatus = (typeof trainingCapabilityStatuses)[number];

export type TrainingCapabilityDefinition = {
  readonly code: TrainingCapabilityCode;
  readonly canonicalName: string;
  readonly description: string;
  readonly status: TrainingCapabilityStatus;
  readonly derivedBodyRegions: readonly BodyRegionCode[];
  readonly primaryMuscleGroups: readonly MuscleGroupCode[];
  readonly secondaryMuscleGroups: readonly MuscleGroupCode[];
  readonly trainingPatterns: readonly TrainingPatternCode[];
};

export type TrainingSemanticRegistry = {
  readonly registryVersion: TrainingSemanticRegistryVersion;
  readonly status: TrainingSemanticRegistryStatus;
  readonly createdFrom: readonly string[];
  readonly capabilities: readonly TrainingCapabilityDefinition[];
  readonly bodyRegions: readonly BodyRegionCode[];
  readonly muscleGroups: readonly MuscleGroupCode[];
  readonly trainingPatterns: readonly TrainingPatternCode[];
};

export type TrainingSemanticRegistryMetadata = {
  readonly registryVersion: TrainingSemanticRegistryVersion;
  readonly registryHash: string;
  readonly status: TrainingSemanticRegistryStatus;
  readonly activeCapabilityCount: number;
  readonly bodyRegionCount: number;
  readonly muscleGroupCount: number;
  readonly trainingPatternCount: number;
};

export const trainingRelationTypes = ['DIRECT', 'SUPPORTED'] as const;
export type TrainingRelationType = (typeof trainingRelationTypes)[number];

export const trainingClassificationConfidenceLevels = ['EXPLICIT', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type TrainingClassificationConfidence = (typeof trainingClassificationConfidenceLevels)[number];

export const trainingReviewStates = ['AUTO', 'HUMAN_REVIEW', 'ACCEPTED', 'REJECTED', 'MANUAL_OVERRIDE'] as const;
export type TrainingReviewState = (typeof trainingReviewStates)[number];

export const trainingSemanticEvidenceKinds = ['NAME', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'MANUAL_OVERRIDE'] as const;
export type TrainingSemanticEvidenceKind = (typeof trainingSemanticEvidenceKinds)[number];

export type TrainingSemanticEvidence = {
  readonly kind: TrainingSemanticEvidenceKind;
  readonly sourceId?: string;
  readonly matchedText?: string;
  readonly ruleId?: string;
  readonly note?: string;
};

export type TrainingAssignmentProvenance = {
  readonly classifierVersion: string;
  readonly generatedAt: string;
  readonly sourceCatalogExport?: string;
  readonly sourceProductSemanticSnapshotId?: string;
  readonly overrideId?: string;
};

export type ProductTrainingCapabilityAssignment = {
  readonly productId: number;
  readonly capabilityCode: TrainingCapabilityCode;
  readonly relationType: TrainingRelationType;
  readonly classificationConfidence: TrainingClassificationConfidence;
  readonly evidence: readonly TrainingSemanticEvidence[];
  readonly reviewState: TrainingReviewState;
  readonly moduleId?: string;
  readonly modifierCodes?: readonly string[];
  readonly provenance: TrainingAssignmentProvenance;
};

export const trainingCoverageStatuses = [
  'NO_CAPABILITY_APPLICABLE',
  'UNMODELED',
  'INSUFFICIENT_EVIDENCE',
  'NEEDS_REVIEW',
] as const;
export type TrainingCoverageStatus = (typeof trainingCoverageStatuses)[number];

export type ProductTrainingSemanticCoverage = {
  readonly productId: number;
  readonly status: TrainingCoverageStatus;
  readonly note?: string;
};

export type DerivedTrainingSemantics = {
  readonly capabilityCode: TrainingCapabilityCode;
  readonly bodyRegions: readonly BodyRegionCode[];
  readonly primaryMuscleGroups: readonly MuscleGroupCode[];
  readonly secondaryMuscleGroups: readonly MuscleGroupCode[];
  readonly trainingPatterns: readonly TrainingPatternCode[];
};
