import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProduct, searchProducts } from '../../client/catalogClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
    expect(init.headers).toBeInstanceOf(Headers);
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
