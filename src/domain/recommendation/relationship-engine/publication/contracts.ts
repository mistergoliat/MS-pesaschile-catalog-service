import { z } from 'zod';
import {
  calculatedProductRelationshipSchema,
  relationshipDataWindowSchema,
  type CalculatedProductRelationship,
} from '../contracts.js';
import {
  type ValidatedProductRelationship,
} from '../validation/contracts.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function' || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return value.every((item) => isJsonValue(item, seen));
  }
  if (isPlainRecord(value)) {
    if (value instanceof Error || seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).every((item) => isJsonValue(item, seen));
  }
  return false;
}

function addIssue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
  });
}

function productIdentity(product: CalculatedProductRelationship['sourceProduct']): string {
  return `${product.productId}:${product.combinationId ?? ''}`;
}

function directedPairIdentity(relationship: CalculatedProductRelationship): string {
  return `${productIdentity(relationship.sourceProduct)}->${productIdentity(relationship.targetProduct)}`;
}

export const productRelationshipSnapshotSchemaVersionSchema = z.literal('1');

export const productRelationshipSnapshotSchema = z
  .object({
    schemaVersion: productRelationshipSnapshotSchemaVersionSchema,
    snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    modelVersion: z.string().trim().min(1),
    evidenceWindow: relationshipDataWindowSchema,
    relationshipCount: z.number().int().nonnegative(),
    relationships: z.array(calculatedProductRelationshipSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.relationshipCount !== snapshot.relationships.length) {
      addIssue(context, ['relationshipCount'], 'relationshipCount must equal relationships.length');
    }
    for (const [index, relationship] of snapshot.relationships.entries()) {
      if (relationship.modelVersion !== snapshot.modelVersion) {
        addIssue(context, ['relationships', index, 'modelVersion'], 'relationship modelVersion must match snapshot');
      }
      if (
        relationship.evidenceWindow.from !== snapshot.evidenceWindow.from ||
        relationship.evidenceWindow.to !== snapshot.evidenceWindow.to
      ) {
        addIssue(context, ['relationships', index, 'evidenceWindow'], 'relationship evidenceWindow must match snapshot');
      }
    }
  });

export const productRelationshipSnapshotPublicationContextSchema = z
  .object({
    publishedAt: z.string().trim().min(1).optional(),
  })
  .strict();

export const productRelationshipSnapshotPublicationParametersSchema = z
  .object({
    allowEmptySnapshot: z.boolean(),
  })
  .strict();

export const DEFAULT_PRODUCT_RELATIONSHIP_SNAPSHOT_PUBLICATION_PARAMETERS = {
  allowEmptySnapshot: false,
} as const;

export const emptyProductRelationshipSnapshotMetadataSchema = z
  .object({
    modelVersion: z.string().trim().min(1),
    evidenceWindow: relationshipDataWindowSchema,
  })
  .strict();

export const productRelationshipSnapshotBuildStatisticsSchema = z
  .object({
    relationshipsRead: z.number().int().nonnegative(),
    relationshipsPublished: z.number().int().nonnegative(),
    distinctSourceProducts: z.number().int().nonnegative(),
    distinctTargetProducts: z.number().int().nonnegative(),
    distinctDirectedPairs: z.number().int().nonnegative(),
  })
  .strict();

export const productRelationshipSnapshotBuildWarningCodeSchema = z.enum([
  'EMPTY_SNAPSHOT_PUBLISHED',
]);

export const productRelationshipSnapshotBuildWarningSchema = z
  .object({
    code: productRelationshipSnapshotBuildWarningCodeSchema,
    message: z.string().trim().min(1),
    details: z.custom<JsonValue>((value) => isJsonValue(value)).optional(),
  })
  .strict();

export const productRelationshipSnapshotBuildResultSchema = z
  .object({
    snapshot: productRelationshipSnapshotSchema,
    statistics: productRelationshipSnapshotBuildStatisticsSchema,
    warnings: z.array(productRelationshipSnapshotBuildWarningSchema),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.statistics.relationshipsPublished !== result.snapshot.relationshipCount) {
      addIssue(context, ['statistics', 'relationshipsPublished'], 'relationshipsPublished must equal snapshot count');
    }
    if (result.statistics.relationshipsPublished !== result.snapshot.relationships.length) {
      addIssue(context, ['statistics', 'relationshipsPublished'], 'relationshipsPublished must equal relationships.length');
    }
    if (result.statistics.relationshipsRead !== result.statistics.relationshipsPublished) {
      addIssue(context, ['statistics', 'relationshipsRead'], 'relationshipsRead must equal relationshipsPublished');
    }
  });

export const productRelationshipSnapshotSaveResultSchema = z
  .object({
    status: z.enum(['created', 'already_exists']),
    snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

export const productRelationshipSnapshotPublicationResultSchema = z
  .object({
    snapshot: productRelationshipSnapshotSchema,
    saveStatus: z.enum(['created', 'already_exists']),
    activated: z.literal(true),
    publishedAt: z.string().trim().min(1).optional(),
    statistics: productRelationshipSnapshotBuildStatisticsSchema,
    warnings: z.array(productRelationshipSnapshotBuildWarningSchema),
  })
  .strict();

export interface ProductRelationshipSnapshotBuilder {
  build(input: {
    relationships: readonly ValidatedProductRelationship[];
    parameters?: ProductRelationshipSnapshotPublicationParameters;
    emptySnapshotMetadata?: EmptyProductRelationshipSnapshotMetadata;
  }): ProductRelationshipSnapshotBuildResult;
}

export interface ProductRelationshipSnapshotStore {
  save(snapshot: ProductRelationshipSnapshot): Promise<ProductRelationshipSnapshotSaveResult>;

  activate(snapshotId: string): Promise<void>;

  getById(snapshotId: string): Promise<ProductRelationshipSnapshot | null>;

  getActive(): Promise<ProductRelationshipSnapshot | null>;
}

export interface ProductRelationshipSnapshotPublisher {
  publish(input: {
    relationships: readonly ValidatedProductRelationship[];
    parameters?: ProductRelationshipSnapshotPublicationParameters;
    emptySnapshotMetadata?: EmptyProductRelationshipSnapshotMetadata;
    publicationContext?: ProductRelationshipSnapshotPublicationContext;
  }): Promise<ProductRelationshipSnapshotPublicationResult>;
}

export type ProductRelationshipSnapshotSchemaVersion = z.infer<typeof productRelationshipSnapshotSchemaVersionSchema>;
export type ProductRelationshipSnapshot = Omit<z.infer<typeof productRelationshipSnapshotSchema>, 'relationships'> & {
  readonly relationships: readonly CalculatedProductRelationship[];
};
export type ProductRelationshipSnapshotPublicationContext = z.infer<typeof productRelationshipSnapshotPublicationContextSchema>;
export type ProductRelationshipSnapshotPublicationParameters = z.infer<typeof productRelationshipSnapshotPublicationParametersSchema>;
export type EmptyProductRelationshipSnapshotMetadata = z.infer<typeof emptyProductRelationshipSnapshotMetadataSchema>;
export type ProductRelationshipSnapshotBuildStatistics = z.infer<typeof productRelationshipSnapshotBuildStatisticsSchema>;
export type ProductRelationshipSnapshotBuildWarningCode = z.infer<typeof productRelationshipSnapshotBuildWarningCodeSchema>;
export type ProductRelationshipSnapshotBuildWarning = z.infer<typeof productRelationshipSnapshotBuildWarningSchema>;
export type ProductRelationshipSnapshotBuildResult = Omit<z.infer<typeof productRelationshipSnapshotBuildResultSchema>, 'snapshot'> & {
  snapshot: ProductRelationshipSnapshot;
};
export type ProductRelationshipSnapshotSaveResult = z.infer<typeof productRelationshipSnapshotSaveResultSchema>;
export type ProductRelationshipSnapshotPublicationResult = Omit<
  z.infer<typeof productRelationshipSnapshotPublicationResultSchema>,
  'snapshot'
> & {
  snapshot: ProductRelationshipSnapshot;
};

export const relationshipSnapshotContractHelpers = {
  directedPairIdentity,
  isJsonValue,
  productIdentity,
} as const;
