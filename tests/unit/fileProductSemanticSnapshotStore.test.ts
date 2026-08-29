import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ProductSemanticSnapshotStoreError } from '../../src/domain/product-semantic-snapshot/index.js';
import { FileProductSemanticSnapshotStore } from '../../src/infrastructure/product-semantic/fileProductSemanticSnapshotStore.js';
import { buildRuntimeSemanticSnapshot, runtimeSemanticSnapshot } from '../fixtures/productSemanticSnapshot.js';

async function tempStore() {
  const root = await mkdtemp(join(tmpdir(), 'product-semantic-snapshot-store-'));
  return {
    root,
    store: new FileProductSemanticSnapshotStore(root),
  };
}

describe('FileProductSemanticSnapshotStore', () => {
  it('saves and loads a snapshot by id', async () => {
    const { store } = await tempStore();
    await store.save(runtimeSemanticSnapshot);
    expect((await store.getById(runtimeSemanticSnapshot.snapshotId))?.snapshotId).toBe(runtimeSemanticSnapshot.snapshotId);
  });

  it('persists the active snapshot pointer with schemaVersion', async () => {
    const { root, store } = await tempStore();
    await store.save(runtimeSemanticSnapshot);
    await store.activate(runtimeSemanticSnapshot.snapshotId);

    const activePointer = JSON.parse(await readFile(join(root, 'active.json'), 'utf8')) as {
      snapshotId: string;
      schemaVersion: string;
    };
    expect(activePointer).toEqual({
      snapshotId: runtimeSemanticSnapshot.snapshotId,
      schemaVersion: runtimeSemanticSnapshot.schemaVersion,
    });
  });

  it('returns null when no active snapshot pointer exists', async () => {
    const { store } = await tempStore();
    expect(await store.getActive()).toBeNull();
  });

  it('rejects activating an unknown snapshot', async () => {
    const { store } = await tempStore();
    await expect(store.activate(runtimeSemanticSnapshot.snapshotId)).rejects.toThrow(ProductSemanticSnapshotStoreError);
  });

  it('rejects corrupt active pointer JSON', async () => {
    const { root, store } = await tempStore();
    await writeFile(join(root, 'active.json'), '{not-json', 'utf8');
    await expect(store.getActive()).rejects.toThrow(ProductSemanticSnapshotStoreError);
  });

  it('rejects a missing snapshot referenced by active.json', async () => {
    const { root, store } = await tempStore();
    await writeFile(join(root, 'active.json'), JSON.stringify({ snapshotId: runtimeSemanticSnapshot.snapshotId, schemaVersion: '1' }), 'utf8');
    await expect(store.getActive()).rejects.toThrow(ProductSemanticSnapshotStoreError);
  });

  it('ignores stray temporary files and still loads the active snapshot', async () => {
    const { root, store } = await tempStore();
    await store.save(runtimeSemanticSnapshot);
    await store.activate(runtimeSemanticSnapshot.snapshotId);
    await writeFile(join(root, 'snapshots', 'ignored.json.123.tmp'), '{"broken":true}', 'utf8');
    expect((await store.getActive())?.snapshotId).toBe(runtimeSemanticSnapshot.snapshotId);
  });

  it('treats same semantic content with a different builtAt as already_exists', async () => {
    const { store } = await tempStore();
    await store.save(runtimeSemanticSnapshot);
    const rebuilt = buildRuntimeSemanticSnapshot(undefined, '2026-08-29T14:00:00.000Z');
    await expect(store.save(rebuilt)).resolves.toEqual({
      status: 'already_exists',
      snapshotId: runtimeSemanticSnapshot.snapshotId,
    });
  });
});
