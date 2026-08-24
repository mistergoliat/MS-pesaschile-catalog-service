import { describe, expect, it } from 'vitest';
import { MySqlCatalogRepository } from '../../src/infrastructure/repositories/mysqlCatalogRepository.js';

type QueryCall = {
  readonly sql: string;
  readonly values: readonly unknown[];
};

function searchRow(overrides: Record<string, unknown> = {}) {
  return {
    productId: 545,
    combinationId: 0,
    productSku: 'BORE20',
    combinationSku: null,
    productName: 'Barra Olimpica 20kg 220cm Eco Serie | PROmachine',
    shortDescription: 'Barra olimpica 20kg',
    longDescription: null,
    variantLabel: null,
    physicalQuantity: 3,
    hasVariants: 0,
    isDefault: 0,
    active: 1,
    ...overrides,
  };
}

function poolWithRows(rows: readonly unknown[][]) {
  const calls: QueryCall[] = [];
  return {
    calls,
    pool: {
      async query(options: { sql: string; values: readonly unknown[] }) {
        calls.push({ sql: options.sql, values: options.values });
        return [rows[calls.length - 1] ?? [], undefined];
      },
    },
  };
}

describe('MySqlCatalogRepository discovery exclusions', () => {
  it('excludes known internal products in search SQL before the database limit', async () => {
    const fake = poolWithRows([[]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    await repository.getSearchCandidates('banca', false, 5);

    const call = fake.calls[0];
    expect(call).toBeDefined();
    const sql = call!.sql;
    expect(sql).toContain('p.id_product NOT IN (?, ?)');
    expect(sql.indexOf('p.id_product NOT IN (?, ?)')).toBeLessThan(sql.indexOf('ORDER BY p.id_product'));
    expect(sql.indexOf('p.id_product NOT IN (?, ?)')).toBeLessThan(sql.indexOf('LIMIT ?'));
    expect(call!.values.slice(-3)).toEqual([444, 505, 50]);
  });

  it('does not run token fallback when phrase results have full name coverage', async () => {
    const fake = poolWithRows([[searchRow()]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('barra olimpica 20kg', false, 5);

    expect(results).toHaveLength(1);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call).toBeDefined();
    expect(call!.sql).toContain('pl.name LIKE ?');
    expect(call!.values.slice(-3)).toEqual([444, 505, 50]);
  });

  it('runs token fallback when phrase results are empty', async () => {
    const fake = poolWithRows([[], [searchRow({ productId: 99, productName: 'Disco Bumper 10kg' })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('disco bumper', false, 5);

    expect(results.map((result) => result.productId)).toEqual([99]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.sql).toContain('pl.name LIKE ? AND pl.name LIKE ?');
    expect(fake.calls[1]!.sql).not.toContain('pl.description_short LIKE ?');
    expect(fake.calls[1]!.sql).not.toContain('pl.description LIKE ?');
    expect(fake.calls[1]!.values.slice(5, 7)).toEqual(['%disco%', '%bumper%']);
  });

  it('runs token fallback when phrase results have no full name coverage', async () => {
    const fake = poolWithRows([
      [searchRow({ productId: 1, productName: 'Implemento de entrenamiento', shortDescription: 'barra olimpica eco 20kg' })],
      [searchRow({ productId: 545 })],
    ]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('barra olimpica eco 20kg', false, 5);

    expect(results.map((result) => result.productId)).toEqual([1, 545]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.values.slice(5, 9)).toEqual([
      '%barra%',
      '%olimpica%',
      '%eco%',
      '%20kg%',
    ]);
  });

  it('does not expand short alphabetic token queries through token fallback', async () => {
    const fake = poolWithRows([[]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('barra pro', false, 5);

    expect(results).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it('does not run token fallback for non-canonical variants', async () => {
    const fake = poolWithRows([[]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('barra olímpica 20 kg', false, 5);

    expect(results).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it('does not expand a specific query that phrase search already satisfies', async () => {
    const fake = poolWithRows([[searchRow({ productId: 545 }), searchRow({ productId: 31, productSku: 'BORP' })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('barra olimpica 20kg', false, 5);

    expect(results.map((result) => result.productId)).toEqual([545, 31]);
    expect(fake.calls).toHaveLength(1);
  });
});

describe('MySqlCatalogRepository stopword retrieval fallback (A11.2-B)', () => {
  it('SEARCH01: drops "de" from the mandatory token fallback for "discos olimpicos de 20kg"', async () => {
    const fake = poolWithRows([
      [],
      [searchRow({ productId: 900, productName: 'Par Discos Olimpicos Grip Rubber 20kg | PROmachine' })],
    ]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('discos olimpicos de 20kg', false, 5);

    expect(results.map((result) => result.productId)).toEqual([900]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.sql).toContain('pl.name LIKE ? AND pl.name LIKE ? AND pl.name LIKE ?');
    expect(fake.calls[1]!.values.slice(5, 8)).toEqual(['%discos%', '%olimpicos%', '%20kg%']);
    expect(fake.calls[1]!.values).not.toContain('%de%');
  });

  it('SEARCH02: drops "de" from the mandatory token fallback for singular "disco olimpico de 20kg"', async () => {
    const fake = poolWithRows([
      [],
      [searchRow({ productId: 901, productName: 'Disco Olimpico Grip Rubber 20kg | PROmachine' })],
    ]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('disco olimpico de 20kg', false, 5);

    expect(results.map((result) => result.productId)).toEqual([901]);
    expect(fake.calls[1]!.sql).toContain('pl.name LIKE ? AND pl.name LIKE ? AND pl.name LIKE ?');
    expect(fake.calls[1]!.values.slice(5, 8)).toEqual(['%disco%', '%olimpico%', '%20kg%']);
    expect(fake.calls[1]!.values).not.toContain('%de%');
  });

  it('SEARCH03: keeps the existing all-substantive-token behavior for "discos olimpicos 20kg"', async () => {
    const fake = poolWithRows([[], [searchRow({ productId: 902 })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    await repository.getSearchCandidates('discos olimpicos 20kg', false, 5);

    expect(fake.calls[1]!.sql).toContain('pl.name LIKE ? AND pl.name LIKE ? AND pl.name LIKE ?');
    expect(fake.calls[1]!.values.slice(5, 8)).toEqual(['%discos%', '%olimpicos%', '%20kg%']);
  });

  it('SEARCH04: keeps the existing behavior for "disco olimpico 20 kg" (non-canonical variant skips fallback)', async () => {
    const fake = poolWithRows([[]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('disco olimpico 20 kg', false, 5);

    expect(results).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it('SEARCH07: drops "del" from the mandatory token fallback', async () => {
    const fake = poolWithRows([[], [searchRow({ productId: 903, productName: 'Barra Gimnasio 20kg' })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    await repository.getSearchCandidates('barra del gimnasio 20kg', false, 5);

    expect(fake.calls[1]!.sql).toContain('pl.name LIKE ? AND pl.name LIKE ? AND pl.name LIKE ?');
    expect(fake.calls[1]!.values.slice(5, 8)).toEqual(['%barra%', '%gimnasio%', '%20kg%']);
    expect(fake.calls[1]!.values).not.toContain('%del%');
  });

  it.each([
    ['el', 'disco el olimpico 20kg', ['%disco%', '%olimpico%', '%20kg%']],
    ['la', 'barra la olimpica 20kg', ['%barra%', '%olimpica%', '%20kg%']],
  ])('SEARCH08: drops the intermediate stopword "%s"', async (stopword, query, expectedValues) => {
    const fake = poolWithRows([[], [searchRow({ productId: 904 })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    await repository.getSearchCandidates(query, false, 5);

    expect(fake.calls[1]!.values.slice(5, 8)).toEqual(expectedValues);
    expect(fake.calls[1]!.values).not.toContain(`%${stopword}%`);
  });

  it.each([['de la'], ['el'], ['una']])(
    'SEARCH09: never runs a mandatory-token fallback for a stopwords-only query "%s"',
    async (query) => {
      const fake = poolWithRows([[]]);
      const repository = new MySqlCatalogRepository(fake.pool as never);

      const results = await repository.getSearchCandidates(query, false, 5);

      expect(results).toEqual([]);
      expect(fake.calls).toHaveLength(1);
    },
  );

  it('SEARCH10: never filters the unit token even when paired only with a stopword', async () => {
    const fake = poolWithRows([[], [searchRow({ productId: 905, productName: 'Disco 20kg' })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    await repository.getSearchCandidates('disco de 20kg', false, 5);

    expect(fake.calls[1]!.sql).toContain('pl.name LIKE ? AND pl.name LIKE ?');
    expect(fake.calls[1]!.values.slice(5, 7)).toEqual(['%disco%', '%20kg%']);
  });

  it('does not widen the fallback into an OR: still requires every mandatory token to match', async () => {
    const fake = poolWithRows([[], []]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const results = await repository.getSearchCandidates('producto inexistente de 20kg', false, 5);

    expect(results).toEqual([]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.sql).not.toContain(' OR ');
    expect(fake.calls[1]!.sql.match(/LIKE \?/gu)).toHaveLength(3);
  });
});

describe('MySqlCatalogRepository product weight (CAT-R1-T13B)', () => {
  function productCoreRow(overrides: Record<string, unknown> = {}) {
    return {
      id_product: 1,
      name: 'Barra Olimpica 20kg',
      sku: 'BAR-20',
      description_short: 'Barra olimpica',
      description: null,
      link_rewrite: 'barra-olimpica-20kg',
      baseWeight: 20,
      ...overrides,
    };
  }

  function variantRow(overrides: Record<string, unknown> = {}) {
    return {
      combinationId: 10,
      sku: 'BAR-20-RED',
      label: 'Color: Rojo',
      impactPrice: 0,
      physicalQuantity: 4,
      isDefault: 1,
      weightImpact: 0,
      ...overrides,
    };
  }

  it('reads p.weight as part of the existing product-core query, not a separate one', async () => {
    const fake = poolWithRows([[productCoreRow({ baseWeight: 20 })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const product = await repository.getProductCore(1);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.sql).toContain('p.weight AS baseWeight');
    expect(product?.baseWeightKg).toBe(20);
  });

  it('maps a decimal base weight without precision loss', async () => {
    const fake = poolWithRows([[productCoreRow({ baseWeight: 0.1 })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const product = await repository.getProductCore(1);

    expect(product?.baseWeightKg).toBe(0.1);
  });

  it('preserves a literal zero base weight (not coerced or dropped)', async () => {
    const fake = poolWithRows([[productCoreRow({ baseWeight: 0 })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const product = await repository.getProductCore(1);

    expect(product?.baseWeightKg).toBe(0);
  });

  it('reads combination weight impact as part of the existing variants query with shop-override precedence matching price', async () => {
    const fake = poolWithRows([[variantRow({ weightImpact: 0 })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const variants = await repository.getVariants(1);

    // getVariants issues the variants query plus a separate attributes-map query; the weight
    // impact column lives on the first (variants) query alongside price impact.
    const sql = fake.calls[0]!.sql;
    expect(sql).toContain('COALESCE(pas.weight, pa.weight, 0) AS weightImpact');
    // Same LEFT JOIN ... product_attribute_shop already used for price impact — no new join introduced.
    expect(sql.match(/product_attribute_shop/gu)).toHaveLength(1);
    expect(variants[0]?.weightImpactKg).toBe(0);
  });

  it('maps a non-zero synthetic combination weight impact (production currently has none live)', async () => {
    const fake = poolWithRows([[variantRow({ weightImpact: 2.5 })]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const variants = await repository.getVariants(1);

    expect(variants[0]?.weightImpactKg).toBe(2.5);
  });

  it('does not expose weightImpactKg through the discovery search candidate shape', async () => {
    const fake = poolWithRows([[searchRow()]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    const [candidate] = await repository.getSearchCandidates('barra olimpica 20kg', false, 5);

    expect(candidate).not.toHaveProperty('weightImpactKg');
    expect(candidate).not.toHaveProperty('baseWeightKg');
  });
});
