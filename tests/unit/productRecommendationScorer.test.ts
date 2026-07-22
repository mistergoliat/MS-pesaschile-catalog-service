import { describe, expect, it } from 'vitest';
import {
  DefaultProductRecommendationScorer,
  type EligibleProductRecommendationCandidate,
} from '../../src/domain/recommendation/relationship-engine/recommendation/index.js';
import {
  commercialDataFor,
  relationshipTo,
  clone,
} from '../fixtures/productRecommendation.js';

function candidate(patch: Partial<EligibleProductRecommendationCandidate> = {}): EligibleProductRecommendationCandidate {
  return {
    product: { productId: 'B' },
    productIdentity: 'B::<base>',
    relationship: relationshipTo('B'),
    commercialData: commercialDataFor('B'),
    reasons: [],
    warnings: [],
    ...patch,
  };
}

function score(patch: Partial<EligibleProductRecommendationCandidate> = {}) {
  return new DefaultProductRecommendationScorer().score(candidate(patch));
}

describe('DefaultProductRecommendationScorer', () => {
  it('is deterministic', () => {
    expect(score()).toEqual(score());
  });

  it('keeps score between 0 and 100', () => {
    expect(score().total).toBeGreaterThanOrEqual(0);
    expect(score().total).toBeLessThanOrEqual(100);
  });

  it('increases when reliability increases', () => {
    const low = score({ relationship: relationshipTo('B', { reliability: 0.1 }) }).total;
    const high = score({ relationship: relationshipTo('B', { reliability: 0.9 }) }).total;
    expect(high).toBeGreaterThan(low);
  });

  it('increases when confidence increases', () => {
    const low = score({ relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.3, confidence: 0.1, lift: 1.5 } }) }).total;
    const high = score({ relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.3, confidence: 0.9, lift: 1.5 } }) }).total;
    expect(high).toBeGreaterThan(low);
  });

  it('increases when lift increases', () => {
    const low = score({ relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.3, confidence: 0.6, lift: 1 } }) }).total;
    const high = score({ relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.3, confidence: 0.6, lift: 4 } }) }).total;
    expect(high).toBeGreaterThan(low);
  });

  it('increases when support increases', () => {
    const low = score({ relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.01, confidence: 0.6, lift: 1.5 } }) }).total;
    const high = score({ relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.1, confidence: 0.6, lift: 1.5 } }) }).total;
    expect(high).toBeGreaterThan(low);
  });

  it('adds in stock availability bonus', () => {
    expect(score({ commercialData: commercialDataFor('B', { stockStatus: 'in_stock' }) }).components.availability).toBe(5);
  });

  it('adds smaller low stock availability bonus', () => {
    expect(score({ commercialData: commercialDataFor('B', { stockStatus: 'low_stock' }) }).components.availability).toBe(2);
  });

  it('penalizes out of stock availability', () => {
    expect(score({ commercialData: commercialDataFor('B', { stockStatus: 'out_of_stock', available: false }) }).components.availability).toBe(-15);
  });

  it('adds compatible bonus', () => {
    expect(score({ commercialData: commercialDataFor('B', { compatibilityStatus: 'compatible' }) }).components.compatibility).toBe(5);
  });

  it('adds high margin bonus', () => {
    expect(score({ commercialData: commercialDataFor('B', { marginSignal: 'high' }) }).components.commercial).toBe(3);
  });

  it('adds medium margin bonus', () => {
    expect(score({ commercialData: commercialDataFor('B', { marginSignal: 'medium' }) }).components.commercial).toBe(2);
  });

  it('applies already-in-cart penalty', () => {
    expect(score({ warnings: [{ code: 'ALREADY_IN_CART' }] }).components.penalties).toBe(-20);
  });

  it('applies out-of-stock included penalty', () => {
    expect(score({ warnings: [{ code: 'OUT_OF_STOCK_INCLUDED' }] }).components.penalties).toBe(-15);
  });

  it('applies price unavailable penalty', () => {
    expect(score({ warnings: [{ code: 'PRICE_UNAVAILABLE' }] }).components.penalties).toBe(-2);
  });

  it('applies currency mismatch penalty', () => {
    expect(score({ warnings: [{ code: 'CURRENCY_MISMATCH' }] }).components.penalties).toBe(-2);
  });

  it('never returns NaN', () => {
    expect(Number.isNaN(score().total)).toBe(false);
  });

  it('never returns Infinity', () => {
    expect(Number.isFinite(score().total)).toBe(true);
  });

  it('does not modify relationship', () => {
    const relationship = relationshipTo('B');
    const before = clone(relationship);
    score({ relationship });
    expect(relationship).toEqual(before);
  });

  it('does not recalculate reliability', () => {
    const relationship = relationshipTo('B', { reliability: 0.123 });
    score({ relationship });
    expect(relationship.reliability).toBe(0.123);
  });

  it('clamps high scores at 100', () => {
    const result = score({
      relationship: relationshipTo('B', { reliability: 1, evidence: { kind: 'co_occurrence', jointCount: 100, support: 1, confidence: 1, lift: 100 } }),
      commercialData: commercialDataFor('B', { stockStatus: 'in_stock', marginSignal: 'high', compatibilityStatus: 'compatible' }),
    });
    expect(result.total).toBeLessThanOrEqual(100);
  });
});
