import { z } from 'zod';
import {
  relationshipTypeSchema,
  type RelationshipType,
} from '../../contracts.js';
import {
  productRelationshipProductReferenceSchema,
  relationshipDataWindowSchema,
  type CalculatedProductRelationship,
  type ProductRelationshipProductReference,
} from '../contracts.js';
import type {
  ProductRelationshipSnapshot,
  ProductRelationshipSnapshotSchemaVersion,
  ProductRelationshipSnapshotStore,
} from '../publication/contracts.js';

export type ProductReference = ProductRelationshipProductReference;
export type ProductRelationshipType = RelationshipType;
export type ProductRuntimeIdentity = string;

export type ProductRelationshipRuntimeIndex = {
  readonly snapshotId: string;
  readonly schemaVersion: ProductRelationshipSnapshotSchemaVersion;
  readonly modelVersion: string;
  readonly evidenceWindow: {
    readonly from: string;
    readonly to: string;
  };
  readonly relationshipCount: number;
  readonly relationshipsBySource: ReadonlyMap<ProductRuntimeIdentity, readonly CalculatedProductRelationship[]>;
};

export interface ProductRelationshipRuntimeIndexBuilder {
  build(snapshot: ProductRelationshipSnapshot): ProductRelationshipRuntimeIndex;
}

export type ProductRelationshipRuntimeRefreshStatus = 'loaded' | 'unchanged' | 'cleared';

export type ProductRelationshipRuntimeRefreshStatistics = {
  relationshipsRead: number;
  sourcesIndexed: number;
  emptySources: 0;
  snapshotChanged: boolean;
};

export type ProductRelationshipRuntimeRefreshResult = {
  status: ProductRelationshipRuntimeRefreshStatus;
  previousSnapshotId: string | null;
  activeSnapshotId: string | null;
  statistics: ProductRelationshipRuntimeRefreshStatistics;
};

export type ProductRelationshipRuntimeStatus =
  | {
      state: 'not_loaded';
    }
  | {
      state: 'ready';
      snapshotId: string;
      modelVersion: string;
      relationshipCount: number;
      sourceCount: number;
    };

export type ProductRelationshipActiveSnapshotMetadata = {
  snapshotId: string;
  schemaVersion: ProductRelationshipSnapshotSchemaVersion;
  modelVersion: string;
  evidenceWindow: {
    from: string;
    to: string;
  };
  relationshipCount: number;
  sourceCount: number;
};

export const productRelationshipSourceQuerySchema = z
  .object({
    sourceProduct: productRelationshipProductReferenceSchema,
    relationshipTypes: z.array(relationshipTypeSchema).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type ProductRelationshipSourceQuery = Omit<z.infer<typeof productRelationshipSourceQuerySchema>, 'relationshipTypes'> & {
  readonly relationshipTypes?: readonly ProductRelationshipType[];
};

export type ProductRelationshipQueryResult = {
  snapshot: ProductRelationshipActiveSnapshotMetadata;
  sourceIdentity: ProductRuntimeIdentity;
  relationships: readonly CalculatedProductRelationship[];
  totalMatched: number;
  returned: number;
};

export interface ActiveProductRelationshipSnapshotReader {
  refresh(): Promise<ProductRelationshipRuntimeRefreshResult>;

  getStatus(): ProductRelationshipRuntimeStatus;

  getActiveSnapshotMetadata(): ProductRelationshipActiveSnapshotMetadata | null;

  findBySource(query: ProductRelationshipSourceQuery): ProductRelationshipQueryResult;
}

export const productRelationshipRuntimeRefreshStatisticsSchema = z
  .object({
    relationshipsRead: z.number().int().nonnegative(),
    sourcesIndexed: z.number().int().nonnegative(),
    emptySources: z.literal(0),
    snapshotChanged: z.boolean(),
  })
  .strict();

export const productRelationshipRuntimeRefreshResultSchema = z
  .object({
    status: z.enum(['loaded', 'unchanged', 'cleared']),
    previousSnapshotId: z.string().nullable(),
    activeSnapshotId: z.string().nullable(),
    statistics: productRelationshipRuntimeRefreshStatisticsSchema,
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

export const productRelationshipRuntimeReadyStatusSchema = z
  .object({
    state: z.literal('ready'),
    snapshotId: z.string().trim().min(1),
    modelVersion: z.string().trim().min(1),
    relationshipCount: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative(),
  })
  .strict();

export const productRelationshipRuntimeStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_loaded') }).strict(),
  productRelationshipRuntimeReadyStatusSchema,
]);

export const productRelationshipActiveSnapshotMetadataSchema = z
  .object({
    snapshotId: z.string().trim().min(1),
    schemaVersion: z.literal('1'),
    modelVersion: z.string().trim().min(1),
    evidenceWindow: relationshipDataWindowSchema,
    relationshipCount: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative(),
  })
  .strict();

export const productRelationshipQueryResultSchema = z
  .object({
    snapshot: productRelationshipActiveSnapshotMetadataSchema,
    sourceIdentity: z.string().trim().min(1),
    relationships: z.array(z.custom<CalculatedProductRelationship>()),
    totalMatched: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.returned !== result.relationships.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'returned must equal relationships.length',
        path: ['returned'],
      });
    }
    if (result.returned > result.totalMatched) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'returned must not exceed totalMatched',
        path: ['returned'],
      });
    }
  });

export type ProductRelationshipRuntimeDependencies = {
  store: ProductRelationshipSnapshotStore;
  indexBuilder: ProductRelationshipRuntimeIndexBuilder;
};
