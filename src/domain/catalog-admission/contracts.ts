import { z } from 'zod';
import type { CanonicalProduct } from '../catalog/projection-input/canonical.js';
import type { ProductSemanticSnapshotFact } from '../product-semantic-snapshot/contracts.js';
import type { TrainingSemanticSnapshotV2Record } from '../training-semantic-snapshot/v2-contracts.js';
import type { SpecsArtifact } from '../catalog/projection-bundle.js';

export const semanticDimensions = ['PRODUCT_SEMANTICS', 'TRAINING_EXERCISE', 'TRAINING_FUNCTION', 'SPECS', 'TRUST'] as const;
export type SemanticDimension = typeof semanticDimensions[number];
export const requirementStates = ['REQUIRED', 'CONDITIONAL', 'NOT_REQUIRED', 'UNKNOWN'] as const;
export const normalizedResolutionStates = ['VERIFIED', 'VERIFIED_NOT_APPLICABLE', 'PARTIAL', 'AMBIGUOUS', 'DATA_GAP',
  'ONTOLOGY_GAP', 'SOURCE_CONFLICT', 'INVALID_STATE', 'UNAVAILABLE_PROJECTION', 'UNKNOWN'] as const;
export type NormalizedResolutionState = typeof normalizedResolutionStates[number];
export const evidenceKinds = ['NAME_TEXT', 'NAME', 'STRUCTURED_FEATURE', 'TRUSTED_CATEGORY', 'FAMILY_INFERENCE', 'FAMILY_DERIVATION', 'MANUAL_OVERRIDE'] as const;
export type EvidenceKind = typeof evidenceKinds[number];
export const evidenceStrengths = ['UNKNOWN', 'WEAK', 'STRONG', 'EXPLICIT'] as const;
export type EvidenceStrength = typeof evidenceStrengths[number];
export const negativeEvidenceStates = ['PRESENT', 'ABSENT', 'NOT_REQUIRED', 'UNKNOWN'] as const;
export type NegativeEvidenceState = typeof negativeEvidenceStates[number];
export const admissionSurfaces = ['LEXICAL_SEARCH', 'PRODUCT_CONTEXT', 'COMMERCIAL_PURCHASE', 'PRODUCT_SEMANTIC_DISCOVERY',
  'TRAINING_DISCOVERY', 'SPEC_FILTERING', 'UNIFIED_RETRIEVAL'] as const;
export type AdmissionSurface = typeof admissionSurfaces[number];
export const admissionDecisionStates = ['ADMITTED', 'PARTIAL', 'REVIEW_REQUIRED', 'BLOCKED', 'NOT_APPLICABLE', 'UNKNOWN'] as const;
export type AdmissionDecisionState = typeof admissionDecisionStates[number];
export const admissionReasonCodes = ['MISSING_FAMILY_OBLIGATION_CONTRACT', 'DIMENSION_UNKNOWN', 'DIMENSION_PARTIAL', 'DIMENSION_AMBIGUOUS',
  'DIMENSION_DATA_GAP', 'DIMENSION_ONTOLOGY_GAP', 'DIMENSION_SOURCE_CONFLICT', 'DIMENSION_INVALID_STATE', 'PROJECTION_UNAVAILABLE',
  'NEGATIVE_EVIDENCE_MISSING', 'EVIDENCE_INSUFFICIENT', 'TRUST_INSUFFICIENT', 'TRUST_RUNTIME_AUTHORITY_SEPARATE',
  'SURFACE_CONTRACT_UNDEFINED', 'HISTORICAL_SCOPE_EXCLUDED', 'NON_PRODUCT_EXCLUDED', 'CANONICAL_PRODUCT_MISSING',
  'SOURCE_STRUCTURE_INVALID', 'COMMERCIAL_FACTS_MISSING', 'PRODUCT_INACTIVE', 'PRODUCT_NOT_LISTED', 'COMMERCIAL_NOT_OFFERABLE',
  'TRAINING_COMPLETE_REQUIRED', 'TRAINING_NEGATIVE_WITH_ASSIGNMENTS', 'TRAINING_FUNCTION_ONLY_NO_EXERCISE_RESOLUTION',
  'REQUIRED_ASSIGNMENT_MISSING', 'SPEC_UNSUPPORTED', 'SPEC_MISSING', 'SPEC_SOURCE_CONFLICT', 'CONDITION_NOT_EVALUABLE',
  'UNKNOWN_REQUIREMENT', 'CROSS_PROJECTION_CONFLICT', 'REQUIREMENTS_SATISFIED', 'BACKORDER_OFFER', 'NOT_REQUIRED_BY_CONTRACT'] as const;
export type AdmissionReasonCode = typeof admissionReasonCodes[number];
export type AdmissionReason = { code: AdmissionReasonCode; dimension?: SemanticDimension; detail?: string };
const ref = z.string().trim().min(1);
const references = z.array(ref).min(1);
const dimension = z.enum(semanticDimensions);
export const evidenceRequirementSchema = z.object({
  acceptedEvidenceKinds: z.array(z.enum(evidenceKinds)).min(1), minimumEvidenceStrength: z.enum(['WEAK', 'STRONG', 'EXPLICIT']),
  requiresNegativeEvidence: z.boolean(),
}).strict();
export type EvidenceRequirement = z.infer<typeof evidenceRequirementSchema>;
export const semanticConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FEATURE_PRESENT'), featureId: z.number().int().positive().safe() }).strict(),
  z.object({ kind: z.literal('SUPPORTED_SPEC_SOURCE_PRESENT') }).strict(),
  z.object({ kind: z.literal('TRAINING_ASSIGNMENTS_PRESENT'), dimension: z.enum(['TRAINING_EXERCISE', 'TRAINING_FUNCTION']) }).strict(),
  z.object({ kind: z.literal('TRUST_EVIDENCE_USED') }).strict(),
]);
export type SemanticCondition = z.infer<typeof semanticConditionSchema>;
const resolutionCriteriaSchema = z.object({
  terminalStates: z.array(z.enum(['VERIFIED', 'VERIFIED_NOT_APPLICABLE'])).min(1),
  scope: z.enum(['PRODUCT_FAMILY_AND_EMITTED_TAGS', 'MODELED_ASSIGNMENTS', 'SUPPORTED_SPEC_SOURCES', 'TRUST_AUTHORITY']),
  requiredCodes: z.array(ref).optional(),
}).strict();
export const semanticDimensionRequirementSchema = z.object({
  dimension, requirement: z.enum(requirementStates), resolutionCriteria: resolutionCriteriaSchema.optional(),
  evidenceRequirement: evidenceRequirementSchema.optional(), condition: semanticConditionSchema.optional(),
  whenFalse: z.enum(['UNKNOWN', 'NOT_REQUIRED']).optional(), rationale: ref, sourceReferences: references,
}).strict().superRefine((value, ctx) => {
  if (['REQUIRED', 'CONDITIONAL'].includes(value.requirement) && (!value.resolutionCriteria || !value.evidenceRequirement))
    ctx.addIssue({ code: 'custom', message: 'REQUIRED/CONDITIONAL needs resolution and evidence criteria' });
  if (value.requirement === 'CONDITIONAL' ? !value.condition || !value.whenFalse : !!value.condition || !!value.whenFalse)
    ctx.addIssue({ code: 'custom', message: 'Only CONDITIONAL has a typed condition and explicit whenFalse' });
  if (value.requirement === 'UNKNOWN' && value.resolutionCriteria)
    ctx.addIssue({ code: 'custom', message: 'UNKNOWN cannot declare a terminal resolution' });
});
export type SemanticDimensionRequirement = z.infer<typeof semanticDimensionRequirementSchema>;
export const surfaceAdmissionPolicySchema = z.object({
  surface: z.enum(admissionSurfaces), status: z.enum(['ACTIVE', 'UNDEFINED']), requiredDimensions: z.array(dimension),
  requireKnownGlobalObligations: z.boolean(), currentOnly: z.boolean(), excludeNonProduct: z.boolean(),
  defaultDecision: z.enum(['EVALUATE', 'UNKNOWN', 'REVIEW_REQUIRED']), rationale: ref, sourceReferences: references,
}).strict(); // Static ADMITTED is forbidden: only the evaluator can certify a decision.
export type SurfaceAdmissionPolicy = z.infer<typeof surfaceAdmissionPolicySchema>;
export const productFamilyObligationSchema = z.object({
  productFamily: ref, dimensions: z.array(semanticDimensionRequirementSchema), surfacePolicies: z.array(surfaceAdmissionPolicySchema),
  rationale: ref, sourceReferences: references, status: z.enum(['ACTIVE', 'PROVISIONAL', 'UNKNOWN']),
}).strict();
export type ProductFamilyObligation = z.infer<typeof productFamilyObligationSchema>;
export const semanticObligationContractSchema = z.object({
  schemaVersion: z.literal('1'), contractVersion: ref, contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  ontologyVersion: ref, ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  families: z.array(productFamilyObligationSchema), defaultFamily: productFamilyObligationSchema,
}).strict();
export type SemanticObligationContract = z.infer<typeof semanticObligationContractSchema>;

export type EvidenceFact = { kind: EvidenceKind; strength: EvidenceStrength; sourceReference: string; acceptable: boolean };
export type NormalizedResolution = {
  dimension: SemanticDimension; state: NormalizedResolutionState; negativeEvidenceState: NegativeEvidenceState;
  evidenceFacts: readonly (readonly EvidenceFact[])[]; negativeEvidence: readonly EvidenceFact[];
  codes: readonly string[]; sourceStatuses: readonly string[]; reasons: readonly AdmissionReason[]; warnings: readonly AdmissionReason[];
};
export const admissionTrustInputSchema = z.object({
  categories: z.array(z.object({ categoryId: z.number().int().positive(), trustClass: z.enum(['SEMANTIC_STRONG', 'SEMANTIC_WEAK', 'CAMPAIGN', 'NAVIGATION', 'LEGACY', 'UNKNOWN']) }).strict()),
  features: z.array(z.object({ featureId: z.number().int().positive(), trustClass: z.enum(['SEMANTIC', 'TECHNICAL', 'NOISE', 'PRESENTATION', 'LOGISTICS', 'UNKNOWN']) }).strict()),
  sourceHashesVerified: z.boolean(), consumedByCategorySelection: z.boolean(),
}).strict().superRefine((maps, ctx) => {
  if (new Set(maps.categories.map(c => c.categoryId)).size !== maps.categories.length || new Set(maps.features.map(f => f.featureId)).size !== maps.features.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate trust definitions' });
});
export type AdmissionTrustInput = z.infer<typeof admissionTrustInputSchema>;
export type ProductAdmissionContext = {
  canonical: Pick<CanonicalProduct, 'productId' | 'catalogPresence' | 'active' | 'name' | 'features' | 'categoryIds'> | null;
  productSemantics?: ProductSemanticSnapshotFact | null;
  training?: TrainingSemanticSnapshotV2Record | null;
  specs?: readonly SpecsArtifact['records'][number][] | null;
  trust?: AdmissionTrustInput | null;
  lineage?: { productVerified: boolean; trainingVerified: boolean; specsVerified: boolean };
  crossProjectionIssues?: readonly { dimension: SemanticDimension; code: 'CROSS_PROJECTION_CONFLICT'; detail: string }[];
  listing?: boolean | null;
  commercial?: { authority: 'prestashop-v2-commercial-runtime'; sellability: 'sellable' | 'backorder' | 'not_sellable' | 'check_with_staff'; priceAvailable: boolean };
  trainingDiscoveryDimension?: 'TRAINING_EXERCISE' | 'TRAINING_FUNCTION';
  designatedSurface?: AdmissionSurface;
};
export type EvaluatedDimension = {
  dimension: SemanticDimension; declaredRequirement: SemanticDimensionRequirement['requirement'];
  effectiveRequirement: 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN'; conditionResult: boolean | null;
  resolution: NormalizedResolution; terminalValid: boolean; evidenceCertified: boolean;
  reasons: readonly AdmissionReason[]; sourceReferences: readonly string[];
};
export type AdmissionDecision = {
  surface: AdmissionSurface; decision: AdmissionDecisionState; requiredDimensions: readonly SemanticDimension[];
  evaluatedDimensions: readonly EvaluatedDimension[]; blockingDimensions: readonly SemanticDimension[];
  reasons: readonly AdmissionReason[]; warnings: readonly AdmissionReason[]; contractVersion: string; contractHash: string;
};
export const consolidationStates = ['CONSOLIDATED', 'CONSOLIDATED_WITH_NOT_APPLICABLE', 'PARTIALLY_CONSOLIDATED', 'REVIEW_REQUIRED',
  'BLOCKED_BY_DATA', 'BLOCKED_BY_ONTOLOGY', 'BLOCKED_BY_CONFLICT', 'INVALID', 'UNKNOWN_OBLIGATIONS'] as const;
export type ConsolidationState = typeof consolidationStates[number];
export const consolidationLevels = ['L0_PRESENT', 'L1_STRUCTURALLY_VALID', 'L2_REQUIRED_SEMANTICALLY_RESOLVED',
  'L3_REQUIRED_EVIDENCE_BACKED', 'L4_REQUIRED_CROSS_VALIDATED', 'L5_DESIGNATED_SURFACE_ADMITTED'] as const;
export type ConsolidationLevel = typeof consolidationLevels[number];
export type ProductConsolidation = {
  state: ConsolidationState; obligationsKnown: boolean; evaluatedDimensions: readonly EvaluatedDimension[];
  highestCertifiedLevel: ConsolidationLevel | null; nextBlockedLevel: ConsolidationLevel | null;
  blockingReasons: readonly AdmissionReason[]; levels: readonly { level: ConsolidationLevel; certified: boolean }[];
  contractVersion: string; contractHash: string;
};
// Product identities belong to audit/event payloads, never these metric labels.
export type AdmissionDecisionMetric = { metric: 'admission_decision_total'; labels: { surface: AdmissionSurface; decision: AdmissionDecisionState; reason: AdmissionReasonCode }; value: 1 };
export type ConsolidationStateMetric = { metric: 'consolidation_state_total'; labels: { state: ConsolidationState; family: string }; value: 1 };
