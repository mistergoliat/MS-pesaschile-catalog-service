/**
 * PrestaShop 1.7.8.3 unit-price semantics, the single pricing primitive of both
 * Catalog price paths (v2 `commercialEngine` and commercial-truth
 * `CommercialPriceCalculator`). R4-J1D-R1.
 *
 * Source (tag 1.7.8.3): the storefront price of a product (tax-included display,
 * `price_display_method = 0`) is
 *   Product::getProductProperties → Tools::ps_round(Product::getPriceStatic(…, $decimals = 6, …), computingPrecision)
 *   Product::priceCalculation     → $price (+ attribute impact) → TaxCalculator::addTaxes ($price * (1 + rate/100))
 *                                   → $price -= reduction (percentage: $price * reduction; amount: tax-included)
 *                                   → Tools::ps_round($price, 6) → max(0, …)
 *   Tools::ps_round (PS_ROUND_HALF_UP) → Tools::math_round → PHP round($value, $places, PHP_ROUND_HALF_UP)
 * i.e. IEEE-754 double arithmetic rounded TWICE, first to 6 decimals then to the
 * currency precision (CLP: 0). Rounding once (J1D, catalog-commercial-v2.1.0)
 * published 1 CLP less than the storefront on half-peso boundaries.
 *
 * The arithmetic is deliberately done in doubles, like PHP: PrestaShop's result is
 * defined by that arithmetic, so an exact-decimal computation is not "more correct".
 */

export const PRESTASHOP_PRICE_COMPUTE_DECIMALS = 6;

function intPow10(power: number): number {
  // php_intpow10: exact powers of ten up to 1e22.
  return power >= 0 && power <= 22 ? Number(`1e${power}`) : 10 ** power;
}

function roundHelperHalfUp(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

/**
 * PHP 7 `round($value, $places, PHP_ROUND_HALF_UP)` (`_php_math_round`, also
 * PrestaShop's `Tools::math_round` fallback): pre-rounds to the 15 significant
 * digits a double guarantees, then rounds half away from zero.
 */
export function phpRoundHalfUp(value: number, places: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const precisionPlaces = 14 - Math.floor(Math.log10(Math.abs(value)));
  const f1 = intPow10(Math.abs(places));
  let tmp: number;
  if (precisionPlaces > places && precisionPlaces - 15 < places) {
    const usePrecision = Math.max(precisionPlaces, -60);
    tmp = roundHelperHalfUp(usePrecision >= 0 ? value * intPow10(usePrecision) : value / intPow10(-usePrecision));
    tmp /= intPow10(Math.abs(Math.max(places - usePrecision, -60)));
  } else {
    tmp = places >= 0 ? value * f1 : value / f1;
    if (Math.abs(tmp) >= 1e15) return value;
  }
  tmp = roundHelperHalfUp(tmp);
  return places > 0 ? tmp / f1 : tmp * f1;
}

export type PrestashopReduction =
  | { readonly type: 'percentage'; readonly rate: number }
  | { readonly type: 'amount'; readonly amount: number; readonly taxIncluded: boolean };

export type PrestashopUnitPrice = {
  /** Price without reduction, tax included, at currency precision. */
  readonly regularGross: number;
  /** Price after the reduction, tax included, at currency precision, never negative. */
  readonly finalGross: number;
  /** The reduction, tax included, at currency precision (PrestaShop's `reduction`). */
  readonly reductionGross: number;
};

/**
 * One unit's storefront prices. `priceNet` is the tax-excluded unit price the
 * reduction applies to (base or fixed-price override, plus the combination impact).
 */
export function prestashopUnitPrice(input: {
  readonly priceNet: number;
  readonly taxRate: number;
  readonly reduction: PrestashopReduction | null;
  readonly currencyDecimals?: number;
}): PrestashopUnitPrice {
  const decimals = input.currencyDecimals ?? 0;
  const taxFactor = 1 + input.taxRate;
  const gross = input.priceNet * taxFactor;
  let reduction = 0;
  if (input.reduction?.type === 'percentage') {
    reduction = gross * input.reduction.rate;
  } else if (input.reduction?.type === 'amount') {
    reduction = input.reduction.taxIncluded ? input.reduction.amount : input.reduction.amount * taxFactor;
  }
  const atCurrency = (value: number) => phpRoundHalfUp(phpRoundHalfUp(value, PRESTASHOP_PRICE_COMPUTE_DECIMALS), decimals);
  const finalAtCompute = phpRoundHalfUp(gross - reduction, PRESTASHOP_PRICE_COMPUTE_DECIMALS);
  return {
    regularGross: atCurrency(gross),
    finalGross: finalAtCompute < 0 ? 0 : phpRoundHalfUp(finalAtCompute, decimals),
    reductionGross: atCurrency(reduction),
  };
}
