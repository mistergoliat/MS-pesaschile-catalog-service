import type { ProductSemanticClassificationResult, ProductSemanticClassificationStatus } from '../../../src/domain/product-semantic-classification/index.js';

export type ClassificationSummary = {
  readonly sourceProductCount: number;
  readonly statusCounts: Record<ProductSemanticClassificationStatus, number>;
  readonly excludedNonProductCount: number;
  readonly classifiedCount: number;
  readonly partialCount: number;
  readonly otherCount: number;
  readonly needsReviewCount: number;
  readonly productFamilyTagCounts: Record<string, number>;
  readonly disciplineTagCounts: Record<string, number>;
  readonly useContextTagCounts: Record<string, number>;
  readonly confidenceDistribution: { readonly EXPLICIT: number; readonly STRONGLY_INFERRED: number };
  readonly catalogPresenceDistribution: Record<string, number>;
  readonly registryVersion: string;
  readonly registryHash: string;
};

export function buildClassificationSummary(
  results: readonly ProductSemanticClassificationResult[],
  catalogPresenceById: ReadonlyMap<string, string>,
): ClassificationSummary {
  const statusCounts: Record<ProductSemanticClassificationStatus, number> = {
    CLASSIFIED: 0,
    PARTIALLY_CLASSIFIED: 0,
    OTHER: 0,
    EXCLUDED_NON_PRODUCT: 0,
    NEEDS_REVIEW: 0,
  };
  const productFamilyTagCounts: Record<string, number> = {};
  const disciplineTagCounts: Record<string, number> = {};
  const useContextTagCounts: Record<string, number> = {};
  const confidenceDistribution = { EXPLICIT: 0, STRONGLY_INFERRED: 0 };
  const catalogPresenceDistribution: Record<string, number> = {};

  for (const result of results) {
    statusCounts[result.classificationStatus] += 1;

    const catalogPresence = catalogPresenceById.get(result.productId) ?? 'unknown';
    catalogPresenceDistribution[catalogPresence] = (catalogPresenceDistribution[catalogPresence] ?? 0) + 1;

    const familyCodes = new Set<string>();
    if (result.primaryProductFamily) familyCodes.add(result.primaryProductFamily.code);
    for (const secondary of result.secondaryProductFamilies) familyCodes.add(secondary.code);
    for (const code of familyCodes) productFamilyTagCounts[code] = (productFamilyTagCounts[code] ?? 0) + 1;

    for (const discipline of result.disciplines) disciplineTagCounts[discipline.code] = (disciplineTagCounts[discipline.code] ?? 0) + 1;
    for (const useContext of result.useContexts) useContextTagCounts[useContext.code] = (useContextTagCounts[useContext.code] ?? 0) + 1;

    for (const tag of [result.primaryProductFamily, ...result.secondaryProductFamilies, ...result.disciplines, ...result.useContexts]) {
      if (!tag) continue;
      confidenceDistribution[tag.confidence] += 1;
    }
  }

  return {
    sourceProductCount: results.length,
    statusCounts,
    excludedNonProductCount: statusCounts.EXCLUDED_NON_PRODUCT,
    classifiedCount: statusCounts.CLASSIFIED,
    partialCount: statusCounts.PARTIALLY_CLASSIFIED,
    otherCount: statusCounts.OTHER,
    needsReviewCount: statusCounts.NEEDS_REVIEW,
    productFamilyTagCounts,
    disciplineTagCounts,
    useContextTagCounts,
    confidenceDistribution,
    catalogPresenceDistribution,
    registryVersion: results[0]?.registryVersion ?? '',
    registryHash: results[0]?.registryHash ?? '',
  };
}
