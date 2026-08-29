// CUSTOMER-INTELLIGENCE-R2-A00.3 — full-catalog offline product semantic classification runner.
//
// Deterministic, offline. Reads the A00 product export + A00.1 trust maps, classifies every row
// against the A00.2 commercial-product-ontology-v1 registry, and writes machine-readable audit
// artifacts. No database connection, no network call, no PrestaShop/Catalog Service dependency.
//
// Usage:
//   npx tsx scripts/product-semantic-classification/classify-catalog.ts
//   # zero-arg mode resolves the local migrated fixture files from docs/audits/product-intelligence-exploration/inputs/
//
//   npx tsx scripts/product-semantic-classification/classify-catalog.ts \
//     --catalog=<product_catalog_exploration.csv> \
//     --category-trust-map=<category_trust_map.csv> \
//     --feature-trust-map=<feature_trust_map.csv> \
//     [--output-dir=<dir>]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyProducts, computeClassificationChecksum } from '../../src/domain/product-semantic-classification/index.js';
import { writeCsv } from './lib/csv.js';
import { resolveProductSemanticInputPaths } from './lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from './lib/load-input.js';
import { buildClassificationSummary } from './lib/summary.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');

type CliArgs = {
  readonly inputDir?: string;
  readonly catalogCsvPath?: string;
  readonly categoryTrustMapCsvPath?: string;
  readonly featureTrustMapCsvPath?: string;
  readonly outputDir: string;
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
    catalogCsvPath: values['catalog'],
    categoryTrustMapCsvPath: values['category-trust-map'],
    featureTrustMapCsvPath: values['feature-trust-map'],
    outputDir: path.resolve(values['output-dir'] ?? DEFAULT_OUTPUT_DIR),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });
  const inputPaths = await resolveProductSemanticInputPaths(args);

  const { inputs, warnings: loadWarnings } = await loadProductSemanticClassificationInputs(inputPaths);

  const startedAt = Date.now();
  const results = classifyProducts(inputs);
  const durationMs = Date.now() - startedAt;

  const catalogPresenceById = new Map(inputs.map((input) => [input.productId, input.catalogPresence] as const));
  const summary = buildClassificationSummary(results, catalogPresenceById);
  const checksum = computeClassificationChecksum(results);

  const generatedAt = new Date().toISOString();

  await writeFile(path.join(args.outputDir, 'product_semantic_classifications.json'), `${JSON.stringify({ generatedAt, registryVersion: summary.registryVersion, registryHash: summary.registryHash, results }, null, 2)}\n`, 'utf8');

  const csvRows = results.map((result) => ({
    productId: result.productId,
    classificationStatus: result.classificationStatus,
    primaryProductFamily: result.primaryProductFamily?.code ?? '',
    primaryProductFamilyConfidence: result.primaryProductFamily?.confidence ?? '',
    primaryProductFamilyRuleId: result.primaryProductFamily?.ruleId ?? '',
    secondaryProductFamilies: result.secondaryProductFamilies.map((tag) => tag.code).join(';'),
    disciplines: result.disciplines.map((tag) => `${tag.code}:${tag.confidence}`).join(';'),
    useContexts: result.useContexts.map((tag) => `${tag.code}:${tag.confidence}`).join(';'),
    exclusionReason: result.exclusionReason ?? '',
    warnings: result.warnings.join(' | '),
  }));
  await writeFile(
    path.join(args.outputDir, 'product_semantic_classifications.csv'),
    writeCsv(
      ['productId', 'classificationStatus', 'primaryProductFamily', 'primaryProductFamilyConfidence', 'primaryProductFamilyRuleId', 'secondaryProductFamilies', 'disciplines', 'useContexts', 'exclusionReason', 'warnings'],
      csvRows,
    ),
    'utf8',
  );

  const needsReviewRows = results
    .filter((result) => result.classificationStatus === 'NEEDS_REVIEW')
    .map((result) => ({
      productId: result.productId,
      needsReviewCandidates: result.needsReviewCandidates.map((tag) => tag.code).join(';'),
      warnings: result.warnings.join(' | '),
    }));
  await writeFile(path.join(args.outputDir, 'product_semantic_needs_review.csv'), writeCsv(['productId', 'needsReviewCandidates', 'warnings'], needsReviewRows), 'utf8');

  const performance = {
    productsProcessed: results.length,
    durationMs,
    productsPerSecond: durationMs > 0 ? Math.round((results.length / durationMs) * 1000) : results.length,
  };

  await writeFile(
    path.join(args.outputDir, 'product_semantic_classification_summary.json'),
    `${JSON.stringify(
      {
        generatedAt,
        registryVersion: summary.registryVersion,
        registryHash: summary.registryHash,
        sourceProductCount: summary.sourceProductCount,
        excludedNonProductCount: summary.excludedNonProductCount,
        classifiedCount: summary.classifiedCount,
        partialCount: summary.partialCount,
        otherCount: summary.otherCount,
        needsReviewCount: summary.needsReviewCount,
        statusCounts: summary.statusCounts,
        productFamilyTagCounts: summary.productFamilyTagCounts,
        disciplineTagCounts: summary.disciplineTagCounts,
        useContextTagCounts: summary.useContextTagCounts,
        confidenceDistribution: summary.confidenceDistribution,
        catalogPresenceDistribution: summary.catalogPresenceDistribution,
        performance,
        determinismChecksum: checksum,
        loaderWarnings: loadWarnings,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.info(`[product-semantic-classification] classified ${results.length} products in ${durationMs}ms (${performance.productsPerSecond}/s). checksum=${checksum}`);
  console.info(`[product-semantic-classification] statusCounts=${JSON.stringify(summary.statusCounts)}`);
  console.info(`[product-semantic-classification] inputs=${JSON.stringify(inputPaths)}`);
  console.info(`[product-semantic-classification] outputs written to ${args.outputDir}`);
}

main().catch((error: unknown) => {
  console.error('[product-semantic-classification] Failed.', error);
  process.exitCode = 1;
});
