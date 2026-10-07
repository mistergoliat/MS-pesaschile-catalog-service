import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyTrainingSemanticProducts } from '../../src/domain/training-semantic-classification/index.js';
import { classifyTrainingSemanticProductsV21 } from '../../src/domain/training-semantic-classification-v2-1/index.js';
import { DefaultTrainingSemanticSnapshotBuilder } from '../../src/domain/training-semantic-snapshot/defaultSnapshotBuilder.js';
import { DefaultTrainingSemanticSnapshotV2Builder } from '../../src/domain/training-semantic-snapshot/v2SnapshotBuilder.js';
import { reconcileTrainingResolution, trainingSourceEvidenceId } from '../../src/domain/training-semantic-snapshot/reconcileResolution.js';
import { validateTrainingSemanticInvariants } from '../../src/domain/training-semantic-snapshot/semanticInvariants.js';
import { trainingResolutionPolicy } from '../../src/domain/training-semantic-snapshot/resolutionPolicy.js';
import { FileTrainingSemanticSnapshotV2Store } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.js';
import { InMemoryTrainingSemanticSnapshotV2Store } from '../../src/domain/training-semantic-snapshot/v2Runtime.js';
import { semanticObligationContractV2, evaluateProductDimensions, type AdmissionContextV2 } from '../../src/domain/catalog-admission/index.js';
import type { TrainingSemanticSnapshotV2Record } from '../../src/domain/training-semantic-snapshot/v2-contracts.js';
import type { TrainingSemanticClassificationInput } from '../../src/domain/training-semantic-classification/index.js';
import { isResolved, resolutionState } from '../../scripts/training-semantic-classification-v2/classify-catalog.js';
import { classifyTrainingSemanticProductV2 } from '../../src/domain/training-semantic-classification-v2/index.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/catalog-admission/contexts.json', import.meta.url), 'utf8')).fixtures as Record<string, AdmissionContextV2>;
const empty = (state: TrainingSemanticSnapshotV2Record['resolutionState'] = 'VERIFIED_NO_APPLICABLE_CAPABILITY'): TrainingSemanticSnapshotV2Record => ({
  productId: 999001, exerciseCapabilities: [], trainingFunctions: [], coverageStatus: 'UNMODELED', resolutionState: state,
  resolved: state === 'VERIFIED_NO_APPLICABLE_CAPABILITY', warnings: [],
});
function historicalRecord(input: TrainingSemanticClassificationInput) {
  const v1 = new DefaultTrainingSemanticSnapshotBuilder().build({ results: classifyTrainingSemanticProducts([input]), parameters: { sourceProductCount: 1 } });
  return new DefaultTrainingSemanticSnapshotV2Builder().replayHistorical({ results: classifyTrainingSemanticProductsV21([input]), parameters: {
    sourceProductCount: 1, sourceV1SnapshotId: v1.snapshotId, sourceV1Snapshot: v1,
    resolutionStates: new Map([[input.productId, 'VERIFIED_NO_APPLICABLE_CAPABILITY']]),
  } }, false).records[0]!;
}
function sourceFor(context: AdmissionContextV2): TrainingSemanticClassificationInput {
  const c = context.canonical!;
  return { productId: c.productId, name: c.name, productFamily: context.productSemantics?.primaryProductFamily?.code,
    categories: (c.categoryIds ?? []).map(c => ({ categoryId: String(c.categoryId), name: c.name ?? '', trustClass: context.trust!.categories.find(t => t.categoryId === c.categoryId)!.trustClass as 'SEMANTIC_STRONG' })),
    features: (c.features ?? []).map(f => ({ featureId: String(f.featureId), featureName: f.name, value: f.value ?? '', trustClass: context.trust!.features.find(t => t.featureId === f.featureId)!.trustClass as 'SEMANTIC' })),
  };
}

const inputs = [{ productId: 999001, name: 'Cable Machine', productFamily: 'CABLE_MACHINE', categories: [], features: [] }];
const source = new DefaultTrainingSemanticSnapshotBuilder().build({ results: classifyTrainingSemanticProducts(inputs), parameters: { sourceProductCount: 1 } });
const historicalInput = { results: classifyTrainingSemanticProductsV21(inputs), parameters: {
  sourceProductCount: 1, sourceV1SnapshotId: source.snapshotId, sourceV1Snapshot: source,
  resolutionStates: new Map([[999001, 'VERIFIED_NO_APPLICABLE_CAPABILITY' as const]]),
} };

describe('P2.3C historical resolution precedence', () => {
  it('rejects a stale negative override after the classifier assigns a valid function', () => {
    expect(historicalInput.results[0]!.trainingFunctions[0]!.functionCode).toBe('CABLE_RESISTANCE');
    expect(() => new DefaultTrainingSemanticSnapshotV2Builder().buildProjection(historicalInput)).toThrow('TRAINING_NEGATIVE_WITH_ASSIGNMENTS');
  });
  it('reproduces the old contradiction using the explicit read-only historical builder', () => {
    const baseline = { productId: 999001, currentCoverageStatus: 'NO_CAPABILITY_APPLICABLE', resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY',
      candidateCapabilities: [], missingCapabilities: [], gapType: '', name: inputs[0]!.name, productFamily: 'CABLE_MACHINE', active: true };
    const result = classifyTrainingSemanticProductV2(inputs[0]!);
    expect(result.trainingFunctions.length).toBeGreaterThan(0);
    const resolved = isResolved(baseline, result, []);
    expect(resolved).toBe(true);
    expect(resolutionState(baseline, resolved)).toBe('VERIFIED_NO_APPLICABLE_CAPABILITY');
    const record = new DefaultTrainingSemanticSnapshotV2Builder().replayHistorical(historicalInput, false).records[0]!;
    expect(record).toMatchObject({ resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY', resolved: true });
    expect(record.trainingFunctions).toHaveLength(1);
  });
  it('rejects historical contradictions in both stores before writes', async () => {
    const snapshot = new DefaultTrainingSemanticSnapshotV2Builder().replayHistorical(historicalInput, false);
    await expect(new InMemoryTrainingSemanticSnapshotV2Store().save(snapshot)).rejects.toThrow('TRAINING_NEGATIVE_WITH_ASSIGNMENTS');
    await expect(new FileTrainingSemanticSnapshotV2Store('cross-projection-audit/p2-3c/never-written').save(snapshot)).rejects.toThrow('TRAINING_NEGATIVE_WITH_ASSIGNMENTS');
  });
});

describe('P2.3C final source reconciliation', () => {
  it.each([
    ['exercise', { productId: 999001, name: 'Maquina Leg Press', categories: [], features: [] }],
    ['function', inputs[0]!],
    ['both', { productId: 999001, name: 'Maquina Lat Pulldown', productFamily: 'CABLE_MACHINE', categories: [], features: [] }],
  ] as const)('reconciles negative + %s using source replay', (_dimension, input) => {
    const before = historicalRecord(input), result = reconcileTrainingResolution(before, input);
    expect(result.record.resolutionState).not.toBe('VERIFIED_NO_APPLICABLE_CAPABILITY');
    expect(result.record.resolutionState).toBe('SEMANTIC_COMPLETE');
    expect(() => validateTrainingSemanticInvariants({ records: [result.record] }, new Set([trainingSourceEvidenceId(input)]))).not.toThrow();
  });
  it('does not infer completeness from assignments without reconstructable sources', () => {
    const result = reconcileTrainingResolution(historicalRecord(inputs[0]!), undefined);
    expect(result.record).toMatchObject({ resolutionState: 'DATA_GAP', resolved: false });
    expect(result.record.resolutionEvidence).toBeUndefined();
  });
  it('does not accept an assignment whose evidence cannot be reproduced', () => {
    const before = historicalRecord(inputs[0]!);
    before.trainingFunctions[0]!.evidence[0]!.matchedText = 'fabricated';
    expect(reconcileTrainingResolution(before, inputs[0]!).record.resolutionState).toBe('DATA_GAP');
  });
  it('preserves uncertainty from review and deferred concepts rather than blanket COMPLETE', () => {
    const before = historicalRecord(inputs[0]!);
    expect(reconcileTrainingResolution(before, { ...inputs[0]!, name: 'Cable Machine remo' }).record.resolutionState).toBe('AMBIGUOUS');
    expect(reconcileTrainingResolution(before, { ...inputs[0]!, name: 'Cable Machine squat' }).record.resolutionState).toBe('SEMANTIC_COMPLETE');
  });
  it('does not mark a partial set complete when source rules prove another assignment', () => {
    expect(reconcileTrainingResolution(historicalRecord(inputs[0]!), { ...inputs[0]!, name: 'Cable Machine Lat Pulldown' }).record.resolutionState).toBe('RULE_GAP');
  });
  it('preserves a valid empty negative and documents a real negative rule', () => {
    const input = { productId: 999001, name: 'Mancuerna', productFamily: 'DUMBBELL', categories: [], features: [] };
    const result = reconcileTrainingResolution(empty(), input);
    expect(result.record.resolutionState).toBe('VERIFIED_NO_APPLICABLE_CAPABILITY');
    expect(result.negativeEvidenceState).toBe('NEGATIVE_EVIDENCE_PRESENT');
    expect(result.record.resolutionEvidence?.[0]).toMatchObject({ kind: 'CLASSIFIER_NEGATIVE_RULE', sourceId: trainingSourceEvidenceId(input) });
  });
  it('preserves evidence absence rather than upgrading a historical generic reason', () => {
    const input = { productId: 999001, name: 'Equipo sin evidencia', categories: [], features: [] };
    const result = reconcileTrainingResolution(empty(), input);
    expect(result.record.resolutionState).toBe('VERIFIED_NO_APPLICABLE_CAPABILITY');
    expect(result.negativeEvidenceState).toBe('NEGATIVE_EVIDENCE_ABSENT');
    expect(result.record.resolutionEvidence).toBeUndefined();
    expect(reconcileTrainingResolution(empty(), undefined).negativeEvidenceState).toBe('NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE');
  });
  it('derives a missing required cable function only from verified family source and registry authority', () => {
    const context = structuredClone(fixtures.combinedEvidence!);
    const source = { ...sourceFor(context), productFamily: null };
    const before = { ...empty(), productId: source.productId };
    const result = reconcileTrainingResolution(before, source, context);
    expect(result.gaps).toContainEqual(expect.objectContaining({ code: 'CABLE_RESISTANCE', classification: 'SAFE_DERIVABLE' }));
    expect(result.record.trainingFunctions).toContainEqual(expect.objectContaining({ functionCode: 'CABLE_RESISTANCE' }));
    expect(result.record.exerciseCapabilities).toEqual([]);
  });
  it.each(['missing-source', 'unverified-lineage', 'unbound-feature', 'different-source-name'] as const)('never fabricates a required assignment with %s', mode => {
    const context = structuredClone(fixtures.combinedEvidence!);
    const source = { ...sourceFor(context), productFamily: null };
    if (mode === 'unverified-lineage') context.lineage!.productVerified = false;
    if (mode === 'unbound-feature') context.canonical!.features = [];
    if (mode === 'different-source-name') source.name = 'Unrelated machine';
    const result = reconcileTrainingResolution({ ...empty(), productId: source.productId }, mode === 'missing-source' ? undefined : source, context);
    expect(result.record.trainingFunctions).toEqual([]);
    expect(result.gaps.some(g => g.classification === 'SAFE_DERIVABLE')).toBe(false);
  });
  it.each(semanticObligationContractV2.families.map(f => f.productFamily))('preserves P_NEW family applicability for %s', family => {
    const context: AdmissionContextV2 = { canonical: { productId: 999001, name: 'P_NEW', catalogPresence: 'current_catalog', active: true, categoryIds: [], features: [] }, declaredProductFamily: family };
    const input = { productId: 999001, name: 'P_NEW', categories: [], features: [] };
    const before = empty('ONTOLOGY_GAP');
    const result = reconcileTrainingResolution(before, input, context);
    expect(result.record).toEqual(before);
    expect(evaluateProductDimensions(context, semanticObligationContractV2).map(d => [d.dimension, d.effectiveRequirement])).toEqual(evaluateProductDimensions({ ...context, training: result.record }, semanticObligationContractV2).map(d => [d.dimension, d.effectiveRequirement]));
  });
  it('is deterministic including evidence ordering and policy identity', () => {
    const input = inputs[0]!, before = historicalRecord(input);
    expect(reconcileTrainingResolution(before, input)).toEqual(reconcileTrainingResolution(before, structuredClone(input)));
    expect(trainingResolutionPolicy.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(trainingResolutionPolicy.previousPolicy).toBe('accepted-a00.6.7');
  });
});

describe('P2.3C publication invariants', () => {
  it.each(['unknown-code', 'invalid-relation', 'anatomy', 'resolved-state', 'duplicate-id', 'evidence-reference', 'family-mapping'] as const)('rejects %s independently of parity', corruption => {
    const record = historicalRecord(inputs[0]!);
    record.resolutionState = 'SEMANTIC_COMPLETE';
    const records = [record];
    if (corruption === 'unknown-code') Object.assign(record.trainingFunctions[0]!, { functionCode: 'UNKNOWN' });
    if (corruption === 'invalid-relation') Object.assign(record.trainingFunctions[0]!, { relationType: 'SUPPORTED' });
    if (corruption === 'anatomy') Object.assign(record.trainingFunctions[0]!, { muscleGroups: ['BACK'] });
    if (corruption === 'resolved-state') record.resolved = false;
    if (corruption === 'duplicate-id') records.push(record);
    if (corruption === 'evidence-reference') record.resolutionEvidence = [{ kind: 'TRAINING_RECONCILIATION', sourceId: 'missing' }];
    if (corruption === 'family-mapping') Object.assign(record.trainingFunctions[0]!, { productFamily: 'WEIGHT_PLATE', relationType: 'FAMILY_DERIVED' });
    expect(() => validateTrainingSemanticInvariants({ records }, new Set())).toThrow();
  });
  it('allows a coherent empty negative with absent evidence', () => {
    expect(() => validateTrainingSemanticInvariants({ records: [empty()] })).not.toThrow();
  });
});
