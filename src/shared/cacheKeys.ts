export function searchCacheKey(input: {
  query: string;
  limit: number;
  includeOutOfStock: boolean;
}): string {
  return `search:${input.query.toLowerCase().trim()}:${input.limit}:${input.includeOutOfStock ? 1 : 0}`;
}

export function productCacheKey(input: {
  shopId: number;
  productId: number;
  combinationId: number;
  quantity: number;
  customerId: number;
  customerGroupId: number;
  currencyId: number;
  countryId: number;
}): string {
  return [
    'product',
    input.shopId,
    input.productId,
    input.combinationId,
    input.quantity,
    input.customerId,
    input.customerGroupId,
    input.currencyId,
    input.countryId,
  ].join(':');
}

export function priceCacheKey(input: {
  shopId: number;
  productId: number;
  combinationId: number;
  quantity: number;
  customerId: number;
  customerGroupId: number;
  currencyId: number;
  countryId: number;
}): string {
  return [
    'price',
    input.shopId,
    input.productId,
    input.combinationId,
    input.quantity,
    input.customerId,
    input.customerGroupId,
    input.currencyId,
    input.countryId,
  ].join(':');
}

export function stockCacheKey(input: {
  shopId: number;
  productId: number;
  combinationId: number;
}): string {
  return ['stock', input.shopId, input.productId, input.combinationId].join(':');
}
