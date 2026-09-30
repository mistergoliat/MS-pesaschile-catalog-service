import { normalizeCatalogSearchText } from '../searchTextNormalization.js';

/*
 * J1D-CAT-01 — nominal search semantics of /v2/catalog/search.
 *
 * Nominal means: the query NAMES a product (reference, name, or the words and
 * measures of its name). It is not conceptual discovery: no category or
 * ontology expansion, no synonyms beyond the explicit unit aliases below.
 *
 * Match tiers (strongest first):
 *   exact_reference  normalized query = product or variant reference
 *   exact_name       query tokens = name tokens (identical words, same order)
 *   phrase           query tokens appear contiguously in the name
 *   all_tokens       every significant token appears in the name
 *   description      every significant token appears in the short description
 * A product that reaches none of them is not a match.
 *
 * Token equivalence: equal; or equal after dropping one trailing "s"
 * (plural, words of 4+ letters); or a prefix for query words of 4+ letters.
 * Measures ("20 kg", "20kg", "20-kgs", "20 kilos") are one token and match
 * exactly: "10kg" never matches "110kg".
 */

export type NominalMatchTier = 'exact_reference' | 'exact_name' | 'phrase' | 'all_tokens' | 'description';

export type NominalMatch = {
  tier: NominalMatchTier;
  matchedTokens: number;
  totalTokens: number;
  orderedInName: boolean;
  nameTokenCount: number;
};

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'con', 'para', 'por', 'en']);
const UNIT_WORDS = new Map<string, string>([
  ['kilo', 'kg'], ['kilos', 'kg'], ['kilogramo', 'kg'], ['kilogramos', 'kg'],
  ['libra', 'lb'], ['libras', 'lb'],
]);
const MEASURE = /^\d+(?:\.\d+)?(?:kg|g|lb|mm|cm|m)$/u;
const TIER_RANK: Record<NominalMatchTier, number> = { exact_reference: 0, exact_name: 1, phrase: 2, all_tokens: 3, description: 4 };
export const MAX_SIGNIFICANT_TOKENS = 8;

/** Normalized, punctuation-free tokens, with explicit unit words folded into measures. */
export function nominalTokens(text: string): string[] {
  const words = normalizeCatalogSearchText(text)
    .split(/[^\p{L}\p{N}.]+/u)
    .map((word) => word.replace(/^\.+|\.+$/gu, ''))
    .filter((word) => word.length > 0);
  const tokens: string[] = [];
  for (const word of words) {
    const unit = UNIT_WORDS.get(word);
    const previous = tokens[tokens.length - 1];
    if (unit && previous !== undefined && /^\d+(?:\.\d+)?$/u.test(previous)) {
      tokens[tokens.length - 1] = `${previous}${unit}`;
    } else {
      tokens.push(word);
    }
  }
  return tokens;
}

/** The query tokens that carry meaning (stopwords dropped unless nothing else is left), bounded. */
export function significantTokens(query: string): string[] {
  const tokens = [...new Set(nominalTokens(query))];
  const significant = tokens.filter((token) => !STOPWORDS.has(token));
  return (significant.length > 0 ? significant : tokens).slice(0, MAX_SIGNIFICANT_TOKENS);
}

function stem(token: string): string {
  return token.length >= 4 && !/\d/u.test(token) && token.endsWith('s') ? token.slice(0, -1) : token;
}

export function tokenMatches(queryToken: string, textToken: string): boolean {
  if (queryToken === textToken) return true;
  if (MEASURE.test(queryToken) || MEASURE.test(textToken)) return false;
  if (stem(queryToken) === stem(textToken)) return true;
  return queryToken.length >= 4 && textToken.startsWith(queryToken);
}

function indexOfPhrase(queryTokens: readonly string[], textTokens: readonly string[]): number {
  for (let start = 0; start + queryTokens.length <= textTokens.length; start += 1) {
    if (queryTokens.every((token, offset) => tokenMatches(token, textTokens[start + offset]!))) return start;
  }
  return -1;
}

function inOrder(queryTokens: readonly string[], textTokens: readonly string[]): boolean {
  let from = 0;
  for (const token of queryTokens) {
    const index = textTokens.findIndex((candidate, position) => position >= from && tokenMatches(token, candidate));
    if (index === -1) return false;
    from = index + 1;
  }
  return true;
}

export function matchNominal(input: {
  query: string;
  name: string;
  shortDescription: string | null;
  references: readonly (string | null)[];
}): NominalMatch | null {
  const normalizedQuery = nominalTokens(input.query).join(' ');
  const queryTokens = nominalTokens(input.query);
  const significant = significantTokens(input.query);
  const nameTokens = nominalTokens(input.name);
  const base = { totalTokens: Math.max(significant.length, 1), nameTokenCount: nameTokens.length };
  const inName = significant.filter((token) => nameTokens.some((candidate) => tokenMatches(token, candidate))).length;

  if (normalizedQuery.length > 0 && input.references.some((reference) => reference !== null && nominalTokens(reference).join(' ') === normalizedQuery)) {
    return { tier: 'exact_reference', matchedTokens: inName, orderedInName: inOrder(significant, nameTokens), ...base };
  }
  if (normalizedQuery.length > 0 && normalizedQuery === nameTokens.join(' ')) {
    return { tier: 'exact_name', matchedTokens: inName, orderedInName: true, ...base };
  }
  if (queryTokens.length > 0 && indexOfPhrase(queryTokens, nameTokens) >= 0) {
    return { tier: 'phrase', matchedTokens: inName, orderedInName: true, ...base };
  }
  if (significant.length > 0 && inName === significant.length) {
    return { tier: 'all_tokens', matchedTokens: inName, orderedInName: inOrder(significant, nameTokens), ...base };
  }
  const descriptionTokens = nominalTokens(input.shortDescription ?? '');
  const inDescription = significant.filter((token) => descriptionTokens.some((candidate) => tokenMatches(token, candidate))).length;
  if (significant.length > 0 && inDescription === significant.length) {
    return { tier: 'description', matchedTokens: inDescription, orderedInName: false, ...base };
  }
  return null;
}

/** Deterministic order: tier, word order, closeness of the name (fewer extra words), then name and id. */
export function compareNominal(
  left: { match: NominalMatch; name: string; productId: number },
  right: { match: NominalMatch; name: string; productId: number },
): number {
  return TIER_RANK[left.match.tier] - TIER_RANK[right.match.tier]
    || Number(right.match.orderedInName) - Number(left.match.orderedInName)
    || left.match.nameTokenCount - right.match.nameTokenCount
    || left.name.localeCompare(right.name, 'es')
    || left.productId - right.productId;
}

/**
 * Coarse SQL retrieval for a significant token: a superset of the in-memory
 * match (the database collation is case/accent-insensitive; the service then
 * applies `matchNominal`). A measure is retrieved by its number, which also
 * covers "20 kg" / "20kg" / "20 kilos" spellings in the source name; the
 * plural stem covers singular/plural.
 */
export function sqlLikeFragments(token: string): string[] {
  const measure = /^(\d+(?:\.\d+)?)(?:kg|g|lb|mm|cm|m)$/u.exec(token);
  if (measure) {
    const amount = measure[1]!;
    return amount.includes('.') ? [amount, amount.replace('.', ',')] : [amount];
  }
  return [stem(token)];
}
