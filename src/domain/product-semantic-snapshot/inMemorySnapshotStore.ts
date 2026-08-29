import {
  productSemanticSnapshotSchema,
  type ProductSemanticSnapshot,
  type ProductSemanticSnapshotSaveResult,
  type ProductSemanticSnapshotStore,
} from './contracts.js';
import { canonicalizeJson, cloneJsonValue, deepFreeze } from './canonicalJson.js';
import { createProductSemanticSnapshotIdentityPayload } from './defaultSnapshotBuilder.js';
import { ProductSemanticSnapshotStoreError } from './errors.js';

function identityPayload(snapshot: ProductSemanticSnapshot): string {
  return canonicalizeJson(createProductSemanticSnapshotIdentityPayload(snapshot));
}

function immutableSnapshotCopy(snapshot: ProductSemanticSnapshot): ProductSemanticSnapshot {
  return deepFreeze(cloneJsonValue(snapshot));
}

export class InMemoryProductSemanticSnapshotStore implements ProductSemanticSnapshotStore {
  private readonly snapshots = new Map<string, ProductSemanticSnapshot>();

  private activeSnapshotId: string | null = null;

  async save(snapshot: ProductSemanticSnapshot): Promise<ProductSemanticSnapshotSaveResult> {
    const parsed = productSemanticSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot does not satisfy the snapshot contract');
    }

    let incomingIdentity: string;
    try {
      incomingIdentity = identityPayload(snapshot);
    } catch (error) {
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot is not canonical JSON serializable', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }

    const existing = this.snapshots.get(snapshot.snapshotId);
    if (existing) {
      if (identityPayload(existing) !== incomingIdentity) {
        throw new ProductSemanticSnapshotStoreError(
          'SNAPSHOT_ID_COLLISION',
          'A different semantic snapshot already exists with the same snapshotId',
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
      throw new ProductSemanticSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'Cannot activate an unknown semantic snapshot', {
        snapshotId,
      });
    }
    this.activeSnapshotId = snapshotId;
  }

  async getById(snapshotId: string): Promise<ProductSemanticSnapshot | null> {
    return this.snapshots.get(snapshotId) ?? null;
  }

  async getActive(): Promise<ProductSemanticSnapshot | null> {
    if (!this.activeSnapshotId) return null;
    return this.snapshots.get(this.activeSnapshotId) ?? null;
  }
}
