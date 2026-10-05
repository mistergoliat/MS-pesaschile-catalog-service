import { describe, expect, it } from 'vitest';
import { compareProductSemantics, readableSnapshot } from '../../scripts/catalog-v2/product-semantics-parity.js';
import { canonicalizeJson, createProductSemanticSnapshotId, type ProductSemanticSnapshot } from '../../src/domain/product-semantic-snapshot/index.js';
import { buildRuntimeSemanticSnapshot, clone, semanticFixtureResults } from '../fixtures/productSemanticSnapshot.js';

function change(snapshot: ProductSemanticSnapshot, mutate: (copy: ProductSemanticSnapshot) => void) {
  const copy = clone(snapshot);
  mutate(copy);
  return { ...copy, snapshotId: createProductSemanticSnapshotId(copy) };
}

describe('Product Semantics retirement evidence', () => {
  it('separates populations by identity and emits deterministic IDs rather than relying on counts', () => {
    const legacy = buildRuntimeSemanticSnapshot(semanticFixtureResults.slice(0, 3));
    const catV2 = buildRuntimeSemanticSnapshot(semanticFixtureResults.slice(1));
    const report = compareProductSemantics(legacy, catV2);
    expect(report.coverage.both.legacy.productIds).toEqual(['2', '3']);
    expect(report.coverage.legacyOnly.productIds).toEqual(['1']);
    expect(report.coverage.catV2Only.productIds).toEqual(['4']);
    expect(report.metrics.equivalentSemanticMatches).toBe(2);
    expect(report.coverage.both.legacy.states).toEqual({ resolved: 1, unknown: 1, excluded: 0, unavailable: 0 });
    expect(report.coverage.legacyOnly.presence.current_catalog).toBe(1);
    expect(report.coverage.both.legacy.presence.historical_order_detail_only).toBe(1);
    expect(canonicalizeJson(report)).toBe(canonicalizeJson(compareProductSemantics(legacy, catV2)));
  });

  it('ignores legitimate build timestamps without ignoring statuses or scope', () => {
    const legacy = buildRuntimeSemanticSnapshot();
    const catV2 = { ...legacy, builtAt: '2026-10-05T00:00:00.000Z' };
    expect(compareProductSemantics(legacy, catV2).recordClassifications.EQUIVALENT).toBe(4);
    const scoped = change(catV2, (copy) => { copy.records[0]!.catalogPresence = 'historical_order_detail_only'; });
    const report = compareProductSemantics(legacy, scoped);
    expect(report.metrics).toMatchObject({ equivalentSemanticMatches: 4, presenceDeltas: 1, semanticDifferences: 1 });
    expect(report.differences[0]!.classification).toBe('SEMANTIC_DIFFERENCE');
  });

  it('reports legacy knowledge lost even when every legacy ID remains present', () => {
    const legacy = buildRuntimeSemanticSnapshot();
    const catV2 = change(legacy, (copy) => { copy.records[0]!.primaryProductFamily = null; copy.records[0]!.provenance.evidence = []; });
    const report = compareProductSemantics(legacy, catV2);
    expect(report.coverage.legacyOnly.recordCount).toBe(0);
    expect(report.metrics).toMatchObject({ legacySuperset: 1, legacyExtraAssignments: 1, resolvedToUnknown: 1, conflictingAssignments: 0 });
    expect(report.differences[0]).toMatchObject({ productKey: 'P1', classification: 'LEGACY_SUPERSET', legacyEvidence: legacy.records[0]!.provenance.evidence });
    const reverse = compareProductSemantics(catV2, legacy);
    expect(reverse.metrics).toMatchObject({ catV2Superset: 1, catV2ExtraAssignments: 1, unknownToResolved: 1 });
  });

  it('does not call changed confidence equivalent', () => {
    const legacy = buildRuntimeSemanticSnapshot();
    const catV2 = change(legacy, (copy) => { copy.records[0]!.primaryProductFamily!.confidence = 'STRONGLY_INFERRED'; });
    const report = compareProductSemantics(legacy, catV2);
    expect(report.metrics).toMatchObject({ conflictingAssignments: 1, equivalentSemanticMatches: 3 });
    expect(report.differences[0]!.classification).toBe('SEMANTIC_DIFFERENCE');
  });

  it('reports a status change despite equivalent assignments', () => {
    const legacy = buildRuntimeSemanticSnapshot();
    const catV2 = change(legacy, (copy) => { copy.records[0]!.classificationStatus = 'PARTIALLY_CLASSIFIED'; });
    const report = compareProductSemantics(legacy, catV2);
    expect(report.metrics).toMatchObject({ equivalentSemanticMatches: 4, statusDeltas: 1, semanticDifferences: 1 });
  });

  it('keeps changed evidence unresolved while recognizing equivalent tag assignments', () => {
    const legacy = buildRuntimeSemanticSnapshot();
    const catV2 = change(legacy, (copy) => { copy.records[0]!.provenance.evidence[0]!.rawValue = 'Updated source name'; });
    const report = compareProductSemantics(legacy, catV2);
    expect(report.metrics).toMatchObject({ equivalentSemanticMatches: 4, evidenceDeltas: 1 });
    expect(report.recordClassifications.UNKNOWN).toBe(1);
  });

  it('rejects corrupt identities and duplicate records before measuring coverage', () => {
    const snapshot = buildRuntimeSemanticSnapshot();
    expect(() => readableSnapshot({ ...snapshot, snapshotId: `sha256:${'0'.repeat(64)}` })).toThrow('SNAPSHOT_ID_MISMATCH');
    const duplicate = change(snapshot, (copy) => { copy.records[1]!.productId = copy.records[0]!.productId; });
    expect(() => compareProductSemantics(snapshot, duplicate)).toThrow('Duplicate product semantic fact');
  });
});
