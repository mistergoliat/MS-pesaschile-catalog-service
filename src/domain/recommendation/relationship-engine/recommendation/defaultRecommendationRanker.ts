import type {
  ProductRecommendationRanker,
  ScoredProductRecommendationCandidate,
} from './contracts.js';

function coOccurrenceMetric(
  candidate: ScoredProductRecommendationCandidate,
  metric: 'confidence' | 'lift' | 'support' | 'jointCount',
): number {
  if (candidate.relationship.evidence.kind !== 'co_occurrence') {
    return 0;
  }
  return candidate.relationship.evidence[metric];
}

function compatibilityRank(candidate: ScoredProductRecommendationCandidate): number {
  return candidate.commercialData.compatibilityStatus === 'compatible' ? 1 : 0;
}

function stockRank(candidate: ScoredProductRecommendationCandidate): number {
  if (candidate.commercialData.stockStatus === 'in_stock') return 3;
  if (candidate.commercialData.stockStatus === 'low_stock') return 2;
  if (candidate.commercialData.stockStatus === 'unknown') return 1;
  return 0;
}

export class DefaultProductRecommendationRanker implements ProductRecommendationRanker {
  rank(candidates: readonly ScoredProductRecommendationCandidate[]): readonly ScoredProductRecommendationCandidate[] {
    return [...candidates].sort((left, right) => (
      right.score.total - left.score.total ||
      right.relationship.reliability - left.relationship.reliability ||
      compatibilityRank(right) - compatibilityRank(left) ||
      stockRank(right) - stockRank(left) ||
      coOccurrenceMetric(right, 'confidence') - coOccurrenceMetric(left, 'confidence') ||
      coOccurrenceMetric(right, 'lift') - coOccurrenceMetric(left, 'lift') ||
      coOccurrenceMetric(right, 'support') - coOccurrenceMetric(left, 'support') ||
      coOccurrenceMetric(right, 'jointCount') - coOccurrenceMetric(left, 'jointCount') ||
      left.productIdentity.localeCompare(right.productIdentity)
    ));
  }
}
