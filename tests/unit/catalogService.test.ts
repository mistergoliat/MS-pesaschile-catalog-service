import { describe, expect, it, vi } from 'vitest';
import { CatalogApplicationService } from '../../src/application/catalogService.js';
import { createCacheStub, createPricingProviderStub, createRepositoryStub, createSearchProviderStub, createStockProviderStub } from '../support/fakes.js';
import type { ProductCoreRecord, SearchItem, VariantSummary } from '../../src/domain/catalog/types.js';

function makeService(options?: {
  product?: ProductCoreRecord | null;
  variants?: VariantSummary[];
  defaultCombinationId?: number | null;
  stock?: { physicalQuantity: number; available: boolean; shopId: number };
  pricing?: {
    quantity: number;
    baseUnitPrice: number;
    effectiveUnitPrice: number;
    subtotal: number;
    currency: string;
    taxIncluded: true;
    taxMode: 'configured_rate';
    discountApplied: boolean;
    discountType: 'amount' | 'percentage' | null;
    discountValue: number | null;
    specificPriceId: number | null;
    pricingMode: 'sql_specific_price';
  };
}) {
  const repository = createRepositoryStub({
    getProductCore: vi.fn().mockResolvedValue(options?.product ?? {
      productId: 1,
      name: 'Disco bumper',
      sku: 'BUMPER',
      shortDescription: 'Corto',
      longDescription: 'Largo',
      linkRewrite: 'disco-bumper',
      active: true,
      baseWeightKg: 20,
    }),
    getVariants: vi.fn().mockResolvedValue(options?.variants ?? []),
    getDefaultCombinationId: vi.fn().mockResolvedValue(options?.defaultCombinationId ?? null),
  });
  const stockProvider = createStockProviderStub({
    getStock: vi.fn().mockResolvedValue(options?.stock ?? { physicalQuantity: 8, available: true, shopId: 1 }),
  });
  const pricingProvider = createPricingProviderStub({
    quote: vi.fn().mockImplementation(async (input: { quantity: number }) => options?.pricing ?? {
      quantity: input.quantity,
      baseUnitPrice: 1000,
      effectiveUnitPrice: 1000,
      subtotal: 1000,
      currency: 'CLP',
      taxIncluded: true,
      taxMode: 'configured_rate',
      discountApplied: false,
      discountType: null,
      discountValue: null,
      specificPriceId: null,
      pricingMode: 'sql_specific_price',
    }),
  });
  const service = new CatalogApplicationService({
    repository,
    searchProvider: createSearchProviderStub(),
    stockProvider,
    pricingProvider,
    cache: createCacheStub(),
  });

  return { service, repository, stockProvider, pricingProvider };
}

const cachedBarSearchItems: SearchItem[] = [
  {
    productId: 545,
    combinationId: 0,
    sku: 'BAR-20',
    name: 'Barra Olimpica 20kg',
    variantLabel: null,
    shortDescription: 'Barra olimpica 20kg',
    physicalQuantity: 3,
    available: true,
    matchType: 'partial_name',
  },
];

async function expectEquivalentSearchQueriesShareCache(firstQuery: string, secondQuery: string) {
  const search = vi.fn().mockResolvedValue(cachedBarSearchItems);
  const cache = createCacheStub();
  const service = new CatalogApplicationService({
    repository: createRepositoryStub(),
    searchProvider: createSearchProviderStub({ search }),
    stockProvider: createStockProviderStub(),
    pricingProvider: createPricingProviderStub(),
    cache,
  });

  const first = await service.searchProducts(firstQuery, 5, false);
  const cachedAfterFirst = cache.store.get('search:barra olimpica 20kg:5:0') as { query: string; items: SearchItem[] };
  const second = await service.searchProducts(secondQuery, 5, false);
  const cachedAfterSecond = cache.store.get('search:barra olimpica 20kg:5:0') as { query: string; items: SearchItem[] };

  expect(search).toHaveBeenCalledTimes(1);
  expect(first.query).toBe(firstQuery);
  expect(second.query).toBe(secondQuery);
  expect(first.freshness.cached).toBe(false);
  expect(second.freshness.cached).toBe(true);
  expect(first.items).toEqual(cachedBarSearchItems);
  expect(second.items).toEqual(cachedBarSearchItems);
  expect(cachedAfterFirst).toBe(cachedAfterSecond);
  expect(cachedAfterSecond.query).toBe(firstQuery);
  expect(cachedAfterSecond.items).toEqual(cachedBarSearchItems);
}

describe('CatalogApplicationService', () => {
  it('returns a simple product with stock and price', async () => {
    const { service, stockProvider, pricingProvider } = makeService();
    const result = await service.getProduct({ productId: 1, combinationId: 0, quantity: 2 });

    expect(result.selectedVariant?.combinationId).toBe(0);
    expect(result.publicLink).toEqual({
      canonicalUrl: 'https://pesaschile.cl/categories/1-disco-bumper.html',
      scope: 'exact_product',
      available: true,
      requiresVariantSelection: false,
      variantAttributeLabels: [],
    });
    expect(result.attributes).toEqual([]);
    expect(result.stock?.physicalQuantity).toBe(8);
    expect(result.pricing?.quantity).toBe(2);
    expect(result.weightKg).toBe(20);
    expect(stockProvider.getStock).toHaveBeenCalledWith(1, 0);
    expect(pricingProvider.quote).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 1, combinationId: 0, quantity: 2 }),
    );
  });

  it('selects the default variant when none is specified', async () => {
    const { service } = makeService({
      variants: [
        {
          combinationId: 20,
          sku: null,
          label: 'Peso: 20 kg',
          attributes: [{ group: 'Peso', value: '20 kg' }],
          impactPrice: 0,
          physicalQuantity: 4,
          available: true,
          isDefault: true,
          weightImpactKg: 0,
        },
      ],
      defaultCombinationId: 20,
    });

    const result = await service.getProduct({ productId: 1, combinationId: 0, quantity: 1 });
    expect(result.selectedVariant?.combinationId).toBe(20);
    expect(result.publicLink).toMatchObject({
      scope: 'parent_product',
      requiresVariantSelection: true,
      variantAttributeLabels: ['Peso'],
    });
    expect(result.selectedVariant?.sku).toBe('BUMPER');
    expect(result.attributes).toEqual([{ group: 'Peso', value: '20 kg' }]);
    expect(result.weightKg).toBe(20);
    expect(result.variants[0]).not.toHaveProperty('weightImpactKg');
  });

  it('adds combination weight impact to base weight for the selected variant (synthetic fixture — production impacts are 0 today)', async () => {
    const { service } = makeService({
      product: {
        productId: 1,
        name: 'Disco bumper',
        sku: 'BUMPER',
        shortDescription: 'Corto',
        longDescription: 'Largo',
        linkRewrite: 'disco-bumper',
        active: true,
        baseWeightKg: 20,
      },
      variants: [
        {
          combinationId: 20,
          sku: null,
          label: 'Peso: 20 kg',
          attributes: [{ group: 'Peso', value: '20 kg' }],
          impactPrice: 0,
          physicalQuantity: 4,
          available: true,
          isDefault: true,
          weightImpactKg: 2.5,
        },
      ],
      defaultCombinationId: 20,
    });

    const result = await service.getProduct({ productId: 1, combinationId: 0, quantity: 1 });
    expect(result.weightKg).toBe(22.5);
  });

  it('rounds the effective weight to 3 decimal places with ROUND_HALF_UP', async () => {
    const { service } = makeService({
      product: {
        productId: 1,
        name: 'Disco bumper',
        sku: 'BUMPER',
        shortDescription: 'Corto',
        longDescription: 'Largo',
        linkRewrite: 'disco-bumper',
        active: true,
        baseWeightKg: 20.1234,
      },
    });

    const result = await service.getProduct({ productId: 1, combinationId: 0, quantity: 1 });
    expect(result.weightKg).toBe(20.123);
  });

  it('preserves a literal zero weight instead of normalizing it to null', async () => {
    const { service } = makeService({
      product: {
        productId: 505,
        name: 'Costo logistico',
        sku: 'CT',
        shortDescription: null,
        longDescription: null,
        linkRewrite: 'costo-logistico',
        active: true,
        baseWeightKg: 0,
      },
    });

    const result = await service.getProduct({ productId: 505, combinationId: 0, quantity: 1 });
    expect(result.weightKg).toBe(0);
    expect(result.weightKg).not.toBeNull();
  });

  it('fails closed with WeightUnavailableError when the resultant effective weight would be negative', async () => {
    const { service } = makeService({
      product: {
        productId: 1,
        name: 'Disco bumper',
        sku: 'BUMPER',
        shortDescription: 'Corto',
        longDescription: 'Largo',
        linkRewrite: 'disco-bumper',
        active: true,
        baseWeightKg: 1,
      },
      variants: [
        {
          combinationId: 20,
          sku: null,
          label: 'Peso: -2 kg (invalid, synthetic)',
          attributes: [],
          impactPrice: 0,
          physicalQuantity: 4,
          available: true,
          isDefault: true,
          weightImpactKg: -2,
        },
      ],
      defaultCombinationId: 20,
    });

    await expect(service.getProduct({ productId: 1, combinationId: 0, quantity: 1 })).rejects.toMatchObject({
      code: 'WEIGHT_UNAVAILABLE',
    });
  });

  it('does not mutate the repository-provided variant objects while resolving weight', async () => {
    const sourceVariant: VariantSummary = {
      combinationId: 20,
      sku: null,
      label: 'Peso: 20 kg',
      attributes: [{ group: 'Peso', value: '20 kg' }],
      impactPrice: 0,
      physicalQuantity: 4,
      available: true,
      isDefault: true,
      weightImpactKg: 2.5,
    };
    const { service } = makeService({
      variants: [sourceVariant],
      defaultCombinationId: 20,
    });

    await service.getProduct({ productId: 1, combinationId: 0, quantity: 1 });

    expect(sourceVariant.weightImpactKg).toBe(2.5);
    expect(sourceVariant).toEqual({
      combinationId: 20,
      sku: null,
      label: 'Peso: 20 kg',
      attributes: [{ group: 'Peso', value: '20 kg' }],
      impactPrice: 0,
      physicalQuantity: 4,
      available: true,
      isDefault: true,
      weightImpactKg: 2.5,
    });
  });

  it('leaves price and stock null when a variant product has no default selection', async () => {
    const { service } = makeService({
      variants: [
        {
          combinationId: 20,
          sku: 'BUMPER-20',
          label: 'Peso: 20 kg',
          attributes: [{ group: 'Peso', value: '20 kg' }],
          impactPrice: 0,
          physicalQuantity: 4,
          available: true,
          isDefault: false,
          weightImpactKg: 0,
        },
      ],
      defaultCombinationId: null,
    });

    const result = await service.getProduct({ productId: 1, combinationId: 0, quantity: 1 });
    expect(result.selectedVariant).toBeNull();
    expect(result.attributes).toEqual([]);
    expect(result.pricing).toBeNull();
    expect(result.stock).toBeNull();
    expect(result.weightKg).toBeNull();
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).not.toHaveProperty('weightImpactKg');
  });

  it('rejects an unknown combination', async () => {
    const { service } = makeService({
      variants: [
        {
          combinationId: 20,
          sku: 'BUMPER-20',
          label: 'Peso: 20 kg',
          attributes: [{ group: 'Peso', value: '20 kg' }],
          impactPrice: 0,
          physicalQuantity: 4,
          available: true,
          isDefault: false,
          weightImpactKg: 0,
        },
      ],
    });

    await expect(service.getProduct({ productId: 1, combinationId: 999, quantity: 1 })).rejects.toMatchObject({
      code: 'COMBINATION_NOT_FOUND',
    });
  });

  it('rejects a missing product', async () => {
    const repository = createRepositoryStub({
      getProductCore: vi.fn().mockResolvedValue(null),
    });
    const service = new CatalogApplicationService({
      repository,
      searchProvider: createSearchProviderStub(),
      stockProvider: createStockProviderStub(),
      pricingProvider: createPricingProviderStub(),
      cache: createCacheStub(),
    });

    await expect(service.getProduct({ productId: 999, combinationId: 0, quantity: 1 })).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('allows direct details lookup for a discovery-excluded product id', async () => {
    const { service } = makeService({
      product: {
        productId: 444,
        name: 'Servicio vendedor Pesas Chile',
        sku: 'SERVICIO',
        shortDescription: 'Servicio interno',
        longDescription: 'Servicio interno',
        linkRewrite: 'servicio-vendedor-pesas-chile',
        active: true,
        baseWeightKg: 0,
      },
    });

    const result = await service.getProduct({ productId: 444, combinationId: 0, quantity: 1 });

    expect(result.product.productId).toBe(444);
    expect(result.weightKg).toBe(0);
    expect(result.product.name).toBe('Servicio vendedor Pesas Chile');
  });

  it('serves cached product responses', async () => {
    const cache = createCacheStub();
    await cache.set(
      'product:1:1:0:1:0:0:1:0',
      {
        product: {
          productId: 1,
          name: 'Disco bumper',
          sku: 'BUMPER',
          shortDescription: 'Corto',
          longDescription: 'Largo',
          linkRewrite: 'disco-bumper',
          active: true,
        },
        publicLink: {
          canonicalUrl: 'https://pesaschile.cl/categories/1-disco-bumper.html',
          scope: 'exact_product',
          available: true,
          requiresVariantSelection: false,
          variantAttributeLabels: [],
        },
        selectedVariant: { combinationId: 0, sku: 'BUMPER', label: null, attributes: [] },
        attributes: [],
        variants: [],
        pricing: null,
        stock: null,
        freshness: { productCheckedAt: '2026-01-01T00:00:00.000Z', priceCalculatedAt: null, stockCheckedAt: null, cached: false },
      },
      900,
    );

    const repository = createRepositoryStub({
      getProductCore: vi.fn(),
    });
    const service = new CatalogApplicationService({
      repository,
      searchProvider: createSearchProviderStub(),
      stockProvider: createStockProviderStub(),
      pricingProvider: createPricingProviderStub(),
      cache,
    });

    const result = await service.getProduct({ productId: 1, combinationId: 0, quantity: 1 });
    expect(result.freshness.cached).toBe(true);
    expect(repository.getProductCore).not.toHaveBeenCalled();
  });

  it('serves spaced then compact equivalent search queries from the canonical cache key', async () => {
    await expectEquivalentSearchQueriesShareCache('barra ol\u00edmpica 20 kg', 'barra olimpica 20kg');
  });

  it('serves compact then spaced equivalent search queries from the canonical cache key', async () => {
    await expectEquivalentSearchQueriesShareCache('barra olimpica 20kg', 'barra ol\u00edmpica 20 kg');
  });

  it('returns item-level errors in batch mode', async () => {
    const repository = createRepositoryStub({
      getProductCore: vi.fn(async (productId: number) =>
        productId === 999
            ? null
            : {
                productId,
                name: 'Disco bumper',
                sku: 'BUMPER',
                shortDescription: 'Corto',
                longDescription: 'Largo',
                linkRewrite: 'disco-bumper',
                active: true,
                baseWeightKg: 20,
              },
      ),
    });
    const service = new CatalogApplicationService({
      repository,
      searchProvider: createSearchProviderStub(),
      stockProvider: createStockProviderStub(),
      pricingProvider: createPricingProviderStub(),
      cache: createCacheStub(),
    });
    const result = await service.batchGetProducts(
      [
        { productId: 1, combinationId: 0, quantity: 1 },
        { productId: 999, combinationId: 0, quantity: 1 },
      ],
      'corr-123',
    );

    expect(result.items[0]?.ok).toBe(true);
    if (result.items[0]?.ok) {
      expect(result.items[0].product.weightKg).toBe(20);
    }
    expect(result.items[1]?.ok).toBe(false);
    if (!result.items[1]?.ok) {
      expect(result.items[1]?.error.correlationId).toBe('corr-123');
      expect(result.items[1]?.error).not.toHaveProperty('weightKg');
    }
  });

  it('allows batch hydration for a discovery-excluded product id', async () => {
    const repository = createRepositoryStub({
      getProductCore: vi.fn(async (productId: number) => ({
        productId,
        name: productId === 505 ? 'Costo logistico' : 'Disco bumper',
        sku: productId === 505 ? 'LOGISTICA' : 'BUMPER',
        shortDescription: 'Corto',
        longDescription: 'Largo',
        linkRewrite: productId === 505 ? 'costo-logistico' : 'disco-bumper',
        active: true,
        baseWeightKg: productId === 505 ? 0 : 20,
      })),
    });
    const service = new CatalogApplicationService({
      repository,
      searchProvider: createSearchProviderStub(),
      stockProvider: createStockProviderStub(),
      pricingProvider: createPricingProviderStub(),
      cache: createCacheStub(),
    });

    const result = await service.batchGetProducts(
      [{ productId: 505, combinationId: 0, quantity: 1 }],
      'corr-505',
    );

    expect(result.items[0]?.ok).toBe(true);
    if (result.items[0]?.ok) {
      expect(result.items[0].product.product.productId).toBe(505);
      expect(result.items[0].product.product.name).toBe('Costo logistico');
      expect(result.items[0].product.weightKg).toBe(0);
    }
  });
});
