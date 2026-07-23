import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import type {
  ProductIntentResolutionService,
  ResolveProductIntentRequest,
  ResolveProductIntentResult,
} from '../../src/application/catalog/product-intent/index.js';
import { ProductIntentResolutionError } from '../../src/application/catalog/product-intent/index.js';
import { createRepositoryStub } from '../support/fakes.js';
import {
  baseResolveProductIntentRequest,
  buildProductIntentHarness,
} from '../fixtures/productIntentResolution.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function catalogServiceStub() {
  return {
    searchProducts: vi.fn(),
    getProduct: vi.fn(),
    batchGetProducts: vi.fn(),
  } as never;
}

class FakeProductIntentHttpService implements ProductIntentResolutionService {
  calls: ResolveProductIntentRequest[] = [];

  failWith: Error | null = null;

  constructor(private readonly result?: ResolveProductIntentResult) {}

  async resolve(request: ResolveProductIntentRequest): Promise<ResolveProductIntentResult> {
    this.calls.push(request);
    if (this.failWith) throw this.failWith;
    return this.result ?? await buildProductIntentHarness().service.resolve(request);
  }
}

async function makeApp(productIntentResolutionService?: ProductIntentResolutionService) {
  return buildApp({
    service: catalogServiceStub(),
    productIntentResolutionService,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

function validInject(service = new FakeProductIntentHttpService()) {
  return {
    service,
    request: {
      method: 'POST' as const,
      url: '/api/v2/catalog/resolve-product-intent',
      headers: { 'x-api-key': 'test-api-key', 'x-correlation-id': 'corr-header' },
      payload: baseResolveProductIntentRequest,
    },
  };
}

describe('Resolve Product Intent HTTP endpoint', () => {
  it('returns 200 for valid POST', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('returns JSON content type', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(response.headers['content-type']).toContain('application/json');
    await app.close();
  });

  it('uses correlation id header precedence', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(response.headers['x-correlation-id']).toBe('corr-header');
    expect(service.calls[0]?.correlationId).toBe('corr-header');
    await app.close();
  });

  it('uses body correlation id when header is absent', async () => {
    const service = new FakeProductIntentHttpService();
    const app = await makeApp(service);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/catalog/resolve-product-intent',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { ...baseResolveProductIntentRequest, correlationId: 'corr-body-only' },
    });
    expect(response.headers['x-correlation-id']).toBe('corr-body-only');
    await app.close();
  });

  it('uses generated request id when no correlation is provided', async () => {
    const service = new FakeProductIntentHttpService();
    const app = await makeApp(service);
    const payload = { ...baseResolveProductIntentRequest };
    delete payload.correlationId;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/catalog/resolve-product-intent',
      headers: { 'x-api-key': 'test-api-key' },
      payload,
    });
    expect(response.headers['x-correlation-id']).toBeTruthy();
    expect(service.calls[0]?.correlationId).toBe(response.headers['x-correlation-id']);
    await app.close();
  });

  it('rejects invalid body with 400', async () => {
    const app = await makeApp(new FakeProductIntentHttpService());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/catalog/resolve-product-intent',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { query: '' },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('maps invalid catalog result to 422', async () => {
    const service = new FakeProductIntentHttpService();
    service.failWith = new ProductIntentResolutionError('INVALID_CATALOG_RESULT', 'bad catalog', { stage: 'response' });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it('maps catalog unavailable to 503', async () => {
    const service = new FakeProductIntentHttpService();
    service.failWith = new ProductIntentResolutionError('CATALOG_SEARCH_UNAVAILABLE', 'down', { stage: 'search', retryable: true });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.retryable).toBe(true);
    await app.close();
  });

  it('maps unexpected error to 500 without stack trace', async () => {
    const service = new FakeProductIntentHttpService();
    service.failWith = new Error('secret failure');
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.json())).not.toContain('secret failure');
    await app.close();
  });

  it('returns 401 without api key', async () => {
    const app = await makeApp(new FakeProductIntentHttpService());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/catalog/resolve-product-intent',
      payload: baseResolveProductIntentRequest,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns 503 when service is not configured', async () => {
    const app = await makeApp(undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/catalog/resolve-product-intent',
      headers: { 'x-api-key': 'test-api-key' },
      payload: baseResolveProductIntentRequest,
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it('returns resolved state with 200', async () => {
    const result = await buildProductIntentHarness().service.resolve(baseResolveProductIntentRequest);
    const service = new FakeProductIntentHttpService(result);
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(200);
    expect(response.json().resolution.status).toBe('resolved');
    await app.close();
  });

  it('returns clarification_required state with 200', async () => {
    const result = await buildProductIntentHarness().service.resolve({ query: 'barra', limit: 5 });
    const service = new FakeProductIntentHttpService(result);
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(200);
    expect(response.json().resolution.status).toBe('clarification_required');
    await app.close();
  });

  it('returns no_match state with 200', async () => {
    const result = await buildProductIntentHarness({ hits: [] }).service.resolve({ query: 'producto inexistente xyz', limit: 5 });
    const service = new FakeProductIntentHttpService(result);
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(200);
    expect(response.json().resolution.status).toBe('no_match');
    await app.close();
  });

  it('does not expose recommendation fields', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(response.json()).not.toHaveProperty('recommendations');
    await app.close();
  });

  it('documents route in OpenAPI with the three examples', async () => {
    const app = await makeApp(new FakeProductIntentHttpService());
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    const route = response.json().paths['/api/v2/catalog/resolve-product-intent'].post;
    expect(route.description).toContain('barra olimpica 15 kg');
    expect(route.description).toContain('quiero una barra');
    expect(route.description).toContain('producto inexistente xyz 987654');
    await app.close();
  });
});
