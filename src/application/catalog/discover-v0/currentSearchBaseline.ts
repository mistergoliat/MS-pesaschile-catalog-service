import { CatalogContractService } from '../v2/catalogContractService.js';
import { catalogSearchRequestSchema, type CatalogSearchResponse, type CatalogV2DataReader, type CatalogV2Product } from '../../../domain/catalog/v2/contracts.js';
import { significantTokens, sqlLikeFragments } from '../../../domain/catalog/v2/nominalSearch.js';
import { isDiscoveryExcludedProductId } from '../../../domain/catalog/discoveryExclusionPolicy.js';
import type { CanonicalExtraction } from '../../../domain/catalog/projection-input/canonical.js';

/*
 * Variant A (CURRENT_SEARCH): the REAL CatalogContractService.search (matchNominal
 * + compareNominal + its filters), fed by an offline reader over the frozen
 * source extraction. Same precedent as scripts/catalog-v2/searchGold.ts.
 *
 * Differences vs the production runtime, all caused by fields the frozen
 * extraction does not contain (documented, not compensated):
 *  - no SKU/reference: exact_reference can never fire;
 *  - no short description: the `description` tier can never fire;
 *  - no visibility: active current products are treated as listed;
 *  - no price/stock/orderability: priceSummary is null and availability is
 *    "not observed"; the adapter discards both and reports NOT_OBSERVED;
 *  - the SQL candidate predicate is emulated in memory with case/accent folding
 *    (MySQL collation) — it is a superset filter, the service still decides;
 *  - the service's 15 s response cache is bypassed (one instance per call) so
 *    every measured call does the same work.
 */

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function frozenSourceSearchProducts(extraction: CanonicalExtraction, asOf: string): CatalogV2Product[] {
  return extraction.products
    .filter((product) => product.catalogPresence === 'current_catalog' && product.active === true && !isDiscoveryExcludedProductId(product.productId))
    .map((product) => {
      const brand = (product.features ?? []).find((feature) => feature.featureId === 62)?.value ?? null;
      const variantIds = product.variantIds ?? [];
      return {
        productId: product.productId,
        basePriceNet: null,
        name: product.name,
        sku: null,
        shortDescription: null,
        brand,
        weightKg: null,
        linkRewrite: null,
        category: null,
        active: true,
        listed: true,
        orderable: null,
        variants: variantIds.length > 0
          ? variantIds.map((variantId, position) => ({ combinationId: variantId, sku: null, attributes: [], impactPriceNet: 0, isDefault: position === 0, availableQuantity: null, outOfStock: null }))
          : [{ combinationId: 0, sku: null, attributes: [], impactPriceNet: 0, isDefault: true, availableQuantity: null, outOfStock: null }],
        specifications: [],
        globalBackorderAllowed: null,
        specificPrices: [],
        asOf,
      } satisfies CatalogV2Product;
    });
}

export class FrozenSourceCatalogV2DataReader implements CatalogV2DataReader {
  constructor(private readonly products: readonly CatalogV2Product[], private readonly asOf: string) {}

  async readProducts(input: { productIds?: readonly number[]; query?: string }) {
    const ids = input.productIds ? new Set(input.productIds) : null;
    const query = input.query ? fold(input.query) : null;
    const tokenFragments = input.query ? significantTokens(input.query).map((token) => sqlLikeFragments(token).map(fold)) : [];
    const products = this.products.filter((product) => {
      if (ids && !ids.has(product.productId)) return false;
      if (!query) return true;
      const name = fold(product.name);
      return name === query || name.includes(query)
        || (tokenFragments.length > 0 && tokenFragments.every((fragments) => fragments.some((fragment) => name.includes(fragment))));
    });
    return { products: [...products], asOf: this.asOf };
  }
}

export type CurrentSearchOutcome = {
  status: 'OK' | 'REJECTED_BY_ROUTE_SCHEMA';
  productKeys: string[];
  matchTypes: string[];
  totalMatches: number;
  truncated: boolean;
  response: CatalogSearchResponse | null;
  commercial: 'NOT_OBSERVED_OFFLINE';
};

export class CurrentSearchBaseline {
  private readonly products: CatalogV2Product[];
  private readonly reader: FrozenSourceCatalogV2DataReader;

  constructor(extraction: CanonicalExtraction, private readonly observedAt: string) {
    this.products = frozenSourceSearchProducts(extraction, observedAt);
    this.reader = new FrozenSourceCatalogV2DataReader(this.products, observedAt);
  }

  get universeSize(): number {
    return this.products.length;
  }

  async search(query: string, limit: number): Promise<CurrentSearchOutcome> {
    const parsed = catalogSearchRequestSchema.safeParse({ query, limit });
    if (!parsed.success) {
      return { status: 'REJECTED_BY_ROUTE_SCHEMA', productKeys: [], matchTypes: [], totalMatches: 0, truncated: false, response: null, commercial: 'NOT_OBSERVED_OFFLINE' };
    }
    const service = new CatalogContractService({
      reader: this.reader,
      clock: { now: () => new Date(this.observedAt) },
      serviceBuildRef: 'catalog-service@discover-v0-offline-baseline',
    });
    const response = await service.search(parsed.data);
    return {
      status: 'OK',
      productKeys: response.results.map((result) => result.productKey),
      matchTypes: response.results.map((result) => result.match.type),
      totalMatches: response.completeness.totalMatches,
      truncated: response.completeness.truncated,
      response,
      commercial: 'NOT_OBSERVED_OFFLINE',
    };
  }
}
