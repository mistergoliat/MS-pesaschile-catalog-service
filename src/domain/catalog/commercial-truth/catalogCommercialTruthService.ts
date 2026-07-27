import { cloneJsonValue, deepFreeze } from '../../recommendation/relationship-engine/publication/canonicalJson.js';
import {
  CommercialAvailabilityResolver,
} from './availabilityResolver.js';
import type {
  CatalogCommercialDataReader,
  CatalogCommercialProduct,
  CatalogCommercialProductReference,
  CatalogCommercialRawProduct,
  CatalogCommercialSpecificPrice,
  CatalogCommercialTruthRequest,
  CatalogCommercialTruthResult,
  CatalogCommercialWarning,
  Clock,
} from './contracts.js';
import { SystemClock } from './contracts.js';
import { CommercialPriceCalculator } from './priceCalculator.js';
import { buildProductPublicUrl } from './productPublicUrl.js';
import { createCatalogCommercialProductIdentity } from './productIdentity.js';
import { SpecificPriceSelector } from './specificPriceSelector.js';

function normalizeReference(product: CatalogCommercialProductReference): CatalogCommercialProductReference | null {
  if (!/^\d+$/u.test(product.productId)) return null;
  if (product.combinationId !== undefined && !/^\d+$/u.test(product.combinationId)) return null;
  if (Number(product.productId) <= 0) return null;
  return {
    productId: product.productId,
    ...(product.combinationId === undefined || product.combinationId === '0' ? {} : { combinationId: product.combinationId }),
  };
}

function deduplicateProducts(
  products: readonly CatalogCommercialProductReference[],
): CatalogCommercialProductReference[] {
  const result = new Map<string, CatalogCommercialProductReference>();
  for (const product of products) {
    const normalized = normalizeReference(product);
    if (!normalized) continue;
    const identity = createCatalogCommercialProductIdentity(normalized);
    if (!result.has(identity)) result.set(identity, normalized);
  }
  return [...result.values()];
}

function rawIdentity(product: Pick<CatalogCommercialRawProduct, 'productId' | 'combinationId'>): string {
  return createCatalogCommercialProductIdentity({
    productId: String(product.productId),
    ...(product.combinationId > 0 ? { combinationId: String(product.combinationId) } : {}),
  });
}

function productSpecificPrices(
  prices: readonly CatalogCommercialSpecificPrice[],
  productId: number,
): CatalogCommercialSpecificPrice[] {
  return prices.filter((price) => price.productId === productId);
}

type CatalogCommercialTruthLogger = {
  warn(event: string, fields: Readonly<Record<string, unknown>>): void;
};

type CatalogCommercialDataScope = {
  readonly shopId: number;
  readonly langId: number;
};

export class CatalogCommercialTruthService {
  constructor(
    private readonly dependencies: {
      readonly dataReader: CatalogCommercialDataReader;
      readonly availabilityResolver?: CommercialAvailabilityResolver;
      readonly specificPriceSelector?: SpecificPriceSelector;
      readonly priceCalculator?: CommercialPriceCalculator;
      readonly clock?: Clock;
      readonly publicBaseUrl?: string;
      readonly logger?: CatalogCommercialTruthLogger;
    },
  ) {}

  async getCommercialTruth(request: CatalogCommercialTruthRequest): Promise<CatalogCommercialTruthResult> {
    const evaluatedAtDate = (this.dependencies.clock ?? new SystemClock()).now();
    const evaluatedAt = evaluatedAtDate.toISOString();
    const requestedProducts = deduplicateProducts(request.products);
    const data = await this.dependencies.dataReader.read({
      products: requestedProducts,
      context: request.context,
    });
    const rawProducts = new Map(data.products.map((product) => [rawIdentity(product), product]));
    const productsByIdentity = new Map<string, CatalogCommercialProduct>();
    const warnings: CatalogCommercialWarning[] = [];
    const availabilityResolver = this.dependencies.availabilityResolver ?? new CommercialAvailabilityResolver();
    const specificPriceSelector = this.dependencies.specificPriceSelector ?? new SpecificPriceSelector();
    const priceCalculator = this.dependencies.priceCalculator ?? new CommercialPriceCalculator();
    const publicBaseUrl = this.dependencies.publicBaseUrl ?? process.env.CATALOG_PUBLIC_BASE_URL ?? '';

    let inactive = 0;
    let unavailableForOrder = 0;
    let outOfStock = 0;
    let priceUnavailable = 0;

    for (const requested of requestedProducts) {
      const identity = createCatalogCommercialProductIdentity(requested);
      const rawProduct = rawProducts.get(identity);
      if (!rawProduct) continue;

      const productWarnings: CatalogCommercialWarning[] = [];
      this.logLocalizationInconsistencies(rawProduct, data.scope, request.context);
      const selection = specificPriceSelector.select({
        product: requested,
        combinationId: rawProduct.combinationId,
        specificPrices: productSpecificPrices(data.specificPrices, rawProduct.productId),
        context: request.context,
        evaluatedAt: evaluatedAtDate,
      });
      productWarnings.push(...selection.warnings);

      const availability = availabilityResolver.resolve(rawProduct, evaluatedAt);
      if (availability.status === 'unknown') {
        productWarnings.push({ code: 'CATALOG_COMMERCIAL_STATUS_UNKNOWN', product: requested });
      }
      if (availability.status === 'inactive') inactive += 1;
      if (availability.status === 'unavailable_for_order') unavailableForOrder += 1;
      if (availability.status === 'out_of_stock') outOfStock += 1;

      const price = priceCalculator.calculate({
        product: requested,
        rawProduct,
        selectedSpecificPrice: selection.selected,
        context: request.context,
        evaluatedAt,
      });
      productWarnings.push(...price.warnings);
      if (price.price === null) priceUnavailable += 1;

      const publicUrl = buildProductPublicUrl({
        baseUrl: publicBaseUrl,
        productId: rawProduct.productId,
        linkRewrite: rawProduct.linkRewrite,
      });
      const requiresVariantSelection = rawProduct.hasCombinations;
      const publicLink = {
        canonicalUrl: publicUrl.canonicalUrl,
        scope: requiresVariantSelection ? 'parent_product' as const : 'exact_product' as const,
        available: publicUrl.available,
        ...(publicUrl.available ? {} : { unavailableReason: publicUrl.reason }),
        requiresVariantSelection,
        variantAttributeLabels: requiresVariantSelection ? rawProduct.variantAttributeLabels : [],
      };
      if (!publicUrl.available) {
        productWarnings.push({
          code: 'CATALOG_PUBLIC_LINK_UNAVAILABLE',
          product: requested,
          details: { reason: publicUrl.reason },
        });
        this.dependencies.logger?.warn('catalog_public_link_unavailable', {
          productId: rawProduct.productId,
          reason: publicUrl.reason,
        });
      }
      if (requiresVariantSelection && rawProduct.variantAttributeLabels.length === 0) {
        this.dependencies.logger?.warn('catalog_variant_attribute_labels_missing', {
          productId: rawProduct.productId,
        });
      }

      const resolved: CatalogCommercialProduct = {
        productId: requested.productId,
        ...(requested.combinationId === undefined ? {} : { combinationId: requested.combinationId }),
        name: rawProduct.name,
        ...(rawProduct.combinationReference ?? rawProduct.productReference
          ? { reference: rawProduct.combinationReference ?? rawProduct.productReference ?? undefined }
          : {}),
        ...(rawProduct.description ? { description: rawProduct.description } : {}),
        ...(rawProduct.category ? { category: rawProduct.category } : {}),
        publicLink,
        availability,
        price: price.price,
        warnings: deepFreeze(productWarnings.map((item) => cloneJsonValue(item))),
      };
      productsByIdentity.set(identity, deepFreeze(cloneJsonValue(resolved)));
      warnings.push(...productWarnings);
    }

    const result: CatalogCommercialTruthResult = {
      productsByIdentity,
      warnings: deepFreeze(warnings.map((item) => cloneJsonValue(item))),
      statistics: {
        requested: requestedProducts.length,
        resolved: productsByIdentity.size,
        missing: requestedProducts.length - productsByIdentity.size,
        inactive,
        unavailableForOrder,
        outOfStock,
        priceUnavailable,
        warningsGenerated: warnings.length,
      },
      evaluatedAt,
    };
    return deepFreeze(result);
  }

  private logLocalizationInconsistencies(
    rawProduct: CatalogCommercialRawProduct,
    dataScope: CatalogCommercialDataScope | undefined,
    context: CatalogCommercialTruthRequest['context'],
  ): void {
    if (dataScope && rawProduct.localizedLangId !== undefined && rawProduct.localizedLangId !== dataScope.langId) {
      this.dependencies.logger?.warn('catalog_public_link_lang_inconsistent', {
        productId: rawProduct.productId,
        expectedLangId: dataScope.langId,
        actualLangId: rawProduct.localizedLangId,
      });
    }
    if (dataScope && rawProduct.localizedShopId !== undefined && rawProduct.localizedShopId !== dataScope.shopId) {
      this.dependencies.logger?.warn('catalog_public_link_shop_inconsistent', {
        productId: rawProduct.productId,
        expectedShopId: dataScope.shopId,
        actualShopId: rawProduct.localizedShopId,
      });
    }
    if (dataScope && dataScope.shopId !== context.shopId) {
      this.dependencies.logger?.warn('catalog_commercial_context_shop_inconsistent', {
        expectedShopId: dataScope.shopId,
        actualShopId: context.shopId,
      });
    }
  }
}
