import { describe, expect, it } from 'vitest';
import { commercialProductOntologyRegistryVersionV3, getCommercialProductOntologyRegistry, computeCommercialProductOntologyRegistryHash } from '../../src/domain/commercial-product-ontology/index.js';
import { classifyProduct, classifyProducts, computeClassificationChecksum, type ProductSemanticClassificationInput } from '../../src/domain/product-semantic-classification/index.js';

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

describe('Non-product exclusion (Section 5)', () => {
  it('excludes all 9 known non-product productIds, before any semantic rule runs', () => {
    const knownExcludedIds = ['444', '505', '554', '555', '556', '557', '558', '902', '903'];
    for (const productId of knownExcludedIds) {
      const result = classifyProduct(input('Servicio de armado tipo A-10', { productId }));
      expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
      expect(result.exclusionReason).not.toBeNull();
      expect(result.matchedExclusionRule).toBe('NON_PRODUCT_KNOWN_ID_V1');
      expect(result.primaryProductFamily).toBeNull();
      expect(result.disciplines).toEqual([]);
      expect(result.useContexts).toEqual([]);
    }
  });

  it('excludes by normalized-name pattern even for an id not in the known list', () => {
    const result = classifyProduct(input('INSTALACION JAULA A LA PARED', { productId: '999001' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
    expect(result.matchedExclusionRule).toBe('NON_PRODUCT_NAME_PATTERN_V1');
  });

  it('does not exclude a legitimate product whose description merely mentions "servicio"', () => {
    const result = classifyProduct(input('Cinturón de Levantamiento con Servicio Postventa Incluido', { productId: '999002' }));
    expect(result.classificationStatus).not.toBe('EXCLUDED_NON_PRODUCT');
  });

  it('EXCLUDED_NON_PRODUCT is distinct from OTHER: excluded rows are never classified as OTHER', () => {
    const excluded = classifyProduct(input('Servicio vendedor Pesas Chile', { productId: '444' }));
    const other = classifyProduct(input('AbMat 1.0 | HWM®'));
    expect(excluded.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
    expect(other.classificationStatus).toBe('OTHER');
    expect(excluded.classificationStatus).not.toBe(other.classificationStatus);
  });
});

describe('Historical product policy (Section 12)', () => {
  it('PRODUCT_FAMILY: classifiable from name alone on a historical row', () => {
    const result = classifyProduct(
      input('Discos Powerlifting Chromed Steel 20kg (Par) | XMASTER', { catalogPresence: 'historical_order_detail_only', categories: [], features: [] }),
    );
    expect(result.primaryProductFamily?.code).toBe('WEIGHT_PLATE');
    expect(result.classificationStatus).toBe('PARTIALLY_CLASSIFIED');
  });

  it('PRODUCT_FAMILY: an ambiguous historical name stays OTHER rather than guessed, even with a category vote that would apply to a current-catalog row', () => {
    const result = classifyProduct(
      input('Set 20kg Maletín Cast Iron', {
        catalogPresence: 'historical_order_detail_only',
        categories: [{ categoryId: '273', name: 'Set de Mancuernas', trustClass: 'SEMANTIC_STRONG' }],
      }),
    );
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('DISCIPLINE requires explicit name evidence on historical rows', () => {
    const result = classifyProduct(
      input('Discos Powerlifting Chromed Steel 20kg (Par) | XMASTER', { catalogPresence: 'historical_order_detail_only' }),
    );
    expect(result.disciplines).toContainEqual(expect.objectContaining({ code: 'POWERLIFTING' }));
  });

  it('USE_CONTEXT requires explicit name evidence on historical rows — a category-only signal never fires', () => {
    const result = classifyProduct(
      input('Banco Regulable 3.0', {
        catalogPresence: 'historical_order_detail_only',
        categories: [{ categoryId: '314', name: 'Máquinas Home Gym', trustClass: 'SEMANTIC_STRONG' }],
      }),
    );
    expect(result.useContexts.some((tag) => tag.code === 'HOME_GYM')).toBe(false);
  });

  it('missing metadata is UNKNOWN, not negative evidence: no warnings/errors for an empty-evidence historical row', () => {
    const result = classifyProduct(input('Pack Grip 105kg | PROmachine', { catalogPresence: 'historical_order_detail_only' }));
    expect(result.classificationStatus).toBe('OTHER');
    expect(result.primaryProductFamily).toBeNull();
    expect(result.disciplines).toEqual([]);
    expect(result.useContexts).toEqual([]);
  });

  it('PARTIALLY_CLASSIFIED vs CLASSIFIED: identical name-derived family, different catalogPresence', () => {
    const current = classifyProduct(input('Barra Olímpica 20kg Training | HWM®', { catalogPresence: 'current_catalog' }));
    const historical = classifyProduct(input('Barra Olímpica 20kg Training | HWM®', { catalogPresence: 'historical_order_detail_only' }));
    expect(current.classificationStatus).toBe('CLASSIFIED');
    expect(historical.classificationStatus).toBe('PARTIALLY_CLASSIFIED');
    expect(current.primaryProductFamily?.code).toBe(historical.primaryProductFamily?.code);
  });
});

describe('Evidence provenance (Section 15, Section 16)', () => {
  it('every emitted tag carries a stable ruleId that also appears in the flattened evidence list', () => {
    const result = classifyProduct(input('Barra Olímpica 20kg Training | HWM®'));
    expect(result.primaryProductFamily?.ruleId).toBe('PF_BARBELL_NAME_V1');
    const evidenceForFamily = result.evidence.find((entry) => entry.axis === 'PRODUCT_FAMILY' && entry.code === 'BARBELL');
    expect(evidenceForFamily).toMatchObject({ ruleId: 'PF_BARBELL_NAME_V1', sourceType: 'NAME_TEXT', sourceId: 'NAME' });
    expect(evidenceForFamily?.rawValue).toBe('Barra Olímpica 20kg Training | HWM®');
  });

  it('evidence is bounded: normalizedValue never exceeds a reasonable length derived from the actual input (no free-text excerpt injection)', () => {
    const result = classifyProduct(input('Cinturón de Levantamiento Heavy Duty | HWM'));
    for (const entry of result.evidence) {
      expect(entry.normalizedValue.length).toBeLessThanOrEqual(entry.rawValue.length + 8);
    }
  });

  it('registryVersion and registryHash on every result match the canonical v3 registry (A00.3.5: classifier consumes v3)', () => {
    const registry = getCommercialProductOntologyRegistry(commercialProductOntologyRegistryVersionV3);
    const expectedHash = computeCommercialProductOntologyRegistryHash(registry);
    const result = classifyProduct(input('Kettlebell Acero 20kg | HWM®'));
    expect(result.registryVersion).toBe('commercial-product-ontology-v3');
    expect(result.registryVersion).toBe(registry.registryVersion);
    expect(result.registryHash).toBe(expectedHash);
  });
});

describe('Determinism (Section 27)', () => {
  it('classifying the same input twice produces byte-identical results', () => {
    const productInput = input('Trotadora Comercial S1 Series LED | Obelix®', { features: [{ featureId: '1', featureName: 'Clasificación de Uso', value: 'USO INTENSIVO - COMERCIAL', trustClass: 'SEMANTIC' }] });
    const first = classifyProduct(productInput);
    const second = classifyProduct(productInput);
    expect(first).toEqual(second);
  });

  it('the checksum over a run is stable across repeated runs of the same input set, and changes if the input set changes', () => {
    const inputs = [input('Barra Olímpica 20kg'), input('Banco Regulable 3.0'), input('Kettlebell Acero 20kg')];
    const runA = classifyProducts(inputs);
    const runB = classifyProducts(inputs);
    expect(computeClassificationChecksum(runA)).toBe(computeClassificationChecksum(runB));

    const differentInputs = [...inputs, input('Cinturón de Levantamiento Heavy Duty')];
    const runC = classifyProducts(differentInputs);
    expect(computeClassificationChecksum(runC)).not.toBe(computeClassificationChecksum(runA));
  });

  it('the checksum is independent of input array order', () => {
    const a = input('Barra Olímpica 20kg', { productId: '10' });
    const b = input('Banco Regulable 3.0', { productId: '20' });
    const runForward = classifyProducts([a, b]);
    const runBackward = classifyProducts([b, a]);
    expect(computeClassificationChecksum(runForward)).toBe(computeClassificationChecksum(runBackward));
  });
});
