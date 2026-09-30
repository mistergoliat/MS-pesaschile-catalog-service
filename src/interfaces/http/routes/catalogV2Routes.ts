import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DatabaseUnavailableError } from '../../../shared/errors.js';
import {
  catalogSearchRequestSchema,
  catalogSearchResponseSchema,
  itemContextResponseSchema,
  productContextResponseSchema,
} from '../../../domain/catalog/v2/contracts.js';
import type { CatalogContractService } from '../../../application/catalog/v2/catalogContractService.js';

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        correlationId: { type: 'string' },
        retryable: { type: 'boolean' },
      },
      required: ['code', 'message', 'correlationId'],
      additionalProperties: false,
    },
  },
  required: ['error'],
  additionalProperties: false,
} as const;

function jsonSchema(schema: unknown) {
  return zodToJsonSchema(schema as never, { $refStrategy: 'none' });
}

function invalidRequest(correlationId: string, message = 'Invalid request') {
  return {
    error: { code: 'invalid_request', message, correlationId },
  };
}

function unavailable(correlationId: string) {
  return {
    error: {
      code: 'catalog_source_unavailable',
      message: 'Catalog source is unavailable',
      correlationId,
      retryable: true,
    },
  };
}

/**
 * The owner guarantees its published contract: an answer that does not match
 * the executable schema is never sent (it would make a consumer reject or,
 * worse, trust malformed data). It fails as a typed, non-retryable 500.
 */
function sendChecked(
  reply: FastifyReply,
  request: FastifyRequest,
  schema: { safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } } },
  value: unknown,
) {
  const checked = schema.safeParse(value);
  if (checked.success) return reply.send(value);
  request.log.error({
    event: 'catalog_v2_contract_output_invalid',
    correlationId: request.id,
    paths: checked.error?.issues.slice(0, 5).map((issue) => issue.path.map(String).join('.')),
  }, 'Catalog v2 answer violates the published contract');
  return reply.code(500).send({
    error: { code: 'contract_output_invalid', message: 'Catalog answer violates its contract', correlationId: request.id, retryable: false },
  });
}

function isDatabaseUnavailable(error: unknown): boolean {
  return error instanceof DatabaseUnavailableError
    || (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'DATABASE_UNAVAILABLE');
}

export async function registerCatalogV2Routes(
  app: FastifyInstance,
  service?: CatalogContractService,
): Promise<void> {
  app.post('/v2/catalog/search', {
    schema: {
      tags: ['Catalog v2'],
      summary: 'Search the commercial catalog at product level',
      security: [{ apiKeyAuth: [] }],
      body: jsonSchema(catalogSearchRequestSchema),
      response: {
        200: jsonSchema(catalogSearchResponseSchema),
        400: errorSchema,
        401: errorSchema,
        429: errorSchema,
        500: errorSchema,
        503: errorSchema,
      },
    },
  }, async (request, reply) => {
    if (!service) return reply.code(503).send(unavailable(request.id));
    const parsed = catalogSearchRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidRequest(request.id));
    try {
      return sendChecked(reply, request, catalogSearchResponseSchema, await service.search(parsed.data));
    } catch (error) {
      if (isDatabaseUnavailable(error)) return reply.code(503).send(unavailable(request.id));
      throw error;
    }
  });

  app.get('/v2/catalog/products/:productKey/context', {
    schema: {
      tags: ['Catalog v2'],
      summary: 'Read a coherent product context',
      security: [{ apiKeyAuth: [] }],
      params: {
        type: 'object',
        required: ['productKey'],
        additionalProperties: false,
        properties: { productKey: { type: 'string', pattern: '^P[0-9]+$' } },
      },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { quantity: { type: 'integer', minimum: 1, maximum: 99, default: 1 } },
      },
      response: {
        200: jsonSchema(productContextResponseSchema),
        400: errorSchema,
        401: errorSchema,
        429: errorSchema,
        500: errorSchema,
        503: errorSchema,
      },
    },
  }, async (request, reply) => {
    if (!service) return reply.code(503).send(unavailable(request.id));
    const params = request.params as { productKey?: string };
    const query = request.query as { quantity?: string | number };
    const productKey = params.productKey ?? '';
    const quantity = query.quantity === undefined ? 1 : Number(query.quantity);
    if (!/^P\d+$/u.test(productKey) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return reply.code(400).send(invalidRequest(request.id));
    }
    try {
      return sendChecked(reply, request, productContextResponseSchema, await service.getProductContext({ productKey, quantity }));
    } catch (error) {
      if (isDatabaseUnavailable(error)) return reply.code(503).send(unavailable(request.id));
      throw error;
    }
  });

  app.get('/v2/catalog/items/:itemKey/context', {
    schema: {
      tags: ['Catalog v2'],
      summary: 'Read a coherent sellable-item context',
      security: [{ apiKeyAuth: [] }],
      params: {
        type: 'object',
        required: ['itemKey'],
        additionalProperties: false,
        properties: { itemKey: { type: 'string', pattern: '^P[0-9]+(?:-V[0-9]+)?$' } },
      },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { quantity: { type: 'integer', minimum: 1, maximum: 99, default: 1 } },
      },
      response: {
        200: jsonSchema(itemContextResponseSchema),
        400: errorSchema,
        401: errorSchema,
        429: errorSchema,
        500: errorSchema,
        503: errorSchema,
      },
    },
  }, async (request, reply) => {
    if (!service) return reply.code(503).send(unavailable(request.id));
    const params = request.params as { itemKey?: string };
    const query = request.query as { quantity?: string | number };
    const itemKey = params.itemKey ?? '';
    const quantity = query.quantity === undefined ? 1 : Number(query.quantity);
    if (!/^P\d+(?:-V\d+)?$/u.test(itemKey) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return reply.code(400).send(invalidRequest(request.id));
    }
    try {
      return sendChecked(reply, request, itemContextResponseSchema, await service.getItemContext({ itemKey, quantity }));
    } catch (error) {
      if (isDatabaseUnavailable(error)) return reply.code(503).send(unavailable(request.id));
      throw error;
    }
  });
}
