import { describe, expect, it } from 'vitest';
import {
  DefaultProductRecommendationRanker,
  type ScoredProductRecommendationCandidate,
} from '../../src/domain/recommendation/relationship-engine/recommendation/index.js';
import {
  commercialDataFor,
  relationshipTo,
  clone,
} from '../fixtures/productRecommendation.js';

function candidate(
  productId: string,
  patch: Partial<ScoredProductRecommendationCandidate> = {},
): ScoredProductRecommendationCandidate {
  return {
    product: { productId },
    productIdentity: `${productId}::<base>`,
    relationship: relationshipTo(productId),
    commercialData: commercialDataFor(productId),
    reasons: [],
    warnings: [],
    score: {
      total: 50,
      components: {
        relationship: 40,
        availability: 5,
        compatibility: 5,
        commercial: 0,
        penalties: 0,
      },
    },
    ...patch,
  };
}

function rank(candidates: readonly ScoredProductRecommendationCandidate[]) {
  return new DefaultProductRecommendationRanker().rank(candidates);
}

describe('DefaultProductRecommendationRanker', () => {
  it('orders by score descending', () => {
    expect(rank([
      candidate('B', { score: { ...candidate('B').score, total: 10 } }),
      candidate('C', { score: { ...candidate('C').score, total: 90 } }),
    ])[0]?.productIdentity).toBe('C::<base>');
  });

  it('breaks ties by reliability', () => {
    expect(rank([
      candidate('B', { relationship: relationshipTo('B', { reliability: 0.2 }) }),
      candidate('C', { relationship: relationshipTo('C', { reliability: 0.9 }) }),
    ])[0]?.productIdentity).toBe('C::<base>');
  });

  it('breaks ties by compatibility', () => {
    expect(rank([
      candidate('B', { commercialData: commercialDataFor('B', { compatibilityStatus: 'unknown' }) }),
      candidate('C', { commercialData: commercialDataFor('C', { compatibilityStatus: 'compatible' }) }),
    ])[0]?.productIdentity).toBe('C::<base>');
  });

  it('breaks ties by stock status', () => {
    expect(rank([
      candidate('B', { commercialData: commercialDataFor('B', { stockStatus: 'low_stock' }) }),
      candidate('C', { commercialData: commercialDataFor('C', { stockStatus: 'in_stock' }) }),
    ])[0]?.productIdentity).toBe('C::<base>');
  });

  it('breaks ties by confidence', () => {
    expect(rank([
      candidate('B', { relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.3, confidence: 0.2, lift: 1.5 } }) }),
      candidate('C', { relationship: relationshipTo('C', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.3, confidence: 0.8, lift: 1.5 } }) }),
    ])[0]?.productIdentity).toBe('C::<base>');
  });

  it('breaks ties by lift', () => {
    expect(rank([
      candidate('B', { relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.3, confidence: 0.6, lift: 1.2 } }) }),
      candidate('C', { relationship: relationshipTo('C', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.3, confidence: 0.6, lift: 3 } }) }),
    ])[0]?.productIdentity).toBe('C::<base>');
  });

  it('breaks ties by support', () => {
    expect(rank([
      candidate('B', { relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.1, confidence: 0.6, lift: 1.5 } }) }),
      candidate('C', { relationship: relationshipTo('C', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.4, confidence: 0.6, lift: 1.5 } }) }),
    ])[0]?.productIdentity).toBe('C::<base>');
  });

  it('breaks ties by jointCount', () => {
    expect(rank([
      candidate('B', { relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 3, support: 0.3, confidence: 0.6, lift: 1.5 } }) }),
      candidate('C', { relationship: relationshipTo('C', { evidence: { kind: 'co_occurrence', jointCount: 30, support: 0.3, confidence: 0.6, lift: 1.5 } }) }),
    ])[0]?.productIdentity).toBe('C::<base>');
  });

  it('breaks final ties by product identity', () => {
    expect(rank([candidate('C'), candidate('B')]).map((item) => item.productIdentity)).toEqual(['B::<base>', 'C::<base>']);
  });

  it('is deterministic', () => {
    const input = [candidate('C'), candidate('B')];
    expect(rank(input)).toEqual(rank(input));
  });

  it('does not modify input array', () => {
    const input = [candidate('C'), candidate('B')];
    const before = clone(input);
    rank(input);
    expect(input).toEqual(before);
  });

  it('does not modify candidates', () => {
    const input = [candidate('C'), candidate('B')];
    const before = clone(input[0]);
    rank(input);
    expect(input[0]).toEqual(before);
  });
});
