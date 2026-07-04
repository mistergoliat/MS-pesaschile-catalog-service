import type { CatalogRepository, SearchProvider } from '../../domain/catalog/ports.js';
import type { SearchItem } from '../../domain/catalog/types.js';

function scoreMatch(item: SearchItem, query: string): number {
  const normalized = query.trim().toLowerCase();
  const name = item.name.toLowerCase();
  const shortDescription = item.shortDescription?.toLowerCase() ?? '';

  if (item.sku?.toLowerCase() === normalized) {
    return 0;
  }
  if (name === normalized) {
    return 1;
  }
  if (name.includes(normalized)) {
    return 2;
  }
  if (shortDescription.includes(normalized)) {
    return 3;
  }
  return 4;
}

function resolveMatchType(item: SearchItem, query: string): SearchItem['matchType'] {
  const normalized = query.trim().toLowerCase();
  const name = item.name.toLowerCase();
  const shortDescription = item.shortDescription?.toLowerCase() ?? '';

  if (item.sku?.toLowerCase() === normalized) {
    return 'exact_sku';
  }
  if (name === normalized) {
    return 'exact_name';
  }
  if (name.includes(normalized)) {
    return 'partial_name';
  }
  if (shortDescription.includes(normalized)) {
    return 'description';
  }
  return 'description';
}

export class MySqlSearchProvider implements SearchProvider {
  constructor(private readonly repository: CatalogRepository) {}

  async search(query: string, limit: number, includeOutOfStock: boolean): Promise<SearchItem[]> {
    const candidates = await this.repository.getSearchCandidates(query, includeOutOfStock, limit);
    const ranked = candidates
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
        const matchType = resolveMatchType(item, query);
        return {
          item: { ...item, matchType },
          score: scoreMatch(item, query) - (candidate.isDefault ? 0.5 : 0),
          key: `${candidate.productId}:${candidate.combinationId}`,
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
