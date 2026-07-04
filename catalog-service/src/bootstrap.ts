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

  return {
    pool,
    cache,
    repository,
    service,
  };
}
