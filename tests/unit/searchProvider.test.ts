import { describe, expect, it, vi } from 'vitest';
import type { SearchCandidate } from '../../src/domain/catalog/ports.js';
import { MySqlSearchProvider } from '../../src/infrastructure/search/mysqlSearchProvider.js';
import { createRepositoryStub } from '../support/fakes.js';

function candidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    productId: 545,
    combinationId: 0,
    productSku: 'BAR-20',
    combinationSku: null,
    productName: 'Barra Olimpica 20kg',
    shortDescription: 'Barra olimpica 20kg de entrenamiento',
    longDescription: null,
    variantLabel: null,
    physicalQuantity: 3,
    hasVariants: false,
    isDefault: false,
    active: true,
    ...overrides,
  };
}

const historicalCompactBarCandidates = [
  candidate({
    productId: 545,
    productSku: 'BORE20',
    productName: 'Barra Olimpica 20kg 220cm Eco Serie | PROmachine',
    shortDescription: 'Barra olimpica 20kg',
  }),
  candidate({
    productId: 31,
    productSku: 'BORP',
    productName: 'Barra Olimpica 20kg Classic Serie | PROmachine',
    shortDescription: 'Barra olimpica 20kg',
  }),
  candidate({
    productId: 21,
    productSku: 'BOEH',
    productName: 'Barra Olimpica 20kg Elite | HWM',
    shortDescription: 'Barra olimpica 20kg',
  }),
  candidate({
    productId: 32,
    productSku: 'BORT',
    productName: 'Barra Olimpica 20kg Training | HWM',
    shortDescription: 'Barra olimpica 20kg',
  }),
];

describe('MySqlSearchProvider', () => {
  it('finds compact unit matches when the query uses spaced units', async () => {
    const repository = createRepositoryStub({
      getSearchCandidates: async (query) =>
        query === 'barra olimpica 20kg'
          ? [candidate()]
          : [],
    });

    const provider = new MySqlSearchProvider(repository);
    const results = await provider.search('barra olimpica 20 kg', 5, false);

    expect(results.map((result) => result.productId)).toEqual([545]);
  });

  it('keeps equivalent unit queries aligned for identity, match type, and ordering', async () => {
    const repository = createRepositoryStub({
      getSearchCandidates: async (query) =>
        query === 'barra olimpica 20kg'
          ? [
              candidate({
                productId: 545,
                productName: 'Barra Ol\u00edmpica 20kg Classic',
                shortDescription: 'Barra olimpica 20kg',
              }),
            ]
          : [],
    });

    const provider = new MySqlSearchProvider(repository);
    const spaced = await provider.search('barra ol\u00edmpica 20 kg', 5, false);
    const compact = await provider.search('barra olimpica 20kg', 5, false);

    expect(spaced.map((result) => [result.productId, result.combinationId])).toEqual([[545, 0]]);
    expect(compact.map((result) => [result.productId, result.combinationId])).toEqual([[545, 0]]);
    expect(spaced[0]?.matchType).toBe('partial_name');
    expect(compact[0]?.matchType).toBe('partial_name');
  });

  it('preserves the historical compact query behavior and converges spaced units to it', async () => {
    const repository = createRepositoryStub({
      getSearchCandidates: async (query) =>
        query === 'barra olimpica 20kg'
          ? historicalCompactBarCandidates
          : [],
    });

    const provider = new MySqlSearchProvider(repository);
    const historicalCompact = await provider.search('barra olimpica 20kg', 10, true);
    const spaced = await provider.search('barra ol\u00edmpica 20 kg', 10, true);

    const expectedIdentities = ['545:0', '31:0', '21:0', '32:0'];
    expect(historicalCompact.map((result) => `${result.productId}:${result.combinationId}`)).toEqual(expectedIdentities);
    expect(spaced.map((result) => `${result.productId}:${result.combinationId}`)).toEqual(expectedIdentities);
    expect(historicalCompact.map((result) => result.matchType)).toEqual([
      'partial_name',
      'partial_name',
      'partial_name',
      'partial_name',
    ]);
    expect(spaced.map((result) => result.matchType)).toEqual(historicalCompact.map((result) => result.matchType));
    expect(historicalCompact.map((result) => result.name)).toEqual([
      'Barra Olimpica 20kg 220cm Eco Serie | PROmachine',
      'Barra Olimpica 20kg Classic Serie | PROmachine',
      'Barra Olimpica 20kg Elite | HWM',
      'Barra Olimpica 20kg Training | HWM',
    ]);
    expect(spaced.map((result) => result.name)).toEqual(historicalCompact.map((result) => result.name));
  });

  it('matches normalized query tokens when the product name contains words between them', async () => {
    const repository = createRepositoryStub({
      getSearchCandidates: async (query) =>
        query === 'barra 20kg'
          ? [
              candidate({
                productName: 'Barra Ol\u00edmpica 20kg Classic',
                shortDescription: 'Barra olimpica de 20kg',
              }),
            ]
          : [],
    });

    const provider = new MySqlSearchProvider(repository);
    const results = await provider.search('barra 20 KG', 5, false);

    expect(results.map((result) => result.productId)).toEqual([545]);
    expect(results[0]?.matchType).toBe('partial_name');
  });

  it('deduplicates repository calls when the original query is already canonical', async () => {
    const getSearchCandidates = vi.fn(async (_query: string, _includeOutOfStock: boolean, _limit: number) => [candidate()]);
    const repository = createRepositoryStub({ getSearchCandidates });
    const provider = new MySqlSearchProvider(repository);

    await provider.search('barra olimpica 20kg', 5, false);

    expect(getSearchCandidates).toHaveBeenCalledTimes(1);
    expect(getSearchCandidates).toHaveBeenCalledWith('barra olimpica 20kg', false, 5);
  });

  it('deduplicates the same product and combination returned by multiple variants', async () => {
    const getSearchCandidates = vi.fn(async (_query: string, _includeOutOfStock: boolean, _limit: number) => [candidate()]);
    const repository = createRepositoryStub({ getSearchCandidates });
    const provider = new MySqlSearchProvider(repository);

    const results = await provider.search('barra olimpica 20 kg', 5, false);

    expect(getSearchCandidates).toHaveBeenCalledTimes(2);
    expect(getSearchCandidates.mock.calls.map((call) => call[0])).toEqual([
      'barra olimpica 20 kg',
      'barra olimpica 20kg',
    ]);
    expect(results.map((result) => `${result.productId}:${result.combinationId}`)).toEqual(['545:0']);
  });

  it('keeps distinct candidates found by different variants', async () => {
    const getSearchCandidates = vi.fn(async (query: string, _includeOutOfStock: boolean, _limit: number) => {
      if (query === 'barra olimpica 20 kg') {
        return [candidate({ productId: 100, productName: 'Barra Olimpica 20kg Alpha' })];
      }
      if (query === 'barra olimpica 20kg') {
        return [candidate({ productId: 200, productName: 'Barra Olimpica 20kg Beta' })];
      }
      return [];
    });
    const repository = createRepositoryStub({ getSearchCandidates });
    const provider = new MySqlSearchProvider(repository);

    const results = await provider.search('barra olimpica 20 kg', 5, false);

    expect(results.map((result) => result.productId)).toEqual([100, 200]);
  });

  it('applies the requested limit after merging, deduplicating, and ranking variants', async () => {
    const getSearchCandidates = vi.fn(async (query: string, _includeOutOfStock: boolean, _limit: number) => {
      if (query === 'barra olimpica 20 kg') {
        return [
          candidate({ productId: 100, productName: 'Zulu', shortDescription: 'barra olimpica 20kg' }),
          candidate({ productId: 101, productName: 'Yankee', shortDescription: 'barra olimpica 20kg' }),
        ];
      }
      if (query === 'barra olimpica 20kg') {
        return [
          candidate({ productId: 102, productName: 'Barra Olimpica 20kg Exact' }),
        ];
      }
      return [];
    });
    const repository = createRepositoryStub({ getSearchCandidates });
    const provider = new MySqlSearchProvider(repository);

    const results = await provider.search('barra olimpica 20 kg', 1, false);

    expect(getSearchCandidates.mock.calls.map((call) => call[2])).toEqual([1, 1]);
    expect(results).toHaveLength(1);
    expect(results[0]?.productId).toBe(102);
    expect(results[0]?.matchType).toBe('partial_name');
  });

  it('keeps later exact SKU matches ahead of earlier partial name matches after variant merging', async () => {
    const getSearchCandidates = vi.fn(async (query: string) => {
      if (query === 'REF 20 KG X') {
        return [candidate({ productId: 100, productSku: 'OTHER', productName: 'REF 20KG X Training' })];
      }
      if (query === 'ref 20kg x') {
        return [candidate({ productId: 101, productSku: 'REF 20KG X', productName: 'Referencia Especial' })];
      }
      return [];
    });
    const repository = createRepositoryStub({ getSearchCandidates });
    const provider = new MySqlSearchProvider(repository);

    const results = await provider.search('REF 20 KG X', 2, false);

    expect(results.map((result) => result.productId)).toEqual([101, 100]);
    expect(results.map((result) => result.matchType)).toEqual(['exact_sku', 'partial_name']);
  });

  it('preserves variants with the same product id and different combination ids', async () => {
    const getSearchCandidates = vi.fn(async (query: string) => {
      if (query === 'barra olimpica 20 kg') {
        return [candidate({ productId: 10, combinationId: 1, productName: 'Barra Olimpica 20kg Alpha' })];
      }
      if (query === 'barra olimpica 20kg') {
        return [candidate({ productId: 10, combinationId: 2, productName: 'Barra Olimpica 20kg Beta' })];
      }
      return [];
    });
    const repository = createRepositoryStub({ getSearchCandidates });
    const provider = new MySqlSearchProvider(repository);

    const results = await provider.search('barra olimpica 20 kg', 5, false);

    expect(results.map((result) => `${result.productId}:${result.combinationId}`)).toEqual(['10:1', '10:2']);
  });

  it.each([
    ['M20', candidate({ productId: 1, productSku: 'M20', productName: 'Modelo M20' })],
    ['M-20', candidate({ productId: 2, productSku: 'M-20', productName: 'Modelo M-20' })],
    ['20M', candidate({ productId: 3, productSku: null, combinationSku: '20M', productName: 'Cable 20M' })],
    ['REF 20 KG X', candidate({ productId: 4, productSku: 'REF 20 KG X', productName: 'Referencia Especial' })],
  ])('keeps the original reference query variant available for %s', async (query, foundCandidate) => {
    const getSearchCandidates = vi.fn(async (variant: string) => (variant === query ? [foundCandidate] : []));
    const repository = createRepositoryStub({ getSearchCandidates });
    const provider = new MySqlSearchProvider(repository);

    const results = await provider.search(query, 5, false);

    expect(getSearchCandidates.mock.calls[0]?.[0]).toBe(query);
    expect(results.map((result) => result.productId)).toEqual([foundCandidate.productId]);
    expect(results[0]?.matchType).toBe('exact_sku');
  });

  it('does not collapse different references that normalize to compatible unit text', async () => {
    const getSearchCandidates = vi.fn(async (query: string) => {
      if (query === 'ABC-20-KG') {
        return [candidate({ productId: 10, productSku: 'ABC-20-KG', productName: 'Reference A' })];
      }
      if (query === 'abc-20kg') {
        return [candidate({ productId: 11, productSku: 'ABC-20KG', productName: 'Reference B' })];
      }
      return [];
    });
    const repository = createRepositoryStub({ getSearchCandidates });
    const provider = new MySqlSearchProvider(repository);

    const results = await provider.search('ABC-20-KG', 5, false);

    expect(getSearchCandidates.mock.calls.map((call) => call[0])).toEqual(['ABC-20-KG', 'abc-20kg']);
    expect(results.map((result) => `${result.productId}:${result.sku}`)).toEqual([
      '10:ABC-20-KG',
      '11:ABC-20KG',
    ]);
    expect(results.map((result) => result.matchType)).toEqual(['exact_sku', 'exact_sku']);
  });

  it('propagates repository errors from later variants instead of returning partial results', async () => {
    const repositoryError = Object.assign(new Error('Query inactivity timeout'), {
      code: 'PROTOCOL_SEQUENCE_TIMEOUT',
      errno: 'PROTOCOL_SEQUENCE_TIMEOUT',
      syscall: 'query',
    });
    const getSearchCandidates = vi.fn(async (query: string) => {
      if (query === 'barra olimpica 20 kg') {
        return [candidate()];
      }
      throw repositoryError;
    });
    const repository = createRepositoryStub({ getSearchCandidates });
    const provider = new MySqlSearchProvider(repository);

    await expect(provider.search('barra olimpica 20 kg', 5, false)).rejects.toBe(repositoryError);
    expect(getSearchCandidates.mock.calls.map((call) => call[0])).toEqual([
      'barra olimpica 20 kg',
      'barra olimpica 20kg',
    ]);
  });

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

  it('excludes known internal products from discovery results before ranking and limit', async () => {
    const repository = createRepositoryStub({
      getSearchCandidates: async () => [
        {
          productId: 444,
          combinationId: 0,
          productSku: 'SERVICIO',
          combinationSku: null,
          productName: 'Servicio vendedor Pesas Chile',
          shortDescription: 'Servicio interno',
          longDescription: null,
          variantLabel: null,
          physicalQuantity: 99999,
          hasVariants: false,
          isDefault: false,
          active: true,
        },
        {
          productId: 505,
          combinationId: 0,
          productSku: 'LOGISTICA',
          combinationSku: null,
          productName: 'Costo logistico',
          shortDescription: 'Costo interno',
          longDescription: null,
          variantLabel: null,
          physicalQuantity: 99999,
          hasVariants: false,
          isDefault: false,
          active: true,
        },
        {
          productId: 12,
          combinationId: 0,
          productSku: 'BANCA',
          combinationSku: null,
          productName: 'Banca ajustable',
          shortDescription: 'Banca de entrenamiento',
          longDescription: null,
          variantLabel: null,
          physicalQuantity: 4,
          hasVariants: false,
          isDefault: false,
          active: true,
        },
      ],
    });

    const provider = new MySqlSearchProvider(repository);
    const results = await provider.search('banca', 1, true);

    expect(results.map((result) => result.productId)).toEqual([12]);
  });
});
