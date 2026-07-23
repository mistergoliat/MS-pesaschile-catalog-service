import { config } from '../../shared/config.js';
import type {
  CatalogProductBatchReader,
  CatalogProductSummary,
} from '../../application/recommendation/search-products-v2/index.js';
import type {
  CatalogCommercialProduct,
  CatalogCommercialTruthService,
} from '../../domain/catalog/commercial-truth/index.js';
import type {
  ProductRecommendationCommercialData as RelationshipProductRecommendationCommercialData,
  ProductRecommendationCommercialDataProvider as RelationshipProductRecommendationCommercialDataProvider,
  ProductRecommendationContext as RelationshipProductRecommendationContext,
  ProductReference as RelationshipProductReference,
} from '../../domain/recommendation/relationship-engine/recommendation/index.js';
import type { ProductRelationshipProductReference } from '../../domain/recommendation/relationship-engine/contracts.js';
import { createProductRuntimeIdentity } from '../../domain/recommendation/relationship-engine/runtime/index.js';

function parseCatalogId(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function recommendationStockStatus(
  product: CatalogCommercialProduct,
): RelationshipProductRecommendationCommercialData['stockStatus'] {
  if (product.availability.status === 'unknown') return 'unknown';
  if (!product.availability.purchasable) return 'out_of_stock';
  if ((product.availability.stockQuantity ?? 0) <= 5) return 'low_stock';
  return 'in_stock';
}

function summaryStockStatus(product: CatalogCommercialProduct): CatalogProductSummary['stock']['status'] {
  if (product.availability.status === 'available') return 'in_stock';
  if (product.availability.status === 'out_of_stock') return 'out_of_stock';
  return 'unknown';
}

function summaryFromDetail(
  product: CatalogCommercialProduct,
): CatalogProductSummary {
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
    ...(product.productUrl === undefined ? {} : { productUrl: product.productUrl }),
    ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
  };
}

export class CatalogRecommendationCommercialDataProvider
  implements RelationshipProductRecommendationCommercialDataProvider, CatalogProductBatchReader {
  constructor(private readonly commercialTruthService: CatalogCommercialTruthService) {}

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
      return [product];
    });

    const result = await this.commercialTruthService.getCommercialTruth({
      products: requests,
      context: commercialContext(),
      correlationId: 'search-products-v2-commercial-data',
    });

    const data = new Map<string, RelationshipProductRecommendationCommercialData>();
    for (const product of result.productsByIdentity.values()) {
      const reference = {
        productId: product.productId,
        ...(product.combinationId === undefined ? {} : { combinationId: product.combinationId }),
      };
      const status = recommendationStockStatus(product);
      data.set(createProductRuntimeIdentity(reference), {
        product: reference,
        available: product.availability.purchasable,
        sellable: product.availability.purchasable,
        active: product.availability.active,
        stockStatus: status,
        ...(product.price === null
          ? {}
          : {
              price: {
                currency: product.price.currency,
                amount: product.price.finalGrossAmount,
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
      return [reference];
    });

    const result = await this.commercialTruthService.getCommercialTruth({
      products: requests,
      context: commercialContext(),
      correlationId: 'search-products-v2-enrichment',
    });

    const data = new Map<string, CatalogProductSummary>();
    for (const product of result.productsByIdentity.values()) {
      const reference = {
        productId: product.productId,
        ...(product.combinationId === undefined ? {} : { combinationId: product.combinationId }),
      };
      data.set(createProductRuntimeIdentity(reference), summaryFromDetail(product));
    }
    return data;
  }
}

function commercialContext() {
  return {
    shopId: config.prestashop.shopId,
    currencyId: config.prestashop.currencyId,
    currencyCode: config.prestashop.currencyCode,
    countryId: config.prestashop.countryId,
    customerGroupId: config.prestashop.customerGroupId,
    customerId: 0,
    quantity: 1,
    taxRate: config.pricing.taxRate,
  };
}
