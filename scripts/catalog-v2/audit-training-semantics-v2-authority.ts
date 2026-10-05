import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActivationService } from '../../src/domain/catalog/projection-activation.js';
import { FileProjectionActivationStore } from '../../src/infra/catalog/file-projection-activation-store.js';
import { trainingSemanticsV2ProjectionSchema } from '../../src/domain/catalog/training-semantics-v2-projection.js';
import { contentHash } from '../../src/domain/catalog/projection-input/canonical.js';
import { canonicalizeTrainingSnapshotJson, validateTrainingSemanticSnapshotV2, DefaultTrainingSemanticSnapshotV2Builder,
  TRAINING_SEMANTIC_V1_SNAPSHOT_ID, ACTIVE_TRAINING_RELEVANT_BASELINE, RESOLVED_TRAINING_RELEVANT_BASELINE,
  ACCEPTED_RESOLUTION_STATE_COUNTS, type TrainingSemanticSnapshotV2, type TrainingSemanticSnapshotV2Record } from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotStore } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotStore.js';
import { FileTrainingSemanticSnapshotV2Store } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.js';
import { classifyTrainingSemanticProductsV21 } from '../../src/domain/training-semantic-classification-v2-1/index.js';
import { loadTrainingSemanticClassificationInputs } from '../training-semantic-classification/lib/load-input.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { readAcceptedTrainingResolutionPolicy } from './build-training-semantics-v2.js';

export const acceptedTrainingV2SnapshotId = 'sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1';
const same = (a: unknown, b: unknown) => canonicalizeTrainingSnapshotJson(a) === canonicalizeTrainingSnapshotJson(b);

function semanticRecord(record: TrainingSemanticSnapshotV2Record) {
  // Preserve confidence, relation, review, evidence and coverage; only source-container lineage is removed.
  const assignment = <T extends { provenance?: { sourceCatalogExport?: string; sourceProductSemanticSnapshotId?: string } }>(value: T) => {
    if (!value.provenance) return value;
    const { sourceCatalogExport: _export, sourceProductSemanticSnapshotId: _product, ...provenance } = value.provenance;
    return { ...value, provenance };
  };
  return { ...record, exerciseCapabilities: record.exerciseCapabilities.map(assignment), trainingFunctions: record.trainingFunctions.map(assignment) };
}

export function trainingV2Coverage(snapshot: TrainingSemanticSnapshotV2) {
  const resolutionStates: Record<string, number> = {};
  for (const record of snapshot.records) resolutionStates[record.resolutionState!] = (resolutionStates[record.resolutionState!] ?? 0) + 1;
  return { totalRecords: snapshot.records.length, resolved: snapshot.records.filter((record) => record.resolved).length,
    partial: resolutionStates.SEMANTIC_PARTIAL ?? 0,
    unknown: snapshot.records.filter((record) => record.resolved !== true && record.resolutionState !== 'SEMANTIC_PARTIAL').length,
    excluded: null, excludedMeaning: 'Training V2 has no excluded enum; VERIFIED_NO_APPLICABLE_CAPABILITY remains distinct from UNKNOWN.',
    resolutionStates, counts: snapshot.counts };
}

export function compareTrainingV2(legacy: TrainingSemanticSnapshotV2, candidate: TrainingSemanticSnapshotV2) {
  validateTrainingSemanticSnapshotV2(legacy); validateTrainingSemanticSnapshotV2(candidate);
  const left = new Map(legacy.records.map((record) => [record.productId, record]));
  const right = new Map(candidate.records.map((record) => [record.productId, record]));
  const both = [...left.keys()].filter((id) => right.has(id)).sort((a, b) => a - b);
  const legacyOnly = [...left.keys()].filter((id) => !right.has(id)).sort((a, b) => a - b);
  const candidateOnly = [...right.keys()].filter((id) => !left.has(id)).sort((a, b) => a - b);
  const metrics = { exactRecordMatches: 0, equivalentRecordMatches: 0, materialDifferences: 0, lineageOnlyDifferences: 0 };
  const differences = [];
  for (const productId of both) {
    const a = left.get(productId)!, b = right.get(productId)!;
    if (same(a, b)) metrics.exactRecordMatches++;
    const equivalent = same(semanticRecord(a), semanticRecord(b));
    if (equivalent) metrics.equivalentRecordMatches++;
    else metrics.materialDifferences++;
    if (!same(a, b)) {
      if (equivalent) metrics.lineageOnlyDifferences++;
      differences.push({ productId, productKey: `P${productId}`, classification: equivalent ? 'EQUIVALENT' : 'SEMANTIC_DIFFERENCE',
        explanation: equivalent ? 'Source export/product snapshot provenance changed; semantic contract unchanged.' : 'Review contractual/evidence change before migration.',
        legacyValue: a, candidateValue: b });
    }
  }
  return { coverage: { legacy: trainingV2Coverage(legacy), candidate: trainingV2Coverage(candidate) },
    populations: { both, legacyOnly, candidateOnly }, metrics, differences,
    classification: metrics.materialDifferences || (legacyOnly.length && candidateOnly.length) ? 'SEMANTIC_DIFFERENCE'
      : legacyOnly.length ? 'LEGACY_SUPERSET' : candidateOnly.length ? 'CAT_V2_SUPERSET' : 'EQUIVALENT' };
}

export async function replayAcceptedTrainingV2(sourceV1Directory = 'data/training-semantic-snapshots/.test-v1') {
  const [paths, policy, sourceV1] = await Promise.all([resolveProductSemanticInputPaths(), readAcceptedTrainingResolutionPolicy(),
    new FileTrainingSemanticSnapshotStore(path.resolve(sourceV1Directory)).getById(TRAINING_SEMANTIC_V1_SNAPSHOT_ID)]);
  if (!sourceV1) throw new Error('ACCEPTED_TRAINING_V1_MISSING: run npm run test:bootstrap:training-v2');
  const loaded = await loadTrainingSemanticClassificationInputs(paths);
  if (loaded.warnings.length) throw new Error('ACCEPTED_TRAINING_INPUT_WARNINGS');
  const results = classifyTrainingSemanticProductsV21(loaded.inputs, { sourceCatalogExport: path.basename(paths.catalogCsvPath) });
  const build = () => new DefaultTrainingSemanticSnapshotV2Builder().build({ results, parameters: {
    sourceProductCount: loaded.inputs.length, sourceV1SnapshotId: sourceV1.snapshotId, sourceV1Snapshot: sourceV1,
    resolutionStates: policy.states, activeTrainingRelevant: ACTIVE_TRAINING_RELEVANT_BASELINE, activeTrainingRelevantProductIds: policy.productIds,
    acceptedResolvedCount: RESOLVED_TRAINING_RELEVANT_BASELINE, acceptedResolutionStates: ACCEPTED_RESOLUTION_STATE_COUNTS,
    generatedAt: '1970-01-01T00:00:00.000Z',
  } });
  const a = build(), b = build();
  if (a.snapshotId !== acceptedTrainingV2SnapshotId || !same(a, b)) throw new Error('ACCEPTED_TRAINING_V2_REPLAY_DRIFT');
  const rawInputs = await Promise.all([paths.catalogCsvPath, paths.categoryTrustMapCsvPath, paths.featureTrustMapCsvPath].map((file) => readFile(file, 'utf8')));
  return { snapshot: a, contentHash: contentHash(`${canonicalizeTrainingSnapshotJson(a)}\n`), resolutionPolicyHash: policy.hash,
    inputs: { catalog: contentHash(rawInputs[0]!), categoryTrustMap: contentHash(rawInputs[1]!), featureTrustMap: contentHash(rawInputs[2]!) } };
}

async function main() {
  const options: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--(projection-root|bundle-id|legacy-dir|source-v1-dir|output)=(.+)$/u.exec(arg);
    if (!match || options[match[1]!] !== undefined) throw new Error(`INVALID_ARGUMENT: ${arg}`);
    options[match[1]!] = match[2]!;
  }
  const store = new FileProjectionActivationStore(path.resolve(options['projection-root'] ?? 'artifacts/catalog-v2'));
  const bundleId = options['bundle-id'] ?? (await store.readActivePointer())?.activeProjectionBundleId;
  if (!bundleId) throw new Error('NO_ACTIVE_BUNDLE');
  const bundle = await new ActivationService(store).candidate(bundleId);
  const entry = bundle.manifest.projections.trainingSemanticsV2;
  if (entry?.status !== 'present') throw new Error('TRAINING_V2_PROJECTION_UNAVAILABLE');
  const projection = trainingSemanticsV2ProjectionSchema.parse(JSON.parse(bundle.files[entry.artifact]!));
  const [legacy, replay] = await Promise.all([new FileTrainingSemanticSnapshotV2Store(path.resolve(options['legacy-dir'] ?? 'data/training-semantic-snapshots/v2')).getById(acceptedTrainingV2SnapshotId),
    replayAcceptedTrainingV2(options['source-v1-dir'])]);
  if (!legacy) throw new Error('ACCEPTED_TRAINING_V2_MISSING');
  const { generatedAt: _generated, activatedAt: _activated, ...legacyContent } = legacy;
  const { generatedAt: _replayed, ...replayedContent } = replay.snapshot;
  if (!same(legacyContent, replayedContent)) throw new Error('ACCEPTED_TRAINING_V2_CONTENT_DRIFT');
  const parity = compareTrainingV2(legacy, projection.snapshot);
  const report = { schemaVersion: '1', status: parity.metrics.materialDifferences || parity.populations.legacyOnly.length ? 'MIGRATION_BLOCKED' : 'PARITY_PASS',
    inputs: { acceptedSnapshotId: legacy.snapshotId, reproducibleContentHash: replay.contentHash, resolutionPolicyHash: replay.resolutionPolicyHash,
      acceptedClassificationInputs: replay.inputs, candidateInputs: projection.inputs, codeRef: projection.codeRef,
      candidateBundleId: bundleId, candidateManifestHash: bundle.manifestHash, projectionId: entry.snapshotId,
      sourceExtractionId: projection.sourceExtractionId, sourceV1SnapshotId: projection.snapshot.sourceV1SnapshotId,
      candidateSnapshotId: projection.snapshot.snapshotId, candidateSemanticChecksum: projection.snapshot.semanticChecksum,
      registryVersion: projection.snapshot.registryVersion, registryHash: projection.snapshot.registryHash,
      classifierVersion: projection.snapshot.classifierVersion, rulesHash: projection.snapshot.classifierV2RulesHash }, ...parity };
  const output = path.resolve(options.output ?? 'docs/catalog-v2/evidence/training-v2-parity.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${canonicalizeTrainingSnapshotJson(report)}\n`);
  console.log(JSON.stringify({ status: report.status, populations: { both: parity.populations.both.length, legacyOnly: parity.populations.legacyOnly.length,
    candidateOnly: parity.populations.candidateOnly.length }, metrics: parity.metrics, classification: parity.classification, output }, null, 2));
  if (report.status !== 'PARITY_PASS') process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: 'MIGRATION_BLOCKED', message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1;
});
