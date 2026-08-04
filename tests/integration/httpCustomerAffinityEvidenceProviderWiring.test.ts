import { describe, expect, it } from 'vitest';
import {
  DefaultCustomerAffinityEvaluator,
  DefaultCustomerAffinityScorer,
  DefaultCustomerProductAffinityProvider,
  CustomerAffinityError,
} from '../../src/domain/recommendation/customer-affinity/index.js';
import { HttpCustomerAffinityEvidenceProvider } from '../../src/infrastructure/recommendation/httpCustomerAffinityEvidenceProvider.js';
import type { CustomerProductAffinityRequest } from '../../src/domain/recommendation/customer-affinity/index.js';

const customer = { customerId: '2002' } as const;
const productA = { productId: '11' } as const;
const productB = { productId: '22' } as const;

function purchasedProductsBody(rows: unknown[]) {
  return {
    status: 'available',
    products: rows,
    pagination: { limit: 100, offset: 0, returned: rows.length, hasMore: false },
  };
}

function row(overrides: Partial<{
  productId: number;
  productAttributeId: number;
  orderCount: number;
  firstPurchasedAt: string;
  lastPurchasedAt: string;
}> = {}) {
  return {
    productId: 11,
    productAttributeId: 0,
    productName: 'Disco olimpico 20kg',
    productReference: 'DISC20',
    totalQuantityPurchased: 3,
    orderCount: 2,
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

function buildAffinityProvider(fetchImpl: typeof fetch, timeoutMs = 2500) {
  const evidenceProvider = new HttpCustomerAffinityEvidenceProvider({
    baseUrl: 'http://customer-profile.internal:4020',
    timeoutMs,
    fetchImpl,
  });
  return new DefaultCustomerProductAffinityProvider(
    evidenceProvider,
    new DefaultCustomerAffinityEvaluator(),
    new DefaultCustomerAffinityScorer(),
  );
}

function request(products: CustomerProductAffinityRequest['products']): CustomerProductAffinityRequest {
  return { customer, products };
}

describe('T09 wired to the real HttpCustomerAffinityEvidenceProvider', () => {
  it('propagates positive ownership for a purchased candidate without affecting score/confidence', async () => {
    const provider = buildAffinityProvider(fetchImplFor(200, purchasedProductsBody([row()])));
    const result = await provider.getAffinities(request([productA]));

    const affinity = result.affinities[0];
    expect(affinity?.ownership).toEqual({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: false,
      totalOrderCount: 2,
      firstPurchasedAt: '2026-01-02T10:00:00.000Z',
      lastPurchasedAt: '2026-01-05T12:30:00.000Z',
    });
    expect(affinity?.score).toBe(0);
    expect(affinity?.confidence).toBe('none');
    expect(affinity?.signals).toEqual([]);
  });

  it('reports ownership only for the purchased candidate and PARTIAL_CUSTOMER_HISTORY for the batch', async () => {
    const provider = buildAffinityProvider(fetchImplFor(200, purchasedProductsBody([row({ productId: 11 })])));
    const result = await provider.getAffinities(request([productA, productB]));

    const purchased = result.affinities.find((affinity) => affinity.product.productId === '11');
    const notPurchased = result.affinities.find((affinity) => affinity.product.productId === '22');
    expect(purchased?.ownership?.previouslyPurchased).toBe(true);
    expect(notPurchased?.ownership).toBeUndefined();
    expect(result.warnings).toContainEqual({ code: 'PARTIAL_CUSTOMER_HISTORY' });
  });

  it('reports NO_CUSTOMER_HISTORY when the customer is linked with confirmed empty history', async () => {
    const provider = buildAffinityProvider(fetchImplFor(200, purchasedProductsBody([])));
    const result = await provider.getAffinities(request([productA]));

    expect(result.warnings).toContainEqual({ code: 'NO_CUSTOMER_HISTORY' });
    expect(result.affinities[0]?.ownership).toBeUndefined();
    expect(result.statistics.providerCalls).toBe(1);
  });

  it('reports CUSTOMER_HISTORY_NOT_LINKED without degrading or throwing', async () => {
    const provider = buildAffinityProvider(fetchImplFor(404, { status: 'customer_not_linked' }));
    const result = await provider.getAffinities(request([productA]));

    expect(result.warnings).toEqual([{ code: 'CUSTOMER_HISTORY_NOT_LINKED' }]);
    expect(result.affinities[0]?.ownership).toBeUndefined();
  });

  it('reports CUSTOMER_REFERENCE_NOT_FOUND without degrading or throwing', async () => {
    const provider = buildAffinityProvider(fetchImplFor(404, { status: 'customer_not_found' }));
    const result = await provider.getAffinities(request([productA]));

    expect(result.warnings).toEqual([{ code: 'CUSTOMER_REFERENCE_NOT_FOUND' }]);
    expect(result.affinities[0]?.ownership).toBeUndefined();
  });

  it('surfaces a technical Customer Profile failure as a retryable EVIDENCE_PROVIDER_FAILED error', async () => {
    const provider = buildAffinityProvider(fetchImplFor(503, { status: 'degraded', reason: 'prestashop_unavailable' }));

    await expect(provider.getAffinities(request([productA]))).rejects.toThrow(CustomerAffinityError);
    try {
      await provider.getAffinities(request([productA]));
      throw new Error('expected getAffinities to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CustomerAffinityError);
      expect((error as CustomerAffinityError).code).toBe('EVIDENCE_PROVIDER_FAILED');
      expect((error as CustomerAffinityError).retryable).toBe(true);
    }
  });

  it('surfaces a timeout that fires while the body is still streaming as a retryable EVIDENCE_PROVIDER_FAILED error', async () => {
    const fetchImpl: typeof fetch = (async (_input: URL | string, init?: RequestInit) => {
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
    const provider = buildAffinityProvider(fetchImpl, 30);

    try {
      await provider.getAffinities(request([productA]));
      throw new Error('expected getAffinities to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CustomerAffinityError);
      expect((error as CustomerAffinityError).code).toBe('EVIDENCE_PROVIDER_FAILED');
      expect((error as CustomerAffinityError).retryable).toBe(true);
    }
  });

  it('surfaces an inconsistent pagination page (hasMore=true, incomplete page) as a retryable EVIDENCE_PROVIDER_FAILED error', async () => {
    const provider = buildAffinityProvider(
      fetchImplFor(200, {
        status: 'available',
        products: [row({ productId: 11 })],
        pagination: { limit: 100, offset: 0, returned: 1, hasMore: true },
      }),
    );

    try {
      await provider.getAffinities(request([productA]));
      throw new Error('expected getAffinities to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CustomerAffinityError);
      expect((error as CustomerAffinityError).code).toBe('EVIDENCE_PROVIDER_FAILED');
      expect((error as CustomerAffinityError).retryable).toBe(true);
    }
  });
});
