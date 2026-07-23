import type { JsonValue } from '../../../domain/recommendation/relationship-engine/publication/contracts.js';

export type ProductIntentResolutionErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_CATALOG_RESULT'
  | 'CATALOG_SEARCH_UNAVAILABLE'
  | 'INTERNAL_CONFIGURATION_ERROR';

export type ProductIntentResolutionErrorStage =
  | 'request'
  | 'search'
  | 'catalog'
  | 'ranking'
  | 'response';

export class ProductIntentResolutionError extends Error {
  readonly code: ProductIntentResolutionErrorCode;

  readonly retryable: boolean;

  readonly stage: ProductIntentResolutionErrorStage;

  readonly details?: Readonly<Record<string, JsonValue>>;

  constructor(
    code: ProductIntentResolutionErrorCode,
    message: string,
    options: {
      stage: ProductIntentResolutionErrorStage;
      retryable?: boolean;
      details?: Readonly<Record<string, JsonValue>>;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProductIntentResolutionError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.stage = options.stage;
    this.details = options.details;
  }
}
