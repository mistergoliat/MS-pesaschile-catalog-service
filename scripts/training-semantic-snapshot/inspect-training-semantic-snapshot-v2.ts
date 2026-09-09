import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultActiveTrainingSemanticSnapshotV2Reader } from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotV2Store } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(SCRIPT_DIR, '../../data/training-semantic-snapshots/v2');
function parse(argv: readonly string[]) { const values: Record<string, string> = {}; for (const arg of argv) { const match = /^--([a-z-]+)=(.*)$/u.exec(arg); if (!match) throw new Error(`Unsupported argument: ${arg}`); values[match[1]!] = match[2]!; } const productId = values['product-id'] === undefined ? undefined : Number(values['product-id']); if (productId !== undefined && (!Number.isInteger(productId) || productId <= 0)) throw new Error('--product-id must be a positive integer'); return { view: values.view ?? 'metadata', productId, directory: path.resolve(values['snapshot-dir'] ?? DEFAULT_DIR) }; }
async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const reader = new DefaultActiveTrainingSemanticSnapshotV2Reader(new FileTrainingSemanticSnapshotV2Store(options.directory));
  await reader.refresh();
  const metadata = reader.getMetadata();
  if (!metadata) { console.log(JSON.stringify({ status: 'unavailable', snapshotDirectory: options.directory }, null, 2)); return; }
  if (options.productId !== undefined) { console.log(JSON.stringify({ status: reader.hasProduct(options.productId) ? 'ok' : 'not_found', metadata, fact: reader.getProductTrainingSemanticFact(options.productId) }, null, 2)); return; }
  const facts = reader.getAllProductTrainingSemanticFacts();
  if (options.view === 'metadata') console.log(JSON.stringify({ status: 'ok', metadata }, null, 2));
  else if (options.view === 'counts') console.log(JSON.stringify({ status: 'ok', counts: metadata.counts }, null, 2));
  else if (options.view === 'resolution-counts') console.log(JSON.stringify({ status: 'ok', resolutionStateCounts: metadata.counts.resolutionStateCounts }, null, 2));
  else if (options.view === 'capability-counts') console.log(JSON.stringify({ status: 'ok', assignmentCountsByExerciseCapability: metadata.counts.assignmentCountsByExerciseCapability }, null, 2));
  else if (options.view === 'training-function-counts') console.log(JSON.stringify({ status: 'ok', assignmentCountsByTrainingFunction: metadata.counts.assignmentCountsByTrainingFunction }, null, 2));
  else if (options.view === 'unresolved-products') console.log(JSON.stringify({ status: 'ok', products: facts.filter((fact) => fact.activeTrainingRelevant && !fact.resolved).map((fact) => ({ productId: fact.productId, resolutionState: fact.resolutionState, coverageStatus: fact.coverageStatus, warnings: fact.warnings })) }, null, 2));
  else if (options.view === 'all') console.log(JSON.stringify({ status: 'ok', facts }, null, 2));
  else throw new Error('--view must be metadata, counts, resolution-counts, capability-counts, training-function-counts, unresolved-products, or all');
}
main().catch((error: unknown) => { console.error(JSON.stringify({ status: 'failed', error: error instanceof Error ? error.message : 'Unknown V2 snapshot inspect error' }, null, 2)); process.exitCode = 1; });
