import { describe, expect, it } from 'vitest';
import {
  DefaultProductRecommendationEligibilityEvaluator,
  type ProductRecommendationCandidateContext,
} from '../../src/domain/recommendation/relationship-engine/recommendation/index.js';
import {
  baseRecommendationRequest,
  commercialDataFor,
  relationshipTo,
} from '../fixtures/productRecommendation.js';

function evaluate(patch: Partial<ProductRecommendationCandidateContext> = {}) {
  return new DefaultProductRecommendationEligibilityEvaluator().evaluate({
    request: baseRecommendationRequest,
    relationship: relationshipTo('B'),
    commercialData: commercialDataFor('B'),
    ...patch,
  });
}

describe('DefaultProductRecommendationEligibilityEvaluator mandatory rules', () => {
  it('accepts a normal candidate', () => {
    expect(evaluate()).toMatchObject({ eligible: true });
  });

  it('rejects source product', () => {
    expect(evaluate({ relationship: relationshipTo('A') })).toMatchObject({
      eligible: false,
      rejectionReasons: [{ code: 'SOURCE_PRODUCT' }],
    });
  });

  it('rejects explicitly excluded products', () => {
    expect(evaluate({ request: { ...baseRecommendationRequest, excludedProducts: [{ productId: 'B' }] } })).toMatchObject({
      eligible: false,
      rejectionReasons: [{ code: 'EXPLICITLY_EXCLUDED' }],
    });
  });

  it('rejects inactive products', () => {
    expect(evaluate({ commercialData: commercialDataFor('B', { active: false }) })).toMatchObject({
      eligible: false,
      rejectionReasons: [{ code: 'INACTIVE' }],
    });
  });

  it('rejects not sellable products', () => {
    expect(evaluate({ commercialData: commercialDataFor('B', { sellable: false }) })).toMatchObject({
      eligible: false,
      rejectionReasons: [{ code: 'NOT_SELLABLE' }],
    });
  });

  it('rejects out of stock products by default', () => {
    expect(evaluate({ commercialData: commercialDataFor('B', { stockStatus: 'out_of_stock', available: false }) })).toMatchObject({
      eligible: false,
      rejectionReasons: [{ code: 'OUT_OF_STOCK' }],
    });
  });

  it('includes out of stock products when request allows it', () => {
    expect(evaluate({
      request: { ...baseRecommendationRequest, includeOutOfStock: true },
      commercialData: commercialDataFor('B', { stockStatus: 'out_of_stock', available: false }),
    })).toMatchObject({ eligible: true });
  });

  it('warns when out of stock is included', () => {
    const result = evaluate({
      request: { ...baseRecommendationRequest, includeOutOfStock: true },
      commercialData: commercialDataFor('B', { stockStatus: 'out_of_stock', available: false }),
    });
    expect(result).toMatchObject({ eligible: true, warnings: [{ code: 'OUT_OF_STOCK_INCLUDED' }] });
  });

  it('rejects incompatible products', () => {
    expect(evaluate({ commercialData: commercialDataFor('B', { compatibilityStatus: 'incompatible' }) })).toMatchObject({
      eligible: false,
      rejectionReasons: [{ code: 'INCOMPATIBLE' }],
    });
  });

  it('warns for unknown compatibility by default', () => {
    expect(evaluate({ commercialData: commercialDataFor('B', { compatibilityStatus: 'unknown' }) })).toMatchObject({
      eligible: true,
      warnings: [{ code: 'UNKNOWN_COMPATIBILITY' }],
    });
  });

  it('rejects unknown compatibility when configured', () => {
    const evaluator = new DefaultProductRecommendationEligibilityEvaluator({
      excludeCartProducts: true,
      excludePreviouslyPurchasedProducts: false,
      excludeOutOfStock: true,
      rejectUnknownCompatibility: true,
      rejectMissingCommercialData: true,
    });
    expect(evaluator.evaluate({
      request: baseRecommendationRequest,
      relationship: relationshipTo('B'),
      commercialData: commercialDataFor('B', { compatibilityStatus: 'unknown' }),
    })).toMatchObject({ eligible: false, rejectionReasons: [{ code: 'UNKNOWN_COMPATIBILITY' }] });
  });
});

describe('DefaultProductRecommendationEligibilityEvaluator cart and purchase context', () => {
  it('rejects products already in cart by default', () => {
    expect(evaluate({ request: { ...baseRecommendationRequest, cartProducts: [{ productId: 'B' }] } })).toMatchObject({
      eligible: false,
      rejectionReasons: [{ code: 'ALREADY_IN_CART' }],
    });
  });

  it('includes cart products when policy allows it', () => {
    const evaluator = new DefaultProductRecommendationEligibilityEvaluator({
      excludeCartProducts: false,
      excludePreviouslyPurchasedProducts: false,
      excludeOutOfStock: true,
      rejectUnknownCompatibility: false,
      rejectMissingCommercialData: true,
    });
    expect(evaluator.evaluate({
      request: { ...baseRecommendationRequest, cartProducts: [{ productId: 'B' }] },
      relationship: relationshipTo('B'),
      commercialData: commercialDataFor('B'),
    })).toMatchObject({ eligible: true, warnings: [{ code: 'ALREADY_IN_CART' }] });
  });

  it('allows previously purchased products by default', () => {
    expect(evaluate({ request: { ...baseRecommendationRequest, alreadyPurchasedProducts: [{ productId: 'B' }] } })).toMatchObject({
      eligible: true,
      warnings: [{ code: 'ALREADY_PURCHASED' }],
    });
  });

  it('rejects previously purchased products when configured', () => {
    const evaluator = new DefaultProductRecommendationEligibilityEvaluator({
      excludeCartProducts: true,
      excludePreviouslyPurchasedProducts: true,
      excludeOutOfStock: true,
      rejectUnknownCompatibility: false,
      rejectMissingCommercialData: true,
    });
    expect(evaluator.evaluate({
      request: { ...baseRecommendationRequest, alreadyPurchasedProducts: [{ productId: 'B' }] },
      relationship: relationshipTo('B'),
      commercialData: commercialDataFor('B'),
    })).toMatchObject({ eligible: false, rejectionReasons: [{ code: 'ALREADY_PURCHASED' }] });
  });
});

describe('DefaultProductRecommendationEligibilityEvaluator budget and reasons', () => {
  it('does not filter by price when no budget exists', () => {
    expect(evaluate({ commercialData: commercialDataFor('B', { price: { currency: 'USD', amount: 999999 } }) })).toMatchObject({ eligible: true });
  });

  it('warns when price is unavailable with budget', () => {
    expect(evaluate({
      request: { ...baseRecommendationRequest, recommendationContext: { budget: { currency: 'CLP', maximum: 10000 } } },
      commercialData: commercialDataFor('B', { price: undefined }),
    })).toMatchObject({ eligible: true, warnings: [{ code: 'PRICE_UNAVAILABLE' }] });
  });

  it('warns on currency mismatch', () => {
    expect(evaluate({
      request: { ...baseRecommendationRequest, recommendationContext: { budget: { currency: 'CLP', maximum: 10000 } } },
      commercialData: commercialDataFor('B', { price: { currency: 'USD', amount: 10 } }),
    })).toMatchObject({ eligible: true, warnings: [{ code: 'CURRENCY_MISMATCH' }] });
  });

  it('rejects products above budget maximum', () => {
    expect(evaluate({
      request: { ...baseRecommendationRequest, recommendationContext: { budget: { currency: 'CLP', maximum: 1000 } } },
    })).toMatchObject({ eligible: false, rejectionReasons: [{ code: 'ABOVE_BUDGET' }] });
  });

  it('does not reject products below budget minimum', () => {
    expect(evaluate({
      request: { ...baseRecommendationRequest, recommendationContext: { budget: { currency: 'CLP', minimum: 20000 } } },
    })).toMatchObject({ eligible: true });
  });

  it('adds available reason', () => {
    expect(evaluate()).toMatchObject({ eligible: true, reasons: expect.arrayContaining([{ code: 'AVAILABLE', contribution: 5 }]) });
  });

  it('adds compatible reason', () => {
    expect(evaluate()).toMatchObject({ eligible: true, reasons: expect.arrayContaining([{ code: 'COMPATIBLE', contribution: 5 }]) });
  });

  it('adds low stock warning and reason', () => {
    expect(evaluate({ commercialData: commercialDataFor('B', { stockStatus: 'low_stock' }) })).toMatchObject({
      eligible: true,
      warnings: [{ code: 'LOW_STOCK' }],
      reasons: expect.arrayContaining([{ code: 'LOW_STOCK', contribution: 2 }]),
    });
  });

  it('adds high confidence reason', () => {
    expect(evaluate()).toMatchObject({ eligible: true, reasons: expect.arrayContaining([{ code: 'HIGH_CONFIDENCE', contribution: 0.6 }]) });
  });

  it('adds high lift reason', () => {
    expect(evaluate({ relationship: relationshipTo('B', { evidence: { kind: 'co_occurrence', jointCount: 12, support: 0.3, confidence: 0.6, lift: 2 } }) })).toMatchObject({
      eligible: true,
      reasons: expect.arrayContaining([{ code: 'HIGH_LIFT', contribution: 2 }]),
    });
  });

  it('adds high margin reason', () => {
    expect(evaluate({ commercialData: commercialDataFor('B', { marginSignal: 'high' }) })).toMatchObject({
      eligible: true,
      reasons: expect.arrayContaining([{ code: 'HIGH_MARGIN_SIGNAL', contribution: 3 }]),
    });
  });
});
