import { describe, expect, it } from 'vitest';
import { MySqlSearchProvider } from '../../src/infrastructure/search/mysqlSearchProvider.js';
import { createRepositoryStub } from '../support/fakes.js';

describe('MySqlSearchProvider', () => {
  it('prioritizes exact SKU matches', async () => {
    const repository = createRepositoryStub({
      getSearchCandidates: async () => [
        {
          productId: 1,
          combinationId: 11,
          productSku: 'PROD',
          combinationSku: 'SKU-EXACT',
          productName: 'Disco bumper',
          shortDescription: 'something',
          longDescription: null,
          variantLabel: 'Peso: 20 kg',
          physicalQuantity: 4,
          hasVariants: true,
          isDefault: true,
          active: true,
        },
        {
          productId: 2,
          combinationId: 0,
          productSku: 'OTHER',
          combinationSku: null,
          productName: 'Disco bumper',
          shortDescription: 'something',
          longDescription: null,
          variantLabel: null,
          physicalQuantity: 8,
          hasVariants: false,
          isDefault: false,
          active: true,
        },
      ],
    });

    const provider = new MySqlSearchProvider(repository);
    const results = await provider.search('SKU-EXACT', 5, false);

    expect(results[0]?.productId).toBe(1);
    expect(results[0]?.matchType).toBe('exact_sku');
  });

  it('matches partial product names', async () => {
    const repository = createRepositoryStub({
      getSearchCandidates: async () => [
        {
          productId: 1,
          combinationId: 0,
          productSku: 'OTHER',
          combinationSku: null,
          productName: 'Disco bumper olímpico 20 kg',
          shortDescription: 'Disco olímpico de caucho',
          longDescription: null,
          variantLabel: null,
          physicalQuantity: 8,
          hasVariants: false,
          isDefault: false,
          active: true,
        },
      ],
    });

    const provider = new MySqlSearchProvider(repository);
    const results = await provider.search('bumper', 5, false);

    expect(results[0]?.matchType).toBe('partial_name');
    expect(results[0]?.available).toBe(true);
  });
});
