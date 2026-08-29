import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DefaultProductSemanticSnapshotBuilder,
  DefaultProductSemanticSnapshotPublisher,
  productSemanticClassifierVersion,
} from '../../src/domain/product-semantic-snapshot/index.js';
import { FileProductSemanticSnapshotStore } from '../../src/infrastructure/product-semantic/fileProductSemanticSnapshotStore.js';
import { resolveProductSemanticSnapshotDir } from '../../src/shared/productSemanticSnapshotConfig.js';
import { resolveProductSemanticInputPaths } from './lib/fixture-paths.js';
import { runProductSemanticClassification } from './lib/classification-run.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

type CliArgs = {
  readonly inputDir?: string;
  readonly catalogCsvPath?: string;
  readonly categoryTrustMapCsvPath?: string;
  readonly featureTrustMapCsvPath?: string;
  readonly snapshotDir?: string;
  readonly builtAt?: string;
};

function parseArgs(argv: readonly string[]): CliArgs {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unsupported argument: ${arg}`);
    values[match[1]!] = match[2]!;
  }
  return {
    inputDir: values['input-dir'],
    catalogCsvPath: values.catalog,
    categoryTrustMapCsvPath: values['category-trust-map'],
    featureTrustMapCsvPath: values['feature-trust-map'],
    snapshotDir: values['snapshot-dir'],
    builtAt: values['built-at'],
  };
}

function snapshotPath(rootDirectory: string, snapshotId: string): string {
  return path.join(rootDirectory, 'snapshots', `${snapshotId.replace(/^sha256:/u, '')}.json`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPaths = await resolveProductSemanticInputPaths(args);
  const snapshotDirectory = resolveProductSemanticSnapshotDir({
    cwd: path.resolve(SCRIPT_DIR, '../..'),
    directory: args.snapshotDir,
  });
  const run = await runProductSemanticClassification(inputPaths);
  const publisher = new DefaultProductSemanticSnapshotPublisher(
    new DefaultProductSemanticSnapshotBuilder(),
    new FileProductSemanticSnapshotStore(snapshotDirectory),
  );
  const publication = await publisher.publish({
    results: run.results,
    parameters: {
      sourceProductCount: run.inputs.length,
      classifierVersion: productSemanticClassifierVersion,
      ...(args.builtAt ? { builtAt: args.builtAt } : {}),
    },
  });

  console.log(JSON.stringify({
    status: 'ok',
    snapshotId: publication.snapshot.snapshotId,
    schemaVersion: publication.snapshot.schemaVersion,
    builtAt: publication.snapshot.builtAt,
    ontologyVersion: publication.snapshot.ontologyVersion,
    ontologyHash: publication.snapshot.ontologyHash,
    classifierVersion: publication.snapshot.classifierVersion,
    semanticChecksum: publication.snapshot.semanticChecksum,
    sourceProductCount: publication.snapshot.sourceProductCount,
    recordCount: publication.snapshot.recordCount,
    classificationCounts: publication.snapshot.classificationCounts,
    saveStatus: publication.saveStatus,
    snapshotPath: snapshotPath(snapshotDirectory, publication.snapshot.snapshotId),
    activePointerPath: path.join(snapshotDirectory, 'active.json'),
    fixtureInputs: inputPaths,
    loaderWarnings: run.loaderWarnings,
  }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown product semantic snapshot build error';
  const name = error instanceof Error ? error.name : 'Error';
  console.error(JSON.stringify({ status: 'failed', error: { name, message } }, null, 2));
  process.exitCode = 1;
});
