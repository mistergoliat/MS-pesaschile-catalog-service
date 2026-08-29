import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DefaultActiveProductSemanticSnapshotReader,
  DefaultProductSemanticRuntimeIndexBuilder,
  ProductSemanticRuntimeError,
} from '../../src/domain/product-semantic-snapshot/runtime/index.js';
import { FileProductSemanticSnapshotStore } from '../../src/infrastructure/product-semantic/fileProductSemanticSnapshotStore.js';
import { resolveProductSemanticSnapshotDir } from '../../src/shared/productSemanticSnapshotConfig.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

type CliArgs = {
  readonly productId?: string;
  readonly snapshotDir?: string;
};

function parseArgs(argv: readonly string[]): CliArgs {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unsupported argument: ${arg}`);
    values[match[1]!] = match[2]!;
  }
  return {
    productId: values['product-id'],
    snapshotDir: values['snapshot-dir'],
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.productId) {
    throw new Error('--product-id is required');
  }

  const snapshotDirectory = resolveProductSemanticSnapshotDir({
    cwd: path.resolve(SCRIPT_DIR, '../..'),
    directory: args.snapshotDir,
  });
  const reader = new DefaultActiveProductSemanticSnapshotReader(
    new FileProductSemanticSnapshotStore(snapshotDirectory),
    new DefaultProductSemanticRuntimeIndexBuilder(),
  );
  await reader.refresh();
  const fact = reader.getProductSemanticFact(args.productId);
  if (!fact) {
    throw new ProductSemanticRuntimeError('INVALID_RUNTIME_QUERY', `productId ${args.productId} is not present in the active snapshot`);
  }

  console.log(JSON.stringify({
    status: 'ok',
    snapshot: reader.getActiveSnapshotMetadata(),
    fact,
  }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown product semantic snapshot inspect error';
  const name = error instanceof Error ? error.name : 'Error';
  console.error(JSON.stringify({ status: 'failed', error: { name, message } }, null, 2));
  process.exitCode = 1;
});
