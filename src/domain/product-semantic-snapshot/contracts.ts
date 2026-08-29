import { z } from 'zod';
import {
  type ClassifiedOntologyTag,
  type ClassificationEvidenceRecord,
  type ProductSemanticClassificationResult,
  type ProductSemanticClassificationStatus,
} from '../product-semantic-classification/index.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };

export const productSemanticSnapshotSchemaVersion = '1';
export type ProductSemanticSnapshotSchemaVersion = typeof productSemanticSnapshotSchemaVersion;

export const productSemanticClassifierVersion = 'product-semantic-classifier-v1';
export type ProductSemanticClassifierVersion = typeof productSemanticClassifierVersion;

export const productSemanticClassificationStatusSchema = z.enum([
  'CLASSIFIED',
  'PARTIALLY_CLASSIFIED',
  'OTHER',
  'EXCLUDED_NON_PRODUCT',
  'NEEDS_REVIEW',
]);

export const ontologyAxisSchema = z.enum(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']);
export const ontologyConfidenceSchema = z.enum(['EXPLICIT', 'STRONGLY_INFERRED']);
export const ontologyEvidenceSourceTypeSchema = z.enum([
  'NAME_TEXT',
  'TRUSTED_CATEGORY',
  'STRUCTURED_FEATURE',
  'FAMILY_INFERENCE',
]);

export const productSemanticSnapshotTagSchema = z
  .object({
    axis: ontologyAxisSchema,
    code: z.string().trim().min(1),
    confidence: ontologyConfidenceSchema,
    ruleId: z.string().trim().min(1),
  })
  .strict();

export const productSemanticSnapshotEvidenceSchema = z
  .object({
    axis: ontologyAxisSchema,
    code: z.string().trim().min(1),
    ruleId: z.string().trim().min(1),
    sourceType: ontologyEvidenceSourceTypeSchema,
    sourceId: z.string().trim().min(1),
    rawValue: z.string(),
    normalizedValue: z.string(),
  })
  .strict();

export const productSemanticSnapshotExclusionSchema = z
  .object({
    ruleId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();

export const productSemanticSnapshotFactSchema = z
  .object({
    productId: z.string().trim().min(1),
    classificationStatus: productSemanticClassificationStatusSchema,
    primaryProductFamily: productSemanticSnapshotTagSchema.nullable(),
    secondaryProductFamilies: z.array(productSemanticSnapshotTagSchema),
    disciplines: z.array(productSemanticSnapshotTagSchema),
    useContexts: z.array(productSemanticSnapshotTagSchema),
    ontologyVersion: z.string().trim().min(1),
    ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    provenance: z
      .object({
        evidence: z.array(productSemanticSnapshotEvidenceSchema),
        exclusion: productSemanticSnapshotExclusionSchema.nullable(),
      })
      .strict(),
    needsReviewCandidates: z.array(productSemanticSnapshotTagSchema),
  })
  .strict();

export const productSemanticClassificationCountsSchema = z
  .object({
    CLASSIFIED: z.number().int().nonnegative(),
    PARTIALLY_CLASSIFIED: z.number().int().nonnegative(),
    OTHER: z.number().int().nonnegative(),
    EXCLUDED_NON_PRODUCT: z.number().int().nonnegative(),
    NEEDS_REVIEW: z.number().int().nonnegative(),
  })
  .strict();

export const productSemanticSnapshotSchema = z
  .object({
    schemaVersion: z.literal(productSemanticSnapshotSchemaVersion),
    snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    builtAt: z.string().datetime({ offset: true }),
    sourceProductCount: z.number().int().nonnegative(),
    recordCount: z.number().int().nonnegative(),
    ontologyVersion: z.string().trim().min(1),
    ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    classifierVersion: z.string().trim().min(1),
    semanticChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
    classificationCounts: productSemanticClassificationCountsSchema,
    records: z.array(productSemanticSnapshotFactSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.recordCount !== snapshot.records.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'recordCount must equal records.length',
        path: ['recordCount'],
      });
    }
    const totalCount = Object.values(snapshot.classificationCounts).reduce((sum, value) => sum + value, 0);
    if (totalCount !== snapshot.recordCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'classificationCounts must sum to recordCount',
        path: ['classificationCounts'],
      });
    }
  });

export const productSemanticSnapshotBuildParametersSchema = z
  .object({
    sourceProductCount: z.number().int().nonnegative(),
    classifierVersion: z.string().trim().min(1).default(productSemanticClassifierVersion),
    builtAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const productSemanticSnapshotBuildStatisticsSchema = z
  .object({
    sourceProductsRead: z.number().int().nonnegative(),
    snapshotRecordsPublished: z.number().int().nonnegative(),
    classificationCounts: productSemanticClassificationCountsSchema,
  })
  .strict();

export const productSemanticSnapshotBuildResultSchema = z
  .object({
    snapshot: productSemanticSnapshotSchema,
    statistics: productSemanticSnapshotBuildStatisticsSchema,
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.statistics.sourceProductsRead !== result.snapshot.sourceProductCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sourceProductsRead must equal snapshot.sourceProductCount',
        path: ['statistics', 'sourceProductsRead'],
      });
    }
    if (result.statistics.snapshotRecordsPublished !== result.snapshot.recordCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'snapshotRecordsPublished must equal snapshot.recordCount',
        path: ['statistics', 'snapshotRecordsPublished'],
      });
    }
  });

export const productSemanticSnapshotSaveResultSchema = z
  .object({
    status: z.enum(['created', 'already_exists']),
    snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

export const productSemanticSnapshotPublicationResultSchema = z
  .object({
    snapshot: productSemanticSnapshotSchema,
    saveStatus: z.enum(['created', 'already_exists']),
    activated: z.literal(true),
    statistics: productSemanticSnapshotBuildStatisticsSchema,
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

export interface ProductSemanticSnapshotBuilder {
  build(input: {
    readonly results: readonly ProductSemanticClassificationResult[];
    readonly parameters: ProductSemanticSnapshotBuildParameters;
  }): ProductSemanticSnapshotBuildResult;
}

export interface ProductSemanticSnapshotStore {
  save(snapshot: ProductSemanticSnapshot): Promise<ProductSemanticSnapshotSaveResult>;

  activate(snapshotId: string): Promise<void>;

  getById(snapshotId: string): Promise<ProductSemanticSnapshot | null>;

  getActive(): Promise<ProductSemanticSnapshot | null>;
}

export interface ProductSemanticSnapshotPublisher {
  publish(input: {
    readonly results: readonly ProductSemanticClassificationResult[];
    readonly parameters: ProductSemanticSnapshotBuildParameters;
  }): Promise<ProductSemanticSnapshotPublicationResult>;
}

export type ProductSemanticSnapshotTag = z.infer<typeof productSemanticSnapshotTagSchema>;
export type ProductSemanticSnapshotEvidence = z.infer<typeof productSemanticSnapshotEvidenceSchema>;
export type ProductSemanticSnapshotExclusion = z.infer<typeof productSemanticSnapshotExclusionSchema>;
export type ProductSemanticSnapshotFact = z.infer<typeof productSemanticSnapshotFactSchema>;
export type ProductSemanticClassificationCounts = z.infer<typeof productSemanticClassificationCountsSchema>;
export type ProductSemanticSnapshot = Omit<z.infer<typeof productSemanticSnapshotSchema>, 'records'> & {
  readonly records: readonly ProductSemanticSnapshotFact[];
};
export type ProductSemanticSnapshotBuildParameters = z.infer<typeof productSemanticSnapshotBuildParametersSchema>;
export type ProductSemanticSnapshotBuildStatistics = z.infer<typeof productSemanticSnapshotBuildStatisticsSchema>;
export type ProductSemanticSnapshotBuildResult = Omit<z.infer<typeof productSemanticSnapshotBuildResultSchema>, 'snapshot'> & {
  readonly snapshot: ProductSemanticSnapshot;
};
export type ProductSemanticSnapshotSaveResult = z.infer<typeof productSemanticSnapshotSaveResultSchema>;
export type ProductSemanticSnapshotPublicationResult = Omit<
  z.infer<typeof productSemanticSnapshotPublicationResultSchema>,
  'snapshot'
> & {
  readonly snapshot: ProductSemanticSnapshot;
};

export const emptyProductSemanticClassificationCounts = Object.freeze({
  CLASSIFIED: 0,
  PARTIALLY_CLASSIFIED: 0,
  OTHER: 0,
  EXCLUDED_NON_PRODUCT: 0,
  NEEDS_REVIEW: 0,
}) satisfies ProductSemanticClassificationCounts;

export function countProductSemanticClassificationStatuses(
  results: readonly Pick<ProductSemanticClassificationResult, 'classificationStatus'>[],
): ProductSemanticClassificationCounts {
  const counts: ProductSemanticClassificationCounts = {
    CLASSIFIED: 0,
    PARTIALLY_CLASSIFIED: 0,
    OTHER: 0,
    EXCLUDED_NON_PRODUCT: 0,
    NEEDS_REVIEW: 0,
  };
  for (const result of results) {
    counts[result.classificationStatus] += 1;
  }
  return counts;
}

export function semanticFactCount(result: Pick<
  ProductSemanticClassificationResult,
  'primaryProductFamily' | 'secondaryProductFamilies' | 'disciplines' | 'useContexts'
>): number {
  return (
    (result.primaryProductFamily ? 1 : 0) +
    result.secondaryProductFamilies.length +
    result.disciplines.length +
    result.useContexts.length
  );
}

export function toSnapshotTag(tag: ClassifiedOntologyTag): ProductSemanticSnapshotTag {
  return {
    axis: tag.axis,
    code: tag.code,
    confidence: tag.confidence,
    ruleId: tag.ruleId,
  };
}

export function toSnapshotEvidence(record: ClassificationEvidenceRecord): ProductSemanticSnapshotEvidence {
  return {
    axis: record.axis,
    code: record.code,
    ruleId: record.ruleId,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    rawValue: record.rawValue,
    normalizedValue: record.normalizedValue,
  };
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
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

export function productIdComparator(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

export type ProductSemanticSnapshotRecordStatus = ProductSemanticClassificationStatus;
