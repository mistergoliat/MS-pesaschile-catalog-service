import { z } from 'zod';
import {
  productInteractionDatasetSchema,
  productRelationshipBuildInputSchema,
  productRelationshipProductReferenceSchema,
  relationshipDataWindowSchema,
  type ProductInteractionDataset,
  type ProductRelationshipBuildInput,
} from '../contracts.js';
import { relationshipTypeSchema, type RelationshipType } from '../../contracts.js';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonSerializable(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return false;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return value.every((item) => isJsonSerializable(item, seen));
  }
  if (isPlainRecord(value)) {
    if (value instanceof Error || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return Object.values(value).every((item) => isJsonSerializable(item, seen));
  }
  return false;
}

const nonEmptyStringSchema = z.string().trim().min(1);
const zeroToOneSchema = z.number().finite().min(0).max(1);
const finiteNonNegativeNumberSchema = z.number().finite().nonnegative();
const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const coOccurrenceRelationshipEvidenceSchema = z
  .object({
    kind: z.literal('co_occurrence'),
    jointCount: nonNegativeIntegerSchema,
    sourceCount: nonNegativeIntegerSchema,
    targetCount: nonNegativeIntegerSchema,
    totalTransactions: nonNegativeIntegerSchema,
    support: finiteNonNegativeNumberSchema,
    confidence: zeroToOneSchema,
    lift: finiteNonNegativeNumberSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.totalTransactions === 0 && evidence.jointCount > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'jointCount requires totalTransactions greater than zero',
        path: ['jointCount'],
      });
    }
    if (evidence.sourceCount === 0 && evidence.jointCount > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'jointCount requires sourceCount greater than zero',
        path: ['sourceCount'],
      });
    }
    if (evidence.targetCount === 0 && evidence.jointCount > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'jointCount requires targetCount greater than zero',
        path: ['targetCount'],
      });
    }
  });

export const productRelationshipCandidateSchema = z
  .object({
    sourceProduct: productRelationshipProductReferenceSchema,
    targetProduct: productRelationshipProductReferenceSchema,
    relationshipType: z.literal('same_order'),
    evidence: coOccurrenceRelationshipEvidenceSchema,
    evidenceWindow: relationshipDataWindowSchema,
    modelVersion: nonEmptyStringSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    const sourceKey = `${candidate.sourceProduct.productId}:${candidate.sourceProduct.combinationId ?? ''}`;
    const targetKey = `${candidate.targetProduct.productId}:${candidate.targetProduct.combinationId ?? ''}`;
    if (sourceKey === targetKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Candidate source and target products must be different',
        path: ['targetProduct'],
      });
    }
  });

export const sameOrderCalculationStatisticsSchema = z
  .object({
    transactionsRead: nonNegativeIntegerSchema,
    ordersRead: nonNegativeIntegerSchema,
    cartsIgnored: nonNegativeIntegerSchema,
    ordersOutsideDataWindow: nonNegativeIntegerSchema,
    singleProductOrdersIgnored: nonNegativeIntegerSchema,
    ordersProcessed: nonNegativeIntegerSchema,
    distinctProductsObserved: nonNegativeIntegerSchema,
    directedPairsObserved: nonNegativeIntegerSchema,
    candidatesGenerated: nonNegativeIntegerSchema,
    candidatesRejectedByJointCount: nonNegativeIntegerSchema,
    candidatesRejectedByConfidence: nonNegativeIntegerSchema,
    candidatesRejectedByLift: nonNegativeIntegerSchema,
    candidatesRejectedBySourceLimit: nonNegativeIntegerSchema,
    candidatesAccepted: nonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((statistics, context) => {
    if (
      statistics.ordersRead !==
      statistics.ordersOutsideDataWindow + statistics.singleProductOrdersIgnored + statistics.ordersProcessed
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ordersRead must equal outside-window plus single-product plus processed orders',
        path: ['ordersRead'],
      });
    }
    if (statistics.transactionsRead !== statistics.ordersRead + statistics.cartsIgnored) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'transactionsRead must equal ordersRead plus cartsIgnored',
        path: ['transactionsRead'],
      });
    }
  });

export const sameOrderCalculationWarningCodeSchema = z.enum([
  'EMPTY_DATASET',
  'NO_ELIGIBLE_ORDERS',
  'NO_RELATIONSHIPS_GENERATED',
  'SOURCE_RELATIONSHIP_LIMIT_APPLIED',
]);

export const sameOrderCalculationWarningSchema = z
  .object({
    code: sameOrderCalculationWarningCodeSchema,
    message: nonEmptyStringSchema,
    sourceProduct: productRelationshipProductReferenceSchema.optional(),
    details: z.unknown().optional(),
  })
  .strict()
  .superRefine((warning, context) => {
    if (warning.details !== undefined && !isJsonSerializable(warning.details)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'details must be JSON serializable',
        path: ['details'],
      });
    }
  });

export const productRelationshipCandidateCalculationResultSchema = z
  .object({
    candidates: z.array(productRelationshipCandidateSchema),
    statistics: sameOrderCalculationStatisticsSchema,
    warnings: z.array(sameOrderCalculationWarningSchema),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.statistics.candidatesAccepted !== result.candidates.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'candidatesAccepted must equal candidates.length',
        path: ['statistics', 'candidatesAccepted'],
      });
    }
  });

export const productRelationshipCandidateCalculatorInputSchema = z
  .object({
    dataset: productInteractionDatasetSchema,
    buildInput: productRelationshipBuildInputSchema,
  })
  .strict();

export interface ProductRelationshipCandidateCalculator {
  supports(type: RelationshipType): boolean;

  calculate(input: {
    dataset: ProductInteractionDataset;
    buildInput: ProductRelationshipBuildInput;
  }): ProductRelationshipCandidateCalculationResult;
}

export type CoOccurrenceRelationshipEvidence = z.infer<typeof coOccurrenceRelationshipEvidenceSchema>;
export type ProductRelationshipCandidate = z.infer<typeof productRelationshipCandidateSchema>;
export type SameOrderCalculationStatistics = z.infer<typeof sameOrderCalculationStatisticsSchema>;
export type SameOrderCalculationWarningCode = z.infer<typeof sameOrderCalculationWarningCodeSchema>;
export type SameOrderCalculationWarning = z.infer<typeof sameOrderCalculationWarningSchema>;
export type ProductRelationshipCandidateCalculationResult = z.infer<typeof productRelationshipCandidateCalculationResultSchema>;

export { relationshipTypeSchema };

