import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import {
  commercialProductOntologyRegistryVersionV3,
  computeCommercialProductOntologyRegistryHash,
  getCommercialProductOntologyRegistry,
} from '../../src/domain/commercial-product-ontology/index.js';
import { createRepositoryStub } from '../support/fakes.js';

async function makeApp() {
  return buildApp({
    service: {
      searchProducts: async () => ({ query: '', items: [], freshness: { cached: false, generatedAt: new Date().toISOString() } }),
      getProduct: async () => { throw new Error('not exercised'); },
      batchGetProducts: async () => ({ items: [] }),
    } as never,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

describe('GET /v1/products/semantics/registry', () => {
  it('projects the complete, ordered v3 registry using only public vocabulary fields', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/semantics/registry',
      headers: { 'x-api-key': 'test-api-key' },
    });

    const registry = getCommercialProductOntologyRegistry(commercialProductOntologyRegistryVersionV3);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: '1',
      ontologyVersion: commercialProductOntologyRegistryVersionV3,
      ontologyHash: computeCommercialProductOntologyRegistryHash(registry),
      status: 'PUBLISHED',
      axes: registry.axes.map(({ axis, tags }) => ({
        axis,
        values: tags.map(({ code, labelEs, definition, status, residual }) => ({
          code,
          labelEs,
          definition,
          status,
          residual,
        })),
      })),
    });
    expect(response.json().ontologyHash).toBe('f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955');

    const payload = response.json();
    expect(payload.axes.map((entry: { axis: string }) => entry.axis)).toEqual([
      'PRODUCT_FAMILY',
      'DISCIPLINE',
      'USE_CONTEXT',
    ]);
    expect(payload.axes.flatMap((entry: { values: unknown[] }) => entry.values)).toHaveLength(registry.tags.length);
    expect(payload.axes[0].values.find((value: { code: string }) => value.code === 'OTHER')).toMatchObject({
      code: 'OTHER',
      status: 'RESIDUAL',
      residual: true,
    });
    expect(payload.axes[1].values.some((value: { code: string }) => value.code === 'HYROX')).toBe(true);
    expect(payload.axes[2].values.some((value: { code: string }) => value.code === 'HOME_GYM')).toBe(true);
    expect(payload.axes[0].values.some((value: { code: string }) => value.code === 'DUMBBELL')).toBe(true);
    expect(payload.axes[1].values.some((value: { code: string }) => value.code === 'WEIGHTLIFTING')).toBe(false);

    const valueKeys = Object.keys(payload.axes[0].values[0]);
    expect(valueKeys.sort()).toEqual(['code', 'definition', 'labelEs', 'residual', 'status']);
    await app.close();
  });

  it('preserves deterministic axis and value ordering across requests', async () => {
    const app = await makeApp();
    const first = await app.inject({ method: 'GET', url: '/v1/products/semantics/registry', headers: { 'x-api-key': 'test-api-key' } });
    const second = await app.inject({ method: 'GET', url: '/v1/products/semantics/registry', headers: { 'x-api-key': 'test-api-key' } });

    expect(first.body).toBe(second.body);
    await app.close();
  });

  it('uses the existing API-key boundary', async () => {
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/v1/products/semantics/registry' });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
