import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
  DefaultCustomerAffinityScorer,
  customerAffinityParametersSchema,
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
  it('does not score a DIRECT_PRODUCT_PURCHASE signal', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE')]).score).toBe(0);
  });

  it('does not let DIRECT_PRODUCT_PURCHASE change the score of another signal', () => {
    const withDirectPurchase = score([positive('CATEGORY_PURCHASE'), positive('DIRECT_PRODUCT_PURCHASE')]);
    const withoutDirectPurchase = score([positive('CATEGORY_PURCHASE')]);
    expect(withDirectPurchase.score).toBe(withoutDirectPurchase.score);
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
    expect(score([positive('CATEGORY_PURCHASE'), positive('BRAND_PURCHASE')]).score).toBeGreaterThan(
      score([positive('CATEGORY_PURCHASE')]).score,
    );
  });

  it('clamps lower bound at zero', () => {
    expect(score([negative('PRODUCT_REJECTION')]).score).toBe(0);
  });

  it('reaches an effective ceiling of 0.80 with every remaining default signal maxed', () => {
    expect(score([
      positive('CATEGORY_PURCHASE'),
      positive('BRAND_PURCHASE'),
      positive('RECENT_PRODUCT_INTEREST'),
      positive('RECENT_CATEGORY_INTEREST'),
      positive('OWNED_COMPATIBLE_PRODUCT'),
      positive('REPEAT_PURCHASE_PATTERN'),
      positive('OBSERVED_SPEND_FIT'),
    ]).score).toBe(0.8);
  });

  it('still clamps the raw score at one as a safety net (the 0.20 reserve makes this unreachable through normal 0..1 signal strengths)', () => {
    const overshoot = new DefaultCustomerAffinityScorer().score(evaluation([positive('CATEGORY_PURCHASE', 2)]), {
      ...DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
      categoryPurchaseWeight: 1,
      brandPurchaseWeight: 0,
      recentProductInterestWeight: 0,
      recentCategoryInterestWeight: 0,
      ownedCompatibleProductWeight: 0,
      repeatPurchasePatternWeight: 0,
      observedSpendFitWeight: 0,
    });
    expect(overshoot.score).toBe(1);
  });

  it('product rejection neutralizes strong positive affinity', () => {
    expect(score([positive('CATEGORY_PURCHASE'), positive('RECENT_PRODUCT_INTEREST'), negative('PRODUCT_REJECTION')]).score).toBe(0);
  });

  it('category rejection penalizes less than product rejection', () => {
    expect(score([positive('CATEGORY_PURCHASE'), positive('RECENT_PRODUCT_INTEREST'), negative('CATEGORY_REJECTION')]).score).toBeGreaterThan(
      score([positive('CATEGORY_PURCHASE'), positive('RECENT_PRODUCT_INTEREST'), negative('PRODUCT_REJECTION')]).score,
    );
  });

  it('does not materialize directProductPurchaseWeight in the default parameters', () => {
    expect('directProductPurchaseWeight' in DEFAULT_CUSTOMER_AFFINITY_PARAMETERS).toBe(false);
  });

  it('uses an explicit default repeatPurchaseWindowDays', () => {
    expect(DEFAULT_CUSTOMER_AFFINITY_PARAMETERS.repeatPurchaseWindowDays).toBe(365);
  });

  it('freezes exported default parameters', () => {
    expect(Object.isFrozen(DEFAULT_CUSTOMER_AFFINITY_PARAMETERS)).toBe(true);
  });

  it('uses custom parameters, still subject to the fixed 0.20 reserve', () => {
    const custom = new DefaultCustomerAffinityScorer().score(evaluation([positive('CATEGORY_PURCHASE')]), {
      ...DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
      categoryPurchaseWeight: 0.8,
      brandPurchaseWeight: 0,
      recentProductInterestWeight: 0,
      recentCategoryInterestWeight: 0,
      ownedCompatibleProductWeight: 0,
      repeatPurchasePatternWeight: 0,
      observedSpendFitWeight: 0,
    });
    expect(custom.score).toBe(0.8);
  });

  it('is deterministic', () => {
    expect(score([positive('CATEGORY_PURCHASE')])).toEqual(score([positive('CATEGORY_PURCHASE')]));
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

  it('returns none for a DIRECT_PRODUCT_PURCHASE-only evaluation', () => {
    expect(score([positive('DIRECT_PRODUCT_PURCHASE')], 1).confidence).toBe('none');
  });

  it('returns low with one signal', () => {
    expect(score([positive('CATEGORY_PURCHASE')], 1).confidence).toBe('low');
  });

  it('returns medium with diversity and minimum evidence', () => {
    expect(score([positive('CATEGORY_PURCHASE'), positive('BRAND_PURCHASE')], 2).confidence).toBe('medium');
  });

  it('does not count DIRECT_PRODUCT_PURCHASE toward signal diversity', () => {
    const withoutDirectPurchase = score([positive('CATEGORY_PURCHASE')], 1).confidence;
    const withDirectPurchase = score([positive('CATEGORY_PURCHASE'), positive('DIRECT_PRODUCT_PURCHASE')], 2).confidence;
    expect(withDirectPurchase).toBe(withoutDirectPurchase);
  });

  it('returns high with sufficient diversity and evidence', () => {
    expect(score([
      positive('CATEGORY_PURCHASE'),
      positive('BRAND_PURCHASE'),
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
      positive('CATEGORY_PURCHASE'),
      positive('BRAND_PURCHASE'),
      negative('PRODUCT_REJECTION'),
    ], 3);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe('high');
  });

  it('counts negative evidence for confidence', () => {
    expect(score([negative('PRODUCT_REJECTION'), negative('CATEGORY_REJECTION')], 2).confidence).toBe('medium');
  });

  it('returns scoring version', () => {
    expect(score([positive('CATEGORY_PURCHASE')]).scoringVersion).toBe('customer-affinity-v2');
  });
});

describe('DefaultCustomerAffinityScorer v2 exact scale (CP-R1-T10B3B correction)', () => {
  it('CATEGORY_PURCHASE at strength 1 scores 0.10', () => {
    expect(score([positive('CATEGORY_PURCHASE')]).score).toBe(0.10);
  });

  it('BRAND_PURCHASE at strength 1 scores 0.05', () => {
    expect(score([positive('BRAND_PURCHASE')]).score).toBe(0.05);
  });

  it('RECENT_PRODUCT_INTEREST at strength 1 scores 0.25', () => {
    expect(score([positive('RECENT_PRODUCT_INTEREST')]).score).toBe(0.25);
  });

  it('RECENT_CATEGORY_INTEREST at strength 1 scores 0.10', () => {
    expect(score([positive('RECENT_CATEGORY_INTEREST')]).score).toBe(0.10);
  });

  it('OWNED_COMPATIBLE_PRODUCT at strength 1 scores 0.15', () => {
    expect(score([positive('OWNED_COMPATIBLE_PRODUCT')]).score).toBe(0.15);
  });

  it('REPEAT_PURCHASE_PATTERN at strength 1 scores 0.10', () => {
    expect(score([positive('REPEAT_PURCHASE_PATTERN')]).score).toBe(0.10);
  });

  it('OBSERVED_SPEND_FIT at strength 1 scores 0.05', () => {
    expect(score([positive('OBSERVED_SPEND_FIT')]).score).toBe(0.05);
  });

  it('every remaining signal combined scores 0.80, matching the documented v2 ceiling', () => {
    expect(score([
      positive('CATEGORY_PURCHASE'),
      positive('BRAND_PURCHASE'),
      positive('RECENT_PRODUCT_INTEREST'),
      positive('RECENT_CATEGORY_INTEREST'),
      positive('OWNED_COMPATIBLE_PRODUCT'),
      positive('REPEAT_PURCHASE_PATTERN'),
      positive('OBSERVED_SPEND_FIT'),
    ]).score).toBe(0.80);
  });
});

describe('legacy directProductPurchaseWeight compatibility (CP-R1-T10B3B correction)', () => {
  it('accepts a v1-shaped parameters object that includes directProductPurchaseWeight', () => {
    const v1Shaped = { ...DEFAULT_CUSTOMER_AFFINITY_PARAMETERS, directProductPurchaseWeight: 0.2 };
    expect(customerAffinityParametersSchema.safeParse(v1Shaped).success).toBe(true);
  });

  it('accepts a v2 parameters object that omits directProductPurchaseWeight', () => {
    expect(customerAffinityParametersSchema.safeParse(DEFAULT_CUSTOMER_AFFINITY_PARAMETERS).success).toBe(true);
  });

  it('rejects a negative directProductPurchaseWeight', () => {
    const invalid = { ...DEFAULT_CUSTOMER_AFFINITY_PARAMETERS, directProductPurchaseWeight: -0.1 };
    expect(customerAffinityParametersSchema.safeParse(invalid).success).toBe(false);
  });

  it('does not change the score when the legacy value changes between 0 and 1', () => {
    const withZero = new DefaultCustomerAffinityScorer().score(
      evaluation([positive('CATEGORY_PURCHASE')]),
      { ...DEFAULT_CUSTOMER_AFFINITY_PARAMETERS, directProductPurchaseWeight: 0 },
    );
    const withOne = new DefaultCustomerAffinityScorer().score(
      evaluation([positive('CATEGORY_PURCHASE')]),
      { ...DEFAULT_CUSTOMER_AFFINITY_PARAMETERS, directProductPurchaseWeight: 1 },
    );
    expect(withZero.score).toBe(withOne.score);
    expect(withZero.score).toBe(0.10);
  });
});
