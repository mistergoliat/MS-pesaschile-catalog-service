import type {
  CatalogCommercialContext,
  CatalogCommercialTruthService,
} from '../../../src/domain/catalog/commercial-truth/index.js';
import type {
  ProductSemanticClassificationResult,
} from '../../../src/domain/product-semantic-classification/index.js';

export interface CurrentCatalogPresenceSource {
  getCurrentProductIds(productIds: readonly string[]): Promise<ReadonlySet<string>>;
}

/**
 * Resolves product presence from the operational catalog truth layer. An inactive product is
 * deliberately not current here because GET /v1/products/:productId only resolves active rows.
 */
export class CatalogCommercialTruthPresenceSource implements CurrentCatalogPresenceSource {
  constructor(
    private readonly commercialTruthService: CatalogCommercialTruthService,
    private readonly context: CatalogCommercialContext,
  ) {}

  async getCurrentProductIds(productIds: readonly string[]): Promise<ReadonlySet<string>> {
    const requested = [...new Set(productIds)].filter((productId) => /^\d+$/u.test(productId) && Number(productId) > 0);
    if (requested.length === 0) return new Set();

    const truth = await this.commercialTruthService.getCommercialTruth({
      products: requested.map((productId) => ({ productId })),
      context: this.context,
    });
    return new Set(
      [...truth.productsByIdentity.values()]
        .filter((product) => product.availability.active)
        .map((product) => product.productId),
    );
  }
}

/** Test/fixture adapter for an independently produced current-catalog export. */
export class StaticCurrentCatalogPresenceSource implements CurrentCatalogPresenceSource {
  private readonly currentProductIds: ReadonlySet<string>;

  constructor(productIds: readonly string[]) {
    this.currentProductIds = new Set(productIds);
  }

  async getCurrentProductIds(productIds: readonly string[]): Promise<ReadonlySet<string>> {
    const requested = new Set(productIds);
    return new Set([...this.currentProductIds].filter((productId) => requested.has(productId)));
  }
}

export async function reconcileProductSemanticCatalogPresence(
  results: readonly ProductSemanticClassificationResult[],
  source: CurrentCatalogPresenceSource,
): Promise<readonly ProductSemanticClassificationResult[]> {
  const currentProductIds = await source.getCurrentProductIds(results.map((result) => result.productId));
  return results.map((result) => ({
    ...result,
    catalogPresence: currentProductIds.has(result.productId) ? 'current_catalog' : 'historical_order_detail_only',
  }));
}
