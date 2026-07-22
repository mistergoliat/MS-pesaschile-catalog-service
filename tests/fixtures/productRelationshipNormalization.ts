import type {
  ProductTransactionNormalizationConfig,
  RawTransactionRecord,
} from '../../src/domain/recommendation/relationship-engine/normalization/contracts.js';

export const validNormalizationConfig: ProductTransactionNormalizationConfig = {
  acceptedOrderStatuses: ['paid', 'delivered'],
  acceptedCartStatuses: ['active'],
  rejectedLineStatuses: ['cancelled', 'refunded'],
  maximumDistinctProductsPerTransaction: 3,
  minimumOccurredAt: '2025-01-01T00:00:00.000Z',
  maximumOccurredAt: '2025-12-31T23:59:59.000Z',
  allowAnonymousTransactions: true,
  duplicateTransactionStrategy: 'reject',
  duplicateProductStrategy: 'aggregate_quantity',
  outputOrder: 'occurred_at_then_transaction_id',
};

export const strictCustomerConfig: ProductTransactionNormalizationConfig = {
  ...validNormalizationConfig,
  allowAnonymousTransactions: false,
};

export const transactionIdOrderConfig: ProductTransactionNormalizationConfig = {
  ...validNormalizationConfig,
  outputOrder: 'transaction_id',
};

export const validOrderRecord: RawTransactionRecord = {
  transactionId: 'order-001',
  transactionType: 'order',
  occurredAt: '2025-03-10T10:00:00.000Z',
  status: 'paid',
  customerKey: 'customer-key-001',
  lines: [
    {
      lineId: 'line-001',
      productId: '1001',
      quantity: 1,
    },
    {
      lineId: 'line-002',
      productId: '1002',
      combinationId: '2002',
      quantity: 2,
    },
  ],
  source: {
    system: 'fixture',
    reference: 'fixture-order-001',
  },
};

export const validCartRecord: RawTransactionRecord = {
  transactionId: 'cart-001',
  transactionType: 'cart',
  occurredAt: '2025-03-11T10:00:00.000Z',
  status: 'active',
  lines: [
    {
      lineId: 'cart-line-001',
      productId: '1003',
      quantity: 1,
    },
  ],
  source: {
    system: 'fixture',
  },
};

export const anonymousOrderRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-anonymous-001',
  customerKey: undefined,
};

export const timezoneOrderRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-timezone-001',
  occurredAt: '2025-03-10T10:00:00-04:00',
};

export const outsideWindowOrderRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-outside-window-001',
  occurredAt: '2024-12-31T23:59:59.000Z',
};

export const rejectedStatusOrderRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-rejected-status-001',
  status: 'cancelled',
};

export const rejectedStatusCartRecord: RawTransactionRecord = {
  ...validCartRecord,
  transactionId: 'cart-rejected-status-001',
  status: 'expired',
};

export const emptyTransactionIdRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: ' ',
};

export const invalidTimestampRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-invalid-timestamp-001',
  occurredAt: '2025-03-10 10:00:00',
};

export const missingCustomerKeyRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-missing-customer-001',
  customerKey: undefined,
};

export const baseProductRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-base-product-001',
  lines: [{ lineId: 'line-base', productId: '1001', quantity: 1 }],
};

export const combinationProductRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-combination-product-001',
  lines: [{ lineId: 'line-combination', productId: '1001', combinationId: '2001', quantity: 1 }],
};

export const zeroQuantityRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-zero-quantity-001',
  lines: [{ lineId: 'line-zero', productId: '1001', quantity: 0 }],
};

export const negativeQuantityRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-negative-quantity-001',
  lines: [{ lineId: 'line-negative', productId: '1001', quantity: -1 }],
};

export const decimalQuantityRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-decimal-quantity-001',
  lines: [{ lineId: 'line-decimal', productId: '1001', quantity: 1.5 }],
};

export const emptyProductIdRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-empty-product-001',
  lines: [{ lineId: 'line-empty-product', productId: ' ', quantity: 1 }],
};

export const emptyCombinationIdRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-empty-combination-001',
  lines: [{ lineId: 'line-empty-combination', productId: '1001', combinationId: ' ', quantity: 1 }],
};

export const rejectedLineStatusRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-rejected-line-status-001',
  lines: [{ lineId: 'line-rejected-status', productId: '1001', quantity: 1, lineStatus: 'cancelled' }],
};

export const partialTransactionRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-partial-001',
  lines: [
    { lineId: 'line-valid-a', productId: '1001', quantity: 1 },
    { lineId: 'line-invalid', productId: '1002', quantity: 0 },
    { lineId: 'line-valid-c', productId: '1003', quantity: 1 },
  ],
};

export const noValidLinesRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-no-valid-lines-001',
  lines: [
    { lineId: 'line-invalid-a', productId: ' ', quantity: 1 },
    { lineId: 'line-invalid-b', productId: '1002', quantity: 0 },
  ],
};

export const duplicateProductsRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-duplicate-products-001',
  lines: [
    { lineId: 'line-dup-a', productId: '1001', quantity: 1 },
    { lineId: 'line-dup-b', productId: '1001', quantity: 2 },
    { lineId: 'line-other', productId: '1002', quantity: 1 },
  ],
};

export const duplicateTransactionRecord: RawTransactionRecord = {
  ...validOrderRecord,
};

export const underLimitRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-under-limit-001',
  lines: [
    { lineId: 'line-a', productId: '1001', quantity: 1 },
    { lineId: 'line-b', productId: '1002', quantity: 1 },
    { lineId: 'line-c', productId: '1003', quantity: 1 },
  ],
};

export const overLimitRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-over-limit-001',
  lines: [
    { lineId: 'line-a', productId: '1001', quantity: 1 },
    { lineId: 'line-b', productId: '1002', quantity: 1 },
    { lineId: 'line-c', productId: '1003', quantity: 1 },
    { lineId: 'line-d', productId: '1004', quantity: 1 },
  ],
};

export const unsortedRecords: RawTransactionRecord[] = [
  {
    ...validOrderRecord,
    transactionId: 'order-003',
    occurredAt: '2025-03-12T10:00:00.000Z',
  },
  {
    ...validOrderRecord,
    transactionId: 'order-001',
    occurredAt: '2025-03-10T10:00:00.000Z',
  },
  {
    ...validOrderRecord,
    transactionId: 'order-002',
    occurredAt: '2025-03-10T10:00:00.000Z',
  },
];

export const unsortedLinesRecord: RawTransactionRecord = {
  ...validOrderRecord,
  transactionId: 'order-unsorted-lines-001',
  lines: [
    { lineId: 'line-c', productId: '1002', combinationId: '2002', quantity: 1 },
    { lineId: 'line-a', productId: '1001', combinationId: '2001', quantity: 1 },
    { lineId: 'line-b', productId: '1001', quantity: 1 },
  ],
};

export const sourceWithReferenceRecord: RawTransactionRecord = validOrderRecord;

export const sourceWithoutReferenceRecord: RawTransactionRecord = validCartRecord;

export const productRelationshipNormalizationFixtures = {
  validNormalizationConfig,
  strictCustomerConfig,
  transactionIdOrderConfig,
  validOrderRecord,
  validCartRecord,
  anonymousOrderRecord,
  timezoneOrderRecord,
  outsideWindowOrderRecord,
  rejectedStatusOrderRecord,
  rejectedStatusCartRecord,
  emptyTransactionIdRecord,
  invalidTimestampRecord,
  missingCustomerKeyRecord,
  baseProductRecord,
  combinationProductRecord,
  zeroQuantityRecord,
  negativeQuantityRecord,
  decimalQuantityRecord,
  emptyProductIdRecord,
  emptyCombinationIdRecord,
  rejectedLineStatusRecord,
  partialTransactionRecord,
  noValidLinesRecord,
  duplicateProductsRecord,
  duplicateTransactionRecord,
  underLimitRecord,
  overLimitRecord,
  unsortedRecords,
  unsortedLinesRecord,
  sourceWithReferenceRecord,
  sourceWithoutReferenceRecord,
} as const;

