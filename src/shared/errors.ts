export type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'PRODUCT_NOT_FOUND'
  | 'COMBINATION_NOT_FOUND'
  | 'AMBIGUOUS_PRODUCT'
  | 'PRICE_UNAVAILABLE'
  | 'STOCK_UNAVAILABLE'
  | 'WEIGHT_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'CATALOG_QUERY_FAILED'
  | 'PRODUCT_SEMANTICS_NOT_FOUND'
  | 'PRODUCT_SEMANTICS_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class CatalogError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

export class InvalidInputError extends CatalogError {
  constructor(message = 'Invalid input', details?: unknown) {
    super('INVALID_INPUT', message, 400, details);
  }
}

export class UnauthorizedError extends CatalogError {
  constructor(message = 'Invalid API key') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class RateLimitedError extends CatalogError {
  constructor(message = 'Rate limit exceeded') {
    super('RATE_LIMITED', message, 429);
  }
}

export class ProductNotFoundError extends CatalogError {
  constructor(message = 'Product was not found') {
    super('PRODUCT_NOT_FOUND', message, 404);
  }
}

export class CombinationNotFoundError extends CatalogError {
  constructor(message = 'Combination was not found') {
    super('COMBINATION_NOT_FOUND', message, 404);
  }
}

export class PriceUnavailableError extends CatalogError {
  constructor(message = 'Price is unavailable') {
    super('PRICE_UNAVAILABLE', message, 503);
  }
}

export class StockUnavailableError extends CatalogError {
  constructor(message = 'Stock is unavailable') {
    super('STOCK_UNAVAILABLE', message, 503);
  }
}

export class WeightUnavailableError extends CatalogError {
  constructor(message = 'Weight is unavailable') {
    super('WEIGHT_UNAVAILABLE', message, 503);
  }
}

export class ProductSemanticsNotFoundError extends CatalogError {
  constructor(message = 'Product is not present in the active product semantic snapshot') {
    super('PRODUCT_SEMANTICS_NOT_FOUND', message, 404);
  }
}

export class ProductSemanticsUnavailableError extends CatalogError {
  constructor(message = 'Active product semantic snapshot is not loaded') {
    super('PRODUCT_SEMANTICS_UNAVAILABLE', message, 503);
  }
}

export class DatabaseUnavailableError extends CatalogError {
  constructor(message = 'Database is unavailable') {
    super('DATABASE_UNAVAILABLE', message, 503);
  }
}

export class CatalogQueryFailedError extends CatalogError {
  constructor(message = 'Catalog query failed') {
    super('CATALOG_QUERY_FAILED', message, 500);
  }
}

export class InternalError extends CatalogError {
  constructor(message = 'Internal server error') {
    super('INTERNAL_ERROR', message, 500);
  }
}
