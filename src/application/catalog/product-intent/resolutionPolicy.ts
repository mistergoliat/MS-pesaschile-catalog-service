import type {
  ProductIntentReference,
  ProductIntentResolutionDecision,
  ProductIntentResolutionPolicy,
  RankedProductIntentCandidate,
} from './contracts.js';

export type ProductIntentResolutionPolicyParameters = {
  readonly resolvedMinimumScore: number;
  readonly resolvedMinimumGap: number;
  readonly plausibleMinimumScore: number;
};

export const DEFAULT_PRODUCT_INTENT_RESOLUTION_POLICY_PARAMETERS = Object.freeze({
  resolvedMinimumScore: 0.82,
  resolvedMinimumGap: 0.12,
  plausibleMinimumScore: 0.4,
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

  resolve(candidates: readonly RankedProductIntentCandidate[]): ProductIntentResolutionDecision {
    const top = candidates[0];
    if (!top || top.score < this.parameters.plausibleMinimumScore) {
      return { status: 'no_match', confidence: 0 };
    }

    const second = candidates[1];
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
