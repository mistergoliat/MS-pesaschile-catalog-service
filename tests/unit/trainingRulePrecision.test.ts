import { describe, expect, it } from 'vitest';
import { classifyTrainingSemanticProductV21 } from '../../src/domain/training-semantic-classification-v2-1/index.js';
import { trainingOntologyGapFindings, reconcileTrainingResolution } from '../../src/domain/training-semantic-snapshot/reconcileResolution.js';
import { validateTrainingSemanticInvariants } from '../../src/domain/training-semantic-snapshot/semanticInvariants.js';
import type { TrainingSemanticClassificationInput } from '../../src/domain/training-semantic-classification/contracts.js';
import type { TrainingSemanticSnapshotV2Record } from '../../src/domain/training-semantic-snapshot/v2-contracts.js';

const mechanism = { featureId: '11', featureName: 'Relación de cable y polea', value: '2:1', trustClass: 'SEMANTIC' as const };
const product = (name: string, extra: Partial<TrainingSemanticClassificationInput> = {}): TrainingSemanticClassificationInput => ({ productId: 900001, name, categories: [], features: [], ...extra });
const codes = (input: TrainingSemanticClassificationInput) => {
  const r = classifyTrainingSemanticProductV21(input);
  return [...r.exerciseCapabilities.map(a => a.capabilityCode), ...r.trainingFunctions.map(a => a.functionCode)];
};
const empty: TrainingSemanticSnapshotV2Record = { productId: 900001, exerciseCapabilities: [], trainingFunctions: [], coverageStatus: 'UNMODELED', resolutionState: 'SEMANTIC_COMPLETE', resolved: true, warnings: [] };

describe('P2.3C-FIX evidence classes', () => {
  it('rejects cable material but preserves cable mechanism', () => {
    expect(codes(product('Speed Rope', { features: [{ ...mechanism, featureName: 'Material', value: 'cable de acero' }] }))).not.toContain('CABLE_RESISTANCE');
    expect(codes(product('Módulo de resistencia', { features: [mechanism] }))).toContain('CABLE_RESISTANCE');
    expect(codes(product('Soga', { features: [{ ...mechanism, featureName: 'Material', value: 'Relación de cable y polea 2:1' }] }))).not.toContain('CABLE_RESISTANCE');
  });
  it.each(['Soga de Tríceps - Accesorio Polea', 'Barra Lat Pull Down - Accesorio Polea', 'Barra Corta Recta - Accesorio Polea', 'Accesorio Polea Cable Bar', 'Ankle Straps', 'Pack Agarres de Polea', 'Asiento Polea Accesorio'])('rejects passive cable part %s even with a circular family and host mechanism', name => {
    expect(codes(product(name, { productFamily: 'CABLE_MACHINE', features: [mechanism], categories: [{ categoryId: '2', name: 'Accesorios de Polea', trustClass: 'SEMANTIC_STRONG' }], productFamilyEvidence: [{ axis: 'PRODUCT_FAMILY', code: 'CABLE_MACHINE', sourceType: 'NAME_TEXT', rawValue: name }] }))).not.toContain('CABLE_RESISTANCE');
  });
  it.each([
    ['Lat Pull Down Accesorio Smith Machine', 'GUIDED_BARBELL_SUPPORT'],
    ['Cable Polea Rack Pro Accesorio', 'BARBELL_SUPPORT'],
  ])('preserves a cable module while rejecting host leakage in %s', (name, hostCode) => {
    const result = codes(product(name!, { features: [mechanism] }));
    expect(result).toContain('CABLE_RESISTANCE');
    expect(result).not.toContain(hostCode);
  });
  it('rejects host rack and cage but preserves the rack sold', () => {
    for (const name of ['Accesorio Rack', 'Accesorio Jaula', 'Bulgarian Squat Accesorio Jaula']) expect(codes(product(name))).not.toContain('BARBELL_SUPPORT');
    expect(codes(product('Squat Rack', { productFamily: 'RACK_CAGE' }))).toContain('BARBELL_SUPPORT');
  });
  it('keeps generic rack bundles conservative and allows a discriminated rack', () => {
    expect(codes(product('Set Body Pump + Rack'))).not.toContain('BARBELL_SUPPORT');
    expect(reconcileTrainingResolution({ ...empty, resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY' }, product('Set Body Pump + Rack'), undefined, true).record.resolutionState).toBe('AMBIGUOUS');
    expect(codes(product('Set + Squat Rack'))).toContain('BARBELL_SUPPORT');
    expect(codes(product('Pack Discos + Jaula de Potencia'))).toContain('BARBELL_SUPPORT');
    expect(codes(product('Pack Smith + Banco + Discos Grip'))).toContain('GUIDED_BARBELL_SUPPORT');
    for (const name of ['Atril de Discos', 'Rack Horizontal Para Mancuernas', 'Mancuernas Ajustables + Rack', 'Rack Para Balones Medicinales', 'Rack Colgador Mat', 'Instalacion Jaula a la Pared', 'Set Barras Rectas Peso Fijo + Rack']) expect(codes(product(name))).not.toContain('BARBELL_SUPPORT');
  });
  it('requires specific pull-up evidence and preserves bodyweight support', () => {
    const categories = [{ categoryId: '319', name: 'Barras Pull Up & Push Up', trustClass: 'SEMANTIC_STRONG' as const }, { categoryId: '430', name: 'Barras Paralelas', trustClass: 'SEMANTIC_STRONG' as const }];
    const result = codes(product('Par Paralelas Triple Grip', { categories }));
    expect(result).not.toContain('PULL_UP');
    expect(result).toContain('BODYWEIGHT_SUPPORT');
    expect(codes(product('Barra Pull Ups Multigrip', { categories }))).toContain('PULL_UP');
    expect(codes(product('Implemento', { categories: [{ categoryId: '10', name: 'Barras de Dominadas', trustClass: 'SEMANTIC_STRONG' }] }))).toContain('PULL_UP');
  });
  it('rejects a preacher pad, preserves a dedicated machine and does not reject every pad token', () => {
    expect(codes(product('Preacher Pad Biceps Curl'))).not.toContain('BICEPS_CURL');
    expect(codes(product('Biceps Curl Machine', { productFamily: 'SELECTORIZED_MACHINE' }))).toContain('BICEPS_CURL');
    expect(codes(product('Biceps Curl Machine con pad ajustable', { productFamily: 'SELECTORIZED_MACHINE' }))).toContain('BICEPS_CURL');
  });
  it('requires independent Product family provenance for derivation', () => {
    expect(codes(product('Home Gym', { productFamily: 'CABLE_MACHINE' }))).not.toContain('CABLE_RESISTANCE');
    expect(codes(product('Home Gym', { productFamily: 'CABLE_MACHINE', productFamilyEvidence: [{ axis: 'PRODUCT_FAMILY', code: 'CABLE_MACHINE', sourceType: 'STRUCTURED_FEATURE', rawValue: 'Relación de cable y polea 2:1' }] }))).toContain('CABLE_RESISTANCE');
  });
  it('filters ACTIVE and explicitly forbidden deferred codes', () => {
    const finding = { matchedText: 'squat', reason: 'lexical' };
    expect(trainingOntologyGapFindings([{ ...finding, candidateCode: 'SQUAT' }, { ...finding, candidateCode: 'PULL_UP' }])).toEqual([]);
    expect(trainingOntologyGapFindings([{ ...finding, candidateCode: 'UNMODELED_CONCEPT' }])).toHaveLength(1);
    const r = reconcileTrainingResolution(empty, product('Squat Rack'), undefined, true).record;
    expect(r.resolutionState).toBe('SEMANTIC_COMPLETE');
    const accessory = reconcileTrainingResolution({ ...empty, resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY' }, product('Bulgarian Squat Accesorio Jaula', { productFamily: 'MACHINE_ATTACHMENT' }), undefined, true).record;
    expect(accessory).toMatchObject({ resolutionState: 'DATA_GAP', resolved: false, trainingFunctions: [] });
  });
  it.each([
    ['Heavy Rope', 'CABLE_RESISTANCE', 'FEATURE_NAME_CABLE_RESISTANCE_EXPLICIT_V2', 'STRUCTURED_FEATURE', '11', 'Material: cable de acero'],
    ['Equipo', 'CABLE_RESISTANCE', 'FEATURE_NAME_CABLE_RESISTANCE_EXPLICIT_V2', 'STRUCTURED_FEATURE', '11', 'Cable: 20 mm'],
    ['Accesorio Smith Machine', 'GUIDED_BARBELL_SUPPORT', 'NAME_GUIDED_BARBELL_SUPPORT_EXPLICIT_V2', 'NAME', 'NAME', 'smith'],
  ] as const)('publication independently rejects incompatible provenance for %s', (name, functionCode, ruleId, kind, sourceId, matchedText) => {
    const record: TrainingSemanticSnapshotV2Record = { ...empty, trainingFunctions: [{ functionCode, relationType: 'DIRECT', classificationConfidence: 'EXPLICIT', reviewState: 'AUTO', evidence: [{ ruleId, kind, sourceId, matchedText }] }] };
    expect(() => validateTrainingSemanticInvariants({ records: [record] }, undefined, new Map([[900001, product(name)]]))).toThrow();
  });
  it('rejects mixed-category provenance without specificity even without source input', () => {
    const record: TrainingSemanticSnapshotV2Record = { ...empty, exerciseCapabilities: [{ capabilityCode: 'PULL_UP', relationType: 'DIRECT', classificationConfidence: 'HIGH', reviewState: 'AUTO', evidence: [{ kind: 'TRUSTED_CATEGORY', sourceId: 'CATEGORY', matchedText: 'Barras Pull Up & Push Up', ruleId: 'CATEGORY_CATEGORY_PULL_UP_PUSH_UP_BARS_CLOSURE_V2' }] }] };
    expect(() => validateTrainingSemanticInvariants({ records: [record] })).toThrow('TRAINING_MIXED_CATEGORY_WITHOUT_SPECIFICITY');
  });
});

describe('P2.3C-FIX2 source classes', () => {
  it.each(['Tobillera para polea', 'Ankle strap cable', 'Agarre para polea', 'Agarre para polea con asiento', 'Handle para polea', 'Soga para polea', 'Rope para polea', 'Barra para polea', 'Asiento pasivo de polea', 'Pad para polea'])('keeps the sold passive cable part negative: %s', name => {
    const source = product(name, { productFamily: 'CABLE_MACHINE', features: [mechanism] });
    expect(codes(source)).not.toContain('CABLE_RESISTANCE');
    const result = reconcileTrainingResolution(empty, source, undefined, true);
    expect(result.record.resolutionState).toBe('VERIFIED_NO_APPLICABLE_CAPABILITY');
    expect(result.negativeEvidenceState).toBe('NEGATIVE_EVIDENCE_PRESENT');
  });
  it.each(['Accesorio Polea Alta Remo', 'Accesorio Polea con Asiento', 'Accesorio cable'])('does not use accessory wording as negative proof: %s', name => {
    const source = product(name, { productFamily: 'CABLE_MACHINE' });
    const classified = classifyTrainingSemanticProductV21(source);
    expect(classified.coverageStatus).toBe('INSUFFICIENT_EVIDENCE');
    expect(codes(source)).not.toContain('CABLE_RESISTANCE');
    const result = reconcileTrainingResolution({ ...empty, resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY' }, source, undefined, true);
    expect(result.record).toMatchObject({ resolutionState: 'DATA_GAP', resolved: false, trainingFunctions: [] });
    expect(result.negativeEvidenceState).toBe('NOT_REQUIRED');
    expect(result.record.resolutionEvidence?.some(e => e.kind === 'CLASSIFIER_NEGATIVE_RULE')).toBe(false);
    expect(() => validateTrainingSemanticInvariants({ records: [{ ...result.record, resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY', resolved: true }] }, undefined, new Map([[source.productId, source]]))).toThrow('TRAINING_UNPROVEN_CABLE_NEGATIVE');
  });
  it('keeps a loaded cable module unresolved without inventing a mechanism from load or dimensions', () => {
    const source = product('Polea Alta Remo Accesorio Jaula', { features: [
      { featureId: '12', featureName: 'Peso máximo de carga', value: '80 kg', trustClass: 'SEMANTIC' },
      { featureId: '48', featureName: 'Diámetro de manga', value: '50 mm', trustClass: 'SEMANTIC' },
      { featureId: '15', featureName: 'Dimensiones del producto armado', value: '93 x 85 x 213 cm', trustClass: 'TECHNICAL' },
    ] });
    expect(reconcileTrainingResolution(empty, source, undefined, true).record.resolutionState).toBe('DATA_GAP');
    expect(codes(source)).not.toContain('CABLE_RESISTANCE');
    expect(codes({ ...source, features: [...source.features, { ...mechanism, value: '1:1' }] })).toContain('CABLE_RESISTANCE');
    expect(codes({ ...source, features: [source.features[0]!] })).not.toContain('CABLE_RESISTANCE');
    expect(codes({ ...source, features: [source.features[2]!] })).not.toContain('CABLE_RESISTANCE');
  });
  it('requires barbell-support specificity while preserving bodyweight capabilities', () => {
    const source = product('Rack Pull Up / Dip', { productFamily: 'BODYWEIGHT_GYMNASTICS', categories: [
      { categoryId: '319', name: 'Barras Pull Up & Push Up', trustClass: 'SEMANTIC_STRONG' },
      { categoryId: '429', name: 'Barras de Dominadas', trustClass: 'SEMANTIC_STRONG' },
      { categoryId: '430', name: 'Barras Paralelas', trustClass: 'SEMANTIC_STRONG' },
    ] });
    expect(codes(source)).toEqual(expect.arrayContaining(['PULL_UP', 'DIP', 'BODYWEIGHT_SUPPORT']));
    expect(codes(source)).not.toContain('BARBELL_SUPPORT');
    expect(codes(product('Rack'))).not.toContain('BARBELL_SUPPORT');
    expect(codes(product('Rack', { features: [{ featureId: '12', featureName: 'Carga máxima para barra', value: '200 kg', trustClass: 'SEMANTIC' }] }))).toContain('BARBELL_SUPPORT');
  });
  it.each(['Squat Rack', 'Power Rack', 'Half Rack', 'Atril de Sentadillas', 'Jaula de Potencia', 'Wall Rack Plegable', 'Powerlifting Combo Rack'])('preserves discriminating own barbell support: %s', name => {
    expect(codes(product(name))).toContain('BARBELL_SUPPORT');
  });
  it.each(['Rack de almacenamiento', 'Rack de Mancuernas', 'Accesorio Power Rack'])('suppresses storage and host barbell support: %s', name => {
    expect(codes(product(name))).not.toContain('BARBELL_SUPPORT');
  });
});
