import {
  bodyRegionCodes,
  muscleGroupCodes,
  trainingSemanticRegistryStatus,
  trainingSemanticRegistryVersion,
  trainingPatternCodes,
  type DerivedTrainingSemantics,
  type TrainingCapabilityCode,
  type TrainingCapabilityDefinition,
  type TrainingSemanticRegistry,
  type TrainingSemanticRegistryMetadata,
} from './contracts.js';
import { computeTrainingSemanticRegistryHash } from './hashing.js';
import { validateTrainingSemanticRegistry } from './validation.js';

const capabilityDefinitions: readonly TrainingCapabilityDefinition[] = [
  {
    code: 'LEG_EXTENSION',
    canonicalName: 'Leg extension',
    description: 'Product explicitly designed for knee extension through a leg-extension movement.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['QUADRICEPS'],
    secondaryMuscleGroups: [],
    trainingPatterns: ['KNEE_EXTENSION'],
  },
  {
    code: 'LEG_CURL',
    canonicalName: 'Leg curl',
    description: 'Product explicitly designed for knee flexion through a leg-curl movement.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['HAMSTRINGS'],
    secondaryMuscleGroups: [],
    trainingPatterns: ['KNEE_FLEXION'],
  },
  {
    code: 'HIP_THRUST',
    canonicalName: 'Hip thrust',
    description: 'Product explicitly designed to position and support a hip-thrust movement.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    primaryMuscleGroups: ['GLUTES'],
    secondaryMuscleGroups: [],
    trainingPatterns: ['HIP_EXTENSION'],
  },
  {
    code: 'CHEST_PRESS',
    canonicalName: 'Chest press',
    description: 'Product explicitly designed as a chest-press station or machine.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['CHEST'],
    secondaryMuscleGroups: ['TRICEPS', 'SHOULDERS'],
    trainingPatterns: ['PRESS'],
  },
  {
    code: 'PEC_DECK',
    canonicalName: 'Pec deck',
    description: 'Product explicitly designed as a pec-deck or chest-fly station.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['CHEST'],
    secondaryMuscleGroups: [],
    trainingPatterns: ['PRESS'],
  },
  {
    code: 'LAT_PULLDOWN',
    canonicalName: 'Lat pulldown',
    description: 'Product explicitly designed as a lat-pulldown station or machine.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['BACK'],
    secondaryMuscleGroups: ['BICEPS'],
    trainingPatterns: ['PULL'],
  },
  {
    code: 'ROW',
    canonicalName: 'Row',
    description: 'Product explicitly designed as a rowing station or machine; technical row variants share this code.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['BACK'],
    secondaryMuscleGroups: ['BICEPS'],
    trainingPatterns: ['PULL'],
  },
  {
    code: 'SHOULDER_PRESS',
    canonicalName: 'Shoulder press',
    description: 'Product explicitly designed as a shoulder-press station or machine.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['SHOULDERS'],
    secondaryMuscleGroups: ['TRICEPS'],
    trainingPatterns: ['PRESS'],
  },
  {
    code: 'PULL_UP',
    canonicalName: 'Pull-up',
    description: 'Product explicitly designed for pull-ups or dominadas as an autonomous station or implement.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['BACK'],
    secondaryMuscleGroups: ['BICEPS'],
    trainingPatterns: ['PULL'],
  },
  {
    code: 'DIP',
    canonicalName: 'Dip',
    description: 'Product explicitly designed for dips or fondos as an autonomous station or support.',
    status: 'ACTIVE',
    derivedBodyRegions: ['UPPER_BODY'],
    primaryMuscleGroups: ['TRICEPS'],
    secondaryMuscleGroups: ['CHEST'],
    trainingPatterns: ['PRESS'],
  },
  {
    code: 'ABDOMINAL_CRUNCH',
    canonicalName: 'Abdominal crunch',
    description: 'Product explicitly designed as an abdominal-crunch station or autonomous abdominal implement.',
    status: 'ACTIVE',
    derivedBodyRegions: ['CORE'],
    primaryMuscleGroups: ['CORE'],
    secondaryMuscleGroups: [],
    trainingPatterns: [],
  },
  {
    code: 'ADDUCTOR',
    canonicalName: 'Adductor',
    description: 'Product explicitly designed as an adductor station or adductor movement capability.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    // A00.2 deliberately left the muscle mapping pending. Do not invent it here.
    primaryMuscleGroups: [],
    secondaryMuscleGroups: [],
    trainingPatterns: [],
  },
  {
    code: 'ABDUCTOR',
    canonicalName: 'Abductor',
    description: 'Product explicitly designed as an abductor station or abductor movement capability.',
    status: 'ACTIVE',
    derivedBodyRegions: ['LOWER_BODY'],
    // A00.2 deliberately left the muscle mapping pending. Do not invent it here.
    primaryMuscleGroups: [],
    secondaryMuscleGroups: [],
    trainingPatterns: [],
  },
];

const canonicalTrainingSemanticRegistry: TrainingSemanticRegistry = Object.freeze({
  registryVersion: trainingSemanticRegistryVersion,
  status: trainingSemanticRegistryStatus,
  createdFrom: Object.freeze([
    'CATALOG-INTELLIGENCE-TRAINING-SEMANTICS-A00-discovery.md',
    'CATALOG-INTELLIGENCE-TRAINING-SEMANTICS-A00.2-ontology-design.md',
    'candidate-capability-registry.csv',
  ]),
  capabilities: Object.freeze(capabilityDefinitions.map((definition) => Object.freeze({
    ...definition,
    derivedBodyRegions: Object.freeze([...definition.derivedBodyRegions]),
    primaryMuscleGroups: Object.freeze([...definition.primaryMuscleGroups]),
    secondaryMuscleGroups: Object.freeze([...definition.secondaryMuscleGroups]),
    trainingPatterns: Object.freeze([...definition.trainingPatterns]),
  }))),
  bodyRegions: Object.freeze([...bodyRegionCodes]),
  muscleGroups: Object.freeze([...muscleGroupCodes]),
  trainingPatterns: Object.freeze([...trainingPatternCodes]),
});

validateTrainingSemanticRegistry(canonicalTrainingSemanticRegistry);

const capabilityByCode = new Map<TrainingCapabilityCode, TrainingCapabilityDefinition>(
  canonicalTrainingSemanticRegistry.capabilities.map((definition) => [definition.code, definition]),
);

const registryMetadata: TrainingSemanticRegistryMetadata = Object.freeze({
  registryVersion: canonicalTrainingSemanticRegistry.registryVersion,
  registryHash: computeTrainingSemanticRegistryHash(canonicalTrainingSemanticRegistry),
  status: canonicalTrainingSemanticRegistry.status,
  activeCapabilityCount: canonicalTrainingSemanticRegistry.capabilities.filter((definition) => definition.status === 'ACTIVE').length,
  bodyRegionCount: canonicalTrainingSemanticRegistry.bodyRegions.length,
  muscleGroupCount: canonicalTrainingSemanticRegistry.muscleGroups.length,
  trainingPatternCount: canonicalTrainingSemanticRegistry.trainingPatterns.length,
});

export function getTrainingSemanticRegistry(): TrainingSemanticRegistry {
  return canonicalTrainingSemanticRegistry;
}

export function getTrainingSemanticRegistryMetadata(): TrainingSemanticRegistryMetadata {
  return registryMetadata;
}

export function getTrainingCapability(code: string): TrainingCapabilityDefinition | undefined {
  return capabilityByCode.get(code as TrainingCapabilityCode);
}

export function deriveTrainingSemantics(code: string): DerivedTrainingSemantics {
  const definition = getTrainingCapability(code);
  if (!definition) {
    throw new Error(`Unknown training capability code: "${code}"`);
  }
  return Object.freeze({
    capabilityCode: definition.code,
    bodyRegions: definition.derivedBodyRegions,
    primaryMuscleGroups: definition.primaryMuscleGroups,
    secondaryMuscleGroups: definition.secondaryMuscleGroups,
    trainingPatterns: definition.trainingPatterns,
  });
}
