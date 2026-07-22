import type { JsonValue } from '../relationship-engine/publication/contracts.js';

export type CustomerAffinityErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_CUSTOMER_REFERENCE'
  | 'INVALID_PRODUCT_REFERENCE'
  | 'INVALID_PARAMETERS'
  | 'EVIDENCE_PROVIDER_FAILED'
  | 'INVALID_PROVIDER_RESPONSE';

export class CustomerAffinityError extends Error {
  readonly code: CustomerAffinityErrorCode;

  readonly retryable: boolean;

  readonly details?: Readonly<Record<string, JsonValue>>;

  constructor(
    code: CustomerAffinityErrorCode,
    message: string,
    options?: {
      retryable?: boolean;
      details?: Readonly<Record<string, JsonValue>>;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CustomerAffinityError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }
}
