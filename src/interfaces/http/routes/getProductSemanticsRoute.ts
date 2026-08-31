import type { FastifyInstance } from 'fastify';
import type { ActiveProductSemanticSnapshotReader } from '../../../domain/product-semantic-snapshot/runtime/index.js';
import { ProductSemanticsNotFoundError, ProductSemanticsUnavailableError } from '../../../shared/errors.js';

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

const ontologyTagSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['axis', 'code', 'confidence', 'ruleId'],
  properties: {
    axis: { type: 'string', enum: ['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'] },
    code: { type: 'string' },
    confidence: { type: 'string', enum: ['EXPLICIT', 'STRONGLY_INFERRED'] },
    ruleId: { type: 'string' },
  },
} as const;

const evidenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['axis', 'code', 'ruleId', 'sourceType', 'sourceId', 'rawValue', 'normalizedValue'],
  properties: {
    axis: { type: 'string', enum: ['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'] },
    code: { type: 'string' },
    ruleId: { type: 'string' },
    sourceType: { type: 'string', enum: ['NAME_TEXT', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'FAMILY_INFERENCE'] },
    sourceId: { type: 'string' },
    rawValue: { type: 'string' },
    normalizedValue: { type: 'string' },
  },
} as const;

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'productId',
    'classificationStatus',
    'primaryProductFamily',
    'secondaryProductFamilies',
    'disciplines',
    'useContexts',
    'ontologyVersion',
    'ontologyHash',
    'classifierVersion',
    'snapshotId',
    'provenance',
  ],
  properties: {
    productId: { type: 'integer' },
    classificationStatus: {
      type: 'string',
      enum: ['CLASSIFIED', 'PARTIALLY_CLASSIFIED', 'OTHER', 'EXCLUDED_NON_PRODUCT', 'NEEDS_REVIEW'],
    },
    primaryProductFamily: { ...ontologyTagSchema, type: ['object', 'null'] },
    secondaryProductFamilies: { type: 'array', items: ontologyTagSchema },
    disciplines: { type: 'array', items: ontologyTagSchema },
    useContexts: { type: 'array', items: ontologyTagSchema },
    ontologyVersion: { type: 'string' },
    ontologyHash: { type: 'string' },
    classifierVersion: { type: 'string' },
    snapshotId: { type: 'string' },
    provenance: {
      type: 'object',
      additionalProperties: false,
      required: ['evidence', 'exclusion'],
      properties: {
        evidence: { type: 'array', items: evidenceSchema },
        exclusion: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['ruleId', 'reason'],
          properties: {
            ruleId: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

export async function registerGetProductSemanticsRoute(
  app: FastifyInstance,
  reader?: ActiveProductSemanticSnapshotReader,
): Promise<void> {
  app.get('/v1/products/:productId/semantics', {
    schema: {
      tags: ['Products'],
      summary: 'Read published product semantic facts',
      description: [
        'Returns the product semantic facts materialized in the active product semantic snapshot.',
        'Read-only: never classifies on demand and never queries PrestaShop for semantics.',
        'A product present in the source universe but assigned no semantic tags is returned with classificationStatus OTHER, not 404.',
        'A product excluded from the commercial universe is returned with classificationStatus EXCLUDED_NON_PRODUCT and exclusion provenance, not 404.',
      ].join(' '),
      security: [{ apiKeyAuth: [] }],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['productId'],
        properties: {
          productId: { type: 'integer', minimum: 1 },
        },
      },
      response: {
        200: responseSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: { ...errorResponseSchema, description: 'Product is not present in the active product semantic snapshot universe.' },
        503: { ...errorResponseSchema, description: 'Active product semantic snapshot is not loaded.' },
      },
    },
  }, async (request, reply) => {
    const { productId } = request.params as { productId: number };
    const productIdKey = String(productId);

    if (!reader) {
      throw new ProductSemanticsUnavailableError();
    }
    const metadata = reader.getActiveSnapshotMetadata();
    if (metadata === null) {
      throw new ProductSemanticsUnavailableError();
    }

    const fact = reader.getProductSemanticFact(productIdKey);
    if (fact === null) {
      throw new ProductSemanticsNotFoundError();
    }

    reply.type('application/json');
    return reply.code(200).send({
      productId,
      classificationStatus: fact.classificationStatus,
      primaryProductFamily: fact.primaryProductFamily,
      secondaryProductFamilies: fact.secondaryProductFamilies,
      disciplines: fact.disciplines,
      useContexts: fact.useContexts,
      ontologyVersion: fact.ontologyVersion,
      ontologyHash: fact.ontologyHash,
      classifierVersion: metadata.classifierVersion,
      snapshotId: metadata.snapshotId,
      provenance: fact.provenance,
    });
  });
}
