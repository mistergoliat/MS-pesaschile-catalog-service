import { describe, expect, it } from 'vitest';
import type { ProductSemanticClassificationResult } from '../../src/domain/product-semantic-classification/index.js';
import {
  DefaultProductSemanticSnapshotBuilder,
  ProductSemanticSnapshotBuildError,
} from '../../src/domain/product-semantic-snapshot/index.js';
import { clone, semanticFixtureResults } from '../fixtures/productSemanticSnapshot.js';

function build(results: readonly ProductSemanticClassificationResult[] = semanticFixtureResults, builtAt = '2026-08-29T12:00:00.000Z') {
  return new DefaultProductSemanticSnapshotBuilder().build({
    results,
    parameters: {
      sourceProductCount: results.length,
      classifierVersion: 'product-semantic-classifier-v1',
      builtAt,
    },
  });
}

describe('DefaultProductSemanticSnapshotBuilder', () => {
  it('builds a full-universe semantic snapshot', () => {
    const result = build();
    expect(result.snapshot.sourceProductCount).toBe(4);
    expect(result.snapshot.recordCount).toBe(4);
    expect(result.snapshot.classificationCounts).toEqual({
      CLASSIFIED: 1,
      PARTIALLY_CLASSIFIED: 1,
      OTHER: 1,
      EXCLUDED_NON_PRODUCT: 1,
      NEEDS_REVIEW: 0,
    });
  });

  it('copies stable ontology and checksum metadata into the snapshot', () => {
    const snapshot = build().snapshot;
    expect(snapshot.ontologyVersion).toBe('commercial-product-ontology-v3');
    expect(snapshot.ontologyHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.semanticChecksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.classifierVersion).toBe('product-semantic-classifier-v1');
  });

  it('same semantic content produces the same snapshotId even when builtAt changes', () => {
    const first = build(semanticFixtureResults, '2026-08-29T12:00:00.000Z').snapshot;
    const second = build(semanticFixtureResults, '2026-08-29T13:00:00.000Z').snapshot;
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.builtAt).not.toBe(first.builtAt);
  });

  it('orders snapshot records deterministically by productId', () => {
    const reversed = [...semanticFixtureResults].reverse();
    const snapshot = build(reversed).snapshot;
    expect(snapshot.records.map((record) => record.productId)).toEqual(['1', '2', '3', '4']);
  });

  it('does not mutate classification inputs while building', () => {
    const input = clone(semanticFixtureResults);
    const before = clone(input);
    build(input);
    expect(input).toEqual(before);
  });

  it('rejects duplicate product ids', () => {
    const duplicate = [...semanticFixtureResults, clone(semanticFixtureResults[0]!)];
    expect(() => build(duplicate)).toThrow(ProductSemanticSnapshotBuildError);
  });

  it('rejects a source count mismatch', () => {
    const builder = new DefaultProductSemanticSnapshotBuilder();
    expect(() => builder.build({
      results: semanticFixtureResults,
      parameters: {
        sourceProductCount: 5,
        classifierVersion: 'product-semantic-classifier-v1',
        builtAt: '2026-08-29T12:00:00.000Z',
      },
    })).toThrow(ProductSemanticSnapshotBuildError);
  });

  it('rejects unknown ontology tags', () => {
    const mutated = [...clone(semanticFixtureResults)];
    mutated[0] = {
      ...mutated[0]!,
      primaryProductFamily: {
        axis: 'PRODUCT_FAMILY',
        code: 'NOT_A_REAL_TAG',
        confidence: 'EXPLICIT',
        ruleId: 'PF_FAKE',
      },
      evidence: [{
        axis: 'PRODUCT_FAMILY',
        code: 'NOT_A_REAL_TAG',
        ruleId: 'PF_FAKE',
        sourceType: 'NAME_TEXT',
        sourceId: 'NAME',
        rawValue: 'fake',
        normalizedValue: 'fake',
      }],
    };
    expect(() => build(mutated)).toThrow(ProductSemanticSnapshotBuildError);
  });
});
