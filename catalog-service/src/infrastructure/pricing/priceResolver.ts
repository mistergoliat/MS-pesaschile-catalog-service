import type { PriceContext, PriceResolution, SpecificPriceCandidate } from '../../domain/pricing/types.js';
import { Decimal as DecimalStatic, decimal, toCurrencyInteger, toPercent } from '../../shared/money.js';

function isValidDateWindow(value: string | Date | null | undefined): boolean {
  if (!value || value === '0000-00-00 00:00:00') {
    return true;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now();
}

function isStillActive(value: string | Date | null | undefined): boolean {
  if (!value || value === '0000-00-00 00:00:00') {
    return true;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now();
}

function specificityScore(row: SpecificPriceCandidate, context: PriceContext): number[] {
  return [
    row.id_product_attribute === context.combinationId ? 1 : 0,
    row.id_shop === context.shopId ? 1 : 0,
    row.id_currency === context.currencyId ? 1 : 0,
    row.id_country === context.countryId ? 1 : 0,
    row.id_group === context.customerGroupId ? 1 : 0,
    row.id_customer === context.customerId ? 1 : 0,
    row.from_quantity,
    row.priority ?? 0,
    -row.id_specific_price,
  ];
}

export function selectSpecificPrice(
  rows: SpecificPriceCandidate[],
  context: PriceContext,
): SpecificPriceCandidate | null {
  const valid = rows.filter((row) => {
    if (row.from_quantity > context.quantity) {
      return false;
    }
    if (![0, context.combinationId].includes(row.id_product_attribute)) {
      return false;
    }
    if (![0, context.shopId].includes(row.id_shop)) {
      return false;
    }
    if (![0, context.currencyId].includes(row.id_currency)) {
      return false;
    }
    if (![0, context.countryId].includes(row.id_country)) {
      return false;
    }
    if (![0, context.customerGroupId].includes(row.id_group)) {
      return false;
    }
    if (![0, context.customerId].includes(row.id_customer)) {
      return false;
    }
    if (!isValidDateWindow(row.from)) {
      return false;
    }
    if (!isStillActive(row.to)) {
      return false;
    }
    return true;
  });

  return valid.sort((left, right) => {
    const leftScore = specificityScore(left, context);
    const rightScore = specificityScore(right, context);
    for (let index = 0; index < leftScore.length; index += 1) {
      const leftValue = leftScore[index] ?? 0;
      const rightValue = rightScore[index] ?? 0;
      if (leftValue !== rightValue) {
        return rightValue - leftValue;
      }
    }
    return 0;
  })[0] ?? null;
}

export function resolvePrice(
  input: {
    baseProductPrice: number;
    combinationImpact: number;
    specificPrices: SpecificPriceCandidate[];
  },
  context: PriceContext,
): PriceResolution {
  const taxMultiplier = decimal(1).plus(context.taxRate);
  const catalogBaseTaxExcluded = DecimalStatic.max(
    decimal(input.baseProductPrice).plus(input.combinationImpact),
    0,
  );
  const selected = selectSpecificPrice(input.specificPrices, context);

  let effectiveTaxExcluded = catalogBaseTaxExcluded;
  let discountType: PriceResolution['discountType'] = null;
  let discountValue: number | null = null;

  if (selected) {
    if (selected.price >= 0) {
      effectiveTaxExcluded = decimal(selected.price).plus(input.combinationImpact);
    }

    if (selected.reduction_type === 'percentage' && selected.reduction > 0) {
      effectiveTaxExcluded = effectiveTaxExcluded.mul(decimal(1).minus(selected.reduction));
      discountType = 'percentage';
      discountValue = toPercent(selected.reduction);
    } else if (selected.reduction_type === 'amount' && selected.reduction > 0) {
      const reductionTaxExcluded = selected.reduction_tax === 1
        ? decimal(selected.reduction).div(taxMultiplier)
        : decimal(selected.reduction);
      effectiveTaxExcluded = effectiveTaxExcluded.minus(reductionTaxExcluded);
      discountType = 'amount';
      discountValue = selected.reduction_tax === 1
        ? toCurrencyInteger(reductionTaxExcluded)
        : toCurrencyInteger(selected.reduction);
    }
  }

  effectiveTaxExcluded = DecimalStatic.max(effectiveTaxExcluded, 0);

  const baseUnitPrice = toCurrencyInteger(catalogBaseTaxExcluded.mul(taxMultiplier));
  const effectiveUnitPrice = toCurrencyInteger(effectiveTaxExcluded.mul(taxMultiplier));

  return {
    quantity: context.quantity,
    baseUnitPrice,
    effectiveUnitPrice,
    subtotal: effectiveUnitPrice * context.quantity,
    currency: context.currencyCode,
    taxIncluded: true,
    taxMode: 'configured_rate',
    discountApplied: effectiveUnitPrice < baseUnitPrice,
    discountType,
    discountValue,
    specificPriceId: selected?.id_specific_price ?? null,
    pricingMode: 'sql_specific_price',
  };
}
