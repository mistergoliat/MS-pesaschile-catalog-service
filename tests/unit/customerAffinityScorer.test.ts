import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
  DefaultCustomerAffinityScorer,
  type CustomerAffinityEvaluation,
  type CustomerAffinitySignal,
} from '../../src/domain/recommendation/customer-affinity/index.js';
import { productB } from '../fixtures/customerProductAffinity.js';

function evaluation(signals: CustomerAffinitySignal[], validEvidenceCount = signals.length): CustomerAffinityEvaluation {
  return {
    product: productB,
    productIdentity: 'B::<base>',
    signals,
    evidence: signals.map((signal) => ({ code: signal.code, count: 1 })),
    warnings: [],
    validEvidenceCount,
  };
}

function positive(code: CustomerAffinitySignal['code'], strength = 1): CustomerAffinitySignal {
  return { code, direction: 'positive', strength };
}

function negative(code: 'PRODUCT_REJECTION' | 'CATEGORY_REJECTION', strength = 1): CustomerAffinitySignal {
  return { code, direction: 'negative', strength };
}

function score(signals: CustomerAffinitySignal[], validEvidenceCount = signals.length) {
  return new DefaultCustomerAffinityScorer().score(evaluation(signals, validEvidenceCount), DEFAULT_CUSTOMER_AFFINITY_PARAMETERS);
}

describe('DefaultCustomerAffinityScorer scoring', () => {
  it('scores direct purchase signal', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE')]).score).toBeGreaterThan(0);
  });

  it('scores category purchase signal', () => {
    expect(score([positive('CATEGORY_PURCHASE')]).score).toBeGreaterThan(0);
  });

  it('scores brand purchase signal', () => {
    expect(score([positive('BRAND_PURCHASE')]).score).toBeGreaterThan(0);
  });

  it('scores recent product interest signal', () => {
    expect(score([positive('RECENT_PRODUCT_INTEREST')]).score).toBeGreaterThan(score([positive('BRAND_PURCHASE')]).score);
  });

  it('scores recent category interest signal', () => {
    expect(score([positive('RECENT_CATEGORY_INTEREST')]).score).toBeGreaterThan(0);
  });

  it('scores owned compatible product signal', () => {
    expect(score([positive('OWNED_COMPATIBLE_PRODUCT')]).score).toBeGreaterThan(0);
  });

  it('scores repeat purchase pattern signal', () => {
    expect(score([positive('REPEAT_PURCHASE_PATTERN')]).score).toBeGreaterThan(0);
  });

  it('scores observed spend fit signal', () => {
    expect(score([positive('OBSERVED_SPEND_FIT')]).score).toBeGreaterThan(0);
  });

  it('sums positive signals', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE'), positive('CATEGORY_PURCHASE')]).score).toBeGreaterThan(
      score([positive('DIRECT_PRODUCT_PURCHASE')]).score,
    );
  });

  it('clamps lower bound at zero', () => {
    expect(score([negative('PRODUCT_REJECTION')]).score).toBe(0);
  });

  it('clamps upper bound at one', () => {
    expect(score([
      positive('DIRECT_PRODUCT_PURCHASE'),
      positive('CATEGORY_PURCHASE'),
      positive('BRAND_PURCHASE'),
      positive('RECENT_PRODUCT_INTEREST'),
      positive('RECENT_CATEGORY_INTEREST'),
      positive('OWNED_COMPATIBLE_PRODUCT'),
      positive('REPEAT_PURCHASE_PATTERN'),
      positive('OBSERVED_SPEND_FIT'),
    ]).score).toBe(1);
  });

  it('product rejection neutralizes strong positive affinity', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE'), positive('RECENT_PRODUCT_INTEREST'), negative('PRODUCT_REJECTION')]).score).toBe(0);
  });

  it('category rejection penalizes less than product rejection', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE'), positive('RECENT_PRODUCT_INTEREST'), negative('CATEGORY_REJECTION')]).score).toBeGreaterThan(
      score([positive('DIRECT_PRODUCT_PURCHASE'), positive('RECENT_PRODUCT_INTEREST'), negative('PRODUCT_REJECTION')]).score,
    );
  });

  it('uses explicit defaults', () => {
    expect(DEFAULT_CUSTOMER_AFFINITY_PARAMETERS.directProductPurchaseWeight).toBe(0.2);
  });

  it('freezes exported default parameters', () => {
    expect(Object.isFrozen(DEFAULT_CUSTOMER_AFFINITY_PARAMETERS)).toBe(true);
  });

  it('uses custom parameters', () => {
    const custom = new DefaultCustomerAffinityScorer().score(evaluation([positive('DIRECT_PRODUCT_PURCHASE')]), {
      ...DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
      directProductPurchaseWeight: 1,
      categoryPurchaseWeight: 0,
      brandPurchaseWeight: 0,
      recentProductInterestWeight: 0,
      recentCategoryInterestWeight: 0,
      ownedCompatibleProductWeight: 0,
      repeatPurchasePatternWeight: 0,
      observedSpendFitWeight: 0,
    });
    expect(custom.score).toBe(1);
  });

  it('is deterministic', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE')])).toEqual(score([positive('DIRECT_PRODUCT_PURCHASE')]));
  });

  it('score is distinct from confidence', () => {
    const result = score([positive('RECENT_PRODUCT_INTEREST')]);
    expect(result.score).toBeGreaterThan(0);
    expect(result.confidence).toBe('low');
  });
});

describe('DefaultCustomerAffinityScorer confidence', () => {
  it('returns none without evidence', () => {
    expect(score([], 0).confidence).toBe('none');
  });

  it('returns low with one signal', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE')], 1).confidence).toBe('low');
  });

  it('returns medium with diversity and minimum evidence', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE'), positive('CATEGORY_PURCHASE')], 2).confidence).toBe('medium');
  });

  it('returns high with sufficient diversity and evidence', () => {
    expect(score([
      positive('DIRECT_PRODUCT_PURCHASE'),
      positive('CATEGORY_PURCHASE'),
      negative('PRODUCT_REJECTION'),
    ], 3).confidence).toBe('high');
  });

  it('allows high score with low confidence', () => {
    const result = score([positive('RECENT_PRODUCT_INTEREST', 1)], 1);
    expect(result.score).toBeGreaterThan(0.2);
    expect(result.confidence).toBe('low');
  });

  it('allows low score with high confidence', () => {
    const result = score([
      positive('DIRECT_PRODUCT_PURCHASE'),
      positive('CATEGORY_PURCHASE'),
      negative('PRODUCT_REJECTION'),
    ], 3);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe('high');
  });

  it('counts negative evidence for confidence', () => {
    expect(score([negative('PRODUCT_REJECTION'), negative('CATEGORY_REJECTION')], 2).confidence).toBe('medium');
  });

  it('returns scoring version', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE')]).scoringVersion).toBe('customer-affinity-v1');
  });
});
