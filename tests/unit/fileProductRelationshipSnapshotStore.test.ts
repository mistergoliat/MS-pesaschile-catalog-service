import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FileProductRelationshipSnapshotStore } from '../../src/infrastructure/recommendation/fileProductRelationshipSnapshotStore.js';
import { ProductRelationshipSnapshotStoreError } from '../../src/domain/recommendation/relationship-engine/publication/index.js';
import { runtimeSnapshot } from '../fixtures/relationshipRuntimeReader.js';

async function tempStore() {
  const root = await mkdtemp(join(tmpdir(), 'relationship-snapshot-store-'));
  return {
    root,
    store: new FileProductRelationshipSnapshotStore(root),
  };
}

describe('FileProductRelationshipSnapshotStore', () => {
  it('saves and loads a snapshot by id', async () => {
    const { store } = await tempStore();
    await store.save(runtimeSnapshot);
    expect((await store.getById(runtimeSnapshot.snapshotId))?.snapshotId).toBe(runtimeSnapshot.snapshotId);
  });

  it('persists the active snapshot pointer', async () => {
    const { root, store } = await tempStore();
    await store.save(runtimeSnapshot);
    await store.activate(runtimeSnapshot.snapshotId);

    const reloaded = new FileProductRelationshipSnapshotStore(root);
    expect((await reloaded.getActive())?.snapshotId).toBe(runtimeSnapshot.snapshotId);
  });

  it('returns null when no active snapshot pointer exists', async () => {
    const { store } = await tempStore();
    expect(await store.getActive()).toBeNull();
  });

  it('rejects activating an unknown snapshot', async () => {
    const { store } = await tempStore();
    await expect(store.activate(runtimeSnapshot.snapshotId)).rejects.toThrow(ProductRelationshipSnapshotStoreError);
  });

  it('rejects corrupt active pointer JSON', async () => {
    const { root, store } = await tempStore();
    await writeFile(join(root, 'active.json'), '{not-json', 'utf8');
    await expect(store.getActive()).rejects.toThrow(ProductRelationshipSnapshotStoreError);
  });

  it('does not expose mutable snapshot references', async () => {
    const { store } = await tempStore();
    await store.save(runtimeSnapshot);
    await store.activate(runtimeSnapshot.snapshotId);
    const active = await store.getActive();
    expect(Object.isFrozen(active)).toBe(true);
  });

  it('stores snapshots under a filesystem-safe hash filename', async () => {
    const { root, store } = await tempStore();
    await store.save(runtimeSnapshot);
    const hash = runtimeSnapshot.snapshotId.replace('sha256:', '');
    const raw = await readFile(join(root, 'snapshots', `${hash}.json`), 'utf8');
    expect(raw).toContain(runtimeSnapshot.snapshotId);
  });
});
