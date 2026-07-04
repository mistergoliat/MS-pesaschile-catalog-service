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
