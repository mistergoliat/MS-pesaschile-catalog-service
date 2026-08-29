# CATALOG-INTELLIGENCE-A00.4 - Classification Acceptance & Quality Gate

Status: **ACCEPTED WITH DEBT**
Audit date: **2026-08-29**
Production runtime changed: **NO**

## 1. Scope

This gate re-audits whether the semantic facts produced by `MS-pesaschile-catalog-service` are
trustworthy enough to persist in A00.5 as durable product truth.

It does not change:

- production runtime wiring
- SearchProducts V2 behavior
- relationship logic
- `customer-profile`

## 2. Current ontology

- registry version: `commercial-product-ontology-v3`
- registry hash: `f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955`
- active axes: `PRODUCT_FAMILY`, `DISCIPLINE`, `USE_CONTEXT`

Allowed evidence sources:

- `NAME_TEXT`
- `TRUSTED_CATEGORY`
- `STRUCTURED_FEATURE`
- `FAMILY_INFERENCE`

Forbidden evidence sources:

- `FREE_TEXT_DESCRIPTION`
- `CAMPAIGN_CATEGORY`
- `NAVIGATION_CATEGORY`
- `LEGACY_CATEGORY`
- `UNKNOWN_CATEGORY`
- `NOISE_FEATURE`
- `PRESENTATION_FEATURE`
- `LOGISTICS_FEATURE`
- `SAMPLING_METADATA`

## 3. Source universe

- source products: `2011`
- semantic universe: `1998`
- excluded non-products: `13`

## 4. Classification distribution

- `CLASSIFIED`: `1281`
- `PARTIALLY_CLASSIFIED`: `400`
- `OTHER`: `317`
- `EXCLUDED_NON_PRODUCT`: `13`
- `NEEDS_REVIEW`: `0`

## 5. Golden set

- `PRODUCT_FAMILY`: `200/200`
- `DISCIPLINE`: `200/200`
- `USE_CONTEXT`: `200/200`

## 6. OTHER audit

The `OTHER` population was regrouped deterministically on Saturday, August 29, 2026.

- `OTHER_AUDIT_TOTAL`: `317`
- `OTHER_LEGITIMATE_RESIDUAL`: `138`
- `OTHER_EVIDENCE_GAP`: `136`
- `OTHER_POSSIBLE_CLASSIFIER_DEFECT`: `0`
- `OTHER_POSSIBLE_ONTOLOGY_GAP`: `39`
- `OTHER_POSSIBLE_NON_PRODUCT_LEAKAGE`: `0`
- `OTHER_DATA_QUALITY`: `4`

Sub-buckets:

- `HISTORICAL_NAME_ONLY`: `61`
- `BUNDLE_DEFERRED`: `90`
- `NON_EQUIPMENT_MISC`: `48`
- `CURRENT_SPARSE_EVIDENCE`: `75`
- `CURRENT_EXISTING_FAMILY_MISS`: `0`
- `CURRENT_UNMODELED_PRODUCT`: `39`
- `SERVICE_LIKE`: `0`
- `TEST_OR_DISABLED`: `4`

Interpretation:

- no active existing-family false-negative cluster remains;
- pack residuals remain intentional;
- remaining debt is concentrated in unmodeled conditioning/accessory concepts, historical-only rows,
  and low-volume data-quality noise.

## 7. Partial classification audit

All `400` `PARTIALLY_CLASSIFIED` rows are `historical_order_detail_only`.

Pattern split:

- `FAMILY_ONLY`: `342`
- `FAMILY_PLUS_DISCIPLINE`: `49`
- `FAMILY_PLUS_USE_CONTEXT`: `7`
- `FAMILY_PLUS_BOTH`: `2`

This remains acceptable because current-catalog precision is prioritized over historical coverage,
and historical rows are name-limited by contract.

## 8. Positive false-positive audit

Reviewed sample count: `31`

Explicitly rechecked:

- targeted guarded cable v3 ids: `1021`, `1207`, `1430`, `1444`, `1445`, `1450`, `1451`, `1922`,
  `2133`, `2134`, `2182`
- cable structured-rule ids actually emitted: `1021`, `1207`, `1430`, `1444`, `1445`, `1450`,
  `1451`, `1922`, `2134`, `2182`

Outcome:

- negative control `2133` remained unchanged: `true`
- documented hybrid `2134` remained bounded
- no new material positive false positives were identified in the current gate sample

## 9. Provenance audit

- semantic facts with rule provenance: `100%`
- semantic facts with evidence provenance: `100%`
- results with ontology version: `100%`
- results with ontology hash: `100%`
- semantic facts with deterministic source references: `100%`
- orphan evidence records: `0`
- silent semantic facts: `0`
- snapshot blocking from provenance: `false`

## 10. Evidence compliance

- evidence violations: `0`
- forbidden evidence violations: `0`
- missing source reference violations: `0`
- rule-contract violations: `0`
- cable-machine v3 rule violations: `0`

## 11. Reproducibility

Repeated runs on Saturday, August 29, 2026 were byte-identical.

- expected checksum: `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e`
- run 1 checksum: `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e`
- run 2 checksum: `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e`
- checksums identical: `true`
- counts identical: `true`
- registry hash identical: `true`
- result ordering identical: `true`
- output byte identical: `true`

## 12. Coverage by population

ACTIVE:

- source products: `889`
- classified: `800`
- partially classified: `0`
- other: `82`
- excluded: `7`

INACTIVE:

- source products: `661`
- classified: `481`
- partially classified: `0`
- other: `174`
- excluded: `6`

HISTORICAL_ONLY:

- source products: `461`
- classified: `0`
- partially classified: `400`
- other: `61`
- excluded: `0`

## 13. Commercial-weighted coverage

Overall:

- `CLASSIFIED`: `89.56%` of revenue, `85.83%` of valid orders
- `OTHER`: `6.49%` of revenue, `9.39%` of valid orders
- `PARTIALLY_CLASSIFIED`: `3.67%` of revenue, `1.88%` of valid orders
- `EXCLUDED_NON_PRODUCT`: `0.28%` of revenue, `2.9%` of valid orders

Active-only:

- `CLASSIFIED`: `94.34%` of revenue, `87.07%` of valid orders
- `OTHER`: `5.27%` of revenue, `9.39%` of valid orders
- `EXCLUDED_NON_PRODUCT`: `0.39%` of revenue, `3.53%` of valid orders

## 14. Ontology debt

- `A00.4-D2`: unmodeled conditioning/accessory concepts remain in `OTHER`
  - affected products: `39`
  - affected revenue: `203366351.95`
  - snapshot blocking: `false`
- `A00.4-D3`: pack/bundle residuals intentionally deferred
  - affected products: `90`
  - affected revenue: `200920270.2`
  - snapshot blocking: `false`
- `A00.4-D4`: historical-only rows remain name-limited
  - affected products: `61`
  - affected revenue: `106119895`
  - snapshot blocking: `false`
- `A00.4-D5`: test/disabled data-quality rows remain
  - affected products: `4`
  - affected revenue: `2705371.3`
  - snapshot blocking: `false`

## 15. Acceptance criteria

- deterministic reproducibility: `PASS`
- provenance completeness: `PASS`
- evidence-source compliance: `PASS`
- positive false-positive control: `PASS`
- current catalog residual boundedness: `PASS`
- no active in-scope false-negative cluster: `PASS`

## 16. Final verdict

`PRODUCT_SEMANTIC_CLASSIFICATION_ACCEPTED_WITH_DEBT`

Rationale:

- precision remained high
- the golden set stayed perfect
- no active existing-family false-negative cluster remained
- provenance and evidence compliance stayed clean
- reproducibility is deterministic
- remaining debt is bounded and non-blocking

## 17. A00.5 readiness

A00.5 may proceed from this gate state.

Remaining debt to carry forward is explicit, auditable, and not snapshot-blocking.
