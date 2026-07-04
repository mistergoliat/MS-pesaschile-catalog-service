import type { RowDataPacket } from 'mysql2/promise';
import { dbQueryDurationSeconds } from '../../shared/metrics.js';

export async function runQuery<T extends RowDataPacket[]>(
  pool: {
    query: (sqlOrOptions: any, values?: any) => Promise<[T, unknown]>;
  },
  operation: string,
  sql: string,
  params: readonly unknown[],
  timeoutMs: number,
): Promise<T> {
  const started = process.hrtime.bigint();
  try {
    const [rows] = await pool.query({ sql, values: params, timeout: timeoutMs });
    return rows;
  } finally {
    const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
    dbQueryDurationSeconds.observe({ operation }, elapsed);
  }
}
