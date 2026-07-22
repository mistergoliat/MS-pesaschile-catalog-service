import { describe, expect, it } from 'vitest';
import {
  DefaultProductRelationshipSnapshotBuilder,
  InMemoryProductRelationshipSnapshotStore,
  ProductRelationshipSnapshotStoreError,
  type ProductRelationshipSnapshot,
} from '../../src/domain/recommendation/relationship-engine/publication/index.js';
import {
  clone,
  snapshotRelationshipAtoB,
  validatedWrapper,
} from '../fixtures/relationshipSnapshotPublisher.js';

function buildSnapshot(overrideReliability?: number): ProductRelationshipSnapshot {
  const relationship = overrideReliability === undefined
    ? snapshotRelationshipAtoB
    : { ...snapshotRelationshipAtoB, reliability: overrideReliability };
  return new DefaultProductRelationshipSnapshotBuilder().build({
    relationships: [validatedWrapper(relationship)],
  }).snapshot;
}

async function expectStoreError(action: () => Promise<unknown>, code: ProductRelationshipSnapshotStoreError['code']): Promise<void> {
  await expect(action()).rejects.toThrow(ProductRelationshipSnapshotStoreError);
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProductRelationshipSnapshotStoreError);
    expect((error as ProductRelationshipSnapshotStoreError).code).toBe(code);
  }
}

describe('InMemoryProductRelationshipSnapshotStore save behavior', () => {
  it('saves a new snapshot', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    await store.save(snapshot);
    expect(await store.getById(snapshot.snapshotId)).toEqual(snapshot);
  });

  it('returns created for a new snapshot', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    expect(await store.save(buildSnapshot())).toMatchObject({ status: 'created' });
  });

  it('returns already_exists for a second save of the same snapshot', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    await store.save(snapshot);
    expect(await store.save(snapshot)).toMatchObject({ status: 'already_exists' });
  });

  it('does not duplicate the same snapshot', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    await store.save(snapshot);
    await store.save(snapshot);
    expect(await store.getById(snapshot.snapshotId)).toEqual(snapshot);
  });

  it('gets a snapshot by ID', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    await store.save(snapshot);
    expect((await store.getById(snapshot.snapshotId))?.snapshotId).toBe(snapshot.snapshotId);
  });

  it('returns null for unknown IDs', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    expect(await store.getById('sha256:0000000000000000000000000000000000000000000000000000000000000000')).toBeNull();
  });

  it('rejects invalid snapshots', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = { ...buildSnapshot(), snapshotId: 'invalid' };
    await expectStoreError(() => store.save(snapshot as ProductRelationshipSnapshot), 'INVALID_SNAPSHOT');
  });
});

describe('InMemoryProductRelationshipSnapshotStore activation', () => {
  it('saving does not activate automatically', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    await store.save(buildSnapshot());
    expect(await store.getActive()).toBeNull();
  });

  it('activates an existing snapshot', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    await store.save(snapshot);
    await store.activate(snapshot.snapshotId);
    expect((await store.getActive())?.snapshotId).toBe(snapshot.snapshotId);
  });

  it('rejects activation of an unknown snapshot', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    await expectStoreError(
      () => store.activate('sha256:1111111111111111111111111111111111111111111111111111111111111111'),
      'SNAPSHOT_NOT_FOUND',
    );
  });

  it('maintains only one active snapshot', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const first = buildSnapshot(0.55);
    const second = buildSnapshot(0.65);
    await store.save(first);
    await store.save(second);
    await store.activate(first.snapshotId);
    await store.activate(second.snapshotId);
    expect((await store.getActive())?.snapshotId).toBe(second.snapshotId);
  });

  it('changing active snapshot does not remove previous snapshots', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const first = buildSnapshot(0.55);
    const second = buildSnapshot(0.65);
    await store.save(first);
    await store.save(second);
    await store.activate(second.snapshotId);
    expect(await store.getById(first.snapshotId)).toEqual(first);
  });
});

describe('InMemoryProductRelationshipSnapshotStore collision and immutability', () => {
  it('detects snapshot ID collision with different content', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    const collision = clone(snapshot);
    collision.relationships[0]!.reliability = 0.99;
    await store.save(snapshot);
    await expectStoreError(() => store.save(collision), 'SNAPSHOT_ID_COLLISION');
  });

  it('compares canonical content rather than references', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    await store.save(snapshot);
    expect(await store.save(clone(snapshot))).toMatchObject({ status: 'already_exists' });
  });

  it('stores an immutable snapshot copy', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = clone(buildSnapshot());
    await store.save(snapshot);
    snapshot.relationships[0]!.targetProduct.productId = 'MUTATED';
    const stored = await store.getById(snapshot.snapshotId);
    expect(stored?.relationships[0]?.targetProduct.productId).toBe('B');
  });

  it('returns frozen snapshots', async () => {
    const store = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    await store.save(snapshot);
    const stored = await store.getById(snapshot.snapshotId);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored?.relationships)).toBe(true);
  });

  it('does not use global state across store instances', async () => {
    const firstStore = new InMemoryProductRelationshipSnapshotStore();
    const secondStore = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    await firstStore.save(snapshot);
    expect(await secondStore.getById(snapshot.snapshotId)).toBeNull();
  });

  it('leaves active empty in a new store instance', async () => {
    const firstStore = new InMemoryProductRelationshipSnapshotStore();
    const secondStore = new InMemoryProductRelationshipSnapshotStore();
    const snapshot = buildSnapshot();
    await firstStore.save(snapshot);
    await firstStore.activate(snapshot.snapshotId);
    expect(await secondStore.getActive()).toBeNull();
  });
});
