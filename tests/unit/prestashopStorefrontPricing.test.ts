import { describe, expect, it } from 'vitest';
import { calculatePrice } from '../../src/domain/catalog/v2/commercialEngine.js';
import type { CatalogV2Product, CatalogV2SpecificPrice, CatalogV2Variant } from '../../src/domain/catalog/v2/contracts.js';
import { CommercialPriceCalculator } from '../../src/domain/catalog/commercial-truth/priceCalculator.js';
import type { CatalogCommercialRawProduct, CatalogCommercialSpecificPrice } from '../../src/domain/catalog/commercial-truth/contracts.js';
import { phpRoundHalfUp, prestashopUnitPrice } from '../../src/domain/pricing/prestashopPrice.js';
import { STOREFRONT_TAX_RATE, storefrontPricingCases } from '../fixtures/prestashopStorefrontPricing.js';

// R4-J1D-R1: both Catalog price paths must publish the price the PrestaShop storefront shows.
const now = new Date('2026-09-30T17:00:00.000Z');

function v2Price(baseNet: number, reduction: number) {
  const product: CatalogV2Product = {
    productId: 1, basePriceNet: baseNet, name: 'Parity', sku: null, shortDescription: null, brand: null,
    weightKg: null, linkRewrite: null, category: null, active: true, listed: true, orderable: true,
    variants: [], specifications: [], globalBackorderAllowed: false, specificPrices: [], asOf: now.toISOString(),
  };
  const variant: CatalogV2Variant = {
    combinationId: 0, sku: null, attributes: [], impactPriceNet: 0, isDefault: true, availableQuantity: 1, outOfStock: 2,
  };
  const row: CatalogV2SpecificPrice = {
    idSpecificPrice: 1, combinationId: 0, shopId: 0, currencyId: 0, countryId: 0, groupId: 0, customerId: 0, cartId: 0,
    price: -1, fromQuantity: 1, reduction, reductionTax: 1, reductionType: 'percentage', from: null, to: null,
  };
  return calculatePrice({
    product,
    variant,
    specificPrices: [row],
    context: { quantity: 1, shopId: 1, currencyId: 1, countryId: 0, customerGroupId: 0, customerId: 0, currencyCode: 'CLP', taxRate: STOREFRONT_TAX_RATE },
    now,
  });
}

function legacyPrice(baseNet: number, reduction: number) {
  const rawProduct: CatalogCommercialRawProduct = {
    productId: 1, combinationId: 0, name: 'Parity', productReference: null, combinationReference: null, description: null,
    category: null, linkRewrite: null, hasCombinations: false, variantAttributeLabels: [], active: true, availableForOrder: true,
    productBasePriceNet: baseNet, combinationImpactNet: 0, stockQuantity: 1,
  };
  const selectedSpecificPrice: CatalogCommercialSpecificPrice = {
    idSpecificPrice: 1, productId: 1, combinationId: 0, shopId: 0, currencyId: 0, countryId: 0, groupId: 0, customerId: 0,
    cartId: 0, price: -1, fromQuantity: 1, reduction, reductionTax: 1, reductionType: 'percentage', from: null, to: null,
  };
  return new CommercialPriceCalculator().calculate({
    product: { productId: '1' },
    rawProduct,
    selectedSpecificPrice,
    context: { shopId: 1, currencyId: 1, currencyCode: 'CLP', countryId: 0, customerGroupId: 0, customerId: 0, quantity: 1, taxRate: STOREFRONT_TAX_RATE },
    evaluatedAt: now.toISOString(),
  }).price;
}

describe('PrestaShop storefront price parity — 20 production boundary units (R4-J1D-R1)', () => {
  it.each(storefrontPricingCases)('v2 engine: $productKey → $storefrontFinalGross', (unit) => {
    const result = v2Price(Number(unit.baseNet), Number(unit.reduction));
    expect(result?.finalGross).toBe(unit.storefrontFinalGross);
    if (unit.storefrontRegularGross !== undefined) expect(result?.regularGross).toBe(unit.storefrontRegularGross);
  });

  it.each(storefrontPricingCases)('commercial-truth calculator: $productKey → $storefrontFinalGross', (unit) => {
    const result = legacyPrice(Number(unit.baseNet), Number(unit.reduction));
    expect(result?.finalGrossAmount).toBe(unit.storefrontFinalGross);
    if (unit.storefrontRegularGross !== undefined) expect(result?.baseGrossAmount).toBe(unit.storefrontRegularGross);
  });
});

describe('phpRoundHalfUp — PHP 7 round(…, PHP_ROUND_HALF_UP)', () => {
  it.each([
    // PHP manual / known pre-rounding behaviour: the literal decimal is honoured.
    [1.955, 2, 1.96],
    [5.045, 2, 5.05],
    [5.055, 2, 5.06],
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [1234567.891, -3, 1235000],
    [0.285, 2, 0.29],
    [0, 6, 0],
  ])('round(%s, %s) = %s', (value, places, expected) => {
    expect(phpRoundHalfUp(value, places)).toBe(expected);
  });
});

describe('prestashopUnitPrice — PrestaShop 1.7.8.3 unit price', () => {
  const unit = (priceNet: number, reduction: Parameters<typeof prestashopUnitPrice>[0]['reduction'] = null) =>
    prestashopUnitPrice({ priceNet, taxRate: STOREFRONT_TAX_RATE, reduction });

  it('prices without promotion at the currency precision', () => {
    expect(unit(100000)).toEqual({ regularGross: 119000, finalGross: 119000, reductionGross: 0 });
    expect(unit(71420.168067).finalGross).toBe(84990); // P545, storefront 84 990
    expect(unit(17638.655462).finalGross).toBe(20990); // P2248, storefront 20 990
  });

  it('applies an ordinary percentage on the tax-included price', () => {
    expect(unit(100000, { type: 'percentage', rate: 0.1 })).toEqual({ regularGross: 119000, finalGross: 107100, reductionGross: 11900 });
    expect(unit(26042.016807, { type: 'percentage', rate: 0.3 }).finalGross).toBe(21693); // P1136 variants, storefront 21 693
  });

  it('rounds to 6 decimals before the currency precision (the boundary the J1D engine missed)', () => {
    // 11 756.302521 × 1.19 × 0.45 = 6 295.4999999… → 6 295.500000 → 6 296 (storefront); one rounding gives 6 295.
    expect(unit(11756.302521, { type: 'percentage', rate: 0.55 }).finalGross).toBe(6296);
    // 151 252.1008 × 1.19 × 0.65 = 116 993.49996… stays below the half → 116 993 (storefront).
    expect(unit(151252.1008, { type: 'percentage', rate: 0.35 }).finalGross).toBe(116993);
  });

  it('treats an amount reduction the same whatever its tax basis', () => {
    const taxIncluded = unit(100000, { type: 'amount', amount: 10000, taxIncluded: true });
    const taxExcluded = unit(100000, { type: 'amount', amount: 8403.361345, taxIncluded: false });
    expect(taxIncluded).toEqual({ regularGross: 119000, finalGross: 109000, reductionGross: 10000 });
    expect(taxExcluded).toEqual(taxIncluded);
  });

  it('keeps the regular price under a 0 % reduction and never goes negative', () => {
    expect(unit(12345.678901, { type: 'percentage', rate: 0 })).toEqual(unit(12345.678901));
    expect(unit(1000, { type: 'amount', amount: 999999, taxIncluded: true }).finalGross).toBe(0);
    expect(unit(1000, { type: 'percentage', rate: 1 }).finalGross).toBe(0);
  });

  it('keeps final ≤ regular and regular − final within 1 CLP of the published reduction', () => {
    for (let net = 0.5; net < 2_000_000; net = net * 1.37 + 0.123457) {
      for (const rate of [0.05, 0.1, 0.15, 0.3, 0.35, 0.45, 0.55, 0.8]) {
        const price = unit(Number(net.toFixed(6)), { type: 'percentage', rate });
        expect(price.finalGross).toBeGreaterThanOrEqual(0);
        expect(price.finalGross).toBeLessThanOrEqual(price.regularGross);
        expect(Math.abs(price.regularGross - price.finalGross - price.reductionGross)).toBeLessThanOrEqual(1);
      }
    }
  });
});
