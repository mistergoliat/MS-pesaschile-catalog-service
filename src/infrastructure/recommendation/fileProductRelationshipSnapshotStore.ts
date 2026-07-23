import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  productRelationshipSnapshotSchema,
  type ProductRelationshipSnapshot,
  type ProductRelationshipSnapshotSaveResult,
  type ProductRelationshipSnapshotStore,
} from '../../domain/recommendation/relationship-engine/publication/contracts.js';
import { canonicalizeJson, cloneJsonValue, deepFreeze } from '../../domain/recommendation/relationship-engine/publication/canonicalJson.js';
import { ProductRelationshipSnapshotStoreError } from '../../domain/recommendation/relationship-engine/publication/errors.js';

type ActiveSnapshotPointer = {
  readonly snapshotId: string;
};

function snapshotFileName(snapshotId: string): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(snapshotId);
  if (!match) {
    throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot id is invalid');
  }
  return `${match[1]}.json`;
}

function immutableSnapshotCopy(snapshot: ProductRelationshipSnapshot): ProductRelationshipSnapshot {
  return deepFreeze(cloneJsonValue(snapshot));
}

function canonicalSnapshot(snapshot: ProductRelationshipSnapshot): string {
  return canonicalizeJson(snapshot);
}

function activePointer(value: unknown): ActiveSnapshotPointer | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'snapshotId' in value &&
    typeof value.snapshotId === 'string'
  ) {
    return { snapshotId: value.snapshotId };
  }
  return null;
}

export class FileProductRelationshipSnapshotStore implements ProductRelationshipSnapshotStore {
  private readonly snapshotsDirectory: string;

  private readonly activePointerPath: string;

  constructor(private readonly rootDirectory: string) {
    this.snapshotsDirectory = join(rootDirectory, 'snapshots');
    this.activePointerPath = join(rootDirectory, 'active.json');
  }

  async save(snapshot: ProductRelationshipSnapshot): Promise<ProductRelationshipSnapshotSaveResult> {
    const parsed = productRelationshipSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot does not satisfy the snapshot contract');
    }

    await mkdir(this.snapshotsDirectory, { recursive: true });
    const path = this.snapshotPath(snapshot.snapshotId);
    const incoming = canonicalSnapshot(snapshot);
    const existing = await this.readSnapshotFile(path);
    if (existing) {
      if (canonicalSnapshot(existing) !== incoming) {
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

    await this.writeJsonAtomically(path, JSON.stringify(snapshot, null, 2));
    return {
      status: 'created',
      snapshotId: snapshot.snapshotId,
    };
  }

  async activate(snapshotId: string): Promise<void> {
    if (await this.getById(snapshotId) === null) {
      throw new ProductRelationshipSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'Cannot activate an unknown snapshot', {
        snapshotId,
      });
    }
    await mkdir(this.rootDirectory, { recursive: true });
    await this.writeJsonAtomically(this.activePointerPath, JSON.stringify({ snapshotId }, null, 2));
  }

  async getById(snapshotId: string): Promise<ProductRelationshipSnapshot | null> {
    return this.readSnapshotFile(this.snapshotPath(snapshotId));
  }

  async getActive(): Promise<ProductRelationshipSnapshot | null> {
    let raw: string;
    try {
      raw = await readFile(this.activePointerPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Active snapshot pointer could not be read');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Active snapshot pointer is not valid JSON');
    }
    const pointer = activePointer(parsed);
    if (!pointer) {
      throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Active snapshot pointer is invalid');
    }
    const snapshot = await this.getById(pointer.snapshotId);
    if (!snapshot) {
      throw new ProductRelationshipSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'Active snapshot does not exist', {
        snapshotId: pointer.snapshotId,
      });
    }
    return snapshot;
  }

  private snapshotPath(snapshotId: string): string {
    return join(this.snapshotsDirectory, snapshotFileName(snapshotId));
  }

  private async readSnapshotFile(path: string): Promise<ProductRelationshipSnapshot | null> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot file could not be read');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot file is not valid JSON');
    }

    const snapshot = productRelationshipSnapshotSchema.safeParse(parsed);
    if (!snapshot.success) {
      throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot file does not satisfy the snapshot contract');
    }
    return immutableSnapshotCopy(snapshot.data);
  }

  private async writeJsonAtomically(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, content, 'utf8');
    await rename(temporaryPath, path);
  }
}
