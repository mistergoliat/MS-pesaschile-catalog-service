import { CatalogQueryFailedError, DatabaseUnavailableError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

type DatabaseErrorShape = {
  code?: string;
  message?: string;
};

const INFRASTRUCTURE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
]);

const INFRASTRUCTURE_MESSAGE_FRAGMENTS = [
  'connection acquisition timeout',
  'acquire timeout',
  'connect econnrefused',
  'connect etimedout',
  'connection lost',
  'pool is closed',
  'socket hang up',
];

function databaseErrorShape(error: unknown): DatabaseErrorShape | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  return error as DatabaseErrorShape;
}

export function normalizeDatabaseError(error: unknown, operation: string): DatabaseUnavailableError | CatalogQueryFailedError {
  if (error instanceof DatabaseUnavailableError || error instanceof CatalogQueryFailedError) {
    return error;
  }

  const candidate = databaseErrorShape(error);
  const code = candidate?.code?.toUpperCase() ?? '';
  const message = candidate?.message?.toLowerCase() ?? '';
  const infrastructureUnavailable =
    INFRASTRUCTURE_ERROR_CODES.has(code) ||
    (code.startsWith('PROTOCOL_') && !code.startsWith('ER_')) ||
    INFRASTRUCTURE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));

  if (infrastructureUnavailable) {
    logger.error(
      { event: 'database_query_unavailable', operation, err: error },
      'Database query failed because infrastructure is unavailable',
    );
    return new DatabaseUnavailableError();
  }

  logger.error({ event: 'database_query_failed', operation, err: error }, 'Database query failed');
  return new CatalogQueryFailedError();
}
