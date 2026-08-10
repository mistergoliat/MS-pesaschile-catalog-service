import { config } from '../shared/config.js';
import {
  CombinationNotFoundError,
  ProductNotFoundError,
  WeightUnavailableError,
} from '../shared/errors.js';
import { cacheHitsTotal, cacheMissesTotal, priceResolutionTotal } from '../shared/metrics.js';
import { RequestCoalescer } from '../shared/coalescer.js';
import { productCacheKey, priceCacheKey, searchCacheKey, stockCacheKey } from '../shared/cacheKeys.js';
import { toWeightKg } from '../shared/weight.js';
import { buildProductPublicUrl, type ProductPublicLink } from '../domain/catalog/commercial-truth/index.js';
import { normalizeCatalogSearchText } from '../domain/catalog/searchTextNormalization.js';
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

function variantAttributeLabels(variants: readonly { attributes: readonly { group: string }[] }[]): string[] {
  const labels: string[] = [];
  for (const variant of variants) {
    for (const attribute of variant.attributes) {
      const label = attribute.group.trim();
      if (label && !labels.includes(label)) labels.push(label);
    }
  }
  return labels;
}

function resolveEffectiveWeightKg(input: { baseWeightKg: number; weightImpactKg: number }): number {
  const effectiveWeightKg = input.baseWeightKg + input.weightImpactKg;
  if (effectiveWeightKg < 0) {
    // ps_product.weight and the combination weight impact columns are NOT NULL and never
    // negative in production today (CAT-R1-T13A). This guards the arithmetic result rather
    // than any single source column, mirroring StockUnavailableError's "this specific fact
    // for the selected variant could not be resolved" pattern instead of inventing 0.
    throw new WeightUnavailableError();
  }
  return toWeightKg(effectiveWeightKg);
}

function productPublicLink(input: {
  productId: number;
  linkRewrite: string | null;
  hasVariants: boolean;
  variantAttributeLabels: readonly string[];
}): ProductPublicLink {
  const url = buildProductPublicUrl({
    baseUrl: config.catalog.publicBaseUrl,
    productId: input.productId,
    linkRewrite: input.linkRewrite,
  });
  return {
    canonicalUrl: url.canonicalUrl,
    scope: input.hasVariants ? 'parent_product' : 'exact_product',
    available: url.available,
    ...(url.available ? {} : { unavailableReason: url.reason }),
    requiresVariantSelection: input.hasVariants,
    variantAttributeLabels: input.hasVariants ? [...input.variantAttributeLabels] : [],
  };
}

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
    const cacheKeyQuery = normalizeCatalogSearchText(query);
    const key = searchCacheKey({ query: cacheKeyQuery, limit, includeOutOfStock });
    const cached = await this.dependencies.cache.get<{
      query: string;
      items: SearchItem[];
      freshness: { cached: boolean; generatedAt: string };
    }>(key);

    if (cached) {
      cacheHitsTotal.inc({ area: 'search' });
      return {
        ...cached,
        query,
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
      const { linkRewrite, baseWeightKg, ...productCore } = product;
      const publicLink = productPublicLink({
        productId: product.productId,
        linkRewrite,
        hasVariants,
        variantAttributeLabels: variantAttributeLabels(variants),
      });
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

      const variantList = variants.map((variant) => {
        // weightImpactKg is an internal delta used only to resolve `weightKg` below; it is not
        // part of the public `variants[]` contract (CAT-R1-T13B).
        const { weightImpactKg: _weightImpactKg, ...publicVariant } = variant;
        return { ...publicVariant, sku: variant.sku ?? product.sku };
      });

      const weightKg = selectedVariant
        ? resolveEffectiveWeightKg({
            baseWeightKg,
            weightImpactKg: selectedVariantBase?.weightImpactKg ?? 0,
          })
        : null;

      const timestamps = {
        productCheckedAt: new Date().toISOString(),
        priceCalculatedAt: null as string | null,
        stockCheckedAt: null as string | null,
        cached: false,
      };

      if (!selectedVariant) {
        const response: ProductDetail = {
          product: productCore,
          publicLink,
          selectedVariant: null,
          attributes: [],
          variants: variantList,
          pricing: null,
          stock: null,
          weightKg,
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
        product: productCore,
        publicLink,
        selectedVariant,
        attributes: selectedVariant.attributes,
        variants: variantList,
        pricing: resolvedPricing,
        stock: resolvedStock,
        weightKg,
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
