import {
  canonicalizeJson, createProductSemanticSnapshotId, productSemanticSnapshotSchema,
  type ProductSemanticSnapshot, type ProductSemanticSnapshotFact,
} from '../../src/domain/product-semantic-snapshot/index.js';
import { DefaultProductSemanticRuntimeIndexBuilder } from '../../src/domain/product-semantic-snapshot/runtime/index.js';

export function readableSnapshot(value: unknown): ProductSemanticSnapshot {
  const snapshot = productSemanticSnapshotSchema.parse(value);
  if (createProductSemanticSnapshotId(snapshot) !== snapshot.snapshotId) throw new Error('SNAPSHOT_ID_MISMATCH');
  new DefaultProductSemanticRuntimeIndexBuilder().build(snapshot);
  return snapshot;
}

const compareIds = (a: string, b: string) => Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0);
const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
const sorted = (values: readonly unknown[]) => values.map((value) => canonicalizeJson(value)).sort();
const assignmentFields = ['primaryProductFamily', 'secondaryProductFamilies', 'disciplines', 'useContexts'] as const;
const contractFields = ['catalogPresence', 'classificationStatus', 'ontologyVersion', 'ontologyHash', 'needsReviewCandidates'] as const;

function assignments(fact: ProductSemanticSnapshotFact) {
  return assignmentFields.flatMap((field) => {
    const value = fact[field];
    const tags = Array.isArray(value) ? value : value ? [value] : [];
    return tags.map((tag) => ({ field, axis: tag.axis, code: tag.code, confidence: tag.confidence }));
  });
}

function population(records: readonly ProductSemanticSnapshotFact[]) {
  const presence = { current_catalog: 0, historical_order_detail_only: 0 };
  const states = { resolved: 0, unknown: 0, excluded: 0, unavailable: 0 };
  const statuses: Record<string, number> = {};
  const coverage = { anyAssignment: 0, primaryProductFamily: 0, secondaryProductFamilies: 0, disciplines: 0, useContexts: 0 };
  for (const fact of records) {
    presence[fact.catalogPresence]++;
    statuses[fact.classificationStatus] = (statuses[fact.classificationStatus] ?? 0) + 1;
    const tags = assignments(fact);
    if (tags.length) coverage.anyAssignment++;
    for (const field of assignmentFields) if (tags.some((tag) => tag.field === field)) coverage[field]++;
    if (fact.classificationStatus === 'EXCLUDED_NON_PRODUCT') states.excluded++;
    else if (tags.length) states.resolved++;
    else states.unknown++;
  }
  return { recordCount: records.length, productIds: records.map((fact) => fact.productId).sort(compareIds),
    presence, classificationStatuses: statuses, assignmentCoverage: coverage, states };
}

export function compareProductSemantics(legacy: ProductSemanticSnapshot, catV2: ProductSemanticSnapshot) {
  // Validate both effective runtime contracts, including duplicates, registry references and identity.
  readableSnapshot(legacy); readableSnapshot(catV2);
  const left = new Map(legacy.records.map((fact) => [fact.productId, fact]));
  const right = new Map(catV2.records.map((fact) => [fact.productId, fact]));
  const both = [...left.keys()].filter((id) => right.has(id)).sort(compareIds);
  const legacyOnly = [...left.keys()].filter((id) => !right.has(id)).sort(compareIds);
  const catV2Only = [...right.keys()].filter((id) => !left.has(id)).sort(compareIds);
  const metrics = { exactRecordMatches: 0, exactSemanticMatches: 0, equivalentSemanticMatches: 0,
    catV2Superset: 0, legacySuperset: 0, conflictingAssignments: 0, semanticDifferences: 0,
    catV2ExtraAssignments: 0, legacyExtraAssignments: 0, presenceDeltas: 0, statusDeltas: 0,
    resolvedToUnknown: 0, unknownToResolved: 0, evidenceDeltas: 0 };
  const recordClassifications = { EQUIVALENT: 0, CAT_V2_SUPERSET: 0, LEGACY_SUPERSET: 0,
    REPRESENTATIONAL_ONLY: 0, SEMANTIC_DIFFERENCE: 0, UNKNOWN: 0 };
  const differences = [];
  for (const productId of both) {
    const a = left.get(productId)!, b = right.get(productId)!;
    const at = assignments(a), bt = assignments(b);
    const ak = sorted(at), bk = sorted(bt);
    const legacyExtra = at.filter((tag) => !bk.includes(canonicalizeJson(tag)));
    const catV2Extra = bt.filter((tag) => !ak.includes(canonicalizeJson(tag)));
    const exactSemantic = assignmentFields.every((field) => same(a[field], b[field]));
    const equivalentSemantic = same(ak, bk);
    const changedFields = contractFields.filter((field) => !same(a[field], b[field]));
    const evidenceChanged = !same(a.provenance, b.provenance);
    const conflict = (a.primaryProductFamily !== null && b.primaryProductFamily !== null
      && a.primaryProductFamily.code !== b.primaryProductFamily.code)
      || at.some((tag) => bt.some((other) => tag.field === other.field && tag.code === other.code && tag.confidence !== other.confidence))
      || (legacyExtra.length > 0 && catV2Extra.length > 0);
    const classification = conflict ? 'SEMANTIC_DIFFERENCE'
      : legacyExtra.length ? 'LEGACY_SUPERSET' : catV2Extra.length ? 'CAT_V2_SUPERSET'
      : changedFields.length || !same(a.provenance.exclusion, b.provenance.exclusion) ? 'SEMANTIC_DIFFERENCE'
      : same(a, b) ? 'EQUIVALENT'
      : evidenceChanged && !same(sorted(a.provenance.evidence), sorted(b.provenance.evidence)) ? 'UNKNOWN'
      : 'REPRESENTATIONAL_ONLY';
    recordClassifications[classification]++;
    if (same(a, b)) metrics.exactRecordMatches++;
    if (exactSemantic) metrics.exactSemanticMatches++;
    if (equivalentSemantic) metrics.equivalentSemanticMatches++;
    if (classification === 'CAT_V2_SUPERSET') metrics.catV2Superset++;
    if (classification === 'LEGACY_SUPERSET') metrics.legacySuperset++;
    if (classification === 'SEMANTIC_DIFFERENCE') metrics.semanticDifferences++;
    if (conflict) metrics.conflictingAssignments++;
    metrics.catV2ExtraAssignments += catV2Extra.length;
    metrics.legacyExtraAssignments += legacyExtra.length;
    if (a.catalogPresence !== b.catalogPresence) metrics.presenceDeltas++;
    if (a.classificationStatus !== b.classificationStatus) metrics.statusDeltas++;
    if (at.length && !bt.length) metrics.resolvedToUnknown++;
    if (!at.length && bt.length) metrics.unknownToResolved++;
    if (evidenceChanged) metrics.evidenceDeltas++;
    if (!same(a, b)) differences.push({ productId, productKey: `P${productId}`, classification,
      analysis: 'REVIEW_REQUIRED', changedFields, legacyExtraAssignments: legacyExtra, catV2ExtraAssignments: catV2Extra,
      impact: classification === 'REPRESENTATIONAL_ONLY' ? 'Ordering/rule representation changed; public assignments equivalent.'
        : 'Inspect individual facts/provenance, batch status/scope and discovery filtering before accepting retirement.',
      legacyValue: a, catV2Value: b, legacyEvidence: a.provenance.evidence, catV2Evidence: b.provenance.evidence });
  }
  const lineage = (snapshot: ProductSemanticSnapshot) => {
    const { records: _records, ...metadata } = snapshot;
    return metadata;
  };
  return {
    lineage: { legacy: lineage(legacy), catV2: lineage(catV2) },
    coverage: {
      legacy: population(legacy.records), catV2: population(catV2.records),
      both: { legacy: population(both.map((id) => left.get(id)!)), catV2: population(both.map((id) => right.get(id)!)) },
      legacyOnly: population(legacyOnly.map((id) => left.get(id)!)), catV2Only: population(catV2Only.map((id) => right.get(id)!)),
    },
    metrics, recordClassifications, differences,
    legacyOnlyFacts: legacyOnly.map((id) => left.get(id)!), catV2OnlyFacts: catV2Only.map((id) => right.get(id)!),
  };
}
