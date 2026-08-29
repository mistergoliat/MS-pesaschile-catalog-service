import { z } from 'zod';
import type {
  ProductSemanticClassificationCounts,
  ProductSemanticSnapshot,
  ProductSemanticSnapshotFact,
  ProductSemanticSnapshotSchemaVersion,
  ProductSemanticSnapshotStore,
} from '../contracts.js';

export type ProductSemanticRuntimeIndex = {
  readonly snapshotId: string;
  readonly schemaVersion: ProductSemanticSnapshotSchemaVersion;
  readonly classifierVersion: string;
  readonly builtAt: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly semanticChecksum: string;
  readonly sourceProductCount: number;
  readonly recordCount: number;
  readonly classificationCounts: ProductSemanticClassificationCounts;
  readonly factsByProductId: ReadonlyMap<string, ProductSemanticSnapshotFact>;
  readonly facts: readonly ProductSemanticSnapshotFact[];
};

export interface ProductSemanticRuntimeIndexBuilder {
  build(snapshot: ProductSemanticSnapshot): ProductSemanticRuntimeIndex;
}

export type ProductSemanticRuntimeRefreshStatus = 'loaded' | 'unchanged' | 'cleared';

export type ProductSemanticRuntimeRefreshStatistics = {
  recordsRead: number;
  indexedProducts: number;
  snapshotChanged: boolean;
};

export type ProductSemanticRuntimeRefreshResult = {
  status: ProductSemanticRuntimeRefreshStatus;
  previousSnapshotId: string | null;
  activeSnapshotId: string | null;
  statistics: ProductSemanticRuntimeRefreshStatistics;
};

export type ProductSemanticActiveSnapshotMetadata = {
  snapshotId: string;
  schemaVersion: ProductSemanticSnapshotSchemaVersion;
  classifierVersion: string;
  builtAt: string;
  ontologyVersion: string;
  ontologyHash: string;
  semanticChecksum: string;
  sourceProductCount: number;
  recordCount: number;
  classificationCounts: ProductSemanticClassificationCounts;
};

export type ProductSemanticRuntimeStatus =
  | {
      state: 'not_loaded';
    }
  | ({
      state: 'ready';
    } & ProductSemanticActiveSnapshotMetadata);

export interface ActiveProductSemanticSnapshotReader {
  refresh(): Promise<ProductSemanticRuntimeRefreshResult>;

  getStatus(): ProductSemanticRuntimeStatus;

  getActiveSnapshotMetadata(): ProductSemanticActiveSnapshotMetadata | null;

  hasProduct(productId: string): boolean;

  getProductSemanticFact(productId: string): ProductSemanticSnapshotFact | null;

  getAllProductSemanticFacts(): readonly ProductSemanticSnapshotFact[];
}

export const productSemanticRuntimeRefreshStatisticsSchema = z
  .object({
    recordsRead: z.number().int().nonnegative(),
    indexedProducts: z.number().int().nonnegative(),
    snapshotChanged: z.boolean(),
  })
  .strict();

export const productSemanticRuntimeRefreshResultSchema = z
  .object({
    status: z.enum(['loaded', 'unchanged', 'cleared']),
    previousSnapshotId: z.string().nullable(),
    activeSnapshotId: z.string().nullable(),
    statistics: productSemanticRuntimeRefreshStatisticsSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === 'loaded' && result.activeSnapshotId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'loaded refresh requires an activeSnapshotId',
        path: ['activeSnapshotId'],
      });
    }
    if (result.status === 'unchanged' && result.statistics.snapshotChanged) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unchanged refresh must not mark snapshotChanged',
        path: ['statistics', 'snapshotChanged'],
      });
    }
  });

export const productSemanticActiveSnapshotMetadataSchema = z
  .object({
    snapshotId: z.string().trim().min(1),
    schemaVersion: z.literal('1'),
    classifierVersion: z.string().trim().min(1),
    builtAt: z.string().datetime({ offset: true }),
    ontologyVersion: z.string().trim().min(1),
    ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    semanticChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceProductCount: z.number().int().nonnegative(),
    recordCount: z.number().int().nonnegative(),
    classificationCounts: z
      .object({
        CLASSIFIED: z.number().int().nonnegative(),
        PARTIALLY_CLASSIFIED: z.number().int().nonnegative(),
        OTHER: z.number().int().nonnegative(),
        EXCLUDED_NON_PRODUCT: z.number().int().nonnegative(),
        NEEDS_REVIEW: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const productSemanticRuntimeStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_loaded') }).strict(),
  z
    .object({
      state: z.literal('ready'),
    })
    .merge(productSemanticActiveSnapshotMetadataSchema),
]);

export type ProductSemanticRuntimeDependencies = {
  readonly store: ProductSemanticSnapshotStore;
  readonly indexBuilder: ProductSemanticRuntimeIndexBuilder;
};
