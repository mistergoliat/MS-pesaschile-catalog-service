import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PRODUCT_SEMANTIC_FIXTURE_INPUT_DIR = path.resolve(LIB_DIR, '../../../docs/audits/product-intelligence-exploration/inputs');
export const PRODUCT_SEMANTIC_GOLDEN_SET_OUTPUT_DIR = path.resolve(LIB_DIR, '../../../docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review');

type ProductSemanticInputPathOptions = {
  readonly inputDir?: string;
  readonly catalogCsvPath?: string;
  readonly categoryTrustMapCsvPath?: string;
  readonly featureTrustMapCsvPath?: string;
};

export type ProductSemanticInputPaths = {
  readonly inputDir: string;
  readonly catalogCsvPath: string;
  readonly categoryTrustMapCsvPath: string;
  readonly featureTrustMapCsvPath: string;
};

async function resolveCsvByPrefix(inputDir: string, prefix: string): Promise<string> {
  const entries = await readdir(inputDir);
  const match = entries.find((entry) => entry.startsWith(prefix) && entry.endsWith('.csv'));
  if (!match) {
    throw new Error(`No file starting with "${prefix}" found in ${inputDir}`);
  }
  return path.join(inputDir, match);
}

export async function resolveProductSemanticInputPaths(options: ProductSemanticInputPathOptions = {}): Promise<ProductSemanticInputPaths> {
  const inputDir = path.resolve(options.inputDir ?? PRODUCT_SEMANTIC_FIXTURE_INPUT_DIR);

  const [catalogCsvPath, categoryTrustMapCsvPath, featureTrustMapCsvPath] = await Promise.all([
    options.catalogCsvPath ? path.resolve(options.catalogCsvPath) : resolveCsvByPrefix(inputDir, 'product_catalog_exploration'),
    options.categoryTrustMapCsvPath ? path.resolve(options.categoryTrustMapCsvPath) : resolveCsvByPrefix(inputDir, 'category_trust_map'),
    options.featureTrustMapCsvPath ? path.resolve(options.featureTrustMapCsvPath) : resolveCsvByPrefix(inputDir, 'feature_trust_map'),
  ]);

  return {
    inputDir,
    catalogCsvPath,
    categoryTrustMapCsvPath,
    featureTrustMapCsvPath,
  };
}

export function resolveGoldenSetClosureCsvPath(closureCsvPath?: string): string {
  return path.resolve(closureCsvPath ?? path.join(PRODUCT_SEMANTIC_GOLDEN_SET_OUTPUT_DIR, 'ontology_review_closure.csv'));
}
