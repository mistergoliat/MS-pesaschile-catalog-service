import { describe, expect, it, vi } from 'vitest';
import { CatalogApplicationService } from '../../src/application/catalogService.js';
import {
  DefaultProductClarificationBuilder,
  DefaultProductExplicitConstraintExtractor,
  DefaultProductIntentCandidateRanker,
  DefaultProductIntentResolutionPolicy,
  DefaultProductIntentResolutionService,
  DefaultProductQueryNormalizer,
  StaticProductSearchSynonymProvider,
} from '../../src/application/catalog/product-intent/index.js';
import { CatalogProductIntentProvider } from '../../src/infrastructure/catalog/catalogProductIntentProvider.js';
import { buildApp } from '../../src/interfaces/http/app.js';
import type { SearchItem } from '../../src/domain/catalog/types.js';
import { CatalogCommercialTruthService } from '../../src/domain/catalog/commercial-truth/index.js';
import {
  createCacheStub,
  createPricingProviderStub,
  createRepositoryStub,
  createSearchProviderStub,
  createStockProviderStub,
} from '../support/fakes.js';

function productIntentRuntime() {
  const searchItems: SearchItem[] = [
    {
      productId: 29,
      combinationId: 0,
      sku: 'BAR-15',
      name: 'Barra olimpica 15 kg',
      variantLabel: null,
      shortDescription: 'Barra recta para sentadillas',
      physicalQuantity: 8,
      available: true,
      matchType: 'partial_name',
    },
  ];
  const repository = createRepositoryStub({
    getProductCore: vi.fn(async (productId: number) => ({
      productId,
      name: 'Barra olimpica 15 kg',
      sku: 'BAR-15',
      shortDescription: 'Barra recta para sentadillas',
      longDescription: null,
      active: true,
    })),
  });
  const service = new CatalogApplicationService({
    repository,
    searchProvider: createSearchProviderStub({
      search: vi.fn(async () => searchItems),
    }),
    stockProvider: createStockProviderStub(),
    pricingProvider: createPricingProviderStub(),
    cache: createCacheStub(),
  });
  const commercialTruthService = new CatalogCommercialTruthService({
    dataReader: {
      async read(input) {
        return {
          products: input.products.map((product) => ({
            productId: Number(product.productId),
            combinationId: product.combinationId === undefined ? 0 : Number(product.combinationId),
            name: 'Barra olimpica 15 kg',
            productReference: 'BAR-15',
            combinationReference: null,
            description: 'Barra recta para sentadillas',
            category: 'Barras',
            active: true,
            availableForOrder: true,
            productBasePriceNet: 1000,
            combinationImpactNet: 0,
            stockQuantity: 8,
          })),
          specificPrices: [],
        };
      },
    },
    clock: { now: () => new Date('2026-07-23T12:00:00.000Z') },
  });
  const provider = new CatalogProductIntentProvider(service, commercialTruthService);
  return {
    repository,
    service,
    productIntentResolutionService: new DefaultProductIntentResolutionService({
      normalizer: new DefaultProductQueryNormalizer(),
      synonymProvider: new StaticProductSearchSynonymProvider(),
      constraintExtractor: new DefaultProductExplicitConstraintExtractor(),
      searcher: provider,
      catalogReader: provider,
      ranker: new DefaultProductIntentCandidateRanker(),
      resolutionPolicy: new DefaultProductIntentResolutionPolicy(),
      clarificationBuilder: new DefaultProductClarificationBuilder(),
      correlationIdProvider: { generate: () => 'corr-runtime' },
    }),
  };
}

describe('Product Intent runtime wiring', () => {
  it('wires catalog search and batch enrichment without relationship runtime', async () => {
    const runtime = productIntentRuntime();
    const result = await runtime.productIntentResolutionService.resolve({
      query: 'barra olimpica 15 kg',
      filters: { inStockOnly: true },
      limit: 5,
    });
    expect(result.resolution.status).toBe('resolved');
    expect(result.resolution.sourceProduct).toEqual({ productId: '29' });
    expect(result.candidates[0]?.product.name).toBe('Barra olimpica 15 kg');
  });

  it('HTTP endpoint is registered in an app with the runtime service', async () => {
    const runtime = productIntentRuntime();
    const app = await buildApp({
      service: runtime.service,
      productIntentResolutionService: runtime.productIntentResolutionService,
      repository: runtime.repository,
      readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/catalog/resolve-product-intent',
      headers: { 'x-api-key': 'test-api-key', 'x-correlation-id': 'intent-runtime' },
      payload: {
        query: 'barra olimpica 15 kg',
        filters: { inStockOnly: true },
        limit: 5,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().resolution.sourceProduct).toEqual({ productId: '29' });
    await app.close();
  }, 15000);

  it('does not require a relationship snapshot for readiness', async () => {
    const runtime = productIntentRuntime();
    const app = await buildApp({
      service: runtime.service,
      productIntentResolutionService: runtime.productIntentResolutionService,
      repository: runtime.repository,
      readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
