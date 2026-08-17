export type PriceContext = {
  productId: number;
  combinationId: number;
  quantity: number;
  shopId: number;
  currencyId: number;
  countryId: number;
  customerGroupId: number;
  customerId: number;
  currencyCode: string;
  taxRate: number;
};

export type SpecificPriceCandidate = {
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

export type PriceResolution = {
  quantity: number;
  baseUnitPrice: number;
  effectiveUnitPrice: number;
  subtotal: number;
  currency: string;
  taxIncluded: true;
  /**
   * SALES-AGENT-R1-T1.1: the exact rate already applied above to derive
   * baseUnitPrice/effectiveUnitPrice from the tax-excluded catalog price -
   * never a second, independently-read value. Same single configured-rate
   * source (config.pricing.taxRate) the commercial-truth pricing model
   * (domain/catalog/commercial-truth) already exposes as CatalogCommercialPrice.taxRate.
   */
  taxRate: number;
  taxMode: 'configured_rate';
  discountApplied: boolean;
  discountType: 'amount' | 'percentage' | null;
  discountValue: number | null;
  specificPriceId: number | null;
  pricingMode: 'sql_specific_price';
};
