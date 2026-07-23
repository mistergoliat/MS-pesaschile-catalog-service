import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { createRepositoryStub } from '../support/fakes.js';
import { batchRequestSchema, batchResponseSchema, productResponseSchema, searchResponseSchema } from '../../src/shared/contracts.js';
import { catalogToolDefinition, catalogToolInputSchema } from '../../client/types.js';

describe('contracts', () => {
  it('accepts the catalog tool inputs', () => {
    expect(
      catalogToolInputSchema.parse({
        operation: 'search',
        query: 'disco bumper',
        limit: 5,
        includeOutOfStock: false,
      }),
    ).toMatchObject({ operation: 'search' });
    expect(catalogToolDefinition.name).toBe('catalog');
  });

  it('keeps server responses compatible with schemas', async () => {
    const app = await buildApp({
      service: {
        searchProducts: async () => ({
          query: 'disco bumper',
          items: [],
          freshness: { cached: false, generatedAt: '2026-01-01T00:00:00.000Z' },
        }),
        getProduct: async () => ({
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
          freshness: {
            productCheckedAt: '2026-01-01T00:00:00.000Z',
            priceCalculatedAt: null,
            stockCheckedAt: null,
            cached: false,
          },
        }),
        batchGetProducts: async () => ({ items: [] }),
      } as never,
      repository: createRepositoryStub(),
      readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
    });

    const search = await app.inject({
      method: 'GET',
      url: '/v1/products/search?q=disco%20bumper',
      headers: { 'x-api-key': 'test-api-key' },
    });
    const searchPayload = searchResponseSchema.parse(search.json());
    expect(searchPayload.query).toBe('disco bumper');

    const product = await app.inject({
      method: 'GET',
      url: '/v1/products/1',
      headers: { 'x-api-key': 'test-api-key' },
    });
    const productPayload = productResponseSchema.parse(product.json());
    expect(productPayload.product.productId).toBe(1);

    const batch = batchRequestSchema.parse({ items: [{ productId: 1, combinationId: 0, quantity: 1 }] });
    expect(batch.items[0]?.productId).toBe(1);
    expect(batchResponseSchema.parse({ items: [] })).toEqual({ items: [] });
    await app.close();
  }, 15000);
});
