import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { createRepositoryStub } from '../support/fakes.js';
import { batchRequestSchema, batchResponseSchema, productResponseSchema, searchItemSchema, searchResponseSchema } from '../../src/shared/contracts.js';
import { catalogToolDefinition, catalogToolInputSchema } from '../../client/types.js';
import { exploreProductsProductSchema } from '../../src/application/catalog/explore-products/index.js';
import { searchProductsV2CatalogProductSummarySchema } from '../../src/application/recommendation/search-products-v2/index.js';

function validProductPayload(overrides: Record<string, unknown> = {}) {
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
    weightKg: 20,
    freshness: {
      productCheckedAt: '2026-01-01T00:00:00.000Z',
      priceCalculatedAt: null,
      stockCheckedAt: null,
      cached: false,
    },
    ...overrides,
  };
}

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
        getProduct: async () => validProductPayload(),
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
    expect(productPayload.weightKg).toBe(20);

    const batch = batchRequestSchema.parse({ items: [{ productId: 1, combinationId: 0, quantity: 1 }] });
    expect(batch.items[0]?.productId).toBe(1);
    expect(batchResponseSchema.parse({ items: [] })).toEqual({ items: [] });
    await app.close();
  }, 15000);

  describe('weightKg (CAT-R1-T13B)', () => {
    it('requires the weightKg key to be present', () => {
      const { weightKg: _weightKg, ...withoutWeight } = validProductPayload();
      expect(() => productResponseSchema.parse(withoutWeight)).toThrow();
    });

    it('accepts a positive weightKg', () => {
      expect(productResponseSchema.parse(validProductPayload({ weightKg: 20.5 })).weightKg).toBe(20.5);
    });

    it('accepts a literal zero weightKg', () => {
      expect(productResponseSchema.parse(validProductPayload({ weightKg: 0 })).weightKg).toBe(0);
    });

    it('accepts a null weightKg', () => {
      expect(productResponseSchema.parse(validProductPayload({ weightKg: null })).weightKg).toBeNull();
    });

    it('rejects a negative weightKg', () => {
      expect(() => productResponseSchema.parse(validProductPayload({ weightKg: -1 }))).toThrow();
    });

    it('rejects a non-numeric weightKg', () => {
      expect(() => productResponseSchema.parse(validProductPayload({ weightKg: '20' }))).toThrow();
    });

    it('still rejects unknown top-level keys (.strict() is unaffected by the additive field)', () => {
      expect(() => productResponseSchema.parse(validProductPayload({ unexpectedField: 'x' }))).toThrow();
    });

    it('serializes weightKg on the actual HTTP wire response, not only on the in-memory domain object', async () => {
      const app = await buildApp({
        service: {
          searchProducts: async () => ({ query: '', items: [], freshness: { cached: false, generatedAt: '2026-01-01T00:00:00.000Z' } }),
          getProduct: async () => validProductPayload({ weightKg: 20.5 }),
          batchGetProducts: async () => ({ items: [] }),
        } as never,
        repository: createRepositoryStub(),
        readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/products/1',
        headers: { 'x-api-key': 'test-api-key' },
      });
      const body = response.json() as Record<string, unknown>;

      // Guards the exact CAT-R1-T13A risk: Fastify derives its response JSON Schema from
      // productResponseSchema, so a field present on the domain object but absent from that
      // schema would be silently stripped here rather than raising an error.
      expect(body).toHaveProperty('weightKg');
      expect(body.weightKg).toBe(20.5);
      await app.close();
    });

    it('does not add weightKg to search_products, explore_catalog, or recommend_catalog_products contracts', () => {
      expect(Object.keys(searchItemSchema.shape)).not.toContain('weightKg');
      expect(Object.keys(exploreProductsProductSchema.shape)).not.toContain('weightKg');
      expect(Object.keys(searchProductsV2CatalogProductSummarySchema.shape)).not.toContain('weightKg');
    });
  });
});
