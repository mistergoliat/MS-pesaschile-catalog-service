import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculatePrice } from '../../src/domain/catalog/v2/commercialEngine.js';
import type { CatalogV2Product, CatalogV2SpecificPrice, CatalogV2Variant } from '../../src/domain/catalog/v2/contracts.js';

type GoldenCase = {
  name: string;
  quantity?: number;
  variantImpactNet?: number;
  specificPrices: Array<Partial<CatalogV2SpecificPrice> & Pick<CatalogV2SpecificPrice, 'idSpecificPrice' | 'reduction' | 'reductionTax' | 'reductionType'>>;
  expected: { regularGross: number; finalGross: number };
};

const cases = JSON.parse(readFileSync(path.resolve('contracts/catalog/v2/fixtures/pricing-golden.json'), 'utf8')) as GoldenCase[];
const product = (): CatalogV2Product => ({
  productId: 1,
  basePriceNet: 100000,
  name: 'Parity product',
  sku: 'PARITY',
  shortDescription: null,
  brand: null,
  weightKg: null,
  linkRewrite: null,
  category: null,
  active: true,
  listed: true,
  orderable: true,
  variants: [],
  specifications: [],
  globalBackorderAllowed: null,
  specificPrices: [],
  asOf: '2026-09-29T12:00:00.000Z',
});

describe('Catalog v2 pricing golden parity cases', () => {
  it.each(cases)('$name', (golden) => {
    const variant: CatalogV2Variant = {
      combinationId: 0,
      sku: 'PARITY',
      attributes: [],
      impactPriceNet: golden.variantImpactNet ?? 0,
      isDefault: true,
      availableQuantity: 10,
      outOfStock: 0,
    };
    const rows = golden.specificPrices.map((row) => ({
      combinationId: 0,
      shopId: 0,
      currencyId: 0,
      countryId: 0,
      groupId: 0,
      customerId: 0,
      cartId: 0,
      price: -1,
      fromQuantity: 1,
      from: null,
      to: null,
      ...row,
    })) as CatalogV2SpecificPrice[];
    const result = calculatePrice({
      product: product(),
      variant,
      specificPrices: rows,
      context: { quantity: golden.quantity ?? 1, shopId: 1, currencyId: 1, countryId: 0, customerGroupId: 0, customerId: 0, currencyCode: 'CLP', taxRate: 0.19 },
      now: new Date('2026-09-29T12:00:00.000Z'),
    });
    expect(result).toMatchObject(golden.expected);
  });
});
