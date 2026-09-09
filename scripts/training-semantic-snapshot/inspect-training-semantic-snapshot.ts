import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultActiveTrainingSemanticSnapshotReader } from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotStore } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotStore.js';
import { resolveTrainingSemanticSnapshotDir } from '../../src/shared/trainingSemanticSnapshotConfig.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
function parseArgs(argv: readonly string[]): { view: string; productId?: number; snapshotDir?: string } {
  const values: Record<string, string> = {};
  for (const arg of argv) { const match = /^--([a-z-]+)=(.*)$/u.exec(arg); if (!match) throw new Error(`Unsupported argument: ${arg}`); values[match[1]!] = match[2]!; }
  const productId = values['product-id'] === undefined ? undefined : Number(values['product-id']);
  if (productId !== undefined && (!Number.isInteger(productId) || productId <= 0)) throw new Error('--product-id must be a positive integer');
  return { view: values.view ?? 'metadata', productId, snapshotDir: values['snapshot-dir'] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = resolveTrainingSemanticSnapshotDir({ cwd: path.resolve(SCRIPT_DIR, '../..'), directory: args.snapshotDir });
  const reader = new DefaultActiveTrainingSemanticSnapshotReader(new FileTrainingSemanticSnapshotStore(root));
  await reader.refresh();
  if (!reader.getMetadata()) { console.log(JSON.stringify({ status: 'unavailable', snapshotDirectory: root }, null, 2)); return; }
  if (args.productId !== undefined) { console.log(JSON.stringify({ status: 'ok', metadata: reader.getMetadata(), fact: reader.getProductTrainingSemanticFact(args.productId) }, null, 2)); return; }
  const facts = reader.getAllProductTrainingSemanticFacts();
  if (args.view === 'capability-counts') console.log(JSON.stringify({ status: 'ok', metadata: reader.getMetadata(), assignmentCountsByCapability: reader.getMetadata()!.counts.assignmentCountsByCapability }, null, 2));
  else if (args.view === 'coverage-counts') console.log(JSON.stringify({ status: 'ok', metadata: reader.getMetadata(), coverageCounts: reader.getMetadata()!.counts.coverageCounts }, null, 2));
  else if (args.view === 'metadata') console.log(JSON.stringify({ status: 'ok', metadata: reader.getMetadata() }, null, 2));
  else throw new Error('--view must be metadata, capability-counts, or coverage-counts');
  void facts;
}

main().catch((error: unknown) => { console.error(JSON.stringify({ status: 'failed', error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'Unknown error' } }, null, 2)); process.exitCode = 1; });
