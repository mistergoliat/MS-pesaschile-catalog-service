import { classifyProducts, computeClassificationChecksum } from '../../../src/domain/product-semantic-classification/index.js';
import type {
  ProductSemanticClassificationInput,
  ProductSemanticClassificationResult,
} from '../../../src/domain/product-semantic-classification/index.js';
import { loadProductSemanticClassificationInputs } from './load-input.js';
import type { ProductSemanticInputPaths } from './fixture-paths.js';
import { buildClassificationSummary, type ClassificationSummary } from './summary.js';

export type ProductSemanticClassificationRun = {
  readonly inputs: readonly ProductSemanticClassificationInput[];
  readonly results: readonly ProductSemanticClassificationResult[];
  readonly summary: ClassificationSummary;
  readonly checksum: string;
  readonly loaderWarnings: readonly string[];
};

export async function runProductSemanticClassification(paths: ProductSemanticInputPaths): Promise<ProductSemanticClassificationRun> {
  const { inputs, warnings: loaderWarnings } = await loadProductSemanticClassificationInputs(paths);
  const results = classifyProducts(inputs);
  const catalogPresenceById = new Map(inputs.map((input) => [input.productId, input.catalogPresence] as const));
  return {
    inputs,
    results,
    summary: buildClassificationSummary(results, catalogPresenceById),
    checksum: computeClassificationChecksum(results),
    loaderWarnings,
  };
}
