import type { ProductIntentReference } from './contracts.js';

export function createProductIntentIdentity(product: ProductIntentReference): string {
  return `${product.productId}::${product.combinationId ?? '<base>'}`;
}
