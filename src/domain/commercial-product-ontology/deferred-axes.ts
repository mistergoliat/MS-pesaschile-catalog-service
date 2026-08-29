// Section 13: axes considered and explicitly not activated. Never appears in `ontologyAxes` or
// `registry.axes` — this is a permanent design record, not an active axis definition. Do not
// reintroduce any of these without new evidence produced by a future review pass.

import type { DeferredOrDroppedAxis, RejectedOntologyTag } from './contracts.js';

export const deferredOrDroppedAxes: readonly DeferredOrDroppedAxis[] = [
  {
    axis: 'TRAINING_OBJECTIVE',
    decision: 'DEFER',
    reason:
      'No structured feature or trusted category maps to a training-goal concept (max strength / hypertrophy / conditioning / mobility). Populating it would require free-text description inference, which is explicitly forbidden by this registry. Revisit only if a structured evidence source is identified, or a downstream use case needs a distinction DISCIPLINE + PRODUCT_FAMILY cannot already provide.',
  },
  {
    axis: 'COMMERCIAL_LEVEL',
    decision: 'DROP',
    reason:
      'Proven ~1:1 redundant with USE_CONTEXT: both would be sourced from the identical "Clasificación de Uso" structured feature (HOME_LIGHT/HOME_REGULAR ≈ HOME_GYM, SEMI_COMMERCIAL ≈ SEMI_COMMERCIAL_STUDIO, COMMERCIAL_INTENSIVE ≈ COMMERCIAL_GYM). Keeping both would create duplicated semantics across two axes for no discriminating gain.',
  },
  {
    axis: 'COMMERCIAL_ROLE',
    decision: 'DROP',
    reason:
      "Its candidate tags are each already implied by an existing PRODUCT_FAMILY (PROTECTION_SAFETY ≈ PROTECTIVE_GEAR, FLOORING_INFRASTRUCTURE ≈ FLOORING, STORAGE_ORGANIZATION ≈ STORAGE, ACCESSORY_ATTACHMENT ≈ MACHINE_ATTACHMENT, PACK_BUNDLE ≈ the MULTI_COMPONENT_PRODUCT review flag). No full-catalog evidence for a distinct REPLACEMENT_PART population was found.",
  },
];

/** Tags that were proposed at some point in A00.1B/A00.1C and explicitly rejected, kept as a permanent record. */
export const rejectedOntologyTags: readonly RejectedOntologyTag[] = [
  {
    axis: 'DISCIPLINE',
    code: 'WEIGHTLIFTING',
    reason:
      '"Categoría: Olímpico/Preolímpico" is a technical sleeve-diameter specification (the IWF-standard equipment dimension shared by CrossFit, Powerlifting, and general-strength bars/plates alike), not a reliable signal that a product is positioned for the sport of competitive Weightlifting. Full-catalog validation (A00.1C) found it on 216/2011 products — 55% of all BARBELL+WEIGHT_PLATE SKUs, 10.7% of the entire catalog — under the rule proposed in A00.1B. Direct reading of sampled product descriptions (e.g. a beginner "Eco Serie" bar explicitly marketed for entrenamientos básicos/usuarios principiantes) confirmed this was a technical-spec false positive, not real discipline signal. No alternative reliable evidence source was found. Do not resurrect this tag without a new, non-technical-spec evidence source (e.g. a genuine "Halterofilia"/competition-line category or explicit name text, neither of which currently exists in this catalog).',
  },
  {
    axis: 'DISCIPLINE',
    code: 'FUNCTIONAL_TRAINING',
    reason:
      'Zero golden-set or full-catalog products qualify under an explicit-name or SEMANTIC_STRONG-category evidence rule, despite the golden set being stratified to include functional/conditioning theme coverage. The only supporting category evidence ("Funcional", "Gimnasia & Funcional") is SEMANTIC_WEAK/CAMPAIGN-trust — too broad to support a reliable rule.',
  },
  {
    axis: 'DISCIPLINE',
    code: 'BODYBUILDING',
    reason: 'Zero golden-set or full-catalog products qualify; no category or structured feature in either trust map maps to this concept.',
  },
  {
    axis: 'USE_CONTEXT',
    code: 'CROSSFIT_BOX',
    reason:
      'Zero golden-set or full-catalog products qualify for CROSSFIT_BOX as a distinct facility use-context beyond COMMERCIAL_GYM/DISCIPLINE:CROSSFIT. A CrossFit box is adequately represented by DISCIPLINE:CROSSFIT + USE_CONTEXT:COMMERCIAL_GYM without a dedicated facility tag.',
  },
  {
    axis: 'PRODUCT_FAMILY',
    code: 'PACK_SET',
    reason:
      'Every pack/set product in the golden set is more usefully described by its underlying family (e.g. a pack of resistance bands is BAND_SUSPENSION); a separate PACK_SET family would duplicate the family axis for every bundled SKU. Kept only as a review-time MULTI_COMPONENT_PRODUCT flag for genuine cross-family bundles, not a registry tag.',
  },
  {
    axis: 'PRODUCT_FAMILY',
    code: 'BOXING_MMA',
    reason:
      'BOXING_MMA was a candidate for both PRODUCT_FAMILY and DISCIPLINE. Every boxing/MMA product observed is a physical object already covered by another family (gloves/wraps = PROTECTIVE_GEAR, tatami = FLOORING). Kept only as a DISCIPLINE tag layered on top of the physical family.',
  },
];
