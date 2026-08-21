import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { runQuery } from '../../src/infrastructure/database/queries.js';
import { CatalogQueryFailedError, DatabaseUnavailableError } from '../../src/shared/errors.js';

describe('runQuery database error mapping', () => {
  it('returns rows on successful query', async () => {
    const rows = [{ id_product: 1 }] as unknown as RowDataPacket[];
    const result = await runQuery(
      {
        query: async () => [rows, undefined],
      },
      'product-core',
      'SELECT 1',
      [],
      1000,
    );

    expect(result).toEqual(rows);
  });

  it.each([
    [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:3306' }],
    [{ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }],
    [{ code: 'PROTOCOL_CONNECTION_LOST', message: 'Connection lost: The server closed the connection.' }],
    [{ code: 'POOL_CLOSED', message: 'Pool is closed' }],
    [{ message: 'connection acquisition timeout' }],
  ])('maps infrastructure failures to DatabaseUnavailableError: %j', async (error) => {
    await expect(runQuery(
      {
        query: async () => {
          throw error;
        },
      },
      'search-candidates',
      'SELECT 1',
      [],
      1000,
    )).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });

  it('maps generic SQL errors to CatalogQueryFailedError', async () => {
    await expect(runQuery(
      {
        query: async () => {
          throw { code: 'ER_BAD_FIELD_ERROR', message: "Unknown column 'missing' in 'field list'" };
        },
      },
      'search-candidates',
      'SELECT broken',
      [],
      1000,
    )).rejects.toBeInstanceOf(CatalogQueryFailedError);
  });
});
