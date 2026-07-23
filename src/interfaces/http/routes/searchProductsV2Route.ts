import type { FastifyInstance } from 'fastify';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  searchProductsV2RequestSchema,
  searchProductsV2ResultSchema,
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

function jsonSchema(schema: unknown) {
  return zodToJsonSchema(schema as never, { $refStrategy: 'none' });
}

const requestExample = {
  sourceProduct: {
    productId: '173',
  },
  filters: {
    inStockOnly: true,
  },
  limit: 5,
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
      body: jsonSchema(searchProductsV2RequestSchema),
      response: {
        200: {
          ...jsonSchema(searchProductsV2ResultSchema),
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
