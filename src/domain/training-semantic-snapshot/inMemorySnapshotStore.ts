import { cloneTrainingSnapshotJson, deepFreezeTrainingSnapshot } from './canonicalJson.js';
import { validateTrainingSemanticSnapshot } from './defaultSnapshotBuilder.js';
import { type TrainingSemanticSnapshot, type TrainingSemanticSnapshotSaveResult, type TrainingSemanticSnapshotStore } from './contracts.js';
import { TrainingSemanticSnapshotStoreError } from './errors.js';

export class InMemoryTrainingSemanticSnapshotStore implements TrainingSemanticSnapshotStore {
  private readonly snapshots = new Map<string, TrainingSemanticSnapshot>();
  private activeId: string | null = null;

  async save(snapshot: TrainingSemanticSnapshot): Promise<TrainingSemanticSnapshotSaveResult> {
    try { validateTrainingSemanticSnapshot(snapshot); } catch (error) { throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot does not satisfy its contract', { cause: error }); }
    const existing = this.snapshots.get(snapshot.snapshotId);
    if (existing) {
      if (existing.snapshotId !== snapshot.snapshotId) throw new TrainingSemanticSnapshotStoreError('SNAPSHOT_ID_COLLISION', 'Different snapshot exists with same id', { snapshotId: snapshot.snapshotId });
      return { status: 'already_exists', snapshotId: snapshot.snapshotId };
    }
    this.snapshots.set(snapshot.snapshotId, deepFreezeTrainingSnapshot(cloneTrainingSnapshotJson(snapshot)));
    return { status: 'created', snapshotId: snapshot.snapshotId };
  }

  async activate(snapshotId: string): Promise<void> {
    if (!this.snapshots.has(snapshotId)) throw new TrainingSemanticSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'Cannot activate an unknown snapshot', { snapshotId });
    this.activeId = snapshotId;
  }

  async getById(snapshotId: string): Promise<TrainingSemanticSnapshot | null> {
    const snapshot = this.snapshots.get(snapshotId);
    return snapshot ? deepFreezeTrainingSnapshot(cloneTrainingSnapshotJson(snapshot)) : null;
  }

  async getActive(): Promise<TrainingSemanticSnapshot | null> {
    return this.activeId ? this.getById(this.activeId) : null;
  }
}
