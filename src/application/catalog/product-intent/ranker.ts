import type {
  CandidateConstraintEvaluation,
  ExplicitProductConstraints,
  NormalizedProductQuery,
  ProductIntentCandidateRanker,
  ProductIntentCatalogProduct,
  ProductIntentContext,
  ProductMatchReason,
  RankedProductIntentCandidate,
  ProductConstraintEvaluator,
} from './contracts.js';
import { DefaultProductConstraintEvaluator } from './constraints.js';
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

function explicitReasonList(evaluation: CandidateConstraintEvaluation): ProductMatchReason[] {
  return evaluation.constraints.flatMap((constraint) => {
    if (constraint.status !== 'matched') return [];
    if (constraint.type === 'product_type') return ['EXPLICIT_TYPE_MATCH' as const];
    if (constraint.type === 'weight') return ['EXPLICIT_WEIGHT_MATCH' as const];
    if (constraint.type === 'diameter') return ['EXPLICIT_DIAMETER_MATCH' as const];
    if (constraint.type === 'length') return ['EXPLICIT_LENGTH_MATCH' as const];
    if (constraint.type === 'reference') return ['EXPLICIT_REFERENCE_MATCH' as const];
    return [];
  });
}

function explicitBonus(evaluation: CandidateConstraintEvaluation): number {
  return evaluation.constraints.reduce((sum, constraint) => {
    if (constraint.status !== 'matched') return sum;
    if (constraint.type === 'product_type') return sum + 0.22;
    if (constraint.type === 'weight') return sum + 0.25;
    if (constraint.type === 'diameter' || constraint.type === 'length') return sum + 0.2;
    if (constraint.type === 'reference') return sum + 0.35;
    return sum + 0.08;
  }, 0);
}

function contradictionPenalty(evaluation: CandidateConstraintEvaluation): number {
  const contradictions = evaluation.constraints.filter((constraint) => constraint.status === 'contradicted').length;
  return contradictions === 0 ? 1 : Math.max(0.08, 0.22 / contradictions);
}

function isPlausible(score: number, evaluation: CandidateConstraintEvaluation): boolean {
  if (evaluation.hasContradiction) return false;
  if (evaluation.explicitConstraintCount === 0) return score > 0;
  return score >= 0.35;
}

export class DefaultProductIntentCandidateRanker implements ProductIntentCandidateRanker {
  constructor(private readonly constraintEvaluator: ProductConstraintEvaluator = new DefaultProductConstraintEvaluator()) {}

  rank(
    query: NormalizedProductQuery,
    constraints: ExplicitProductConstraints,
    candidates: readonly ProductIntentCatalogProduct[],
    context?: ProductIntentContext,
  ): readonly RankedProductIntentCandidate[] {
    return candidates
      .map((product) => this.rankOne(query, constraints, product, context))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => (
        Number(right.plausible) - Number(left.plausible) ||
        right.score - left.score ||
        left.product.name.localeCompare(right.product.name, 'es') ||
        productIdentity(left.product).localeCompare(productIdentity(right.product))
      ));
  }

  private rankOne(
    query: NormalizedProductQuery,
    constraints: ExplicitProductConstraints,
    product: ProductIntentCatalogProduct,
    context?: ProductIntentContext,
  ): RankedProductIntentCandidate {
    const constraintEvaluation = this.constraintEvaluator.evaluate(constraints, product);
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
      return {
        product,
        score: 1,
        reasons: reasonList([...reasons, ...explicitReasonList(constraintEvaluation)]),
        constraintEvaluation,
        plausible: !constraintEvaluation.hasContradiction,
      };
    }
    if (name === query.normalized) {
      const score = roundScore(0.95 * contradictionPenalty(constraintEvaluation));
      return {
        product,
        score,
        reasons: reasonList([...reasons, ...explicitReasonList(constraintEvaluation)]),
        constraintEvaluation,
        plausible: isPlausible(score, constraintEvaluation),
      };
    }

    const baseScore =
      (0.7 * nameCoverage) +
      (0.12 * attributeCoverage) +
      (0.08 * categoryCoverage) +
      (synonymMatched ? 0.06 : 0) +
      (intendedUseMatched ? 0.05 : 0) +
      (0.04 * descriptionCoverage);
    const constraintScore = constraintEvaluation.satisfiesAllExplicitConstraints
      ? Math.max(baseScore + explicitBonus(constraintEvaluation), constraintEvaluation.explicitConstraintCount >= 2 ? 0.9 : 0)
      : baseScore + explicitBonus(constraintEvaluation);
    const score = roundScore(constraintScore * contradictionPenalty(constraintEvaluation));

    return {
      product,
      score,
      reasons: reasonList([...reasons, ...explicitReasonList(constraintEvaluation)]),
      constraintEvaluation,
      plausible: isPlausible(score, constraintEvaluation),
    };
  }
}
