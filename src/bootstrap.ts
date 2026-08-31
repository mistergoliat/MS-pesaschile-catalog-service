import RedisJs from 'ioredis';
import { config } from './shared/config.js';
import { createPool } from './infrastructure/database/pool.js';
import { MemoryCacheProvider } from './infrastructure/cache/memory.js';
import { RedisCacheProvider } from './infrastructure/cache/redis.js';
import { MySqlCatalogRepository } from './infrastructure/repositories/mysqlCatalogRepository.js';
import { MySqlSearchProvider } from './infrastructure/search/mysqlSearchProvider.js';
import { SqlPricingProvider } from './infrastructure/pricing/sqlPricingProvider.js';
import { PrestaShopPhysicalStockProvider } from './infrastructure/stock/prestashopPhysicalStockProvider.js';
import { CatalogApplicationService } from './application/catalogService.js';
import { CatalogCommercialTruthService } from './domain/catalog/commercial-truth/index.js';
import { DefaultExploreProductsService } from './application/catalog/explore-products/index.js';
import {
  DefaultProductClarificationBuilder,
  DefaultProductExplicitConstraintExtractor,
  DefaultProductIntentCandidateRanker,
  DefaultProductIntentResolutionPolicy,
  DefaultProductIntentResolutionService,
  DefaultProductQueryNormalizer,
  StaticProductSearchSynonymProvider,
} from './application/catalog/product-intent/index.js';
import { CatalogProductIntentProvider } from './infrastructure/catalog/catalogProductIntentProvider.js';
import { MySqlCatalogCommercialDataReader } from './infrastructure/catalog/mysqlCatalogCommercialDataReader.js';
import { MySqlCatalogExploreDataReader } from './infrastructure/catalog/mysqlCatalogExploreDataReader.js';
import { FileProductRelationshipSnapshotStore } from './infrastructure/recommendation/fileProductRelationshipSnapshotStore.js';
import {
  EmptyCustomerAffinityEvidenceProvider,
  UnavailableCustomerAffinityEvidenceProvider,
} from './infrastructure/recommendation/customerAffinityEvidenceProviders.js';
import {
  HttpCustomerAffinityEvidenceProvider,
  type HttpCustomerAffinityEvidenceProviderLogger,
} from './infrastructure/recommendation/httpCustomerAffinityEvidenceProvider.js';
import type { CustomerAffinityEvidenceProvider } from './domain/recommendation/customer-affinity/index.js';
import { createRecommendationRuntime } from './recommendationRuntime.js';
import { logger } from './shared/logger.js';
import { createCorrelationId } from './shared/crypto.js';
import { resolveProductSemanticSnapshotDir } from './shared/productSemanticSnapshotConfig.js';
import { FileProductSemanticSnapshotStore } from './infrastructure/product-semantic/fileProductSemanticSnapshotStore.js';
import {
  DefaultActiveProductSemanticSnapshotReader,
  DefaultProductSemanticRuntimeIndexBuilder,
} from './domain/product-semantic-snapshot/runtime/index.js';

export function createCustomerAffinityEvidenceProvider(
  mode: typeof config.recommendation.customerAffinityProviderMode,
  deps: {
    customerProfile: { baseUrl: string | null; timeoutMs: number };
    logger: HttpCustomerAffinityEvidenceProviderLogger;
  },
): CustomerAffinityEvidenceProvider {
  if (mode === 'empty') {
    return new EmptyCustomerAffinityEvidenceProvider();
  }
  if (mode === 'http') {
    const baseUrl = deps.customerProfile.baseUrl;
    if (!baseUrl) {
      // Defensive: config.ts already fails at startup when mode=http and the base URL is missing.
      throw new Error('CUSTOMER_PROFILE_BASE_URL must be configured when CUSTOMER_AFFINITY_PROVIDER_MODE=http');
    }
    return new HttpCustomerAffinityEvidenceProvider({
      baseUrl,
      timeoutMs: deps.customerProfile.timeoutMs,
      logger: deps.logger,
    });
  }
  return new UnavailableCustomerAffinityEvidenceProvider();
}

export async function createRuntime() {
  const pool = createPool();
  const repository = new MySqlCatalogRepository(pool);
  type RedisLike = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: 'EX', ttl: number): Promise<'OK'>;
    del(key: string): Promise<number>;
    ping(): Promise<string>;
    quit(): Promise<string>;
  };
  const Redis = RedisJs as unknown as new (url: string) => RedisLike;
  const cache =
    config.cache.driver === 'redis'
      ? new RedisCacheProvider(new Redis(config.cache.redisUrl as string))
      : new MemoryCacheProvider();
  const searchProvider = new MySqlSearchProvider(repository);
  const pricingProvider = new SqlPricingProvider(repository);
  const stockProvider = new PrestaShopPhysicalStockProvider(repository);
  const service = new CatalogApplicationService({
    repository,
    searchProvider,
    stockProvider,
    pricingProvider,
    cache,
  });
  const catalogCommercialTruthService = new CatalogCommercialTruthService({
    dataReader: new MySqlCatalogCommercialDataReader(pool),
    publicBaseUrl: config.catalog.publicBaseUrl,
    logger: {
      warn: (event, fields) => logger.warn({ event, ...fields }, event),
    },
  });
  const exploreProductsService = new DefaultExploreProductsService({
    dataReader: new MySqlCatalogExploreDataReader(pool),
  });
  const customerAffinityEvidenceProvider = createCustomerAffinityEvidenceProvider(
    config.recommendation.customerAffinityProviderMode,
    {
      customerProfile: config.recommendation.customerProfile,
      logger: {
        info: (event, fields) => logger.info({ event, ...fields }, event),
        error: (event, fields) => logger.error({ event, ...fields }, event),
      },
    },
  );
  const productIntentCatalogProvider = new CatalogProductIntentProvider(service, catalogCommercialTruthService);
  const productIntentResolutionService = new DefaultProductIntentResolutionService({
    normalizer: new DefaultProductQueryNormalizer(),
    synonymProvider: new StaticProductSearchSynonymProvider(),
    constraintExtractor: new DefaultProductExplicitConstraintExtractor(),
    searcher: productIntentCatalogProvider,
    catalogReader: productIntentCatalogProvider,
    ranker: new DefaultProductIntentCandidateRanker(),
    resolutionPolicy: new DefaultProductIntentResolutionPolicy(),
    clarificationBuilder: new DefaultProductClarificationBuilder(),
    correlationIdProvider: {
      generate: createCorrelationId,
    },
    logger: {
      info: (event, fields) => logger.info({ event, ...fields }, event),
      error: (event, fields) => logger.error({ event, ...fields }, event),
    },
  });
  const recommendationRuntime = await createRecommendationRuntime({
    catalogCommercialTruthService,
    snapshotStore: new FileProductRelationshipSnapshotStore(config.recommendation.relationshipSnapshotDir),
    customerAffinityEvidenceProvider,
    logger: {
      info: (event, fields) => logger.info({ event, ...fields }, event),
      error: (event, fields) => logger.error({ event, ...fields }, event),
    },
  });

  // Product semantics is a degradable inspection branch (CATALOG-INTELLIGENCE
  // A00.5.1): a missing/unloaded snapshot must not fail catalog service boot
  // or readiness, only make the semantics endpoint report 503.
  const productSemanticSnapshotReader = new DefaultActiveProductSemanticSnapshotReader(
    new FileProductSemanticSnapshotStore(resolveProductSemanticSnapshotDir()),
    new DefaultProductSemanticRuntimeIndexBuilder(),
  );
  try {
    await productSemanticSnapshotReader.refresh();
    const activeSnapshot = productSemanticSnapshotReader.getActiveSnapshotMetadata();
    if (activeSnapshot) {
      logger.info({ snapshotId: activeSnapshot.snapshotId, recordCount: activeSnapshot.recordCount }, 'product_semantic_snapshot_loaded');
    } else {
      logger.warn({}, 'product_semantic_snapshot_not_available');
    }
  } catch (error) {
    logger.error({ error }, 'product_semantic_snapshot_load_failed');
  }

  return {
    pool,
    cache,
    repository,
    service,
    exploreProductsService,
    productIntentResolutionService,
    relationshipSnapshotReader: recommendationRuntime.relationshipSnapshotReader,
    searchProductsV2Service: recommendationRuntime.searchProductsV2Service,
    relationshipSnapshotInitialRefresh: recommendationRuntime.initialRefreshResult,
    relationshipSnapshotInitialRefreshError: recommendationRuntime.initialRefreshError,
    productSemanticSnapshotReader,
  };
}
