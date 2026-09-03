import { describe, expect, it } from 'vitest';
import {
  bodyRegionCodes,
  computeTrainingSemanticRegistryHash,
  deriveTrainingSemantics,
  getTrainingCapability,
  getTrainingSemanticRegistry,
  getTrainingSemanticRegistryMetadata,
  muscleGroupCodes,
  serializeTrainingSemanticRegistry,
  trainingCapabilityCodes,
  trainingPatternCodes,
  validateProductTrainingCapabilityAssignment,
  validateProductTrainingSemanticCoverage,
  validateTrainingSemanticRegistry,
  type ProductTrainingCapabilityAssignment,
  type TrainingSemanticRegistry,
} from '../../src/domain/training-semantics/index.js';

const EXPECTED_CAPABILITIES = [
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

describe('Training Semantic Registry v1', () => {
  it('publishes exactly the approved version and 13 active capabilities', () => {
    const registry = getTrainingSemanticRegistry();
    expect(registry.registryVersion).toBe('training-semantic-registry-v1');
    expect(registry.status).toBe('PUBLISHED');
    expect(registry.capabilities.map((definition) => definition.code)).toEqual(EXPECTED_CAPABILITIES);
    expect(registry.capabilities).toHaveLength(13);
    expect(registry.capabilities.every((definition) => definition.status === 'ACTIVE')).toBe(true);
    expect(trainingCapabilityCodes).toEqual(EXPECTED_CAPABILITIES);
  });

  it('publishes the exact derived vocabularies', () => {
    const registry = getTrainingSemanticRegistry();
    expect(registry.bodyRegions).toEqual(['UPPER_BODY', 'LOWER_BODY', 'CORE', 'FULL_BODY']);
    expect(registry.muscleGroups).toEqual([
      'CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS',
      'QUADRICEPS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'CORE',
    ]);
    expect(registry.trainingPatterns).toEqual(['PRESS', 'PULL', 'KNEE_EXTENSION', 'KNEE_FLEXION', 'HIP_EXTENSION']);
    expect(bodyRegionCodes).toEqual(registry.bodyRegions);
    expect(muscleGroupCodes).toEqual(registry.muscleGroups);
    expect(trainingPatternCodes).toEqual(registry.trainingPatterns);
  });

  it('does not publish deferred capability candidates or training goals/modalities', () => {
    const registry = getTrainingSemanticRegistry();
    const deferred = ['LEG_PRESS', 'SQUAT', 'BENCH_PRESS', 'DEADLIFT', 'BICEPS_CURL', 'TRICEPS_EXTENSION', 'GLUTE_KICKBACK', 'CALF_RAISE', 'BACK_EXTENSION'];
    expect(registry.capabilities.some((definition) => deferred.includes(definition.code))).toBe(false);
    expect(Object.keys(registry)).not.toContain('trainingModalities');
    expect(Object.keys(registry)).not.toContain('trainingGoals');
  });

  it('derives the approved relations deterministically', () => {
    expect(deriveTrainingSemantics('CHEST_PRESS')).toEqual({
      capabilityCode: 'CHEST_PRESS',
      bodyRegions: ['UPPER_BODY'],
      primaryMuscleGroups: ['CHEST'],
      secondaryMuscleGroups: ['TRICEPS', 'SHOULDERS'],
      trainingPatterns: ['PRESS'],
    });
    expect(deriveTrainingSemantics('LEG_EXTENSION')).toEqual({
      capabilityCode: 'LEG_EXTENSION',
      bodyRegions: ['LOWER_BODY'],
      primaryMuscleGroups: ['QUADRICEPS'],
      secondaryMuscleGroups: [],
      trainingPatterns: ['KNEE_EXTENSION'],
    });
    expect(deriveTrainingSemantics('ADDUCTOR').primaryMuscleGroups).toEqual([]);
    expect(deriveTrainingSemantics('ADDUCTOR').secondaryMuscleGroups).toEqual([]);
    expect(() => deriveTrainingSemantics('NOT_A_CAPABILITY')).toThrow(/Unknown training capability/);
  });

  it('returns undefined for an unknown capability without changing registry state', () => {
    expect(getTrainingCapability('NOT_A_CAPABILITY')).toBeUndefined();
    expect(getTrainingSemanticRegistry().capabilities).toHaveLength(13);
  });

  it('exposes stable metadata and the current deterministic hash', () => {
    const metadata = getTrainingSemanticRegistryMetadata();
    expect(metadata).toEqual({
      registryVersion: 'training-semantic-registry-v1',
      registryHash: '82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f',
      status: 'PUBLISHED',
      activeCapabilityCount: 13,
      bodyRegionCount: 4,
      muscleGroupCount: 10,
      trainingPatternCount: 5,
    });
    expect(computeTrainingSemanticRegistryHash(getTrainingSemanticRegistry())).toBe(metadata.registryHash);
  });

  it('hashes semantic content independent of insertion and incidental array order', () => {
    const registry = getTrainingSemanticRegistry();
    const reordered = {
      trainingPatterns: [...registry.trainingPatterns].reverse(),
      muscleGroups: [...registry.muscleGroups].reverse(),
      bodyRegions: [...registry.bodyRegions].reverse(),
      capabilities: registry.capabilities.slice().reverse().map((definition) => ({
        trainingPatterns: [...definition.trainingPatterns].reverse(),
        secondaryMuscleGroups: [...definition.secondaryMuscleGroups].reverse(),
        primaryMuscleGroups: [...definition.primaryMuscleGroups].reverse(),
        derivedBodyRegions: [...definition.derivedBodyRegions].reverse(),
        status: definition.status,
        description: definition.description,
        canonicalName: definition.canonicalName,
        code: definition.code,
      })),
      createdFrom: ['different-provenance-file.md'],
      status: registry.status,
      registryVersion: registry.registryVersion,
    } as unknown as TrainingSemanticRegistry;

    expect(computeTrainingSemanticRegistryHash(reordered)).toBe(computeTrainingSemanticRegistryHash(registry));
    expect(serializeTrainingSemanticRegistry(reordered)).toBe(serializeTrainingSemanticRegistry(registry));
  });

  it('changes hash when semantic content changes', () => {
    const registry = getTrainingSemanticRegistry();
    const changed = {
      ...registry,
      capabilities: registry.capabilities.map((definition) => definition.code === 'ROW'
        ? { ...definition, description: `${definition.description} Changed.` }
        : definition),
    } as unknown as TrainingSemanticRegistry;
    expect(computeTrainingSemanticRegistryHash(changed)).not.toBe(computeTrainingSemanticRegistryHash(registry));
  });

  it('validates the canonical registry and rejects duplicate/unknown relations', () => {
    expect(() => validateTrainingSemanticRegistry(getTrainingSemanticRegistry())).not.toThrow();
    const duplicatePattern = {
      ...getTrainingSemanticRegistry(),
      capabilities: getTrainingSemanticRegistry().capabilities.map((definition) => definition.code === 'ROW'
        ? { ...definition, trainingPatterns: ['PULL', 'PULL'] }
        : definition),
    } as unknown as TrainingSemanticRegistry;
    expect(() => validateTrainingSemanticRegistry(duplicatePattern)).toThrow(/duplicate code/);

    const unknownReference = {
      ...getTrainingSemanticRegistry(),
      capabilities: getTrainingSemanticRegistry().capabilities.map((definition) => definition.code === 'ROW'
        ? { ...definition, derivedBodyRegions: ['NOT_A_REGION'] }
        : definition),
    } as unknown as TrainingSemanticRegistry;
    expect(() => validateTrainingSemanticRegistry(unknownReference)).toThrow(/unknown code/);

    const overlappingMuscles = {
      ...getTrainingSemanticRegistry(),
      capabilities: getTrainingSemanticRegistry().capabilities.map((definition) => definition.code === 'ROW'
        ? { ...definition, secondaryMuscleGroups: ['BACK'] }
        : definition),
    } as unknown as TrainingSemanticRegistry;
    expect(() => validateTrainingSemanticRegistry(overlappingMuscles)).toThrow(/primary\/secondary/);
  });

  it('rejects product-specific or unsupported weighted fields in the registry', () => {
    const invalidRegistry = { ...getTrainingSemanticRegistry(), productId: 123 } as unknown as TrainingSemanticRegistry;
    expect(() => validateTrainingSemanticRegistry(invalidRegistry)).toThrow(/unsupported fields/);
  });
});

describe('Training Semantic future assignment contracts', () => {
  const validAssignment: ProductTrainingCapabilityAssignment = {
    productId: 1269,
    capabilityCode: 'LEG_EXTENSION',
    relationType: 'DIRECT',
    classificationConfidence: 'EXPLICIT',
    evidence: [{ kind: 'NAME', sourceId: '1269', matchedText: 'Extensión de Cuádriceps', ruleId: 'NAME_LEG_EXTENSION' }],
    reviewState: 'AUTO',
    provenance: { classifierVersion: 'future-v1', generatedAt: '2026-09-03T00:00:00.000Z' },
  };

  it('accepts DIRECT and SUPPORTED assignment shapes with evidence', () => {
    expect(() => validateProductTrainingCapabilityAssignment(validAssignment)).not.toThrow();
    expect(() => validateProductTrainingCapabilityAssignment({
      ...validAssignment,
      relationType: 'SUPPORTED',
      reviewState: 'ACCEPTED',
      evidence: [{ kind: 'TRUSTED_CATEGORY', sourceId: 'category-1' }],
    })).not.toThrow();
  });

  it('rejects unknown codes, missing evidence, and override without provenance', () => {
    expect(() => validateProductTrainingCapabilityAssignment({ ...validAssignment, capabilityCode: 'SQUAT' } as never)).toThrow(/unknown code/);
    expect(() => validateProductTrainingCapabilityAssignment({ ...validAssignment, evidence: [] })).toThrow(/at least one evidence/);
    expect(() => validateProductTrainingCapabilityAssignment({
      ...validAssignment,
      reviewState: 'MANUAL_OVERRIDE',
    })).toThrow(/overrideId/);
  });

  it('keeps coverage statuses separate from capability codes', () => {
    expect(() => validateProductTrainingSemanticCoverage({ productId: 80, status: 'NO_CAPABILITY_APPLICABLE' })).not.toThrow();
    expect(() => validateProductTrainingSemanticCoverage({ productId: 80, status: 'UNMODELED', note: 'Capability not yet in v1.' })).not.toThrow();
    expect(() => validateProductTrainingSemanticCoverage({ productId: 80, status: 'SQUAT' } as never)).toThrow(/unknown value/);
  });
});
