import type { CatalogCommercialProductReference } from './contracts.js';

export type CatalogCommercialProductIdentity = string;

export function createCatalogCommercialProductIdentity(
  product: CatalogCommercialProductReference,
): CatalogCommercialProductIdentity {
  if (product.productId.trim().length === 0) {
    throw new Error('productId is required');
  }
  if (product.combinationId !== undefined && product.combinationId.trim().length === 0) {
    throw new Error('combinationId cannot be empty');
  }
  return `${product.productId}::${product.combinationId ?? '<base>'}`;
}
