import type { AttributeValue, ProductCore, SearchItem, VariantSummary } from './types.js';

export type SearchProvider = {
  search(query: string, limit: number, includeOutOfStock: boolean): Promise<SearchItem[]>;
};

export type StockProvider = {
  getStock(productId: number, combinationId: number): Promise<{
    physicalQuantity: number;
    available: boolean;
    shopId: number;
  }>;
  getVariantStocks(productId: number): Promise<Array<{ combinationId: number; physicalQuantity: number; available: boolean; shopId: number }>>;
};

export type PricingProvider = {
  quote(input: {
    productId: number;
    combinationId: number;
    quantity: number;
    customerId: number;
    customerGroupId: number;
    currencyId: number;
    countryId: number;
  }): Promise<{
    quantity: number;
    baseUnitPrice: number;
    effectiveUnitPrice: number;
    subtotal: number;
    currency: string;
    taxIncluded: true;
    taxMode: 'configured_rate';
    discountApplied: boolean;
    discountType: 'amount' | 'percentage' | null;
    discountValue: number | null;
    specificPriceId: number | null;
    pricingMode: 'sql_specific_price';
  }>;
};

export type CatalogRepository = {
  ping(): Promise<void>;
  getProductCore(productId: number): Promise<ProductCore | null>;
  getVariants(productId: number): Promise<VariantSummary[]>;
  getVariant(productId: number, combinationId: number): Promise<VariantSummary | null>;
  getVariantAttributes(combinationId: number): Promise<AttributeValue[]>;
  getVariantAttributesMap(productId: number): Promise<Map<number, AttributeValue[]>>;
  getSearchCandidates(query: string, includeOutOfStock: boolean, limit: number): Promise<SearchCandidate[]>;
  getBasePrices(productId: number, combinationId: number): Promise<{ productPrice: number; combinationImpact: number }>;
  getSpecificPrices(input: {
    productId: number;
    combinationId: number;
    quantity: number;
    shopId: number;
    currencyId: number;
    countryId: number;
    customerGroupId: number;
    customerId: number;
  }): Promise<SpecificPriceRow[]>;
  getStock(productId: number, combinationId: number): Promise<{ physicalQuantity: number; shopId: number } | null>;
  getStockForProduct(productId: number): Promise<Array<{ combinationId: number; physicalQuantity: number; shopId: number }>>;
  getDefaultCombinationId(productId: number): Promise<number | null>;
};

export type SearchCandidate = {
  productId: number;
  combinationId: number;
  productSku: string | null;
  combinationSku: string | null;
  productName: string;
  shortDescription: string | null;
  longDescription: string | null;
  variantLabel: string | null;
  physicalQuantity: number;
  hasVariants: boolean;
  isDefault: boolean;
  active: boolean;
};

export type SpecificPriceRow = {
  id_specific_price: number;
  id_product_attribute: number;
  id_shop: number;
  id_currency: number;
  id_country: number;
  id_group: number;
  id_customer: number;
  price: number;
  from_quantity: number;
  reduction: number;
  reduction_tax: number;
  reduction_type: 'amount' | 'percentage';
  from: string | Date | null;
  to: string | Date | null;
  priority?: number | null;
};
