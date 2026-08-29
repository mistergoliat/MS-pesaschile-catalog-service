import { describe, expect, it } from 'vitest';
import type {
  ProductSemanticSnapshot,
  ProductSemanticSnapshotSaveResult,
  ProductSemanticSnapshotStore,
} from '../../src/domain/product-semantic-snapshot/index.js';
import {
  DefaultActiveProductSemanticSnapshotReader,
  DefaultProductSemanticRuntimeIndexBuilder,
  ProductSemanticRuntimeError,
  type ProductSemanticRuntimeIndexBuilder,
} from '../../src/domain/product-semantic-snapshot/runtime/index.js';
import {
  clone,
  runtimeSecondSemanticSnapshot,
  runtimeSemanticSnapshot,
} from '../fixtures/productSemanticSnapshot.js';

class ControlledSnapshotStore implements ProductSemanticSnapshotStore {
  getActiveCalls = 0;

  saveCalls = 0;

  activateCalls = 0;

  constructor(public activeSnapshot: ProductSemanticSnapshot | null) {}

  async save(): Promise<ProductSemanticSnapshotSaveResult> {
    this.saveCalls += 1;
    return {
      status: 'created',
      snapshotId: this.activeSnapshot?.snapshotId ?? 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
  }

  async activate(): Promise<void> {
    this.activateCalls += 1;
  }

  async getById(): Promise<ProductSemanticSnapshot | null> {
    throw new Error('getById should not be used by the runtime reader');
  }

  async getActive(): Promise<ProductSemanticSnapshot | null> {
    this.getActiveCalls += 1;
    return this.activeSnapshot;
  }
}

class CountingIndexBuilder extends DefaultProductSemanticRuntimeIndexBuilder {
  builds = 0;

  override build(snapshot: ProductSemanticSnapshot) {
    this.builds += 1;
    return super.build(snapshot);
  }
}

class ExplodingIndexBuilder implements ProductSemanticRuntimeIndexBuilder {
  build(): never {
    throw new Error('boom');
  }
}

function createReader(activeSnapshot: ProductSemanticSnapshot | null = runtimeSemanticSnapshot) {
  const store = new ControlledSnapshotStore(activeSnapshot);
  const indexBuilder = new CountingIndexBuilder();
  const reader = new DefaultActiveProductSemanticSnapshotReader(store, indexBuilder);
  return { reader, store, indexBuilder };
}

async function loadedReader(activeSnapshot: ProductSemanticSnapshot | null = runtimeSemanticSnapshot) {
  const context = createReader(activeSnapshot);
  await context.reader.refresh();
  return context;
}

async function expectRuntimeError(action: () => Promise<unknown> | unknown, code: ProductSemanticRuntimeError['code']): Promise<void> {
  await expect(Promise.resolve().then(action)).rejects.toThrow(ProductSemanticRuntimeError);
  try {
    await Promise.resolve().then(action);
  } catch (error) {
    expect(error).toBeInstanceOf(ProductSemanticRuntimeError);
    expect((error as ProductSemanticRuntimeError).code).toBe(code);
  }
}

describe('DefaultActiveProductSemanticSnapshotReader refresh', () => {
  it('starts with not_loaded status', () => {
    expect(createReader().reader.getStatus()).toEqual({ state: 'not_loaded' });
  });

  it('loads the active semantic snapshot', async () => {
    const { reader } = createReader();
    await reader.refresh();
    expect(reader.getStatus()).toMatchObject({ state: 'ready', snapshotId: runtimeSemanticSnapshot.snapshotId });
  });

  it('returns loaded on first active snapshot refresh', async () => {
    const { reader } = createReader();
    expect((await reader.refresh()).status).toBe('loaded');
  });

  it('exposes active metadata', async () => {
    const { reader } = await loadedReader();
    expect(reader.getActiveSnapshotMetadata()).toMatchObject({
      snapshotId: runtimeSemanticSnapshot.snapshotId,
      classifierVersion: runtimeSemanticSnapshot.classifierVersion,
      semanticChecksum: runtimeSemanticSnapshot.semanticChecksum,
      recordCount: runtimeSemanticSnapshot.recordCount,
    });
  });

  it('returns unchanged for the same snapshot', async () => {
    const { reader } = await loadedReader();
    expect((await reader.refresh()).status).toBe('unchanged');
  });

  it('does not rebuild the index for unchanged snapshot', async () => {
    const { reader, indexBuilder } = await loadedReader();
    await reader.refresh();
    expect(indexBuilder.builds).toBe(1);
  });

  it('replaces index when a new active snapshot appears', async () => {
    const { reader, store } = await loadedReader();
    store.activeSnapshot = runtimeSecondSemanticSnapshot;
    const result = await reader.refresh();
    expect(result.status).toBe('loaded');
    expect(reader.getActiveSnapshotMetadata()?.snapshotId).toBe(runtimeSecondSemanticSnapshot.snapshotId);
  });

  it('keeps the previous index if the new snapshot is invalid', async () => {
    const { reader, store } = await loadedReader();
    const corrupt = clone(runtimeSecondSemanticSnapshot);
    corrupt.recordCount = 99;
    store.activeSnapshot = corrupt;
    await expectRuntimeError(() => reader.refresh(), 'INVALID_RUNTIME_SNAPSHOT');
    expect(reader.getActiveSnapshotMetadata()?.snapshotId).toBe(runtimeSemanticSnapshot.snapshotId);
  });

  it('clears a loaded reader when no active snapshot exists', async () => {
    const { reader, store } = await loadedReader();
    store.activeSnapshot = null;
    const result = await reader.refresh();
    expect(result.status).toBe('cleared');
    expect(reader.getStatus()).toEqual({ state: 'not_loaded' });
  });

  it('wraps unexpected index build failures', async () => {
    const store = new ControlledSnapshotStore(runtimeSemanticSnapshot);
    const reader = new DefaultActiveProductSemanticSnapshotReader(store, new ExplodingIndexBuilder());
    await expectRuntimeError(() => reader.refresh(), 'RUNTIME_INDEX_BUILD_FAILURE');
  });
});

describe('DefaultActiveProductSemanticSnapshotReader lookup behavior', () => {
  it('answers hasProduct and product lookup in O(1)-style indexed reads', async () => {
    const { reader } = await loadedReader();
    expect(reader.hasProduct('1')).toBe(true);
    expect(reader.getProductSemanticFact('1')?.classificationStatus).toBe('CLASSIFIED');
    expect(reader.getProductSemanticFact('3')?.classificationStatus).toBe('OTHER');
    expect(reader.getProductSemanticFact('4')?.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
  });

  it('returns null for a product id not present in the snapshot', async () => {
    const { reader } = await loadedReader();
    expect(reader.getProductSemanticFact('999')).toBeNull();
  });

  it('returns all product facts without hitting the store again', async () => {
    const { reader, store } = await loadedReader();
    const calls = store.getActiveCalls;
    expect(reader.getAllProductSemanticFacts()).toHaveLength(runtimeSemanticSnapshot.recordCount);
    expect(store.getActiveCalls).toBe(calls);
  });

  it('throws explicitly when queried before load', async () => {
    const { reader } = createReader(null);
    expect(() => reader.hasProduct('1')).toThrow(ProductSemanticRuntimeError);
    expect(() => reader.getProductSemanticFact('1')).toThrow(ProductSemanticRuntimeError);
    expect(() => reader.getAllProductSemanticFacts()).toThrow(ProductSemanticRuntimeError);
  });

  it('rejects an empty product id query', async () => {
    const { reader } = await loadedReader();
    expect(() => reader.getProductSemanticFact('')).toThrow(ProductSemanticRuntimeError);
  });
});
