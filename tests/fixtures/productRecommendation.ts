import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import type {
  ActiveProductRelationshipSnapshotReader,
  ProductRelationshipQueryResult,
  ProductRelationshipSourceQuery,
} from '../../src/domain/recommendation/relationship-engine/runtime/index.js';
import { createProductRuntimeIdentity } from '../../src/domain/recommendation/relationship-engine/runtime/index.js';
import type {
  ProductRecommendationCommercialData,
  ProductRecommendationCommercialDataProvider,
  ProductRecommendationContext,
  ProductRecommendationRequest,
} from '../../src/domain/recommendation/relationship-engine/recommendation/index.js';
import { ProductRelationshipRuntimeError } from '../../src/domain/recommendation/relationship-engine/runtime/index.js';
import {
  buildRuntimeSnapshot,
  runtimeSnapshot,
  runtimeRelationshipSet,
} from './relationshipRuntimeReader.js';

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function relationshipTo(
  targetProductId: string,
  patch: Partial<CalculatedProductRelationship> = {},
): CalculatedProductRelationship {
  const base = runtimeRelationshipSet.snapshotRelationshipAtoB;
  return {
    ...base,
    targetProduct: { productId: targetProductId },
    evidence: {
      kind: 'co_occurrence',
      jointCount: 12,
      sourceCount: 20,
      targetCount: 16,
      totalTransactions: 40,
      support: 0.3,
      confidence: 0.6,
      lift: 1.5,
    },
    reliability: 0.55,
    ...patch,
  };
}

export const baseRecommendationRequest: ProductRecommendationRequest = {
  sourceProduct: { productId: 'A' },
};

export function commercialDataFor(
  productId: string,
  patch: Partial<ProductRecommendationCommercialData> = {},
): ProductRecommendationCommercialData {
  return {
    product: { productId },
    available: true,
    sellable: true,
    active: true,
    stockStatus: 'in_stock',
    price: {
      currency: 'CLP',
      amount: 10000,
    },
    marginSignal: 'medium',
    compatibilityStatus: 'compatible',
    ...patch,
  };
}

export class FakeActiveProductRelationshipSnapshotReader implements ActiveProductRelationshipSnapshotReader {
  calls: ProductRelationshipSourceQuery[] = [];

  constructor(
    public relationships: readonly CalculatedProductRelationship[] = [
      runtimeRelationshipSet.snapshotRelationshipAtoB,
      runtimeRelationshipSet.snapshotRelationshipAtoC,
    ],
    private readonly loaded = true,
  ) {}

  async refresh() {
    return {
      status: 'unchanged' as const,
      previousSnapshotId: runtimeSnapshot.snapshotId,
      activeSnapshotId: runtimeSnapshot.snapshotId,
      statistics: {
        relationshipsRead: this.relationships.length,
        sourcesIndexed: 1,
        emptySources: 0 as const,
        snapshotChanged: false,
      },
    };
  }

  getStatus() {
    return this.loaded
      ? {
          state: 'ready' as const,
          snapshotId: runtimeSnapshot.snapshotId,
          modelVersion: runtimeSnapshot.modelVersion,
          relationshipCount: this.relationships.length,
          sourceCount: this.relationships.length === 0 ? 0 : 1,
        }
      : { state: 'not_loaded' as const };
  }

  getActiveSnapshotMetadata() {
    return this.loaded
      ? {
          snapshotId: runtimeSnapshot.snapshotId,
          schemaVersion: runtimeSnapshot.schemaVersion,
          modelVersion: runtimeSnapshot.modelVersion,
          evidenceWindow: runtimeSnapshot.evidenceWindow,
          relationshipCount: this.relationships.length,
          sourceCount: this.relationships.length === 0 ? 0 : 1,
        }
      : null;
  }

  findBySource(query: ProductRelationshipSourceQuery): ProductRelationshipQueryResult {
    this.calls.push(clone(query));
    if (!this.loaded) {
      throw new ProductRelationshipRuntimeError('RUNTIME_SNAPSHOT_NOT_LOADED', 'not loaded');
    }
    const metadata = this.getActiveSnapshotMetadata();
    if (!metadata) throw new Error('Expected metadata');
    const filtered = query.relationshipTypes === undefined
      ? this.relationships
      : this.relationships.filter((relationship) => query.relationshipTypes?.includes(relationship.relationshipType));
    return {
      snapshot: metadata,
      sourceIdentity: createProductRuntimeIdentity(query.sourceProduct),
      relationships: filtered,
      totalMatched: filtered.length,
      returned: filtered.length,
    };
  }
}

export class FakeCommercialDataProvider implements ProductRecommendationCommercialDataProvider {
  calls: Array<{ products: readonly { productId: string; combinationId?: string }[]; context: ProductRecommendationContext }> = [];

  failWith: Error | null = null;

  constructor(private readonly data: ReadonlyMap<string, ProductRecommendationCommercialData>) {}

  async getCommercialData(
    products: readonly { productId: string; combinationId?: string }[],
    context: ProductRecommendationContext,
  ): Promise<ReadonlyMap<string, ProductRecommendationCommercialData>> {
    this.calls.push({ products: clone(products), context: clone(context) });
    if (this.failWith) {
      throw this.failWith;
    }
    return this.data;
  }
}

export function commercialDataMap(records: readonly ProductRecommendationCommercialData[]): ReadonlyMap<string, ProductRecommendationCommercialData> {
  return new Map(records.map((record) => [createProductRuntimeIdentity(record.product), record]));
}

export const realT07SnapshotForRecommendation = buildRuntimeSnapshot([
  runtimeRelationshipSet.snapshotRelationshipAtoB,
  runtimeRelationshipSet.snapshotRelationshipAtoC,
]);
