import { describe, expect, it } from 'vitest';
import { productInteractionDatasetSchema } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import {
  DefaultProductTransactionNormalizer,
  ProductTransactionNormalizationConfigError,
  productTransactionNormalizationStatisticsSchema,
  productTransactionNormalizationWarningSchema,
  type ProductTransactionNormalizationConfig,
  type RawTransactionRecord,
} from '../../src/domain/recommendation/relationship-engine/normalization/index.js';
import {
  anonymousOrderRecord,
  baseProductRecord,
  combinationProductRecord,
  decimalQuantityRecord,
  duplicateProductsRecord,
  duplicateTransactionRecord,
  emptyCombinationIdRecord,
  emptyProductIdRecord,
  emptyTransactionIdRecord,
  invalidTimestampRecord,
  missingCustomerKeyRecord,
  negativeQuantityRecord,
  noValidLinesRecord,
  outsideWindowOrderRecord,
  overLimitRecord,
  partialTransactionRecord,
  rejectedLineStatusRecord,
  rejectedStatusCartRecord,
  rejectedStatusOrderRecord,
  sourceWithoutReferenceRecord,
  strictCustomerConfig,
  timezoneOrderRecord,
  transactionIdOrderConfig,
  underLimitRecord,
  unsortedLinesRecord,
  unsortedRecords,
  validCartRecord,
  validNormalizationConfig,
  validOrderRecord,
  zeroQuantityRecord,
} from '../fixtures/productRelationshipNormalization.js';

function normalize(records: RawTransactionRecord[], config: ProductTransactionNormalizationConfig = validNormalizationConfig) {
  return new DefaultProductTransactionNormalizer().normalize({ records, config });
}

function expectConfigError(config: ProductTransactionNormalizationConfig): void {
  expect(() => normalize([validOrderRecord], config)).toThrow(ProductTransactionNormalizationConfigError);
}

describe('ProductTransactionNormalizer configuration', () => {
  it('accepts valid configuration', () => {
    expect(() => normalize([validOrderRecord])).not.toThrow();
  });

  it('rejects empty acceptedOrderStatuses', () => {
    expectConfigError({ ...validNormalizationConfig, acceptedOrderStatuses: [] });
  });

  it('rejects empty order statuses', () => {
    expectConfigError({ ...validNormalizationConfig, acceptedOrderStatuses: ['paid', ' '] });
  });

  it('rejects duplicate order statuses', () => {
    expectConfigError({ ...validNormalizationConfig, acceptedOrderStatuses: ['paid', 'paid'] });
  });

  it('rejects duplicate cart statuses', () => {
    expectConfigError({ ...validNormalizationConfig, acceptedCartStatuses: ['active', 'active'] });
  });

  it('rejects duplicate rejected line statuses', () => {
    expectConfigError({ ...validNormalizationConfig, rejectedLineStatuses: ['cancelled', 'cancelled'] });
  });

  it('rejects maximum below 2', () => {
    expectConfigError({ ...validNormalizationConfig, maximumDistinctProductsPerTransaction: 1 });
  });

  it('rejects invalid minimum window timestamp', () => {
    expectConfigError({ ...validNormalizationConfig, minimumOccurredAt: '2025-01-01' });
  });

  it('rejects invalid maximum window timestamp', () => {
    expectConfigError({ ...validNormalizationConfig, maximumOccurredAt: 'not-a-date' });
  });

  it('rejects inverted data window', () => {
    expectConfigError({
      ...validNormalizationConfig,
      minimumOccurredAt: '2025-12-31T23:59:59.000Z',
      maximumOccurredAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('rejects unsupported duplicate transaction strategy', () => {
    expectConfigError({ ...validNormalizationConfig, duplicateTransactionStrategy: 'merge' as never });
  });

  it('rejects unsupported duplicate product strategy', () => {
    expectConfigError({ ...validNormalizationConfig, duplicateProductStrategy: 'reject' as never });
  });

  it('rejects unsupported output order', () => {
    expectConfigError({ ...validNormalizationConfig, outputOrder: 'random' as never });
  });
});

describe('ProductTransactionNormalizer transactions', () => {
  it('normalizes a valid order', () => {
    const result = normalize([validOrderRecord]);
    expect(result.dataset.transactions).toHaveLength(1);
    expect(result.dataset.transactions[0]).toMatchObject({
      transactionId: 'order-001',
      transactionType: 'order',
      customerKey: 'customer-key-001',
    });
  });

  it('normalizes a valid cart', () => {
    const result = normalize([validCartRecord]);
    expect(result.dataset.transactions[0]?.transactionType).toBe('cart');
  });

  it('normalizes timestamp to UTC', () => {
    const result = normalize([timezoneOrderRecord]);
    expect(result.dataset.transactions[0]?.occurredAt).toBe('2025-03-10T14:00:00.000Z');
  });

  it('conserves valid transaction IDs', () => {
    const result = normalize([validOrderRecord]);
    expect(result.dataset.transactions[0]?.transactionId).toBe(validOrderRecord.transactionId);
  });

  it('conserves valid product IDs', () => {
    const result = normalize([validOrderRecord]);
    expect(result.dataset.transactions[0]?.products[0]?.product.productId).toBe('1001');
  });

  it('accepts base product', () => {
    const result = normalize([baseProductRecord]);
    expect(result.dataset.transactions[0]?.products[0]?.product).toEqual({ productId: '1001' });
  });

  it('accepts combination product', () => {
    const result = normalize([combinationProductRecord]);
    expect(result.dataset.transactions[0]?.products[0]?.product).toEqual({ productId: '1001', combinationId: '2001' });
  });

  it('accepts anonymous transaction when allowed', () => {
    const result = normalize([anonymousOrderRecord]);
    expect(result.dataset.transactions[0]?.customerKey).toBeUndefined();
    expect(result.statistics.anonymousTransactionsAccepted).toBe(1);
  });

  it('rejects anonymous transaction when not allowed', () => {
    const result = normalize([missingCustomerKeyRecord], strictCustomerConfig);
    expect(result.rejectedTransactions[0]?.code).toBe('MISSING_CUSTOMER_KEY');
  });

  it('rejects unaccepted order status', () => {
    const result = normalize([rejectedStatusOrderRecord]);
    expect(result.rejectedTransactions[0]?.code).toBe('STATUS_NOT_ACCEPTED');
  });

  it('rejects unaccepted cart status', () => {
    const result = normalize([rejectedStatusCartRecord]);
    expect(result.rejectedTransactions[0]?.code).toBe('STATUS_NOT_ACCEPTED');
  });

  it('accepts carts without status when cart statuses are not configured', () => {
    const configWithoutCartStatuses = { ...validNormalizationConfig };
    delete configWithoutCartStatuses.acceptedCartStatuses;
    const cartWithoutStatus = { ...validCartRecord, status: undefined };
    const result = normalize([cartWithoutStatus], configWithoutCartStatuses);
    expect(result.dataset.transactions).toHaveLength(1);
  });

  it('rejects invalid timestamp', () => {
    const result = normalize([invalidTimestampRecord]);
    expect(result.rejectedTransactions[0]?.code).toBe('INVALID_OCCURRED_AT');
  });

  it('rejects transaction outside data window', () => {
    const result = normalize([outsideWindowOrderRecord]);
    expect(result.rejectedTransactions[0]?.code).toBe('OUTSIDE_DATA_WINDOW');
  });

  it('rejects empty transaction ID', () => {
    const result = normalize([emptyTransactionIdRecord]);
    expect(result.rejectedTransactions[0]?.code).toBe('INVALID_TRANSACTION_ID');
  });

  it('rejects invalid transaction type', () => {
    const result = normalize([{ ...validOrderRecord, transactionType: 'invoice' as never }]);
    expect(result.rejectedTransactions[0]?.code).toBe('INVALID_TRANSACTION_TYPE');
  });
});

describe('ProductTransactionNormalizer lines', () => {
  it('accepts positive integer quantity', () => {
    const result = normalize([baseProductRecord]);
    expect(result.dataset.transactions[0]?.products[0]?.quantity).toBe(1);
  });

  it('rejects zero quantity', () => {
    const result = normalize([zeroQuantityRecord]);
    expect(result.rejectedLines[0]?.code).toBe('INVALID_QUANTITY');
  });

  it('rejects negative quantity', () => {
    const result = normalize([negativeQuantityRecord]);
    expect(result.rejectedLines[0]?.code).toBe('INVALID_QUANTITY');
  });

  it('rejects decimal quantity', () => {
    const result = normalize([decimalQuantityRecord]);
    expect(result.rejectedLines[0]?.code).toBe('INVALID_QUANTITY');
  });

  it('rejects non-finite quantity', () => {
    const result = normalize([{
      ...validOrderRecord,
      transactionId: 'order-infinite-quantity-001',
      lines: [{ lineId: 'line-infinite', productId: '1001', quantity: Number.POSITIVE_INFINITY }],
    }]);
    expect(result.rejectedLines[0]?.code).toBe('INVALID_QUANTITY');
  });

  it('rejects empty product ID', () => {
    const result = normalize([emptyProductIdRecord]);
    expect(result.rejectedLines[0]?.code).toBe('INVALID_PRODUCT_ID');
  });

  it('rejects empty combination ID', () => {
    const result = normalize([emptyCombinationIdRecord]);
    expect(result.rejectedLines[0]?.code).toBe('INVALID_COMBINATION_ID');
  });

  it('rejects configured line status', () => {
    const result = normalize([rejectedLineStatusRecord]);
    expect(result.rejectedLines[0]?.code).toBe('LINE_STATUS_REJECTED');
  });

  it('keeps valid lines in a partial transaction', () => {
    const result = normalize([partialTransactionRecord]);
    expect(result.dataset.transactions[0]?.products).toHaveLength(2);
    expect(result.rejectedLines).toHaveLength(1);
  });

  it('emits partial transaction warning', () => {
    const result = normalize([partialTransactionRecord]);
    expect(result.warnings.some((warning) => warning.code === 'PARTIAL_TRANSACTION')).toBe(true);
  });

  it('rejects transaction with no valid lines', () => {
    const result = normalize([noValidLinesRecord]);
    expect(result.rejectedTransactions[0]?.code).toBe('NO_VALID_LINES');
  });
});

describe('ProductTransactionNormalizer duplication', () => {
  it('aggregates duplicate product quantities', () => {
    const result = normalize([duplicateProductsRecord]);
    const product = result.dataset.transactions[0]?.products.find((item) => item.product.productId === '1001');
    expect(product?.quantity).toBe(3);
  });

  it('distinguishes different combinations', () => {
    const result = normalize([{
      ...validOrderRecord,
      transactionId: 'order-distinct-combinations-001',
      lines: [
        { lineId: 'line-a', productId: '1001', combinationId: '2001', quantity: 1 },
        { lineId: 'line-b', productId: '1001', combinationId: '2002', quantity: 1 },
      ],
    }]);
    expect(result.dataset.transactions[0]?.products).toHaveLength(2);
  });

  it('does not aggregate base product with combination', () => {
    const result = normalize([{
      ...validOrderRecord,
      transactionId: 'order-base-vs-combination-001',
      lines: [
        { lineId: 'line-a', productId: '1001', quantity: 1 },
        { lineId: 'line-b', productId: '1001', combinationId: '2001', quantity: 1 },
      ],
    }]);
    expect(result.dataset.transactions[0]?.products).toHaveLength(2);
  });

  it('emits aggregation warning', () => {
    const result = normalize([duplicateProductsRecord]);
    expect(result.warnings.some((warning) => warning.code === 'PRODUCT_LINES_AGGREGATED')).toBe(true);
  });

  it('counts duplicate product line aggregations', () => {
    const result = normalize([duplicateProductsRecord]);
    expect(result.statistics.duplicateProductLinesAggregated).toBe(1);
  });

  it('rejects duplicate transaction', () => {
    const result = normalize([validOrderRecord, duplicateTransactionRecord]);
    expect(result.rejectedTransactions[0]?.code).toBe('DUPLICATE_TRANSACTION');
  });

  it('keeps first occurrence of duplicate transaction', () => {
    const result = normalize([validOrderRecord, duplicateTransactionRecord]);
    expect(result.dataset.transactions).toHaveLength(1);
    expect(result.dataset.transactions[0]?.transactionId).toBe(validOrderRecord.transactionId);
  });
});

describe('ProductTransactionNormalizer limits', () => {
  it('accepts exactly the maximum allowed distinct products', () => {
    const result = normalize([underLimitRecord]);
    expect(result.dataset.transactions).toHaveLength(1);
  });

  it('rejects over maximum distinct products', () => {
    const result = normalize([overLimitRecord]);
    expect(result.rejectedTransactions[0]?.code).toBe('TOO_MANY_DISTINCT_PRODUCTS');
  });

  it('applies limit after removing invalid lines', () => {
    const result = normalize([{
      ...overLimitRecord,
      transactionId: 'order-limit-after-invalid-001',
      lines: [
        ...overLimitRecord.lines.slice(0, 3),
        { lineId: 'line-invalid', productId: '1004', quantity: 0 },
      ],
    }]);
    expect(result.dataset.transactions).toHaveLength(1);
  });

  it('applies limit after aggregating duplicates', () => {
    const result = normalize([{
      ...overLimitRecord,
      transactionId: 'order-limit-after-aggregation-001',
      lines: [
        { lineId: 'line-a', productId: '1001', quantity: 1 },
        { lineId: 'line-b', productId: '1001', quantity: 1 },
        { lineId: 'line-c', productId: '1002', quantity: 1 },
        { lineId: 'line-d', productId: '1003', quantity: 1 },
      ],
    }]);
    expect(result.dataset.transactions).toHaveLength(1);
  });
});

describe('ProductTransactionNormalizer order and determinism', () => {
  it('sorts transactions by occurredAt then transactionId', () => {
    const result = normalize(unsortedRecords);
    expect(result.dataset.transactions.map((transaction) => transaction.transactionId)).toEqual([
      'order-001',
      'order-002',
      'order-003',
    ]);
  });

  it('sorts transactions by transactionId when configured', () => {
    const result = normalize(unsortedRecords, transactionIdOrderConfig);
    expect(result.dataset.transactions.map((transaction) => transaction.transactionId)).toEqual([
      'order-001',
      'order-002',
      'order-003',
    ]);
  });

  it('sorts lines by productId and combinationId with base first', () => {
    const result = normalize([unsortedLinesRecord]);
    expect(result.dataset.transactions[0]?.products.map((item) => item.product)).toEqual([
      { productId: '1001' },
      { productId: '1001', combinationId: '2001' },
      { productId: '1002', combinationId: '2002' },
    ]);
  });

  it('generates identical results for the same input', () => {
    const first = normalize([validOrderRecord, validCartRecord]);
    const second = normalize([validOrderRecord, validCartRecord]);
    expect(second).toEqual(first);
  });

  it('does not depend on the clock', () => {
    const result = normalize([validOrderRecord]);
    expect(JSON.stringify(result)).not.toContain(String(new Date().getFullYear() + 1));
  });

  it('does not generate random IDs', () => {
    const result = normalize([validOrderRecord]);
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/u);
  });

  it('preserves original valid ID casing and zeros', () => {
    const record = {
      ...validOrderRecord,
      transactionId: 'Order-0001',
      lines: [{ lineId: 'Line-0001', productId: 'SKU-0001', combinationId: 'Combo-001', quantity: 1 }],
    };
    const result = normalize([record]);
    expect(result.dataset.transactions[0]?.products[0]?.product).toEqual({
      productId: 'SKU-0001',
      combinationId: 'Combo-001',
    });
  });
});

describe('ProductTransactionNormalizer statistics', () => {
  it('counts transactions correctly', () => {
    const result = normalize([validOrderRecord, rejectedStatusOrderRecord]);
    expect(result.statistics).toMatchObject({ transactionsRead: 2, transactionsAccepted: 1, transactionsRejected: 1 });
  });

  it('counts raw lines correctly', () => {
    const result = normalize([validOrderRecord]);
    expect(result.statistics.linesRead).toBe(2);
  });

  it('counts line rejections', () => {
    const result = normalize([partialTransactionRecord]);
    expect(result.statistics.linesRejected).toBe(1);
  });

  it('counts accepted raw lines before aggregation', () => {
    const result = normalize([duplicateProductsRecord]);
    expect(result.statistics.linesAccepted).toBe(3);
  });

  it('counts aggregations', () => {
    const result = normalize([duplicateProductsRecord]);
    expect(result.statistics.duplicateProductLinesAggregated).toBe(1);
  });

  it('counts anonymous transactions', () => {
    const result = normalize([validCartRecord, anonymousOrderRecord]);
    expect(result.statistics.anonymousTransactionsAccepted).toBe(2);
  });

  it('counts distinct accepted product identities', () => {
    const result = normalize([validOrderRecord, validCartRecord]);
    expect(result.statistics.distinctProductsObserved).toBe(3);
  });

  it('satisfies transaction statistics equality', () => {
    const result = normalize([validOrderRecord, rejectedStatusOrderRecord]);
    expect(result.statistics.transactionsAccepted + result.statistics.transactionsRejected).toBe(result.statistics.transactionsRead);
  });

  it('satisfies line statistics equality', () => {
    const result = normalize([partialTransactionRecord]);
    expect(result.statistics.linesAccepted + result.statistics.linesRejected).toBe(result.statistics.linesRead);
    expect(productTransactionNormalizationStatisticsSchema.safeParse(result.statistics).success).toBe(true);
  });
});

describe('ProductTransactionNormalizer warnings and rejections', () => {
  it('emits empty input warning', () => {
    const result = normalize([]);
    expect(result.warnings[0]?.code).toBe('EMPTY_INPUT');
  });

  it('emits source reference missing warning', () => {
    const result = normalize([sourceWithoutReferenceRecord]);
    expect(result.warnings.some((warning) => warning.code === 'SOURCE_REFERENCE_MISSING')).toBe(true);
  });

  it('keeps source trace only on rejected transaction', () => {
    const result = normalize([rejectedStatusOrderRecord]);
    expect(result.rejectedTransactions[0]?.source).toEqual(rejectedStatusOrderRecord.source);
    expect(result.dataset.transactions[0]).toBeUndefined();
  });

  it('does not expose raw lines in rejected transaction', () => {
    const result = normalize([rejectedStatusOrderRecord]);
    expect(result.rejectedTransactions[0]).not.toHaveProperty('lines');
  });

  it('does not expose raw record in rejected lines', () => {
    const result = normalize([zeroQuantityRecord]);
    expect(result.rejectedLines[0]).not.toHaveProperty('raw');
  });

  it('warnings are JSON serializable', () => {
    const result = normalize([duplicateProductsRecord]);
    for (const warning of result.warnings) {
      expect(productTransactionNormalizationWarningSchema.safeParse(warning).success).toBe(true);
    }
  });
});

describe('ProductTransactionNormalizer security and neutrality', () => {
  it('validates output against T01B ProductInteractionDataset schema', () => {
    const result = normalize([validOrderRecord, validCartRecord]);
    expect(productInteractionDatasetSchema.safeParse(result.dataset).success).toBe(true);
  });

  it('always outputs empty dataset rules', () => {
    const result = normalize([validOrderRecord]);
    expect(result.dataset.rules).toEqual([]);
  });

  it('does not output source trace into dataset', () => {
    const result = normalize([validOrderRecord]);
    expect(result.dataset.transactions[0]).not.toHaveProperty('source');
  });

  it('does not output operational statuses into dataset', () => {
    const result = normalize([validOrderRecord]);
    expect(result.dataset.transactions[0]).not.toHaveProperty('status');
  });

  it('does not output line statuses into dataset', () => {
    const result = normalize([validOrderRecord]);
    expect(result.dataset.transactions[0]?.products[0]).not.toHaveProperty('lineStatus');
  });

  it('does not generate SQL', () => {
    const result = normalize([validOrderRecord]);
    expect(JSON.stringify(result).toLowerCase()).not.toContain('select ');
  });

  it('does not depend on PrestaShop fields', () => {
    const result = normalize([validOrderRecord]);
    expect(JSON.stringify(result).toLowerCase()).not.toContain('prestashop');
  });

  it('does not import repositories or runtime dependencies', async () => {
    const module = await import('../../src/domain/recommendation/relationship-engine/normalization/index.js');
    expect(Object.keys(module).join(' ')).not.toMatch(/repository|redis|mysql|fastify/iu);
  });

  it('does not perform IO for valid input', () => {
    const result = normalize([validOrderRecord]);
    expect(result.dataset.transactions).toHaveLength(1);
  });

  it('does not calculate relationships', () => {
    const result = normalize([validOrderRecord]);
    expect(JSON.stringify(result)).not.toContain('jointCount');
    expect(JSON.stringify(result)).not.toContain('confidence');
    expect(JSON.stringify(result)).not.toContain('lift');
  });
});
