import { z } from 'zod';
import type { JsonValue } from '../../../domain/recommendation/relationship-engine/publication/contracts.js';

const nonEmptyStringSchema = z.string().trim().min(1);
const boundedQuerySchema = z.string().min(1).max(240).superRefine((value, refinement) => {
  if (value.trim().length < 2) {
    refinement.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 2,
      inclusive: true,
      type: 'string',
      message: 'query must contain at least 2 non-whitespace characters',
    });
  }
});
const correlationIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const zeroToOneSchema = z.number().finite().min(0).max(1);

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));

export const PRODUCT_INTENT_DEFAULT_LIMIT = 5;
export const PRODUCT_INTENT_MAX_LIMIT = 20;
export const PRODUCT_INTENT_POOL_FACTOR = 4;
export const PRODUCT_INTENT_MAX_POOL_SIZE = 50;

export const productIntentReferenceSchema = z
  .object({
    productId: nonEmptyStringSchema,
    combinationId: nonEmptyStringSchema.optional(),
  })
  .strict();

export const productIntentContextSchema = z
  .object({
    category: nonEmptyStringSchema.optional(),
    intendedUse: nonEmptyStringSchema.optional(),
    preferredAttributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    excludedProductIds: z.array(nonEmptyStringSchema).max(100).optional(),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (context.excludedProductIds && new Set(context.excludedProductIds).size !== context.excludedProductIds.length) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'excludedProductIds must be unique',
        path: ['excludedProductIds'],
      });
    }
  });

export const productIntentFiltersSchema = z
  .object({
    inStockOnly: z.boolean().optional(),
    activeOnly: z.boolean().optional(),
  })
  .strict();

export const resolveProductIntentRequestSchema = z
  .object({
    query: boundedQuerySchema,
    context: productIntentContextSchema.optional(),
    filters: productIntentFiltersSchema.optional(),
    limit: z.number().int().min(1).max(PRODUCT_INTENT_MAX_LIMIT).optional(),
    correlationId: correlationIdSchema.optional(),
  })
  .strict();

export const productIntentPriceSchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    currency: nonEmptyStringSchema,
  })
  .strict();

export const productIntentStockSchema = z
  .object({
    status: z.enum(['in_stock', 'out_of_stock', 'available_for_order', 'unknown']),
    quantity: nonNegativeIntegerSchema.optional(),
    available: z.boolean(),
  })
  .strict();

export const productIntentProductSummarySchema = z
  .object({
    productId: nonEmptyStringSchema,
    combinationId: nonEmptyStringSchema.optional(),
    name: nonEmptyStringSchema,
    reference: nonEmptyStringSchema.optional(),
    description: nonEmptyStringSchema.optional(),
    category: nonEmptyStringSchema.optional(),
    active: z.boolean(),
    price: productIntentPriceSchema.nullable(),
    stock: productIntentStockSchema,
    productUrl: nonEmptyStringSchema.optional(),
    imageUrl: nonEmptyStringSchema.optional(),
  })
  .strict();

export const productMatchReasonSchema = z.enum([
  'EXACT_REFERENCE_MATCH',
  'EXACT_NAME_MATCH',
  'NAME_TOKEN_MATCH',
  'CATEGORY_MATCH',
  'DESCRIPTION_MATCH',
  'ATTRIBUTE_MATCH',
  'INTENDED_USE_MATCH',
  'SYNONYM_MATCH',
]);

export const productIntentCandidateSchema = z
  .object({
    product: productIntentProductSummarySchema,
    match: z
      .object({
        rank: positiveIntegerSchema,
        score: zeroToOneSchema,
        reasons: z.array(productMatchReasonSchema),
      })
      .strict(),
  })
  .strict();

export const productClarificationSchema = z
  .object({
    dimension: z.enum(['product_type', 'weight', 'diameter', 'length', 'category', 'brand', 'variant', 'unspecified']),
    options: z.array(z
      .object({
        value: nonEmptyStringSchema,
        label: nonEmptyStringSchema,
        productIds: z.array(nonEmptyStringSchema),
      })
      .strict()),
  })
  .strict();

export const productIntentWarningSchema = z
  .object({
    code: z.enum([
      'QUERY_NORMALIZED',
      'RESULTS_TRUNCATED',
      'CATALOG_PRICE_UNAVAILABLE',
      'CATALOG_STOCK_UNKNOWN',
      'SEARCH_PARTIALLY_DEGRADED',
    ]),
    details: z.record(jsonValueSchema).optional(),
  })
  .strict();

export const resolveProductIntentResultSchema = z
  .object({
    query: z.object({
      original: z.string().min(1),
      normalized: nonEmptyStringSchema,
    }).strict(),
    resolution: z
      .object({
        status: z.enum(['resolved', 'clarification_required', 'no_match']),
        confidence: zeroToOneSchema,
        sourceProduct: productIntentReferenceSchema.optional(),
      })
      .strict()
      .superRefine((resolution, refinement) => {
        if (resolution.status === 'resolved' && resolution.sourceProduct === undefined) {
          refinement.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'resolved status requires sourceProduct',
            path: ['sourceProduct'],
          });
        }
        if (resolution.status !== 'resolved' && resolution.sourceProduct !== undefined) {
          refinement.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'sourceProduct is only allowed for resolved status',
            path: ['sourceProduct'],
          });
        }
      }),
    candidates: z.array(productIntentCandidateSchema),
    clarification: productClarificationSchema.optional(),
    statistics: z.object({
      retrieved: nonNegativeIntegerSchema,
      eligible: nonNegativeIntegerSchema,
      returned: nonNegativeIntegerSchema,
    }).strict(),
    warnings: z.array(productIntentWarningSchema),
    correlationId: correlationIdSchema,
  })
  .strict()
  .superRefine((result, refinement) => {
    if (result.resolution.status === 'clarification_required' && result.clarification === undefined) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'clarification_required status requires clarification',
        path: ['clarification'],
      });
    }
    if (result.statistics.returned !== result.candidates.length) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'returned must equal candidates length',
        path: ['statistics', 'returned'],
      });
    }
  });

export type ProductIntentReference = z.infer<typeof productIntentReferenceSchema>;
export type ProductIntentContext = z.infer<typeof productIntentContextSchema>;
export type ProductIntentFilters = z.infer<typeof productIntentFiltersSchema>;
export type ResolveProductIntentRequest = z.infer<typeof resolveProductIntentRequestSchema>;
export type ProductIntentPrice = z.infer<typeof productIntentPriceSchema>;
export type ProductIntentStock = z.infer<typeof productIntentStockSchema>;
export type ProductIntentProductSummary = z.infer<typeof productIntentProductSummarySchema>;
export type ProductMatchReason = z.infer<typeof productMatchReasonSchema>;
export type ProductIntentCandidate = z.infer<typeof productIntentCandidateSchema>;
export type ProductClarification = z.infer<typeof productClarificationSchema>;
export type ProductIntentWarning = z.infer<typeof productIntentWarningSchema>;
export type ResolveProductIntentResult = z.infer<typeof resolveProductIntentResultSchema>;
export type ProductIntentResolutionStatus = ResolveProductIntentResult['resolution']['status'];

export type ProductIntentAttribute = {
  readonly group: string;
  readonly value: string;
};

export type ProductIntentCatalogProduct = ProductIntentProductSummary & {
  readonly attributes?: readonly ProductIntentAttribute[];
};

export type NormalizedProductQuery = {
  readonly original: string;
  readonly normalized: string;
  readonly tokens: readonly string[];
  readonly searchableTerms: readonly string[];
  readonly unitTokens: readonly string[];
  readonly synonymTerms: readonly string[];
};

export type ProductIntentSearchHit = {
  readonly product: ProductIntentReference;
  readonly query: string;
  readonly matchType?: string;
};

export interface ProductQueryNormalizer {
  normalize(query: string): NormalizedProductQuery;
}

export interface ProductSearchSynonymProvider {
  expand(query: NormalizedProductQuery): NormalizedProductQuery;
}

export interface CatalogProductIntentSearcher {
  search(input: {
    readonly query: NormalizedProductQuery;
    readonly limit: number;
    readonly includeOutOfStock: boolean;
  }): Promise<readonly ProductIntentSearchHit[]>;
}

export interface CatalogProductIntentBatchReader {
  getProductsByReferences(
    references: readonly ProductIntentReference[],
    correlationId: string,
  ): Promise<ReadonlyMap<string, ProductIntentCatalogProduct>>;
}

export type RankedProductIntentCandidate = {
  readonly product: ProductIntentCatalogProduct;
  readonly score: number;
  readonly reasons: readonly ProductMatchReason[];
};

export interface ProductIntentCandidateRanker {
  rank(
    query: NormalizedProductQuery,
    candidates: readonly ProductIntentCatalogProduct[],
    context?: ProductIntentContext,
  ): readonly RankedProductIntentCandidate[];
}

export type ProductIntentResolutionDecision = {
  readonly status: ProductIntentResolutionStatus;
  readonly confidence: number;
  readonly sourceProduct?: ProductIntentReference;
};

export interface ProductIntentResolutionPolicy {
  resolve(candidates: readonly RankedProductIntentCandidate[]): ProductIntentResolutionDecision;
}

export interface ProductClarificationBuilder {
  build(candidates: readonly RankedProductIntentCandidate[]): ProductClarification;
}

export interface ProductIntentCorrelationIdProvider {
  generate(): string;
}

export interface ProductIntentLogger {
  info(event: string, fields: Readonly<Record<string, JsonValue>>): void;
  error(event: string, fields: Readonly<Record<string, JsonValue>>): void;
}

export type ProductIntentResolutionParameters = {
  readonly defaultLimit: number;
  readonly maximumLimit: number;
  readonly poolFactor: number;
  readonly maximumPoolSize: number;
};

export const DEFAULT_PRODUCT_INTENT_RESOLUTION_PARAMETERS = Object.freeze({
  defaultLimit: PRODUCT_INTENT_DEFAULT_LIMIT,
  maximumLimit: PRODUCT_INTENT_MAX_LIMIT,
  poolFactor: PRODUCT_INTENT_POOL_FACTOR,
  maximumPoolSize: PRODUCT_INTENT_MAX_POOL_SIZE,
} as const);

export type ProductIntentResolutionServiceDependencies = {
  readonly normalizer: ProductQueryNormalizer;
  readonly synonymProvider: ProductSearchSynonymProvider;
  readonly searcher: CatalogProductIntentSearcher;
  readonly catalogReader: CatalogProductIntentBatchReader;
  readonly ranker: ProductIntentCandidateRanker;
  readonly resolutionPolicy: ProductIntentResolutionPolicy;
  readonly clarificationBuilder: ProductClarificationBuilder;
  readonly correlationIdProvider: ProductIntentCorrelationIdProvider;
  readonly logger?: ProductIntentLogger;
  readonly parameters?: ProductIntentResolutionParameters;
};

export interface ProductIntentResolutionService {
  resolve(request: ResolveProductIntentRequest): Promise<ResolveProductIntentResult>;
}
