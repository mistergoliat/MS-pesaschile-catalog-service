// DISCIPLINE axis: 8 tags. Source: ontology_registry_candidate_v1.json, validated in
// CUSTOMER-INTELLIGENCE-R2-A00.1C-ontology-review-closure.md Section 7.
//
// WEIGHTLIFTING is deliberately absent. See `rejectedOntologyTags` in registry.ts for the permanent
// design record: "CategorÃ­a: OlÃ­mpico/PreolÃ­mpico" is a technical sleeve-diameter specification (the
// IWF-standard equipment dimension shared by CrossFit, Powerlifting, and general-strength bars/plates
// alike), not a reliable signal that a product is positioned for the sport of competitive Weightlifting.
// A00.1C found it on 216/2011 products (55% of all BARBELL+WEIGHT_PLATE SKUs) once validated at
// full-catalog scale, and direct reading of sampled product descriptions confirmed the same SKUs are
// marketed equally for CrossFit/functional training/general strength. Do not resurrect this tag without
// a new, non-technical-spec evidence source.

import type { CommercialProductOntologyTag } from './contracts.js';

export const disciplineTags: readonly CommercialProductOntologyTag[] = [
  {
    axis: 'DISCIPLINE',
    code: 'CROSSFIT',
    labelEs: 'CrossFit',
    definition: 'Explicit CrossFit positioning.',
    positiveEvidence: ['literal "CrossFit"/"WOD" in name'],
    negativeEvidence: [
      '"CrossFit HWMÂ®" brand/collection category alone (LEGACY-trust, excluded)',
      'free-text description mentioning CrossFit as one of several generic uses',
    ],
    allowedEvidenceSources: ['NAME_TEXT'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT'],
      notes:
        'Full-catalog validated: 19/2011 matches, all precise, zero false positives. Commercial caveat: 0 of the 19 are currently-active products (18 discontinued packs/apparel + 1 historical) â€” retrospective value only until new CrossFit-branded SKUs are added.',
    },
    historicalPolicy: { classifiableFromNameOnly: true, notes: 'Classify from name only when explicit.' },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'DISCIPLINE',
    code: 'HYROX',
    labelEs: 'HYROX',
    definition: 'Explicit HYROX positioning.',
    positiveEvidence: ['trusted "HYROX" category', 'literal name'],
    negativeEvidence: [],
    allowedEvidenceSources: ['NAME_TEXT', 'TRUSTED_CATEGORY'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT'],
      notes: 'Full-catalog: 27/2011, all active, all explicit, zero false positives found.',
    },
    historicalPolicy: { classifiableFromNameOnly: true, notes: 'Classify from name only when explicit.' },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'DISCIPLINE',
    code: 'POWERLIFTING',
    labelEs: 'Powerlifting',
    definition: 'Powerlifting-specific gear.',
    positiveEvidence: ['trusted category (Powerlifting, Discos de Powerlifting, Barras Powerlifting, Powerlifting Racks)', 'literal name'],
    negativeEvidence: ['generic strength equipment'],
    allowedEvidenceSources: ['NAME_TEXT', 'TRUSTED_CATEGORY'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT'],
      notes: 'Full-catalog: 38/2011, zero false positives found (distinct XMASTER-branded product line).',
    },
    historicalPolicy: { classifiableFromNameOnly: true, notes: 'Classify from name only when explicit (e.g. "Discos Powerlifting Chromed Steel").' },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'DISCIPLINE',
    code: 'CALISTHENICS',
    labelEs: 'Calistenia',
    definition: 'Bodyweight/gymnastics training.',
    positiveEvidence: ['trusted "Calistenia" category', 'literal name', 'family=BODYWEIGHT_GYMNASTICS'],
    negativeEvidence: ['barbell/rack products'],
    allowedEvidenceSources: ['NAME_TEXT', 'TRUSTED_CATEGORY', 'FAMILY_INFERENCE'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT', 'STRONGLY_INFERRED'],
      notes:
        'EXPLICIT by name/category; STRONGLY_INFERRED by family â€” validated sound because BODYWEIGHT_GYMNASTICS (66/2011, 3.3% of catalog) is a narrow, single-discipline family, unlike BARBELL/WEIGHT_PLATE.',
    },
    historicalPolicy: {
      classifiableFromNameOnly: true,
      notes: 'Classify from name only when explicit; family-based inference requires current-catalog category data (unavailable for historical-only rows).',
    },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'DISCIPLINE',
    code: 'CARDIO_ENDURANCE',
    labelEs: 'Cardio y Resistencia',
    definition: 'Cardio/endurance training.',
    positiveEvidence: ['family=CARDIO_MACHINE'],
    negativeEvidence: ['functional conditioning tools (sleds, balls) that are not literally cardio machines'],
    allowedEvidenceSources: ['FAMILY_INFERENCE'],
    confidencePolicy: {
      allowedConfidenceLevels: ['STRONGLY_INFERRED'],
      notes: 'Validated sound â€” CARDIO_MACHINE (73/2011, 3.6% of catalog) is narrow and tautologically cardio-purposed, unlike the WEIGHTLIFTING case.',
    },
    historicalPolicy: {
      classifiableFromNameOnly: true,
      notes: 'Classify from name only when the name itself identifies a cardio machine (e.g. "Trotadora", "Bicicleta de Spinning").',
    },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'DISCIPLINE',
    code: 'YOGA_PILATES',
    labelEs: 'Yoga y Pilates',
    definition: 'Yoga/Pilates practice.',
    positiveEvidence: ['trusted "Yoga & Pilates" category', 'literal name'],
    negativeEvidence: ['generic mats/flooring'],
    allowedEvidenceSources: ['NAME_TEXT', 'TRUSTED_CATEGORY'],
    confidencePolicy: { allowedConfidenceLevels: ['EXPLICIT'], notes: 'Full-catalog: 17/2011, zero false positives.' },
    historicalPolicy: { classifiableFromNameOnly: true, notes: 'Classify from name only when explicit.' },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'DISCIPLINE',
    code: 'BOXING_MMA',
    labelEs: 'Boxeo y MMA',
    definition: 'Boxing/martial arts training.',
    positiveEvidence: ['trusted "Boxeo & MMA" category', 'literal name'],
    negativeEvidence: ['generic conditioning gloves'],
    allowedEvidenceSources: ['NAME_TEXT', 'TRUSTED_CATEGORY'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT'],
      notes: 'Full-catalog: 13/2011, all active, zero false positives (gloves/wraps/vendas confirmed genuine boxing gear).',
    },
    historicalPolicy: { classifiableFromNameOnly: true, notes: 'Classify from name only when explicit.' },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'DISCIPLINE',
    code: 'REHABILITATION',
    labelEs: 'RehabilitaciÃ³n',
    definition: 'Clinical/therapeutic use.',
    positiveEvidence: ['literal clinical wording in name', 'family=RECOVERY_TOOL + dedicated clinical-device category (CÃ¡maras HiperbÃ¡ricas, Presoterapia)'],
    negativeEvidence: [
      'generic recovery tools (foam rollers) without clinical positioning',
      'free-text description mentioning rehab as one of several generic uses',
    ],
    allowedEvidenceSources: ['NAME_TEXT', 'TRUSTED_CATEGORY', 'FAMILY_INFERENCE'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT', 'STRONGLY_INFERRED'],
      notes:
        'Full-catalog: 4/2011, all active, all genuine (O2Life hyperbaric chambers + compression boots â€” single-brand niche, small but real and commercially coherent).',
    },
    historicalPolicy: { classifiableFromNameOnly: true, notes: 'Classify from name only when explicit; category-gated inference requires current-catalog data.' },
    status: 'ACTIVE',
    residual: false,
  },
];
