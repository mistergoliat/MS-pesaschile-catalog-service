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

export const recommendationEnrichmentCandidatesTotal = new client.Counter({
  name: 'catalog_recommendation_enrichment_candidates_total',
  help: 'Recommendation candidates requested for catalog enrichment',
});

export const recommendationEnrichmentMissingTotal = new client.Counter({
  name: 'catalog_recommendation_enrichment_missing_total',
  help: 'Recommendation candidates missing from catalog enrichment',
});

export const recommendationEnrichmentInactiveTotal = new client.Counter({
  name: 'catalog_recommendation_enrichment_inactive_total',
  help: 'Recommendation candidates discarded because the catalog product is inactive',
});

export const recommendationEnrichmentOutOfStockTotal = new client.Counter({
  name: 'catalog_recommendation_enrichment_out_of_stock_total',
  help: 'Recommendation candidates discarded by in-stock filtering',
});

export const recommendationEnrichmentReturnedTotal = new client.Counter({
  name: 'catalog_recommendation_enrichment_returned_total',
  help: 'Enriched recommendations returned',
});

export const productIntentRequestsTotal = new client.Counter({
  name: 'catalog_product_intent_requests_total',
  help: 'Product intent resolution requests',
});

export const productIntentResolvedTotal = new client.Counter({
  name: 'catalog_product_intent_resolved_total',
  help: 'Product intent requests resolved to a source product',
});

export const productIntentClarificationTotal = new client.Counter({
  name: 'catalog_product_intent_clarification_total',
  help: 'Product intent requests that require structured clarification',
});

export const productIntentNoMatchTotal = new client.Counter({
  name: 'catalog_product_intent_no_match_total',
  help: 'Product intent requests without a plausible catalog match',
});

export const productIntentCandidatesRetrieved = new client.Histogram({
  name: 'catalog_product_intent_candidates_retrieved',
  help: 'Product intent catalog candidates retrieved',
  buckets: [0, 1, 2, 5, 10, 20, 50],
});

export const productIntentResolutionDuration = new client.Histogram({
  name: 'catalog_product_intent_resolution_duration_seconds',
  help: 'Product intent resolution duration',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export const errorsTotal = new client.Counter({
  name: 'catalog_errors_total',
  help: 'Catalog errors',
  labelNames: ['code'] as const,
});

export async function metricsText(): Promise<string> {
  return client.register.metrics();
}
