import { config } from '../../shared/config.js';
import type { CatalogApplicationService } from '../../application/catalogService.js';
import type {
  CatalogProductBatchReader,
  CatalogProductSummary,
} from '../../application/recommendation/search-products-v2/index.js';
import type {
  ProductRecommendationCommercialData as RelationshipProductRecommendationCommercialData,
  ProductRecommendationCommercialDataProvider as RelationshipProductRecommendationCommercialDataProvider,
  ProductRecommendationContext as RelationshipProductRecommendationContext,
  ProductReference as RelationshipProductReference,
} from '../../domain/recommendation/relationship-engine/recommendation/index.js';
import type { ProductRelationshipProductReference } from '../../domain/recommendation/relationship-engine/contracts.js';
import { createProductRuntimeIdentity } from '../../domain/recommendation/relationship-engine/runtime/index.js';
import type { ProductDetail } from '../../domain/catalog/types.js';

function parseCatalogId(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function stockStatus(
  physicalQuantity: number | undefined,
  available: boolean | undefined,
): RelationshipProductRecommendationCommercialData['stockStatus'] {
  if (physicalQuantity === undefined || available === undefined) return 'unknown';
  if (!available || physicalQuantity <= 0) return 'out_of_stock';
  if (physicalQuantity <= 5) return 'low_stock';
  return 'in_stock';
}

function summaryStockStatus(
  physicalQuantity: number | undefined,
  available: boolean | undefined,
): CatalogProductSummary['stock']['status'] {
  if (physicalQuantity === undefined || available === undefined) return 'unknown';
  if (!available) return 'out_of_stock';
  if (physicalQuantity <= 0) return 'available_for_order';
  return 'in_stock';
}

function summaryFromDetail(
  reference: ProductRelationshipProductReference,
  detail: ProductDetail,
): CatalogProductSummary {
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
  };
}

export class CatalogRecommendationCommercialDataProvider
  implements RelationshipProductRecommendationCommercialDataProvider, CatalogProductBatchReader {
  constructor(private readonly catalogService: CatalogApplicationService) {}

  async getCommercialData(
    products: readonly RelationshipProductReference[],
    _context: RelationshipProductRecommendationContext,
  ): Promise<ReadonlyMap<string, RelationshipProductRecommendationCommercialData>> {
    const requests = products.flatMap((product) => {
      const productId = parseCatalogId(product.productId, Number.NaN);
      const combinationId = parseCatalogId(product.combinationId, 0);
      if (productId === null || combinationId === null || productId <= 0) {
        return [];
      }
      return [{
        product,
        input: {
          productId,
          combinationId,
          quantity: 1,
        },
      }];
    });

    const result = await this.catalogService.batchGetProducts(
      requests.map((request) => request.input),
      'search-products-v2-commercial-data',
      {
        customerGroupId: config.prestashop.customerGroupId,
        currencyId: config.prestashop.currencyId,
        countryId: config.prestashop.countryId,
      },
    );

    const data = new Map<string, RelationshipProductRecommendationCommercialData>();
    for (const [index, item] of result.items.entries()) {
      const requested = requests[index];
      if (!requested || !item.ok) continue;

      const detail = item.product;
      const status = stockStatus(detail.stock?.physicalQuantity, detail.stock?.available);
      const available = status === 'in_stock' || status === 'low_stock';
      data.set(createProductRuntimeIdentity(requested.product), {
        product: requested.product,
        available,
        sellable: detail.selectedVariant !== null,
        active: detail.product.active,
        stockStatus: status,
        ...(detail.pricing === null
          ? {}
          : {
              price: {
                currency: detail.pricing.currency,
                amount: detail.pricing.effectiveUnitPrice,
              },
            }),
        marginSignal: 'unknown',
        compatibilityStatus: 'compatible',
      });
    }
    return data;
  }

  async getProductsByReferences(
    references: readonly ProductRelationshipProductReference[],
  ): Promise<ReadonlyMap<string, CatalogProductSummary>> {
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
      'search-products-v2-enrichment',
      {
        customerGroupId: config.prestashop.customerGroupId,
        currencyId: config.prestashop.currencyId,
        countryId: config.prestashop.countryId,
      },
    );

    const data = new Map<string, CatalogProductSummary>();
    for (const [index, item] of result.items.entries()) {
      const requested = requests[index];
      if (!requested || !item.ok) continue;
      data.set(createProductRuntimeIdentity(requested.reference), summaryFromDetail(requested.reference, item.product));
    }
    return data;
  }
}
