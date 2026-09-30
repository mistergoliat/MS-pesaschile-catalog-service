import { config } from '../../../shared/config.js';
import { buildProductPublicUrl } from '../../../domain/catalog/commercial-truth/productPublicUrl.js';
import {
  aggregateAvailableQuantity,
  buildItemKey,
  buildProductKey,
  calculatePrice,
  chooseBestSellability,
  CATALOG_V2_ENGINE_VERSION,
  deriveSellability,
  parseCatalogItemKey,
  type PriceResult,
} from '../../../domain/catalog/v2/commercialEngine.js';
import type {
  CatalogProductRef,
  CatalogSearchRequest,
  CatalogSearchResponse,
  CatalogV2DataReader,
  CatalogV2Product,
  CatalogV2Variant,
  FrequentlyBoughtTogetherProvider,
  ItemContextResponse,
  ProductContextResponse,
} from '../../../domain/catalog/v2/contracts.js';
import {
  evaluateCatalogSearchTextRelevance,
  compareCatalogSearchRankEntries,
  type CatalogSearchRankEntry,
} from '../../../domain/catalog/searchTextRelevance.js';
import type { SearchItem } from '../../../domain/catalog/types.js';
import { normalizeCatalogSearchText, tokenizeCatalogSearchText } from '../../../domain/catalog/searchTextNormalization.js';

export type CatalogV2Clock = { now(): Date };

type CacheEntry<T> = {
  value: T;
  asOf: string;
  expiresAt: number;
};

type CatalogV2ServiceDependencies = {
  reader: CatalogV2DataReader;
  clock?: CatalogV2Clock;
  publicBaseUrl?: string;
  frequentlyBoughtTogether?: FrequentlyBoughtTogetherProvider;
  freshnessTtlSeconds?: number;
  serviceBuildRef?: string;
};

export class CatalogContractService {
  private readonly clock: CatalogV2Clock;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly freshnessTtlSeconds: number;
  private readonly serviceBuildRef: string;

  constructor(private readonly dependencies: CatalogV2ServiceDependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date() };
    this.freshnessTtlSeconds = dependencies.freshnessTtlSeconds ?? 15;
    this.serviceBuildRef = dependencies.serviceBuildRef ?? process.env.CATALOG_SERVICE_BUILD_REF ?? 'catalog-service@local';
  }

  async search(input: CatalogSearchRequest): Promise<CatalogSearchResponse> {
    const key = `catalog-v2:search:${JSON.stringify(input)}`;
    const cached = this.getCached<CatalogSearchResponse>(key);
    if (cached) return this.withFreshness(cached.value, cached.asOf, true);

    const data = await this.dependencies.reader.readProducts({ query: input.query });
    const context = this.publicContext(1);
    const candidates = data.products
      .filter((product) => product.active === true && product.listed === true)
      .filter((product) => matchesLexically(product, input.query))
      .filter((product) => !input.filters.categoryId || product.category?.id === input.filters.categoryId)
      .map((product) => this.toSearchCandidate(product, input.query, context))
      .filter((candidate) => candidate !== null)
      .filter((candidate) => !input.filters.sellableOnly || candidate.result.availabilitySummary.sellability === 'sellable')
      .filter((candidate) => input.filters.maxUnitPrice === undefined
        || (candidate.result.priceSummary !== null && candidate.result.priceSummary.finalGross.amount <= input.filters.maxUnitPrice))
      .sort((left, right) => compareCatalogSearchRankEntries(left.rank, right.rank));

    const results = candidates.slice(0, input.limit).map((candidate) => candidate.result);
    const value: CatalogSearchResponse = {
      schemaVersion: 1,
      results,
      completeness: {
        totalMatches: candidates.length,
        truncated: candidates.length > input.limit,
      },
      searchMode: 'lexical',
      freshness: this.freshness(data.asOf, false),
    };
    this.setCached(key, value, data.asOf);
    return value;
  }

  async getProductContext(input: { productKey: string; quantity: number }): Promise<ProductContextResponse> {
    const key = `catalog-v2:product:${input.productKey}:${input.quantity}`;
    const cached = this.getCached<ProductContextResponse>(key);
    if (cached) return this.withFreshness(cached.value, cached.asOf, true);
    const parsed = parseCatalogItemKey(input.productKey);
    if (!parsed || parsed.variantId !== null) {
      return { schemaVersion: 1, status: 'not_found', productKey: input.productKey };
    }
    const data = await this.dependencies.reader.readProducts({ productIds: [parsed.productId] });
    const product = data.products.find((candidate) => candidate.productId === parsed.productId);
    if (!product) {
      return { schemaVersion: 1, status: 'not_found', productKey: input.productKey };
    }
    const value = this.buildProductContext(product, input.quantity, data.asOf);
    this.setCached(key, value, data.asOf);
    return value;
  }

  async getItemContext(input: { itemKey: string; quantity: number }): Promise<ItemContextResponse> {
    const key = `catalog-v2:item:${input.itemKey}:${input.quantity}`;
    const cached = this.getCached<ItemContextResponse>(key);
    if (cached) return this.withFreshness(cached.value, cached.asOf, true);
    const parsed = parseCatalogItemKey(input.itemKey);
    if (!parsed) return { schemaVersion: 1, status: 'not_found', itemKey: input.itemKey };
    const data = await this.dependencies.reader.readProducts({ productIds: [parsed.productId] });
    const product = data.products.find((candidate) => candidate.productId === parsed.productId);
    if (!product) return { schemaVersion: 1, status: 'not_found', itemKey: input.itemKey };

    const hasVariants = product.variants.some((variant) => variant.combinationId > 0);
    // P{id} of a product WITH variants is a productKey, never a sellable item:
    // the owner says so explicitly instead of picking a variant or answering not_found.
    if (hasVariants && parsed.variantId === null) {
      const value: ItemContextResponse = { schemaVersion: 1, status: 'variant_required', itemKey: input.itemKey, productKey: buildProductKey(product.productId) };
      this.setCached(key, value, data.asOf);
      return value;
    }
    const variant = parsed.variantId === null
      ? product.variants.find((candidate) => candidate.combinationId === 0) ?? null
      : product.variants.find((candidate) => candidate.combinationId === parsed.variantId && candidate.combinationId > 0) ?? null;
    if (!variant) return { schemaVersion: 1, status: 'not_found', itemKey: input.itemKey };

    const value = this.buildItemContext(product, variant, buildItemKey(product.productId, hasVariants ? variant.combinationId : null), input.quantity, data.asOf);
    this.setCached(key, value, data.asOf);
    return value;
  }

  private toSearchCandidate(
    product: CatalogV2Product,
    query: string,
    context: ReturnType<CatalogContractService['publicContext']>,
  ): { rank: CatalogSearchRankEntry; result: CatalogSearchResponse['results'][number] } {
    const variants = product.variants;
    const hasVariants = variants.some((variant) => variant.combinationId > 0);
    const prices = variants
      .map((variant) => calculatePrice({ product, variant, specificPrices: product.specificPrices, context, now: this.clock.now() }))
      .filter((price): price is PriceResult => price !== null);
    const priceSummary = minPrice(prices, hasVariants);
    const availability = variants.map((variant) => deriveSellability({
      product: withVariantBackorderPolicy(product, variant),
      availableQuantity: variant.availableQuantity,
      requireVariant: false,
    }));
    const aggregateAvailability = chooseBestSellability(availability);
    const sellableVariants = availability.filter((item) => item.sellability === 'sellable').length;
    const matchingVariant = variants.find((variant) => variant.sku && variant.sku.trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase());
    const searchItem: SearchItem = {
      productId: product.productId,
      combinationId: 0,
      sku: matchingVariant?.sku ?? product.sku,
      name: product.name,
      variantLabel: null,
      shortDescription: product.shortDescription,
      physicalQuantity: aggregateAvailableQuantity(product) ?? 0,
      available: aggregateAvailability.sellability === 'sellable',
      matchType: 'description',
    };
    const rank = evaluateCatalogSearchTextRelevance({ item: searchItem, query, isDefault: true });
    const totalTokens = Math.max(rank.nameTokenTotal, 1);
    const matchType: CatalogSearchResponse['results'][number]['match']['type'] = rank.matchType === 'exact_sku'
      ? 'exact_reference'
      : rank.matchType === 'partial_name' ? 'name' : rank.matchType;
    return {
      rank: { item: searchItem, signals: rank },
      result: {
        productKey: buildProductKey(product.productId),
        ref: { productId: String(product.productId) } satisfies CatalogProductRef,
        name: product.name,
        sku: product.sku,
        category: product.category,
        variants: { count: hasVariants ? variants.length : 0, requiresSelection: hasVariants },
        priceSummary,
        availabilitySummary: {
          sellability: aggregateAvailability.sellability,
          reason: aggregateAvailability.reason,
          sellableVariants: hasVariants ? sellableVariants : null,
        },
        match: {
          type: matchType,
          matchedTokens: rank.matchType === 'description' ? rank.descriptionTokenCoverage : rank.nameTokenCoverage,
          totalTokens,
        },
      },
    };
  }

  private buildProductContext(product: CatalogV2Product, quantity: number, asOf: string): ProductContextResponse {
    const hasVariants = product.variants.some((variant) => variant.combinationId > 0);
    const context = this.publicContext(quantity);
    const now = this.clock.now();
    const pricedVariants = product.variants
      .map((variant) => calculatePrice({ product, variant, specificPrices: product.specificPrices, context, now }))
      .filter((price): price is PriceResult => price !== null);
    const priceSummary = minPrice(pricedVariants, hasVariants);
    const variantAvailability = product.variants.map((variant) => deriveSellability({
      product: withVariantBackorderPolicy(product, variant),
      availableQuantity: variant.availableQuantity,
      requireVariant: false,
    }));
    const availability = chooseBestSellability(variantAvailability);
    const sellableVariants = variantAvailability.filter((item) => item.sellability === 'sellable').length;
    const publicUrl = buildProductPublicUrl({
      baseUrl: this.dependencies.publicBaseUrl ?? config.catalog.publicBaseUrl,
      productId: product.productId,
      linkRewrite: product.linkRewrite,
    });
    const inferred = this.inferred(product.productId);
    const response: ProductContextResponse = {
      schemaVersion: 1,
      status: 'found',
      productKey: buildProductKey(product.productId),
      ref: { productId: String(product.productId) },
      facts: {
        name: product.name,
        sku: product.sku,
        shortDescription: product.shortDescription,
        category: product.category,
        brand: product.brand,
        weightKg: product.weightKg,
        specifications: product.specifications,
        status: {
          active: product.active === true,
          listed: product.listed === true,
          orderable: product.orderable === true,
        },
        sellableItem: hasVariants
          ? null
          : { itemKey: buildItemKey(product.productId, null), ref: { productId: String(product.productId), variantId: null } },
        variantOptions: hasVariants ? product.variants.filter((variant) => variant.combinationId > 0).map((variant) => ({
          itemKey: buildItemKey(product.productId, variant.combinationId),
          ref: { productId: String(product.productId), variantId: String(variant.combinationId) },
          sku: variant.sku ?? product.sku,
          attributes: variant.attributes,
          isDefault: variant.isDefault,
        })) : [],
        stock: {
          availableQuantity: aggregateAvailableQuantity(product),
          scope: hasVariants ? 'product_total' : 'variant',
        },
      },
      derived: {
        priceSummary,
        availability: {
          sellability: availability.sellability,
          reason: availability.reason,
          sellableVariants: hasVariants ? sellableVariants : null,
          leadTime: null,
        },
        publicUrl: publicUrl.available ? publicUrl.canonicalUrl : null,
      },
      inferred,
      provenance: this.provenance(),
      freshness: this.freshness(asOf, false, earliestPromotionEnd(pricedVariants)),
    };
    return response;
  }

  private buildItemContext(
    product: CatalogV2Product,
    variant: CatalogV2Variant,
    itemKey: string,
    quantity: number,
    asOf: string,
  ): ItemContextResponse {
    const context = this.publicContext(quantity);
    const price = calculatePrice({
      product,
      variant,
      specificPrices: product.specificPrices,
      context,
      now: this.clock.now(),
    });
    const availability = deriveSellability({
      product: withVariantBackorderPolicy(product, variant),
      availableQuantity: variant.availableQuantity,
      requireVariant: false,
    });
    return {
      schemaVersion: 1,
      status: 'found',
      itemKey,
      ref: { productId: String(product.productId), variantId: variant.combinationId > 0 ? String(variant.combinationId) : null },
      parentProduct: {
        productKey: buildProductKey(product.productId),
        name: product.name,
        sku: product.sku,
      },
      variant: {
        variantId: variant.combinationId > 0 ? String(variant.combinationId) : null,
        sku: variant.sku ?? product.sku,
        attributes: variant.attributes,
      },
      pricing: price
        ? {
            status: 'available',
            quantity,
            regularGross: money(price.regularGross),
            finalGross: money(price.finalGross),
            promotion: price.promotion,
            tax: { included: true, rate: context.taxRate, basis: 'configured_flat_rate' },
            engineVersion: CATALOG_V2_ENGINE_VERSION,
          }
        : { status: 'unavailable', reason: 'invalid_base_price' },
      availability: {
        availableQuantity: variant.availableQuantity,
        sellability: availability.sellability,
        reason: availability.reason,
        leadTime: null,
      },
      freshness: this.freshness(asOf, false, price?.promotion?.validUntil ?? null),
      provenance: this.provenance(),
    };
  }

  private inferred(productId: number) {
    const result = this.dependencies.frequentlyBoughtTogether?.getForProduct(productId, 5);
    if (!result) return { frequentlyBoughtTogether: { status: 'unavailable' as const, reason: 'snapshot_unavailable' as const } };
    return {
      frequentlyBoughtTogether: {
        status: 'available' as const,
        snapshotId: result.snapshotId,
        builtAt: result.builtAt,
        items: result.items.slice(0, 5).map((item) => ({
          productKey: buildProductKey(item.productId),
          name: item.name,
          confidence: item.confidence,
          jointCount: item.jointCount,
        })),
      },
    };
  }

  private publicContext(quantity: number) {
    return {
      quantity,
      shopId: config.prestashop.shopId,
      currencyId: config.prestashop.currencyId,
      countryId: config.prestashop.countryId,
      customerGroupId: config.prestashop.customerGroupId,
      customerId: 0,
      currencyCode: 'CLP' as const,
      taxRate: config.pricing.taxRate,
    };
  }

  private provenance() {
    return {
      source: 'prestashop' as const,
      service: 'catalog-service' as const,
      serviceBuildRef: this.serviceBuildRef,
      sourceUpdatedAt: null,
    };
  }

  private freshness(asOf: string, hit: boolean, promotionValidUntil: string | null = null) {
    const asOfMs = Date.parse(asOf);
    const ttlEnd = new Date(asOfMs + this.freshnessTtlSeconds * 1000).toISOString();
    const validUntil = promotionValidUntil && Date.parse(promotionValidUntil) < Date.parse(ttlEnd)
      ? promotionValidUntil
      : ttlEnd;
    return {
      asOf,
      cache: { hit, ageMs: Math.max(0, this.clock.now().getTime() - asOfMs) },
      validUntil,
    };
  }

  private getCached<T>(key: string): CacheEntry<T> | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (entry.expiresAt <= this.clock.now().getTime()) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  private setCached<T>(key: string, value: T, asOf: string): void {
    this.cache.set(key, {
      value,
      asOf,
      expiresAt: this.clock.now().getTime() + this.freshnessTtlSeconds * 1000,
    });
  }

  private withFreshness<T>(value: T, asOf: string, hit: boolean): T {
    if (!value || typeof value !== 'object' || !('freshness' in value)) return value;
    const currentFreshness = (value as { freshness?: { validUntil?: string | null } }).freshness;
    return {
      ...(value as object),
      freshness: this.freshness(asOf, hit, currentFreshness?.validUntil ?? null),
    } as T;
  }
}

function money(amount: number) {
  return { amount, currency: 'CLP' as const };
}

function minPrice(prices: readonly PriceResult[], from: boolean) {
  if (prices.length === 0) return null;
  const selected = bestPrice(prices)!;
  return {
    kind: from ? 'from' as const : 'exact' as const,
    finalGross: money(selected.finalGross),
    regularGross: money(selected.regularGross),
    discounted: selected.discounted,
  };
}

/** A product answer that relies on promotions stops being valid when the first of them ends. */
function earliestPromotionEnd(prices: readonly PriceResult[]): string | null {
  const ends = prices.map((price) => price.promotion?.validUntil ?? null).filter((value): value is string => value !== null);
  return ends.length === 0 ? null : ends.reduce((left, right) => (Date.parse(left) <= Date.parse(right) ? left : right));
}

function bestPrice(prices: readonly PriceResult[]): PriceResult | null {
  return [...prices].sort((left, right) => left.finalGross - right.finalGross || left.regularGross - right.regularGross)[0] ?? null;
}

function matchesLexically(product: CatalogV2Product, query: string): boolean {
  const normalizedQuery = normalizeCatalogSearchText(query);
  const fields = [
    product.sku,
    product.name,
    product.shortDescription,
    ...product.variants.map((variant) => variant.sku),
  ].filter((value): value is string => Boolean(value)).map(normalizeCatalogSearchText);
  if (fields.some((field) => field === normalizedQuery || field.includes(normalizedQuery))) return true;
  const tokens = tokenizeCatalogSearchText(query).filter((token) => token.length > 0);
  if (tokens.length === 0) return false;
  const name = normalizeCatalogSearchText(product.name);
  const description = normalizeCatalogSearchText(product.shortDescription ?? '');
  return tokens.every((token) => name.includes(token)) || tokens.every((token) => description.includes(token));
}

function withVariantBackorderPolicy(product: CatalogV2Product, variant: CatalogV2Variant): CatalogV2Product {
  const policy = variant.outOfStock === 1
    ? true
    : variant.outOfStock === 0
      ? false
      : product.globalBackorderAllowed;
  return { ...product, globalBackorderAllowed: policy };
}
