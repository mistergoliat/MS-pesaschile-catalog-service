import { describe, expect, it } from 'vitest';
import {
  commercialProductOntologyRegistryVersion,
  commercialProductOntologyRegistryVersionV2,
  commercialProductOntologyRegistryVersionV3,
  computeCommercialProductOntologyRegistryHash,
  getCommercialProductOntologyRegistry,
  getCommercialProductOntologyRegistryV2,
  getCommercialProductOntologyRegistryV3,
  getOntologyTag,
} from '../../src/domain/commercial-product-ontology/index.js';
import { classifyProduct, classifyProducts, type ProductSemanticClassificationInput } from '../../src/domain/product-semantic-classification/index.js';
import { resolveProductSemanticInputPaths } from '../../scripts/product-semantic-classification/lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from '../../scripts/product-semantic-classification/lib/load-input.js';

const EXPECTED_OTHER_TO_CABLE_MACHINE = ['1207', '1444', '1445', '1450', '1451'];
const EXPECTED_SECONDARY_CABLE_MACHINE_ADDITIONS = ['1021', '1430', '1922', '2134', '2182'];
const EXPECTED_CATEGORY_290_CABLE_PRODUCTS = [
  '176',
  '288',
  '494',
  '495',
  '534',
  '1021',
  '1187',
  '1207',
  '1427',
  '1429',
  '1430',
  '1444',
  '1445',
  '1450',
  '1451',
  '1455',
  '1516',
  '1517',
  '1921',
  '1922',
  '1974',
  '2134',
  '2139',
  '2142',
  '2182',
];

let nextId = 500000;
function input(productName: string, overrides: Partial<Omit<ProductSemanticClassificationInput, 'productName'>> = {}): ProductSemanticClassificationInput {
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

describe('commercial-product-ontology-v3 guarded CABLE_MACHINE rule', () => {
  it('coexists with immutable v1/v2 and changes only the CABLE_MACHINE tag metadata', () => {
    const v1 = getCommercialProductOntologyRegistry(commercialProductOntologyRegistryVersion);
    const v2 = getCommercialProductOntologyRegistryV2();
    const v3 = getCommercialProductOntologyRegistryV3();

    expect(v1.registryVersion).toBe('commercial-product-ontology-v1');
    expect(v2.registryVersion).toBe('commercial-product-ontology-v2');
    expect(v3.registryVersion).toBe('commercial-product-ontology-v3');
    expect(v3.globalRules).toBe(v2.globalRules);
    expect(v3.tags).not.toBe(v2.tags);
    expect(computeCommercialProductOntologyRegistryHash(v1)).not.toBe(computeCommercialProductOntologyRegistryHash(v3));
    expect(computeCommercialProductOntologyRegistryHash(v2)).not.toBe(computeCommercialProductOntologyRegistryHash(v3));
    expect(computeCommercialProductOntologyRegistryHash(v3)).toBe(computeCommercialProductOntologyRegistryHash(getCommercialProductOntologyRegistry(commercialProductOntologyRegistryVersionV3)));

    expect(getOntologyTag('PRODUCT_FAMILY', 'CABLE_MACHINE', commercialProductOntologyRegistryVersion)?.allowedEvidenceSources).toEqual(['NAME_TEXT']);
    expect(getOntologyTag('PRODUCT_FAMILY', 'CABLE_MACHINE', commercialProductOntologyRegistryVersionV2)?.allowedEvidenceSources).toEqual(['NAME_TEXT']);
    expect(getOntologyTag('PRODUCT_FAMILY', 'CABLE_MACHINE', commercialProductOntologyRegistryVersionV3)).toMatchObject({
      allowedEvidenceSources: ['NAME_TEXT', 'STRUCTURED_FEATURE'],
      confidencePolicy: { allowedConfidenceLevels: ['EXPLICIT', 'STRONGLY_INFERRED'] },
    });
  });

  it('keeps FREE_TEXT_DESCRIPTION forbidden under v3', () => {
    const v3 = getCommercialProductOntologyRegistryV3();
    expect(v3.globalRules.forbiddenEvidenceSourceTypes).toContain('FREE_TEXT_DESCRIPTION');
  });

  it('category 290 alone is insufficient', () => {
    const result = classifyProduct(
      input('Producto Sin Nombre Claro', {
        categories: [{ categoryId: '290', name: 'Máquinas con Poleas', trustClass: 'SEMANTIC_STRONG' }],
      }),
    );
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('structured cable feature alone is insufficient without trusted category 290', () => {
    const result = classifyProduct(
      input('Producto Sin Nombre Claro', {
        features: [{ featureId: '65', featureName: 'Relación de cable y polea', value: '2:1', trustClass: 'SEMANTIC' }],
      }),
    );
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('category 290 plus an accepted structured feature yields guarded CABLE_MACHINE provenance', () => {
    const result = classifyProduct(
      input('Producto Sin Nombre Claro', {
        categories: [{ categoryId: '290', name: 'Máquinas con Poleas', trustClass: 'SEMANTIC_STRONG' }],
        features: [{ featureId: '65', featureName: 'Relación de cable y polea', value: '2:1', trustClass: 'SEMANTIC' }],
      }),
    );
    expect(result.primaryProductFamily).toMatchObject({
      code: 'CABLE_MACHINE',
      confidence: 'STRONGLY_INFERRED',
      ruleId: 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3',
    });
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        axis: 'PRODUCT_FAMILY',
        code: 'CABLE_MACHINE',
        ruleId: 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3',
        sourceType: 'STRUCTURED_FEATURE',
        sourceId: '65',
      }),
    );
  });

  it('category 451 does not activate the guarded rule', () => {
    const result = classifyProduct(
      input('Producto Sin Nombre Claro', {
        categories: [{ categoryId: '451', name: 'Accesorios de Polea', trustClass: 'SEMANTIC_STRONG' }],
        features: [{ featureId: '65', featureName: 'Relación de cable y polea', value: '2:1', trustClass: 'SEMANTIC' }],
      }),
    );
    expect(result.primaryProductFamily?.code).toBe('MACHINE_ATTACHMENT');
    expect(result.primaryProductFamily?.ruleId).toBe('PF_MACHINE_ATTACHMENT_CATEGORY_V1');
    expect(result.secondaryProductFamilies.some((tag) => tag.ruleId === 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3')).toBe(false);
  });

  it('produces deterministic byte-identical output for the same guarded input', () => {
    const productInput = input('Producto Sin Nombre Claro', {
      categories: [{ categoryId: '290', name: 'Máquinas con Poleas', trustClass: 'SEMANTIC_STRONG' }],
      features: [{ featureId: '34', featureName: 'Pila de Stack', value: '117 kg', trustClass: 'SEMANTIC' }],
    });
    expect(classifyProduct(productInput)).toEqual(classifyProduct(productInput));
  });

  it('recovers the documented 2134 hybrid and leaves 2133 untouched', async () => {
    const { inputs } = await loadProductSemanticClassificationInputs(await resolveProductSemanticInputPaths());
    const byId = new Map(inputs.map((productInput) => [productInput.productId, productInput]));

    const result2133 = classifyProduct(byId.get('2133')!);
    expect(result2133.primaryProductFamily?.code).toBe('PLATE_LOADED_MACHINE');
    expect(result2133.secondaryProductFamilies.map((tag) => tag.code)).toEqual([]);

    const result2134 = classifyProduct(byId.get('2134')!);
    expect(result2134.primaryProductFamily?.code).toBe('PLATE_LOADED_MACHINE');
    expect(result2134.secondaryProductFamilies).toContainEqual(
      expect.objectContaining({
        code: 'CABLE_MACHINE',
        confidence: 'STRONGLY_INFERRED',
        ruleId: 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3',
      }),
    );
    expect(result2134.evidence).toContainEqual(
      expect.objectContaining({
        axis: 'PRODUCT_FAMILY',
        code: 'CABLE_MACHINE',
        ruleId: 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3',
        sourceType: 'STRUCTURED_FEATURE',
      }),
    );
  });

  it('changes exactly the five expected OTHER rows into primary CABLE_MACHINE and the five expected PLATE_LOADED_MACHINE rows into hybrids', async () => {
    const { inputs } = await loadProductSemanticClassificationInputs(await resolveProductSemanticInputPaths());
    const results = classifyProducts(inputs);

    const otherToCable = results
      .filter((result) => EXPECTED_OTHER_TO_CABLE_MACHINE.includes(result.productId))
      .map((result) => ({ productId: result.productId, status: result.classificationStatus, primary: result.primaryProductFamily?.code, secondaries: result.secondaryProductFamilies.map((tag) => tag.code) }))
      .sort((a, b) => a.productId.localeCompare(b.productId, undefined, { numeric: true }));
    expect(otherToCable).toEqual(
      EXPECTED_OTHER_TO_CABLE_MACHINE.map((productId) => ({
        productId,
        status: 'CLASSIFIED',
        primary: 'CABLE_MACHINE',
        secondaries: [],
      })),
    );

    const hybrids = results
      .filter((result) => EXPECTED_SECONDARY_CABLE_MACHINE_ADDITIONS.includes(result.productId))
      .map((result) => ({ productId: result.productId, status: result.classificationStatus, primary: result.primaryProductFamily?.code, secondaries: result.secondaryProductFamilies.map((tag) => tag.code).sort() }))
      .sort((a, b) => a.productId.localeCompare(b.productId, undefined, { numeric: true }));
    expect(hybrids).toEqual(
      EXPECTED_SECONDARY_CABLE_MACHINE_ADDITIONS.map((productId) => ({
        productId,
        status: 'CLASSIFIED',
        primary: 'PLATE_LOADED_MACHINE',
        secondaries: ['CABLE_MACHINE'],
      })),
    );
  });

  it('re-runs the full category-290 audit with zero false positives and zero NEEDS_REVIEW', async () => {
    const { inputs } = await loadProductSemanticClassificationInputs(await resolveProductSemanticInputPaths());
    const category290Inputs = inputs.filter((productInput) => productInput.categories.some((category) => category.categoryId === '290'));
    expect(category290Inputs).toHaveLength(26);

    const resultsById = new Map(classifyProducts(category290Inputs).map((result) => [result.productId, result]));
    const productsWithCableSemantics = category290Inputs
      .filter((productInput) => {
        const result = resultsById.get(productInput.productId)!;
        return result.primaryProductFamily?.code === 'CABLE_MACHINE' || result.secondaryProductFamilies.some((tag) => tag.code === 'CABLE_MACHINE');
      })
      .map((productInput) => productInput.productId)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const primaryCableCount = [...resultsById.values()].filter((result) => result.primaryProductFamily?.code === 'CABLE_MACHINE').length;
    const hybridCableCount = [...resultsById.values()].filter((result) => result.primaryProductFamily?.code === 'PLATE_LOADED_MACHINE' && result.secondaryProductFamilies.some((tag) => tag.code === 'CABLE_MACHINE')).length;
    const needsReview = [...resultsById.values()].filter((result) => result.classificationStatus === 'NEEDS_REVIEW');

    expect(productsWithCableSemantics).toEqual(EXPECTED_CATEGORY_290_CABLE_PRODUCTS);
    expect(primaryCableCount).toBe(20);
    expect(hybridCableCount).toBe(5);
    expect(resultsById.get('2133')?.secondaryProductFamilies).toEqual([]);
    expect(needsReview).toEqual([]);
  });

  it('preserves zero false positives from category 451 and the full-catalog status counts expected for v3', async () => {
    const { inputs } = await loadProductSemanticClassificationInputs(await resolveProductSemanticInputPaths());
    const results = classifyProducts(inputs);
    const counts = { CLASSIFIED: 0, PARTIALLY_CLASSIFIED: 0, OTHER: 0, EXCLUDED_NON_PRODUCT: 0, NEEDS_REVIEW: 0 };
    for (const result of results) counts[result.classificationStatus] += 1;

    const resultsById = new Map(results.map((result) => [result.productId, result]));
    const category451Inputs = inputs.filter((productInput) => productInput.categories.some((category) => category.categoryId === '451'));
    const falsePositive451 = category451Inputs.filter((productInput) => {
      const result = resultsById.get(productInput.productId)!;
      return result.primaryProductFamily?.ruleId === 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3' || result.secondaryProductFamilies.some((tag) => tag.ruleId === 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3');
    });

    expect(falsePositive451).toEqual([]);
    expect(counts).toEqual({
      CLASSIFIED: 1281,
      PARTIALLY_CLASSIFIED: 400,
      OTHER: 317,
      EXCLUDED_NON_PRODUCT: 13,
      NEEDS_REVIEW: 0,
    });
  });
});
