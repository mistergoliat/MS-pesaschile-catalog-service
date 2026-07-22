import type { JsonValue } from '../relationship-engine/publication/contracts.js';

export type PersonalizedRecommendationErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_COMMERCIAL_RESULT'
  | 'INVALID_AFFINITY_RESULT'
  | 'CUSTOMER_MISMATCH'
  | 'INVALID_PARAMETERS'
  | 'DUPLICATED_COMMERCIAL_PRODUCT'
  | 'DUPLICATED_AFFINITY_PRODUCT'
  | 'INVALID_SCORE';

export class PersonalizedRecommendationError extends Error {
  readonly code: PersonalizedRecommendationErrorCode;

  readonly retryable: boolean;

  readonly details?: Readonly<Record<string, JsonValue>>;

  constructor(
    code: PersonalizedRecommendationErrorCode,
    message: string,
    options?: {
      retryable?: boolean;
      details?: Readonly<Record<string, JsonValue>>;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PersonalizedRecommendationError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }
}
