import { z } from 'zod';
import { semanticConditionSchema, semanticDimensionRequirementSchema, productFamilyObligationSchema,
  semanticObligationContractSchema, requirementStates, type SemanticObligationContract, type ProductAdmissionContext,
  type EvaluatedDimension } from './contracts.js';

export const supportedSpecKeys = ['max_user_weight_kg', 'max_load_kg', 'assembled_length_cm', 'assembled_width_cm', 'assembled_height_cm', 'weight_kg'] as const;
export type SpecKey = typeof supportedSpecKeys[number];
export const supportedSpecSources: Readonly<Record<SpecKey, readonly number[]>> = {
  max_user_weight_kg: [11], max_load_kg: [12, 41], assembled_length_cm: [15], assembled_width_cm: [15], assembled_height_cm: [15], weight_kg: [3],
};
const ref = z.string().trim().min(1);
export const semanticConditionV2Schema = z.union([semanticConditionSchema,
  z.object({ kind: z.literal('TRAINING_SOURCE_RULE_MATCHES'), dimension: z.enum(['TRAINING_EXERCISE', 'TRAINING_FUNCTION']) }).strict(),
  z.object({ kind: z.literal('SPEC_SOURCE_PRESENT'), sourceIds: z.array(z.number().int().positive()).min(1) }).strict(),
]);
export type SemanticConditionV2 = z.infer<typeof semanticConditionV2Schema>;
export const dimensionRequirementV2Schema = semanticDimensionRequirementSchema.innerType().extend({
  condition: semanticConditionV2Schema.optional(), requiresNegativeEvidence: z.boolean(), negativeEvidenceRationale: ref,
}).superRefine((d, ctx) => {
  if (['REQUIRED', 'CONDITIONAL'].includes(d.requirement) && (!d.resolutionCriteria || !d.evidenceRequirement))
    ctx.addIssue({ code: 'custom', message: 'Required obligation needs resolution/evidence criteria' });
  if (d.requirement === 'CONDITIONAL' ? !d.condition || !d.whenFalse : !!d.condition || !!d.whenFalse)
    ctx.addIssue({ code: 'custom', message: 'Only CONDITIONAL has a condition and whenFalse' });
  if (d.requirement === 'UNKNOWN' && d.resolutionCriteria)
    ctx.addIssue({ code: 'custom', message: 'UNKNOWN cannot define terminal criteria' });
  if (d.evidenceRequirement && d.evidenceRequirement.requiresNegativeEvidence !== d.requiresNegativeEvidence)
    ctx.addIssue({ code: 'custom', message: 'Negative evidence declarations disagree' });
});
export type DimensionRequirementV2 = z.infer<typeof dimensionRequirementV2Schema>;
export const specRequirementSchema = z.object({
  specKey: z.enum(supportedSpecKeys), requirement: z.enum(requirementStates), condition: semanticConditionV2Schema.optional(),
  whenFalse: z.enum(['UNKNOWN', 'NOT_REQUIRED']).optional(), acceptedSourceIds: z.array(z.number().int().positive()).min(1),
  rationale: ref, sourceReferences: z.array(ref).min(1), requiresNegativeEvidence: z.boolean(), negativeEvidenceRationale: ref,
}).strict().superRefine((s, ctx) => {
  if (s.requirement === 'CONDITIONAL' ? !s.condition || !s.whenFalse : !!s.condition || !!s.whenFalse)
    ctx.addIssue({ code: 'custom', message: 'Only conditional specs have condition/whenFalse' });
});
export type SpecRequirement = z.infer<typeof specRequirementSchema>;
export const familyObligationV2Schema = productFamilyObligationSchema.extend({
  dimensions: z.array(dimensionRequirementV2Schema), specRequirements: z.array(specRequirementSchema),
}).strict();
export type FamilyObligationV2 = z.infer<typeof familyObligationV2Schema>;
export const semanticObligationContractV2Schema = semanticObligationContractSchema.extend({
  schemaVersion: z.literal('2'), families: z.array(familyObligationV2Schema), defaultFamily: familyObligationV2Schema,
}).strict();
export type SemanticObligationContractV2 = z.infer<typeof semanticObligationContractV2Schema>;
export type AdmissionContract = SemanticObligationContract | SemanticObligationContractV2;
export type AdmissionContextV2 = ProductAdmissionContext & {
  // An onboarding claim selects obligations; it is never a certified Product Semantics fact.
  declaredProductFamily?: string;
  specFilteringKeys?: readonly SpecKey[];
};
export type EvaluatedSpecRequirement = {
  specKey: SpecKey; declaredRequirement: SpecRequirement['requirement']; effectiveRequirement: 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN';
  conditionResult: boolean | null; resolution: EvaluatedDimension['resolution']; terminalValid: boolean; evidenceCertified: boolean;
  sourceReferences: readonly string[];
};
