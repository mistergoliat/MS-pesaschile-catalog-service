import type { RowDataPacket } from 'mysql2';
import type {
  HistoricalOrderTransactionReader,
  RelationshipSourceReaderConfig,
  RelationshipSourceReadResult,
  RelationshipSourceReadStatistics,
} from '../../application/recommendation/relationship-snapshot-build/index.js';
import type {
  RawTransactionLine,
  RawTransactionRecord,
} from '../../domain/recommendation/relationship-engine/normalization/index.js';

export type PrestashopOrderTransactionReaderDatabase = {
  query<T extends RowDataPacket[]>(sql: string, values: unknown[]): Promise<[T, unknown]>;
};

type PrestashopOrderRow = RowDataPacket & {
  readonly orderId: number | string;
  readonly occurredAt: Date | string;
  readonly orderState: number | string;
  readonly lineId: number | string;
  readonly productId: number | string | null;
  readonly productAttributeId: number | string | null;
  readonly quantity: number | string | null;
};

type MutableOrder = {
  readonly transactionId: string;
  readonly status: string;
  readonly occurredAt: string;
  readonly source: {
    readonly system: string;
    readonly reference: string;
  };
  readonly lines: RawTransactionLine[];
  excluded: boolean;
};

type MutableRelationshipSourceReadStatistics = {
  -readonly [Key in keyof RelationshipSourceReadStatistics]: RelationshipSourceReadStatistics[Key];
};

function assertValidTablePrefix(prefix: string): void {
  if (!/^[A-Za-z0-9_]+_$/u.test(prefix)) {
    throw new Error('Invalid PrestaShop table prefix');
  }
}

function toNonEmptyString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const stringValue = String(value);
  return stringValue.trim().length > 0 ? stringValue : null;
}

function toPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^[0-9]+$/u.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toIsoDateTime(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const trimmed = value.trim();
  if (/[zZ]|[+-][0-9]{2}:[0-9]{2}$/u.test(trimmed)) {
    return new Date(trimmed).toISOString();
  }
  const normalized = trimmed.replace(' ', 'T');
  const withMilliseconds = /\.[0-9]+$/u.test(normalized) ? normalized : `${normalized}.000`;
  return new Date(`${withMilliseconds}Z`).toISOString();
}

function emptyStatistics(): MutableRelationshipSourceReadStatistics {
  return {
    sourceOrdersRead: 0,
    sourceLinesRead: 0,
    sourceOrdersExcluded: 0,
    sourceLinesExcluded: 0,
    sourceDuplicateLinesExcluded: 0,
    sourceProductsExcluded: 0,
  };
}

export class PrestashopHistoricalOrderTransactionReader implements HistoricalOrderTransactionReader {
  constructor(
    private readonly database: PrestashopOrderTransactionReaderDatabase,
    private readonly tablePrefix: string,
  ) {
    assertValidTablePrefix(tablePrefix);
  }

  async read(config: RelationshipSourceReaderConfig): Promise<RelationshipSourceReadResult> {
    const rows = await this.readRows(config);
    return this.mapRows(rows, config);
  }

  private async readRows(config: RelationshipSourceReaderConfig): Promise<readonly PrestashopOrderRow[]> {
    const values: unknown[] = [config.from];
    const toPredicate = config.to ? 'AND o.date_add <= ?' : '';
    if (config.to) {
      values.push(config.to);
    }

    const [rows] = await this.database.query<PrestashopOrderRow[]>(
      `
        SELECT
          o.id_order AS orderId,
          o.date_add AS occurredAt,
          o.current_state AS orderState,
          od.id_order_detail AS lineId,
          od.product_id AS productId,
          od.product_attribute_id AS productAttributeId,
          od.product_quantity AS quantity
        FROM ${this.tablePrefix}orders o
        INNER JOIN ${this.tablePrefix}order_detail od ON od.id_order = o.id_order
        WHERE o.date_add >= ?
          ${toPredicate}
        ORDER BY o.date_add ASC, o.id_order ASC, od.id_order_detail ASC
      `,
      values,
    );
    return rows;
  }

  private mapRows(
    rows: readonly PrestashopOrderRow[],
    config: RelationshipSourceReaderConfig,
  ): RelationshipSourceReadResult {
    const acceptedStates = new Set(config.acceptedOrderStates);
    const excludedProductIds = new Set(config.excludedProductIds);
    const statistics = emptyStatistics();
    const orders = new Map<string, MutableOrder>();
    const seenLineKeys = new Set<string>();

    for (const row of rows) {
      statistics.sourceLinesRead += 1;
      const transactionId = toNonEmptyString(row.orderId);
      const state = toNonEmptyString(row.orderState);
      const lineId = toNonEmptyString(row.lineId);
      if (!transactionId || !state || !lineId) {
        statistics.sourceLinesExcluded += 1;
        continue;
      }

      let order = orders.get(transactionId);
      if (!order) {
        statistics.sourceOrdersRead += 1;
        order = {
          transactionId,
          status: state,
          occurredAt: toIsoDateTime(row.occurredAt),
          source: {
            system: 'prestashop',
            reference: `order:${transactionId}`,
          },
          lines: [],
          excluded: !acceptedStates.has(state),
        };
        orders.set(transactionId, order);
      }

      if (order.excluded) {
        statistics.sourceLinesExcluded += 1;
        continue;
      }

      const lineKey = `${transactionId}:${lineId}`;
      if (seenLineKeys.has(lineKey)) {
        statistics.sourceLinesExcluded += 1;
        statistics.sourceDuplicateLinesExcluded += 1;
        continue;
      }
      seenLineKeys.add(lineKey);

      const productId = toNonEmptyString(row.productId);
      const quantity = toPositiveInteger(row.quantity);
      if (!productId || !quantity) {
        statistics.sourceLinesExcluded += 1;
        continue;
      }
      if (excludedProductIds.has(productId)) {
        statistics.sourceLinesExcluded += 1;
        statistics.sourceProductsExcluded += 1;
        continue;
      }

      order.lines.push({
        lineId,
        productId,
        quantity,
      });
    }

    const records: RawTransactionRecord[] = [];
    for (const order of orders.values()) {
      if (order.excluded) {
        statistics.sourceOrdersExcluded += 1;
        continue;
      }
      records.push({
        transactionId: order.transactionId,
        transactionType: 'order',
        occurredAt: order.occurredAt,
        status: order.status,
        lines: order.lines,
        source: order.source,
      });
    }

    return {
      records,
      statistics,
    };
  }
}
