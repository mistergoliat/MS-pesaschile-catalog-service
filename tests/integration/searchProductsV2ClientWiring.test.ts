import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/interfaces/http/app.js';
import { CatalogApplicationService } from '../../src/application/catalogService.js';
import type {
  SearchProductsV2Request,
  SearchProductsV2Result,
  SearchProductsV2Service,
} from '../../src/application/recommendation/search-products-v2/index.js';
import { getProduct, searchProductsV2 } from '../../client/catalogClient.js';
import { createCacheStub, createPricingProviderStub, createRepositoryStub, createSearchProviderStub, createStockProviderStub } from '../support/fakes.js';
import {
  buildSearchProductsV2Harness,
  catalogSummaryFor,
} from '../fixtures/searchProductsV2Application.js';
import {
  commercialRecommendationFor,
  commercialResultFor,
} from '../fixtures/personalizedRecommendation.js';

const sourceBar = { productId: '101' } as const;
const candidateBarCollar = { productId: '123', combinationId: '456' } as const;

class RecordingSearchProductsV2Service implements SearchProductsV2Service {
  readonly calls: SearchProductsV2Request[] = [];

  constructor(private readonly delegate: SearchProductsV2Service) {}

  async search(request: SearchProductsV2Request): Promise<SearchProductsV2Result> {
    this.calls.push(JSON.parse(JSON.stringify(request)) as SearchProductsV2Request);
    return this.delegate.search(request);
  }
}

let openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.map((app) => app.close()));
  openApps = [];
});

function catalogApplicationService() {
  const repository = createRepositoryStub({
    getProductCore: async (productId: number) => ({
      productId,
      name: productId === 123 ? 'Seguro para barra olimpica' : 'Barra olimpica 20 kg',
      sku: productId === 123 ? 'COLLAR-OLY' : 'BAR-OLY-20',
      shortDescription: 'Producto comercial disponible para el agente',
      longDescription: 'Detalle comercial del producto',
      linkRewrite: productId === 123 ? 'seguro-barra-olimpica' : 'barra-olimpica-20-kg',
      active: true,
      baseWeightKg: 20,
    }),
    getVariants: async () => [
      {
        combinationId: 456,
        sku: 'COLLAR-OLY-PAR',
        label: 'Formato: Par',
        attributes: [{ group: 'Formato', value: 'Par' }],
        impactPrice: 0,
        physicalQuantity: 8,
        available: true,
        isDefault: true,
        weightImpactKg: 0.2,
      },
    ],
    getDefaultCombinationId: async () => 456,
    getStock: async () => ({ physicalQuantity: 8, shopId: 1 }),
  });

  return {
    repository,
    service: new CatalogApplicationService({
      repository,
      searchProvider: createSearchProviderStub(),
      stockProvider: createStockProviderStub({
        getStock: async () => ({ physicalQuantity: 8, available: true, shopId: 1 }),
      }),
      pricingProvider: createPricingProviderStub({
        quote: async () => ({
          quantity: 1,
          baseUnitPrice: 12990,
          effectiveUnitPrice: 9990,
          subtotal: 9990,
          currency: 'CLP',
          taxIncluded: true,
          taxMode: 'configured_rate',
          discountApplied: true,
          discountType: 'amount',
          discountValue: 3000,
          specificPriceId: 987,
          pricingMode: 'sql_specific_price',
        }),
      }),
      cache: createCacheStub(),
    }),
  };
}

async function appWithSearchProductsV2(searchProductsV2Service?: SearchProductsV2Service) {
  const catalog = catalogApplicationService();
  const app = await buildApp({
    service: catalog.service,
    searchProductsV2Service,
    repository: catalog.repository,
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
  openApps.push(app);
  const baseUrl = (await app.listen({ host: '127.0.0.1', port: 0 })) as string;
  return { app, baseUrl };
}

function searchProductsV2Service(options: { empty?: boolean } = {}) {
  const harness = buildSearchProductsV2Harness({
    commercialResult: commercialResultFor(options.empty
      ? []
      : [commercialRecommendationFor(candidateBarCollar, 1, 80)]),
    catalogProducts: [
      catalogSummaryFor(sourceBar, {
        name: 'Barra olimpica 20 kg',
        reference: 'BAR-OLY-20',
      }),
      catalogSummaryFor(candidateBarCollar, {
        name: 'Seguro para barra olimpica',
        reference: 'COLLAR-OLY',
        stock: { status: 'in_stock', quantity: 8, available: true },
      }),
    ],
  });
  return new RecordingSearchProductsV2Service(harness.service);
}

describe('SearchProducts V2 client HTTP wiring', () => {
  it.each([
    ['barra'],
    ['barra ol\u00edmpica'],
    ['barra ol\u00edmpica 20 kg'],
  ])('lets the CRM/Sales Agent continue from "%s" to product details', async (query) => {
    const recommendationService = searchProductsV2Service();
    const { baseUrl } = await appWithSearchProductsV2(recommendationService);
    const correlationId = `crm-${query.replace(/\W+/gu, '-').replace(/^-|-$/gu, '')}`;
    const context = { baseUrl, apiKey: 'test-api-key', timeoutMs: 5000, correlationId };

    const search = await searchProductsV2({
      query,
      sourceProduct: sourceBar,
      customer: { customerId: 'customer-1' },
      context: { customerId: 'customer-1', intent: 'purchase', useCase: 'sales-agent' },
      limit: 5,
      correlationId: 'body-correlation-is-not-authoritative',
    }, context);

    expect(recommendationService.calls[0]).toMatchObject({
      query,
      sourceProduct: sourceBar,
      correlationId,
    });
    expect(search.execution.correlationId).toBe(correlationId);
    expect(search.recommendations[0]?.product).toMatchObject({
      productId: '123',
      combinationId: '456',
      stock: { status: 'in_stock', quantity: 8, available: true },
    });
    // recommend_catalog_products is explicitly out of scope for weight (CAT-R1-T13B §3/§15).
    expect(search.recommendations[0]?.product).not.toHaveProperty('weightKg');

    const candidate = search.recommendations[0]!.product;
    const details = await getProduct({
      productId: Number(candidate.productId),
      combinationId: Number(candidate.combinationId),
      quantity: 1,
    }, context);

    expect(details.product.productId).toBe(123);
    expect(details.selectedVariant?.combinationId).toBe(456);
    expect(details.pricing?.effectiveUnitPrice).toBe(9990);
    expect(details.stock?.physicalQuantity).toBe(8);
    // get_product_details resolves base(20) + combination impact(0.2) via the real HTTP + client path.
    expect(details.weightKg).toBe(20.2);
  });

  it('returns a controlled empty result for a CRM term without candidates', async () => {
    const { baseUrl } = await appWithSearchProductsV2(searchProductsV2Service({ empty: true }));

    const search = await searchProductsV2({
      query: 'termino sin resultados',
      sourceProduct: sourceBar,
      customer: { customerId: 'customer-1' },
      limit: 5,
    }, {
      baseUrl,
      apiKey: 'test-api-key',
      correlationId: 'crm-empty-result',
    });

    expect(search.recommendations).toEqual([]);
    expect(search.warnings.map((warning) => warning.code)).toContain('NO_COMMERCIAL_CANDIDATES');
    expect(search.execution.correlationId).toBe('crm-empty-result');
  });

  it('surfaces Catalog Service unavailable as a controlled technical error', async () => {
    const { baseUrl } = await appWithSearchProductsV2(undefined);

    await expect(searchProductsV2({
      query: 'barra olimpica 20 kg',
      sourceProduct: sourceBar,
      customer: { customerId: 'customer-1' },
      limit: 5,
    }, {
      baseUrl,
      apiKey: 'test-api-key',
      correlationId: 'crm-catalog-down',
    })).rejects.toMatchObject({
      name: 'CatalogClientError',
      statusCode: 503,
      code: 'COMMERCIAL_RECOMMENDATION_UNAVAILABLE',
      correlationId: 'crm-catalog-down',
      retryable: true,
    });
  });
});
