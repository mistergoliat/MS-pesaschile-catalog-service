import { describe, expect, it } from 'vitest';
import { MySqlCatalogCommercialDataReader } from '../../src/infrastructure/catalog/mysqlCatalogCommercialDataReader.js';

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

const context = {
  shopId: 1,
  currencyId: 1,
  currencyCode: 'CLP',
  countryId: 0,
  customerGroupId: 0,
  customerId: 0,
  quantity: 1,
  taxRate: 0.19,
};

describe('MySqlCatalogCommercialDataReader', () => {
  it('reads commercial data in a bounded batch without N+1 queries', async () => {
    const fake = poolWithRows([
      [
        {
          productId: 173,
          name: 'Barra',
          productReference: 'BAR-173',
          description: '<p>Texto</p>',
          category: 'Barras',
          active: 1,
          availableForOrder: 1,
          productBasePriceNet: 1000,
        },
      ],
      [{ productId: 173, combinationId: 0, stockQuantity: 7 }],
      [],
    ]);
    const reader = new MySqlCatalogCommercialDataReader(fake.pool as never);
    const result = await reader.read({
      products: [{ productId: '173' }],
      context,
    });
    expect(fake.calls).toHaveLength(3);
    expect(result.products[0]).toMatchObject({
      productId: 173,
      name: 'Barra',
      description: 'Texto',
      active: true,
      availableForOrder: true,
      stockQuantity: 7,
    });
  });

  it('does not filter inactive products at SQL level', async () => {
    const fake = poolWithRows([[], [], [], []]);
    const reader = new MySqlCatalogCommercialDataReader(fake.pool as never);
    await reader.read({ products: [{ productId: '173' }], context });
    expect(fake.calls[0]?.sql).not.toContain('p.active = 1');
  });

  it('leaves specific price date evaluation to the selector instead of SQL NOW', async () => {
    const fake = poolWithRows([[], [], [], []]);
    const reader = new MySqlCatalogCommercialDataReader(fake.pool as never);
    await reader.read({ products: [{ productId: '173' }], context });
    expect(fake.calls.at(-1)?.sql).not.toContain('NOW()');
  });

  it('maps requested combinations and stock rows by composed identity', async () => {
    const fake = poolWithRows([
      [
        {
          productId: 173,
          name: 'Barra',
          productReference: 'BAR',
          description: null,
          category: null,
          active: 1,
          availableForOrder: 1,
          productBasePriceNet: 1000,
        },
      ],
      [{ productId: 173, combinationId: 20, combinationReference: 'BAR-20', combinationImpactNet: 250 }],
      [{ productId: 173, combinationId: 20, stockQuantity: 3 }],
      [],
    ]);
    const reader = new MySqlCatalogCommercialDataReader(fake.pool as never);
    const result = await reader.read({
      products: [{ productId: '173', combinationId: '20' }],
      context,
    });
    expect(result.products[0]).toMatchObject({
      productId: 173,
      combinationId: 20,
      combinationReference: 'BAR-20',
      combinationImpactNet: 250,
      stockQuantity: 3,
    });
  });

  it('does not fabricate missing combinations', async () => {
    const fake = poolWithRows([
      [
        {
          productId: 173,
          name: 'Barra',
          productReference: 'BAR',
          description: null,
          category: null,
          active: 1,
          availableForOrder: 1,
          productBasePriceNet: 1000,
        },
      ],
      [],
      [],
      [],
    ]);
    const reader = new MySqlCatalogCommercialDataReader(fake.pool as never);
    const result = await reader.read({
      products: [{ productId: '173', combinationId: '20' }],
      context,
    });
    expect(result.products).toEqual([]);
  });
});
