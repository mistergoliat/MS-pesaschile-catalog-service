import { z } from 'zod';
import {
  calculatedProductRelationshipSchema,
  productRelationshipProductReferenceSchema,
  type ProductRelationshipProductReference,
} from '../relationship-engine/contracts.js';
import {
  productRecommendationCommercialDataSchema,
  productRecommendationReasonSchema,
  productRecommendationScoreSchema,
  productRecommendationWarningSchema,
  type ProductRecommendation,
  type ProductRecommendationResult,
} from '../relationship-engine/recommendation/index.js';
import {
  productRelationshipActiveSnapshotMetadataSchema,
  type ProductRuntimeIdentity,
} from '../relationship-engine/runtime/index.js';
import type { JsonValue } from '../relationship-engine/publication/contracts.js';
import {
  customerAffinityConfidenceSchema,
  customerAffinityCustomerReferenceSchema,
  customerProductAffinityResultSchema,
  customerProductAffinitySchema,
  type CustomerAffinityConfidence,
  type CustomerAffinityCustomerReference,
  type CustomerProductAffinity,
  type CustomerProductAffinityResult,
} from '../customer-affinity/index.js';

const WEIGHT_TOLERANCE = 0.000001;
const nonEmptyStringSchema = z.string().trim().min(1);
const zeroToOneSchema = z.number().finite().min(0).max(1);
const nonNegativeNumberSchema = z.number().finite().nonnegative();
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

export const PERSONALIZED_RECOMMENDATION_SCORING_VERSION = 'personalized-recommendation-v1';

export const personalizedRecommendationMoneyContextSchema = z
  .object({
    currency: nonEmptyStringSchema,
    minimum: nonNegativeNumberSchema.optional(),
    maximum: nonNegativeNumberSchema.optional(),
  })
  .strict()
  .superRefine((budget, context) => {
    if (budget.minimum !== undefined && budget.maximum !== undefined && budget.minimum > budget.maximum) {
      addIssue(context, ['minimum'], 'budget minimum must be less than or equal to maximum');
    }
  });

export const personalizedRecommendationContextSchema = z
  .object({
    customer: customerAffinityCustomerReferenceSchema.optional(),
    customerIdentified: z.boolean().optional(),
    intent: nonEmptyStringSchema.optional(),
    useCase: nonEmptyStringSchema.optional(),
    budget: personalizedRecommendationMoneyContextSchema.optional(),
    preferredProductIds: z.array(productRelationshipProductReferenceSchema).optional(),
    excludedProductIds: z.array(productRelationshipProductReferenceSchema).optional(),
  })
  .strict();

export const personalizedRecommendationParametersSchema = z
  .object({
    commercialWeight: zeroToOneSchema,
    affinityWeight: zeroToOneSchema,
    affinityConfidenceNoneMultiplier: zeroToOneSchema,
    affinityConfidenceLowMultiplier: zeroToOneSchema,
    affinityConfidenceMediumMultiplier: zeroToOneSchema,
    affinityConfidenceHighMultiplier: zeroToOneSchema,
    explicitPreferenceBoost: nonNegativeNumberSchema.max(1),
    productRejectionPenalty: nonNegativeNumberSchema.max(1),
    categoryRejectionPenalty: nonNegativeNumberSchema.max(1),
    maximumResults: positiveIntegerSchema.optional(),
    minimumPersonalizedScore: zeroToOneSchema.optional(),
  })
  .strict()
  .superRefine((parameters, context) => {
    const sum = parameters.commercialWeight + parameters.affinityWeight;
    if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
      addIssue(context, ['commercialWeight'], 'commercialWeight + affinityWeight must equal 1');
    }
  });

export const DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS = Object.freeze({
  commercialWeight: 0.7,
  affinityWeight: 0.3,
  affinityConfidenceNoneMultiplier: 0,
  affinityConfidenceLowMultiplier: 0.35,
  affinityConfidenceMediumMultiplier: 0.7,
  affinityConfidenceHighMultiplier: 1,
  explicitPreferenceBoost: 0.1,
  productRejectionPenalty: 1,
  categoryRejectionPenalty: 0.25,
  minimumPersonalizedScore: 0,
} as const);

export const commercialRecommendationSchema = z
  .object({
    product: productRelationshipProductReferenceSchema,
    productIdentity: nonEmptyStringSchema,
    relationship: calculatedProductRelationshipSchema,
    commercialData: productRecommendationCommercialDataSchema,
    reasons: z.array(productRecommendationReasonSchema),
    warnings: z.array(productRecommendationWarningSchema),
    score: productRecommendationScoreSchema,
    rank: positiveIntegerSchema,
  })
  .strict()
  .superRefine((recommendation, context) => {
    if (recommendation.score.total < 0 || recommendation.score.total > 100) {
      addIssue(context, ['score', 'total'], 'commercial score total must be in 0..100');
    }
  });

export const commercialRecommendationResultSchema = z
  .object({
    snapshot: productRelationshipActiveSnapshotMetadataSchema,
    sourceIdentity: nonEmptyStringSchema,
    recommendations: z.array(commercialRecommendationSchema),
    rejectedCandidates: z.array(z.unknown()),
    statistics: z.record(z.unknown()),
  })
  .strict();

export const personalizedRecommendationRequestSchema = z
  .object({
    commercialRecommendations: commercialRecommendationResultSchema,
    customerAffinities: customerProductAffinityResultSchema.optional(),
    context: personalizedRecommendationContextSchema.optional(),
    parameters: personalizedRecommendationParametersSchema.optional(),
  })
  .strict();

export const personalizedRecommendationReasonCodeSchema = z.enum([
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

export const personalizedRecommendationReasonSchema = z
  .object({
    code: personalizedRecommendationReasonCodeSchema,
    contribution: z.number().finite().optional(),
    source: z.enum(['commercial', 'affinity', 'context', 'fallback']),
  })
  .strict();

export const personalizedRecommendationExclusionCodeSchema = z.enum([
  'EXPLICIT_CONTEXT_EXCLUSION',
  'EXPLICIT_PRODUCT_REJECTION',
  'BELOW_MINIMUM_PERSONALIZED_SCORE',
  'RESULT_LIMIT_TRUNCATION',
]);

export const personalizedRecommendationExclusionSchema = z
  .object({
    product: productRelationshipProductReferenceSchema,
    code: personalizedRecommendationExclusionCodeSchema,
    commercialScore: zeroToOneSchema,
    affinityScore: zeroToOneSchema.optional(),
  })
  .strict();

export const personalizedRecommendationWarningCodeSchema = z.enum([
  'CUSTOMER_AFFINITY_UNAVAILABLE',
  'CUSTOMER_NOT_IDENTIFIED',
  'NO_CUSTOMER_HISTORY',
  'PARTIAL_CUSTOMER_HISTORY',
  'AFFINITY_MISSING_FOR_PRODUCT',
  'AFFINITY_FOR_UNKNOWN_PRODUCT_IGNORED',
  'CUSTOMER_MISMATCH',
  'SCORING_PARAMETER_OVERRIDE',
  'PERSONALIZATION_CONTEXT_PARTIALLY_APPLIED',
  'COMMERCIAL_WARNING_PROPAGATED',
  'AFFINITY_WARNING_PROPAGATED',
]);

export const personalizedRecommendationWarningSchema = z
  .object({
    code: personalizedRecommendationWarningCodeSchema,
    productIdentity: nonEmptyStringSchema.optional(),
    details: z.record(jsonValueSchema).optional(),
  })
  .strict();

export const personalizedRecommendationScoreComponentsSchema = z
  .object({
    commercialScore: zeroToOneSchema,
    normalizedCommercialContribution: zeroToOneSchema,
    affinityScore: zeroToOneSchema,
    affinityConfidenceMultiplier: zeroToOneSchema,
    normalizedAffinityContribution: zeroToOneSchema,
    explicitPreferenceBoost: nonNegativeNumberSchema.max(1),
    rejectionPenalty: nonNegativeNumberSchema.max(1),
    rawScore: z.number().finite(),
    finalScore: zeroToOneSchema,
  })
  .strict();

export const personalizedRecommendationSchema = z
  .object({
    product: productRelationshipProductReferenceSchema,
    personalizedScore: zeroToOneSchema,
    components: personalizedRecommendationScoreComponentsSchema,
    affinityConfidence: customerAffinityConfidenceSchema,
    reasons: z.array(personalizedRecommendationReasonSchema),
    commercialRecommendation: commercialRecommendationSchema,
    customerAffinity: customerProductAffinitySchema.optional(),
    originalCommercialRank: positiveIntegerSchema,
    personalizedRank: positiveIntegerSchema,
    warnings: z.array(personalizedRecommendationWarningSchema),
  })
  .strict()
  .superRefine((recommendation, context) => {
    if (recommendation.personalizedScore !== recommendation.components.finalScore) {
      addIssue(context, ['personalizedScore'], 'personalizedScore must equal components.finalScore');
    }
    const reasonCodes = recommendation.reasons.map((reason) => reason.code);
    if (new Set(reasonCodes).size !== reasonCodes.length) {
      addIssue(context, ['reasons'], 'reasons must be unique by code');
    }
  });

export const personalizedRecommendationStatisticsSchema = z
  .object({
    commercialCandidatesReceived: nonNegativeIntegerSchema,
    affinityEntriesReceived: nonNegativeIntegerSchema,
    candidatesWithAffinity: nonNegativeIntegerSchema,
    candidatesWithoutAffinity: nonNegativeIntegerSchema,
    affinityEntriesIgnored: nonNegativeIntegerSchema,
    contextExclusions: nonNegativeIntegerSchema,
    rejectionExclusions: nonNegativeIntegerSchema,
    minimumScoreExclusions: nonNegativeIntegerSchema,
    resultLimitTruncations: nonNegativeIntegerSchema,
    personalizedRecommendationsReturned: nonNegativeIntegerSchema,
    recommendationsWithEffectivePersonalization: nonNegativeIntegerSchema,
    commercialFallbackRecommendations: nonNegativeIntegerSchema,
    warningsGenerated: nonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((statistics, context) => {
    if (
      statistics.candidatesWithAffinity + statistics.candidatesWithoutAffinity !==
      statistics.commercialCandidatesReceived
    ) {
      addIssue(context, ['candidatesWithAffinity'], 'affinity coverage must equal commercial candidates received');
    }
    const terminalCount =
      statistics.personalizedRecommendationsReturned +
      statistics.contextExclusions +
      statistics.rejectionExclusions +
      statistics.minimumScoreExclusions +
      statistics.resultLimitTruncations;
    if (terminalCount !== statistics.commercialCandidatesReceived) {
      addIssue(context, ['personalizedRecommendationsReturned'], 'terminal recommendation states must equal commercial candidates received');
    }
    if (
      statistics.recommendationsWithEffectivePersonalization + statistics.commercialFallbackRecommendations !==
      statistics.personalizedRecommendationsReturned
    ) {
      addIssue(context, ['recommendationsWithEffectivePersonalization'], 'returned personalization states must equal returned recommendations');
    }
  });

export const personalizedRecommendationResultSchema = z
  .object({
    customer: customerAffinityCustomerReferenceSchema.optional(),
    recommendations: z.array(personalizedRecommendationSchema),
    excluded: z.array(personalizedRecommendationExclusionSchema),
    warnings: z.array(personalizedRecommendationWarningSchema),
    statistics: personalizedRecommendationStatisticsSchema,
    scoringVersion: nonEmptyStringSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const ranks = result.recommendations.map((recommendation) => recommendation.personalizedRank);
    const sortedRanks = [...ranks].sort((left, right) => left - right);
    for (const [index, rank] of sortedRanks.entries()) {
      if (rank !== index + 1) {
        addIssue(context, ['recommendations'], 'personalizedRank must be contiguous from 1');
        break;
      }
    }
  });

export type ProductRuntimeReference = ProductRelationshipProductReference;
export type MoneyContext = z.infer<typeof personalizedRecommendationMoneyContextSchema>;
export type PersonalizedRecommendationContext = Omit<z.infer<typeof personalizedRecommendationContextSchema>, 'preferredProductIds' | 'excludedProductIds'> & {
  readonly preferredProductIds?: readonly ProductRuntimeReference[];
  readonly excludedProductIds?: readonly ProductRuntimeReference[];
};
export type PersonalizedRecommendationParameters = z.infer<typeof personalizedRecommendationParametersSchema>;
export type CommercialRecommendation = ProductRecommendation;
export type PersonalizedRecommendationRequest = {
  readonly commercialRecommendations: ProductRecommendationResult;
  readonly customerAffinities?: CustomerProductAffinityResult;
  readonly context?: PersonalizedRecommendationContext;
  readonly parameters?: PersonalizedRecommendationParameters;
};
export type PersonalizedRecommendationReasonCode = z.infer<typeof personalizedRecommendationReasonCodeSchema>;
export type PersonalizedRecommendationReason = z.infer<typeof personalizedRecommendationReasonSchema>;
export type PersonalizedRecommendationExclusionCode = z.infer<typeof personalizedRecommendationExclusionCodeSchema>;
export type PersonalizedRecommendationExclusion = z.infer<typeof personalizedRecommendationExclusionSchema>;
export type PersonalizedRecommendationWarningCode = z.infer<typeof personalizedRecommendationWarningCodeSchema>;
export type PersonalizedRecommendationWarning = z.infer<typeof personalizedRecommendationWarningSchema>;
export type PersonalizedRecommendationScoreComponents = z.infer<typeof personalizedRecommendationScoreComponentsSchema>;
export type PersonalizedRecommendation = Omit<
  z.infer<typeof personalizedRecommendationSchema>,
  'reasons' | 'warnings' | 'commercialRecommendation' | 'customerAffinity'
> & {
  readonly reasons: readonly PersonalizedRecommendationReason[];
  readonly warnings: readonly PersonalizedRecommendationWarning[];
  readonly commercialRecommendation: CommercialRecommendation;
  readonly customerAffinity?: CustomerProductAffinity;
};
export type PersonalizedRecommendationStatistics = z.infer<typeof personalizedRecommendationStatisticsSchema>;
export type PersonalizedRecommendationResult = Omit<z.infer<typeof personalizedRecommendationResultSchema>, 'recommendations' | 'excluded' | 'warnings'> & {
  readonly customer?: CustomerAffinityCustomerReference;
  readonly recommendations: readonly PersonalizedRecommendation[];
  readonly excluded: readonly PersonalizedRecommendationExclusion[];
  readonly warnings: readonly PersonalizedRecommendationWarning[];
};

export type PersonalizedRecommendationScoreResult = {
  components: PersonalizedRecommendationScoreComponents;
  affinityConfidence: CustomerAffinityConfidence;
  effectivePersonalization: boolean;
  productRejected: boolean;
  categoryRejected: boolean;
};

export interface PersonalizedRecommendationScorer {
  score(
    commercialRecommendation: CommercialRecommendation,
    affinity: CustomerProductAffinity | undefined,
    context: PersonalizedRecommendationContext | undefined,
    parameters: PersonalizedRecommendationParameters,
  ): PersonalizedRecommendationScoreResult;
}

export interface PersonalizedRecommendationService {
  personalize(request: PersonalizedRecommendationRequest): PersonalizedRecommendationResult;
}

export const personalizedRecommendationWeightTolerance = WEIGHT_TOLERANCE;
export type PersonalizedProductIdentity = ProductRuntimeIdentity;
