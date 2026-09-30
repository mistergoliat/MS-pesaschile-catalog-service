import { z } from 'zod';

/*
 * Identity invariant (R4-J1C, frozen for schemaVersion 1):
 *   productKey = PRODUCT identity (`P{id}`): search results, product context,
 *                frequently-bought-together items and a variant_required answer.
 *   itemKey    = SELLABLE ITEM identity: `P{id}` ONLY for a product without
 *                variants, `P{id}-V{variantId}` for a concrete variant. It is
 *                emitted only by `facts.sellableItem`, `facts.variantOptions`
 *                and the item context.
 * A product-level object never carries an `itemKey`, and `P{id}` of a product
 * with variants is never a sellable item (item context answers
 * `variant_required`). Consumers treat both keys as opaque.
 */
export const catalogItemKeySchema = z.string().regex(/^P\d+(?:-V\d+)?$/u);
export const catalogProductKeySchema = z.string().regex(/^P\d+$/u);

const numericIdSchema = z.string().regex(/^\d+$/u);

/** Internal ids of a product (product-level objects). */
export const catalogProductRefSchema = z.object({
  productId: numericIdSchema,
}).strict();

/** Internal ids of a sellable item: `variantId` is null only for a product without variants. */
export const catalogItemRefSchema = z.object({
  productId: numericIdSchema,
  variantId: numericIdSchema.nullable(),
}).strict();

/*
 * Text bounds follow the PrestaShop source columns (product_lang.name 128,
 * reference 64, category_lang.name 128, manufacturer.name 64,
 * feature_lang.name 128, feature_value_lang.value 255, attribute names 128).
 * They are part of the contract: consumers reject, never truncate.
 */
const nameText = z.string().min(1).max(128);
const skuText = z.string().min(1).max(64);
const categorySchema = z.object({ id: numericIdSchema, name: nameText }).strict();
const attributeSchema = z.object({ group: nameText, value: nameText }).strict();
export const CATALOG_V2_MAX_VARIANT_OPTIONS = 100;

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

/**
 * Product-level price (OD-1): `exact` for a product without variants; `from`
 * = the minimum final price over the product's priced variants.
 * `basis: offerable` — computed only over units that can be ordered now
 * (sellability `sellable` or `backorder`); a unit that cannot be ordered never
 * lowers the advertised price.
 * `basis: not_offerable` — explicit fallback when NO priced unit is offerable:
 * the minimum over all priced units, a reference price, never an offer.
 */
export const catalogPriceSummarySchema = z.object({
  kind: z.enum(['exact', 'from']),
  basis: z.enum(['offerable', 'not_offerable']),
  finalGross: catalogMoneySchema,
  regularGross: catalogMoneySchema,
  discounted: z.boolean(),
}).strict();

/** Product-level availability: the best variant's sellability, and how many variants are sellable (null without variants). */
export const catalogAvailabilitySummarySchema = z.object({
  sellability: sellabilitySchema,
  reason: sellabilityReasonSchema,
  sellableVariants: z.number().int().nonnegative().nullable(),
}).strict();

export const catalogSearchResultSchema = z.object({
  productKey: catalogProductKeySchema,
  ref: catalogProductRefSchema,
  name: nameText,
  sku: skuText.nullable(),
  category: categorySchema.nullable(),
  variants: z.object({ count: z.number().int().nonnegative(), requiresSelection: z.boolean() }).strict(),
  priceSummary: catalogPriceSummarySchema.nullable(),
  availabilitySummary: catalogAvailabilitySummarySchema,
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
  productKey: catalogProductKeySchema,
  quantity: z.number().int().min(1).max(99).default(1),
}).strict();

const productStatusSchema = z.object({
  active: z.boolean(),
  listed: z.boolean(),
  orderable: z.boolean(),
}).strict();

/** One concrete sellable unit of a product. */
export const catalogSellableItemSchema = z.object({
  itemKey: catalogItemKeySchema,
  ref: catalogItemRefSchema,
}).strict();

const variantOptionSchema = z.object({
  itemKey: catalogItemKeySchema,
  ref: catalogItemRefSchema,
  sku: skuText.nullable(),
  attributes: z.array(attributeSchema).max(10),
  isDefault: z.boolean(),
}).strict();

const specificationSchema = z.object({ name: nameText, value: z.string().min(1).max(255) }).strict();

const authoritativeFactsSchema = z.object({
  name: nameText,
  sku: skuText.nullable(),
  shortDescription: z.string().max(600).nullable(),
  category: categorySchema.nullable(),
  brand: z.string().min(1).max(64).nullable(),
  weightKg: z.number().nonnegative().nullable(),
  specifications: z.array(specificationSchema).max(40),
  status: productStatusSchema,
  /** The product's own sellable unit when it has NO variants; null when a variant must be selected. */
  sellableItem: catalogSellableItemSchema.nullable(),
  variantOptions: z.array(variantOptionSchema).max(CATALOG_V2_MAX_VARIANT_OPTIONS),
  stock: z.object({
    availableQuantity: z.number().int().nullable(),
    scope: z.enum(['variant', 'product_total']),
  }).strict(),
}).strict();

const availabilitySchema = catalogAvailabilitySummarySchema.extend({
  leadTime: z.null(),
}).strict();

const inferredSchema = z.object({
  frequentlyBoughtTogether: z.union([
    z.object({
      status: z.literal('available'),
      snapshotId: z.string().min(1),
      builtAt: z.string().datetime(),
      items: z.array(z.object({
        productKey: catalogProductKeySchema,
        name: nameText,
        confidence: z.number().min(0).max(1),
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
  productKey: catalogProductKeySchema,
}).strict();

export const productContextFoundSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('found'),
  productKey: catalogProductKeySchema,
  ref: catalogProductRefSchema,
  facts: authoritativeFactsSchema,
  derived: z.object({
    priceSummary: catalogPriceSummarySchema.nullable(),
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
    /** The quantity tier priced (specific prices with from_quantity); amounts are UNIT amounts, tax included. */
    quantity: z.number().int().positive(),
    regularGross: catalogMoneySchema,
    finalGross: catalogMoneySchema,
    /**
     * The applied promotion in normalized terms (OD-2), present only when it
     * lowers the price: `percentage` → `percentOff` is a fraction (0.1 = 10 %);
     * `amount` → `amountOffGross` is the unit reduction, TAX INCLUDED, whatever
     * basis the source used. `regularGross` is the price before the reduction.
     * Display-only: the owner's price is `finalGross`; consumers never recompute.
     */
    promotion: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('percentage'),
        percentOff: z.number().gt(0).max(1),
        amountOffGross: z.null(),
        validUntil: z.string().datetime().nullable(),
      }).strict(),
      z.object({
        type: z.literal('amount'),
        percentOff: z.null(),
        amountOffGross: catalogMoneySchema,
        validUntil: z.string().datetime().nullable(),
      }).strict(),
    ]).nullable(),
    tax: z.object({
      included: z.literal(true),
      rate: z.number().min(0).max(1),
      basis: z.enum(['configured_flat_rate', 'prestashop_tax_rules']),
    }).strict(),
    engineVersion: z.string().min(1),
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['invalid_base_price']),
  }).strict(),
]);

const itemContextResponseBaseSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('found'),
  itemKey: catalogItemKeySchema,
  ref: catalogItemRefSchema,
  parentProduct: z.object({
    productKey: catalogProductKeySchema,
    name: nameText,
    sku: skuText.nullable(),
  }).strict(),
  variant: z.object({
    variantId: numericIdSchema.nullable(),
    sku: skuText.nullable(),
    attributes: z.array(attributeSchema).max(10),
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

/** The key names a product that HAS variants: it is a productKey, not a sellable item; select a variant's itemKey. */
export const itemContextVariantRequiredSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('variant_required'),
  itemKey: catalogItemKeySchema,
  productKey: catalogProductKeySchema,
}).strict();

export const itemContextResponseSchema = z.union([itemContextNotFoundSchema, itemContextVariantRequiredSchema, itemContextResponseBaseSchema]);

export type CatalogItemRef = z.infer<typeof catalogItemRefSchema>;
export type CatalogProductRef = z.infer<typeof catalogProductRefSchema>;
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
