import type { FastifyInstance } from 'fastify';
import {
  type SearchProductsV2Service,
} from '../../../application/recommendation/search-products-v2/index.js';
import { createSearchProductsV2Controller } from '../controllers/searchProductsV2Controller.js';

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
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
        correlationId: { type: 'string' },
      },
    },
  },
} as const;

const requestExample = {
  sourceProduct: {
    productId: '173',
  },
  filters: {
    inStockOnly: true,
  },
  limit: 5,
} as const;

const requestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceProduct'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 240 },
    sourceProduct: {
      type: 'object',
      additionalProperties: false,
      required: ['productId'],
      properties: {
        productId: { type: 'string', minLength: 1 },
        combinationId: { type: 'string', minLength: 1 },
      },
    },
    customer: {
      type: 'object',
      additionalProperties: true,
    },
    context: {
      type: 'object',
      additionalProperties: true,
    },
    filters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inStockOnly: { type: 'boolean' },
        productIds: {
          type: 'array',
          maxItems: 50,
          items: { type: 'string', minLength: 1 },
        },
      },
    },
    limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
    correlationId: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

const responseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['sourceProduct', 'recommendations', 'warnings', 'statistics', 'execution'],
  properties: {
    query: { type: ['string', 'null'] },
    sourceProduct: { type: 'object', additionalProperties: true },
    customer: { type: 'object', additionalProperties: true },
    recommendations: { type: 'array', items: { type: 'object', additionalProperties: true } },
    excluded: { type: 'array', items: { type: 'object', additionalProperties: true } },
    personalization: { type: 'object', additionalProperties: true },
    snapshot: { type: 'object', additionalProperties: true },
    warnings: { type: 'array', items: { type: 'object', additionalProperties: true } },
    statistics: { type: 'object', additionalProperties: true },
    execution: { type: 'object', additionalProperties: true },
  },
} as const;

export async function registerSearchProductsV2Route(
  app: FastifyInstance,
  service?: SearchProductsV2Service,
): Promise<void> {
  app.post('/api/v2/recommendations/search-products', {
    attachValidation: true,
    schema: {
      tags: ['Recommendations'],
      summary: 'SearchProducts V2 recommendations',
      description: [
        'Returns enriched product recommendations for a known source product id.',
        'The caller must provide sourceProduct.productId manually; this endpoint does not infer productId from query text.',
        'query is optional compatibility metadata and does not identify or replace sourceProduct.',
        'Natural-language product intent resolution is reserved for T12.',
        'The active relationship snapshot provides statistical relationship evidence; live catalog data provides names, prices, stock, and availability.',
        'If the active relationship snapshot is unavailable, the endpoint returns 503 instead of an empty recommendation list.',
        `Copyable request example: ${JSON.stringify(requestExample)}`,
      ].join(' '),
      security: [{ apiKeyAuth: [] }],
      headers: {
        type: 'object',
        properties: {
          'x-correlation-id': { type: 'string', minLength: 1, maxLength: 128 },
        },
        additionalProperties: true,
      },
      body: requestSchema,
      response: {
        200: {
          ...responseSchema,
          description: 'Recommendations were evaluated successfully. The result may be empty when the source product has no relationships.',
        },
        400: { ...errorResponseSchema, description: 'Invalid request body, headers, filters, or correlation id.' },
        401: { ...errorResponseSchema, description: 'Missing or invalid x-api-key.' },
        409: { ...errorResponseSchema, description: 'Customer identity mismatch.' },
        422: { ...errorResponseSchema, description: 'Upstream or response contract mismatch.' },
        500: { ...errorResponseSchema, description: 'Unexpected internal error.' },
        503: { ...errorResponseSchema, description: 'Commercial recommendation knowledge or service dependency is unavailable.' },
      },
    },
  }, createSearchProductsV2Controller({ service }));
}
