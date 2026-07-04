import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { CatalogApplicationService } from '../../src/application/catalogService.js';
import { createCacheStub, createPricingProviderStub, createRepositoryStub, createSearchProviderStub, createStockProviderStub } from '../support/fakes.js';
import { searchProducts, getProduct } from '../../client/catalogClient.js';

let appUrl: string | null = null;

afterEach(async () => {
  if (appUrl) {
    appUrl = null;
  }
});

describe('agent flow', () => {
  it('searches then retrieves grounded product details', async () => {
    const repository = createRepositoryStub({
      getProductCore: async () => ({
        productId: 123,
        name: 'Disco bumper olímpico 20 kg',
        sku: 'BUMPER',
        shortDescription: 'Disco olímpico de caucho',
        longDescription: 'Disco bumper de alta densidad',
        active: true,
      }),
      getVariants: async () => [
        {
          combinationId: 456,
          sku: 'BUMPER-20',
          label: 'Peso: 20 kg',
          attributes: [{ group: 'Peso', value: '20 kg' }],
          impactPrice: 0,
          physicalQuantity: 8,
          available: true,
          isDefault: true,
        },
      ],
      getDefaultCombinationId: async () => 456,
      getStock: async () => ({ physicalQuantity: 8, shopId: 1 }),
    });

    const service = new CatalogApplicationService({
      repository,
      searchProvider: createSearchProviderStub({
        search: async () => [
          {
            productId: 123,
            combinationId: 456,
            sku: 'BUMPER-20',
            name: 'Disco bumper olímpico 20 kg',
            variantLabel: 'Peso: 20 kg',
            shortDescription: 'Disco olímpico de caucho',
            physicalQuantity: 8,
            available: true,
            matchType: 'exact_sku',
          },
        ],
      }),
      stockProvider: createStockProviderStub({
        getStock: async () => ({ physicalQuantity: 8, available: true, shopId: 1 }),
      }),
      pricingProvider: createPricingProviderStub({
        quote: async () => ({
          quantity: 1,
          baseUnitPrice: 59990,
          effectiveUnitPrice: 49990,
          subtotal: 49990,
          currency: 'CLP',
          taxIncluded: true,
          taxMode: 'configured_rate',
          discountApplied: true,
          discountType: 'percentage',
          discountValue: 0.1667,
          specificPriceId: 1234,
          pricingMode: 'sql_specific_price',
        }),
      }),
      cache: createCacheStub(),
    });

    const app = await buildApp({
      service,
      repository,
      readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
    });

    const address = (await app.listen({ host: '127.0.0.1', port: 0 })) as string;
    appUrl = address;

    const context = {
      baseUrl: appUrl,
      apiKey: 'test-api-key',
      timeoutMs: 5000,
    };

    const search = await searchProducts({ query: 'disco bumper 20 kg', limit: 5 }, context);
    expect(search.items[0]?.productId).toBe(123);

    const product = await getProduct(
      { productId: search.items[0]!.productId, combinationId: search.items[0]!.combinationId, quantity: 2 },
      context,
    );

    expect(product.pricing?.effectiveUnitPrice).toBe(49990);
    expect(product.stock?.physicalQuantity).toBe(8);
    expect(product.selectedVariant?.combinationId).toBe(456);

    await app.close();
  });
});
