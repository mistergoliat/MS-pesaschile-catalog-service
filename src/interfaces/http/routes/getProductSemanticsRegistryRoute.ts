import type { FastifyInstance } from 'fastify';
import { ontologyAxes, ontologyTagStatuses } from '../../../domain/commercial-product-ontology/index.js';
import type { ProductSemanticsRegistryService } from '../../../application/catalog/product-semantics-registry/index.js';
import { defaultProductSemanticsRegistryService } from '../../../application/catalog/product-semantics-registry/index.js';

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
        correlationId: { type: 'string' },
      },
    },
  },
} as const;

const registryValueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'labelEs', 'definition', 'status', 'residual'],
  properties: {
    code: { type: 'string' },
    labelEs: { type: 'string' },
    definition: { type: 'string' },
    status: { type: 'string', enum: [...ontologyTagStatuses] },
    residual: { type: 'boolean' },
  },
} as const;

const registryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'ontologyVersion', 'ontologyHash', 'status', 'axes'],
  properties: {
    schemaVersion: { type: 'string', enum: ['1'] },
    ontologyVersion: { type: 'string' },
    ontologyHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    status: { type: 'string', enum: ['PUBLISHED'] },
    axes: {
      type: 'array',
      minItems: ontologyAxes.length,
      maxItems: ontologyAxes.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['axis', 'values'],
        properties: {
          axis: { type: 'string', enum: [...ontologyAxes] },
          values: { type: 'array', items: registryValueSchema },
        },
      },
    },
  },
} as const;

export async function registerGetProductSemanticsRegistryRoute(
  app: FastifyInstance,
  service: ProductSemanticsRegistryService = defaultProductSemanticsRegistryService,
): Promise<void> {
  app.get('/v1/products/semantics/registry', {
    schema: {
      tags: ['Products'],
      summary: 'Read the published product semantics ontology vocabulary',
      description: [
        'Returns the complete, deterministic public projection of Catalog-owned commercial product ontology v3.',
        'Only vocabulary metadata is exposed; classifier evidence and implementation details are not part of this contract.',
      ].join(' '),
      security: [{ apiKeyAuth: [] }],
      response: {
        200: registryResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (_request, reply) => {
    return reply.type('application/json').code(200).send(service.getRegistry());
  });
}
