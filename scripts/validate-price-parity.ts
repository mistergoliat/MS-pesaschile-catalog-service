import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { getProduct } from '../client/catalogClient.js';

const [casesPath] = process.argv.slice(2);
if (!casesPath) {
  console.error('Usage: npm run validate:prices -- <cases.json>');
  process.exit(1);
}

const baseUrl = (process.env.CATALOG_SERVICE_URL ?? 'http://localhost:4010').replace(/\/$/, '');
const apiKey = process.env.CATALOG_SERVICE_API_KEY ?? process.env.API_KEY ?? '';

const cases = JSON.parse(await readFile(casesPath, 'utf8')) as Array<{
  productId: number;
  combinationId?: number;
  quantity: number;
  expectedStorefrontPrice: number;
}>;

const context = {
  baseUrl,
  apiKey,
  timeoutMs: 8000,
};

let failures = 0;

for (const testCase of cases) {
  try {
    const result = await getProduct(
      {
        productId: testCase.productId,
        combinationId: testCase.combinationId,
        quantity: testCase.quantity,
      },
      context,
    );
    const actual = result.pricing?.effectiveUnitPrice;
    if (actual !== testCase.expectedStorefrontPrice) {
      failures += 1;
      console.error(
        JSON.stringify(
          {
            productId: testCase.productId,
            combinationId: testCase.combinationId ?? 0,
            quantity: testCase.quantity,
            expectedStorefrontPrice: testCase.expectedStorefrontPrice,
            actualStorefrontPrice: actual,
          },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    failures += 1;
    console.error(
      JSON.stringify(
        {
          productId: testCase.productId,
          combinationId: testCase.combinationId ?? 0,
          quantity: testCase.quantity,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
  }
}

process.exit(failures === 0 ? 0 : 1);
