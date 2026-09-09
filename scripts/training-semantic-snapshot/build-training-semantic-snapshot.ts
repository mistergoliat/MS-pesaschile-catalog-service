import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTrainingSemanticProducts } from '../../src/domain/training-semantic-classification/index.js';
import { canonicalizeTrainingSnapshotJson, DefaultTrainingSemanticSnapshotBuilder, DefaultTrainingSemanticSnapshotPublisher } from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotStore } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotStore.js';
import { resolveTrainingSemanticSnapshotDir } from '../../src/shared/trainingSemanticSnapshotConfig.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { loadTrainingSemanticClassificationInputs } from '../training-semantic-classification/lib/load-input.js';
import { buildTrainingSemanticClassificationSummary } from '../training-semantic-classification/lib/summary.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = {
  productCount: 2011,
  assignmentCount: 180,
  directAssignments: 157,
  supportedAssignments: 23,
  multiAssignmentProducts: 23,
  coverageCounts: { NO_CAPABILITY_APPLICABLE: 881, UNMODELED: 1086, INSUFFICIENT_EVIDENCE: 44, NEEDS_REVIEW: 0 },
  assignmentCountsByCapability: { ABDUCTOR: 9, ADDUCTOR: 7, CHEST_PRESS: 7, DIP: 21, HIP_THRUST: 18, LAT_PULLDOWN: 24, LEG_CURL: 20, LEG_EXTENSION: 11, PEC_DECK: 1, PULL_UP: 31, ROW: 25, SHOULDER_PRESS: 6, ABDOMINAL_CRUNCH: 0 },
} as const;

type Args = { inputDir?: string; catalog?: string; categoryTrustMap?: string; featureTrustMap?: string; snapshotDir?: string; generatedAt?: string };
function parseArgs(argv: readonly string[]): Args {
  const values: Record<string, string> = {};
  for (const arg of argv) { const match = /^--([a-z-]+)=(.*)$/u.exec(arg); if (!match) throw new Error(`Unsupported argument: ${arg}`); values[match[1]!] = match[2]!; }
  return { inputDir: values['input-dir'], catalog: values.catalog, categoryTrustMap: values['category-trust-map'], featureTrustMap: values['feature-trust-map'], snapshotDir: values['snapshot-dir'], generatedAt: values['generated-at'] };
}

function assertBaseline(summary: ReturnType<typeof buildTrainingSemanticClassificationSummary>): void {
  const actual = { productCount: summary.productCount, assignmentCount: Object.values(summary.capabilityCounts).reduce((sum, count) => sum + count, 0), directAssignments: summary.relationCounts.DIRECT ?? 0, supportedAssignments: summary.relationCounts.SUPPORTED ?? 0, multiAssignmentProducts: summary.multiAssignmentCount, coverageCounts: summary.coverageCounts, assignmentCountsByCapability: summary.capabilityCounts };
  if (canonicalizeTrainingSnapshotJson(actual) !== canonicalizeTrainingSnapshotJson(BASELINE)) throw new Error(`TRAINING SEMANTIC BASELINE DRIFT: expected ${JSON.stringify(BASELINE)}, actual ${JSON.stringify(actual)}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPaths = await resolveProductSemanticInputPaths({ inputDir: args.inputDir, catalogCsvPath: args.catalog, categoryTrustMapCsvPath: args.categoryTrustMap, featureTrustMapCsvPath: args.featureTrustMap });
  const { inputs, warnings: loaderWarnings } = await loadTrainingSemanticClassificationInputs(inputPaths);
  const results = classifyTrainingSemanticProducts(inputs, { sourceCatalogExport: path.basename(inputPaths.catalogCsvPath) });
  const summary = buildTrainingSemanticClassificationSummary(results);
  assertBaseline(summary);
  if (summary.coverageCounts.NEEDS_REVIEW !== 0) throw new Error('TRAINING SEMANTIC SNAPSHOT BUILD STOPPED: NEEDS_REVIEW must be zero');
  const snapshotDirectory = resolveTrainingSemanticSnapshotDir({ cwd: path.resolve(SCRIPT_DIR, '../..'), directory: args.snapshotDir });
  const publication = await new DefaultTrainingSemanticSnapshotPublisher(new DefaultTrainingSemanticSnapshotBuilder(), new FileTrainingSemanticSnapshotStore(snapshotDirectory)).publish({ results, parameters: { sourceProductCount: inputs.length, ...(args.generatedAt ? { generatedAt: args.generatedAt } : {}) } });
  console.log(JSON.stringify({ status: 'ok', snapshotId: publication.snapshot.snapshotId, semanticChecksum: publication.snapshot.semanticChecksum, schemaVersion: publication.snapshot.schemaVersion, registryVersion: publication.snapshot.registryVersion, registryHash: publication.snapshot.registryHash, classifierVersion: publication.snapshot.classifierVersion, rulesHash: publication.snapshot.rulesHash, generatedAt: publication.snapshot.generatedAt, counts: publication.snapshot.counts, saveStatus: publication.saveStatus, snapshotPath: path.join(snapshotDirectory, 'snapshots', `${publication.snapshot.snapshotId.replace(/^sha256:/u, '')}.json`), activePointerPath: path.join(snapshotDirectory, 'active.json'), fixtureInputs: inputPaths, loaderWarnings }, null, 2));
}

main().catch((error: unknown) => { console.error(JSON.stringify({ status: 'failed', error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'Unknown error' } }, null, 2)); process.exitCode = 1; });
