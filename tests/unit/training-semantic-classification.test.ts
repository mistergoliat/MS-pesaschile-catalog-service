import {
  classifyTrainingSemanticProduct,
  computeTrainingSemanticClassifierRulesHash,
  trainingSemanticClassifierVersion,
  type TrainingSemanticClassificationInput,
} from '../../src/domain/training-semantic-classification/index.js';
import { getTrainingSemanticRegistryMetadata } from '../../src/domain/training-semantics/index.js';

function product(name: string, overrides: Partial<TrainingSemanticClassificationInput> = {}): TrainingSemanticClassificationInput {
  return {
    productId: 1,
    name,
    productFamily: null,
    categories: [],
    features: [],
    ...overrides,
  };
}

describe('training semantic classifier A00.4', () => {
  it.each([
    ['Extensión de Cuádriceps', 'LEG_EXTENSION'],
    ['Curl Femoral Sentado', 'LEG_CURL'],
    ['Hip Thrust Machine', 'HIP_THRUST'],
    ['Press de Pectoral', 'CHEST_PRESS'],
    ['Pec Deck', 'PEC_DECK'],
    ['Lat Pulldown', 'LAT_PULLDOWN'],
    ['Remo Sentado', 'ROW'],
    ['Shoulder Press', 'SHOULDER_PRESS'],
    ['Barra de Dominadas', 'PULL_UP'],
    ['Dip Station', 'DIP'],
    ['Abdominal Crunch Machine', 'ABDOMINAL_CRUNCH'],
    ['Máquina Aductora', 'ADDUCTOR'],
    ['Máquina Abductora', 'ABDUCTOR'],
  ] as const)('classifies explicit %s as %s DIRECT', (name, capabilityCode) => {
    const result = classifyTrainingSemanticProduct(product(name));
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({ capabilityCode, relationType: 'DIRECT', classificationConfidence: 'EXPLICIT', reviewState: 'AUTO' });
    expect(result.coverageStatus).toBe('UNMODELED');
  });

  it('supports an explicit pull-up module on a rack without turning the rack family into a positive rule', () => {
    const result = classifyTrainingSemanticProduct(product('Power Rack con módulo de dominadas', { productFamily: 'RACK_CAGE' }));
    expect(result.assignments).toMatchObject([{ capabilityCode: 'PULL_UP', relationType: 'SUPPORTED', classificationConfidence: 'EXPLICIT' }]);
    expect(result.warnings).toContain('SUPPORTED assignment requires explicit module/configuration evidence.');
  });

  it('supports an explicit dip module on a rack', () => {
    const result = classifyTrainingSemanticProduct(product('Power Rack con soporte de fondos', { productFamily: 'RACK_CAGE' }));
    expect(result.assignments).toMatchObject([{ capabilityCode: 'DIP', relationType: 'SUPPORTED' }]);
  });

  it('classifies dual adductor/abductor machines independently', () => {
    const result = classifyTrainingSemanticProduct(product('Dual Abductor / Aductor'));
    expect(result.assignments.map((assignment) => assignment.capabilityCode)).toEqual(['ABDUCTOR', 'ADDUCTOR']);
    expect(result.assignments.every((assignment) => assignment.relationType === 'DIRECT')).toBe(true);
  });

  it.each([
    ['Barra Olímpica', 'BARBELL'],
    ['Mancuerna Hexagonal', 'DUMBBELL'],
    ['Banco Regulable', 'BENCH'],
    ['Power Rack', 'RACK_CAGE'],
    ['Cable Crossover Genérico', 'CABLE_MACHINE'],
    ['Remo Ergómetro', 'CARDIO_MACHINE'],
    ['Banda de Resistencia', 'BAND'],
  ] as const)('does not infer capabilities from %s', (name, productFamily) => {
    const result = classifyTrainingSemanticProduct(product(name, { productFamily }));
    expect(result.assignments).toEqual([]);
    expect(result.coverageStatus).not.toBe('NEEDS_REVIEW');
  });

  it('does not classify AbMat or generic abdominal wheel as crunch', () => {
    expect(classifyTrainingSemanticProduct(product('AbMat abdominal')).assignments).toEqual([]);
    expect(classifyTrainingSemanticProduct(product('Rueda Abdominal')).assignments).toEqual([]);
  });

  it('emits all four contractual coverage states without conflating them', () => {
    expect(classifyTrainingSemanticProduct(product('Palmeta de Caucho', { productFamily: 'FLOORING' })).coverageStatus).toBe('NO_CAPABILITY_APPLICABLE');
    expect(classifyTrainingSemanticProduct(product('Cable Machine Genérica', { productFamily: 'CABLE_MACHINE' })).coverageStatus).toBe('UNMODELED');
    expect(classifyTrainingSemanticProduct(product('Polea de Muro', { productFamily: 'CABLE_MACHINE' })).coverageStatus).toBe('INSUFFICIENT_EVIDENCE');
    expect(classifyTrainingSemanticProduct(product('Máquina comercial', {
      categories: [{ categoryId: 'c1', name: 'Press de Hombro', trustClass: 'SEMANTIC_WEAK' }],
    })).coverageStatus).toBe('NEEDS_REVIEW');
  });

  it('does not leak capabilities through packs or accessories', () => {
    expect(classifyTrainingSemanticProduct(product('Pack Barra + Banco + Discos')).assignments).toEqual([]);
    expect(classifyTrainingSemanticProduct(product('Soporte Para Fondos Accesorio')).assignments).toEqual([]);
    expect(classifyTrainingSemanticProduct(product('Accesorio Polea Alta')).assignments).toEqual([]);
  });

  it('rejects a generic hip-thrust box after targeted adjudication', () => {
    const result = classifyTrainingSemanticProduct(product('Cajón Hip Thrust Acolchado'));
    expect(result.assignments).toEqual([]);
    expect(result.coverageStatus).toBe('NO_CAPABILITY_APPLICABLE');
    expect(result.reviewCandidates).toEqual([]);
  });

  it('rejects generic abdominal benches after targeted adjudication', () => {
    const result = classifyTrainingSemanticProduct(product('Banco Abdominal Ajustable'));
    expect(result.assignments).toEqual([]);
    expect(result.coverageStatus).toBe('NO_CAPABILITY_APPLICABLE');
    expect(result.reviewCandidates).toEqual([]);
  });

  it('does not classify a barbell or pad as HIP_THRUST', () => {
    expect(classifyTrainingSemanticProduct(product('Barra Olímpica Hip Thrust', { productFamily: 'BARBELL' })).assignments).toEqual([]);
    expect(classifyTrainingSemanticProduct(product('Almohadilla Hip Thrust')).assignments).toEqual([]);
  });

  it('records deferred capabilities without mapping them to V1', () => {
    const result = classifyTrainingSemanticProduct(product('Banco Press de Banca con Squat Rack'));
    expect(result.assignments).toEqual([]);
    expect(result.deferredFindings.map((finding) => finding.candidateCode)).toEqual(['SQUAT', 'BENCH_PRESS']);
  });

  it('supports structured semantic feature evidence at HIGH confidence', () => {
    const result = classifyTrainingSemanticProduct(product('Máquina comercial', {
      productFamily: 'CABLE_MACHINE',
      features: [{ featureId: 'f1', featureName: 'Función', value: 'Jalón al pecho', trustClass: 'SEMANTIC' }],
    }));
    expect(result.assignments).toMatchObject([{ capabilityCode: 'LAT_PULLDOWN', classificationConfidence: 'HIGH', relationType: 'DIRECT' }]);
    expect(result.assignments[0]?.evidence[0]).toMatchObject({ kind: 'STRUCTURED_FEATURE', sourceId: 'f1' });
  });

  it('uses trusted category evidence as HIGH only when the category is strong', () => {
    const result = classifyTrainingSemanticProduct(product('Máquina comercial', {
      categories: [{ categoryId: 'c1', name: 'Press de Hombro', trustClass: 'SEMANTIC_STRONG' }],
    }));
    expect(result.assignments).toMatchObject([{ capabilityCode: 'SHOULDER_PRESS', classificationConfidence: 'HIGH' }]);
  });

  it('keeps weak category evidence as a review candidate', () => {
    const result = classifyTrainingSemanticProduct(product('Máquina comercial', {
      categories: [{ categoryId: 'c1', name: 'Press de Hombro', trustClass: 'SEMANTIC_WEAK' }],
    }));
    expect(result.assignments).toEqual([]);
    expect(result.coverageStatus).toBe('NEEDS_REVIEW');
    expect(result.reviewCandidates[0]).toMatchObject({ capabilityCode: 'SHOULDER_PRESS', classificationConfidence: 'MEDIUM' });
  });

  it('requires review for excessive multifunction assignments', () => {
    const result = classifyTrainingSemanticProduct(product('Leg Extension Leg Curl Hip Thrust Chest Press Pec Deck Lat Pulldown Row Shoulder Press Pull Up Dip Abdominal Crunch'));
    expect(result.assignments.length).toBeGreaterThan(6);
    expect(result.coverageStatus).toBe('NEEDS_REVIEW');
    expect(result.warnings).toContain('More than 6 direct/supported capabilities detected; human review is mandatory.');
  });

  it('is invariant to input ordering and produces canonical assignment/evidence ordering', () => {
    const first = classifyTrainingSemanticProduct(product('Dual Polea Alta / Remo Bajo', {
      categories: [
        { categoryId: 'b', name: 'Remo', trustClass: 'SEMANTIC_STRONG' },
        { categoryId: 'a', name: 'Polea Alta', trustClass: 'SEMANTIC_STRONG' },
      ],
      features: [
        { featureId: '2', featureName: 'Función', value: 'Remo Bajo', trustClass: 'SEMANTIC' },
        { featureId: '1', featureName: 'Función', value: 'Jalón al pecho', trustClass: 'SEMANTIC' },
      ],
    }));
    const second = classifyTrainingSemanticProduct(product('Dual Polea Alta / Remo Bajo', {
      categories: [
        { categoryId: 'a', name: 'Polea Alta', trustClass: 'SEMANTIC_STRONG' },
        { categoryId: 'b', name: 'Remo', trustClass: 'SEMANTIC_STRONG' },
      ],
      features: [
        { featureId: '1', featureName: 'Función', value: 'Jalón al pecho', trustClass: 'SEMANTIC' },
        { featureId: '2', featureName: 'Función', value: 'Remo Bajo', trustClass: 'SEMANTIC' },
      ],
    }));
    expect(second).toEqual(first);
    expect(first.assignments.map((assignment) => assignment.capabilityCode)).toEqual(['LAT_PULLDOWN', 'ROW']);
  });

  it('preserves the published registry and versions the rules separately', () => {
    expect(trainingSemanticClassifierVersion).toBe('training-semantic-classifier-v1.1');
    expect(getTrainingSemanticRegistryMetadata()).toMatchObject({
      registryVersion: 'training-semantic-registry-v1',
      registryHash: '82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f',
      activeCapabilityCount: 13,
    });
    expect(computeTrainingSemanticClassifierRulesHash()).toMatch(/^[a-f0-9]{64}$/);
  });
});
