export type DiscoveryExcludedProduct = {
  readonly productId: number;
  readonly name: string;
  readonly reason: 'known_internal_product';
};

export const DISCOVERY_EXCLUDED_PRODUCTS: readonly DiscoveryExcludedProduct[] = Object.freeze([
  { productId: 444, name: 'Servicio vendedor Pesas Chile', reason: 'known_internal_product' },
  { productId: 505, name: 'Costo logistico', reason: 'known_internal_product' },
]);

export const DISCOVERY_EXCLUDED_PRODUCT_IDS: readonly number[] = Object.freeze(
  DISCOVERY_EXCLUDED_PRODUCTS.map((product) => product.productId),
);

const DISCOVERY_EXCLUDED_PRODUCT_ID_SET = new Set<number>(DISCOVERY_EXCLUDED_PRODUCT_IDS);

export function isDiscoveryExcludedProductId(productId: number | string): boolean {
  const parsed = typeof productId === 'number' ? productId : Number(productId);
  return Number.isSafeInteger(parsed) && DISCOVERY_EXCLUDED_PRODUCT_ID_SET.has(parsed);
}
