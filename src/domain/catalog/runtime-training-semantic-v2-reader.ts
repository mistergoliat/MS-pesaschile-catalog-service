import type { ActiveTrainingSemanticSnapshotV2Reader } from '../training-semantic-snapshot/v2-contracts.js';
import { cloneTrainingSnapshotJson } from '../training-semantic-snapshot/canonicalJson.js';
import { fact } from '../training-semantic-snapshot/v2Runtime.js';
import type { RuntimeProjectionManager } from './runtime-projection.js';

/** All reads use the bundle captured for this request; unavailable V2 never falls back. */
export class RuntimeTrainingSemanticV2Reader implements ActiveTrainingSemanticSnapshotV2Reader {
  constructor(private readonly manager: RuntimeProjectionManager) {}

  async refresh() {
    const previousSnapshotId = this.getMetadata()?.snapshotId ?? null;
    await this.manager.reconcile();
    const activeSnapshotId = this.getMetadata()?.snapshotId ?? null;
    return { status: activeSnapshotId === null ? 'cleared' as const : activeSnapshotId === previousSnapshotId ? 'unchanged' as const : 'loaded' as const,
      previousSnapshotId, activeSnapshotId };
  }

  getMetadata() {
    const snapshot = this.manager.forRequest()?.trainingSemanticsV2?.snapshot;
    if (!snapshot) return null;
    const { records: _records, ...metadata } = snapshot;
    return cloneTrainingSnapshotJson(metadata);
  }

  hasProduct(productId: number) {
    return this.manager.forRequest()?.trainingSemanticsV2?.snapshot.records.some((record) => record.productId === productId) ?? false;
  }

  getProductTrainingSemanticFact(productId: number) {
    if (!Number.isInteger(productId) || productId <= 0) throw new Error('INVALID_RUNTIME_QUERY: productId must be a positive integer');
    const record = this.loaded().records.find((item) => item.productId === productId);
    return record ? fact(cloneTrainingSnapshotJson(record)) : null;
  }

  getAllProductTrainingSemanticFacts() {
    return this.loaded().records.map((record) => fact(cloneTrainingSnapshotJson(record)));
  }

  private loaded() {
    const snapshot = this.manager.forRequest()?.trainingSemanticsV2?.snapshot;
    if (!snapshot) throw new Error('RUNTIME_SNAPSHOT_UNAVAILABLE: active CAT-V2 Training Semantics V2 projection is unavailable');
    return snapshot;
  }
}
