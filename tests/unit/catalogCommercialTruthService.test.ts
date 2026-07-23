import { describe, expect, it } from 'vitest';
import {
  CatalogCommercialTruthService,
  CommercialAvailabilityResolver,
  CommercialPriceCalculator,
  SpecificPriceSelector,
  type CatalogCommercialContext,
  type CatalogCommercialDataReader,
  type CatalogCommercialRawProduct,
  type CatalogCommercialSpecificPrice,
} from '../../src/domain/catalog/commercial-truth/index.js';

const evaluatedAt = new Date('2026-07-23T12:00:00.000Z');

const context: CatalogCommercialContext = {
  shopId: 1,
  currencyId: 1,
  currencyCode: 'CLP',
  countryId: 0,
  customerGroupId: 0,
  customerId: 0,
  quantity: 1,
  taxRate: 0.19,
};

function raw(overrides: Partial<CatalogCommercialRawProduct> = {}): CatalogCommercialRawProduct {
  return {
    productId: 173,
    combinationId: 0,
    name: 'Barra olimpica',
    productReference: 'BAR-173',
    combinationReference: null,
    description: 'Producto de prueba',
    category: 'Barras',
    active: true,
    availableForOrder: true,
    productBasePriceNet: 1000,
    combinationImpactNet: 0,
    stockQuantity: 5,
    ...overrides,
  };
}

function specific(overrides: Partial<CatalogCommercialSpecificPrice> = {}): CatalogCommercialSpecificPrice {
  return {
    idSpecificPrice: 10,
    productId: 173,
    combinationId: 0,
    shopId: 0,
    currencyId: 0,
    countryId: 0,
    groupId: 0,
    customerId: 0,
    cartId: 0,
    price: -1,
    fromQuantity: 1,
    reduction: 0,
    reductionTax: 0,
    reductionType: 'percentage',
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-12-31T23:59:59.000Z',
    ...overrides,
  };
}

describe('CommercialAvailabilityResolver', () => {
  const resolver = new CommercialAvailabilityResolver();

  it.each([
    { product: raw({ active: false }), status: 'inactive', purchasable: false },
    { product: raw({ active: true, availableForOrder: false, stockQuantity: 5 }), status: 'unavailable_for_order', purchasable: false },
    { product: raw({ active: true, availableForOrder: true, stockQuantity: 5 }), status: 'available', purchasable: true },
    { product: raw({ active: true, availableForOrder: true, stockQuantity: 0 }), status: 'out_of_stock', purchasable: false },
    { product: raw({ active: true, availableForOrder: true, stockQuantity: null }), status: 'unknown', purchasable: false },
    { product: raw({ active: null, availableForOrder: true, stockQuantity: 5 }), status: 'unknown', purchasable: false },
  ])('resolves $status availability', ({ product, status, purchasable }) => {
    expect(resolver.resolve(product, evaluatedAt.toISOString())).toMatchObject({ status, purchasable });
  });
});

describe('SpecificPriceSelector', () => {
  const selector = new SpecificPriceSelector();

  it('prefers exact combination over base product discount', () => {
    const selected = selector.select({
      product: { productId: '173', combinationId: '20' },
      combinationId: 20,
      context,
      evaluatedAt,
      specificPrices: [
        specific({ idSpecificPrice: 1, combinationId: 0 }),
        specific({ idSpecificPrice: 2, combinationId: 20 }),
      ],
    }).selected;
    expect(selected?.idSpecificPrice).toBe(2);
  });

  it('prefers shop-specific price over global price', () => {
    const selected = selector.select({
      product: { productId: '173' },
      combinationId: 0,
      context,
      evaluatedAt,
      specificPrices: [
        specific({ idSpecificPrice: 1, shopId: 0 }),
        specific({ idSpecificPrice: 2, shopId: 1 }),
      ],
    }).selected;
    expect(selected?.idSpecificPrice).toBe(2);
  });

  it('prefers highest compatible from_quantity', () => {
    const selected = selector.select({
      product: { productId: '173' },
      combinationId: 0,
      context: { ...context, quantity: 5 },
      evaluatedAt,
      specificPrices: [
        specific({ idSpecificPrice: 1, fromQuantity: 1 }),
        specific({ idSpecificPrice: 2, fromQuantity: 5 }),
        specific({ idSpecificPrice: 3, fromQuantity: 6 }),
      ],
    }).selected;
    expect(selected?.idSpecificPrice).toBe(2);
  });

  it('prefers context-specific price over public price', () => {
    const selected = selector.select({
      product: { productId: '173' },
      combinationId: 0,
      context: { ...context, customerGroupId: 3 },
      evaluatedAt,
      specificPrices: [
        specific({ idSpecificPrice: 1, groupId: 0 }),
        specific({ idSpecificPrice: 2, groupId: 3 }),
      ],
    }).selected;
    expect(selected?.idSpecificPrice).toBe(2);
  });

  it('prefers more recent from date', () => {
    const selected = selector.select({
      product: { productId: '173' },
      combinationId: 0,
      context,
      evaluatedAt,
      specificPrices: [
        specific({ idSpecificPrice: 1, from: '2026-01-01T00:00:00.000Z' }),
        specific({ idSpecificPrice: 2, from: '2026-06-01T00:00:00.000Z' }),
      ],
    }).selected;
    expect(selected?.idSpecificPrice).toBe(2);
  });

  it('uses higher id as deterministic tie break and warns ambiguity', () => {
    const result = selector.select({
      product: { productId: '173' },
      combinationId: 0,
      context,
      evaluatedAt,
      specificPrices: [
        specific({ idSpecificPrice: 1 }),
        specific({ idSpecificPrice: 2 }),
      ],
    });
    expect(result.selected?.idSpecificPrice).toBe(2);
    expect(result.warnings.map((warning) => warning.code)).toContain('SPECIFIC_PRICE_SELECTION_AMBIGUOUS');
  });

  it.each([
    specific({ idSpecificPrice: 1, from: 'bad-date' }),
    specific({ idSpecificPrice: 2, to: 'bad-date' }),
  ])('ignores specific prices with invalid dates', (row) => {
    const result = selector.select({
      product: { productId: '173' },
      combinationId: 0,
      context,
      evaluatedAt,
      specificPrices: [row],
    });
    expect(result.selected).toBeNull();
    expect(result.warnings[0]?.code).toBe('SPECIFIC_PRICE_INVALID_DATE');
  });

  it.each([
    specific({ from: '2026-08-01T00:00:00.000Z' }),
    specific({ to: '2026-01-01T00:00:00.000Z' }),
    specific({ shopId: 2 }),
    specific({ currencyId: 2 }),
    specific({ countryId: 2 }),
    specific({ groupId: 2 }),
    specific({ customerId: 2 }),
    specific({ cartId: 99 }),
  ])('ignores incompatible specific prices', (row) => {
    const result = selector.select({
      product: { productId: '173' },
      combinationId: 0,
      context,
      evaluatedAt,
      specificPrices: [row],
    });
    expect(result.selected).toBeNull();
  });
});

describe('CommercialPriceCalculator', () => {
  const calculator = new CommercialPriceCalculator();

  it('calculates gross base price from net product price and IVA', () => {
    const result = calculator.calculate({
      product: { productId: '173' },
      rawProduct: raw({ productBasePriceNet: 1000 }),
      selectedSpecificPrice: null,
      context,
      evaluatedAt: evaluatedAt.toISOString(),
    });
    expect(result.price?.baseGrossAmount).toBe(1190);
    expect(result.price?.finalGrossAmount).toBe(1190);
  });

  it('adds combination impact before IVA', () => {
    const result = calculator.calculate({
      product: { productId: '173', combinationId: '20' },
      rawProduct: raw({ combinationId: 20, productBasePriceNet: 1000, combinationImpactNet: 100 }),
      selectedSpecificPrice: null,
      context,
      evaluatedAt: evaluatedAt.toISOString(),
    });
    expect(result.price?.baseGrossAmount).toBe(1309);
  });

  it('uses specific price as net base replacement', () => {
    const result = calculator.calculate({
      product: { productId: '173' },
      rawProduct: raw({ productBasePriceNet: 1000 }),
      selectedSpecificPrice: specific({ price: 500 }),
      context,
      evaluatedAt: evaluatedAt.toISOString(),
    });
    expect(result.price?.baseGrossAmount).toBe(595);
  });

  it('applies percentage reduction over gross price', () => {
    const result = calculator.calculate({
      product: { productId: '173' },
      rawProduct: raw({ productBasePriceNet: 1000 }),
      selectedSpecificPrice: specific({ reduction: 0.25, reductionType: 'percentage' }),
      context,
      evaluatedAt: evaluatedAt.toISOString(),
    });
    expect(result.price?.finalGrossAmount).toBe(893);
    expect(result.price?.discountType).toBe('percentage');
  });

  it('applies amount reduction as gross CLP without using reduction_tax', () => {
    const result = calculator.calculate({
      product: { productId: '173' },
      rawProduct: raw({ productBasePriceNet: 1000 }),
      selectedSpecificPrice: specific({ reduction: 190, reductionTax: 1, reductionType: 'amount' }),
      context,
      evaluatedAt: evaluatedAt.toISOString(),
    });
    expect(result.price?.finalGrossAmount).toBe(1000);
    expect(result.price?.discountValue).toBe(190);
  });

  it.each([
    specific({ reduction: 1.5, reductionType: 'percentage' }),
    specific({ reduction: Number.POSITIVE_INFINITY, reductionType: 'amount' }),
    specific({ reduction: -1, reductionType: 'amount' }),
  ])('ignores invalid reductions with warnings', (selectedSpecificPrice) => {
    const result = calculator.calculate({
      product: { productId: '173' },
      rawProduct: raw(),
      selectedSpecificPrice,
      context,
      evaluatedAt: evaluatedAt.toISOString(),
    });
    expect(result.price?.finalGrossAmount).toBe(1190);
    expect(result.warnings.map((warning) => warning.code)).toContain('SPECIFIC_PRICE_INVALID_REDUCTION');
  });

  it('warns and clamps amount reductions greater than base gross', () => {
    const result = calculator.calculate({
      product: { productId: '173' },
      rawProduct: raw(),
      selectedSpecificPrice: specific({ reduction: 2000, reductionType: 'amount' }),
      context,
      evaluatedAt: evaluatedAt.toISOString(),
    });
    expect(result.price?.finalGrossAmount).toBe(0);
    expect(result.warnings.map((warning) => warning.code)).toContain('SPECIFIC_PRICE_EXCEEDS_BASE_PRICE');
  });

  it('ignores unsupported reduction types with warnings', () => {
    const result = calculator.calculate({
      product: { productId: '173' },
      rawProduct: raw(),
      selectedSpecificPrice: specific({ reduction: 100, reductionType: 'mystery' }),
      context,
      evaluatedAt: evaluatedAt.toISOString(),
    });
    expect(result.price?.finalGrossAmount).toBe(1190);
    expect(result.warnings.map((warning) => warning.code)).toContain('SPECIFIC_PRICE_UNSUPPORTED_REDUCTION_TYPE');
  });

  it.each([
    raw({ productBasePriceNet: null }),
    raw({ productBasePriceNet: Number.NaN }),
    raw({ productBasePriceNet: -100 }),
  ])('returns unavailable price for invalid base prices', (rawProduct) => {
    const result = calculator.calculate({
      product: { productId: '173' },
      rawProduct,
      selectedSpecificPrice: null,
      context,
      evaluatedAt: evaluatedAt.toISOString(),
    });
    expect(result.price).toBeNull();
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'CATALOG_INVALID_BASE_PRICE',
      'CATALOG_PRICE_UNAVAILABLE',
    ]);
  });
});

describe('CatalogCommercialTruthService', () => {
  function reader(rows: readonly CatalogCommercialRawProduct[], prices: readonly CatalogCommercialSpecificPrice[] = []): CatalogCommercialDataReader {
    return {
      async read() {
        return { products: rows, specificPrices: prices };
      },
    };
  }

  it('returns products keyed by stable commercial identity', async () => {
    const service = new CatalogCommercialTruthService({
      dataReader: reader([raw()]),
      clock: { now: () => evaluatedAt },
    });
    const result = await service.getCommercialTruth({ products: [{ productId: '173' }], context });
    expect(result.productsByIdentity.get('173::<base>')?.name).toBe('Barra olimpica');
  });

  it('deduplicates requested products before reading', async () => {
    const service = new CatalogCommercialTruthService({
      dataReader: reader([raw()]),
      clock: { now: () => evaluatedAt },
    });
    const result = await service.getCommercialTruth({
      products: [{ productId: '173' }, { productId: '173' }],
      context,
    });
    expect(result.statistics.requested).toBe(1);
  });

  it('tracks missing products', async () => {
    const service = new CatalogCommercialTruthService({
      dataReader: reader([]),
      clock: { now: () => evaluatedAt },
    });
    const result = await service.getCommercialTruth({ products: [{ productId: '999' }], context });
    expect(result.statistics).toMatchObject({ requested: 1, resolved: 0, missing: 1 });
  });

  it('uses one evaluatedAt for availability and pricing', async () => {
    const service = new CatalogCommercialTruthService({
      dataReader: reader([raw()]),
      clock: { now: () => evaluatedAt },
    });
    const result = await service.getCommercialTruth({ products: [{ productId: '173' }], context });
    const product = result.productsByIdentity.get('173::<base>');
    expect(product?.availability.evaluatedAt).toBe('2026-07-23T12:00:00.000Z');
    expect(product?.price?.evaluatedAt).toBe('2026-07-23T12:00:00.000Z');
  });

  it('aggregates status and price statistics', async () => {
    const service = new CatalogCommercialTruthService({
      dataReader: reader([
        raw({ productId: 1, active: false }),
        raw({ productId: 2, availableForOrder: false }),
        raw({ productId: 3, stockQuantity: 0 }),
        raw({ productId: 4, productBasePriceNet: null }),
      ]),
      clock: { now: () => evaluatedAt },
    });
    const result = await service.getCommercialTruth({
      products: [{ productId: '1' }, { productId: '2' }, { productId: '3' }, { productId: '4' }],
      context,
    });
    expect(result.statistics).toMatchObject({
      inactive: 1,
      unavailableForOrder: 1,
      outOfStock: 1,
      priceUnavailable: 1,
    });
  });

  it('freezes returned products', async () => {
    const service = new CatalogCommercialTruthService({
      dataReader: reader([raw()]),
      clock: { now: () => evaluatedAt },
    });
    const result = await service.getCommercialTruth({ products: [{ productId: '173' }], context });
    expect(Object.isFrozen(result.productsByIdentity.get('173::<base>'))).toBe(true);
  });
});
