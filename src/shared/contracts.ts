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
    taxRate: z.number().nonnegative(),
    taxMode: z.literal('configured_rate'),
    discountApplied: z.boolean(),
    discountType: z.enum(['amount', 'percentage']).nullable(),
    discountValue: z.number().nullable(),
    specificPriceId: z.number().int().nullable(),
    pricingMode: z.literal('sql_specific_price'),
  })
  .strict();

export const publicLinkSchema = z
  .object({
    canonicalUrl: z.string().min(1).nullable(),
    scope: z.enum(['exact_product', 'parent_product']),
    available: z.boolean(),
    unavailableReason: z.enum(['missing_link_rewrite', 'invalid_product_id', 'invalid_base_url']).optional(),
    requiresVariantSelection: z.boolean(),
    variantAttributeLabels: z.array(z.string().min(1)),
  })
  .strict();

export const productResponseSchema = z
  .object({
    product: productCoreSchema,
    publicLink: publicLinkSchema.optional(),
    selectedVariant: selectedVariantSchema.nullable(),
    attributes: z.array(attributeSchema),
    variants: z.array(variantSchema),
    pricing: pricingSchema.nullable(),
    stock: stockSchema.nullable(),
    weightKg: z.number().nonnegative().nullable(),
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
        relationshipSnapshot: z.enum(['ok', 'unavailable']).optional(),
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

export const productSemanticBatchMaxSize = 500;

export const productSemanticBatchTagSchema = z
  .object({
    code: z.string().trim().min(1),
    confidence: z.enum(['EXPLICIT', 'STRONGLY_INFERRED']),
  })
  .strict();

export const productSemanticBatchFactSchema = z
  .object({
    productId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    classificationStatus: z.enum([
      'CLASSIFIED',
      'PARTIALLY_CLASSIFIED',
      'OTHER',
      'EXCLUDED_NON_PRODUCT',
      'NEEDS_REVIEW',
    ]),
    primaryProductFamily: productSemanticBatchTagSchema.nullable(),
    secondaryProductFamilies: z.array(productSemanticBatchTagSchema),
    disciplines: z.array(productSemanticBatchTagSchema),
    useContexts: z.array(productSemanticBatchTagSchema),
  })
  .strict();

export const productSemanticBatchRequestSchema = z
  .object({
    productIds: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(productSemanticBatchMaxSize),
    expectedSnapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u).optional(),
  })
  .strict();

export const productSemanticBatchResponseSchema = z
  .object({
    schemaVersion: z.literal('1'),
    snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    ontologyVersion: z.string().trim().min(1),
    ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    classifierVersion: z.string().trim().min(1),
    semanticChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
    products: z.array(productSemanticBatchFactSchema),
    missingProductIds: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
  })
  .strict()
  .superRefine((response, context) => {
    const productIds = response.products.map((product) => product.productId);
    const missingIds = response.missingProductIds;
    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'products must not contain duplicate productIds', path: ['products'] });
    }
    if (new Set(missingIds).size !== missingIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'missingProductIds must not contain duplicates', path: ['missingProductIds'] });
    }
    const missingSet = new Set(missingIds);
    for (const productId of productIds) {
      if (missingSet.has(productId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'products and missingProductIds must not overlap', path: ['missingProductIds'] });
        break;
      }
    }
  });

export const productSemanticsRegistryValueSchema = z
  .object({
    code: z.string().trim().min(1),
    labelEs: z.string(),
    definition: z.string(),
    status: z.enum(['ACTIVE', 'RESIDUAL']),
    residual: z.boolean(),
  })
  .strict();

export const productSemanticsRegistryAxisSchema = z
  .object({
    axis: z.enum(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']),
    values: z.array(productSemanticsRegistryValueSchema),
  })
  .strict();

export const productSemanticsRegistryResponseSchema = z
  .object({
    schemaVersion: z.literal('1'),
    ontologyVersion: z.string().trim().min(1),
    ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    status: z.literal('PUBLISHED'),
    axes: z.array(productSemanticsRegistryAxisSchema),
  })
  .strict();

export const searchQueryResponseSchema = searchResponseSchema;

export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type ProductResponse = z.infer<typeof productResponseSchema>;
export type BatchResponse = z.infer<typeof batchResponseSchema>;
export type ProductSemanticBatchRequest = z.infer<typeof productSemanticBatchRequestSchema>;
export type ProductSemanticBatchFact = z.infer<typeof productSemanticBatchFactSchema>;
export type ProductSemanticBatchResponse = z.infer<typeof productSemanticBatchResponseSchema>;
export type ProductSemanticsRegistryValue = z.infer<typeof productSemanticsRegistryValueSchema>;
export type ProductSemanticsRegistryAxis = z.infer<typeof productSemanticsRegistryAxisSchema>;
export type ProductSemanticsRegistryResponse = z.infer<typeof productSemanticsRegistryResponseSchema>;
