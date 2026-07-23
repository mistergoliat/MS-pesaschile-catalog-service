import { decimal, Decimal, toCurrencyInteger } from '../../../shared/money.js';
import type {
  CatalogCommercialContext,
  CatalogCommercialPrice,
  CatalogCommercialProductReference,
  CatalogCommercialRawProduct,
  CatalogCommercialSpecificPrice,
  CatalogCommercialWarning,
} from './contracts.js';

type PriceCalculationInput = {
  readonly product: CatalogCommercialProductReference;
  readonly rawProduct: CatalogCommercialRawProduct;
  readonly selectedSpecificPrice: CatalogCommercialSpecificPrice | null;
  readonly context: CatalogCommercialContext;
  readonly evaluatedAt: string;
};

export type PriceCalculationResult = {
  readonly price: CatalogCommercialPrice | null;
  readonly warnings: readonly CatalogCommercialWarning[];
};

export class CommercialPriceCalculator {
  calculate(input: PriceCalculationInput): PriceCalculationResult {
    const warnings: CatalogCommercialWarning[] = [];
    const catalogBaseNet = baseNet(input.rawProduct);
    if (catalogBaseNet === null) {
      return {
        price: null,
        warnings: [
          warning('CATALOG_INVALID_BASE_PRICE', input.product),
          warning('CATALOG_PRICE_UNAVAILABLE', input.product),
        ],
      };
    }

    const selected = input.selectedSpecificPrice;
    const selectedBaseNet = selected && selected.price >= 0
      ? decimal(selected.price).plus(input.rawProduct.combinationImpactNet ?? 0)
      : catalogBaseNet;
    const positiveBaseNet = Decimal.max(selectedBaseNet, 0);
    const baseGrossAmount = toCurrencyInteger(positiveBaseNet.mul(decimal(1).plus(input.context.taxRate)));

    let finalGrossAmount = baseGrossAmount;
    let discountType: CatalogCommercialPrice['discountType'] = null;
    let discountValue: number | null = null;

    if (selected && selected.reduction > 0) {
      if (selected.reductionType === 'percentage') {
        if (selected.reduction > 1 || !Number.isFinite(selected.reduction)) {
          warnings.push(warning('SPECIFIC_PRICE_INVALID_REDUCTION', input.product, {
            specificPriceId: selected.idSpecificPrice,
          }));
        } else {
          finalGrossAmount = toCurrencyInteger(decimal(baseGrossAmount).mul(decimal(1).minus(selected.reduction)));
          discountType = 'percentage';
          discountValue = selected.reduction;
        }
      } else if (selected.reductionType === 'amount') {
        if (!Number.isFinite(selected.reduction)) {
          warnings.push(warning('SPECIFIC_PRICE_INVALID_REDUCTION', input.product, {
            specificPriceId: selected.idSpecificPrice,
          }));
        } else {
          const grossReduction = toCurrencyInteger(selected.reduction);
          if (grossReduction > baseGrossAmount) {
            warnings.push(warning('SPECIFIC_PRICE_EXCEEDS_BASE_PRICE', input.product, {
              specificPriceId: selected.idSpecificPrice,
              baseGrossAmount,
              reductionGrossAmount: grossReduction,
            }));
          }
          finalGrossAmount = Math.max(baseGrossAmount - grossReduction, 0);
          discountType = 'amount';
          discountValue = grossReduction;
        }
      } else {
        warnings.push(warning('SPECIFIC_PRICE_UNSUPPORTED_REDUCTION_TYPE', input.product, {
          specificPriceId: selected.idSpecificPrice,
          reductionType: selected.reductionType,
        }));
      }
    } else if (selected && selected.reduction < 0) {
      warnings.push(warning('SPECIFIC_PRICE_INVALID_REDUCTION', input.product, {
        specificPriceId: selected.idSpecificPrice,
      }));
    }

    return {
      price: {
        baseGrossAmount,
        finalGrossAmount,
        currency: input.context.currencyCode,
        taxIncluded: true,
        taxRate: input.context.taxRate,
        discountApplied: finalGrossAmount < baseGrossAmount,
        discountType,
        discountValue,
        specificPriceId: selected?.idSpecificPrice ?? null,
        evaluatedAt: input.evaluatedAt,
      },
      warnings,
    };
  }
}

function warning(
  code: CatalogCommercialWarning['code'],
  product: CatalogCommercialProductReference,
  details?: CatalogCommercialWarning['details'],
): CatalogCommercialWarning {
  return details === undefined ? { code, product } : { code, product, details };
}

function baseNet(product: CatalogCommercialRawProduct) {
  if (
    product.productBasePriceNet === null ||
    product.combinationImpactNet === null ||
    !Number.isFinite(product.productBasePriceNet) ||
    !Number.isFinite(product.combinationImpactNet)
  ) {
    return null;
  }
  const value = decimal(product.productBasePriceNet).plus(product.combinationImpactNet);
  return value.toNumber() < 0 ? null : value;
}
