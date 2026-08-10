import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { createRepositoryStub } from '../support/fakes.js';
import { config } from '../../src/shared/config.js';

afterEach(async () => {
  vi.restoreAllMocks();
});

function makeApp(overrides?: Partial<Parameters<typeof buildApp>[0]>) {
  const service = {
    searchProducts: vi.fn().mockResolvedValue({
      query: 'disco bumper',
      items: [],
      freshness: { cached: false, generatedAt: '2026-01-01T00:00:00.000Z' },
    }),
    getProduct: vi.fn(),
    batchGetProducts: vi.fn(),
  } as unknown as Parameters<typeof buildApp>[0]['service'];

  return buildApp({
    service,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
    ...overrides,
  });
}

describe('HTTP interface', () => {
  it('rejects unauthorized requests', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/search?q=disco%20bumper',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
    await app.close();
  });

  it('propagates correlation ids', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/search?q=disco%20bumper',
      headers: { 'x-api-key': 'test-api-key', 'x-correlation-id': 'corr-123' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-correlation-id']).toBe('corr-123');
    await app.close();
  });

  it('validates query input', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/search?q=a',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
    await app.close();
  });

  function productDetailFixture() {
    return {
      product: {
        productId: 1,
        name: 'Disco bumper',
        sku: 'BUMPER',
        shortDescription: 'Corto',
        longDescription: 'Largo',
        active: true,
      },
      selectedVariant: { combinationId: 0, sku: 'BUMPER', label: null, attributes: [] },
      attributes: [],
      variants: [],
      pricing: null,
      stock: null,
      weightKg: 20.5,
      freshness: {
        productCheckedAt: '2026-01-01T00:00:00.000Z',
        priceCalculatedAt: null,
        stockCheckedAt: null,
        cached: false,
      },
    };
  }

  it('serializes weightKg on the GET /v1/products/:productId wire response (CAT-R1-T13B)', async () => {
    const app = await makeApp({
      service: {
        searchProducts: vi.fn(),
        getProduct: vi.fn().mockResolvedValue(productDetailFixture()),
        batchGetProducts: vi.fn(),
      } as unknown as Parameters<typeof buildApp>[0]['service'],
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/1',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body).toHaveProperty('weightKg');
    expect(body.weightKg).toBe(20.5);
    await app.close();
  });

  it('serializes weightKg per successful item on the POST /v1/products/batch wire response (CAT-R1-T13B)', async () => {
    const app = await makeApp({
      service: {
        searchProducts: vi.fn(),
        getProduct: vi.fn(),
        batchGetProducts: vi.fn().mockResolvedValue({
          items: [{ ok: true, input: { productId: 1, combinationId: 0, quantity: 1 }, product: productDetailFixture() }],
        }),
      } as unknown as Parameters<typeof buildApp>[0]['service'],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/batch',
      headers: { 'x-api-key': 'test-api-key', 'content-type': 'application/json' },
      payload: { items: [{ productId: 1, combinationId: 0, quantity: 1 }] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).toHaveProperty('ok', true);
    const product = body.items[0]?.product as Record<string, unknown>;
    expect(product).toHaveProperty('weightKg');
    expect(product.weightKg).toBe(20.5);
    await app.close();
  });

  it('enforces rate limiting', async () => {
    const original = config.limits.rateLimitMax;
    (config as unknown as { limits: { rateLimitMax: number } }).limits.rateLimitMax = 1;
    const app = await makeApp();

    const first = await app.inject({
      method: 'GET',
      url: '/v1/products/search?q=disco%20bumper',
      headers: { 'x-api-key': 'test-api-key' },
    });
    const second = await app.inject({
      method: 'GET',
      url: '/v1/products/search?q=disco%20bumper',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    (config as unknown as { limits: { rateLimitMax: number } }).limits.rateLimitMax = original;
    await app.close();
  });
});
