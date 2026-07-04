import { z } from 'zod';
import type {
  BatchResponse,
  ProductResponse,
  SearchResponse,
} from '../src/shared/contracts.js';

export const catalogToolInputSchema = z.union([
  z.object({
    operation: z.literal('search'),
    query: z.string().min(2).max(120),
    limit: z.number().int().min(1).max(10).optional(),
    includeOutOfStock: z.boolean().optional(),
  }),
  z.object({
    operation: z.literal('get_product'),
    productId: z.number().int().positive(),
    combinationId: z.number().int().nonnegative().optional(),
    quantity: z.number().int().min(1).max(999).optional(),
  }),
  z.object({
    operation: z.literal('batch_get'),
    items: z.array(
      z.object({
        productId: z.number().int().positive(),
        combinationId: z.number().int().nonnegative().optional(),
        quantity: z.number().int().min(1).max(999).optional(),
      }),
    ),
  }),
]);

export type CatalogToolInput = z.infer<typeof catalogToolInputSchema>;
export type SearchProductsResult = SearchResponse;
export type GetProductResult = ProductResponse;
export type BatchGetProductsResult = BatchResponse;

export const catalogToolDefinition = {
  name: 'catalog',
  description: 'Busca productos activos de PrestaShop y recupera precio efectivo, variante y stock físico.',
  inputSchema: {
    oneOf: [
      {
        type: 'object',
        properties: {
          operation: { const: 'search' },
          query: { type: 'string', minLength: 2, maxLength: 120 },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
          includeOutOfStock: { type: 'boolean' },
        },
        required: ['operation', 'query'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          operation: { const: 'get_product' },
          productId: { type: 'integer', minimum: 1 },
          combinationId: { type: 'integer', minimum: 0 },
          quantity: { type: 'integer', minimum: 1, maximum: 999 },
        },
        required: ['operation', 'productId'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          operation: { const: 'batch_get' },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                productId: { type: 'integer', minimum: 1 },
                combinationId: { type: 'integer', minimum: 0 },
                quantity: { type: 'integer', minimum: 1, maximum: 999 },
              },
              required: ['productId'],
              additionalProperties: false,
            },
          },
        },
        required: ['operation', 'items'],
        additionalProperties: false,
      },
    ],
  },
} as const;
