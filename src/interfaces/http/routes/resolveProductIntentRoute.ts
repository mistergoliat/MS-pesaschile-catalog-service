import type { FastifyInstance } from 'fastify';
import {
  type ProductIntentResolutionService,
} from '../../../application/catalog/product-intent/index.js';
import { createResolveProductIntentController } from '../controllers/resolveProductIntentController.js';

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

const resolvedExample = {
  query: 'barra olimpica 15 kg',
  filters: {
    inStockOnly: true,
  },
  limit: 5,
} as const;

const requestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 2, maxLength: 240 },
    context: {
      type: 'object',
      additionalProperties: false,
      properties: {
        category: { type: 'string', minLength: 1 },
        intendedUse: { type: 'string', minLength: 1 },
        preferredAttributes: {
          type: 'object',
          additionalProperties: true,
        },
        excludedProductIds: {
          type: 'array',
          maxItems: 100,
          items: { type: 'string', minLength: 1 },
        },
      },
    },
    filters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inStockOnly: { type: 'boolean' },
        activeOnly: { type: 'boolean' },
      },
    },
    limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
    correlationId: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

const responseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['query', 'resolution', 'candidates', 'statistics', 'warnings', 'correlationId'],
  properties: {
    query: {
      type: 'object',
      required: ['original', 'normalized'],
      properties: {
        original: { type: 'string' },
        normalized: { type: 'string' },
      },
    },
    resolution: {
      type: 'object',
      required: ['status', 'confidence'],
      properties: {
        status: { type: 'string', enum: ['resolved', 'clarification_required', 'no_match'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        sourceProduct: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            combinationId: { type: 'string' },
          },
        },
      },
    },
    candidates: { type: 'array', items: { type: 'object', additionalProperties: true } },
    clarification: { type: 'object', additionalProperties: true },
    statistics: { type: 'object', additionalProperties: true },
    warnings: { type: 'array', items: { type: 'object', additionalProperties: true } },
    correlationId: { type: 'string' },
  },
} as const;

const ambiguousExample = {
  query: 'quiero una barra',
  filters: {
    inStockOnly: true,
  },
  limit: 5,
} as const;

const noMatchExample = {
  query: 'producto inexistente xyz 987654',
  limit: 5,
} as const;

export async function registerResolveProductIntentRoute(
  app: FastifyInstance,
  service?: ProductIntentResolutionService,
): Promise<void> {
  app.post('/api/v2/catalog/resolve-product-intent', {
    attachValidation: true,
    schema: {
      tags: ['Catalog'],
      summary: 'Resolve product intent',
      description: [
        'Resolves bounded natural-language product intent into real catalog product candidates.',
        'The endpoint does not generate products and does not execute SearchProducts V2 recommendations.',
        'It may return resolved, clarification_required, or no_match.',
        'It does not use LLMs or embeddings in V1.',
        'A resolved sourceProduct can be copied directly into /api/v2/recommendations/search-products.',
        `Resolved example: ${JSON.stringify(resolvedExample)}`,
        `Ambiguous example: ${JSON.stringify(ambiguousExample)}`,
        `No-match example: ${JSON.stringify(noMatchExample)}`,
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
          description: 'Product intent was evaluated successfully. Business status is represented in resolution.status.',
        },
        400: { ...errorResponseSchema, description: 'Invalid request body, headers, filters, or correlation id.' },
        401: { ...errorResponseSchema, description: 'Missing or invalid x-api-key.' },
        422: { ...errorResponseSchema, description: 'Catalog response could not be mapped to the public contract.' },
        500: { ...errorResponseSchema, description: 'Unexpected internal error.' },
        503: { ...errorResponseSchema, description: 'Catalog search or enrichment is unavailable.' },
      },
    },
  }, createResolveProductIntentController({ service }));
}
