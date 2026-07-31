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

// v1's positive-weight budget summed to 1.0, with DIRECT_PRODUCT_PURCHASE historically occupying 0.20 of it.
// v2 retires that signal but does not redistribute its share to the remaining signals, and does not read it
// from `parameters` (see the deprecated, ignored `directProductPurchaseWeight` field in contracts.ts) — the
// value is fixed here so it cannot be reintroduced through configuration. This keeps v1's score scale intact:
// the remaining signals alone now reach an effective ceiling of 0.80 instead of silently being inflated to
// fill the full 0.0..1.0 range. This is a deliberate product decision (CP-R1-T10B3B), not an oversight.
const CUSTOMER_AFFINITY_V2_RESERVED_DIRECT_PURCHASE_WEIGHT = 0.2;

function maximumPositiveWeight(parameters: CustomerAffinityParameters): number {
  return (
    parameters.categoryPurchaseWeight +
    parameters.brandPurchaseWeight +
    parameters.recentProductInterestWeight +
    parameters.recentCategoryInterestWeight +
    parameters.ownedCompatibleProductWeight +
    parameters.repeatPurchasePatternWeight +
    parameters.observedSpendFitWeight +
    CUSTOMER_AFFINITY_V2_RESERVED_DIRECT_PURCHASE_WEIGHT
  );
}

export class DefaultCustomerAffinityScorer implements CustomerAffinityScorer {
  // Formula intentionally has no term for DIRECT_PRODUCT_PURCHASE (deprecated, see contracts.ts):
  // historical ownership must never contribute to score or confidence.
  score(evaluation: CustomerAffinityEvaluation, parameters: CustomerAffinityParameters): CustomerAffinityScoreResult {
    const positive =
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
    // DIRECT_PRODUCT_PURCHASE is excluded defensively: even a non-default evaluator that still emits the
    // deprecated signal must not be able to raise confidence through it.
    const distinctSignalTypes = new Set(
      evaluation.signals.filter((signal) => signal.code !== 'DIRECT_PRODUCT_PURCHASE').map((signal) => signal.code),
    ).size;

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
