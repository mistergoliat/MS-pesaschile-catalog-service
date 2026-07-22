import { z } from 'zod';
import type { ProductInteractionDataset } from '../contracts.js';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonSerializable(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return false;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return value.every((item) => isJsonSerializable(item, seen));
  }
  if (isPlainRecord(value)) {
    if (value instanceof Error || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return Object.values(value).every((item) => isJsonSerializable(item, seen));
  }
  return false;
}

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, 'Expected a non-empty string');
const sourceTraceSchema = z
  .object({
    system: nonEmptyStringSchema,
    reference: nonEmptyStringSchema.optional(),
  })
  .strict();

export const rawTransactionLineSchema = z
  .object({
    lineId: nonEmptyStringSchema.optional(),
    productId: z.string(),
    combinationId: z.string().optional(),
    quantity: z.number(),
    lineStatus: z.string().optional(),
  })
  .strict();

export const rawTransactionRecordSchema = z
  .object({
    transactionId: z.string(),
    transactionType: z.union([z.literal('order'), z.literal('cart')]),
    occurredAt: z.string(),
    status: z.string().optional(),
    customerKey: z.string().optional(),
    lines: z.array(rawTransactionLineSchema),
    source: sourceTraceSchema.optional(),
  })
  .strict();

export const duplicateTransactionStrategySchema = z.literal('reject');
export const duplicateProductStrategySchema = z.literal('aggregate_quantity');
export const transactionNormalizationOutputOrderSchema = z.enum([
  'occurred_at_then_transaction_id',
  'transaction_id',
]);

export const productTransactionNormalizationConfigSchema = z
  .object({
    acceptedOrderStatuses: z.array(nonEmptyStringSchema),
    acceptedCartStatuses: z.array(nonEmptyStringSchema).optional(),
    rejectedLineStatuses: z.array(nonEmptyStringSchema).optional(),
    maximumDistinctProductsPerTransaction: z.number().int().min(2),
    minimumOccurredAt: z.string().optional(),
    maximumOccurredAt: z.string().optional(),
    allowAnonymousTransactions: z.boolean(),
    duplicateTransactionStrategy: duplicateTransactionStrategySchema,
    duplicateProductStrategy: duplicateProductStrategySchema,
    outputOrder: transactionNormalizationOutputOrderSchema,
  })
  .strict();

export const transactionRejectionCodeSchema = z.enum([
  'INVALID_TRANSACTION_ID',
  'INVALID_TRANSACTION_TYPE',
  'INVALID_OCCURRED_AT',
  'OUTSIDE_DATA_WINDOW',
  'STATUS_NOT_ACCEPTED',
  'MISSING_CUSTOMER_KEY',
  'NO_VALID_LINES',
  'TOO_MANY_DISTINCT_PRODUCTS',
  'DUPLICATE_TRANSACTION',
  'INVALID_TRANSACTION',
]);

export const transactionLineRejectionCodeSchema = z.enum([
  'INVALID_PRODUCT_ID',
  'INVALID_COMBINATION_ID',
  'INVALID_QUANTITY',
  'LINE_STATUS_REJECTED',
  'INVALID_LINE',
]);

export const productTransactionNormalizationWarningCodeSchema = z.enum([
  'ANONYMOUS_TRANSACTION',
  'PRODUCT_LINES_AGGREGATED',
  'PARTIAL_TRANSACTION',
  'EMPTY_INPUT',
  'SOURCE_REFERENCE_MISSING',
]);

export const rejectedTransactionRecordSchema = z
  .object({
    transactionId: z.string().optional(),
    code: transactionRejectionCodeSchema,
    message: nonEmptyStringSchema,
    source: sourceTraceSchema.optional(),
  })
  .strict();

export const rejectedTransactionLineSchema = z
  .object({
    transactionId: z.string().optional(),
    lineId: z.string().optional(),
    productId: z.string().optional(),
    combinationId: z.string().optional(),
    code: transactionLineRejectionCodeSchema,
    message: nonEmptyStringSchema,
  })
  .strict();

export const productTransactionNormalizationWarningSchema = z
  .object({
    code: productTransactionNormalizationWarningCodeSchema,
    message: nonEmptyStringSchema,
    transactionId: z.string().optional(),
    productId: z.string().optional(),
    combinationId: z.string().optional(),
    details: z.unknown().optional(),
  })
  .strict()
  .superRefine((warning, context) => {
    if (warning.details !== undefined && !isJsonSerializable(warning.details)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'details must be JSON serializable',
        path: ['details'],
      });
    }
  });

export const productTransactionNormalizationStatisticsSchema = z
  .object({
    transactionsRead: z.number().int().nonnegative(),
    transactionsAccepted: z.number().int().nonnegative(),
    transactionsRejected: z.number().int().nonnegative(),
    linesRead: z.number().int().nonnegative(),
    linesAccepted: z.number().int().nonnegative(),
    linesRejected: z.number().int().nonnegative(),
    duplicateProductLinesAggregated: z.number().int().nonnegative(),
    anonymousTransactionsAccepted: z.number().int().nonnegative(),
    distinctProductsObserved: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((statistics, context) => {
    if (statistics.transactionsAccepted + statistics.transactionsRejected !== statistics.transactionsRead) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'transactionsAccepted plus transactionsRejected must equal transactionsRead',
        path: ['transactionsAccepted'],
      });
    }
    if (statistics.linesAccepted + statistics.linesRejected !== statistics.linesRead) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'linesAccepted plus linesRejected must equal linesRead',
        path: ['linesAccepted'],
      });
    }
  });

export const productTransactionNormalizationResultSchema = z
  .object({
    dataset: z.custom<ProductInteractionDataset>(),
    statistics: productTransactionNormalizationStatisticsSchema,
    rejectedTransactions: z.array(rejectedTransactionRecordSchema),
    rejectedLines: z.array(rejectedTransactionLineSchema),
    warnings: z.array(productTransactionNormalizationWarningSchema),
  })
  .strict();

export class ProductTransactionNormalizationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductTransactionNormalizationConfigError';
  }
}

export type RawTransactionLine = z.infer<typeof rawTransactionLineSchema>;
export type RawTransactionRecord = z.infer<typeof rawTransactionRecordSchema>;
export type ProductTransactionNormalizationConfig = z.infer<typeof productTransactionNormalizationConfigSchema>;
export type TransactionRejectionCode = z.infer<typeof transactionRejectionCodeSchema>;
export type TransactionLineRejectionCode = z.infer<typeof transactionLineRejectionCodeSchema>;
export type ProductTransactionNormalizationWarningCode = z.infer<typeof productTransactionNormalizationWarningCodeSchema>;
export type RejectedTransactionRecord = z.infer<typeof rejectedTransactionRecordSchema>;
export type RejectedTransactionLine = z.infer<typeof rejectedTransactionLineSchema>;
export type ProductTransactionNormalizationWarning = z.infer<typeof productTransactionNormalizationWarningSchema>;
export type ProductTransactionNormalizationStatistics = z.infer<typeof productTransactionNormalizationStatisticsSchema>;
export type ProductTransactionNormalizationResult = z.infer<typeof productTransactionNormalizationResultSchema>;

