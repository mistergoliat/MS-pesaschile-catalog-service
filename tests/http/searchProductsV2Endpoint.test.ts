import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import type {
  SearchProductsV2Request,
  SearchProductsV2Result,
  SearchProductsV2Service,
} from '../../src/application/recommendation/search-products-v2/index.js';
import { SearchProductsV2Error } from '../../src/application/recommendation/search-products-v2/index.js';
import { createRepositoryStub } from '../support/fakes.js';
import {
  baseSearchProductsV2Request,
  buildSearchProductsV2Harness,
} from '../fixtures/searchProductsV2Application.js';

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

class FakeSearchProductsV2HttpService implements SearchProductsV2Service {
  calls: SearchProductsV2Request[] = [];

  failWith: Error | null = null;

  constructor(private readonly result?: SearchProductsV2Result) {}

  async search(request: SearchProductsV2Request): Promise<SearchProductsV2Result> {
    this.calls.push(request);
    if (this.failWith) throw this.failWith;
    return this.result ?? await buildSearchProductsV2Harness().service.search(request);
  }
}

async function makeApp(searchProductsV2Service?: SearchProductsV2Service) {
  return buildApp({
    service: catalogServiceStub(),
    searchProductsV2Service,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

function validInject(service = new FakeSearchProductsV2HttpService()) {
  return {
    service,
    request: {
      method: 'POST' as const,
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key', 'x-correlation-id': 'corr-header' },
      payload: baseSearchProductsV2Request,
    },
  };
}

describe('SearchProducts V2 HTTP endpoint', () => {
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
    const service = new FakeSearchProductsV2HttpService();
    const app = await makeApp(service);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { ...baseSearchProductsV2Request, correlationId: 'corr-body-only' },
    });
    expect(response.headers['x-correlation-id']).toBe('corr-body-only');
    await app.close();
  });

  it('uses generated request id when no correlation is provided', async () => {
    const service = new FakeSearchProductsV2HttpService();
    const app = await makeApp(service);
    const payload = { ...baseSearchProductsV2Request };
    delete payload.correlationId;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key' },
      payload,
    });
    expect(response.headers['x-correlation-id']).toBeTruthy();
    expect(service.calls[0]?.correlationId).toBe(response.headers['x-correlation-id']);
    await app.close();
  });

  it('rejects invalid body with 400', async () => {
    const app = await makeApp(new FakeSearchProductsV2HttpService());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { query: '' },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('maps customer mismatch to 409', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new SearchProductsV2Error('CUSTOMER_MISMATCH', 'mismatch', { stage: 'request' });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it('maps upstream contract mismatch to 422', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new SearchProductsV2Error('UPSTREAM_CONTRACT_MISMATCH', 'bad upstream', { stage: 'response' });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it('maps T08 unavailable to 503', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new SearchProductsV2Error('COMMERCIAL_RECOMMENDATION_UNAVAILABLE', 'down', { stage: 'commercial', retryable: true });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.retryable).toBe(true);
    await app.close();
  });

  it('maps unexpected error to 500', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new Error('secret failure');
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toBe('Internal server error');
    await app.close();
  });

  it('does not expose stack trace', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new Error('secret failure');
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(JSON.stringify(response.json()).toLowerCase()).not.toContain('stack');
    await app.close();
  });

  it('does not expose internal cause', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new SearchProductsV2Error('INVALID_PERSONALIZATION_RESULT', 'bad', { stage: 'personalization', cause: new Error('secret') });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(JSON.stringify(response.json())).not.toContain('secret');
    await app.close();
  });

  it('does not expose accidental PII markers', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(JSON.stringify(response.json()).toLowerCase()).not.toContain('password');
    await app.close();
  });

  it('controller calls service once', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    await app.inject(request);
    expect(service.calls).toHaveLength(1);
    await app.close();
  });

  it('controller does not contain scoring behavior', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(response.json().recommendations[0].score).toBeTypeOf('number');
    expect(service.calls).toHaveLength(1);
    await app.close();
  });

  it('returns 401 without api key', async () => {
    const app = await makeApp(new FakeSearchProductsV2HttpService());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      payload: baseSearchProductsV2Request,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns 503 when service is not configured', async () => {
    const app = await makeApp(undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key' },
      payload: baseSearchProductsV2Request,
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it('returns empty recommendations for zero candidates', async () => {
    const result = await buildSearchProductsV2Harness({ commercialResult: { ...await buildSearchProductsV2Harness().commercial.recommend({ sourceProduct: { productId: 'A' } }), recommendations: [] } }).service.search(baseSearchProductsV2Request);
    const service = new FakeSearchProductsV2HttpService(result);
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(200);
    expect(response.json().recommendations).toEqual([]);
    await app.close();
  });

  it('returns degraded result with 200', async () => {
    const harness = buildSearchProductsV2Harness();
    harness.affinity.failWith = new (await import('../../src/domain/recommendation/customer-affinity/index.js')).CustomerAffinityError('EVIDENCE_PROVIDER_FAILED', 'timeout', { retryable: true });
    const result = await harness.service.search(baseSearchProductsV2Request);
    const service = new FakeSearchProductsV2HttpService(result);
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(200);
    expect(response.json().execution.degraded).toBe(true);
    await app.close();
  });

  it('maps invalid affinity result to 422', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new SearchProductsV2Error('INVALID_AFFINITY_RESULT', 'bad affinity', { stage: 'affinity' });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it('maps invalid personalization result to 422', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new SearchProductsV2Error('INVALID_PERSONALIZATION_RESULT', 'bad personalization', { stage: 'personalization' });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it('maps invalid commercial result to 422', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new SearchProductsV2Error('INVALID_COMMERCIAL_RESULT', 'bad commercial', { stage: 'commercial' });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it('always returns correlation id in errors', async () => {
    const service = new FakeSearchProductsV2HttpService();
    service.failWith = new SearchProductsV2Error('CUSTOMER_MISMATCH', 'mismatch', { stage: 'request' });
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.headers['x-correlation-id']).toBe('corr-header');
    expect(response.json().error.correlationId).toBe('corr-header');
    await app.close();
  });

  it('passes HTTP body to application mapper', async () => {
    const service = new FakeSearchProductsV2HttpService();
    const app = await makeApp(service);
    await app.inject(validInject(service).request);
    expect(service.calls[0]?.query).toBe(baseSearchProductsV2Request.query);
    await app.close();
  });

  it('maps exclusions in response', async () => {
    const result = await buildSearchProductsV2Harness().service.search({ ...baseSearchProductsV2Request, context: { excludedProducts: [{ productId: 'B' }] } });
    const service = new FakeSearchProductsV2HttpService(result);
    const app = await makeApp(service);
    const response = await app.inject(validInject(service).request);
    expect(response.json().excluded[0].code).toBe('EXPLICIT_CONTEXT_EXCLUSION');
    await app.close();
  });

  it('maps reasons in response', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(response.json().recommendations[0].reasons[0].code).toBeTypeOf('string');
    await app.close();
  });

  it('maps scores in response', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(response.json().recommendations[0].commercialScore).toBeGreaterThan(0);
    await app.close();
  });

  it('maps customer in response', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(response.json().customer.customerId).toBe('customer-1');
    await app.close();
  });

  it('exposes relationship evidence but not raw customer evidence in HTTP response', async () => {
    const { service, request } = validInject();
    const app = await makeApp(service);
    const response = await app.inject(request);
    expect(response.json().recommendations[0].relationship.evidence).toMatchObject({
      jointCount: 12,
      confidence: 0.6,
      lift: 1.5,
    });
    expect(JSON.stringify(response.json())).not.toContain('DIRECT_PRODUCT_PURCHASE');
    await app.close();
  });
});
