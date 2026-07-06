import { describe, expect, it, vi } from 'vitest';
import { CatalogApplicationService } from '../../src/application/catalogService.js';
import { createCacheStub, createPricingProviderStub, createRepositoryStub, createSearchProviderStub, createStockProviderStub } from '../support/fakes.js';
import type { ProductCore, VariantSummary } from '../../src/domain/catalog/types.js';

function makeService(options?: {
  product?: ProductCore | null;
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
      active: true,
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

describe('CatalogApplicationService', () => {
  it('returns a simple product with stock and price', async () => {
    const { service, stockProvider, pricingProvider } = makeService();
    const result = await service.getProduct({ productId: 1, combinationId: 0, quantity: 2 });

    expect(result.selectedVariant?.combinationId).toBe(0);
    expect(result.attributes).toEqual([]);
    expect(result.stock?.physicalQuantity).toBe(8);
    expect(result.pricing?.quantity).toBe(2);
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
        },
      ],
      defaultCombinationId: 20,
    });

    const result = await service.getProduct({ productId: 1, combinationId: 0, quantity: 1 });
    expect(result.selectedVariant?.combinationId).toBe(20);
    expect(result.selectedVariant?.sku).toBe('BUMPER');
    expect(result.attributes).toEqual([{ group: 'Peso', value: '20 kg' }]);
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
        },
      ],
      defaultCombinationId: null,
    });

    const result = await service.getProduct({ productId: 1, combinationId: 0, quantity: 1 });
    expect(result.selectedVariant).toBeNull();
    expect(result.attributes).toEqual([]);
    expect(result.pricing).toBeNull();
    expect(result.stock).toBeNull();
    expect(result.variants).toHaveLength(1);
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
          active: true,
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
                active: true,
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
    expect(result.items[1]?.ok).toBe(false);
    if (!result.items[1]?.ok) {
      expect(result.items[1]?.error.correlationId).toBe('corr-123');
    }
  });
});
