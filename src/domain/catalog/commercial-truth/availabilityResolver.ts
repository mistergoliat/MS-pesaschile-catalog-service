import type { CatalogCommercialAvailability, CatalogCommercialRawProduct } from './contracts.js';

export class CommercialAvailabilityResolver {
  resolve(product: CatalogCommercialRawProduct, evaluatedAt: string): CatalogCommercialAvailability {
    if (product.active === false) {
      return {
        status: 'inactive',
        purchasable: false,
        active: false,
        availableForOrder: product.availableForOrder === true,
        stockQuantity: normalizeStock(product.stockQuantity),
        stockKnown: product.stockQuantity !== null,
        evaluatedAt,
      };
    }

    if (product.active !== true || product.availableForOrder === null) {
      return {
        status: 'unknown',
        purchasable: false,
        active: product.active === true,
        availableForOrder: product.availableForOrder === true,
        stockQuantity: normalizeStock(product.stockQuantity),
        stockKnown: product.stockQuantity !== null,
        evaluatedAt,
      };
    }

    if (!product.availableForOrder) {
      return {
        status: 'unavailable_for_order',
        purchasable: false,
        active: true,
        availableForOrder: false,
        stockQuantity: normalizeStock(product.stockQuantity),
        stockKnown: product.stockQuantity !== null,
        evaluatedAt,
      };
    }

    if (product.stockQuantity === null || !Number.isFinite(product.stockQuantity)) {
      return {
        status: 'unknown',
        purchasable: false,
        active: true,
        availableForOrder: true,
        stockQuantity: null,
        stockKnown: false,
        evaluatedAt,
      };
    }

    if (product.stockQuantity > 0) {
      return {
        status: 'available',
        purchasable: true,
        active: true,
        availableForOrder: true,
        stockQuantity: Math.trunc(product.stockQuantity),
        stockKnown: true,
        evaluatedAt,
      };
    }

    return {
      status: 'out_of_stock',
      purchasable: false,
      active: true,
      availableForOrder: true,
      stockQuantity: Math.trunc(product.stockQuantity),
      stockKnown: true,
      evaluatedAt,
    };
  }
}

function normalizeStock(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}
