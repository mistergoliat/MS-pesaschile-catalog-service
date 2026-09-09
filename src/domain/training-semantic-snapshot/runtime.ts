import { deriveTrainingSemantics } from '../training-semantics/index.js';
import { cloneTrainingSnapshotJson } from './canonicalJson.js';
import type { ActiveTrainingSemanticSnapshotReader, TrainingSemanticRuntimeFact, TrainingSemanticRuntimeStatus, TrainingSemanticSnapshot, TrainingSemanticSnapshotMetadata, TrainingSemanticSnapshotStore } from './contracts.js';
import { TrainingSemanticSnapshotError } from './errors.js';

function runtimeFact(record: TrainingSemanticSnapshot['records'][number]): TrainingSemanticRuntimeFact {
  return {
    ...record,
    assignments: record.assignments.map((assignment) => ({ ...assignment, derivedSemantics: deriveTrainingSemantics(assignment.capabilityCode) })),
  };
}

export class DefaultActiveTrainingSemanticSnapshotReader implements ActiveTrainingSemanticSnapshotReader {
  private activeSnapshot: TrainingSemanticSnapshot | null = null;

  constructor(private readonly store: TrainingSemanticSnapshotStore) {}

  async refresh() {
    const previousSnapshotId = this.activeSnapshot?.snapshotId ?? null;
    const next = await this.store.getActive();
    if (!next) {
      this.activeSnapshot = null;
      return { status: 'cleared' as const, previousSnapshotId, activeSnapshotId: null };
    }
    if (next.snapshotId === this.activeSnapshot?.snapshotId) return { status: 'unchanged' as const, previousSnapshotId, activeSnapshotId: next.snapshotId };
    this.activeSnapshot = next;
    return { status: 'loaded' as const, previousSnapshotId, activeSnapshotId: next.snapshotId };
  }

  getStatus(): TrainingSemanticRuntimeStatus {
    return this.activeSnapshot ? { state: 'ready', ...this.getMetadata()! } : { state: 'not_loaded' };
  }

  getMetadata(): TrainingSemanticSnapshotMetadata | null {
    if (!this.activeSnapshot) return null;
    const { records: _records, ...metadata } = this.activeSnapshot;
    return cloneTrainingSnapshotJson(metadata);
  }

  getActiveSnapshotMetadata(): TrainingSemanticSnapshotMetadata | null { return this.getMetadata(); }

  hasProduct(productId: number): boolean { return this.loaded().records.some((record) => record.productId === productId); }

  getProductTrainingSemanticFact(productId: number): TrainingSemanticRuntimeFact | null {
    if (!Number.isInteger(productId) || productId <= 0) throw new TrainingSemanticSnapshotError('INVALID_RUNTIME_QUERY', 'productId must be a positive integer');
    return this.loaded().records.find((record) => record.productId === productId) ? runtimeFact(this.loaded().records.find((record) => record.productId === productId)!) : null;
  }

  getAllProductTrainingSemanticFacts(): readonly TrainingSemanticRuntimeFact[] { return this.loaded().records.map(runtimeFact); }

  private loaded(): TrainingSemanticSnapshot {
    if (!this.activeSnapshot) throw new TrainingSemanticSnapshotError('RUNTIME_SNAPSHOT_UNAVAILABLE', 'Active training semantic snapshot is unavailable');
    return this.activeSnapshot;
  }
}
