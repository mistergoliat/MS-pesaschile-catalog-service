import { config } from './shared/config.js';
import { logger } from './shared/logger.js';
import { buildApp } from './interfaces/http/app.js';
import { createRuntime } from './bootstrap.js';

const runtime = await createRuntime();

const app = await buildApp({
  service: runtime.service,
  repository: runtime.repository,
  readyCheck: async () => {
    try {
      await runtime.repository.ping();
      const redis =
        config.cache.driver === 'redis'
          ? (await runtime.cache.ping() ? 'ok' : 'unavailable')
          : 'ok';
      return { database: 'ok', redis };
    } catch {
      return { database: 'unavailable', redis: config.cache.driver === 'redis' ? 'unavailable' : 'ok' };
    }
  },
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
