import type { JsonValue } from '../../recommendation/relationship-engine/publication/contracts.js';

export type CatalogCommercialProductReference = {
  readonly productId: string;
  readonly combinationId?: string;
};

export type CatalogCommercialContext = {
  readonly shopId: number;
  readonly currencyId: number;
  readonly currencyCode: string;
  readonly countryId: number;
  readonly customerGroupId: number;
  readonly customerId: number;
  readonly quantity: number;
  readonly taxRate: number;
};

export type CatalogCommercialTruthRequest = {
  readonly products: readonly CatalogCommercialProductReference[];
  readonly context: CatalogCommercialContext;
  readonly correlationId?: string;
};

export type CatalogCommercialWarningCode =
  | 'CATALOG_PRICE_UNAVAILABLE'
  | 'CATALOG_INVALID_BASE_PRICE'
  | 'CATALOG_COMMERCIAL_STATUS_UNKNOWN'
  | 'SPECIFIC_PRICE_INVALID_DATE'
  | 'SPECIFIC_PRICE_INVALID_REDUCTION'
  | 'SPECIFIC_PRICE_UNSUPPORTED_REDUCTION_TYPE'
  | 'SPECIFIC_PRICE_EXCEEDS_BASE_PRICE'
  | 'SPECIFIC_PRICE_CONTEXT_UNSUPPORTED'
  | 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS';

export type CatalogCommercialWarning = {
  readonly code: CatalogCommercialWarningCode;
  readonly product?: CatalogCommercialProductReference;
  readonly details?: JsonValue;
};

export type CatalogAvailabilityStatus =
  | 'available'
  | 'out_of_stock'
  | 'inactive'
  | 'unavailable_for_order'
  | 'unknown';

export type CatalogCommercialAvailability = {
  readonly status: CatalogAvailabilityStatus;
  readonly purchasable: boolean;
  readonly active: boolean;
  readonly availableForOrder: boolean;
  readonly stockQuantity: number | null;
  readonly stockKnown: boolean;
  readonly evaluatedAt: string;
};

export type CatalogCommercialPrice = {
  readonly baseGrossAmount: number;
  readonly finalGrossAmount: number;
  readonly currency: string;
  readonly taxIncluded: true;
  readonly taxRate: number;
  readonly discountApplied: boolean;
  readonly discountType: 'percentage' | 'amount' | null;
  readonly discountValue: number | null;
  readonly specificPriceId: number | null;
  readonly evaluatedAt: string;
};

export type CatalogCommercialProduct = {
  readonly productId: string;
  readonly combinationId?: string;
  readonly name: string;
  readonly reference?: string;
  readonly description?: string;
  readonly category?: string;
  readonly productUrl?: string;
  readonly imageUrl?: string;
  readonly availability: CatalogCommercialAvailability;
  readonly price: CatalogCommercialPrice | null;
  readonly warnings: readonly CatalogCommercialWarning[];
};

export type CatalogCommercialTruthResult = {
  readonly productsByIdentity: ReadonlyMap<string, CatalogCommercialProduct>;
  readonly warnings: readonly CatalogCommercialWarning[];
  readonly statistics: {
    readonly requested: number;
    readonly resolved: number;
    readonly missing: number;
    readonly inactive: number;
    readonly unavailableForOrder: number;
    readonly outOfStock: number;
    readonly priceUnavailable: number;
    readonly warningsGenerated: number;
  };
  readonly evaluatedAt: string;
};

export type CatalogCommercialRawProduct = {
  readonly productId: number;
  readonly combinationId: number;
  readonly name: string;
  readonly productReference: string | null;
  readonly combinationReference: string | null;
  readonly description: string | null;
  readonly category: string | null;
  readonly active: boolean | null;
  readonly availableForOrder: boolean | null;
  readonly productBasePriceNet: number | null;
  readonly combinationImpactNet: number | null;
  readonly stockQuantity: number | null;
};

export type CatalogCommercialSpecificPrice = {
  readonly idSpecificPrice: number;
  readonly productId: number;
  readonly combinationId: number;
  readonly shopId: number;
  readonly currencyId: number;
  readonly countryId: number;
  readonly groupId: number;
  readonly customerId: number;
  readonly cartId: number;
  readonly price: number;
  readonly fromQuantity: number;
  readonly reduction: number;
  readonly reductionTax: number;
  readonly reductionType: string;
  readonly from: string | Date | null;
  readonly to: string | Date | null;
};

export type CatalogCommercialData = {
  readonly products: readonly CatalogCommercialRawProduct[];
  readonly specificPrices: readonly CatalogCommercialSpecificPrice[];
};

export interface CatalogCommercialDataReader {
  read(input: {
    readonly products: readonly CatalogCommercialProductReference[];
    readonly context: CatalogCommercialContext;
  }): Promise<CatalogCommercialData>;
}

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
