import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTrainingSemanticProductsV21 } from '../../src/domain/training-semantic-classification-v2-1/index.js';
import { DefaultTrainingSemanticSnapshotV2Builder, ACTIVE_TRAINING_RELEVANT_BASELINE, ACCEPTED_RESOLUTION_STATE_COUNTS,
  RESOLVED_TRAINING_RELEVANT_BASELINE, trainingSemanticResolutionStates,
  type TrainingSemanticResolutionState, type TrainingSemanticSnapshot } from '../../src/domain/training-semantic-snapshot/index.js';
import { reconcileTrainingResolution, trainingSourceEvidenceId, trainingResolutionPolicy, validateTrainingSemanticInvariants,
  calculateTrainingSemanticSnapshotV2Counts, recomputeTrainingSemanticSnapshotV2Identity, validateTrainingSemanticSnapshotV2,
  type TrainingSemanticSnapshotV2 } from '../../src/domain/training-semantic-snapshot/index.js';
import type { TrainingSemanticClassificationInput } from '../../src/domain/training-semantic-classification/index.js';
import type { AdmissionContextV2 } from '../../src/domain/catalog-admission/index.js';
import { contentHash } from '../../src/domain/catalog/projection-input/canonical.js';
import type { TrainingSemanticsV2Projection } from '../../src/domain/catalog/training-semantics-v2-projection.js';
import { loadTrainingSemanticClassificationInputs } from '../training-semantic-classification/lib/load-input.js';
import { parseCsvRecords } from '../product-semantic-classification/lib/csv.js';

export const resolutionPolicyFile = 'docs/audits/training-semantics/a00.6.7/post-closure-resolution-active.csv';

export function reconcileTrainingSnapshot(input: { baseline: TrainingSemanticSnapshotV2; sourceV1: TrainingSemanticSnapshot;
  sources: readonly TrainingSemanticClassificationInput[]; contexts?: ReadonlyMap<number, AdmissionContextV2> }) {
  const sources = new Map(input.sources.map(source => [source.productId, { ...source,
    ...(input.contexts?.get(source.productId)?.productSemantics ? { productFamilyEvidence: input.contexts.get(source.productId)!.productSemantics!.provenance.evidence } : {}) }]));
  const evaluations = input.baseline.records.map(record => ({ productId: record.productId, ...reconcileTrainingResolution(record, sources.get(record.productId), input.contexts?.get(record.productId), true) }));
  const snapshot = { ...structuredClone(input.baseline), records: evaluations.map(e => e.record) };
  snapshot.rulesHash = trainingResolutionPolicy.classifierRulesHash;
  snapshot.classifierV2RulesHash = trainingResolutionPolicy.classifierRulesHash;
  snapshot.counts = calculateTrainingSemanticSnapshotV2Counts(snapshot.records, { sourceProductCount: snapshot.records.length,
    sourceV1SnapshotId: input.sourceV1.snapshotId, sourceV1Snapshot: input.sourceV1, activeTrainingRelevant: input.baseline.counts.activeTrainingRelevant });
  Object.assign(snapshot, recomputeTrainingSemanticSnapshotV2Identity(snapshot));
  validateTrainingSemanticSnapshotV2(snapshot);
  validateTrainingSemanticInvariants(snapshot, new Set([...sources.values()].map(trainingSourceEvidenceId)), sources);
  return { snapshot, evaluations };
}

/** Shared immutable policy used by the approved legacy publisher and the native projection. */
export async function readAcceptedTrainingResolutionPolicy() {
  const raw = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', resolutionPolicyFile), 'utf8');
  const rows = parseCsvRecords(raw);
  const states = new Map<number, TrainingSemanticResolutionState>();
  for (const row of rows) {
    const id = Number(row.productId);
    if (!Number.isSafeInteger(id) || id <= 0 || states.has(id)
      || !trainingSemanticResolutionStates.includes(row.resolutionState as TrainingSemanticResolutionState)) throw new Error('INVALID_ACCEPTED_TRAINING_RESOLUTION_POLICY');
    states.set(id, row.resolutionState as TrainingSemanticResolutionState);
  }
  const counts = Object.fromEntries(Object.keys(ACCEPTED_RESOLUTION_STATE_COUNTS).map((state) => [state, [...states.values()].filter((value) => value === state).length]));
  if (states.size !== ACTIVE_TRAINING_RELEVANT_BASELINE || JSON.stringify(counts) !== JSON.stringify(ACCEPTED_RESOLUTION_STATE_COUNTS)) throw new Error('ACCEPTED_TRAINING_RESOLUTION_POLICY_DRIFT');
  return { states, productIds: [...states.keys()], hash: contentHash(raw) };
}

export async function buildTrainingSemanticsV2Projection(input: {
  sourceDir: string; sourceExtractionId: string; codeRef: string; sourceV1: TrainingSemanticSnapshot;
  contexts?: ReadonlyMap<number, AdmissionContextV2>;
}): Promise<TrainingSemanticsV2Projection> {
  const paths = { catalogCsvPath: path.join(input.sourceDir, 'product_catalog_exploration.csv'),
    categoryTrustMapCsvPath: path.join(input.sourceDir, 'category_trust_map.csv'), featureTrustMapCsvPath: path.join(input.sourceDir, 'feature_trust_map.csv') };
  const [loaded, policy, rawInputs] = await Promise.all([loadTrainingSemanticClassificationInputs(paths), readAcceptedTrainingResolutionPolicy(),
    Promise.all(Object.values(paths).map((file) => readFile(file, 'utf8')))]);
  if (loaded.warnings.length) throw new Error(`TRAINING_V2_INPUT_WARNINGS: ${loaded.warnings.join('; ')}`);
  const results = classifyTrainingSemanticProductsV21(loaded.inputs, { sourceCatalogExport: 'product_catalog_exploration.csv' });
  const ids = new Set(loaded.inputs.map((item) => item.productId));
  // Curated cohort membership is historical review metadata, never live Commercial Truth.
  const cohort = policy.productIds.filter((id) => ids.has(id));
  const completeCohort = cohort.length === policy.productIds.length;
  const baseline = new DefaultTrainingSemanticSnapshotV2Builder().replayHistorical({ results, parameters: {
    sourceProductCount: results.length, sourceV1SnapshotId: input.sourceV1.snapshotId, sourceV1Snapshot: input.sourceV1,
    resolutionStates: policy.states, activeTrainingRelevantProductIds: cohort, activeTrainingRelevant: cohort.length,
    ...(completeCohort ? { acceptedResolvedCount: RESOLVED_TRAINING_RELEVANT_BASELINE, acceptedResolutionStates: ACCEPTED_RESOLUTION_STATE_COUNTS } : {}),
    generatedAt: '1970-01-01T00:00:00.000Z',
  } }, false);
  const { snapshot } = reconcileTrainingSnapshot({ baseline, sourceV1: input.sourceV1, sources: loaded.inputs, contexts: input.contexts });
  return { schemaVersion: '2', sourceExtractionId: input.sourceExtractionId, codeRef: input.codeRef,
    inputs: { catalog: contentHash(rawInputs[0]!), categoryTrustMap: contentHash(rawInputs[1]!), featureTrustMap: contentHash(rawInputs[2]!),
      resolutionPolicy: { file: 'src/domain/training-semantic-snapshot/resolutionPolicy.ts', hash: trainingResolutionPolicy.contentHash,
        version: trainingResolutionPolicy.version, builderVersion: trainingResolutionPolicy.builderVersion,
        previousPolicy: { file: resolutionPolicyFile, hash: policy.hash }, cohort: 'accepted-a00.6.7' } }, snapshot };
}
