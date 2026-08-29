import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  productSemanticSnapshotSchema,
  type ProductSemanticSnapshot,
  type ProductSemanticSnapshotSaveResult,
  type ProductSemanticSnapshotStore,
} from '../../domain/product-semantic-snapshot/index.js';
import { canonicalizeJson, cloneJsonValue, deepFreeze } from '../../domain/product-semantic-snapshot/index.js';
import { createProductSemanticSnapshotIdentityPayload } from '../../domain/product-semantic-snapshot/index.js';
import { ProductSemanticSnapshotStoreError } from '../../domain/product-semantic-snapshot/index.js';

type ActiveSnapshotPointer = {
  readonly snapshotId: string;
  readonly schemaVersion: string;
};

function snapshotFileName(snapshotId: string): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(snapshotId);
  if (!match) {
    throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot id is invalid');
  }
  return `${match[1]}.json`;
}

function immutableSnapshotCopy(snapshot: ProductSemanticSnapshot): ProductSemanticSnapshot {
  return deepFreeze(cloneJsonValue(snapshot));
}

function snapshotIdentity(snapshot: ProductSemanticSnapshot): string {
  return canonicalizeJson(createProductSemanticSnapshotIdentityPayload(snapshot));
}

function activePointer(value: unknown): ActiveSnapshotPointer | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'snapshotId' in value &&
    typeof value.snapshotId === 'string' &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'string'
  ) {
    return {
      snapshotId: value.snapshotId,
      schemaVersion: value.schemaVersion,
    };
  }
  return null;
}

export class FileProductSemanticSnapshotStore implements ProductSemanticSnapshotStore {
  private readonly snapshotsDirectory: string;

  private readonly activePointerPath: string;

  constructor(private readonly rootDirectory: string) {
    this.snapshotsDirectory = join(rootDirectory, 'snapshots');
    this.activePointerPath = join(rootDirectory, 'active.json');
  }

  async save(snapshot: ProductSemanticSnapshot): Promise<ProductSemanticSnapshotSaveResult> {
    const parsed = productSemanticSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Snapshot does not satisfy the snapshot contract');
    }

    await mkdir(this.snapshotsDirectory, { recursive: true });
    const path = this.snapshotPath(snapshot.snapshotId);
    const incomingIdentity = snapshotIdentity(snapshot);
    const existing = await this.readSnapshotFile(path);
    if (existing) {
      if (snapshotIdentity(existing) !== incomingIdentity) {
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

    await this.writeJsonAtomically(path, JSON.stringify(snapshot, null, 2));
    return {
      status: 'created',
      snapshotId: snapshot.snapshotId,
    };
  }

  async activate(snapshotId: string): Promise<void> {
    const snapshot = await this.getById(snapshotId);
    if (!snapshot) {
      throw new ProductSemanticSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'Cannot activate an unknown semantic snapshot', {
        snapshotId,
      });
    }
    await mkdir(this.rootDirectory, { recursive: true });
    await this.writeJsonAtomically(
      this.activePointerPath,
      JSON.stringify(
        {
          snapshotId,
          schemaVersion: snapshot.schemaVersion,
        },
        null,
        2,
      ),
    );
  }

  async getById(snapshotId: string): Promise<ProductSemanticSnapshot | null> {
    return this.readSnapshotFile(this.snapshotPath(snapshotId));
  }

  async getActive(): Promise<ProductSemanticSnapshot | null> {
    let raw: string;
    try {
      raw = await readFile(this.activePointerPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Active semantic snapshot pointer could not be read');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Active semantic snapshot pointer is not valid JSON');
    }
    const pointer = activePointer(parsed);
    if (!pointer) {
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Active semantic snapshot pointer is invalid');
    }
    const snapshot = await this.getById(pointer.snapshotId);
    if (!snapshot) {
      throw new ProductSemanticSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'Active semantic snapshot does not exist', {
        snapshotId: pointer.snapshotId,
      });
    }
    if (snapshot.schemaVersion !== pointer.schemaVersion) {
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Active semantic snapshot pointer schemaVersion does not match snapshot');
    }
    return snapshot;
  }

  private snapshotPath(snapshotId: string): string {
    return join(this.snapshotsDirectory, snapshotFileName(snapshotId));
  }

  private async readSnapshotFile(path: string): Promise<ProductSemanticSnapshot | null> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Semantic snapshot file could not be read');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Semantic snapshot file is not valid JSON');
    }

    const snapshot = productSemanticSnapshotSchema.safeParse(parsed);
    if (!snapshot.success) {
      throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'Semantic snapshot file does not satisfy the snapshot contract');
    }
    return immutableSnapshotCopy(snapshot.data);
  }

  private async writeJsonAtomically(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    const file = await open(temporaryPath, 'w');
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
