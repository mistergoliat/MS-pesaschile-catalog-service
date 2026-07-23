import { config } from '../../shared/config.js';
import type { CatalogApplicationService } from '../../application/catalogService.js';
import type { SearchItem } from '../../domain/catalog/types.js';
import type {
  CatalogCommercialProduct,
  CatalogCommercialTruthService,
} from '../../domain/catalog/commercial-truth/index.js';
import type {
  CatalogProductIntentBatchReader,
  CatalogProductIntentSearcher,
  NormalizedProductQuery,
  ProductIntentCatalogProduct,
  ProductIntentReference,
  ProductIntentSearchHit,
} from '../../application/catalog/product-intent/index.js';
import { createProductIntentIdentity } from '../../application/catalog/product-intent/index.js';
import { normalizeCatalogText } from '../../application/catalog/product-intent/normalizer.js';

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

function summaryStockStatus(product: CatalogCommercialProduct): ProductIntentCatalogProduct['stock']['status'] {
  if (product.availability.status === 'available') return 'in_stock';
  if (product.availability.status === 'out_of_stock') return 'out_of_stock';
  return 'unknown';
}

function summaryFromTruth(product: CatalogCommercialProduct): ProductIntentCatalogProduct {
  const status = summaryStockStatus(product);
  return {
    productId: product.productId,
    ...(product.combinationId === undefined ? {} : { combinationId: product.combinationId }),
    name: product.name,
    ...(product.reference === undefined ? {} : { reference: product.reference }),
    ...(product.description === undefined ? {} : { description: product.description }),
    ...(product.category === undefined ? {} : { category: product.category }),
    active: product.availability.active,
    price: product.price === null
      ? null
      : {
          amount: product.price.finalGrossAmount,
          currency: product.price.currency,
        },
    stock: {
      status,
      ...(product.availability.stockQuantity === null ? {} : { quantity: product.availability.stockQuantity }),
      available: product.availability.purchasable,
    },
    availability: product.availability,
    pricing: product.price,
  };
}

function searchTerms(query: NormalizedProductQuery): string[] {
  const broadGenericTerms = new Set(['barra']);
  const includeNormalizedTerm = !(broadGenericTerms.has(query.normalized) && query.synonymTerms.length > 0);
  const compactUnits = [
    ...(includeNormalizedTerm ? [query.normalized.replace(/\b(\d+(?:[.,]\d+)?)\s+(kg|mm|cm|m)\b/gu, '$1$2')] : []),
    ...query.synonymTerms.map((term) => term.replace(/\b(\d+(?:[.,]\d+)?)\s+(kg|mm|cm|m)\b/gu, '$1$2')),
  ];
  const baseTerms = broadGenericTerms.has(query.normalized) && query.synonymTerms.length > 0
    ? query.synonymTerms
    : [query.normalized, ...query.synonymTerms];
  return [...new Set([
    ...baseTerms,
    ...compactUnits,
  ].filter((term) => term.trim().length >= 2))].slice(0, 8);
}

export class CatalogProductIntentProvider implements CatalogProductIntentSearcher, CatalogProductIntentBatchReader {
  constructor(
    private readonly catalogService: CatalogApplicationService,
    private readonly commercialTruthService: CatalogCommercialTruthService,
  ) {}

  async search(input: {
    readonly query: NormalizedProductQuery;
    readonly limit: number;
    readonly includeOutOfStock: boolean;
  }): Promise<readonly ProductIntentSearchHit[]> {
    const hits = new Map<string, ProductIntentSearchHit>();
    const terms = searchTerms(input.query);
    const perTermLimit = Math.max(5, Math.ceil(input.limit / Math.max(terms.length, 1)));
    for (const term of terms) {
      const result = await this.catalogService.searchProducts(term, input.limit, input.includeOutOfStock);
      let acceptedForTerm = 0;
      for (const item of result.items) {
        if (input.query.normalized === 'barra' && !normalizeCatalogText(item.name).includes(normalizeCatalogText(term))) {
          continue;
        }
        const product = referenceFromSearchItem(item);
        const key = createProductIntentIdentity(product);
        if (!hits.has(key)) {
          hits.set(key, {
            product,
            query: term,
            matchType: item.matchType,
          });
          acceptedForTerm += 1;
          if (acceptedForTerm >= perTermLimit) break;
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
      return [reference];
    });

    const result = await this.commercialTruthService.getCommercialTruth({
      products: requests,
      context: {
        shopId: config.prestashop.shopId,
        currencyId: config.prestashop.currencyId,
        currencyCode: config.prestashop.currencyCode,
        countryId: config.prestashop.countryId,
        customerGroupId: config.prestashop.customerGroupId,
        customerId: 0,
        quantity: 1,
        taxRate: config.pricing.taxRate,
      },
      correlationId,
    });

    const data = new Map<string, ProductIntentCatalogProduct>();
    for (const product of result.productsByIdentity.values()) {
      const reference = {
        productId: product.productId,
        ...(product.combinationId === undefined ? {} : { combinationId: product.combinationId }),
      };
      data.set(createProductIntentIdentity(reference), summaryFromTruth(product));
    }
    return data;
  }
}
