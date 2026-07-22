import { z } from 'zod';
import {
  productRelationshipProductReferenceSchema,
  type ProductRelationshipProductReference,
} from '../relationship-engine/contracts.js';
import type { JsonValue } from '../relationship-engine/publication/contracts.js';
import type { ProductRuntimeIdentity } from '../relationship-engine/runtime/index.js';

const ISO_DATE_MESSAGE = 'Expected an ISO-8601 date-time string';
const nonEmptyStringSchema = z.string().trim().min(1);
const zeroToOneSchema = z.number().finite().min(0).max(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveNumberSchema = z.number().finite().positive();
const nonNegativeNumberSchema = z.number().finite().nonnegative();

function isIsoDateTime(value: string): boolean {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

const isoDateTimeSchema = nonEmptyStringSchema.refine(isIsoDateTime, ISO_DATE_MESSAGE);

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

export const CUSTOMER_AFFINITY_SCORING_VERSION = 'customer-affinity-v1';

export const customerAffinitySignalCodeSchema = z.enum([
  'DIRECT_PRODUCT_PURCHASE',
  'CATEGORY_PURCHASE',
  'BRAND_PURCHASE',
  'RECENT_PRODUCT_INTEREST',
  'RECENT_CATEGORY_INTEREST',
  'PRODUCT_REJECTION',
  'CATEGORY_REJECTION',
  'OWNED_COMPATIBLE_PRODUCT',
  'REPEAT_PURCHASE_PATTERN',
  'OBSERVED_SPEND_FIT',
]);

export const customerAffinityConfidenceSchema = z.enum(['none', 'low', 'medium', 'high']);

export const customerAffinityWarningCodeSchema = z.enum([
  'CUSTOMER_NOT_IDENTIFIED',
  'NO_CUSTOMER_HISTORY',
  'PARTIAL_CUSTOMER_HISTORY',
  'REFERENCE_TIME_UNAVAILABLE',
  'INVALID_EVIDENCE_IGNORED',
  'CURRENCY_MISMATCH',
  'SPEND_PROFILE_UNAVAILABLE',
  'AFFINITY_PROVIDER_WARNING',
]);

export const customerAffinityCustomerReferenceSchema = z
  .object({
    customerId: nonEmptyStringSchema,
  })
  .strict()
  .superRefine((customer, context) => {
    if (['0', 'unknown'].includes(customer.customerId.trim().toLowerCase())) {
      addIssue(context, ['customerId'], 'customerId must not use sentinel values');
    }
  });

export const customerAffinityContextSchema = z
  .object({
    channel: nonEmptyStringSchema.optional(),
    intent: nonEmptyStringSchema.optional(),
    currency: nonEmptyStringSchema.optional(),
    referenceTime: isoDateTimeSchema.optional(),
  })
  .strict();

export const customerAffinityParametersSchema = z
  .object({
    recentInterestWindowDays: positiveNumberSchema,
    recentPurchaseWindowDays: positiveNumberSchema,
    rejectionWindowDays: positiveNumberSchema,
    directProductPurchaseWeight: nonNegativeNumberSchema,
    categoryPurchaseWeight: nonNegativeNumberSchema,
    brandPurchaseWeight: nonNegativeNumberSchema,
    recentProductInterestWeight: nonNegativeNumberSchema,
    recentCategoryInterestWeight: nonNegativeNumberSchema,
    ownedCompatibleProductWeight: nonNegativeNumberSchema,
    repeatPurchasePatternWeight: nonNegativeNumberSchema,
    observedSpendFitWeight: nonNegativeNumberSchema,
    productRejectionPenalty: nonNegativeNumberSchema,
    categoryRejectionPenalty: nonNegativeNumberSchema,
    minimumEvidenceForHighConfidence: z.number().int().positive(),
    minimumEvidenceForMediumConfidence: z.number().int().positive(),
  })
  .strict()
  .superRefine((parameters, context) => {
    if (parameters.minimumEvidenceForHighConfidence < parameters.minimumEvidenceForMediumConfidence) {
      addIssue(context, ['minimumEvidenceForHighConfidence'], 'high confidence evidence must be >= medium threshold');
    }
    const positiveWeight =
      parameters.directProductPurchaseWeight +
      parameters.categoryPurchaseWeight +
      parameters.brandPurchaseWeight +
      parameters.recentProductInterestWeight +
      parameters.recentCategoryInterestWeight +
      parameters.ownedCompatibleProductWeight +
      parameters.repeatPurchasePatternWeight +
      parameters.observedSpendFitWeight;
    if (positiveWeight <= 0) {
      addIssue(context, ['directProductPurchaseWeight'], 'at least one positive weight must be greater than zero');
    }
  });

export const DEFAULT_CUSTOMER_AFFINITY_PARAMETERS = Object.freeze({
  recentInterestWindowDays: 30,
  recentPurchaseWindowDays: 180,
  rejectionWindowDays: 180,
  directProductPurchaseWeight: 0.2,
  categoryPurchaseWeight: 0.1,
  brandPurchaseWeight: 0.05,
  recentProductInterestWeight: 0.25,
  recentCategoryInterestWeight: 0.1,
  ownedCompatibleProductWeight: 0.15,
  repeatPurchasePatternWeight: 0.1,
  observedSpendFitWeight: 0.05,
  productRejectionPenalty: 0.5,
  categoryRejectionPenalty: 0.25,
  minimumEvidenceForHighConfidence: 3,
  minimumEvidenceForMediumConfidence: 2,
} as const);

export const moneyEvidenceSchema = z
  .object({
    currency: nonEmptyStringSchema,
    amount: nonNegativeNumberSchema,
  })
  .strict();

const countedEvidenceSchema = z
  .object({
    count: z.number().int().positive().optional(),
    occurredAt: isoDateTimeSchema.optional(),
    details: z.record(jsonValueSchema).optional(),
  })
  .strict();

export const purchaseEvidenceSchema = countedEvidenceSchema;
export const categoryPurchaseEvidenceSchema = countedEvidenceSchema.extend({ categoryId: nonEmptyStringSchema.optional() }).strict();
export const brandPurchaseEvidenceSchema = countedEvidenceSchema.extend({ brandId: nonEmptyStringSchema.optional() }).strict();
export const interestEvidenceSchema = countedEvidenceSchema.extend({ interestType: nonEmptyStringSchema.optional() }).strict();
export const categoryInterestEvidenceSchema = countedEvidenceSchema.extend({ categoryId: nonEmptyStringSchema.optional() }).strict();
export const rejectionEvidenceSchema = countedEvidenceSchema.extend({ reasonCode: nonEmptyStringSchema.optional() }).strict();
export const categoryRejectionEvidenceSchema = countedEvidenceSchema.extend({ categoryId: nonEmptyStringSchema.optional() }).strict();
export const compatibleOwnershipEvidenceSchema = countedEvidenceSchema.extend({
  ownedProduct: productRelationshipProductReferenceSchema,
}).strict();

export const repeatPurchaseEvidenceSchema = z
  .object({
    purchaseCount: z.number().int().positive(),
    medianIntervalDays: positiveNumberSchema.optional(),
    lastPurchasedAt: isoDateTimeSchema.optional(),
    consistency: zeroToOneSchema.optional(),
    details: z.record(jsonValueSchema).optional(),
  })
  .strict();

export const customerProductEvidenceSchema = z
  .object({
    product: productRelationshipProductReferenceSchema,
    directPurchases: z.array(purchaseEvidenceSchema).optional(),
    categoryPurchases: z.array(categoryPurchaseEvidenceSchema).optional(),
    brandPurchases: z.array(brandPurchaseEvidenceSchema).optional(),
    productInterests: z.array(interestEvidenceSchema).optional(),
    categoryInterests: z.array(categoryInterestEvidenceSchema).optional(),
    productRejections: z.array(rejectionEvidenceSchema).optional(),
    categoryRejections: z.array(categoryRejectionEvidenceSchema).optional(),
    ownedCompatibleProducts: z.array(compatibleOwnershipEvidenceSchema).optional(),
    repeatPurchasePattern: repeatPurchaseEvidenceSchema.optional(),
    candidatePrice: moneyEvidenceSchema.optional(),
  })
  .strict();

export const customerCommercialProfileEvidenceSchema = z
  .object({
    observedMinimumSpend: moneyEvidenceSchema.optional(),
    observedMaximumSpend: moneyEvidenceSchema.optional(),
    observedAverageSpend: moneyEvidenceSchema.optional(),
    orderCount: nonNegativeIntegerSchema.optional(),
  })
  .strict();

export const customerAffinityProviderWarningSchema = z
  .object({
    code: nonEmptyStringSchema,
    details: z.record(jsonValueSchema).optional(),
  })
  .strict();

export const customerAffinityEvidenceResultSchema = z
  .object({
    customer: customerAffinityCustomerReferenceSchema,
    productEvidence: z.array(customerProductEvidenceSchema),
    customerProfile: customerCommercialProfileEvidenceSchema.optional(),
    warnings: z.array(customerAffinityProviderWarningSchema).optional(),
  })
  .strict();

export const customerProductAffinityRequestSchema = z
  .object({
    customer: customerAffinityCustomerReferenceSchema.optional(),
    products: z.array(productRelationshipProductReferenceSchema),
    context: customerAffinityContextSchema.optional(),
    parameters: customerAffinityParametersSchema.optional(),
  })
  .strict();

export const customerAffinitySignalSchema = z
  .object({
    code: customerAffinitySignalCodeSchema,
    direction: z.enum(['positive', 'negative']),
    strength: zeroToOneSchema,
  })
  .strict()
  .superRefine((signal, context) => {
    const negativeCodes = new Set(['PRODUCT_REJECTION', 'CATEGORY_REJECTION']);
    const mustBeNegative = negativeCodes.has(signal.code);
    if (mustBeNegative && signal.direction !== 'negative') addIssue(context, ['direction'], 'rejection signals must be negative');
    if (!mustBeNegative && signal.direction !== 'positive') addIssue(context, ['direction'], 'non-rejection signals must be positive');
  });

export const customerAffinityEvidenceSummarySchema = z
  .object({
    code: customerAffinitySignalCodeSchema,
    count: nonNegativeIntegerSchema,
    mostRecentAt: isoDateTimeSchema.optional(),
    details: z.record(jsonValueSchema).optional(),
  })
  .strict();

export const customerAffinityWarningSchema = z
  .object({
    code: customerAffinityWarningCodeSchema,
    productIdentity: z.string().trim().min(1).optional(),
    details: z.record(jsonValueSchema).optional(),
  })
  .strict();

export const customerProductAffinitySchema = z
  .object({
    product: productRelationshipProductReferenceSchema,
    score: zeroToOneSchema,
    confidence: customerAffinityConfidenceSchema,
    scoringVersion: nonEmptyStringSchema,
    signals: z.array(customerAffinitySignalSchema),
    evidence: z.array(customerAffinityEvidenceSummarySchema),
    warnings: z.array(customerAffinityWarningSchema),
  })
  .strict()
  .superRefine((affinity, context) => {
    const signalCodes = affinity.signals.map((signal) => signal.code);
    if (new Set(signalCodes).size !== signalCodes.length) addIssue(context, ['signals'], 'signals must be unique by code');
  });

export const customerAffinityStatisticsSchema = z
  .object({
    requestedProducts: nonNegativeIntegerSchema,
    deduplicatedProducts: nonNegativeIntegerSchema,
    duplicateProductsRemoved: nonNegativeIntegerSchema,
    productsWithEvidence: nonNegativeIntegerSchema,
    productsWithoutEvidence: nonNegativeIntegerSchema,
    positiveSignalsGenerated: nonNegativeIntegerSchema,
    negativeSignalsGenerated: nonNegativeIntegerSchema,
    warningsGenerated: nonNegativeIntegerSchema,
    providerCalls: z.union([z.literal(0), z.literal(1)]),
  })
  .strict()
  .superRefine((statistics, context) => {
    if (statistics.requestedProducts !== statistics.deduplicatedProducts + statistics.duplicateProductsRemoved) {
      addIssue(context, ['requestedProducts'], 'requestedProducts must equal deduplicated plus duplicates removed');
    }
    if (statistics.productsWithEvidence + statistics.productsWithoutEvidence !== statistics.deduplicatedProducts) {
      addIssue(context, ['productsWithEvidence'], 'evidence counts must equal deduplicated products');
    }
  });

export const customerProductAffinityResultSchema = z
  .object({
    customer: customerAffinityCustomerReferenceSchema.optional(),
    affinities: z.array(customerProductAffinitySchema),
    warnings: z.array(customerAffinityWarningSchema),
    statistics: customerAffinityStatisticsSchema,
  })
  .strict();

export type CustomerAffinitySignalCode = z.infer<typeof customerAffinitySignalCodeSchema>;
export type CustomerAffinityConfidence = z.infer<typeof customerAffinityConfidenceSchema>;
export type CustomerAffinityWarningCode = z.infer<typeof customerAffinityWarningCodeSchema>;
export type CustomerAffinityCustomerReference = z.infer<typeof customerAffinityCustomerReferenceSchema>;
export type CustomerAffinityContext = z.infer<typeof customerAffinityContextSchema>;
export type CustomerAffinityParameters = z.infer<typeof customerAffinityParametersSchema>;
export type MoneyEvidence = z.infer<typeof moneyEvidenceSchema>;
export type PurchaseEvidence = z.infer<typeof purchaseEvidenceSchema>;
export type CategoryPurchaseEvidence = z.infer<typeof categoryPurchaseEvidenceSchema>;
export type BrandPurchaseEvidence = z.infer<typeof brandPurchaseEvidenceSchema>;
export type InterestEvidence = z.infer<typeof interestEvidenceSchema>;
export type CategoryInterestEvidence = z.infer<typeof categoryInterestEvidenceSchema>;
export type RejectionEvidence = z.infer<typeof rejectionEvidenceSchema>;
export type CategoryRejectionEvidence = z.infer<typeof categoryRejectionEvidenceSchema>;
export type CompatibleOwnershipEvidence = z.infer<typeof compatibleOwnershipEvidenceSchema>;
export type RepeatPurchaseEvidence = z.infer<typeof repeatPurchaseEvidenceSchema>;
export type CustomerProductEvidence = z.infer<typeof customerProductEvidenceSchema>;
export type CustomerCommercialProfileEvidence = z.infer<typeof customerCommercialProfileEvidenceSchema>;
export type CustomerAffinityProviderWarning = z.infer<typeof customerAffinityProviderWarningSchema>;
export type CustomerAffinityEvidenceResult = z.infer<typeof customerAffinityEvidenceResultSchema>;
export type CustomerProductAffinityRequest = Omit<z.infer<typeof customerProductAffinityRequestSchema>, 'products'> & {
  readonly products: readonly ProductRelationshipProductReference[];
};
export type CustomerAffinitySignal = z.infer<typeof customerAffinitySignalSchema>;
export type CustomerAffinityEvidenceSummary = z.infer<typeof customerAffinityEvidenceSummarySchema>;
export type CustomerAffinityWarning = z.infer<typeof customerAffinityWarningSchema>;
export type CustomerProductAffinity = Omit<z.infer<typeof customerProductAffinitySchema>, 'signals' | 'evidence' | 'warnings'> & {
  readonly signals: readonly CustomerAffinitySignal[];
  readonly evidence: readonly CustomerAffinityEvidenceSummary[];
  readonly warnings: readonly CustomerAffinityWarning[];
};
export type CustomerAffinityStatistics = z.infer<typeof customerAffinityStatisticsSchema>;
export type CustomerProductAffinityResult = Omit<z.infer<typeof customerProductAffinityResultSchema>, 'affinities' | 'warnings'> & {
  readonly affinities: readonly CustomerProductAffinity[];
  readonly warnings: readonly CustomerAffinityWarning[];
};

export type CustomerAffinityEvaluation = {
  product: ProductRelationshipProductReference;
  productIdentity: ProductRuntimeIdentity;
  signals: readonly CustomerAffinitySignal[];
  evidence: readonly CustomerAffinityEvidenceSummary[];
  warnings: readonly CustomerAffinityWarning[];
  validEvidenceCount: number;
};

export type CustomerAffinityScoreResult = {
  score: number;
  confidence: CustomerAffinityConfidence;
  scoringVersion: string;
};

export interface CustomerAffinityEvidenceProvider {
  getEvidence(
    customer: CustomerAffinityCustomerReference,
    products: readonly ProductRelationshipProductReference[],
    context?: CustomerAffinityContext,
  ): Promise<CustomerAffinityEvidenceResult>;
}

export interface CustomerAffinityEvaluator {
  evaluate(
    product: ProductRelationshipProductReference,
    evidence: CustomerProductEvidence | undefined,
    profile: CustomerCommercialProfileEvidence | undefined,
    context: CustomerAffinityContext | undefined,
    parameters: CustomerAffinityParameters,
  ): CustomerAffinityEvaluation;
}

export interface CustomerAffinityScorer {
  score(
    evaluation: CustomerAffinityEvaluation,
    parameters: CustomerAffinityParameters,
  ): CustomerAffinityScoreResult;
}

export interface CustomerProductAffinityProvider {
  getAffinities(request: CustomerProductAffinityRequest): Promise<CustomerProductAffinityResult>;
}
