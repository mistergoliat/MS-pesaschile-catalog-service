import { describe, expect, it } from 'vitest';
import { MySqlCatalogRepository } from '../../src/infrastructure/repositories/mysqlCatalogRepository.js';

type QueryCall = {
  readonly sql: string;
  readonly values: readonly unknown[];
};

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

  it('adds unit-token name matching only for two-token unit searches', async () => {
    const fake = poolWithRows([[]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    await repository.getSearchCandidates('barra 20kg', false, 5);

    const call = fake.calls[0];
    expect(call).toBeDefined();
    expect(call!.sql).toContain('(pl.name LIKE ? AND pl.name LIKE ?)');
    expect(call!.sql).not.toContain('%barra%');
    expect(call!.sql).not.toContain('%20kg%');
    expect(call!.sql).not.toContain('(pl.description_short LIKE ? AND pl.description_short LIKE ?)');
    expect(call!.sql).not.toContain('(pl.description LIKE ? AND pl.description LIKE ?)');
    expect(call!.values.slice(11, 13)).toEqual([
      '%barra%',
      '%20kg%',
    ]);
  });

  it('does not add unit-token name matching for the historical full canonical query', async () => {
    const fake = poolWithRows([[]]);
    const repository = new MySqlCatalogRepository(fake.pool as never);

    await repository.getSearchCandidates('barra olimpica 20kg', false, 5);

    const call = fake.calls[0];
    expect(call).toBeDefined();
    expect(call!.sql).not.toContain('(pl.name LIKE ? AND pl.name LIKE ?)');
    expect(call!.values.slice(-3)).toEqual([444, 505, 50]);
  });
});
