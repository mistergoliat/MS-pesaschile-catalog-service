// CUSTOMER-INTELLIGENCE-R2-A00.3.1 — non-product universe policy correction: full-catalog v1-vs-v2
// migration audit. Deterministic, offline. No database, no network, no LLM.
//
// Usage:
//   npx tsx scripts/product-semantic-classification/non-product-policy-v2-migration.ts
//   # zero-arg mode resolves the local migrated fixture files from docs/audits/product-intelligence-exploration/inputs/
//
//   npx tsx scripts/product-semantic-classification/non-product-policy-v2-migration.ts \
//     --catalog=<product_catalog_exploration.csv> \
//     --category-trust-map=<category_trust_map.csv> \
//     --feature-trust-map=<feature_trust_map.csv> \
//     [--output-dir=<dir>]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCommercialProductOntologyRegistry,
  getCommercialProductOntologyRegistryV2,
  computeCommercialProductOntologyRegistryHash,
} from '../../src/domain/commercial-product-ontology/index.js';
import {
  classifyProducts,
  computeClassificationChecksum,
  normalizeProductName,
  type ClassifiedOntologyTag,
  type ProductSemanticClassificationInput,
  type ProductSemanticClassificationResult,
  type ProductSemanticClassificationStatus,
} from '../../src/domain/product-semantic-classification/index.js';
import { writeCsv } from './lib/csv.js';
import { resolveProductSemanticInputPaths } from './lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from './lib/load-input.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');

/** Broader-than-the-approved-patterns keyword superset, for the Section 11 discovery scan only — reporting, never auto-exclusion. */
const DISCOVERY_KEYWORDS = ['revision', 'reparacion', 'armado', 'instalacion', 'mantencion', 'mantenimiento', 'servicio', 'costo'] as const;

function containsKeyword(normalizedName: string, keyword: string): boolean {
  return normalizedName === keyword || normalizedName.startsWith(`${keyword} `) || normalizedName.includes(` ${keyword} `) || normalizedName.endsWith(` ${keyword}`);
}

function businessTypeForPattern(patternSource: string): string {
  if (patternSource.includes('vendedor') || patternSource.includes('costo')) return 'ADMINISTRATIVE_FEE';
  if (patternSource.includes('instalacion')) return 'INSTALLATION_SERVICE';
  if (patternSource.includes('armado')) return 'ASSEMBLY_SERVICE';
  if (patternSource.includes('revision') || patternSource.includes('reparacion')) return 'REVIEW_REPAIR_SERVICE';
  if (patternSource.includes('mantencion') || patternSource.includes('mantenimiento')) return 'MAINTENANCE_SERVICE';
  return 'UNKNOWN';
}

function familyCodes(result: ProductSemanticClassificationResult): readonly string[] {
  const codes = [result.primaryProductFamily?.code, ...result.secondaryProductFamilies.map((t) => t.code)].filter((c): c is string => Boolean(c));
  return [...codes].sort();
}

function tagCodes(tags: readonly ClassifiedOntologyTag[]): readonly string[] {
  return [...tags.map((t) => t.code)].sort();
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

type ChangeType = 'UNCHANGED' | 'OTHER_TO_EXCLUDED_NON_PRODUCT' | 'CLASSIFIED_TO_EXCLUDED_NON_PRODUCT' | 'PARTIAL_TO_EXCLUDED_NON_PRODUCT' | 'UNEXPECTED_SEMANTIC_CHANGE';

function classifyChange(v1: ProductSemanticClassificationResult, v2: ProductSemanticClassificationResult): ChangeType {
  const semanticallyIdentical =
    v1.classificationStatus === v2.classificationStatus &&
    sameList(familyCodes(v1), familyCodes(v2)) &&
    sameList(tagCodes(v1.disciplines), tagCodes(v2.disciplines)) &&
    sameList(tagCodes(v1.useContexts), tagCodes(v2.useContexts));
  if (semanticallyIdentical) return 'UNCHANGED';

  if (v2.classificationStatus === 'EXCLUDED_NON_PRODUCT' && v1.classificationStatus !== 'EXCLUDED_NON_PRODUCT') {
    if (v1.classificationStatus === 'OTHER') return 'OTHER_TO_EXCLUDED_NON_PRODUCT';
    if (v1.classificationStatus === 'CLASSIFIED') return 'CLASSIFIED_TO_EXCLUDED_NON_PRODUCT';
    if (v1.classificationStatus === 'PARTIALLY_CLASSIFIED') return 'PARTIAL_TO_EXCLUDED_NON_PRODUCT';
  }
  return 'UNEXPECTED_SEMANTIC_CHANGE';
}

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

  const { inputs } = await loadProductSemanticClassificationInputs(inputPaths);
  const inputsById = new Map<string, ProductSemanticClassificationInput>(inputs.map((input) => [input.productId, input]));

  const registryV1 = getCommercialProductOntologyRegistry();
  const registryV2 = getCommercialProductOntologyRegistryV2();
  const hashV1 = computeCommercialProductOntologyRegistryHash(registryV1);
  const hashV2 = computeCommercialProductOntologyRegistryHash(registryV2);

  const resultsV1 = classifyProducts(inputs, registryV1.registryVersion);
  const resultsV2 = classifyProducts(inputs, registryV2.registryVersion);
  const resultsV1ById = new Map(resultsV1.map((r) => [r.productId, r] as const));
  const resultsV2ById = new Map(resultsV2.map((r) => [r.productId, r] as const));

  // -- non_product_policy_audit.csv --
  const v2Patterns = registryV2.globalRules.nonProductExclusion.normalizedNameExclusionPatterns.map((source) => ({ source, regex: new RegExp(source) }));
  const v2KnownIds = new Set(registryV2.globalRules.nonProductExclusion.knownExcludedProductIds);
  const auditRows: Record<string, string>[] = [];
  for (const input of inputs) {
    const normalizedName = normalizeProductName(input.productName);
    const matchedPattern = v2Patterns.find((p) => p.regex.test(normalizedName));
    const isKnownId = v2KnownIds.has(input.productId);
    const looksAdministrative = DISCOVERY_KEYWORDS.some((kw) => containsKeyword(normalizedName, kw));
    if (!matchedPattern && !isKnownId && !looksAdministrative) continue;

    const v1Status = resultsV1ById.get(input.productId)?.classificationStatus ?? 'UNKNOWN';
    const v2Status = resultsV2ById.get(input.productId)?.classificationStatus ?? 'UNKNOWN';
    auditRows.push({
      productId: input.productId,
      productName: input.productName,
      normalizedName,
      matchedRule: matchedPattern ? matchedPattern.source : isKnownId ? 'KNOWN_ID_ONLY' : 'DISCOVERY_KEYWORD_ONLY_NOT_EXCLUDED',
      businessType: matchedPattern ? businessTypeForPattern(matchedPattern.source) : isKnownId ? businessTypeForPattern('') : 'NOT_A_SERVICE_ROW',
      previousStatus: v1Status,
      newStatus: v2Status,
      decision: v2Status === 'EXCLUDED_NON_PRODUCT' ? 'EXCLUDED' : 'NOT_EXCLUDED',
      notes: matchedPattern || isKnownId ? 'Confirmed non-product service/administrative row.' : 'Contains a discovery keyword but does not match an approved v2 pattern — reported, not auto-excluded.',
    });
  }
  await writeFile(
    path.join(args.outputDir, 'non_product_policy_audit.csv'),
    writeCsv(['productId', 'productName', 'normalizedName', 'matchedRule', 'businessType', 'previousStatus', 'newStatus', 'decision', 'notes'], auditRows),
    'utf8',
  );

  // -- product_semantic_v1_v2_diff.csv --
  const diffRows = inputs.map((input) => {
    const v1 = resultsV1ById.get(input.productId)!;
    const v2 = resultsV2ById.get(input.productId)!;
    return {
      productId: input.productId,
      productName: input.productName,
      v1Status: v1.classificationStatus,
      v2Status: v2.classificationStatus,
      v1PrimaryFamily: v1.primaryProductFamily?.code ?? '',
      v2PrimaryFamily: v2.primaryProductFamily?.code ?? '',
      v1Disciplines: tagCodes(v1.disciplines).join(';'),
      v2Disciplines: tagCodes(v2.disciplines).join(';'),
      v1UseContexts: tagCodes(v1.useContexts).join(';'),
      v2UseContexts: tagCodes(v2.useContexts).join(';'),
      changeType: classifyChange(v1, v2),
    };
  });
  await writeFile(
    path.join(args.outputDir, 'product_semantic_v1_v2_diff.csv'),
    writeCsv(
      ['productId', 'productName', 'v1Status', 'v2Status', 'v1PrimaryFamily', 'v2PrimaryFamily', 'v1Disciplines', 'v2Disciplines', 'v1UseContexts', 'v2UseContexts', 'changeType'],
      diffRows,
    ),
    'utf8',
  );

  const changeCounts: Record<ChangeType, number> = {
    UNCHANGED: 0,
    OTHER_TO_EXCLUDED_NON_PRODUCT: 0,
    CLASSIFIED_TO_EXCLUDED_NON_PRODUCT: 0,
    PARTIAL_TO_EXCLUDED_NON_PRODUCT: 0,
    UNEXPECTED_SEMANTIC_CHANGE: 0,
  };
  for (const row of diffRows) changeCounts[row.changeType as ChangeType] += 1;

  const unexpectedSemanticChanges = diffRows.filter((row) => row.changeType === 'UNEXPECTED_SEMANTIC_CHANGE');

  // -- false-positive check: any v2 exclusion on a row NOT in the confirmed audit set is a blocker --
  const confirmedExcludableIds = new Set(auditRows.filter((row) => row.decision === 'EXCLUDED').map((row) => row.productId));
  const falsePositiveExclusions = resultsV2.filter((r) => r.classificationStatus === 'EXCLUDED_NON_PRODUCT' && !confirmedExcludableIds.has(r.productId));

  const statusCountsV1 = countStatuses(resultsV1);
  const statusCountsV2 = countStatuses(resultsV2);

  const checksumV2 = computeClassificationChecksum(resultsV2);
  const checksumV2Repeat = computeClassificationChecksum(classifyProducts(inputs, registryV2.registryVersion));

  const summary = {
    generatedAt: new Date().toISOString(),
    registryVersion: registryV2.registryVersion,
    registryHash: hashV2,
    previousRegistryVersion: registryV1.registryVersion,
    previousRegistryHash: hashV1,
    sourceProducts: inputs.length,
    semanticUniverseProducts: inputs.length - statusCountsV2.EXCLUDED_NON_PRODUCT,
    excludedNonProducts: statusCountsV2.EXCLUDED_NON_PRODUCT,
    classificationCounts: statusCountsV2,
    deltaVsV1: {
      EXCLUDED_NON_PRODUCT: statusCountsV2.EXCLUDED_NON_PRODUCT - statusCountsV1.EXCLUDED_NON_PRODUCT,
      CLASSIFIED: statusCountsV2.CLASSIFIED - statusCountsV1.CLASSIFIED,
      PARTIALLY_CLASSIFIED: statusCountsV2.PARTIALLY_CLASSIFIED - statusCountsV1.PARTIALLY_CLASSIFIED,
      OTHER: statusCountsV2.OTHER - statusCountsV1.OTHER,
      NEEDS_REVIEW: statusCountsV2.NEEDS_REVIEW - statusCountsV1.NEEDS_REVIEW,
    },
    changeCounts,
    falsePositiveExclusions: falsePositiveExclusions.map((r) => ({ productId: r.productId })),
    unexpectedSemanticChanges: unexpectedSemanticChanges.map((r) => ({ productId: r.productId, productName: r.productName, changeType: r.changeType })),
    checksum: checksumV2,
    checksumStableAcrossRuns: checksumV2 === checksumV2Repeat,
  };
  await writeFile(path.join(args.outputDir, 'product_semantic_v2_summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.info(`[non-product-policy-v2-migration] v1 status counts: ${JSON.stringify(statusCountsV1)}`);
  console.info(`[non-product-policy-v2-migration] v2 status counts: ${JSON.stringify(statusCountsV2)}`);
  console.info(`[non-product-policy-v2-migration] changeCounts: ${JSON.stringify(changeCounts)}`);
  console.info(`[non-product-policy-v2-migration] falsePositiveExclusions: ${falsePositiveExclusions.length}`);
  console.info(`[non-product-policy-v2-migration] unexpectedSemanticChanges: ${unexpectedSemanticChanges.length}`);
  console.info(`[non-product-policy-v2-migration] v2 checksum: ${checksumV2} (stable across repeat run: ${summary.checksumStableAcrossRuns})`);
  console.info(`[non-product-policy-v2-migration] inputs=${JSON.stringify(inputPaths)}`);
  console.info(`[non-product-policy-v2-migration] outputs written to ${args.outputDir}`);
}

function countStatuses(results: readonly ProductSemanticClassificationResult[]): Record<ProductSemanticClassificationStatus, number> {
  const counts: Record<ProductSemanticClassificationStatus, number> = { CLASSIFIED: 0, PARTIALLY_CLASSIFIED: 0, OTHER: 0, EXCLUDED_NON_PRODUCT: 0, NEEDS_REVIEW: 0 };
  for (const result of results) counts[result.classificationStatus] += 1;
  return counts;
}

main().catch((error: unknown) => {
  console.error('[non-product-policy-v2-migration] Failed.', error);
  process.exitCode = 1;
});
