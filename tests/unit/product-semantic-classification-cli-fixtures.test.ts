import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  PRODUCT_SEMANTIC_FIXTURE_INPUT_DIR,
  resolveGoldenSetClosureCsvPath,
  resolveProductSemanticInputPaths,
} from '../../scripts/product-semantic-classification/lib/fixture-paths.js';

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../..');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLASSIFY_SUMMARY_PATH = path.join(REPO_ROOT, 'scripts/product-semantic-classification/outputs/product_semantic_classification_summary.json');
const V2_SUMMARY_PATH = path.join(REPO_ROOT, 'scripts/product-semantic-classification/outputs/product_semantic_v2_summary.json');

describe.sequential('Product semantic CLI fixture resolution', () => {
  it('resolves local fixture paths with zero explicit arguments and never points to customer-profile', async () => {
    const resolved = await resolveProductSemanticInputPaths();
    const closureCsvPath = resolveGoldenSetClosureCsvPath();

    expect(resolved.inputDir).toBe(PRODUCT_SEMANTIC_FIXTURE_INPUT_DIR);
    expect(resolved.catalogCsvPath).toContain('product_catalog_exploration');
    expect(resolved.categoryTrustMapCsvPath).toContain('category_trust_map');
    expect(resolved.featureTrustMapCsvPath).toContain('feature_trust_map');
    expect(closureCsvPath).toContain('ontology_review_closure.csv');

    for (const value of [resolved.inputDir, resolved.catalogCsvPath, resolved.categoryTrustMapCsvPath, resolved.featureTrustMapCsvPath, closureCsvPath]) {
      expect(value).toContain('MS-pesaschile-catalog-service');
      expect(value.toLowerCase()).not.toContain('customer-profile');
      await access(value);
    }
  });

  it('the zero-arg classify command resolves local fixtures and produces the expected v3 counts', async () => {
    await execFileAsync(process.execPath, [TSX_CLI, 'scripts/product-semantic-classification/classify-catalog.ts'], { cwd: REPO_ROOT });

    const summary = JSON.parse(await readFile(CLASSIFY_SUMMARY_PATH, 'utf8')) as {
      registryVersion: string;
      sourceProductCount: number;
      excludedNonProductCount: number;
      statusCounts: Record<string, number>;
    };

    expect(summary.registryVersion).toBe('commercial-product-ontology-v3');
    expect(summary.sourceProductCount).toBe(2011);
    expect(summary.excludedNonProductCount).toBe(13);
    expect(summary.statusCounts).toEqual({
      CLASSIFIED: 1281,
      PARTIALLY_CLASSIFIED: 400,
      OTHER: 317,
      EXCLUDED_NON_PRODUCT: 13,
      NEEDS_REVIEW: 0,
    });
  }, 10_000);

  it('the zero-arg v2 migration audit resolves local fixtures and reports zero unexpected semantic changes', async () => {
    await execFileAsync(process.execPath, [TSX_CLI, 'scripts/product-semantic-classification/non-product-policy-v2-migration.ts'], { cwd: REPO_ROOT });

    const summary = JSON.parse(await readFile(V2_SUMMARY_PATH, 'utf8')) as {
      sourceProducts: number;
      semanticUniverseProducts: number;
      excludedNonProducts: number;
      classificationCounts: Record<string, number>;
      changeCounts: Record<string, number>;
      falsePositiveExclusions: unknown[];
      unexpectedSemanticChanges: unknown[];
    };

    expect(summary.sourceProducts).toBe(2011);
    expect(summary.semanticUniverseProducts).toBe(1998);
    expect(summary.excludedNonProducts).toBe(13);
    expect(summary.classificationCounts).toEqual({
      CLASSIFIED: 1276,
      PARTIALLY_CLASSIFIED: 400,
      OTHER: 322,
      EXCLUDED_NON_PRODUCT: 13,
      NEEDS_REVIEW: 0,
    });
    expect(summary.changeCounts.UNEXPECTED_SEMANTIC_CHANGE).toBe(0);
    expect(summary.falsePositiveExclusions).toEqual([]);
    expect(summary.unexpectedSemanticChanges).toEqual([]);
  }, 10_000);
});
