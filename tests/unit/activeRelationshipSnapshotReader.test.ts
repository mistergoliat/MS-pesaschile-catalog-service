import { describe, expect, it } from 'vitest';
import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import type {
  ProductRelationshipSnapshot,
  ProductRelationshipSnapshotSaveResult,
  ProductRelationshipSnapshotStore,
} from '../../src/domain/recommendation/relationship-engine/publication/index.js';
import {
  DefaultActiveProductRelationshipSnapshotReader,
  DefaultProductRelationshipRuntimeIndexBuilder,
  ProductRelationshipRuntimeError,
  type ProductRelationshipRuntimeIndexBuilder,
} from '../../src/domain/recommendation/relationship-engine/runtime/index.js';
import {
  buildEmptyRuntimeSnapshot,
  buildRuntimeSnapshot,
  clone,
  runtimeSecondSnapshot,
  runtimeSnapshot,
  runtimeRelationshipSet,
} from '../fixtures/relationshipRuntimeReader.js';

class ControlledSnapshotStore implements ProductRelationshipSnapshotStore {
  getActiveCalls = 0;

  saveCalls = 0;

  activateCalls = 0;

  constructor(public activeSnapshot: ProductRelationshipSnapshot | null) {}

  async save(): Promise<ProductRelationshipSnapshotSaveResult> {
    this.saveCalls += 1;
    return {
      status: 'created',
      snapshotId: this.activeSnapshot?.snapshotId ?? 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
  }

  async activate(): Promise<void> {
    this.activateCalls += 1;
  }

  async getById(): Promise<ProductRelationshipSnapshot | null> {
    throw new Error('getById should not be used by T07');
  }

  async getActive(): Promise<ProductRelationshipSnapshot | null> {
    this.getActiveCalls += 1;
    return this.activeSnapshot;
  }
}

class CountingIndexBuilder extends DefaultProductRelationshipRuntimeIndexBuilder {
  builds = 0;

  override build(snapshot: ProductRelationshipSnapshot) {
    this.builds += 1;
    return super.build(snapshot);
  }
}

class ExplodingIndexBuilder implements ProductRelationshipRuntimeIndexBuilder {
  build(): never {
    throw new Error('boom');
  }
}

function createReader(activeSnapshot: ProductRelationshipSnapshot | null = runtimeSnapshot) {
  const store = new ControlledSnapshotStore(activeSnapshot);
  const indexBuilder = new CountingIndexBuilder();
  const reader = new DefaultActiveProductRelationshipSnapshotReader(store, indexBuilder);
  return { reader, store, indexBuilder };
}

async function loadedReader(activeSnapshot: ProductRelationshipSnapshot | null = runtimeSnapshot) {
  const context = createReader(activeSnapshot);
  await context.reader.refresh();
  return context;
}

async function expectRuntimeError(action: () => Promise<unknown> | unknown, code: ProductRelationshipRuntimeError['code']): Promise<void> {
  await expect(Promise.resolve().then(action)).rejects.toThrow(ProductRelationshipRuntimeError);
  try {
    await Promise.resolve().then(action);
  } catch (error) {
    expect(error).toBeInstanceOf(ProductRelationshipRuntimeError);
    expect((error as ProductRelationshipRuntimeError).code).toBe(code);
  }
}

describe('DefaultActiveProductRelationshipSnapshotReader refresh', () => {
  it('starts with not_loaded status', () => {
    expect(createReader().reader.getStatus()).toEqual({ state: 'not_loaded' });
  });

  it('loads the active snapshot', async () => {
    const { reader } = createReader();
    await reader.refresh();
    expect(reader.getStatus()).toMatchObject({ state: 'ready', snapshotId: runtimeSnapshot.snapshotId });
  });

  it('returns loaded on first active snapshot refresh', async () => {
    const { reader } = createReader();
    expect((await reader.refresh()).status).toBe('loaded');
  });

  it('installs the runtime index', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships).toHaveLength(2);
  });

  it('exposes active metadata', async () => {
    const { reader } = await loadedReader();
    expect(reader.getActiveSnapshotMetadata()).toMatchObject({
      snapshotId: runtimeSnapshot.snapshotId,
      modelVersion: runtimeSnapshot.modelVersion,
      relationshipCount: runtimeSnapshot.relationshipCount,
      sourceCount: 2,
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
    store.activeSnapshot = runtimeSecondSnapshot;
    const result = await reader.refresh();
    expect(result.status).toBe('loaded');
    expect(reader.getActiveSnapshotMetadata()?.snapshotId).toBe(runtimeSecondSnapshot.snapshotId);
  });

  it('keeps previous index if the new build fails', async () => {
    const { reader, store } = await loadedReader();
    const corrupt = clone(runtimeSecondSnapshot);
    corrupt.relationshipCount = 99;
    store.activeSnapshot = corrupt;
    await expectRuntimeError(() => reader.refresh(), 'INVALID_RUNTIME_SNAPSHOT');
    expect(reader.getActiveSnapshotMetadata()?.snapshotId).toBe(runtimeSnapshot.snapshotId);
  });

  it('clears a loaded reader when no active snapshot exists', async () => {
    const { reader, store } = await loadedReader();
    store.activeSnapshot = null;
    const result = await reader.refresh();
    expect(result.status).toBe('cleared');
    expect(reader.getStatus()).toEqual({ state: 'not_loaded' });
  });

  it('returns cleared when an empty reader has no active snapshot', async () => {
    const { reader } = createReader(null);
    const result = await reader.refresh();
    expect(result.status).toBe('cleared');
    expect(result.statistics.snapshotChanged).toBe(false);
  });

  it('does not save while refreshing', async () => {
    const { reader, store } = createReader();
    await reader.refresh();
    expect(store.saveCalls).toBe(0);
  });

  it('does not activate while refreshing', async () => {
    const { reader, store } = createReader();
    await reader.refresh();
    expect(store.activateCalls).toBe(0);
  });

  it('uses getActive to discover the active snapshot', async () => {
    const { reader, store } = createReader();
    await reader.refresh();
    expect(store.getActiveCalls).toBe(1);
  });

  it('wraps unexpected index build failures', async () => {
    const store = new ControlledSnapshotStore(runtimeSnapshot);
    const reader = new DefaultActiveProductRelationshipSnapshotReader(store, new ExplodingIndexBuilder());
    await expectRuntimeError(() => reader.refresh(), 'RUNTIME_INDEX_BUILD_FAILURE');
  });
});

describe('DefaultActiveProductRelationshipSnapshotReader query behavior', () => {
  it('queries an existing source', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships).toHaveLength(2);
  });

  it('queries a missing source without throwing', async () => {
    const { reader } = await loadedReader();
    const result = reader.findBySource({ sourceProduct: { productId: 'Z' } });
    expect(result.relationships).toEqual([]);
    expect(result.totalMatched).toBe(0);
  });

  it('distinguishes source combinations', async () => {
    const { reader } = await loadedReader(buildRuntimeSnapshot([
      runtimeRelationshipSet.snapshotRelationshipAtoB,
      runtimeRelationshipSet.snapshotRelationshipWithSourceCombination,
    ]));
    expect(reader.findBySource({ sourceProduct: { productId: 'A', combinationId: '10' } }).relationships).toHaveLength(1);
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships).toHaveLength(1);
  });

  it('returns snapshot metadata in query result', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).snapshot.snapshotId).toBe(runtimeSnapshot.snapshotId);
  });

  it('preserves canonical order', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships.map((relationship) => relationship.targetProduct.productId)).toEqual(['B', 'C']);
  });

  it('returns totalMatched', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).totalMatched).toBe(2);
  });

  it('returns returned count', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, limit: 1 }).returned).toBe(1);
  });

  it('does not modify returned relationships', async () => {
    const { reader } = await loadedReader();
    const relationship = reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships[0];
    expect(Object.isFrozen(relationship)).toBe(true);
  });

  it('does not query the store during findBySource', async () => {
    const { reader, store } = await loadedReader();
    const calls = store.getActiveCalls;
    reader.findBySource({ sourceProduct: { productId: 'A' } });
    expect(store.getActiveCalls).toBe(calls);
  });

  it('queries an explicitly empty snapshot with an empty result', async () => {
    const { reader } = await loadedReader(buildEmptyRuntimeSnapshot());
    const result = reader.findBySource({ sourceProduct: { productId: 'A' } });
    expect(result.relationships).toEqual([]);
    expect(result.snapshot.relationshipCount).toBe(0);
  });
});

describe('DefaultActiveProductRelationshipSnapshotReader limit', () => {
  it('returns all relationships without a limit', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).returned).toBe(2);
  });

  it('truncates when limit is below total', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, limit: 1 }).relationships).toHaveLength(1);
  });

  it('returns all when limit is greater than total', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, limit: 99 }).relationships).toHaveLength(2);
  });

  it('returns all when limit equals total', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, limit: 2 }).relationships).toHaveLength(2);
  });

  it('rejects zero limit', async () => {
    const { reader } = await loadedReader();
    await expectRuntimeError(() => reader.findBySource({ sourceProduct: { productId: 'A' }, limit: 0 }), 'INVALID_RUNTIME_QUERY');
  });

  it('rejects negative limit', async () => {
    const { reader } = await loadedReader();
    await expectRuntimeError(() => reader.findBySource({ sourceProduct: { productId: 'A' }, limit: -1 }), 'INVALID_RUNTIME_QUERY');
  });

  it('rejects decimal limit', async () => {
    const { reader } = await loadedReader();
    await expectRuntimeError(() => reader.findBySource({ sourceProduct: { productId: 'A' }, limit: 1.5 }), 'INVALID_RUNTIME_QUERY');
  });

  it('does not reorder while limiting', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, limit: 1 }).relationships[0]?.targetProduct.productId).toBe('B');
  });
});

describe('DefaultActiveProductRelationshipSnapshotReader relationship type filters', () => {
  function mixedTypeSnapshot() {
    const manual: CalculatedProductRelationship = {
      ...runtimeRelationshipSet.snapshotRelationshipAtoB,
      targetProduct: { productId: 'D' },
      relationshipType: 'manual',
      evidence: {
        kind: 'rule',
        ruleId: 'manual-A-D',
        ruleVersion: '2025-01',
      },
      reliability: 0.8,
    };
    return buildRuntimeSnapshot([
      runtimeRelationshipSet.snapshotRelationshipAtoB,
      runtimeRelationshipSet.snapshotRelationshipAtoC,
      manual,
    ]);
  }

  it('accepts all relationship types without a filter', async () => {
    const { reader } = await loadedReader(mixedTypeSnapshot());
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships).toHaveLength(3);
  });

  it('filters same_order', async () => {
    const { reader } = await loadedReader(mixedTypeSnapshot());
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, relationshipTypes: ['same_order'] }).relationships).toHaveLength(2);
  });

  it('filters multiple types', async () => {
    const { reader } = await loadedReader(mixedTypeSnapshot());
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, relationshipTypes: ['same_order', 'manual'] }).relationships).toHaveLength(3);
  });

  it('returns zero for an empty type filter', async () => {
    const { reader } = await loadedReader(mixedTypeSnapshot());
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, relationshipTypes: [] }).relationships).toHaveLength(0);
  });

  it('treats duplicate filters as a set', async () => {
    const { reader } = await loadedReader(mixedTypeSnapshot());
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, relationshipTypes: ['manual', 'manual'] }).relationships).toHaveLength(1);
  });

  it('rejects invalid relationship types', async () => {
    const { reader } = await loadedReader();
    await expectRuntimeError(
      () => reader.findBySource({
        sourceProduct: { productId: 'A' },
        relationshipTypes: ['bad' as ProductRelationshipSourceQueryType],
      }),
      'INVALID_RUNTIME_QUERY',
    );
  });

  it('combines filter and limit', async () => {
    const { reader } = await loadedReader(mixedTypeSnapshot());
    const result = reader.findBySource({ sourceProduct: { productId: 'A' }, relationshipTypes: ['same_order'], limit: 1 });
    expect(result.totalMatched).toBe(2);
    expect(result.returned).toBe(1);
  });

  it('calculates totalMatched after filtering and before limit', async () => {
    const { reader } = await loadedReader(mixedTypeSnapshot());
    expect(reader.findBySource({ sourceProduct: { productId: 'A' }, relationshipTypes: ['same_order'], limit: 1 }).totalMatched).toBe(2);
  });
});

type ProductRelationshipSourceQueryType = 'same_order';

describe('DefaultActiveProductRelationshipSnapshotReader unloaded state', () => {
  it('fails when queried before refresh', async () => {
    await expectRuntimeError(() => createReader().reader.findBySource({ sourceProduct: { productId: 'A' } }), 'RUNTIME_SNAPSHOT_NOT_LOADED');
  });

  it('uses RUNTIME_SNAPSHOT_NOT_LOADED code before refresh', async () => {
    await expectRuntimeError(() => createReader().reader.findBySource({ sourceProduct: { productId: 'Z' } }), 'RUNTIME_SNAPSHOT_NOT_LOADED');
  });

  it('does not confuse not_loaded with source without results', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'Z' } }).totalMatched).toBe(0);
  });
});

describe('DefaultActiveProductRelationshipSnapshotReader immutability and determinism', () => {
  it('returns frozen arrays without filters', async () => {
    const { reader } = await loadedReader();
    expect(Object.isFrozen(reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships)).toBe(true);
  });

  it('returns frozen arrays with filters', async () => {
    const { reader } = await loadedReader();
    expect(Object.isFrozen(reader.findBySource({ sourceProduct: { productId: 'A' }, relationshipTypes: ['same_order'] }).relationships)).toBe(true);
  });

  it('returns frozen arrays with limits', async () => {
    const { reader } = await loadedReader();
    expect(Object.isFrozen(reader.findBySource({ sourceProduct: { productId: 'A' }, limit: 1 }).relationships)).toBe(true);
  });

  it('mutating query after execution does not affect the index', async () => {
    const { reader } = await loadedReader();
    const query = { sourceProduct: { productId: 'A' }, relationshipTypes: ['same_order'] as const };
    const first = reader.findBySource(query);
    query.sourceProduct.productId = 'Z';
    const second = reader.findBySource({ sourceProduct: { productId: 'A' } });
    expect(first.relationships).toEqual(second.relationships);
  });

  it('mutating original snapshot after refresh does not affect query results', async () => {
    const snapshot = clone(runtimeSnapshot);
    const { reader } = await loadedReader(snapshot);
    snapshot.relationships[0]!.targetProduct.productId = 'MUTATED';
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships[0]?.targetProduct.productId).toBe('B');
  });

  it('refresh does not alter the snapshot returned by the store', async () => {
    const snapshot = clone(runtimeSnapshot);
    const before = clone(snapshot);
    await loadedReader(snapshot);
    expect(snapshot).toEqual(before);
  });

  it('same snapshot generates same query result', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } })).toEqual(
      reader.findBySource({ sourceProduct: { productId: 'A' } }),
    );
  });

  it('same query generates same result', async () => {
    const { reader } = await loadedReader();
    const query = { sourceProduct: { productId: 'A' } };
    expect(reader.findBySource(query)).toEqual(reader.findBySource(query));
  });

  it('keeps result order stable', async () => {
    const { reader } = await loadedReader();
    const first = reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships.map((relationship) => relationship.targetProduct.productId);
    const second = reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships.map((relationship) => relationship.targetProduct.productId);
    expect(second).toEqual(first);
  });

  it('does not use the clock', async () => {
    const { reader } = await loadedReader();
    const result = reader.findBySource({ sourceProduct: { productId: 'A' } });
    expect(result.snapshot).not.toHaveProperty('loadedAt');
    expect(result.snapshot).not.toHaveProperty('generatedAt');
  });

  it('does not generate IDs', async () => {
    const { reader } = await loadedReader();
    const result = reader.findBySource({ sourceProduct: { productId: 'A' } });
    expect(result).not.toHaveProperty('queryId');
  });

  it('performs no store I/O during query', async () => {
    const { reader, store } = await loadedReader();
    const calls = store.getActiveCalls;
    reader.findBySource({ sourceProduct: { productId: 'A' } });
    reader.findBySource({ sourceProduct: { productId: 'B' } });
    expect(store.getActiveCalls).toBe(calls);
  });
});

describe('DefaultActiveProductRelationshipSnapshotReader compatibility', () => {
  it('consumes a real T06 snapshot', async () => {
    const { reader } = await loadedReader(runtimeSnapshot);
    expect(reader.getStatus()).toMatchObject({ state: 'ready' });
  });

  it('accepts relationships validated by T05 and published by T06', async () => {
    const { reader } = await loadedReader(buildRuntimeSnapshot([
      runtimeRelationshipSet.snapshotRelationshipAtoB,
      runtimeRelationshipSet.snapshotRelationshipAtoC,
    ]));
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).returned).toBe(2);
  });

  it('preserves T04 reliability', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships[0]?.reliability).toBe(0.55);
  });

  it('preserves T03 evidence', async () => {
    const { reader } = await loadedReader();
    expect(reader.findBySource({ sourceProduct: { productId: 'A' } }).relationships[0]?.evidence).toHaveProperty('jointCount', 12);
  });

  it('does not depend on T02 datasets', async () => {
    const { reader } = await loadedReader();
    expect(JSON.stringify(reader.getActiveSnapshotMetadata()).toLowerCase()).not.toContain('transactions');
  });

  it('does not expose SQL, Redis, endpoints, Excel, panel, CRM, or e-commerce markers', async () => {
    const { reader } = await loadedReader();
    expect(JSON.stringify(reader.findBySource({ sourceProduct: { productId: 'A' } })).toLowerCase()).not.toMatch(
      /select |redis|endpoint|excel|panel|crm|e-commerce/u,
    );
  });
});
