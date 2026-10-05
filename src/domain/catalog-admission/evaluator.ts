import { z } from 'zod';
import { productSemanticSnapshotFactSchema } from '../product-semantic-snapshot/contracts.js';
import { trainingSemanticSnapshotV2RecordSchema } from '../training-semantic-snapshot/v2-contracts.js';
import { specsArtifactSchema } from '../catalog/projection-bundle.js';
import { semanticDimensions, consolidationLevels, admissionSurfaces, type ProductAdmissionContext, type SemanticCondition, type SemanticDimensionRequirement,
  type EvidenceRequirement, type NormalizedResolution, type EvaluatedDimension, type AdmissionReason, type AdmissionSurface,
  type AdmissionDecision, type ProductConsolidation, type ConsolidationState,
  type AdmissionDecisionMetric, type ConsolidationStateMetric, type SemanticDimension } from './contracts.js';
import { semanticObligationContract, getProductFamilyObligation } from './registry.js';
import { supportedSpecKeys, type AdmissionContract, type AdmissionContextV2, type SemanticConditionV2, type DimensionRequirementV2,
  type FamilyObligationV2, type EvaluatedSpecRequirement } from './contracts-v2.js';
import { admissionFamilyCode, evaluateSourceCondition, trainingSourceObligations, mapSpecRequirement, specDimensionRequirement } from './applicability-v2.js';
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
export function evaluateSemanticCondition(condition: SemanticCondition | SemanticConditionV2, context: AdmissionContextV2): boolean | null {
  if (context.canonical && !canonicalSchema.safeParse(context.canonical).success) return null;
  const sourceResult = evaluateSourceCondition(condition, context);
  if (sourceResult !== undefined) return sourceResult;
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
    default: return null;
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
function evaluateDimension(requirement: SemanticDimensionRequirement | DimensionRequirementV2, context: AdmissionContextV2, mapped: NormalizedResolution, sourceCondition?: boolean | null): EvaluatedDimension {
  const conditionResult = sourceCondition !== undefined ? sourceCondition : requirement.condition ? evaluateSemanticCondition(requirement.condition, context) : null;
  const effectiveRequirement = requirement.requirement === 'CONDITIONAL' ? conditionResult === true ? 'REQUIRED'
    : conditionResult === false ? requirement.whenFalse! : 'UNKNOWN' : requirement.requirement;
  let resolution = effectiveRequirement === 'REQUIRED' && requirement.dimension === 'SPECS' && mapped.sourceStatuses.includes('MISSING') ? { ...mapped, state: 'DATA_GAP' as const } : mapped;
  if ('requiresNegativeEvidence' in requirement && effectiveRequirement === 'REQUIRED' && ['UNKNOWN', 'UNAVAILABLE_PROJECTION'].includes(resolution.state))
    resolution = { ...resolution, state: 'DATA_GAP' };
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
export function evaluateSpecRequirements(context: AdmissionContextV2, family: FamilyObligationV2): EvaluatedSpecRequirement[] {
  return family.specRequirements.map(spec => {
    const conditionResult = spec.condition ? evaluateSemanticCondition(spec.condition, context) : null;
    const effectiveRequirement = spec.requirement === 'CONDITIONAL' ? conditionResult === true ? 'REQUIRED' : conditionResult === false ? spec.whenFalse! : 'UNKNOWN' : spec.requirement;
    const requirement = { ...specDimensionRequirement(spec), requirement: effectiveRequirement, requiresNegativeEvidence: spec.requiresNegativeEvidence, negativeEvidenceRationale: spec.negativeEvidenceRationale };
    const evaluated = evaluateDimension(requirement, context, mapSpecRequirement(context, spec));
    return { specKey: spec.specKey, declaredRequirement: spec.requirement, effectiveRequirement, conditionResult,
      resolution: evaluated.resolution, terminalValid: evaluated.terminalValid, evidenceCertified: evaluated.evidenceCertified, sourceReferences: spec.sourceReferences };
  });
}
type DimensionWithSpecs = EvaluatedDimension & { specRequirements?: EvaluatedSpecRequirement[] };
export function evaluateProductDimensions(context: AdmissionContextV2, contract: AdmissionContract = semanticObligationContract): DimensionWithSpecs[] {
  const family = getProductFamilyObligation(contract.schemaVersion === '2' ? admissionFamilyCode(context) : context.productSemantics?.primaryProductFamily?.code, contract);
  const resolutions: NormalizedResolution[] = context.canonical && !canonicalSchema.safeParse(context.canonical).success
    ? semanticDimensions.map(dimension => ({ dimension, state: 'INVALID_STATE', negativeEvidenceState: 'UNKNOWN', evidenceFacts: [], negativeEvidence: [], codes: [], sourceStatuses: [],
      reasons: [{ code: 'SOURCE_STRUCTURE_INVALID', dimension }], warnings: [] }))
    : [mapProductSemantics(context), mapTrainingExercise(context), mapTrainingFunction(context), mapSpecs(context), mapTrust(context)];
  const source = contract.schemaVersion === '2' && canonicalSchema.safeParse(context.canonical).success ? trainingSourceObligations(context) : null;
  return semanticDimensions.map(dim => {
    let requirement = family.dimensions.find(d => d.dimension === dim)!;
    if (contract.schemaVersion === '2' && dim.startsWith('TRAINING_') && requirement.resolutionCriteria) {
      const codes = source ? dim === 'TRAINING_EXERCISE' ? source.exercise : source.function : [];
      requirement = { ...requirement, resolutionCriteria: { ...requirement.resolutionCriteria, requiredCodes: [...new Set([...(requirement.resolutionCriteria.requiredCodes ?? []), ...codes])].sort() } };
    }
    let sourceCondition: boolean | null | undefined;
    if (requirement.condition?.kind === 'TRAINING_SOURCE_RULE_MATCHES') {
      const exercise = dim === 'TRAINING_EXERCISE';
      sourceCondition = !source ? null : (exercise ? source.exercise : source.function).length > 0 ? true : (exercise ? source.exerciseReview : source.functionReview) ? null : false;
    }
    if (contract.schemaVersion === '2' && requirement.condition?.kind === 'TRUST_EVIDENCE_USED' && source?.trustEvidenceUsed) sourceCondition = true;
    const evaluated = evaluateDimension(requirement, context, resolutions.find(r => r.dimension === dim)!, sourceCondition);
    if (contract.schemaVersion !== '2' || dim !== 'SPECS' || !canonicalSchema.safeParse(context.canonical).success) return evaluated;
    const specRequirements = evaluateSpecRequirements(context, family as FamilyObligationV2);
    const required = specRequirements.filter(s => s.effectiveRequirement === 'REQUIRED');
    if (evaluated.effectiveRequirement !== 'REQUIRED') return { ...evaluated, specRequirements };
    const priority = ['INVALID_STATE', 'SOURCE_CONFLICT', 'DATA_GAP', 'UNAVAILABLE_PROJECTION', 'ONTOLOGY_GAP', 'AMBIGUOUS', 'PARTIAL', 'UNKNOWN', 'VERIFIED'] as const;
    const state = priority.find(s => required.some(r => r.resolution.state === s)) ?? 'UNKNOWN';
    const resolution = { ...evaluated.resolution, state, evidenceFacts: required.flatMap(s => s.resolution.evidenceFacts),
      sourceStatuses: [...new Set(required.flatMap(s => s.resolution.sourceStatuses))].sort(), codes: required.map(s => s.specKey),
      reasons: orderedReasons(required.flatMap(s => s.resolution.reasons)) };
    const scoped = evaluateDimension(requirement, context, resolution);
    return { ...scoped, effectiveRequirement: specRequirements.some(s => s.effectiveRequirement === 'UNKNOWN') ? 'UNKNOWN' : scoped.effectiveRequirement,
      terminalValid: required.length > 0 && required.every(s => s.terminalValid), evidenceCertified: required.length > 0 && required.every(s => s.evidenceCertified), specRequirements };
  });
}
function crossReasons(context: ProductAdmissionContext, dimensions: readonly EvaluatedDimension[]): AdmissionReason[] {
  return (context.crossProjectionIssues ?? []).filter(i => dimensions.some(d => d.dimension === i.dimension && d.effectiveRequirement === 'REQUIRED'))
    .map(i => ({ code: i.code, dimension: i.dimension, detail: i.detail }));
}
export function evaluateProductAdmission(context: AdmissionContextV2, surface: AdmissionSurface,
  contract: AdmissionContract = semanticObligationContract): AdmissionDecision {
  return admissionFromDimensions(context, surface, contract, evaluateProductDimensions(context, contract));
}
function admissionFromDimensions(context: AdmissionContextV2, surface: AdmissionSurface, contract: AdmissionContract, dimensions: DimensionWithSpecs[]): AdmissionDecision {
  const family = getProductFamilyObligation(contract.schemaVersion === '2' ? admissionFamilyCode(context) : context.productSemantics?.primaryProductFamily?.code, contract), policy = family.surfacePolicies.find(p => p.surface === surface)!;
  if (contract.schemaVersion === '2' && surface === 'SPEC_FILTERING' && 'specRequirements' in family && policy.status === 'ACTIVE' && policy.defaultDecision === 'EVALUATE') {
    if (!context.canonical || !canonicalSchema.safeParse(context.canonical).success) return { surface, decision: 'BLOCKED', requiredDimensions: ['SPECS'],
      evaluatedDimensions: dimensions.filter(d => d.dimension === 'SPECS'), blockingDimensions: ['SPECS'], reasons: [{ code: 'SOURCE_STRUCTURE_INVALID' }],
      warnings: [], contractVersion: contract.contractVersion, contractHash: contract.contentHash };
    const specs = dimensions.find(d => d.dimension === 'SPECS')!.specRequirements ?? evaluateSpecRequirements(context, family), selected = context.specFilteringKeys ? specs.filter(s => context.specFilteringKeys!.includes(s.specKey)) : specs.filter(s => s.effectiveRequirement === 'REQUIRED');
    const unknown = context.specFilteringKeys?.some(key => !selected.some(s => s.specKey === key)) || selected.some(s => s.effectiveRequirement === 'UNKNOWN');
    const dimension = dimensions.find(d => d.dimension === 'SPECS')!;
    const required = selected.filter(s => s.effectiveRequirement === 'REQUIRED');
    let decision: AdmissionDecision['decision'] = !selected.length || unknown ? 'UNKNOWN' : !required.length ? 'NOT_APPLICABLE'
      : required.some(s => ['SOURCE_CONFLICT', 'INVALID_STATE', 'DATA_GAP', 'UNAVAILABLE_PROJECTION'].includes(s.resolution.state)) ? 'BLOCKED'
      : required.every(s => s.terminalValid && s.evidenceCertified) ? 'ADMITTED' : 'PARTIAL';
    const reasons: AdmissionReason[] = required.flatMap(s => s.resolution.reasons);
    if (!context.canonical || !canonicalSchema.safeParse(context.canonical).success) { decision = 'BLOCKED'; reasons.push({ code: 'SOURCE_STRUCTURE_INVALID' }); }
    else if (policy.currentOnly && context.canonical.catalogPresence !== 'current_catalog') { decision = 'NOT_APPLICABLE'; reasons.push({ code: 'HISTORICAL_SCOPE_EXCLUDED' }); }
    else if (policy.excludeNonProduct && context.productSemantics?.classificationStatus === 'EXCLUDED_NON_PRODUCT') { decision = 'NOT_APPLICABLE'; reasons.push({ code: 'NON_PRODUCT_EXCLUDED' }); }
    if (decision === 'UNKNOWN') reasons.push({ code: 'UNKNOWN_REQUIREMENT', dimension: 'SPECS' });
    if (decision === 'NOT_APPLICABLE') reasons.push({ code: 'NOT_REQUIRED_BY_CONTRACT', dimension: 'SPECS' });
    if (decision === 'ADMITTED') reasons.push({ code: 'REQUIREMENTS_SATISFIED' });
    return { surface, decision, requiredDimensions: ['SPECS'], evaluatedDimensions: [{ ...dimension, specRequirements: selected } as DimensionWithSpecs],
      blockingDimensions: ['BLOCKED', 'PARTIAL', 'UNKNOWN'].includes(decision) ? ['SPECS'] : [], reasons: orderedReasons(reasons), warnings: [], contractVersion: contract.contractVersion, contractHash: contract.contentHash };
  }
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
    if (evaluatedDimensions.some(d => d.resolution.state === 'INVALID_STATE'
      || (contract.schemaVersion === '1' || d.effectiveRequirement === 'REQUIRED') && d.resolution.state === 'SOURCE_CONFLICT') || crossReasons(context, evaluatedDimensions).length) decision = 'BLOCKED';
    else if (policy.requireKnownGlobalObligations && dimensions.some(d => d.effectiveRequirement === 'UNKNOWN')) decision = 'REVIEW_REQUIRED';
    else if (blocking.some(d => d.effectiveRequirement === 'UNKNOWN')) decision = 'REVIEW_REQUIRED';
    else if (blocking.some(d => d.resolution.state === 'PARTIAL')) decision = 'PARTIAL';
    else if (blocking.length) decision = 'BLOCKED';
    if (surface === 'TRAINING_DISCOVERY' && context.training?.resolutionState !== 'SEMANTIC_COMPLETE') {
      decision = 'BLOCKED'; reasons.push({ code: 'TRAINING_COMPLETE_REQUIRED' });
    }
    if (contract.schemaVersion === '2' && surface === 'TRAINING_DISCOVERY') {
      const dim = evaluatedDimensions[0]!;
      if (dim.resolution.state === 'INVALID_STATE') { decision = 'BLOCKED'; reasons.push(...dim.reasons); }
      else if (dim.effectiveRequirement === 'NOT_REQUIRED' && !dim.resolution.codes.length) { decision = 'NOT_APPLICABLE'; reasons.push({ code: 'NOT_REQUIRED_BY_CONTRACT', dimension: dim.dimension }); }
      else if (decision === 'ADMITTED' && (!dim.resolution.codes.length || !dim.terminalValid || !dim.evidenceCertified)) { decision = 'BLOCKED'; reasons.push({ code: 'REQUIRED_ASSIGNMENT_MISSING', dimension: dim.dimension }); }
    }
  }
  if (decision === 'ADMITTED') reasons.push({ code: 'REQUIREMENTS_SATISFIED' });
  const blockingDimensions = semanticDimensions.filter(dim => blocking.some(d => d.dimension === dim) || crossReasons(context, evaluatedDimensions).some(r => r.dimension === dim));
  return { surface, decision, requiredDimensions: [...requiredDimensions], evaluatedDimensions, blockingDimensions,
    reasons: orderedReasons(reasons), warnings: orderedReasons(warnings), contractVersion: contract.contractVersion, contractHash: contract.contentHash };
}
export function evaluateProductConsolidation(context: AdmissionContextV2, contract: AdmissionContract = semanticObligationContract): ProductConsolidation {
  return consolidationFromDimensions(context, contract, evaluateProductDimensions(context, contract));
}
function consolidationFromDimensions(context: AdmissionContextV2, contract: AdmissionContract, evaluatedDimensions: DimensionWithSpecs[]): ProductConsolidation {
  const required = evaluatedDimensions.filter(d => d.effectiveRequirement === 'REQUIRED');
  const obligationsKnown = evaluatedDimensions.every(d => d.effectiveRequirement !== 'UNKNOWN');
  const present = !!context.canonical, structural = isAdmissionContextStructurallyValid(context);
  const resolved = obligationsKnown && required.every(d => d.terminalValid), backed = required.every(d => d.evidenceCertified);
  const cross = crossReasons(context, evaluatedDimensions), crossValid = !cross.length && required.every(d => !['SOURCE_CONFLICT', 'INVALID_STATE'].includes(d.resolution.state));
  const designatedAdmission = admissionFromDimensions(context, context.designatedSurface ?? 'UNIFIED_RETRIEVAL', contract, evaluatedDimensions);
  const admitted = designatedAdmission.decision === 'ADMITTED';
  const passes = [present, structural, resolved, backed, crossValid, admitted];
  let certified = true;
  const levels = consolidationLevels.map((level, index) => ({ level, certified: certified &&= passes[index]! }));
  const highestCertifiedLevel = levels.filter(l => l.certified).at(-1)?.level ?? null, nextBlockedLevel = levels.find(l => !l.certified)?.level ?? null;
  const reasons = evaluatedDimensions.filter(d => d.effectiveRequirement === 'UNKNOWN' || d.effectiveRequirement === 'REQUIRED' && (!d.terminalValid || !d.evidenceCertified)).flatMap(d => d.reasons);
  if (!present) reasons.push({ code: 'CANONICAL_PRODUCT_MISSING' });
  else if (!structural) reasons.push({ code: 'SOURCE_STRUCTURE_INVALID' });
  reasons.push(...cross);
  if (nextBlockedLevel === 'L5_DESIGNATED_SURFACE_ADMITTED') reasons.push(...designatedAdmission.reasons);
  let state: ConsolidationState;
  const relevant = contract.schemaVersion === '1' ? evaluatedDimensions : required;
  if (!present || !structural || evaluatedDimensions.some(d => d.resolution.state === 'INVALID_STATE')) state = 'INVALID';
  else if (cross.length || relevant.some(d => d.resolution.state === 'SOURCE_CONFLICT')) state = 'BLOCKED_BY_CONFLICT';
  else if (!obligationsKnown) state = 'UNKNOWN_OBLIGATIONS';
  else if (required.some(d => d.resolution.state === 'DATA_GAP' || d.resolution.state === 'UNAVAILABLE_PROJECTION')) state = 'BLOCKED_BY_DATA';
  else if (required.some(d => d.resolution.state === 'ONTOLOGY_GAP')) state = 'BLOCKED_BY_ONTOLOGY';
  else if (required.some(d => d.resolution.state === 'AMBIGUOUS' || d.resolution.state === 'UNKNOWN')) state = 'REVIEW_REQUIRED';
  else if (!resolved || !backed || !crossValid || !admitted) state = 'PARTIALLY_CONSOLIDATED';
  else state = required.some(d => d.resolution.state === 'VERIFIED_NOT_APPLICABLE') ? 'CONSOLIDATED_WITH_NOT_APPLICABLE' : 'CONSOLIDATED';
  return { state, obligationsKnown, evaluatedDimensions, highestCertifiedLevel, nextBlockedLevel, blockingReasons: orderedReasons(reasons), levels,
    contractVersion: contract.contractVersion, contractHash: contract.contentHash };
}
// One immutable evaluation pass for offline population audits; no cache or trusted caller-supplied results.
export function evaluateAdmissionSnapshot(context: AdmissionContextV2, contract: AdmissionContract = semanticObligationContract) {
  const dimensions = evaluateProductDimensions(context, contract);
  return { consolidation: consolidationFromDimensions(context, contract, dimensions),
    admission: Object.fromEntries(admissionSurfaces.map(surface => [surface, admissionFromDimensions(context, surface, contract, dimensions)])) as Record<AdmissionSurface, AdmissionDecision>,
    functionDiscovery: admissionFromDimensions({ ...context, trainingDiscoveryDimension: 'TRAINING_FUNCTION' }, 'TRAINING_DISCOVERY', contract, dimensions),
    ...(contract.schemaVersion === '2' ? { specFilteringByKey: Object.fromEntries(supportedSpecKeys.map(key => [key,
      admissionFromDimensions({ ...context, specFilteringKeys: [key] }, 'SPEC_FILTERING', contract, dimensions)])) } : {}) };
}
export function admissionDecisionMetrics(decision: AdmissionDecision): AdmissionDecisionMetric[] {
  return [...new Set(decision.reasons.map(r => r.code))].sort().map(reason => ({ metric: 'admission_decision_total', labels: { surface: decision.surface, decision: decision.decision, reason }, value: 1 }));
}
export function consolidationStateMetric(consolidation: ProductConsolidation, family: string | null | undefined): ConsolidationStateMetric {
  return { metric: 'consolidation_state_total', labels: { state: consolidation.state, family: getProductFamilyObligation(family).productFamily }, value: 1 };
}
