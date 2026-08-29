import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adjudicationCsv, buildExistingFamilyMissAdjudication, renderExistingFamilyMissReleaseMarkdown } from './lib/existing-family-miss-adjudication.js';
import { resolveProductSemanticInputPaths } from './lib/fixture-paths.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');
const DEFAULT_RELEASE_DOC_PATH = path.resolve(SCRIPT_DIR, '../../docs/releases/CATALOG-INTELLIGENCE-A00.4.1-existing-family-miss-adjudication.md');

type CliArgs = {
  readonly inputDir?: string;
  readonly catalogCsvPath?: string;
  readonly categoryTrustMapCsvPath?: string;
  readonly featureTrustMapCsvPath?: string;
  readonly outputDir: string;
  readonly releaseDocPath: string;
  readonly auditDate: string;
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
    outputDir: path.resolve(values['output-dir'] ?? DEFAULT_OUTPUT_DIR),
    releaseDocPath: path.resolve(values['release-doc'] ?? DEFAULT_RELEASE_DOC_PATH),
    auditDate: values['audit-date'] ?? '2026-08-29',
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPaths = await resolveProductSemanticInputPaths(args);
  const summary = await buildExistingFamilyMissAdjudication(inputPaths, args.auditDate);

  await mkdir(args.outputDir, { recursive: true });
  await mkdir(path.dirname(args.releaseDocPath), { recursive: true });

  await writeFile(
    path.join(args.outputDir, 'product_semantic_existing_family_miss_adjudication.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(args.outputDir, 'product_semantic_existing_family_miss_adjudication.csv'),
    adjudicationCsv(summary),
    'utf8',
  );
  await writeFile(args.releaseDocPath, `${renderExistingFamilyMissReleaseMarkdown(summary)}\n`, 'utf8');

  console.info(
    `[product-semantic-existing-family-miss] decision=${summary.finalDecision} total=${summary.totalCandidates} clear=${summary.decisionCounts.CLEAR_EXISTING_FAMILY} conditional=${summary.decisionCounts.CONDITIONAL_EXISTING_FAMILY} checksum=${summary.classificationChecksum}`,
  );
  console.info(`[product-semantic-existing-family-miss] outputs written to ${args.outputDir}`);
  console.info(`[product-semantic-existing-family-miss] release doc written to ${args.releaseDocPath}`);
}

main().catch((error: unknown) => {
  console.error('[product-semantic-existing-family-miss] Failed.', error);
  process.exitCode = 1;
});
