import { config } from './shared/config.js';
import { logger } from './shared/logger.js';
import { buildApp } from './interfaces/http/app.js';
import { createRuntime } from './bootstrap.js';
import { collectRuntimeReadinessChecks } from './shared/readiness.js';

const runtime = await createRuntime();

const app = await buildApp({
  service: runtime.service,
  exploreProductsService: runtime.exploreProductsService,
  productIntentResolutionService: runtime.productIntentResolutionService,
  searchProductsV2Service: runtime.searchProductsV2Service,
  repository: runtime.repository,
  readyCheck: () => collectRuntimeReadinessChecks({
    repository: runtime.repository,
    cache: runtime.cache,
    cacheDriver: config.cache.driver,
    relationshipSnapshotReader: runtime.relationshipSnapshotReader,
  }),
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down catalog service');
  await app.close();
  if ('close' in runtime.cache && typeof runtime.cache.close === 'function') {
    await runtime.cache.close();
  }
  await runtime.pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

try {
  await app.listen({ host: config.host, port: config.port });
  logger.info({ host: config.host, port: config.port }, 'Catalog service started');
} catch (error) {
  logger.error({ error }, 'Failed to start catalog service');
  process.exit(1);
}
