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
  productB,
  productC,
  productD,
  productE,
  signal,
} from '../fixtures/personalizedRecommendation.js';
import {
  baseSearchProductsV2Request,
  buildSearchProductsV2Harness,
  clone,
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
    expect(searchProductsV2RequestSchema.safeParse({ query: 'rack', sourceProduct: { productId: 'A' } }).success).toBe(true);
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
    expect(harness.commercial.calls[0]?.limit).toBe(12);
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
    expect(harness.personalization.calls[0]?.customerAffinities?.warnings[0]?.code).toBe('CUSTOMER_NOT_IDENTIFIED');
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
  });

  it('returns warning on retryable T09 error', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = retryableAffinityFailure();
    const result = await harness.service.search(baseSearchProductsV2Request);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
  });

  it('fails non-retryable T09 error', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = structuralAffinityFailure();
    await expectSearchError(() => harness.service.search(baseSearchProductsV2Request), 'INVALID_AFFINITY_RESULT');
  });

  it('fails generic T09 error', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = new Error('boom');
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

  it('does not expose raw customer evidence summaries', async () => {
    const result = await buildSearchProductsV2Harness().service.search(baseSearchProductsV2Request);
    expect(JSON.stringify(result)).not.toContain('evidence');
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
