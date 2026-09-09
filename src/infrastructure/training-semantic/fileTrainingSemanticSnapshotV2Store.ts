import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalizeTrainingSnapshotJson, cloneTrainingSnapshotJson, deepFreezeTrainingSnapshot } from '../../domain/training-semantic-snapshot/canonicalJson.js';
import { validateTrainingSemanticSnapshotV2 } from '../../domain/training-semantic-snapshot/v2SnapshotBuilder.js';
import { trainingSemanticSnapshotV2Schema, type TrainingSemanticSnapshotV2, type TrainingSemanticSnapshotV2SaveResult, type TrainingSemanticSnapshotV2Store } from '../../domain/training-semantic-snapshot/v2-contracts.js';

type ActivePointer = Pick<TrainingSemanticSnapshotV2, 'snapshotId' | 'schemaVersion' | 'registryVersion' | 'registryHash' | 'classifierVersion' | 'classifierV2RulesHash' | 'semanticChecksum'> & { readonly rulesHash?: string; readonly activatedAt: string };

function fileName(snapshotId: string): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(snapshotId);
  if (!match) throw new Error('Invalid Training Semantic Snapshot V2 id');
  return `${match[1]}.json`;
}
function comparable(snapshot: TrainingSemanticSnapshotV2): string {
  const copy = { ...snapshot, generatedAt: undefined, activatedAt: undefined };
  delete (copy as { generatedAt?: string }).generatedAt;
  delete (copy as { activatedAt?: string }).activatedAt;
  return canonicalizeTrainingSnapshotJson(copy);
}

export class FileTrainingSemanticSnapshotV2Store implements TrainingSemanticSnapshotV2Store {
  private readonly snapshotsDirectory: string;
  private readonly activePointerPath: string;
  constructor(private readonly rootDirectory: string) { this.snapshotsDirectory = join(rootDirectory, 'snapshots'); this.activePointerPath = join(rootDirectory, 'active.json'); }

  async save(snapshot: TrainingSemanticSnapshotV2): Promise<TrainingSemanticSnapshotV2SaveResult> {
    validateTrainingSemanticSnapshotV2(snapshot);
    await mkdir(this.snapshotsDirectory, { recursive: true });
    const target = join(this.snapshotsDirectory, fileName(snapshot.snapshotId));
    const existing = await this.readSnapshot(target);
    if (existing) {
      if (comparable(existing) !== comparable(snapshot)) throw new Error(`SNAPSHOT_ID_COLLISION: ${snapshot.snapshotId} already contains different semantic bytes`);
      return { status: 'already_exists', snapshotId: snapshot.snapshotId };
    }
    await this.writeJsonAtomically(target, JSON.stringify(snapshot, null, 2));
    return { status: 'created', snapshotId: snapshot.snapshotId };
  }

  async activate(snapshotId: string): Promise<void> {
    const snapshot = await this.getById(snapshotId);
    if (!snapshot) throw new Error(`SNAPSHOT_NOT_FOUND: ${snapshotId}`);
    const pointer: ActivePointer = { snapshotId: snapshot.snapshotId, schemaVersion: snapshot.schemaVersion, registryVersion: snapshot.registryVersion, registryHash: snapshot.registryHash, classifierVersion: snapshot.classifierVersion, classifierV2RulesHash: snapshot.classifierV2RulesHash, ...(snapshot.rulesHash ? { rulesHash: snapshot.rulesHash } : {}), semanticChecksum: snapshot.semanticChecksum, activatedAt: new Date().toISOString() };
    await this.writeJsonAtomically(this.activePointerPath, JSON.stringify(pointer, null, 2));
  }

  async getById(snapshotId: string): Promise<TrainingSemanticSnapshotV2 | null> { return this.readSnapshot(join(this.snapshotsDirectory, fileName(snapshotId))); }

  async getActive(): Promise<TrainingSemanticSnapshotV2 | null> {
    let raw: string;
    try { raw = await readFile(this.activePointerPath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Active Training Semantic Snapshot V2 pointer could not be read'); }
    let pointer: Partial<ActivePointer>;
    try { pointer = JSON.parse(raw) as Partial<ActivePointer>; } catch { throw new Error('Active Training Semantic Snapshot V2 pointer is not valid JSON'); }
    if (!pointer.snapshotId || !pointer.schemaVersion || !pointer.registryVersion || !pointer.registryHash || !pointer.classifierVersion || !pointer.classifierV2RulesHash || !pointer.semanticChecksum || !pointer.activatedAt) throw new Error('Active Training Semantic Snapshot V2 pointer is incomplete');
    const snapshot = await this.getById(pointer.snapshotId);
    if (!snapshot) throw new Error(`SNAPSHOT_NOT_FOUND: active V2 snapshot ${pointer.snapshotId}`);
    for (const key of ['schemaVersion', 'registryVersion', 'registryHash', 'classifierVersion', 'classifierV2RulesHash', 'semanticChecksum'] as const) if (snapshot[key] !== pointer[key]) throw new Error(`Active V2 pointer ${key} does not match snapshot`);
    return snapshot;
  }

  private async readSnapshot(path: string): Promise<TrainingSemanticSnapshotV2 | null> {
    let raw: string;
    try { raw = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Training Semantic Snapshot V2 file could not be read'); }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Training Semantic Snapshot V2 file is not valid JSON'); }
    const result = trainingSemanticSnapshotV2Schema.safeParse(parsed);
    if (!result.success) throw new Error('Training Semantic Snapshot V2 file does not satisfy its contract');
    validateTrainingSemanticSnapshotV2(result.data);
    return deepFreezeTrainingSnapshot(cloneTrainingSnapshotJson(result.data));
  }
  private async writeJsonAtomically(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    const file = await open(temporaryPath, 'w');
    try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
    try { await rename(temporaryPath, path); } catch (error) { await rm(temporaryPath, { force: true }); throw error; }
  }
}
