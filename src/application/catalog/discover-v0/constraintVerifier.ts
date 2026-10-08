import type { CommercialObservation, ConstraintResult, DiscoverConstraint, DiscoverV0Mode } from './contracts.js';
import { matchNominal } from '../../../domain/catalog/v2/nominalSearch.js';
import { admissionFor, hasIndexedText, specSatisfies } from './generators.js';
import { DISCOVER_V0_LEXICON, type ConceptLexiconEntry } from './lexicon.js';
import type { DiscoverIndex, ProductRetrievalDocument } from './retrievalDocument.js';
import { discoverTokens, stemToken } from './text.js';

/*
 * ConstraintVerifier — evaluates each requested constraint against the
 * projection that owns that claim, gated by the Admission decision of THAT
 * dimension (never Unified Admission as a global filter).
 *
 *  SATISFIED   the owning projection asserts it AND its dimension is ADMITTED
 *              (family claims: and no REQUIRED family obligation is unmet)
 *              (specs: parsed, unqualified, single-valued, SPEC_FILTERING admitted)
 *  VIOLATED    the owning projection, admitted, asserts something incompatible
 *              (or a PRESENT negative for a modeled exercise/function)
 *  UNKNOWN     missing, unadmitted, ambiguous, qualified, ABSENT negative,
 *              commercial truth not observed, or text-vs-classification conflict
 *  UNSUPPORTED no verified projection exists (compatibility: relationships UNAVAILABLE)
 *
 * A lexical match never makes a constraint SATISFIED.
 */

const familyTermStems = new Map<string, string[][]>();
for (const entry of DISCOVER_V0_LEXICON) {
  if (entry.type === 'CONCEPT' && (entry as ConceptLexiconEntry).axis === 'PRODUCT_FAMILY') {
    const code = (entry as ConceptLexiconEntry).code;
    familyTermStems.set(code, [...(familyTermStems.get(code) ?? []), ...entry.terms.map((term) => discoverTokens(term).map(stemToken))]);
  }
}

function nameNamesFamily(document: ProductRetrievalDocument, codes: readonly string[]): string | null {
  const name = discoverTokens(document.name).map(stemToken);
  for (const code of codes) {
    for (const term of familyTermStems.get(code) ?? []) {
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

  verify(document: ProductRetrievalDocument, constraint: DiscoverConstraint, hard: boolean, mode: DiscoverV0Mode, commercial: CommercialObservation): ConstraintResult {
    const base = { constraintId: constraint.id, kind: constraint.kind, domain: constraint.domain, hard };
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
    if (constraint.domain === 'COMMERCIAL') return { ...base, ...this.commercial(constraint, commercial) };
    if (mode === 'LEXICAL_PLUS') return { ...base, state: 'UNKNOWN', reason: 'NOT_EVALUATED_IN_LEXICAL_MODE' };
    return { ...base, ...this.technical(document, constraint) };
  }

  private commercial(constraint: DiscoverConstraint, observation: CommercialObservation): Verdict {
    if (observation.status === 'NOT_OBSERVED') return { state: 'UNKNOWN', reason: `COMMERCIAL_TRUTH_NOT_OBSERVED:${observation.reason}`, source: 'COMMERCIAL_TRUTH' };
    if (constraint.kind === 'COMMERCIAL_MAX_PRICE') {
      if (observation.finalGrossClp === null) return { state: 'UNKNOWN', reason: 'PRICE_UNAVAILABLE', source: 'COMMERCIAL_TRUTH' };
      return { state: observation.finalGrossClp <= (constraint.value ?? 0) ? 'SATISFIED' : 'VIOLATED', reason: `finalGross=${observation.finalGrossClp}`, source: 'COMMERCIAL_TRUTH', evidence: `${observation.authority}@${observation.asOf}` };
    }
    if (constraint.kind === 'COMMERCIAL_AVAILABILITY') {
      if (observation.sellability === 'sellable') return { state: 'SATISFIED', reason: 'sellable', source: 'COMMERCIAL_TRUTH', evidence: `${observation.authority}@${observation.asOf}` };
      if (observation.sellability === 'not_sellable') return { state: 'VIOLATED', reason: 'not_sellable', source: 'COMMERCIAL_TRUTH' };
      return { state: 'UNKNOWN', reason: observation.sellability, source: 'COMMERCIAL_TRUTH' };
    }
    return { state: 'UNKNOWN', reason: 'COMMERCIAL_PREFERENCE_NOT_SCORED_V0', source: 'COMMERCIAL_TRUTH' };
  }

  private technical(document: ProductRetrievalDocument, constraint: DiscoverConstraint): Verdict {
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
        return this.spec(document, constraint);
      default:
        return { state: 'UNSUPPORTED', reason: `NO_VERIFIER_FOR_${constraint.kind}` };
    }
  }

  private productSemantics(document: ProductRetrievalDocument, axis: string, codes: readonly string[]): Verdict {
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
    const nameTerm = nameNamesFamily(document, codes);
    if (nameTerm) {
      // The product's own name names the requested type while the admitted family differs:
      // a cross-evidence conflict, never resolved in either direction by the text match.
      return { state: 'UNKNOWN', reason: `CLASSIFICATION_CONFLICTS_WITH_NAME:${semantic.primaryFamily.code}~"${nameTerm}"`, source: 'PRODUCT_SEMANTICS',
        evidence: semantic.primaryFamily.ruleId, admission };
    }
    return { state: 'VIOLATED', reason: `ADMITTED_FAMILY_DIFFERS:${semantic.primaryFamily.code}`, source: 'PRODUCT_SEMANTICS', evidence: semantic.primaryFamily.ruleId,
      confidence: semantic.primaryFamily.confidence, admission };
  }

  private training(document: ProductRetrievalDocument, axis: string, codes: readonly string[]): Verdict {
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
      return this.negative(training, document.admission?.functionNegativeEvidence ?? null, admission, true);
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
    return this.negative(training, document.admission?.exerciseNegativeEvidence ?? null, admission, axis === 'EXERCISE_CAPABILITY');
  }

  private negative(training: NonNullable<ProductRetrievalDocument['training']>, negativeEvidence: string | null, admission: string, modeledCode: boolean): Verdict {
    const noAssignments = training.exercises.length === 0 && training.functions.length === 0;
    if (modeledCode && training.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && negativeEvidence === 'PRESENT' && noAssignments) {
      return { state: 'VIOLATED', reason: 'VERIFIED_NO_APPLICABLE_CAPABILITY/NEGATIVE_EVIDENCE_PRESENT', source: 'TRAINING_V2', admission };
    }
    return { state: 'UNKNOWN', reason: `NOT_ASSERTED:${training.resolutionState}/negative=${negativeEvidence ?? 'n/a'}`, source: 'TRAINING_V2', admission };
  }

  private spec(document: ProductRetrievalDocument, constraint: DiscoverConstraint): Verdict {
    if (!document.specs) return { state: 'UNKNOWN', reason: 'SPECS_UNAVAILABLE', source: 'SPECS' };
    const key = constraint.specKey!;
    const records = document.specs.filter((spec) => spec.key === key);
    const admission = admissionFor(document, 'SPEC', key);
    if (records.length === 0) return { state: 'UNKNOWN', reason: 'SPEC_MISSING', source: 'SPECS', admission };
    const parsed = records.filter((spec) => spec.status === 'parsed' && spec.value !== null);
    const values = [...new Set(parsed.map((spec) => spec.value))];
    if (parsed.length !== records.length || values.length !== 1) {
      return { state: 'UNKNOWN', reason: `SPEC_NOT_SINGLE_PARSED:${records.map((spec) => spec.status).join(',')}`, source: 'SPECS', admission };
    }
    const spec = parsed[0]!;
    const evidence = `${spec.rawValue} [feature ${spec.featureId}/${spec.featureValueId}, ${spec.derivationRule}]`;
    if (admission !== 'ADMITTED') return { state: 'UNKNOWN', reason: `SPEC_FILTERING_NOT_ADMITTED:${admission}`, source: 'SPECS', evidence, admission };
    if (parsed.some((item) => item.qualifier)) return { state: 'UNKNOWN', reason: `SPEC_CONTEXTUAL_QUALIFIER:"${spec.qualifier}"`, source: 'SPECS', evidence, admission };
    const ok = specSatisfies(constraint.operator, spec.value!, constraint.value!);
    return { state: ok ? 'SATISFIED' : 'VIOLATED', reason: `${key}=${spec.value}${spec.unit} ${constraint.operator} ${constraint.value}`, source: 'SPECS',
      matchedConcept: `SPEC:${key}`, evidence, admission };
  }
}
