import {
  productRelationshipSnapshotSchema,
  type ProductRelationshipSnapshot,
  type ProductRelationshipSnapshotSaveResult,
  type ProductRelationshipSnapshotStore,
} from './contracts.js';
import { canonicalizeJson, cloneJsonValue, deepFreeze } from './canonicalJson.js';
import { ProductRelationshipSnapshotStoreError } from './errors.js';

function canonicalSnapshotContent(snapshot: ProductRelationshipSnapshot): string {
  return canonicalizeJson(snapshot);
}

function immutableSnapshotCopy(snapshot: ProductRelationshipSnapshot): ProductRelationshipSnapshot {
  return deepFreeze(cloneJsonValue(snapshot));
}

export class InMemoryProductRelationshipSnapshotStore implements ProductRelationshipSnapshotStore {
  private readonly snapshots = new Map<string, ProductRelationshipSnapshot>();

  private activeSnapshotId: string | null = null;

  async save(snapshot: ProductRelationshipSnapshot): Promise<ProductRelationshipSnapshotSaveResult> {
    const parsed = productRelationshipSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot does not satisfy the snapshot contract');
    }

    let incomingCanonical: string;
    try {
      incomingCanonical = canonicalSnapshotContent(snapshot);
    } catch (error) {
      throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot is not canonical JSON serializable', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }

    const existing = this.snapshots.get(snapshot.snapshotId);
    if (existing) {
      if (canonicalSnapshotContent(existing) !== incomingCanonical) {
        throw new ProductRelationshipSnapshotStoreError(
          'SNAPSHOT_ID_COLLISION',
          'A different snapshot already exists with the same snapshotId',
          { snapshotId: snapshot.snapshotId },
        );
      }
      return {
        status: 'already_exists',
        snapshotId: snapshot.snapshotId,
      };
    }

    this.snapshots.set(snapshot.snapshotId, immutableSnapshotCopy(snapshot));
    return {
      status: 'created',
      snapshotId: snapshot.snapshotId,
    };
  }

  async activate(snapshotId: string): Promise<void> {
    if (!this.snapshots.has(snapshotId)) {
      throw new ProductRelationshipSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'Cannot activate an unknown snapshot', {
        snapshotId,
      });
    }
    this.activeSnapshotId = snapshotId;
  }

  async getById(snapshotId: string): Promise<ProductRelationshipSnapshot | null> {
    return this.snapshots.get(snapshotId) ?? null;
  }

  async getActive(): Promise<ProductRelationshipSnapshot | null> {
    if (!this.activeSnapshotId) {
      return null;
    }
    return this.snapshots.get(this.activeSnapshotId) ?? null;
  }
}
