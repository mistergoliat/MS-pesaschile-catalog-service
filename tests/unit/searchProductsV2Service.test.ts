import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_PRODUCTS_V2_SERVICE_PARAMETERS,
  SearchProductsV2Error,
  searchProductsV2ContextSchema,
  searchProductsV2ExecutionSchema,
  searchProductsV2FiltersSchema,
  searchProductsV2RequestSchema,
  searchProductsV2ResultSchema,
  searchProductsV2StatisticsSchema,
  searchProductsV2WarningSchema,
  searchProductsV2Internals,
} from '../../src/application/recommendation/search-products-v2/index.js';
import { ProductRecommendationError } from '../../src/domain/recommendation/relationship-engine/recommendation/index.js';
import { PersonalizedRecommendationError } from '../../src/domain/recommendation/personalized-recommendation/index.js';
import {
  affinityFor,
  affinityResultFor,
  commercialRecommendationFor,
  commercialResultFor,
  ownershipFor,
  productB,
  productBCombo,
  productBCombo11,
  productC,
  productD,
  productE,
  signal,
  sourceProduct,
} from '../fixtures/personalizedRecommendation.js';
import {
  baseSearchProductsV2Request,
  buildSearchProductsV2Harness,
  catalogSummaryFor,
  clone,
  customerMismatchAffinityFailure,
  duplicateEvidenceAffinityFailure,
  nonDegradableAffinityFailure,
  productOutsideBatchAffinityFailure,
  retryableAffinityFailure,
  searchProductsV2UnknownAffinityResult,
  structuralAffinityFailure,
} from '../fixtures/searchProductsV2Application.js';

async function expectSearchError(action: () => Promise<unknown>, code: SearchProductsV2Error['code']) {
  await expect(action()).rejects.toThrow(SearchProductsV2Error);
  try {
    await action();
  } catch (error) {
    expect((error as SearchProductsV2Error).code).toBe(code);
  }
}

describe('SearchProducts V2 contracts', () => {
  it('accepts a minimal valid request', () => {
    expect(searchProductsV2RequestSchema.safeParse({ sourceProduct: { productId: 'A' } }).success).toBe(true);
  });

  it('accepts a complete valid request', () => {
    expect(searchProductsV2RequestSchema.safeParse({
      ...baseSearchProductsV2Request,
      context: {
        customerId: 'customer-1',
        intent: 'purchase',
        useCase: 'home-gym',
        budget: { amount: 800000, currency: 'CLP' },
        preferredProducts: [productB],
        excludedProducts: [productD],
      },
      filters: { inStockOnly: true },
    }).success).toBe(true);
  });

  it('rejects empty query', () => {
    expect(searchProductsV2RequestSchema.safeParse({ query: '', sourceProduct: { productId: 'A' } }).success).toBe(false);
  });

  it('rejects blank query', () => {
    expect(searchProductsV2RequestSchema.safeParse({ query: '   ', sourceProduct: { productId: 'A' } }).success).toBe(false);
  });

  it('rejects too long query', () => {
    expect(searchProductsV2RequestSchema.safeParse({ query: 'x'.repeat(241), sourceProduct: { productId: 'A' } }).success).toBe(false);
  });

  it('rejects invalid limit zero', () => {
    expect(searchProductsV2RequestSchema.safeParse({ query: 'rack', sourceProduct: { productId: 'A' }, limit: 0 }).success).toBe(false);
  });

  it('rejects invalid limit over maximum', () => {
    expect(searchProductsV2RequestSchema.safeParse({ query: 'rack', sourceProduct: { productId: 'A' }, limit: 21 }).success).toBe(false);
  });

  it('rejects duplicate preferred products', () => {
    expect(searchProductsV2ContextSchema.safeParse({ preferredProducts: [productB, productB] }).success).toBe(false);
  });

  it('rejects duplicate excluded products', () => {
    expect(searchProductsV2ContextSchema.safeParse({ excludedProducts: [productB, productB] }).success).toBe(false);
  });

  it('accepts explicitRepurchaseProducts (CP-R1-T10B3C)', () => {
    expect(searchProductsV2ContextSchema.safeParse({ explicitRepurchaseProducts: [productB] }).success).toBe(true);
  });

  it('rejects duplicate explicit repurchase products', () => {
    expect(searchProductsV2ContextSchema.safeParse({ explicitRepurchaseProducts: [productB, productB] }).success).toBe(false);
  });

  it('rejects the same identity in explicitRepurchaseProducts and excludedProducts', () => {
    expect(searchProductsV2ContextSchema.safeParse({
      excludedProducts: [productB],
      explicitRepurchaseProducts: [productB],
    }).success).toBe(false);
  });

  it('accepts explicitRepurchaseProducts and excludedProducts for different identities', () => {
    expect(searchProductsV2ContextSchema.safeParse({
      excludedProducts: [productC],
      explicitRepurchaseProducts: [productB],
    }).success).toBe(true);
  });

  it('treats a different combination of the same base product as a distinct identity, not a conflict', () => {
    expect(searchProductsV2ContextSchema.safeParse({
      excludedProducts: [productBCombo11],
      explicitRepurchaseProducts: [productBCombo],
    }).success).toBe(true);
  });

  it('rejects duplicate product filters', () => {
    expect(searchProductsV2FiltersSchema.safeParse({ productIds: ['A', 'A'] }).success).toBe(false);
  });

  it('rejects empty currency', () => {
    expect(searchProductsV2ContextSchema.safeParse({ budget: { amount: 10, currency: '' } }).success).toBe(false);
  });

  it('rejects invalid budget amount', () => {
    expect(searchProductsV2ContextSchema.safeParse({ budget: { amount: -1, currency: 'CLP' } }).success).toBe(false);
  });

  it('rejects customer mismatch in request', () => {
    expect(searchProductsV2RequestSchema.safeParse({
      query: 'rack',
      sourceProduct: { productId: 'A' },
      customer: { customerId: 'customer-1' },
      context: { customerId: 'other' },
    }).success).toBe(false);
  });

  it('rejects invalid correlation id', () => {
    expect(searchProductsV2RequestSchema.safeParse({ query: 'rack', sourceProduct: { productId: 'A' }, correlationId: 'bad id!' }).success).toBe(false);
  });

  it('accepts valid response', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(searchProductsV2ResultSchema.safeParse(result).success).toBe(true);
  });

  it('returns an enriched source product and enriched recommendations', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.sourceProduct).toMatchObject({ productId: 'A', name: 'Producto A', reference: 'SKU-A' });
    expect(result.recommendations[0]?.product).toMatchObject({
      productId: 'B',
      name: 'Producto B',
      reference: 'SKU-B',
      publicLink: {
        canonicalUrl: 'https://pesaschile.cl/categories/B-producto-B.html',
        scope: 'exact_product',
        available: true,
        requiresVariantSelection: false,
        variantAttributeLabels: [],
      },
      price: { amount: 1000, currency: 'CLP' },
      stock: { status: 'in_stock', available: true },
    });
  });

  it('uses one logical catalog enrichment batch for source and candidate pool', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.catalog.calls).toHaveLength(1);
    expect(harness.catalog.calls[0]).toEqual([sourceProduct, productB, productC, productD]);
  });

  it('fails when source product is missing from catalog enrichment', async () => {
    const harness = buildSearchProductsV2Harness({ catalogProducts: [catalogSummaryFor(productB)] });
    await expectSearchError(() => harness.service.search(baseSearchProductsV2Request), 'SOURCE_PRODUCT_NOT_FOUND');
  });

  it('fails when source product is inactive', async () => {
    const harness = buildSearchProductsV2Harness({
      catalogProducts: [
        catalogSummaryFor(sourceProduct, { active: false }),
        catalogSummaryFor(productB),
        catalogSummaryFor(productC),
        catalogSummaryFor(productD),
      ],
    });
    await expectSearchError(() => harness.service.search(baseSearchProductsV2Request), 'SOURCE_PRODUCT_INACTIVE');
  });

  it('filters missing and inactive recommended products after enrichment', async () => {
    const harness = buildSearchProductsV2Harness({
      catalogProducts: [
        catalogSummaryFor(sourceProduct),
        catalogSummaryFor(productB),
        catalogSummaryFor(productC, { active: false }),
      ],
    });
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B']);
    expect(result.excluded.map((item) => item.code)).toContain('INACTIVE_PRODUCT');
    expect(result.excluded.map((item) => item.code)).toContain('MISSING_CATALOG_PRODUCT');
  });

  it('applies inStockOnly after enrichment', async () => {
    const harness = buildSearchProductsV2Harness({
      catalogProducts: [
        catalogSummaryFor(sourceProduct),
        catalogSummaryFor(productB),
        catalogSummaryFor(productC, { stock: { status: 'out_of_stock', available: false } }),
        catalogSummaryFor(productD, { stock: { status: 'unknown', available: false } }),
      ],
    });
    const result = await harness.service.search({ ...baseSearchProductsV2Request, filters: { inStockOnly: true } });
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B']);
    expect(result.excluded.filter((item) => item.code === 'OUT_OF_STOCK_FILTERED')).toHaveLength(2);
  });

  it('keeps out-of-stock products visible when inStockOnly is absent', async () => {
    const harness = buildSearchProductsV2Harness({
      catalogProducts: [
        catalogSummaryFor(sourceProduct),
        catalogSummaryFor(productB, { stock: { status: 'out_of_stock', available: false } }),
        catalogSummaryFor(productC),
        catalogSummaryFor(productD),
      ],
    });
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.recommendations[0]?.product.stock.status).toBe('out_of_stock');
  });

  it('does not invent missing price and emits one global warning', async () => {
    const harness = buildSearchProductsV2Harness({
      catalogProducts: [
        catalogSummaryFor(sourceProduct),
        catalogSummaryFor(productB, { price: null }),
        catalogSummaryFor(productC, { price: null }),
        catalogSummaryFor(productD),
      ],
    });
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.recommendations[0]?.product.price).toBeNull();
    expect(result.warnings.filter((item) => item.code === 'CATALOG_PRICE_UNAVAILABLE')).toHaveLength(1);
  });

  it('keeps unknown stock explicit and emits one global warning', async () => {
    const harness = buildSearchProductsV2Harness({
      catalogProducts: [
        catalogSummaryFor(sourceProduct),
        catalogSummaryFor(productB, { stock: { status: 'unknown', available: false } }),
        catalogSummaryFor(productC),
        catalogSummaryFor(productD),
      ],
    });
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.recommendations[0]?.product.stock).toEqual({ status: 'unknown', available: false });
    expect(result.warnings.filter((item) => item.code === 'CATALOG_STOCK_UNKNOWN')).toHaveLength(1);
  });

  it('preserves scores and statistical evidence while recalculating final rank after filtering', async () => {
    const harness = buildSearchProductsV2Harness({
      catalogProducts: [
        catalogSummaryFor(sourceProduct),
        catalogSummaryFor(productB, { active: false }),
        catalogSummaryFor(productC),
        catalogSummaryFor(productD),
      ],
    });
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.recommendations[0]).toMatchObject({
      rank: 1,
      ranking: { rank: 1 },
      product: { productId: 'C' },
      relationship: {
        type: 'same_order',
        reliability: 0.55,
        evidence: { jointCount: 12, support: 0.3, confidence: 0.6, lift: 1.5 },
      },
    });
    expect(result.recommendations[0]?.score).toBe(0.5215);
  });

  it('respects final limit after enrichment', async () => {
    const result = await buildSearchProductsV2Harness().service.search({ ...baseSearchProductsV2Request, limit: 2 });
    expect(result.recommendations).toHaveLength(2);
    expect(result.excluded.some((item) => item.code === 'RESULT_LIMIT_TRUNCATION')).toBe(true);
  });

  it('does not let query change the source product', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search({ ...baseSearchProductsV2Request, query: 'otro texto' });
    expect(harness.commercial.calls[0]?.sourceProduct).toEqual(sourceProduct);
  });

  it('rejects inconsistent execution', () => {
    expect(searchProductsV2ExecutionSchema.safeParse({
      correlationId: 'corr',
      degraded: false,
      degradationReasons: ['CUSTOMER_AFFINITY_RETRYABLE_FAILURE'],
      stages: { commercialRecommendation: 'completed', customerAffinity: 'completed', personalization: 'completed' },
    }).success).toBe(false);
  });

  it('rejects inconsistent statistics', () => {
    expect(searchProductsV2StatisticsSchema.safeParse({
      commercialCandidates: 2,
      affinityCandidates: 0,
      personalizedRecommendations: 1,
      excludedRecommendations: 0,
      customerAffinityCalls: 0,
      personalizationCalls: 0,
      degradedStages: 0,
      warningsGenerated: 0,
    }).success).toBe(false);
  });

  it('rejects invalid warning details', () => {
    expect(searchProductsV2WarningSchema.safeParse({ code: 'NO_COMMERCIAL_CANDIDATES', details: { bad: Number.NaN } }).success).toBe(false);
  });

  it('freezes default service parameters', () => {
    expect(Object.isFrozen(DEFAULT_SEARCH_PRODUCTS_V2_SERVICE_PARAMETERS)).toBe(true);
  });
});

describe('SearchProducts V2 orchestration', () => {
  it('executes T08 once', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.commercial.calls).toHaveLength(1);
  });

  it('executes T09 once when customer exists', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.affinity.calls).toHaveLength(1);
  });

  it('executes T10 once when candidates exist', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.personalization.calls).toHaveLength(1);
  });

  it('executes in T08 T09 T10 order', async () => {
    const callOrder: string[] = [];
    const harness = buildSearchProductsV2Harness({ callOrder });
    await harness.service.search(baseSearchProductsV2Request);
    expect(callOrder).toEqual(['T08', 'T09', 'T10']);
  });

  it('does not call T09 before T08', async () => {
    const callOrder: string[] = [];
    const harness = buildSearchProductsV2Harness({ callOrder });
    await harness.service.search(baseSearchProductsV2Request);
    expect(callOrder.indexOf('T09')).toBeGreaterThan(callOrder.indexOf('T08'));
  });

  it('does not call T10 before T09', async () => {
    const callOrder: string[] = [];
    const harness = buildSearchProductsV2Harness({ callOrder });
    await harness.service.search(baseSearchProductsV2Request);
    expect(callOrder.indexOf('T10')).toBeGreaterThan(callOrder.indexOf('T09'));
  });

  it('propagates correlation id from request', async () => {
    const result = await buildSearchProductsV2Harness().service.search({ ...baseSearchProductsV2Request, correlationId: 'corr-explicit' });
    expect(result.execution.correlationId).toBe('corr-explicit');
  });

  it('generates correlation id when missing', async () => {
    const harness = buildSearchProductsV2Harness();
    const request = { ...baseSearchProductsV2Request };
    delete request.correlationId;
    const result = await harness.service.search(request);
    expect(result.execution.correlationId).toBe('corr-generated');
    expect(harness.correlation.calls).toBe(1);
  });

  it('does not mutate request', async () => {
    const harness = buildSearchProductsV2Harness();
    const request = clone(baseSearchProductsV2Request);
    const before = clone(request);
    await harness.service.search(request);
    expect(request).toEqual(before);
  });

  it('does not mutate T08 result', async () => {
    const commercialResult = commercialResultFor([commercialRecommendationFor(productB)]);
    const before = clone(commercialResult);
    await buildSearchProductsV2Harness({ commercialResult }).service.search(baseSearchProductsV2Request);
    expect(commercialResult).toEqual(before);
  });

  it('does not mutate T09 result', async () => {
    const affinityResult = affinityResultFor([affinityFor(productB)]);
    const before = clone(affinityResult);
    await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(affinityResult).toEqual(before);
  });

  it('maps request to T08 with source product', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.commercial.calls[0]?.sourceProduct).toEqual({ productId: 'A' });
  });

  it('maps limit to candidate pool', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search({ ...baseSearchProductsV2Request, limit: 4 });
    expect(harness.commercial.calls[0]?.limit).toBe(20);
  });

  it('caps expanded candidate pool to the T08 maximum limit', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search({ ...baseSearchProductsV2Request, limit: 10 });
    expect(harness.commercial.calls[0]?.limit).toBe(20);
  });

  it('maps inStockOnly to includeOutOfStock false', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search({ ...baseSearchProductsV2Request, filters: { inStockOnly: true } });
    expect(harness.commercial.calls[0]?.includeOutOfStock).toBe(false);
  });

  it('rejects unsupported productIds filter explicitly', async () => {
    await expectSearchError(
      () => buildSearchProductsV2Harness().service.search({ ...baseSearchProductsV2Request, filters: { productIds: ['B'] } }),
      'INVALID_REQUEST',
    );
  });

  it('passes T08 products as T09 batch', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.affinity.calls[0]?.products.map((product) => product.productId)).toEqual(['B', 'C', 'D']);
  });

  it('passes T08 result intact to T10', async () => {
    const commercialResult = commercialResultFor([commercialRecommendationFor(productB)]);
    const harness = buildSearchProductsV2Harness({ commercialResult });
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.personalization.calls[0]?.commercialRecommendations).toEqual(commercialResult);
  });

  it('passes T09 result intact to T10', async () => {
    const affinityResult = affinityResultFor([affinityFor(productB)]);
    const harness = buildSearchProductsV2Harness({ affinityResult });
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.personalization.calls[0]?.customerAffinities).toEqual(affinityResult);
  });

  it('passes context to T10', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search({ ...baseSearchProductsV2Request, context: { preferredProducts: [productB], useCase: 'home-gym' } });
    expect(harness.personalization.calls[0]?.context?.preferredProductIds).toEqual([productB]);
  });
});

describe('SearchProducts V2 T08 behavior', () => {
  it('returns valid commercial result', async () => {
    expect((await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request)).statistics.commercialCandidates).toBe(3);
  });

  it('handles zero candidates with 200-style result', async () => {
    const harness = buildSearchProductsV2Harness({ commercialResult: commercialResultFor([]) });
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.recommendations).toEqual([]);
    expect(result.warnings[0]?.code).toBe('NO_COMMERCIAL_CANDIDATES');
  });

  it('does not call T09 for zero candidates', async () => {
    const harness = buildSearchProductsV2Harness({ commercialResult: commercialResultFor([]) });
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.affinity.calls).toHaveLength(0);
  });

  it('does not call T10 for zero candidates', async () => {
    const harness = buildSearchProductsV2Harness({ commercialResult: commercialResultFor([]) });
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.personalization.calls).toHaveLength(0);
  });

  it('maps commercial warnings', async () => {
    const recommendation = commercialRecommendationFor(productB, 1, 80, { warnings: [{ code: 'LOW_STOCK' }] });
    const result = await buildSearchProductsV2Harness({ commercialResult: commercialResultFor([recommendation]) }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'UPSTREAM_COMMERCIAL_WARNING')).toBe(true);
  });

  it('fails when T08 throws retryable-like error', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.commercial.failWith = new ProductRecommendationError('RECOMMENDATION_KNOWLEDGE_NOT_LOADED', 'not loaded');
    await expectSearchError(() => harness.service.search(baseSearchProductsV2Request), 'COMMERCIAL_RECOMMENDATION_UNAVAILABLE');
  });

  it('does not call T09 when T08 fails', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.commercial.failWith = new ProductRecommendationError('COMMERCIAL_DATA_PROVIDER_FAILURE', 'down');
    await expect(harness.service.search(baseSearchProductsV2Request)).rejects.toThrow();
    expect(harness.affinity.calls).toHaveLength(0);
  });

  it('does not call T10 when T08 fails', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.commercial.failWith = new Error('boom');
    await expect(harness.service.search(baseSearchProductsV2Request)).rejects.toThrow();
    expect(harness.personalization.calls).toHaveLength(0);
  });

  it('rejects duplicated T08 products', async () => {
    await expectSearchError(
      () => buildSearchProductsV2Harness({
        commercialResult: commercialResultFor([commercialRecommendationFor(productB, 1), commercialRecommendationFor(productB, 2)]),
      }).service.search(baseSearchProductsV2Request),
      'INVALID_COMMERCIAL_RESULT',
    );
  });

  it('rejects invalid T08 score', async () => {
    await expectSearchError(
      () => buildSearchProductsV2Harness({
        commercialResult: commercialResultFor([commercialRecommendationFor(productB, 1, 101)]),
      }).service.search(baseSearchProductsV2Request),
      'INVALID_COMMERCIAL_RESULT',
    );
  });

  it('rejects duplicated T08 ranks', async () => {
    await expectSearchError(
      () => buildSearchProductsV2Harness({
        commercialResult: commercialResultFor([commercialRecommendationFor(productB, 1), commercialRecommendationFor(productC, 1)]),
      }).service.search(baseSearchProductsV2Request),
      'INVALID_COMMERCIAL_RESULT',
    );
  });
});

describe('SearchProducts V2 T09 behavior and degradation', () => {
  it('calls T09 with identified customer', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.affinity.calls[0]?.customer).toEqual(baseSearchProductsV2Request.customer);
  });

  it('does not call T09 without customer', async () => {
    const harness = buildSearchProductsV2Harness();
    const request = { ...baseSearchProductsV2Request };
    delete request.customer;
    await harness.service.search(request);
    expect(harness.affinity.calls).toHaveLength(0);
  });

  it('creates neutral no-customer affinity for T10', async () => {
    const harness = buildSearchProductsV2Harness();
    const request = { ...baseSearchProductsV2Request };
    delete request.customer;
    await harness.service.search(request);
    expect(harness.personalization.calls[0]?.customerAffinities?.warnings).toEqual([]);
  });

  it('preserves no-history affinity', async () => {
    const affinityResult = affinityResultFor([affinityFor(productB, 0, 'none', [], { warnings: [{ code: 'NO_CUSTOMER_HISTORY' }] })]);
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'NO_CUSTOMER_HISTORY')).toBe(true);
  });

  it('preserves partial-history affinity', async () => {
    const affinityResult = affinityResultFor([affinityFor(productB, 0.8, 'high')]);
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'AFFINITY_MISSING_FOR_PRODUCT')).toBe(true);
  });

  it('propagates CUSTOMER_HISTORY_NOT_LINKED from T09 without degrading (CP-R1-T10B4A)', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_HISTORY_NOT_LINKED' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_HISTORY_NOT_LINKED')).toBe(true);
    expect(result.execution.degraded).toBe(false);
    expect(result.execution.stages.customerAffinity).toBe('completed');
    expect(result.execution.degradationReasons).toEqual([]);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(false);
  });

  it('propagates CUSTOMER_REFERENCE_NOT_FOUND from T09 without degrading (CP-R1-T10B4A)', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_REFERENCE_NOT_FOUND' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_REFERENCE_NOT_FOUND')).toBe(true);
    expect(result.execution.degraded).toBe(false);
    expect(result.execution.stages.customerAffinity).toBe('completed');
    expect(result.execution.degradationReasons).toEqual([]);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(false);
  });

  it('preserves commercial ranking when T09 reports CUSTOMER_HISTORY_NOT_LINKED (CP-R1-T10B4A)', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_HISTORY_NOT_LINKED' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B', 'C', 'D']);
  });

  it('does not attach ownership to any recommendation when T09 reports CUSTOMER_REFERENCE_NOT_FOUND (CP-R1-T10B4A)', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_REFERENCE_NOT_FOUND' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.recommendations.every((item) => item.ownership === undefined)).toBe(true);
  });

  it('uses complete affinity', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.recommendations.some((item) => item.affinityScore > 0)).toBe(true);
  });

  it('degrades retryable T09 error', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = retryableAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.execution.degraded).toBe(true);
    expect(result.execution.stages.customerAffinity).toBe('degraded');
    expect(result.execution.degradationReasons).toEqual(['CUSTOMER_AFFINITY_RETRYABLE_FAILURE']);
  });

  it('returns warning on retryable T09 error', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = retryableAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
  });

  it('preserves commercial ranking on retryable T09 error', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = retryableAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B', 'C', 'D']);
  });

  it('does not expose the provider error message or cause for a retryable failure (CP-R1-T10B3C)', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = retryableAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/timeout|cause/u);
  });

  it('degrades a structurally invalid T09 provider response instead of failing (CP-R1-T10B3C)', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = structuralAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.execution.degraded).toBe(true);
    expect(result.execution.stages.customerAffinity).toBe('degraded');
    expect(result.execution.degradationReasons).toEqual(['CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID']);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
  });

  it('preserves generic commercial ranking when T09 provider response is structurally invalid', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = structuralAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B', 'C', 'D']);
  });

  it('fails generic T09 error', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = new Error('boom');
    await expectSearchError(() => harness.service.search(baseSearchProductsV2Request), 'INVALID_AFFINITY_RESULT');
  });

  it('degrades on a customer mismatch reported by the evidence provider (CP-R1-T10B3C)', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = customerMismatchAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.execution.degraded).toBe(true);
    expect(result.execution.stages.customerAffinity).toBe('degraded');
    expect(result.execution.degradationReasons).toEqual(['CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID']);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B', 'C', 'D']);
  });

  it('degrades when the evidence provider returns a product outside the requested batch', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = productOutsideBatchAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.execution.degraded).toBe(true);
    expect(result.execution.stages.customerAffinity).toBe('degraded');
    expect(result.execution.degradationReasons).toEqual(['CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID']);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B', 'C', 'D']);
  });

  it('degrades when the evidence provider returns duplicated product evidence', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = duplicateEvidenceAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.execution.degraded).toBe(true);
    expect(result.execution.stages.customerAffinity).toBe('degraded');
    expect(result.execution.degradationReasons).toEqual(['CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID']);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B', 'C', 'D']);
  });

  it('does not expose the provider error message or cause for an invalid provider response (CP-R1-T10B3C)', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = duplicateEvidenceAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/duplicated product evidence|cause/u);
  });

  it('does not degrade a CustomerAffinityError that represents an internal contract bug', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = nonDegradableAffinityFailure();
    await expectSearchError(() => harness.service.search(baseSearchProductsV2Request), 'INVALID_AFFINITY_RESULT');
  });

  it('fallback neutral uses T08 identities', async () => {
    const fallback = searchProductsV2Internals.createNeutralCustomerAffinityResult(
      baseSearchProductsV2Request.customer,
      [productB, productC],
      'technical_degradation',
    );
    expect(fallback.affinities.map((item) => item.product)).toEqual([productB, productC]);
  });

  it('fallback neutral does not fake no-history', () => {
    const fallback = searchProductsV2Internals.createNeutralCustomerAffinityResult(baseSearchProductsV2Request.customer, [productB], 'technical_degradation');
    expect(JSON.stringify(fallback)).not.toContain('NO_CUSTOMER_HISTORY');
  });

  it('calls T09 at most once under degradation', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = retryableAffinityFailure();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.affinity.calls).toHaveLength(1);
  });

  it('does not put unknown affinity into public ranking', async () => {
    const result = await buildSearchProductsV2Harness({ affinityResult: searchProductsV2UnknownAffinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.recommendations.some((item) => item.product.productId === productE.productId)).toBe(false);
  });
});

describe('SearchProducts V2 personalization metadata (CP-R1-T10B4A)', () => {
  it('reports applied:true when affinity is real and positive', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.personalization).toEqual({ applied: true, customerId: baseSearchProductsV2Request.customer!.customerId });
  });

  it('reports applied:false/no_customer_history for confirmed empty history', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', [], { warnings: [{ code: 'NO_CUSTOMER_HISTORY' }] })]),
      warnings: [{ code: 'NO_CUSTOMER_HISTORY' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.personalization).toEqual({
      applied: false,
      reason: 'no_customer_history',
      customerId: baseSearchProductsV2Request.customer!.customerId,
    });
  });

  it('reports applied:false/customer_affinity_unavailable for technical degradation', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = retryableAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.personalization).toEqual({
      applied: false,
      reason: 'customer_affinity_unavailable',
      customerId: baseSearchProductsV2Request.customer!.customerId,
    });
  });

  it('reports applied:false/customer_not_provided without a customer', async () => {
    const harness = buildSearchProductsV2Harness();
    const request = { ...baseSearchProductsV2Request };
    delete request.customer;
    const result = await harness.service.search(request);
    expect(result.personalization).toEqual({ applied: false, reason: 'customer_not_provided' });
  });

  it('reports applied:false/customer_history_not_linked for CUSTOMER_HISTORY_NOT_LINKED', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_HISTORY_NOT_LINKED' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.personalization).toEqual({
      applied: false,
      reason: 'customer_history_not_linked',
      customerId: baseSearchProductsV2Request.customer!.customerId,
    });
    expect(result.execution.degraded).toBe(false);
    expect(result.execution.stages.customerAffinity).toBe('completed');
    expect(result.execution.degradationReasons).toEqual([]);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B', 'C', 'D']);
    expect(result.recommendations.every((item) => item.ownership === undefined)).toBe(true);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(false);
  });

  it('reports applied:false/customer_reference_not_found for CUSTOMER_REFERENCE_NOT_FOUND', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_REFERENCE_NOT_FOUND' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.personalization).toEqual({
      applied: false,
      reason: 'customer_reference_not_found',
      customerId: baseSearchProductsV2Request.customer!.customerId,
    });
    expect(result.execution.degraded).toBe(false);
    expect(result.execution.stages.customerAffinity).toBe('completed');
    expect(result.execution.degradationReasons).toEqual([]);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B', 'C', 'D']);
    expect(result.recommendations.every((item) => item.ownership === undefined)).toBe(true);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(false);
  });

  it('does not collapse CUSTOMER_HISTORY_NOT_LINKED into a generic upstream warning anywhere in the response', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_HISTORY_NOT_LINKED' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'UPSTREAM_PERSONALIZATION_WARNING')).toBe(false);
    expect(result.warnings.some((item) => item.code === 'UPSTREAM_AFFINITY_WARNING')).toBe(false);
    expect(result.warnings.every((item) => item.code === 'CUSTOMER_HISTORY_NOT_LINKED')).toBe(true);
  });

  it('reports CUSTOMER_HISTORY_NOT_LINKED as exactly one global entry, not one per relay leg (CP-R1-T10B4A closure)', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_HISTORY_NOT_LINKED' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings).toEqual([{ code: 'CUSTOMER_HISTORY_NOT_LINKED' }]);
    expect(result.statistics.warningsGenerated).toBe(1);
  });

  it('does not collapse CUSTOMER_REFERENCE_NOT_FOUND into a generic upstream warning anywhere in the response', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_REFERENCE_NOT_FOUND' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'UPSTREAM_PERSONALIZATION_WARNING')).toBe(false);
    expect(result.warnings.some((item) => item.code === 'UPSTREAM_AFFINITY_WARNING')).toBe(false);
    expect(result.warnings.every((item) => item.code === 'CUSTOMER_REFERENCE_NOT_FOUND')).toBe(true);
  });

  it('reports CUSTOMER_REFERENCE_NOT_FOUND as exactly one global entry, not one per relay leg (CP-R1-T10B4A closure)', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0, 'none', []), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'CUSTOMER_REFERENCE_NOT_FOUND' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings).toEqual([{ code: 'CUSTOMER_REFERENCE_NOT_FOUND' }]);
    expect(result.statistics.warningsGenerated).toBe(1);
  });
});

describe('SearchProducts V2 warning deduplication (CP-R1-T10B4A closure)', () => {
  it('reduces a NO_CUSTOMER_HISTORY duplicate relayed by T09 and T10 to one global entry, without dropping legitimate per-product ones', async () => {
    const affinityResult = {
      ...affinityResultFor([
        affinityFor(productB, 0, 'none', [], { warnings: [{ code: 'NO_CUSTOMER_HISTORY' }] }),
        affinityFor(productC, 0, 'none', [], { warnings: [{ code: 'NO_CUSTOMER_HISTORY' }] }),
        affinityFor(productD, 0, 'none', [], { warnings: [{ code: 'NO_CUSTOMER_HISTORY' }] }),
      ]),
      warnings: [{ code: 'NO_CUSTOMER_HISTORY' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    const globalEntries = result.warnings.filter((item) => item.code === 'NO_CUSTOMER_HISTORY' && item.product === undefined);
    const productEntries = result.warnings.filter((item) => item.code === 'NO_CUSTOMER_HISTORY' && item.product !== undefined);
    expect(globalEntries).toHaveLength(1);
    expect(productEntries.map((item) => item.product?.productId).sort()).toEqual(['B', 'C', 'D']);
    expect(result.statistics.warningsGenerated).toBe(result.warnings.length);
  });

  it('reduces a PARTIAL_CUSTOMER_HISTORY global duplicate relayed by T09 and T10 to one entry', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0.8, 'high'), affinityFor(productC, 0, 'none', []), affinityFor(productD, 0, 'none', [])]),
      warnings: [{ code: 'PARTIAL_CUSTOMER_HISTORY' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.filter((item) => item.code === 'PARTIAL_CUSTOMER_HISTORY')).toHaveLength(1);
    expect(result.warnings.filter((item) => item.code === 'PARTIAL_CUSTOMER_HISTORY')[0]?.product).toBeUndefined();
  });

  it('keeps PARTIAL_CUSTOMER_HISTORY for two different products as two distinct entries', async () => {
    const affinityResult = affinityResultFor([
      affinityFor(productB, 0, 'none', [], { warnings: [{ code: 'PARTIAL_CUSTOMER_HISTORY' }] }),
      affinityFor(productC, 0, 'none', [], { warnings: [{ code: 'PARTIAL_CUSTOMER_HISTORY' }] }),
      affinityFor(productD, 1, 'high'),
    ]);
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    const entries = result.warnings.filter((item) => item.code === 'PARTIAL_CUSTOMER_HISTORY');
    expect(entries).toHaveLength(2);
    expect(entries.map((item) => item.product?.productId).sort()).toEqual(['B', 'C']);
  });

  it('keeps a global PARTIAL_CUSTOMER_HISTORY and a per-product one for the same code as two distinct entries', async () => {
    const affinityResult = {
      ...affinityResultFor([
        affinityFor(productB, 0, 'none', [], { warnings: [{ code: 'PARTIAL_CUSTOMER_HISTORY' }] }),
        affinityFor(productC, 1, 'high'),
        affinityFor(productD, 1, 'high'),
      ]),
      warnings: [{ code: 'PARTIAL_CUSTOMER_HISTORY' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    const entries = result.warnings.filter((item) => item.code === 'PARTIAL_CUSTOMER_HISTORY');
    expect(entries).toHaveLength(2);
    expect(entries.some((item) => item.product === undefined)).toBe(true);
    expect(entries.some((item) => item.product?.productId === 'B')).toBe(true);
  });

  it('keeps genuinely different codes separate when the same T09 fact is relayed under two different fallback codes', async () => {
    const affinityResult = {
      ...affinityResultFor([affinityFor(productB, 0.5, 'medium')]),
      warnings: [{ code: 'AFFINITY_PROVIDER_WARNING' as const }],
    };
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'UPSTREAM_AFFINITY_WARNING')).toBe(true);
    expect(result.warnings.some((item) => item.code === 'UPSTREAM_PERSONALIZATION_WARNING')).toBe(true);
  });

  it('deduplicates warnings sharing code, scope, and identical details', () => {
    const deduplicated = searchProductsV2Internals.deduplicateWarnings([
      { code: 'CATALOG_PRODUCT_MISSING', source: 't11', details: { count: 3 } },
      { code: 'CATALOG_PRODUCT_MISSING', source: 'commercial', details: { count: 3 } },
    ]);
    expect(deduplicated).toEqual([{ code: 'CATALOG_PRODUCT_MISSING', details: { count: 3 } }]);
  });

  it('preserves both entries when code and scope match but details genuinely differ', () => {
    const deduplicated = searchProductsV2Internals.deduplicateWarnings([
      { code: 'CATALOG_PRODUCT_MISSING', source: 't11', details: { count: 3 } },
      { code: 'CATALOG_PRODUCT_MISSING', source: 't11', details: { count: 5 } },
    ]);
    expect(deduplicated).toEqual([
      { code: 'CATALOG_PRODUCT_MISSING', details: { count: 3 } },
      { code: 'CATALOG_PRODUCT_MISSING', details: { count: 5 } },
    ]);
  });
});

describe('SearchProducts V2 T10 mapping and result', () => {
  it('receives fallback neutral on T09 degradation', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = retryableAffinityFailure();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.personalization.calls[0]?.customerAffinities?.affinities.every((item) => item.score === 0)).toBe(true);
  });

  it('fails when T10 fails structurally', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.personalization.failWith = new PersonalizedRecommendationError('INVALID_REQUEST', 'bad');
    await expectSearchError(() => harness.service.search(baseSearchProductsV2Request), 'INVALID_PERSONALIZATION_RESULT');
  });

  it('preserves personalized ranking', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.recommendations.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it('preserves T10 exclusions', async () => {
    const result = await buildSearchProductsV2Harness({
      affinityResult: affinityResultFor([affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')]), affinityFor(productC), affinityFor(productD)]),
    }).service.search(baseSearchProductsV2Request);
    expect(result.excluded[0]?.code).toBe('EXPLICIT_PRODUCT_REJECTION');
  });

  it('preserves T10 warnings', async () => {
    const result = await buildSearchProductsV2Harness({
      affinityResult: affinityResultFor([affinityFor(productB, 0, 'none', [], { warnings: [{ code: 'PARTIAL_CUSTOMER_HISTORY' }] })]),
    }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'PARTIAL_CUSTOMER_HISTORY')).toBe(true);
  });

  it('preserves T10 statistics terminal counts', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.statistics.personalizedRecommendations + result.statistics.excludedRecommendations).toBe(result.statistics.commercialCandidates);
  });

  it('exposes relationship evidence without raw customer evidence summaries', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.recommendations[0]?.relationship.evidence).toMatchObject({
      jointCount: 12,
      confidence: 0.6,
      lift: 1.5,
    });
    expect(JSON.stringify(result)).not.toContain('DIRECT_PRODUCT_PURCHASE');
  });

  it('maps reasons without free text', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.recommendations[0]?.reasons.every((reason) => !('message' in reason))).toBe(true);
  });

  it('maps scores from T10 components', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.recommendations[0]?.score).toBe(result.recommendations[0]?.score);
    expect(result.recommendations[0]?.commercialScore).toBeGreaterThan(0);
  });
});

describe('SearchProducts V2 statistics, immutability, determinism, compatibility', () => {
  it('counts normal execution', async () => {
    const stats = (await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request)).statistics;
    expect(stats.customerAffinityCalls).toBe(1);
    expect(stats.personalizationCalls).toBe(1);
  });

  it('counts zero candidates', async () => {
    const stats = (await buildSearchProductsV2Harness({ commercialResult: commercialResultFor([]) }).service.search(baseSearchProductsV2Request)).statistics;
    expect(stats.commercialCandidates).toBe(0);
    expect(stats.customerAffinityCalls).toBe(0);
  });

  it('counts no customer', async () => {
    const request = { ...baseSearchProductsV2Request };
    delete request.customer;
    const stats = (await buildSearchProductsV2Harness().service.search(request)).statistics;
    expect(stats.customerAffinityCalls).toBe(0);
    expect(stats.personalizationCalls).toBe(1);
  });

  it('counts affinity degradation', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = retryableAffinityFailure();
    const stats = (await harness.service.search(baseSearchProductsV2Request)).statistics;
    expect(stats.degradedStages).toBe(1);
  });

  it('counts candidates excluded', async () => {
    const stats = (await buildSearchProductsV2Harness({
      affinityResult: affinityResultFor([affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')]), affinityFor(productC), affinityFor(productD)]),
    }).service.search(baseSearchProductsV2Request)).statistics;
    expect(stats.excludedRecommendations).toBe(1);
  });

  it('handles all candidates excluded', async () => {
    const stats = (await buildSearchProductsV2Harness({
      affinityResult: affinityResultFor([
        affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')]),
        affinityFor(productC, 1, 'high', [signal('PRODUCT_REJECTION')]),
        affinityFor(productD, 1, 'high', [signal('PRODUCT_REJECTION')]),
      ]),
    }).service.search(baseSearchProductsV2Request)).statistics;
    expect(stats.personalizedRecommendations).toBe(0);
    expect(stats.excludedRecommendations).toBe(3);
  });

  it('does not double count warnings', async () => {
    const result = await buildSearchProductsV2Harness({ affinityResult: affinityResultFor([affinityFor(productB)]) }).service.search(baseSearchProductsV2Request);
    const productWarnings = result.recommendations.reduce((count, item) => count + item.warnings.length, 0);
    expect(result.statistics.warningsGenerated).toBe(result.warnings.length + productWarnings);
  });

  it('freezes response', async () => {
    expect(Object.isFrozen(await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request))).toBe(true);
  });

  it('freezes arrays', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(Object.isFrozen(result.recommendations)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
    expect(Object.isFrozen(result.excluded)).toBe(true);
  });

  it('freezes execution', async () => {
    expect(Object.isFrozen((await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request)).execution)).toBe(true);
  });

  it('mutation after upstream does not alter response', async () => {
    const commercialResult = commercialResultFor([commercialRecommendationFor(productB)]);
    const result = await buildSearchProductsV2Harness({ commercialResult }).service.search(baseSearchProductsV2Request);
    commercialResult.recommendations[0]!.score.total = 1;
    expect(result.recommendations[0]?.commercialScore).toBe(0.8);
  });

  it('same input produces same functional result', async () => {
    const first = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    const second = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(second).toEqual(first);
  });

  it('correlation id does not change ranking', async () => {
    const first = await buildSearchProductsV2Harness().service.search({ ...baseSearchProductsV2Request, correlationId: 'corr-a' });
    const second = await buildSearchProductsV2Harness().service.search({ ...baseSearchProductsV2Request, correlationId: 'corr-b' });
    expect(second.recommendations).toEqual(first.recommendations);
  });

  it('orders warnings deterministically', async () => {
    const first = await buildSearchProductsV2Harness({ affinityResult: affinityResultFor([affinityFor(productB)]) }).service.search(baseSearchProductsV2Request);
    const second = await buildSearchProductsV2Harness({ affinityResult: affinityResultFor([affinityFor(productB)]) }).service.search(baseSearchProductsV2Request);
    expect(second.warnings).toEqual(first.warnings);
  });

  it('serializes to JSON', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('keeps correlation id out of scoring', async () => {
    const first = await buildSearchProductsV2Harness().service.search({ ...baseSearchProductsV2Request, correlationId: 'corr-one' });
    const second = await buildSearchProductsV2Harness().service.search({ ...baseSearchProductsV2Request, correlationId: 'corr-two' });
    expect(second.recommendations.map((item) => item.score)).toEqual(first.recommendations.map((item) => item.score));
  });

  it('keeps source product out of public recommendations', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.recommendations.some((item) => item.product.productId === baseSearchProductsV2Request.sourceProduct.productId)).toBe(false);
  });

  it('logs started and completed events', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search(baseSearchProductsV2Request);
    expect(harness.logger.events.map((item) => item.event)).toContain('search_products_v2_started');
    expect(harness.logger.events.map((item) => item.event)).toContain('search_products_v2_completed');
  });

  it('does not expose forbidden infrastructure markers', async () => {
    expect(JSON.stringify(await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request)).toLowerCase()).not.toMatch(/select |redis|customer 360|prestashop|llm|crm/u);
  });
});

describe('SearchProducts V2 ownership propagation (CP-R1-T10B3C)', () => {
  it('appears on the recommendation for the exact candidate T09 provided it for', async () => {
    const ownership = ownershipFor({ previouslyPurchased: true, exactVariantPreviouslyPurchased: false, totalOrderCount: 3 });
    const affinityResult = affinityResultFor([affinityFor(productB, 0, 'none', [], { ownership })]);
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.recommendations.find((item) => item.product.productId === 'B')?.ownership).toEqual(ownership);
  });

  it('is absent when T09 does not provide ownership for a candidate', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(result.recommendations.every((item) => item.ownership === undefined)).toBe(true);
  });

  it('preserves exactVariantPreviouslyPurchased for the exact variant candidate', async () => {
    const ownership = ownershipFor({ previouslyPurchased: true, exactVariantPreviouslyPurchased: true, totalOrderCount: 1 });
    const harness = buildSearchProductsV2Harness({
      commercialResult: commercialResultFor([commercialRecommendationFor(productBCombo, 1, 80)]),
      affinityResult: affinityResultFor([affinityFor(productBCombo, 0, 'none', [], { ownership })]),
      catalogProducts: [catalogSummaryFor(sourceProduct), catalogSummaryFor(productBCombo)],
    });
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.recommendations[0]?.ownership).toEqual(ownership);
  });

  it('does not appear as a warning', async () => {
    const affinityResult = affinityResultFor([affinityFor(productB, 0, 'none', [], { ownership: ownershipFor() })]);
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    expect(result.warnings.every((item) => !JSON.stringify(item).includes('previouslyPurchased'))).toBe(true);
    expect(result.recommendations.find((item) => item.product.productId === 'B')?.warnings ?? []).toEqual([]);
  });

  it('does not alter commercialReason', async () => {
    const signals = [signal('CATEGORY_PURCHASE')];
    const withoutOwnership = await buildSearchProductsV2Harness({
      affinityResult: affinityResultFor([affinityFor(productB, 0.5, 'medium', signals)]),
    }).service.search(baseSearchProductsV2Request);
    const withOwnership = await buildSearchProductsV2Harness({
      affinityResult: affinityResultFor([affinityFor(productB, 0.5, 'medium', signals, { ownership: ownershipFor() })]),
    }).service.search(baseSearchProductsV2Request);
    const before = withoutOwnership.recommendations.find((item) => item.product.productId === 'B')?.commercialReason;
    const after = withOwnership.recommendations.find((item) => item.product.productId === 'B')?.commercialReason;
    expect(after).toEqual(before);
    expect(after?.code).toBe('CUSTOMER_AFFINITY_MATCH');
  });

  it('does not expose raw evidence, only the neutral ownership shape', async () => {
    const affinityResult = affinityResultFor([affinityFor(productB, 0, 'none', [], { ownership: ownershipFor() })]);
    const result = await buildSearchProductsV2Harness({ affinityResult }).service.search(baseSearchProductsV2Request);
    const ownership = result.recommendations.find((item) => item.product.productId === 'B')?.ownership;
    expect(Object.keys(ownership ?? {}).sort()).toEqual([
      'exactVariantPreviouslyPurchased',
      'firstPurchasedAt',
      'lastPurchasedAt',
      'previouslyPurchased',
      'totalOrderCount',
    ].sort());
  });
});

describe('SearchProducts V2 explicit repurchase (CP-R1-T10B3C)', () => {
  it('maps context.explicitRepurchaseProducts to T10 explicitRepurchaseProductIds', async () => {
    const harness = buildSearchProductsV2Harness();
    await harness.service.search({ ...baseSearchProductsV2Request, context: { explicitRepurchaseProducts: [productB] } });
    expect(harness.personalization.calls[0]?.context?.explicitRepurchaseProductIds).toEqual([productB]);
  });

  it('rejects a request where explicitRepurchaseProducts conflicts with excludedProducts', async () => {
    await expectSearchError(
      () => buildSearchProductsV2Harness().service.search({
        ...baseSearchProductsV2Request,
        context: { excludedProducts: [productB], explicitRepurchaseProducts: [productB] },
      }),
      'INVALID_REQUEST',
    );
  });

  it('rejects duplicated explicitRepurchaseProducts', async () => {
    await expectSearchError(
      () => buildSearchProductsV2Harness().service.search({
        ...baseSearchProductsV2Request,
        context: { explicitRepurchaseProducts: [productB, productB] },
      }),
      'INVALID_REQUEST',
    );
  });

  it('surfaces the EXPLICIT_REPURCHASE_INTENT reason in the response', async () => {
    const result = await buildSearchProductsV2Harness().service.search({
      ...baseSearchProductsV2Request,
      context: { explicitRepurchaseProducts: [productB] },
    });
    expect(result.recommendations.find((item) => item.product.productId === 'B')?.reasons.some((reason) => reason.code === 'EXPLICIT_REPURCHASE_INTENT')).toBe(true);
  });

  it('does not boost or add the reason for a product outside explicitRepurchaseProducts', async () => {
    const result = await buildSearchProductsV2Harness().service.search({
      ...baseSearchProductsV2Request,
      context: { explicitRepurchaseProducts: [productB] },
    });
    expect(result.recommendations.find((item) => item.product.productId === 'C')?.reasons.some((reason) => reason.code === 'EXPLICIT_REPURCHASE_INTENT')).toBe(false);
  });

  it('keeps prior behavior identical when the request omits explicitRepurchaseProducts', async () => {
    const withField = await buildSearchProductsV2Harness().service.search({ ...baseSearchProductsV2Request, context: { explicitRepurchaseProducts: [] } });
    const without = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(withField.recommendations.map((item) => item.score)).toEqual(without.recommendations.map((item) => item.score));
  });
});

describe('SearchProducts V2 CUSTOMER_MISMATCH (CP-R1-T10B3C)', () => {
  it('maps a T10 CUSTOMER_MISMATCH error to the dedicated error code instead of a generic personalization failure', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.personalization.failWith = new PersonalizedRecommendationError('CUSTOMER_MISMATCH', 'mismatch');
    await expectSearchError(() => harness.service.search(baseSearchProductsV2Request), 'CUSTOMER_MISMATCH');
  });

  it('still validates request-level customerId mismatch as INVALID_REQUEST at the schema boundary', () => {
    expect(searchProductsV2RequestSchema.safeParse({
      sourceProduct: { productId: 'A' },
      customer: { customerId: 'customer-1' },
      context: { customerId: 'other' },
    }).success).toBe(false);
  });
});

describe('SearchProducts V2 per-product commercial warnings (CP-R1-T10B3C)', () => {
  it('preserves a T08 warning associated with its own recommendation', async () => {
    const commercialResult = commercialResultFor([
      commercialRecommendationFor(productB, 1, 80, { warnings: [{ code: 'ALREADY_PURCHASED' }] }),
      commercialRecommendationFor(productC, 2, 70),
      commercialRecommendationFor(productD, 3, 60),
    ]);
    const result = await buildSearchProductsV2Harness({ commercialResult }).service.search(baseSearchProductsV2Request);
    expect(result.recommendations.find((item) => item.product.productId === 'B')?.warnings).toEqual([{ code: 'UPSTREAM_COMMERCIAL_WARNING' }]);
    expect(result.recommendations.find((item) => item.product.productId === 'C')?.warnings).toEqual([]);
  });

  it('tags the global commercial warning entry with the specific product identity', async () => {
    const commercialResult = commercialResultFor([
      commercialRecommendationFor(productB, 1, 80, { warnings: [{ code: 'ALREADY_PURCHASED' }] }),
      commercialRecommendationFor(productC, 2, 70),
      commercialRecommendationFor(productD, 3, 60),
    ]);
    const result = await buildSearchProductsV2Harness({ commercialResult }).service.search(baseSearchProductsV2Request);
    const globalWarning = result.warnings.find((item) => item.code === 'UPSTREAM_COMMERCIAL_WARNING');
    expect(globalWarning?.product).toEqual(productB);
  });

  it('does not exclude a product because it carries an ALREADY_PURCHASED warning', async () => {
    const commercialResult = commercialResultFor([
      commercialRecommendationFor(productB, 1, 80, { warnings: [{ code: 'ALREADY_PURCHASED' }] }),
      commercialRecommendationFor(productC, 2, 70),
      commercialRecommendationFor(productD, 3, 60),
    ]);
    const result = await buildSearchProductsV2Harness({ commercialResult }).service.search(baseSearchProductsV2Request);
    expect(result.recommendations.some((item) => item.product.productId === 'B')).toBe(true);
    expect(result.excluded.some((item) => item.product.productId === 'B')).toBe(false);
  });

  it('does not duplicate a global warning entry shared by multiple products with the same code', async () => {
    const commercialResult = commercialResultFor([
      commercialRecommendationFor(productB, 1, 80, { warnings: [{ code: 'LOW_STOCK' }] }),
      commercialRecommendationFor(productC, 2, 70, { warnings: [{ code: 'LOW_STOCK' }] }),
      commercialRecommendationFor(productD, 3, 60),
    ]);
    const result = await buildSearchProductsV2Harness({ commercialResult }).service.search(baseSearchProductsV2Request);
    const lowStockWarnings = result.warnings.filter((item) => item.code === 'UPSTREAM_COMMERCIAL_WARNING');
    expect(lowStockWarnings).toHaveLength(2);
    expect(new Set(lowStockWarnings.map((item) => item.product?.productId))).toEqual(new Set(['B', 'C']));
  });

  it('counts per-recommendation warnings in warningsGenerated without double counting', async () => {
    const commercialResult = commercialResultFor([
      commercialRecommendationFor(productB, 1, 80, { warnings: [{ code: 'ALREADY_PURCHASED' }] }),
      commercialRecommendationFor(productC, 2, 70),
      commercialRecommendationFor(productD, 3, 60),
    ]);
    const result = await buildSearchProductsV2Harness({ commercialResult }).service.search(baseSearchProductsV2Request);
    const productWarnings = result.recommendations.reduce((count, item) => count + item.warnings.length, 0);
    expect(result.statistics.warningsGenerated).toBe(result.warnings.length + productWarnings);
  });
});

describe('SearchProducts V2 backward compatibility (CP-R1-T10B3C)', () => {
  it('still accepts a request with none of the new fields', async () => {
    expect(searchProductsV2RequestSchema.safeParse(baseSearchProductsV2Request).success).toBe(true);
  });

  it('still produces a schema-valid response for a request predating explicitRepurchaseProducts and ownership', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(searchProductsV2ResultSchema.safeParse(result).success).toBe(true);
  });

  it('keeps explicitRepurchaseProducts and ownership optional in the schemas', () => {
    expect(searchProductsV2ContextSchema.safeParse({}).success).toBe(true);
  });
});
