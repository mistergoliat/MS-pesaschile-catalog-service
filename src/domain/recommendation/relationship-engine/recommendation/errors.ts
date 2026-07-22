import type { JsonValue } from '../publication/contracts.js';

export type ProductRecommendationErrorCode =
  | 'INVALID_RECOMMENDATION_REQUEST'
  | 'RECOMMENDATION_KNOWLEDGE_NOT_LOADED'
  | 'COMMERCIAL_DATA_PROVIDER_FAILURE'
  | 'INVALID_COMMERCIAL_DATA'
  | 'RECOMMENDATION_SCORING_FAILURE'
  | 'RECOMMENDATION_RANKING_FAILURE';

export class ProductRecommendationError extends Error {
  readonly code: ProductRecommendationErrorCode;

  readonly details?: JsonValue;

  constructor(
    code: ProductRecommendationErrorCode,
    message: string,
    options?: {
      details?: JsonValue;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProductRecommendationError';
    this.code = code;
    this.details = options?.details;
  }
}
