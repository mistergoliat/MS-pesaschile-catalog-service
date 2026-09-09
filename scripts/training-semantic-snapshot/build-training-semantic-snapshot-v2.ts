import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTrainingSemanticProductsV21 } from '../../src/domain/training-semantic-classification-v2-1/index.js';
import { DefaultTrainingSemanticSnapshotV2Builder, ACCEPTED_RESOLUTION_STATE_COUNTS, ACTIVE_TRAINING_RELEVANT_BASELINE, RESOLVED_TRAINING_RELEVANT_BASELINE, TRAINING_SEMANTIC_V1_SNAPSHOT_ID, type TrainingSemanticResolutionState } from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotStore } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotStore.js';
import { FileTrainingSemanticSnapshotV2Store } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { loadTrainingSemanticClassificationInputs } from '../training-semantic-classification/lib/load-input.js';
import { parseCsvRecords } from '../product-semantic-classification/lib/csv.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DEFAULT_V1_DIR = path.resolve(SERVICE_ROOT, 'data/training-semantic-snapshots');
const DEFAULT_V2_DIR = path.resolve(SERVICE_ROOT, 'data/training-semantic-snapshots/v2');
const RESOLUTION_CSV = path.resolve(SERVICE_ROOT, 'docs/audits/training-semantics/a00.6.7/post-closure-resolution-active.csv');

function args(argv: readonly string[]) { const values: Record<string, string> = {}; for (const arg of argv) { const match = /^--([a-z-]+)=(.*)$/u.exec(arg); if (!match) throw new Error(`Unsupported argument: ${arg}`); values[match[1]!] = match[2]!; } return { v1Dir: path.resolve(values['source-v1-dir'] ?? DEFAULT_V1_DIR), v2Dir: path.resolve(values['snapshot-dir'] ?? DEFAULT_V2_DIR), generatedAt: values['generated-at'] }; }
function resolutionInput() {
  return readFile(RESOLUTION_CSV, 'utf8').then((text) => {
    const records = parseCsvRecords(text).map((row) => ({ productId: Number(row.productId), resolutionState: row.resolutionState }));
    if (records.length !== ACTIVE_TRAINING_RELEVANT_BASELINE || records.some((row) => !Number.isInteger(row.productId) || !row.resolutionState)) throw new Error('A00.6.7 active resolution baseline is missing or malformed');
    const states = new Map(records.map((row) => [row.productId, row.resolutionState as TrainingSemanticResolutionState] as const));
    const counts: Record<string, number> = {}; for (const state of states.values()) counts[state] = (counts[state] ?? 0) + 1;
    if (JSON.stringify({ SEMANTIC_COMPLETE: counts.SEMANTIC_COMPLETE ?? 0, VERIFIED_NO_APPLICABLE_CAPABILITY: counts.VERIFIED_NO_APPLICABLE_CAPABILITY ?? 0, DATA_GAP: counts.DATA_GAP ?? 0, AMBIGUOUS: counts.AMBIGUOUS ?? 0, NEEDS_REVIEW: counts.NEEDS_REVIEW ?? 0 }) !== JSON.stringify(ACCEPTED_RESOLUTION_STATE_COUNTS)) throw new Error(`A00.6.7 resolution-state baseline drift: ${JSON.stringify(counts)}`);
    return { states, productIds: records.map((row) => row.productId) };
  });
}

async function main(): Promise<void> {
  const options = args(process.argv.slice(2));
  const [inputPaths, resolution, sourceV1] = await Promise.all([
    resolveProductSemanticInputPaths(), resolutionInput(), new FileTrainingSemanticSnapshotStore(options.v1Dir).getById(TRAINING_SEMANTIC_V1_SNAPSHOT_ID),
  ]);
  if (!sourceV1) throw new Error(`V1 source snapshot missing: ${TRAINING_SEMANTIC_V1_SNAPSHOT_ID}. Build/publish V1 first; V2 build is fail-closed.`);
  const { inputs, warnings } = await loadTrainingSemanticClassificationInputs(inputPaths);
  const results = classifyTrainingSemanticProductsV21(inputs, { sourceCatalogExport: path.basename(inputPaths.catalogCsvPath) });
  const snapshot = new DefaultTrainingSemanticSnapshotV2Builder().build({ results, parameters: { sourceProductCount: inputs.length, sourceV1SnapshotId: sourceV1.snapshotId, sourceV1Snapshot: sourceV1, resolutionStates: resolution.states, activeTrainingRelevant: ACTIVE_TRAINING_RELEVANT_BASELINE, activeTrainingRelevantProductIds: resolution.productIds, acceptedResolvedCount: RESOLVED_TRAINING_RELEVANT_BASELINE, acceptedResolutionStates: ACCEPTED_RESOLUTION_STATE_COUNTS, ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}) } });
  const store = new FileTrainingSemanticSnapshotV2Store(options.v2Dir);
  const saved = await store.save(snapshot);
  const persisted = await store.getById(snapshot.snapshotId);
  if (!persisted) throw new Error('Persisted V2 snapshot could not be validated/read');
  await store.activate(snapshot.snapshotId);
  console.log(JSON.stringify({ status: 'ok', snapshotId: snapshot.snapshotId, semanticChecksum: snapshot.semanticChecksum, schemaVersion: snapshot.schemaVersion, registryVersion: snapshot.registryVersion, registryHash: snapshot.registryHash, classifierVersion: snapshot.classifierVersion, rulesHash: snapshot.rulesHash, sourceV1SnapshotId: snapshot.sourceV1SnapshotId, generatedAt: snapshot.generatedAt, counts: snapshot.counts, saveStatus: saved.status, snapshotPath: path.join(options.v2Dir, 'snapshots', `${snapshot.snapshotId.slice('sha256:'.length)}.json`), activePointerPath: path.join(options.v2Dir, 'active.json'), fixtureInputs: inputPaths, loaderWarnings: warnings.length }, null, 2));
}
main().catch((error: unknown) => { console.error(JSON.stringify({ status: 'failed', error: error instanceof Error ? error.message : 'Unknown V2 snapshot build error' }, null, 2)); process.exitCode = 1; });
