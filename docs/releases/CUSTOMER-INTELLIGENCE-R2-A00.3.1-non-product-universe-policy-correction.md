# CUSTOMER-INTELLIGENCE-R2-A00.3.1 — Non-Product Universe Policy Correction

Status: **READY**
Type: ontology-registry maintenance (new version, v1 untouched) + deterministic classifier revalidation.

Previous registry: `commercial-product-ontology-v1`, hash `df58006b9a68f056a36988ff2c178a5084fe6400fd3f6abe96091472f9969009`
New registry: `commercial-product-ontology-v2`, hash `cbf363d31fc7fb6f99f9597e5c4545a75812db9e008205d9820d61391edbe212`

## 1. Business clarification

The business has explicitly confirmed that a specific class of PrestaShop "products" are not physical
or commercial products at all: they exist in PrestaShop only so they can be charged through the
commercial/order workflow. Three coded families were identified:

- **R-\*** — review/repair service rows (e.g. `"Revisión R-10"`)
- **A-\*** — assembly/installation service rows (e.g. `"Servicio de armado tipo A-10"`, `"Servicio tipo A-PC"`)
- **M-\*** — maintenance service rows (business policy confirmed; **no such row exists yet** in the
  current 2011-product catalog — see Section 5)

plus the two administrative fee rows already excluded in v1 (`"Servicio vendedor"`, `"Costo logístico"`).

These rows must be `EXCLUDED_NON_PRODUCT` — not `OTHER` (a real product with no supported family fit),
not any `PRODUCT_FAMILY`/`DISCIPLINE`/`USE_CONTEXT` tag. The required pipeline order is unchanged and
reaffirmed: **raw catalog universe → non-product exclusion → semantic product universe →
PRODUCT_FAMILY → DISCIPLINE → USE_CONTEXT.** A00.3 already implemented this order exactly (exclusion
runs before any semantic rule); this slice only changes *which* rows the exclusion recognizes.

## 2. Versioning: v1 is never mutated

`commercial-product-ontology-v1` is byte-for-byte unchanged — its computed hash is identical to before
this slice (`df58006b...`, verified in `product-semantic-classification-v2-non-product-policy.test.ts`).
`commercial-product-ontology-v2` is a new, separately-published, permanently immutable version:

- Same 3 active axes (`PRODUCT_FAMILY`, `DISCIPLINE`, `USE_CONTEXT`).
- Same 21 `PRODUCT_FAMILY` + `OTHER`, 8 `DISCIPLINE`, 6 `USE_CONTEXT` — 35 real tags, 36 including `OTHER`.
- **v1 and v2 literally share the same tag/axis object references** (`v2.tags === v1.tags`,
  `v2.axes === v1.axes`) — not merely equal by value. This is the strongest guarantee available that
  tag codes, definitions, confidence policy, evidence policy, category trust gate, historical policy,
  and deferred/dropped axes are unchanged: the exact same frozen objects are reused, so there is no code
  path by which they could have silently drifted between versions.
- The **only** field that differs is `globalRules.nonProductExclusion`.

`registry.ts` builds both `canonicalRegistryV1` and `canonicalRegistryV2` at module load and validates
both with the same startup validator. `getCommercialProductOntologyRegistry()` (no argument) still
returns v1 — the exact pre-existing call signature and behavior from A00.2 — so nothing that already
consumed the zero-arg form regressed. `getCommercialProductOntologyRegistry('commercial-product-ontology-v2')`
or the convenience `getCommercialProductOntologyRegistryV2()` returns v2.

## 3. Why v1's `^servicio\b` pattern already "worked" — and why that wasn't good enough

v1's `nonProductExclusion.normalizedNameExclusionPatterns` included a broad `^servicio\b`, which
happened to also catch `"Servicio de armado tipo A-10"` (ids 554-557) and `"Servicio tipo A-PC"`
(id 558) as a side effect of being a prefix match on the word "servicio" — not because anyone had
designed an A-\* assembly-service rule. That is exactly the false-positive risk the business asked this
slice to close off: a future legitimate product literally named `"Servicio de Instalación Premium"`
(a real installation *product*, not a fee line item) would have been silently excluded too. v2 replaces
the single broad pattern with **named, narrower patterns anchored to the actual confirmed service
vocabulary** — the business rule is now explicit and auditable instead of an accidental side effect of
prefix-matching one common word.

## 4. Non-product policy: two-layer defense

Per the task's explicit instruction not to rely on ids alone (new service rows will be created later)
or on broad regexes alone (legitimate products must never be caught):

- **Layer 1 — `knownExcludedProductIds`** (exact, defensive): v1's 9 ids plus the 4 newly
  business-confirmed R-\* ids — `444, 505, 550, 551, 552, 553, 554, 555, 556, 557, 558, 902, 903`
  (13 total). This alone guarantees every currently-known non-product row stays excluded regardless of
  how the patterns below are worded.
- **Layer 2 — `normalizedNameExclusionPatterns`** (generalizable, forward-looking): anchored patterns
  that would also catch a *future* new row of the same shape without needing a registry edit.

Every pattern below was verified against the real 2011-product catalog (not assumed) — see Section 8.
**Normalization detail that mattered**: `normalizeProductName` replaces every run of non-alphanumeric
characters, hyphens included, with a single space, so `"R-10"` normalizes to `"r 10"` (three tokens),
not `"r-10"`. Every pattern is written against that normalized form:

```
^servicio\s+vendedor\b                                    administrative fee (444)
^costo\s+logistico\b                                      administrative fee (505)
^instalacion\b                                            installation service (902, 903) — unchanged from v1
^servicio\s+(de\s+armado\s+)?tipo\s+a\s+[a-z0-9]+\b        A-* assembly service (554-558, incl. non-numeric "A-PC")
^armado(?:\s+tipo)?\s+a\s+[a-z0-9]+\b                      A-* without the "servicio (de)" prefix (policy-only variant)
^revision\s+r\s+[a-z0-9]+\b                                R-* review/repair service (550-553)
^reparacion\s+r\s+[a-z0-9]+\b                              R-* alternate vocabulary (policy-only variant)
^mantencion\s+m\s+[a-z0-9]+\b                              M-* maintenance service (POLICY_ONLY_NOT_OBSERVED)
^mantenimiento\s+m\s+[a-z0-9]+\b                           M-* alternate vocabulary (POLICY_ONLY_NOT_OBSERVED)
```

No pattern is a generic catch-all like `.*r-.*` or a bare `^servicio\b` — every one requires the actual
service-phrase opener (`"revision r"`, `"reparacion r"`, `"servicio ... tipo a"`, `"armado tipo a"`,
`"mantencion/mantenimiento m"`) before the code suffix, exactly as the task required.

## 5. R-* / A-* / M-* — observed vs policy-only

A full scan of the real 2011-product catalog for every product whose normalized name contains
`revision`, `reparacion`, `armado`, `instalacion`, `mantencion`, `mantenimiento`, `servicio`, or `costo`
as a whole word found **exactly 13 rows** — the same 13 that end up excluded, with zero ambiguous or
borderline cases:

| Family | Status | Rows found |
| --- | --- | --- |
| R-\* (`revision`) | **OBSERVED_AND_VALIDATED** | 550-553 (`"Revisión R-10"`...`"R-40"`) |
| R-\* (`reparacion`) | POLICY_ONLY_NOT_OBSERVED | 0 |
| A-\* (`armado`/`servicio ... tipo a`) | **OBSERVED_AND_VALIDATED** | 554-558 |
| M-\* (`mantencion`/`mantenimiento`) | POLICY_ONLY_NOT_OBSERVED | 0 |
| Administrative (`servicio vendedor`, `costo logistico`) | **OBSERVED_AND_VALIDATED** | 444, 505 |
| Installation (`instalacion`) | **OBSERVED_AND_VALIDATED** | 902, 903 |

The M-\* and `reparacion` R-\* patterns are included per the approved business policy even though
nothing in the current catalog exercises them — they are conservative, forward-looking encodings, not
speculation: each was verified to add **zero** matches and therefore **zero** false-positive risk
against the full catalog (Section 8).

## 6. Full audit table

See `non_product_policy_audit.csv` (generated by
`npm run product:semantic:v2-migration-audit`) for the complete table: `productId`, `productName`,
`normalizedName`, `matchedRule`, `businessType` (`ADMINISTRATIVE_FEE` / `INSTALLATION_SERVICE` /
`ASSEMBLY_SERVICE` / `REVIEW_REPAIR_SERVICE`), `previousStatus` (v1), `newStatus` (v2), `decision`,
`notes`. All 13 matched rows have `decision = EXCLUDED`; no row was found matching a discovery keyword
without also matching an approved pattern (i.e. nothing was "fuzzy-matched" into exclusion — Section 11's
explicit instruction not to auto-expand policy based on similarity alone).

## 7. Classifier compatibility (Section 15)

`src/domain/product-semantic-classification/classifier.ts`'s only change: its cached registry lookup
now requests `commercial-product-ontology-v2` instead of relying on the default (which stayed v1). No
`PRODUCT_FAMILY`/`DISCIPLINE`/`USE_CONTEXT` rule changed. `classifyProduct`/`classifyProducts` gained an
optional `registryVersion` parameter (defaulting to v2) so v1-vs-v2 comparison tooling can reuse the
exact same classifier against either registry rather than duplicating logic — this is the one new
capability, not a semantic-rule change.

## 8. False-positive validation (Section 12)

Every one of the 9 patterns above was tested against all 2011 products in the real export:

```
matchedRows:         13
confirmedServices:   13
falsePositiveProducts: 0
```

Every one of the 13 known-excluded ids is independently matched by name pattern too (not just the id
layer) — full redundancy between both defense layers. **Acceptance requirement met: 0 false positives.**

## 9. Full-catalog v1 vs v2 re-run

`npm run product:semantic:v2-migration-audit` classifies all 2011 products under both registries and
diffs per product (`product_semantic_v1_v2_diff.csv`):

| changeType | Count |
| --- | ---: |
| `UNCHANGED` | 2007 |
| `OTHER_TO_EXCLUDED_NON_PRODUCT` | 4 (ids 550, 551, 552, 553 — exactly the newly-confirmed R-\* rows) |
| `CLASSIFIED_TO_EXCLUDED_NON_PRODUCT` | 0 |
| `PARTIAL_TO_EXCLUDED_NON_PRODUCT` | 0 |
| `UNEXPECTED_SEMANTIC_CHANGE` | **0** |

Zero `UNEXPECTED_SEMANTIC_CHANGE` rows means every real physical product's `PRODUCT_FAMILY`,
`DISCIPLINE`, and `USE_CONTEXT` tags are byte-for-byte identical between v1 and v2 — confirmed both by
this full-catalog diff and by a dedicated unit test that classifies the same real-product fixtures
under both registry versions and asserts equality.

## 10. Status counts

| | v1 | v2 | Δ |
| --- | ---: | ---: | ---: |
| `sourceProductCount` | 2011 | 2011 | 0 |
| `CLASSIFIED` | 1246 | 1246 | 0 |
| `PARTIALLY_CLASSIFIED` | 397 | 397 | 0 |
| `OTHER` | 359 | 355 | **-4** |
| `EXCLUDED_NON_PRODUCT` | 9 | 13 | **+4** |
| `NEEDS_REVIEW` | 0 | 0 | 0 |
| semantic universe (`sourceProductCount - EXCLUDED_NON_PRODUCT`) | 2002 | 1998 | -4 |

Exactly the expected business effect: 4 rows move from `OTHER` (previously misclassified as "a real
product we can't tag") to the more accurate `EXCLUDED_NON_PRODUCT`; every other status count is
unchanged.

## 11. Golden-set regression

Re-run against all 200 `ontology_review_closure.csv` rows under v2 (none of ids 550-553 are golden-set
members, so no change was expected or observed):

- `PRODUCT_FAMILY`: 199/200 (same one documented exception as A00.3 — id 2134's secondary
  `CABLE_MACHINE` tag, which requires forbidden free-text-description evidence; **not** touched by this
  slice, per its explicit scope boundary).
- `DISCIPLINE`: 200/200, unchanged.
- `USE_CONTEXT`: 200/200, unchanged.

## 12. Determinism

`f1a4ffb8d74388dbffc2ee3e9be5020a9cac8e6516cb2c1d11ff831a95502ed1` — the full-catalog classification
checksum under v2, confirmed identical across repeated runs (both via the CLI and in a dedicated unit
test). The v2 **registry** hash (`cbf363d3...`) is separately deterministic and differs from v1's
(`df58006b...`) — both verified by repeated calls in tests.

## 13. Output artifacts

Generated by `npm run product:semantic:v2-migration-audit` (alongside the unchanged
`npm run product:semantic:classify` artifacts, now reflecting v2 by default):

- `non_product_policy_audit.csv` — the full non-product discovery/decision table (Section 6).
- `product_semantic_v1_v2_diff.csv` — one row per product, v1 vs v2 status/tags/changeType (Section 9).
- `product_semantic_v2_summary.json` — registry versions/hashes, status counts, delta vs v1, change
  counts, `falsePositiveExclusions` (empty array), `unexpectedSemanticChanges` (empty array), checksum.

## 14. Tests

`tests/unit/product-semantic-classification-v2-non-product-policy.test.ts` (38 tests): registry
invariants (v1 hash unchanged, v2 hash deterministic and different, shared tag/axis object identity,
unchanged category-trust/evidence/historical policy, WEIGHTLIFTING still absent), anchored-pattern
safety, R-\*/A-\*/M-\*/administrative exclusion (including the policy-only variants), legitimate
lookalike products correctly NOT excluded, all 13 v2 ids individually re-verified, zero tags on excluded
rows, real-product v1-vs-v2 semantic equality, and a full-catalog false-positive check
(`falsePositiveProducts = 0`) plus a raw discovery-keyword scan confirming exactly the 13 known rows.
Two pre-existing A00.3 tests were updated to reflect the classifier's new v2-by-default consumption and
the 13-id (not 9-id) exclusion set — both changes are the direct, intended consequence of this slice,
not regressions.

## 15. What this slice does NOT change

- No semantic tag was added, removed, or redefined on any axis.
- `PRODUCT_FAMILY`/`DISCIPLINE`/`USE_CONTEXT` definitions, evidence rules, and confidence policy: unchanged.
- The `OTHER` population's ontology debt (LASTRE/weighted-vest cluster, apparel vocabulary gaps, etc.,
  documented in A00.3) was not touched — no new family was created.
- id 2134's documented `CABLE_MACHINE` secondary-family mismatch was not "fixed"; free-text description
  evidence remains forbidden.
- No SQL persistence, snapshot publication, customer affinity, UI/API, PrestaShop connection, or LLM use
  was added anywhere.

## 16. Validation run

```
npm run typecheck                                          → clean, 0 errors
npx vitest run (full suite)                                 → 196 test files, 1889 tests, all passing (0 regressions; 38 new)
npm run product:semantic:classify                           → 2011 products, statusCounts includes EXCLUDED_NON_PRODUCT=13
npm run product:semantic:v2-migration-audit                  → falsePositiveExclusions=0, unexpectedSemanticChanges=0
golden-set regression (200/200 ontology_review_closure.csv)  → 199/200 FAMILY (1 documented exception), 200/200 DISCIPLINE, 200/200 USE_CONTEXT
```
