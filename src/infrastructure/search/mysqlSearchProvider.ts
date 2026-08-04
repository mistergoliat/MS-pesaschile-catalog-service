import type { CatalogRepository, SearchCandidate, SearchProvider } from '../../domain/catalog/ports.js';
import type { SearchItem } from '../../domain/catalog/types.js';
import { isDiscoveryExcludedProductId } from '../../domain/catalog/discoveryExclusionPolicy.js';
import {
  catalogSearchQueryVariants,
  normalizeCatalogSearchText,
  tokenizeCatalogSearchText,
} from '../../domain/catalog/searchTextNormalization.js';

function containsQuery(text: string, normalizedQuery: string, queryTokens: readonly string[]): boolean {
  return text.includes(normalizedQuery) || (queryTokens.length > 1 && queryTokens.every((token) => text.includes(token)));
}

function scoreMatch(item: SearchItem, query: string): number {
  const normalized = normalizeCatalogSearchText(query);
  const queryTokens = tokenizeCatalogSearchText(query);
  const sku = item.sku ? normalizeCatalogSearchText(item.sku) : null;
  const name = normalizeCatalogSearchText(item.name);
  const shortDescription = normalizeCatalogSearchText(item.shortDescription ?? '');

  if (sku === normalized) {
    return 0;
  }
  if (name === normalized) {
    return 1;
  }
  if (containsQuery(name, normalized, queryTokens)) {
    return 2;
  }
  if (containsQuery(shortDescription, normalized, queryTokens)) {
    return 3;
  }
  return 4;
}

function resolveMatchType(item: SearchItem, query: string): SearchItem['matchType'] {
  const normalized = normalizeCatalogSearchText(query);
  const queryTokens = tokenizeCatalogSearchText(query);
  const sku = item.sku ? normalizeCatalogSearchText(item.sku) : null;
  const name = normalizeCatalogSearchText(item.name);
  const shortDescription = normalizeCatalogSearchText(item.shortDescription ?? '');

  if (sku === normalized) {
    return 'exact_sku';
  }
  if (name === normalized) {
    return 'exact_name';
  }
  if (containsQuery(name, normalized, queryTokens)) {
    return 'partial_name';
  }
  if (containsQuery(shortDescription, normalized, queryTokens)) {
    return 'description';
  }
  return 'description';
}

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
    const normalizedQuery = normalizeCatalogSearchText(query);
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
        const matchType = resolveMatchType(item, normalizedQuery);
        return {
          item: { ...item, matchType },
          score: scoreMatch(item, normalizedQuery) - (candidate.isDefault ? 0.5 : 0),
          key: candidateKey(candidate),
        };
      })
      .sort((left, right) => left.score - right.score || left.item.name.localeCompare(right.item.name))
      .reduce<Map<string, SearchItem>>((acc, entry) => {
        if (!acc.has(entry.key)) {
          acc.set(entry.key, entry.item);
        }
        return acc;
      }, new Map());

    return [...ranked.values()].slice(0, limit);
  }
}
