import {
  CUSTOMER_AFFINITY_SCORING_VERSION,
  type CustomerAffinityEvaluation,
  type CustomerAffinityParameters,
  type CustomerAffinityScoreResult,
  type CustomerAffinityScorer,
  type CustomerAffinitySignalCode,
} from './contracts.js';

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function signalStrength(evaluation: CustomerAffinityEvaluation, code: CustomerAffinitySignalCode): number {
  return evaluation.signals.find((signal) => signal.code === code)?.strength ?? 0;
}

function maximumPositiveWeight(parameters: CustomerAffinityParameters): number {
  return (
    parameters.directProductPurchaseWeight +
    parameters.categoryPurchaseWeight +
    parameters.brandPurchaseWeight +
    parameters.recentProductInterestWeight +
    parameters.recentCategoryInterestWeight +
    parameters.ownedCompatibleProductWeight +
    parameters.repeatPurchasePatternWeight +
    parameters.observedSpendFitWeight
  );
}

export class DefaultCustomerAffinityScorer implements CustomerAffinityScorer {
  score(evaluation: CustomerAffinityEvaluation, parameters: CustomerAffinityParameters): CustomerAffinityScoreResult {
    const positive =
      signalStrength(evaluation, 'DIRECT_PRODUCT_PURCHASE') * parameters.directProductPurchaseWeight +
      signalStrength(evaluation, 'CATEGORY_PURCHASE') * parameters.categoryPurchaseWeight +
      signalStrength(evaluation, 'BRAND_PURCHASE') * parameters.brandPurchaseWeight +
      signalStrength(evaluation, 'RECENT_PRODUCT_INTEREST') * parameters.recentProductInterestWeight +
      signalStrength(evaluation, 'RECENT_CATEGORY_INTEREST') * parameters.recentCategoryInterestWeight +
      signalStrength(evaluation, 'OWNED_COMPATIBLE_PRODUCT') * parameters.ownedCompatibleProductWeight +
      signalStrength(evaluation, 'REPEAT_PURCHASE_PATTERN') * parameters.repeatPurchasePatternWeight +
      signalStrength(evaluation, 'OBSERVED_SPEND_FIT') * parameters.observedSpendFitWeight;

    const negative =
      signalStrength(evaluation, 'PRODUCT_REJECTION') * parameters.productRejectionPenalty +
      signalStrength(evaluation, 'CATEGORY_REJECTION') * parameters.categoryRejectionPenalty;

    const score = clamp((positive - negative) / maximumPositiveWeight(parameters));
    const distinctSignalTypes = new Set(evaluation.signals.map((signal) => signal.code)).size;

    const confidence = distinctSignalTypes === 0 || evaluation.validEvidenceCount === 0
      ? 'none'
      : distinctSignalTypes >= 3 && evaluation.validEvidenceCount >= parameters.minimumEvidenceForHighConfidence
        ? 'high'
        : distinctSignalTypes >= 2 && evaluation.validEvidenceCount >= parameters.minimumEvidenceForMediumConfidence
          ? 'medium'
          : 'low';

    return {
      score,
      confidence,
      scoringVersion: CUSTOMER_AFFINITY_SCORING_VERSION,
    };
  }
}
