// Global evidence rules for the Commercial Product Ontology Registry (A00.2 Section 9-12).

import {
  allowedOntologyEvidenceSourceTypes,
  forbiddenOntologyEvidenceSourceTypes,
  type CategoryTrustGate,
  type CommercialProductOntologyGlobalHistoricalPolicy,
  type CommercialProductOntologyGlobalRules,
  type NonProductExclusionPolicy,
} from './contracts.js';

/**
 * Section 10: PRODUCT_FAMILY may use SEMANTIC_STRONG or SEMANTIC_WEAK trusted categories.
 * DISCIPLINE and USE_CONTEXT may use SEMANTIC_STRONG only. This gate applies only to tags that
 * declare TRUSTED_CATEGORY among their allowedEvidenceSources — a tag using only NAME_TEXT or
 * STRUCTURED_FEATURE is unaffected by it.
 */
export const categoryTrustGate: CategoryTrustGate = {
  PRODUCT_FAMILY: ['SEMANTIC_STRONG', 'SEMANTIC_WEAK'],
  DISCIPLINE: ['SEMANTIC_STRONG'],
  USE_CONTEXT: ['SEMANTIC_STRONG'],
};

/**
 * Section 11: non-product PrestaShop rows (service/installation/logistics fee line items) must be
 * excluded from classification before any rule runs. This registry only *describes* the policy —
 * application belongs to A00.3's classifier pipeline, not to this module.
 *
 * `knownExcludedProductIds` were each confirmed by direct evidence review in the A00.1C closure pass
 * (not a heuristic):
 *   444       Servicio vendedor Pesas Chile   — internal seller-service fee line item.
 *   505       Costo logistico                 — internal logistics-cost fee line item.
 *   554-558   Servicio de armado tipo A-*     — assembly-service fee line items (5 SKUs, tiers A-10..A-PC).
 *   902       INSTALACION BARRA PARED FACIL   — wall-mount installation service (confirmed to
 *                                                false-positive as PRODUCT_FAMILY:BARBELL + USE_CONTEXT:SMALL_SPACE
 *                                                before this exclusion was documented).
 *   903       INSTALACION JAULA A LA PARED    — wall-mount installation service (confirmed to
 *                                                false-positive as PRODUCT_FAMILY:RACK_CAGE + USE_CONTEXT:SMALL_SPACE).
 *
 * `normalizedNameExclusionPatterns` are regex source strings, intentionally anchored to the start of
 * the normalized (lowercased, accent-stripped) product name — never a bare substring match — so a
 * legitimate product whose description happens to mention "servicio" is never caught, only products
 * whose own name literally begins with one of these administrative terms.
 */
export const nonProductExclusionPolicy: NonProductExclusionPolicy = {
  description:
    'PrestaShop productIds that are service, installation, or logistics-cost line items rather than physical products. Must be filtered out before any PRODUCT_FAMILY/DISCIPLINE/USE_CONTEXT classification rule runs. Definition only — application belongs to A00.3.',
  knownExcludedProductIds: ['444', '505', '554', '555', '556', '557', '558', '902', '903'],
  normalizedNameExclusionPatterns: ['^servicio\\b', '^costo logistico\\b', '^instalacion\\b'],
  appliesToNote: 'Applies to the full product universe before axis classification, not only to USE_CONTEXT:SMALL_SPACE where the false positive was first found.',
};

/** Section 12: the single global historical-product policy, applied identically across all 3 axes. */
export const globalHistoricalPolicy: CommercialProductOntologyGlobalHistoricalPolicy = {
  appliesToCatalogPresence: 'historical_order_detail_only',
  productFamilyClassifiableFromNameOnly: true,
  disciplineRequiresExplicitNameEvidence: true,
  useContextRequiresExplicitNameEvidence: true,
  missingMetadataIsUnknownNotNegative: true,
  automaticSuccessorMappingAllowed: false,
  categoryOrFeatureInferenceAllowedWhenUnavailable: false,
  notes:
    'For historical_order_detail_only products: PRODUCT_FAMILY may be classified from name only when unambiguous; DISCIPLINE and USE_CONTEXT require explicit name evidence (their category/structured-feature evidence sources are unavailable for historical rows, by construction, not by choice). Missing metadata is UNKNOWN, never treated as negative evidence. No automatic mapping to a current-catalog successor product is performed, even when one is identifiable by name similarity.',
};

export const globalRules: CommercialProductOntologyGlobalRules = {
  allowedEvidenceSourceTypes: allowedOntologyEvidenceSourceTypes,
  forbiddenEvidenceSourceTypes: forbiddenOntologyEvidenceSourceTypes,
  categoryTrustGate,
  nonProductExclusion: nonProductExclusionPolicy,
  historicalPolicy: globalHistoricalPolicy,
};
