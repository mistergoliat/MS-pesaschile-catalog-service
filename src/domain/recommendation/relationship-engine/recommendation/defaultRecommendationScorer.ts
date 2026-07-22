import {
  productRecommendationScoreSchema,
  type EligibleProductRecommendationCandidate,
  type ProductRecommendationScore,
  type ProductRecommendationScorer,
} from './contracts.js';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function coOccurrenceMetrics(candidate: EligibleProductRecommendationCandidate): {
  confidence: number;
  lift: number;
  support: number;
} {
  if (candidate.relationship.evidence.kind !== 'co_occurrence') {
    return {
      confidence: 0,
      lift: 0,
      support: 0,
    };
  }
  return candidate.relationship.evidence;
}

export class DefaultProductRecommendationScorer implements ProductRecommendationScorer {
  score(candidate: EligibleProductRecommendationCandidate): ProductRecommendationScore {
    const metrics = coOccurrenceMetrics(candidate);
    const normalizedLift = clamp((metrics.lift - 1) / 4, 0, 1);
    const normalizedSupport = clamp(metrics.support / 0.1, 0, 1);
    const relationship =
      candidate.relationship.reliability * 45 +
      metrics.confidence * 20 +
      normalizedLift * 15 +
      normalizedSupport * 10;

    const availability = candidate.commercialData.stockStatus === 'in_stock'
      ? 5
      : candidate.commercialData.stockStatus === 'low_stock'
        ? 2
        : candidate.commercialData.stockStatus === 'out_of_stock'
          ? -15
          : 0;
    const compatibility = candidate.commercialData.compatibilityStatus === 'compatible' ? 5 : 0;
    const commercial = candidate.commercialData.marginSignal === 'high'
      ? 3
      : candidate.commercialData.marginSignal === 'medium'
        ? 2
        : 0;

    let penalties = 0;
    for (const warning of candidate.warnings) {
      if (warning.code === 'ALREADY_IN_CART') penalties -= 20;
      if (warning.code === 'OUT_OF_STOCK_INCLUDED') penalties -= 15;
      if (warning.code === 'PRICE_UNAVAILABLE') penalties -= 2;
      if (warning.code === 'CURRENCY_MISMATCH') penalties -= 2;
    }

    const score: ProductRecommendationScore = {
      total: clamp(relationship + availability + compatibility + commercial + penalties, 0, 100),
      components: {
        relationship,
        availability,
        compatibility,
        commercial,
        penalties,
      },
    };
    return productRecommendationScoreSchema.parse(score);
  }
}
