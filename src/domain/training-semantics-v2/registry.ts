import { bodyRegionCodes, muscleGroupCodes, trainingPatternCodes, type TrainingCapabilityDefinition } from '../training-semantics/contracts.js';
import { getTrainingSemanticRegistry } from '../training-semantics/registry.js';
import { computeTrainingSemanticRegistryV2Hash } from './hashing.js';
import {
  exerciseCapabilityCodesV2,
  trainingFunctionCodesV2,
  trainingSemanticRegistryV2SchemaVersion,
  trainingSemanticRegistryV2Status,
  trainingSemanticRegistryV2Version,
  type DerivedExerciseSemanticsV2,
  type ExerciseCapabilityDefinitionV2,
  type ExerciseCapabilityCodeV2,
  type FamilyTrainingFunctionDerivation,
  type TrainingFunctionCode,
  type TrainingFunctionDefinition,
  type TrainingSemanticRegistryV2,
} from './contracts.js';
import { validateTrainingSemanticRegistryV2 } from './validation.js';

export const trainingSemanticV1Baseline = Object.freeze({
  registryVersion: 'training-semantic-registry-v1',
  registryHash: '82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f',
  snapshotId: 'sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d',
});

const newExerciseCapabilityDefinitions: readonly ExerciseCapabilityDefinitionV2[] = [
  {
    code: 'HACK_SQUAT',
    canonicalName: 'Hack squat',
    description: 'Dedicated hack- or V-squat machine capability with explicit mechanism evidence; generic racks are excluded.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['QUADRICEPS'],
    secondaryMuscleGroups: ['GLUTES'],
    trainingPatterns: ['KNEE_EXTENSION'],
  },
  {
    code: 'LEG_PRESS',
    canonicalName: 'Leg press',
    description: 'Dedicated leg-press machine capability asserted by explicit Product Truth.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['QUADRICEPS'],
    secondaryMuscleGroups: ['GLUTES'],
    trainingPatterns: ['KNEE_EXTENSION'],
  },
  {
    code: 'CALF_RAISE',
    canonicalName: 'Calf raise',
    description: 'Dedicated standing or seated calf-raise machine capability.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['CALVES'],
    secondaryMuscleGroups: [],
    trainingPatterns: [],
  },
  {
    code: 'REAR_DELT_FLY',
    canonicalName: 'Rear delt fly',
    description: 'Dedicated rear-delt fly capability, including an explicit dual pec-fly/rear-delt station.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['SHOULDERS'],
    secondaryMuscleGroups: ['BACK'],
    trainingPatterns: [],
  },
  {
    code: 'BICEPS_CURL',
    canonicalName: 'Biceps curl',
    description: 'Dedicated biceps-curl capability asserted by explicit Product Truth.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['BICEPS'],
    secondaryMuscleGroups: [],
    trainingPatterns: [],
  },
  {
    code: 'TRICEPS_EXTENSION',
    canonicalName: 'Triceps extension',
    description: 'Dedicated triceps-extension capability asserted by explicit Product Truth.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['TRICEPS'],
    secondaryMuscleGroups: [],
    trainingPatterns: [],
  },
  {
    code: 'PENDULUM_SQUAT',
    canonicalName: 'Pendulum squat',
    description: 'Dedicated pendulum-squat capability requiring explicit pendulum geometry.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['QUADRICEPS'],
    secondaryMuscleGroups: ['GLUTES'],
    trainingPatterns: ['KNEE_EXTENSION'],
  },
  {
    code: 'BELT_SQUAT',
    canonicalName: 'Belt squat',
    description: 'Dedicated belt-squat capability asserted by explicit belt-squat Product Truth.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['QUADRICEPS'],
    secondaryMuscleGroups: ['GLUTES'],
    trainingPatterns: ['KNEE_EXTENSION'],
  },
  {
    code: 'REVERSE_HYPER',
    canonicalName: 'Reverse hyper',
    description: 'Dedicated reverse-hyper capability asserted by explicit Product Truth.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['GLUTES'],
    secondaryMuscleGroups: ['HAMSTRINGS'],
    trainingPatterns: ['HIP_EXTENSION'],
  },
  {
    code: 'DEADLIFT',
    canonicalName: 'Deadlift',
    description: 'Narrow capability for a dedicated deadlift machine only; a deadlift jack or generic barbell is not sufficient.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['GLUTES'],
    secondaryMuscleGroups: ['HAMSTRINGS'],
    trainingPatterns: ['HIP_EXTENSION'],
  },
  {
    code: 'PULLOVER',
    canonicalName: 'Pullover',
    description: 'Dedicated pullover-machine capability asserted by explicit Product Truth.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['BACK'],
    secondaryMuscleGroups: [],
    trainingPatterns: [],
  },
];

const trainingFunctionDefinitions: readonly TrainingFunctionDefinition[] = [
  {
    code: 'CABLE_RESISTANCE',
    canonicalName: 'Cable resistance',
    description: 'General cable resistance delivery without asserting a particular exercise or anatomy.',
    status: 'ACTIVE',
    allowedRelationTypes: ['DIRECT', 'FAMILY_DERIVED'],
    allowedEvidenceKinds: ['NAME', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'FAMILY_DERIVATION', 'MANUAL_OVERRIDE'],
  },
  {
    code: 'MULTI_DIRECTIONAL_RESISTANCE',
    canonicalName: 'Multi-directional resistance',
    description: 'Resistance available through explicit crossover or dual geometry.',
    status: 'ACTIVE',
    allowedRelationTypes: ['DIRECT'],
    allowedEvidenceKinds: ['NAME', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'MANUAL_OVERRIDE'],
  },
  {
    code: 'BODYWEIGHT_SUPPORT',
    canonicalName: 'Bodyweight support',
    description: 'Explicit support or obstacle utility for bodyweight training without asserting an exercise.',
    status: 'ACTIVE',
    allowedRelationTypes: ['DIRECT'],
    allowedEvidenceKinds: ['NAME', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'MANUAL_OVERRIDE'],
  },
  {
    code: 'BARBELL_SUPPORT',
    canonicalName: 'Barbell support',
    description: 'Explicit open rack or stand support for a barbell; it is not a generic squat assignment.',
    status: 'ACTIVE',
    allowedRelationTypes: ['DIRECT'],
    allowedEvidenceKinds: ['NAME', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'MANUAL_OVERRIDE'],
  },
  {
    code: 'GUIDED_BARBELL_SUPPORT',
    canonicalName: 'Guided barbell support',
    description: 'Explicit Smith or Multipower guided bar path, distinct from open barbell support.',
    status: 'ACTIVE',
    allowedRelationTypes: ['DIRECT'],
    allowedEvidenceKinds: ['NAME', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'MANUAL_OVERRIDE'],
  },
];

const familyTrainingFunctionDerivations: readonly FamilyTrainingFunctionDerivation[] = [
  {
    productFamily: 'CABLE_MACHINE',
    trainingFunctionCode: 'CABLE_RESISTANCE',
    relationType: 'FAMILY_DERIVED',
    evidenceKind: 'FAMILY_DERIVATION',
    status: 'ACTIVE',
    rationale: 'The approved generic cable family derivation expresses resistance delivery without inventing an exercise.',
  },
];

const semanticBoundaries = {
  exerciseCapability: 'Specific exercise/function asserted by Product Truth.',
  trainingFunction: 'Instrumental/general training utility that does not assert exercise, anatomy, region or goal.',
  deadlift: {
    dedicatedMachine: 'DEADLIFT',
    deadliftJack: 'NOT_DEADLIFT',
    barbell: 'NOT_DEADLIFT_AUTOMATICALLY',
    familyDerived: false,
  },
  squat: {
    forbiddenGenericCode: 'SQUAT',
    explicitCapabilities: ['HACK_SQUAT', 'PENDULUM_SQUAT', 'BELT_SQUAT'],
    genericEquipmentPolicy: 'TRAINING_FUNCTION_OR_OTHER_PRODUCT_TRUTH',
  },
} as const;

function freezeExerciseDefinition(definition: ExerciseCapabilityDefinitionV2): ExerciseCapabilityDefinitionV2 {
  return Object.freeze({
    ...definition,
    derivedBodyRegions: Object.freeze([...definition.derivedBodyRegions]),
    primaryMuscleGroups: Object.freeze([...definition.primaryMuscleGroups]),
    secondaryMuscleGroups: Object.freeze([...definition.secondaryMuscleGroups]),
    trainingPatterns: Object.freeze([...definition.trainingPatterns]),
  });
}

function freezeV1Definition(definition: TrainingCapabilityDefinition): ExerciseCapabilityDefinitionV2 {
  return freezeExerciseDefinition(definition);
}

const v1Registry = getTrainingSemanticRegistry();
const exerciseCapabilities = Object.freeze([
  ...v1Registry.capabilities.map(freezeV1Definition),
  ...newExerciseCapabilityDefinitions.map(freezeExerciseDefinition),
]);

const exerciseDerivedRelations: readonly DerivedExerciseSemanticsV2[] = Object.freeze(exerciseCapabilities.map((definition) => Object.freeze({
  capabilityCode: definition.code,
  bodyRegions: Object.freeze([...definition.derivedBodyRegions]),
  primaryMuscleGroups: Object.freeze([...definition.primaryMuscleGroups]),
  secondaryMuscleGroups: Object.freeze([...definition.secondaryMuscleGroups]),
  trainingPatterns: Object.freeze([...definition.trainingPatterns]),
})));

const registryWithoutHash = {
  schemaVersion: trainingSemanticRegistryV2SchemaVersion,
  registryVersion: trainingSemanticRegistryV2Version,
  registryHash: '',
  status: trainingSemanticRegistryV2Status,
  createdFrom: Object.freeze([
    'docs/design/training-semantics/a00.6.4/training-semantic-ontology-expansion.md',
    'docs/design/training-semantics/a00.6.4/training-semantic-v2-proposed-registry.json',
    'training-semantic-registry-v1',
  ]),
  exerciseCapabilities,
  trainingFunctions: Object.freeze(trainingFunctionDefinitions.map((definition) => Object.freeze({
    ...definition,
    allowedRelationTypes: Object.freeze([...definition.allowedRelationTypes]),
    allowedEvidenceKinds: Object.freeze([...definition.allowedEvidenceKinds]),
  }))),
  bodyRegions: Object.freeze([...bodyRegionCodes]),
  muscleGroups: Object.freeze([...muscleGroupCodes]),
  trainingPatterns: Object.freeze([...trainingPatternCodes]),
  exerciseDerivedRelations,
  familyTrainingFunctionDerivations: Object.freeze(familyTrainingFunctionDerivations.map((derivation) => Object.freeze({ ...derivation }))),
  semanticBoundaries,
} satisfies Omit<TrainingSemanticRegistryV2, 'registryHash'> & { registryHash: string };

const registryHash = computeTrainingSemanticRegistryV2Hash(registryWithoutHash);

const canonicalTrainingSemanticRegistryV2: TrainingSemanticRegistryV2 = Object.freeze({
  ...registryWithoutHash,
  registryHash,
});

validateTrainingSemanticRegistryV2(canonicalTrainingSemanticRegistryV2);

const exerciseCapabilityByCode = new Map<ExerciseCapabilityCodeV2, ExerciseCapabilityDefinitionV2>(
  canonicalTrainingSemanticRegistryV2.exerciseCapabilities.map((definition) => [definition.code, definition]),
);
const trainingFunctionByCode = new Map<TrainingFunctionCode, TrainingFunctionDefinition>(
  canonicalTrainingSemanticRegistryV2.trainingFunctions.map((definition) => [definition.code, definition]),
);

export function getTrainingSemanticRegistryV2(): TrainingSemanticRegistryV2 {
  return canonicalTrainingSemanticRegistryV2;
}

export function getExerciseCapabilityV2(code: string): ExerciseCapabilityDefinitionV2 | undefined {
  return exerciseCapabilityByCode.get(code as ExerciseCapabilityCodeV2);
}

export function getTrainingFunction(code: string): TrainingFunctionDefinition | undefined {
  return trainingFunctionByCode.get(code as TrainingFunctionCode);
}

export function deriveExerciseSemantics(code: string): DerivedExerciseSemanticsV2 {
  const definition = getExerciseCapabilityV2(code);
  if (!definition) throw new Error(`Unknown V2 exercise capability code: "${code}"`);
  return Object.freeze({
    capabilityCode: definition.code,
    bodyRegions: definition.derivedBodyRegions,
    primaryMuscleGroups: definition.primaryMuscleGroups,
    secondaryMuscleGroups: definition.secondaryMuscleGroups,
    trainingPatterns: definition.trainingPatterns,
  });
}

export function getFamilyDerivedTrainingFunctions(productFamily: string): readonly TrainingFunctionDefinition[] {
  const codes = canonicalTrainingSemanticRegistryV2.familyTrainingFunctionDerivations
    .filter((derivation) => derivation.productFamily === productFamily && derivation.status === 'ACTIVE')
    .map((derivation) => derivation.trainingFunctionCode);
  return Object.freeze(codes.map((code) => trainingFunctionByCode.get(code)!).filter(Boolean));
}

export function getFamilyDerivedTrainingFunctionCodes(productFamily: string): readonly TrainingFunctionCode[] {
  return Object.freeze(canonicalTrainingSemanticRegistryV2.familyTrainingFunctionDerivations
    .filter((derivation) => derivation.productFamily === productFamily && derivation.status === 'ACTIVE')
    .map((derivation) => derivation.trainingFunctionCode));
}

export { exerciseCapabilityCodesV2, trainingFunctionCodesV2 };
