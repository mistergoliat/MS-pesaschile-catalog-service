import { describe, expect, it } from 'vitest';
import {
  classifyTrainingSemanticProductV21,
  computeTrainingSemanticClassifierV21RulesHash,
  trainingSemanticClassifierV21RulesHash,
} from '../../src/domain/training-semantic-classification-v2-1/index.js';
import type { TrainingSemanticClassificationV21Input } from '../../src/domain/training-semantic-classification-v2-1/index.js';

function product(name: string, overrides: Partial<TrainingSemanticClassificationV21Input> = {}): TrainingSemanticClassificationV21Input {
  return { productId: 1, name, productFamily: null, categories: [], features: [], ...overrides };
}

const cableCategory = { categoryId: '290', name: 'Máquinas con Poleas', trustClass: 'SEMANTIC_STRONG' as const };
const selectorizadaCategory = { categoryId: '281', name: 'Máquinas Selectorizadas', trustClass: 'SEMANTIC_STRONG' as const };

function functions(name: string, overrides: Partial<TrainingSemanticClassificationV21Input> = {}): string[] {
  return classifyTrainingSemanticProductV21(product(name, overrides)).trainingFunctions.map((assignment) => assignment.functionCode);
}

function exercises(name: string, overrides: Partial<TrainingSemanticClassificationV21Input> = {}): string[] {
  return classifyTrainingSemanticProductV21(product(name, overrides)).exerciseCapabilities.map((assignment) => assignment.capabilityCode);
}

describe('Training Semantic Classifier V2.1 gap closure', () => {
  it('closes trusted crossover names but rejects generic cable evidence', () => {
    expect(functions('Polea Cruzada Corta V8 Series', { productFamily: 'CABLE_MACHINE', categories: [cableCategory] })).toContain('MULTI_DIRECTIONAL_RESISTANCE');
    expect(functions('Polea Genérica', { productFamily: 'CABLE_MACHINE', categories: [cableCategory] })).not.toContain('MULTI_DIRECTIONAL_RESISTANCE');
    expect(functions('Polea Cruzada Corta V8 Series', { productFamily: 'CABLE_MACHINE', categories: [{ ...cableCategory, trustClass: 'SEMANTIC_WEAK' }] })).not.toContain('MULTI_DIRECTIONAL_RESISTANCE');
  });

  it('closes dual adjustable pulley only with the structured dual-ratio feature', () => {
    const input = product('Polea Dual Multifuncional 70kg ZR Series', {
      productFamily: 'CABLE_MACHINE', categories: [cableCategory],
      features: [{ featureId: '65', featureName: 'Relación de cable y polea', value: '2:1 - 1:1', trustClass: 'SEMANTIC' }],
    });
    expect(classifyTrainingSemanticProductV21(input).trainingFunctions.map((assignment) => assignment.functionCode)).toContain('MULTI_DIRECTIONAL_RESISTANCE');
    expect(functions('Polea Dual Multifuncional 70kg ZR Series', { productFamily: 'CABLE_MACHINE', categories: [cableCategory], features: [{ featureId: '65', featureName: 'Relación de cable y polea', value: '2:1', trustClass: 'SEMANTIC' }] })).not.toContain('MULTI_DIRECTIONAL_RESISTANCE');
  });

  it('closes each explicit dual exercise module independently', () => {
    expect(exercises('Dual Cuádriceps / Femoral Sentado MO 2.0', { productFamily: 'SELECTORIZED_MACHINE', categories: [selectorizadaCategory] })).toEqual(['LEG_CURL', 'LEG_EXTENSION']);
    expect(exercises('Dual Cuádriceps / Femoral Acostado MO 2.0', { productFamily: 'SELECTORIZED_MACHINE', categories: [selectorizadaCategory] })).toEqual(['LEG_CURL', 'LEG_EXTENSION']);
    expect(exercises('Dual Press Pectoral / Hombros MO 2.0', { productFamily: 'SELECTORIZED_MACHINE', categories: [selectorizadaCategory] })).toEqual(['CHEST_PRESS', 'SHOULDER_PRESS']);
    expect(exercises('Dual Press Genérico', { productFamily: 'SELECTORIZED_MACHINE', categories: [selectorizadaCategory] })).not.toContain('CHEST_PRESS');
  });

  it('does not compensate unknown family or unresolved mechanism with inference', () => {
    expect(functions('Multiestación de Poder 1.0', { categories: [{ categoryId: '314', name: 'Máquinas Home Gym', trustClass: 'SEMANTIC_STRONG' }] })).toEqual([]);
    expect(exercises('Multi Hip Extension', { productFamily: 'PLATE_LOADED_MACHINE', categories: [{ categoryId: '285', name: 'Máquinas con Carga de Discos', trustClass: 'SEMANTIC_STRONG' }] })).not.toContain('HIP_THRUST');
  });

  it('keeps V2.1 deterministic and separately versioned', () => {
    const input = product('Polea Cruzada', { productFamily: 'CABLE_MACHINE', categories: [cableCategory] });
    expect(trainingSemanticClassifierV21RulesHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(trainingSemanticClassifierV21RulesHash).toBe(computeTrainingSemanticClassifierV21RulesHash());
    expect(classifyTrainingSemanticProductV21(input)).toEqual(classifyTrainingSemanticProductV21(input));
    expect(classifyTrainingSemanticProductV21(input).classifierVersion).toBe('training-semantic-classifier-v2.1');
  });
});
