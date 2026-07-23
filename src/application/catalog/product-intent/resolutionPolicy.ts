import type {
  ExplicitProductConstraints,
  ProductIntentReference,
  ProductIntentResolutionDecision,
  ProductIntentResolutionPolicy,
  RankedProductIntentCandidate,
} from './contracts.js';

export type ProductIntentResolutionPolicyParameters = {
  readonly resolvedMinimumScore: number;
  readonly resolvedMinimumGap: number;
  readonly plausibleMinimumScore: number;
  readonly explicitResolvedMinimumScore: number;
};

export const DEFAULT_PRODUCT_INTENT_RESOLUTION_POLICY_PARAMETERS = Object.freeze({
  resolvedMinimumScore: 0.82,
  resolvedMinimumGap: 0.12,
  plausibleMinimumScore: 0.4,
  explicitResolvedMinimumScore: 0.82,
} as const);

function productReference(product: RankedProductIntentCandidate['product']): ProductIntentReference {
  return {
    productId: product.productId,
    ...(product.combinationId === undefined ? {} : { combinationId: product.combinationId }),
  };
}

export class DefaultProductIntentResolutionPolicy implements ProductIntentResolutionPolicy {
  constructor(
    private readonly parameters: ProductIntentResolutionPolicyParameters = DEFAULT_PRODUCT_INTENT_RESOLUTION_POLICY_PARAMETERS,
  ) {}

  resolve(
    candidates: readonly RankedProductIntentCandidate[],
    constraints: ExplicitProductConstraints,
  ): ProductIntentResolutionDecision {
    const explicitConstraintCount = [
      constraints.productType,
      constraints.weight,
      constraints.diameter,
      constraints.length,
      constraints.brand,
      constraints.reference,
      constraints.variant,
    ].filter((value) => value !== undefined).length;
    const plausibleCandidates = candidates.filter((candidate) => (
      candidate.plausible && candidate.score >= this.parameters.plausibleMinimumScore
    ));
    const top = plausibleCandidates[0];
    if (!top || top.score < this.parameters.plausibleMinimumScore) {
      return { status: 'no_match', confidence: 0 };
    }

    if (explicitConstraintCount > 0) {
      const fullyMatching = plausibleCandidates.filter((candidate) => candidate.constraintEvaluation.satisfiesAllExplicitConstraints);
      if (fullyMatching.length === 1 && fullyMatching[0]!.score >= this.parameters.explicitResolvedMinimumScore) {
        return {
          status: 'resolved',
          confidence: fullyMatching[0]!.score,
          sourceProduct: productReference(fullyMatching[0]!.product),
        };
      }
      if (fullyMatching.length === 0 && plausibleCandidates.length === 0) {
        return { status: 'no_match', confidence: 0 };
      }
      return {
        status: 'clarification_required',
        confidence: top.score,
      };
    }

    const second = plausibleCandidates[1];
    const gap = second ? top.score - second.score : 1;
    if (top.score >= this.parameters.resolvedMinimumScore && gap >= this.parameters.resolvedMinimumGap) {
      return {
        status: 'resolved',
        confidence: top.score,
        sourceProduct: productReference(top.product),
      };
    }

    return {
      status: 'clarification_required',
      confidence: top.score,
    };
  }
}
