import { prestashopUnitPrice } from '../../pricing/prestashopPrice.js';
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
    const effectiveBaseNet = selected && selected.price >= 0
      ? selected.price + (input.rawProduct.combinationImpactNet ?? 0)
      : catalogBaseNet;
    const taxRate = input.context.taxRate;
    // R4-J1D-R1: PrestaShop's own storefront arithmetic (prestashopPrice.ts).
    const baseGrossAmount = prestashopUnitPrice({ priceNet: Math.max(catalogBaseNet, 0), taxRate, reduction: null }).regularGross;
    const effectiveNet = Math.max(effectiveBaseNet, 0);

    let finalGrossAmount = prestashopUnitPrice({ priceNet: effectiveNet, taxRate, reduction: null }).finalGross;
    let discountType: CatalogCommercialPrice['discountType'] = null;
    let discountValue: number | null = null;

    if (selected && selected.reduction > 0) {
      if (selected.reductionType === 'percentage') {
        if (selected.reduction > 1 || !Number.isFinite(selected.reduction)) {
          warnings.push(warning('SPECIFIC_PRICE_INVALID_REDUCTION', input.product, {
            specificPriceId: selected.idSpecificPrice,
          }));
        } else {
          finalGrossAmount = prestashopUnitPrice({
            priceNet: effectiveNet,
            taxRate,
            reduction: { type: 'percentage', rate: selected.reduction },
          }).finalGross;
          discountType = 'percentage';
          discountValue = selected.reduction;
        }
      } else if (selected.reductionType === 'amount') {
        if (!Number.isFinite(selected.reduction)) {
          warnings.push(warning('SPECIFIC_PRICE_INVALID_REDUCTION', input.product, {
            specificPriceId: selected.idSpecificPrice,
          }));
        } else {
          const unit = prestashopUnitPrice({
            priceNet: effectiveNet,
            taxRate,
            reduction: { type: 'amount', amount: selected.reduction, taxIncluded: selected.reductionTax === 1 },
          });
          if (unit.reductionGross > baseGrossAmount) {
            warnings.push(warning('SPECIFIC_PRICE_EXCEEDS_BASE_PRICE', input.product, {
              specificPriceId: selected.idSpecificPrice,
              baseGrossAmount,
              reductionGrossAmount: unit.reductionGross,
            }));
          }
          finalGrossAmount = unit.finalGross;
          discountType = 'amount';
          discountValue = selected.reduction;
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

function baseNet(product: CatalogCommercialRawProduct): number | null {
  if (
    product.productBasePriceNet === null ||
    product.combinationImpactNet === null ||
    !Number.isFinite(product.productBasePriceNet) ||
    !Number.isFinite(product.combinationImpactNet)
  ) {
    return null;
  }
  // Summed as PrestaShop does ((float) price + attribute_price).
  const value = product.productBasePriceNet + product.combinationImpactNet;
  return value < 0 ? null : value;
}
