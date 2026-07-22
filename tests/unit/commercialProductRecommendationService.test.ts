import { describe, expect, it } from 'vitest';
import {
  DefaultActiveProductRelationshipSnapshotReader,
  DefaultProductRelationshipRuntimeIndexBuilder,
} from '../../src/domain/recommendation/relationship-engine/runtime/index.js';
import {
  DefaultCommercialProductRecommendationService,
  DefaultProductRecommendationEligibilityEvaluator,
  DefaultProductRecommendationRanker,
  DefaultProductRecommendationScorer,
  InMemoryProductRelationshipSnapshotStore,
  ProductRecommendationError,
  type ProductRecommendationCommercialDataProvider,
} from '../../src/domain/recommendation/relationship-engine/index.js';
import {
  baseRecommendationRequest,
  clone,
  commercialDataFor,
  commercialDataMap,
  FakeActiveProductRelationshipSnapshotReader,
  FakeCommercialDataProvider,
  realT07SnapshotForRecommendation,
  relationshipTo,
} from '../fixtures/productRecommendation.js';

function service(
  relationships = [relationshipTo('B'), relationshipTo('C')],
  provider: ProductRecommendationCommercialDataProvider = new FakeCommercialDataProvider(
    commercialDataMap([commercialDataFor('B'), commercialDataFor('C')]),
  ),
  reader = new FakeActiveProductRelationshipSnapshotReader(relationships),
) {
  return {
    service: new DefaultCommercialProductRecommendationService(
      reader,
      provider,
      new DefaultProductRecommendationEligibilityEvaluator(),
      new DefaultProductRecommendationScorer(),
      new DefaultProductRecommendationRanker(),
      { defaultLimit: 5, maximumLimit: 20 },
    ),
    reader,
    provider,
  };
}

async function expectRecommendationError(action: () => Promise<unknown>, code: ProductRecommendationError['code']) {
  await expect(action()).rejects.toThrow(ProductRecommendationError);
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProductRecommendationError);
    expect((error as ProductRecommendationError).code).toBe(code);
  }
}

describe('DefaultCommercialProductRecommendationService request validation', () => {
  it('accepts a minimal request', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).recommendations).toHaveLength(2);
  });

  it('accepts a full context', async () => {
    const result = await service().service.recommend({
      ...baseRecommendationRequest,
      customerId: 'customer-1',
      cartProducts: [{ productId: 'X' }],
      alreadyPurchasedProducts: [{ productId: 'Y' }],
      excludedProducts: [{ productId: 'Z' }],
      relationshipTypes: ['same_order'],
      limit: 1,
      includeOutOfStock: true,
      recommendationContext: {
        channel: 'whatsapp',
        intent: 'purchase',
        budget: { currency: 'CLP', minimum: 1000, maximum: 20000 },
      },
    });
    expect(result.recommendations).toHaveLength(1);
  });

  it('rejects invalid source product', async () => {
    await expectRecommendationError(() => service().service.recommend({ sourceProduct: { productId: '' } }), 'INVALID_RECOMMENDATION_REQUEST');
  });

  it('rejects zero limit', async () => {
    await expectRecommendationError(() => service().service.recommend({ ...baseRecommendationRequest, limit: 0 }), 'INVALID_RECOMMENDATION_REQUEST');
  });

  it('rejects negative limit', async () => {
    await expectRecommendationError(() => service().service.recommend({ ...baseRecommendationRequest, limit: -1 }), 'INVALID_RECOMMENDATION_REQUEST');
  });

  it('rejects decimal limit', async () => {
    await expectRecommendationError(() => service().service.recommend({ ...baseRecommendationRequest, limit: 1.5 }), 'INVALID_RECOMMENDATION_REQUEST');
  });

  it('rejects limit above maximum', async () => {
    await expectRecommendationError(() => service().service.recommend({ ...baseRecommendationRequest, limit: 21 }), 'INVALID_RECOMMENDATION_REQUEST');
  });

  it('rejects negative budget', async () => {
    await expectRecommendationError(
      () => service().service.recommend({ ...baseRecommendationRequest, recommendationContext: { budget: { currency: 'CLP', minimum: -1 } } }),
      'INVALID_RECOMMENDATION_REQUEST',
    );
  });

  it('rejects minimum greater than maximum', async () => {
    await expectRecommendationError(
      () => service().service.recommend({ ...baseRecommendationRequest, recommendationContext: { budget: { currency: 'CLP', minimum: 2, maximum: 1 } } }),
      'INVALID_RECOMMENDATION_REQUEST',
    );
  });

  it('rejects empty currency', async () => {
    await expectRecommendationError(
      () => service().service.recommend({ ...baseRecommendationRequest, recommendationContext: { budget: { currency: '' } } }),
      'INVALID_RECOMMENDATION_REQUEST',
    );
  });

  it('does not modify request', async () => {
    const request = clone({ ...baseRecommendationRequest, cartProducts: [{ productId: 'X' }] });
    const before = clone(request);
    await service().service.recommend(request);
    expect(request).toEqual(before);
  });
});

describe('DefaultCommercialProductRecommendationService candidate retrieval', () => {
  it('consults T07 once', async () => {
    const context = service();
    await context.service.recommend(baseRecommendationRequest);
    expect(context.reader.calls).toHaveLength(1);
  });

  it('uses the requested sourceProduct', async () => {
    const context = service();
    await context.service.recommend({ sourceProduct: { productId: 'A', combinationId: '10' } });
    expect(context.reader.calls[0]?.sourceProduct).toEqual({ productId: 'A', combinationId: '10' });
  });

  it('passes relationshipTypes to T07', async () => {
    const context = service();
    await context.service.recommend({ ...baseRecommendationRequest, relationshipTypes: ['same_order'] });
    expect(context.reader.calls[0]?.relationshipTypes).toEqual(['same_order']);
  });

  it('does not pass limit to T07', async () => {
    const context = service();
    await context.service.recommend({ ...baseRecommendationRequest, limit: 1 });
    expect(context.reader.calls[0]).not.toHaveProperty('limit');
  });

  it('translates reader not loaded', async () => {
    await expectRecommendationError(
      () => service([relationshipTo('B')], undefined, new FakeActiveProductRelationshipSnapshotReader([relationshipTo('B')], false)).service.recommend(baseRecommendationRequest),
      'RECOMMENDATION_KNOWLEDGE_NOT_LOADED',
    );
  });

  it('returns empty when source has no relationships', async () => {
    const context = service([], new FakeCommercialDataProvider(commercialDataMap([])), new FakeActiveProductRelationshipSnapshotReader([]));
    expect((await context.service.recommend(baseRecommendationRequest)).recommendations).toEqual([]);
  });

  it('does not call provider when there are no candidates', async () => {
    const provider = new FakeCommercialDataProvider(commercialDataMap([]));
    await service([], provider, new FakeActiveProductRelationshipSnapshotReader([])).service.recommend(baseRecommendationRequest);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('DefaultCommercialProductRecommendationService deduplication', () => {
  it('keeps a single recommendation per target', async () => {
    const result = await service([relationshipTo('B'), relationshipTo('B', { reliability: 0.9 })], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest);
    expect(result.recommendations).toHaveLength(1);
  });

  it('counts duplicate candidates', async () => {
    const result = await service([relationshipTo('B'), relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest);
    expect(result.statistics.duplicatesRemoved).toBe(1);
  });

  it('chooses the highest reliability relationship', async () => {
    const result = await service([relationshipTo('B', { reliability: 0.1 }), relationshipTo('B', { reliability: 0.9 })], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest);
    expect(result.recommendations[0]?.relationship.reliability).toBe(0.9);
  });

  it('breaks duplicate ties by lift', async () => {
    const result = await service([
      relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 10, support: 0.2, confidence: 0.5, lift: 1.1 } }),
      relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 10, support: 0.2, confidence: 0.5, lift: 3 } }),
    ], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest);
    expect(result.recommendations[0]?.relationship.evidence).toHaveProperty('lift', 3);
  });

  it('breaks duplicate ties by confidence', async () => {
    const result = await service([
      relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 10, support: 0.2, confidence: 0.1, lift: 2 } }),
      relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 10, support: 0.2, confidence: 0.8, lift: 2 } }),
    ], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest);
    expect(result.recommendations[0]?.relationship.evidence).toHaveProperty('confidence', 0.8);
  });

  it('breaks duplicate ties by support', async () => {
    const result = await service([
      relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 10, support: 0.1, confidence: 0.5, lift: 2 } }),
      relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 10, support: 0.4, confidence: 0.5, lift: 2 } }),
    ], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest);
    expect(result.recommendations[0]?.relationship.evidence).toHaveProperty('support', 0.4);
  });

  it('breaks duplicate ties by jointCount', async () => {
    const result = await service([
      relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 1, support: 0.2, confidence: 0.5, lift: 2 } }),
      relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 20, support: 0.2, confidence: 0.5, lift: 2 } }),
    ], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest);
    expect(result.recommendations[0]?.relationship.evidence).toHaveProperty('jointCount', 20);
  });

  it('keeps duplicate relationships in rejectedCandidates', async () => {
    const result = await service([relationshipTo('B'), relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest);
    expect(result.rejectedCandidates[0]?.rejectionReasons[0]?.code).toBe('DUPLICATE_TARGET');
  });
});

describe('DefaultCommercialProductRecommendationService commercial data provider', () => {
  it('requests commercial data in batch', async () => {
    const provider = new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B'), commercialDataFor('C')]));
    await service([relationshipTo('B'), relationshipTo('C')], provider).service.recommend(baseRecommendationRequest);
    expect(provider.calls[0]?.products).toHaveLength(2);
  });

  it('requests only unique targets', async () => {
    const provider = new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]));
    await service([relationshipTo('B'), relationshipTo('B')], provider).service.recommend(baseRecommendationRequest);
    expect(provider.calls[0]?.products).toHaveLength(1);
  });

  it('passes context to provider', async () => {
    const provider = new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]));
    await service([relationshipTo('B')], provider).service.recommend({
      ...baseRecommendationRequest,
      recommendationContext: { channel: 'web', intent: 'quote' },
    });
    expect(provider.calls[0]?.context).toEqual({ channel: 'web', intent: 'quote' });
  });

  it('calls provider only once', async () => {
    const provider = new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B'), commercialDataFor('C')]));
    await service(undefined, provider).service.recommend(baseRecommendationRequest);
    expect(provider.calls).toHaveLength(1);
  });

  it('wraps provider failure', async () => {
    const provider = new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]));
    provider.failWith = new Error('provider down');
    await expectRecommendationError(() => service([relationshipTo('B')], provider).service.recommend(baseRecommendationRequest), 'COMMERCIAL_DATA_PROVIDER_FAILURE');
  });

  it('rejects missing commercial data', async () => {
    const result = await service([relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([]))).service.recommend(baseRecommendationRequest);
    expect(result.rejectedCandidates[0]?.rejectionReasons[0]?.code).toBe('MISSING_COMMERCIAL_DATA');
  });

  it('rejects invalid commercial data', async () => {
    const provider = new FakeCommercialDataProvider(new Map([['B::<base>', { ...commercialDataFor('B'), price: { currency: '', amount: 1 } }]]));
    await expectRecommendationError(() => service([relationshipTo('B')], provider).service.recommend(baseRecommendationRequest), 'INVALID_COMMERCIAL_DATA');
  });

  it('rejects commercial data whose product identity does not match the requested product', async () => {
    const provider = new FakeCommercialDataProvider(new Map([['B::<base>', commercialDataFor('C')]]));
    await expectRecommendationError(() => service([relationshipTo('B')], provider).service.recommend(baseRecommendationRequest), 'INVALID_COMMERCIAL_DATA');
  });
});

describe('DefaultCommercialProductRecommendationService eligibility, limit, and statistics', () => {
  it('rejects unavailable candidates', async () => {
    const result = await service([relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B', { available: false, stockStatus: 'out_of_stock' })]))).service.recommend(baseRecommendationRequest);
    expect(result.rejectedCandidates[0]?.rejectionReasons[0]?.code).toBe('OUT_OF_STOCK');
  });

  it('does not include rejected candidates in recommendations', async () => {
    const result = await service([relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B', { active: false })]))).service.recommend(baseRecommendationRequest);
    expect(result.recommendations).toHaveLength(0);
  });

  it('applies default limit', async () => {
    const relationships = Array.from({ length: 6 }, (_, index) => relationshipTo(String.fromCharCode(66 + index)));
    const data = relationships.map((relationship) => commercialDataFor(relationship.targetProduct.productId));
    const result = await service(relationships, new FakeCommercialDataProvider(commercialDataMap(data))).service.recommend(baseRecommendationRequest);
    expect(result.recommendations).toHaveLength(5);
  });

  it('applies explicit limit', async () => {
    const result = await service().service.recommend({ ...baseRecommendationRequest, limit: 1 });
    expect(result.recommendations).toHaveLength(1);
  });

  it('applies limit after ranking', async () => {
    const result = await service(
      [relationshipTo('B', { reliability: 0.1 }), relationshipTo('C', { reliability: 0.9 })],
      new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B'), commercialDataFor('C')])),
    ).service.recommend({ ...baseRecommendationRequest, limit: 1 });
    expect(result.recommendations[0]?.product.productId).toBe('C');
  });

  it('assigns ranks starting at 1', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).recommendations[0]?.rank).toBe(1);
  });

  it('assigns continuous ranks', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).recommendations.map((item) => item.rank)).toEqual([1, 2]);
  });

  it('reports relationshipsRead', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).statistics.relationshipsRead).toBe(2);
  });

  it('reports deduplicatedCandidates', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).statistics.deduplicatedCandidates).toBe(2);
  });

  it('reports eligibleCandidates', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).statistics.eligibleCandidates).toBe(2);
  });

  it('reports rejectedCandidates', async () => {
    const result = await service([relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B', { active: false })]))).service.recommend(baseRecommendationRequest);
    expect(result.statistics.rejectedCandidates).toBe(1);
  });

  it('reports scoredCandidates equal to eligibleCandidates', async () => {
    const stats = (await service().service.recommend(baseRecommendationRequest)).statistics;
    expect(stats.scoredCandidates).toBe(stats.eligibleCandidates);
  });

  it('reports recommendationsReturned', async () => {
    expect((await service().service.recommend({ ...baseRecommendationRequest, limit: 1 })).statistics.recommendationsReturned).toBe(1);
  });

  it('satisfies statistics invariants', async () => {
    const stats = (await service([relationshipTo('B'), relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest)).statistics;
    expect(stats.relationshipsRead).toBe(stats.deduplicatedCandidates + stats.duplicatesRemoved);
    expect(stats.eligibleCandidates + stats.rejectedCandidates).toBe(stats.deduplicatedCandidates + stats.duplicatesRemoved);
    expect(stats.recommendationsReturned).toBeLessThanOrEqual(stats.scoredCandidates);
  });
});

describe('DefaultCommercialProductRecommendationService output details', () => {
  it('includes snapshot metadata', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).snapshot.snapshotId).toBeTruthy();
  });

  it('includes source identity', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).sourceIdentity).toBe('A::<base>');
  });

  it('includes reasons', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).recommendations[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('includes warnings', async () => {
    const result = await service([relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B', { stockStatus: 'unknown' })]))).service.recommend(baseRecommendationRequest);
    expect(result.recommendations[0]?.warnings[0]?.code).toBe('UNKNOWN_STOCK');
  });

  it('includes scores', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).recommendations[0]?.score.total).toBeGreaterThan(0);
  });

  it('preserves relationship evidence', async () => {
    expect((await service().service.recommend(baseRecommendationRequest)).recommendations[0]?.relationship.evidence).toHaveProperty('jointCount');
  });

  it('preserves reliability', async () => {
    expect((await service([relationshipTo('B', { reliability: 0.321 })], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest)).recommendations[0]?.relationship.reliability).toBe(0.321);
  });

  it('freezes recommendations', async () => {
    expect(Object.isFrozen((await service().service.recommend(baseRecommendationRequest)).recommendations)).toBe(true);
  });

  it('freezes rejectedCandidates', async () => {
    expect(Object.isFrozen((await service([relationshipTo('B'), relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B')]))).service.recommend(baseRecommendationRequest)).rejectedCandidates)).toBe(true);
  });

  it('freezes score objects', async () => {
    expect(Object.isFrozen((await service().service.recommend(baseRecommendationRequest)).recommendations[0]?.score)).toBe(true);
  });

  it('freezes reasons and warnings', async () => {
    const recommendation = (await service().service.recommend(baseRecommendationRequest)).recommendations[0];
    expect(Object.isFrozen(recommendation?.reasons)).toBe(true);
    expect(Object.isFrozen(recommendation?.warnings)).toBe(true);
  });

  it('mutating provider response after service call does not affect result', async () => {
    const record = commercialDataFor('B');
    const result = await service([relationshipTo('B')], new FakeCommercialDataProvider(commercialDataMap([record]))).service.recommend(baseRecommendationRequest);
    record.stockStatus = 'out_of_stock';
    expect(result.recommendations[0]?.commercialData.stockStatus).toBe('in_stock');
  });

  it('same input produces same result', async () => {
    const first = await service().service.recommend(baseRecommendationRequest);
    const second = await service().service.recommend(baseRecommendationRequest);
    expect(second).toEqual(first);
  });

  it('does not use clock, random, or UUID fields', async () => {
    const serialized = JSON.stringify(await service().service.recommend(baseRecommendationRequest));
    expect(serialized).not.toMatch(/generatedAt|createdAt|uuid|random/u);
  });
});

describe('DefaultCommercialProductRecommendationService compatibility', () => {
  it('works with a real T07 reader over a T06 snapshot', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    await store.save(realT07SnapshotForRecommendation);
    await store.activate(realT07SnapshotForRecommendation.snapshotId);
    const reader = new DefaultActiveProductRelationshipSnapshotReader(store, new DefaultProductRelationshipRuntimeIndexBuilder());
    await reader.refresh();
    const result = await service(
      undefined,
      new FakeCommercialDataProvider(commercialDataMap([commercialDataFor('B'), commercialDataFor('C')])),
      reader as unknown as FakeActiveProductRelationshipSnapshotReader,
    ).service.recommend(baseRecommendationRequest);
    expect(result.recommendations).toHaveLength(2);
  });

  it('does not expose SQL, Redis, endpoints, Excel, panel, CRM, e-commerce, or LLM markers', async () => {
    const serialized = JSON.stringify(await service().service.recommend(baseRecommendationRequest)).toLowerCase();
    expect(serialized).not.toMatch(/select |redis|endpoint|excel|panel|crm|e-commerce|llm/u);
  });
});
