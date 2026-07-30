import { describe, expect, it } from 'vitest';
import {
  DefaultExploreProductsService,
  type CatalogExploreDataReader,
  type ExploreCatalogProductRow,
  type ExploreProductsError,
} from '../../src/application/catalog/explore-products/index.js';
import type {
  CatalogCommercialContext,
  CatalogCommercialSpecificPrice,
} from '../../src/domain/catalog/commercial-truth/index.js';
import { resolvePrice } from '../../src/infrastructure/pricing/priceResolver.js';

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

function row(overrides: Partial<ExploreCatalogProductRow> = {}): ExploreCatalogProductRow {
  const productId = overrides.productId ?? '1';
  return {
    productId,
    name: `Producto ${productId}`,
    reference: null,
    description: null,
    defaultCategoryId: '10',
    defaultCategoryName: 'General',
    defaultCategorySlug: 'general',
    categoryIds: ['10'],
    categoryNames: ['General'],
    categorySlugs: ['general'],
    attributeText: null,
    featureText: null,
    hasCombinations: false,
    defaultCombinationId: null,
    productBasePriceNet: 1000,
    combinationImpactNet: 0,
    active: true,
    availableForOrder: true,
    stockQuantity: 1,
    ...overrides,
  };
}

function specific(overrides: Partial<CatalogCommercialSpecificPrice> = {}): CatalogCommercialSpecificPrice {
  return {
    idSpecificPrice: 1,
    productId: 1,
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
    from: null,
    to: null,
    ...overrides,
  };
}

function reader(input: {
  readonly products: readonly ExploreCatalogProductRow[];
  readonly prices?: readonly CatalogCommercialSpecificPrice[];
  readonly exhaustiveForScope?: boolean;
  readonly categoryFound?: boolean;
  readonly resolvedCategoryIds?: readonly string[];
  readonly fail?: boolean;
}): CatalogExploreDataReader {
  return {
    async resolveCategory() {
      return {
        found: input.categoryFound ?? true,
        categoryIds: input.resolvedCategoryIds ?? ['10'],
      };
    },
    async readProducts() {
      if (input.fail) throw new Error('database down');
      return {
        products: input.products,
        specificPrices: input.prices ?? [],
        exhaustiveForScope: input.exhaustiveForScope ?? true,
      };
    },
  };
}

type ReaderOverrides = Omit<Parameters<typeof reader>[0], 'products'>;

function service(products: readonly ExploreCatalogProductRow[], overrides: ReaderOverrides = {}) {
  return new DefaultExploreProductsService({
    dataReader: reader({ products, ...overrides }),
    clock: { now: () => new Date('2026-07-29T12:00:00.000Z') },
  });
}

describe('DefaultExploreProductsService', () => {
  it('returns global price descending rankings', async () => {
    const result = await service([
      row({ productId: '1', name: 'Barata', productBasePriceNet: 1000 }),
      row({ productId: '2', name: 'Cara', productBasePriceNet: 2000 }),
    ]).explore({ sort: { by: 'price', direction: 'desc' }, limit: 2 }, context);

    expect(result.products.map((product) => product.productId)).toEqual(['2', '1']);
    expect(result.totalMatched).toBe(2);
  });

  it('uses the shared effective pricing resolver for products without discounts', async () => {
    const result = await service([
      row({ productId: '1', productBasePriceNet: 1000, combinationImpactNet: 0 }),
    ]).explore({ sort: { by: 'price', direction: 'asc' }, limit: 1 }, context);

    expect(result.products[0]).toMatchObject({
      price: 1190,
      stockScope: 'product',
    });
  });

  it('uses net-then-tax rounding for percentage discounts', async () => {
    const result = await service([
      row({ productId: '15', productBasePriceNet: 97470.588235, combinationImpactNet: 0 }),
    ], {
      prices: [specific({
        idSpecificPrice: 31918,
        productId: 15,
        reduction: 0.35,
        reductionType: 'percentage',
      })],
    }).explore({ sort: { by: 'price', direction: 'asc' }, limit: 1 }, context);

    expect(result.products[0]?.price).toBe(75393);
  });

  it('matches the details pricing resolver for the same default combination context', async () => {
    const prices = [specific({
      idSpecificPrice: 31918,
      productId: 15,
      reduction: 0.35,
      reductionType: 'percentage',
    })];
    const result = await service([
      row({ productId: '15', productBasePriceNet: 97470.588235, combinationImpactNet: 0 }),
    ], { prices }).explore({ sort: { by: 'price', direction: 'asc' }, limit: 1 }, context);
    const expected = resolvePrice({
      baseProductPrice: 97470.588235,
      combinationImpact: 0,
      specificPrices: [{
        id_specific_price: 31918,
        id_product_attribute: 0,
        id_shop: 0,
        id_currency: 0,
        id_country: 0,
        id_group: 0,
        id_customer: 0,
        price: -1,
        from_quantity: 1,
        reduction: 0.35,
        reduction_tax: 0,
        reduction_type: 'percentage',
        from: null,
        to: null,
      }],
    }, {
      productId: 15,
      combinationId: 0,
      quantity: 1,
      shopId: context.shopId,
      currencyId: context.currencyId,
      countryId: context.countryId,
      customerGroupId: context.customerGroupId,
      customerId: context.customerId,
      currencyCode: context.currencyCode,
      taxRate: context.taxRate,
    });

    expect(result.products[0]?.price).toBe(expected.effectiveUnitPrice);
  });

  it('uses the shared effective pricing resolver for fixed reductions', async () => {
    const result = await service([
      row({ productId: '1', productBasePriceNet: 1000, combinationImpactNet: 0 }),
    ], {
      prices: [specific({
        productId: 1,
        reduction: 190,
        reductionTax: 1,
        reductionType: 'amount',
      })],
    }).explore({ sort: { by: 'price', direction: 'asc' }, limit: 1 }, context);

    expect(result.products[0]?.price).toBe(1000);
  });

  it('prices the default combination for products with variants', async () => {
    const result = await service([
      row({
        productId: '1',
        hasCombinations: true,
        defaultCombinationId: '333',
        productBasePriceNet: 1000,
        combinationImpactNet: 100,
        stockQuantity: 533,
      }),
    ], {
      prices: [
        specific({ productId: 1, combinationId: 0, reduction: 0.1, reductionType: 'percentage' }),
        specific({ idSpecificPrice: 2, productId: 1, combinationId: 333, reduction: 0.2, reductionType: 'percentage' }),
      ],
    }).explore({ sort: { by: 'price', direction: 'asc' }, limit: 1 }, context);

    expect(result.products[0]).toMatchObject({
      price: 1047,
      stockQuantity: 533,
      stockScope: 'product_aggregate',
      availability: 'available',
    });
  });

  it('returns price ascending rankings inside a category', async () => {
    const result = await service([
      row({ productId: '1', productBasePriceNet: 3000, defaultCategoryId: '20', categoryIds: ['20'] }),
      row({ productId: '2', productBasePriceNet: 1000, categoryIds: ['10'] }),
      row({ productId: '3', productBasePriceNet: 2000, categoryIds: ['10'] }),
    ], { resolvedCategoryIds: ['10'] }).explore({
      categoryId: '10',
      sort: { by: 'price', direction: 'asc' },
      limit: 10,
    }, context);

    expect(result.products.map((product) => product.productId)).toEqual(['2', '3']);
  });

  it('returns top 5 productType=machine by category classification', async () => {
    const products = Array.from({ length: 6 }, (_, index) => row({
      productId: String(index + 1),
      name: `Maquina ${index + 1}`,
      productBasePriceNet: 1000 + index,
      categoryNames: ['Maquinas'],
      categorySlugs: ['maquinas-con-carga-de-discos'],
    }));

    const result = await service(products).explore({
      productType: 'machine',
      sort: { by: 'price', direction: 'desc' },
      limit: 5,
    }, context);

    expect(result.products).toHaveLength(5);
    expect(result.totalMatched).toBe(6);
    expect(result.classificationSource).toBe('category');
  });

  it('filters by price range before sorting', async () => {
    const result = await service([
      row({ productId: '1', productBasePriceNet: 100 }),
      row({ productId: '2', productBasePriceNet: 1000 }),
      row({ productId: '3', productBasePriceNet: 3000 }),
    ]).explore({
      price: { min: 1000, max: 2500 },
      sort: { by: 'price', direction: 'asc' },
      limit: 10,
    }, context);

    expect(result.products.map((product) => product.productId)).toEqual(['2']);
  });

  it('filters available products only', async () => {
    const result = await service([
      row({ productId: '1', stockQuantity: 0 }),
      row({ productId: '2', stockQuantity: 3 }),
    ]).explore({
      availability: 'available',
      sort: { by: 'stock', direction: 'desc' },
      limit: 10,
    }, context);

    expect(result.products.map((product) => product.productId)).toEqual(['2']);
    expect(result.scope.availability).toBe('available');
  });

  it('excludes products without price from price rankings and totalMatched', async () => {
    const result = await service([
      row({ productId: '1', productBasePriceNet: null }),
      row({ productId: '2', productBasePriceNet: 1000 }),
    ]).explore({ sort: { by: 'price', direction: 'desc' }, limit: 10 }, context);

    expect(result.totalMatched).toBe(1);
    expect(result.products.map((product) => product.productId)).toEqual(['2']);
  });

  it('rejects limits greater than 10', async () => {
    await expect(service([]).explore({ sort: { by: 'price', direction: 'desc' }, limit: 11 }, context))
      .rejects.toMatchObject({ code: 'invalid_limit' } satisfies Partial<ExploreProductsError>);
  });

  it('rejects price.max lower than price.min', async () => {
    await expect(service([]).explore({
      price: { min: 2000, max: 1000 },
      sort: { by: 'price', direction: 'asc' },
      limit: 1,
    }, context)).rejects.toMatchObject({ code: 'invalid_price_range' } satisfies Partial<ExploreProductsError>);
  });

  it('marks exhaustiveForScope true after a complete source read', async () => {
    const result = await service([row()]).explore({ sort: { by: 'name', direction: 'asc' }, limit: 1 }, context);
    expect(result.exhaustiveForScope).toBe(true);
  });

  it('marks exhaustiveForScope false when the catalog source is partial', async () => {
    const result = await service([row()], { exhaustiveForScope: false })
      .explore({ sort: { by: 'name', direction: 'asc' }, limit: 1 }, context);
    expect(result.exhaustiveForScope).toBe(false);
  });

  it('sorts the complete scope before applying limit', async () => {
    const result = await service([
      row({ productId: '1', productBasePriceNet: 1000 }),
      row({ productId: '2', productBasePriceNet: 5000 }),
      row({ productId: '3', productBasePriceNet: 3000 }),
    ]).explore({ sort: { by: 'price', direction: 'desc' }, limit: 1 }, context);

    expect(result.products.map((product) => product.productId)).toEqual(['2']);
    expect(result.totalMatched).toBe(3);
  });

  it('excludes known internal products before stock ranking, totalMatched, and limit', async () => {
    const result = await service([
      row({
        productId: '444',
        name: 'Servicio vendedor Pesas Chile',
        productBasePriceNet: 0,
        stockQuantity: 99999,
      }),
      row({
        productId: '505',
        name: 'Costo logistico',
        productBasePriceNet: 0,
        stockQuantity: 10001,
      }),
      row({
        productId: '21',
        name: 'Banca ajustable',
        productBasePriceNet: 1000,
        stockQuantity: 3,
      }),
      row({
        productId: '22',
        name: 'Banca plana',
        productBasePriceNet: 1000,
        stockQuantity: 2,
      }),
    ]).explore({ sort: { by: 'stock', direction: 'desc' }, limit: 1 }, context);

    expect(result.products.map((product) => product.productId)).toEqual(['21']);
    expect(result.totalMatched).toBe(2);
  });

  it('uses productId ASC as the deterministic final tie break', async () => {
    const input = [
      row({ productId: '3', name: 'Alpha', productBasePriceNet: 1000 }),
      row({ productId: '1', name: 'Zulu', productBasePriceNet: 1000 }),
      row({ productId: '2', name: 'Bravo', productBasePriceNet: 1000 }),
    ];
    const request = { sort: { by: 'price' as const, direction: 'asc' as const }, limit: 3 };

    const runs = await Promise.all([
      service(input).explore(request, context),
      service(input).explore(request, context),
      service(input).explore(request, context),
    ]);

    expect(runs.map((run) => run.products.map((product) => product.productId))).toEqual([
      ['1', '2', '3'],
      ['1', '2', '3'],
      ['1', '2', '3'],
    ]);
  });

  it('marks text fallback classification explicitly', async () => {
    const result = await service([
      row({
        productId: '1',
        name: 'Specialty trainer',
        categoryNames: ['General'],
        categorySlugs: ['general'],
      }),
    ]).explore({
      productType: 'specialty',
      sort: { by: 'name', direction: 'asc' },
      limit: 1,
    }, context);

    expect(result.classificationSource).toBe('text_fallback');
  });

  it('returns category_not_found for missing explicit categories', async () => {
    await expect(service([], { categoryFound: false }).explore({
      categorySlug: 'missing',
      sort: { by: 'name', direction: 'asc' },
      limit: 1,
    }, context)).rejects.toMatchObject({ code: 'category_not_found', statusCode: 404 });
  });

  it('maps unavailable catalog source to a 503 domain error', async () => {
    await expect(service([], { fail: true }).explore({ sort: { by: 'name', direction: 'asc' }, limit: 1 }, context))
      .rejects.toMatchObject({ code: 'catalog_source_unavailable', statusCode: 503 });
  });

  it('returns the requested machine acceptance shape when the source is complete', async () => {
    const products = Array.from({ length: 37 }, (_, index) => row({
      productId: String(index + 1),
      name: `Maquina disponible ${index + 1}`,
      categoryNames: ['Maquinas'],
      categorySlugs: ['maquinas-con-carga-de-discos'],
      productBasePriceNet: 1000 + index,
      stockQuantity: 2,
    }));

    const result = await service(products).explore({
      productType: 'machine',
      availability: 'available',
      sort: { by: 'price', direction: 'desc' },
      limit: 1,
    }, context);

    expect(result.products).toHaveLength(1);
    expect(result.totalMatched).toBe(37);
    expect(result.exhaustiveForScope).toBe(true);
  });
});
