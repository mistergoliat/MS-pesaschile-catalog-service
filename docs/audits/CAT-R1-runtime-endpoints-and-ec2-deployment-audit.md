# CAT-R1 — Runtime Endpoints & EC2 Deployment Audit

**Type:** Read-only technical audit (no code, config, or infrastructure changes made)
**Scope:** `MS-pesaschile-catalog-service`, current `main` @ `6f49ed1`
**Trigger:** Observed `401 Unauthorized` on some HTTP calls and `503 COMMERCIAL_RECOMMENDATION_UNAVAILABLE` on `POST /api/v2/recommendations/search-products` on the EC2 deployment, while `GET /v1/products/search?q=barra` returned `200`.
**Method:** Source-of-truth order followed strictly — (1) runtime code, (2) tests, (3) configuration (`config.ts`, `.env.example`), (4) scripts/CLI, (5) documentation. Every claim below is anchored to a file and, where useful, a line range. Where README/docs diverge from code, the divergence is called out explicitly rather than silently resolved in either direction.

---

## 1. Executive summary

The service is a single Fastify process (`src/server.ts`) exposing two independent capability groups behind one shared API-key gate:

- **Catalog group** (`/v1/products/*`, `/v1/products/explore`) — reads only from PrestaShop/MariaDB through one `mysql2` pool. No dependency on the relationship engine, snapshots, or Customer Profile.
- **Recommendation group** (`/api/v2/recommendations/search-products`, `/api/v2/catalog/resolve-product-intent`) — the catalog group's DB access *plus* an in-memory relationship index loaded once at process startup from a JSON snapshot on local disk (`RELATIONSHIP_SNAPSHOT_DIR`), *plus* an optional Customer Profile HTTP call gated by `CUSTOMER_AFFINITY_PROVIDER_MODE`.

Both observed symptoms are fully explained by code, with no need to speculate:

- **`503 COMMERCIAL_RECOMMENDATION_UNAVAILABLE` / `stage="commercial"`** is the documented, by-design response when the relationship snapshot reader has no active index loaded (`defaultActiveSnapshotReader.ts:134-140` → `defaultCommercialRecommendationService.ts:107-122` → `defaultSearchProductsV2Service.ts:628-638` → `searchProductsV2Controller.ts:50-64`). This happens whenever `RELATIONSHIP_SNAPSHOT_DIR/active.json` does not exist, or the file it points to is missing/corrupt, **at the moment the process started** — the reader never refreshes itself afterward (§7, §13, §14). Locally, `data/relationship-snapshots` does not exist in a fresh clone (it is git-ignored — `.gitignore:5`) and nothing in `npm ci`/`npm run build`/`npm start` creates it. If the EC2 host never ran `npm run relationship:snapshot:build` (or ran it after the process last started), this is the expected, self-consistent state — not a bug.
- **`401 Unauthorized`** on some calls and `200` on others against the same route is explained by how `config.apiKeys` is computed **once, at process import time** (`config.ts:73-88`) and never re-read afterward, combined with `x-api-key` comparison that is exact and case-sensitive with no trimming of the *incoming* header (`crypto.ts:16-22`). Any of the following reproduces it: a stale in-memory key list after editing `.env` without a real process restart (PM2 `restart` without `--update-env` does not reload environment for an already-running interpreter's `process.env` in every PM2 topology), a client sending a key with incidental leading/trailing whitespace or a newline, or a caller using a key that was valid before a rotation. §13 gives the precise mechanism and how to disambiguate on EC2 without guessing.

No evidence of a code defect was found in the auth or 503 paths themselves — both behave exactly as designed. One real (but separate) implementation defect was found in `/health/ready`'s error handling (§9, §16), and two cases of dead/inert configuration were found (`DatabaseUnavailableError`/`CatalogQueryFailedError` never thrown; `ENABLE_METRICS` never read). README also makes two claims that do not match the code (§15).

**Verdict:** `RUNTIME_DESIGN_CLEAR_EC2_MISCONFIGURED` (see §17 for the full justification and the capability table).

---

## 2. Architecture / runtime map

Composition root: `src/server.ts` → `createRuntime()` (`src/bootstrap.ts`) → `buildApp()` (`src/interfaces/http/app.ts`).

```text
src/server.ts
 ├─ config (src/shared/config.ts)               parsed once at import time from process.env via dotenv/config
 ├─ createRuntime()  (src/bootstrap.ts)
 │   ├─ createPool()                             mysql2 pool — SHARED by catalog AND recommendation reads
 │   ├─ cache: MemoryCacheProvider | RedisCacheProvider   (config.cache.driver)
 │   ├─ CatalogApplicationService                 (search / product / batch)
 │   ├─ CatalogCommercialTruthService              (price/stock/availability truth used by both groups)
 │   ├─ DefaultExploreProductsService
 │   ├─ createCustomerAffinityEvidenceProvider()   unavailable | empty | http  (config.recommendation.customerAffinityProviderMode)
 │   ├─ DefaultProductIntentResolutionService
 │   └─ createRecommendationRuntime()  (src/recommendationRuntime.ts)
 │        ├─ DefaultActiveProductRelationshipSnapshotReader
 │        │     .refresh()  ← called EXACTLY ONCE, here, at startup (recommendationRuntime.ts:50)
 │        ├─ DefaultCommercialProductRecommendationService   (T08)
 │        ├─ DefaultCustomerProductAffinityProvider          (T09)
 │        ├─ DefaultPersonalizedRecommendationService        (T10)
 │        └─ DefaultSearchProductsV2Service                  (T11)
 └─ buildApp(deps)  (src/interfaces/http/app.ts)
     ├─ @fastify/rate-limit (global)
     ├─ @fastify/swagger + swagger-ui  — only if ENABLE_DOCS=true AND NODE_ENV !== 'production'
     ├─ onRequest hook: correlation id
     ├─ preHandler hook: x-api-key auth gate (all routes except /health*, /docs*, /openapi.json, and
     │   conditionally /metrics)
     ├─ GET  /health/live
     ├─ GET  /health/ready
     ├─ GET  /metrics
     ├─ GET  /v1/products/search
     ├─ GET  /v1/products/:productId
     ├─ POST /v1/products/batch
     ├─ POST /api/v2/catalog/resolve-product-intent   (routes/resolveProductIntentRoute.ts)
     ├─ POST /api/v2/recommendations/search-products  (routes/searchProductsV2Route.ts)
     └─ POST /v1/products/explore                     (routes/exploreProductsRoute.ts)
```

Two independent runtime resources sit outside the process and outside Git:

1. **MariaDB/PrestaShop** — reachability required by nearly everything (`DB_HOST`/`DB_*`).
2. **Relationship snapshot files** on local disk under `RELATIONSHIP_SNAPSHOT_DIR` — required only by the recommendation group, and only loaded once, at process start.

There is no message queue, no scheduler, no cron, and no file-watcher in this codebase (confirmed by `grep -r "setInterval\|watch(" src/` — the only `refresh()` call in the entire source tree is the one startup call in `recommendationRuntime.ts:50`).

---

## 3. Endpoint inventory

Source: `src/interfaces/http/app.ts` (health, metrics, `/v1/products/*`) plus the three `register*Route` files under `src/interfaces/http/routes/`. This is the complete route list registered by `buildApp()` — nothing else is mounted.

| Method | Route | Handler | Auth | Input validation | Main service | Dependencies | Success | Failure | Degraded behavior |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/health/live` | `app.ts:146-154` inline | none (excluded, `app.ts:176`) | none | — | none | 200 always | — | never fails; does not check any dependency |
| GET | `/health/ready` | `app.ts:156-172` inline, `deps.readyCheck` from `server.ts:14-30` | none (excluded) | none | — | DB ping, Redis ping (if `CACHE_DRIVER=redis`), relationship snapshot status | 200 `{status:"ok"}` | 503 `{status:"degraded"}` | any of DB/Redis/snapshot unavailable ⇒ 503 (see §9) |
| GET | `/metrics` | `app.ts:188-191` | conditional — bypassed only if `METRICS_REQUIRE_API_KEY=false` (`app.ts:179-181`) | none | `metricsText()` (prom-client) | none | 200 text | 401 if key required and missing/invalid | — |
| GET | `/openapi.json` | `app.ts:100-103` | none (excluded) | none | fastify-swagger | none | 200 (only if `ENABLE_DOCS=true` and `NODE_ENV !== 'production'`; otherwise route does not exist ⇒ 404) | 404 if docs disabled | — |
| GET | `/docs` | swagger-ui plugin | none (excluded) | none | swagger-ui | none | 200 (same gating as above) | 404 if docs disabled | — |
| GET | `/v1/products/search` | `app.ts:212-225` inline | **required** | Zod (`searchQuerySchema`) + Fastify JSON-schema on querystring | `CatalogApplicationService.searchProducts` (`catalogService.ts:97-130`) | DB (`MySqlSearchProvider`→`MySqlCatalogRepository`), cache | 200 | 400 invalid input, 401 unauthorized, 500 on unmapped errors (incl. raw DB failures — see §16) | none coded; cache miss just means a DB round-trip |
| GET | `/v1/products/:productId` | `app.ts:258-280` inline | **required** | Zod (`productParamsSchema`, `productQuerySchema`) | `CatalogApplicationService.getProduct` (`catalogService.ts:132-305`) | DB, cache, `PrestaShopPhysicalStockProvider`, `SqlPricingProvider` | 200 | 400, 401, 404 (`ProductNotFoundError`/`CombinationNotFoundError`), 503 (`WeightUnavailableError`, `StockUnavailableError`, `PriceUnavailableError` — domain data-integrity guards, `catalogService.ts:44-51`), 500 on unmapped errors | none coded |
| POST | `/v1/products/batch` | `app.ts:313-327` inline | **required** | Zod (`batchRequestSchema`) | `CatalogApplicationService.batchGetProducts` (`catalogService.ts:307-339`) | same as product detail, per item | **200 always** (per-item `Promise.allSettled`, failures surface as `ok:false` items in the 200 body, not as HTTP error codes) | 400 (malformed request shape only), 401 | per-item — a DB/price/stock failure for one item never fails the whole batch |
| POST | `/v1/products/explore` | `exploreProductsRoute.ts:130-161` / `exploreProductsController.ts` | **required** | Fastify JSON-schema (`requestSchema`) | `DefaultExploreProductsService` (`application/catalog/explore-products`) | DB (`MySqlCatalogExploreDataReader`) | 200 | 400, 401, 404 `category_not_found`, 500, 503 `catalog_source_unavailable` (only if `service` dependency itself is `undefined` — never happens via `server.ts`, always constructed — see `exploreProductsController.ts:34-36`) | — |
| POST | `/api/v2/catalog/resolve-product-intent` | `resolveProductIntentRoute.ts:119-160` / `resolveProductIntentController.ts` | **required** | Fastify JSON-schema | `DefaultProductIntentResolutionService` | DB via `CatalogProductIntentProvider` (wraps `CatalogApplicationService` + `CatalogCommercialTruthService`) | 200 (business outcome `resolved`/`clarification_required`/`no_match` inside the 200 body) | 400, 401, 422 `INVALID_CATALOG_RESULT`, 500, 503 `CATALOG_SEARCH_UNAVAILABLE` (`resolveProductIntentController.ts:106-110`, only if service undefined — not reachable via `server.ts`) | — |
| POST | `/api/v2/recommendations/search-products` | `searchProductsV2Route.ts:98-135` / `searchProductsV2Controller.ts` | **required** | Fastify JSON-schema + Zod (`searchProductsV2RequestSchema`) | `DefaultSearchProductsV2Service.search` (`defaultSearchProductsV2Service.ts:613-855`) | DB (catalog enrichment + T08 commercial data), relationship snapshot (T08 via T07 reader), Customer Profile (T09, only if `customer` present in body) | 200 (recommendations may legitimately be an empty array) | 400, 401, 404 `SOURCE_PRODUCT_NOT_FOUND`, 409 `CUSTOMER_MISMATCH`/`SOURCE_PRODUCT_INACTIVE`, 422 (contract-mismatch codes), 500 `INTERNAL_CONFIGURATION_ERROR`, **503 `COMMERCIAL_RECOMMENDATION_UNAVAILABLE`** | customer affinity degrades to neutral instead of failing the request (§8); commercial stage and catalog-enrichment stage failures are hard failures (503), not degradations |

All non-health/docs/metrics routes require `x-api-key`; this matches the README's blanket claim, but the per-route auth is enforced generically by the global `preHandler` hook (`app.ts:174-186`), not per-route — every route registered after that hook inherits it automatically, including any future route someone adds without realizing it needs an explicit auth annotation.

---

## 4. Authentication model

Full trace: `app.ts:174-186` (hook) → `crypto.ts:isApiKeyAuthorized`/`safeKeyEquals` → `config.ts:73-88` (key list construction) → `shared/errors.ts:UnauthorizedError` (401).

### 4.1 Key list construction (`config.ts:73-88`)

```text
apiKeys = (CATALOG_API_KEYS ?? API_KEY ?? '')
            .split(',')
            .map(trim)
            .filter(Boolean)

if apiKeys.length === 0: throw at startup — process refuses to boot
```

- `CATALOG_API_KEYS` **takes full precedence over `API_KEY` whenever it is present, even as an empty string** — `??` is nullish coalescing, so `CATALOG_API_KEYS=""` short-circuits `API_KEY` entirely and (after `.filter(Boolean)`) yields zero keys, which crashes the process at boot (not a runtime 401 — the service will not start at all). This is a startup-time hard failure, not a per-request one.
- If both are set and `CATALOG_API_KEYS` is non-empty, `API_KEY` is **silently ignored** in full.
- Each configured key is trimmed once, at parse time. Whitespace inside `.env` around commas is tolerated.
- Empty entries between commas are dropped (`filter(Boolean)`), so `CATALOG_API_KEYS=a,,b` yields `['a','b']`.

### 4.2 Per-request comparison (`app.ts:182-185`, `crypto.ts:7-22`)

```text
apiKey := request.headers['x-api-key']   (must be a single string header value)
if apiKey is not a string OR isApiKeyAuthorized(apiKey, config.apiKeys) is false:
    throw UnauthorizedError()   → 401 { error: { code: "UNAUTHORIZED", ... } }
```

- `isApiKeyAuthorized` returns `false` immediately if `value` is falsy (`crypto.ts:16-19`).
- `safeKeyEquals` does a **length check first**, then `crypto.timingSafeEqual` only if lengths match (`crypto.ts:7-14`) — this is a correct timing-safe comparison, but it means a key with an extra trailing character (e.g. `\n` from a copy-paste or a shell `echo` without `-n`) fails the length check outright, well before timing-safety is even relevant.
- **The incoming header value is never trimmed.** Only the configured keys are trimmed at parse time (§4.1). A client sending `x-api-key: mykey\n` or `x-api-key: mykey ` will get 401 even though `mykey` is a valid configured key.
- Header name matching is case-insensitive (Fastify/Node normalize header names), but the header **value** comparison is byte-exact and case-sensitive.

### 4.3 Route exclusions (`app.ts:174-186`)

```text
skip auth if:  path startsWith '/health'
            OR path startsWith '/docs'
            OR path === '/openapi.json'
            OR (path === '/metrics' AND METRICS_REQUIRE_API_KEY is false)
```

`METRICS_REQUIRE_API_KEY` defaults to `true` (`config.ts:180`, via `parseBoolean(raw.METRICS_REQUIRE_API_KEY, true)`), so by default `/metrics` **is** protected.

### 4.4 Behavior matrix

| Condition | Result |
|---|---|
| No `x-api-key` header | 401 (falsy → `isApiKeyAuthorized` short-circuits) |
| Wrong key | 401 (length or byte mismatch) |
| `API_KEY` unset, `CATALOG_API_KEYS` unset | process does not start (startup crash, not a 401) |
| `CATALOG_API_KEYS` set (even to only whitespace/commas) | used exclusively; `API_KEY` ignored entirely |
| Both set, `CATALOG_API_KEYS` non-empty | `CATALOG_API_KEYS` wins, `API_KEY` ignored |
| Configured key has surrounding whitespace in `.env` | tolerated — trimmed at parse time |
| Incoming header has surrounding whitespace | **not tolerated** — compared byte-exact, will 401 against an otherwise-correct key |
| Empty string as `x-api-key` | 401 (falsy check) |
| Key correct, one of several configured keys | 200-class (any match in the list authorizes — `isApiKeyAuthorized` uses `.some`) |

### 4.5 Why the same route can return 401 for one call and 200 for another

Given the mechanics above, on a single running EC2 process the only ways to get inconsistent 401/200 on identical-looking calls are:

1. **Different keys used by different callers** (some correct, some stale/rotated-out) — the most common real-world cause and requires no code defect.
2. **Whitespace/newline difference in the sent header** on some calls but not others (e.g., one client interpolates a shell variable with `$(cat file)` picking up a trailing newline, another uses `echo -n`).
3. **The `.env` was edited (key rotated/added) but the running Node process was never actually restarted with the new environment.** `config.ts` is a module evaluated once at process import (`import 'dotenv/config'` at the top, then a top-level `envSchema.safeParse(process.env)`) — there is no re-read at request time. A `pm2 restart <name>` **without** `--update-env` can, depending on PM2 version/mode, keep serving the process's original environment snapshot; only a full stop/start or `pm2 restart <name> --update-env` is guaranteed to pick up an edited `.env`. This is indistinguishable from the outside from "wrong key" — both produce 401 — which is exactly why this must be verified on EC2 rather than guessed (see §12, §13).

There is no per-IP, per-route, or partial-key-list logic anywhere in the auth path — the gate is a single, uniform boolean check applied identically to every protected route.

---

## 5. Catalog-only dependency path (`GET /v1/products/search`)

Full trace: `app.ts:212-225` → `CatalogApplicationService.searchProducts` (`catalogService.ts:97-130`) → `CacheProvider.get/set` (`infrastructure/cache/{memory,redis}.ts`) → `RequestCoalescer.run` (`shared/coalescer.ts`, dedupes concurrent identical queries) → `MySqlSearchProvider.search` (`infrastructure/search/mysqlSearchProvider.ts:17-64`) → `MySqlCatalogRepository.getSearchCandidates` (`infrastructure/repositories/mysqlCatalogRepository.ts:276-323`) → `runQuery` (`infrastructure/database/queries.ts:4-21`) → the shared `mysql2` pool (`infrastructure/database/pool.ts`).

- **Tables queried:** `{prefix}product`, `{prefix}product_lang`, `{prefix}product_attribute`, `{prefix}stock_available`, `{prefix}product_attribute_combination`, `{prefix}attribute`, `{prefix}attribute_lang`, `{prefix}attribute_group_lang` (`mysqlCatalogRepository.ts:334-373`), prefix from `PRESTASHOP_DB_PREFIX`, strictly validated to end in `_` (`config.ts:103-106`).
- **Scope filters:** `p.active = 1` hard-coded (`mysqlCatalogRepository.ts:373`); shop/lang scoped via `pl.id_shop = ?` / `pl.id_lang = ?` bound to `config.prestashop.shopId`/`langId` (constructor default, `mysqlCatalogRepository.ts:81-84`); stock filter is conditional — `includeOutOfStock=false` (the default) appends `AND COALESCE(sa.physical_quantity, 0) > 0` (`mysqlCatalogRepository.ts:378`); a hard-coded discovery-exclusion product-id denylist is also applied both in SQL (`NOT IN (...)`, `mysqlCatalogRepository.ts:377`) and again defensively in `MySqlSearchProvider.search` (`mysqlSearchProvider.ts:31`, `DISCOVERY_EXCLUDED_PRODUCT_IDS`).
- **Two-pass search:** an exact/phrase pass runs first; a token-AND fallback pass (`shouldUseNameTokenFallback`/`shouldRunNameTokenFallback`, `mysqlCatalogRepository.ts:55-76`) only runs when the phrase pass has no candidate with full name-token coverage — this is why `q=barra` (a single common token) can behave differently from a multi-word query, but it is a ranking heuristic, not a dependency.
- **Price resolution:** **not** performed by this endpoint — search results carry `physicalQuantity`/`available` only (`mysqlSearchProvider.ts:33-43`); price is resolved only by the product-detail path (§6.1). This directly contradicts nothing in the request but is worth noting: search results do not include price.
- **Cache:** `MemoryCacheProvider` or `RedisCacheProvider` per `CACHE_DRIVER`, TTL `SEARCH_CACHE_TTL_SECONDS` (default 300s), keyed by normalized query + limit + `includeOutOfStock` (`shared/cacheKeys.ts`, `catalogService.ts:102-103`).
- **Timeout:** `DB_QUERY_TIMEOUT_MS` (default 3000ms) passed as the mysql2 per-query `timeout` option (`queries.ts:15`, `mysqlCatalogRepository.ts:85`).
- **Error mapping:** **none, beyond Zod input validation.** `runQuery` does not catch or translate driver errors (`queries.ts:4-21` has no try/catch around the query itself, only a `finally` for the metric). A raw connection/timeout error from `mysql2` propagates unchanged up through `MySqlSearchProvider` → `CatalogApplicationService` → the Fastify route handler → `app.ts`'s global error handler (`app.ts:121-144`), where it is **not** an instance of `CatalogError`, not a validation error, not a rate-limit error, so it falls through to the generic branch and becomes **`500 INTERNAL_ERROR`** (`app.ts:141-143`). See §16 for why this matters: `DatabaseUnavailableError`/`CatalogQueryFailedError` exist in `shared/errors.ts` but are never thrown anywhere in `src/` — a DB outage surfaces as an undifferentiated 500, not the more specific 503 the error-code taxonomy suggests exists.

**Confirmed dependencies:** DB (required), cache (present but soft — cache-provider failure is not explicitly guarded either, so a broken Redis would also surface as an uncaught 500 here, not a graceful bypass). **Confirmed non-dependencies:** relationship snapshot, Customer Profile, recommendation engine — none of these types are imported or referenced anywhere in the search/product/batch code paths (verified by reading `catalogService.ts`, `mysqlSearchProvider.ts`, `mysqlCatalogRepository.ts`, `pool.ts` in full — zero references to `RELATIONSHIP_*` or `CUSTOMER_PROFILE_*` symbols). This is exactly why `/v1/products/search` returning `200` while `/api/v2/recommendations/search-products` returns `503` is expected and does not indicate a partial or flaky DB outage.

---

## 6. Product detail and batch

### 6.1 `GET /v1/products/:productId` (`catalogService.ts:132-305`)

1. Cache lookup by full context key (product/combination/quantity/customer/currency/country) — `productCacheKey`.
2. `repository.getProductCore(productId)` — `p.active = 1` filter; returns `null` ⇒ `ProductNotFoundError` (404) (`catalogService.ts:157-159`).
3. `repository.getVariants(productId)` — determines `hasVariants`.
4. Combination resolution: explicit `combinationId` must exist among the product's variants or `CombinationNotFoundError` (404, `catalogService.ts:177-179`); otherwise the default combination is looked up (`getDefaultCombinationId`) when the product has variants.
5. Weight resolution: `resolveEffectiveWeightKg` (`catalogService.ts:42-52`) throws `WeightUnavailableError` (503) only if `baseWeight + weightImpact < 0` — a data-integrity guard, documented as not expected to trigger in production today (CAT-R1-T13A).
6. Stock: cache lookup, else `PrestaShopPhysicalStockProvider.getStock` (`infrastructure/stock/prestashopPhysicalStockProvider.ts`), cached with `STOCK_CACHE_TTL_SECONDS`.
7. Price: cache lookup, else `SqlPricingProvider.quote` (`infrastructure/pricing/sqlPricingProvider.ts` → `priceResolver.ts`, applies `specific_price` rows and `TAX_RATE`), cached with `PRICE_CACHE_TTL_SECONDS`.

No relationship-snapshot or Customer Profile dependency anywhere in this path either.

**Failure modes:** 400 (Zod param/query validation), 401, 404 (`ProductNotFoundError`, `CombinationNotFoundError`), 503 (`WeightUnavailableError`/`StockUnavailableError`/`PriceUnavailableError` — data-integrity guards, not infra-outage signals), 500 for any unmapped/raw error (same uncaught-driver-error pattern as §5).

### 6.2 `POST /v1/products/batch` (`catalogService.ts:307-339`)

Fans out to `getProduct` per item via `Promise.allSettled` — **the HTTP response is always `200`** for a structurally valid request; individual product failures (not-found, DB error, etc.) are captured per item as `{ ok:false, error:{ code, message, correlationId } }` inside the response body, never as an HTTP error status. Only a malformed request body (fails Zod `batchRequestSchema`, e.g. more than 20 items, missing `productId`) produces a `400`, and a missing/invalid key produces `401`. This is a meaningful operational distinction from single-product lookup and should inform how a caller — or a smoke test — interprets a batch response.

---

## 7. SearchProducts V2 (`POST /api/v2/recommendations/search-products`)

### 7.1 Real call graph (as wired in `bootstrap.ts` + `recommendationRuntime.ts`, not the README's conceptual diagram)

```text
HTTP POST /api/v2/recommendations/search-products
  → searchProductsV2Route.ts (Fastify JSON-schema: only `sourceProduct` required)
  → searchProductsV2Controller.ts
      - resolves correlationId (header or body)
      - if attachValidation caught a schema error → SearchProductsV2Error INVALID_REQUEST (400)
      - if deps.service is undefined → SearchProductsV2Error COMMERCIAL_RECOMMENDATION_UNAVAILABLE (503)
        (dead branch via server.ts: the service is always constructed by createRecommendationRuntime())
  → DefaultSearchProductsV2Service.search()          (defaultSearchProductsV2Service.ts:613-855)
      1. Zod-validate request (searchProductsV2RequestSchema) → 400 INVALID_REQUEST
      2. assertSupportedFilters — rejects `filters.productIds` (not supported in V1) → 400
      3. mapCommercialRequest() → DefaultCommercialProductRecommendationService.recommend()   == T08
           → ActiveProductRelationshipSnapshotReader.findBySource()                            == T07
                (throws RUNTIME_SNAPSHOT_NOT_LOADED if no snapshot has ever loaded successfully)
           → CatalogRecommendationCommercialDataProvider.getCommercialData()  (DB via CatalogCommercialTruthService)
           on ANY failure here → SearchProductsV2Error COMMERCIAL_RECOMMENDATION_UNAVAILABLE, stage="commercial" (503)
      4. CatalogRecommendationCommercialDataProvider.getProductsByReferences()  (DB catalog enrichment, incl. sourceProduct)
           on failure → SearchProductsV2Error COMMERCIAL_RECOMMENDATION_UNAVAILABLE, stage="catalog" (503)
      5. sourceProduct must resolve in catalog and be active
           → 404 SOURCE_PRODUCT_NOT_FOUND / 409 SOURCE_PRODUCT_INACTIVE
      6. if commercial.recommendations is empty → 200 with recommendations:[] and warning NO_COMMERCIAL_CANDIDATES
         (this is NOT an error — "no relationships for this source product" is a valid 200)
      7. if request.customer present → DefaultCustomerProductAffinityProvider.getAffinities()   == T09
           on a *retryable* CustomerAffinityError → DEGRADE (neutral affinity, warning CUSTOMER_AFFINITY_UNAVAILABLE,
              execution.degraded=true) — request still returns 200
           on a *non-retryable, non-INVALID_PROVIDER_RESPONSE* CustomerAffinityError → hard fail,
              SearchProductsV2Error INVALID_AFFINITY_RESULT (→ 422, not enumerated in the controller's
              switch, falls to the default branch)
      8. DefaultPersonalizedRecommendationService.personalize()                                 == T10
           on failure → SearchProductsV2Error INVALID_PERSONALIZATION_RESULT (422) or
              CUSTOMER_MISMATCH (409, defensively unreachable per the code comment at
              defaultSearchProductsV2Service.ts:792-799)
      9. mapResult() — enrichment filtering (missing/inactive/out-of-stock), warning dedup, response assembly
  → searchProductsV2Controller.ts: mapSearchProductsV2ErrorToHttp() maps SearchProductsV2Error.code → HTTP status
```

### 7.2 `query` vs `sourceProduct`

- **`sourceProduct.productId` is the only required field of the request body** — enforced identically by the Fastify JSON-schema (`required: ['sourceProduct']`, `searchProductsV2Route.ts:39`) and the Zod contract (`sourceProduct: productRelationshipProductReferenceSchema` non-optional, `query: boundedQuerySchema.optional()`, `contracts.ts:126-127`).
- **`query` is optional** and is treated purely as pass-through compatibility metadata — it does not identify, resolve, or replace `sourceProduct` anywhere in `defaultSearchProductsV2Service.ts`. The route's own OpenAPI description says so explicitly: *"The caller must provide sourceProduct.productId manually; this endpoint does not infer productId from query text. query is optional compatibility metadata..."* (`searchProductsV2Route.ts:105-107`).
- **The service performs no lexical/text search to resolve `sourceProduct`.** Natural-language resolution is a *separate* endpoint, `POST /api/v2/catalog/resolve-product-intent` (§3), explicitly reserved for "T12" per the route description (`searchProductsV2Route.ts:108`) — its resolved `sourceProduct` can be copied into this endpoint's body (`resolveProductIntentRoute.ts:133`), but the two endpoints are never called from one another.
- **README divergence:** `README.md:57` states *"SearchProducts V2 V1 requires both `query` and `sourceProduct`"*. This directly contradicts both the Fastify schema and the Zod schema, and contradicts the route's own inline OpenAPI description. **Code and Zod contract are the source of truth: `query` is optional.** (§15)

### 7.3 What happens with no relationships vs no snapshot — these are different states

| State | Where it's decided | HTTP result |
|---|---|---|
| Snapshot loaded, source product has zero relationships in it | `defaultSearchProductsV2Service.ts:699-721` | **200**, `recommendations: []`, warning `NO_COMMERCIAL_CANDIDATES` |
| No snapshot ever successfully loaded (reader's `activeIndex` is `null`) | `defaultActiveSnapshotReader.ts:134-140` → wrapped up the stack | **503** `COMMERCIAL_RECOMMENDATION_UNAVAILABLE`, `stage:"commercial"` |
| Snapshot loaded, but the DB call to enrich commercial data fails | `catalogRecommendationCommercialDataProvider.ts` → `defaultCommercialRecommendationService.ts:255-267` (`COMMERCIAL_DATA_PROVIDER_FAILURE`) | **503** `COMMERCIAL_RECOMMENDATION_UNAVAILABLE`, `stage:"commercial"` (same code+stage as the missing-snapshot case — see §14 for how to disambiguate) |
| Snapshot loaded, relationships resolved, but the catalog-enrichment DB call for the *candidate products* fails | `defaultSearchProductsV2Service.ts:668-677` | **503** `COMMERCIAL_RECOMMENDATION_UNAVAILABLE`, `stage:"catalog"` |
| Customer affinity call fails with a retryable/integration error | `defaultSearchProductsV2Service.ts:747-766` | **200**, degraded, warning `CUSTOMER_AFFINITY_UNAVAILABLE` |
| Customer affinity call fails with a non-retryable T09-internal bug (should not occur via a validated request) | `defaultSearchProductsV2Service.ts:751-755` | 422 `INVALID_AFFINITY_RESULT` (hard failure, not a degrade) |

### 7.4 What degrades vs what fails the whole request

- **Degrades (200, `execution.degraded=true`):** customer affinity provider integration failures only (network/timeout to Customer Profile, or a structurally invalid provider response). This is the *only* stage in the entire T11 pipeline designed to degrade rather than fail.
- **Hard-fails the request (non-200):** commercial recommendation stage (T08, including the snapshot-not-loaded case), catalog enrichment (both the pre- and post-commercial lookups), personalization stage (T10), and any contract-shape violation returned by an upstream stage (`INVALID_COMMERCIAL_RESULT`, `UPSTREAM_CONTRACT_MISMATCH`, etc.).

---

## 8. Product Relationship Engine (T01–T07) — build pipeline and snapshot lifecycle

### 8.1 Source

`PrestashopHistoricalOrderTransactionReader` (`infrastructure/recommendation/prestashopOrderTransactionReader.ts`), instantiated only by the CLI (`src/cli/buildRelationshipSnapshot.ts:70`) — **never** by the running server.

- **Tables:** `{prefix}orders` joined to `{prefix}order_detail` (`prestashopOrderTransactionReader.ts:113-129`).
- **Time range:** `o.date_add >= RELATIONSHIP_SOURCE_FROM_DATE` and, if set, `<= RELATIONSHIP_SOURCE_TO_DATE`.
- **Order states accepted:** `RELATIONSHIP_SOURCE_ORDER_STATES` (CSV of `current_state` values) — a line whose order's `current_state` is not in this set is excluded (`prestashopOrderTransactionReader.ts:165-173`).
- **Products excluded:** `RELATIONSHIP_SOURCE_EXCLUDED_PRODUCT_IDS` (CSV of product ids, excluded per-line).
- **Cap:** `RELATIONSHIP_SOURCE_MAX_PRODUCTS_PER_ORDER` is enforced later, by the normalizer (`maximumDistinctProductsPerTransaction`, `defaultRelationshipSnapshotBuildService.ts:54`), not by the SQL reader itself.

### 8.2 Build pipeline (all invoked synchronously, in-process, by the CLI only)

```text
PrestashopHistoricalOrderTransactionReader.read()                (defaultRelationshipSnapshotBuildService.ts:48)
  → DefaultProductTransactionNormalizer.normalize()               T02  (domain/.../normalization/normalizer.ts)
  → SameOrderRelationshipCalculator.calculate()                   T03  (domain/.../calculators/sameOrderCalculator.ts)
  → EvidenceBasedRelationshipReliabilityEvaluator.evaluateCandidates()  T04  (domain/.../reliability/evidenceBasedReliabilityEvaluator.ts)
  → DefaultProductRelationshipValidator.validate()                T05  (domain/.../validation/defaultRelationshipValidator.ts)
       — if validRelationships.length === 0 → throws RelationshipSnapshotBuildError, "active snapshot was not changed"
         (defaultRelationshipSnapshotBuildService.ts:96-98) — the CLI exits non-zero, existing active snapshot untouched
  → DefaultProductRelationshipSnapshotPublisher.publish()          T06  (domain/.../publication/defaultSnapshotPublisher.ts)
       → DefaultProductRelationshipSnapshotBuilder.build()          builds the immutable snapshot object + sha256 id
       → store.save(snapshot)                                       writes snapshots/<hash>.json (idempotent — see 8.3)
       → store.activate(snapshot.snapshotId)                        ALWAYS called — publish() always activates what it just built
```

`DefaultProductRelationshipSnapshotPublisher.publish()` (`defaultSnapshotPublisher.ts:20-45`) unconditionally calls `store.save()` **and then** `store.activate()` — there is no "build without activating" mode in this codebase. Every successful CLI run both writes a new snapshot file **and** flips the active pointer to it, atomically per §8.3.

### 8.3 Snapshot runtime (`infrastructure/recommendation/fileProductRelationshipSnapshotStore.ts`)

Given `RELATIONSHIP_SNAPSHOT_DIR=<dir>` (default `data/relationship-snapshots`, relative to the process's working directory):

```text
<dir>/
  active.json              { "snapshotId": "sha256:<64-hex>" }
  snapshots/
    <64-hex>.json           one immutable file per snapshot, named by its content hash
```

- **`snapshotFileName()`** (`fileProductRelationshipSnapshotStore.ts:16-22`) requires `snapshotId` to match `^sha256:([a-f0-9]{64})$` exactly — anything else throws `INVALID_SNAPSHOT` before touching disk.
- **`save()`** (`:55-84`): parses/validates the snapshot against `productRelationshipSnapshotSchema`; if a file with the same hash already exists, compares canonical JSON — identical content ⇒ `status:'already_exists'` (idempotent, no-op); different content under the *same* claimed hash ⇒ `SNAPSHOT_ID_COLLISION` (should be unreachable in practice since the id *is* a content hash, but is defended against). Otherwise writes via `writeJsonAtomically`.
- **`writeJsonAtomically()`** (`:159-175`): writes to `<path>.<pid>.tmp`, `fsync`s, then `rename()`s over the final path — this is atomic on POSIX (rename is atomic within the same filesystem) and cleans up the temp file on failure. **This applies equally to `active.json`** (via `activate()`, `:86-94`), so a crash mid-publish cannot leave a half-written `active.json`.
- **`activate()`** (`:86-94`): first confirms the target snapshot file actually exists (`getById`) — refuses to point `active.json` at a snapshot that isn't on disk (`SNAPSHOT_NOT_FOUND`).
- **`getActive()`** (`:100-128`) — this is the exact function the running server calls at startup:
  - `active.json` **does not exist** (`ENOENT`) → returns `null` (not an error) → reader treats this as "no active snapshot," `activeIndex` stays `null`, `getStatus()` returns `{state:'not_loaded'}`.
  - `active.json` exists but is unreadable for another reason, or is not valid JSON, or does not have a string `snapshotId` field → throws `ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', ...)`. This propagates out of `refresh()` uncaught by the reader itself; `recommendationRuntime.ts:49-53` catches it at the top level and stores it as `initialRefreshError` — **the server still starts**, but `relationshipSnapshotReader` stays with `activeIndex=null`, i.e. functionally identical to the ENOENT case from the outside (readiness degraded, T11 returns 503).
  - `active.json` points to a `snapshotId` whose file is missing from `snapshots/` → throws `SNAPSHOT_NOT_FOUND` — same propagation/outcome as above.
  - Snapshot file content fails `productRelationshipSnapshotSchema` (corrupt/invalid) → throws `INVALID_SNAPSHOT` — same propagation/outcome.
  - "Old" snapshot (stale evidence window) is **not** detected or rejected anywhere in this store or in `DefaultActiveProductRelationshipSnapshotReader` — there is no max-age check. An old-but-structurally-valid snapshot loads and serves normally; staleness is an operational/business concern, not something the runtime enforces.
- **Versioning:** content-addressed by sha256 of the canonicalized snapshot JSON (`canonicalJson.ts`) — there is no separate incrementing version number; re-running the build over identical source data yields the identical `snapshotId` and is a no-op `save()` (still re-activates, harmlessly, since it's already active).

### 8.4 What must physically exist on EC2 for the recommendation group to be ready

```text
$RELATIONSHIP_SNAPSHOT_DIR/active.json                      — must exist, valid JSON, { "snapshotId": "sha256:<64 hex>" }
$RELATIONSHIP_SNAPSHOT_DIR/snapshots/<that 64-hex>.json      — must exist, must pass productRelationshipSnapshotSchema
```

Both are ordinary files on the EC2 instance's local filesystem (not in Git — `.gitignore:5` excludes `data/relationship-snapshots`), and both must exist **before the Node process starts**, because the reader only loads them once, at `createRuntime()` time (§2). There is no runtime endpoint, signal handler, or scheduled job anywhere in this codebase that re-reads them later.

### 8.5 Runtime index build validation (`domain/.../runtime/defaultRuntimeIndexBuilder.ts`)

Even a snapshot that passes the store's schema check is re-validated when turned into the in-memory index: `schemaVersion === '1'`, `relationshipCount === relationships.length`, every relationship's `modelVersion`/`evidenceWindow` must match the snapshot's own, every product reference must itself be schema-valid, and duplicate relationships (by source+target+type+modelVersion+window) are rejected (`DUPLICATE_RUNTIME_RELATIONSHIP`). Any violation throws `ProductRelationshipRuntimeError` during `refresh()`, caught by `recommendationRuntime.ts` exactly like the store-level errors in §8.3 — same "server starts, recommendation group stays unready" outcome.

---

## 9. CLI / snapshot build (`src/cli/buildRelationshipSnapshot.ts`, `package.json` script)

**Command, confirmed against `package.json:17`:**

```bash
npm run relationship:snapshot:build
```

which runs `tsx src/cli/buildRelationshipSnapshot.ts` — i.e. this is a **TypeScript-source** entry point via `tsx`, not something that requires `dist/` to exist first (unlike `npm start`, which does). It can be run before or independent of `npm run build`.

- **Requires `RELATIONSHIP_SOURCE_FROM_DATE`** — the CLI throws immediately if unset (`buildRelationshipSnapshot.ts:37-39`); this variable is optional in `envSchema` (no crash at process-config-parse time) but **mandatory for this specific command** to run at all.
- **Connects directly to the DB** — calls `createPool()` (the same pool factory used by the server) and queries via `PrestashopHistoricalOrderTransactionReader` (§8.1).
- **Writes files locally** under `config.recommendation.relationshipSnapshotDir` (same env var the server reads — `RELATIONSHIP_SNAPSHOT_DIR`; must be set consistently between the CLI run and the server's own config for the server to find what was just built).
- **Always updates the active pointer** on success — `DefaultRelationshipSnapshotBuildService.build()` → `DefaultProductRelationshipSnapshotPublisher.publish()` always calls `store.activate()` (§8.2). There is no "build only, review before activating" mode.
- **Does not require the server to be stopped.** It opens its own separate `mysql2` pool (`createPool()` call, `buildRelationshipSnapshot.ts:68`) and closes it in a `finally` (`:75-77`); it writes to the snapshot directory via atomic rename (§8.3), which is safe to do concurrently with a running server reading the *old* files (the running server's reader never re-reads them anyway — §7, §8.4).
- **Does NOT make an already-running server pick up the new snapshot.** Because `refresh()` is called only once, at `createRuntime()` time, a server that was already up when the CLI ran keeps serving with its original (possibly `not_loaded`) snapshot state until it is restarted. **A process restart is a required step after every snapshot build**, not an optional one.
- **Idempotent per identical source data**: same source rows in the DB (same date range/order states/exclusions) → same canonical snapshot → same sha256 `snapshotId` → `store.save()` returns `already_exists` and `activate()` re-points to the same, already-active snapshot. Different source data (new orders since the last build, or different date-range/state/exclusion parameters) produces a **new** snapshot version and a new active pointer.
- **Failure mode:** if the validated-relationships set ends up empty (e.g., too narrow a date range, or a `RELATIONSHIP_SOURCE_ORDER_STATES` value that matches nothing), the CLI throws `RelationshipSnapshotBuildError` and **exits with a non-zero code** (`buildRelationshipSnapshot.ts:80-85`, `process.exitCode = 1`) **without touching the previously-active snapshot** — this is the one case where a build attempt is guaranteed not to regress an already-working recommendation group.

No script anywhere in `package.json`, and no other file under `src/cli/`, does anything with snapshots besides this one command — there is no separate "activate" or "rollback" CLI; those operations only exist implicitly, by running a build against source data that reproduces the desired snapshot, or by manually rewriting `active.json` to point at a previously-saved snapshot file (both files are just JSON on disk — nothing in the store prevents a manual pointer edit as long as the target snapshot file exists and passes schema validation on next `getActive()`).

**On whether snapshots should be built once, per-deploy, periodically, or via a separate worker:** the codebase does not answer this — there is no scheduler, no queue consumer, and no repo convention (no cron file, no systemd timer, no `ecosystem.config.js`) expressing an intended cadence. The only fact the code establishes is the operational *constraint*: whatever cadence is chosen, **a server restart must follow every activation** for it to take effect. This is an operational decision the repository does not make for you, and this audit does not invent one on its behalf.

---

## 10. Customer affinity (T09)

`CUSTOMER_AFFINITY_PROVIDER_MODE` (`config.ts:62`, enum `unavailable | empty | http`, default `unavailable`) selects the evidence provider at `bootstrap.ts:39-62`:

| Mode | Provider | Behavior |
|---|---|---|
| `unavailable` (default) | `UnavailableCustomerAffinityEvidenceProvider` (`customerAffinityEvidenceProviders.ts:24-30`) | `getEvidence()` **always throws** `CustomerAffinityError('EVIDENCE_PROVIDER_FAILED', ..., retryable:true)` unconditionally |
| `empty` | `EmptyCustomerAffinityEvidenceProvider` (`:10-22`) | Always returns `{ productEvidence: [], warnings: [] }` — no error, but no signal either; every candidate gets neutral affinity with `NO_CUSTOMER_HISTORY` |
| `http` | `HttpCustomerAffinityEvidenceProvider` (`httpCustomerAffinityEvidenceProvider.ts`) | Calls Customer Profile over HTTP (below) |

Startup validation (`config.ts:112-136`): if mode is `http`, `CUSTOMER_PROFILE_BASE_URL` is **required** — the process refuses to start without it, must be an absolute http(s) URL with no embedded credentials, no query string, no fragment.

**Important:** the evidence provider is only ever invoked when `request.customer` is present in the SearchProducts V2 body (§7.1 step 7). With no `customer` object in the request, affinity is skipped entirely (`affinityStage:'skipped'`) regardless of provider mode — so a request without `customer` never touches this code path at all, `unavailable` mode included.

### 10.1 `http` mode contract

- **Endpoint:** `GET {CUSTOMER_PROFILE_BASE_URL}/v1/customers/{masterCustomerId}/purchased-products?limit=100&offset=<n>` (`httpCustomerAffinityEvidenceProvider.ts:218-227`) — `masterCustomerId` is `request.customer.customerId`, validated as a numeric string ≤20 chars, not the all-zero sentinel (`toMasterCustomerId`, `:405-429`).
- **Timeout:** `CUSTOMER_PROFILE_TIMEOUT_MS` (default 2500ms) via `AbortController` around the *entire* paginated fetch loop, not per-page (`:120-121`).
- **Pagination:** up to 200 pages, 20,000 total rows, guarded (`MAX_PAGES`, `MAX_TOTAL_HISTORICAL_ROWS`, `:27-28`) — these are runaway-upstream guards, not expected real-traffic limits.
- **Response contract → outcome mapping:**

| Customer Profile response | Provider outcome |
|---|---|
| `200` with valid `available` schema | evidence rows collected, matched against candidates |
| `404` classified as "customer not found" | `warnings:[{code:'customer_reference_not_found'}]`, no evidence — **not an error**, this is a defined functional state |
| `404` classified as "customer not linked" | `warnings:[{code:'customer_history_not_linked'}]`, no evidence — **not an error** |
| `503` with a recognized degraded-reason body | throws `HttpCustomerAffinityEvidenceProviderError('prestashop_unavailable'\|'prestashop_timeout', ...)` |
| `401`/`403` | throws `..._Error('auth_or_config_error', ...)` |
| `400` | throws `..._Error('bad_request', ...)` |
| any other status | throws `..._Error('unexpected_http_status', ...)` |
| network error / fetch throw | `network_error` |
| abort (timeout) | `timeout` |
| non-JSON body, schema mismatch, inconsistent pagination, duplicate identity across pages | various `invalid_*`/`pagination_*` reasons |

**All of the above `HttpCustomerAffinityEvidenceProviderError` cases propagate up as a thrown error out of `getEvidence()`.** `DefaultCustomerProductAffinityProvider.getAffinities()` (`defaultCustomerProductAffinityProvider.ts:163-175`) catches *any* thrown error from the evidence provider and uniformly rewraps it as `CustomerAffinityError('EVIDENCE_PROVIDER_FAILED', ..., retryable:true)` — **the specific HTTP failure reason (timeout vs 500 vs bad schema vs network) is preserved only in the `cause` chain and in provider-level logs (`customer_affinity_http_evidence_lookup_failed`), not in the public T09/T11 contract.** From SearchProducts V2's perspective, *every* Customer Profile failure mode looks identical: a retryable `CustomerAffinityError`, which — per §7.4 — **degrades**, it does not fail the request. So: Customer Profile being unconfigured, down, timing out, or returning garbage all produce the same outcome for the caller — a 200 with `execution.degraded=true` and a `CUSTOMER_AFFINITY_UNAVAILABLE` warning — **never** a 503 by itself. (A `404`/customer-not-found/not-linked response is explicitly *not* an error at all — it's a defined functional state that still returns neutral affinities with a specific warning, without ever throwing.)

---

## 11. Health / readiness semantics

`GET /health/live` (`app.ts:146-154`) — **unconditional** `{status:'ok', checks:{}}`. Does not touch DB, cache, or the snapshot reader. A process can be "live" while completely unable to serve any real traffic.

`GET /health/ready` (`app.ts:156-172`, backed by `deps.readyCheck` defined in `server.ts:14-30`) — the exact checks, confirmed by reading the implementation (not assumed):

```text
database:            runtime.repository.ping()  →  SELECT 1  against MariaDB
redis:                only evaluated if CACHE_DRIVER=redis, via runtime.cache.ping(); otherwise hard-coded 'ok'
relationshipSnapshot: relationshipSnapshotReader.getStatus().state === 'ready' ? 'ok' : 'unavailable'
```

- **`ok`** (HTTP 200): `database==='ok'` AND `redis!=='unavailable'` AND `relationshipSnapshot!=='unavailable'`.
- **`degraded`** (HTTP 503): any one of the three is unavailable.
- There is **no Customer Profile check** in readiness — a Customer Profile outage never affects `/health/ready`, consistent with it being a request-time degrade, not a startup dependency (§10).
- **The relationship snapshot is part of readiness.** This means: if `RELATIONSHIP_SNAPSHOT_DIR` has no valid active snapshot, `/health/ready` **already** returns 503 — independent of and prior to any client ever calling SearchProducts V2. A correct EC2 rollout procedure would catch the eventual `503 COMMERCIAL_RECOMMENDATION_UNAVAILABLE` at this stage, before declaring the deploy done (§12).
- **A process can absolutely be `online` in PM2 while `/health/ready` reports `degraded`.** PM2's `online` status only reflects "the Node process is running and didn't crash" — it has no knowledge of Fastify readiness. This is the exact situation this audit's evidence points to for the current EC2 state (§14–§15).

### 11.1 Implementation defect found in `/health/ready`

`server.ts:14-30`:

```js
readyCheck: async () => {
  try {
    await runtime.repository.ping();
    const redis = config.cache.driver === 'redis'
      ? (await runtime.cache.ping() ? 'ok' : 'unavailable')
      : 'ok';
    ...
    return { database: 'ok', redis, relationshipSnapshot };
  } catch {
    return { database: 'unavailable', redis: ..., relationshipSnapshot: ... };
  }
}
```

The `runtime.cache.ping()` call sits **inside the same `try` block** as `repository.ping()`. If `CACHE_DRIVER=redis` and Redis itself throws (rather than resolving falsy) — e.g. a connection error from `ioredis` — that exception is caught by the *outer* `catch`, which unconditionally reports `database:'unavailable'`, even though the database ping actually succeeded. **A Redis-only outage under `CACHE_DRIVER=redis` would be misreported in `/health/ready` as a database outage.** This does not affect the current default configuration (`.env.example` ships `CACHE_DRIVER=memory`), so it is not implicated in the observed EC2 symptoms, but it is a real, demonstrable defect worth fixing before Redis is adopted in production. See §16.

---

## 12. Production configuration matrix

Cross-referenced against `.env.example`, `src/shared/config.ts` (the only consumer/validator of `process.env` in this codebase — confirmed no other file reads `process.env` directly for these names outside `config.ts` and, separately, the CLI's own read of the *parsed* `config.recommendation.*` object), and every runtime file that reads the resulting `config.*` object.

Legend — **Required at startup**: process throws and refuses to boot if absent/invalid. **Required for capability**: process starts fine, but a specific capability is unavailable or degraded without it.

### Core runtime

| Variable | Required at startup | Required for capability | Default | Prod recommendation | Failure if absent |
|---|---|---|---|---|---|
| `HOST` | No | — | `0.0.0.0` | keep default unless binding to a specific interface | n/a |
| `PORT` | No | — | `4010` | pin explicitly for clarity in the PM2/proxy config | n/a |
| `NODE_ENV` | No | Yes — gates `/docs`+`/openapi.json` (`app.ts:75`) | `development` | **must be `production`** on EC2, otherwise Swagger UI/OpenAPI are exposed | if not `production`, docs endpoints are reachable |
| `LOG_LEVEL` | No | — | `info` | `info` or `warn` in prod | n/a |

### Auth

| Variable | Required at startup | Required for capability | Default | Prod recommendation | Failure if absent |
|---|---|---|---|---|---|
| `API_KEY` | Yes, unless `CATALOG_API_KEYS` set | — | none | prefer `CATALOG_API_KEYS` for multi-key rotation | process crashes at boot if neither is set/non-empty |
| `CATALOG_API_KEYS` | Yes, if used (takes precedence when present) | — | none | comma-separated allowlist; rotate by adding-then-removing, then **restart the process** | see §4 — silently overrides `API_KEY` even if set to only whitespace |

### PrestaShop / DB

| Variable | Required at startup | Required for capability | Default | Prod recommendation | Failure if absent |
|---|---|---|---|---|---|
| `DB_HOST` | Yes | — | none | — | boot crash (Zod `min(1)`) |
| `DB_PORT` | No | — | `3306` | — | n/a |
| `DB_USER` | Yes | — | none | least-privilege read-only user | boot crash |
| `DB_PASSWORD` | Yes | — | none (empty string technically satisfies `z.string()` — see risk below) | — | boot crash only if the var is entirely absent; an **empty** password passes validation |
| `DB_NAME` | Yes | — | none | — | boot crash |
| `DB_CONNECTION_LIMIT` | No | — | `10` | size to expected concurrency | n/a |
| `DB_QUERY_TIMEOUT_MS` | No | — | `3000` | keep low enough that a stuck query doesn't pile up connections | n/a |
| `PRESTASHOP_DB_PREFIX` | Yes (format-validated) | — | `ps_` | must match the real PrestaShop install's prefix | boot crash if not `[A-Za-z0-9_]+_` |
| `PRESTASHOP_SHOP_ID` | Yes (must be exactly `1`) | — | `1` | do not change — code hard-requires `1` (`config.ts:90-92`) | boot crash if not `1` |
| `PRESTASHOP_LANG_ID`, `PRESTASHOP_CURRENCY_ID`, `PRESTASHOP_CURRENCY_CODE`, `PRESTASHOP_COUNTRY_ID`, `PRESTASHOP_CUSTOMER_GROUP_ID` | No | Yes — wrong values silently scope queries to the wrong language/shop context | `1`/`1`/`CLP`/`0`/`0` | must match the real PrestaShop shop's actual ids | wrong (not missing) values return empty/incorrect results, not an error |
| `CATALOG_PUBLIC_BASE_URL` | Yes (must be valid http/https URL) | — | `https://pesaschile.cl` | — | boot crash if malformed |

### Cache

| Variable | Required at startup | Required for capability | Default | Prod recommendation | Failure if absent |
|---|---|---|---|---|---|
| `CACHE_DRIVER` | No | — | `memory` | `memory` is fine for a single instance; `redis` if scaling to >1 process for cache coherency | n/a |
| `REDIS_URL` | Yes, if `CACHE_DRIVER=redis` | — | empty | — | boot crash if driver=redis and unset |
| `SEARCH_CACHE_TTL_SECONDS` / `PRODUCT_CACHE_TTL_SECONDS` / `PRICE_CACHE_TTL_SECONDS` / `STOCK_CACHE_TTL_SECONDS` | No | — | 300/900/60/15 | tune to acceptable staleness | n/a |

### API behavior

| Variable | Required at startup | Required for capability | Default | Prod recommendation | Failure if absent |
|---|---|---|---|---|---|
| `BODY_LIMIT_BYTES` | No | — | 262144 | keep default | n/a |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_TIME_WINDOW_MS` | No | — | 120 / 60000 | tune to expected caller volume | n/a |
| `ENABLE_METRICS` | No | **No — read but never consumed** | `true` | leave as-is; changing it has no observable effect (dead config, §16) | none — the `/metrics` route is always registered regardless of this value |
| `METRICS_REQUIRE_API_KEY` | No | Yes — controls whether `/metrics` bypasses auth | `true` | keep `true` in prod unless scraping infra can't send the key | if `false`, `/metrics` is public |
| `ENABLE_DOCS` | No | Yes — combined with `NODE_ENV!=='production'` | `true` | irrelevant once `NODE_ENV=production` (docs are force-disabled regardless) | n/a in prod |

### Relationship engine

| Variable | Required at startup | Required for capability | Default | Prod recommendation | Failure if absent |
|---|---|---|---|---|---|
| `RELATIONSHIP_SNAPSHOT_DIR` | No | **Yes — required for the entire recommendation group to be `ready`** | `data/relationship-snapshots` (relative to CWD) | use an **absolute path** on EC2, owned/writable by the service user, outside the deploy directory so it survives redeploys | recommendation group returns 503, readiness degraded, **but core catalog endpoints keep working** |
| `RELATIONSHIP_SOURCE_FROM_DATE` | No (only required by the CLI at build time — `buildRelationshipSnapshot.ts:37-39`) | Yes, for building a snapshot | none | set explicitly whenever running the build | CLI throws immediately if run without it |
| `RELATIONSHIP_SOURCE_TO_DATE` | No | No (optional; defaults to latest observed transaction) | none | leave unset for "up to now" builds | n/a |
| `RELATIONSHIP_SOURCE_ORDER_STATES` | No | Yes, for the build to include any orders at all (CSV of `current_state` ids to accept) | empty → CLI throws `assertUniqueNonEmpty` if empty at build time | must be set to the real PrestaShop order-state ids that represent "completed enough to count" | CLI build fails if empty |
| `RELATIONSHIP_SOURCE_EXCLUDED_PRODUCT_IDS` | No | No | empty | set to any products that should never appear as recommendations | n/a |
| `RELATIONSHIP_SOURCE_MAX_PRODUCTS_PER_ORDER` | No | No | `50` | keep default unless orders routinely have far more distinct lines | n/a |

### Customer affinity

| Variable | Required at startup | Required for capability | Default | Prod recommendation | Failure if absent |
|---|---|---|---|---|---|
| `CUSTOMER_AFFINITY_PROVIDER_MODE` | No | Yes — selects the T09 provider | `unavailable` | `http` only once Customer Profile is actually reachable from EC2; `empty` as an explicit "no personalization yet" choice; `unavailable` is functionally similar to `empty` for the caller (both never 503 the whole request — §10) but logs/degrades every affinity-bearing call | with the default `unavailable`, any request that includes `customer` degrades affinity every time |
| `CUSTOMER_PROFILE_BASE_URL` | Yes, if mode=`http` | — | none | absolute URL, no credentials/query/fragment (enforced) | boot crash if mode=http and unset/malformed |
| `CUSTOMER_PROFILE_TIMEOUT_MS` | No | Yes, for http mode | `2500` | tune to Customer Profile's real p99 | n/a |

**Variables likely missing/misconfigured on the current EC2 host, based purely on the design (not verified against the live instance — this audit is read-only against the repository, not EC2):** `RELATIONSHIP_SNAPSHOT_DIR` either unset (defaulting to a relative `data/relationship-snapshots` under whatever CWD PM2 launched the process from — fragile) or set but pointing at a directory that was never populated by a `relationship:snapshot:build` run; and/or `NODE_ENV` not actually set to `production` (worth checking given docs/openapi exposure risk, independent of the reported symptoms).

---

## 13. Root-cause analysis of the observed `401`

Per §4.5, three mechanisms reproduce inconsistent 401/200 on the same route, all consistent with the evidence given (no code defect required):

1. **Stale in-memory `config.apiKeys` after an `.env` edit without a true process restart.** `config.ts` parses `process.env` exactly once, at module import (`config.ts:1,67`). If EC2's `.env` was edited (key added/rotated) and PM2 was told to `restart` in a way that does not force environment reload for that process manager version/mode, the already-running Node process keeps the *old* key list in memory indefinitely — every call using the *new* key 401s, every call using the *old* key still works, and this can look exactly like "some calls 401, some don't" depending on which key each caller happens to use.
2. **Client-side whitespace/newline in the `x-api-key` header.** The configured keys are trimmed at parse time; the incoming header is compared byte-exact and is never trimmed (`crypto.ts:7-22`). A caller whose key is captured via `$(cat keyfile)`, a `curl -H "x-api-key: $KEY"` where `$KEY` was exported with a trailing newline, or a copy-paste including an invisible character, will 401 with an otherwise-correct key.
3. **Different callers genuinely using different keys**, one of which is not (or no longer) in `CATALOG_API_KEYS`/`API_KEY` — the mundane explanation, and the first one to rule out on EC2.

**Disambiguation on EC2 (read-only, no config changes):**
- Compare `ps aux | grep node` (or `pm2 show <name>`) process start time against the `.env` file's last-modified time — if `.env` is newer than the process start, mechanism (1) applies.
- `pm2 env <id>` (PM2 ≥ 5) or inspecting `/proc/<pid>/environ` shows the *actual* environment the running process has, which can be diffed against the current `.env` file's `API_KEY`/`CATALOG_API_KEYS` values.
- Capture the exact header bytes of a failing request server-side (e.g., temporarily via an access log or `tcpdump`/reverse-proxy log showing the raw header) and diff against the configured key byte-for-byte, specifically checking for trailing whitespace — this rules in/out mechanism (2) without needing to change anything.

No code change is implicated by any of these three mechanisms; all are configuration/operational-state facts to be verified directly on the instance.

---

## 14. Root-cause conditions for the observed `503 COMMERCIAL_RECOMMENDATION_UNAVAILABLE` / `stage="commercial"`

Exact mapping, condition → exception → mapper → public code, all citations to real files/lines:

```text
Condition A — no active snapshot has ever loaded successfully in this process's lifetime
  DefaultActiveProductRelationshipSnapshotReader.activeIndex === null
    (either RELATIONSHIP_SNAPSHOT_DIR/active.json doesn't exist → getActive() returns null,
     OR getActive()/refresh() threw at startup and recommendationRuntime.ts:49-53 swallowed it
     into initialRefreshError while leaving activeIndex null)
  → findBySource() throws ProductRelationshipRuntimeError('RUNTIME_SNAPSHOT_NOT_LOADED', ...)
      [defaultActiveSnapshotReader.ts:134-140]
  → DefaultCommercialProductRecommendationService.recommend() catches it, code === 'RUNTIME_SNAPSHOT_NOT_LOADED'
      → rethrows ProductRecommendationError('RECOMMENDATION_KNOWLEDGE_NOT_LOADED', ...)
      [defaultCommercialRecommendationService.ts:113-121]
  → DefaultSearchProductsV2Service.search() try/catch around commercialRecommendationService.recommend()
      logs event="search_products_v2_failed" stage="commercial"           [defaultSearchProductsV2Service.ts:631-632]
      → throws SearchProductsV2Error('COMMERCIAL_RECOMMENDATION_UNAVAILABLE',
             'Commercial recommendations are unavailable',
             { stage:'commercial', retryable: true (error instanceof ProductRecommendationError) })
      [defaultSearchProductsV2Service.ts:628-638]
  → searchProductsV2Controller.mapSearchProductsV2ErrorToHttp(): code === 'COMMERCIAL_RECOMMENDATION_UNAVAILABLE' → 503
      [searchProductsV2Controller.ts:60-61]

Condition B — snapshot IS loaded, but the DB call that enriches candidate products with commercial data fails
  CatalogRecommendationCommercialDataProvider.getCommercialData() throws (underlying MySQL error via
      CatalogCommercialTruthService → MySqlCatalogCommercialDataReader)
  → DefaultCommercialProductRecommendationService.getCommercialData() catches it
      → throws ProductRecommendationError('COMMERCIAL_DATA_PROVIDER_FAILURE', ...)
      [defaultCommercialRecommendationService.ts:255-267]
  → same try/catch as Condition A in defaultSearchProductsV2Service.ts:628-638
      → same SearchProductsV2Error('COMMERCIAL_RECOMMENDATION_UNAVAILABLE', stage:'commercial') → same 503

Condition C (produces the SAME public code but a DIFFERENT stage — distinguishable) —
  snapshot loaded, T08 succeeded, but enriching the RESULT set (source product + recommended products)
  against the catalog fails
  → SearchProductsV2Error('COMMERCIAL_RECOMMENDATION_UNAVAILABLE', stage:'catalog')
      [defaultSearchProductsV2Service.ts:668-677]
```

**Conditions A and B are indistinguishable from the HTTP response alone** — both produce `503`, `error.code="COMMERCIAL_RECOMMENDATION_UNAVAILABLE"`, and (per the logged event at `defaultSearchProductsV2Service.ts:632`) the same `stage="commercial"`. They are only distinguishable by:
- **Correlating with `/health/ready`**: if readiness is already `degraded` with `relationshipSnapshot:'unavailable'`, Condition A is confirmed and Condition B is irrelevant (T08 never even reaches the DB call — `findBySource()` throws before `getCommercialData()` is called at all, since it's a synchronous check earlier in `recommend()`, `defaultCommercialRecommendationService.ts:107-122` runs before `:139`).
- **Cross-checking against `GET /v1/products/search` succeeding**: since Condition B requires a MySQL failure through the *same shared pool* that catalog search also uses, a healthy `/v1/products/search` response at approximately the same time makes Condition B implausible (though not impossible — it would require a query- or table-specific failure rather than a connectivity failure, since `MySqlCatalogCommercialDataReader` queries different tables/joins than `MySqlSearchProvider`).

**Given the evidence in this ticket** — `/v1/products/search` returns 200 (rules out a general DB-connectivity failure), and there is no local `data/relationship-snapshots` directory in a fresh checkout (§8.4, confirmed: `data/` does not exist in this repository checkout) — **Condition A (no active snapshot loaded) is the far more likely explanation for what was observed on EC2**, pending direct confirmation via `/health/ready`'s `relationshipSnapshot` field and the physical presence of `active.json` on the instance (§16 gives the exact commands).

---

## 15. README / documentation vs code — confirmed divergences

Per the audit's source-of-truth ordering (code > tests > config > CLI > docs), these are resolved in code's favor; documentation is flagged, not silently trusted:

1. **`README.md:57`** — *"SearchProducts V2 V1 requires both `query` and `sourceProduct`."* **Code says `query` is optional** — both the Fastify JSON-schema (`searchProductsV2Route.ts:39` `required: ['sourceProduct']` only) and the Zod contract (`contracts.ts:126-127`, `query: boundedQuerySchema.optional()`) agree, and the same route's own OpenAPI `description` text contradicts the README in the same file set (`searchProductsV2Route.ts:105-107`). Anyone building a caller strictly off the README would send `query` unnecessarily; anyone building strictly off the OpenAPI description (or this audit) knows it's optional.
2. **`README.md:186-227`** (environment variable table) **omits** seven variables that are real, consumed config: `RELATIONSHIP_SOURCE_FROM_DATE`, `RELATIONSHIP_SOURCE_TO_DATE`, `RELATIONSHIP_SOURCE_ORDER_STATES`, `RELATIONSHIP_SOURCE_EXCLUDED_PRODUCT_IDS`, `RELATIONSHIP_SOURCE_MAX_PRODUCTS_PER_ORDER`, `CUSTOMER_PROFILE_BASE_URL`, `CUSTOMER_PROFILE_TIMEOUT_MS` — all present in `.env.example` and all read by `config.ts`. The README table is a subset, not the full picture; `.env.example` and `config.ts` (§12) are the complete and authoritative list.
3. **`README.md:47-48`** describes `/health/ready` as covering only "database/Redis checks" — the actual implementation also gates on the relationship snapshot (`server.ts:21,27`, `app.ts:167`), which the README's own architecture section elsewhere implies matters but doesn't state explicitly in the health-check row.

No divergence was found between the architecture-diagram concept (T01–T11) and the actual composition root's wiring order — the README's high-level pipeline shape (`normalizer → calculator → reliability → validator → publisher → runtime reader → commercial → affinity → personalization → V2`) matches `bootstrap.ts`/`recommendationRuntime.ts`/`defaultRelationshipSnapshotBuildService.ts` faithfully; only the two specific claims above were found to be wrong or incomplete.

---

## 16. Risks / deployment debts (findings independent of the two reported incidents)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| 1 | `/health/ready`'s Redis ping failure is misreported as a database failure | `server.ts:14-30` — `cache.ping()` call is inside the same `try` as `repository.ping()`, and the `catch` unconditionally sets `database:'unavailable'` | Only relevant once `CACHE_DRIVER=redis` is adopted; today (`memory` driver) this code path for Redis is never exercised, so it does not explain current symptoms, but would produce a misleading readiness signal if Redis is introduced later without also fixing this |
| 2 | `DatabaseUnavailableError` and `CatalogQueryFailedError` are defined but never thrown anywhere in `src/` | `grep -rn "DatabaseUnavailableError\|CatalogQueryFailedError" src/` matches only their own definitions in `shared/errors.ts` | A raw DB connectivity/timeout failure on any catalog endpoint surfaces as an undifferentiated `500 INTERNAL_ERROR` instead of a more actionable `503`, and the error-code taxonomy documented by the class names' existence overstates what actually happens at runtime |
| 3 | `ENABLE_METRICS` is parsed into `config.observability.enableMetrics` but never read anywhere else | `grep -rn "enableMetrics" src/` matches only the assignment in `config.ts:179` | Setting `ENABLE_METRICS=false` has zero effect — `/metrics` is always registered; only `METRICS_REQUIRE_API_KEY` has any real effect on that route |
| 4 | No periodic/triggered refresh of the relationship snapshot reader | Sole `refresh()` call in the codebase is `recommendationRuntime.ts:50`, at startup | A snapshot rebuilt+activated while the server is running is invisible to that running process until it is restarted — an easy step to forget in a deploy runbook, and the exact kind of gap that produces "we rebuilt it and it's still 503" confusion |
| 5 | `RELATIONSHIP_SNAPSHOT_DIR` default is a relative path (`data/relationship-snapshots`) | `.env.example:35`, `config.ts:56` | If PM2 (or any supervisor) launches the process from a different working directory than expected (e.g., after a symlink-swap deploy strategy), a relative default silently resolves to the wrong location — an absolute path removes this class of surprise entirely |
| 6 | `DB_PASSWORD` passes startup validation even as an empty string | `config.ts:39` — `z.string()` with no `.min(1)`, unlike `DB_HOST`/`DB_USER`/`DB_NAME` which do have `.min(1)` | Not exploitable by itself (MariaDB would still require a real password to auth), but it means a misconfigured/empty password does not fail fast at process boot the way a missing `DB_HOST` does — the failure only surfaces later, as a DB connection error (and per finding #2, as an undifferentiated 500) |
| 7 | No `ecosystem.config.js`, systemd unit, or any process-manager config file exists in this repository | `find . -iname "ecosystem*" -o -iname "Procfile" -o -iname "*.service"` → no matches (outside `node_modules`) | Whatever PM2 invocation is running on EC2 today was constructed out-of-band, is not version-controlled, and cannot be audited from this repository — the deployment runbook (§17 in the task, delivered as §11-equivalent below) must be treated as advisory scaffolding, not a verified description of what's actually running |
| 8 | Batch endpoint always returns HTTP 200 | `catalogService.ts:307-339` | Any caller or monitoring check that treats `/v1/products/batch`'s HTTP status as a correctness signal will miss per-item failures entirely — they must inspect each `items[].ok` field |

---

## 17. EC2 deployment runbook

This section is derived strictly from `package.json` scripts, `src/cli/buildRelationshipSnapshot.ts`, `src/server.ts`'s expectations, and the file-based facts in §8–§12. No `ecosystem.config.js` exists in this repository (finding #7 above) — none is invented here; PM2 invocation is described in terms of the two script entry points the repo actually defines (`npm start` / `node dist/src/server.js`), and left to whatever process-manager wrapper already exists on the instance.

### 17.1 First deployment

```bash
# 1. Fetch code
git clone <repo-url> catalog-service
cd catalog-service

# 2. Install exact locked dependencies (package-lock.json is present and should be respected)
npm ci

# 3. Configure environment — .env is git-ignored and must be created on the instance
cp .env.example .env
# edit .env: at minimum DB_HOST/DB_USER/DB_PASSWORD/DB_NAME, API_KEY or CATALOG_API_KEYS,
# NODE_ENV=production, and an ABSOLUTE RELATIONSHIP_SNAPSHOT_DIR (see risk #5, §16)

# 4. Compile TypeScript — required because `npm start` runs dist/src/server.js, not src/ directly
npm run build

# 5. Build (and activate) the initial relationship snapshot BEFORE first start —
#    this is a separate command from the build step above; it is a data pipeline run, not a compile step.
#    Requires RELATIONSHIP_SOURCE_FROM_DATE to be set in .env (see §9) and DB reachability.
npm run relationship:snapshot:build
# confirm success: command prints a JSON summary to stdout and exits 0;
# confirm the files physically exist per §8.4:
#   test -f "$RELATIONSHIP_SNAPSHOT_DIR/active.json" && \
#   test -f "$RELATIONSHIP_SNAPSHOT_DIR/snapshots/$(node -e "console.log(require('fs').readFileSync(process.env.RELATIONSHIP_SNAPSHOT_DIR+'/active.json','utf8'))" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).snapshotId.replace('sha256:','')").json"

# 6. Start the process (see §17.3 for the PM2 invocation shape)
pm2 start dist/src/server.js --name catalog-service
pm2 save

# 7. Verify readiness BEFORE declaring the deploy done — see §18
curl -s http://127.0.0.1:$PORT/health/ready | jq
# must show status:"ok" and relationshipSnapshot:"ok" — if degraded, do not proceed to smoke tests yet

# 8. Run the smoke test battery — §18
```

### 17.2 Subsequent deployment

```bash
git fetch origin
git pull origin main
npm ci                      # always — package-lock.json can change between deploys, and a stale
                             # node_modules is a common source of drift; cheap relative to the risk
npm run build                # always — dist/ is compiled output and must be regenerated from the new src/;
                              # npm start runs dist/src/server.js, a stale dist/ silently serves old code
pm2 restart catalog-service --update-env
                              # --update-env is REQUIRED whenever .env changed (key rotation, new
                              # RELATIONSHIP_* var, etc.) — see §13, mechanism (1). Omitting it when .env
                              # is unchanged is harmless but there is no reason to omit it as a habit.
```

**What must happen to snapshots on a subsequent deploy:** nothing, automatically — a normal code deploy does **not** touch `RELATIONSHIP_SNAPSHOT_DIR` at all (it lives outside the deploy directory tree if configured per risk #5's recommendation, and `git pull`/`npm ci`/`npm run build` never write to it). The already-active snapshot survives a redeploy untouched and the restarted process reloads it fresh from disk at startup (§7-§8) — this is a *feature*, not a gap: recommendation data does not need to be rebuilt on every code deploy. **Only** rebuild+reactivate a snapshot (`npm run relationship:snapshot:build`, §9) when you specifically want to refresh the underlying relationship data — and when you do, a subsequent `pm2 restart` is required for the running process to pick it up (§9, finding #4).

**Answers to the explicit questions asked:**
- **Is `npm ci` always necessary?** Yes, as a matter of discipline — it is cheap relative to the risk of a stale `node_modules` diverging from a changed `package-lock.json`. The code does not *require* it if dependencies genuinely didn't change, but there is no reliable way to know that from outside without just running it.
- **Is `npm run build` always necessary?** Yes, whenever `src/` changed and the process is (correctly) started via `npm start`/`node dist/src/server.js` — `dist/` is compiled output, not tracked by Git-driven runtime behavior; skipping the build after a `git pull` silently keeps serving the previous version's compiled code.
- **Are there migrations?** None found — no migration tool, no `migrations/` directory, no schema-modifying SQL anywhere in this repository. The service is explicitly read-only against PrestaShop's schema (confirmed by every SQL statement audited in §5–§6 being a `SELECT`).
- **Are there offline jobs?** Yes — exactly one: `npm run relationship:snapshot:build` (§9). It is not scheduled by anything in this repo; whether/how it runs periodically is an operational decision made outside this codebase.
- **Are there runtime files Git does not provide?** Yes — `.env` (git-ignored) and everything under `RELATIONSHIP_SNAPSHOT_DIR` (git-ignored via `.gitignore:5`). Both must exist on the instance independent of any `git pull`.
- **Should PM2 run `npm start` or `node dist/src/server.js`?** They are equivalent — `package.json:9` defines `"start": "node dist/src/server.js"`, so `npm start` is a thin wrapper around the exact same command. Either is correct as long as `dist/` was just rebuilt (previous point) and the working directory is the repository root (next point).
- **Expected working directory:** the repository root — `RELATIONSHIP_SNAPSHOT_DIR`'s default is relative to `process.cwd()` (risk #5), and `dotenv/config`'s default `.env` lookup is also relative to `process.cwd()`. PM2 must be configured to launch from (or `cwd:` set to) the repo root, not some other directory.
- **How should `.env` be loaded?** Via `dotenv/config`, imported as the very first line of `config.ts` (`config.ts:1`) — this reads a `.env` file from the process's current working directory at startup. PM2 does not need to inject env vars itself as long as `.env` is present in the correct working directory and readable by the service user; if PM2 *is* additionally configured to inject env vars directly (bypassing the `.env` file), those take precedence over `.env` per Node's normal `process.env` semantics, and `--update-env` becomes mandatory on every `pm2 restart` for such vars to ever change.
- **Does `--update-env` matter?** Yes — directly implicated in the observed 401s (§13). Always include it on `pm2 restart` for this service.

### 17.3 PM2 invocation (advisory — no `ecosystem.config.js` exists in-repo to confirm against, per risk #7)

```bash
pm2 start dist/src/server.js --name catalog-service --cwd /path/to/catalog-service
```

or, if an `ecosystem.config.js` is later introduced (not currently present — do not assume one exists on EC2 without checking):

```js
// NOT present in this repo today — illustrative only if/when one is added
module.exports = {
  apps: [{
    name: 'catalog-service',
    script: 'dist/src/server.js',
    cwd: '/path/to/catalog-service',
    env: { NODE_ENV: 'production' },
  }],
};
```

---

## 18. Post-deploy smoke test

All commands assume `BASE_URL` (e.g. `http://127.0.0.1:4010`), `API_KEY` (a valid configured key), and — for the SearchProducts V2 checks — `SOURCE_PRODUCT_ID` known in advance to have relationships in the currently-active snapshot (obtainable from the JSON summary printed by the last successful `relationship:snapshot:build` run, or by inspecting `snapshots/<hash>.json` directly for a `sourceProduct` with a non-empty relationship list).

```bash
# 1. Liveness — must always be 200, independent of any dependency
curl -s -o /dev/null -w '%{http_code}\n' "$BASE_URL/health/live"
# expect: 200

# 2. Readiness — the single most informative check; run before anything else below
curl -s "$BASE_URL/health/ready" | tee /tmp/ready.json
curl -s -o /dev/null -w '%{http_code}\n' "$BASE_URL/health/ready"
# expect: 200 and jq '.checks' shows {database:"ok", redis:"ok", relationshipSnapshot:"ok"}
# if relationshipSnapshot:"unavailable" here, STOP — SearchProducts V2 WILL 503, and this is not a
# separate incident, it is the same root cause surfacing twice (§14)

# 3. Auth negative — protected route without a key must reject
curl -s -o /dev/null -w '%{http_code}\n' "$BASE_URL/v1/products/search?q=barra"
# expect: 401

# 4. Auth positive — same route, with the currently-configured key
curl -s -o /dev/null -w '%{http_code}\n' -H "x-api-key: $API_KEY" "$BASE_URL/v1/products/search?q=barra"
# expect: NOT 401 (200 expected if the query matches active in-stock products; a 200 with items:[] is
# still a pass for this specific check — the point here is proving the key is accepted)

# 5. Catalog search — proves DB reachability end to end
curl -s -H "x-api-key: $API_KEY" "$BASE_URL/v1/products/search?q=barra" | jq '.items | length'
# expect: 200, a JSON body with an `items` array (length >= 0; >0 only if "barra" matches real stock)

# 6. Product detail — use a productId confirmed to exist from step 5's output
PRODUCT_ID=$(curl -s -H "x-api-key: $API_KEY" "$BASE_URL/v1/products/search?q=barra" | jq -r '.items[0].productId')
curl -s -o /dev/null -w '%{http_code}\n' -H "x-api-key: $API_KEY" "$BASE_URL/v1/products/$PRODUCT_ID"
# expect: 200 (404 only if the product from step 5 was deactivated between calls — re-run step 5)

# 7. Batch — remember: this ALWAYS returns 200 at the transport level; inspect the body
curl -s -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d "{\"items\":[{\"productId\":$PRODUCT_ID}]}" \
  "$BASE_URL/v1/products/batch" | jq '.items[0].ok'
# expect: `true` — a `false` here with the transport still 200 means the underlying per-item lookup
# failed (check .items[0].error.code); this is NOT the same as an HTTP-level failure

# 8. SearchProducts V2 — the one that must differentiate outcomes, not just report pass/fail
STATUS=$(curl -s -o /tmp/v2.json -w '%{http_code}' -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' \
  -d "{\"sourceProduct\":{\"productId\":\"$SOURCE_PRODUCT_ID\"},\"limit\":5}" \
  "$BASE_URL/api/v2/recommendations/search-products")
echo "HTTP $STATUS"; cat /tmp/v2.json | jq '.'
```

**Interpreting step 8's result — this is the check the user specifically asked to be able to disambiguate:**

| Observed | Meaning |
|---|---|
| HTTP 503, `error.code="COMMERCIAL_RECOMMENDATION_UNAVAILABLE"` | Endpoint reachable but the recommendation group is not ready — correlate immediately with step 2's `relationshipSnapshot` field; if that was already `unavailable`, this is Condition A from §14 (no active snapshot), not a new failure |
| HTTP 200, `recommendations: []`, `warnings` containing `NO_COMMERCIAL_CANDIDATES` | Snapshot **is** loaded and working — this specific `SOURCE_PRODUCT_ID` simply has no relationships in it. Re-run with a different, known-connected product id before concluding anything is broken |
| HTTP 200, `execution.degraded: true`, warning `CUSTOMER_AFFINITY_UNAVAILABLE` | Commercial recommendations worked; customer affinity degraded (only relevant if the test request included a `customer` object — omit `customer` from the smoke-test body to isolate the commercial path from the affinity path) |
| HTTP 200, `execution.degraded: false`, non-empty `recommendations` | Full success — snapshot loaded, relationships found, (if `customer` was sent) affinity resolved cleanly |
| HTTP 404 `SOURCE_PRODUCT_NOT_FOUND` / 409 `SOURCE_PRODUCT_INACTIVE` | `SOURCE_PRODUCT_ID` itself is wrong/inactive — fix the test input, not the service |
| HTTP 401 | Same auth investigation as step 3/4 — re-run step 4 first to isolate whether this is auth or V2-specific |

---

## 19. Current EC2 expected-vs-observed gap

| Signal | Code-derived expectation | Reported observation | Gap |
|---|---|---|---|
| `GET /v1/products/search?q=barra` | 200 if DB reachable, key valid, and query matches active/in-stock products | 200 | **No gap** — matches expectation for a working catalog path with no recommendation-engine dependency |
| `POST /api/v2/recommendations/search-products` | 503 `COMMERCIAL_RECOMMENDATION_UNAVAILABLE` iff no active relationship snapshot was loaded at process start (or, less likely given DB is otherwise healthy, a commercial-data DB call specifically failing) | 503 `COMMERCIAL_RECOMMENDATION_UNAVAILABLE` | **No gap between code and this specific observation** — this is the designed response to a missing/failed snapshot load, not an anomaly. The gap, if any, is operational: has `relationship:snapshot:build` ever been run against this EC2 host's `RELATIONSHIP_SNAPSHOT_DIR`, and does the running process's `RELATIONSHIP_SNAPSHOT_DIR` value match where that build wrote its files? |
| Some HTTP calls | 401 only for missing/wrong/malformed key | 401 on "some calls" | Cannot be closed from the repository alone — requires the three checks in §13 run directly against the EC2 instance (process env vs `.env` file freshness; raw incoming header bytes vs configured keys) |

This audit cannot verify EC2's actual filesystem, environment, or PM2 state — it is a **read-only repository audit**, not a review of the live instance. §13's disambiguation steps and §18's smoke tests are the intended next actions to close this table's remaining "cannot be closed from the repository alone" cells in a single pass, exactly as requested.

---

## 20. Final verdict

### Category

**`RUNTIME_DESIGN_CLEAR_EC2_MISCONFIGURED`**

Justification: every observed symptom (401 on some calls, 503 with `stage="commercial"` on SearchProducts V2, 200 on catalog search) is fully and precisely explained by intentional, traceable code behavior — the auth gate, the once-at-startup snapshot load, and the commercial-stage error mapping all work exactly as written, with test coverage consistent with that design (`tests/unit/security.test.ts`). Nothing in the traced call graphs required guessing or produced an unexplained state. The gap is entirely between the *design's requirements* (a populated `RELATIONSHIP_SNAPSHOT_DIR` present before start; a process environment that matches the current `.env`) and what is *actually present on the EC2 instance* — which this repository-only audit cannot observe directly, but which §13/§14/§18 give a closed, deterministic procedure to verify in one pass. Two independent, real code-quality issues were found along the way (§16, #1 and #2) and are reported for completeness, but neither is the cause of the two reported incidents, and neither rises to a defect that would change this category (they do not make the system's behavior unpredictable — they make one already-rare edge case's diagnostics slightly less precise).

### Capability table

| Capability | Code status | Runtime dependency | Expected EC2 requirement | Current likely state |
|---|---|---|---|---|
| Liveness | Implemented, unconditional | none | none | Working (implied by the service being reachable at all) |
| Readiness | Implemented, checks DB + Redis(if enabled) + relationship snapshot | DB, snapshot, conditionally Redis | must report `ok` before traffic is considered safe | Very likely `degraded` (`relationshipSnapshot:"unavailable"`) given the reported 503 — **verify with §18 step 2** |
| Catalog search | Implemented, DB-only | MariaDB/PrestaShop via shared pool | DB reachable, correct `PRESTASHOP_*` scoping | **Working** — confirmed by the reported 200 |
| Product detail | Implemented, DB-only (+ weight/stock/price guards) | same as search | same as search | Very likely working (not reported broken; same dependency surface as search) |
| Batch lookup | Implemented, DB-only, always-200 transport | same as search, per item | same as search | Very likely working; verify per-item `ok` flags, not just transport status |
| Commercial recommendations (T08) | Implemented | Active relationship snapshot (T07) + DB | `RELATIONSHIP_SNAPSHOT_DIR/active.json` + referenced snapshot file present **before process start** | **Very likely NOT ready** — matches the reported 503 exactly |
| Customer affinity (T09) | Implemented, three modes | none (unavailable/empty) or Customer Profile HTTP (http mode) | only required if `CUSTOMER_AFFINITY_PROVIDER_MODE=http` and a caller sends `customer` | Not implicated by either reported symptom (affinity failures degrade, never 503 the request) — mode not verifiable from this repo alone |
| Personalized recommendations (T10) | Implemented | T08 output + T09 output | same as T08 (T10 cannot run if T08 hard-fails) | Blocked transitively by the same snapshot gap as T08 |
| SearchProducts V2 (T11) | Implemented | T08 (hard), T09 (soft/degradable), catalog DB (hard) | all of the above | **Confirmed broken by the reported 503**, root cause per §14 Condition A (pending on-instance confirmation) |

**Recommended next action:** run §18's readiness check (step 2) on the EC2 instance first — its `relationshipSnapshot` field alone will confirm or rule out §14's Condition A in one call, before touching anything else. Then run §13's three disambiguation checks for the 401. Neither requires any code, config, or infrastructure change — both are read-only verification steps consistent with this audit's scope.
