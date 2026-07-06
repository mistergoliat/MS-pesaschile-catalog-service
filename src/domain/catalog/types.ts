export type CatalogScope = {
  shopId: number;
  langId: number;
};

export type ProductCore = {
  productId: number;
  name: string;
  sku: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  active: boolean;
};

export type AttributeValue = {
  group: string;
  value: string;
};

export type VariantSummary = {
  combinationId: number;
  sku: string | null;
  label: string | null;
  attributes: AttributeValue[];
  impactPrice: number;
  physicalQuantity: number;
  available: boolean;
  isDefault: boolean;
};

export type SearchMatchType = 'exact_sku' | 'exact_name' | 'partial_name' | 'description';

export type SearchItem = {
  productId: number;
  combinationId: number;
  sku: string | null;
  name: string;
  variantLabel: string | null;
  shortDescription: string | null;
  physicalQuantity: number;
  available: boolean;
  matchType: SearchMatchType;
};

export type ProductDetail = {
  product: ProductCore;
  selectedVariant: Pick<VariantSummary, 'combinationId' | 'sku' | 'label' | 'attributes'> | null;
  attributes: AttributeValue[];
  variants: VariantSummary[];
  pricing: ProductPricing | null;
  stock: ProductStock | null;
  freshness: {
    productCheckedAt: string;
    priceCalculatedAt: string | null;
    stockCheckedAt: string | null;
    cached: boolean;
  };
};

export type ProductPricing = {
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
};

export type ProductStock = {
  physicalQuantity: number;
  available: boolean;
  shopId: number;
};

export type BatchGetInput = {
  productId: number;
  combinationId: number;
  quantity: number;
};

export type BatchGetItemResult =
  | { ok: true; input: BatchGetInput; product: ProductDetail }
  | {
      ok: false;
      input: BatchGetInput;
      error: { code: string; message: string; correlationId: string };
    };
