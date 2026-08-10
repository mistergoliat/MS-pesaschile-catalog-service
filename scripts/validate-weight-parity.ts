import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { getProduct } from '../client/catalogClient.js';

const [casesPath] = process.argv.slice(2);
if (!casesPath) {
  console.error('Usage: npm run validate:weight -- <cases.json>');
  process.exit(1);
}

const baseUrl = (process.env.CATALOG_SERVICE_URL ?? 'http://localhost:4010').replace(/\/$/, '');
const apiKey = process.env.CATALOG_SERVICE_API_KEY ?? process.env.API_KEY ?? '';

const cases = JSON.parse(await readFile(casesPath, 'utf8')) as Array<{
  productId: number;
  combinationId?: number;
  quantity?: number;
  expectedWeightKg: number | null;
}>;

const context = {
  baseUrl,
  apiKey,
  timeoutMs: 8000,
};

let failures = 0;
const results: unknown[] = [];

for (const testCase of cases) {
  try {
    const result = await getProduct(
      {
        productId: testCase.productId,
        combinationId: testCase.combinationId,
        quantity: testCase.quantity ?? 1,
      },
      context,
    );
    const actual = result.weightKg;
    const match = actual === testCase.expectedWeightKg;
    if (!match) failures += 1;
    results.push({
      productId: testCase.productId,
      combinationId: testCase.combinationId ?? 0,
      expectedWeightKg: testCase.expectedWeightKg,
      serviceWeightKg: actual,
      match,
    });
  } catch (error) {
    failures += 1;
    results.push({
      productId: testCase.productId,
      combinationId: testCase.combinationId ?? 0,
      expectedWeightKg: testCase.expectedWeightKg,
      serviceWeightKg: null,
      match: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify(results, null, 2));
process.exit(failures === 0 ? 0 : 1);
