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
  isOfferable,
  parseCatalogItemKey,
  type PriceResult,
  type SellabilityResult,
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
import { compareNominal, matchNominal, type NominalMatch } from '../../../domain/catalog/v2/nominalSearch.js';
import { BoundedTtlCache } from './boundedTtlCache.js';

export type CatalogV2Clock = { now(): Date };

type CacheEntry = {
  value: unknown;
  asOf: string;
};

export const CATALOG_V2_CACHE_MAX_ENTRIES = 500;

type CatalogV2ServiceDependencies = {
  reader: CatalogV2DataReader;
  clock?: CatalogV2Clock;
  publicBaseUrl?: string;
  frequentlyBoughtTogether?: FrequentlyBoughtTogetherProvider;
  freshnessTtlSeconds?: number;
  cacheMaxEntries?: number;
  serviceBuildRef?: string;
};

export class CatalogContractService {
  private readonly clock: CatalogV2Clock;
  private readonly cache: BoundedTtlCache<CacheEntry>;
  private readonly freshnessTtlSeconds: number;
  private readonly serviceBuildRef: string;

  constructor(private readonly dependencies: CatalogV2ServiceDependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date() };
    this.freshnessTtlSeconds = dependencies.freshnessTtlSeconds ?? 15;
    this.cache = new BoundedTtlCache(dependencies.cacheMaxEntries ?? CATALOG_V2_CACHE_MAX_ENTRIES);
    this.serviceBuildRef = dependencies.serviceBuildRef ?? process.env.CATALOG_SERVICE_BUILD_REF ?? 'catalog-service@local';
  }

  async search(input: CatalogSearchRequest): Promise<CatalogSearchResponse> {
    // Whitespace is collapsed before retrieval; the key is also case-folded,
    // which is answer-preserving because retrieval and matching ignore case.
    const query = input.query.trim().replace(/\s+/gu, ' ');
    const key = `catalog-v2:search:${JSON.stringify([
      query.toLocaleLowerCase('es'),
      input.filters.categoryId ?? null,
      input.filters.maxUnitPrice ?? null,
      input.filters.sellableOnly,
      input.limit,
    ])}`;
    const cached = this.getCached(key);
    if (cached) return this.withFreshness(cached.value as CatalogSearchResponse, cached.asOf, true);

    const data = await this.dependencies.reader.readProducts({ query });
    const context = this.publicContext(1);
    const now = this.clock.now();
    const candidates = data.products
      .filter((product) => product.active === true && product.listed === true)
      .filter((product) => !input.filters.categoryId || product.category?.id === input.filters.categoryId)
      .flatMap((product) => {
        const match = matchNominal({
          query,
          name: product.name,
          shortDescription: product.shortDescription,
          references: [product.sku, ...product.variants.map((variant) => variant.sku)],
        });
        return match ? [this.toSearchCandidate(product, match, context, now)] : [];
      })
      .filter((candidate) => !input.filters.sellableOnly || candidate.result.availabilitySummary.sellability === 'sellable')
      .filter((candidate) => input.filters.maxUnitPrice === undefined
        || (candidate.result.priceSummary !== null && candidate.result.priceSummary.finalGross.amount <= input.filters.maxUnitPrice))
      .sort((left, right) => compareNominal(left.rank, right.rank));

    const returned = candidates.slice(0, input.limit);
    const value: CatalogSearchResponse = {
      schemaVersion: 1,
      results: returned.map((candidate) => candidate.result),
      completeness: {
        totalMatches: candidates.length,
        truncated: candidates.length > input.limit,
      },
      searchMode: 'lexical',
      freshness: this.freshness(data.asOf, false, earliest(returned.map((candidate) => candidate.priceValidUntil))),
    };
    this.setCached(key, value, data.asOf);
    return value;
  }

  async getProductContext(input: { productKey: string; quantity: number }): Promise<ProductContextResponse> {
    const key = `catalog-v2:product:${input.productKey}:${input.quantity}`;
    const cached = this.getCached(key);
    if (cached) return this.withFreshness(cached.value as ProductContextResponse, cached.asOf, true);
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
    const cached = this.getCached(key);
    if (cached) return this.withFreshness(cached.value as ItemContextResponse, cached.asOf, true);
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
    match: NominalMatch,
    context: ReturnType<CatalogContractService['publicContext']>,
    now: Date,
  ): {
    rank: { match: NominalMatch; name: string; productId: number };
    result: CatalogSearchResponse['results'][number];
    priceValidUntil: string | null;
  } {
    const variants = product.variants;
    const hasVariants = variants.some((variant) => variant.combinationId > 0);
    const units = this.priceUnits(product, context, now);
    const aggregateAvailability = chooseBestSellability(units.map((unit) => unit.availability));
    const sellableVariants = units.filter((unit) => unit.availability.sellability === 'sellable').length;
    const matchType: CatalogSearchResponse['results'][number]['match']['type'] = match.tier === 'exact_reference' || match.tier === 'exact_name'
      ? match.tier
      : match.tier === 'description' ? 'description' : 'name';
    return {
      rank: { match, name: product.name, productId: product.productId },
      priceValidUntil: earliest(units.map((unit) => unit.price?.priceValidUntil ?? null)),
      result: {
        productKey: buildProductKey(product.productId),
        ref: { productId: String(product.productId) } satisfies CatalogProductRef,
        name: product.name,
        sku: product.sku,
        category: product.category,
        variants: { count: hasVariants ? variants.length : 0, requiresSelection: hasVariants },
        priceSummary: priceSummary(units, hasVariants),
        availabilitySummary: {
          sellability: aggregateAvailability.sellability,
          reason: aggregateAvailability.reason,
          sellableVariants: hasVariants ? sellableVariants : null,
        },
        match: {
          type: matchType,
          matchedTokens: Math.min(match.matchedTokens, match.totalTokens),
          totalTokens: match.totalTokens,
        },
      },
    };
  }

  /** Every sellable unit of the product with its owner price and sellability (the basis of OD-1). */
  private priceUnits(product: CatalogV2Product, context: ReturnType<CatalogContractService['publicContext']>, now: Date): PriceUnit[] {
    return product.variants.map((variant) => ({
      price: calculatePrice({ product, variant, specificPrices: product.specificPrices, context, now }),
      availability: deriveSellability({
        product: withVariantBackorderPolicy(product, variant),
        availableQuantity: variant.availableQuantity,
        requireVariant: false,
      }),
    }));
  }

  private buildProductContext(product: CatalogV2Product, quantity: number, asOf: string): ProductContextResponse {
    const hasVariants = product.variants.some((variant) => variant.combinationId > 0);
    const context = this.publicContext(quantity);
    const units = this.priceUnits(product, context, this.clock.now());
    const availability = chooseBestSellability(units.map((unit) => unit.availability));
    const sellableVariants = units.filter((unit) => unit.availability.sellability === 'sellable').length;
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
        priceSummary: priceSummary(units, hasVariants),
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
      freshness: this.freshness(asOf, false, earliest(units.map((unit) => unit.price?.priceValidUntil ?? null))),
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
            promotion: publicPromotion(price.promotion),
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
      freshness: this.freshness(asOf, false, price?.priceValidUntil ?? null),
      provenance: this.provenance(),
    };
  }

  private inferred(productId: number) {
    if (!this.dependencies.frequentlyBoughtTogether) return { frequentlyBoughtTogether: { status: 'unavailable' as const, reason: 'not_supported' as const } };
    const result = this.dependencies.frequentlyBoughtTogether.getForProduct(productId, 5);
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

  /** OD-3: valid for the owner TTL from `asOf`, never past the first scheduled price change. */
  private freshness(asOf: string, hit: boolean, priceChangeAt: string | null = null) {
    const asOfMs = Date.parse(asOf);
    const ttlEnd = new Date(asOfMs + this.freshnessTtlSeconds * 1000).toISOString();
    const validUntil = priceChangeAt && Date.parse(priceChangeAt) < Date.parse(ttlEnd)
      ? priceChangeAt
      : ttlEnd;
    return {
      asOf,
      cache: { hit, ageMs: Math.max(0, this.clock.now().getTime() - asOfMs) },
      validUntil,
    };
  }

  private getCached(key: string): CacheEntry | null {
    return this.cache.get(key, this.clock.now().getTime()) ?? null;
  }

  /** An answer is cached only until its own validity ends (asOf + TTL, or earlier). */
  private setCached(key: string, value: unknown, asOf: string): void {
    const validUntil = (value as { freshness?: { validUntil?: string | null } }).freshness?.validUntil;
    const expiresAtMs = validUntil ? Date.parse(validUntil) : Date.parse(asOf) + this.freshnessTtlSeconds * 1000;
    this.cache.set(key, { value, asOf }, expiresAtMs, this.clock.now().getTime());
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

type PriceUnit = { price: PriceResult | null; availability: SellabilityResult };

/**
 * OD-1: the advertised price of a product. Only offerable units (sellable or
 * backorder) set it; a unit that cannot be ordered never lowers it. When no
 * priced unit is offerable the basis says so explicitly (reference price).
 */
function priceSummary(units: readonly PriceUnit[], from: boolean) {
  const priced = units.filter((unit): unit is { price: PriceResult; availability: SellabilityResult } => unit.price !== null);
  if (priced.length === 0) return null;
  const offerable = priced.filter((unit) => isOfferable(unit.availability));
  const basis = offerable.length > 0 ? 'offerable' as const : 'not_offerable' as const;
  const selected = [...(offerable.length > 0 ? offerable : priced)]
    .map((unit) => unit.price)
    .sort((left, right) => left.finalGross - right.finalGross || left.regularGross - right.regularGross)[0]!;
  return {
    kind: from ? 'from' as const : 'exact' as const,
    basis,
    finalGross: money(selected.finalGross),
    regularGross: money(selected.regularGross),
    discounted: selected.discounted,
  };
}

/** OD-2: the wire shape of an applied promotion (amounts tax-included). */
function publicPromotion(promotion: PriceResult['promotion']) {
  if (!promotion) return null;
  if (promotion.type === 'percentage') {
    return { type: 'percentage' as const, percentOff: promotion.percentOff!, amountOffGross: null, validUntil: promotion.validUntil };
  }
  return { type: 'amount' as const, percentOff: null, amountOffGross: money(promotion.amountOffGross!), validUntil: promotion.validUntil };
}

function earliest(values: readonly (string | null)[]): string | null {
  const instants = values.filter((value): value is string => value !== null);
  return instants.length === 0 ? null : instants.reduce((left, right) => (Date.parse(left) <= Date.parse(right) ? left : right));
}

function withVariantBackorderPolicy(product: CatalogV2Product, variant: CatalogV2Variant): CatalogV2Product {
  const policy = variant.outOfStock === 1
    ? true
    : variant.outOfStock === 0
      ? false
      : product.globalBackorderAllowed;
  return { ...product, globalBackorderAllowed: policy };
}
