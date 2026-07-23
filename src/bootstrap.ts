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
import {
  DefaultProductClarificationBuilder,
  DefaultProductIntentCandidateRanker,
  DefaultProductIntentResolutionPolicy,
  DefaultProductIntentResolutionService,
  DefaultProductQueryNormalizer,
  StaticProductSearchSynonymProvider,
} from './application/catalog/product-intent/index.js';
import { CatalogProductIntentProvider } from './infrastructure/catalog/catalogProductIntentProvider.js';
import { FileProductRelationshipSnapshotStore } from './infrastructure/recommendation/fileProductRelationshipSnapshotStore.js';
import {
  EmptyCustomerAffinityEvidenceProvider,
  UnavailableCustomerAffinityEvidenceProvider,
} from './infrastructure/recommendation/customerAffinityEvidenceProviders.js';
import { createRecommendationRuntime } from './recommendationRuntime.js';
import { logger } from './shared/logger.js';
import { createCorrelationId } from './shared/crypto.js';

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
  const customerAffinityEvidenceProvider = config.recommendation.customerAffinityProviderMode === 'empty'
    ? new EmptyCustomerAffinityEvidenceProvider()
    : new UnavailableCustomerAffinityEvidenceProvider();
  const productIntentCatalogProvider = new CatalogProductIntentProvider(service);
  const productIntentResolutionService = new DefaultProductIntentResolutionService({
    normalizer: new DefaultProductQueryNormalizer(),
    synonymProvider: new StaticProductSearchSynonymProvider(),
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
    catalogService: service,
    snapshotStore: new FileProductRelationshipSnapshotStore(config.recommendation.relationshipSnapshotDir),
    customerAffinityEvidenceProvider,
    logger: {
      info: (event, fields) => logger.info({ event, ...fields }, event),
      error: (event, fields) => logger.error({ event, ...fields }, event),
    },
  });
  if (recommendationRuntime.initialRefreshError) {
    logger.warn(
      { error: recommendationRuntime.initialRefreshError },
      'Relationship snapshot could not be loaded at startup',
    );
  }

  return {
    pool,
    cache,
    repository,
    service,
    productIntentResolutionService,
    relationshipSnapshotReader: recommendationRuntime.relationshipSnapshotReader,
    searchProductsV2Service: recommendationRuntime.searchProductsV2Service,
    relationshipSnapshotInitialRefresh: recommendationRuntime.initialRefreshResult,
    relationshipSnapshotInitialRefreshError: recommendationRuntime.initialRefreshError,
  };
}
