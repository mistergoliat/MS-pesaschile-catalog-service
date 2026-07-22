import { z } from 'zod';
import {
  calculatedProductRelationshipSchema,
  type CalculatedProductRelationship,
} from '../contracts.js';

export const RELATIONSHIP_METRIC_TOLERANCE = 1e-12;

const productRelationshipValidationRejectionCodes = [
  'INVALID_SOURCE_PRODUCT',
  'INVALID_TARGET_PRODUCT',
  'SELF_RELATIONSHIP',
  'UNSUPPORTED_RELATIONSHIP_TYPE',
  'EVIDENCE_TYPE_MISMATCH',
  'INVALID_EVIDENCE_WINDOW',
  'INVALID_MODEL_VERSION',
  'INVALID_SUPPORT',
  'INVALID_CONFIDENCE',
  'INVALID_LIFT',
  'INVALID_RELIABILITY',
  'INVALID_JOINT_COUNT',
  'INVALID_EVIDENCE_COUNTS',
  'INCONSISTENT_EVIDENCE_COUNTS',
  'INCONSISTENT_SUPPORT',
  'INCONSISTENT_CONFIDENCE',
  'INCONSISTENT_LIFT',
  'NON_POSITIVE_ASSOCIATION',
  'RELIABILITY_BELOW_MINIMUM',
  'DUPLICATE_RELATIONSHIP',
  'NON_SERIALIZABLE_RELATIONSHIP',
] as const;

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

function addIssue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
  });
}

export const relationshipValidationParametersSchema = z
  .object({
    minimumReliability: z.number().finite().min(0).max(1),
    rejectNegativeAssociation: z.boolean(),
  })
  .strict();

export const DEFAULT_RELATIONSHIP_VALIDATION_PARAMETERS = {
  minimumReliability: 0.3,
  rejectNegativeAssociation: true,
} as const;

export const validatedProductRelationshipSchema = z
  .object({
    relationship: calculatedProductRelationshipSchema,
    validatedAtModelVersion: z.string().trim().min(1),
  })
  .strict()
  .superRefine((validated, context) => {
    if (validated.validatedAtModelVersion !== validated.relationship.modelVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'validatedAtModelVersion must match relationship.modelVersion',
        path: ['validatedAtModelVersion'],
      });
    }
  });

export const productRelationshipValidationRejectionCodeSchema = z.enum(productRelationshipValidationRejectionCodes);

export type ProductRelationshipValidationRejectionCode = z.infer<typeof productRelationshipValidationRejectionCodeSchema>;

export const productRelationshipValidationWarningCodeSchema = z.enum([
  'EMPTY_INPUT',
  'NO_VALID_RELATIONSHIPS',
  'PARTIAL_VALIDATION_SUCCESS',
]);

export const productRelationshipValidationRejectionSchema = z
  .object({
    index: z.number().int().nonnegative(),
    code: productRelationshipValidationRejectionCodeSchema,
    message: z.string().trim().min(1),
    relationship: z.custom<CalculatedProductRelationship>().optional(),
    details: z.unknown().optional(),
  })
  .strict()
  .superRefine((rejection, context) => {
    if (rejection.details !== undefined && !isJsonSerializable(rejection.details)) {
      addIssue(context, ['details'], 'details must be JSON serializable');
    }
  });

export const productRelationshipValidationWarningSchema = z
  .object({
    code: productRelationshipValidationWarningCodeSchema,
    message: z.string().trim().min(1),
    details: z.unknown().optional(),
  })
  .strict()
  .superRefine((warning, context) => {
    if (warning.details !== undefined && !isJsonSerializable(warning.details)) {
      addIssue(context, ['details'], 'details must be JSON serializable');
    }
  });

const rejectedByCodeSchema = z
  .record(z.string(), z.number().int().positive())
  .superRefine((rejectedByCode, context) => {
    for (const code of Object.keys(rejectedByCode)) {
      if (!productRelationshipValidationRejectionCodeSchema.safeParse(code).success) {
        addIssue(context, [code], 'rejectedByCode contains an unknown rejection code');
      }
    }
  });

export const productRelationshipValidationStatisticsSchema = z
  .object({
    relationshipsRead: z.number().int().nonnegative(),
    relationshipsAccepted: z.number().int().nonnegative(),
    relationshipsRejected: z.number().int().nonnegative(),
    rejectedByCode: rejectedByCodeSchema,
    distinctSourceProductsAccepted: z.number().int().nonnegative(),
    distinctTargetProductsAccepted: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((statistics, context) => {
    if (statistics.relationshipsRead !== statistics.relationshipsAccepted + statistics.relationshipsRejected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relationshipsRead must equal accepted plus rejected',
        path: ['relationshipsRead'],
      });
    }
    const rejectedTotal = Object.values(statistics.rejectedByCode).reduce((sum, value) => sum + value, 0);
    if (rejectedTotal !== statistics.relationshipsRejected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rejectedByCode total must equal relationshipsRejected',
        path: ['rejectedByCode'],
      });
    }
  });

export const productRelationshipValidationResultSchema = z
  .object({
    validRelationships: z.array(validatedProductRelationshipSchema),
    rejections: z.array(productRelationshipValidationRejectionSchema),
    warnings: z.array(productRelationshipValidationWarningSchema),
    statistics: productRelationshipValidationStatisticsSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.statistics.relationshipsAccepted !== result.validRelationships.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relationshipsAccepted must equal validRelationships.length',
        path: ['statistics', 'relationshipsAccepted'],
      });
    }
    if (result.statistics.relationshipsRejected !== result.rejections.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relationshipsRejected must equal rejections.length',
        path: ['statistics', 'relationshipsRejected'],
      });
    }
  });

export interface ProductRelationshipValidator {
  validate(input: {
    relationships: CalculatedProductRelationship[];
    parameters?: RelationshipValidationParameters;
  }): ProductRelationshipValidationResult;
}

export type RelationshipValidationParameters = z.infer<typeof relationshipValidationParametersSchema>;
export type ValidatedProductRelationship = z.infer<typeof validatedProductRelationshipSchema>;
export type ProductRelationshipValidationRejection = z.infer<typeof productRelationshipValidationRejectionSchema>;
export type ProductRelationshipValidationWarningCode = z.infer<typeof productRelationshipValidationWarningCodeSchema>;
export type ProductRelationshipValidationWarning = z.infer<typeof productRelationshipValidationWarningSchema>;
export type ProductRelationshipValidationStatistics = z.infer<typeof productRelationshipValidationStatisticsSchema>;
export type ProductRelationshipValidationResult = z.infer<typeof productRelationshipValidationResultSchema>;
