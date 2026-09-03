import type { FastifyInstance } from 'fastify';
import type { ActiveProductSemanticSnapshotReader } from '../../../domain/product-semantic-snapshot/runtime/index.js';
import {
  InvalidInputError,
  ProductSemanticSnapshotMismatchError,
  ProductSemanticsUnavailableError,
} from '../../../shared/errors.js';

export const PRODUCT_SEMANTICS_BATCH_MAX_SIZE = 500;

const classificationStatuses = [
  'CLASSIFIED',
  'PARTIALLY_CLASSIFIED',
  'OTHER',
  'EXCLUDED_NON_PRODUCT',
  'NEEDS_REVIEW',
] as const;

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

const publicTagSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'confidence'],
  properties: {
    code: { type: 'string' },
    confidence: { type: 'string', enum: ['EXPLICIT', 'STRONGLY_INFERRED'] },
  },
} as const;

const publicFactSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'productId',
    'classificationStatus',
    'primaryProductFamily',
    'secondaryProductFamilies',
    'disciplines',
    'useContexts',
  ],
  properties: {
    productId: { type: 'integer', minimum: 1 },
    classificationStatus: { type: 'string', enum: [...classificationStatuses] },
    primaryProductFamily: { anyOf: [publicTagSchema, { type: 'null' }] },
    secondaryProductFamilies: { type: 'array', items: publicTagSchema },
    disciplines: { type: 'array', items: publicTagSchema },
    useContexts: { type: 'array', items: publicTagSchema },
  },
} as const;

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'snapshotId',
    'ontologyVersion',
    'ontologyHash',
    'classifierVersion',
    'semanticChecksum',
    'products',
    'missingProductIds',
  ],
  properties: {
    schemaVersion: { type: 'string', enum: ['1'] },
    snapshotId: { type: 'string' },
    ontologyVersion: { type: 'string' },
    ontologyHash: { type: 'string' },
    classifierVersion: { type: 'string' },
    semanticChecksum: { type: 'string' },
    products: { type: 'array', items: publicFactSchema },
    missingProductIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
  },
} as const;

const requestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['productIds'],
  properties: {
    productIds: {
      type: 'array',
      minItems: 1,
      maxItems: PRODUCT_SEMANTICS_BATCH_MAX_SIZE,
      items: { type: 'integer', minimum: 1 },
    },
    expectedSnapshotId: {
      type: 'string',
      pattern: '^sha256:[a-f0-9]{64}$',
    },
  },
} as const;

type BatchRequest = {
  readonly productIds: number[];
  readonly expectedSnapshotId?: string;
};

function normalizeProductIds(productIds: readonly number[]): number[] {
  return [...new Set(productIds)];
}

function publicTag(tag: { readonly code: string; readonly confidence: string }) {
  return { code: tag.code, confidence: tag.confidence };
}

function publicFact(fact: {
  readonly productId: string;
  readonly classificationStatus: (typeof classificationStatuses)[number];
  readonly primaryProductFamily: { readonly code: string; readonly confidence: string } | null;
  readonly secondaryProductFamilies: readonly { readonly code: string; readonly confidence: string }[];
  readonly disciplines: readonly { readonly code: string; readonly confidence: string }[];
  readonly useContexts: readonly { readonly code: string; readonly confidence: string }[];
}) {
  return {
    productId: Number(fact.productId),
    classificationStatus: fact.classificationStatus,
    primaryProductFamily: fact.primaryProductFamily ? publicTag(fact.primaryProductFamily) : null,
    secondaryProductFamilies: fact.secondaryProductFamilies.map(publicTag),
    disciplines: fact.disciplines.map(publicTag),
    useContexts: fact.useContexts.map(publicTag),
  };
}

export async function registerGetProductSemanticsBatchRoute(
  app: FastifyInstance,
  reader?: ActiveProductSemanticSnapshotReader,
): Promise<void> {
  app.post('/v1/products/semantics/batch', {
    schema: {
      tags: ['Products'],
      summary: 'Read published product semantic facts in bulk',
      description: [
        'Returns semantic facts exclusively from the active product semantic runtime snapshot.',
        'The request is deterministically de-duplicated while preserving first appearance order.',
        'OTHER, EXCLUDED_NON_PRODUCT, and NEEDS_REVIEW are returned as facts; missingProductIds only means absent from the snapshot universe.',
        'expectedSnapshotId pins a multi-request consumer run to one snapshot lineage.',
      ].join(' '),
      security: [{ apiKeyAuth: [] }],
      body: requestSchema,
      response: {
        200: responseSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
        409: errorResponseSchema,
        503: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body as BatchRequest;
    if (!Array.isArray(body?.productIds) || body.productIds.length === 0) {
      throw new InvalidInputError('productIds must be a non-empty array');
    }
    if (body.productIds.length > PRODUCT_SEMANTICS_BATCH_MAX_SIZE) {
      throw new InvalidInputError(`productIds cannot contain more than ${PRODUCT_SEMANTICS_BATCH_MAX_SIZE} ids`);
    }
    if (
      body.productIds.some((productId) => !Number.isSafeInteger(productId) || productId <= 0) ||
      (body.expectedSnapshotId !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(body.expectedSnapshotId))
    ) {
      throw new InvalidInputError('Invalid product semantics batch request');
    }

    if (!reader) throw new ProductSemanticsUnavailableError();
    const metadata = reader.getActiveSnapshotMetadata();
    if (metadata === null) throw new ProductSemanticsUnavailableError();
    if (body.expectedSnapshotId !== undefined && body.expectedSnapshotId !== metadata.snapshotId) {
      throw new ProductSemanticSnapshotMismatchError();
    }

    const normalizedProductIds = normalizeProductIds(body.productIds);
    const products = [];
    const missingProductIds: number[] = [];
    for (const productId of normalizedProductIds) {
      const fact = reader.getProductSemanticFact(String(productId));
      if (fact === null) {
        missingProductIds.push(productId);
      } else {
        products.push(publicFact(fact));
      }
    }

    return reply.code(200).send({
      schemaVersion: metadata.schemaVersion,
      snapshotId: metadata.snapshotId,
      ontologyVersion: metadata.ontologyVersion,
      ontologyHash: metadata.ontologyHash,
      classifierVersion: metadata.classifierVersion,
      semanticChecksum: metadata.semanticChecksum,
      products,
      missingProductIds,
    });
  });
}
