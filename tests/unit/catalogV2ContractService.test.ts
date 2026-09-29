import { describe, expect, it } from 'vitest';
import { CatalogContractService } from '../../src/application/catalog/v2/catalogContractService.js';
import { catalogSearchResponseSchema, itemContextResponseSchema, productContextResponseSchema, type CatalogV2DataReader, type CatalogV2Product } from '../../src/domain/catalog/v2/contracts.js';

function product(overrides: Partial<CatalogV2Product> = {}): CatalogV2Product {
  return {
    productId: 10,
    basePriceNet: 100000,
    name: 'Barra olímpica',
    sku: 'BAR-10',
    shortDescription: 'Barra comercial',
    brand: null,
    weightKg: 20,
    linkRewrite: 'barra-olimpica',
    category: { id: '3', name: 'Barras' },
    active: true,
    listed: true,
    orderable: true,
    variants: [{
      combinationId: 0,
      sku: 'BAR-10',
      attributes: [],
      impactPriceNet: 0,
      isDefault: true,
      availableQuantity: 4,
      outOfStock: 0,
    }],
    specifications: [{ name: 'Largo', value: '220 cm' }],
    globalBackorderAllowed: null,
    specificPrices: [],
    asOf: '2026-09-29T12:00:00.000Z',
    ...overrides,
  };
}

function reader(products: CatalogV2Product[]): CatalogV2DataReader {
  return {
    async readProducts() {
      return { products, asOf: '2026-09-29T12:00:00.000Z' };
    },
  };
}

describe('CatalogContractService', () => {
  it('uses canonical product/item identity and keeps SKU as display data', async () => {
    const service = new CatalogContractService({ reader: reader([product()]) });

    const productContext = await service.getProductContext({ productKey: 'P10', quantity: 1 });
    const itemContext = await service.getItemContext({ itemKey: 'P10', quantity: 1 });

    expect(productContext.status).toBe('found');
    if (productContext.status === 'found') {
      expect(productContext.itemKey).toBe('P10');
      expect(productContext.ref).toEqual({ productId: '10', variantId: null });
      expect(productContext.facts.sku).toBe('BAR-10');
    }
    expect(itemContext.status).toBe('found');
    if (itemContext.status === 'found') {
      expect(itemContext.itemKey).toBe('P10');
      expect(itemContext.ref.variantId).toBeNull();
    }
  });

  it('does not manufacture a base sellable item for a product with variants', async () => {
    const variantProduct = product({
      productId: 20,
      variants: [{
        combinationId: 7,
        sku: 'BAR-20-XL',
        attributes: [{ group: 'Tamaño', value: 'XL' }],
        impactPriceNet: 10000,
        isDefault: true,
        availableQuantity: 2,
        outOfStock: 0,
      }],
    });
    const service = new CatalogContractService({ reader: reader([variantProduct]) });

    const productContext = await service.getProductContext({ productKey: 'P20', quantity: 1 });
    const itemContext = await service.getItemContext({ itemKey: 'P20', quantity: 1 });
    const variantContext = await service.getItemContext({ itemKey: 'P20-V7', quantity: 1 });

    expect(productContext.status).toBe('found');
    if (productContext.status === 'found') {
      expect(productContext.facts.variantOptions[0]?.itemKey).toBe('P20-V7');
      expect(productContext.facts.stock.scope).toBe('product_total');
    }
    expect(itemContext.status).toBe('not_found');
    expect(variantContext.status).toBe('found');
    if (variantContext.status === 'found') expect(variantContext.ref.variantId).toBe('7');
  });

  it('applies reduction_tax=0 in net space and exposes the engine version', async () => {
    const discounted = product({
      specificPrices: [{
        idSpecificPrice: 1,
        combinationId: 0,
        shopId: 0,
        currencyId: 0,
        countryId: 0,
        groupId: 0,
        customerId: 0,
        cartId: 0,
        price: -1,
        fromQuantity: 1,
        reduction: 10000,
        reductionTax: 0,
        reductionType: 'amount',
        from: null,
        to: null,
      }],
    });
    const service = new CatalogContractService({ reader: reader([discounted]) });

    const result = await service.getItemContext({ itemKey: 'P10', quantity: 1 });
    expect(result.status).toBe('found');
    if (result.status === 'found' && result.pricing.status === 'available') {
      expect(result.pricing.regularGross.amount).toBe(119000);
      expect(result.pricing.finalGross.amount).toBe(107100);
      expect(result.pricing.engineVersion).toBe('catalog-commercial-v2.0.0');
    }
    expect(itemContextResponseSchema.safeParse(result).success).toBe(true);
  });

  it('derives backorder and unknown policy without inferring from zero quantity alone', async () => {
    const backorder = product({
      variants: [{ ...product().variants[0]!, availableQuantity: 0, outOfStock: 1 }],
    });
    const unknown = product({
      productId: 11,
      variants: [{ ...product().variants[0]!, availableQuantity: 0, outOfStock: 2 }],
      globalBackorderAllowed: null,
    });
    const service = new CatalogContractService({ reader: reader([backorder, unknown]) });

    const allowed = await service.getItemContext({ itemKey: 'P10', quantity: 1 });
    const unresolved = await service.getItemContext({ itemKey: 'P11', quantity: 1 });
    expect(allowed.status).toBe('found');
    if (allowed.status === 'found') expect(allowed.availability).toMatchObject({ sellability: 'backorder', reason: 'backorder_allowed' });
    expect(unresolved.status).toBe('found');
    if (unresolved.status === 'found') expect(unresolved.availability).toMatchObject({ sellability: 'check_with_staff', reason: 'backorder_policy_unknown' });
  });

  it('searches at product level, keeps zero stock visible, and ranks before truncation', async () => {
    const service = new CatalogContractService({
      reader: reader([
        product({ productId: 30, name: 'Banco ajustable', sku: 'BANCO', shortDescription: 'Banca comercial', variants: [{ ...product().variants[0]!, availableQuantity: 0 }] }),
        product({ productId: 31, name: 'Barra olímpica premium', sku: 'BARRA', variants: [{ ...product().variants[0]!, availableQuantity: 5 }] }),
      ]),
    });
    const result = await service.search({ query: 'barra', filters: { sellableOnly: false }, limit: 1 });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.itemKey).toBe('P31');
    expect(result.completeness).toEqual({ totalMatches: 1, truncated: false });
    expect(catalogSearchResponseSchema.safeParse(result).success).toBe(true);
  });

  it('distinguishes inactive from not found and preserves a real asOf on cache hits', async () => {
    const inactive = product({ productId: 40, active: false });
    let current = Date.parse('2026-09-29T12:00:01.000Z');
    const service = new CatalogContractService({
      reader: reader([inactive]),
      clock: { now: () => new Date(current) },
    });
    const first = await service.getProductContext({ productKey: 'P40', quantity: 1 });
    current += 2000;
    const second = await service.getProductContext({ productKey: 'P40', quantity: 1 });
    const missing = await service.getProductContext({ productKey: 'P999', quantity: 1 });

    expect(first.status).toBe('found');
    if (first.status === 'found' && second.status === 'found') {
      expect(first.freshness.asOf).toBe(second.freshness.asOf);
      expect(second.freshness.cache).toEqual({ hit: true, ageMs: 3000 });
      expect(second.facts.status.active).toBe(false);
    }
    expect(missing.status).toBe('not_found');
    expect(productContextResponseSchema.safeParse(first).success).toBe(true);
  });
});
