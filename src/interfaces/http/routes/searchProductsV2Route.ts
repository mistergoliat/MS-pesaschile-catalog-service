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
      required: ['code', 'message', 'retryable', 'correlationId'],
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

export async function registerSearchProductsV2Route(
  app: FastifyInstance,
  service?: SearchProductsV2Service,
): Promise<void> {
  app.post('/api/v2/recommendations/search-products', {
    attachValidation: true,
    schema: {
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
        200: jsonSchema(searchProductsV2ResultSchema),
        400: errorResponseSchema,
        409: errorResponseSchema,
        422: errorResponseSchema,
        500: errorResponseSchema,
        503: errorResponseSchema,
      },
    },
  }, createSearchProductsV2Controller({ service }));
}
