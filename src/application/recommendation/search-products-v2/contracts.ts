import { z } from 'zod';
import {
  productRelationshipProductReferenceSchema,
  type ProductRelationshipProductReference,
} from '../../../domain/recommendation/relationship-engine/contracts.js';
import type {
  CommercialProductRecommendationService,
  ProductRecommendationContext,
  ProductRecommendationResult,
} from '../../../domain/recommendation/relationship-engine/recommendation/index.js';
import type {
  CustomerAffinityCustomerReference,
  CustomerProductAffinityResult,
  CustomerProductAffinityProvider,
} from '../../../domain/recommendation/customer-affinity/index.js';
import {
  customerAffinityConfidenceSchema,
  customerAffinityCustomerReferenceSchema,
} from '../../../domain/recommendation/customer-affinity/index.js';
import type {
  PersonalizedRecommendationResult,
  PersonalizedRecommendationService,
} from '../../../domain/recommendation/personalized-recommendation/index.js';
import type { JsonValue } from '../../../domain/recommendation/relationship-engine/publication/contracts.js';

const nonEmptyStringSchema = z.string().trim().min(1);
const boundedQuerySchema = z.string().trim().min(1).max(240);
const correlationIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const zeroToOneSchema = z.number().finite().min(0).max(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));

function addIssue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message, path });
}

function hasDuplicateProductReferences(products: readonly ProductRelationshipProductReference[] | undefined): boolean {
  if (!products) return false;
  const keys = products.map((product) => `${product.productId}::${product.combinationId ?? '<base>'}`);
  return new Set(keys).size !== keys.length;
}

function hasDuplicateStrings(values: readonly string[] | undefined): boolean {
  return values === undefined ? false : new Set(values).size !== values.length;
}

export const SEARCH_PRODUCTS_V2_MAX_LIMIT = 20;
export const SEARCH_PRODUCTS_V2_CANDIDATE_POOL_FACTOR = 3;
export const SEARCH_PRODUCTS_V2_MAX_CANDIDATE_POOL = 60;

export const searchProductsV2MoneySchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    currency: nonEmptyStringSchema,
  })
  .strict();

export const searchProductsV2CustomerReferenceSchema = customerAffinityCustomerReferenceSchema;

export const searchProductsV2ContextSchema = z
  .object({
    customerId: nonEmptyStringSchema.optional(),
    intent: nonEmptyStringSchema.optional(),
    useCase: nonEmptyStringSchema.optional(),
    budget: searchProductsV2MoneySchema.optional(),
    preferredProducts: z.array(productRelationshipProductReferenceSchema).optional(),
    excludedProducts: z.array(productRelationshipProductReferenceSchema).optional(),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (hasDuplicateProductReferences(context.preferredProducts)) {
      addIssue(refinement, ['preferredProducts'], 'preferredProducts must be unique by runtime identity');
    }
    if (hasDuplicateProductReferences(context.excludedProducts)) {
      addIssue(refinement, ['excludedProducts'], 'excludedProducts must be unique by runtime identity');
    }
  });

export const searchProductsV2FiltersSchema = z
  .object({
    inStockOnly: z.boolean().optional(),
    productIds: z.array(nonEmptyStringSchema).max(50).optional(),
  })
  .strict()
  .superRefine((filters, context) => {
    if (hasDuplicateStrings(filters.productIds)) {
      addIssue(context, ['productIds'], 'productIds must be unique');
    }
  });

export const searchProductsV2RequestSchema = z
  .object({
    query: boundedQuerySchema.optional(),
    sourceProduct: productRelationshipProductReferenceSchema,
    customer: searchProductsV2CustomerReferenceSchema.optional(),
    context: searchProductsV2ContextSchema.optional(),
    filters: searchProductsV2FiltersSchema.optional(),
    limit: z.number().int().min(1).max(SEARCH_PRODUCTS_V2_MAX_LIMIT).optional(),
    correlationId: correlationIdSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.customer !== undefined &&
      request.context?.customerId !== undefined &&
      request.customer.customerId !== request.context.customerId
    ) {
      addIssue(context, ['context', 'customerId'], 'context customerId must match customer.customerId');
    }
  });

export const searchProductsV2ReasonCodeSchema = z.enum([
  'STRONG_COMMERCIAL_RELEVANCE',
  'CUSTOMER_PRODUCT_AFFINITY',
  'CUSTOMER_CATEGORY_AFFINITY',
  'CUSTOMER_BRAND_AFFINITY',
  'RECENT_PRODUCT_INTEREST',
  'RECENT_CATEGORY_INTEREST',
  'OWNED_COMPATIBLE_PRODUCT',
  'REPEAT_PURCHASE_PATTERN',
  'OBSERVED_SPEND_COMPATIBILITY',
  'EXPLICIT_CONTEXT_PREFERENCE',
  'GENERAL_COMMERCIAL_FALLBACK',
]);

export const searchProductsV2ReasonSchema = z
  .object({
    code: searchProductsV2ReasonCodeSchema,
    source: z.enum(['commercial', 'affinity', 'context', 'fallback']),
  })
  .strict();

export const searchProductsV2WarningCodeSchema = z.enum([
  'NO_COMMERCIAL_CANDIDATES',
  'CUSTOMER_NOT_IDENTIFIED',
  'NO_CUSTOMER_HISTORY',
  'PARTIAL_CUSTOMER_HISTORY',
  'CUSTOMER_AFFINITY_UNAVAILABLE',
  'AFFINITY_MISSING_FOR_PRODUCT',
  'PERSONALIZATION_CONTEXT_PARTIALLY_APPLIED',
  'RESULTS_TRUNCATED',
  'CATALOG_PRODUCT_MISSING',
  'CATALOG_PRODUCT_INACTIVE',
  'CATALOG_PRICE_UNAVAILABLE',
  'CATALOG_STOCK_UNKNOWN',
  'UPSTREAM_COMMERCIAL_WARNING',
  'UPSTREAM_AFFINITY_WARNING',
  'UPSTREAM_PERSONALIZATION_WARNING',
]);

export const searchProductsV2WarningSchema = z
  .object({
    code: searchProductsV2WarningCodeSchema,
    product: productRelationshipProductReferenceSchema.optional(),
    details: z.record(jsonValueSchema).optional(),
  })
  .strict();

export const searchProductsV2ExclusionCodeSchema = z.enum([
  'EXPLICIT_CONTEXT_EXCLUSION',
  'EXPLICIT_PRODUCT_REJECTION',
  'BELOW_MINIMUM_PERSONALIZED_SCORE',
  'RESULT_LIMIT_TRUNCATION',
  'MISSING_CATALOG_PRODUCT',
  'INACTIVE_PRODUCT',
  'OUT_OF_STOCK_FILTERED',
]);

export const searchProductsV2ExclusionSchema = z
  .object({
    product: productRelationshipProductReferenceSchema,
    code: searchProductsV2ExclusionCodeSchema,
  })
  .strict();

export const searchProductsV2PriceSchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    currency: nonEmptyStringSchema,
  })
  .strict();

export const searchProductsV2StockSchema = z
  .object({
    status: z.enum(['in_stock', 'out_of_stock', 'available_for_order', 'unknown']),
    quantity: nonNegativeIntegerSchema.optional(),
    available: z.boolean(),
  })
  .strict();

export const searchProductsV2AvailabilitySchema = z
  .object({
    status: z.enum(['available', 'out_of_stock', 'inactive', 'unavailable_for_order', 'unknown']),
    purchasable: z.boolean(),
    active: z.boolean(),
    availableForOrder: z.boolean(),
    stockQuantity: nonNegativeIntegerSchema.nullable(),
    stockKnown: z.boolean(),
    evaluatedAt: nonEmptyStringSchema,
  })
  .strict();

export const searchProductsV2PricingSchema = z
  .object({
    baseGrossAmount: z.number().finite().nonnegative(),
    finalGrossAmount: z.number().finite().nonnegative(),
    currency: nonEmptyStringSchema,
    taxIncluded: z.literal(true),
    taxRate: z.number().finite().nonnegative(),
    discountApplied: z.boolean(),
    discountType: z.enum(['percentage', 'amount']).nullable(),
    discountValue: z.number().finite().nonnegative().nullable(),
    specificPriceId: nonNegativeIntegerSchema.nullable(),
    evaluatedAt: nonEmptyStringSchema,
  })
  .strict();

export const searchProductsV2CatalogProductSummarySchema = z
  .object({
    productId: nonEmptyStringSchema,
    combinationId: nonEmptyStringSchema.optional(),
    name: nonEmptyStringSchema,
    reference: nonEmptyStringSchema.optional(),
    description: nonEmptyStringSchema.optional(),
    category: nonEmptyStringSchema.optional(),
    active: z.boolean(),
    price: searchProductsV2PriceSchema.nullable(),
    stock: searchProductsV2StockSchema,
    availability: searchProductsV2AvailabilitySchema.optional(),
    pricing: searchProductsV2PricingSchema.nullable().optional(),
    productUrl: nonEmptyStringSchema.optional(),
    imageUrl: nonEmptyStringSchema.optional(),
  })
  .strict();

export const searchProductsV2RelationshipEvidenceSchema = z
  .object({
    jointCount: nonNegativeIntegerSchema,
    support: z.number().finite().nonnegative(),
    confidence: zeroToOneSchema,
    lift: z.number().finite().nonnegative(),
  })
  .strict();

export const searchProductsV2RecommendationRelationshipSchema = z
  .object({
    type: nonEmptyStringSchema,
    reliability: zeroToOneSchema,
    evidence: searchProductsV2RelationshipEvidenceSchema,
  })
  .strict();

export const searchProductsV2CommercialReasonCodeSchema = z.enum([
  'FREQUENTLY_BOUGHT_TOGETHER',
  'RELATED_PRODUCT_FALLBACK',
  'CUSTOMER_AFFINITY_MATCH',
]);

export const searchProductsV2CommercialReasonSchema = z
  .object({
    code: searchProductsV2CommercialReasonCodeSchema,
    label: nonEmptyStringSchema,
  })
  .strict();

export const searchProductsV2RecommendationRankingSchema = z
  .object({
    rank: positiveIntegerSchema,
    score: zeroToOneSchema,
  })
  .strict();

export const searchProductsV2RecommendationSchema = z
  .object({
    product: searchProductsV2CatalogProductSummarySchema,
    rank: positiveIntegerSchema,
    score: zeroToOneSchema,
    commercialScore: zeroToOneSchema,
    affinityScore: zeroToOneSchema,
    affinityConfidence: customerAffinityConfidenceSchema,
    ranking: searchProductsV2RecommendationRankingSchema,
    relationship: searchProductsV2RecommendationRelationshipSchema,
    commercialReason: searchProductsV2CommercialReasonSchema,
    reasons: z.array(searchProductsV2ReasonSchema),
    warnings: z.array(searchProductsV2WarningSchema),
  })
  .strict();

export const searchProductsV2StatisticsSchema = z
  .object({
    commercialCandidates: nonNegativeIntegerSchema,
    affinityCandidates: nonNegativeIntegerSchema,
    personalizedRecommendations: nonNegativeIntegerSchema,
    excludedRecommendations: nonNegativeIntegerSchema,
    customerAffinityCalls: z.union([z.literal(0), z.literal(1)]),
    personalizationCalls: z.union([z.literal(0), z.literal(1)]),
    degradedStages: nonNegativeIntegerSchema,
    warningsGenerated: nonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((statistics, context) => {
    if (statistics.personalizedRecommendations + statistics.excludedRecommendations !== statistics.commercialCandidates) {
      addIssue(context, ['personalizedRecommendations'], 'recommendations plus exclusions must equal commercial candidates');
    }
  });

export const searchProductsV2DegradationCodeSchema = z.enum(['CUSTOMER_AFFINITY_RETRYABLE_FAILURE']);

export const searchProductsV2ExecutionStagesSchema = z
  .object({
    commercialRecommendation: z.enum(['completed', 'failed']),
    customerAffinity: z.enum(['completed', 'skipped', 'degraded', 'failed']),
    personalization: z.enum(['completed', 'skipped', 'failed']),
  })
  .strict();

export const searchProductsV2ExecutionSchema = z
  .object({
    correlationId: correlationIdSchema,
    degraded: z.boolean(),
    degradationReasons: z.array(searchProductsV2DegradationCodeSchema),
    stages: searchProductsV2ExecutionStagesSchema,
  })
  .strict()
  .superRefine((execution, context) => {
    if (execution.stages.commercialRecommendation === 'failed' && execution.stages.personalization === 'completed') {
      addIssue(context, ['stages', 'personalization'], 'personalization cannot complete when commercial stage failed');
    }
    if (execution.stages.customerAffinity === 'degraded' && !execution.degraded) {
      addIssue(context, ['degraded'], 'degraded must be true when customer affinity is degraded');
    }
    if (!execution.degraded && execution.degradationReasons.length > 0) {
      addIssue(context, ['degradationReasons'], 'degradationReasons must be empty when degraded is false');
    }
  });

export const searchProductsV2PersonalizationSchema = z
  .object({
    applied: z.boolean(),
    reason: z.enum(['customer_not_provided', 'customer_affinity_unavailable', 'no_customer_history']).optional(),
    customerId: nonEmptyStringSchema.optional(),
  })
  .strict();

export const searchProductsV2SnapshotSchema = z
  .object({
    id: nonEmptyStringSchema,
    modelVersion: nonEmptyStringSchema,
  })
  .strict();

export const searchProductsV2ResultSchema = z
  .object({
    query: boundedQuerySchema.nullable(),
    sourceProduct: searchProductsV2CatalogProductSummarySchema,
    customer: searchProductsV2CustomerReferenceSchema.optional(),
    recommendations: z.array(searchProductsV2RecommendationSchema),
    excluded: z.array(searchProductsV2ExclusionSchema),
    personalization: searchProductsV2PersonalizationSchema,
    snapshot: searchProductsV2SnapshotSchema,
    warnings: z.array(searchProductsV2WarningSchema),
    statistics: searchProductsV2StatisticsSchema,
    execution: searchProductsV2ExecutionSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const productWarnings = result.recommendations.reduce((count, item) => count + item.warnings.length, 0);
    if (result.statistics.warningsGenerated !== result.warnings.length + productWarnings) {
      addIssue(context, ['statistics', 'warningsGenerated'], 'warningsGenerated must count global plus recommendation warnings');
    }
  });

export type SearchProductsV2Money = z.infer<typeof searchProductsV2MoneySchema>;
export type SearchProductsV2CustomerReference = CustomerAffinityCustomerReference;
export type SearchProductsV2Context = Omit<z.infer<typeof searchProductsV2ContextSchema>, 'preferredProducts' | 'excludedProducts'> & {
  readonly preferredProducts?: readonly ProductRelationshipProductReference[];
  readonly excludedProducts?: readonly ProductRelationshipProductReference[];
};
export type SearchProductsV2Filters = z.infer<typeof searchProductsV2FiltersSchema>;
export type SearchProductsV2Request = Omit<z.infer<typeof searchProductsV2RequestSchema>, 'context'> & {
  readonly context?: SearchProductsV2Context;
};
export type SearchProductsV2Reason = z.infer<typeof searchProductsV2ReasonSchema>;
export type SearchProductsV2Warning = z.infer<typeof searchProductsV2WarningSchema>;
export type SearchProductsV2Exclusion = z.infer<typeof searchProductsV2ExclusionSchema>;
export type SearchProductsV2Price = z.infer<typeof searchProductsV2PriceSchema>;
export type SearchProductsV2Stock = z.infer<typeof searchProductsV2StockSchema>;
export type SearchProductsV2Availability = z.infer<typeof searchProductsV2AvailabilitySchema>;
export type SearchProductsV2Pricing = z.infer<typeof searchProductsV2PricingSchema>;
export type CatalogProductSummary = z.infer<typeof searchProductsV2CatalogProductSummarySchema>;
export type SearchProductsV2RecommendationRelationship = z.infer<typeof searchProductsV2RecommendationRelationshipSchema>;
export type SearchProductsV2CommercialReason = z.infer<typeof searchProductsV2CommercialReasonSchema>;
export type SearchProductsV2Recommendation = z.infer<typeof searchProductsV2RecommendationSchema>;
export type SearchProductsV2Statistics = z.infer<typeof searchProductsV2StatisticsSchema>;
export type SearchProductsV2ExecutionStages = z.infer<typeof searchProductsV2ExecutionStagesSchema>;
export type SearchProductsV2Execution = z.infer<typeof searchProductsV2ExecutionSchema>;
export type SearchProductsV2Personalization = z.infer<typeof searchProductsV2PersonalizationSchema>;
export type SearchProductsV2Snapshot = z.infer<typeof searchProductsV2SnapshotSchema>;
export type SearchProductsV2Result = z.infer<typeof searchProductsV2ResultSchema>;

export interface CorrelationIdProvider {
  generate(): string;
}

export interface SearchProductsV2Logger {
  info(event: string, fields: Readonly<Record<string, JsonValue>>): void;
  error(event: string, fields: Readonly<Record<string, JsonValue>>): void;
}

export interface CatalogProductBatchReader {
  getProductsByReferences(
    references: readonly ProductRelationshipProductReference[],
  ): Promise<ReadonlyMap<string, CatalogProductSummary>>;
}

export type SearchProductsV2ServiceParameters = {
  readonly defaultLimit: number;
  readonly maximumLimit: number;
  readonly candidatePoolFactor: number;
  readonly maximumCandidatePoolSize: number;
};

export const DEFAULT_SEARCH_PRODUCTS_V2_SERVICE_PARAMETERS = Object.freeze({
  defaultLimit: 5,
  maximumLimit: SEARCH_PRODUCTS_V2_MAX_LIMIT,
  candidatePoolFactor: SEARCH_PRODUCTS_V2_CANDIDATE_POOL_FACTOR,
  maximumCandidatePoolSize: SEARCH_PRODUCTS_V2_MAX_CANDIDATE_POOL,
} as const);

export type SearchProductsV2Dependencies = {
  readonly commercialRecommendationService: CommercialProductRecommendationService;
  readonly catalogProductBatchReader: CatalogProductBatchReader;
  readonly customerAffinityProvider: CustomerProductAffinityProvider;
  readonly personalizedRecommendationService: PersonalizedRecommendationService;
  readonly correlationIdProvider: CorrelationIdProvider;
  readonly logger?: SearchProductsV2Logger;
  readonly parameters?: SearchProductsV2ServiceParameters;
};

export interface SearchProductsV2Service {
  search(request: SearchProductsV2Request): Promise<SearchProductsV2Result>;
}

export type SearchProductsV2StageOutputs = {
  readonly commercialRecommendations: ProductRecommendationResult;
  readonly customerAffinities?: CustomerProductAffinityResult;
  readonly personalizedRecommendations?: PersonalizedRecommendationResult;
};

export type ProductRuntimeReference = ProductRelationshipProductReference;
export type SearchProductsV2CommercialContext = ProductRecommendationContext;
