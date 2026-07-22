import { productRelationshipProductReferenceSchema, type ProductRelationshipProductReference } from '../contracts.js';
import type { ProductRuntimeIdentity } from './contracts.js';
import { ProductRelationshipRuntimeError } from './errors.js';

const BASE_COMBINATION_IDENTITY = '<base>';

function encodeIdentityComponent(value: string): string {
  return encodeURIComponent(value);
}

export function createProductRuntimeIdentity(product: ProductRelationshipProductReference): ProductRuntimeIdentity {
  const parsed = productRelationshipProductReferenceSchema.safeParse(product);
  if (!parsed.success) {
    throw new ProductRelationshipRuntimeError('INVALID_RUNTIME_QUERY', 'Product reference is invalid');
  }

  return [
    encodeIdentityComponent(parsed.data.productId),
    parsed.data.combinationId === undefined
      ? BASE_COMBINATION_IDENTITY
      : encodeIdentityComponent(parsed.data.combinationId),
  ].join('::');
}

export const productRuntimeIdentityConstants = {
  baseCombinationIdentity: BASE_COMBINATION_IDENTITY,
} as const;
