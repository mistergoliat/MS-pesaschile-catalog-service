import {
  DEFAULT_PRODUCT_RECOMMENDATION_ELIGIBILITY_PARAMETERS,
  productRecommendationEligibilityParametersSchema,
  type ProductRecommendationCandidateContext,
  type ProductRecommendationEligibilityEvaluator,
  type ProductRecommendationEligibilityParameters,
  type ProductRecommendationEligibilityResult,
  type ProductRecommendationReason,
  type ProductRecommendationRejectionReason,
  type ProductRecommendationWarning,
} from './contracts.js';
import { createProductRuntimeIdentity } from '../runtime/productIdentity.js';
import { ProductRelationshipRuntimeError } from '../runtime/errors.js';

function identitiesFor(products: readonly { productId: string; combinationId?: string }[] | undefined): Set<string> {
  return new Set((products ?? []).map((product) => createProductRuntimeIdentity(product)));
}

function reject(code: ProductRecommendationRejectionReason['code'], details?: ProductRecommendationRejectionReason['details']): ProductRecommendationEligibilityResult {
  return {
    eligible: false,
    rejectionReasons: [
      {
        code,
        ...(details === undefined ? {} : { details }),
      },
    ],
  };
}

function addWarning(
  warnings: ProductRecommendationWarning[],
  code: ProductRecommendationWarning['code'],
  details?: ProductRecommendationWarning['details'],
): void {
  if (warnings.some((warning) => warning.code === code)) {
    return;
  }
  warnings.push({
    code,
    ...(details === undefined ? {} : { details }),
  });
}

function addReason(
  reasons: ProductRecommendationReason[],
  code: ProductRecommendationReason['code'],
  contribution?: number,
): void {
  if (reasons.some((reason) => reason.code === code)) {
    return;
  }
  reasons.push({
    code,
    ...(contribution === undefined ? {} : { contribution }),
  });
}

export class DefaultProductRecommendationEligibilityEvaluator implements ProductRecommendationEligibilityEvaluator {
  private readonly parameters: ProductRecommendationEligibilityParameters;

  constructor(parameters: ProductRecommendationEligibilityParameters = DEFAULT_PRODUCT_RECOMMENDATION_ELIGIBILITY_PARAMETERS) {
    this.parameters = productRecommendationEligibilityParametersSchema.parse(parameters);
  }

  evaluate(candidate: ProductRecommendationCandidateContext): ProductRecommendationEligibilityResult {
    let sourceIdentity: string;
    let productIdentity: string;
    try {
      sourceIdentity = createProductRuntimeIdentity(candidate.request.sourceProduct);
      productIdentity = createProductRuntimeIdentity(candidate.relationship.targetProduct);
    } catch (error) {
      if (error instanceof ProductRelationshipRuntimeError) {
        return reject('INVALID_PRODUCT_IDENTITY');
      }
      throw error;
    }

    if (productIdentity === sourceIdentity) {
      return reject('SOURCE_PRODUCT');
    }
    if (identitiesFor(candidate.request.excludedProducts).has(productIdentity)) {
      return reject('EXPLICITLY_EXCLUDED');
    }

    const warnings: ProductRecommendationWarning[] = [];
    const reasons: ProductRecommendationReason[] = [];

    if (identitiesFor(candidate.request.cartProducts).has(productIdentity)) {
      if (this.parameters.excludeCartProducts) {
        return reject('ALREADY_IN_CART');
      }
      addWarning(warnings, 'ALREADY_IN_CART');
    }

    if (identitiesFor(candidate.request.alreadyPurchasedProducts).has(productIdentity)) {
      if (this.parameters.excludePreviouslyPurchasedProducts) {
        return reject('ALREADY_PURCHASED');
      }
      addWarning(warnings, 'ALREADY_PURCHASED');
    }

    if (!candidate.commercialData.active) {
      return reject('INACTIVE');
    }
    if (!candidate.commercialData.sellable) {
      return reject('NOT_SELLABLE');
    }

    const includeOutOfStock = candidate.request.includeOutOfStock === true;
    const shouldExcludeOutOfStock = this.parameters.excludeOutOfStock && !includeOutOfStock;
    if ((candidate.commercialData.stockStatus === 'out_of_stock' || !candidate.commercialData.available) && shouldExcludeOutOfStock) {
      return reject('OUT_OF_STOCK');
    }
    if (candidate.commercialData.stockStatus === 'out_of_stock' || !candidate.commercialData.available) {
      addWarning(warnings, 'OUT_OF_STOCK_INCLUDED');
    } else if (candidate.commercialData.stockStatus === 'low_stock') {
      addWarning(warnings, 'LOW_STOCK');
      addReason(reasons, 'LOW_STOCK', 2);
    } else if (candidate.commercialData.stockStatus === 'unknown') {
      addWarning(warnings, 'UNKNOWN_STOCK');
    } else {
      addReason(reasons, 'AVAILABLE', 5);
    }

    if (candidate.commercialData.compatibilityStatus === 'incompatible') {
      return reject('INCOMPATIBLE');
    }
    if (candidate.commercialData.compatibilityStatus === 'unknown') {
      if (this.parameters.rejectUnknownCompatibility) {
        return reject('UNKNOWN_COMPATIBILITY');
      }
      addWarning(warnings, 'UNKNOWN_COMPATIBILITY');
    } else {
      addReason(reasons, 'COMPATIBLE', 5);
    }

    const budget = candidate.request.recommendationContext?.budget;
    if (budget) {
      if (!candidate.commercialData.price) {
        addWarning(warnings, 'PRICE_UNAVAILABLE');
      } else if (candidate.commercialData.price.currency !== budget.currency) {
        addWarning(warnings, 'CURRENCY_MISMATCH', {
          expected: budget.currency,
          actual: candidate.commercialData.price.currency,
        });
      } else {
        if (budget.maximum !== undefined && candidate.commercialData.price.amount > budget.maximum) {
          return reject('ABOVE_BUDGET', {
            maximum: budget.maximum,
            amount: candidate.commercialData.price.amount,
          });
        }
        addReason(reasons, 'WITHIN_BUDGET');
      }
    }

    const evidence = candidate.relationship.evidence;
    if (candidate.relationship.reliability >= 0.7) addReason(reasons, 'STRONG_RELATIONSHIP', candidate.relationship.reliability);
    if (evidence.kind === 'co_occurrence') {
      if (evidence.confidence >= 0.5) addReason(reasons, 'HIGH_CONFIDENCE', evidence.confidence);
      if (evidence.lift >= 2) addReason(reasons, 'HIGH_LIFT', evidence.lift);
    }
    if (candidate.commercialData.marginSignal === 'high') {
      addReason(reasons, 'HIGH_MARGIN_SIGNAL', 3);
    }

    return {
      eligible: true,
      reasons,
      warnings,
    };
  }
}
