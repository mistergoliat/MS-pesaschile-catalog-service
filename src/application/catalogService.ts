import { config } from '../shared/config.js';
import {
  CombinationNotFoundError,
  ProductNotFoundError,
} from '../shared/errors.js';
import { cacheHitsTotal, cacheMissesTotal, priceResolutionTotal } from '../shared/metrics.js';
import { RequestCoalescer } from '../shared/coalescer.js';
import { productCacheKey, priceCacheKey, searchCacheKey, stockCacheKey } from '../shared/cacheKeys.js';
import type {
  BatchGetInput,
  BatchGetItemResult,
  ProductDetail,
  ProductPricing,
  ProductStock,
  SearchItem,
} from '../domain/catalog/types.js';
import type { CatalogRepository, PricingProvider, SearchProvider, StockProvider } from '../domain/catalog/ports.js';
import type { CacheProvider } from '../infrastructure/cache/types.js';
import type { CommercialContext } from '../shared/requestContext.js';

type GetProductInput = {
  productId: number;
  combinationId: number;
  quantity: number;
} & Partial<CommercialContext>;

export class CatalogApplicationService {
  private readonly coalescer = new RequestCoalescer();

  constructor(
    private readonly dependencies: {
      repository: CatalogRepository;
      searchProvider: SearchProvider;
      stockProvider: StockProvider;
      pricingProvider: PricingProvider;
      cache: CacheProvider;
    },
  ) {}

  private resolveContext(context?: Partial<CommercialContext>): CommercialContext {
    return {
      customerId: context?.customerId ?? 0,
      customerGroupId: context?.customerGroupId ?? config.prestashop.customerGroupId,
      currencyId: context?.currencyId ?? config.prestashop.currencyId,
      countryId: context?.countryId ?? config.prestashop.countryId,
    };
  }

  async searchProducts(query: string, limit: number, includeOutOfStock: boolean): Promise<{
    query: string;
    items: SearchItem[];
    freshness: { cached: boolean; generatedAt: string };
  }> {
    const key = searchCacheKey({ query, limit, includeOutOfStock });
    const cached = await this.dependencies.cache.get<{
      query: string;
      items: SearchItem[];
      freshness: { cached: boolean; generatedAt: string };
    }>(key);

    if (cached) {
      cacheHitsTotal.inc({ area: 'search' });
      return {
        ...cached,
        freshness: { ...cached.freshness, cached: true },
      };
    }

    cacheMissesTotal.inc({ area: 'search' });
    return this.coalescer.run(key, async () => {
      const items = await this.dependencies.searchProvider.search(query, limit, includeOutOfStock);
      const response = {
        query,
        items,
        freshness: { cached: false, generatedAt: new Date().toISOString() },
      };
      await this.dependencies.cache.set(key, response, config.cache.searchTtlSeconds);
      return response;
    });
  }

  async getProduct(input: GetProductInput): Promise<ProductDetail> {
    const context = this.resolveContext(input);
    const key = productCacheKey({
      shopId: config.prestashop.shopId,
      productId: input.productId,
      combinationId: input.combinationId,
      quantity: input.quantity,
      customerId: context.customerId,
      customerGroupId: context.customerGroupId,
      currencyId: context.currencyId,
      countryId: context.countryId,
    });

    const cached = await this.dependencies.cache.get<ProductDetail>(key);
    if (cached) {
      cacheHitsTotal.inc({ area: 'product' });
      return {
        ...cached,
        freshness: { ...cached.freshness, cached: true },
      };
    }

    cacheMissesTotal.inc({ area: 'product' });
    return this.coalescer.run(key, async () => {
      const product = await this.dependencies.repository.getProductCore(input.productId);
      if (!product) {
        throw new ProductNotFoundError();
      }

      const variants = await this.dependencies.repository.getVariants(input.productId);
      const hasVariants = variants.length > 0;
      const selectedCombinationId =
        input.combinationId > 0
          ? input.combinationId
          : hasVariants
            ? await this.dependencies.repository.getDefaultCombinationId(input.productId)
            : 0;

      if (input.combinationId > 0 && !variants.some((variant) => variant.combinationId === input.combinationId)) {
        throw new CombinationNotFoundError();
      }

      const selectedVariantBase =
        hasVariants && selectedCombinationId !== null
          ? variants.find((variant) => variant.combinationId === selectedCombinationId) ?? null
          : null;

      const selectedVariant =
        selectedCombinationId === null
          ? null
          : !hasVariants
            ? {
                combinationId: 0,
                sku: product.sku,
                label: null,
                attributes: [],
              }
            : selectedVariantBase
              ? {
                  combinationId: selectedVariantBase.combinationId,
                  sku: selectedVariantBase.sku ?? product.sku,
                  label: selectedVariantBase.label,
                  attributes: selectedVariantBase.attributes,
                }
              : null;

      const variantList = variants.map((variant) => ({
        ...variant,
        sku: variant.sku ?? product.sku,
      }));

      const timestamps = {
        productCheckedAt: new Date().toISOString(),
        priceCalculatedAt: null as string | null,
        stockCheckedAt: null as string | null,
        cached: false,
      };

      if (!selectedVariant) {
        const response: ProductDetail = {
          product,
          selectedVariant: null,
          attributes: [],
          variants: variantList,
          pricing: null,
          stock: null,
          freshness: timestamps,
        };
        await this.dependencies.cache.set(key, response, config.cache.productTtlSeconds);
        return response;
      }

      const stockKey = stockCacheKey({
        shopId: config.prestashop.shopId,
        productId: input.productId,
        combinationId: selectedVariant.combinationId,
      });
      const priceKey = priceCacheKey({
        shopId: config.prestashop.shopId,
        productId: input.productId,
        combinationId: selectedVariant.combinationId,
        quantity: input.quantity,
        customerId: context.customerId,
        customerGroupId: context.customerGroupId,
        currencyId: context.currencyId,
        countryId: context.countryId,
      });

      const stock = await this.dependencies.cache.get<ProductStock>(stockKey);
      const pricing = await this.dependencies.cache.get<ProductPricing>(priceKey);

      let resolvedStock = stock;
      if (resolvedStock) {
        cacheHitsTotal.inc({ area: 'stock' });
      } else {
        cacheMissesTotal.inc({ area: 'stock' });
        resolvedStock = await this.dependencies.stockProvider.getStock(input.productId, selectedVariant.combinationId);
        await this.dependencies.cache.set(stockKey, resolvedStock, config.cache.stockTtlSeconds);
      }

      let resolvedPricing = pricing;
      if (resolvedPricing) {
        cacheHitsTotal.inc({ area: 'price' });
      } else {
        cacheMissesTotal.inc({ area: 'price' });
        resolvedPricing = await this.dependencies.pricingProvider.quote({
          productId: input.productId,
          combinationId: selectedVariant.combinationId,
          quantity: input.quantity,
          customerId: context.customerId,
          customerGroupId: context.customerGroupId,
          currencyId: context.currencyId,
          countryId: context.countryId,
        });
        priceResolutionTotal.inc({ result: resolvedPricing.discountApplied ? 'discounted' : 'base' });
        await this.dependencies.cache.set(priceKey, resolvedPricing, config.cache.priceTtlSeconds);
      }

      timestamps.priceCalculatedAt = new Date().toISOString();
      timestamps.stockCheckedAt = new Date().toISOString();

      const response: ProductDetail = {
        product,
        selectedVariant,
        attributes: selectedVariant.attributes,
        variants: variantList,
        pricing: resolvedPricing,
        stock: resolvedStock,
        freshness: timestamps,
      };
      await this.dependencies.cache.set(key, response, config.cache.productTtlSeconds);
      return response;
    });
  }

  async batchGetProducts(
    items: BatchGetInput[],
    correlationId: string,
    context?: Partial<CommercialContext>,
  ): Promise<{ items: BatchGetItemResult[] }> {
    const settled = await Promise.allSettled(
      items.map((item) => this.getProduct({ ...item, ...context })),
    );

    return {
      items: settled.map((result, index) => {
        const input = items[index]!;
        if (result.status === 'fulfilled') {
          return {
            ok: true,
            input,
            product: result.value,
          };
        }

        const error = result.reason as Error & { code?: string };
        return {
          ok: false,
          input,
          error: {
            code: error.code ?? 'CATALOG_QUERY_FAILED',
            message: error.message || 'Catalog request failed',
            correlationId,
          },
        };
      }),
    };
  }
}
