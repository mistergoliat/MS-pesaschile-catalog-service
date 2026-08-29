import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSummaryStableHash, buildAcceptanceAudit } from './lib/acceptance-audit.js';
import { writeCsv } from './lib/csv.js';
import { resolveProductSemanticInputPaths } from './lib/fixture-paths.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');

type CliArgs = {
  readonly inputDir?: string;
  readonly catalogCsvPath?: string;
  readonly categoryTrustMapCsvPath?: string;
  readonly featureTrustMapCsvPath?: string;
  readonly outputDir: string;
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
    auditDate: values['audit-date'] ?? '2026-08-29',
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPaths = await resolveProductSemanticInputPaths(args);
  const audit = await buildAcceptanceAudit(inputPaths, args.auditDate);

  await mkdir(args.outputDir, { recursive: true });

  await writeFile(
    path.join(args.outputDir, 'product_semantic_acceptance_audit.json'),
    `${JSON.stringify(audit.summary, null, 2)}\n`,
    'utf8',
  );

  await writeFile(
    path.join(args.outputDir, 'product_semantic_other_audit.csv'),
    writeCsv(
      [
        'productId',
        'productName',
        'catalogPresence',
        'activeStatus',
        'bucket',
        'subbucket',
        'reason',
        'validOrderCount',
        'unitsSold',
        'totalRevenueTaxIncl',
        'allCategoryNames',
        'featuresText',
      ],
      audit.otherRows.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        catalogPresence: row.catalogPresence,
        activeStatus: row.activeStatus === null ? '' : String(row.activeStatus),
        bucket: row.bucket,
        subbucket: row.subbucket,
        reason: row.reason,
        validOrderCount: row.validOrderCount,
        unitsSold: row.unitsSold,
        totalRevenueTaxIncl: row.totalRevenueTaxIncl,
        allCategoryNames: row.allCategoryNames,
        featuresText: row.featuresText,
      })),
    ),
    'utf8',
  );

  await writeFile(
    path.join(args.outputDir, 'product_semantic_positive_audit.csv'),
    writeCsv(
      [
        'reviewGroup',
        'productId',
        'productName',
        'classificationStatus',
        'primaryProductFamily',
        'secondaryProductFamilies',
        'disciplines',
        'useContexts',
        'unitsSold',
        'totalRevenueTaxIncl',
        'evidenceSummary',
        'allCategoryNames',
      ],
      audit.positiveAuditRows.map((row) => ({
        reviewGroup: row.reviewGroup,
        productId: row.productId,
        productName: row.productName,
        classificationStatus: row.classificationStatus,
        primaryProductFamily: row.primaryProductFamily ?? '',
        secondaryProductFamilies: row.secondaryProductFamilies,
        disciplines: row.disciplines,
        useContexts: row.useContexts,
        unitsSold: row.unitsSold,
        totalRevenueTaxIncl: row.totalRevenueTaxIncl,
        evidenceSummary: row.evidenceSummary,
        allCategoryNames: row.allCategoryNames,
      })),
    ),
    'utf8',
  );

  console.info(
    `[product-semantic-acceptance] verdict=${audit.summary.finalVerdict} other=${audit.summary.otherAudit.total} classifierDefectCandidates=${audit.summary.otherAudit.POSSIBLE_CLASSIFIER_DEFECT} checksum=${audit.summary.reproducibility.run1Checksum}`,
  );
  console.info(`[product-semantic-acceptance] outputs written to ${args.outputDir}`);
  console.info(`[product-semantic-acceptance] summaryHash=${auditSummaryStableHash(audit.summary)}`);
}

main().catch((error: unknown) => {
  console.error('[product-semantic-acceptance] Failed.', error);
  process.exitCode = 1;
});
