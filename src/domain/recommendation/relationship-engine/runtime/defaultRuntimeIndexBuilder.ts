import {
  productRelationshipProductReferenceSchema,
  type CalculatedProductRelationship,
} from '../contracts.js';
import type { ProductRelationshipSnapshot } from '../publication/contracts.js';
import { cloneJsonValue, deepFreeze } from '../publication/canonicalJson.js';
import {
  type ProductRelationshipRuntimeIndex,
  type ProductRelationshipRuntimeIndexBuilder,
  type ProductRuntimeIdentity,
} from './contracts.js';
import { ProductRelationshipRuntimeError } from './errors.js';
import { createProductRuntimeIdentity } from './productIdentity.js';

class ImmutableReadonlyMap<K, V> implements ReadonlyMap<K, V> {
  readonly [Symbol.toStringTag] = 'ImmutableReadonlyMap';

  constructor(private readonly inner: Map<K, V>) {
    Object.freeze(this);
  }

  get size(): number {
    return this.inner.size;
  }

  get(key: K): V | undefined {
    return this.inner.get(key);
  }

  has(key: K): boolean {
    return this.inner.has(key);
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.inner.entries()) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  entries(): IterableIterator<[K, V]> {
    return this.inner.entries();
  }

  keys(): IterableIterator<K> {
    return this.inner.keys();
  }

  values(): IterableIterator<V> {
    return this.inner.values();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}

function relationshipIdentity(relationship: CalculatedProductRelationship): string {
  return [
    createProductRuntimeIdentity(relationship.sourceProduct),
    createProductRuntimeIdentity(relationship.targetProduct),
    relationship.relationshipType,
    relationship.modelVersion,
    relationship.evidenceWindow.from,
    relationship.evidenceWindow.to,
  ].join('|');
}

function assertReadableSnapshot(snapshot: ProductRelationshipSnapshot): void {
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    snapshot.schemaVersion !== '1' ||
    typeof snapshot.snapshotId !== 'string' ||
    typeof snapshot.modelVersion !== 'string' ||
    !Array.isArray(snapshot.relationships) ||
    !Number.isInteger(snapshot.relationshipCount)
  ) {
    throw new ProductRelationshipRuntimeError('INVALID_RUNTIME_SNAPSHOT', 'Snapshot has invalid runtime structure');
  }

  if (snapshot.relationshipCount !== snapshot.relationships.length) {
    throw new ProductRelationshipRuntimeError(
      'INVALID_RUNTIME_SNAPSHOT',
      'snapshot.relationshipCount must equal snapshot.relationships.length',
      { details: { relationshipCount: snapshot.relationshipCount, relationshipsLength: snapshot.relationships.length } },
    );
  }
}

function assertRelationshipReadable(
  snapshot: ProductRelationshipSnapshot,
  relationship: CalculatedProductRelationship,
  index: number,
): void {
  if (relationship.modelVersion !== snapshot.modelVersion) {
    throw new ProductRelationshipRuntimeError(
      'INVALID_RUNTIME_SNAPSHOT',
      'Relationship modelVersion must match snapshot modelVersion',
      { details: { index } },
    );
  }
  if (
    relationship.evidenceWindow.from !== snapshot.evidenceWindow.from ||
    relationship.evidenceWindow.to !== snapshot.evidenceWindow.to
  ) {
    throw new ProductRelationshipRuntimeError(
      'INVALID_RUNTIME_SNAPSHOT',
      'Relationship evidenceWindow must match snapshot evidenceWindow',
      { details: { index } },
    );
  }
  if (!productRelationshipProductReferenceSchema.safeParse(relationship.sourceProduct).success) {
    throw new ProductRelationshipRuntimeError('INVALID_RUNTIME_SNAPSHOT', 'Relationship source product is invalid', {
      details: { index },
    });
  }
  if (!productRelationshipProductReferenceSchema.safeParse(relationship.targetProduct).success) {
    throw new ProductRelationshipRuntimeError('INVALID_RUNTIME_SNAPSHOT', 'Relationship target product is invalid', {
      details: { index },
    });
  }
}

export class DefaultProductRelationshipRuntimeIndexBuilder implements ProductRelationshipRuntimeIndexBuilder {
  build(snapshot: ProductRelationshipSnapshot): ProductRelationshipRuntimeIndex {
    assertReadableSnapshot(snapshot);

    const grouped = new Map<ProductRuntimeIdentity, CalculatedProductRelationship[]>();
    const seenRelationships = new Set<string>();

    for (const [index, relationship] of snapshot.relationships.entries()) {
      assertRelationshipReadable(snapshot, relationship, index);

      const identity = relationshipIdentity(relationship);
      if (seenRelationships.has(identity)) {
        throw new ProductRelationshipRuntimeError(
          'DUPLICATE_RUNTIME_RELATIONSHIP',
          'Duplicate relationship found while building runtime index',
          { details: { index } },
        );
      }
      seenRelationships.add(identity);

      const sourceIdentity = createProductRuntimeIdentity(relationship.sourceProduct);
      const existing = grouped.get(sourceIdentity) ?? [];
      existing.push(cloneJsonValue(relationship));
      grouped.set(sourceIdentity, existing);
    }

    const frozenGrouped = new Map<ProductRuntimeIdentity, readonly CalculatedProductRelationship[]>();
    for (const [sourceIdentity, relationships] of grouped.entries()) {
      frozenGrouped.set(sourceIdentity, deepFreeze(relationships));
    }

    return Object.freeze({
      snapshotId: snapshot.snapshotId,
      schemaVersion: snapshot.schemaVersion,
      modelVersion: snapshot.modelVersion,
      evidenceWindow: deepFreeze(cloneJsonValue(snapshot.evidenceWindow)),
      relationshipCount: snapshot.relationshipCount,
      relationshipsBySource: new ImmutableReadonlyMap(frozenGrouped),
    });
  }
}
