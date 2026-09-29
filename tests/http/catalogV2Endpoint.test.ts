import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { CatalogContractService } from '../../src/application/catalog/v2/catalogContractService.js';
import type { CatalogV2DataReader, CatalogV2Product } from '../../src/domain/catalog/v2/contracts.js';
import { createRepositoryStub } from '../support/fakes.js';

afterEach(() => vi.restoreAllMocks());

const sampleProduct: CatalogV2Product = {
  productId: 10,
  basePriceNet: 100000,
  name: 'Barra olímpica',
  sku: 'BAR-10',
  shortDescription: 'Barra comercial',
  brand: null,
  weightKg: 20,
  linkRewrite: 'barra-olimpica',
  category: { id: '3', name: 'Barras' },
  active: true,
  listed: true,
  orderable: true,
  variants: [{ combinationId: 0, sku: 'BAR-10', attributes: [], impactPriceNet: 0, isDefault: true, availableQuantity: 0, outOfStock: 1 }],
  specifications: [],
  globalBackorderAllowed: null,
  specificPrices: [],
  asOf: '2026-09-29T12:00:00.000Z',
};

function makeContractService() {
  const reader: CatalogV2DataReader = {
    async readProducts() {
      return { products: [sampleProduct], asOf: '2026-09-29T12:00:00.000Z' };
    },
  };
  return new CatalogContractService({ reader });
}

function makeApp(catalogContractService = makeContractService()) {
  return buildApp({
    service: {
      searchProducts: vi.fn(),
      getProduct: vi.fn(),
      batchGetProducts: vi.fn(),
    } as never,
    catalogContractService,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

describe('Catalog v2 HTTP contract', () => {
  it('returns product-level search results and keeps zero stock visible', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v2/catalog/search',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { query: 'barra', limit: 5 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].itemKey).toBe('P10');
    expect(response.json().results[0].availabilitySummary.sellability).toBe('backorder');
    await app.close();
  });

  it('returns product and concrete item context through separate surfaces', async () => {
    const app = await makeApp();
    const product = await app.inject({ method: 'GET', url: '/v2/catalog/products/P10/context', headers: { 'x-api-key': 'test-api-key' } });
    const item = await app.inject({ method: 'GET', url: '/v2/catalog/items/P10/context?quantity=2', headers: { 'x-api-key': 'test-api-key' } });
    expect(product.statusCode).toBe(200);
    expect(product.json().status).toBe('found');
    expect(item.statusCode).toBe(200);
    expect(item.json().itemKey).toBe('P10');
    expect(item.json().pricing.quantity).toBe(2);
    await app.close();
  });

  it('normalizes invalid requests and preserves correlation id', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v2/catalog/search',
      headers: { 'x-api-key': 'test-api-key', 'x-correlation-id': 'catalog-v2-test' },
      payload: { query: '%' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['x-correlation-id']).toBe('catalog-v2-test');
    expect(response.json().error.code).toBe('invalid_request');
    await app.close();
  });
});
