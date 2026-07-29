import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import {
  DefaultExploreProductsService,
  ExploreProductsError,
  type CatalogExploreDataReader,
  type ExploreProductsRequest,
  type ExploreProductsResponse,
  type ExploreProductsService,
} from '../../src/application/catalog/explore-products/index.js';
import type { ExploreCatalogProductRow } from '../../src/application/catalog/explore-products/index.js';
import { createRepositoryStub } from '../support/fakes.js';

function catalogServiceStub() {
  return {
    searchProducts: vi.fn(),
    getProduct: vi.fn(),
    batchGetProducts: vi.fn(),
  } as never;
}

async function makeApp(exploreProductsService?: ExploreProductsService) {
  return buildApp({
    service: catalogServiceStub(),
    exploreProductsService,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

function row(overrides: Partial<ExploreCatalogProductRow> = {}): ExploreCatalogProductRow {
  const productId = overrides.productId ?? '1';
  return {
    productId,
    name: `Producto ${productId}`,
    reference: null,
    description: null,
    defaultCategoryId: '10',
    defaultCategoryName: 'Maquinas',
    defaultCategorySlug: 'maquinas',
    categoryIds: ['10'],
    categoryNames: ['Maquinas'],
    categorySlugs: ['maquinas'],
    attributeText: null,
    featureText: null,
    hasCombinations: false,
    defaultCombinationId: null,
    productBasePriceNet: 1000,
    combinationImpactNet: 0,
    active: true,
    availableForOrder: true,
    stockQuantity: 1,
    ...overrides,
  };
}

function reader(products: readonly ExploreCatalogProductRow[] = [row()], fail = false): CatalogExploreDataReader {
  return {
    async resolveCategory() {
      return { found: true, categoryIds: ['10'] };
    },
    async readProducts() {
      if (fail) throw new Error('db down');
      return { products, specificPrices: [], exhaustiveForScope: true };
    },
  };
}

class FakeExploreProductsService implements ExploreProductsService {
  readonly calls: unknown[] = [];

  failWith: Error | null = null;

  async explore(input: unknown): Promise<ExploreProductsResponse> {
    this.calls.push(input);
    if (this.failWith) throw this.failWith;
    const request = input as ExploreProductsRequest;
    return {
      scope: {
        ...(request.productType === undefined ? {} : { productType: request.productType }),
        availability: request.availability ?? 'all',
      },
      sort: request.sort,
      totalMatched: 1,
      exhaustiveForScope: true,
      ...(request.productType === undefined ? {} : { classificationSource: 'category' as const }),
      products: [{
        productId: '1',
        name: 'Maquina',
        price: 1190,
        currency: 'CLP',
        stockQuantity: 1,
        stockScope: 'product',
        availability: 'available',
      }],
    };
  }
}

const validPayload = {
  productType: 'machine',
  availability: 'available',
  sort: { by: 'price', direction: 'desc' },
  limit: 1,
} as const;

describe('Explore Products HTTP endpoint', () => {
  it('returns 200 for valid POST /v1/products/explore', async () => {
    const service = new FakeExploreProductsService();
    const app = await makeApp(service);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      headers: { 'x-api-key': 'test-api-key' },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      totalMatched: 1,
      exhaustiveForScope: true,
      classificationSource: 'category',
    });
    expect(service.calls).toHaveLength(1);
    await app.close();
  });

  it('rejects limit above 10 with invalid_limit', async () => {
    const app = await makeApp(new DefaultExploreProductsService({ dataReader: reader() }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { sort: { by: 'price', direction: 'desc' }, limit: 11 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_limit');
    await app.close();
  });

  it('returns stockScope for variant aggregate stock', async () => {
    const app = await makeApp(new DefaultExploreProductsService({
      dataReader: reader([
        row({
          productId: '1582',
          name: 'Producto con variantes',
          hasCombinations: true,
          defaultCombinationId: '333',
          stockQuantity: 533,
        }),
      ]),
    }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { query: 'Producto con variantes', sort: { by: 'name', direction: 'asc' }, limit: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().products[0]).toMatchObject({
      productId: '1582',
      stockQuantity: 533,
      stockScope: 'product_aggregate',
      availability: 'available',
    });
    await app.close();
  });

  it('rejects invalid sort with invalid_sort', async () => {
    const app = await makeApp(new DefaultExploreProductsService({ dataReader: reader() }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { sort: { by: 'rating', direction: 'desc' }, limit: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_sort');
    await app.close();
  });

  it('rejects inverted price ranges with invalid_price_range', async () => {
    const app = await makeApp(new DefaultExploreProductsService({ dataReader: reader() }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { price: { min: 2000, max: 1000 }, sort: { by: 'price', direction: 'asc' }, limit: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_price_range');
    await app.close();
  });

  it('maps category_not_found to 404', async () => {
    const failingCategoryReader: CatalogExploreDataReader = {
      async resolveCategory() {
        return { found: false, categoryIds: [] };
      },
      async readProducts() {
        return { products: [], specificPrices: [], exhaustiveForScope: true };
      },
    };
    const app = await makeApp(new DefaultExploreProductsService({ dataReader: failingCategoryReader }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { categorySlug: 'missing', sort: { by: 'name', direction: 'asc' }, limit: 1 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('category_not_found');
    await app.close();
  });

  it('returns 503 when the service is not configured', async () => {
    const app = await makeApp(undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      headers: { 'x-api-key': 'test-api-key' },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('catalog_source_unavailable');
    await app.close();
  });

  it('maps catalog source failures to catalog_source_unavailable', async () => {
    const app = await makeApp(new DefaultExploreProductsService({ dataReader: reader([], true) }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { sort: { by: 'name', direction: 'asc' }, limit: 1 },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('catalog_source_unavailable');
    await app.close();
  });

  it('sanitizes unexpected errors', async () => {
    const service = new FakeExploreProductsService();
    service.failWith = new ExploreProductsError('internal_error', 'secret failure', 500);
    const app = await makeApp(service);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      headers: { 'x-api-key': 'test-api-key' },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toBe('Internal server error');
    expect(JSON.stringify(response.json())).not.toContain('secret');
    await app.close();
  });

  it('returns 401 without api key', async () => {
    const app = await makeApp(new FakeExploreProductsService());
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/explore',
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('exposes request, response and errors in OpenAPI', async () => {
    const app = await makeApp(new FakeExploreProductsService());
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    const openapi = response.json();
    const operation = openapi.paths['/v1/products/explore'].post;

    expect(operation.requestBody.content['application/json'].schema.properties.sort).toBeTruthy();
    const productSchema = operation.responses['200'].content['application/json'].schema.properties.products.items;
    expect(productSchema.properties.stockScope.enum).toEqual(['product', 'product_aggregate']);
    expect(productSchema.required).toContain('stockScope');
    expect(operation.responses['400'].content['application/json'].schema.properties.error.properties.code.enum)
      .toContain('invalid_limit');
    expect(operation.responses['503'].content['application/json'].schema.properties.error.properties.code.enum)
      .toContain('catalog_source_unavailable');
    await app.close();
  });
});
