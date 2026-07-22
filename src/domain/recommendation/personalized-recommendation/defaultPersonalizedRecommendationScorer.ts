import { createProductRuntimeIdentity } from '../relationship-engine/runtime/index.js';
import type { CustomerAffinityConfidence, CustomerProductAffinity } from '../customer-affinity/index.js';
import {
  type CommercialRecommendation,
  type PersonalizedRecommendationContext,
  type PersonalizedRecommendationParameters,
  type PersonalizedRecommendationScoreResult,
  type PersonalizedRecommendationScorer,
} from './contracts.js';

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function confidenceMultiplier(confidence: CustomerAffinityConfidence, parameters: PersonalizedRecommendationParameters): number {
  if (confidence === 'high') return parameters.affinityConfidenceHighMultiplier;
  if (confidence === 'medium') return parameters.affinityConfidenceMediumMultiplier;
  if (confidence === 'low') return parameters.affinityConfidenceLowMultiplier;
  return parameters.affinityConfidenceNoneMultiplier;
}

function hasSignal(affinity: CustomerProductAffinity | undefined, code: string): boolean {
  return affinity?.signals.some((signal) => signal.code === code) ?? false;
}

function signalStrength(affinity: CustomerProductAffinity | undefined, code: string): number {
  return affinity?.signals.find((signal) => signal.code === code)?.strength ?? 0;
}

function isPreferred(
  recommendation: CommercialRecommendation,
  context: PersonalizedRecommendationContext | undefined,
): boolean {
  const identity = createProductRuntimeIdentity(recommendation.product);
  return context?.preferredProductIds?.some((product) => createProductRuntimeIdentity(product) === identity) ?? false;
}

export class DefaultPersonalizedRecommendationScorer implements PersonalizedRecommendationScorer {
  score(
    commercialRecommendation: CommercialRecommendation,
    affinity: CustomerProductAffinity | undefined,
    context: PersonalizedRecommendationContext | undefined,
    parameters: PersonalizedRecommendationParameters,
  ): PersonalizedRecommendationScoreResult {
    const commercialScore = clamp(commercialRecommendation.score.total / 100);
    const affinityScore = affinity?.score ?? 0;
    const affinityConfidence = affinity?.confidence ?? 'none';
    const multiplier = confidenceMultiplier(affinityConfidence, parameters);
    const normalizedCommercialContribution = commercialScore * parameters.commercialWeight;
    const normalizedAffinityContribution = affinityScore * multiplier * parameters.affinityWeight;
    const explicitPreferenceBoost = isPreferred(commercialRecommendation, context) ? parameters.explicitPreferenceBoost : 0;
    const productRejection = signalStrength(affinity, 'PRODUCT_REJECTION') * parameters.productRejectionPenalty;
    const categoryRejection = signalStrength(affinity, 'CATEGORY_REJECTION') * parameters.categoryRejectionPenalty;
    const rejectionPenalty = clamp(productRejection + categoryRejection);
    const rawScore =
      normalizedCommercialContribution +
      normalizedAffinityContribution +
      explicitPreferenceBoost -
      rejectionPenalty;
    const finalScore = clamp(rawScore);

    return {
      components: {
        commercialScore,
        normalizedCommercialContribution,
        affinityScore,
        affinityConfidenceMultiplier: multiplier,
        normalizedAffinityContribution,
        explicitPreferenceBoost,
        rejectionPenalty,
        rawScore,
        finalScore,
      },
      affinityConfidence,
      effectivePersonalization: normalizedAffinityContribution > 0 || explicitPreferenceBoost > 0 || rejectionPenalty > 0,
      productRejected: hasSignal(affinity, 'PRODUCT_REJECTION'),
      categoryRejected: hasSignal(affinity, 'CATEGORY_REJECTION'),
    };
  }
}
