import type { FastifyInstance } from 'fastify';
import type { TrainingSemanticQueryService } from '../../../application/catalog/training-semantic-query/index.js';
import { TrainingSemanticsUnavailableError } from '../../../shared/errors.js';
import { trainingSemanticErrorResponseSchema } from './getTrainingSemanticProductRoute.js';

const evidenceSchema = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: { kind: { type: 'string' }, sourceId: { type: 'string' }, matchedText: { type: 'string' }, ruleId: { type: 'string' }, note: { type: 'string' } },
} as const;

const queryResponseSchema = {
  type: 'object',
  required: ['schemaVersion', 'lineage', 'query', 'results', 'totalMatches', 'truncated'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    lineage: {
      type: 'object', additionalProperties: false,
      required: ['snapshotId', 'semanticChecksum', 'registryVersion', 'registryHash', 'classifierVersion', 'rulesHash'],
      properties: {
        snapshotId: { type: 'string' }, semanticChecksum: { type: 'string' }, registryVersion: { type: 'string' },
        registryHash: { type: 'string' }, classifierVersion: { type: 'string' }, rulesHash: { type: 'string' },
      },
    },
    query: {
      type: 'object', additionalProperties: false, required: ['requirements', 'options'],
      properties: {
        requirements: {
          type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['axis', 'codes', 'mode', 'match'],
            properties: {
              axis: { type: 'string' }, codes: { type: 'array', items: { type: 'string' } },
              mode: { type: 'string' }, match: { type: 'string' }, relations: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        options: { type: 'object', additionalProperties: false, required: ['limit'], properties: { limit: { type: 'integer' } } },
      },
    },
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['productId', 'resolutionState', 'coverageStatus', 'matchedRequirements', 'exerciseCapabilities', 'trainingFunctions', 'derived'],
        properties: {
          productId: { type: 'integer' }, resolutionState: { type: 'string' }, coverageStatus: { type: 'string' },
          matchedRequirements: {
            type: 'array', items: {
              type: 'object', additionalProperties: false,
              required: ['axis', 'codes', 'matchedCodes', 'relationTypes', 'mode', 'match', 'reason'],
              properties: {
                axis: { type: 'string' }, codes: { type: 'array', items: { type: 'string' } }, matchedCodes: { type: 'array', items: { type: 'string' } },
                relationTypes: { type: 'array', items: { type: 'string' } }, mode: { type: 'string' }, match: { type: 'string' }, reason: { type: 'string' },
              },
            },
          },
          exerciseCapabilities: {
            type: 'array', items: {
              type: 'object', additionalProperties: false, required: ['code', 'relationType', 'classificationConfidence', 'evidence'],
              properties: {
                code: { type: 'string' }, relationType: { type: 'string' }, classificationConfidence: { type: 'string' },
                evidence: { type: 'array', items: evidenceSchema },
              },
            },
          },
          trainingFunctions: {
            type: 'array', items: {
              type: 'object', additionalProperties: false, required: ['code', 'relationType', 'evidence'],
              properties: { code: { type: 'string' }, relationType: { type: 'string' }, evidence: { type: 'array', items: evidenceSchema } },
            },
          },
          derived: {
            type: 'object', additionalProperties: false, required: ['bodyRegions', 'primaryMuscleGroups', 'secondaryMuscleGroups', 'trainingPatterns'],
            properties: {
              bodyRegions: { type: 'array', items: { type: 'string' } }, primaryMuscleGroups: { type: 'array', items: { type: 'string' } },
              secondaryMuscleGroups: { type: 'array', items: { type: 'string' } }, trainingPatterns: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    totalMatches: { type: 'integer', minimum: 0 },
    truncated: { type: 'boolean' },
  },
} as const;

export async function registerQueryTrainingSemanticsRoute(app: FastifyInstance, service?: TrainingSemanticQueryService): Promise<void> {
  app.post('/v1/products/training-semantics/query', {
    schema: {
      tags: ['Products'],
      summary: 'Query structured Training Semantic Product Truth V2',
      description: 'Structured-only query over the active immutable Training Semantic Snapshot V2. It does not interpret free text.',
      security: [{ apiKeyAuth: [] }],
      response: {
        200: queryResponseSchema,
        400: trainingSemanticErrorResponseSchema,
        401: trainingSemanticErrorResponseSchema,
        409: trainingSemanticErrorResponseSchema,
        503: trainingSemanticErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (!service) throw new TrainingSemanticsUnavailableError();
    return reply.code(200).send(service.query(request.body));
  });
}

export { queryResponseSchema as trainingSemanticQueryResponseSchema };
