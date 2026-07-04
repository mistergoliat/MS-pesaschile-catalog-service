import 'dotenv/config';
import { getProduct, searchProducts } from '../client/catalogClient.js';

const baseUrl = (process.env.CATALOG_SERVICE_URL ?? 'http://localhost:4010').replace(/\/$/, '');
const apiKey = process.env.CATALOG_SERVICE_API_KEY ?? process.env.API_KEY ?? '';
const query = process.argv.slice(2).join(' ') || 'disco bumper';

const context = {
  baseUrl,
  apiKey,
  timeoutMs: 8000,
};

const search = await searchProducts({ query, limit: 5 }, context);
console.log(JSON.stringify(search, null, 2));

if (search.items[0]) {
  const product = await getProduct(
    {
      productId: search.items[0].productId,
      combinationId: search.items[0].combinationId,
      quantity: 1,
    },
    context,
  );
  console.log(JSON.stringify(product, null, 2));
}

process.exit(0);
