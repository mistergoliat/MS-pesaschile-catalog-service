// USE_CONTEXT axis: 6 tags. Source: ontology_registry_candidate_v1.json, validated in
// CUSTOMER-INTELLIGENCE-R2-A00.1C-ontology-review-closure.md Sections 4-6.

import type { CommercialProductOntologyTag } from './contracts.js';

export const useContextTags: readonly CommercialProductOntologyTag[] = [
  {
    axis: 'USE_CONTEXT',
    code: 'HOME_GYM',
    labelEs: 'Gimnasio en Casa',
    definition: 'Marketed/speced for home use.',
    positiveEvidence: [
      'structured feature "ClasificaciÃ³n de Uso" = Hogar tier (source A)',
      'trusted "MÃ¡quinas Home Gym" category (source B)',
      'literal "Home Gym" in name (source C)',
    ],
    // Source D â€” "a consumer could plausibly use this at home" â€” must NEVER become evidence. Confirmed
    // at full-catalog scale in A00.1C: 0 products are tagged via mere plausibility.
    negativeEvidence: ['any product an individual could merely buy or plausibly use at home, absent sources A/B/C'],
    allowedEvidenceSources: ['STRUCTURED_FEATURE', 'TRUSTED_CATEGORY', 'NAME_TEXT'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT', 'STRONGLY_INFERRED'],
      notes:
        'EXPLICIT for source A (84/92 = 91% of full-catalog matches); STRONGLY_INFERRED for sources B/C (8/92 = 9% â€” source B in particular is lower-confidence: the "MÃ¡quinas Home Gym" category is internally inconsistent, assigned to at least one plain bench). Full-catalog: 92/2011 (76 active, 11 inactive, 5 historical).',
    },
    historicalPolicy: {
      classifiableFromNameOnly: true,
      notes: 'Classify from name only when explicit (source C); structured-feature and category evidence are unavailable for historical-only rows.',
    },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'USE_CONTEXT',
    code: 'SMALL_SPACE',
    labelEs: 'Espacio Reducido',
    definition: 'Wall-mounted/foldable/compact design.',
    positiveEvidence: ['literal "de Muro"/"Plegable"/"Pared" in name'],
    negativeEvidence: [
      'ordinary home products with no compact-design evidence',
      'non-product installation-service SKUs ("INSTALACION...PARED") â€” must be excluded by the non-product exclusion policy before this rule runs; 2 confirmed false positives found in the A00.1C closure pass',
    ],
    allowedEvidenceSources: ['NAME_TEXT'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT'],
      notes: 'Full-catalog: 30/2011 confirmed real matches once the 2 non-product service SKUs are excluded per the nonProductExclusion global rule.',
    },
    historicalPolicy: { classifiableFromNameOnly: true, notes: 'Classify from name only when explicit.' },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'USE_CONTEXT',
    code: 'COMMERCIAL_GYM',
    labelEs: 'Gimnasio Comercial',
    definition: 'High-use public/commercial facility.',
    positiveEvidence: ['structured feature "ClasificaciÃ³n de Uso" = Comercial/high-indoor-traffic tier', 'literal "Comercial" in name'],
    // Explicitly verified never used: machine family/type alone (e.g. being a CARDIO_MACHINE or
    // PLATE_LOADED_MACHINE) must never by itself imply COMMERCIAL_GYM.
    negativeEvidence: ['machine family/type alone â€” confirmed in A00.1C: >99% of matches trace to the structured feature or literal name, 0% to family/machine-type inference'],
    allowedEvidenceSources: ['STRUCTURED_FEATURE', 'NAME_TEXT'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT'],
      notes: 'Full-catalog: 206/2011 (131 active, 73 inactive, 2 historical).',
    },
    historicalPolicy: { classifiableFromNameOnly: true, notes: 'Classify from name only when explicit (e.g. "Trotadora Comercial").' },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'USE_CONTEXT',
    code: 'SEMI_COMMERCIAL_STUDIO',
    labelEs: 'Studio Semi-Comercial',
    definition: 'Studio/semi-commercial tier.',
    positiveEvidence: ['structured feature "ClasificaciÃ³n de Uso" = Semi Profesional/SC tier'],
    negativeEvidence: ['full commercial or home-only tier'],
    allowedEvidenceSources: ['STRUCTURED_FEATURE'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT'],
      notes:
        'Full-catalog: 13/2011 (11 active, 2 inactive) â€” upgraded confidence vs. the golden-set-only view (n=1); confirmed commercially coherent (treadmills, cable machines, spin bikes, racks, air machines).',
    },
    historicalPolicy: {
      classifiableFromNameOnly: false,
      notes: 'Structured-feature evidence is unavailable for historical-only rows; no historical SEMI_COMMERCIAL_STUDIO tags exist.',
    },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'USE_CONTEXT',
    code: 'CLINICAL_RECOVERY',
    labelEs: 'RecuperaciÃ³n ClÃ­nica',
    definition: 'Clinic/therapy context.',
    positiveEvidence: ['literal clinical wording in name', 'dedicated clinical-device category (CÃ¡maras HiperbÃ¡ricas, Presoterapia)'],
    negativeEvidence: ['ordinary recovery accessories'],
    allowedEvidenceSources: ['NAME_TEXT', 'TRUSTED_CATEGORY'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT', 'STRONGLY_INFERRED'],
      notes: 'Full-catalog: 4/2011, all active, single-brand (O2Life) niche â€” small but real.',
    },
    historicalPolicy: { classifiableFromNameOnly: true, notes: 'Category evidence is unavailable for historical-only rows; name-only evidence still applies when explicit.' },
    status: 'ACTIVE',
    residual: false,
  },
  {
    axis: 'USE_CONTEXT',
    code: 'OUTDOOR_HIGH_TRAFFIC',
    labelEs: 'Alto TrÃ¡fico Exterior',
    definition: 'Outdoor/high-traffic-rated.',
    positiveEvidence: ['structured feature "ClasificaciÃ³n de Uso" = "interiores y exteriores"'],
    negativeEvidence: ['indoor-only high-traffic (folded into COMMERCIAL_GYM)'],
    allowedEvidenceSources: ['STRUCTURED_FEATURE'],
    confidencePolicy: {
      allowedConfidenceLevels: ['EXPLICIT'],
      notes:
        'Full-catalog: 3/2011, all active â€” note this reduces to 1 distinct product design (a thicker outdoor-rated rubber tile) sold in 3 pack-size SKUs, not 3 independent products.',
    },
    historicalPolicy: {
      classifiableFromNameOnly: false,
      notes: 'Structured-feature evidence is unavailable for historical-only rows; no historical OUTDOOR_HIGH_TRAFFIC tags exist.',
    },
    status: 'ACTIVE',
    residual: false,
  },
];
