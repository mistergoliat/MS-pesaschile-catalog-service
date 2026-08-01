import type { JsonValue } from '../relationship-engine/publication/contracts.js';

export type CustomerAffinityErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_CUSTOMER_REFERENCE'
  | 'INVALID_PRODUCT_REFERENCE'
  | 'INVALID_PARAMETERS'
  | 'EVIDENCE_PROVIDER_FAILED'
  // Reserved exclusively for validation failures of the response returned by a CustomerAffinityEvidenceProvider:
  // invalid schema, customer mismatch reported by the provider, duplicated evidence, evidence outside the
  // requested batch, a corrupt payload, or (CP-R1-T10B4A) a provider response declaring both reserved
  // customer-history-availability warnings at once, or a reserved warning alongside actual product evidence.
  // Never reuse this code for internal evaluator/scorer bugs or other T09 contract errors — T11 treats it as an
  // integration failure and degrades to neutral affinity on purpose (see degradableAffinityErrorReason in
  // defaultSearchProductsV2Service.ts).
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
