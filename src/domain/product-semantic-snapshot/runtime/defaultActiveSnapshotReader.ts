import type { ProductSemanticSnapshotStore } from '../contracts.js';
import {
  productSemanticActiveSnapshotMetadataSchema,
  productSemanticRuntimeRefreshResultSchema,
  productSemanticRuntimeStatusSchema,
  type ActiveProductSemanticSnapshotReader,
  type ProductSemanticActiveSnapshotMetadata,
  type ProductSemanticRuntimeIndex,
  type ProductSemanticRuntimeIndexBuilder,
  type ProductSemanticRuntimeRefreshResult,
  type ProductSemanticRuntimeStatus,
} from './contracts.js';
import { ProductSemanticRuntimeError } from './errors.js';

function createMetadata(index: ProductSemanticRuntimeIndex): ProductSemanticActiveSnapshotMetadata {
  return {
    snapshotId: index.snapshotId,
    schemaVersion: index.schemaVersion,
    classifierVersion: index.classifierVersion,
    builtAt: index.builtAt,
    ontologyVersion: index.ontologyVersion,
    ontologyHash: index.ontologyHash,
    semanticChecksum: index.semanticChecksum,
    sourceProductCount: index.sourceProductCount,
    recordCount: index.recordCount,
    classificationCounts: {
      ...index.classificationCounts,
    },
  };
}

function createRefreshStatistics(
  index: ProductSemanticRuntimeIndex | null,
  snapshotChanged: boolean,
): ProductSemanticRuntimeRefreshResult['statistics'] {
  return {
    recordsRead: index?.recordCount ?? 0,
    indexedProducts: index?.factsByProductId.size ?? 0,
    snapshotChanged,
  };
}

export class DefaultActiveProductSemanticSnapshotReader implements ActiveProductSemanticSnapshotReader {
  private activeIndex: ProductSemanticRuntimeIndex | null = null;

  constructor(
    private readonly store: ProductSemanticSnapshotStore,
    private readonly indexBuilder: ProductSemanticRuntimeIndexBuilder,
  ) {}

  async refresh(): Promise<ProductSemanticRuntimeRefreshResult> {
    const previousSnapshotId = this.activeIndex?.snapshotId ?? null;
    const activeSnapshot = await this.store.getActive();

    if (!activeSnapshot) {
      this.activeIndex = null;
      const result: ProductSemanticRuntimeRefreshResult = {
        status: 'cleared',
        previousSnapshotId,
        activeSnapshotId: null,
        statistics: createRefreshStatistics(null, previousSnapshotId !== null),
      };
      productSemanticRuntimeRefreshResultSchema.parse(result);
      return result;
    }

    if (this.activeIndex?.snapshotId === activeSnapshot.snapshotId) {
      const result: ProductSemanticRuntimeRefreshResult = {
        status: 'unchanged',
        previousSnapshotId,
        activeSnapshotId: activeSnapshot.snapshotId,
        statistics: createRefreshStatistics(this.activeIndex, false),
      };
      productSemanticRuntimeRefreshResultSchema.parse(result);
      return result;
    }

    let nextIndex: ProductSemanticRuntimeIndex;
    try {
      nextIndex = this.indexBuilder.build(activeSnapshot);
    } catch (error) {
      if (error instanceof ProductSemanticRuntimeError) throw error;
      throw new ProductSemanticRuntimeError(
        'RUNTIME_INDEX_BUILD_FAILURE',
        'Runtime semantic index could not be built',
        { cause: error },
      );
    }

    this.activeIndex = nextIndex;
    const result: ProductSemanticRuntimeRefreshResult = {
      status: 'loaded',
      previousSnapshotId,
      activeSnapshotId: nextIndex.snapshotId,
      statistics: createRefreshStatistics(nextIndex, true),
    };
    productSemanticRuntimeRefreshResultSchema.parse(result);
    return result;
  }

  getStatus(): ProductSemanticRuntimeStatus {
    if (!this.activeIndex) {
      return { state: 'not_loaded' };
    }
    const status: ProductSemanticRuntimeStatus = {
      state: 'ready',
      ...createMetadata(this.activeIndex),
    };
    productSemanticRuntimeStatusSchema.parse(status);
    return status;
  }

  getActiveSnapshotMetadata(): ProductSemanticActiveSnapshotMetadata | null {
    if (!this.activeIndex) return null;
    const metadata = createMetadata(this.activeIndex);
    productSemanticActiveSnapshotMetadataSchema.parse(metadata);
    return metadata;
  }

  hasProduct(productId: string): boolean {
    return this.getLoadedIndex().factsByProductId.has(productId);
  }

  getProductSemanticFact(productId: string) {
    if (typeof productId !== 'string' || productId.trim().length === 0) {
      throw new ProductSemanticRuntimeError('INVALID_RUNTIME_QUERY', 'productId must be a non-empty string');
    }
    return this.getLoadedIndex().factsByProductId.get(productId) ?? null;
  }

  getAllProductSemanticFacts() {
    return this.getLoadedIndex().facts;
  }

  private getLoadedIndex(): ProductSemanticRuntimeIndex {
    if (!this.activeIndex) {
      throw new ProductSemanticRuntimeError(
        'RUNTIME_SNAPSHOT_NOT_LOADED',
        'Active product semantic snapshot has not been loaded',
      );
    }
    return this.activeIndex;
  }
}
