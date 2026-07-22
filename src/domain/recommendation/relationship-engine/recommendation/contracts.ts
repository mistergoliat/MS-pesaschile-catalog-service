import { z } from 'zod';
import { relationshipTypeSchema } from '../../contracts.js';
import {
  productRelationshipProductReferenceSchema,
  type CalculatedProductRelationship,
  type ProductRelationshipProductReference,
} from '../contracts.js';
import type { JsonValue } from '../publication/contracts.js';
import type {
  ActiveProductRelationshipSnapshotReader,
  ProductRelationshipActiveSnapshotMetadata,
  ProductRelationshipType,
  ProductRuntimeIdentity,
} from '../runtime/contracts.js';

export type ProductReference = ProductRelationshipProductReference;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));

export const productRecommendationBudgetSchema = z
  .object({
    currency: z.string().trim().min(1),
    minimum: z.number().finite().nonnegative().optional(),
    maximum: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .superRefine((budget, context) => {
    if (budget.minimum !== undefined && budget.maximum !== undefined && budget.minimum > budget.maximum) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'budget minimum must be less than or equal to maximum',
        path: ['minimum'],
      });
    }
  });

export const productRecommendationContextSchema = z
  .object({
    channel: z.enum(['whatsapp', 'web', 'phone', 'internal']).optional(),
    intent: z.enum(['purchase', 'quote', 'comparison', 'information']).optional(),
    budget: productRecommendationBudgetSchema.optional(),
  })
  .strict();

export const productRecommendationRequestSchema = z
  .object({
    sourceProduct: productRelationshipProductReferenceSchema,
    customerId: z.string().trim().min(1).optional(),
    cartProducts: z.array(productRelationshipProductReferenceSchema).optional(),
    alreadyPurchasedProducts: z.array(productRelationshipProductReferenceSchema).optional(),
    excludedProducts: z.array(productRelationshipProductReferenceSchema).optional(),
    relationshipTypes: z.array(relationshipTypeSchema).optional(),
    limit: z.number().int().positive().optional(),
    includeOutOfStock: z.boolean().optional(),
    recommendationContext: productRecommendationContextSchema.optional(),
  })
  .strict();

export const productRecommendationServiceParametersSchema = z
  .object({
    defaultLimit: z.number().int().positive(),
    maximumLimit: z.number().int().positive(),
  })
  .strict()
  .superRefine((parameters, context) => {
    if (parameters.defaultLimit > parameters.maximumLimit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'defaultLimit must be less than or equal to maximumLimit',
        path: ['defaultLimit'],
      });
    }
  });

export const DEFAULT_PRODUCT_RECOMMENDATION_SERVICE_PARAMETERS = {
  defaultLimit: 5,
  maximumLimit: 20,
} as const;

export const productRecommendationEligibilityParametersSchema = z
  .object({
    excludeCartProducts: z.boolean(),
    excludePreviouslyPurchasedProducts: z.boolean(),
    excludeOutOfStock: z.boolean(),
    rejectUnknownCompatibility: z.boolean(),
    rejectMissingCommercialData: z.boolean(),
  })
  .strict();

export const DEFAULT_PRODUCT_RECOMMENDATION_ELIGIBILITY_PARAMETERS = {
  excludeCartProducts: true,
  excludePreviouslyPurchasedProducts: false,
  excludeOutOfStock: true,
  rejectUnknownCompatibility: false,
  rejectMissingCommercialData: true,
} as const;

export const productRecommendationCommercialDataSchema = z
  .object({
    product: productRelationshipProductReferenceSchema,
    available: z.boolean(),
    sellable: z.boolean(),
    active: z.boolean(),
    stockStatus: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'unknown']),
    price: z
      .object({
        currency: z.string().trim().min(1),
        amount: z.number().finite().nonnegative(),
      })
      .strict()
      .optional(),
    marginSignal: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
    compatibilityStatus: z.enum(['compatible', 'incompatible', 'unknown']),
  })
  .strict();

export const productRecommendationReasonCodeSchema = z.enum([
  'STRONG_RELATIONSHIP',
  'HIGH_CONFIDENCE',
  'HIGH_LIFT',
  'AVAILABLE',
  'LOW_STOCK',
  'COMPATIBLE',
  'HIGH_MARGIN_SIGNAL',
  'WITHIN_BUDGET',
]);

export const productRecommendationWarningCodeSchema = z.enum([
  'LOW_STOCK',
  'OUT_OF_STOCK_INCLUDED',
  'UNKNOWN_STOCK',
  'UNKNOWN_COMPATIBILITY',
  'PRICE_UNAVAILABLE',
  'CURRENCY_MISMATCH',
  'ALREADY_IN_CART',
  'ALREADY_PURCHASED',
]);

export const productRecommendationRejectionCodeSchema = z.enum([
  'SOURCE_PRODUCT',
  'EXPLICITLY_EXCLUDED',
  'ALREADY_IN_CART',
  'ALREADY_PURCHASED',
  'INACTIVE',
  'NOT_SELLABLE',
  'OUT_OF_STOCK',
  'INCOMPATIBLE',
  'UNKNOWN_COMPATIBILITY',
  'ABOVE_BUDGET',
  'MISSING_COMMERCIAL_DATA',
  'INVALID_PRODUCT_IDENTITY',
  'DUPLICATE_TARGET',
]);

export const productRecommendationReasonSchema = z
  .object({
    code: productRecommendationReasonCodeSchema,
    contribution: z.number().finite().optional(),
    details: jsonValueSchema.optional(),
  })
  .strict();

export const productRecommendationWarningSchema = z
  .object({
    code: productRecommendationWarningCodeSchema,
    details: jsonValueSchema.optional(),
  })
  .strict();

export const productRecommendationRejectionReasonSchema = z
  .object({
    code: productRecommendationRejectionCodeSchema,
    details: jsonValueSchema.optional(),
  })
  .strict();

export const productRecommendationScoreSchema = z
  .object({
    total: z.number().finite().min(0).max(100),
    components: z
      .object({
        relationship: z.number().finite(),
        availability: z.number().finite(),
        compatibility: z.number().finite(),
        commercial: z.number().finite(),
        penalties: z.number().finite(),
      })
      .strict(),
  })
  .strict();

export type ProductRecommendationContext = z.infer<typeof productRecommendationContextSchema>;
export type ProductRecommendationRequest = Omit<z.infer<typeof productRecommendationRequestSchema>, 'cartProducts' | 'alreadyPurchasedProducts' | 'excludedProducts' | 'relationshipTypes'> & {
  readonly cartProducts?: readonly ProductReference[];
  readonly alreadyPurchasedProducts?: readonly ProductReference[];
  readonly excludedProducts?: readonly ProductReference[];
  readonly relationshipTypes?: readonly ProductRelationshipType[];
};
export type ProductRecommendationServiceParameters = z.infer<typeof productRecommendationServiceParametersSchema>;
export type ProductRecommendationEligibilityParameters = z.infer<typeof productRecommendationEligibilityParametersSchema>;
export type ProductRecommendationCommercialData = z.infer<typeof productRecommendationCommercialDataSchema>;
export type ProductRecommendationReasonCode = z.infer<typeof productRecommendationReasonCodeSchema>;
export type ProductRecommendationWarningCode = z.infer<typeof productRecommendationWarningCodeSchema>;
export type ProductRecommendationRejectionCode = z.infer<typeof productRecommendationRejectionCodeSchema>;
export type ProductRecommendationReason = z.infer<typeof productRecommendationReasonSchema>;
export type ProductRecommendationWarning = z.infer<typeof productRecommendationWarningSchema>;
export type ProductRecommendationRejectionReason = z.infer<typeof productRecommendationRejectionReasonSchema>;
export type ProductRecommendationScore = z.infer<typeof productRecommendationScoreSchema>;

export type ProductRecommendationCandidateContext = {
  request: ProductRecommendationRequest;
  relationship: CalculatedProductRelationship;
  commercialData: ProductRecommendationCommercialData;
};

export type ProductRecommendationEligibilityResult =
  | {
      eligible: true;
      reasons: readonly ProductRecommendationReason[];
      warnings: readonly ProductRecommendationWarning[];
    }
  | {
      eligible: false;
      rejectionReasons: readonly ProductRecommendationRejectionReason[];
    };

export type EligibleProductRecommendationCandidate = {
  product: ProductReference;
  productIdentity: ProductRuntimeIdentity;
  relationship: CalculatedProductRelationship;
  commercialData: ProductRecommendationCommercialData;
  reasons: readonly ProductRecommendationReason[];
  warnings: readonly ProductRecommendationWarning[];
};

export type ScoredProductRecommendationCandidate = EligibleProductRecommendationCandidate & {
  score: ProductRecommendationScore;
};

export type ProductRecommendation = ScoredProductRecommendationCandidate & {
  rank: number;
};

export type RejectedProductRecommendationCandidate = {
  product: ProductReference;
  productIdentity: ProductRuntimeIdentity;
  relationship: CalculatedProductRelationship;
  rejectionReasons: readonly ProductRecommendationRejectionReason[];
};

export type ProductRecommendationStatistics = {
  relationshipsRead: number;
  deduplicatedCandidates: number;
  duplicatesRemoved: number;
  commercialRecordsRequested: number;
  eligibleCandidates: number;
  rejectedCandidates: number;
  scoredCandidates: number;
  recommendationsReturned: number;
};

export type ProductRecommendationResult = {
  snapshot: ProductRelationshipActiveSnapshotMetadata;
  sourceIdentity: ProductRuntimeIdentity;
  recommendations: readonly ProductRecommendation[];
  rejectedCandidates: readonly RejectedProductRecommendationCandidate[];
  statistics: ProductRecommendationStatistics;
};

export interface ProductRecommendationCommercialDataProvider {
  getCommercialData(
    products: readonly ProductReference[],
    context: ProductRecommendationContext,
  ): Promise<ReadonlyMap<ProductRuntimeIdentity, ProductRecommendationCommercialData>>;
}

export interface ProductRecommendationEligibilityEvaluator {
  evaluate(candidate: ProductRecommendationCandidateContext): ProductRecommendationEligibilityResult;
}

export interface ProductRecommendationScorer {
  score(candidate: EligibleProductRecommendationCandidate): ProductRecommendationScore;
}

export interface ProductRecommendationRanker {
  rank(candidates: readonly ScoredProductRecommendationCandidate[]): readonly ScoredProductRecommendationCandidate[];
}

export interface CommercialProductRecommendationService {
  recommend(request: ProductRecommendationRequest): Promise<ProductRecommendationResult>;
}

export type CommercialProductRecommendationServiceDependencies = {
  reader: ActiveProductRelationshipSnapshotReader;
  commercialDataProvider: ProductRecommendationCommercialDataProvider;
  eligibilityEvaluator: ProductRecommendationEligibilityEvaluator;
  scorer: ProductRecommendationScorer;
  ranker: ProductRecommendationRanker;
  parameters: ProductRecommendationServiceParameters;
};
