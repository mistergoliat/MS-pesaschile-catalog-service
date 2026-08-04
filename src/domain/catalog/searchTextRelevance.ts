import type { SearchItem, SearchMatchType } from './types.js';
import {
  normalizeCatalogSearchText,
  tokenizeCatalogSearchText,
} from './searchTextNormalization.js';

export type CatalogSearchRelevanceSignals = {
  readonly matchType: SearchMatchType;
  readonly score: number;
  readonly matchTypePriority: number;
  readonly exactPhraseInName: boolean;
  readonly orderedTokensInName: boolean;
  readonly nameTokenCoverage: number;
  readonly nameTokenTotal: number;
  readonly descriptionTokenCoverage: number;
  readonly descriptionTokenTotal: number;
  readonly isDefault: boolean;
};

export type CatalogSearchRankEntry = {
  readonly item: SearchItem;
  readonly signals: CatalogSearchRelevanceSignals;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isCanonicalUnitToken(token: string): boolean {
  return /^\d+(?:\.\d+)?(?:kg|g|lb|mm|cm|m)$/u.test(token);
}

function tokenMatchesTextToken(queryToken: string, textToken: string): boolean {
  if (queryToken === textToken) {
    return true;
  }
  if (isCanonicalUnitToken(queryToken) || queryToken.length <= 3) {
    return false;
  }
  return textToken.startsWith(queryToken);
}

function tokenInText(queryToken: string, textTokens: readonly string[]): boolean {
  return textTokens.some((textToken) => tokenMatchesTextToken(queryToken, textToken));
}

function tokenCoverage(queryTokens: readonly string[], textTokens: readonly string[]): number {
  return queryTokens.filter((token) => tokenInText(token, textTokens)).length;
}

export function catalogSearchTextTokenCoverage(input: {
  readonly query: string;
  readonly text: string | null;
}): { readonly matched: number; readonly total: number } {
  const queryTokens = unique(tokenizeCatalogSearchText(input.query));
  const textTokens = tokenizeCatalogSearchText(input.text ?? '');
  return {
    matched: tokenCoverage(queryTokens, textTokens),
    total: queryTokens.length,
  };
}

function orderedTokensInText(queryTokens: readonly string[], textTokens: readonly string[]): boolean {
  if (queryTokens.length === 0) {
    return false;
  }
  let searchFrom = 0;
  for (const queryToken of queryTokens) {
    const index = textTokens.findIndex((textToken, currentIndex) => (
      currentIndex >= searchFrom && tokenMatchesTextToken(queryToken, textToken)
    ));
    if (index === -1) {
      return false;
    }
    searchFrom = index + 1;
  }
  return true;
}

export function catalogSearchMatchTypePriority(matchType: SearchMatchType): number {
  switch (matchType) {
    case 'exact_sku':
      return 0;
    case 'exact_name':
      return 1;
    case 'partial_name':
      return 2;
    case 'description':
      return 3;
  }
}

export function evaluateCatalogSearchTextRelevance(input: {
  readonly item: Pick<SearchItem, 'sku' | 'name' | 'shortDescription'>;
  readonly query: string;
  readonly isDefault: boolean;
}): CatalogSearchRelevanceSignals {
  const normalizedQuery = normalizeCatalogSearchText(input.query);
  const queryTokens = unique(tokenizeCatalogSearchText(input.query));
  const normalizedSku = input.item.sku ? normalizeCatalogSearchText(input.item.sku) : null;
  const normalizedName = normalizeCatalogSearchText(input.item.name);
  const normalizedDescription = normalizeCatalogSearchText(input.item.shortDescription ?? '');
  const nameTokens = tokenizeCatalogSearchText(input.item.name);
  const descriptionTokens = tokenizeCatalogSearchText(input.item.shortDescription ?? '');
  const nameTokenCoverage = tokenCoverage(queryTokens, nameTokens);
  const descriptionTokenCoverage = tokenCoverage(queryTokens, descriptionTokens);
  const exactPhraseInName = normalizedQuery.length > 0 && normalizedName.includes(normalizedQuery);
  const orderedNameTokens = orderedTokensInText(queryTokens, nameTokens);
  const allNameTokensMatched = queryTokens.length > 0 && nameTokenCoverage === queryTokens.length;
  const allDescriptionTokensMatched = queryTokens.length > 0 && descriptionTokenCoverage === queryTokens.length;

  let matchType: SearchMatchType = 'description';
  let score = 4;
  if (normalizedSku === normalizedQuery) {
    matchType = 'exact_sku';
    score = 0;
  } else if (normalizedName === normalizedQuery) {
    matchType = 'exact_name';
    score = 1;
  } else if (exactPhraseInName || allNameTokensMatched) {
    matchType = 'partial_name';
    score = 2;
  } else if (normalizedDescription.includes(normalizedQuery) || allDescriptionTokensMatched) {
    matchType = 'description';
    score = 3;
  }

  return {
    matchType,
    score,
    matchTypePriority: catalogSearchMatchTypePriority(matchType),
    exactPhraseInName,
    orderedTokensInName: orderedNameTokens,
    nameTokenCoverage,
    nameTokenTotal: queryTokens.length,
    descriptionTokenCoverage,
    descriptionTokenTotal: queryTokens.length,
    isDefault: input.isDefault,
  };
}

export function compareCatalogSearchRankEntries(left: CatalogSearchRankEntry, right: CatalogSearchRankEntry): number {
  const descriptionCoverageRank = left.signals.matchType === 'description' && right.signals.matchType === 'description'
    ? right.signals.descriptionTokenCoverage - left.signals.descriptionTokenCoverage
    : 0;
  return (
    left.signals.matchTypePriority - right.signals.matchTypePriority ||
    Number(right.signals.exactPhraseInName) - Number(left.signals.exactPhraseInName) ||
    right.signals.nameTokenCoverage - left.signals.nameTokenCoverage ||
    Number(right.signals.orderedTokensInName) - Number(left.signals.orderedTokensInName) ||
    descriptionCoverageRank ||
    Number(right.signals.isDefault) - Number(left.signals.isDefault) ||
    left.item.name.localeCompare(right.item.name) ||
    left.item.productId - right.item.productId ||
    left.item.combinationId - right.item.combinationId
  );
}
