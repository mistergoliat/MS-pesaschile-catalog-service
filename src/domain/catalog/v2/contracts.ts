import { z } from 'zod';

export const catalogItemKeySchema = z.string().regex(/^P\d+(?:-V\d+)?$/u);
export const catalogProductKeySchema = z.string().regex(/^P\d+$/u);

export const catalogItemRefSchema = z.object({
  productId: z.string().regex(/^\d+$/u),
  variantId: z.string().regex(/^\d+$/u).nullable(),
}).strict();

export const catalogMoneySchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.literal('CLP'),
}).strict();

export const catalogFreshnessSchema = z.object({
  asOf: z.string().datetime(),
  cache: z.object({ hit: z.boolean(), ageMs: z.number().int().nonnegative() }).strict(),
  validUntil: z.string().datetime().nullable(),
}).strict();

export const sellabilitySchema = z.enum(['sellable', 'backorder', 'not_sellable', 'check_with_staff']);
export const sellabilityReasonSchema = z.enum([
  'in_stock',
  'backorder_allowed',
  'inactive',
  'not_listed',
  'not_orderable',
  'out_of_stock',
  'stock_unknown',
  'variant_required',
  'backorder_policy_unknown',
]);

export const catalogSearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(120),
  filters: z.object({
    categoryId: z.string().regex(/^\d+$/u).optional(),
    maxUnitPrice: z.number().int().positive().optional(),
    sellableOnly: z.boolean().default(false),
  }).strict().default({}),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

export const catalogSearchResultSchema = z.object({
  itemKey: catalogItemKeySchema,
  ref: catalogItemRefSchema,
  name: z.string(),
  sku: z.string().nullable(),
  category: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
  variants: z.object({ count: z.number().int().nonnegative(), requiresSelection: z.boolean() }).strict(),
  priceSummary: z.object({
    kind: z.enum(['exact', 'from']),
    finalGross: catalogMoneySchema,
    regularGross: catalogMoneySchema,
    discounted: z.boolean(),
  }).strict().nullable(),
  availabilitySummary: z.object({
    sellability: sellabilitySchema,
    reason: sellabilityReasonSchema,
    sellableVariants: z.number().int().nonnegative().nullable(),
  }).strict(),
  match: z.object({
    type: z.enum(['exact_reference', 'exact_name', 'name', 'description']),
    matchedTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().positive(),
  }).strict(),
}).strict();

export const catalogSearchResponseSchema = z.object({
  schemaVersion: z.literal(1),
  results: z.array(catalogSearchResultSchema).max(10),
  completeness: z.object({
    totalMatches: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).strict(),
  searchMode: z.literal('lexical'),
  freshness: catalogFreshnessSchema,
}).strict();

export const productContextRequestSchema = z.object({
  itemKey: catalogProductKeySchema,
  quantity: z.number().int().min(1).max(99).default(1),
}).strict();

const productStatusSchema = z.object({
  active: z.boolean(),
  listed: z.boolean(),
  orderable: z.boolean(),
}).strict();

const variantOptionSchema = z.object({
  itemKey: catalogItemKeySchema,
  sku: z.string().nullable(),
  attributes: z.array(z.object({ group: z.string(), value: z.string() }).strict()),
  isDefault: z.boolean(),
}).strict();

const specificationSchema = z.object({ name: z.string(), value: z.string() }).strict();

const authoritativeFactsSchema = z.object({
  name: z.string(),
  sku: z.string().nullable(),
  shortDescription: z.string().max(600).nullable(),
  category: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
  brand: z.string().nullable(),
  weightKg: z.number().nonnegative().nullable(),
  specifications: z.array(specificationSchema).max(40),
  status: productStatusSchema,
  variantOptions: z.array(variantOptionSchema).max(20),
  stock: z.object({
    availableQuantity: z.number().int().nullable(),
    scope: z.enum(['variant', 'product_total']),
  }).strict(),
}).strict();

const productPricingSchema = z.union([
  z.object({
    status: z.literal('available'),
    basis: z.object({
      taxIncluded: z.literal(true),
      taxRate: z.number().nonnegative(),
      taxBasis: z.enum(['configured_flat_rate', 'prestashop_tax_rules']),
    }).strict(),
    quantity: z.number().int().positive(),
    regularGross: catalogMoneySchema,
    finalGross: catalogMoneySchema,
    promotion: z.object({
      discountType: z.enum(['amount', 'percentage']),
      discountValue: z.number(),
      validUntil: z.string().datetime().nullable(),
    }).strict().nullable(),
    engineVersion: z.string().min(1),
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['invalid_base_price', 'variant_required']),
  }).strict(),
]);

const availabilitySchema = z.object({
  sellability: sellabilitySchema,
  reason: sellabilityReasonSchema,
  leadTime: z.null(),
}).strict();

const inferredSchema = z.object({
  frequentlyBoughtTogether: z.union([
    z.object({
      status: z.literal('available'),
      snapshotId: z.string().min(1),
      builtAt: z.string().datetime(),
      items: z.array(z.object({
        itemKey: catalogItemKeySchema,
        name: z.string(),
        confidence: z.number(),
        jointCount: z.number().int().nonnegative(),
      }).strict()).max(5),
    }).strict(),
    z.object({
      status: z.literal('unavailable'),
      reason: z.enum(['snapshot_unavailable', 'not_supported']),
    }).strict(),
  ]),
}).strict();

const provenanceSchema = z.object({
  source: z.literal('prestashop'),
  service: z.literal('catalog-service'),
  serviceBuildRef: z.string().min(1),
  sourceUpdatedAt: z.string().datetime().nullable(),
}).strict();

export const productContextNotFoundSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('not_found'),
  itemKey: catalogProductKeySchema,
}).strict();

export const productContextFoundSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('found'),
  itemKey: catalogProductKeySchema,
  ref: catalogItemRefSchema,
  facts: authoritativeFactsSchema,
  derived: z.object({
    pricing: productPricingSchema,
    availability: availabilitySchema,
    publicUrl: z.string().url().nullable(),
  }).strict(),
  inferred: inferredSchema,
  provenance: provenanceSchema,
  freshness: catalogFreshnessSchema,
}).strict();

export const productContextResponseSchema = z.union([
  productContextNotFoundSchema,
  productContextFoundSchema,
]);

export const itemContextRequestSchema = z.object({
  itemKey: catalogItemKeySchema,
  quantity: z.number().int().min(1).max(99).default(1),
}).strict();

const itemPricingSchema = z.union([
  z.object({
    status: z.literal('available'),
    quantity: z.number().int().positive(),
    regularGross: catalogMoneySchema,
    finalGross: catalogMoneySchema,
    promotion: z.object({
      discountType: z.enum(['amount', 'percentage']),
      discountValue: z.number(),
      validUntil: z.string().datetime().nullable(),
    }).strict().nullable(),
    tax: z.object({
      included: z.literal(true),
      rate: z.number().nonnegative(),
      basis: z.enum(['configured_flat_rate', 'prestashop_tax_rules']),
    }).strict(),
    engineVersion: z.string().min(1),
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['invalid_base_price', 'variant_required']),
  }).strict(),
]);

const itemContextResponseBaseSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('found'),
  itemKey: catalogItemKeySchema,
  ref: catalogItemRefSchema,
  parentProduct: z.object({
    productKey: catalogProductKeySchema,
    name: z.string(),
    sku: z.string().nullable(),
  }).strict(),
  variant: z.object({
    variantId: z.string().nullable(),
    sku: z.string().nullable(),
    attributes: z.array(z.object({ group: z.string(), value: z.string() }).strict()),
  }).strict(),
  pricing: itemPricingSchema,
  availability: z.object({
    availableQuantity: z.number().int().nullable(),
    sellability: sellabilitySchema,
    reason: sellabilityReasonSchema,
    leadTime: z.null(),
  }).strict(),
  freshness: catalogFreshnessSchema,
  provenance: provenanceSchema,
}).strict();

export const itemContextNotFoundSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('not_found'),
  itemKey: catalogItemKeySchema,
}).strict();

export const itemContextResponseSchema = z.union([itemContextNotFoundSchema, itemContextResponseBaseSchema]);

export type CatalogItemRef = z.infer<typeof catalogItemRefSchema>;
export type CatalogSearchRequest = z.infer<typeof catalogSearchRequestSchema>;
export type CatalogSearchResponse = z.infer<typeof catalogSearchResponseSchema>;
export type ProductContextResponse = z.infer<typeof productContextResponseSchema>;
export type ItemContextResponse = z.infer<typeof itemContextResponseSchema>;

export type CatalogV2SpecificPrice = {
  idSpecificPrice: number;
  combinationId: number;
  shopId: number;
  currencyId: number;
  countryId: number;
  groupId: number;
  customerId: number;
  cartId: number;
  price: number;
  fromQuantity: number;
  reduction: number;
  reductionTax: number;
  reductionType: string;
  from: string | Date | null;
  to: string | Date | null;
};

export type CatalogV2Variant = {
  combinationId: number;
  sku: string | null;
  attributes: Array<{ group: string; value: string }>;
  impactPriceNet: number;
  isDefault: boolean;
  availableQuantity: number | null;
  outOfStock: number | null;
};

export type CatalogV2Product = {
  productId: number;
  basePriceNet: number | null;
  name: string;
  sku: string | null;
  shortDescription: string | null;
  brand: string | null;
  weightKg: number | null;
  linkRewrite: string | null;
  category: { id: string; name: string } | null;
  active: boolean | null;
  listed: boolean | null;
  orderable: boolean | null;
  variants: CatalogV2Variant[];
  specifications: Array<{ name: string; value: string }>;
  globalBackorderAllowed: boolean | null;
  specificPrices: CatalogV2SpecificPrice[];
  asOf: string;
};

export type CatalogV2DataReader = {
  readProducts(input: { productIds?: readonly number[]; query?: string }): Promise<{
    products: CatalogV2Product[];
    asOf: string;
  }>;
};

export type FrequentlyBoughtTogetherProvider = {
  getForProduct(productId: number, limit: number): {
    snapshotId: string;
    builtAt: string;
    items: Array<{ productId: number; name: string; confidence: number; jointCount: number }>;
  } | null;
};
