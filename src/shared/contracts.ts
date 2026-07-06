import { z } from 'zod';

export const matchTypeSchema = z.enum(['exact_sku', 'exact_name', 'partial_name', 'description']);

export const attributeSchema = z
  .object({
    group: z.string(),
    value: z.string(),
  })
  .strict();

export const stockSchema = z
  .object({
    physicalQuantity: z.number().int(),
    available: z.boolean(),
    shopId: z.number().int(),
  })
  .strict();

export const searchItemSchema = z
  .object({
    productId: z.number().int().positive(),
    combinationId: z.number().int().nonnegative(),
    sku: z.string().nullable(),
    name: z.string(),
    variantLabel: z.string().nullable(),
    shortDescription: z.string().nullable(),
    physicalQuantity: z.number().int(),
    available: z.boolean(),
    matchType: matchTypeSchema,
  })
  .strict();

export const searchResponseSchema = z
  .object({
    query: z.string(),
    items: z.array(searchItemSchema),
    freshness: z
      .object({
        cached: z.boolean(),
        generatedAt: z.string(),
      })
      .strict(),
  })
  .strict();

export const productCoreSchema = z
  .object({
    productId: z.number().int().positive(),
    name: z.string(),
    sku: z.string().nullable(),
    shortDescription: z.string().nullable(),
    longDescription: z.string().nullable(),
    active: z.boolean(),
  })
  .strict();

export const selectedVariantSchema = z
  .object({
    combinationId: z.number().int().nonnegative(),
    sku: z.string().nullable(),
    label: z.string().nullable(),
    attributes: z.array(attributeSchema),
  })
  .strict();

export const variantSchema = z
  .object({
    combinationId: z.number().int().nonnegative(),
    sku: z.string().nullable(),
    label: z.string().nullable(),
    attributes: z.array(attributeSchema),
    impactPrice: z.number(),
    physicalQuantity: z.number().int(),
    available: z.boolean(),
    isDefault: z.boolean(),
  })
  .strict();

export const pricingSchema = z
  .object({
    quantity: z.number().int().min(1),
    baseUnitPrice: z.number().int(),
    effectiveUnitPrice: z.number().int(),
    subtotal: z.number().int(),
    currency: z.string(),
    taxIncluded: z.literal(true),
    taxMode: z.literal('configured_rate'),
    discountApplied: z.boolean(),
    discountType: z.enum(['amount', 'percentage']).nullable(),
    discountValue: z.number().nullable(),
    specificPriceId: z.number().int().nullable(),
    pricingMode: z.literal('sql_specific_price'),
  })
  .strict();

export const productResponseSchema = z
  .object({
    product: productCoreSchema,
    selectedVariant: selectedVariantSchema.nullable(),
    attributes: z.array(attributeSchema),
    variants: z.array(variantSchema),
    pricing: pricingSchema.nullable(),
    stock: stockSchema.nullable(),
    freshness: z
      .object({
        productCheckedAt: z.string(),
        priceCalculatedAt: z.string().nullable(),
        stockCheckedAt: z.string().nullable(),
        cached: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const batchItemInputSchema = z
  .object({
    productId: z.number().int().positive(),
    combinationId: z.number().int().nonnegative().default(0),
    quantity: z.number().int().min(1).max(999).default(1),
  })
  .strict();

export const batchItemErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
  })
  .strict();

export const batchItemSuccessSchema = z
  .object({
    ok: z.literal(true),
    input: batchItemInputSchema,
    product: productResponseSchema,
  })
  .strict();

export const batchItemFailureSchema = z
  .object({
    ok: z.literal(false),
    input: batchItemInputSchema,
    error: batchItemErrorSchema,
  })
  .strict();

export const batchResponseSchema = z
  .object({
    items: z.array(z.union([batchItemSuccessSchema, batchItemFailureSchema])),
  })
  .strict();

export const errorResponseSchema = z
  .object({
    error: batchItemErrorSchema,
  })
  .strict();

export const healthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    checks: z
      .object({
        database: z.enum(['ok', 'unavailable']).optional(),
        redis: z.enum(['ok', 'unavailable']).optional(),
      })
      .strict(),
  })
  .strict();

export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    limit: z.coerce.number().int().min(1).max(10).default(5),
    includeOutOfStock: z
      .union([z.literal('true'), z.literal('false'), z.boolean()])
      .transform((value) => value === true || value === 'true')
      .default(false),
  })
  .strict();

export const productParamsSchema = z
  .object({
    productId: z.coerce.number().int().positive(),
  })
  .strict();

export const productQuerySchema = z
  .object({
    combinationId: z.coerce.number().int().nonnegative().default(0),
    quantity: z.coerce.number().int().min(1).max(999).default(1),
    customerId: z.coerce.number().int().nonnegative().optional(),
    customerGroupId: z.coerce.number().int().nonnegative().optional(),
    currencyId: z.coerce.number().int().nonnegative().optional(),
    countryId: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

export const batchRequestSchema = z
  .object({
    items: z.array(batchItemInputSchema).min(1).max(20),
  })
  .strict();

export const searchQueryResponseSchema = searchResponseSchema;

export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type ProductResponse = z.infer<typeof productResponseSchema>;
export type BatchResponse = z.infer<typeof batchResponseSchema>;
