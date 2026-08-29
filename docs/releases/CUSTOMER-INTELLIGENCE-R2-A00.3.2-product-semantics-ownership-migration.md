# CUSTOMER-INTELLIGENCE-R2-A00.3.2 — Product Semantics Ownership Migration

Status: **READY**
Type: ownership migration (behavioral equivalence, not a redesign or rewrite).

Source repo: `MS-pesaschile-customer-profile` (where A00.2/A00.3/A00.3.1 were originally built)
Destination repo: `MS-pesaschile-catalog-service` (this repo — the correct long-term owner of product
semantics, since it already owns product/catalog data end to end)

## 1. Why this slice exists

A00.2 (the ontology registry), A00.3 (the classifier), and A00.3.1 (the non-product policy
correction) were all built inside `MS-pesaschile-customer-profile` because that is where the A00
product-export tooling happened to live. That repo is not the right permanent home for product
semantics — `catalog-service` is. Moving ownership *before* A00.4 (acceptance) and A00.5 (snapshot
publication) build anything on top of these modules avoids having to migrate a registry, a classifier,
a snapshot publisher, version/hash contracts, tests, scripts, docs, and possibly persistence all at
once later. This slice moves the already-finished, already-accepted implementation as-is — it does not
redesign, rename, or reinterpret anything.

## 2. What moved

From `MS-pesaschile-customer-profile`, copied file-for-file (same relative paths, same filenames, same
content except the one necessary import-path fix described in Section 3):

```
src/domain/commercial-product-ontology/    (11 files: contracts, tag data, global-rules ×2, registry,
                                             hash, immutable, validate, index)
src/domain/product-semantic-classification/ (10 files: contracts, normalize, category-catalog,
                                             non-product-exclusion, rules ×3, classifier, checksum, index)
scripts/product-semantic-classification/    (classify-catalog.ts, golden-set-regression.ts,
                                             non-product-policy-v2-migration.ts, lib/{csv,load-input,summary}.ts)
tests/unit/commercial-product-ontology-registry.test.ts
tests/unit/product-semantic-classification-*.test.ts   (6 files, 129 tests)
docs/releases/CUSTOMER-INTELLIGENCE-R2-A00.2-*.md
docs/releases/CUSTOMER-INTELLIGENCE-R2-A00.3-*.md
docs/releases/CUSTOMER-INTELLIGENCE-R2-A00.3.1-*.md
```

Also copied (required for the migrated tests to run at all, not "historical audit" material): the A00
export fixture data the golden-set regression and non-product-policy tests read directly —
`docs/audits/product-intelligence-exploration/inputs/{category_trust_map,feature_trust_map,
product_catalog_exploration}(*).csv` and
`docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/
ontology_review_closure.csv`. The historical A00/A00.1/A00.1B/A00.1C **markdown audit reports**
deliberately stayed in `customer-profile` — they are audit narrative, not runtime or test dependencies.

`MS-pesaschile-customer-profile`'s copies were **left completely untouched** — nothing was deleted or
deprecated there in this slice. Disposal of the origin copies is an explicit, separate decision for a
later slice, once something in `catalog-service` actually depends on this code at runtime.

## 3. The one necessary adaptation

`commercial-product-ontology/hash.ts` and `product-semantic-classification/checksum.ts` both imported
a small, generic, dependency-free deterministic-JSON-hash helper (`sha256Stable`/`stableStringify`)
from `customer-profile`'s `src/domain/customer-rfm/checksum.ts` — a domain that is out of scope for
`catalog-service` (RFM/segmentation is a customer-profile concept). The helper itself has zero
`customer-rfm`-specific logic, so it was copied unchanged to `src/shared/checksum.ts` here (alongside
this repo's existing `src/shared/crypto.ts`, `money.ts`, etc.), and the two import sites were updated
from `'../customer-rfm/checksum.js'` to `'../../shared/checksum.js'`. **This is the only code change
made anywhere in the migrated modules** — every other file is byte-for-byte identical to its
`customer-profile` source. `npm run product:semantic:classify` and
`npm run product:semantic:v2-migration-audit` were added to `package.json`, matching
`customer-profile`'s script names exactly.

## 4. Verified equivalence

Acceptance for this slice was exact-equivalence, not "it compiles." Every criterion below was run
independently in `catalog-service` against the identical A00 export/trust-map fixture files and
compared directly against the last confirmed `customer-profile` run (CUSTOMER-INTELLIGENCE-R2-A00.3.1):

| Criterion | customer-profile | catalog-service | Match |
| --- | --- | --- | --- |
| Registry version | `commercial-product-ontology-v2` | `commercial-product-ontology-v2` | ✅ |
| Registry hash | `cbf363d31fc7fb6f99f9597e5c4545a75812db9e008205d9820d61391edbe212` | `cbf363d31fc7fb6f99f9597e5c4545a75812db9e008205d9820d61391edbe212` | ✅ exact |
| Previous (v1) registry hash | `df58006b9a68f056a36988ff2c178a5084fe6400fd3f6abe96091472f9969009` | `df58006b9a68f056a36988ff2c178a5084fe6400fd3f6abe96091472f9969009` | ✅ exact |
| Source products | 2011 | 2011 | ✅ |
| Excluded (non-product) | 13 | 13 | ✅ |
| Semantic universe | 1998 | 1998 | ✅ |
| `CLASSIFIED` | 1246 | 1246 | ✅ |
| `PARTIALLY_CLASSIFIED` | 397 | 397 | ✅ |
| `OTHER` | 355 | 355 | ✅ |
| `EXCLUDED_NON_PRODUCT` | 13 | 13 | ✅ |
| `NEEDS_REVIEW` | 0 | 0 | ✅ |
| v1-vs-v2 `falsePositiveExclusions` | 0 | 0 | ✅ |
| v1-vs-v2 `unexpectedSemanticChanges` | 0 | 0 | ✅ |
| **Classification checksum** | `f1a4ffb8d74388dbffc2ee3e9be5020a9cac8e6516cb2c1d11ff831a95502ed1` | `f1a4ffb8d74388dbffc2ee3e9be5020a9cac8e6516cb2c1d11ff831a95502ed1` | ✅ **exact** |
| Golden-set `PRODUCT_FAMILY` | 199/200 (id 2134 documented exception) | 199/200 (same exception) | ✅ |
| Golden-set `DISCIPLINE` | 200/200 | 200/200 | ✅ |
| Golden-set `USE_CONTEXT` | 200/200 | 200/200 | ✅ |

Every number matches exactly, including the full-precision classification checksum — the strongest
possible evidence that this was an ownership migration, not a reimplementation. If a single rule had
been transcribed differently, the checksum would have changed; it did not.

## 5. Tests

224 tests migrated (95 registry + 91 A00.3 + 38 A00.3.1), all passing unmodified in `catalog-service`'s
existing `vitest` setup (`globals: true`, `tests/setup.ts` env bootstrap — neither interfered, since
every migrated test imports `describe`/`expect`/`it` from `vitest` explicitly rather than relying on
globals). Running the full `catalog-service` suite alongside them (68 files, 2024 tests) shows zero
regressions attributable to this migration.

## 6. What this slice does NOT do

- No ontology tag, evidence rule, confidence policy, or non-product pattern was changed, added, or
  removed. `commercial-product-ontology-v2`'s hash is identical to the version already accepted in
  `customer-profile`.
- No classifier rule changed. The only classifier-adjacent change anywhere is the checksum-helper
  import path (Section 3).
- Nothing was deleted or deprecated in `MS-pesaschile-customer-profile` — both copies coexist for now.
- No integration was built yet: nothing in `catalog-service`'s HTTP interface, application layer, or
  infrastructure layer consumes these domains yet. That wiring, along with A00.4 (acceptance) and A00.5
  (durable snapshot publication), is explicitly out of scope here.
- No database persistence, snapshot publication, customer affinity, UI/API surface, PrestaShop
  connection, or LLM use was added.

## 7. Validation run

```
npm run typecheck (catalog-service)                          → clean, 0 errors
npx vitest run tests/unit/{commercial-product-ontology-registry,product-semantic-classification-*}.test.ts
                                                               → 7 files, 224 tests, all passing
npx vitest run (full catalog-service suite)                  → 68 files, 2024 tests, all passing
npm run product:semantic:classify                            → 2011 products, checksum f1a4ffb8...
npm run product:semantic:v2-migration-audit                   → falsePositiveExclusions=0, unexpectedSemanticChanges=0
golden-set regression (200/200 ontology_review_closure.csv)  → 199/200 FAMILY, 200/200 DISCIPLINE, 200/200 USE_CONTEXT
```

## 8. Next slice

`A00.4` Classification Acceptance & Quality Gate — now correctly scoped to accept an implementation
already living in its permanent owning repo.
