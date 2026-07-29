export type ExploreProductsErrorCode =
  | 'invalid_request'
  | 'invalid_sort'
  | 'invalid_price_range'
  | 'invalid_limit'
  | 'category_not_found'
  | 'catalog_source_unavailable'
  | 'internal_error';

export class ExploreProductsError extends Error {
  constructor(
    public readonly code: ExploreProductsErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ExploreProductsError';
  }
}

export function invalidRequest(message = 'Invalid request'): ExploreProductsError {
  return new ExploreProductsError('invalid_request', message, 400);
}

export function invalidSort(message = 'Invalid sort'): ExploreProductsError {
  return new ExploreProductsError('invalid_sort', message, 400);
}

export function invalidPriceRange(message = 'Invalid price range'): ExploreProductsError {
  return new ExploreProductsError('invalid_price_range', message, 400);
}

export function invalidLimit(message = 'Invalid limit'): ExploreProductsError {
  return new ExploreProductsError('invalid_limit', message, 400);
}

export function categoryNotFound(message = 'Category was not found'): ExploreProductsError {
  return new ExploreProductsError('category_not_found', message, 404);
}

export function catalogSourceUnavailable(message = 'Catalog source is unavailable'): ExploreProductsError {
  return new ExploreProductsError('catalog_source_unavailable', message, 503, true);
}

export function internalExploreError(message = 'Internal server error'): ExploreProductsError {
  return new ExploreProductsError('internal_error', message, 500);
}
