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

export class CatalogCommercialTruthService {
  constructor(
    private readonly dependencies: {
      readonly dataReader: CatalogCommercialDataReader;
      readonly availabilityResolver?: CommercialAvailabilityResolver;
      readonly specificPriceSelector?: SpecificPriceSelector;
      readonly priceCalculator?: CommercialPriceCalculator;
      readonly clock?: Clock;
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

    let inactive = 0;
    let unavailableForOrder = 0;
    let outOfStock = 0;
    let priceUnavailable = 0;

    for (const requested of requestedProducts) {
      const identity = createCatalogCommercialProductIdentity(requested);
      const rawProduct = rawProducts.get(identity);
      if (!rawProduct) continue;

      const productWarnings: CatalogCommercialWarning[] = [];
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

      const resolved: CatalogCommercialProduct = {
        productId: requested.productId,
        ...(requested.combinationId === undefined ? {} : { combinationId: requested.combinationId }),
        name: rawProduct.name,
        ...(rawProduct.combinationReference ?? rawProduct.productReference
          ? { reference: rawProduct.combinationReference ?? rawProduct.productReference ?? undefined }
          : {}),
        ...(rawProduct.description ? { description: rawProduct.description } : {}),
        ...(rawProduct.category ? { category: rawProduct.category } : {}),
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
}
