import client from 'prom-client';

client.collectDefaultMetrics({ prefix: 'catalog_' });

export const httpRequestsTotal = new client.Counter({
  name: 'catalog_http_requests_total',
  help: 'Total HTTP requests handled by the catalog service',
  labelNames: ['method', 'route', 'status'] as const,
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'catalog_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export const dbQueryDurationSeconds = new client.Histogram({
  name: 'catalog_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
});

export const cacheHitsTotal = new client.Counter({
  name: 'catalog_cache_hits_total',
  help: 'Cache hits',
  labelNames: ['area'] as const,
});

export const cacheMissesTotal = new client.Counter({
  name: 'catalog_cache_misses_total',
  help: 'Cache misses',
  labelNames: ['area'] as const,
});

export const priceResolutionTotal = new client.Counter({
  name: 'catalog_price_resolution_total',
  help: 'Price resolution attempts',
  labelNames: ['result'] as const,
});

export const errorsTotal = new client.Counter({
  name: 'catalog_errors_total',
  help: 'Catalog errors',
  labelNames: ['code'] as const,
});

export async function metricsText(): Promise<string> {
  return client.register.metrics();
}
