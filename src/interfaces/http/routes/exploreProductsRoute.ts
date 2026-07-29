import type { FastifyInstance } from 'fastify';
import type { ExploreProductsService } from '../../../application/catalog/explore-products/index.js';
import { createExploreProductsController } from '../controllers/exploreProductsController.js';

const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'correlationId'],
      properties: {
        code: {
          type: 'string',
          enum: [
            'invalid_request',
            'invalid_sort',
            'invalid_price_range',
            'invalid_limit',
            'category_not_found',
            'catalog_source_unavailable',
            'internal_error',
          ],
        },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
        correlationId: { type: 'string' },
      },
    },
  },
} as const;

const requestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sort', 'limit'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 240 },
    categoryId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^\\d+$' },
    categorySlug: { type: 'string', minLength: 1, maxLength: 160 },
    productType: { type: 'string', minLength: 1, maxLength: 120 },
    price: {
      type: 'object',
      additionalProperties: false,
      properties: {
        min: { type: 'number', minimum: 0 },
        max: { type: 'number', minimum: 0 },
      },
    },
    availability: { type: 'string', enum: ['available', 'unavailable', 'all'], default: 'all' },
    sort: {
      type: 'object',
      additionalProperties: false,
      required: ['by', 'direction'],
      properties: {
        by: { type: 'string', enum: ['price', 'stock', 'name'] },
        direction: { type: 'string', enum: ['asc', 'desc'] },
      },
    },
    limit: { type: 'integer', minimum: 1, maximum: 10 },
  },
} as const;

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scope', 'sort', 'totalMatched', 'exhaustiveForScope', 'products'],
  properties: {
    scope: {
      type: 'object',
      additionalProperties: false,
      required: ['availability'],
      properties: {
        query: { type: 'string' },
        categoryId: { type: 'string' },
        categorySlug: { type: 'string' },
        productType: { type: 'string' },
        availability: { type: 'string', enum: ['available', 'unavailable', 'all'] },
      },
    },
    sort: {
      type: 'object',
      additionalProperties: false,
      required: ['by', 'direction'],
      properties: {
        by: { type: 'string', enum: ['price', 'stock', 'name'] },
        direction: { type: 'string', enum: ['asc', 'desc'] },
      },
    },
    totalMatched: { type: 'integer', minimum: 0 },
    exhaustiveForScope: { type: 'boolean' },
    classificationSource: { type: 'string', enum: ['category', 'attribute', 'rule', 'text_fallback'] },
    products: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['productId', 'name', 'price', 'currency', 'stockQuantity', 'stockScope', 'availability'],
        properties: {
          productId: { type: 'string' },
          name: { type: 'string' },
          price: { type: ['number', 'null'], minimum: 0 },
          currency: { type: 'string' },
          stockQuantity: { type: ['integer', 'null'] },
          stockScope: {
            type: 'string',
            enum: ['product', 'product_aggregate'],
            description: 'product for products without combinations; product_aggregate for total stock aggregated across combinations.',
          },
          availability: { type: 'string' },
        },
      },
    },
  },
} as const;

const requestExample = {
  productType: 'machine',
  availability: 'available',
  sort: {
    by: 'price',
    direction: 'desc',
  },
  limit: 1,
} as const;

export async function registerExploreProductsRoute(
  app: FastifyInstance,
  service?: ExploreProductsService,
): Promise<void> {
  app.post('/v1/products/explore', {
    attachValidation: true,
    schema: {
      tags: ['Products'],
      summary: 'Explore and rank catalog products',
      description: [
        'Returns a structured catalog exploration result without scraping the storefront.',
        'Filters are applied before sorting, sorting is applied to the complete filtered scope before limit.',
        'For price sorting, products with price=null are excluded from the ranking and totalMatched.',
        'For stock sorting, products with stockQuantity=null are kept after products with known stock in both directions.',
        'When the primary sort value ties, productId ASC is used as the deterministic final tie break.',
        'stockQuantity is direct product stock for stockScope=product and aggregated variant stock for stockScope=product_aggregate.',
        'exhaustiveForScope is true only when the catalog source completed the full filtered scope without pagination, truncation, or partial fallback.',
        `Copyable request example: ${JSON.stringify(requestExample)}`,
      ].join(' '),
      security: [{ apiKeyAuth: [] }],
      body: requestSchema,
      response: {
        200: responseSchema,
        400: { ...errorResponseSchema, description: 'Invalid request, sort, price range, or limit.' },
        401: { ...errorResponseSchema, description: 'Missing or invalid x-api-key.' },
        404: { ...errorResponseSchema, description: 'Requested category does not exist for the configured shop/language.' },
        500: { ...errorResponseSchema, description: 'Unexpected internal error.' },
        503: { ...errorResponseSchema, description: 'Catalog source is unavailable.' },
      },
    },
  }, createExploreProductsController({ service }));
}
