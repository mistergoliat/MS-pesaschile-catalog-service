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
import { MySqlCatalogRepository } from '../../src/infrastructure/repositories/mysqlCatalogRepository.js';
import { MySqlSearchProvider } from '../../src/infrastructure/search/mysqlSearchProvider.js';
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

// Matches the mandatory `pl.name LIKE ?` wildcard terms actually built for each query against
// the fixture's real product name, instead of hard-coding a call count/order. This exercises
// the same repository code the A11.2-B fix touches (getSearchCandidates' fallback predicate)
// regardless of how many query variants the product-intent layer's own unit normalization fans
// out into (e.g. "20 kg" and "20kg" as separate search terms).
function nameOnlyFallbackPool(row: Record<string, unknown>) {
  const nameLower = String(row.productName).toLowerCase();
  return {
    async query(options: { sql: string; values: readonly unknown[] }) {
      const wildcardTerms = options.values
        .filter((value): value is string => typeof value === 'string' && value.startsWith('%') && value.endsWith('%'))
        .map((value) => value.slice(1, -1));
      const matches = wildcardTerms.length > 0 && wildcardTerms.every((term) => nameLower.includes(term));
      return [matches ? [row] : [], undefined];
    },
  };
}

function searchRow(overrides: Record<string, unknown> = {}) {
  return {
    productId: 900,
    combinationId: 0,
    productSku: 'DISC-OLY-20',
    combinationSku: null,
    productName: 'Par Discos Olimpicos Grip Rubber 20kg | PROmachine',
    shortDescription: 'Par discos olimpicos de goma para barra',
    longDescription: null,
    variantLabel: null,
    physicalQuantity: 8,
    hasVariants: 0,
    isDefault: 0,
    active: 1,
    ...overrides,
  };
}

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
      linkRewrite: 'barra-olimpica-15-kg',
      active: true,
      baseWeightKg: 15,
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
            linkRewrite: 'barra-olimpica-15-kg',
            hasCombinations: false,
            variantAttributeLabels: [],
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

describe('Product Intent stopword retrieval fix (A11.2-B)', () => {
  function productIntentRuntimeWithRealRetrieval(row: Record<string, unknown>) {
    const pool = nameOnlyFallbackPool(row);
    const repository = new MySqlCatalogRepository(pool as never);
    const service = new CatalogApplicationService({
      repository,
      searchProvider: new MySqlSearchProvider(repository),
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
              name: 'Par Discos Olimpicos Grip Rubber 20kg | PROmachine',
              productReference: 'DISC-OLY-20',
              combinationReference: null,
              description: 'Par discos olimpicos de goma para barra',
              category: 'Discos',
              linkRewrite: 'par-discos-olimpicos-20kg',
              hasCombinations: false,
              variantAttributeLabels: [],
              active: true,
              availableForOrder: true,
              productBasePriceNet: 39990,
              combinationImpactNet: 0,
              stockQuantity: 8,
            })),
            specificPrices: [],
          };
        },
      },
      clock: { now: () => new Date('2026-08-24T12:00:00.000Z') },
    });
    const provider = new CatalogProductIntentProvider(service, commercialTruthService);
    const productIntentResolutionService = new DefaultProductIntentResolutionService({
      normalizer: new DefaultProductQueryNormalizer(),
      synonymProvider: new StaticProductSearchSynonymProvider(),
      constraintExtractor: new DefaultProductExplicitConstraintExtractor(),
      searcher: provider,
      catalogReader: provider,
      ranker: new DefaultProductIntentCandidateRanker(),
      resolutionPolicy: new DefaultProductIntentResolutionPolicy(),
      clarificationBuilder: new DefaultProductClarificationBuilder(),
      correlationIdProvider: { generate: () => 'corr-a11-2-b' },
    });
    return { productIntentResolutionService };
  }

  it('SEARCH-T12: "discos olimpicos de 20kg" is no longer a no_match caused by retrieval', async () => {
    // The real name has no "de", so this only recovers a candidate if the fallback's mandatory
    // AND no longer requires "de" as a token.
    const { productIntentResolutionService } = productIntentRuntimeWithRealRetrieval(searchRow());

    const result = await productIntentResolutionService.resolve({
      query: 'discos olimpicos de 20kg',
      filters: { inStockOnly: true },
      limit: 5,
    });

    expect(result.resolution.status).not.toBe('no_match');
    expect(result.candidates.some((candidate) => candidate.product.productId === '900')).toBe(true);
  });

  it('SEARCH-T12b: "disco olimpico de 20kg" (singular) is no longer a no_match caused by retrieval', async () => {
    const { productIntentResolutionService } = productIntentRuntimeWithRealRetrieval(searchRow());

    const result = await productIntentResolutionService.resolve({
      query: 'disco olimpico de 20kg',
      filters: { inStockOnly: true },
      limit: 5,
    });

    expect(result.resolution.status).not.toBe('no_match');
    expect(result.candidates.some((candidate) => candidate.product.productId === '900')).toBe(true);
  });
});
