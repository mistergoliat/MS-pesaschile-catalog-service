import type { FastifyInstance } from 'fastify';
import type { TrainingSemanticReadService } from '../../../application/catalog/training-semantic-read/index.js';
import { getTrainingSemanticRegistryV2 } from '../../../domain/training-semantics-v2/index.js';
import { trainingSemanticErrorResponseSchema } from './getTrainingSemanticProductRoute.js';

const registryResponseSchema = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'registryVersion', 'registryHash', 'status', 'exerciseCapabilities', 'trainingFunctions', 'bodyRegions', 'muscleGroups', 'trainingPatterns', 'exerciseDerivedRelations', 'familyTrainingFunctionDerivations', 'semanticBoundaries'],
  properties: {
    schemaVersion: { type: 'string', enum: ['2'] }, registryVersion: { type: 'string' }, registryHash: { type: 'string' }, status: { type: 'string', enum: ['PUBLISHED'] },
    exerciseCapabilities: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code', 'canonicalName', 'description', 'status', 'derivedBodyRegions', 'primaryMuscleGroups', 'secondaryMuscleGroups', 'trainingPatterns'], properties: { code: { type: 'string' }, canonicalName: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' }, derivedBodyRegions: { type: 'array', items: { type: 'string' } }, primaryMuscleGroups: { type: 'array', items: { type: 'string' } }, secondaryMuscleGroups: { type: 'array', items: { type: 'string' } }, trainingPatterns: { type: 'array', items: { type: 'string' } } } } },
    trainingFunctions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code', 'canonicalName', 'description', 'status', 'allowedRelationTypes', 'allowedEvidenceKinds'], properties: { code: { type: 'string' }, canonicalName: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' }, allowedRelationTypes: { type: 'array', items: { type: 'string' } }, allowedEvidenceKinds: { type: 'array', items: { type: 'string' } } } } },
    bodyRegions: { type: 'array', items: { type: 'string' } }, muscleGroups: { type: 'array', items: { type: 'string' } }, trainingPatterns: { type: 'array', items: { type: 'string' } },
    exerciseDerivedRelations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['capabilityCode', 'bodyRegions', 'primaryMuscleGroups', 'secondaryMuscleGroups', 'trainingPatterns'], properties: { capabilityCode: { type: 'string' }, bodyRegions: { type: 'array', items: { type: 'string' } }, primaryMuscleGroups: { type: 'array', items: { type: 'string' } }, secondaryMuscleGroups: { type: 'array', items: { type: 'string' } }, trainingPatterns: { type: 'array', items: { type: 'string' } } } } },
    familyTrainingFunctionDerivations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['productFamily', 'trainingFunctionCode', 'relationType', 'evidenceKind', 'status', 'rationale'], properties: { productFamily: { type: 'string' }, trainingFunctionCode: { type: 'string' }, relationType: { type: 'string' }, evidenceKind: { type: 'string' }, status: { type: 'string' }, rationale: { type: 'string' } } } },
    semanticBoundaries: { type: 'object', additionalProperties: false, required: ['exerciseCapability', 'trainingFunction', 'deadlift', 'squat'], properties: { exerciseCapability: { type: 'string' }, trainingFunction: { type: 'string' }, deadlift: { type: 'object', additionalProperties: false, required: ['dedicatedMachine', 'deadliftJack', 'barbell', 'familyDerived'], properties: { dedicatedMachine: { type: 'string' }, deadliftJack: { type: 'string' }, barbell: { type: 'string' }, familyDerived: { type: 'boolean' } } }, squat: { type: 'object', additionalProperties: false, required: ['forbiddenGenericCode', 'explicitCapabilities', 'genericEquipmentPolicy'], properties: { forbiddenGenericCode: { type: 'string' }, explicitCapabilities: { type: 'array', items: { type: 'string' } }, genericEquipmentPolicy: { type: 'string' } } } } },
  },
} as const;

export async function registerGetTrainingSemanticRegistryRoute(app: FastifyInstance, service?: TrainingSemanticReadService): Promise<void> {
  app.get('/v1/products/training-semantics/registry', {
    schema: { tags: ['Products'], summary: 'Read the published Training Semantic Registry V2', description: 'Returns the public V2 vocabulary and semantic boundary. Product assignments and internal classifier rules are not exposed.', security: [{ apiKeyAuth: [] }], response: { 200: registryResponseSchema, 401: trainingSemanticErrorResponseSchema } },
  }, async (_request, reply) => reply.code(200).send(service?.getRegistry() ?? {
    schemaVersion: getTrainingSemanticRegistryV2().schemaVersion,
    registryVersion: getTrainingSemanticRegistryV2().registryVersion,
    registryHash: getTrainingSemanticRegistryV2().registryHash,
    status: getTrainingSemanticRegistryV2().status,
    exerciseCapabilities: getTrainingSemanticRegistryV2().exerciseCapabilities,
    trainingFunctions: getTrainingSemanticRegistryV2().trainingFunctions,
    bodyRegions: getTrainingSemanticRegistryV2().bodyRegions,
    muscleGroups: getTrainingSemanticRegistryV2().muscleGroups,
    trainingPatterns: getTrainingSemanticRegistryV2().trainingPatterns,
    exerciseDerivedRelations: getTrainingSemanticRegistryV2().exerciseDerivedRelations,
    familyTrainingFunctionDerivations: getTrainingSemanticRegistryV2().familyTrainingFunctionDerivations,
    semanticBoundaries: getTrainingSemanticRegistryV2().semanticBoundaries,
  }));
}
