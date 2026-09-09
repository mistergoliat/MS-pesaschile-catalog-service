/**
 * Training Semantics V2 contracts.
 *
 * V2 deliberately keeps exercise capabilities and training functions as two
 * different semantic types. A training function is an instrumental utility;
 * it never participates in anatomy, movement-pattern or goal derivation.
 */

import type {
  BodyRegionCode,
  MuscleGroupCode,
  TrainingAssignmentProvenance,
  TrainingClassificationConfidence,
  TrainingPatternCode,
  TrainingRelationType,
  TrainingReviewState,
  TrainingSemanticEvidence,
} from '../training-semantics/contracts.js';

export const trainingSemanticRegistryV2SchemaVersion = '2' as const;
export type TrainingSemanticRegistryV2SchemaVersion = typeof trainingSemanticRegistryV2SchemaVersion;

export const trainingSemanticRegistryV2Version = 'training-semantic-registry-v2' as const;
export type TrainingSemanticRegistryV2Version = typeof trainingSemanticRegistryV2Version;

export const trainingSemanticRegistryV2Status = 'PUBLISHED' as const;
export type TrainingSemanticRegistryV2Status = typeof trainingSemanticRegistryV2Status;

export const exerciseCapabilityCodesV2 = [
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
  'HACK_SQUAT',
  'LEG_PRESS',
  'CALF_RAISE',
  'REAR_DELT_FLY',
  'BICEPS_CURL',
  'TRICEPS_EXTENSION',
  'PENDULUM_SQUAT',
  'BELT_SQUAT',
  'REVERSE_HYPER',
  'DEADLIFT',
  'PULLOVER',
] as const;
export type ExerciseCapabilityCodeV2 = (typeof exerciseCapabilityCodesV2)[number];

export const trainingFunctionCodesV2 = [
  'CABLE_RESISTANCE',
  'MULTI_DIRECTIONAL_RESISTANCE',
  'BODYWEIGHT_SUPPORT',
  'BARBELL_SUPPORT',
  'GUIDED_BARBELL_SUPPORT',
] as const;
export type TrainingFunctionCode = (typeof trainingFunctionCodesV2)[number];

export const trainingSemanticV2Statuses = ['ACTIVE', 'DEPRECATED'] as const;
export type TrainingSemanticV2Status = (typeof trainingSemanticV2Statuses)[number];

export const trainingFunctionRelationTypes = ['DIRECT', 'FAMILY_DERIVED'] as const;
export type TrainingFunctionRelationType = (typeof trainingFunctionRelationTypes)[number];

export const trainingFunctionEvidenceKinds = [
  'NAME',
  'TRUSTED_CATEGORY',
  'STRUCTURED_FEATURE',
  'FAMILY_DERIVATION',
  'MANUAL_OVERRIDE',
] as const;
export type TrainingFunctionEvidenceKind = (typeof trainingFunctionEvidenceKinds)[number];

export type ExerciseCapabilityDefinitionV2 = {
  readonly code: ExerciseCapabilityCodeV2;
  readonly canonicalName: string;
  readonly description: string;
  readonly status: TrainingSemanticV2Status;
  readonly derivedBodyRegions: readonly BodyRegionCode[];
  readonly primaryMuscleGroups: readonly MuscleGroupCode[];
  readonly secondaryMuscleGroups: readonly MuscleGroupCode[];
  readonly trainingPatterns: readonly TrainingPatternCode[];
};

export type ExerciseDerivedRelationV2 = {
  readonly capabilityCode: ExerciseCapabilityCodeV2;
  readonly bodyRegions: readonly BodyRegionCode[];
  readonly primaryMuscleGroups: readonly MuscleGroupCode[];
  readonly secondaryMuscleGroups: readonly MuscleGroupCode[];
  readonly trainingPatterns: readonly TrainingPatternCode[];
};

export type TrainingFunctionDefinition = {
  readonly code: TrainingFunctionCode;
  readonly canonicalName: string;
  readonly description: string;
  readonly status: TrainingSemanticV2Status;
  readonly allowedRelationTypes: readonly TrainingFunctionRelationType[];
  readonly allowedEvidenceKinds: readonly TrainingFunctionEvidenceKind[];
};

export type FamilyTrainingFunctionDerivation = {
  readonly productFamily: string;
  readonly trainingFunctionCode: TrainingFunctionCode;
  readonly relationType: 'FAMILY_DERIVED';
  readonly evidenceKind: 'FAMILY_DERIVATION';
  readonly status: TrainingSemanticV2Status;
  readonly rationale: string;
};

export type TrainingSemanticV2SemanticBoundaries = {
  readonly exerciseCapability: string;
  readonly trainingFunction: string;
  readonly deadlift: {
    readonly dedicatedMachine: 'DEADLIFT';
    readonly deadliftJack: 'NOT_DEADLIFT';
    readonly barbell: 'NOT_DEADLIFT_AUTOMATICALLY';
    readonly familyDerived: false;
  };
  readonly squat: {
    readonly forbiddenGenericCode: 'SQUAT';
    readonly explicitCapabilities: readonly ['HACK_SQUAT', 'PENDULUM_SQUAT', 'BELT_SQUAT'];
    readonly genericEquipmentPolicy: 'TRAINING_FUNCTION_OR_OTHER_PRODUCT_TRUTH';
  };
};

export type TrainingSemanticRegistryV2 = {
  readonly schemaVersion: TrainingSemanticRegistryV2SchemaVersion;
  readonly registryVersion: TrainingSemanticRegistryV2Version;
  readonly registryHash: string;
  readonly status: TrainingSemanticRegistryV2Status;
  readonly createdFrom: readonly string[];
  readonly exerciseCapabilities: readonly ExerciseCapabilityDefinitionV2[];
  readonly trainingFunctions: readonly TrainingFunctionDefinition[];
  readonly bodyRegions: readonly BodyRegionCode[];
  readonly muscleGroups: readonly MuscleGroupCode[];
  readonly trainingPatterns: readonly TrainingPatternCode[];
  readonly exerciseDerivedRelations: readonly ExerciseDerivedRelationV2[];
  readonly familyTrainingFunctionDerivations: readonly FamilyTrainingFunctionDerivation[];
  readonly semanticBoundaries: TrainingSemanticV2SemanticBoundaries;
};

export type TrainingFunctionEvidence = {
  readonly kind: TrainingFunctionEvidenceKind;
  readonly sourceId?: string;
  readonly matchedText?: string;
  readonly ruleId?: string;
  readonly note?: string;
};

export type TrainingFunctionAssignmentProvenance = {
  readonly classifierVersion: string;
  readonly generatedAt: string;
  readonly sourceCatalogExport?: string;
  readonly overrideId?: string;
};

export type ProductTrainingFunctionAssignment = {
  readonly productId: number;
  readonly functionCode: TrainingFunctionCode;
  readonly relationType: TrainingFunctionRelationType;
  readonly productFamily?: string;
  readonly classificationConfidence: TrainingClassificationConfidence;
  readonly evidence: readonly TrainingFunctionEvidence[];
  readonly reviewState: TrainingReviewState;
  readonly provenance: TrainingFunctionAssignmentProvenance;
};

export type DerivedExerciseSemanticsV2 = ExerciseDerivedRelationV2;

/** V2 exercise assignment shape; it widens only the capability code union. */
export type ProductTrainingExerciseCapabilityAssignment = {
  readonly productId: number;
  readonly capabilityCode: ExerciseCapabilityCodeV2;
  readonly relationType: TrainingRelationType;
  readonly classificationConfidence: TrainingClassificationConfidence;
  readonly evidence: readonly TrainingSemanticEvidence[];
  readonly reviewState: TrainingReviewState;
  readonly moduleId?: string;
  readonly modifierCodes?: readonly string[];
  readonly provenance: TrainingAssignmentProvenance;
};
