import type { ProductRelationshipSnapshotStore } from '../publication/contracts.js';
import { deepFreeze } from '../publication/canonicalJson.js';
import {
  productRelationshipSourceQuerySchema,
  productRelationshipRuntimeRefreshResultSchema,
  productRelationshipRuntimeStatusSchema,
  productRelationshipActiveSnapshotMetadataSchema,
  productRelationshipQueryResultSchema,
  type ActiveProductRelationshipSnapshotReader,
  type ProductRelationshipActiveSnapshotMetadata,
  type ProductRelationshipQueryResult,
  type ProductRelationshipRuntimeIndex,
  type ProductRelationshipRuntimeIndexBuilder,
  type ProductRelationshipRuntimeRefreshResult,
  type ProductRelationshipRuntimeRefreshStatistics,
  type ProductRelationshipRuntimeStatus,
  type ProductRelationshipSourceQuery,
} from './contracts.js';
import { ProductRelationshipRuntimeError } from './errors.js';
import { createProductRuntimeIdentity } from './productIdentity.js';

const EMPTY_RELATIONSHIP_ARRAY = Object.freeze([]);

function createMetadata(index: ProductRelationshipRuntimeIndex): ProductRelationshipActiveSnapshotMetadata {
  return {
    snapshotId: index.snapshotId,
    schemaVersion: index.schemaVersion,
    modelVersion: index.modelVersion,
    evidenceWindow: {
      from: index.evidenceWindow.from,
      to: index.evidenceWindow.to,
    },
    relationshipCount: index.relationshipCount,
    sourceCount: index.relationshipsBySource.size,
  };
}

function createRefreshStatistics(
  index: ProductRelationshipRuntimeIndex | null,
  snapshotChanged: boolean,
): ProductRelationshipRuntimeRefreshStatistics {
  return {
    relationshipsRead: index?.relationshipCount ?? 0,
    sourcesIndexed: index?.relationshipsBySource.size ?? 0,
    emptySources: 0,
    snapshotChanged,
  };
}

export class DefaultActiveProductRelationshipSnapshotReader implements ActiveProductRelationshipSnapshotReader {
  private activeIndex: ProductRelationshipRuntimeIndex | null = null;

  constructor(
    private readonly store: ProductRelationshipSnapshotStore,
    private readonly indexBuilder: ProductRelationshipRuntimeIndexBuilder,
  ) {}

  async refresh(): Promise<ProductRelationshipRuntimeRefreshResult> {
    const previousSnapshotId = this.activeIndex?.snapshotId ?? null;
    const activeSnapshot = await this.store.getActive();

    if (!activeSnapshot) {
      this.activeIndex = null;
      const result: ProductRelationshipRuntimeRefreshResult = {
        status: 'cleared',
        previousSnapshotId,
        activeSnapshotId: null,
        statistics: createRefreshStatistics(null, previousSnapshotId !== null),
      };
      productRelationshipRuntimeRefreshResultSchema.parse(result);
      return result;
    }

    if (this.activeIndex?.snapshotId === activeSnapshot.snapshotId) {
      const result: ProductRelationshipRuntimeRefreshResult = {
        status: 'unchanged',
        previousSnapshotId,
        activeSnapshotId: activeSnapshot.snapshotId,
        statistics: createRefreshStatistics(this.activeIndex, false),
      };
      productRelationshipRuntimeRefreshResultSchema.parse(result);
      return result;
    }

    let nextIndex: ProductRelationshipRuntimeIndex;
    try {
      nextIndex = this.indexBuilder.build(activeSnapshot);
    } catch (error) {
      if (error instanceof ProductRelationshipRuntimeError) {
        throw error;
      }
      throw new ProductRelationshipRuntimeError(
        'RUNTIME_INDEX_BUILD_FAILURE',
        'Runtime index could not be built',
        { cause: error },
      );
    }

    this.activeIndex = nextIndex;
    const result: ProductRelationshipRuntimeRefreshResult = {
      status: 'loaded',
      previousSnapshotId,
      activeSnapshotId: nextIndex.snapshotId,
      statistics: createRefreshStatistics(nextIndex, true),
    };
    productRelationshipRuntimeRefreshResultSchema.parse(result);
    return result;
  }

  getStatus(): ProductRelationshipRuntimeStatus {
    if (!this.activeIndex) {
      return { state: 'not_loaded' };
    }
    const status: ProductRelationshipRuntimeStatus = {
      state: 'ready',
      snapshotId: this.activeIndex.snapshotId,
      modelVersion: this.activeIndex.modelVersion,
      relationshipCount: this.activeIndex.relationshipCount,
      sourceCount: this.activeIndex.relationshipsBySource.size,
    };
    productRelationshipRuntimeStatusSchema.parse(status);
    return status;
  }

  getActiveSnapshotMetadata(): ProductRelationshipActiveSnapshotMetadata | null {
    if (!this.activeIndex) {
      return null;
    }
    const metadata = createMetadata(this.activeIndex);
    productRelationshipActiveSnapshotMetadataSchema.parse(metadata);
    return metadata;
  }

  findBySource(query: ProductRelationshipSourceQuery): ProductRelationshipQueryResult {
    if (!this.activeIndex) {
      throw new ProductRelationshipRuntimeError(
        'RUNTIME_SNAPSHOT_NOT_LOADED',
        'Active relationship snapshot has not been loaded',
      );
    }

    const parsed = productRelationshipSourceQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ProductRelationshipRuntimeError('INVALID_RUNTIME_QUERY', 'Runtime source query is invalid');
    }

    const sourceIdentity = createProductRuntimeIdentity(parsed.data.sourceProduct);
    const sourceRelationships = this.activeIndex.relationshipsBySource.get(sourceIdentity) ?? EMPTY_RELATIONSHIP_ARRAY;
    const relationshipTypes = parsed.data.relationshipTypes;
    const filtered = relationshipTypes === undefined
      ? sourceRelationships
      : sourceRelationships.filter((relationship) => new Set(relationshipTypes).has(relationship.relationshipType));
    const limited = parsed.data.limit === undefined ? filtered : filtered.slice(0, parsed.data.limit);
    const relationships = limited === sourceRelationships ? sourceRelationships : deepFreeze([...limited]);

    const result: ProductRelationshipQueryResult = {
      snapshot: createMetadata(this.activeIndex),
      sourceIdentity,
      relationships,
      totalMatched: filtered.length,
      returned: relationships.length,
    };
    productRelationshipQueryResultSchema.parse(result);
    return result;
  }
}
