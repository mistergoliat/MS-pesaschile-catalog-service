import { DefaultSearchProductsV2Service, type SearchProductsV2Logger, type SearchProductsV2Service } from './application/recommendation/search-products-v2/index.js';
import type { CatalogApplicationService } from './application/catalogService.js';
import {
  DefaultCustomerAffinityEvaluator,
  DefaultCustomerAffinityScorer,
  DefaultCustomerProductAffinityProvider,
  type CustomerAffinityEvidenceProvider,
} from './domain/recommendation/customer-affinity/index.js';
import {
  DefaultPersonalizedRecommendationScorer,
  DefaultPersonalizedRecommendationService,
} from './domain/recommendation/personalized-recommendation/index.js';
import {
  DefaultCommercialProductRecommendationService,
  DefaultProductRecommendationEligibilityEvaluator,
  DefaultProductRecommendationRanker,
  DefaultProductRecommendationScorer,
} from './domain/recommendation/relationship-engine/recommendation/index.js';
import {
  DefaultActiveProductRelationshipSnapshotReader,
  DefaultProductRelationshipRuntimeIndexBuilder,
  type ActiveProductRelationshipSnapshotReader,
  type ProductRelationshipRuntimeRefreshResult,
} from './domain/recommendation/relationship-engine/runtime/index.js';
import type { ProductRelationshipSnapshotStore } from './domain/recommendation/relationship-engine/publication/index.js';
import { createCorrelationId } from './shared/crypto.js';
import { CatalogRecommendationCommercialDataProvider } from './infrastructure/recommendation/catalogRecommendationCommercialDataProvider.js';

export type RecommendationRuntime = {
  readonly relationshipSnapshotReader: ActiveProductRelationshipSnapshotReader;
  readonly searchProductsV2Service: SearchProductsV2Service;
  readonly initialRefreshResult: ProductRelationshipRuntimeRefreshResult | null;
  readonly initialRefreshError: Error | null;
};

export async function createRecommendationRuntime(input: {
  catalogService: CatalogApplicationService;
  snapshotStore: ProductRelationshipSnapshotStore;
  customerAffinityEvidenceProvider: CustomerAffinityEvidenceProvider;
  logger?: SearchProductsV2Logger;
}): Promise<RecommendationRuntime> {
  const relationshipSnapshotReader = new DefaultActiveProductRelationshipSnapshotReader(
    input.snapshotStore,
    new DefaultProductRelationshipRuntimeIndexBuilder(),
  );

  let initialRefreshResult: ProductRelationshipRuntimeRefreshResult | null = null;
  let initialRefreshError: Error | null = null;
  try {
    initialRefreshResult = await relationshipSnapshotReader.refresh();
  } catch (error) {
    initialRefreshError = error instanceof Error ? error : new Error('Relationship snapshot refresh failed');
  }

  const commercialRecommendationService = new DefaultCommercialProductRecommendationService(
    relationshipSnapshotReader,
    new CatalogRecommendationCommercialDataProvider(input.catalogService),
    new DefaultProductRecommendationEligibilityEvaluator(),
    new DefaultProductRecommendationScorer(),
    new DefaultProductRecommendationRanker(),
  );
  const catalogProductBatchReader = new CatalogRecommendationCommercialDataProvider(input.catalogService);
  const customerAffinityProvider = new DefaultCustomerProductAffinityProvider(
    input.customerAffinityEvidenceProvider,
    new DefaultCustomerAffinityEvaluator(),
    new DefaultCustomerAffinityScorer(),
  );

  return {
    relationshipSnapshotReader,
    searchProductsV2Service: new DefaultSearchProductsV2Service({
      commercialRecommendationService,
      catalogProductBatchReader,
      customerAffinityProvider,
      personalizedRecommendationService: new DefaultPersonalizedRecommendationService(new DefaultPersonalizedRecommendationScorer()),
      correlationIdProvider: {
        generate: createCorrelationId,
      },
      logger: input.logger,
    }),
    initialRefreshResult,
    initialRefreshError,
  };
}
