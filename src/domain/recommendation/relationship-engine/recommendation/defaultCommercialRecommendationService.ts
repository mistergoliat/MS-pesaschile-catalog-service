import type { CalculatedProductRelationship } from '../contracts.js';
import { cloneJsonValue, deepFreeze } from '../publication/canonicalJson.js';
import { ProductRelationshipRuntimeError } from '../runtime/errors.js';
import { createProductRuntimeIdentity } from '../runtime/productIdentity.js';
import {
  DEFAULT_PRODUCT_RECOMMENDATION_SERVICE_PARAMETERS,
  productRecommendationCommercialDataSchema,
  productRecommendationRequestSchema,
  productRecommendationServiceParametersSchema,
  type CommercialProductRecommendationService,
  type ProductRecommendation,
  type ProductRecommendationCommercialData,
  type ProductRecommendationCommercialDataProvider,
  type ProductRecommendationEligibilityEvaluator,
  type ProductRecommendationRanker,
  type ProductRecommendationRequest,
  type ProductRecommendationResult,
  type ProductRecommendationScorer,
  type ProductRecommendationServiceParameters,
  type ProductRecommendationStatistics,
  type RejectedProductRecommendationCandidate,
  type ScoredProductRecommendationCandidate,
} from './contracts.js';
import { ProductRecommendationError } from './errors.js';
import type { ActiveProductRelationshipSnapshotReader } from '../runtime/contracts.js';

function coOccurrenceMetric(relationship: CalculatedProductRelationship, metric: 'lift' | 'confidence' | 'support' | 'jointCount'): number {
  if (relationship.evidence.kind !== 'co_occurrence') return 0;
  return relationship.evidence[metric];
}

function compareRelationshipsForDeduplication(
  left: CalculatedProductRelationship,
  right: CalculatedProductRelationship,
): number {
  return (
    right.reliability - left.reliability ||
    coOccurrenceMetric(right, 'lift') - coOccurrenceMetric(left, 'lift') ||
    coOccurrenceMetric(right, 'confidence') - coOccurrenceMetric(left, 'confidence') ||
    coOccurrenceMetric(right, 'support') - coOccurrenceMetric(left, 'support') ||
    coOccurrenceMetric(right, 'jointCount') - coOccurrenceMetric(left, 'jointCount') ||
    createProductRuntimeIdentity(left.targetProduct).localeCompare(createProductRuntimeIdentity(right.targetProduct))
  );
}

function duplicateRejection(relationship: CalculatedProductRelationship): RejectedProductRecommendationCandidate {
  return {
    product: cloneJsonValue(relationship.targetProduct),
    productIdentity: createProductRuntimeIdentity(relationship.targetProduct),
    relationship: cloneJsonValue(relationship),
    rejectionReasons: deepFreeze([{ code: 'DUPLICATE_TARGET' as const }]),
  };
}

function emptyStatistics(relationshipsRead: number, deduplicatedCandidates: number, duplicatesRemoved: number): ProductRecommendationStatistics {
  return {
    relationshipsRead,
    deduplicatedCandidates,
    duplicatesRemoved,
    commercialRecordsRequested: deduplicatedCandidates,
    eligibleCandidates: 0,
    rejectedCandidates: duplicatesRemoved,
    scoredCandidates: 0,
    recommendationsReturned: 0,
  };
}

function validateStatistics(statistics: ProductRecommendationStatistics): void {
  if (statistics.relationshipsRead !== statistics.deduplicatedCandidates + statistics.duplicatesRemoved) {
    throw new ProductRecommendationError('INVALID_RECOMMENDATION_REQUEST', 'Recommendation statistics are inconsistent');
  }
  if (statistics.eligibleCandidates + statistics.rejectedCandidates !== statistics.deduplicatedCandidates + statistics.duplicatesRemoved) {
    throw new ProductRecommendationError('INVALID_RECOMMENDATION_REQUEST', 'Recommendation candidate statistics are inconsistent');
  }
  if (statistics.scoredCandidates !== statistics.eligibleCandidates) {
    throw new ProductRecommendationError('INVALID_RECOMMENDATION_REQUEST', 'Scored candidates must equal eligible candidates');
  }
  if (statistics.recommendationsReturned > statistics.scoredCandidates) {
    throw new ProductRecommendationError('INVALID_RECOMMENDATION_REQUEST', 'Returned recommendations exceed scored candidates');
  }
}

export class DefaultCommercialProductRecommendationService implements CommercialProductRecommendationService {
  private readonly parameters: ProductRecommendationServiceParameters;

  constructor(
    private readonly reader: ActiveProductRelationshipSnapshotReader,
    private readonly commercialDataProvider: ProductRecommendationCommercialDataProvider,
    private readonly eligibilityEvaluator: ProductRecommendationEligibilityEvaluator,
    private readonly scorer: ProductRecommendationScorer,
    private readonly ranker: ProductRecommendationRanker,
    parameters: ProductRecommendationServiceParameters = DEFAULT_PRODUCT_RECOMMENDATION_SERVICE_PARAMETERS,
  ) {
    this.parameters = productRecommendationServiceParametersSchema.parse(parameters);
  }

  async recommend(request: ProductRecommendationRequest): Promise<ProductRecommendationResult> {
    const parsedRequest = productRecommendationRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new ProductRecommendationError('INVALID_RECOMMENDATION_REQUEST', 'Recommendation request is invalid');
    }
    if (parsedRequest.data.limit !== undefined && parsedRequest.data.limit > this.parameters.maximumLimit) {
      throw new ProductRecommendationError('INVALID_RECOMMENDATION_REQUEST', 'Recommendation limit exceeds maximumLimit');
    }

    const requestedLimit = parsedRequest.data.limit ?? this.parameters.defaultLimit;
    let queryResult;
    try {
      queryResult = this.reader.findBySource({
        sourceProduct: parsedRequest.data.sourceProduct,
        relationshipTypes: parsedRequest.data.relationshipTypes,
      });
    } catch (error) {
      if (error instanceof ProductRelationshipRuntimeError && error.code === 'RUNTIME_SNAPSHOT_NOT_LOADED') {
        throw new ProductRecommendationError(
          'RECOMMENDATION_KNOWLEDGE_NOT_LOADED',
          'Recommendation knowledge has not been loaded',
          { cause: error },
        );
      }
      throw error;
    }

    const deduplicated = this.deduplicate(queryResult.relationships);
    if (deduplicated.winners.length === 0) {
      const statistics = emptyStatistics(queryResult.relationships.length, 0, deduplicated.duplicates.length);
      const result: ProductRecommendationResult = {
        snapshot: cloneJsonValue(queryResult.snapshot),
        sourceIdentity: queryResult.sourceIdentity,
        recommendations: deepFreeze([]),
        rejectedCandidates: deepFreeze(deduplicated.duplicates),
        statistics,
      };
      validateStatistics(result.statistics);
      return deepFreeze(result);
    }

    const products = deduplicated.winners.map((relationship) => cloneJsonValue(relationship.targetProduct));
    const commercialData = await this.getCommercialData(products, parsedRequest.data.recommendationContext ?? {});

    const rejectedCandidates: RejectedProductRecommendationCandidate[] = [...deduplicated.duplicates];
    const scoredCandidates: ScoredProductRecommendationCandidate[] = [];

    for (const relationship of deduplicated.winners) {
      const productIdentity = createProductRuntimeIdentity(relationship.targetProduct);
      const data = commercialData.get(productIdentity);
      if (!data) {
        rejectedCandidates.push({
          product: cloneJsonValue(relationship.targetProduct),
          productIdentity,
          relationship: cloneJsonValue(relationship),
          rejectionReasons: deepFreeze([{ code: 'MISSING_COMMERCIAL_DATA' as const }]),
        });
        continue;
      }

      const eligibility = this.eligibilityEvaluator.evaluate({
        request: parsedRequest.data,
        relationship,
        commercialData: data,
      });
      if (!eligibility.eligible) {
        rejectedCandidates.push({
          product: cloneJsonValue(relationship.targetProduct),
          productIdentity,
          relationship: cloneJsonValue(relationship),
          rejectionReasons: deepFreeze(cloneJsonValue(eligibility.rejectionReasons)),
        });
        continue;
      }

      const eligibleCandidate = {
        product: cloneJsonValue(relationship.targetProduct),
        productIdentity,
        relationship: cloneJsonValue(relationship),
        commercialData: cloneJsonValue(data),
        reasons: deepFreeze(cloneJsonValue(eligibility.reasons)),
        warnings: deepFreeze(cloneJsonValue(eligibility.warnings)),
      };
      try {
        scoredCandidates.push({
          ...eligibleCandidate,
          score: deepFreeze(this.scorer.score(eligibleCandidate)),
        });
      } catch (error) {
        throw new ProductRecommendationError('RECOMMENDATION_SCORING_FAILURE', 'Recommendation scoring failed', {
          cause: error,
        });
      }
    }

    let ranked: readonly ScoredProductRecommendationCandidate[];
    try {
      ranked = this.ranker.rank(scoredCandidates);
    } catch (error) {
      throw new ProductRecommendationError('RECOMMENDATION_RANKING_FAILURE', 'Recommendation ranking failed', {
        cause: error,
      });
    }

    const recommendations: ProductRecommendation[] = ranked.slice(0, requestedLimit).map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
    const statistics: ProductRecommendationStatistics = {
      relationshipsRead: queryResult.relationships.length,
      deduplicatedCandidates: deduplicated.winners.length,
      duplicatesRemoved: deduplicated.duplicates.length,
      commercialRecordsRequested: products.length,
      eligibleCandidates: scoredCandidates.length,
      rejectedCandidates: rejectedCandidates.length,
      scoredCandidates: scoredCandidates.length,
      recommendationsReturned: recommendations.length,
    };
    validateStatistics(statistics);

    return deepFreeze({
      snapshot: cloneJsonValue(queryResult.snapshot),
      sourceIdentity: queryResult.sourceIdentity,
      recommendations: deepFreeze(recommendations),
      rejectedCandidates: deepFreeze(rejectedCandidates),
      statistics,
    });
  }

  private deduplicate(relationships: readonly CalculatedProductRelationship[]): {
    winners: CalculatedProductRelationship[];
    duplicates: RejectedProductRecommendationCandidate[];
  } {
    const byTarget = new Map<string, CalculatedProductRelationship[]>();
    for (const relationship of relationships) {
      const identity = createProductRuntimeIdentity(relationship.targetProduct);
      byTarget.set(identity, [...(byTarget.get(identity) ?? []), relationship]);
    }

    const winners: CalculatedProductRelationship[] = [];
    const duplicates: RejectedProductRecommendationCandidate[] = [];
    for (const [identity, candidates] of [...byTarget.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const sorted = [...candidates].sort(compareRelationshipsForDeduplication);
      const winner = sorted[0];
      if (!winner) continue;
      winners.push(winner);
      for (const duplicate of sorted.slice(1)) {
        duplicates.push(duplicateRejection(duplicate));
      }
      void identity;
    }

    return {
      winners,
      duplicates,
    };
  }

  private async getCommercialData(
    products: readonly { productId: string; combinationId?: string }[],
    context: ProductRecommendationRequest['recommendationContext'],
  ): Promise<ReadonlyMap<string, ProductRecommendationCommercialData>> {
    let data: ReadonlyMap<string, ProductRecommendationCommercialData>;
    try {
      data = await this.commercialDataProvider.getCommercialData(products, context ?? {});
    } catch (error) {
      throw new ProductRecommendationError('COMMERCIAL_DATA_PROVIDER_FAILURE', 'Commercial data provider failed', {
        cause: error,
      });
    }

    const validated = new Map<string, ProductRecommendationCommercialData>();
    for (const product of products) {
      const identity = createProductRuntimeIdentity(product);
      const record = data.get(identity);
      if (record === undefined) continue;
      const parsed = productRecommendationCommercialDataSchema.safeParse(record);
      if (!parsed.success || createProductRuntimeIdentity(parsed.data.product) !== identity) {
        throw new ProductRecommendationError('INVALID_COMMERCIAL_DATA', 'Commercial data is invalid', {
          details: { productIdentity: identity },
        });
      }
      validated.set(identity, cloneJsonValue(parsed.data));
    }
    return validated;
  }
}
