import type { JsonValue } from '../publication/contracts.js';

export type ProductRelationshipRuntimeErrorCode =
  | 'RUNTIME_SNAPSHOT_NOT_LOADED'
  | 'INVALID_RUNTIME_QUERY'
  | 'INVALID_RUNTIME_SNAPSHOT'
  | 'DUPLICATE_RUNTIME_RELATIONSHIP'
  | 'RUNTIME_INDEX_BUILD_FAILURE';

export class ProductRelationshipRuntimeError extends Error {
  readonly code: ProductRelationshipRuntimeErrorCode;

  readonly details?: JsonValue;

  constructor(
    code: ProductRelationshipRuntimeErrorCode,
    message: string,
    options?: {
      details?: JsonValue;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProductRelationshipRuntimeError';
    this.code = code;
    this.details = options?.details;
  }
}
