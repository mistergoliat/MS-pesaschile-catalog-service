import { config } from '../../shared/config.js';
import type { CatalogApplicationService } from '../../application/catalogService.js';
import type {
  ProductRecommendationCommercialData,
  ProductRecommendationCommercialDataProvider,
  ProductRecommendationContext,
  ProductReference,
} from '../../domain/recommendation/relationship-engine/recommendation/index.js';
import { createProductRuntimeIdentity } from '../../domain/recommendation/relationship-engine/runtime/index.js';

function parseCatalogId(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function stockStatus(physicalQuantity: number | undefined, available: boolean | undefined): ProductRecommendationCommercialData['stockStatus'] {
  if (physicalQuantity === undefined || available === undefined) return 'unknown';
  if (!available || physicalQuantity <= 0) return 'out_of_stock';
  if (physicalQuantity <= 5) return 'low_stock';
  return 'in_stock';
}

export class CatalogRecommendationCommercialDataProvider implements ProductRecommendationCommercialDataProvider {
  constructor(private readonly catalogService: CatalogApplicationService) {}

  async getCommercialData(
    products: readonly ProductReference[],
    _context: ProductRecommendationContext,
  ): Promise<ReadonlyMap<string, ProductRecommendationCommercialData>> {
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

    const data = new Map<string, ProductRecommendationCommercialData>();
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
}
