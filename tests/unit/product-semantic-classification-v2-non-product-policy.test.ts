// CUSTOMER-INTELLIGENCE-R2-A00.3.1 - non-product universe policy correction.
//
// Verifies the commercial-product-ontology-v2 registry (v1 unchanged, only nonProductExclusion
// differs) and the classifier's consumption of it: R-*/A-*/M-* service rows, the two administrative
// fee rows, anchored-pattern safety (no broad "^servicio\b" / ".*r-.*" catch-alls), and that real
// physical products are completely unaffected.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  commercialProductOntologyRegistryVersion,
  commercialProductOntologyRegistryVersionV2,
  computeCommercialProductOntologyRegistryHash,
  getCommercialProductOntologyRegistry,
  getCommercialProductOntologyRegistryV2,
  getOntologyTagsForAxis,
} from '../../src/domain/commercial-product-ontology/index.js';
import { classifyProduct, classifyProducts, normalizeProductName, type ProductSemanticClassificationInput } from '../../src/domain/product-semantic-classification/index.js';
import { parseCsvRecords } from '../../scripts/product-semantic-classification/lib/csv.js';
import { resolveProductSemanticInputPaths } from '../../scripts/product-semantic-classification/lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from '../../scripts/product-semantic-classification/lib/load-input.js';

const V1_HASH = '32d0b7f4a9a87ed5b1316b63f07af452d2f8a6b4ed012be3aa53729d149aefb9';

let nextId = 1;
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

describe('Registry v2 - invariants (Section 13)', () => {
  it('v1 is byte-for-byte unchanged: same hash as before A00.3.1', () => {
    const v1 = getCommercialProductOntologyRegistry();
    expect(v1.registryVersion).toBe('commercial-product-ontology-v1');
    expect(computeCommercialProductOntologyRegistryHash(v1)).toBe(V1_HASH);
  });

  it('v2 hash differs from v1 and is deterministic across repeated calls', () => {
    const v1 = getCommercialProductOntologyRegistry();
    const v2 = getCommercialProductOntologyRegistryV2();
    const hashV1 = computeCommercialProductOntologyRegistryHash(v1);
    const hashV2First = computeCommercialProductOntologyRegistryHash(v2);
    const hashV2Second = computeCommercialProductOntologyRegistryHash(getCommercialProductOntologyRegistry(commercialProductOntologyRegistryVersionV2));
    expect(hashV2First).not.toBe(hashV1);
    expect(hashV2First).toBe(hashV2Second);
  });

  it('v2 has identical tag counts to v1: 21 PRODUCT_FAMILY + OTHER, 8 DISCIPLINE, 6 USE_CONTEXT, 35 real tags', () => {
    const v2 = getCommercialProductOntologyRegistryV2();
    expect(v2.tags.filter((t) => !t.residual)).toHaveLength(35);
    expect(v2.tags).toHaveLength(36);
    expect(getOntologyTagsForAxis('PRODUCT_FAMILY').filter((t) => !t.residual)).toHaveLength(21);
    expect(getOntologyTagsForAxis('DISCIPLINE')).toHaveLength(8);
    expect(getOntologyTagsForAxis('USE_CONTEXT')).toHaveLength(6);
  });

  it('v1 and v2 literally share the same tag/axis objects (strongest possible "tags unchanged" guarantee)', () => {
    const v1 = getCommercialProductOntologyRegistry();
    const v2 = getCommercialProductOntologyRegistryV2();
    expect(v2.tags).toBe(v1.tags);
    expect(v2.axes).toBe(v1.axes);
    expect(v2.deferredOrDroppedAxes).toBe(v1.deferredOrDroppedAxes);
  });

  it('v2 category trust gate, evidence policy, and historical policy are unchanged from v1', () => {
    const v1 = getCommercialProductOntologyRegistry();
    const v2 = getCommercialProductOntologyRegistryV2();
    expect(v2.globalRules.categoryTrustGate).toEqual(v1.globalRules.categoryTrustGate);
    expect(v2.globalRules.allowedEvidenceSourceTypes).toEqual(v1.globalRules.allowedEvidenceSourceTypes);
    expect(v2.globalRules.forbiddenEvidenceSourceTypes).toEqual(v1.globalRules.forbiddenEvidenceSourceTypes);
    expect(v2.globalRules.historicalPolicy).toEqual(v1.globalRules.historicalPolicy);
  });

  it('only nonProductExclusion differs between v1 and v2', () => {
    const v1 = getCommercialProductOntologyRegistry();
    const v2 = getCommercialProductOntologyRegistryV2();
    expect(v2.globalRules.nonProductExclusion).not.toEqual(v1.globalRules.nonProductExclusion);
  });

  it('WEIGHTLIFTING remains absent under v2', () => {
    const v2 = getCommercialProductOntologyRegistryV2();
    expect(v2.tags.some((t) => t.code === 'WEIGHTLIFTING')).toBe(false);
  });

  it('v2 registry is immutable, same as v1', () => {
    const v2 = getCommercialProductOntologyRegistryV2();
    expect(Object.isFrozen(v2)).toBe(true);
    expect(() => {
      (v2.globalRules.nonProductExclusion.knownExcludedProductIds as unknown as string[]).push('999999');
    }).toThrow();
  });
});

describe('Non-product exclusion patterns are anchored and narrow (Section 6/12)', () => {
  it('every v2 pattern is anchored to the start of the normalized name', () => {
    const v2 = getCommercialProductOntologyRegistryV2();
    for (const pattern of v2.globalRules.nonProductExclusion.normalizedNameExclusionPatterns) {
      expect(pattern.startsWith('^'), `pattern "${pattern}" must be anchored`).toBe(true);
    }
  });

  it('no pattern is a forbidden generic catch-all like ".*r-.*" or a bare "^servicio\\b"', () => {
    const v2 = getCommercialProductOntologyRegistryV2();
    const patterns = v2.globalRules.nonProductExclusion.normalizedNameExclusionPatterns;
    expect(patterns).not.toContain('.*r-.*');
    expect(patterns).not.toContain('^servicio\\b');
  });
});

describe('R-* review/repair service exclusion', () => {
  it('excludes "Revision R-10" style rows purely by name pattern (a productId not in the known-id list)', () => {
    const result = classifyProduct(input('Revision R-10', { productId: '999100' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
    expect(result.matchedExclusionRule).toBe('NON_PRODUCT_NAME_PATTERN_V1');
  });

  it('excludes all 4 newly-confirmed ids 550-553', () => {
    for (const [productId, name] of [
      ['550', 'Revision R-10'],
      ['551', 'Revision R-20'],
      ['552', 'Revision R-30'],
      ['553', 'Revision R-40'],
    ] as const) {
      const result = classifyProduct(input(name, { productId }));
      expect(result.classificationStatus, `${productId} (${name})`).toBe('EXCLUDED_NON_PRODUCT');
    }
  });

  it('also excludes the "reparacion r-*" vocabulary variant, even though not currently observed in the catalog', () => {
    const result = classifyProduct(input('Reparacion R-15', { productId: '999101' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });
});

describe('A-* assembly/installation service exclusion', () => {
  it('excludes "Servicio de armado tipo A-10" style rows', () => {
    const result = classifyProduct(input('Servicio de armado tipo A-10', { productId: '554' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });

  it('excludes "Servicio tipo A-PC" (a non-numeric A-* tier code)', () => {
    const result = classifyProduct(input('Servicio tipo A-PC', { productId: '558' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });

  it('also excludes the bare "armado tipo a-*" vocabulary variant without a "servicio de" prefix', () => {
    const result = classifyProduct(input('Armado tipo A-50', { productId: '999102' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });

  it('does not exclude a legitimate equipment SKU merely because its name contains "A-" somewhere', () => {
    const result = classifyProduct(input('Barra Olimpica A-100 Pro Series | KONG', { productId: '999103' }));
    expect(result.classificationStatus).not.toBe('EXCLUDED_NON_PRODUCT');
    expect(result.primaryProductFamily?.code).toBe('BARBELL');
  });
});

describe('M-* maintenance service exclusion (POLICY_ONLY_NOT_OBSERVED)', () => {
  it('excludes "Mantencion M-10" style rows even though none exist yet in the current catalog', () => {
    const result = classifyProduct(input('Mantencion M-10', { productId: '999104' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });

  it('excludes the "mantenimiento m-*" vocabulary variant', () => {
    const result = classifyProduct(input('Mantenimiento M-20', { productId: '999105' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });
});

describe('Administrative service rows', () => {
  it('excludes "Servicio vendedor" (id 444)', () => {
    const result = classifyProduct(input('Servicio vendedor Pesas Chile', { productId: '444' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });

  it('excludes "Costo logistico" (id 505)', () => {
    const result = classifyProduct(input('Costo logistico', { productId: '505' }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });
});

describe('Legitimate products with superficially similar wording are never excluded', () => {
  it('a product whose description-style wording contains "servicio" mid-name is not excluded', () => {
    const result = classifyProduct(input('Cinturon de Levantamiento con Servicio Postventa Incluido', { productId: '999106' }));
    expect(result.classificationStatus).not.toBe('EXCLUDED_NON_PRODUCT');
  });

  it('a "Revision" of something other than an R-* tier code is not excluded (no bare "revision" catch-all)', () => {
    const result = classifyProduct(input('Guia de Revision Tecnica Incluida', { productId: '999107' }));
    expect(result.classificationStatus).not.toBe('EXCLUDED_NON_PRODUCT');
  });

  it('a product literally named with an R-code but not a review/repair phrase is not excluded', () => {
    const result = classifyProduct(input('Kettlebell Modelo R-10 Edicion Especial', { productId: '999108' }));
    expect(result.classificationStatus).not.toBe('EXCLUDED_NON_PRODUCT');
    expect(result.primaryProductFamily?.code).toBe('KETTLEBELL');
  });
});

describe('Prior v1 exclusions still hold under v2', () => {
  it.each(['444', '505', '554', '555', '556', '557', '558', '902', '903'])('id %s remains excluded', (productId) => {
    const result = classifyProduct(input('Servicio de armado tipo A-10', { productId }));
    expect(result.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });
});

describe('Excluded rows carry zero semantic tags', () => {
  it('EXCLUDED_NON_PRODUCT rows never carry a family, discipline, or use-context tag', () => {
    const result = classifyProduct(input('Revision R-10', { productId: '550' }));
    expect(result.primaryProductFamily).toBeNull();
    expect(result.secondaryProductFamilies).toEqual([]);
    expect(result.disciplines).toEqual([]);
    expect(result.useContexts).toEqual([]);
    expect(result.evidence).toEqual([]);
  });
});

describe('Real-product semantic regression: v1 and v2 agree on every non-excluded product', () => {
  it('classifying the same real product under v1 and v2 yields identical family/discipline/context tags', () => {
    const samples = [
      input('Barra Olimpica 20kg Training | HWM'),
      input('Kettlebell Acero 20kg | HWM'),
      input('Trotadora Comercial S1 Series LED | Obelix', {
        features: [{ featureId: '1', featureName: 'Clasificacion de Uso', value: 'USO INTENSIVO - COMERCIAL', trustClass: 'SEMANTIC' }],
      }),
      input('Camara Hiperbarica ST801 1.5ATA | O2Life', { categories: [{ categoryId: '367', name: 'Camaras Hiperbaricas', trustClass: 'SEMANTIC_STRONG' }] }),
    ];
    for (const productInput of samples) {
      const v1Result = classifyProduct(productInput, commercialProductOntologyRegistryVersion);
      const v2Result = classifyProduct(productInput, commercialProductOntologyRegistryVersionV2);
      expect(v2Result.classificationStatus, productInput.productName).toBe(v1Result.classificationStatus);
      expect(v2Result.primaryProductFamily, productInput.productName).toEqual(v1Result.primaryProductFamily);
      expect(v2Result.secondaryProductFamilies, productInput.productName).toEqual(v1Result.secondaryProductFamilies);
      expect(v2Result.disciplines, productInput.productName).toEqual(v1Result.disciplines);
      expect(v2Result.useContexts, productInput.productName).toEqual(v1Result.useContexts);
    }
  });

  it('classifyProducts still supports explicit v2 while the default registry can move independently', () => {
    const explicitV2 = classifyProducts([input('Barra Olimpica 20kg Training | HWM')], commercialProductOntologyRegistryVersionV2);
    const result = classifyProducts([input('Barra Olimpica 20kg Training | HWM')]);
    expect(explicitV2[0]?.registryVersion).toBe('commercial-product-ontology-v2');
    expect(result[0]?.registryVersion).not.toBe('commercial-product-ontology-v2');
  });
});

describe('Full-catalog false-positive check (Section 12/25)', () => {
  it('zero legitimate physical products are excluded across the real 2011-product catalog', async () => {
    const { inputs } = await loadProductSemanticClassificationInputs(await resolveProductSemanticInputPaths());
    expect(inputs.length).toBe(2011);

    const results = classifyProducts(inputs, commercialProductOntologyRegistryVersionV2);
    const excludedIds = results.filter((r) => r.classificationStatus === 'EXCLUDED_NON_PRODUCT').map((r) => r.productId).sort();
    const expectedExcludedIds = ['444', '505', '550', '551', '552', '553', '554', '555', '556', '557', '558', '902', '903'];
    expect(excludedIds).toEqual(expectedExcludedIds);

    const needsReview = results.filter((r) => r.classificationStatus === 'NEEDS_REVIEW');
    expect(needsReview).toEqual([]);
  });

  it('confirms via a raw-name discovery scan that no additional row matches the R/A/M/administrative keywords beyond the 13 confirmed ones', async () => {
    const { catalogCsvPath } = await resolveProductSemanticInputPaths();
    const catalogPath = path.resolve(catalogCsvPath);
    const text = await readFile(catalogPath, 'utf8');
    const records = parseCsvRecords(text);
    expect(records.length).toBe(2011);

    const keywords = ['revision', 'reparacion', 'armado', 'instalacion', 'mantencion', 'mantenimiento', 'servicio', 'costo'];
    const containsKeyword = (normalized: string, keyword: string) =>
      normalized === keyword || normalized.startsWith(`${keyword} `) || normalized.includes(` ${keyword} `) || normalized.endsWith(` ${keyword}`);

    const matchedIds = records
      .filter((record) => {
        const normalized = normalizeProductName(record.name ?? '');
        return keywords.some((keyword) => containsKeyword(normalized, keyword));
      })
      .map((record) => record.productId)
      .sort();

    expect(matchedIds).toEqual(['444', '505', '550', '551', '552', '553', '554', '555', '556', '557', '558', '902', '903']);
  });
});
