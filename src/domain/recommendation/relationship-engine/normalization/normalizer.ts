import {
  productInteractionDatasetSchema,
  type ProductInteractionDataset,
  type ProductTransaction,
  type TransactionProduct,
} from '../contracts.js';
import {
  ProductTransactionNormalizationConfigError,
  productTransactionNormalizationWarningSchema,
  type ProductTransactionNormalizationConfig,
  type ProductTransactionNormalizationResult,
  type ProductTransactionNormalizationStatistics,
  type ProductTransactionNormalizationWarning,
  type RawTransactionLine,
  type RawTransactionRecord,
  type RejectedTransactionLine,
  type RejectedTransactionRecord,
} from './contracts.js';

type ParsedConfig = ProductTransactionNormalizationConfig & {
  minimumOccurredAtDate?: Date;
  maximumOccurredAtDate?: Date;
};

type AcceptedLine = {
  line: RawTransactionLine;
  productId: string;
  combinationId?: string;
  quantity: number;
  identity: string;
};

export interface ProductTransactionNormalizer {
  normalize(input: {
    records: RawTransactionRecord[];
    config: ProductTransactionNormalizationConfig;
  }): ProductTransactionNormalizationResult;
}

function parseIsoTimestamp(value: string): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
  if (!hasExplicitTimezone) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function assertUniqueNonEmptyStatuses(values: readonly string[] | undefined, field: string): void {
  if (!values) {
    return;
  }
  const seen = new Set<string>();
  for (const status of values) {
    if (status.trim().length === 0) {
      throw new ProductTransactionNormalizationConfigError(`${field} must not contain empty statuses`);
    }
    if (seen.has(status)) {
      throw new ProductTransactionNormalizationConfigError(`${field} must not contain duplicate statuses`);
    }
    seen.add(status);
  }
}

function validateConfig(config: ProductTransactionNormalizationConfig): ParsedConfig {
  if (config.acceptedOrderStatuses.length === 0) {
    throw new ProductTransactionNormalizationConfigError('acceptedOrderStatuses must not be empty');
  }
  assertUniqueNonEmptyStatuses(config.acceptedOrderStatuses, 'acceptedOrderStatuses');
  assertUniqueNonEmptyStatuses(config.acceptedCartStatuses, 'acceptedCartStatuses');
  assertUniqueNonEmptyStatuses(config.rejectedLineStatuses, 'rejectedLineStatuses');

  if (config.maximumDistinctProductsPerTransaction < 2 || !Number.isInteger(config.maximumDistinctProductsPerTransaction)) {
    throw new ProductTransactionNormalizationConfigError('maximumDistinctProductsPerTransaction must be an integer >= 2');
  }
  if (config.duplicateTransactionStrategy !== 'reject') {
    throw new ProductTransactionNormalizationConfigError('duplicateTransactionStrategy must be reject');
  }
  if (config.duplicateProductStrategy !== 'aggregate_quantity') {
    throw new ProductTransactionNormalizationConfigError('duplicateProductStrategy must be aggregate_quantity');
  }
  if (
    config.outputOrder !== 'occurred_at_then_transaction_id' &&
    config.outputOrder !== 'transaction_id'
  ) {
    throw new ProductTransactionNormalizationConfigError('Unsupported outputOrder');
  }

  const minimumOccurredAtDate = config.minimumOccurredAt ? parseIsoTimestamp(config.minimumOccurredAt) : undefined;
  const maximumOccurredAtDate = config.maximumOccurredAt ? parseIsoTimestamp(config.maximumOccurredAt) : undefined;
  if (config.minimumOccurredAt && !minimumOccurredAtDate) {
    throw new ProductTransactionNormalizationConfigError('minimumOccurredAt must be a valid ISO timestamp with timezone');
  }
  if (config.maximumOccurredAt && !maximumOccurredAtDate) {
    throw new ProductTransactionNormalizationConfigError('maximumOccurredAt must be a valid ISO timestamp with timezone');
  }
  if (minimumOccurredAtDate && maximumOccurredAtDate && minimumOccurredAtDate.getTime() > maximumOccurredAtDate.getTime()) {
    throw new ProductTransactionNormalizationConfigError('minimumOccurredAt must be before or equal to maximumOccurredAt');
  }

  return {
    ...config,
    ...(minimumOccurredAtDate ? { minimumOccurredAtDate } : {}),
    ...(maximumOccurredAtDate ? { maximumOccurredAtDate } : {}),
  };
}

function productIdentity(productId: string, combinationId?: string): string {
  return `${productId}:${combinationId ?? ''}`;
}

function transactionIdentity(record: RawTransactionRecord): string {
  return `${record.transactionType}:${record.transactionId}`;
}

function validNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejectTransaction(record: RawTransactionRecord, code: RejectedTransactionRecord['code'], message: string): RejectedTransactionRecord {
  return {
    transactionId: validNonEmpty(record.transactionId) ? record.transactionId : undefined,
    code,
    message,
    source: record.source,
  };
}

function rejectLine(record: RawTransactionRecord, line: RawTransactionLine, code: RejectedTransactionLine['code'], message: string): RejectedTransactionLine {
  return {
    transactionId: validNonEmpty(record.transactionId) ? record.transactionId : undefined,
    lineId: validNonEmpty(line.lineId) ? line.lineId : undefined,
    productId: typeof line.productId === 'string' ? line.productId : undefined,
    combinationId: typeof line.combinationId === 'string' ? line.combinationId : undefined,
    code,
    message,
  };
}

function sortProducts(left: TransactionProduct, right: TransactionProduct): number {
  const productCompare = left.product.productId.localeCompare(right.product.productId);
  if (productCompare !== 0) {
    return productCompare;
  }
  const leftCombination = left.product.combinationId;
  const rightCombination = right.product.combinationId;
  if (leftCombination === undefined && rightCombination !== undefined) {
    return -1;
  }
  if (leftCombination !== undefined && rightCombination === undefined) {
    return 1;
  }
  return (leftCombination ?? '').localeCompare(rightCombination ?? '');
}

function sortTransactions(config: ProductTransactionNormalizationConfig, transactions: ProductTransaction[]): ProductTransaction[] {
  return [...transactions].sort((left, right) => {
    if (config.outputOrder === 'transaction_id') {
      return left.transactionId.localeCompare(right.transactionId);
    }
    return (
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.transactionId.localeCompare(right.transactionId)
    );
  });
}

export class DefaultProductTransactionNormalizer implements ProductTransactionNormalizer {
  normalize(input: {
    records: RawTransactionRecord[];
    config: ProductTransactionNormalizationConfig;
  }): ProductTransactionNormalizationResult {
    const config = validateConfig(input.config);
    const datasetTransactions: ProductTransaction[] = [];
    const rejectedTransactions: RejectedTransactionRecord[] = [];
    const rejectedLines: RejectedTransactionLine[] = [];
    const warnings: ProductTransactionNormalizationWarning[] = [];
    const seenTransactions = new Set<string>();
    const distinctProductsObserved = new Set<string>();

    const statistics: ProductTransactionNormalizationStatistics = {
      transactionsRead: input.records.length,
      transactionsAccepted: 0,
      transactionsRejected: 0,
      linesRead: 0,
      linesAccepted: 0,
      linesRejected: 0,
      duplicateProductLinesAggregated: 0,
      anonymousTransactionsAccepted: 0,
      distinctProductsObserved: 0,
    };

    if (input.records.length === 0) {
      warnings.push({
        code: 'EMPTY_INPUT',
        message: 'No raw transaction records were provided',
      });
    }

    for (const record of input.records) {
      statistics.linesRead += Array.isArray(record.lines) ? record.lines.length : 0;

      const transactionRejection = this.validateTransaction(record, config, seenTransactions);
      if (transactionRejection) {
        statistics.transactionsRejected += 1;
        rejectedTransactions.push(transactionRejection);
        continue;
      }
      seenTransactions.add(transactionIdentity(record));

      const acceptedLines = this.collectAcceptedLines(record, config, rejectedLines, statistics);
      if (acceptedLines.length === 0) {
        statistics.transactionsRejected += 1;
        rejectedTransactions.push(rejectTransaction(record, 'NO_VALID_LINES', 'Transaction has no valid lines'));
        continue;
      }

      const aggregated = this.aggregateLines(record, acceptedLines, statistics, warnings);
      if (aggregated.products.length > config.maximumDistinctProductsPerTransaction) {
        statistics.transactionsRejected += 1;
        rejectedTransactions.push(rejectTransaction(
          record,
          'TOO_MANY_DISTINCT_PRODUCTS',
          'Transaction exceeds maximum distinct products per transaction',
        ));
        continue;
      }

      if (rejectedLines.some((line) => line.transactionId === record.transactionId)) {
        warnings.push({
          code: 'PARTIAL_TRANSACTION',
          message: 'Transaction was accepted with one or more rejected lines',
          transactionId: record.transactionId,
        });
      }

      if (!validNonEmpty(record.customerKey)) {
        statistics.anonymousTransactionsAccepted += 1;
        warnings.push({
          code: 'ANONYMOUS_TRANSACTION',
          message: 'Transaction was accepted without customerKey',
          transactionId: record.transactionId,
        });
      }

      if (record.source && !record.source.reference) {
        warnings.push({
          code: 'SOURCE_REFERENCE_MISSING',
          message: 'Source reference is missing',
          transactionId: record.transactionId,
          details: { system: record.source.system },
        });
      }

      for (const product of aggregated.products) {
        distinctProductsObserved.add(productIdentity(product.product.productId, product.product.combinationId));
      }

      statistics.transactionsAccepted += 1;
      datasetTransactions.push({
        transactionId: record.transactionId,
        transactionType: record.transactionType,
        occurredAt: aggregated.occurredAt,
        ...(validNonEmpty(record.customerKey) ? { customerKey: record.customerKey } : {}),
        products: aggregated.products,
      });
    }

    statistics.distinctProductsObserved = distinctProductsObserved.size;

    const dataset: ProductInteractionDataset = productInteractionDatasetSchema.parse({
      transactions: sortTransactions(config, datasetTransactions),
      rules: [],
    });

    return {
      dataset,
      statistics,
      rejectedTransactions,
      rejectedLines,
      warnings: warnings.map((warning) => productTransactionNormalizationWarningSchema.parse(warning)),
    };
  }

  private validateTransaction(
    record: RawTransactionRecord,
    config: ParsedConfig,
    seenTransactions: Set<string>,
  ): RejectedTransactionRecord | null {
    if (!validNonEmpty(record.transactionId)) {
      return rejectTransaction(record, 'INVALID_TRANSACTION_ID', 'transactionId must be non-empty');
    }
    if (record.transactionType !== 'order' && record.transactionType !== 'cart') {
      return rejectTransaction(record, 'INVALID_TRANSACTION_TYPE', 'transactionType must be order or cart');
    }

    const occurredAt = parseIsoTimestamp(record.occurredAt);
    if (!occurredAt) {
      return rejectTransaction(record, 'INVALID_OCCURRED_AT', 'occurredAt must be a valid ISO timestamp with timezone');
    }

    if (
      (config.minimumOccurredAtDate && occurredAt.getTime() < config.minimumOccurredAtDate.getTime()) ||
      (config.maximumOccurredAtDate && occurredAt.getTime() > config.maximumOccurredAtDate.getTime())
    ) {
      return rejectTransaction(record, 'OUTSIDE_DATA_WINDOW', 'Transaction occurred outside configured data window');
    }

    if (record.transactionType === 'order' && !config.acceptedOrderStatuses.includes(record.status ?? '')) {
      return rejectTransaction(record, 'STATUS_NOT_ACCEPTED', 'Order status is not accepted by configuration');
    }

    if (
      record.transactionType === 'cart' &&
      config.acceptedCartStatuses !== undefined &&
      !config.acceptedCartStatuses.includes(record.status ?? '')
    ) {
      return rejectTransaction(record, 'STATUS_NOT_ACCEPTED', 'Cart status is not accepted by configuration');
    }

    if (!config.allowAnonymousTransactions && !validNonEmpty(record.customerKey)) {
      return rejectTransaction(record, 'MISSING_CUSTOMER_KEY', 'customerKey is required by configuration');
    }

    if (seenTransactions.has(transactionIdentity(record))) {
      return rejectTransaction(record, 'DUPLICATE_TRANSACTION', 'Duplicate transaction was rejected');
    }

    if (!Array.isArray(record.lines)) {
      return rejectTransaction(record, 'INVALID_TRANSACTION', 'lines must be an array');
    }

    return null;
  }

  private collectAcceptedLines(
    record: RawTransactionRecord,
    config: ProductTransactionNormalizationConfig,
    rejectedLines: RejectedTransactionLine[],
    statistics: ProductTransactionNormalizationStatistics,
  ): AcceptedLine[] {
    const acceptedLines: AcceptedLine[] = [];

    for (const line of record.lines) {
      const rejection = this.validateLine(record, line, config);
      if (rejection) {
        statistics.linesRejected += 1;
        rejectedLines.push(rejection);
        continue;
      }

      statistics.linesAccepted += 1;
      acceptedLines.push({
        line,
        productId: line.productId,
        ...(line.combinationId !== undefined ? { combinationId: line.combinationId } : {}),
        quantity: line.quantity,
        identity: productIdentity(line.productId, line.combinationId),
      });
    }

    return acceptedLines;
  }

  private validateLine(
    record: RawTransactionRecord,
    line: RawTransactionLine,
    config: ProductTransactionNormalizationConfig,
  ): RejectedTransactionLine | null {
    if (!validNonEmpty(line.productId)) {
      return rejectLine(record, line, 'INVALID_PRODUCT_ID', 'productId must be non-empty');
    }
    if (line.combinationId !== undefined && !validNonEmpty(line.combinationId)) {
      return rejectLine(record, line, 'INVALID_COMBINATION_ID', 'combinationId must be non-empty when present');
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.quantity)) {
      return rejectLine(record, line, 'INVALID_QUANTITY', 'quantity must be a finite positive integer');
    }
    if (line.lineStatus !== undefined && config.rejectedLineStatuses?.includes(line.lineStatus)) {
      return rejectLine(record, line, 'LINE_STATUS_REJECTED', 'lineStatus is rejected by configuration');
    }
    return null;
  }

  private aggregateLines(
    record: RawTransactionRecord,
    acceptedLines: AcceptedLine[],
    statistics: ProductTransactionNormalizationStatistics,
    warnings: ProductTransactionNormalizationWarning[],
  ): { occurredAt: string; products: TransactionProduct[] } {
    const productsByIdentity = new Map<string, TransactionProduct>();

    for (const accepted of acceptedLines) {
      const existing = productsByIdentity.get(accepted.identity);
      if (existing) {
        existing.quantity += accepted.quantity;
        statistics.duplicateProductLinesAggregated += 1;
        warnings.push({
          code: 'PRODUCT_LINES_AGGREGATED',
          message: 'Duplicate product lines were aggregated',
          transactionId: record.transactionId,
          productId: accepted.productId,
          combinationId: accepted.combinationId,
          details: {
            lineId: accepted.line.lineId,
            aggregatedQuantity: existing.quantity,
          },
        });
        continue;
      }

      productsByIdentity.set(accepted.identity, {
        product: {
          productId: accepted.productId,
          ...(accepted.combinationId !== undefined ? { combinationId: accepted.combinationId } : {}),
        },
        quantity: accepted.quantity,
      });
    }

    return {
      occurredAt: parseIsoTimestamp(record.occurredAt)!.toISOString(),
      products: [...productsByIdentity.values()].sort(sortProducts),
    };
  }
}
