# CAT-V2 P1.6 — Phase 1 closure and authority audit

Date: 2026-10-01. Decision: **CAT-V2 PHASE 1: NOT CLOSED**. This record distinguishes repository evidence from the required real deployment evidence. No Phase 2 work is authorized by this record.

## Repository and deployment evidence

P1.5 is committed as `63ee156d6f1fbb8d4d629418781a71c9cb74a900` on `main`. `git ls-remote origin refs/heads/main` returned that exact SHA on 2026-10-01. Generated `artifacts/`, `dist/`, `node_modules/`, `.env`, and legacy snapshot directories are Git-ignored; P1.5's commit contains no runtime bundle or credentials.

The runbook [catalog-service-ec2-deployment.md](../operations/catalog-service-ec2-deployment.md) describes an EC2 service on port 4010, but this checkout has no `.env`, SSH configuration, deployment manifest, or endpoint/credentials for that process. The production process, build SHA, active bundle, and access method have **not been observed**. No production activation, rollback, restart, failure injection, or soak was performed. Local tests and the P1.5 local drill cannot satisfy these gates.

| Required observation | Real deployment result |
| --- | --- |
| Startup → Commercial Truth operational → desired/loaded B1 | Not executed; deployment access and B1 identity unavailable |
| B1 → B2 without restart | Not executed; B2 identity and deployment access unavailable |
| B2 → B1 rollback without restart | Not executed |
| Restart with desired/loaded B1 | Not executed |
| Invalid candidate in isolated control root; B1 retained | Not executed |
| J1 nominal search, product context, concrete item context, price, stock, sellability, freshness at B1/loading/B2/rollback | Not executed |
| `/health/projections` desired, loaded, activation ID, reload state; `/health/ready` Commercial Truth and capability readiness | Not observed in real process |
| Startup/reload latency, convergence, RSS before/during/after, polling/retry, soak | Not observed in real process |

The local integration drill in `tests/integration/projectionRuntimeHotReload.test.ts` covers B1 → B2 → B1, request capture, failed reload preservation, degraded projection readiness, stale candidate fencing, and source file removal. Its database readiness uses a stub, so it is **local mechanism evidence only**. The default poll interval is 1 s and retry backoff is bounded from 1 to 30 s in `src/domain/catalog/runtime-projection.ts`; those are configuration/code facts, not observed production behavior or SLOs.

## Runtime authority matrix

`CAT_V2_RUNTIME`, `LEGACY`, and `UNAVAILABLE` below describe the authority actually consulted by the consumer. A loaded artifact alone does not make it an HTTP authority. Commercial Truth remains live PrestaShop data and is outside CAT-V2 projections.

| Consumer | Data/projection | Current authority/status | Target authority | Phase 1 action and future action |
| --- | --- | --- | --- | --- |
| `/v1/products/:id/semantics`, batch, registry | Product Semantics | `CAT_V2_RUNTIME` when a bundle is loaded; `LEGACY` only if no CAT-V2 pointer exists | `CAT_V2_RUNTIME` | Retain transitional fallback; observe usage, then retire after deployment guarantee |
| `/v1/products/semantic-discovery/query`, Product axis | Product Semantics | Same request-captured CAT-V2/legacy rule | `CAT_V2_RUNTIME` | Same fallback decision |
| Training V2 product, batch, registry and query routes | Training V2 | `LEGACY` V2 snapshot | Future V2 projection | `DEFER`; migrate when a versioned V2 artifact and compatibility gate exist |
| Semantic discovery Training axis | Training V2 | `LEGACY` V2 snapshot | Future V2 projection | Same migration condition |
| Runtime manager's Training V1 state | Training V1 | `CAT_V2_RUNTIME`, loaded/validated; no public Training V1 route consumes it | Governed projection | Keep distinct from V2; no V1→V2 substitution |
| Runtime manager's Specs state | Normalized Specs V1 | `CAT_V2_RUNTIME`, loaded/validated; no public query consumes it | CAT-V2 Specs | Record data-quality limit; public use requires a later explicit consumer |
| `/v2/catalog/products/:key/context` specifications | PrestaShop feature facts | `LEGACY` live Commercial Truth, not CAT-V2 Specs | Explicit future decision | Keep J1 authority; do not imply normalized projection use |
| Runtime trust-map artifact | Category/feature trust hashes | `CAT_V2_RUNTIME`, validated; no query consumer | CAT-V2 trust projection | Keep lineage and make consumer migration explicit later |
| `/v2/catalog/*` category selection | Generated static category trust map | `LEGACY` static `categoryTrustMap.ts` | Explicit future decision | No silent switch in P1.6 |
| CAT-V2 Relationships entry | Relationships | `UNAVAILABLE` with reason; no CAT-V2 consumer | Phase 4 | Preserve unavailable state; never treat as empty relationship set |
| Recommendation search and relationship readiness | Separate relationship snapshot | `LEGACY` independent runtime | Phase 4 migration decision | Keep separate; CAT-V2 unavailable does not disable this reader |
| CAT-V2 Capabilities entry | Capabilities | `UNAVAILABLE` with reason; no CAT-V2 consumer | Phase 4 | Preserve unavailable state; never treat as false capability |
| Training V2 capability facts | Legacy Training V2 snapshot | `LEGACY` | Phase 4 versioned capability authority | Maintain V2 contract until migration |
| Product context `inferred.frequentlyBoughtTogether` | FBT | `UNAVAILABLE` in real composition: no provider injected | Phase 4 relationship authority or remove field | `DEFER_WITH_OWNER`; explicit `not_supported` when provider is absent |

`src/bootstrap.ts` injects the Product Semantics adapter, the legacy Training V2 reader, and the independent relationship reader. It does not inject FBT. `src/domain/catalog/runtime-projection.ts` reports CAT-V2 Relationships and Capabilities as `UNAVAILABLE`; `src/shared/readiness.ts` keeps Commercial Truth independent. An optional `UNAVAILABLE` capability yields HTTP 200 degraded readiness, not a false empty result or HTTP 503 when database/cache are operational. This is code/test evidence; deployment behavior remains unverified.

## Authority decisions

**Product Semantics: A — transitional fallback retained.** Owner: Catalog service runtime owner. It applies only to the explicit `NO_ACTIVE_BUNDLE` state; corrupt or unloadable desired pointers cannot silently select legacy authority. Usage is counted by `catalog_product_semantic_legacy_fallback_total` (reads delegated, not distinct requests). Removal condition: the real deployment guarantees a valid active pointer on every start, production startup/restart and rollback drills pass, and the fallback counter remains zero during the agreed rollout observation window. No window length is invented here.

**Training V2: DEFER.** Public Training V2 and the Training axis of semantic discovery retain the legacy V2 snapshot. CAT-V2 currently contains Training V1 and is not compatible with the V2 response contract. Owner: Catalog service semantics owner; home: Phase 4 capability/semantic authority migration once a same-lineage V2 artifact and contract parity are built.

**Relationships/Capabilities: UNAVAILABLE in CAT-V2.** Their manifest entries and runtime readiness say unavailable, not empty/false. The independent legacy relationship recommendation reader remains its own authority. Owner/home: Phase 4. Do not infer that `projection.readiness.relationships = UNAVAILABLE` describes the separate legacy recommendation snapshot.

**FBT: DEFER_WITH_OWNER.** Owner: Catalog service recommendation owner; home: Phase 4 relationship integration or contract removal. The public field remains in the v2 product-context schema, but the real composition does not pass a provider. The response now says `status: unavailable, reason: not_supported` in that case. `snapshot_unavailable` remains reserved for an injected provider that returns no result. Contract fixtures and manifest are updated. A fixture with an injected provider demonstrates only the optional contract branch, not production wiring.

**Spec Projection decision.** The initial Spec Projection is deterministic normalization of current PrestaShop product features. It is **not** independent physical or manufacturer-certified verification. Records preserve raw value, source feature IDs, derivation rule/version, and `parsed`, `ambiguous`, or `unsupported` status. Lack of external validation is an **ACCEPTED DATA QUALITY LIMITATION**, not an architectural defect. The original reviewed-precision gate is **DEFERRED / WAIVED BY PRODUCT DECISION** for this initial projection, not PASS. `CATALOG_PLATFORM_V2_PRD.md` and `CATALOG_PLATFORM_ARCHITECTURE_AUDIT.md` carry the amended gate. The waiver does not assert that ambiguous values are correct.

## Residual test and script audit

| Test dependency | Classification | Owner/action |
| --- | --- | --- |
| `tests/http/getTrainingSemanticReadSurfaceEndpoint.test.ts`, `queryTrainingSemanticsEndpoint.test.ts`, `semanticDiscoveryQueryEndpoint.test.ts` read ignored `data/training-semantic-snapshots/v2` and require manual rebuild | `MIGRATE` | Catalog service test owner; move to committed synthetic V2 fixture in legacy-retirement work. Until then, a clean checkout cannot reproduce their positive cases without fixture preparation. |
| Product Semantic classifier CLI/golden-set tests read tracked archived CSV and write ignored outputs | `KEEP` | Catalog service classifier owner; these pin historical compatibility behavior and do not require ignored runtime snapshots. |
| CAT-V2 bundle/activation/runtime tests create temporary source and bundles | `KEEP` | Catalog service projection owner; they exercise current authority and source retention. |
| Relationship unit/integration tests use generated or in-memory snapshots | `KEEP` | Recommendation owner; tests for the independent legacy relationship authority. |

| Old classifier/script path | Classification | Reason/action |
| --- | --- | --- |
| Product and Training V1 classifier/load-input modules | `COMPATIBILITY_ADAPTER` | P1.2 validates their inputs and P1.3 builder calls them to produce bundle facts; cannot remove safely. |
| `scripts/product-semantic-classification/*` publisher, audits, inspection | `ACTIVE` legacy operations | Legacy fallback and historical review still need them; retire with explicit consumer migration. |
| `scripts/training-semantic-snapshot/*` and V2 classifier scripts | `ACTIVE` legacy operations | Public Training V2 still loads their snapshot. |
| `scripts/catalog-v2/generate-category-trust-map.mjs` | `ACTIVE` J1 adapter | Produces static map used by `mysqlCatalogV2DataReader.ts`, separate from CAT-V2 trust hashes. |
| P1.2 extractor and P1.3 builder | `ACTIVE` | Current projection publication path. |
| Proven `DEAD` script path | None established | No deletion without proving callers and deployment jobs absent. |

Published bundles are self-contained for activation, loading, reload, rollback and restart: the runtime loader validates published manifest/artifacts rather than `canonical_input.json`. The local integration drill removes the source directory before activation/load. Historical extraction may be retained for auditability. Real deployment retention has not been demonstrated.

## Phase 1 deliverables

| Deliverable | Status | Evidence/owner when deferred |
| --- | --- | --- |
| Read-only extractor | PASS | P1.2 production SELECT-only extraction record |
| Reproducible normalized projection input | PASS | P1.2 A/B hash record |
| Unified projection manifest | PASS | P1.3 bundle contract |
| Strict schema/version validation | PASS | P1.3/P1.4 candidate gate and tests |
| Hot reload | FAIL | Local mechanism passes; real deployment drill missing |
| Rollback | FAIL | Local mechanism passes; real deployment drill missing |
| Live-presence handling | PASS | Canonical `current_catalog`/historical-only and bundle validation |
| Initial normalized Spec Projection | PASS | Technical normalization only; external verification waived |
| Snapshot-dependent tests | DEFERRED_ACCEPTED | Three ignored Training V2 snapshot tests; Catalog service test owner, legacy retirement |
| FBT decision | DEFERRED_ACCEPTED | Explicit unavailable; recommendation owner, Phase 4 |
| Obsolete classifier/script paths | DEFERRED_ACCEPTED | Compatibility adapters/legacy operations retained; classifier owners, legacy retirement |

## Phase 1 gates

| Gate | Status | Evidence/remaining proof |
| --- | --- | --- |
| Same source + same code → same hash | PASS | P1.2 A/B extraction and P1.3 replay |
| Invalid bundle cannot activate | PASS | P1.4 candidate validation and tests |
| Previous valid bundle remains usable | FAIL | Local test passes; controlled failure drill in real deployment missing |
| Spec Projection decision documented | PASS | Product waiver and accepted limitation above |
| No Commercial Truth regression | FAIL | J1 real smokes at B1, B2 loading/loaded, and rollback missing |
| P1.5 committed/pushed | PASS | `63ee156d6f1fbb8d4d629418781a71c9cb74a900` on `origin/main` |
| Desired/loaded visibility and capability-aware readiness in deployment | FAIL | No real endpoint observation |
| Restart persistence, operational baseline and soak | FAIL | No real process observation |
| Build, typecheck, lint, full tests, `git diff --check` | PASS | `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (105 files/2,413 tests), and `git diff --check` all exit 0 on this checkout; this is local repository evidence |

## Remaining debt and closure blockers

| Class | Item |
| --- | --- |
| BLOCKER | Real deployment access/build evidence; B1/B2 identifiers; startup, hot reload, rollback, restart, controlled failure, J1 regression smoke, readiness, measurements and soak. |
| PHASE 2 | Unified Retrieval only after Phase 1 closes; no Phase 2 implementation here. |
| PHASE 4 | Versioned Training V2/Capabilities and Relationships authority migration; FBT provider decision. |
| LEGACY RETIREMENT | Remove Product Semantics fallback after its condition; migrate ignored Training V2 snapshot tests; retire classifier/publisher paths only after their consumers are gone. |
| DATA QUALITY | External physical/manufacturer spec validation accepted as a limitation; orphan feature/category source rows and historical semantic review remain separately governed. |
| OPERATIONS | Bundle/control root persistence and permissions, process manager restart behavior, polling/retry observations, RSS and soak baseline still need real deployment evidence. |

**CAT-V2 PHASE 1: NOT CLOSED**. The concrete blocker is missing real deployment evidence; repository tests cannot substitute for it.
