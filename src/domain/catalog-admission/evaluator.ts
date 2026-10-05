import { z } from 'zod';
import { productSemanticSnapshotFactSchema } from '../product-semantic-snapshot/contracts.js';
import { trainingSemanticSnapshotV2RecordSchema } from '../training-semantic-snapshot/v2-contracts.js';
import { specsArtifactSchema } from '../catalog/projection-bundle.js';
import { semanticDimensions, consolidationLevels, type ProductAdmissionContext, type SemanticCondition, type SemanticDimensionRequirement,
  type EvidenceRequirement, type NormalizedResolution, type EvaluatedDimension, type AdmissionReason, type AdmissionSurface,
  type AdmissionDecision, type ProductConsolidation, type SemanticObligationContract, type ConsolidationState,
  type AdmissionDecisionMetric, type ConsolidationStateMetric, type SemanticDimension } from './contracts.js';
import { semanticObligationContract, getProductFamilyObligation } from './registry.js';
import { mapProductSemantics, mapTrainingExercise, mapTrainingFunction, mapSpecs, mapTrust, isTerminalValidResolution,
  orderedReasons, supportedSpecFeatureIds } from './resolution.js';

const canonicalSchema = z.object({ productId: z.number().int().positive().safe(), name: z.string().trim().min(1),
  catalogPresence: z.enum(['current_catalog', 'historical_order_detail_only']), active: z.boolean().nullable(),
  categoryIds: z.array(z.object({ categoryId: z.number().int().positive(), name: z.string().nullable() })).nullable(),
  features: z.array(z.object({ featureId: z.number().int().positive(), featureValueId: z.number().int().positive(), name: z.string(), value: z.string().nullable() })).nullable(),
}).superRefine((p, ctx) => {
  if (p.catalogPresence === 'current_catalog' ? p.active === null || p.categoryIds === null || p.features === null : p.active !== null || p.categoryIds !== null || p.features !== null)
    ctx.addIssue({ code: 'custom', message: 'Canonical presence/source partition invalid' });
});
export function isAdmissionContextStructurallyValid(context: ProductAdmissionContext): boolean {
  return canonicalSchema.safeParse(context.canonical).success
    && (!context.productSemantics || productSemanticSnapshotFactSchema.safeParse(context.productSemantics).success)
    && (!context.training || trainingSemanticSnapshotV2RecordSchema.safeParse(context.training).success)
    && (!context.specs || specsArtifactSchema.shape.records.safeParse(context.specs).success);
}
export function evaluateSemanticCondition(condition: SemanticCondition, context: ProductAdmissionContext): boolean | null {
  if (context.canonical && !canonicalSchema.safeParse(context.canonical).success) return null;
  switch (condition.kind) {
    case 'FEATURE_PRESENT': return context.canonical?.features ? context.canonical.features.some(f => f.featureId === condition.featureId) : null;
    case 'SUPPORTED_SPEC_SOURCE_PRESENT': return context.canonical?.features ? context.canonical.features.some(f => (supportedSpecFeatureIds as readonly number[]).includes(f.featureId)) : null;
    case 'TRAINING_ASSIGNMENTS_PRESENT': {
      const training = trainingSemanticSnapshotV2RecordSchema.safeParse(context.training);
      return training.success ? (condition.dimension === 'TRAINING_EXERCISE' ? training.data.exerciseCapabilities : training.data.trainingFunctions).length > 0 : null;
    }
    case 'TRUST_EVIDENCE_USED': {
      const product = productSemanticSnapshotFactSchema.safeParse(context.productSemantics), training = trainingSemanticSnapshotV2RecordSchema.safeParse(context.training);
      if (!product.success || !training.success) return null;
      return product.data.provenance.evidence.some(e => ['TRUSTED_CATEGORY', 'STRUCTURED_FEATURE'].includes(e.sourceType))
        || [...training.data.exerciseCapabilities, ...training.data.trainingFunctions].some(a => a.evidence.some(e => ['TRUSTED_CATEGORY', 'STRUCTURED_FEATURE'].includes(e.kind)));
    }
  }
}
export function certifyResolutionEvidence(resolution: NormalizedResolution, requirement: EvidenceRequirement | undefined): boolean {
  if (!requirement || !isTerminalValidResolution(resolution.state)) return false;
  const strengths = { UNKNOWN: 0, WEAK: 1, STRONG: 2, EXPLICIT: 3 };
  const accepts = (fact: NormalizedResolution['negativeEvidence'][number]): boolean => fact.acceptable && !!fact.sourceReference
    && requirement.acceptedEvidenceKinds.includes(fact.kind) && strengths[fact.strength] >= strengths[requirement.minimumEvidenceStrength];
  if (resolution.state === 'VERIFIED_NOT_APPLICABLE') return !requirement.requiresNegativeEvidence
    || resolution.negativeEvidenceState === 'PRESENT' && resolution.negativeEvidence.some(accepts);
  return resolution.evidenceFacts.length > 0 && resolution.evidenceFacts.every(group => group.some(accepts));
}
const stateReasons: Partial<Record<NormalizedResolution['state'], AdmissionReason['code']>> = {
  UNKNOWN: 'DIMENSION_UNKNOWN', PARTIAL: 'DIMENSION_PARTIAL', AMBIGUOUS: 'DIMENSION_AMBIGUOUS', DATA_GAP: 'DIMENSION_DATA_GAP',
  ONTOLOGY_GAP: 'DIMENSION_ONTOLOGY_GAP', SOURCE_CONFLICT: 'DIMENSION_SOURCE_CONFLICT', INVALID_STATE: 'DIMENSION_INVALID_STATE', UNAVAILABLE_PROJECTION: 'PROJECTION_UNAVAILABLE',
};
function evaluateDimension(requirement: SemanticDimensionRequirement, context: ProductAdmissionContext, mapped: NormalizedResolution): EvaluatedDimension {
  const conditionResult = requirement.condition ? evaluateSemanticCondition(requirement.condition, context) : null;
  const effectiveRequirement = requirement.requirement === 'CONDITIONAL' ? conditionResult === true ? 'REQUIRED'
    : conditionResult === false ? requirement.whenFalse! : 'UNKNOWN' : requirement.requirement;
  let resolution = effectiveRequirement === 'REQUIRED' && requirement.dimension === 'SPECS' && mapped.sourceStatuses.includes('MISSING') ? { ...mapped, state: 'DATA_GAP' as const } : mapped;
  const reasons: AdmissionReason[] = [...resolution.reasons];
  if (effectiveRequirement === 'UNKNOWN') {
    reasons.push({ code: 'UNKNOWN_REQUIREMENT', dimension: requirement.dimension });
    if (requirement.condition && conditionResult === null) reasons.push({ code: 'CONDITION_NOT_EVALUABLE', dimension: requirement.dimension });
  }
  if (effectiveRequirement === 'NOT_REQUIRED') reasons.push({ code: 'NOT_REQUIRED_BY_CONTRACT', dimension: requirement.dimension });
  if (effectiveRequirement === 'REQUIRED' && requirement.resolutionCriteria?.requiredCodes?.some(code => !mapped.codes.includes(code))) {
    if (isTerminalValidResolution(mapped.state)) resolution = { ...mapped, state: 'DATA_GAP' };
    reasons.push({ code: 'REQUIRED_ASSIGNMENT_MISSING', dimension: requirement.dimension });
  }
  const terminalValid = isTerminalValidResolution(resolution.state) && (!requirement.resolutionCriteria || requirement.resolutionCriteria.terminalStates.includes(resolution.state as 'VERIFIED' | 'VERIFIED_NOT_APPLICABLE'));
  const evidenceCertified = certifyResolutionEvidence(resolution, requirement.evidenceRequirement);
  const stateReason = stateReasons[resolution.state];
  if (stateReason) reasons.push({ code: stateReason, dimension: requirement.dimension });
  if (isTerminalValidResolution(resolution.state) && !evidenceCertified) reasons.push({
    code: resolution.state === 'VERIFIED_NOT_APPLICABLE' && resolution.negativeEvidenceState === 'ABSENT' ? 'NEGATIVE_EVIDENCE_MISSING' : 'EVIDENCE_INSUFFICIENT', dimension: requirement.dimension });
  return { dimension: requirement.dimension, declaredRequirement: requirement.requirement, effectiveRequirement, conditionResult,
    resolution, terminalValid, evidenceCertified, reasons: orderedReasons(reasons), sourceReferences: requirement.sourceReferences };
}
export function evaluateProductDimensions(context: ProductAdmissionContext, contract = semanticObligationContract): EvaluatedDimension[] {
  const family = getProductFamilyObligation(context.productSemantics?.primaryProductFamily?.code, contract);
  const resolutions: NormalizedResolution[] = context.canonical && !canonicalSchema.safeParse(context.canonical).success
    ? semanticDimensions.map(dimension => ({ dimension, state: 'INVALID_STATE', negativeEvidenceState: 'UNKNOWN', evidenceFacts: [], negativeEvidence: [], codes: [], sourceStatuses: [],
      reasons: [{ code: 'SOURCE_STRUCTURE_INVALID', dimension }], warnings: [] }))
    : [mapProductSemantics(context), mapTrainingExercise(context), mapTrainingFunction(context), mapSpecs(context), mapTrust(context)];
  return semanticDimensions.map(dim => evaluateDimension(family.dimensions.find(d => d.dimension === dim)!, context, resolutions.find(r => r.dimension === dim)!));
}
function crossReasons(context: ProductAdmissionContext, dimensions: readonly EvaluatedDimension[]): AdmissionReason[] {
  return (context.crossProjectionIssues ?? []).filter(i => dimensions.some(d => d.dimension === i.dimension && d.effectiveRequirement === 'REQUIRED'))
    .map(i => ({ code: i.code, dimension: i.dimension, detail: i.detail }));
}
export function evaluateProductAdmission(context: ProductAdmissionContext, surface: AdmissionSurface,
  contract: SemanticObligationContract = semanticObligationContract): AdmissionDecision {
  const family = getProductFamilyObligation(context.productSemantics?.primaryProductFamily?.code, contract), policy = family.surfacePolicies.find(p => p.surface === surface)!;
  const dimensions = evaluateProductDimensions(context, contract);
  const requiredDimensions: readonly SemanticDimension[] = surface === 'TRAINING_DISCOVERY' ? [context.trainingDiscoveryDimension ?? 'TRAINING_EXERCISE'] : policy.requiredDimensions;
  const evaluatedDimensions = dimensions.filter(d => requiredDimensions.includes(d.dimension));
  const blocking = evaluatedDimensions.filter(d => d.effectiveRequirement === 'UNKNOWN' || d.effectiveRequirement === 'REQUIRED' && (!d.terminalValid || !d.evidenceCertified));
  const reasons: AdmissionReason[] = [], warnings = evaluatedDimensions.flatMap(d => d.resolution.warnings);
  let decision: AdmissionDecision['decision'] = 'ADMITTED';
  if (!context.canonical) { decision = 'BLOCKED'; reasons.push({ code: 'CANONICAL_PRODUCT_MISSING' }); }
  else if (!canonicalSchema.safeParse(context.canonical).success) { decision = 'BLOCKED'; reasons.push({ code: 'SOURCE_STRUCTURE_INVALID' }); }
  else if (policy.currentOnly && context.canonical.catalogPresence !== 'current_catalog') { decision = 'NOT_APPLICABLE'; reasons.push({ code: 'HISTORICAL_SCOPE_EXCLUDED' }); }
  else if (policy.excludeNonProduct && context.productSemantics?.classificationStatus === 'EXCLUDED_NON_PRODUCT') { decision = 'NOT_APPLICABLE'; reasons.push({ code: 'NON_PRODUCT_EXCLUDED' }); }
  else if (policy.status === 'UNDEFINED' || policy.defaultDecision !== 'EVALUATE') { decision = policy.defaultDecision === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'UNKNOWN'; reasons.push({ code: 'SURFACE_CONTRACT_UNDEFINED' }); }
  else if (surface === 'LEXICAL_SEARCH' || surface === 'COMMERCIAL_PURCHASE') {
    if (context.canonical.active !== true) { decision = 'BLOCKED'; reasons.push({ code: 'PRODUCT_INACTIVE' }); }
    else if (surface === 'LEXICAL_SEARCH') {
      if (context.listing == null) { decision = 'UNKNOWN'; reasons.push({ code: 'COMMERCIAL_FACTS_MISSING', detail: 'Listing/visibility unavailable' }); }
      else if (!context.listing) { decision = 'BLOCKED'; reasons.push({ code: 'PRODUCT_NOT_LISTED' }); }
    } else if (!context.commercial || context.commercial.authority !== 'prestashop-v2-commercial-runtime') { decision = 'UNKNOWN'; reasons.push({ code: 'COMMERCIAL_FACTS_MISSING' }); }
    else if (!context.commercial.priceAvailable || !['sellable', 'backorder'].includes(context.commercial.sellability)) { decision = 'BLOCKED'; reasons.push({ code: 'COMMERCIAL_NOT_OFFERABLE' }); }
    else if (context.commercial.sellability === 'backorder') warnings.push({ code: 'BACKORDER_OFFER' });
  } else if (surface !== 'PRODUCT_CONTEXT') {
    reasons.push(...blocking.flatMap(d => d.reasons), ...crossReasons(context, evaluatedDimensions));
    if (family.status === 'UNKNOWN') reasons.push({ code: 'MISSING_FAMILY_OBLIGATION_CONTRACT' });
    if (evaluatedDimensions.some(d => ['INVALID_STATE', 'SOURCE_CONFLICT'].includes(d.resolution.state)) || crossReasons(context, evaluatedDimensions).length) decision = 'BLOCKED';
    else if (policy.requireKnownGlobalObligations && dimensions.some(d => d.effectiveRequirement === 'UNKNOWN')) decision = 'REVIEW_REQUIRED';
    else if (blocking.some(d => d.effectiveRequirement === 'UNKNOWN')) decision = 'REVIEW_REQUIRED';
    else if (blocking.some(d => d.resolution.state === 'PARTIAL')) decision = 'PARTIAL';
    else if (blocking.length) decision = 'BLOCKED';
    if (surface === 'TRAINING_DISCOVERY' && context.training?.resolutionState !== 'SEMANTIC_COMPLETE') {
      decision = 'BLOCKED'; reasons.push({ code: 'TRAINING_COMPLETE_REQUIRED' });
    }
  }
  if (decision === 'ADMITTED') reasons.push({ code: 'REQUIREMENTS_SATISFIED' });
  const blockingDimensions = semanticDimensions.filter(dim => blocking.some(d => d.dimension === dim) || crossReasons(context, evaluatedDimensions).some(r => r.dimension === dim));
  return { surface, decision, requiredDimensions: [...requiredDimensions], evaluatedDimensions, blockingDimensions,
    reasons: orderedReasons(reasons), warnings: orderedReasons(warnings), contractVersion: contract.contractVersion, contractHash: contract.contentHash };
}
export function evaluateProductConsolidation(context: ProductAdmissionContext, contract = semanticObligationContract): ProductConsolidation {
  const evaluatedDimensions = evaluateProductDimensions(context, contract), required = evaluatedDimensions.filter(d => d.effectiveRequirement === 'REQUIRED');
  const obligationsKnown = evaluatedDimensions.every(d => d.effectiveRequirement !== 'UNKNOWN');
  const present = !!context.canonical, structural = isAdmissionContextStructurallyValid(context);
  const resolved = obligationsKnown && required.every(d => d.terminalValid), backed = required.every(d => d.evidenceCertified);
  const cross = crossReasons(context, evaluatedDimensions), crossValid = !cross.length && required.every(d => !['SOURCE_CONFLICT', 'INVALID_STATE'].includes(d.resolution.state));
  const admitted = evaluateProductAdmission(context, context.designatedSurface ?? 'UNIFIED_RETRIEVAL', contract).decision === 'ADMITTED';
  const passes = [present, structural, resolved, backed, crossValid, admitted];
  let certified = true;
  const levels = consolidationLevels.map((level, index) => ({ level, certified: certified &&= passes[index]! }));
  const highestCertifiedLevel = levels.filter(l => l.certified).at(-1)?.level ?? null, nextBlockedLevel = levels.find(l => !l.certified)?.level ?? null;
  const reasons = evaluatedDimensions.filter(d => d.effectiveRequirement === 'UNKNOWN' || d.effectiveRequirement === 'REQUIRED' && (!d.terminalValid || !d.evidenceCertified)).flatMap(d => d.reasons);
  if (!present) reasons.push({ code: 'CANONICAL_PRODUCT_MISSING' });
  else if (!structural) reasons.push({ code: 'SOURCE_STRUCTURE_INVALID' });
  reasons.push(...cross);
  if (nextBlockedLevel === 'L5_DESIGNATED_SURFACE_ADMITTED') reasons.push(...evaluateProductAdmission(context, context.designatedSurface ?? 'UNIFIED_RETRIEVAL', contract).reasons);
  let state: ConsolidationState;
  if (!present || !structural || evaluatedDimensions.some(d => d.resolution.state === 'INVALID_STATE')) state = 'INVALID';
  else if (cross.length || evaluatedDimensions.some(d => d.resolution.state === 'SOURCE_CONFLICT')) state = 'BLOCKED_BY_CONFLICT';
  else if (!obligationsKnown) state = 'UNKNOWN_OBLIGATIONS';
  else if (required.some(d => d.resolution.state === 'DATA_GAP' || d.resolution.state === 'UNAVAILABLE_PROJECTION')) state = 'BLOCKED_BY_DATA';
  else if (required.some(d => d.resolution.state === 'ONTOLOGY_GAP')) state = 'BLOCKED_BY_ONTOLOGY';
  else if (required.some(d => d.resolution.state === 'AMBIGUOUS' || d.resolution.state === 'UNKNOWN')) state = 'REVIEW_REQUIRED';
  else if (!resolved || !backed || !crossValid || !admitted) state = 'PARTIALLY_CONSOLIDATED';
  else state = required.some(d => d.resolution.state === 'VERIFIED_NOT_APPLICABLE') ? 'CONSOLIDATED_WITH_NOT_APPLICABLE' : 'CONSOLIDATED';
  return { state, obligationsKnown, evaluatedDimensions, highestCertifiedLevel, nextBlockedLevel, blockingReasons: orderedReasons(reasons), levels,
    contractVersion: contract.contractVersion, contractHash: contract.contentHash };
}
export function admissionDecisionMetrics(decision: AdmissionDecision): AdmissionDecisionMetric[] {
  return [...new Set(decision.reasons.map(r => r.code))].sort().map(reason => ({ metric: 'admission_decision_total', labels: { surface: decision.surface, decision: decision.decision, reason }, value: 1 }));
}
export function consolidationStateMetric(consolidation: ProductConsolidation, family: string | null | undefined): ConsolidationStateMetric {
  return { metric: 'consolidation_state_total', labels: { state: consolidation.state, family: getProductFamilyObligation(family).productFamily }, value: 1 };
}
