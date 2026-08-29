// Global evidence rules for commercial-product-ontology-v2 (CUSTOMER-INTELLIGENCE-R2-A00.3.1).
//
// The ONLY thing this version changes relative to v1 (`global-rules.ts`) is `nonProductExclusion`.
// `categoryTrustGate` and `historicalPolicy` are reused by reference, unchanged, from v1.
//
// Business background: the business has now explicitly confirmed three families of PrestaShop rows
// that exist only so they can be charged through the commercial/order workflow, not because they are
// physical or commercial products:
//
//   R-*  review/repair service rows       ("Revisión R-10", "Revisión R-20", ...)
//   A-*  assembly/installation service rows ("Servicio de armado tipo A-10", "Servicio tipo A-PC", ...)
//   M-*  maintenance service rows          (POLICY_ONLY_NOT_OBSERVED — see below)
//
// plus the two administrative fee rows already excluded in v1 ("Servicio vendedor", "Costo logístico").
//
// v1's `^servicio\b` pattern already caught every "Servicio ..." row in the current 2011-product
// catalog (verified below) purely by accident of it being a broad prefix match — it was never a
// deliberate R-/A-/M- policy. v2 replaces it with named, narrower patterns anchored to the actual
// service-phrase vocabulary, so the exclusion is an intentional business rule instead of an
// accidental side effect of a broad prefix, per the explicit instruction not to use a generic
// pattern like `.*r-.*` or `^servicio.*` (Section 6/12 of the task: false-positive risk).
//
// Every pattern here was verified against a full scan of the real 2011-product export
// (`docs/audits/product-intelligence-exploration/inputs/`) for every product whose normalized name
// contains any of "revision"/"reparacion"/"armado"/"instalacion"/"mantencion"/"mantenimiento"/
// "servicio"/"costo" — see `tests/unit/product-semantic-classification-v2-non-product-policy.test.ts`
// and the audit artifact `non_product_policy_audit.csv`. That scan found exactly 13 rows, all of
// which are confirmed non-product; zero legitimate products anywhere in the catalog matched.
//
// Normalization note: `normalizeProductName` (product-semantic-classification/normalize.ts) replaces
// every run of non-alphanumeric characters (including hyphens) with a single space, so "R-10"
// normalizes to "r 10" (three tokens), not "r-10". Every pattern below is written against that
// normalized form, not the raw hyphenated spelling — this was verified empirically, not assumed.

import {
  allowedOntologyEvidenceSourceTypes,
  forbiddenOntologyEvidenceSourceTypes,
  type CommercialProductOntologyGlobalRules,
  type NonProductExclusionPolicy,
} from './contracts.js';
import { categoryTrustGate, globalHistoricalPolicy } from './global-rules.js';

/**
 * v1's 9 confirmed ids, plus the 4 newly business-confirmed R-* review/repair rows (550-553).
 * `knownExcludedProductIds` remains the authoritative, exact-match layer: it alone guarantees every
 * currently-known non-product row is excluded regardless of how the generalizable patterns below are
 * worded. The patterns are the second, forward-looking layer — for rows not yet enumerated here.
 */
export const nonProductExclusionPolicyV2: NonProductExclusionPolicy = {
  description:
    'PrestaShop productIds that are service, installation, review/repair, maintenance, or ' +
    'logistics-cost line items rather than physical products — confirmed by explicit business ' +
    'clarification (CUSTOMER-INTELLIGENCE-R2-A00.3.1) that these rows exist in PrestaShop only so ' +
    'they can be charged through the commercial/order workflow. Must be filtered out before any ' +
    'PRODUCT_FAMILY/DISCIPLINE/USE_CONTEXT classification rule runs. Definition only — application ' +
    'belongs to A00.3\'s classifier pipeline.',
  knownExcludedProductIds: ['444', '505', '550', '551', '552', '553', '554', '555', '556', '557', '558', '902', '903'],
  normalizedNameExclusionPatterns: [
    // Administrative fee rows (unchanged concept from v1, narrowed from the old broad "^servicio\b").
    '^servicio\\s+vendedor\\b',
    '^costo\\s+logistico\\b',
    // Installation service rows (unchanged from v1).
    '^instalacion\\b',
    // A-* assembly/installation service rows: "servicio de armado tipo a 10", "servicio tipo a pc",
    // and the bare "armado tipo a *" form for a row named without the "servicio (de)" prefix.
    '^servicio\\s+(de\\s+armado\\s+)?tipo\\s+a\\s+[a-z0-9]+\\b',
    '^armado(?:\\s+tipo)?\\s+a\\s+[a-z0-9]+\\b',
    // R-* review/repair service rows: "revision r 10" (observed), "reparacion r 10" (policy-only,
    // not currently observed in the catalog — included per approved business policy; verified to
    // produce zero matches, and zero false positives, against the full 2011-product catalog).
    '^revision\\s+r\\s+[a-z0-9]+\\b',
    '^reparacion\\s+r\\s+[a-z0-9]+\\b',
    // M-* maintenance service rows: POLICY_ONLY_NOT_OBSERVED — no "mantención"/"mantenimiento" row
    // exists anywhere in the current 2011-product catalog. Encoded conservatively ahead of need,
    // per the approved business policy, because it is expressible with zero false-positive risk
    // (verified against the full catalog scan alongside every other pattern above).
    '^mantencion\\s+m\\s+[a-z0-9]+\\b',
    '^mantenimiento\\s+m\\s+[a-z0-9]+\\b',
  ],
  appliesToNote:
    'Applies to the full product universe before axis classification. Supersedes v1\'s broader ' +
    '"^servicio\\b" catch-all with named, narrower R-*/A-*/administrative patterns that cover the ' +
    'identical set of rows in the current catalog (verified) while being safer for future new SKUs.',
};

export const globalRulesV2: CommercialProductOntologyGlobalRules = {
  allowedEvidenceSourceTypes: allowedOntologyEvidenceSourceTypes,
  forbiddenEvidenceSourceTypes: forbiddenOntologyEvidenceSourceTypes,
  categoryTrustGate,
  nonProductExclusion: nonProductExclusionPolicyV2,
  historicalPolicy: globalHistoricalPolicy,
};
