import { beforeAll, describe, expect, it } from 'vitest';
import { classifyTrainingSemanticProducts } from '../../src/domain/training-semantic-classification/index.js';
import { classifyTrainingSemanticProductsV21 } from '../../src/domain/training-semantic-classification-v2-1/index.js';
import { DefaultTrainingSemanticSnapshotBuilder } from '../../src/domain/training-semantic-snapshot/defaultSnapshotBuilder.js';
import { DefaultTrainingSemanticSnapshotV2Builder, calculateTrainingSemanticSnapshotV2Counts,
  recomputeTrainingSemanticSnapshotV2Identity, validateTrainingSemanticV2Source } from '../../src/domain/training-semantic-snapshot/v2SnapshotBuilder.js';
import type { TrainingSemanticSnapshotV2 } from '../../src/domain/training-semantic-snapshot/v2-contracts.js';
import { canonicalizeTrainingSnapshotJson } from '../../src/domain/training-semantic-snapshot/canonicalJson.js';
import { acceptedTrainingV2SnapshotId, compareTrainingV2, replayAcceptedTrainingV2, trainingV2Coverage } from '../../scripts/catalog-v2/audit-training-semantics-v2-authority.js';
import { FileTrainingSemanticSnapshotV2Store } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.js';
import { RuntimeTrainingSemanticV2Reader } from '../../src/domain/catalog/runtime-training-semantic-v2-reader.js';
import type { RuntimeProjectionManager } from '../../src/domain/catalog/runtime-projection.js';

const inputs = [
  { productId: 1, name: 'Maquina Leg Press', productFamily: null, categories: [], features: [] },
  { productId: 2, name: 'Maquina Seated Row', productFamily: null, categories: [], features: [] },
  { productId: 3, name: 'Cable Machine', productFamily: 'CABLE_MACHINE', categories: [], features: [] },
  { productId: 4, name: 'Equipo sin evidencia', productFamily: null, categories: [], features: [] },
] as const;
const source = new DefaultTrainingSemanticSnapshotBuilder().build({ results: classifyTrainingSemanticProducts(inputs), parameters: { sourceProductCount: inputs.length, generatedAt: '1970-01-01T00:00:00.000Z' } });
function build(reverse = false) {
  return new DefaultTrainingSemanticSnapshotV2Builder().buildProjection({ results: classifyTrainingSemanticProductsV21(reverse ? [...inputs].reverse() : inputs),
    parameters: { sourceProductCount: inputs.length, sourceV1Snapshot: source, sourceV1SnapshotId: source.snapshotId,
      activeTrainingRelevantProductIds: [], activeTrainingRelevant: 0, generatedAt: '1970-01-01T00:00:00.000Z' } });
}
function reidentify(snapshot: TrainingSemanticSnapshotV2) {
  snapshot.counts = calculateTrainingSemanticSnapshotV2Counts(snapshot.records, { sourceProductCount: snapshot.records.length,
    sourceV1SnapshotId: source.snapshotId, sourceV1Snapshot: source, activeTrainingRelevant: snapshot.records.filter((record) => record.activeTrainingRelevant).length });
  Object.assign(snapshot, recomputeTrainingSemanticSnapshotV2Identity(snapshot));
  return snapshot;
}

describe('native Training V2 authority gates', () => {
  it('builds deterministic V2 from original inputs and verifies its actual V1 without relaxing the legacy publisher', () => {
    const snapshot = build();
    expect(canonicalizeTrainingSnapshotJson(snapshot)).toBe(canonicalizeTrainingSnapshotJson(build(true)));
    expect(snapshot.sourceV1SnapshotId).toBe(source.snapshotId);
    expect(snapshot.counts.v1AssignmentsPreserved).toBe(source.counts.assignmentCount);
    expect(snapshot.records.find((record) => record.productId === 1)?.exerciseCapabilities.map((assignment) => assignment.capabilityCode)).toEqual(['LEG_PRESS']);
    expect(snapshot.records.find((record) => record.productId === 3)?.trainingFunctions.map((assignment) => assignment.functionCode)).toEqual(['CABLE_RESISTANCE']);
    expect(snapshot.records.find((record) => record.productId === 4)).toMatchObject({ resolved: false, resolutionState: 'ONTOLOGY_GAP' });
    expect(() => validateTrainingSemanticV2Source(snapshot, source)).not.toThrow();
    expect(() => new DefaultTrainingSemanticSnapshotV2Builder().build({ results: classifyTrainingSemanticProductsV21(inputs),
      parameters: { sourceProductCount: inputs.length, sourceV1Snapshot: source, sourceV1SnapshotId: source.snapshotId } })).toThrow('not accepted');
    const wrong = structuredClone(source); wrong.snapshotId = `sha256:${'0'.repeat(64)}`;
    expect(() => validateTrainingSemanticV2Source(snapshot, wrong)).toThrow('snapshot link mismatch');
  });

  it('excludes only container provenance from semantic parity', () => {
    const baseline = build(), candidate = structuredClone(baseline);
    const assignment = candidate.records.find((record) => record.productId === 2)!.exerciseCapabilities[0]!;
    assignment.provenance = { ...assignment.provenance, sourceCatalogExport: 'native-export.csv', sourceProductSemanticSnapshotId: `sha256:${'1'.repeat(64)}` };
    reidentify(candidate);
    const parity = compareTrainingV2(baseline, candidate);
    expect(parity.classification).toBe('EQUIVALENT');
    expect(parity.metrics).toMatchObject({ equivalentRecordMatches: 4, materialDifferences: 0, lineageOnlyDifferences: 1 });
    candidate.generatedAt = '2026-10-05T00:00:00.000Z';
    expect(compareTrainingV2(baseline, candidate).classification).toBe('EQUIVALENT');
  });

  it.each(['evidence', 'confidence', 'review', 'resolution'] as const)('blocks contractual %s drift even when identity is valid', (field) => {
    const baseline = build(), candidate = structuredClone(baseline);
    const record = candidate.records.find((item) => item.productId === 2)!, assignment = record.exerciseCapabilities[0]!;
    if (field === 'evidence') assignment.evidence[0]!.matchedText = 'different';
    if (field === 'confidence') assignment.classificationConfidence = 'LOW';
    if (field === 'review') assignment.reviewState = 'HUMAN_REVIEW';
    if (field === 'resolution') { record.resolutionState = 'DATA_GAP'; record.resolved = false; }
    const parity = compareTrainingV2(baseline, reidentify(candidate));
    expect(parity.classification).toBe('SEMANTIC_DIFFERENCE');
    expect(parity.metrics.materialDifferences).toBe(1);
  });

  it('distinguishes added products from lost legacy coverage', () => {
    const baseline = build(), superset = structuredClone(baseline);
    superset.records.push({ ...structuredClone(superset.records[3]!), productId: 5 });
    reidentify(superset);
    expect(compareTrainingV2(baseline, superset)).toMatchObject({ classification: 'CAT_V2_SUPERSET', populations: { candidateOnly: [5], legacyOnly: [] } });
    expect(compareTrainingV2(superset, baseline)).toMatchObject({ classification: 'LEGACY_SUPERSET', populations: { legacyOnly: [5], candidateOnly: [] } });
    expect(trainingV2Coverage(superset).unknown).toBe(2);
    expect(trainingV2Coverage(superset).excluded).toBeNull();
  });

  it('never substitutes V1 or legacy V2 when the active bundle lacks V2', async () => {
    const reader = new RuntimeTrainingSemanticV2Reader({ forRequest: () => ({ trainingSemantics: source, trainingSemanticsV2: null }), reconcile: async () => undefined } as unknown as RuntimeProjectionManager);
    expect(reader.getMetadata()).toBeNull(); expect(reader.hasProduct(2)).toBe(false);
    expect(() => reader.getProductTrainingSemanticFact(2)).toThrow('RUNTIME_SNAPSHOT_UNAVAILABLE');
    expect(() => reader.getAllProductTrainingSemanticFacts()).toThrow('RUNTIME_SNAPSHOT_UNAVAILABLE');
    expect(await reader.refresh()).toMatchObject({ status: 'cleared', activeSnapshotId: null });
  });
});

describe('accepted Training V2 reproduction', () => {
  let replay: Awaited<ReturnType<typeof replayAcceptedTrainingV2>>;
  beforeAll(async () => { replay = await replayAcceptedTrainingV2(); }, 30000);
  it('reproduces the approved identity, fixed-time bytes and 240-product review cohort', async () => {
    expect(replay.snapshot.snapshotId).toBe(acceptedTrainingV2SnapshotId);
    expect(replay.contentHash).toBe('sha256:57ec370d6f54347d56e952b6b1e934228e3bbadd41a17b5a2fbfd1b5a5f9d414');
    expect(replay.snapshot.counts).toMatchObject({ sourceProducts: 2011, activeTrainingRelevant: 240, resolvedCount: 234, unresolvedCount: 6,
      resolutionRate: 97.5, v1AssignmentsPreserved: 180, exerciseCapabilityAssignmentCount: 275, trainingFunctionAssignmentCount: 282 });
    const accepted = await new FileTrainingSemanticSnapshotV2Store('data/training-semantic-snapshots/v2').getById(acceptedTrainingV2SnapshotId);
    expect(accepted).not.toBeNull();
    expect(compareTrainingV2(accepted!, replay.snapshot)).toMatchObject({ classification: 'EQUIVALENT', metrics: { equivalentRecordMatches: 2011, materialDifferences: 0 } });
    expect(trainingV2Coverage(replay.snapshot)).toMatchObject({ totalRecords: 2011, resolved: 1250, partial: 0, unknown: 761, excluded: null });
  });
});
