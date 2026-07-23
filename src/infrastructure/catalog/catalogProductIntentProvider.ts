import { config } from '../../shared/config.js';
import type { CatalogApplicationService } from '../../application/catalogService.js';
import type { ProductDetail, SearchItem } from '../../domain/catalog/types.js';
import type {
  CatalogProductIntentBatchReader,
  CatalogProductIntentSearcher,
  NormalizedProductQuery,
  ProductIntentCatalogProduct,
  ProductIntentReference,
  ProductIntentSearchHit,
} from '../../application/catalog/product-intent/index.js';
import { createProductIntentIdentity } from '../../application/catalog/product-intent/index.js';

function parseCatalogId(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function referenceFromSearchItem(item: SearchItem): ProductIntentReference {
  return {
    productId: String(item.productId),
    ...(item.combinationId > 0 ? { combinationId: String(item.combinationId) } : {}),
  };
}

function summaryStockStatus(
  physicalQuantity: number | undefined,
  available: boolean | undefined,
): ProductIntentCatalogProduct['stock']['status'] {
  if (physicalQuantity === undefined || available === undefined) return 'unknown';
  if (!available) return 'out_of_stock';
  if (physicalQuantity <= 0) return 'available_for_order';
  return 'in_stock';
}

function summaryFromDetail(reference: ProductIntentReference, detail: ProductDetail): ProductIntentCatalogProduct {
  const physicalQuantity = detail.stock?.physicalQuantity;
  const available = detail.stock?.available ?? false;
  const status = summaryStockStatus(physicalQuantity, detail.stock?.available);
  return {
    productId: reference.productId,
    ...(reference.combinationId === undefined ? {} : { combinationId: reference.combinationId }),
    name: detail.product.name,
    ...(detail.selectedVariant?.sku ?? detail.product.sku
      ? { reference: detail.selectedVariant?.sku ?? detail.product.sku ?? undefined }
      : {}),
    ...(detail.product.shortDescription ? { description: detail.product.shortDescription } : {}),
    active: detail.product.active,
    price: detail.pricing === null
      ? null
      : {
          amount: detail.pricing.effectiveUnitPrice,
          currency: detail.pricing.currency,
        },
    stock: {
      status,
      ...(physicalQuantity === undefined ? {} : { quantity: physicalQuantity }),
      available,
    },
    attributes: detail.attributes,
  };
}

function searchTerms(query: NormalizedProductQuery): string[] {
  const compactUnits = [
    query.normalized.replace(/\b(\d+(?:[.,]\d+)?)\s+(kg|mm|cm|m)\b/gu, '$1$2'),
    ...query.synonymTerms.map((term) => term.replace(/\b(\d+(?:[.,]\d+)?)\s+(kg|mm|cm|m)\b/gu, '$1$2')),
  ];
  return [...new Set([
    query.normalized,
    ...query.synonymTerms,
    ...compactUnits,
  ].filter((term) => term.trim().length >= 2))].slice(0, 8);
}

export class CatalogProductIntentProvider implements CatalogProductIntentSearcher, CatalogProductIntentBatchReader {
  constructor(private readonly catalogService: CatalogApplicationService) {}

  async search(input: {
    readonly query: NormalizedProductQuery;
    readonly limit: number;
    readonly includeOutOfStock: boolean;
  }): Promise<readonly ProductIntentSearchHit[]> {
    const hits = new Map<string, ProductIntentSearchHit>();
    for (const term of searchTerms(input.query)) {
      const result = await this.catalogService.searchProducts(term, input.limit, input.includeOutOfStock);
      for (const item of result.items) {
        const product = referenceFromSearchItem(item);
        const key = createProductIntentIdentity(product);
        if (!hits.has(key)) {
          hits.set(key, {
            product,
            query: term,
            matchType: item.matchType,
          });
        }
      }
    }
    return [...hits.values()].slice(0, input.limit);
  }

  async getProductsByReferences(
    references: readonly ProductIntentReference[],
    correlationId: string,
  ): Promise<ReadonlyMap<string, ProductIntentCatalogProduct>> {
    const requests = references.flatMap((reference) => {
      const productId = parseCatalogId(reference.productId, Number.NaN);
      const combinationId = parseCatalogId(reference.combinationId, 0);
      if (productId === null || combinationId === null || productId <= 0) {
        return [];
      }
      return [{
        reference,
        input: {
          productId,
          combinationId,
          quantity: 1,
        },
      }];
    });

    const result = await this.catalogService.batchGetProducts(
      requests.map((request) => request.input),
      correlationId,
      {
        customerGroupId: config.prestashop.customerGroupId,
        currencyId: config.prestashop.currencyId,
        countryId: config.prestashop.countryId,
      },
    );

    const data = new Map<string, ProductIntentCatalogProduct>();
    for (const [index, item] of result.items.entries()) {
      const requested = requests[index];
      if (!requested || !item.ok) continue;
      data.set(createProductIntentIdentity(requested.reference), summaryFromDetail(requested.reference, item.product));
    }
    return data;
  }
}
