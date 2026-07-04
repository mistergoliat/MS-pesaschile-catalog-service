import { describe, expect, it } from 'vitest';
import { resolvePrice, selectSpecificPrice } from '../../src/infrastructure/pricing/priceResolver.js';
import type { PriceContext } from '../../src/domain/pricing/types.js';
import type { SpecificPriceCandidate } from '../../src/domain/pricing/types.js';

const context: PriceContext = {
  productId: 10,
  combinationId: 20,
  quantity: 2,
  shopId: 1,
  currencyId: 1,
  countryId: 0,
  customerGroupId: 3,
  customerId: 0,
  currencyCode: 'CLP',
  taxRate: 0.19,
};

function row(overrides: Partial<SpecificPriceCandidate>): SpecificPriceCandidate {
  return {
    id_specific_price: 1,
    id_product_attribute: 0,
    id_shop: 0,
    id_currency: 0,
    id_country: 0,
    id_group: 0,
    id_customer: 0,
    price: -1,
    from_quantity: 1,
    reduction: 0,
    reduction_tax: 0,
    reduction_type: 'amount',
    from: null,
    to: null,
    ...overrides,
  };
}

describe('selectSpecificPrice', () => {
  it('prefers a combination and shop-specific rule', () => {
    const selected = selectSpecificPrice(
      [
        row({ id_specific_price: 1 }),
        row({ id_specific_price: 2, id_product_attribute: 20, id_shop: 1, id_group: 3 }),
      ],
      context,
    );

    expect(selected?.id_specific_price).toBe(2);
  });

  it('prefers the largest valid quantity break', () => {
    const selected = selectSpecificPrice(
      [row({ id_specific_price: 1, from_quantity: 1 }), row({ id_specific_price: 2, from_quantity: 2 })],
      context,
    );

    expect(selected?.id_specific_price).toBe(2);
  });

  it('skips future rules', () => {
    const selected = selectSpecificPrice([row({ from: '2099-01-01 00:00:00' })], context);
    expect(selected).toBeNull();
  });

  it('prefers specific rows over wildcards', () => {
    const selected = selectSpecificPrice(
      [
        row({ id_specific_price: 1, id_product_attribute: 0, id_shop: 0 }),
        row({ id_specific_price: 2, id_product_attribute: 20, id_shop: 1 }),
      ],
      context,
    );

    expect(selected?.id_specific_price).toBe(2);
  });
});

describe('resolvePrice', () => {
  it('calculates product price plus combination impact and tax', () => {
    const result = resolvePrice(
      { baseProductPrice: 10000, combinationImpact: 2000, specificPrices: [] },
      context,
    );

    expect(result.baseUnitPrice).toBe(14280);
    expect(result.effectiveUnitPrice).toBe(14280);
    expect(result.subtotal).toBe(28560);
    expect(result.discountApplied).toBe(false);
  });

  it('applies a percentage reduction', () => {
    const result = resolvePrice(
      { baseProductPrice: 10000, combinationImpact: 0, specificPrices: [row({ reduction_type: 'percentage', reduction: 0.1 })] },
      context,
    );

    expect(result.effectiveUnitPrice).toBe(10710);
    expect(result.discountApplied).toBe(true);
    expect(result.discountType).toBe('percentage');
  });

  it('applies a tax-included amount reduction', () => {
    const result = resolvePrice(
      { baseProductPrice: 10000, combinationImpact: 0, specificPrices: [row({ reduction_type: 'amount', reduction: 1190, reduction_tax: 1 })] },
      context,
    );

    expect(result.effectiveUnitPrice).toBe(10710);
    expect(result.discountApplied).toBe(true);
    expect(result.discountType).toBe('amount');
  });

  it('applies a specific fixed price per combination', () => {
    const result = resolvePrice(
      { baseProductPrice: 10000, combinationImpact: 0, specificPrices: [row({ id_product_attribute: 20, price: 9000 })] },
      context,
    );

    expect(result.effectiveUnitPrice).toBe(10710);
  });

  it('rounds monetary values to integers', () => {
    const result = resolvePrice(
      { baseProductPrice: 9999, combinationImpact: 0, specificPrices: [] },
      context,
    );

    expect(result.baseUnitPrice).toBe(11899);
  });
});
