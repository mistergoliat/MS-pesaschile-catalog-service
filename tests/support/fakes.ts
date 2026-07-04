import { vi } from 'vitest';
import type { CatalogRepository, PricingProvider, SearchProvider, StockProvider } from '../../src/domain/catalog/ports.js';
import type { CacheProvider } from '../../src/infrastructure/cache/types.js';
import type { ProductCore, VariantSummary, SearchItem, ProductPricing, ProductStock } from '../../src/domain/catalog/types.js';
import type { SpecificPriceRow } from '../../src/domain/catalog/ports.js';

export function createRepositoryStub(overrides: Partial<CatalogRepository> = {}): CatalogRepository {
  return {
    ping: vi.fn().mockResolvedValue(undefined),
    getProductCore: vi.fn().mockResolvedValue({
      productId: 1,
      name: 'Disco bumper olímpico',
      sku: 'BUMPER',
      shortDescription: 'Disco olímpico',
      longDescription: 'Descripción larga',
      active: true,
    } satisfies ProductCore),
    getVariants: vi.fn().mockResolvedValue([] as VariantSummary[]),
    getVariant: vi.fn().mockResolvedValue(null),
    getVariantAttributes: vi.fn().mockResolvedValue([]),
    getVariantAttributesMap: vi.fn().mockResolvedValue(new Map()),
    getSearchCandidates: vi.fn().mockResolvedValue([]),
    getBasePrices: vi.fn().mockResolvedValue({ productPrice: 1000, combinationImpact: 0 }),
    getSpecificPrices: vi.fn().mockResolvedValue([] as SpecificPriceRow[]),
    getStock: vi.fn().mockResolvedValue({ physicalQuantity: 10, shopId: 1 }),
    getStockForProduct: vi.fn().mockResolvedValue([]),
    getDefaultCombinationId: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

export function createSearchProviderStub(overrides: Partial<SearchProvider> = {}): SearchProvider {
  return {
    search: vi.fn().mockResolvedValue([] as SearchItem[]),
    ...overrides,
  };
}

export function createStockProviderStub(overrides: Partial<StockProvider> = {}): StockProvider {
  return {
    getStock: vi.fn().mockResolvedValue({ physicalQuantity: 10, available: true, shopId: 1 } satisfies ProductStock),
    getVariantStocks: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

export function createPricingProviderStub(overrides: Partial<PricingProvider> = {}): PricingProvider {
  return {
    quote: vi.fn().mockResolvedValue({
      quantity: 1,
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
    } satisfies ProductPricing),
    ...overrides,
  };
}

export function createCacheStub(initial = new Map<string, unknown>()): CacheProvider & { store: Map<string, unknown> } {
  const store = initial;
  return {
    store,
    async get<T>(key: string): Promise<T | null> {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async ping(): Promise<boolean> {
      return true;
    },
  };
}
