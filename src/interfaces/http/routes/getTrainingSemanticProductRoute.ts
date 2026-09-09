import type { FastifyInstance } from 'fastify';
import type { TrainingSemanticReadService } from '../../../application/catalog/training-semantic-read/index.js';
import { TrainingSemanticsUnavailableError } from '../../../shared/errors.js';

const errorResponseSchema = {
  type: 'object', additionalProperties: false, required: ['error'],
  properties: { error: { type: 'object', additionalProperties: false, required: ['code', 'message', 'correlationId'], properties: { code: { type: 'string' }, message: { type: 'string' }, correlationId: { type: 'string' } } } },
} as const;

const evidenceSchema = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: { kind: { type: 'string' }, sourceId: { type: 'string' }, matchedText: { type: 'string' }, ruleId: { type: 'string' }, note: { type: 'string' } },
} as const;

const productResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'productId', 'resolutionState', 'coverageStatus', 'exerciseCapabilities', 'trainingFunctions', 'derived', 'lineage'],
  properties: {
    schemaVersion: { type: 'string', enum: ['2'] }, productId: { type: 'integer', minimum: 1 },
    resolutionState: { type: 'string', enum: ['SEMANTIC_COMPLETE', 'VERIFIED_NO_APPLICABLE_CAPABILITY', 'DATA_GAP', 'AMBIGUOUS', 'NEEDS_REVIEW', 'SEMANTIC_PARTIAL', 'ONTOLOGY_GAP', 'RULE_GAP'] },
    coverageStatus: { type: 'string' },
    exerciseCapabilities: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code', 'relationType', 'classificationConfidence', 'evidence'], properties: { code: { type: 'string' }, relationType: { type: 'string' }, classificationConfidence: { type: 'string' }, evidence: { type: 'array', items: evidenceSchema } } } },
    trainingFunctions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code', 'relationType', 'evidence'], properties: { code: { type: 'string' }, relationType: { type: 'string' }, evidence: { type: 'array', items: evidenceSchema } } } },
    derived: { type: 'object', additionalProperties: false, required: ['bodyRegions', 'primaryMuscleGroups', 'secondaryMuscleGroups', 'trainingPatterns'], properties: { bodyRegions: { type: 'array', items: { type: 'string' } }, primaryMuscleGroups: { type: 'array', items: { type: 'string' } }, secondaryMuscleGroups: { type: 'array', items: { type: 'string' } }, trainingPatterns: { type: 'array', items: { type: 'string' } } } },
    lineage: { type: 'object', additionalProperties: false, required: ['snapshotId', 'semanticChecksum', 'registryVersion', 'registryHash', 'classifierVersion', 'rulesHash'], properties: { snapshotId: { type: 'string' }, semanticChecksum: { type: 'string' }, registryVersion: { type: 'string' }, registryHash: { type: 'string' }, classifierVersion: { type: 'string' }, rulesHash: { type: 'string' } } },
  },
} as const;

export async function registerGetTrainingSemanticProductRoute(app: FastifyInstance, service?: TrainingSemanticReadService): Promise<void> {
  app.get('/v1/products/:productId/training-semantics', {
    schema: {
      tags: ['Products'], summary: 'Read Training Semantic Product Truth V2',
      description: 'Read-only projection of the active Training Semantic Snapshot V2. It never classifies on demand or queries the catalog database.',
      security: [{ apiKeyAuth: [] }],
      params: { type: 'object', additionalProperties: false, required: ['productId'], properties: { productId: {} } },
      response: { 200: productResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema, 503: errorResponseSchema },
    },
  }, async (request, reply) => {
    if (!service) throw new TrainingSemanticsUnavailableError();
    const rawProductId = (request.params as { productId?: unknown }).productId;
    const productId = typeof rawProductId === 'number' ? rawProductId : typeof rawProductId === 'string' && /^\d+$/u.test(rawProductId) ? Number(rawProductId) : Number.NaN;
    return reply.code(200).send(service.getProduct(productId));
  });
}

export { productResponseSchema as trainingSemanticProductResponseSchema, errorResponseSchema as trainingSemanticErrorResponseSchema };
