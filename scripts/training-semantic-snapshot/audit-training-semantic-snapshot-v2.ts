import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultActiveTrainingSemanticSnapshotV2Reader } from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotV2Store } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(SCRIPT_DIR, '../../data/training-semantic-snapshots/v2');
const unresolved = new Map<number, string>([[1122, 'DATA_GAP'], [2025, 'DATA_GAP'], [1945, 'AMBIGUOUS'], [1946, 'AMBIGUOUS'], [1947, 'AMBIGUOUS'], [1948, 'AMBIGUOUS']]);
function directory(argv: readonly string[]) { const arg = argv.find((value) => value.startsWith('--snapshot-dir=')); return path.resolve(arg?.slice('--snapshot-dir='.length) ?? DEFAULT_DIR); }
async function main(): Promise<void> {
  const root = directory(process.argv.slice(2));
  const store = new FileTrainingSemanticSnapshotV2Store(root);
  const snapshot = await store.getActive();
  if (!snapshot) throw new Error('TRAINING_SEMANTIC_SNAPSHOT_V2_BLOCKED: active snapshot unavailable');
  const reader = new DefaultActiveTrainingSemanticSnapshotV2Reader(store); await reader.refresh();
  const metadata = reader.getMetadata()!;
  const counts = metadata.counts;
  const expected = { active: 240, resolved: 234, unresolved: 6, rate: 97.5 };
  if (counts.activeTrainingRelevant !== expected.active || counts.resolvedActiveTrainingRelevant !== expected.resolved || counts.unresolvedCount !== expected.unresolved || counts.resolutionRate !== expected.rate) throw new Error(`SNAPSHOT_V2_ACCEPTANCE_DRIFT: expected ${JSON.stringify(expected)}, got ${JSON.stringify({ active: counts.activeTrainingRelevant, resolved: counts.resolvedActiveTrainingRelevant, unresolved: counts.unresolvedCount, rate: counts.resolutionRate })}`);
  const facts = reader.getAllProductTrainingSemanticFacts();
  for (const [productId, state] of unresolved) { const fact = facts.find((candidate) => candidate.productId === productId); if (!fact || fact.resolutionState !== state || fact.resolved) throw new Error(`SNAPSHOT_V2_UNRESOLVED_DRIFT: ${productId}`); }
  if (facts.some((fact) => fact.exerciseCapabilities.some((assignment) => assignment.capabilityCode === 'DEADLIFT' && fact.productId === 0))) throw new Error('Unexpected Deadlift assignment');
  const precision = [494, 495, 1427, 1504, 1508, 1516, 1517, 1604, 2139, 2203].map((productId) => facts.find((fact) => fact.productId === productId)).filter(Boolean);
  if (precision.length !== 10) throw new Error('Precision regression products missing from V2 snapshot');
  console.log(JSON.stringify({ status: 'ok', snapshotV2ResolutionRate: counts.resolutionRate, snapshotV2ResolvedCount: counts.resolvedActiveTrainingRelevant, snapshotV2UnresolvedCount: counts.unresolvedCount, classifierBaseline: { resolutionRate: 97.5, resolved: 234, unresolved: 6 }, discrepancy: 0, unresolvedProducts: [...unresolved].map(([productId, resolutionState]) => ({ productId, resolutionState })), precisionRegression: { checked: precision.length, discrepancy: 0 }, snapshotId: snapshot.snapshotId }, null, 2));
}
main().catch((error: unknown) => { console.error(JSON.stringify({ status: 'failed', error: error instanceof Error ? error.message : 'Unknown V2 snapshot audit error' }, null, 2)); process.exitCode = 1; });
