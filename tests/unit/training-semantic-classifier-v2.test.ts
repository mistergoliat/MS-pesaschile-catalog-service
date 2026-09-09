import { describe, expect, it } from 'vitest';
import {
  classifyTrainingSemanticProductV2,
  classifyTrainingSemanticProductsV2,
  computeTrainingSemanticClassifierV2RulesHash,
  trainingSemanticClassifierV2RulesHash,
  trainingSemanticClassifierV2Version,
  type TrainingSemanticClassificationV2Input,
} from '../../src/domain/training-semantic-classification-v2/index.js';
import { classifyTrainingSemanticProducts } from '../../src/domain/training-semantic-classification/index.js';
import { resolveProductSemanticInputPaths } from '../../scripts/product-semantic-classification/lib/fixture-paths.js';
import { loadTrainingSemanticClassificationInputs } from '../../scripts/training-semantic-classification/lib/load-input.js';

function product(name: string, overrides: Partial<TrainingSemanticClassificationV2Input> = {}): TrainingSemanticClassificationV2Input {
  return { productId: 1, name, productFamily: null, categories: [], features: [], ...overrides };
}

function codes(result: ReturnType<typeof classifyTrainingSemanticProductV2>): string[] {
  return result.exerciseCapabilities.map((assignment) => assignment.capabilityCode);
}

function functionCodes(result: ReturnType<typeof classifyTrainingSemanticProductV2>): string[] {
  return result.trainingFunctions.map((assignment) => assignment.functionCode);
}

describe('Training Semantic Classifier V2', () => {
  it.each([
    ['Hack Squat Solid Rock', 'HACK_SQUAT'],
    ['Prensa Horizontal Sentado', 'LEG_PRESS'],
    ['Elevación de Talones de Pie', 'CALF_RAISE'],
    ['Aperturas Pec Fly / Rear Delt', 'REAR_DELT_FLY'],
    ['Dual Bíceps / Tríceps', 'BICEPS_CURL'],
    ['Dual Bíceps / Tríceps', 'TRICEPS_EXTENSION'],
    ['Prensa Péndulo', 'PENDULUM_SQUAT'],
    ['Belt Squat', 'BELT_SQUAT'],
    ['Reverse Hyper', 'REVERSE_HYPER'],
    ['Multi Dead Lift', 'DEADLIFT'],
    ['Pull Over Beast', 'PULLOVER'],
  ] as const)('classifies explicit %s as %s', (name, capability) => {
    const result = classifyTrainingSemanticProductV2(product(name, { productFamily: 'PLATE_LOADED_MACHINE' }));
    expect(codes(result)).toContain(capability);
    expect(result.exerciseCapabilities.find((assignment) => assignment.capabilityCode === capability)).toMatchObject({ relationType: 'DIRECT', classificationConfidence: 'EXPLICIT', reviewState: 'AUTO' });
  });

  it('supports multifunction products only when both names are explicit', () => {
    const result = classifyTrainingSemanticProductV2(product('Aperturas Pec Fly / Rear Delt MO 2.0', { productFamily: 'SELECTORIZED_MACHINE' }));
    expect(codes(result)).toEqual(['PEC_DECK', 'REAR_DELT_FLY']);
    expect(classifyTrainingSemanticProductV2(product('Dual Bíceps / Tríceps MO 2.0', { productFamily: 'SELECTORIZED_MACHINE' })).exerciseCapabilities.map((assignment) => assignment.capabilityCode)).toEqual(['BICEPS_CURL', 'TRICEPS_EXTENSION']);
  });

  it('completes the four known rule closures with reusable rules', () => {
    expect(codes(classifyTrainingSemanticProductV2(product('Par Push Ups 1.0 | FullFit', {
      categories: [{ categoryId: '430', name: 'Barras Paralelas', trustClass: 'SEMANTIC_STRONG' }, { categoryId: '319', name: 'Barras Pull Up & Push Up', trustClass: 'SEMANTIC_STRONG' }],
    })))).toEqual(['DIP', 'PULL_UP']);
    expect(codes(classifyTrainingSemanticProductV2(product('Curl de Femoral Acostado MO 2.0', { productFamily: 'SELECTORIZED_MACHINE' })))).toContain('LEG_CURL');
    expect(codes(classifyTrainingSemanticProductV2(product('T-Bar Row Beast', { productFamily: 'PLATE_LOADED_MACHINE' })))).toContain('ROW');
    expect(codes(classifyTrainingSemanticProductV2(product('3D Hip Thruster Beast', { productFamily: 'PLATE_LOADED_MACHINE' })))).toContain('HIP_THRUST');
  });

  it('preserves the deadlift, squat and false-positive boundaries', () => {
    expect(codes(classifyTrainingSemanticProductV2(product('Deadlift Jack', { productFamily: 'MACHINE_ATTACHMENT' })))).not.toContain('DEADLIFT');
    expect(codes(classifyTrainingSemanticProductV2(product('Barbell Olímpica', { productFamily: 'BARBELL' })))).not.toContain('DEADLIFT');
    expect(codes(classifyTrainingSemanticProductV2(product('Power Rack', { productFamily: 'RACK_CAGE' })))).not.toContain('SQUAT');
    expect(codes(classifyTrainingSemanticProductV2(product('Smith Machine', { productFamily: 'PLATE_LOADED_MACHINE' })))).not.toContain('SQUAT');
    expect(codes(classifyTrainingSemanticProductV2(product('Remo Ergómetro', { productFamily: 'CARDIO_MACHINE' })))).not.toContain('ROW');
    expect(codes(classifyTrainingSemanticProductV2(product('Cable Crossover Genérico', { productFamily: 'CABLE_MACHINE' })))).not.toContain('LAT_PULLDOWN');
    expect(codes(classifyTrainingSemanticProductV2(product('Leg Press Attachment', { productFamily: 'MACHINE_ATTACHMENT' })))).not.toContain('LEG_PRESS');
  });

  it('classifies training functions separately and permits coexistence', () => {
    const cable = classifyTrainingSemanticProductV2(product('Máquina Home Gym', { productFamily: 'CABLE_MACHINE' }));
    expect(functionCodes(cable)).toContain('CABLE_RESISTANCE');
    expect(cable.trainingFunctions[0]).toMatchObject({ relationType: 'FAMILY_DERIVED', productFamily: 'CABLE_MACHINE' });
    const crossover = classifyTrainingSemanticProductV2(product('Wall Crossover', { productFamily: 'CABLE_MACHINE' }));
    expect(functionCodes(crossover)).toEqual(['CABLE_RESISTANCE', 'MULTI_DIRECTIONAL_RESISTANCE']);
    const rack = classifyTrainingSemanticProductV2(product('Atril de Sentadillas', { productFamily: 'RACK_CAGE' }));
    expect(functionCodes(rack)).toEqual(['BARBELL_SUPPORT']);
    const smith = classifyTrainingSemanticProductV2(product('Smith Machine', { productFamily: 'PLATE_LOADED_MACHINE' }));
    expect(functionCodes(smith)).toEqual(['GUIDED_BARBELL_SUPPORT']);
    expect(codes(smith)).not.toContain('SQUAT');
  });

  it('allows family derivation only for CABLE_MACHINE to CABLE_RESISTANCE', async () => {
    const paths = await resolveProductSemanticInputPaths();
    const { inputs } = await loadTrainingSemanticClassificationInputs(paths);
    const results = classifyTrainingSemanticProductsV2(inputs);
    const familyDerived = results.flatMap((result) => result.trainingFunctions.filter((assignment) => assignment.relationType === 'FAMILY_DERIVED'));
    expect(familyDerived.length).toBeGreaterThan(0);
    expect(familyDerived.every((assignment) => assignment.functionCode === 'CABLE_RESISTANCE' && assignment.productFamily === 'CABLE_MACHINE')).toBe(true);
  }, 30000);

  it('keeps weak evidence review-only and does not infer function anatomy', () => {
    const result = classifyTrainingSemanticProductV2(product('Máquina comercial', {
      categories: [{ categoryId: 'c1', name: 'Crossover', trustClass: 'SEMANTIC_WEAK' }],
    }));
    expect(result.trainingFunctions).toEqual([]);
    expect(result.reviewCandidates).toMatchObject([{ semanticType: 'TRAINING_FUNCTION', functionCode: 'MULTI_DIRECTIONAL_RESISTANCE', classificationConfidence: 'MEDIUM' }]);
    expect(Object.keys(result.trainingFunctions[0] ?? {})).not.toContain('bodyRegions');
  });

  it('versions and hashes V2 rules deterministically', () => {
    const first = classifyTrainingSemanticProductV2(product('Dual Crossover', { productFamily: 'CABLE_MACHINE' }));
    const second = classifyTrainingSemanticProductV2(product('Dual Crossover', { productFamily: 'CABLE_MACHINE' }));
    expect(trainingSemanticClassifierV2Version).toBe('training-semantic-classifier-v2');
    expect(trainingSemanticClassifierV2RulesHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(trainingSemanticClassifierV2RulesHash).toBe(computeTrainingSemanticClassifierV2RulesHash());
    expect(first).toEqual(second);
  });

  it('projects every V1 accepted assignment unchanged under V2', async () => {
    const paths = await resolveProductSemanticInputPaths();
    const { inputs } = await loadTrainingSemanticClassificationInputs(paths);
    const v1 = classifyTrainingSemanticProducts(inputs);
    const v2 = classifyTrainingSemanticProductsV2(inputs);
    const v2ById = new Map(v2.map((result) => [result.productId, result] as const));
    const projected = v2.flatMap((result) => result.exerciseCapabilities.filter((assignment) => assignment.provenance.classifierVersion === 'training-semantic-classifier-v1.1'));
    expect(projected).toHaveLength(180);
    expect(projected).toEqual(v1.flatMap((result) => result.assignments));
    expect(v1.filter((result) => result.assignments.length > 0).every((result) => v2ById.get(result.productId)?.exerciseCapabilities.some((assignment) => assignment.provenance.classifierVersion === 'training-semantic-classifier-v1.1'))).toBe(true);
  }, 30000);
});
