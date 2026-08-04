import { describe, expect, it } from 'vitest';
import {
  DefaultCustomerAffinityEvaluator,
  DefaultCustomerAffinityScorer,
  DefaultCustomerProductAffinityProvider,
} from '../../src/domain/recommendation/customer-affinity/index.js';
import { HttpCustomerAffinityEvidenceProvider } from '../../src/infrastructure/recommendation/httpCustomerAffinityEvidenceProvider.js';
import { DefaultSearchProductsV2Service } from '../../src/application/recommendation/search-products-v2/index.js';
import type { SearchProductsV2Request } from '../../src/application/recommendation/search-products-v2/index.js';
import {
  FakeCatalogProductBatchReader,
  FakeCommercialRecommendationService,
  FakeCorrelationIdProvider,
  FakePersonalizedRecommendationService,
  FakeSearchProductsV2Logger,
  catalogSummaryFor,
} from '../fixtures/searchProductsV2Application.js';
import { commercialRecommendationFor, commercialResultFor, sourceProduct } from '../fixtures/personalizedRecommendation.js';

const numericCustomer = { customerId: '3003' } as const;
const candidateOne = { productId: '301' } as const;
const candidateTwo = { productId: '302' } as const;

function purchasedProductsBody(rows: unknown[]) {
  return {
    status: 'available',
    products: rows,
    pagination: { limit: 100, offset: 0, returned: rows.length, hasMore: false },
  };
}

function row(overrides: Partial<{ productId: number; orderCount: number; firstPurchasedAt: string; lastPurchasedAt: string }> = {}) {
  return {
    productId: 301,
    productAttributeId: 0,
    productName: 'Disco olimpico 20kg',
    productReference: 'DISC20',
    totalQuantityPurchased: 3,
    orderCount: 3,
    firstPurchasedAt: '2026-01-02T10:00:00.000Z',
    lastPurchasedAt: '2026-01-05T12:30:00.000Z',
    totalSpentTaxIncl: '19990.000000',
    catalogStatus: 'linked' as const,
    ...overrides,
  };
}

function fetchImplFor(status: number, body: unknown): typeof fetch {
  return (async () => ({ status, json: async () => body }) as unknown as Response) as unknown as typeof fetch;
}

function buildHarness(fetchImpl: typeof fetch, timeoutMs = 2500) {
  const commercial = new FakeCommercialRecommendationService(
    commercialResultFor([commercialRecommendationFor(candidateOne, 1, 80), commercialRecommendationFor(candidateTwo, 2, 70)]),
  );
  const evidenceProvider = new HttpCustomerAffinityEvidenceProvider({
    baseUrl: 'http://customer-profile.internal:4020',
    timeoutMs,
    fetchImpl,
  });
  const affinity = new DefaultCustomerProductAffinityProvider(
    evidenceProvider,
    new DefaultCustomerAffinityEvaluator(),
    new DefaultCustomerAffinityScorer(),
  );
  const personalization = new FakePersonalizedRecommendationService();
  const catalog = new FakeCatalogProductBatchReader([
    catalogSummaryFor(sourceProduct),
    catalogSummaryFor(candidateOne),
    catalogSummaryFor(candidateTwo),
  ]);
  const correlation = new FakeCorrelationIdProvider();
  const logger = new FakeSearchProductsV2Logger();
  const service = new DefaultSearchProductsV2Service({
    commercialRecommendationService: commercial,
    catalogProductBatchReader: catalog,
    customerAffinityProvider: affinity,
    personalizedRecommendationService: personalization,
    correlationIdProvider: correlation,
    logger,
  });
  return { service };
}

function request(overrides: Partial<SearchProductsV2Request> = {}): SearchProductsV2Request {
  return {
    query: 'test wiring',
    sourceProduct,
    customer: numericCustomer,
    limit: 3,
    correlationId: 'corr-http-wiring',
    ...overrides,
  };
}

describe('SearchProducts V2 wired end-to-end to the real HttpCustomerAffinityEvidenceProvider', () => {
  it('ownership positivo: surfaces ownership for a purchased candidate without changing ranking or inferring repurchase intent', async () => {
    const { service } = buildHarness(fetchImplFor(200, purchasedProductsBody([row({ productId: 301 })])));
    const result = await service.search(request());

    const purchased = result.recommendations.find((item) => item.product.productId === '301');
    expect(purchased?.ownership).toEqual({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: false,
      totalOrderCount: 3,
      firstPurchasedAt: '2026-01-02T10:00:00.000Z',
      lastPurchasedAt: '2026-01-05T12:30:00.000Z',
    });
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['301', '302']);
    expect(result.personalization).toEqual({ applied: true, customerId: numericCustomer.customerId });
    expect(result.recommendations.some((item) => item.reasons.some((reason) => reason.code === 'EXPLICIT_REPURCHASE_INTENT'))).toBe(false);
    expect(result.execution.degraded).toBe(false);
    expect(result.execution.stages.customerAffinity).toBe('completed');
  });

  it('parcial: only the purchased candidate carries ownership, the other does not, PARTIAL_CUSTOMER_HISTORY is reported, ranking preserved', async () => {
    const { service } = buildHarness(fetchImplFor(200, purchasedProductsBody([row({ productId: 301 })])));
    const result = await service.search(request());

    const purchased = result.recommendations.find((item) => item.product.productId === '301');
    const notPurchased = result.recommendations.find((item) => item.product.productId === '302');
    expect(purchased?.ownership?.previouslyPurchased).toBe(true);
    expect(notPurchased?.ownership).toBeUndefined();
    expect(result.warnings.some((item) => item.code === 'PARTIAL_CUSTOMER_HISTORY')).toBe(true);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['301', '302']);
  });

  it('historial vacío: reports NO_CUSTOMER_HISTORY, applied:false/no_customer_history, not degraded', async () => {
    const { service } = buildHarness(fetchImplFor(200, purchasedProductsBody([])));
    const result = await service.search(request());

    expect(result.warnings.some((item) => item.code === 'NO_CUSTOMER_HISTORY')).toBe(true);
    expect(result.personalization).toEqual({ applied: false, reason: 'no_customer_history', customerId: numericCustomer.customerId });
    expect(result.execution.degraded).toBe(false);
  });

  it('no link: reports CUSTOMER_HISTORY_NOT_LINKED, applied:false/customer_history_not_linked, not degraded', async () => {
    const { service } = buildHarness(fetchImplFor(404, { status: 'customer_not_linked' }));
    const result = await service.search(request());

    expect(result.warnings.some((item) => item.code === 'CUSTOMER_HISTORY_NOT_LINKED')).toBe(true);
    expect(result.personalization).toEqual({
      applied: false,
      reason: 'customer_history_not_linked',
      customerId: numericCustomer.customerId,
    });
    expect(result.execution.degraded).toBe(false);
    expect(result.execution.stages.customerAffinity).toBe('completed');
  });

  it('not found: reports CUSTOMER_REFERENCE_NOT_FOUND, applied:false/customer_reference_not_found, not degraded', async () => {
    const { service } = buildHarness(fetchImplFor(404, { status: 'customer_not_found' }));
    const result = await service.search(request());

    expect(result.warnings.some((item) => item.code === 'CUSTOMER_REFERENCE_NOT_FOUND')).toBe(true);
    expect(result.personalization).toEqual({
      applied: false,
      reason: 'customer_reference_not_found',
      customerId: numericCustomer.customerId,
    });
    expect(result.execution.degraded).toBe(false);
    expect(result.execution.stages.customerAffinity).toBe('completed');
  });

  it('technical failure: a Customer Profile outage degrades affinity but preserves commercial ranking', async () => {
    const { service } = buildHarness(fetchImplFor(503, { status: 'degraded', reason: 'prestashop_unavailable' }));
    const result = await service.search(request());

    expect(result.execution.degraded).toBe(true);
    expect(result.execution.stages.customerAffinity).toBe('degraded');
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['301', '302']);
    expect(result.recommendations.every((item) => item.ownership === undefined)).toBe(true);
    expect(result.personalization).toEqual({
      applied: false,
      reason: 'customer_affinity_unavailable',
      customerId: numericCustomer.customerId,
    });
  });

  it('timeout during body parsing: degrades affinity but preserves commercial ranking, same as any other technical failure', async () => {
    const hangingFetch: typeof fetch = (async (_input: URL | string, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }) as unknown as typeof fetch;
    const { service } = buildHarness(hangingFetch, 30);
    const result = await service.search(request());

    expect(result.execution.degraded).toBe(true);
    expect(result.execution.stages.customerAffinity).toBe('degraded');
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['301', '302']);
    expect(result.recommendations.every((item) => item.ownership === undefined)).toBe(true);
  });

  it('pagination inconsistent (hasMore=true, incomplete page): degrades affinity but preserves commercial ranking, no partial ownership', async () => {
    const { service } = buildHarness(
      fetchImplFor(200, {
        status: 'available',
        products: [row({ productId: 301 })],
        pagination: { limit: 100, offset: 0, returned: 1, hasMore: true },
      }),
    );
    const result = await service.search(request());

    expect(result.execution.degraded).toBe(true);
    expect(result.execution.stages.customerAffinity).toBe('degraded');
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
    expect(result.recommendations.map((item) => item.product.productId)).toEqual(['301', '302']);
    expect(result.recommendations.every((item) => item.ownership === undefined)).toBe(true);
  });
});
