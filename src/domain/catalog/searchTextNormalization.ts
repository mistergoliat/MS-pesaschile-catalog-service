const UNIT_ALIASES = new Map<string, string>([
  ['kg', 'kg'],
  ['kgs', 'kg'],
  ['g', 'g'],
  ['gr', 'g'],
  ['grs', 'g'],
  ['lb', 'lb'],
  ['lbs', 'lb'],
  ['mm', 'mm'],
  ['cm', 'cm'],
  ['m', 'm'],
]);

function removeDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeNumber(value: string): string {
  const normalized = value.replace(',', '.');
  if (!normalized.includes('.')) {
    return normalized;
  }
  return normalized.replace(/(\.\d*?)0+$/u, '$1').replace(/\.$/u, '');
}

export function normalizeCatalogSearchText(input: string): string {
  return removeDiacritics(input)
    .toLowerCase()
    .replace(/\b(\d+(?:[.,]\d+)?)(?:\s*-\s*|\s*)(kgs?|grs?|gr|g|lbs?|mm|cm|m)\b/giu, (_match, amount: string, unit: string) => {
      const canonicalUnit = UNIT_ALIASES.get(unit.toLowerCase()) ?? unit.toLowerCase();
      return `${normalizeNumber(amount)}${canonicalUnit}`;
    })
    .replace(/\s+/gu, ' ')
    .trim();
}

export function catalogSearchQueryVariants(query: string): string[] {
  const originalQuery = query.trim();
  const canonicalQuery = normalizeCatalogSearchText(originalQuery);
  return [...new Set([originalQuery, canonicalQuery].filter((variant) => variant.length > 0))];
}

export function tokenizeCatalogSearchText(input: string): string[] {
  return normalizeCatalogSearchText(input).split(/\s+/u).filter((token) => token.length > 0);
}

// Spanish linking words with no retrieval value on their own (A11.2-B). Kept minimal and
// conservative: only articles/prepositions with no commercial meaning, never units or brands.
const CATALOG_SEARCH_STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una']);

// Drops stopwords from a token set used to build a mandatory (AND) SQL filter, so a filler
// word like "de" can't sink an otherwise-matching query. Falls back to the original tokens if
// filtering would empty the set, so a fallback query is never built from zero conditions.
export function filterCatalogSearchStopwords(tokens: readonly string[]): string[] {
  const significant = tokens.filter((token) => !CATALOG_SEARCH_STOPWORDS.has(token));
  return significant.length > 0 ? significant : [...tokens];
}
