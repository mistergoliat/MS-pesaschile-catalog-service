import { z } from 'zod';
import {
  calculatedProductRelationshipSchema,
  type CalculatedProductRelationship,
} from '../contracts.js';
import {
  productRelationshipCandidateSchema,
  type ProductRelationshipCandidate,
} from '../calculators/contracts.js';

export const relationshipReliabilityScoreSchema = z.number().finite().min(0).max(1);

export const reliabilityEvaluationParametersSchema = z
  .object({
    confidenceWeight: z.number().finite().nonnegative(),
    liftWeight: z.number().finite().nonnegative(),
    supportWeight: z.number().finite().nonnegative(),
    jointCountWeight: z.number().finite().nonnegative(),
    jointCountScale: z.number().finite().positive(),
  })
  .strict()
  .superRefine((parameters, context) => {
    const total =
      parameters.confidenceWeight +
      parameters.liftWeight +
      parameters.supportWeight +
      parameters.jointCountWeight;
    if (Math.abs(total - 1) > Number.EPSILON) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reliability weights must sum exactly to 1',
        path: ['confidenceWeight'],
      });
    }
  });

export const relationshipReliabilityEvaluationInputSchema = z
  .object({
    candidate: productRelationshipCandidateSchema,
  })
  .strict();

export const relationshipReliabilityEvaluationResultSchema = z
  .object({
    relationship: calculatedProductRelationshipSchema,
  })
  .strict();

export type RelationshipReliabilityScore = z.infer<typeof relationshipReliabilityScoreSchema>;
export type ReliabilityEvaluationParameters = z.infer<typeof reliabilityEvaluationParametersSchema>;
export type RelationshipReliabilityEvaluationInput = z.infer<typeof relationshipReliabilityEvaluationInputSchema>;
export type RelationshipReliabilityEvaluationResult = z.infer<typeof relationshipReliabilityEvaluationResultSchema>;

export class UnsupportedRelationshipReliabilityEvidenceError extends Error {
  constructor(kind: string) {
    super(`Reliability evaluation is not implemented for ${kind} evidence`);
    this.name = 'UnsupportedRelationshipReliabilityEvidenceError';
  }
}

export interface ProductRelationshipCandidateReliabilityEvaluator {
  evaluateCandidate(candidate: ProductRelationshipCandidate): CalculatedProductRelationship;

  evaluateCandidates(candidates: ProductRelationshipCandidate[]): CalculatedProductRelationship[];
}
