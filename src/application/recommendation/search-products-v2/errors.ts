import type { JsonValue } from '../../../domain/recommendation/relationship-engine/publication/contracts.js';

export type SearchProductsV2ErrorStage =
  | 'request'
  | 'catalog'
  | 'commercial'
  | 'affinity'
  | 'personalization'
  | 'response';

export type SearchProductsV2ErrorCode =
  | 'INVALID_REQUEST'
  | 'CUSTOMER_MISMATCH'
  | 'SOURCE_PRODUCT_NOT_FOUND'
  | 'SOURCE_PRODUCT_INACTIVE'
  | 'COMMERCIAL_RECOMMENDATION_UNAVAILABLE'
  | 'INVALID_COMMERCIAL_RESULT'
  | 'INVALID_AFFINITY_RESULT'
  | 'INVALID_PERSONALIZATION_RESULT'
  | 'UPSTREAM_CONTRACT_MISMATCH'
  | 'INTERNAL_CONFIGURATION_ERROR';

export class SearchProductsV2Error extends Error {
  readonly code: SearchProductsV2ErrorCode;

  readonly retryable: boolean;

  readonly stage: SearchProductsV2ErrorStage;

  readonly details?: Readonly<Record<string, JsonValue>>;

  constructor(
    code: SearchProductsV2ErrorCode,
    message: string,
    options: {
      stage: SearchProductsV2ErrorStage;
      retryable?: boolean;
      details?: Readonly<Record<string, JsonValue>>;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SearchProductsV2Error';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.stage = options.stage;
    this.details = options.details;
  }
}
