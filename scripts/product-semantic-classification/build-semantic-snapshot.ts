import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DefaultProductSemanticSnapshotBuilder,
  DefaultProductSemanticSnapshotPublisher,
  productSemanticClassifierVersion,
} from '../../src/domain/product-semantic-snapshot/index.js';
import { CatalogCommercialTruthService, type CatalogCommercialContext } from '../../src/domain/catalog/commercial-truth/index.js';
import { MySqlCatalogCommercialDataReader } from '../../src/infrastructure/catalog/mysqlCatalogCommercialDataReader.js';
import { createPool } from '../../src/infrastructure/database/pool.js';
import { config } from '../../src/shared/config.js';
import { FileProductSemanticSnapshotStore } from '../../src/infrastructure/product-semantic/fileProductSemanticSnapshotStore.js';
import { resolveProductSemanticSnapshotDir } from '../../src/shared/productSemanticSnapshotConfig.js';
import {
  CatalogCommercialTruthPresenceSource,
  reconcileProductSemanticCatalogPresence,
  StaticCurrentCatalogPresenceSource,
  type CurrentCatalogPresenceSource,
} from './lib/catalog-presence.js';
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
  readonly currentCatalogIdsPath?: string;
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
    currentCatalogIdsPath: values['current-catalog-ids'],
  };
}

function commercialContext(): CatalogCommercialContext {
  return {
    shopId: config.prestashop.shopId,
    currencyId: config.prestashop.currencyId,
    currencyCode: config.prestashop.currencyCode,
    countryId: config.prestashop.countryId,
    customerGroupId: config.prestashop.customerGroupId,
    customerId: 0,
    quantity: 1,
    taxRate: config.pricing.taxRate,
  };
}

async function readCurrentCatalogIds(pathname: string): Promise<readonly string[]> {
  const raw = JSON.parse(await readFile(pathname, 'utf8')) as unknown;
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string' || !/^\d+$/u.test(value) || Number(value) <= 0)) {
    throw new Error(`Current catalog product ID source must be a JSON array of positive numeric strings: ${pathname}`);
  }
  return [...new Set(raw)];
}

async function createPresenceSource(currentCatalogIdsPath?: string): Promise<{
  readonly source: CurrentCatalogPresenceSource;
  readonly close: () => Promise<void>;
  readonly description: string;
}> {
  if (currentCatalogIdsPath) {
    const ids = await readCurrentCatalogIds(path.resolve(currentCatalogIdsPath));
    return {
      source: new StaticCurrentCatalogPresenceSource(ids),
      close: async () => {},
      description: path.resolve(currentCatalogIdsPath),
    };
  }

  const pool = createPool();
  const source = new CatalogCommercialTruthPresenceSource(
    new CatalogCommercialTruthService({
      dataReader: new MySqlCatalogCommercialDataReader(pool),
      publicBaseUrl: config.catalog.publicBaseUrl,
    }),
    commercialContext(),
  );
  return {
    source,
    close: () => pool.end(),
    description: 'catalog-commercial-truth',
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
  const presence = await createPresenceSource(args.currentCatalogIdsPath);
  let publication;
  try {
    const results = await reconcileProductSemanticCatalogPresence(run.results, presence.source);
    const publisher = new DefaultProductSemanticSnapshotPublisher(
      new DefaultProductSemanticSnapshotBuilder(),
      new FileProductSemanticSnapshotStore(snapshotDirectory),
    );
    publication = await publisher.publish({
      results,
      parameters: {
        sourceProductCount: run.inputs.length,
        classifierVersion: productSemanticClassifierVersion,
        ...(args.builtAt ? { builtAt: args.builtAt } : {}),
      },
    });
  } finally {
    await presence.close();
  }

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
    currentCatalogPresenceSource: presence.description,
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
