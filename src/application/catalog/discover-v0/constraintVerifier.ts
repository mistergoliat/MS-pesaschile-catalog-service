import type { CommercialObservation, ConceptAxis, ConstraintResult, DiscoverConstraint, DiscoverV0Mode } from './contracts.js';
import { matchNominal } from '../../../domain/catalog/v2/nominalSearch.js';
import { admissionFor, hasIndexedText } from './generators.js';
import { DISCOVER_V0_LEXICON } from './lexicon.js';
import { assessSpecQuantities } from './quantityScope.js';
import type { DiscoverIndex, ProductRetrievalDocument } from './retrievalDocument.js';
import { discoverTokens, stemToken } from './text.js';

/*
 * ConstraintVerifier — evaluates each requested constraint against the
 * projection that owns that claim, gated by the Admission decision of THAT
 * dimension (never Unified Admission as a global filter).
 *
 *  SATISFIED   the owning projection asserts it AND its dimension is ADMITTED
 *              (family claims: and no REQUIRED family obligation is unmet)
 *              (specs: parsed, single comparable value, SPEC_FILTERING admitted,
 *               and a typed QuantityScope comparable with the requested scope)
 *  VIOLATED    the owning projection, admitted, asserts something incompatible
 *              (or a PRESENT negative for a modeled exercise/function that the
 *               product's own name does not contradict)
 *  UNKNOWN     missing, unadmitted, ambiguous, untyped qualifier, ABSENT negative,
 *              commercial truth not observed/expired, or CONFLICTING_EVIDENCE
 *              between the product's source text and its classification
 *  UNSUPPORTED no verified projection exists (compatibility: relationships UNAVAILABLE)
 *
 * A lexical match never makes a constraint SATISFIED; a conflict is never
 * resolved in favour of the classifier.
 */

export type VerifierContext = {
  /** PRODUCT_TYPE codes of the query (component checks for per-unit quantities). */
  requestedFamilies?: readonly string[];
  /** EXERCISE codes of the query (subcomponent capacities, e.g. "barra pull up: 150 kg"). */
  requestedExercises?: readonly string[];
  /** Clock for commercial freshness; defaults to the wall clock only when an observation carries validUntil. */
  now?: () => Date;
};

/** Stemmed lexicon terms per concept code ("AXIS:CODE"), including the readings of ambiguous entries. */
const conceptTermStems = new Map<string, string[][]>();
const addTerms = (key: string, terms: readonly string[]) => conceptTermStems.set(key, [...(conceptTermStems.get(key) ?? []), ...terms.map((term) => discoverTokens(term).map(stemToken))]);
for (const entry of DISCOVER_V0_LEXICON) {
  if (entry.type === 'CONCEPT') addTerms(`${entry.axis}:${entry.code}`, entry.terms);
  if (entry.type === 'AMBIGUOUS') for (const reading of entry.readings) addTerms(`${reading.axis}:${reading.code}`, entry.terms);
}

/** The first governed term of any requested code that the product NAME contains, or null. */
export function nameNamesConcept(document: ProductRetrievalDocument, axis: ConceptAxis, codes: readonly string[]): string | null {
  const name = discoverTokens(document.name).map(stemToken);
  for (const code of codes) {
    for (const term of conceptTermStems.get(`${axis}:${code}`) ?? []) {
      if (term.length === 0) continue;
      for (let start = 0; start + term.length <= name.length; start += 1) {
        if (term.every((token, offset) => name[start + offset] === token)) return term.join(' ');
      }
    }
  }
  return null;
}

type Verdict = Omit<ConstraintResult, 'constraintId' | 'kind' | 'domain' | 'hard'>;

export class ConstraintVerifier {
  constructor(private readonly index: DiscoverIndex) {}

  verify(document: ProductRetrievalDocument, constraint: DiscoverConstraint, hard: boolean, mode: DiscoverV0Mode, commercial: CommercialObservation, context: VerifierContext = {}): ConstraintResult {
    const base = { constraintId: constraint.id, kind: constraint.kind, domain: constraint.domain, hard,
      ...(constraint.groupId ? { groupId: constraint.groupId, readingId: constraint.readingId } : {}) };
    if (constraint.kind === 'COMPATIBILITY') {
      return { ...base, state: 'UNSUPPORTED', reason: this.index.lineage.relationships === 'PRESENT' ? 'COMPATIBILITY_RELATION_NOT_MODELED_V0' : 'RELATIONSHIPS_PROJECTION_UNAVAILABLE', source: 'RELATIONSHIPS' };
    }
    if (constraint.kind === 'SUBSTITUTION') return { ...base, state: 'UNSUPPORTED', reason: 'SUBSTITUTE_RELATION_UNAVAILABLE', source: 'RELATIONSHIPS' };
    if (constraint.kind === 'UNMODELED_NEED' || constraint.kind === 'VARIANT_ATTRIBUTE') return { ...base, state: 'UNSUPPORTED', reason: `NOT_IN_ONTOLOGY:${constraint.matchedText}`, source: 'ONTOLOGY' };
    if (constraint.kind === 'NOMINAL_TEXT') {
      // A nominal-text condition is a retrieval relevance check (as catalog.search), not a technical claim.
      const match = matchNominal({ query: constraint.matchedText, name: document.name, shortDescription: null, references: document.references });
      return match && match.tier !== 'description'
        ? { ...base, state: 'SATISFIED', reason: `NAME_${match.tier.toUpperCase()}`, source: 'SOURCE_NAME' }
        : { ...base, state: 'UNKNOWN', reason: 'PARTIAL_TEXT_MATCH_ONLY', source: 'SOURCE_NAME' };
    }
    if (constraint.kind === 'BUNDLE_COMPONENT') {
      const mentioned = (constraint.subtypeText ?? []).some((stems) => hasIndexedText(this.index, document.productKey, stems));
      return { ...base, state: 'UNKNOWN', reason: mentioned ? 'BUNDLE_COMPOSITION_NOT_MODELED:component-named-in-text' : 'BUNDLE_COMPOSITION_NOT_MODELED', source: 'ONTOLOGY' };
    }
    if (constraint.domain === 'COMMERCIAL') return { ...base, ...this.commercial(constraint, commercial, context) };
    if (mode === 'LEXICAL_PLUS') return { ...base, state: 'UNKNOWN', reason: 'NOT_EVALUATED_IN_LEXICAL_MODE' };
    return { ...base, ...this.technical(document, constraint, context) };
  }

  private commercial(constraint: DiscoverConstraint, observation: CommercialObservation, context: VerifierContext): Verdict {
    if (observation.status === 'NOT_OBSERVED') return { state: 'UNKNOWN', reason: `COMMERCIAL_TRUTH_NOT_OBSERVED:${observation.reason}`, source: 'COMMERCIAL_TRUTH' };
    const evidence = `${observation.authority}@${observation.asOf}`;
    // PRD P9: an expired observation is historical evidence, never current truth.
    if (observation.validUntil && Date.parse(observation.validUntil) < (context.now ?? (() => new Date()))().getTime()) {
      return { state: 'UNKNOWN', reason: `COMMERCIAL_OBSERVATION_EXPIRED:validUntil=${observation.validUntil}`, source: 'COMMERCIAL_TRUTH', evidence };
    }
    if (constraint.kind === 'COMMERCIAL_MAX_PRICE') {
      if (observation.finalGrossClp === null) return { state: 'UNKNOWN', reason: 'PRICE_UNAVAILABLE', source: 'COMMERCIAL_TRUTH', evidence };
      return { state: observation.finalGrossClp <= (constraint.value ?? 0) ? 'SATISFIED' : 'VIOLATED', reason: `finalGross=${observation.finalGrossClp}`, source: 'COMMERCIAL_TRUTH', evidence };
    }
    if (constraint.kind === 'COMMERCIAL_AVAILABILITY') {
      if (observation.sellability === 'sellable') return { state: 'SATISFIED', reason: `sellable${observation.availabilityReason ? `:${observation.availabilityReason}` : ''}`, source: 'COMMERCIAL_TRUTH', evidence };
      if (observation.sellability === 'not_sellable') return { state: 'VIOLATED', reason: `not_sellable${observation.availabilityReason ? `:${observation.availabilityReason}` : ''}`, source: 'COMMERCIAL_TRUTH', evidence };
      return { state: 'UNKNOWN', reason: observation.sellability, source: 'COMMERCIAL_TRUTH', evidence };
    }
    return { state: 'UNKNOWN', reason: 'COMMERCIAL_PREFERENCE_NOT_SCORED_V0', source: 'COMMERCIAL_TRUTH' };
  }

  private technical(document: ProductRetrievalDocument, constraint: DiscoverConstraint, context: VerifierContext): Verdict {
    const codes = constraint.codes ?? [];
    switch (constraint.kind) {
      case 'PRODUCT_TYPE':
      case 'DISCIPLINE':
      case 'USE_CONTEXT':
        return this.productSemantics(document, constraint.axis ?? 'PRODUCT_FAMILY', codes);
      case 'EXERCISE':
      case 'TRAINING_FUNCTION':
      case 'ANATOMY':
        return this.training(document, constraint.axis ?? 'EXERCISE_CAPABILITY', codes);
      case 'SPEC':
        return this.spec(document, constraint, context);
      default:
        return { state: 'UNSUPPORTED', reason: `NO_VERIFIER_FOR_${constraint.kind}` };
    }
  }

  private productSemantics(document: ProductRetrievalDocument, axis: ConceptAxis, codes: readonly string[]): Verdict {
    const semantic = document.productSemantics;
    if (!semantic) return { state: 'UNKNOWN', reason: 'PRODUCT_SEMANTICS_UNAVAILABLE', source: 'PRODUCT_SEMANTICS' };
    const admission = admissionFor(document, axis);
    const concept = `${axis}:${codes.join('|')}`;
    if (semantic.classificationStatus === 'EXCLUDED_NON_PRODUCT') {
      return admission === 'ADMITTED' || axis === 'PRODUCT_FAMILY'
        ? { state: 'VIOLATED', reason: 'EXCLUDED_NON_PRODUCT', source: 'PRODUCT_SEMANTICS', matchedConcept: concept, admission }
        : { state: 'UNKNOWN', reason: 'EXCLUDED_NON_PRODUCT', source: 'PRODUCT_SEMANTICS', admission };
    }
    const tags = axis === 'PRODUCT_FAMILY' ? [...(semantic.primaryFamily ? [semantic.primaryFamily] : []), ...semantic.secondaryFamilies]
      : axis === 'DISCIPLINE' ? semantic.disciplines : semantic.useContexts;
    const hit = tags.find((tag) => codes.includes(tag.code));
    const unmet = axis === 'PRODUCT_FAMILY' ? (document.admission?.unmetFamilyObligations ?? []) : [];
    if (hit && admission === 'ADMITTED' && unmet.length > 0) {
      // FAMILY_CLAIM_CONSISTENCY_V0: the family's own obligation contract requires a training
      // assertion the product lacks (e.g. CABLE_MACHINE without CABLE_RESISTANCE): not certified.
      return { state: 'UNKNOWN', reason: `FAMILY_OBLIGATION_UNMET:${unmet.join('+')}`, source: 'PRODUCT_SEMANTICS', matchedConcept: `${axis}:${hit.code}`, evidence: hit.ruleId, admission };
    }
    if (hit) {
      return admission === 'ADMITTED'
        ? { state: 'SATISFIED', reason: `${axis}=${hit.code}`, source: 'PRODUCT_SEMANTICS', matchedConcept: `${axis}:${hit.code}`, evidence: hit.ruleId, confidence: hit.confidence, admission }
        : { state: 'UNKNOWN', reason: `ASSIGNED_BUT_NOT_ADMITTED:${admission}`, source: 'PRODUCT_SEMANTICS', matchedConcept: `${axis}:${hit.code}`, evidence: hit.ruleId, admission };
    }
    if (axis !== 'PRODUCT_FAMILY') return { state: 'UNKNOWN', reason: 'TAG_NOT_ASSERTED', source: 'PRODUCT_SEMANTICS', admission };
    if (!semantic.primaryFamily) return { state: 'UNKNOWN', reason: `FAMILY_NOT_ASSIGNED:${semantic.classificationStatus}`, source: 'PRODUCT_SEMANTICS', admission };
    if (admission !== 'ADMITTED') return { state: 'UNKNOWN', reason: `OTHER_FAMILY_NOT_ADMITTED:${semantic.primaryFamily.code}`, source: 'PRODUCT_SEMANTICS', admission };
    const nameTerm = nameNamesConcept(document, 'PRODUCT_FAMILY', codes);
    if (nameTerm) {
      // The product's own name names the requested type while the admitted family differs:
      // a cross-evidence conflict, never resolved in either direction by the text match.
      return { state: 'UNKNOWN', reason: `CLASSIFICATION_CONFLICTS_WITH_NAME:${semantic.primaryFamily.code}~"${nameTerm}"`, source: 'PRODUCT_SEMANTICS',
        evidence: semantic.primaryFamily.ruleId, admission, conflict: 'CONFLICTING_EVIDENCE' };
    }
    return { state: 'VIOLATED', reason: `ADMITTED_FAMILY_DIFFERS:${semantic.primaryFamily.code}`, source: 'PRODUCT_SEMANTICS', evidence: semantic.primaryFamily.ruleId,
      confidence: semantic.primaryFamily.confidence, admission };
  }

  private training(document: ProductRetrievalDocument, axis: ConceptAxis, codes: readonly string[]): Verdict {
    const training = document.training;
    if (!training) return { state: 'UNKNOWN', reason: 'TRAINING_V2_UNAVAILABLE', source: 'TRAINING_V2' };
    const admission = admissionFor(document, axis);
    const concept = `${axis}:${codes.join('|')}`;
    if (axis === 'TRAINING_FUNCTION') {
      const fn = training.functions.find((item) => codes.includes(item.code) && (item.relationType === 'DIRECT' || item.relationType === 'FAMILY_DERIVED'));
      if (fn) {
        return admission === 'ADMITTED'
          ? { state: 'SATISFIED', reason: `${fn.code}/${fn.relationType}`, source: 'TRAINING_V2', matchedConcept: `${axis}:${fn.code}`, evidence: fn.ruleIds.join(','), confidence: fn.relationType, admission }
          : { state: 'UNKNOWN', reason: `ASSIGNED_BUT_NOT_ADMITTED:${admission}`, source: 'TRAINING_V2', matchedConcept: concept, admission };
      }
      return this.negative(document, training, document.admission?.functionNegativeEvidence ?? null, admission, axis, codes, true);
    }
    const exercise = training.exercises.find((item) => (item.relationType === 'DIRECT' || item.relationType === 'SUPPORTED')
      && (axis === 'EXERCISE_CAPABILITY' ? codes.includes(item.code) : axis === 'MUSCLE_GROUP' ? item.muscleGroups.some((code) => codes.includes(code))
        : item.bodyRegions.some((code) => codes.includes(code))));
    if (exercise) {
      const derivation = axis === 'EXERCISE_CAPABILITY' ? '' : ` via ${exercise.code} (registry derivation)`;
      return admission === 'ADMITTED'
        ? { state: 'SATISFIED', reason: `${exercise.code}/${exercise.relationType}${derivation}`, source: 'TRAINING_V2', matchedConcept: concept, evidence: exercise.ruleIds.join(','), confidence: exercise.relationType, admission }
        : { state: 'UNKNOWN', reason: `ASSIGNED_BUT_NOT_ADMITTED:${admission}`, source: 'TRAINING_V2', matchedConcept: concept, admission };
    }
    // Anatomy is broader than the modeled exercises: a negative never certifies "cannot train it".
    return this.negative(document, training, document.admission?.exerciseNegativeEvidence ?? null, admission, axis, codes, axis === 'EXERCISE_CAPABILITY');
  }

  private negative(document: ProductRetrievalDocument, training: NonNullable<ProductRetrievalDocument['training']>, negativeEvidence: string | null, admission: string,
    axis: ConceptAxis, codes: readonly string[], modeledCode: boolean): Verdict {
    const noAssignments = training.exercises.length === 0 && training.functions.length === 0;
    if (modeledCode && training.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && negativeEvidence === 'PRESENT' && noAssignments) {
      // NEGATIVE_EXCLUSION_POLICY_V0.2: a PRESENT negative excludes only when the product's own
      // name does not name the requested concept; otherwise the sources disagree (preserved as UNKNOWN).
      const nameTerm = nameNamesConcept(document, axis, codes);
      if (nameTerm) {
        return { state: 'UNKNOWN', reason: `NEGATIVE_CONFLICTS_WITH_NAME:"${nameTerm}"`, source: 'TRAINING_V2', admission, conflict: 'CONFLICTING_EVIDENCE' };
      }
      return { state: 'VIOLATED', reason: 'VERIFIED_NO_APPLICABLE_CAPABILITY/NEGATIVE_EVIDENCE_PRESENT', source: 'TRAINING_V2', admission };
    }
    return { state: 'UNKNOWN', reason: `NOT_ASSERTED:${training.resolutionState}/negative=${negativeEvidence ?? 'n/a'}`, source: 'TRAINING_V2', admission };
  }

  private spec(document: ProductRetrievalDocument, constraint: DiscoverConstraint, context: VerifierContext): Verdict {
    if (!document.specs) return { state: 'UNKNOWN', reason: 'SPECS_UNAVAILABLE', source: 'SPECS' };
    const key = constraint.specKey!;
    const records = document.specs.filter((spec) => spec.key === key);
    const admission = admissionFor(document, 'SPEC', key);
    if (records.length === 0) return { state: 'UNKNOWN', reason: 'SPEC_MISSING', source: 'SPECS', admission };
    const parsed = records.filter((spec) => spec.status === 'parsed' && spec.value !== null);
    if (parsed.length !== records.length) {
      return { state: 'UNKNOWN', reason: `SPEC_NOT_SINGLE_PARSED:${records.map((spec) => spec.status).join(',')}`, source: 'SPECS', admission };
    }
    const evidence = parsed.map((spec) => `${spec.rawValue} [feature ${spec.featureId}/${spec.featureValueId}, ${spec.derivationRule}]`).join(' ; ');
    if (admission !== 'ADMITTED') return { state: 'UNKNOWN', reason: `SPEC_FILTERING_NOT_ADMITTED:${admission}`, source: 'SPECS', evidence, admission };
    const assessment = assessSpecQuantities(document, parsed, constraint, { requestedFamilies: context.requestedFamilies ?? [], requestedExercises: context.requestedExercises ?? [] });
    const quantity = { scope: assessment.quantity.scope, appliesTo: assessment.quantity.appliesTo, status: assessment.quantity.status, rule: assessment.quantity.rule,
      approximate: assessment.quantity.approximate, comparedValue: assessment.comparedValue, derived: assessment.derived };
    return { state: assessment.state, reason: assessment.reason, source: 'SPECS', evidence, admission, quantity,
      ...(assessment.state !== 'UNKNOWN' ? { matchedConcept: `SPEC:${key}` } : {}), ...(assessment.conflict ? { conflict: assessment.conflict } : {}) };
  }
}
