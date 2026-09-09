import type { FastifyInstance } from 'fastify';
import type { SemanticDiscoveryService } from '../../../application/catalog/semantic-discovery/index.js';
import { TrainingSemanticsUnavailableError } from '../../../shared/errors.js';

const errorResponseSchema = {
  type: 'object', additionalProperties: false, required: ['error'],
  properties: { error: { type: 'object', additionalProperties: false, required: ['code', 'message', 'correlationId'], properties: { code: { type: 'string' }, message: { type: 'string' }, correlationId: { type: 'string' } } } },
} as const;

const responseSchema = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'lineage', 'query', 'results', 'totalMatches', 'truncated'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    lineage: {
      type: 'object', additionalProperties: false, required: ['productSemantics', 'trainingSemantics'],
      properties: {
        productSemantics: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: true }] },
        trainingSemantics: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: true }] },
      },
    },
    query: {
      type: 'object', additionalProperties: false, required: ['requirements', 'options'],
      properties: {
        requirements: { type: 'array', items: { type: 'object', additionalProperties: true } },
        options: { type: 'object', additionalProperties: false, required: ['limit'], properties: { limit: { type: 'integer' } } },
      },
    },
    results: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['productId', 'matchedRequirements', 'productSemantics', 'trainingSemantics'],
        properties: {
          productId: { type: 'integer', minimum: 1 },
          matchedRequirements: { type: 'array', items: { type: 'object', additionalProperties: true } },
          productSemantics: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: true }] },
          trainingSemantics: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: true }] },
        },
      },
    },
    totalMatches: { type: 'integer', minimum: 0 }, truncated: { type: 'boolean' },
  },
} as const;

export async function registerSemanticDiscoveryQueryRoute(app: FastifyInstance, service?: SemanticDiscoveryService): Promise<void> {
  app.post('/v1/products/semantic-discovery/query', {
    schema: {
      tags: ['Products'],
      summary: 'Query combined Product and Training Semantic Product Truth',
      description: 'Structured-only cross-domain semantic discovery. It does not interpret natural language or relax constraints.',
      security: [{ apiKeyAuth: [] }],
      response: { 200: responseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema },
    },
  }, async (request, reply) => {
    if (!service) throw new TrainingSemanticsUnavailableError('Semantic discovery service is not wired');
    return reply.code(200).send(service.query(request.body));
  });
}

export { responseSchema as semanticDiscoveryResponseSchema };
