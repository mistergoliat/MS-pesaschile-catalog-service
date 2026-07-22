import { describe, expect, it } from 'vitest';
import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import type { ProductRelationshipSnapshot } from '../../src/domain/recommendation/relationship-engine/publication/index.js';
import {
  createProductRuntimeIdentity,
  DefaultProductRelationshipRuntimeIndexBuilder,
  ProductRelationshipRuntimeError,
} from '../../src/domain/recommendation/relationship-engine/runtime/index.js';
import {
  buildRuntimeSnapshot,
  buildEmptyRuntimeSnapshot,
  clone,
  runtimeCombinationSnapshot,
  runtimeSnapshot,
  runtimeRelationshipSet,
} from '../fixtures/relationshipRuntimeReader.js';

type MutableSnapshot = Omit<ProductRelationshipSnapshot, 'relationships'> & {
  relationshipCount: number;
  relationships: CalculatedProductRelationship[];
};

function builder() {
  return new DefaultProductRelationshipRuntimeIndexBuilder();
}

function expectRuntimeError(action: () => unknown, code: ProductRelationshipRuntimeError['code']): void {
  expect(action).toThrow(ProductRelationshipRuntimeError);
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProductRelationshipRuntimeError);
    expect((error as ProductRelationshipRuntimeError).code).toBe(code);
  }
}

describe('createProductRuntimeIdentity', () => {
  it('builds identity for a base product', () => {
    expect(createProductRuntimeIdentity({ productId: '123' })).toBe('123::<base>');
  });

  it('builds identity for a combination', () => {
    expect(createProductRuntimeIdentity({ productId: '123', combinationId: '456' })).toBe('123::456');
  });

  it('distinguishes base product from combination', () => {
    expect(createProductRuntimeIdentity({ productId: '123' })).not.toBe(
      createProductRuntimeIdentity({ productId: '123', combinationId: '456' }),
    );
  });

  it('distinguishes combinations', () => {
    expect(createProductRuntimeIdentity({ productId: '123', combinationId: '456' })).not.toBe(
      createProductRuntimeIdentity({ productId: '123', combinationId: '789' }),
    );
  });

  it('is deterministic', () => {
    expect(createProductRuntimeIdentity({ productId: 'barra-olimpica' })).toBe(
      createProductRuntimeIdentity({ productId: 'barra-olimpica' }),
    );
  });

  it('avoids concatenation collisions with separators', () => {
    expect(createProductRuntimeIdentity({ productId: 'a::b', combinationId: 'c' })).not.toBe(
      createProductRuntimeIdentity({ productId: 'a', combinationId: 'b::c' }),
    );
  });

  it('avoids collision with the base marker as a real combination', () => {
    expect(createProductRuntimeIdentity({ productId: 'A' })).not.toBe(
      createProductRuntimeIdentity({ productId: 'A', combinationId: '<base>' }),
    );
  });

  it('rejects invalid references', () => {
    expectRuntimeError(() => createProductRuntimeIdentity({ productId: '' }), 'INVALID_RUNTIME_QUERY');
  });
});

describe('DefaultProductRelationshipRuntimeIndexBuilder construction', () => {
  it('builds an index from a valid snapshot', () => {
    const index = builder().build(runtimeSnapshot);
    expect(index.snapshotId).toBe(runtimeSnapshot.snapshotId);
  });

  it('indexes relationships by source', () => {
    const index = builder().build(runtimeSnapshot);
    expect(index.relationshipsBySource.get('A::<base>')).toHaveLength(2);
  });

  it('groups multiple outgoing relationships for one source', () => {
    const relationships = builder().build(runtimeSnapshot).relationshipsBySource.get('A::<base>') ?? [];
    expect(relationships.map((relationship) => relationship.targetProduct.productId)).toEqual(['B', 'C']);
  });

  it('separates different sources', () => {
    const index = builder().build(runtimeSnapshot);
    expect(index.relationshipsBySource.get('B::<base>')).toHaveLength(1);
  });

  it('preserves canonical order inside each source bucket', () => {
    const relationships = builder().build(runtimeSnapshot).relationshipsBySource.get('A::<base>') ?? [];
    expect(relationships.map((relationship) => relationship.targetProduct.productId)).toEqual(['B', 'C']);
  });

  it('does not order by reliability', () => {
    const lowA: CalculatedProductRelationship = {
      ...runtimeRelationshipSet.snapshotRelationshipAtoB,
      reliability: 0.31,
    };
    const highC: CalculatedProductRelationship = {
      ...runtimeRelationshipSet.snapshotRelationshipAtoC,
      reliability: 0.99,
    };
    const relationships = builder().build(buildRuntimeSnapshot([highC, lowA])).relationshipsBySource.get('A::<base>') ?? [];
    expect(relationships.map((relationship) => relationship.targetProduct.productId)).toEqual(['B', 'C']);
  });

  it('preserves snapshot metadata', () => {
    const index = builder().build(runtimeSnapshot);
    expect(index).toMatchObject({
      snapshotId: runtimeSnapshot.snapshotId,
      schemaVersion: '1',
      modelVersion: runtimeSnapshot.modelVersion,
      relationshipCount: runtimeSnapshot.relationshipCount,
    });
  });

  it('calculates source count through the map size', () => {
    expect(builder().build(runtimeSnapshot).relationshipsBySource.size).toBe(2);
  });

  it('accepts an empty snapshot', () => {
    const empty = buildEmptyRuntimeSnapshot();
    expect(builder().build(empty).relationshipCount).toBe(0);
  });

  it('does not modify the snapshot', () => {
    const snapshot = clone(runtimeSnapshot);
    const before = clone(snapshot);
    builder().build(snapshot);
    expect(snapshot).toEqual(before);
  });

  it('does not modify relationships', () => {
    const snapshot = clone(runtimeSnapshot);
    const before = clone(snapshot.relationships[0]);
    builder().build(snapshot);
    expect(snapshot.relationships[0]).toEqual(before);
  });
});

describe('DefaultProductRelationshipRuntimeIndexBuilder integrity checks', () => {
  it('rejects inconsistent relationshipCount', () => {
    const snapshot = clone(runtimeSnapshot);
    snapshot.relationshipCount = 999;
    expectRuntimeError(() => builder().build(snapshot), 'INVALID_RUNTIME_SNAPSHOT');
  });

  it('rejects inconsistent modelVersion', () => {
    const snapshot = clone(runtimeSnapshot);
    snapshot.relationships[0]!.modelVersion = 'other';
    expectRuntimeError(() => builder().build(snapshot), 'INVALID_RUNTIME_SNAPSHOT');
  });

  it('rejects inconsistent evidenceWindow', () => {
    const snapshot = clone(runtimeSnapshot);
    snapshot.relationships[0]!.evidenceWindow = {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.000Z',
    };
    expectRuntimeError(() => builder().build(snapshot), 'INVALID_RUNTIME_SNAPSHOT');
  });

  it('rejects invalid source product', () => {
    const snapshot = clone(runtimeSnapshot);
    snapshot.relationships[0]!.sourceProduct = { productId: '' };
    expectRuntimeError(() => builder().build(snapshot), 'INVALID_RUNTIME_SNAPSHOT');
  });

  it('rejects invalid target product', () => {
    const snapshot = clone(runtimeSnapshot);
    snapshot.relationships[0]!.targetProduct = { productId: '' };
    expectRuntimeError(() => builder().build(snapshot), 'INVALID_RUNTIME_SNAPSHOT');
  });

  it('rejects exact duplicate relationships', () => {
    const snapshot = clone(runtimeSnapshot) as MutableSnapshot;
    snapshot.relationships = [...snapshot.relationships, clone(snapshot.relationships[0]!)];
    snapshot.relationshipCount = snapshot.relationships.length;
    expectRuntimeError(() => builder().build(snapshot), 'DUPLICATE_RUNTIME_RELATIONSHIP');
  });

  it('accepts the inverse relationship', () => {
    expect(builder().build(runtimeSnapshot).relationshipCount).toBe(3);
  });

  it('does not recalculate support', () => {
    const relationship = {
      ...runtimeRelationshipSet.snapshotRelationshipAtoB,
      evidence: {
        ...runtimeRelationshipSet.snapshotRelationshipAtoB.evidence,
        support: 0.99,
      },
    } as CalculatedProductRelationship;
    const indexed = builder().build(buildRuntimeSnapshot([relationship])).relationshipsBySource.get('A::<base>') ?? [];
    expect(indexed[0]?.evidence).toHaveProperty('support', 0.99);
  });

  it('does not apply reliability minimum', () => {
    const relationship = { ...runtimeRelationshipSet.snapshotRelationshipAtoB, reliability: 0.01 };
    expect(builder().build(buildRuntimeSnapshot([relationship])).relationshipCount).toBe(1);
  });
});

describe('DefaultProductRelationshipRuntimeIndexBuilder combinations and immutability', () => {
  it('indexes base and source combination separately', () => {
    const index = builder().build(runtimeCombinationSnapshot);
    expect(index.relationshipsBySource.has('A::<base>')).toBe(true);
    expect(index.relationshipsBySource.has('A::10')).toBe(true);
  });

  it('keeps target combinations in relationships', () => {
    const relationships = builder().build(runtimeCombinationSnapshot).relationshipsBySource.get('A::<base>') ?? [];
    expect(relationships.some((relationship) => relationship.targetProduct.combinationId === '20')).toBe(true);
  });

  it('freezes indexed arrays', () => {
    const relationships = builder().build(runtimeSnapshot).relationshipsBySource.get('A::<base>');
    expect(Object.isFrozen(relationships)).toBe(true);
  });

  it('freezes indexed relationship objects', () => {
    const relationship = builder().build(runtimeSnapshot).relationshipsBySource.get('A::<base>')?.[0];
    expect(Object.isFrozen(relationship)).toBe(true);
    expect(Object.isFrozen(relationship?.evidence)).toBe(true);
  });

  it('does not expose mutable Map methods on relationshipsBySource', () => {
    const map = builder().build(runtimeSnapshot).relationshipsBySource as unknown as { set?: unknown };
    expect(map.set).toBeUndefined();
  });

  it('clones relationships away from the snapshot', () => {
    const snapshot = clone(runtimeSnapshot);
    const index = builder().build(snapshot);
    expect(index.relationshipsBySource.get('A::<base>')?.[0]).not.toBe(snapshot.relationships[0]);
  });

  it('mutating the snapshot after build does not change the index', () => {
    const snapshot = clone(runtimeSnapshot);
    const index = builder().build(snapshot);
    snapshot.relationships[0]!.targetProduct.productId = 'MUTATED';
    expect(index.relationshipsBySource.get('A::<base>')?.[0]?.targetProduct.productId).toBe('B');
  });

  it('same snapshot generates the same logical index', () => {
    const first = builder().build(runtimeSnapshot);
    const second = builder().build(runtimeSnapshot);
    expect([...second.relationshipsBySource.entries()]).toEqual([...first.relationshipsBySource.entries()]);
  });
});

