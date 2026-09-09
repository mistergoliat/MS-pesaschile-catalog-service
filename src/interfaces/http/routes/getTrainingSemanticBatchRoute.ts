import type { FastifyInstance } from 'fastify';
import type { TrainingSemanticReadService } from '../../../application/catalog/training-semantic-read/index.js';
import { InvalidTrainingSemanticRequestError, TrainingSemanticsUnavailableError } from '../../../shared/errors.js';
import { trainingSemanticErrorResponseSchema } from './getTrainingSemanticProductRoute.js';

export const TRAINING_SEMANTICS_BATCH_MAX_SIZE = 500;

const evidenceSchema = { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { type: 'string' }, sourceId: { type: 'string' }, matchedText: { type: 'string' }, ruleId: { type: 'string' }, note: { type: 'string' } } } as const;
const publicProductSchema = {
  type: 'object', additionalProperties: false, required: ['productId', 'resolutionState', 'coverageStatus', 'exerciseCapabilities', 'trainingFunctions', 'derived'],
  properties: {
    productId: { type: 'integer', minimum: 1 }, resolutionState: { type: 'string' }, coverageStatus: { type: 'string' },
    exerciseCapabilities: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code', 'relationType', 'classificationConfidence', 'evidence'], properties: { code: { type: 'string' }, relationType: { type: 'string' }, classificationConfidence: { type: 'string' }, evidence: { type: 'array', items: evidenceSchema } } } },
    trainingFunctions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code', 'relationType', 'evidence'], properties: { code: { type: 'string' }, relationType: { type: 'string' }, evidence: { type: 'array', items: evidenceSchema } } } },
    derived: { type: 'object', additionalProperties: false, required: ['bodyRegions', 'primaryMuscleGroups', 'secondaryMuscleGroups', 'trainingPatterns'], properties: { bodyRegions: { type: 'array', items: { type: 'string' } }, primaryMuscleGroups: { type: 'array', items: { type: 'string' } }, secondaryMuscleGroups: { type: 'array', items: { type: 'string' } }, trainingPatterns: { type: 'array', items: { type: 'string' } } } },
  },
} as const;

// Validation is performed in the application service so all malformed batch
// requests use the stable Training Semantic error code, including array-size
// and expectedSnapshotId failures.
const requestSchema = { type: 'object', additionalProperties: false, properties: { productIds: {}, expectedSnapshotId: {} } } as const;
const responseSchema = { type: 'object', additionalProperties: false, required: ['schemaVersion', 'lineage', 'products', 'missingProductIds'], properties: { schemaVersion: { type: 'string', enum: ['2'] }, lineage: { type: 'object', additionalProperties: false, required: ['snapshotId', 'semanticChecksum', 'registryVersion', 'registryHash', 'classifierVersion', 'rulesHash'], properties: { snapshotId: { type: 'string' }, semanticChecksum: { type: 'string' }, registryVersion: { type: 'string' }, registryHash: { type: 'string' }, classifierVersion: { type: 'string' }, rulesHash: { type: 'string' } } }, products: { type: 'array', items: publicProductSchema }, missingProductIds: { type: 'array', items: { type: 'integer', minimum: 1 } } } } as const;

type BatchRequest = { readonly productIds?: unknown; readonly expectedSnapshotId?: unknown };

export async function registerGetTrainingSemanticBatchRoute(app: FastifyInstance, service?: TrainingSemanticReadService): Promise<void> {
  app.post('/v1/products/training-semantics/batch', {
    schema: { tags: ['Products'], summary: 'Read Training Semantic Product Truth V2 in bulk', description: 'Reads one active Training Semantic Snapshot V2 for the complete response. Duplicate IDs are removed deterministically while preserving first occurrence order.', security: [{ apiKeyAuth: [] }], body: requestSchema, response: { 200: responseSchema, 400: trainingSemanticErrorResponseSchema, 401: trainingSemanticErrorResponseSchema, 409: trainingSemanticErrorResponseSchema, 503: trainingSemanticErrorResponseSchema } },
  }, async (request, reply) => {
    if (!service) throw new TrainingSemanticsUnavailableError();
    const body = request.body as BatchRequest;
    if (!Array.isArray(body?.productIds) || body.productIds.length === 0 || body.productIds.length > TRAINING_SEMANTICS_BATCH_MAX_SIZE) throw new InvalidTrainingSemanticRequestError('productIds must contain between 1 and 500 ids');
    const productIds = body.productIds as unknown[];
    if (productIds.some((value) => !Number.isSafeInteger(value) || (value as number) <= 0)) throw new InvalidTrainingSemanticRequestError('productIds must contain positive integer ids');
    if (body.expectedSnapshotId !== undefined && typeof body.expectedSnapshotId !== 'string') throw new InvalidTrainingSemanticRequestError('expectedSnapshotId must be a string');
    return reply.code(200).send(service.getProducts(productIds as number[], body.expectedSnapshotId as string | undefined));
  });
}
