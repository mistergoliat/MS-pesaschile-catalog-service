# CAT-V2 P1.6 — Phase 1 closure and authority audit

Date: 2026-10-01. Decision: **CAT-V2 PHASE 1: CLOSED**. The production operator supplied the final P1.6 restart evidence and confirmed the earlier production drills and commercial smokes passed. Production observations in this record are operator-reported; this checkout has no direct deployment access or raw drill logs. Phase 2 was not started as part of this closure.

## Repository and deployment evidence

P1.5 is committed as `63ee156d6f1fbb8d4d629418781a71c9cb74a900` on `main` and was verified on `origin/main` before the P1.6 audit commit advanced that branch. Generated `artifacts/`, `dist/`, `node_modules/`, `.env`, and legacy snapshot directories are Git-ignored; P1.5's commit contains no runtime bundle or credentials.

The runbook [catalog-service-ec2-deployment.md](../operations/catalog-service-ec2-deployment.md) describes the EC2 service on port 4010. This checkout has no deployment credentials, so the following production results were provided by the operator rather than observed directly here. B1/B2 are the operator's bundle aliases; their full content IDs, production build SHA, exact activation UUIDs, drill timestamps, and raw logs were not supplied in this conversation. The local tests remain separate mechanism evidence.

| Required observation | Real deployment result |
| --- | --- |
| Startup → Commercial Truth operational → desired/loaded B1 | PASS, operator-reported; restart observation below confirms fresh startup with B1 |
| B1 → B2 without restart | PASS, operator-reported; first reload reached `READY` before the PM2 memory-policy restart described below |
| B2 → B1 rollback without restart | PASS after PM2 limit correction; same PID and restart counter |
| Restart with desired/loaded B1 | PASS; PID `2778280` → `2780802`, desired B1 = loaded B1, desired activation = loaded activation, `READY`, no reload error |
| Invalid candidate in isolated control root; B1 retained | PASS per operator's P1.6 completion attestation; detailed failure-drill output was not supplied here |
| J1 nominal search, product context, concrete item context, price, stock, sellability, freshness during the lifecycle | PASS per operator's regression-smoke summary; Product Context P40 returned HTTP 200 after restart |
| `/health/projections` and `/health/ready` | PASS; desired/loaded B1, equal activation IDs, `reloadState=READY`, `lastReloadError=null`; readiness `status=ok`, database/Redis `ok`, Commercial Truth and projection runtime `READY` |
| Startup/reload latency, convergence, RSS, polling/retry, soak | PASS per operator's closure attestation; restart startup measurements below. Exact soak duration and polling/retry series were not supplied here |

The fresh-process restart read the persisted `active.json`, validated B1, built `RuntimeProjectionState`, and converged without manual activation. Operator-reported startup metrics: validation ~370 ms, construction ~229 ms, total ~604 ms; RSS before ~172 MiB, candidate ~180 MiB, after ~180 MiB. The configured PM2 memory limit is now 384 MiB. These are observations, not SLOs. The local integration drill in `tests/integration/projectionRuntimeHotReload.test.ts` separately covers B1 → B2 → B1, request capture, failed reload preservation, degraded projection readiness, stale candidate fencing, and source file removal. Its database readiness uses a stub.

### Production incident and correction

The initial PM2 `max_memory_restart` was 250 MiB. CAT-V2 hot reload reached `READY`, then transient RSS reached about 270 MB and PM2 sent `SIGINT`, causing brief `Could not connect to server` windows. The operational memory policy caused the restart after a successful atomic reload. The operator raised the limit to 384 MiB, ran `pm2 save`, and repeated rollback: zero-downtime PASS, same PID PASS, same restart counter PASS. The corrected setting and observed startup RSS leave margin; the process definition is still persisted only in `~/.pm2/dump.pm2`.

### Operator's final production gate summary

| Gate group | Status |
| --- | --- |
| Read-only extraction, deterministic canonical input and repeatable hashes; explained historical semantic diff | PASS |
| Immutable publication, validation, Product/Training/Specs/Trust Maps projections | PASS |
| Relationships and Capabilities explicitly `UNAVAILABLE` | PASS |
| Active pointer, history, CAS and rollback protocol | PASS |
| Startup load, desired/loaded visibility, atomic swap, B1 → B2 reload, B2 → B1 rollback, zero-downtime behavior after correction, restart persistence | PASS |
| Commercial Truth regression: nominal search, product/item context, price, stock, sellability and freshness | PASS |

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

`src/bootstrap.ts` injects the Product Semantics adapter, the legacy Training V2 reader, and the independent relationship reader. It does not inject FBT. `src/domain/catalog/runtime-projection.ts` reports CAT-V2 Relationships and Capabilities as `UNAVAILABLE`; `src/shared/readiness.ts` keeps Commercial Truth independent. The real restart reported `/health/ready status=ok` with Commercial Truth and projection runtime `READY` despite those CAT-V2 projections remaining unavailable. Optional capability unavailability does not force HTTP 503 when database/cache are operational.

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

Published bundles are self-contained for activation, loading, reload, rollback and restart: the runtime loader validates published manifest/artifacts rather than `canonical_input.json`. The local integration drill removes the source directory before activation/load. The production restart confirms that the new process reconstructed B1 from the persisted pointer and published bundle; it did not directly test removal of the historical source directory. Historical extraction may be retained for auditability.

## Phase 1 deliverables

| Deliverable | Status | Evidence/owner when deferred |
| --- | --- | --- |
| Read-only extractor | PASS | P1.2 production SELECT-only extraction record |
| Reproducible normalized projection input | PASS | P1.2 A/B hash record |
| Unified projection manifest | PASS | P1.3 bundle contract |
| Strict schema/version validation | PASS | P1.3/P1.4 candidate gate and tests |
| Hot reload | PASS | Real B1 → B2 reached `READY`; PM2 memory-policy incident corrected |
| Rollback | PASS | Real B2 → B1 converged without restart after correction |
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
| Previous valid bundle remains usable | PASS | Local controlled test and operator-attested production failure drill; detailed production output not supplied here |
| Spec Projection decision documented | PASS | Product waiver and accepted limitation above |
| No Commercial Truth regression | PASS | Operator-reported J1 smokes for search, product/item context, price, stock, sellability and freshness; P40 product context HTTP 200 after restart |
| P1.5 committed/pushed | PASS | `63ee156d6f1fbb8d4d629418781a71c9cb74a900` on `origin/main` |
| Desired/loaded visibility and capability-aware readiness in deployment | PASS | B1 desired/loaded, equal activation IDs, `READY`; database/Redis `ok`, Commercial Truth `READY`, projection runtime `READY` |
| Restart persistence, operational baseline and soak | PASS | PID `2778280` → `2780802`; B1 recovered, startup timing/RSS recorded; no remaining operational blocker reported. Soak duration not supplied here |
| Build, typecheck, lint, full tests, `git diff --check` | PASS | `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (105 files/2,413 tests), and `git diff --check` all exit 0 on this checkout; this is local repository evidence |

## Remaining nonblocking debt

| Class | Item |
| --- | --- |
| PHASE 2 | Unified Retrieval and later search cold-path/SLO work; one broad cold search was ~1–1.5 s versus milliseconds with cache. No Phase 2 implementation in this closure. |
| PHASE 4 | Versioned Training V2/Capabilities and Relationships authority migration; FBT provider decision. |
| LEGACY RETIREMENT | Remove Product Semantics fallback after its condition; migrate ignored Training V2 snapshot tests; retire classifier/publisher paths only after their consumers are gone. |
| DATA QUALITY | External physical/manufacturer spec validation accepted as a limitation; orphan feature/category source rows and historical semantic review remain separately governed. |
| OPERATIONS | Version the PM2 process definition currently held in `~/.pm2/dump.pm2`; keep `max_memory_restart=384 MiB` durable; set `CATALOG_SERVICE_BUILD_REF` so HTTP provenance stops reporting `catalog-service@local`. Retain raw drill logs, full bundle/activation IDs, production build SHA and exact soak window in the operational evidence store. |

**CAT-V2 PHASE 1: CLOSED**. Production hot reload, rollback, Commercial Truth smoke and fresh-process pointer persistence were reported as validated. The PM2 memory-policy blocker was corrected and re-tested. Remaining items above do not reopen the foundation without a concrete regression.
