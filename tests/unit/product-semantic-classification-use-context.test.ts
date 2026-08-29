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

function usageFeature(value: string): ProductSemanticClassificationInputFeature {
  return { featureId: '1', featureName: 'Clasificación de Uso', value, trustClass: 'SEMANTIC' };
}

describe('USE_CONTEXT — one rule per tag', () => {
  it('HOME_GYM: EXPLICIT from the structured "Clasificación de Uso" feature (Hogar tier)', () => {
    const result = classifyProduct(input('Banco Regulable 3.0', { features: [usageFeature('USO REGULAR - HOGAR')] }));
    expect(result.useContexts).toContainEqual(expect.objectContaining({ code: 'HOME_GYM', confidence: 'EXPLICIT', ruleId: 'CTX_HOME_USE_CLASSIFICATION_V1' }));
  });

  it('HOME_GYM: STRONGLY_INFERRED from the "Máquinas Home Gym" trusted category when no structured feature is present', () => {
    const result = classifyProduct(input('Banco Regulable 3.0', { categories: [category('314', 'Máquinas Home Gym', 'SEMANTIC_STRONG')] }));
    expect(result.useContexts).toContainEqual(expect.objectContaining({ code: 'HOME_GYM', confidence: 'STRONGLY_INFERRED', ruleId: 'CTX_HOME_CATEGORY_V1' }));
  });

  it('HOME_GYM: STRONGLY_INFERRED from literal "Home Gym" in the name — including historical rows', () => {
    const result = classifyProduct(input('Máquina Home Gym ULTRA FZ410 68kg | Forza', { catalogPresence: 'historical_order_detail_only' }));
    expect(result.useContexts).toContainEqual(expect.objectContaining({ code: 'HOME_GYM', confidence: 'STRONGLY_INFERRED', ruleId: 'CTX_HOME_NAME_V1' }));
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('HOME_GYM: never inferred from mere consumer-suitability plausibility', () => {
    const result = classifyProduct(input('Kettlebell Acero 20kg | HWM®'));
    expect(result.useContexts.some((tag) => tag.code === 'HOME_GYM')).toBe(false);
  });

  it('SMALL_SPACE: literal "de Muro"/"Plegable"/"Pared"', () => {
    expect(classifyProduct(input('Power Rack de Muro Plegable | HWM')).useContexts).toContainEqual(expect.objectContaining({ code: 'SMALL_SPACE', confidence: 'EXPLICIT' }));
  });

  it('SMALL_SPACE: English "Wall" wording does not match (only the Spanish literal patterns do)', () => {
    const result = classifyProduct(input('Wall Crossover Black ZR Series | PROmachine'));
    expect(result.useContexts.some((tag) => tag.code === 'SMALL_SPACE')).toBe(false);
  });

  it('COMMERCIAL_GYM: EXPLICIT from the structured feature', () => {
    const result = classifyProduct(input('Trotadora GT3 Series | Obelix', { features: [usageFeature('USO INTENSIVO - COMERCIAL')] }));
    expect(result.useContexts).toContainEqual(expect.objectContaining({ code: 'COMMERCIAL_GYM', confidence: 'EXPLICIT', ruleId: 'CTX_COMMERCIAL_USE_CLASSIFICATION_V1' }));
  });

  it('COMMERCIAL_GYM: literal "Comercial" in the name', () => {
    expect(classifyProduct(input('Trotadora Comercial S1 Series LED | Obelix®')).useContexts).toContainEqual(expect.objectContaining({ code: 'COMMERCIAL_GYM' }));
  });

  it('COMMERCIAL_GYM: indoor-only high-traffic feature values fold in (no outdoor claim)', () => {
    const result = classifyProduct(input('Palmeta de Caucho 100x100cm', { features: [usageFeature('Tráfico alto - Uso en interiores')] }));
    expect(result.useContexts).toContainEqual(expect.objectContaining({ code: 'COMMERCIAL_GYM' }));
    expect(result.useContexts.some((tag) => tag.code === 'OUTDOOR_HIGH_TRAFFIC')).toBe(false);
  });

  it('COMMERCIAL_GYM: never inferred from machine family/type alone', () => {
    const result = classifyProduct(input('Trotadora Serie X | Obelix'));
    expect(result.primaryProductFamily?.code).toBe('CARDIO_MACHINE');
    expect(result.useContexts.some((tag) => tag.code === 'COMMERCIAL_GYM')).toBe(false);
  });

  it('SEMI_COMMERCIAL_STUDIO: structured feature only', () => {
    const result = classifyProduct(input('Power Rack Alpha | HWM®', { features: [usageFeature('USO INTENSIVO - SEMI PROFESIONAL')] }));
    expect(result.useContexts).toContainEqual(expect.objectContaining({ code: 'SEMI_COMMERCIAL_STUDIO', confidence: 'EXPLICIT' }));
  });

  it('SEMI_COMMERCIAL_STUDIO: never fires from historical rows (structured feature unavailable)', () => {
    const result = classifyProduct(input('Power Rack Alpha | HWM®', { catalogPresence: 'historical_order_detail_only', features: [usageFeature('USO INTENSIVO - SEMI PROFESIONAL')] }));
    expect(result.useContexts.some((tag) => tag.code === 'SEMI_COMMERCIAL_STUDIO')).toBe(false);
  });

  it('CLINICAL_RECOVERY: STRONGLY_INFERRED from the dedicated clinical-device category', () => {
    const result = classifyProduct(input('Cámara Hiperbárica ST801 1.5ATA | O2Life', { categories: [category('367', 'Cámaras Hiperbáricas', 'SEMANTIC_STRONG')] }));
    expect(result.useContexts).toContainEqual(expect.objectContaining({ code: 'CLINICAL_RECOVERY', confidence: 'STRONGLY_INFERRED' }));
  });

  it('OUTDOOR_HIGH_TRAFFIC: structured feature "interiores y exteriores"', () => {
    const result = classifyProduct(input('Palmeta de Caucho 50x50cm', { features: [usageFeature('Tráfico alto - Uso en interiores y exteriores')] }));
    expect(result.useContexts).toContainEqual(expect.objectContaining({ code: 'OUTDOOR_HIGH_TRAFFIC', confidence: 'EXPLICIT' }));
  });
});

describe('USE_CONTEXT — SMALL_SPACE only applies after non-product exclusion (Section 9)', () => {
  it('a non-product installation SKU mentioning "Pared" is excluded, not tagged SMALL_SPACE', () => {
    const result = classifyProduct(input('INSTALACION BARRA PARED FACIL', { productId: '902' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
    expect(result.useContexts).toEqual([]);
    expect(result.primaryProductFamily).toBeNull();
  });
});
