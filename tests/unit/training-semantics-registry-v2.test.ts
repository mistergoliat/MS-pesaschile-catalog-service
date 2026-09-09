import { describe, expect, it } from 'vitest';
import {
  computeTrainingSemanticRegistryV2Hash,
  deriveExerciseSemantics,
  exerciseCapabilityCodesV2,
  getExerciseCapabilityV2,
  getFamilyDerivedTrainingFunctions,
  getTrainingFunction,
  getTrainingSemanticRegistryV2,
  trainingFunctionCodesV2,
  trainingFunctionRelationTypes,
  trainingSemanticV1Baseline,
  validateProductTrainingFunctionAssignment,
  validateTrainingSemanticRegistryV2,
  type TrainingSemanticRegistryV2,
} from '../../src/domain/training-semantics-v2/index.js';
import {
  computeTrainingSemanticRegistryHash,
  getTrainingSemanticRegistry,
  getTrainingSemanticRegistryMetadata,
} from '../../src/domain/training-semantics/index.js';
import { trainingSemanticSnapshotV2Schema } from '../../src/domain/training-semantic-snapshot/index.js';

describe('Training Semantic Registry V2', () => {
  it('keeps V1 immutable and preserves all V1 definitions', () => {
    const v1 = getTrainingSemanticRegistry();
    const v2 = getTrainingSemanticRegistryV2();
    expect(getTrainingSemanticRegistryMetadata().registryHash).toBe(trainingSemanticV1Baseline.registryHash);
    expect(computeTrainingSemanticRegistryHash(v1)).toBe(trainingSemanticV1Baseline.registryHash);
    for (const definition of v1.capabilities) {
      expect(v2.exerciseCapabilities.find((candidate) => candidate.code === definition.code)).toEqual(definition);
    }
  });

  it('publishes exactly 24 exercise capabilities and five training functions', () => {
    const registry = getTrainingSemanticRegistryV2();
    expect(registry.registryVersion).toBe('training-semantic-registry-v2');
    expect(registry.exerciseCapabilities).toHaveLength(24);
    expect(registry.exerciseCapabilities.filter((definition) => definition.status === 'ACTIVE')).toHaveLength(24);
    expect(registry.trainingFunctions).toHaveLength(5);
    expect(registry.trainingFunctions.filter((definition) => definition.status === 'ACTIVE')).toHaveLength(5);
    expect(exerciseCapabilityCodesV2).not.toContain('SQUAT');
    expect(exerciseCapabilityCodesV2).not.toContain('GLUTE_KICKBACK');
    expect(registry.exerciseCapabilities.map((definition) => definition.code)).not.toContain('SQUAT');
    expect(registry.exerciseCapabilities.map((definition) => definition.code)).not.toContain('GLUTE_KICKBACK');
    expect(trainingFunctionCodesV2).toEqual([
      'CABLE_RESISTANCE',
      'MULTI_DIRECTIONAL_RESISTANCE',
      'BODYWEIGHT_SUPPORT',
      'BARBELL_SUPPORT',
      'GUIDED_BARBELL_SUPPORT',
    ]);
    expect(trainingFunctionRelationTypes).toEqual(['DIRECT', 'FAMILY_DERIVED']);
  });

  it('keeps training functions separate from anatomy and separates guided support', () => {
    const registry = getTrainingSemanticRegistryV2();
    expect(Object.keys(registry.trainingFunctions[0] ?? {})).not.toContain('bodyRegions');
    expect(getTrainingFunction('BARBELL_SUPPORT')?.allowedRelationTypes).toEqual(['DIRECT']);
    expect(getTrainingFunction('GUIDED_BARBELL_SUPPORT')?.code).not.toBe(getTrainingFunction('BARBELL_SUPPORT')?.code);
    const invalid = {
      ...registry,
      registryHash: '',
      trainingFunctions: registry.trainingFunctions.map((definition) => definition.code === 'BARBELL_SUPPORT'
        ? { ...definition, bodyRegions: ['UPPER_BODY'] }
        : definition),
    } as unknown as TrainingSemanticRegistryV2;
    expect(() => validateTrainingSemanticRegistryV2(invalid)).toThrow(/anatomy derivation|unsupported field/);
  });

  it('only permits the approved family derivation', () => {
    expect(getFamilyDerivedTrainingFunctions('CABLE_MACHINE').map((definition) => definition.code)).toEqual(['CABLE_RESISTANCE']);
    expect(getFamilyDerivedTrainingFunctions('RACK_CAGE')).toEqual([]);
    expect(getFamilyDerivedTrainingFunctions('BODYWEIGHT_GYMNASTICS')).toEqual([]);
    expect(() => validateProductTrainingFunctionAssignment({
      productId: 1450,
      functionCode: 'CABLE_RESISTANCE',
      relationType: 'FAMILY_DERIVED',
      productFamily: 'RACK_CAGE',
      classificationConfidence: 'HIGH',
      evidence: [{ kind: 'FAMILY_DERIVATION', sourceId: 'RACK_CAGE' }],
      reviewState: 'AUTO',
      provenance: { classifierVersion: 'future-v2', generatedAt: '2026-09-09T00:00:00.000Z' },
    })).toThrow(/no approved family derivation/);
  });

  it('enforces the deadlift boundary and derives new exercises deterministically', () => {
    const registry = getTrainingSemanticRegistryV2();
    expect(registry.semanticBoundaries.deadlift).toMatchObject({
      dedicatedMachine: 'DEADLIFT',
      deadliftJack: 'NOT_DEADLIFT',
      barbell: 'NOT_DEADLIFT_AUTOMATICALLY',
      familyDerived: false,
    });
    expect(getExerciseCapabilityV2('DEADLIFT')?.description).toMatch(/deadlift machine only/i);
    expect(deriveExerciseSemantics('DEADLIFT')).toEqual(deriveExerciseSemantics('DEADLIFT'));
    expect(deriveExerciseSemantics('CALF_RAISE')).toMatchObject({ primaryMuscleGroups: ['CALVES'] });
    expect(deriveExerciseSemantics('PULLOVER')).toMatchObject({ bodyRegions: ['UPPER_BODY'], primaryMuscleGroups: ['BACK'] });
  });

  it('hashes canonical semantic content deterministically and changes on semantic edits', () => {
    const registry = getTrainingSemanticRegistryV2();
    expect(computeTrainingSemanticRegistryV2Hash(registry)).toBe(registry.registryHash);
    const reordered = {
      ...registry,
      exerciseCapabilities: [...registry.exerciseCapabilities].reverse(),
      trainingFunctions: [...registry.trainingFunctions].reverse(),
      bodyRegions: [...registry.bodyRegions].reverse(),
      muscleGroups: [...registry.muscleGroups].reverse(),
      trainingPatterns: [...registry.trainingPatterns].reverse(),
    };
    expect(computeTrainingSemanticRegistryV2Hash(reordered)).toBe(registry.registryHash);
    const changed = {
      ...registry,
      trainingFunctions: registry.trainingFunctions.map((definition) => definition.code === 'CABLE_RESISTANCE'
        ? { ...definition, description: `${definition.description} Changed.` }
        : definition),
    } as unknown as TrainingSemanticRegistryV2;
    expect(computeTrainingSemanticRegistryV2Hash(changed)).not.toBe(registry.registryHash);
  });

  it('defines the future snapshot V2 contract without publishing a snapshot', () => {
    const registry = getTrainingSemanticRegistryV2();
    const parsed = trainingSemanticSnapshotV2Schema.parse({
      schemaVersion: '2',
      snapshotId: `sha256:${'1'.repeat(64)}`,
      registryVersion: 'training-semantic-registry-v2',
      registryHash: registry.registryHash,
      classifierVersion: 'training-semantic-classifier-v2',
      classifierV2RulesHash: '2'.repeat(64),
      semanticChecksum: '3'.repeat(64),
      sourceV1SnapshotId: trainingSemanticV1Baseline.snapshotId,
      generatedAt: '2026-09-09T00:00:00.000Z',
      counts: {
        sourceProducts: 1,
        productsWithExerciseCapabilities: 0,
        productsWithTrainingFunctions: 0,
        exerciseCapabilityAssignmentCount: 0,
        trainingFunctionAssignmentCount: 0,
      },
      records: [{ productId: 1, exerciseCapabilities: [], trainingFunctions: [], coverageStatus: 'UNMODELED', warnings: [] }],
    });
    expect(parsed.schemaVersion).toBe('2');
    expect(parsed.records[0]?.trainingFunctions).toEqual([]);
  });
});
