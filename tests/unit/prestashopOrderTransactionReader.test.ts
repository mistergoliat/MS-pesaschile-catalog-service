import { describe, expect, it } from 'vitest';
import {
  PrestashopHistoricalOrderTransactionReader,
  type PrestashopOrderTransactionReaderDatabase,
} from '../../src/infrastructure/recommendation/prestashopOrderTransactionReader.js';

type TestRow = {
  readonly orderId: number | string;
  readonly occurredAt: Date | string;
  readonly orderState: number | string;
  readonly lineId: number | string;
  readonly productId: number | string | null;
  readonly productAttributeId: number | string | null;
  readonly quantity: number | string | null;
};

function database(rows: readonly TestRow[]): PrestashopOrderTransactionReaderDatabase & {
  sql: string;
  values: unknown[];
} {
  return {
    sql: '',
    values: [] as unknown[],
    async query<T extends any[]>(sql: string, values: unknown[]): Promise<[T, unknown]> {
      this.sql = sql;
      this.values = values;
      return [rows as T, []];
    },
  };
}

const baseConfig = {
  from: '2025-01-01T00:00:00.000Z',
  to: '2025-12-31T23:59:59.000Z',
  acceptedOrderStates: ['5'],
  excludedProductIds: [],
} as const;

describe('PrestashopHistoricalOrderTransactionReader', () => {
  it('reads historical order rows into raw-neutral order transactions', async () => {
    const db = database([
      {
        orderId: 10,
        occurredAt: new Date('2025-03-01T12:00:00.000Z'),
        orderState: 5,
        lineId: 100,
        productId: 29,
        productAttributeId: 11,
        quantity: 2,
      },
      {
        orderId: 10,
        occurredAt: new Date('2025-03-01T12:00:00.000Z'),
        orderState: 5,
        lineId: 101,
        productId: 30,
        productAttributeId: 0,
        quantity: 1,
      },
    ]);
    const result = await new PrestashopHistoricalOrderTransactionReader(db, 'ps_').read(baseConfig);

    expect(db.sql).toContain('FROM ps_orders o');
    expect(db.sql).toContain('INNER JOIN ps_order_detail od');
    expect(db.values).toEqual(['2025-01-01T00:00:00.000Z', '2025-12-31T23:59:59.000Z']);
    expect(result.records).toEqual([
      {
        transactionId: '10',
        transactionType: 'order',
        occurredAt: '2025-03-01T12:00:00.000Z',
        status: '5',
        lines: [
          { lineId: '100', productId: '29', quantity: 2 },
          { lineId: '101', productId: '30', quantity: 1 },
        ],
        source: { system: 'prestashop', reference: 'order:10' },
      },
    ]);
    expect(result.statistics).toMatchObject({ sourceOrdersRead: 1, sourceLinesRead: 2 });
  });

  it('excludes orders whose states are not configured as accepted', async () => {
    const result = await new PrestashopHistoricalOrderTransactionReader(database([
      {
        orderId: 11,
        occurredAt: '2025-03-01 12:00:00',
        orderState: 6,
        lineId: 110,
        productId: 29,
        productAttributeId: 0,
        quantity: 1,
      },
    ]), 'ps_').read(baseConfig);

    expect(result.records).toEqual([]);
    expect(result.statistics.sourceOrdersExcluded).toBe(1);
    expect(result.statistics.sourceLinesExcluded).toBe(1);
  });

  it('excludes configured administrative products', async () => {
    const result = await new PrestashopHistoricalOrderTransactionReader(database([
      {
        orderId: 12,
        occurredAt: '2025-03-01 12:00:00',
        orderState: 5,
        lineId: 120,
        productId: 999,
        productAttributeId: 0,
        quantity: 1,
      },
    ]), 'ps_').read({
      ...baseConfig,
      excludedProductIds: ['999'],
    });

    expect(result.records[0]?.lines).toEqual([]);
    expect(result.statistics.sourceProductsExcluded).toBe(1);
  });

  it('deduplicates technical duplicate rows by order and line id', async () => {
    const row = {
      orderId: 13,
      occurredAt: '2025-03-01 12:00:00',
      orderState: 5,
      lineId: 130,
      productId: 29,
      productAttributeId: 0,
      quantity: 1,
    };
    const result = await new PrestashopHistoricalOrderTransactionReader(database([row, row]), 'ps_').read(baseConfig);

    expect(result.records[0]?.lines).toHaveLength(1);
    expect(result.statistics.sourceDuplicateLinesExcluded).toBe(1);
  });

  it('rejects invalid product ids and non-positive quantities before normalization', async () => {
    const result = await new PrestashopHistoricalOrderTransactionReader(database([
      {
        orderId: 14,
        occurredAt: '2025-03-01 12:00:00',
        orderState: 5,
        lineId: 140,
        productId: null,
        productAttributeId: 0,
        quantity: 1,
      },
      {
        orderId: 14,
        occurredAt: '2025-03-01 12:00:00',
        orderState: 5,
        lineId: 141,
        productId: 29,
        productAttributeId: 0,
        quantity: 0,
      },
    ]), 'ps_').read(baseConfig);

    expect(result.records[0]?.lines).toEqual([]);
    expect(result.statistics.sourceLinesExcluded).toBe(2);
  });

  it('collapses PrestaShop combinations to productId-level raw lines for the initial snapshot', async () => {
    const result = await new PrestashopHistoricalOrderTransactionReader(database([
      {
        orderId: 15,
        occurredAt: '2025-03-01 12:00:00',
        orderState: 5,
        lineId: 150,
        productId: 29,
        productAttributeId: 123,
        quantity: 1,
      },
    ]), 'ps_').read(baseConfig);

    expect(result.records[0]?.lines[0]).toEqual({ lineId: '150', productId: '29', quantity: 1 });
  });
});
