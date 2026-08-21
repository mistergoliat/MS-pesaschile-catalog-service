import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { config } from '../../src/shared/config.js';
import { createRepositoryStub } from '../support/fakes.js';

const originalObservability = {
  enableMetrics: config.observability.enableMetrics,
  metricsRequireApiKey: config.observability.metricsRequireApiKey,
};

afterEach(() => {
  vi.restoreAllMocks();
  (config as unknown as {
    observability: { enableMetrics: boolean; metricsRequireApiKey: boolean };
  }).observability.enableMetrics = originalObservability.enableMetrics;
  (config as unknown as {
    observability: { enableMetrics: boolean; metricsRequireApiKey: boolean };
  }).observability.metricsRequireApiKey = originalObservability.metricsRequireApiKey;
});

function makeApp() {
  return buildApp({
    service: {
      searchProducts: vi.fn(),
      getProduct: vi.fn(),
      batchGetProducts: vi.fn(),
    } as never,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok', relationshipSnapshot: 'ok' }),
  });
}

describe('/metrics runtime gating', () => {
  it('returns 404 when ENABLE_METRICS=false', async () => {
    (config as unknown as {
      observability: { enableMetrics: boolean };
    }).observability.enableMetrics = false;
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/metrics', headers: { 'x-api-key': 'test-api-key' } });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('requires x-api-key when ENABLE_METRICS=true and METRICS_REQUIRE_API_KEY=true', async () => {
    (config as unknown as {
      observability: { enableMetrics: boolean; metricsRequireApiKey: boolean };
    }).observability.enableMetrics = true;
    (config as unknown as {
      observability: { enableMetrics: boolean; metricsRequireApiKey: boolean };
    }).observability.metricsRequireApiKey = true;
    const app = await makeApp();

    const unauthorized = await app.inject({ method: 'GET', url: '/metrics' });
    const authorized = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    await app.close();
  });

  it('allows anonymous access when ENABLE_METRICS=true and METRICS_REQUIRE_API_KEY=false', async () => {
    (config as unknown as {
      observability: { enableMetrics: boolean; metricsRequireApiKey: boolean };
    }).observability.enableMetrics = true;
    (config as unknown as {
      observability: { enableMetrics: boolean; metricsRequireApiKey: boolean };
    }).observability.metricsRequireApiKey = false;
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    await app.close();
  });
});
