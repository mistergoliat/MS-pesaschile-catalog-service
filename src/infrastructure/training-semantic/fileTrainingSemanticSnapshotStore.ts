import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cloneTrainingSnapshotJson, deepFreezeTrainingSnapshot } from '../../domain/training-semantic-snapshot/canonicalJson.js';
import { validateTrainingSemanticSnapshot } from '../../domain/training-semantic-snapshot/defaultSnapshotBuilder.js';
import { trainingSemanticSnapshotSchema, type TrainingSemanticSnapshot, type TrainingSemanticSnapshotSaveResult, type TrainingSemanticSnapshotStore } from '../../domain/training-semantic-snapshot/contracts.js';
import { TrainingSemanticSnapshotStoreError } from '../../domain/training-semantic-snapshot/errors.js';

type ActivePointer = Pick<TrainingSemanticSnapshot, 'snapshotId' | 'schemaVersion' | 'registryVersion' | 'registryHash' | 'classifierVersion' | 'rulesHash' | 'semanticChecksum'> & { readonly activatedAt: string };

function fileName(snapshotId: string): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(snapshotId);
  if (!match) throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Invalid snapshot id');
  return `${match[1]}.json`;
}

function immutable(snapshot: TrainingSemanticSnapshot): TrainingSemanticSnapshot { return deepFreezeTrainingSnapshot(cloneTrainingSnapshotJson(snapshot)); }

export class FileTrainingSemanticSnapshotStore implements TrainingSemanticSnapshotStore {
  private readonly snapshotsDirectory: string;
  private readonly activePointerPath: string;
  constructor(private readonly rootDirectory: string) { this.snapshotsDirectory = join(rootDirectory, 'snapshots'); this.activePointerPath = join(rootDirectory, 'active.json'); }

  async save(snapshot: TrainingSemanticSnapshot): Promise<TrainingSemanticSnapshotSaveResult> {
    try { validateTrainingSemanticSnapshot(snapshot); } catch (error) { throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot does not satisfy its contract or identity', { cause: error }); }
    await mkdir(this.snapshotsDirectory, { recursive: true });
    const path = join(this.snapshotsDirectory, fileName(snapshot.snapshotId));
    const existing = await this.readSnapshot(path);
    if (existing) {
      if (existing.snapshotId !== snapshot.snapshotId) throw new TrainingSemanticSnapshotStoreError('SNAPSHOT_ID_COLLISION', 'Different snapshot exists with same id', { snapshotId: snapshot.snapshotId });
      return { status: 'already_exists', snapshotId: snapshot.snapshotId };
    }
    await this.writeJsonAtomically(path, JSON.stringify(snapshot, null, 2));
    return { status: 'created', snapshotId: snapshot.snapshotId };
  }

  async activate(snapshotId: string): Promise<void> {
    const snapshot = await this.getById(snapshotId);
    if (!snapshot) throw new TrainingSemanticSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'Cannot activate an unknown snapshot', { snapshotId });
    const pointer: ActivePointer = { snapshotId: snapshot.snapshotId, schemaVersion: snapshot.schemaVersion, registryVersion: snapshot.registryVersion, registryHash: snapshot.registryHash, classifierVersion: snapshot.classifierVersion, rulesHash: snapshot.rulesHash, semanticChecksum: snapshot.semanticChecksum, activatedAt: new Date().toISOString() };
    await this.writeJsonAtomically(this.activePointerPath, JSON.stringify(pointer, null, 2));
  }

  async getById(snapshotId: string): Promise<TrainingSemanticSnapshot | null> { return this.readSnapshot(join(this.snapshotsDirectory, fileName(snapshotId))); }

  async getActive(): Promise<TrainingSemanticSnapshot | null> {
    let raw: string;
    try { raw = await readFile(this.activePointerPath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Active pointer could not be read'); }
    let pointer: Partial<ActivePointer>;
    try { pointer = JSON.parse(raw) as Partial<ActivePointer>; } catch { throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Active pointer is not valid JSON'); }
    if (!pointer.snapshotId || !pointer.schemaVersion || !pointer.registryVersion || !pointer.registryHash || !pointer.classifierVersion || !pointer.rulesHash || !pointer.semanticChecksum || !pointer.activatedAt) throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Active pointer is incomplete');
    const snapshot = await this.getById(pointer.snapshotId);
    if (!snapshot) throw new TrainingSemanticSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'Active snapshot does not exist', { snapshotId: pointer.snapshotId });
    for (const key of ['schemaVersion', 'registryVersion', 'registryHash', 'classifierVersion', 'rulesHash', 'semanticChecksum'] as const) if (snapshot[key] !== pointer[key]) throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', `Active pointer ${key} does not match snapshot`);
    return snapshot;
  }

  private async readSnapshot(path: string): Promise<TrainingSemanticSnapshot | null> {
    let raw: string;
    try { raw = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot file could not be read'); }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot file is not valid JSON'); }
    const result = trainingSemanticSnapshotSchema.safeParse(parsed);
    if (!result.success) throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot file does not satisfy its contract');
    try { validateTrainingSemanticSnapshot(result.data); } catch { throw new TrainingSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot file does not satisfy its contract or identity'); }
    return immutable(result.data);
  }

  private async writeJsonAtomically(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    const file = await open(temporaryPath, 'w');
    try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
    try { await rename(temporaryPath, path); } catch (error) { await rm(temporaryPath, { force: true }); throw error; }
  }
}
