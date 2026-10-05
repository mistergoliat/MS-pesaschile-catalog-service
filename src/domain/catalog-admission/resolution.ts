import { productSemanticSnapshotFactSchema } from '../product-semantic-snapshot/contracts.js';
import { trainingSemanticSnapshotV2RecordSchema } from '../training-semantic-snapshot/v2-contracts.js';
import { specsArtifactSchema } from '../catalog/projection-bundle.js';
import { getOntologyTag, getCommercialProductOntologyRegistry, computeCommercialProductOntologyRegistryHash } from '../commercial-product-ontology/index.js';
import { getTrainingSemanticRegistryV2 } from '../training-semantics-v2/index.js';
import { normalizeProductName } from '../product-semantic-classification/normalize.js';
import { evaluateNonProductExclusion } from '../product-semantic-classification/non-product-exclusion.js';
import { matchGuardedCableMachineStructuredEvidence } from '../product-semantic-classification/product-family-rules.js';
import type { ProductSemanticClassificationInput } from '../product-semantic-classification/contracts.js';
import { evidenceKinds, admissionTrustInputSchema, type ProductAdmissionContext, type NormalizedResolution, type NormalizedResolutionState,
  type SemanticDimension, type AdmissionReason, type EvidenceFact, type EvidenceKind } from './contracts.js';

export function isTerminalValidResolution(state: NormalizedResolutionState): boolean {
  return state === 'VERIFIED' || state === 'VERIFIED_NOT_APPLICABLE';
}
export function orderedReasons(reasons: readonly AdmissionReason[]): AdmissionReason[] {
  const entries = reasons.map(reason => [JSON.stringify(reason), reason] as const);
  return [...new Map(entries).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, reason]) => reason);
}
const reason = (dimension: SemanticDimension, code: AdmissionReason['code'], detail?: string): AdmissionReason =>
  ({ code, dimension, ...(detail ? { detail } : {}) });
const empty = (dimension: SemanticDimension, state: NormalizedResolutionState): NormalizedResolution =>
  ({ dimension, state, negativeEvidenceState: 'UNKNOWN', evidenceFacts: [], negativeEvidence: [], codes: [], sourceStatuses: [], reasons: [], warnings: [] });
const invalid = (dimension: SemanticDimension, detail: string): NormalizedResolution =>
  ({ ...empty(dimension, 'INVALID_STATE'), reasons: [reason(dimension, 'SOURCE_STRUCTURE_INVALID', detail)] });
const atom = (kind: EvidenceKind, sourceReference: string, acceptable: boolean, strength: EvidenceFact['strength'] = 'STRONG'): EvidenceFact =>
  ({ kind, sourceReference, acceptable, strength });
const ontologyVersions = ['commercial-product-ontology-v1', 'commercial-product-ontology-v2', 'commercial-product-ontology-v3'] as const;
// These registries are immutable. Their identities are computed once, without a per-product cache.
const ontologyHashes = new Map(ontologyVersions.map(version => [version, computeCommercialProductOntologyRegistryHash(getCommercialProductOntologyRegistry(version))]));

export function mapProductSemantics(context: ProductAdmissionContext): NormalizedResolution {
  const dim = 'PRODUCT_SEMANTICS';
  if (!context.productSemantics) return empty(dim, 'UNAVAILABLE_PROJECTION');
  const parsed = productSemanticSnapshotFactSchema.safeParse(context.productSemantics);
  if (!parsed.success) return invalid(dim, 'Product snapshot fact schema');
  const fact = parsed.data, product = context.canonical;
  if (!product || fact.productId !== String(product.productId)) return invalid(dim, 'Product identity differs');
  let registry;
  if (fact.ontologyVersion !== 'commercial-product-ontology-v1' && fact.ontologyVersion !== 'commercial-product-ontology-v2' && fact.ontologyVersion !== 'commercial-product-ontology-v3') return invalid(dim, 'Unknown ontology');
  try { registry = getCommercialProductOntologyRegistry(fact.ontologyVersion); } catch { return invalid(dim, 'Unknown ontology'); }
  if (ontologyHashes.get(registry.registryVersion) !== fact.ontologyHash) return invalid(dim, 'Ontology hash differs');
  const tags = [...(fact.primaryProductFamily ? [fact.primaryProductFamily] : []), ...fact.secondaryProductFamilies, ...fact.disciplines, ...fact.useContexts];
  const facts = tags.map(tag => fact.provenance.evidence.filter(e => e.axis === tag.axis && e.code === tag.code && e.ruleId === tag.ruleId).map(e => {
    let acceptable = context.lineage?.productVerified === true;
    if (e.sourceType === 'TRUSTED_CATEGORY' || e.sourceType === 'STRUCTURED_FEATURE') acceptable &&= context.trust?.sourceHashesVerified === true;
    let strength: EvidenceFact['strength'] = tag.confidence === 'EXPLICIT' ? 'EXPLICIT' : 'STRONG';
    if (e.sourceType === 'NAME_TEXT') acceptable &&= e.rawValue === product.name;
    if (e.sourceType === 'TRUSTED_CATEGORY') {
      const trust = context.trust?.categories.find(c => String(c.categoryId) === e.sourceId);
      acceptable &&= !!product.categoryIds?.some(c => String(c.categoryId) === e.sourceId)
        && !!trust && registry.globalRules.categoryTrustGate[tag.axis].includes(trust.trustClass as 'SEMANTIC_STRONG');
      if (trust?.trustClass === 'SEMANTIC_WEAK') strength = 'WEAK';
    }
    if (e.sourceType === 'STRUCTURED_FEATURE') {
      let bound = !!product.features?.some(f => String(f.featureId) === e.sourceId && (f.value ?? '') === e.rawValue);
      if (e.ruleId === 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3') {
        // This real rule persists a combined category + feature string, not the feature value alone.
        const input: ProductSemanticClassificationInput = { productId: String(product.productId), productName: product.name,
          catalogPresence: product.catalogPresence, activeStatus: product.active,
          categories: (product.categoryIds ?? []).map(c => ({ categoryId: String(c.categoryId), name: c.name ?? '',
            trustClass: (context.trust?.categories.find(t => t.categoryId === c.categoryId)?.trustClass ?? 'UNKNOWN') as ProductSemanticClassificationInput['categories'][number]['trustClass'] })),
          features: (product.features ?? []).map(f => ({ featureId: String(f.featureId), featureName: f.name, value: f.value ?? '',
            trustClass: (context.trust?.features.find(t => t.featureId === f.featureId)?.trustClass ?? 'UNKNOWN') as ProductSemanticClassificationInput['features'][number]['trustClass'] })),
        };
        const match = matchGuardedCableMachineStructuredEvidence(input, registry);
        bound = match?.rawValue === e.rawValue && match.sourceId === e.sourceId && match.code === e.code;
      }
      acceptable &&= bound;
    }
    if (e.sourceType === 'FAMILY_INFERENCE') acceptable &&= !!fact.primaryProductFamily && tags.some(t => t.axis === 'PRODUCT_FAMILY');
    return atom(e.sourceType, `${e.ruleId}/${e.sourceId}`, acceptable, strength);
  }));
  const stateByStatus: Record<typeof fact.classificationStatus, NormalizedResolutionState> = {
    CLASSIFIED: 'VERIFIED', PARTIALLY_CLASSIFIED: 'PARTIAL', OTHER: 'UNKNOWN', NEEDS_REVIEW: 'AMBIGUOUS', EXCLUDED_NON_PRODUCT: 'VERIFIED_NOT_APPLICABLE',
  };
  let state = stateByStatus[fact.classificationStatus];
  const reasons: AdmissionReason[] = [], negativeEvidence: EvidenceFact[] = [];
  if (tags.some(t => !getOntologyTag(t.axis, t.code, registry.registryVersion)) || facts.some(f => !f.length)) return invalid(dim, 'Unknown tag or missing bound tag evidence');
  if (fact.catalogPresence !== product.catalogPresence) { state = 'SOURCE_CONFLICT'; reasons.push(reason(dim, 'CROSS_PROJECTION_CONFLICT', 'Product presence differs')); }
  if (facts.some(group => group.some(e => e.strength === 'WEAK'))) state = 'PARTIAL';
  if (product.catalogPresence === 'historical_order_detail_only' && fact.provenance.evidence.some(e => e.sourceType === 'FAMILY_INFERENCE')) {
    state = 'SOURCE_CONFLICT'; reasons.push(reason(dim, 'CROSS_PROJECTION_CONFLICT', 'Historical explicit-name policy conflicts with discipline family inference'));
  }
  if (fact.classificationStatus === 'CLASSIFIED' && (!fact.primaryProductFamily || getOntologyTag('PRODUCT_FAMILY', fact.primaryProductFamily.code, fact.ontologyVersion)?.residual)) state = 'UNKNOWN';
  if (fact.classificationStatus === 'EXCLUDED_NON_PRODUCT') {
    const exclusion = evaluateNonProductExclusion(fact.productId, product.name, registry.globalRules.nonProductExclusion);
    if (exclusion.excluded && exclusion.matchedRule === fact.provenance.exclusion?.ruleId) negativeEvidence.push(atom('NAME_TEXT', exclusion.matchedRule, context.lineage?.productVerified === true, 'EXPLICIT'));
  }
  return { ...empty(dim, state), evidenceFacts: facts, negativeEvidence, negativeEvidenceState: state === 'VERIFIED_NOT_APPLICABLE'
    ? negativeEvidence.length ? 'PRESENT' : 'ABSENT' : 'NOT_REQUIRED', codes: tags.map(t => t.code).sort(), sourceStatuses: [fact.classificationStatus], reasons };
}

function trainingEvidence(context: ProductAdmissionContext, assignment: NonNullable<ProductAdmissionContext['training']>['trainingFunctions'][number]
  | NonNullable<ProductAdmissionContext['training']>['exerciseCapabilities'][number]): EvidenceFact[] {
  const canonical = context.canonical, registry = getTrainingSemanticRegistryV2();
  return assignment.evidence.map(e => {
    let acceptable = context.lineage?.trainingVerified === true;
    if (e.kind === 'TRUSTED_CATEGORY' || e.kind === 'STRUCTURED_FEATURE') acceptable &&= context.trust?.sourceHashesVerified === true;
    let strength: EvidenceFact['strength'] = assignment.classificationConfidence === 'EXPLICIT' ? 'EXPLICIT'
      : assignment.classificationConfidence === 'HIGH' ? 'STRONG' : 'WEAK';
    if (e.kind === 'NAME') acceptable &&= !!e.matchedText && !!canonical && normalizeProductName(canonical.name).includes(normalizeProductName(e.matchedText));
    if (e.kind === 'STRUCTURED_FEATURE') acceptable &&= !!canonical?.features?.some(f => String(f.featureId) === e.sourceId);
    if (e.kind === 'TRUSTED_CATEGORY') {
      acceptable &&= !!canonical?.categoryIds?.some(c => context.trust?.categories.some(t => t.categoryId === c.categoryId && t.trustClass === 'SEMANTIC_STRONG')
        && (String(c.categoryId) === e.sourceId || (!!e.matchedText && !!c.name && normalizeProductName(c.name) === normalizeProductName(e.matchedText))));
    }
    if (e.kind === 'MANUAL_OVERRIDE') {
      acceptable &&= assignment.reviewState === 'MANUAL_OVERRIDE' && !!assignment.provenance?.overrideId;
      strength = 'EXPLICIT';
    }
    if (e.kind === 'FAMILY_DERIVATION') {
      const parent = mapProductSemantics(context);
      acceptable &&= 'functionCode' in assignment && assignment.productFamily === context.productSemantics?.primaryProductFamily?.code
        && registry.familyTrainingFunctionDerivations.some(d => d.productFamily === assignment.productFamily && d.trainingFunctionCode === assignment.functionCode && d.status === 'ACTIVE')
        && parent.state === 'VERIFIED' && parent.evidenceFacts.every(group => group.some(f => f.acceptable && ['STRONG', 'EXPLICIT'].includes(f.strength))) && context.lineage?.productVerified === true;
    }
    return atom(e.kind, `${e.ruleId ?? 'UNSPECIFIED_RULE'}/${e.sourceId ?? 'UNSPECIFIED_SOURCE'}`, acceptable, strength);
  });
}
function mapTraining(context: ProductAdmissionContext, dimension: 'TRAINING_EXERCISE' | 'TRAINING_FUNCTION'): NormalizedResolution {
  if (!context.training) return empty(dimension, 'UNAVAILABLE_PROJECTION');
  const parsed = trainingSemanticSnapshotV2RecordSchema.safeParse(context.training);
  if (!parsed.success) return invalid(dimension, 'Training V2 record schema');
  const fact = parsed.data;
  if (!context.canonical || fact.productId !== context.canonical.productId) return invalid(dimension, 'Training identity differs');
  const exercises = fact.exerciseCapabilities, functions = fact.trainingFunctions, negative = fact.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY';
  if (negative && exercises.length + functions.length > 0) return { ...empty(dimension, 'INVALID_STATE'), sourceStatuses: [fact.resolutionState!],
    reasons: [reason(dimension, 'TRAINING_NEGATIVE_WITH_ASSIGNMENTS')] };
  if (fact.resolved !== undefined && fact.resolved !== ['SEMANTIC_COMPLETE', 'VERIFIED_NO_APPLICABLE_CAPABILITY'].includes(fact.resolutionState ?? ''))
    return invalid(dimension, 'Training resolved flag contradicts resolution state');
  const assignments = dimension === 'TRAINING_EXERCISE' ? exercises : functions;
  const states: Record<string, NormalizedResolutionState> = { SEMANTIC_COMPLETE: 'VERIFIED', VERIFIED_NO_APPLICABLE_CAPABILITY: 'VERIFIED_NOT_APPLICABLE',
    SEMANTIC_PARTIAL: 'PARTIAL', RULE_GAP: 'PARTIAL', AMBIGUOUS: 'AMBIGUOUS', NEEDS_REVIEW: 'AMBIGUOUS', DATA_GAP: 'DATA_GAP', ONTOLOGY_GAP: 'ONTOLOGY_GAP' };
  let state = states[fact.resolutionState ?? ''] ?? 'UNKNOWN';
  const reasons: AdmissionReason[] = [], evidenceFacts = assignments.map(a => trainingEvidence(context, a));
  if (fact.resolutionState === 'SEMANTIC_COMPLETE' && !assignments.length) {
    state = exercises.length + functions.length ? 'UNKNOWN' : 'INVALID_STATE';
    reasons.push(reason(dimension, dimension === 'TRAINING_EXERCISE' && functions.length ? 'TRAINING_FUNCTION_ONLY_NO_EXERCISE_RESOLUTION' : 'REQUIRED_ASSIGNMENT_MISSING'));
  }
  if (assignments.some(a => !['EXPLICIT', 'HIGH'].includes(a.classificationConfidence) && !['ACCEPTED', 'MANUAL_OVERRIDE'].includes(a.reviewState))) state = 'PARTIAL';
  for (const a of functions) if (a.relationType === 'FAMILY_DERIVED') {
    if (!getTrainingSemanticRegistryV2().familyTrainingFunctionDerivations.some(d => d.productFamily === a.productFamily && d.trainingFunctionCode === a.functionCode && d.status === 'ACTIVE')
      || !a.evidence.some(e => e.kind === 'FAMILY_DERIVATION')) state = 'INVALID_STATE';
    else if (a.productFamily !== context.productSemantics?.primaryProductFamily?.code) { state = 'SOURCE_CONFLICT'; reasons.push(reason(dimension, 'CROSS_PROJECTION_CONFLICT', 'Product / Training derived family differs')); }
  }
  const negativeEvidence = (fact.resolutionEvidence ?? []).filter(e => evidenceKinds.includes(e.kind as EvidenceKind)).map(e =>
    atom(e.kind as EvidenceKind, e.sourceId ?? '', !!e.sourceId && context.lineage?.trainingVerified === true,
      e.kind === 'MANUAL_OVERRIDE' ? 'EXPLICIT' : 'STRONG'));
  return { ...empty(dimension, state), evidenceFacts, negativeEvidence, negativeEvidenceState: negative ? fact.resolutionEvidence?.length ? 'PRESENT' : 'ABSENT' : 'NOT_REQUIRED',
    codes: assignments.map(a => 'capabilityCode' in a ? a.capabilityCode : a.functionCode).sort(), sourceStatuses: [fact.resolutionState ?? 'MISSING'], reasons };
}
export const mapTrainingExercise = (context: ProductAdmissionContext): NormalizedResolution => mapTraining(context, 'TRAINING_EXERCISE');
export const mapTrainingFunction = (context: ProductAdmissionContext): NormalizedResolution => mapTraining(context, 'TRAINING_FUNCTION');

export const supportedSpecFeatureIds = [3, 11, 12, 15, 41] as const;
const specKeysByFeature: Readonly<Record<number, readonly string[]>> = { 3: ['weight_kg'], 11: ['max_user_weight_kg'], 12: ['max_load_kg'], 41: ['max_load_kg'],
  15: ['assembled_length_cm', 'assembled_width_cm', 'assembled_height_cm'] };
// Read-only replay of buildSpecs' single-target-unit candidate, before its conflict demotion.
export function specMeasurementCandidate(spec: NonNullable<ProductAdmissionContext['specs']>[number]): number | null {
  const labels: Record<string, string> = { assembled_length_cm: 'Largo', assembled_width_cm: 'Ancho', assembled_height_cm: 'Alto' };
  const label = labels[spec.key], text = label ? spec.rawValue.match(new RegExp(`${label}\\s*:\\s*([^;]+?)(?=\\b(?:Largo|Ancho|Alto)\\s*:|$)`, 'iu'))?.[1] ?? '' : spec.rawValue;
  const matches = [...text.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${spec.unit}\\b`, 'giu'))];
  return matches.length === 1 ? Number(matches[0]![1]!.replace(',', '.')) : null;
}
export function mapSpecs(context: ProductAdmissionContext, specKey?: string): NormalizedResolution {
  const dim = 'SPECS', specs = context.specs;
  if (!specs) return empty(dim, 'UNAVAILABLE_PROJECTION');
  if (!specsArtifactSchema.shape.records.safeParse(specs).success) return invalid(dim, 'Specs records schema');
  if (!specs.length) return { ...empty(dim, 'UNKNOWN'), sourceStatuses: ['MISSING'], reasons: [reason(dim, 'SPEC_MISSING')] };
  const reasons: AdmissionReason[] = [], groups = new Map<string, typeof specs[number][]>();
  for (const spec of specs) { const group = groups.get(spec.key) ?? []; group.push(spec); groups.set(spec.key, group); }
  let conflict = false;
  for (const [key, group] of groups) {
    if (new Set(group.map(s => `${s.sourceFeature.featureId}/${s.sourceFeature.featureValueId}`)).size !== group.length) return invalid(dim, 'Duplicate spec source');
    const values = new Set(group.flatMap(s => { const candidate = specMeasurementCandidate(s); return candidate === null ? [] : [candidate]; }));
    const parsedValues = new Set(group.filter(s => s.status === 'parsed').map(s => `${s.value}/${s.unit}`));
    if (values.size > 1 || parsedValues.size > 1) { conflict = true; reasons.push(reason(dim, 'SPEC_SOURCE_CONFLICT', `${key}: ${[...values].sort((a, b) => a - b).join(', ')}`)); }
  }
  if (specs.some(s => !specKeysByFeature[s.sourceFeature.featureId]?.includes(s.key) || s.derivationRule !== `feature-${s.sourceFeature.featureId}-${s.unit}-v1`)) return invalid(dim, 'Unsupported spec source/key/derivation binding');
  const missing = (context.canonical?.features ?? []).some(f => specKeysByFeature[f.featureId]?.some(key => (!specKey || key === specKey) && !specs.some(s => s.key === key && s.sourceFeature.featureId === f.featureId && s.sourceFeature.featureValueId === f.featureValueId)));
  if (missing) reasons.push(reason(dim, 'SPEC_MISSING', 'Supported source did not publish every promised key'));
  const evidenceFacts = specs.map(s => {
    const bound = context.canonical?.features?.some(f => f.featureId === s.sourceFeature.featureId && f.featureValueId === s.sourceFeature.featureValueId && (f.value ?? '') === s.rawValue);
    if (s.productKey !== `P${context.canonical?.productId}` || s.catalogPresence !== context.canonical?.catalogPresence || !bound
      || s.status === 'parsed' && s.value !== specMeasurementCandidate(s)) {
      conflict = true; reasons.push(reason(dim, 'CROSS_PROJECTION_CONFLICT', `Spec source/presence binding ${s.key}`));
    }
    return [atom('STRUCTURED_FEATURE', `${s.derivationRule}/${s.sourceFeature.featureId}/${s.sourceFeature.featureValueId}`,
      !!bound && s.status === 'parsed' && context.lineage?.specsVerified === true)];
  });
  if (specs.some(s => s.unit !== (s.key.endsWith('_kg') ? 'kg' : 'cm'))) return invalid(dim, 'Spec key/unit differs');
  const unsupported = specs.some(s => s.status === 'unsupported'), ambiguous = specs.some(s => s.status === 'ambiguous'), parsed = specs.some(s => s.status === 'parsed');
  if (unsupported) reasons.push(reason(dim, 'SPEC_UNSUPPORTED'));
  let state: NormalizedResolutionState = unsupported ? parsed || ambiguous ? 'PARTIAL' : 'DATA_GAP' : ambiguous ? parsed ? 'PARTIAL' : 'AMBIGUOUS' : 'VERIFIED';
  if (missing) state = 'DATA_GAP';
  if (conflict) state = 'SOURCE_CONFLICT';
  return { ...empty(dim, state), evidenceFacts, negativeEvidenceState: 'NOT_REQUIRED', codes: [...groups.keys()].sort(),
    sourceStatuses: [...new Set(specs.map(s => s.status.toUpperCase()))].sort(), reasons: orderedReasons(reasons) };
}
export function mapTrust(context: ProductAdmissionContext): NormalizedResolution {
  const dim = 'TRUST', trust = context.trust, canonical = context.canonical;
  if (!trust) return empty(dim, 'UNAVAILABLE_PROJECTION');
  if (!admissionTrustInputSchema.safeParse(trust).success) return invalid(dim, 'Trust mapping schema/duplicate definitions');
  if (!canonical || canonical.categoryIds === null || canonical.features === null) return empty(dim, 'UNKNOWN');
  const missing = canonical.categoryIds.some(c => !trust.categories.some(t => t.categoryId === c.categoryId))
    || canonical.features.some(f => !trust.features.some(t => t.featureId === f.featureId));
  const state = missing ? 'DATA_GAP' : !trust.sourceHashesVerified || !trust.consumedByCategorySelection ? 'PARTIAL' : 'VERIFIED';
  return { ...empty(dim, state), negativeEvidenceState: 'NOT_REQUIRED', evidenceFacts: [[atom('TRUSTED_CATEGORY', 'category-trust-map', trust.sourceHashesVerified && !missing),
    atom('STRUCTURED_FEATURE', 'feature-trust-map', trust.sourceHashesVerified && !missing)]],
    reasons: state === 'VERIFIED' ? [] : [reason(dim, 'TRUST_INSUFFICIENT')], warnings: trust.consumedByCategorySelection ? [] : [reason(dim, 'TRUST_RUNTIME_AUTHORITY_SEPARATE')] };
}
