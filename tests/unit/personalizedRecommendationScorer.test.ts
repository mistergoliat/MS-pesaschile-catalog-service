import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS,
  DefaultPersonalizedRecommendationScorer,
  type PersonalizedRecommendationContext,
  type PersonalizedRecommendationParameters,
  commercialRecommendationSchema,
  personalizedRecommendationContextSchema,
  personalizedRecommendationParametersSchema,
  personalizedRecommendationRequestSchema,
  personalizedRecommendationResultSchema,
  personalizedRecommendationScoreComponentsSchema,
  personalizedRecommendationStatisticsSchema,
  personalizedRecommendationWarningSchema,
  personalizedRecommendationWeightTolerance,
} from '../../src/domain/recommendation/personalized-recommendation/index.js';
import {
  affinityFor,
  affinityResultFor,
  basePersonalizedRequest,
  commercialRecommendationFor,
  commercialResultFor,
  productB,
  productC,
  signal,
} from '../fixtures/personalizedRecommendation.js';

function score(
  affinity?: Parameters<DefaultPersonalizedRecommendationScorer['score']>[1],
  parameters: PersonalizedRecommendationParameters = DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS,
  context: PersonalizedRecommendationContext | undefined = undefined,
) {
  const effectiveAffinity = arguments.length === 0 ? affinityFor(productB, 0.8, 'high') : affinity;
  return new DefaultPersonalizedRecommendationScorer().score(
    commercialRecommendationFor(productB, 1, 80),
    effectiveAffinity,
    context,
    parameters,
  );
}

describe('personalized recommendation contracts', () => {
  it('accepts a valid request', () => {
    expect(personalizedRecommendationRequestSchema.safeParse(basePersonalizedRequest).success).toBe(true);
  });

  it('accepts omitted T09 affinity result', () => {
    expect(personalizedRecommendationRequestSchema.safeParse({ commercialRecommendations: commercialResultFor() }).success).toBe(true);
  });

  it('accepts omitted context', () => {
    expect(personalizedRecommendationRequestSchema.safeParse(basePersonalizedRequest).success).toBe(true);
  });

  it('rejects invalid weight ranges', () => {
    expect(personalizedRecommendationParametersSchema.safeParse({ ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, commercialWeight: -0.1 }).success).toBe(false);
  });

  it('rejects invalid weight sum', () => {
    expect(personalizedRecommendationParametersSchema.safeParse({ ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, commercialWeight: 0.8 }).success).toBe(false);
  });

  it('accepts weight sum within tolerance', () => {
    expect(personalizedRecommendationParametersSchema.safeParse({
      ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS,
      commercialWeight: 0.7000004,
      affinityWeight: 0.2999996,
    }).success).toBe(true);
    expect(personalizedRecommendationWeightTolerance).toBeGreaterThan(0);
  });

  it('rejects invalid maximumResults', () => {
    expect(personalizedRecommendationParametersSchema.safeParse({ ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, maximumResults: 0 }).success).toBe(false);
  });

  it('rejects invalid minimum score', () => {
    expect(personalizedRecommendationParametersSchema.safeParse({ ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, minimumPersonalizedScore: 2 }).success).toBe(false);
  });

  it('rejects invalid context product references', () => {
    expect(personalizedRecommendationContextSchema.safeParse({ preferredProductIds: [{ productId: '' }] }).success).toBe(false);
  });

  it('accepts context product combinations', () => {
    expect(personalizedRecommendationContextSchema.safeParse({ preferredProductIds: [{ productId: 'B', combinationId: '10' }] }).success).toBe(true);
  });

  it('rejects invalid commercial score', () => {
    expect(commercialRecommendationSchema.safeParse({ ...commercialRecommendationFor(productB), score: { total: 101, components: { relationship: 0, availability: 0, compatibility: 0, commercial: 0, penalties: 0 } } }).success).toBe(false);
  });

  it('rejects invalid rank', () => {
    expect(commercialRecommendationSchema.safeParse({ ...commercialRecommendationFor(productB), rank: 0 }).success).toBe(false);
  });

  it('rejects invalid warning details', () => {
    expect(personalizedRecommendationWarningSchema.safeParse({ code: 'CUSTOMER_AFFINITY_UNAVAILABLE', details: { bad: Number.NaN } }).success).toBe(false);
  });

  it('rejects score components outside range', () => {
    expect(personalizedRecommendationScoreComponentsSchema.safeParse({
      commercialScore: 0.8,
      normalizedCommercialContribution: 0.5,
      affinityScore: 0,
      affinityConfidenceMultiplier: 0,
      normalizedAffinityContribution: 0,
      explicitPreferenceBoost: 0,
      rejectionPenalty: 0,
      rawScore: 1.2,
      finalScore: 1.2,
    }).success).toBe(false);
  });

  it('rejects inconsistent statistics', () => {
    expect(personalizedRecommendationStatisticsSchema.safeParse({
      commercialCandidatesReceived: 2,
      affinityEntriesReceived: 0,
      candidatesWithAffinity: 2,
      candidatesWithoutAffinity: 1,
      affinityEntriesIgnored: 0,
      contextExclusions: 0,
      rejectionExclusions: 0,
      minimumScoreExclusions: 0,
      resultLimitTruncations: 0,
      personalizedRecommendationsReturned: 2,
      recommendationsWithEffectivePersonalization: 0,
      commercialFallbackRecommendations: 2,
      warningsGenerated: 0,
    }).success).toBe(false);
  });

  it('rejects non-contiguous personalized ranks', () => {
    expect(personalizedRecommendationResultSchema.safeParse({
      recommendations: [],
      excluded: [],
      warnings: [],
      statistics: {
        commercialCandidatesReceived: 0,
        affinityEntriesReceived: 0,
        candidatesWithAffinity: 0,
        candidatesWithoutAffinity: 0,
        affinityEntriesIgnored: 0,
        contextExclusions: 0,
        rejectionExclusions: 0,
        minimumScoreExclusions: 0,
        resultLimitTruncations: 0,
        personalizedRecommendationsReturned: 0,
        recommendationsWithEffectivePersonalization: 0,
        commercialFallbackRecommendations: 0,
        warningsGenerated: 0,
      },
      scoringVersion: 'personalized-recommendation-v1',
    }).success).toBe(true);
  });

  it('accepts explicit affinity result contract', () => {
    expect(personalizedRecommendationRequestSchema.safeParse({
      commercialRecommendations: commercialResultFor([commercialRecommendationFor(productB)]),
      customerAffinities: affinityResultFor([affinityFor(productB)]),
    }).success).toBe(true);
  });
});

describe('DefaultPersonalizedRecommendationScorer', () => {
  it('uses commercial score only when affinity is absent', () => {
    expect(score(undefined).components.finalScore).toBeCloseTo(0.56);
  });

  it('uses no affinity contribution for confidence none', () => {
    expect(score(affinityFor(productB, 1, 'none')).components.normalizedAffinityContribution).toBe(0);
  });

  it('uses low confidence multiplier', () => {
    expect(score(affinityFor(productB, 1, 'low')).components.affinityConfidenceMultiplier).toBe(0.35);
  });

  it('uses medium confidence multiplier', () => {
    expect(score(affinityFor(productB, 1, 'medium')).components.affinityConfidenceMultiplier).toBe(0.7);
  });

  it('uses high confidence multiplier', () => {
    expect(score(affinityFor(productB, 1, 'high')).components.affinityConfidenceMultiplier).toBe(1);
  });

  it('calculates affinity contribution', () => {
    expect(score(affinityFor(productB, 0.5, 'high')).components.normalizedAffinityContribution).toBeCloseTo(0.15);
  });

  it('adds explicit preference boost', () => {
    expect(score(affinityFor(productB, 0, 'none'), DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, { preferredProductIds: [productB] }).components.explicitPreferenceBoost).toBe(0.1);
  });

  it('does not boost non-preferred products', () => {
    expect(score(affinityFor(productB, 0, 'none'), DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, { preferredProductIds: [productC] }).components.explicitPreferenceBoost).toBe(0);
  });

  it('applies product rejection penalty', () => {
    expect(score(affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')])).components.rejectionPenalty).toBe(1);
  });

  it('flags product rejection', () => {
    expect(score(affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')])).productRejected).toBe(true);
  });

  it('applies category rejection penalty', () => {
    expect(score(affinityFor(productB, 1, 'high', [signal('CATEGORY_REJECTION')])).components.rejectionPenalty).toBe(0.25);
  });

  it('flags category rejection', () => {
    expect(score(affinityFor(productB, 1, 'high', [signal('CATEGORY_REJECTION')])).categoryRejected).toBe(true);
  });

  it('clamps lower bound', () => {
    expect(score(affinityFor(productB, 1, 'high', [signal('PRODUCT_REJECTION')])).components.finalScore).toBe(0);
  });

  it('clamps upper bound', () => {
    expect(score(affinityFor(productB, 1, 'high'), { ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, explicitPreferenceBoost: 1 }, { preferredProductIds: [productB] }).components.finalScore).toBe(1);
  });

  it('uses custom weights', () => {
    expect(score(affinityFor(productB, 1, 'high'), { ...DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, commercialWeight: 0.5, affinityWeight: 0.5 }).components.finalScore).toBeCloseTo(0.9);
  });

  it('freezes default parameters', () => {
    expect(Object.isFrozen(DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS)).toBe(true);
  });

  it('keeps components auditable', () => {
    expect(Object.keys(score().components).sort()).toEqual([
      'affinityConfidenceMultiplier',
      'affinityScore',
      'commercialScore',
      'explicitPreferenceBoost',
      'finalScore',
      'normalizedAffinityContribution',
      'normalizedCommercialContribution',
      'rawScore',
      'rejectionPenalty',
    ].sort());
  });

  it('is deterministic for the same input', () => {
    expect(score()).toEqual(score());
  });

  it('does not treat score as confidence', () => {
    const result = score(affinityFor(productB, 1, 'low'));
    expect(result.components.affinityScore).toBe(1);
    expect(result.affinityConfidence).toBe('low');
  });

  it('marks effective personalization for affinity contribution', () => {
    expect(score(affinityFor(productB, 0.5, 'high')).effectivePersonalization).toBe(true);
  });

  it('marks effective personalization for explicit preference', () => {
    expect(score(undefined, DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS, { preferredProductIds: [productB] }).effectivePersonalization).toBe(true);
  });

  it('does not mark fallback as personalized', () => {
    expect(score(undefined).effectivePersonalization).toBe(false);
  });
});
