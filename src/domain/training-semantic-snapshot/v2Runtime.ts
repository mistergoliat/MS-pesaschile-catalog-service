import { deriveExerciseSemantics } from '../training-semantics-v2/index.js';
import { cloneTrainingSnapshotJson, deepFreezeTrainingSnapshot } from './canonicalJson.js';
import { validateTrainingSemanticSnapshotV2 } from './v2SnapshotBuilder.js';
import type { ActiveTrainingSemanticSnapshotV2Reader, TrainingSemanticRuntimeV2Fact, TrainingSemanticSnapshotV2, TrainingSemanticSnapshotV2Metadata, TrainingSemanticSnapshotV2Store } from './v2-contracts.js';

function fact(record: TrainingSemanticSnapshotV2['records'][number]): TrainingSemanticRuntimeV2Fact {
  return {
    ...record,
    exerciseCapabilities: record.exerciseCapabilities.map((assignment) => ({ ...assignment, derivedExerciseSemantics: deriveExerciseSemantics(assignment.capabilityCode) })),
  };
}

export class DefaultActiveTrainingSemanticSnapshotV2Reader implements ActiveTrainingSemanticSnapshotV2Reader {
  private activeSnapshot: TrainingSemanticSnapshotV2 | null = null;
  constructor(private readonly store: TrainingSemanticSnapshotV2Store) {}
  async refresh() {
    const previousSnapshotId = this.activeSnapshot?.snapshotId ?? null;
    const next = await this.store.getActive();
    if (!next) { this.activeSnapshot = null; return { status: 'cleared' as const, previousSnapshotId, activeSnapshotId: null }; }
    validateTrainingSemanticSnapshotV2(next);
    if (next.snapshotId === this.activeSnapshot?.snapshotId) return { status: 'unchanged' as const, previousSnapshotId, activeSnapshotId: next.snapshotId };
    this.activeSnapshot = next;
    return { status: 'loaded' as const, previousSnapshotId, activeSnapshotId: next.snapshotId };
  }
  getMetadata(): TrainingSemanticSnapshotV2Metadata | null { if (!this.activeSnapshot) return null; const { records: _records, ...metadata } = this.activeSnapshot; return cloneTrainingSnapshotJson(metadata); }
  hasProduct(productId: number): boolean { return this.activeSnapshot?.records.some((record) => record.productId === productId) ?? false; }
  getProductTrainingSemanticFact(productId: number): TrainingSemanticRuntimeV2Fact | null { if (!Number.isInteger(productId) || productId <= 0) throw new Error('INVALID_RUNTIME_QUERY: productId must be a positive integer'); const record = this.loaded().records.find((candidate) => candidate.productId === productId); return record ? fact(record) : null; }
  getAllProductTrainingSemanticFacts(): readonly TrainingSemanticRuntimeV2Fact[] { return this.loaded().records.map(fact); }
  private loaded(): TrainingSemanticSnapshotV2 { if (!this.activeSnapshot) throw new Error('RUNTIME_SNAPSHOT_UNAVAILABLE: active Training Semantic Snapshot V2 is unavailable'); return this.activeSnapshot; }
}

export class InMemoryTrainingSemanticSnapshotV2Store implements TrainingSemanticSnapshotV2Store {
  private readonly snapshots = new Map<string, TrainingSemanticSnapshotV2>();
  private activeId: string | null = null;
  async save(snapshot: TrainingSemanticSnapshotV2) { validateTrainingSemanticSnapshotV2(snapshot); const existing = this.snapshots.get(snapshot.snapshotId); if (existing) return { status: 'already_exists' as const, snapshotId: snapshot.snapshotId }; this.snapshots.set(snapshot.snapshotId, deepFreezeTrainingSnapshot(cloneTrainingSnapshotJson(snapshot))); return { status: 'created' as const, snapshotId: snapshot.snapshotId }; }
  async activate(snapshotId: string): Promise<void> { if (!this.snapshots.has(snapshotId)) throw new Error(`SNAPSHOT_NOT_FOUND: ${snapshotId}`); this.activeId = snapshotId; }
  async getById(snapshotId: string) { const value = this.snapshots.get(snapshotId); return value ? deepFreezeTrainingSnapshot(cloneTrainingSnapshotJson(value)) : null; }
  async getActive() { return this.activeId ? this.getById(this.activeId) : null; }
}
