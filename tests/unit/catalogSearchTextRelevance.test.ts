import { describe, expect, it } from 'vitest';
import {
  compareCatalogSearchRankEntries,
  evaluateCatalogSearchTextRelevance,
} from '../../src/domain/catalog/searchTextRelevance.js';
import type { SearchItem } from '../../src/domain/catalog/types.js';

function item(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    productId: 1,
    combinationId: 0,
    sku: 'SKU',
    name: 'Barra Olimpica 20kg Eco',
    variantLabel: null,
    shortDescription: null,
    physicalQuantity: 1,
    available: true,
    matchType: 'description',
    ...overrides,
  };
}

describe('catalog search text relevance', () => {
  it('calculates full canonical token coverage without splitting units', () => {
    const signals = evaluateCatalogSearchTextRelevance({
      item: item({ name: 'Barra Olimpica 20kg Eco' }),
      query: 'barra ol\u00edmpica 20 kg',
      isDefault: false,
    });

    expect(signals.matchType).toBe('partial_name');
    expect(signals.nameTokenCoverage).toBe(3);
    expect(signals.nameTokenTotal).toBe(3);
    expect(signals.orderedTokensInName).toBe(true);
  });

  it('does not count short tokens as arbitrary substrings', () => {
    const signals = evaluateCatalogSearchTextRelevance({
      item: item({ name: 'Barra PROmachine 20kg' }),
      query: 'barra pro 20kg',
      isDefault: false,
    });

    expect(signals.nameTokenCoverage).toBe(2);
    expect(signals.matchType).toBe('description');
  });

  it('recognizes phrase matches separately from ordered token matches', () => {
    const phrase = evaluateCatalogSearchTextRelevance({
      item: item({ name: 'Barra Olimpica 20kg Eco' }),
      query: 'barra olimpica 20kg',
      isDefault: false,
    });
    const ordered = evaluateCatalogSearchTextRelevance({
      item: item({ name: 'Barra Olimpica Eco 20kg' }),
      query: 'barra olimpica 20kg',
      isDefault: false,
    });

    expect(phrase.exactPhraseInName).toBe(true);
    expect(phrase.orderedTokensInName).toBe(true);
    expect(ordered.exactPhraseInName).toBe(false);
    expect(ordered.orderedTokensInName).toBe(true);
  });

  it('ranks higher name token coverage first within the same match type', () => {
    const stronger = item({ productId: 1, name: 'Barra Olimpica 20kg Eco' });
    const weaker = item({ productId: 2, name: 'Barra EZ 20kg' });

    expect(compareCatalogSearchRankEntries({
      item: weaker,
      signals: {
        matchType: 'partial_name',
        score: 2,
        matchTypePriority: 2,
        exactPhraseInName: false,
        orderedTokensInName: true,
        nameTokenCoverage: 2,
        nameTokenTotal: 3,
        descriptionTokenCoverage: 0,
        descriptionTokenTotal: 3,
        isDefault: false,
      },
    }, {
      item: stronger,
      signals: {
        matchType: 'partial_name',
        score: 2,
        matchTypePriority: 2,
        exactPhraseInName: false,
        orderedTokensInName: true,
        nameTokenCoverage: 3,
        nameTokenTotal: 3,
        descriptionTokenCoverage: 0,
        descriptionTokenTotal: 3,
        isDefault: false,
      },
    })).toBeGreaterThan(0);
  });

  it('does not use description coverage to reorder name matches', () => {
    const historicalFirst = item({ productId: 545, name: 'Barra Olimpica 20kg 220cm Eco' });
    const richerDescription = item({ productId: 1208, name: 'Barra Olimpica Cerakote Black Camo 700lb 20kg' });

    expect(compareCatalogSearchRankEntries({
      item: historicalFirst,
      signals: {
        matchType: 'partial_name',
        score: 2,
        matchTypePriority: 2,
        exactPhraseInName: false,
        orderedTokensInName: true,
        nameTokenCoverage: 2,
        nameTokenTotal: 2,
        descriptionTokenCoverage: 1,
        descriptionTokenTotal: 2,
        isDefault: false,
      },
    }, {
      item: richerDescription,
      signals: {
        matchType: 'partial_name',
        score: 2,
        matchTypePriority: 2,
        exactPhraseInName: false,
        orderedTokensInName: true,
        nameTokenCoverage: 2,
        nameTokenTotal: 2,
        descriptionTokenCoverage: 2,
        descriptionTokenTotal: 2,
        isDefault: false,
      },
    })).toBeLessThan(0);
  });
});
