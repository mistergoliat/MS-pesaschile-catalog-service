import type {
  NormalizedProductQuery,
  ProductIntentCandidateRanker,
  ProductIntentCatalogProduct,
  ProductIntentContext,
  ProductMatchReason,
  RankedProductIntentCandidate,
} from './contracts.js';
import { normalizeCatalogText, tokenizeCatalogText } from './normalizer.js';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Number(clamp01(value).toFixed(6));
}

function productIdentity(product: ProductIntentCatalogProduct): string {
  return `${product.productId}::${product.combinationId ?? '<base>'}`;
}

function containsAll(text: string, tokens: readonly string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => text.includes(token));
}

function coverage(tokens: readonly string[], text: string): number {
  if (tokens.length === 0) return 0;
  const matched = tokens.filter((token) => text.includes(token)).length;
  return matched / tokens.length;
}

function reasonList(reasons: readonly ProductMatchReason[]): ProductMatchReason[] {
  return [...new Set(reasons)];
}

function attributeText(product: ProductIntentCatalogProduct): string {
  return (product.attributes ?? [])
    .map((attribute) => `${attribute.group} ${attribute.value}`)
    .join(' ');
}

export class DefaultProductIntentCandidateRanker implements ProductIntentCandidateRanker {
  rank(
    query: NormalizedProductQuery,
    candidates: readonly ProductIntentCatalogProduct[],
    context?: ProductIntentContext,
  ): readonly RankedProductIntentCandidate[] {
    return candidates
      .map((product) => this.rankOne(query, product, context))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => (
        right.score - left.score ||
        left.product.name.localeCompare(right.product.name, 'es') ||
        productIdentity(left.product).localeCompare(productIdentity(right.product))
      ));
  }

  private rankOne(
    query: NormalizedProductQuery,
    product: ProductIntentCatalogProduct,
    context?: ProductIntentContext,
  ): RankedProductIntentCandidate {
    const name = normalizeCatalogText(product.name);
    const reference = normalizeCatalogText(product.reference);
    const category = normalizeCatalogText(product.category);
    const description = normalizeCatalogText(product.description);
    const attributes = normalizeCatalogText(attributeText(product));
    const intendedUse = normalizeCatalogText(context?.intendedUse);
    const contextCategory = normalizeCatalogText(context?.category);
    const productText = [name, reference, category, description, attributes].join(' ');

    const reasons: ProductMatchReason[] = [];
    if (reference.length > 0 && reference === query.normalized) reasons.push('EXACT_REFERENCE_MATCH');
    if (name === query.normalized) reasons.push('EXACT_NAME_MATCH');

    const nameCoverage = coverage(query.tokens, name);
    if (nameCoverage > 0) reasons.push('NAME_TOKEN_MATCH');

    const categoryCoverage = Math.max(coverage(query.tokens, category), contextCategory.length > 0 && category.includes(contextCategory) ? 1 : 0);
    if (categoryCoverage > 0) reasons.push('CATEGORY_MATCH');

    const descriptionCoverage = coverage(query.tokens, description);
    if (descriptionCoverage > 0) reasons.push('DESCRIPTION_MATCH');

    const attributeCoverage = Math.max(
      coverage(query.unitTokens, attributes),
      coverage(query.unitTokens, productText),
      context?.preferredAttributes
        ? Object.values(context.preferredAttributes).filter((value) => productText.includes(normalizeCatalogText(String(value)))).length /
          Math.max(Object.keys(context.preferredAttributes).length, 1)
        : 0,
    );
    if (attributeCoverage > 0) reasons.push('ATTRIBUTE_MATCH');

    const synonymMatched = query.synonymTerms.some((term) => productText.includes(normalizeCatalogText(term)));
    if (synonymMatched) reasons.push('SYNONYM_MATCH');

    const intendedUseMatched = intendedUse.length > 0 && containsAll(productText, tokenizeCatalogText(intendedUse));
    if (intendedUseMatched) reasons.push('INTENDED_USE_MATCH');

    if (reference.length > 0 && reference === query.normalized) {
      return { product, score: 1, reasons: reasonList(reasons) };
    }
    if (name === query.normalized) {
      return { product, score: 0.95, reasons: reasonList(reasons) };
    }

    const score = roundScore(
      (0.7 * nameCoverage) +
      (0.12 * attributeCoverage) +
      (0.08 * categoryCoverage) +
      (synonymMatched ? 0.06 : 0) +
      (intendedUseMatched ? 0.05 : 0) +
      (0.04 * descriptionCoverage),
    );

    return {
      product,
      score,
      reasons: reasonList(reasons),
    };
  }
}
