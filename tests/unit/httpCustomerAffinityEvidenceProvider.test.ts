import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import {
  HttpCustomerAffinityEvidenceProvider,
  HttpCustomerAffinityEvidenceProviderError,
  type HttpCustomerAffinityEvidenceProviderFailureReason,
} from '../../src/infrastructure/recommendation/httpCustomerAffinityEvidenceProvider.js';
import { customerAffinityEvidenceResultSchema } from '../../src/domain/recommendation/customer-affinity/index.js';
import type { CustomerAffinityCustomerReference } from '../../src/domain/recommendation/customer-affinity/index.js';
import type { ProductRelationshipProductReference } from '../../src/domain/recommendation/relationship-engine/contracts.js';

const BASE_URL = 'http://customer-profile.internal:4020';

const customer: CustomerAffinityCustomerReference = { customerId: '1001' };
const productBase: ProductRelationshipProductReference = { productId: '123' };
const productVariant10: ProductRelationshipProductReference = { productId: '123', combinationId: '10' };
const productVariant11: ProductRelationshipProductReference = { productId: '123', combinationId: '11' };
const productOther: ProductRelationshipProductReference = { productId: '456' };

type RowOverrides = Partial<{
  productId: number;
  productAttributeId: number;
  productName: string;
  productReference: string | null;
  totalQuantityPurchased: number;
  orderCount: number;
  firstPurchasedAt: string;
  lastPurchasedAt: string;
  totalSpentTaxIncl: string;
  catalogStatus: 'linked' | 'deleted_or_unavailable';
}>;

function row(overrides: RowOverrides = {}) {
  return {
    productId: 123,
    productAttributeId: 0,
    productName: 'Disco olimpico 20kg',
    productReference: 'DISC20',
    totalQuantityPurchased: 5,
    orderCount: 2,
    firstPurchasedAt: '2026-01-02T10:00:00.000Z',
    lastPurchasedAt: '2026-01-05T12:30:00.000Z',
    totalSpentTaxIncl: '99990.123456',
    catalogStatus: 'linked' as const,
    ...overrides,
  };
}

function availableBody(products: ReturnType<typeof row>[], pagination: Partial<{ limit: number; offset: number; returned: number; hasMore: boolean }> = {}) {
  return {
    status: 'available',
    products,
    pagination: {
      limit: 100,
      offset: 0,
      returned: products.length,
      hasMore: false,
      ...pagination,
    },
  };
}

// Customer Profile's real reader only ever reports hasMore=true for a page that returned exactly 100 rows (it
// fetches limit+1 to compute hasMore, then slices to limit). Tests that need a realistic hasMore=true page must
// pad it to exactly 100 rows — otherwise the adapter's completeness guard (pagination_inconsistent) now rejects
// it. `extraRows` are appended after `products` with productIds guaranteed not to collide with the fixture ids
// used elsewhere in this file (123, 456, 999, 1, 2, 3), padding the page to exactly 100 total rows.
function fullPageOf(products: ReturnType<typeof row>[], offset = 0) {
  const paddingNeeded = 100 - products.length;
  const padding = Array.from({ length: paddingNeeded }, (_, index) => row({ productId: 900_000 + offset + index }));
  return [...products, ...padding];
}

type FakeFetchResponse = {
  status: number;
  body?: unknown;
  jsonThrows?: boolean;
  networkError?: boolean;
  hangUntilAbort?: boolean;
};

type FakeCall = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  redirect?: string;
  signal?: AbortSignal;
};

function createFakeFetch(responses: readonly FakeFetchResponse[]) {
  const calls: FakeCall[] = [];
  let callIndex = 0;
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    const signal = init?.signal ?? undefined;
    calls.push({
      url,
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
      body: init?.body,
      redirect: init?.redirect,
      signal,
    });
    const spec = responses[callIndex];
    callIndex += 1;
    if (!spec) {
      throw new Error(`Unexpected extra fetch call #${callIndex}`);
    }
    if (spec.hangUntilAbort) {
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
    }
    if (spec.networkError) {
      throw new TypeError('fetch failed');
    }
    return {
      status: spec.status,
      json: async () => {
        if (spec.jsonThrows) throw new SyntaxError('Unexpected token in JSON');
        return spec.body;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, callCount: () => callIndex };
}

function makeProvider(fetchImpl: typeof fetch, timeoutMs = 5000) {
  return new HttpCustomerAffinityEvidenceProvider({ baseUrl: BASE_URL, timeoutMs, fetchImpl });
}

async function captureError(promise: Promise<unknown>): Promise<HttpCustomerAffinityEvidenceProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpCustomerAffinityEvidenceProviderError) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

describe('HttpCustomerAffinityEvidenceProvider identity and request shape', () => {
  it('accepts a numeric masterCustomerId', async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: availableBody([]) }]);
    const provider = makeProvider(fetchImpl);
    await provider.getEvidence(customer, [productBase]);
    expect(calls).toHaveLength(1);
  });

  it('rejects an alphanumeric customerId before any HTTP request', async () => {
    const { fetchImpl, calls } = createFakeFetch([]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence({ customerId: 'abc123' }, [productBase])).rejects.toMatchObject({
      reason: 'invalid_customer_identity',
    });
    expect(calls).toHaveLength(0);
  });

  for (const zeroSentinel of ['0', '00', '000', '0000']) {
    it(`rejects the all-zero sentinel "${zeroSentinel}" before any HTTP request`, async () => {
      const { fetchImpl, calls } = createFakeFetch([]);
      const provider = makeProvider(fetchImpl);
      await expect(provider.getEvidence({ customerId: zeroSentinel }, [productBase])).rejects.toMatchObject({
        reason: 'invalid_customer_identity',
      });
      expect(calls).toHaveLength(0);
    });
  }

  it('accepts a zero-padded positive customerId ("001") and preserves it verbatim in the request URL, without normalizing it to "1"', async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: availableBody([]) }]);
    const provider = makeProvider(fetchImpl);
    await provider.getEvidence({ customerId: '001' }, [productBase]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/customers/001/purchased-products?limit=100&offset=0`);
  });

  it('rejects a customerId longer than the Customer Profile masterCustomerId length', async () => {
    const { fetchImpl, calls } = createFakeFetch([]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence({ customerId: '123456789012345678901' }, [productBase])).rejects.toMatchObject({
      reason: 'invalid_customer_identity',
    });
    expect(calls).toHaveLength(0);
  });

  it('builds the request URL with limit=100 and offset=0 and GET, no body, Accept header', async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: availableBody([]) }]);
    const provider = makeProvider(fetchImpl);
    await provider.getEvidence(customer, [productBase]);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/customers/1001/purchased-products?limit=100&offset=0`);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers).toMatchObject({ Accept: 'application/json' });
    expect(calls[0]?.redirect).toBe('error');
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not call fetch when the candidate batch is empty', async () => {
    const { fetchImpl, calls } = createFakeFetch([]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, []);
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ customer, productEvidence: [], warnings: [] });
  });
});

describe('HttpCustomerAffinityEvidenceProvider available responses', () => {
  it('matches a base product row to a base product candidate', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([row()]) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result.productEvidence).toEqual([
      {
        product: productBase,
        ownership: {
          previouslyPurchased: true,
          exactVariantPreviouslyPurchased: false,
          totalOrderCount: 2,
          firstPurchasedAt: '2026-01-02T10:00:00.000Z',
          lastPurchasedAt: '2026-01-05T12:30:00.000Z',
        },
      },
    ]);
  });

  it('matches a variant row to its exact variant candidate', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([row({ productAttributeId: 10 })]) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productVariant10]);
    expect(result.productEvidence).toEqual([
      {
        product: productVariant10,
        ownership: expect.objectContaining({ previouslyPurchased: true, exactVariantPreviouslyPurchased: true }),
      },
    ]);
  });

  it('does not let a base-product row match a variant candidate', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([row({ productAttributeId: 0 })]) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productVariant10]);
    expect(result.productEvidence).toEqual([]);
  });

  it('does not let variant 10 match variant 11', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([row({ productAttributeId: 10 })]) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productVariant11]);
    expect(result.productEvidence).toEqual([]);
  });

  it('does not let a variant row match the base product candidate', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([row({ productAttributeId: 10 })]) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result.productEvidence).toEqual([]);
  });

  it('maps several rows against several candidates, matching only the intersecting identities', async () => {
    const rows = [
      row({ productId: 123, productAttributeId: 0 }),
      row({ productId: 123, productAttributeId: 10 }),
      row({ productId: 999, productAttributeId: 0 }),
    ];
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody(rows) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase, productVariant10, productOther]);
    const identities = result.productEvidence.map((entry) => entry.product);
    expect(identities).toEqual(expect.arrayContaining([productBase, productVariant10]));
    expect(identities).not.toEqual(expect.arrayContaining([productOther]));
    expect(result.productEvidence).toHaveLength(2);
  });

  it('omits a candidate with no matching row', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([row()]) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase, productOther]);
    expect(result.productEvidence).toHaveLength(1);
    expect(result.productEvidence[0]?.product).toEqual(productBase);
  });

  it('never emits previouslyPurchased: false for an unmatched candidate', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([]) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result.productEvidence).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('previouslyPurchased');
  });

  it('maps orderCount to totalOrderCount and never exposes quantity or amount', async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: availableBody([row({ orderCount: 7, totalQuantityPurchased: 999, totalSpentTaxIncl: '123456.000000' })]) },
    ]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result.productEvidence[0]?.ownership?.totalOrderCount).toBe(7);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('999');
    expect(serialized).not.toContain('123456');
  });

  it('never exposes productName or productReference', async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: availableBody([row({ productName: 'Secret Product Name', productReference: 'SECRET-REF' })]) },
    ]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Secret Product Name');
    expect(serialized).not.toContain('SECRET-REF');
  });

  it('accepts a negative totalSpentTaxIncl (a legitimate credit/adjustment) without exposing it', async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: availableBody([row({ totalSpentTaxIncl: '-10.25' })]) },
    ]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result.productEvidence).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('-10.25');
  });

  it('still produces ownership for a row whose catalogStatus is deleted_or_unavailable', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([row({ catalogStatus: 'deleted_or_unavailable' })]) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result.productEvidence).toHaveLength(1);
    expect(result.productEvidence[0]?.ownership?.previouslyPurchased).toBe(true);
  });
});

describe('HttpCustomerAffinityEvidenceProvider pagination', () => {
  it('follows two pages and merges matches from both', async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { status: 200, body: availableBody(fullPageOf([row({ productId: 123, productAttributeId: 0 })]), { hasMore: true }) },
      { status: 200, body: availableBody([row({ productId: 456, productAttributeId: 0 })], { offset: 100, hasMore: false }) },
    ]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase, productOther]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain('offset=100');
    expect(result.productEvidence).toHaveLength(2);
  });

  it('follows three pages with correct offsets', async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { status: 200, body: availableBody(fullPageOf([row({ productId: 1 })], 0), { offset: 0, hasMore: true }) },
      { status: 200, body: availableBody(fullPageOf([row({ productId: 2 })], 100), { offset: 100, hasMore: true }) },
      { status: 200, body: availableBody([row({ productId: 3 })], { offset: 200, hasMore: false }) },
    ]);
    const provider = makeProvider(fetchImpl);
    await provider.getEvidence(customer, [productBase]);
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE_URL}/v1/customers/1001/purchased-products?limit=100&offset=0`,
      `${BASE_URL}/v1/customers/1001/purchased-products?limit=100&offset=100`,
      `${BASE_URL}/v1/customers/1001/purchased-products?limit=100&offset=200`,
    ]);
  });

  it('stops as soon as hasMore is false and issues no further request', async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: availableBody([row()], { hasMore: false }) }]);
    const provider = makeProvider(fetchImpl);
    await provider.getEvidence(customer, [productBase]);
    expect(calls).toHaveLength(1);
  });

  it('matches a candidate whose row only appears on the last page', async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: availableBody(fullPageOf([row({ productId: 999 })]), { hasMore: true }) },
      { status: 200, body: availableBody([row({ productId: 123, productAttributeId: 0 })], { offset: 100, hasMore: false }) },
    ]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result.productEvidence).toHaveLength(1);
    expect(result.productEvidence[0]?.product).toEqual(productBase);
  });

  it('throws when the same identity is repeated within a single page', async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: availableBody([row({ productId: 1 }), row({ productId: 1 })], { returned: 2, hasMore: false }) },
    ]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({ reason: 'duplicate_identity' });
  });

  it('throws when the same identity is repeated across pages', async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: availableBody(fullPageOf([row({ productId: 1 })]), { hasMore: true }) },
      { status: 200, body: availableBody([row({ productId: 1 })], { offset: 100, hasMore: false }) },
    ]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({ reason: 'duplicate_identity' });
  });

  it('throws when the returned pagination.offset does not match the requested offset', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([row()], { offset: 5, hasMore: false }) }]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({
      reason: 'pagination_inconsistent',
    });
  });

  it('throws when pagination.returned is inconsistent with products.length', async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: { status: 'available', products: [row()], pagination: { limit: 100, offset: 0, returned: 2, hasMore: false } } },
    ]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({
      reason: 'invalid_response_schema',
    });
  });

  it('throws when pagination exceeds the maximum page guard (runaway hasMore=true forever)', async () => {
    // Every page is a realistic, complete 100-row page (hasMore=true requires returned===limit, per the
    // completeness guard) with globally unique productIds derived from its own offset, so this exercises the
    // page-count guard specifically, without also tripping the row-count or duplicate-identity guards.
    const fetchImpl = vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get('offset'));
      const products = Array.from({ length: 100 }, (_, index) => row({ productId: offset + index + 1 }));
      return {
        status: 200,
        json: async () => availableBody(products, { offset, hasMore: true, returned: 100 }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const provider = makeProvider(fetchImpl, 30000);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({
      reason: 'pagination_limit_exceeded',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(200);
  });

  it('throws when a single page reports more historical rows than the guard allows', async () => {
    const hugeProducts = Array.from({ length: 20001 }, (_, index) => row({ productId: index + 1 }));
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: availableBody(hugeProducts, { returned: hugeProducts.length, hasMore: false }) },
    ]);
    const provider = makeProvider(fetchImpl, 30000);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({
      reason: 'pagination_limit_exceeded',
    });
  });

  it('aborts an in-flight request once the total timeout elapses on the first page', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, hangUntilAbort: true }]);
    const provider = makeProvider(fetchImpl, 20);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('aborts an in-flight request once the total timeout elapses during a later page', async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { status: 200, body: availableBody(fullPageOf([row()]), { hasMore: true }) },
      { status: 200, hangUntilAbort: true },
    ]);
    const provider = makeProvider(fetchImpl, 50);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({ reason: 'timeout' });
    expect(calls).toHaveLength(2);
  });

  it('classifies an AbortError that occurs while parsing the response body as timeout, not invalid_response_body (real server, real fetch)', async () => {
    // Uses a real Node http server and the real global fetch (no fetchImpl override): headers are sent
    // immediately (200), but the body is deliberately never completed (no res.end()), so response.json() is
    // still awaiting bytes when the adapter's own AbortController fires. This is the one behavior a mocked
    // fetchImpl cannot exercise, because a mock's json() never actually consults the AbortSignal.
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(
        '{"status":"available","products":[],"pagination":{"limit":100,"offset":0,"returned":0,"hasMore":false',
      );
      // no res.end() — body stream hangs until the client (fetch) aborts it.
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('failed to bind test server');
      const provider = new HttpCustomerAffinityEvidenceProvider({
        baseUrl: `http://127.0.0.1:${address.port}`,
        timeoutMs: 200,
      });
      const error = await captureError(provider.getEvidence(customer, [productBase]));
      expect(error.reason).toBe('timeout');
      expect(error.reason).not.toBe('invalid_response_body');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('throws pagination_inconsistent when hasMore=true but the page is empty (returned=0), and issues no further request', async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: availableBody([], { hasMore: true, returned: 0 }) }]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({
      reason: 'pagination_inconsistent',
    });
    expect(calls).toHaveLength(1);
  });

  it('throws pagination_inconsistent when hasMore=true but returned (50) is less than limit (100), and issues no further request', async () => {
    const partialPage = Array.from({ length: 50 }, (_, index) => row({ productId: index + 1 }));
    const { fetchImpl, calls } = createFakeFetch([
      { status: 200, body: availableBody(partialPage, { hasMore: true, returned: 50 }) },
    ]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence(customer, [productBase])).rejects.toMatchObject({
      reason: 'pagination_inconsistent',
    });
    expect(calls).toHaveLength(1);
  });

  it('accepts hasMore=true when returned===limit===100 (a genuinely complete page)', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => row({ productId: index + 1 }));
    const { fetchImpl, calls } = createFakeFetch([
      { status: 200, body: availableBody(fullPage, { hasMore: true, returned: 100 }) },
      { status: 200, body: availableBody([], { offset: 100, hasMore: false }) },
    ]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence(customer, [productBase])).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it('accepts hasMore=false with fewer rows than limit (a genuine, non-runaway last page)', async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: availableBody([row()], { hasMore: false, returned: 1 }) }]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence(customer, [productBase])).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
  });
});

describe('HttpCustomerAffinityEvidenceProvider functional states', () => {
  it('returns the reserved customer_history_not_linked warning for customer_not_linked, without ownership or throwing', async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 404, body: { status: 'customer_not_linked' } }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result).toEqual({ customer, productEvidence: [], warnings: [{ code: 'customer_history_not_linked' }] });
    expect(calls).toHaveLength(1);
    expect(() => customerAffinityEvidenceResultSchema.parse(result)).not.toThrow();
  });

  it('returns the reserved customer_reference_not_found warning for customer_not_found, without ownership or throwing', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 404, body: { status: 'customer_not_found' } }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result).toEqual({ customer, productEvidence: [], warnings: [{ code: 'customer_reference_not_found' }] });
    expect(() => customerAffinityEvidenceResultSchema.parse(result)).not.toThrow();
  });

  it('does not include details on the reserved warnings', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 404, body: { status: 'customer_not_linked' } }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase]);
    expect(result.warnings?.[0]).toEqual({ code: 'customer_history_not_linked' });
    expect(result.warnings?.[0]).not.toHaveProperty('details');
  });
});

describe('HttpCustomerAffinityEvidenceProvider technical degradation', () => {
  const failureCases: Array<{ name: string; response: FakeFetchResponse; reason: HttpCustomerAffinityEvidenceProviderFailureReason }> = [
    { name: 'degraded prestashop_unavailable', response: { status: 503, body: { status: 'degraded', reason: 'prestashop_unavailable' } }, reason: 'prestashop_unavailable' },
    { name: 'degraded prestashop_timeout', response: { status: 503, body: { status: 'degraded', reason: 'prestashop_timeout' } }, reason: 'prestashop_timeout' },
    { name: 'HTTP 500', response: { status: 500, body: { error: 'internal_error' } }, reason: 'unexpected_http_status' },
    { name: 'HTTP 502', response: { status: 502, body: {} }, reason: 'unexpected_http_status' },
    { name: 'HTTP 504', response: { status: 504, body: {} }, reason: 'unexpected_http_status' },
    { name: 'HTTP 401', response: { status: 401, body: {} }, reason: 'auth_or_config_error' },
    { name: 'HTTP 403', response: { status: 403, body: {} }, reason: 'auth_or_config_error' },
    { name: 'HTTP 400', response: { status: 400, body: { error: 'invalid_limit' } }, reason: 'bad_request' },
    { name: 'unknown HTTP status', response: { status: 201, body: {} }, reason: 'unexpected_http_status' },
    { name: 'network error', response: { status: 0, networkError: true }, reason: 'network_error' },
    { name: 'invalid JSON body', response: { status: 200, jsonThrows: true }, reason: 'invalid_response_body' },
    { name: 'schema-invalid available body', response: { status: 200, body: { status: 'available' } }, reason: 'invalid_response_schema' },
    { name: 'unknown status literal', response: { status: 200, body: { status: 'something_else' } }, reason: 'invalid_response_schema' },
  ];

  for (const testCase of failureCases) {
    it(`throws for ${testCase.name}`, async () => {
      const { fetchImpl } = createFakeFetch([testCase.response]);
      const provider = makeProvider(fetchImpl);
      const error = await captureError(provider.getEvidence(customer, [productBase]));
      expect(error.reason).toBe(testCase.reason);
    });
  }

  it('throws AbortError immediately as a timeout failure', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('This operation was aborted');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof fetch;
    const provider = makeProvider(fetchImpl);
    const error = await captureError(provider.getEvidence(customer, [productBase]));
    expect(error.reason).toBe('timeout');
  });

  it('throws when the response status is 503 but the body does not match the degraded schema', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 503, body: { status: 'available', products: [], pagination: { limit: 100, offset: 0, returned: 0, hasMore: false } } }]);
    const provider = makeProvider(fetchImpl);
    const error = await captureError(provider.getEvidence(customer, [productBase]));
    expect(error.reason).toBe('invalid_response_schema');
  });

  it('throws when the response status is 404 but the body matches neither reserved shape', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 404, body: { status: 'available', products: [], pagination: { limit: 100, offset: 0, returned: 0, hasMore: false } } }]);
    const provider = makeProvider(fetchImpl);
    const error = await captureError(provider.getEvidence(customer, [productBase]));
    expect(error.reason).toBe('invalid_response_schema');
  });

  it('throws when the customer history status changes mid-pagination', async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: availableBody(fullPageOf([row()]), { hasMore: true }) },
      { status: 404, body: { status: 'customer_not_linked' } },
    ]);
    const provider = makeProvider(fetchImpl);
    const error = await captureError(provider.getEvidence(customer, [productBase]));
    expect(error.reason).toBe('pagination_inconsistent');
  });
});

describe('HttpCustomerAffinityEvidenceProvider security and immutability', () => {
  it('never includes the response body, base URL, or masterCustomerId in the thrown error', async () => {
    const secretCustomerId = '999999999999';
    const { fetchImpl } = createFakeFetch([{ status: 500, body: { secret: 'do-not-leak-me' } }]);
    const provider = makeProvider(fetchImpl);
    const error = await captureError(provider.getEvidence({ customerId: secretCustomerId }, [productBase]));
    const serialized = JSON.stringify({ message: error.message, reason: error.reason, httpStatus: error.httpStatus });
    expect(serialized).not.toContain('do-not-leak-me');
    expect(serialized).not.toContain(secretCustomerId);
    expect(serialized).not.toContain(BASE_URL);
  });

  it('does not mutate the customer or products inputs', async () => {
    const inputCustomer = { customerId: '555' };
    const inputProducts = [{ productId: '123' }, { productId: '123', combinationId: '10' }];
    const customerSnapshot = structuredClone(inputCustomer);
    const productsSnapshot = structuredClone(inputProducts);
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody([row({ productAttributeId: 10 })]) }]);
    const provider = makeProvider(fetchImpl);
    await provider.getEvidence(inputCustomer, inputProducts);
    expect(inputCustomer).toEqual(customerSnapshot);
    expect(inputProducts).toEqual(productsSnapshot);
  });

  it('does not leak duplicate-tracking state between independent calls', async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: availableBody([row({ productId: 1 })]) },
      { status: 200, body: availableBody([row({ productId: 1 })]) },
    ]);
    const provider = makeProvider(fetchImpl);
    await expect(provider.getEvidence(customer, [{ productId: '1' }])).resolves.toBeDefined();
    await expect(provider.getEvidence(customer, [{ productId: '1' }])).resolves.toBeDefined();
  });

  it('returns a result that validates against customerAffinityEvidenceResultSchema', async () => {
    const rows = [row({ productId: 123, productAttributeId: 0 }), row({ productId: 123, productAttributeId: 10 })];
    const { fetchImpl } = createFakeFetch([{ status: 200, body: availableBody(rows) }]);
    const provider = makeProvider(fetchImpl);
    const result = await provider.getEvidence(customer, [productBase, productVariant10]);
    expect(() => customerAffinityEvidenceResultSchema.parse(result)).not.toThrow();
  });
});
