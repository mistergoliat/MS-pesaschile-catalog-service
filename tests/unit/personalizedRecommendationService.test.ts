import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS,
  DefaultPersonalizedRecommendationScorer,
  DefaultPersonalizedRecommendationService,
  PersonalizedRecommendationError,
  type PersonalizedRecommendationRequest,
  type PersonalizedRecommendationScorer,
} from '../../src/domain/recommendation/personalized-recommendation/index.js';
import {
  affinityFor,
  affinityResultFor,
  basePersonalizedRequest,
  clone,
  commercialRecommendationFor,
  commercialResultFor,
  productB,
  productBCombo,
  productC,
  productD,
  productE,
  signal,
} from '../fixtures/personalizedRecommendation.js';
import { customer } from '../fixtures/customerProductAffinity.js';

function service(scorer: PersonalizedRecommendationScorer = new DefaultPersonalizedRecommendationScorer()) {
  return new DefaultPersonalizedRecommendationService(scorer);
}

function personalize(request: PersonalizedRecommendationRequest = basePersonalizedRequest) {
  return service().personalize(request);
}

function expectError(action: () => unknown, code: PersonalizedRecommendationError['code']) {
  expect(action).toThrow(PersonalizedRecommendationError);
  try {
    action();
  } catch (error) {
    expect((error as PersonalizedRecommendationError).code).toBe(code);
  }
}

describe('DefaultPersonalizedRecommendationService validation', () => {
  it('returns a result for valid input', () => {
    expect(personalize().recommendations).toHaveLength(3);
  });

  it('rejects invalid commercial result', () => {
    expectError(() => personalize({ ...basePersonalizedRequest, commercialRecommendations: { bad: true } as never }), 'INVALID_COMMERCIAL_RESULT');
  });

  it('rejects invalid affinity result', () => {
    expectError(() => personalize({ ...basePersonalizedRequest, customerAffinities: { bad: true } as never }), 'INVALID_AFFINITY_RESULT');
  });

  it('rejects customer mismatch', () => {
    expectError(() => personalize({ ...basePersonalizedRequest, context: { customer: { customerId: 'other' } } }), 'CUSTOMER_MISMATCH');
  });

  it('rejects invalid parameters', () => {
    expectError(() => personalize({ ...basePersonalizedRequest, parameters: { ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, commercialWeight: 0.9 } }), 'INVALID_PARAMETERS');
  });

  it('rejects duplicate commercial products', () => {
    const duplicate = commercialResultFor([
      commercialRecommendationFor(productB, 1),
      commercialRecommendationFor(productB, 2),
    ]);
    expectError(() => personalize({ commercialRecommendations: duplicate }), 'DUPLICATED_COMMERCIAL_PRODUCT');
  });

  it('rejects duplicate affinity products', () => {
    expectError(
      () => personalize({
        commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
        customerAffinities: affinityResultFor([affinityFor(productB), affinityFor(productB, 0.2)]),
      }),
      'DUPLICATED_AFFINITY_PRODUCT',
    );
  });

  it('rejects inconsistent commercial identity', () => {
    const broken = commercialRecommendationFor(productB, 1, 80, { productIdentity: 'wrong' });
    expectError(() => personalize({ commercialRecommendations: commercialResultFor([broken]) }), 'INVALID_COMMERCIAL_RESULT');
  });

  it('rejects inconsistent commercial data product', () => {
    const broken = commercialRecommendationFor(productB, 1, 80, {
      commercialData: { ...commercialRecommendationFor(productB).commercialData, product: productC },
    });
    expectError(() => personalize({ commercialRecommendations: commercialResultFor([broken]) }), 'INVALID_COMMERCIAL_RESULT');
  });

  it('rejects duplicate commercial ranks', () => {
    const result = commercialResultFor([
      commercialRecommendationFor(productB, 1),
      commercialRecommendationFor(productC, 1),
    ]);
    expectError(() => personalize({ commercialRecommendations: result }), 'INVALID_COMMERCIAL_RESULT');
  });

  it('rejects invalid scorer output', () => {
    const badScorer: PersonalizedRecommendationScorer = {
      score: () => ({
        components: {
          commercialScore: 0,
          normalizedCommercialContribution: 0,
          affinityScore: 0,
          affinityConfidenceMultiplier: 0,
          normalizedAffinityContribution: 0,
          explicitPreferenceBoost: 0,
          rejectionPenalty: 0,
          rawScore: 2,
          finalScore: 2,
        },
        affinityConfidence: 'none',
        effectivePersonalization: false,
        productRejected: false,
        categoryRejected: false,
      }),
    };
    expectError(() => service(badScorer).personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]) }), 'INVALID_SCORE');
  });
});

describe('DefaultPersonalizedRecommendationService matching and degradation', () => {
  it('matches by runtime identity', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 0.9)]),
    });
    expect(result.recommendations[0]?.customerAffinity?.score).toBe(0.9);
  });

  it('distinguishes base and combination', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productBCombo)]),
      customerAffinities: affinityResultFor([affinityFor(productB), affinityFor(productBCombo, 0.9)]),
    });
    expect(result.recommendations[0]?.customerAffinity?.product.combinationId).toBe('10');
  });

  it('keeps final product reference from T08', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productBCombo)]),
      customerAffinities: affinityResultFor([affinityFor(productBCombo, 0.9)]),
    });
    expect(result.recommendations[0]?.product).toEqual(productBCombo);
  });

  it('ignores affinity for unknown product', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB), affinityFor(productE)]),
    });
    expect(result.statistics.affinityEntriesIgnored).toBe(1);
    expect(result.warnings.some((warning) => warning.code === 'AFFINITY_FOR_UNKNOWN_PRODUCT_IGNORED')).toBe(true);
  });

  it('degrades when T09 is omitted', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor() });
    expect(result.warnings[0]?.code).toBe('CUSTOMER_AFFINITY_UNAVAILABLE');
    expect(result.recommendations.every((recommendation) => recommendation.affinityConfidence === 'none')).toBe(true);
  });

  it('preserves commercial ranking without T09', () => {
    expect(personalize({ commercialRecommendations: commercialResultFor() }).recommendations.map((item) => item.originalCommercialRank)).toEqual([1, 2, 3]);
  });

  it('keeps T08 order without personalization even when commercial scores differ from ranks', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([
        commercialRecommendationFor(productB, 1, 60),
        commercialRecommendationFor(productC, 2, 95),
      ]),
    });
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['B', 'C']);
  });

  it('degrades when customer is not identified', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: { ...affinityResultFor([affinityFor(productB, 0, 'none', [])]), customer: undefined, warnings: [{ code: 'CUSTOMER_NOT_IDENTIFIED' }] },
    });
    expect(result.warnings.some((warning) => warning.code === 'CUSTOMER_NOT_IDENTIFIED')).toBe(true);
  });

  it('degrades when there is no history', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 0, 'none', [], { warnings: [{ code: 'NO_CUSTOMER_HISTORY' }] })]),
    });
    expect(result.recommendations[0]?.components.normalizedAffinityContribution).toBe(0);
  });

  it('handles partial affinity', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB), commercialRecommendationFor(productC, 2)]),
      customerAffinities: affinityResultFor([affinityFor(productB)]),
    });
    expect(result.statistics.candidatesWithoutAffinity).toBe(1);
    expect(result.recommendations.some((recommendation) => recommendation.warnings.some((warning) => warning.code === 'AFFINITY_MISSING_FOR_PRODUCT'))).toBe(true);
  });

  it('does not exclude products with no history', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 0, 'none', [])]),
    });
    expect(result.excluded).toHaveLength(0);
  });
});

describe('DefaultPersonalizedRecommendationService exclusions and limits', () => {
  it('excludes product rejection', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')])]),
    });
    expect(result.excluded[0]?.code).toBe('EXPLICIT_PRODUCT_REJECTION');
  });

  it('penalizes category rejection without excluding', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 1, 'high', [signal('CATEGORY_REJECTION')])]),
    });
    expect(result.recommendations).toHaveLength(1);
    expect(result.excluded).toHaveLength(0);
    expect(result.recommendations[0]?.components.rejectionPenalty).toBe(0.25);
  });

  it('gives context exclusion precedence over rejection', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')])]),
      context: { excludedProductIds: [productB] },
    });
    expect(result.excluded[0]?.code).toBe('EXPLICIT_CONTEXT_EXCLUSION');
  });

  it('assigns only one final exclusion per product', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB, 1, 1)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')])]),
      context: { excludedProductIds: [productB] },
      parameters: { ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, minimumPersonalizedScore: 0.9 },
    });
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.code).toBe('EXPLICIT_CONTEXT_EXCLUSION');
  });

  it('does not add replacement for exclusions', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      context: { excludedProductIds: [productB] },
    });
    expect(result.recommendations).toHaveLength(0);
  });

  it('preserves exclusion traceability', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB, 1, 95)]),
      context: { excludedProductIds: [productB] },
    });
    expect(result.excluded[0]).toMatchObject({ product: productB, commercialScore: 0.95 });
  });

  it('excludes commercially strong product when explicitly rejected', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB, 1, 100)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')])]),
    });
    expect(result.recommendations).toHaveLength(0);
  });

  it('applies minimum score exclusion', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productD, 1, 10)]),
      parameters: { ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, minimumPersonalizedScore: 0.5 },
    });
    expect(result.excluded[0]?.code).toBe('BELOW_MINIMUM_PERSONALIZED_SCORE');
  });

  it('does not apply a hidden nonzero threshold by default', () => {
    expect(personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productD, 1, 1)]) }).recommendations).toHaveLength(1);
  });

  it('applies maximumResults after ranking', () => {
    const result = personalize({ ...basePersonalizedRequest, parameters: { ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, maximumResults: 1 } });
    expect(result.recommendations).toHaveLength(1);
    expect(result.statistics.resultLimitTruncations).toBe(2);
  });

  it('does not count truncation as rejection code other than truncation', () => {
    const result = personalize({ ...basePersonalizedRequest, parameters: { ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, maximumResults: 1 } });
    expect(result.excluded.every((item) => item.code === 'RESULT_LIMIT_TRUNCATION')).toBe(true);
  });
});

describe('DefaultPersonalizedRecommendationService ranking', () => {
  it('orders by final score descending', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([
        commercialRecommendationFor(productB, 1, 60),
        commercialRecommendationFor(productC, 2, 90),
      ]),
      customerAffinities: affinityResultFor([affinityFor(productB, 1, 'high'), affinityFor(productC, 0, 'none', [])]),
    });
    expect(result.recommendations[0]?.product.productId).toBe('B');
  });

  it('ties by commercial score descending', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([
        commercialRecommendationFor(productB, 2, 80),
        commercialRecommendationFor(productC, 1, 90),
      ]),
      customerAffinities: affinityResultFor([]),
    });
    expect(result.recommendations[0]?.product.productId).toBe('C');
  });

  it('ties by original commercial rank', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([
        commercialRecommendationFor(productB, 2, 80),
        commercialRecommendationFor(productC, 1, 80),
      ]),
      customerAffinities: affinityResultFor([]),
    });
    expect(result.recommendations[0]?.product.productId).toBe('C');
  });

  it('ties by product identity', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([
        commercialRecommendationFor(productC, 1, 80),
        commercialRecommendationFor(productB, 1, 80, { rank: 2 }),
      ]),
      customerAffinities: affinityResultFor([]),
    });
    expect(result.recommendations[0]?.product.productId).toBe('C');
  });

  it('assigns sequential personalized ranks', () => {
    expect(personalize().recommendations.map((item) => item.personalizedRank)).toEqual([1, 2, 3]);
  });

  it('preserves original commercial ranks', () => {
    expect(personalize().recommendations.map((item) => item.originalCommercialRank).sort((left, right) => left - right)).toEqual([1, 2, 3]);
  });

  it('is deterministic for same input', () => {
    expect(personalize()).toEqual(personalize());
  });

  it('keeps neutral ranking equal to commercial order', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor(), customerAffinities: affinityResultFor([]) });
    expect(result.recommendations.map((item) => item.originalCommercialRank)).toEqual([1, 2, 3]);
  });
});

describe('DefaultPersonalizedRecommendationService reasons', () => {
  it('adds strong commercial relevance reason', () => {
    expect(personalize().recommendations[0]?.reasons.some((reason) => reason.code === 'STRONG_COMMERCIAL_RELEVANCE')).toBe(true);
  });

  it('adds product affinity reason', () => {
    expect(personalize().recommendations[0]?.reasons.some((reason) => reason.code === 'CUSTOMER_PRODUCT_AFFINITY')).toBe(true);
  });

  it('adds category affinity reason', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 0.5, 'medium', [signal('CATEGORY_PURCHASE')])]),
    });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'CUSTOMER_CATEGORY_AFFINITY')).toBe(true);
  });

  it('adds brand affinity reason', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([affinityFor(productB, 0.5, 'medium', [signal('BRAND_PURCHASE')])]) });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'CUSTOMER_BRAND_AFFINITY')).toBe(true);
  });

  it('adds recent product interest reason', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([affinityFor(productB, 0.5, 'medium', [signal('RECENT_PRODUCT_INTEREST')])]) });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'RECENT_PRODUCT_INTEREST')).toBe(true);
  });

  it('adds recent category interest reason', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([affinityFor(productB, 0.5, 'medium', [signal('RECENT_CATEGORY_INTEREST')])]) });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'RECENT_CATEGORY_INTEREST')).toBe(true);
  });

  it('adds compatibility ownership reason', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([affinityFor(productB, 0.5, 'medium', [signal('OWNED_COMPATIBLE_PRODUCT')])]) });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'OWNED_COMPATIBLE_PRODUCT')).toBe(true);
  });

  it('adds repeat purchase reason', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([affinityFor(productB, 0.5, 'medium', [signal('REPEAT_PURCHASE_PATTERN')])]) });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'REPEAT_PURCHASE_PATTERN')).toBe(true);
  });

  it('adds observed spend compatibility reason', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([affinityFor(productB, 0.5, 'medium', [signal('OBSERVED_SPEND_FIT')])]) });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'OBSERVED_SPEND_COMPATIBILITY')).toBe(true);
  });

  it('adds explicit preference reason', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), context: { preferredProductIds: [productB] } });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'EXPLICIT_CONTEXT_PREFERENCE')).toBe(true);
  });

  it('adds fallback reason when no personalization applies', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([]) });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'GENERAL_COMMERCIAL_FALLBACK')).toBe(true);
  });

  it('does not invent affinity reasons for confidence none', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([affinityFor(productB, 1, 'none', [signal('DIRECT_PRODUCT_PURCHASE')])]) });
    expect(result.recommendations[0]?.reasons.some((reason) => reason.code === 'CUSTOMER_PRODUCT_AFFINITY')).toBe(false);
  });

  it('deduplicates reasons', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([affinityFor(productB, 1, 'high', [signal('DIRECT_PRODUCT_PURCHASE')])]) });
    const codes = result.recommendations[0]?.reasons.map((reason) => reason.code) ?? [];
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('DefaultPersonalizedRecommendationService statistics and immutability', () => {
  it('counts commercial candidates received', () => {
    expect(personalize().statistics.commercialCandidatesReceived).toBe(3);
  });

  it('counts affinity entries received', () => {
    expect(personalize().statistics.affinityEntriesReceived).toBe(2);
  });

  it('counts candidates with and without affinity', () => {
    const stats = personalize().statistics;
    expect(stats.candidatesWithAffinity).toBe(2);
    expect(stats.candidatesWithoutAffinity).toBe(1);
  });

  it('counts context exclusions', () => {
    expect(personalize({ ...basePersonalizedRequest, context: { excludedProductIds: [productB] } }).statistics.contextExclusions).toBe(1);
  });

  it('counts rejection exclusions', () => {
    expect(personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinityResultFor([affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')])]) }).statistics.rejectionExclusions).toBe(1);
  });

  it('counts minimum score exclusions', () => {
    expect(personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB, 1, 1)]), parameters: { ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, minimumPersonalizedScore: 0.5 } }).statistics.minimumScoreExclusions).toBe(1);
  });

  it('counts effective personalization', () => {
    expect(personalize().statistics.recommendationsWithEffectivePersonalization).toBeGreaterThan(0);
  });

  it('counts commercial fallback recommendations', () => {
    expect(personalize({ commercialRecommendations: commercialResultFor(), customerAffinities: affinityResultFor([]) }).statistics.commercialFallbackRecommendations).toBe(3);
  });

  it('counts warnings global plus per product', () => {
    const result = personalize({ commercialRecommendations: commercialResultFor(), customerAffinities: affinityResultFor([]) });
    expect(result.statistics.warningsGenerated).toBeGreaterThan(0);
  });

  it('counts each emitted warning exactly once under the global plus product convention', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB), commercialRecommendationFor(productC, 2)]),
      customerAffinities: affinityResultFor([affinityFor(productB)]),
    });
    const productWarnings = result.recommendations.reduce((count, recommendation) => count + recommendation.warnings.length, 0);
    expect(result.statistics.warningsGenerated).toBe(result.warnings.length + productWarnings);
  });

  it('counts category rejection penalty as effective personalization', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 1, 'high', [signal('CATEGORY_REJECTION')])]),
    });
    expect(result.statistics.recommendationsWithEffectivePersonalization).toBe(1);
    expect(result.statistics.commercialFallbackRecommendations).toBe(0);
  });

  it('satisfies affinity coverage invariant', () => {
    const stats = personalize().statistics;
    expect(stats.candidatesWithAffinity + stats.candidatesWithoutAffinity).toBe(stats.commercialCandidatesReceived);
  });

  it('satisfies terminal state invariant', () => {
    const stats = personalize({ ...basePersonalizedRequest, parameters: { ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, maximumResults: 1 } }).statistics;
    expect(stats.personalizedRecommendationsReturned + stats.contextExclusions + stats.rejectionExclusions + stats.minimumScoreExclusions + stats.resultLimitTruncations).toBe(stats.commercialCandidatesReceived);
  });

  it('freezes result', () => {
    expect(Object.isFrozen(personalize())).toBe(true);
  });

  it('freezes arrays', () => {
    const result = personalize();
    expect(Object.isFrozen(result.recommendations)).toBe(true);
    expect(Object.isFrozen(result.excluded)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  it('freezes components', () => {
    expect(Object.isFrozen(personalize().recommendations[0]?.components)).toBe(true);
  });

  it('freezes reasons', () => {
    expect(Object.isFrozen(personalize().recommendations[0]?.reasons)).toBe(true);
  });

  it('freezes warnings', () => {
    expect(Object.isFrozen(personalize({ commercialRecommendations: commercialResultFor() }).warnings)).toBe(true);
  });

  it('clones T08 objects', () => {
    const commercial = commercialResultFor([commercialRecommendationFor(productB)]);
    const result = personalize({ commercialRecommendations: commercial });
    commercial.recommendations[0]!.score.total = 1;
    expect(result.recommendations[0]?.commercialRecommendation.score.total).toBe(80);
  });

  it('clones T09 objects', () => {
    const affinities = affinityResultFor([affinityFor(productB, 0.8)]);
    const result = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]), customerAffinities: affinities });
    affinities.affinities[0]!.score = 0;
    expect(result.recommendations[0]?.customerAffinity?.score).toBe(0.8);
  });

  it('does not mutate request', () => {
    const request = clone(basePersonalizedRequest);
    const before = clone(request);
    personalize(request);
    expect(request).toEqual(before);
  });

  it('serializes to JSON', () => {
    expect(() => JSON.stringify(personalize())).not.toThrow();
  });

  it('does not expose forbidden infrastructure markers', () => {
    expect(JSON.stringify(personalize()).toLowerCase()).not.toMatch(/select |redis|customer 360|prestashop|llm|e2e/u);
  });

  it('does not call providers or T07', () => {
    expect(personalize().recommendations.length).toBeGreaterThan(0);
  });

  it('does not use budget to recalculate score or price eligibility', () => {
    const withoutBudget = personalize({ commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB, 1, 80)]) });
    const withBudget = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB, 1, 80)]),
      context: { budget: { currency: 'CLP', maximum: 1 } },
    });
    expect(withBudget.recommendations[0]?.personalizedScore).toBe(withoutBudget.recommendations[0]?.personalizedScore);
    expect(withBudget.warnings.some((warning) => warning.code === 'PERSONALIZATION_CONTEXT_PARTIALLY_APPLIED')).toBe(true);
  });

  it('propagates commercial warnings structurally', () => {
    const recommendation = commercialRecommendationFor(productB, 1, 80, { warnings: [{ code: 'LOW_STOCK' }] });
    const result = personalize({ commercialRecommendations: commercialResultFor([recommendation]) });
    expect(result.recommendations[0]?.warnings[0]?.code).toBe('COMMERCIAL_WARNING_PROPAGATED');
  });

  it('propagates affinity warnings structurally', () => {
    const result = personalize({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB, 0, 'none', [], { warnings: [{ code: 'PARTIAL_CUSTOMER_HISTORY' }] })]),
    });
    expect(result.recommendations[0]?.warnings[0]?.code).toBe('PARTIAL_CUSTOMER_HISTORY');
  });

  it('preserves customer when affinity has customer', () => {
    expect(personalize().customer).toEqual(customer);
  });

  it('keeps scoring version explicit', () => {
    expect(personalize().scoringVersion).toBe('personalized-recommendation-v1');
  });
});
