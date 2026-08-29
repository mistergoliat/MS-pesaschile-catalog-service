import type { JsonValue } from '../contracts.js';

export type ProductSemanticRuntimeErrorCode =
  | 'RUNTIME_SNAPSHOT_NOT_LOADED'
  | 'INVALID_RUNTIME_SNAPSHOT'
  | 'DUPLICATE_RUNTIME_PRODUCT'
  | 'INVALID_RUNTIME_QUERY'
  | 'RUNTIME_INDEX_BUILD_FAILURE';

export class ProductSemanticRuntimeError extends Error {
  readonly code: ProductSemanticRuntimeErrorCode;

  readonly details?: JsonValue;

  constructor(
    code: ProductSemanticRuntimeErrorCode,
    message: string,
    options?: {
      readonly details?: JsonValue;
      readonly cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProductSemanticRuntimeError';
    this.code = code;
    this.details = options?.details;
  }
}
