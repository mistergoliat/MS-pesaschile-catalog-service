import { evaluateTrainingSemanticRules } from '../training-semantic-classification/rules.js';
import { evaluateTrainingSemanticV2Rules } from '../training-semantic-classification-v2/rules.js';
import { evaluateTrainingSemanticV21Enrichments } from '../training-semantic-classification-v2-1/rules.js';
import { admissionTrustInputSchema, type NormalizedResolution, type SemanticDimensionRequirement } from './contracts.js';
import { type AdmissionContextV2, type SemanticConditionV2, type SpecRequirement } from './contracts-v2.js';
import { mapSpecs } from './resolution.js';

export function admissionFamilyCode(context: AdmissionContextV2): string | undefined {
  return context.productSemantics?.primaryProductFamily?.code ?? context.declaredProductFamily;
}
// Reads canonical source evidence only. Never inspects assignments, resolutionState or SEMANTIC_COMPLETE.
export function trainingSourceObligations(context: AdmissionContextV2): { exercise: string[]; function: string[]; exerciseReview: boolean; functionReview: boolean; trustEvidenceUsed: boolean } | null {
  const canonical = context.canonical, trust = admissionTrustInputSchema.safeParse(context.trust);
  if (!canonical || !admissionFamilyCode(context) || canonical.categoryIds === null || canonical.features === null) return null;
  if ((canonical.categoryIds.length || canonical.features.length) && (!trust.success || !trust.data.sourceHashesVerified)) return null;
  const categories = canonical.categoryIds.map(c => ({ categoryId: String(c.categoryId), name: c.name ?? '', trustClass: trust.success ? trust.data.categories.find(t => t.categoryId === c.categoryId)?.trustClass : undefined }));
  const features = canonical.features.map(f => ({ featureId: String(f.featureId), featureName: f.name, value: f.value ?? '', trustClass: trust.success ? trust.data.features.find(t => t.featureId === f.featureId)?.trustClass : undefined }));
  if (categories.some(c => !c.trustClass) || features.some(f => !f.trustClass)) return null;
  const unavailableSourceValue = categories.some((c, i) => canonical.categoryIds![i]!.name === null && ['SEMANTIC_STRONG', 'SEMANTIC_WEAK'].includes(c.trustClass!))
    || features.some((f, i) => canonical.features![i]!.value === null && f.trustClass === 'SEMANTIC');
  const input = { productId: canonical.productId, name: canonical.name, productFamily: admissionFamilyCode(context),
    catalogPresence: canonical.catalogPresence, categories: categories.map(c => ({ ...c, trustClass: c.trustClass! })), features: features.map(f => ({ ...f, trustClass: f.trustClass! })) };
  const v1 = evaluateTrainingSemanticRules(input), v2 = evaluateTrainingSemanticV2Rules(input), v21 = evaluateTrainingSemanticV21Enrichments(input);
  return { exercise: [...new Set([...v1.matches.map(m => m.capabilityCode), ...v2.exerciseMatches.map(m => m.code), ...v21.flatMap(m => m.exerciseCodes ?? [])])].sort(),
    function: [...new Set([...v2.functionMatches.map(m => m.code), ...v21.flatMap(m => m.functionCode ? [m.functionCode] : [])])].sort(),
    // A positive rule remains provable; absent governed values cannot prove a negative rule result.
    exerciseReview: unavailableSourceValue || v1.reviewCandidates.length > 0 || v2.exerciseReviewCandidates.length > 0, functionReview: unavailableSourceValue || v2.functionReviewCandidates.length > 0,
    trustEvidenceUsed: [...v1.matches, ...v2.exerciseMatches, ...v2.functionMatches, ...v21].some(m => m.evidence.some(e => ['TRUSTED_CATEGORY', 'STRUCTURED_FEATURE'].includes(e.kind))) };
}
export function evaluateSourceCondition(condition: SemanticConditionV2, context: AdmissionContextV2): boolean | null | undefined {
  if (condition.kind === 'TRAINING_SOURCE_RULE_MATCHES') {
    const obligations = trainingSourceObligations(context);
    if (!obligations) return null;
    const exercise = condition.dimension === 'TRAINING_EXERCISE';
    return (exercise ? obligations.exercise : obligations.function).length > 0 ? true : (exercise ? obligations.exerciseReview : obligations.functionReview) ? null : false;
  }
  if (condition.kind === 'SPEC_SOURCE_PRESENT') return context.canonical?.features ? context.canonical.features.some(f => condition.sourceIds.includes(f.featureId)) : null;
  return undefined;
}
export function mapSpecRequirement(context: AdmissionContextV2, requirement: SpecRequirement): NormalizedResolution {
  const records = context.specs?.filter(s => s.key === requirement.specKey && requirement.acceptedSourceIds.includes(s.sourceFeature.featureId));
  // Filtering isolates conflicts and binding gaps to this key, while retaining the original records.
  const features = context.canonical?.features?.filter(f => requirement.acceptedSourceIds.includes(f.featureId));
  const selected = { ...context, canonical: context.canonical ? { ...context.canonical, features: features ?? null } : null, specs: records };
  return mapSpecs(selected, requirement.specKey);
}
export function specDimensionRequirement(spec: SpecRequirement): SemanticDimensionRequirement {
  return { dimension: 'SPECS', requirement: 'REQUIRED', resolutionCriteria: { terminalStates: ['VERIFIED'], scope: 'SUPPORTED_SPEC_SOURCES' },
    evidenceRequirement: { acceptedEvidenceKinds: ['STRUCTURED_FEATURE'], minimumEvidenceStrength: 'STRONG', requiresNegativeEvidence: spec.requiresNegativeEvidence },
    rationale: spec.rationale, sourceReferences: spec.sourceReferences };
}
