import { readFile } from 'node:fs/promises';
import type { TrainingSemanticClassificationInput } from '../../../src/domain/training-semantic-classification/index.js';
import { classifyProduct } from '../../../src/domain/product-semantic-classification/index.js';
import { loadProductSemanticClassificationInputs } from '../../product-semantic-classification/lib/load-input.js';
import { parseCsvRecords } from '../../product-semantic-classification/lib/csv.js';

export async function loadTrainingSemanticClassificationInputs(args: {
  readonly catalogCsvPath: string;
  readonly categoryTrustMapCsvPath: string;
  readonly featureTrustMapCsvPath: string;
}): Promise<{ readonly inputs: readonly TrainingSemanticClassificationInput[]; readonly warnings: readonly string[] }> {
  const [{ inputs: baseInputs, warnings }, catalogText] = await Promise.all([
    loadProductSemanticClassificationInputs(args),
    readFile(args.catalogCsvPath, 'utf8'),
  ]);
  const revenueByProductId = new Map<string, number | null>();
  for (const record of parseCsvRecords(catalogText)) {
    const rawRevenue = record.totalRevenueTaxIncl?.trim() ?? '';
    const revenue = rawRevenue.length > 0 && Number.isFinite(Number(rawRevenue)) ? Number(rawRevenue) : null;
    revenueByProductId.set(record.productId ?? '', revenue);
  }

  return {
    inputs: baseInputs.map((input) => {
      const commercialClassification = classifyProduct(input);
      return {
        productId: Number(input.productId),
        name: input.productName,
        productFamily: commercialClassification.primaryProductFamily?.code ?? null,
        activeStatus: input.activeStatus,
        catalogPresence: input.catalogPresence,
        revenue: revenueByProductId.get(input.productId) ?? null,
        categories: input.categories,
        features: input.features,
      };
    }).filter((input) => Number.isInteger(input.productId) && input.productId > 0),
    warnings,
  };
}

