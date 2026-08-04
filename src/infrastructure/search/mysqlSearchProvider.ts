import type { CatalogRepository, SearchCandidate, SearchProvider } from '../../domain/catalog/ports.js';
import type { SearchItem } from '../../domain/catalog/types.js';
import { isDiscoveryExcludedProductId } from '../../domain/catalog/discoveryExclusionPolicy.js';
import { catalogSearchQueryVariants } from '../../domain/catalog/searchTextNormalization.js';
import {
  compareCatalogSearchRankEntries,
  evaluateCatalogSearchTextRelevance,
} from '../../domain/catalog/searchTextRelevance.js';

function candidateKey(candidate: Pick<SearchCandidate, 'productId' | 'combinationId'>): string {
  return `${candidate.productId}:${candidate.combinationId}`;
}

export class MySqlSearchProvider implements SearchProvider {
  constructor(private readonly repository: CatalogRepository) {}

  async search(query: string, limit: number, includeOutOfStock: boolean): Promise<SearchItem[]> {
    const variants = catalogSearchQueryVariants(query);
    const candidatesByKey = new Map<string, SearchCandidate>();
    for (const variant of variants) {
      const candidates = await this.repository.getSearchCandidates(variant, includeOutOfStock, limit);
      for (const candidate of candidates) {
        const key = candidateKey(candidate);
        if (!candidatesByKey.has(key)) {
          candidatesByKey.set(key, candidate);
        }
      }
    }
    const candidates = [...candidatesByKey.values()];
    const ranked = candidates
      .filter((candidate) => !isDiscoveryExcludedProductId(candidate.productId))
      .map((candidate) => {
        const item: SearchItem = {
          productId: candidate.productId,
          combinationId: candidate.combinationId,
          sku: candidate.combinationSku ?? candidate.productSku,
          name: candidate.productName,
          variantLabel: candidate.variantLabel,
          shortDescription: candidate.shortDescription,
          physicalQuantity: candidate.physicalQuantity,
          available: candidate.physicalQuantity > 0,
          matchType: 'description',
        };
        const signals = evaluateCatalogSearchTextRelevance({
          item,
          query,
          isDefault: candidate.isDefault,
        });
        return {
          item: { ...item, matchType: signals.matchType },
          signals,
          key: candidateKey(candidate),
        };
      })
      .sort(compareCatalogSearchRankEntries)
      .reduce<Map<string, SearchItem>>((acc, entry) => {
        if (!acc.has(entry.key)) {
          acc.set(entry.key, entry.item);
        }
        return acc;
      }, new Map());

    return [...ranked.values()].slice(0, limit);
  }
}
