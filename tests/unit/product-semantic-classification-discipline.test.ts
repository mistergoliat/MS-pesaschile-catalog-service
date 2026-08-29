import { describe, expect, it } from 'vitest';
import { classifyProduct, type ProductSemanticClassificationInput, type ProductSemanticClassificationInputCategory, type ProductSemanticClassificationInputFeature } from '../../src/domain/product-semantic-classification/index.js';

let nextId = 1;
function input(
  productName: string,
  overrides: Partial<Omit<ProductSemanticClassificationInput, 'productName'>> = {},
): ProductSemanticClassificationInput {
  nextId += 1;
  return {
    productId: String(nextId),
    productName,
    catalogPresence: 'current_catalog',
    activeStatus: true,
    categories: [],
    features: [],
    ...overrides,
  };
}

function category(categoryId: string, name: string, trustClass: ProductSemanticClassificationInputCategory['trustClass']): ProductSemanticClassificationInputCategory {
  return { categoryId, name, trustClass };
}

function feature(featureId: string, featureName: string, value: string, trustClass: ProductSemanticClassificationInputFeature['trustClass'] = 'SEMANTIC'): ProductSemanticClassificationInputFeature {
  return { featureId, featureName, value, trustClass };
}

describe('DISCIPLINE — one rule per tag', () => {
  it('CROSSFIT: literal name only', () => {
    const result = classifyProduct(input('CROP TOP CROSSFIT HATERS ROSADO | KILO'));
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'CROSSFIT', confidence: 'EXPLICIT', ruleId: 'DISC_CROSSFIT_NAME_V1' }));
  });

  it('CROSSFIT: the LEGACY "CrossFit HWM®" category alone must never vote', () => {
    const result = classifyProduct(input('Pack Genérico', { categories: [category('410', 'CrossFit HWM®', 'LEGACY')] }));
    expect(result.disciplines.some((tag) => tag.code === 'CROSSFIT')).toBe(false);
  });

  it('HYROX: trusted category', () => {
    const result = classifyProduct(input('Soga de Trepa 7mt | HWM®', { categories: [category('493', 'HYROX', 'SEMANTIC_STRONG')] }));
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'HYROX', confidence: 'EXPLICIT', ruleId: 'DISC_HYROX_CATEGORY_V1' }));
  });

  it('POWERLIFTING: literal name', () => {
    const result = classifyProduct(input('Discos Powerlifting Chromed Steel 20kg (Par) | XMASTER'));
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'POWERLIFTING', confidence: 'EXPLICIT' }));
  });

  it('CALISTHENICS: STRONGLY_INFERRED from family=BODYWEIGHT_GYMNASTICS when no explicit name/category evidence exists', () => {
    const result = classifyProduct(input('Par Anillas Olímpicas de Gimnasia Madera | HWM®'));
    expect(result.primaryProductFamily?.code).toBe('BODYWEIGHT_GYMNASTICS');
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'CALISTHENICS', confidence: 'STRONGLY_INFERRED', ruleId: 'DISC_CALISTHENICS_FAMILY_V1' }));
  });

  it('CALISTHENICS: EXPLICIT via literal name, even without the BODYWEIGHT_GYMNASTICS family', () => {
    const result = classifyProduct(input('Programa de Calistenia Avanzada'));
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'CALISTHENICS', confidence: 'EXPLICIT', ruleId: 'DISC_CALISTHENICS_NAME_V1' }));
  });

  it('CARDIO_ENDURANCE: STRONGLY_INFERRED purely from family=CARDIO_MACHINE (its only evidence source)', () => {
    const result = classifyProduct(input('Trotadora Comercial S1 Series LED | Obelix®'));
    expect(result.primaryProductFamily?.code).toBe('CARDIO_MACHINE');
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'CARDIO_ENDURANCE', confidence: 'STRONGLY_INFERRED', ruleId: 'DISC_CARDIO_ENDURANCE_FAMILY_V1' }));
  });

  it('YOGA_PILATES: literal name', () => {
    const result = classifyProduct(input('Mat de Yoga TPE C/Colgador 173x61cm 8mm | Rising'));
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'YOGA_PILATES', confidence: 'EXPLICIT' }));
  });

  it('BOXING_MMA: literal name', () => {
    const result = classifyProduct(input('Par Guantes de Boxeo | Rising'));
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'BOXING_MMA', confidence: 'EXPLICIT' }));
  });

  it('REHABILITATION: STRONGLY_INFERRED from family=RECOVERY_TOOL + dedicated clinical-device category', () => {
    const result = classifyProduct(
      input('Cámara Hiperbárica ST801 1.5ATA | O2Life', { categories: [category('367', 'Cámaras Hiperbáricas', 'SEMANTIC_STRONG')] }),
    );
    expect(result.primaryProductFamily?.code).toBe('RECOVERY_TOOL');
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'REHABILITATION', confidence: 'STRONGLY_INFERRED', ruleId: 'DISC_REHABILITATION_FAMILY_CATEGORY_V1' }));
  });

  it('REHABILITATION: does not fire on a generic recovery tool without the clinical-device category', () => {
    const result = classifyProduct(input('Foam Roller 30cm | HWM®'));
    expect(result.primaryProductFamily?.code).toBe('RECOVERY_TOOL');
    expect(result.disciplines.some((tag) => tag.code === 'REHABILITATION')).toBe(false);
  });
});

describe('DISCIPLINE — WEIGHTLIFTING must never be emitted (Section 8, Section 11)', () => {
  it('a bar/plate with a "Categoría: Olímpico" SEMANTIC feature never produces a discipline tag', () => {
    const result = classifyProduct(
      input('Barra Olímpica 15kg 220cm Eco Serie | PROmachine', {
        features: [feature('2', 'Categoría', 'Olímpico', 'SEMANTIC')],
      }),
    );
    expect(result.disciplines).toEqual([]);
    expect(result.disciplines.some((tag) => tag.code === 'WEIGHTLIFTING')).toBe(false);
  });

  it('"Preolímpico" also never produces a discipline tag', () => {
    const result = classifyProduct(input('Set 20kg Maletín Cast Iron', { features: [feature('2', 'Categoría', 'Preolímpico', 'SEMANTIC')] }));
    expect(result.disciplines).toEqual([]);
  });

  it('no code path in this module can ever reference the string "WEIGHTLIFTING"', () => {
    // Static guard: the discipline rule set never checks featureName === 'Categoría' for anything.
    const allProducts = ['Barra Olímpica 20kg', 'Discos Olímpicos 20kg', 'Pack 100kg Eco Series'];
    for (const name of allProducts) {
      const result = classifyProduct(input(name, { features: [feature('2', 'Categoría', 'Olímpico y Preolímpico', 'SEMANTIC')] }));
      expect(result.disciplines.map((tag) => tag.code)).not.toContain('WEIGHTLIFTING');
    }
  });
});

describe('DISCIPLINE — feature trust gating (Section 11)', () => {
  it('a NOISE-trust feature never votes, even if it happened to be named "Clasificación de Uso"', () => {
    const result = classifyProduct(input('Producto Cualquiera', { features: [feature('1', 'Clasificación de Uso', 'USO INTENSIVO - COMERCIAL', 'NOISE')] }));
    expect(result.useContexts.some((tag) => tag.code === 'COMMERCIAL_GYM')).toBe(false);
  });
});
