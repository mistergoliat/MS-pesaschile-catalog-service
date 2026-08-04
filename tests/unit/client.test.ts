import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProduct, searchProducts, searchProductsV2 } from '../../client/catalogClient.js';
import type { SearchProductsV2Request } from '../../src/application/recommendation/search-products-v2/index.js';
import {
  baseSearchProductsV2Request,
  buildSearchProductsV2Harness,
  catalogSummaryFor,
} from '../fixtures/searchProductsV2Application.js';
import {
  commercialRecommendationFor,
  commercialResultFor,
  productB,
  sourceProduct,
} from '../fixtures/personalizedRecommendation.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function validSearchProductsV2Result(input: SearchProductsV2Request = baseSearchProductsV2Request) {
  return buildSearchProductsV2Harness().service.search(input);
}

describe('Catalog client', () => {
  it('sends auth and correlation headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'disco bumper',
          items: [],
          freshness: { cached: false, generatedAt: '2026-01-01T00:00:00.000Z' },
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchProducts(
      { query: 'disco bumper', limit: 3, includeOutOfStock: false },
      { baseUrl: 'http://catalog.local', apiKey: 'secret', correlationId: 'corr-1' },
    );

    expect(result.items).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/products/search?');
    const headers = init.headers as Headers;
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get('x-api-key')).toBe('secret');
    expect(headers.get('x-correlation-id')).toBe('corr-1');
  });

  it('retries once on transient failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: 'db', correlationId: 'corr-1' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: 'disco bumper',
            items: [],
            freshness: { cached: false, generatedAt: '2026-01-01T00:00:00.000Z' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchProducts(
      { query: 'disco bumper' },
      { baseUrl: 'http://catalog.local', apiKey: 'secret' },
    );

    expect(result.items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts on timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = getProduct(
      { productId: 1, quantity: 1 },
      { baseUrl: 'http://catalog.local', apiKey: 'secret', timeoutMs: 1 },
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(5);
    const error = await promise;
    expect(error).toMatchObject({ name: 'CatalogClientError', statusCode: 408, code: 'TIMEOUT' });
  });
});

describe('SearchProducts V2 client', () => {
  it.each([
    ['barra'],
    ['barra ol\u00edmpica'],
    ['barra ol\u00edmpica 20 kg'],
  ])('serializes CRM search intent "%s" to the Catalog Service V2 HTTP contract', async (query) => {
    const request: SearchProductsV2Request = {
      ...baseSearchProductsV2Request,
      query,
      correlationId: 'crm-request-1',
      sourceProduct,
      customer: { customerId: 'customer-1' },
      context: {
        customerId: 'customer-1',
        intent: 'purchase',
        useCase: 'sales-agent',
      },
      filters: { inStockOnly: true },
      limit: 3,
    };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as SearchProductsV2Request;
      return new Response(JSON.stringify(await validSearchProductsV2Result(payload)), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'crm-request-1' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchProductsV2(request, {
      baseUrl: 'http://catalog.local/',
      apiKey: 'secret',
      correlationId: 'crm-request-1',
      timeoutMs: 2500,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(url).toBe('http://catalog.local/api/v2/recommendations/search-products');
    expect(init.method).toBe('POST');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-api-key')).toBe('secret');
    expect(headers.get('x-correlation-id')).toBe('crm-request-1');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual(request);
    expect(result.query).toBe(query);
    expect(result.execution.correlationId).toBe('crm-request-1');
    expect(result.recommendations[0]?.product.productId).toBe('B');
  });

  it('keeps an empty Catalog Service response controlled and traceable', async () => {
    const result = await buildSearchProductsV2Harness({
      commercialResult: commercialResultFor([]),
    }).service.search({ ...baseSearchProductsV2Request, correlationId: 'crm-empty' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'crm-empty' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await searchProductsV2(baseSearchProductsV2Request, {
      baseUrl: 'http://catalog.local',
      apiKey: 'secret',
      correlationId: 'crm-empty',
    });

    expect(response.recommendations).toEqual([]);
    expect(response.excluded).toEqual([]);
    expect(response.warnings.map((item) => item.code)).toContain('NO_COMMERCIAL_CANDIDATES');
    expect(response.execution.correlationId).toBe('crm-empty');
  });

  it('preserves out-of-stock and incomplete commercial candidates when the real contract allows them', async () => {
    const result = await buildSearchProductsV2Harness({
      commercialResult: commercialResultFor([
        commercialRecommendationFor(productB, 1, 80),
      ]),
      catalogProducts: [
        catalogSummaryFor(sourceProduct),
        catalogSummaryFor(productB, {
          price: null,
          stock: { status: 'unknown', available: false },
        }),
      ],
    }).service.search(baseSearchProductsV2Request);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await searchProductsV2(baseSearchProductsV2Request, {
      baseUrl: 'http://catalog.local',
      apiKey: 'secret',
      correlationId: 'crm-incomplete',
    });

    expect(response.recommendations[0]?.product).toMatchObject({
      productId: 'B',
      price: null,
      stock: { status: 'unknown', available: false },
    });
    expect(response.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining(['CATALOG_PRICE_UNAVAILABLE', 'CATALOG_STOCK_UNKNOWN']),
    );
  });

  it('maps 4xx errors from Catalog Service without losing CRM correlation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid SearchProducts V2 request',
            retryable: false,
            correlationId: 'crm-bad-request',
          },
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json', 'x-correlation-id': 'crm-bad-request' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchProductsV2(baseSearchProductsV2Request, {
      baseUrl: 'http://catalog.local',
      apiKey: 'secret',
      correlationId: 'crm-bad-request',
    })).rejects.toMatchObject({
      name: 'CatalogClientError',
      statusCode: 400,
      code: 'INVALID_REQUEST',
      correlationId: 'crm-bad-request',
      retryable: false,
    });
  });

  it('retries and maps 5xx Catalog Service failures as controlled technical errors', async () => {
    const unavailableResponse = () => new Response(
      JSON.stringify({
        error: {
          code: 'COMMERCIAL_RECOMMENDATION_UNAVAILABLE',
          message: 'SearchProducts V2 is not configured',
          retryable: true,
          correlationId: 'crm-catalog-down',
        },
      }),
      {
        status: 503,
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'crm-catalog-down' },
      },
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unavailableResponse())
      .mockResolvedValueOnce(unavailableResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchProductsV2(baseSearchProductsV2Request, {
      baseUrl: 'http://catalog.local',
      apiKey: 'secret',
      correlationId: 'crm-catalog-down',
    })).rejects.toMatchObject({
      name: 'CatalogClientError',
      statusCode: 503,
      code: 'COMMERCIAL_RECOMMENDATION_UNAVAILABLE',
      correlationId: 'crm-catalog-down',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
