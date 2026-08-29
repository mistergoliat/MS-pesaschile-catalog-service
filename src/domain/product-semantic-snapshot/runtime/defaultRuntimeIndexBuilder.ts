import {
  type CommercialProductOntologyRegistryVersion,
  getOntologyTag,
  isAllowedEvidenceSource,
  isResidualOntologyTag,
} from '../../commercial-product-ontology/index.js';
import { cloneJsonValue, deepFreeze } from '../canonicalJson.js';
import type { ProductSemanticSnapshot, ProductSemanticSnapshotFact } from '../contracts.js';
import { ProductSemanticRuntimeError } from './errors.js';
import type { ProductSemanticRuntimeIndex, ProductSemanticRuntimeIndexBuilder } from './contracts.js';

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

function assertReadableSnapshot(snapshot: ProductSemanticSnapshot): void {
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    snapshot.schemaVersion !== '1' ||
    typeof snapshot.snapshotId !== 'string' ||
    typeof snapshot.classifierVersion !== 'string' ||
    !Array.isArray(snapshot.records) ||
    !Number.isInteger(snapshot.recordCount)
  ) {
    throw new ProductSemanticRuntimeError('INVALID_RUNTIME_SNAPSHOT', 'Snapshot has invalid runtime structure');
  }

  if (snapshot.recordCount !== snapshot.records.length) {
    throw new ProductSemanticRuntimeError(
      'INVALID_RUNTIME_SNAPSHOT',
      'snapshot.recordCount must equal snapshot.records.length',
      { details: { recordCount: snapshot.recordCount, recordsLength: snapshot.records.length } },
    );
  }
  if (snapshot.sourceProductCount !== snapshot.records.length) {
    throw new ProductSemanticRuntimeError(
      'INVALID_RUNTIME_SNAPSHOT',
      'snapshot.sourceProductCount must equal snapshot.records.length for the full-universe semantic snapshot',
      { details: { sourceProductCount: snapshot.sourceProductCount, recordsLength: snapshot.records.length } },
    );
  }
}

function assertFactReadable(snapshot: ProductSemanticSnapshot, fact: ProductSemanticSnapshotFact, index: number): void {
  if (fact.ontologyVersion !== snapshot.ontologyVersion || fact.ontologyHash !== snapshot.ontologyHash) {
    throw new ProductSemanticRuntimeError(
      'INVALID_RUNTIME_SNAPSHOT',
      'Fact ontology metadata must match snapshot ontology metadata',
      { details: { index, productId: fact.productId } },
    );
  }
  const assignedTags = [
    ...(fact.primaryProductFamily ? [fact.primaryProductFamily] : []),
    ...fact.secondaryProductFamilies,
    ...fact.disciplines,
    ...fact.useContexts,
  ];
  const ontologyVersion = fact.ontologyVersion as CommercialProductOntologyRegistryVersion;
  for (const tag of assignedTags) {
    const ontologyTag = getOntologyTag(tag.axis, tag.code, ontologyVersion);
    if (!ontologyTag) {
      throw new ProductSemanticRuntimeError('INVALID_RUNTIME_SNAPSHOT', 'Fact references an unknown ontology tag', {
        details: { index, productId: fact.productId, axis: tag.axis, code: tag.code },
      });
    }
    if (isResidualOntologyTag(tag.axis, tag.code, ontologyVersion)) {
      throw new ProductSemanticRuntimeError('INVALID_RUNTIME_SNAPSHOT', 'Fact must not assign a residual ontology tag', {
        details: { index, productId: fact.productId, axis: tag.axis, code: tag.code },
      });
    }
  }
  for (const evidence of fact.provenance.evidence) {
    const ontologyTag = getOntologyTag(evidence.axis, evidence.code, ontologyVersion);
    if (!ontologyTag) {
      throw new ProductSemanticRuntimeError('INVALID_RUNTIME_SNAPSHOT', 'Evidence references an unknown ontology tag', {
        details: { index, productId: fact.productId, axis: evidence.axis, code: evidence.code },
      });
    }
    if (!isAllowedEvidenceSource(evidence.axis, evidence.code, evidence.sourceType, ontologyVersion)) {
      throw new ProductSemanticRuntimeError('INVALID_RUNTIME_SNAPSHOT', 'Evidence source is not allowed by the ontology registry', {
        details: { index, productId: fact.productId, axis: evidence.axis, code: evidence.code, sourceType: evidence.sourceType },
      });
    }
  }
}

export class DefaultProductSemanticRuntimeIndexBuilder implements ProductSemanticRuntimeIndexBuilder {
  build(snapshot: ProductSemanticSnapshot): ProductSemanticRuntimeIndex {
    assertReadableSnapshot(snapshot);

    const factsByProductId = new Map<string, ProductSemanticSnapshotFact>();
    const facts: ProductSemanticSnapshotFact[] = [];

    for (const [index, fact] of snapshot.records.entries()) {
      assertFactReadable(snapshot, fact, index);
      if (factsByProductId.has(fact.productId)) {
        throw new ProductSemanticRuntimeError(
          'DUPLICATE_RUNTIME_PRODUCT',
          'Duplicate product semantic fact found while building runtime index',
          { details: { index, productId: fact.productId } },
        );
      }
      const copied = deepFreeze(cloneJsonValue(fact));
      factsByProductId.set(fact.productId, copied);
      facts.push(copied);
    }

    return Object.freeze({
      snapshotId: snapshot.snapshotId,
      schemaVersion: snapshot.schemaVersion,
      classifierVersion: snapshot.classifierVersion,
      builtAt: snapshot.builtAt,
      ontologyVersion: snapshot.ontologyVersion,
      ontologyHash: snapshot.ontologyHash,
      semanticChecksum: snapshot.semanticChecksum,
      sourceProductCount: snapshot.sourceProductCount,
      recordCount: snapshot.recordCount,
      classificationCounts: deepFreeze(cloneJsonValue(snapshot.classificationCounts)),
      factsByProductId: new ImmutableReadonlyMap(factsByProductId),
      facts: deepFreeze(facts),
    });
  }
}
