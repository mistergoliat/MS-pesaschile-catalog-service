# CAT-R1-T13A — Product Weight Authority and Contract Audit

Status: **Audit only. Nothing in this document has been implemented.** No code, schema, or contract in the Catalog Service was changed while producing it.

Scope: determine how `ps_product.weight` should enter the Catalog Service contract so that Carrier/Shipping (via CRM / Sales Agent) can obtain authoritative product weight without querying PrestaShop directly.

---

## 1. Veredicto

```text
PRODUCT_WEIGHT_READY_FOR_ADDITIVE_CONTRACT
```

`ps_product.weight` is a `NOT NULL DECIMAL(20,6)` column, unit `kg` (confirmed via `PS_WEIGHT_UNIT`), with no `NULL`s, no negatives, and a plausible distribution for a gym-equipment catalog (0.1 kg – 826 kg). 97.9% of active products carry a positive, plausible weight. Combination-level weight impact exists in the schema but is empirically **zero across every row in production** (`ps_product_attribute.weight` and `ps_product_attribute_shop.weight`), so it does not block anything today — it only needs to be included in the read formula so the contract stays correct if that ever changes. A narrow, named set of 15 active/in-stock PACK (bundle) SKUs currently show `weight = 0`, which is a real but bounded data-quality gap, not a systemic blocker.

This verdict is conditional on two implementation requirements documented below, neither of which is a blocker for *deciding* the contract now:

1. The read path must compute `base + combination impact`, not `base` only (cheap, mirrors the existing price-impact pattern; see §5).
2. The field must be added to the shared Zod schema in `src/shared/contracts.ts`, not only to internal TypeScript types, or Fastify will silently drop it from the wire response (see §12).

---

## 2. Fuente autoritativa

```text
ps_product.weight  (base weight, per product, unit = kg)
```

confirmed by:

```sql
SELECT name, value FROM ps_configuration WHERE name = 'PS_WEIGHT_UNIT';
-- PS_WEIGHT_UNIT = 'kg'
```

Combination-level weight impact, when non-zero, is layered on top of the base via the standard PrestaShop shop-override pattern already used for price elsewhere in this codebase:

```text
effective weight = ps_product.weight
                  + COALESCE(ps_product_attribute_shop.weight, ps_product_attribute.weight, 0)
```

No other table carries weight. `ps_product_shop` (the per-shop product override table used for price and `available_for_order`) has **no** weight column — weight is not shop-scoped at the base-product level, only at the combination level.

---

## 3. Estructura SQL

Live schema, read via `SHOW COLUMNS`:

```sql
SHOW COLUMNS FROM ps_product WHERE Field IN ('weight','width','height','depth');
```

| Field  | Type            | Null | Default   |
|--------|-----------------|------|-----------|
| weight | decimal(20,6)   | NO   | 0.000000  |
| width  | decimal(20,6)   | NO   | 0.000000  |
| height | decimal(20,6)   | NO   | 0.000000  |
| depth  | decimal(20,6)   | NO   | 0.000000  |

```sql
SHOW COLUMNS FROM ps_product_attribute WHERE Field IN ('weight');
SHOW COLUMNS FROM ps_product_attribute_shop WHERE Field LIKE '%weight%';
SHOW COLUMNS FROM ps_product_shop WHERE Field LIKE '%weight%';
```

| Table                         | weight column | Null | Default   |
|--------------------------------|---------------|------|-----------|
| ps_product_attribute           | decimal(20,6) | NO   | 0.000000  |
| ps_product_attribute_shop      | decimal(20,6) | NO   | 0.000000  |
| ps_product_shop                | *(none)*      | —    | —         |

`ps_product_attribute` also has `unit_price_impact`, confirming `weight` on that table follows the same "impact" convention as price (a delta added to the base, not an absolute override).

### Distribution queries (run read-only against the production PrestaShop DB, `pesas_productiva`, via the existing `pc_consultor` read-only credentials already configured in this service's `.env`)

```sql
-- population
SELECT COUNT(*) FROM ps_product WHERE active = 1;                 -- 1050
SELECT COUNT(*) FROM ps_product;                                   -- 1587 (active + inactive)

-- nullability / sign
SELECT COUNT(*) FROM ps_product WHERE active = 1 AND weight IS NULL; -- 0 (impossible: column is NOT NULL)
SELECT COUNT(*) FROM ps_product WHERE active = 1 AND weight = 0;     -- 22
SELECT COUNT(*) FROM ps_product WHERE active = 1 AND weight > 0;     -- 1028
SELECT COUNT(*) FROM ps_product WHERE active = 1 AND weight < 0;     -- 0

-- distribution (weight > 0)
SELECT MIN(weight), MAX(weight), AVG(weight), STDDEV(weight), COUNT(*)
FROM ps_product WHERE active = 1 AND weight > 0;
-- min=0.1, max=826, avg=52.76, stddev=93.29, n=1028

-- bucketed distribution (active products)
SELECT CASE
    WHEN weight = 0 THEN '0'
    WHEN weight <= 1 THEN '0-1kg'
    WHEN weight <= 5 THEN '1-5kg'
    WHEN weight <= 20 THEN '5-20kg'
    WHEN weight <= 100 THEN '20-100kg'
    WHEN weight <= 1000 THEN '100-1000kg'
    ELSE '>1000kg' END AS bucket, COUNT(*)
FROM ps_product WHERE active = 1 GROUP BY bucket ORDER BY COUNT(*) DESC;

-- outlier sanity check
SELECT id_product, reference, weight, price
FROM ps_product WHERE active = 1 ORDER BY weight DESC LIMIT 15;

-- in-stock scope (what Carrier would actually see today)
SELECT
  SUM(CASE WHEN p.weight = 0 THEN 1 ELSE 0 END) AS zeroWeight,
  SUM(CASE WHEN p.weight > 0 THEN 1 ELSE 0 END) AS positiveWeight,
  COUNT(*) AS total
FROM ps_product p
INNER JOIN ps_stock_available sa
  ON sa.id_product = p.id_product AND sa.id_product_attribute = 0 AND sa.id_shop = 1
WHERE p.active = 1 AND sa.physical_quantity > 0;
-- zeroWeight=10, positiveWeight=792, total=802
```

### Results

| Metric | Value |
|---|---|
| Active products | 1050 |
| Total products (active + inactive) | 1587 |
| `weight IS NULL` (active) | 0 — structurally impossible, column is `NOT NULL` |
| `weight = 0` (active) | 22 (2.1%) |
| `weight > 0` (active) | 1028 (97.9%) |
| `weight < 0` (active) | 0 |
| Min / Max / Avg / StdDev (weight > 0, active) | 0.1 / 826 / 52.76 / 93.29 kg |
| Inactive products, `weight = 0` | 21 of 537 |

Bucketed distribution (active products):

| Bucket | Count |
|---|---|
| 20–100 kg | 288 |
| 0–1 kg | 243 |
| 5–20 kg | 209 |
| 100–1000 kg | 164 |
| 1–5 kg | 124 |
| 0 kg | 22 |

Top outliers (max=826 kg) are large gym machines (e.g. `PRMC2`, `V8-600A`, `OB-MO2-DZ51`) — plausible for this catalog (Pesas Chile sells strength-training equipment), not data-entry errors. No negative values, no implausibly tiny values (nothing in the 0.001–0.099 kg range).

### The 22 active, zero-weight products, individually enumerated

```sql
SELECT p.id_product, p.reference, p.weight, pl.name
FROM ps_product p
INNER JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_shop = 1 AND pl.id_lang = 1
WHERE p.active = 1 AND p.weight = 0
ORDER BY p.id_product ASC;
```

They break down cleanly into three groups (2 + 5 + 15 = 22):

| Group | Count | Examples | Assessment |
|---|---|---|---|
| Internal/non-catalog service SKUs, already excluded from discovery via `DISCOVERY_EXCLUDED_PRODUCT_IDS` | 2 | `id_product 444` "Servicio vendedor Pesas Chile", `505` "Costo logistico" | Correctly zero — non-physical, never shipped |
| Installation/assembly service SKUs | 5 | `554–558` "Servicio de armado tipo A-10..A-PC" | Correctly zero — labor service, not shipped |
| **PACK / bundle SKUs (physical, shippable)** | **15** | `941 PBM100`, `942 PBM150`, `945 PCBH`, `946 PCEC`, `947 PCGH`, `949 PDBCH`, `961 PDPCH`, `968 PHDOA`, `978 PKVR2`, `988 PPMBB`, `989 PPMBP`, `991 PPMY50B`, `992 PPPRO03`, `993 PSDOA`, `1002 RH19PVC` | **Data-quality gap** — these are physical, currently in stock, discoverable products with no weight entered |

This is a real gap, but it is small (15 / 1050 ≈ 1.4% of active catalog), fully named, and does not block adding the contract. It does mean Carrier cannot trust `weightKg = 0` as "confirmed zero" for these 15 SKUs specifically until PrestaShop data is backfilled — see §12 (Riesgos).

---

## 4. Semántica de peso

| Question | Answer | Evidence |
|---|---|---|
| Does `0` mean literally 0 kg? | For 7 of the 22 zero-weight active products (the excluded service + assembly-service SKUs), yes, genuinely. For the other 15 (PACK SKUs), no — it means "never entered." | §3 breakdown |
| Should `0` be normalized to `null`? | **No.** The column is `NOT NULL`; there is no source-level signal to distinguish "true zero" from "not entered." Silently converting `0 → null` would fabricate a distinction the data doesn't support, and would make the 7 legitimately-zero-weight service SKUs behave identically to the 15 data-gap SKUs in the API, hiding the exact information a Carrier caller would need to build a fallback rule. | `SHOW COLUMNS` — column is `NOT NULL DEFAULT 0.000000` |
| Should "unknown weight" be distinguishable from "zero weight" in the contract? | Yes, but at the **product identity** level, not by overloading the number. `weightKg` should carry the literal stored value (including legitimate `0`); "unknown" should only ever be represented by the whole field being absent/null, and that null case should be reserved for products/combinations that don't resolve at all (an existing, pre-established behavior shared with `pricing`/`stock`), not invented for weight specifically. | `ProductDetail.pricing` / `.stock` are already `T \| null` for the same "selected combination didn't resolve" reason — see `src/domain/catalog/types.ts:57-58` |
| Precision | Source is `DECIMAL(20,6)`. Recommend rounding to 3 decimal places (gram-level) at the read boundary for a stable wire value, using the existing `Decimal` / `ROUND_HALF_UP` helper pattern already established in `src/shared/money.ts` (`toPercent` rounds to 4 places the same way). | `src/shared/money.ts:35-37` |
| Rounding | `ROUND_HALF_UP`, consistent with the rest of the codebase (`Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })` in `money.ts`). | same |
| Invalid values (negative) | None found in production today (`weight < 0` count = 0, both `ps_product` and `ps_product_attribute`). No defensive handling exists yet because none has ever been needed. Recommend treating a *resultant* negative effective weight (base + a hypothetical negative combination impact) as an error condition to guard against in the formula, mirroring how `SPECIFIC_PRICE_INVALID_REDUCTION` already guards a different arithmetic edge case. | Query evidence + `CatalogCommercialWarningCode` in `src/domain/catalog/commercial-truth/contracts.ts:25-35` |

Recommended contract:

```ts
weightKg: number | null
```

- Non-null whenever the product and its selected combination resolve (the normal case — ~100% of active, in-stock lookups today).
- Null only in the same pre-existing edge case that already nulls `pricing`/`stock` (a product has combinations but none resolves as the default/selected one) — this task does not introduce a new null-producing scenario, it follows the one that already exists.
- `0` is passed through literally, never coerced to `null`.

---

## 5. Combinaciones

**Explicitly determined, not assumed:**

```text
B. peso efectivo = peso base + impacto de combinación
```

...is the architecturally correct formula (PrestaShop's own convention — `ps_product_attribute.weight` and its shop-override `ps_product_attribute_shop.weight` are impact/delta columns, exactly like `ps_product_attribute.price`, which this codebase already treats as an impact and adds to the base via `COALESCE(pas.price, pa.price, 0)` in `getBasePrices()` / `getVariants()`, `src/infrastructure/repositories/mysqlCatalogRepository.ts:144,426`).

**But empirically, today:**

```sql
SELECT COUNT(*) AS totalCombinations,
       SUM(CASE WHEN weight = 0 THEN 1 ELSE 0 END) AS zeroWeight,
       SUM(CASE WHEN weight <> 0 THEN 1 ELSE 0 END) AS nonZeroWeight,
       MIN(weight), MAX(weight)
FROM ps_product_attribute;
-- totalCombinations=453, zeroWeight=453, nonZeroWeight=0, min=0, max=0

SELECT COUNT(*) AS totalRows,
       SUM(CASE WHEN weight <> 0 THEN 1 ELSE 0 END) AS nonZeroWeight,
       MIN(weight), MAX(weight)
FROM ps_product_attribute_shop WHERE id_shop = 1;
-- totalRows=461, nonZeroWeight=0, min=0, max=0

SELECT COUNT(DISTINCT pa.id_product) AS activeProductsWithCombinations
FROM ps_product_attribute pa INNER JOIN ps_product p ON p.id_product = pa.id_product
WHERE p.active = 1;
-- 109 active products have combinations (out of 1050)
```

Every one of the 453 `ps_product_attribute` rows and all 461 `ps_product_attribute_shop` rows (both scopes checked, not just the base combination table) has `weight = 0`. **Combination weight impact is architecturally present but currently inert across the entire catalog.** `A` (base weight alone) and `B` (base + impact) currently produce identical results for all 109 combination-bearing products.

**Recommendation:** implement `B` anyway, from day one. The formula (`base + COALESCE(pas.weight, pa.weight, 0)`) is a direct copy of the existing, already-tested price-impact pattern, costs one extra `LEFT JOIN` that the variant query already performs for price, and closes off a silent-drift risk: if a merchandiser ever populates a non-zero combination weight in PrestaShop (exactly as they already do for price), a Catalog Service that only read `ps_product.weight` would return a silently wrong weight to Carrier with no test or alert catching the regression, because nothing today exercises that path. Implementing `B` now means no follow-up migration is ever needed for this.

This does **not** change the verdict to `PRODUCT_WEIGHT_REQUIRES_COMBINATION_RESOLUTION` — there is no unresolved ambiguity blocking the decision, only an implementation detail to get right once building starts.

---

## 6. Contrato HTTP actual

| ENDPOINT | CURRENT PRODUCT CONTRACT | PRICE | STOCK | COMBINATION | WEIGHT | CHANGE REQUIRED |
|---|---|---|---|---|---|---|
| `GET /v1/products/search` (search_products) | `searchItemSchema[]` — `productId, combinationId, sku, name, variantLabel, shortDescription, physicalQuantity, available, matchType` | No price field at all (discovery only) | `physicalQuantity`, `available` (boolean) | `combinationId` present, no per-combination detail beyond stock | **Absent** | None — discovery endpoint, no established need for weight (see §8) |
| `GET /v1/products/:productId` (get_product_details) | `productResponseSchema` — `product` (core), `publicLink`, `selectedVariant`, `attributes`, `variants[]`, `pricing`, `stock`, `freshness` | `pricing.effectiveUnitPrice` (tax-included, resolved for quantity/customer/currency/country) | `stock.physicalQuantity`, `stock.available`, `stock.shopId` | `selectedVariant`, `variants[]` (each with `impactPrice`, own stock) | **Absent** | **Yes** — add `weightKg` at `ProductDetail` root, sibling to `pricing`/`stock` |
| `POST /v1/products/batch` (batch_get_products) | `batchResponseSchema` — array of `{ ok, input, product: ProductDetail }` or `{ ok, input, error }` | Same as above, per item | Same as above, per item | Same as above, per item | **Absent** | **Yes, automatically** — reuses `ProductDetail`/`CatalogApplicationService.getProduct()`, so the get_product_details change alone covers this endpoint with no extra code |
| `POST /v1/products/explore` (explore_catalog) | `exploreProductsResponseSchema` — `products[]` with `productId, name, price, currency, stockQuantity, stockScope, availability` | `price` (nullable, net-ish resolved amount) | `stockQuantity` (product or aggregated) | Combinations only affect aggregated stock, not exposed individually | **Absent** | None for now — no stated browse/discovery use case for weight (see §8) |
| `POST /api/v2/recommendations/search-products` (recommend_catalog_products) | `searchProductsV2ResultSchema` — `recommendations[].product` (`CatalogProductSummary`: `price`, `stock`, `availability`, `pricing`, `publicLink`, ...) | `pricing` (full resolved object) | `stock.status/quantity/available` | `combinationId` optional on the reference | **Absent** | None for now — no ranking/relevance use for weight today (see §8) |

Adapters / repositories backing each row (three **independent** SQL read paths exist — important for scoping):

- `search_products` → `MySqlSearchProvider` → `MySqlCatalogRepository.getSearchCandidates()`
- `get_product_details` / `batch_get_products` → `CatalogApplicationService.getProduct()` → `MySqlCatalogRepository.getProductCore()` / `.getVariants()` (**shared path — the leverage point**)
- `explore_catalog` → `MySqlCatalogExploreDataReader.readProducts()` (separate query, separate file)
- `recommend_catalog_products` → `CatalogRecommendationCommercialDataProvider` → `CatalogCommercialTruthService` → `MySqlCatalogCommercialDataReader.read()` (separate query, separate file)

No DTO, schema, fixture, or test anywhere in this repository currently mentions product weight. (A repo-wide case-insensitive search for `weight` only matches unrelated *scoring* weights inside the recommendation/personalization engine — `customerAffinityScorer`, `personalizedRecommendationScorer`, etc. — not physical product weight.)

---

## 7. Contrato recomendado

```ts
// sibling of `pricing` and `stock` on ProductDetail / productResponseSchema
weightKg: number | null
```

Rules:

- Represents the **resolved** weight for exactly the `(productId, selectedVariant.combinationId)` pair already being returned — `base` when no combination is selected, `base + combination impact` when one is.
- Rounded to 3 decimal places (gram precision) via a `Decimal`/`ROUND_HALF_UP` helper mirroring `src/shared/money.ts`.
- `null` only when `pricing`/`stock` are also `null` (pre-existing "no resolvable default combination" edge case) — no new null-producing path introduced.
- `0` passed through literally — never normalized to `null`.
- Zod: `z.number().nonnegative().nullable()`, required key (present on every response, value may be `null`) — consistent with how `pricing`/`stock` are already modeled (`.nullable()`, not `.optional()`).

Not recommended: a nested `{ weightKg, combinationId, source }` wrapper object. Unlike `pricing`/`stock`, weight needs no quote-style metadata (no tax mode, no discount, no evaluation timestamp, no per-request context dependency) — it is a static catalog attribute of the already-selected `(product, combination)`, so a flat nullable number is proportionate and keeps parity with what §'s 7/9/10 downstream expect: one number per line, no client-side math.

---

## 8. Endpoints afectados

| Tool | Add weight? | Why |
|---|---|---|
| `get_product_details` | **Yes** | Primary use case — CRM resolves one line and needs its shipping weight |
| `batch_get_products` | **Yes, for free** | Shares `CatalogApplicationService.getProduct()` / `MySqlCatalogRepository` with `get_product_details`; implementing the field once in that shared path automatically covers both endpoints with zero additional service-layer code. This is the strongest reason to scope the change here first. |
| `search_products` | No | Discovery/typeahead endpoint; doesn't even expose price today. Adding weight would be scope creep with no stated consumer and would require a brand-new SQL join purely to populate a field nothing reads. |
| `explore_catalog` | No, unless a browse-time shipping estimate becomes a real requirement | Independent SQL path (`MySqlCatalogExploreDataReader`); no current use case ties weight to catalog browsing. |
| `recommend_catalog_products` | No, unless "cheap-to-ship alternatives" ranking becomes a real requirement | Independent SQL path (`MySqlCatalogCommercialDataReader`); recommendations answer "what else," not "what does this weigh." |

Net result: **one shared implementation point** (`getProductCore` + `getVariants` in `MySqlCatalogRepository`, consumed by `CatalogApplicationService.getProduct()`) satisfies both endpoints Carrier actually needs, without inflating the search or discovery contracts the task explicitly warned against inflating.

---

## 9. Compatibilidad

```text
ADDITIVE_BACKWARD_COMPATIBLE
```

Reasoning:

- No existing field is renamed, removed, retyped, or made required-where-optional. No status code changes. No request schema changes.
- Every response schema in `src/shared/contracts.ts` uses Zod `.strict()` (`productCoreSchema`, `productResponseSchema`, `stockSchema`, `pricingSchema`, `variantSchema`, etc.), which **rejects unknown keys on the object being parsed** — this is the concrete mechanism the task asked to check for. It matters here because both the HTTP server and this repo's own `client/catalogClient.ts` validate against the *same* schema object (`client/types.ts` imports `ProductResponse`/`BatchResponse` directly from `src/shared/contracts.ts`), so server and client can never drift apart within this repository — one edit updates both.
- The same is true for `search-products-v2`: its Zod schemas are `.strict()`, but that endpoint is out of scope for this change (§8).
- **Caveat that cannot be verified from this repository:** if CRM / Sales Agent maintains its own independent copy of the response schema (rather than importing this repo's `client/` package or simply reading fields by name), and that copy also uses `.strict()`/`additionalProperties: false`, it will throw on the new field until updated in lockstep. This is a cross-repo coordination risk, not a Catalog-Service-internal one — flagged in §12, not something this audit can resolve.

No `CONTRACT_VERSION_CHANGE_REQUIRED` condition is met.

---

## 10. Carrier readiness

After the recommended change (weight added to `get_product_details` / `batch_get_products` only), CRM can obtain, per line, from a single `POST /v1/products/batch` call, without touching PrestaShop:

| Field | Source (already present today) |
|---|---|
| `productId` | `product.productId` |
| `combinationId` | `selectedVariant.combinationId` (`0` for simple products) |
| `unitPriceTaxIncl` | `pricing.effectiveUnitPrice` (`taxIncluded: true` is already asserted by the schema) |
| `stock` | `stock.physicalQuantity` / `stock.available` |
| `weightKg` | **added by this task's follow-up implementation** |

`batch_get_products` already accepts up to 20 `{ productId, combinationId, quantity }` items per call, which is exactly the multi-line shape a Carrier quote needs. Once `weightKg` is added, this closes the full loop described in the task's objective — Catalog Service becomes a complete data facade for Carrier, and CRM no longer needs any direct PrestaShop dependency for this data.

Pre-existing caveat (not introduced by this task): if a product has combinations but none is marked `default_on = 1` in PrestaShop, `selectedVariant` (and therefore `pricing`/`stock`/the proposed `weightKg`) resolves to `null` today. This audit did not enumerate how many production products hit that edge case — flagged as an open item, not asserted either way.

---

## 11. Tests requeridos (for the follow-up implementation task — not written here)

| Case | Where | Notes |
|---|---|---|
| Producto con peso (base, no combination) | `tests/unit/mysqlCatalogRepository.test.ts`, `tests/unit/catalogService.test.ts` | e.g. weight = 52.76-ish kg, asserts pass-through |
| Peso decimal | same | Use the observed minimum, 0.1 kg, to confirm rounding doesn't truncate small values to 0 |
| Peso cero | same | Fixture with `weight = 0`; assert `weightKg === 0`, never `null` |
| Peso desconocido | same | Fixture reproducing the existing "no resolvable default combination" path; assert `weightKg === null` exactly when `pricing`/`stock` are also `null` — never null on its own |
| Producto con combinación | same | Selected combination changes `weightKg` relative to base only when a fixture defines non-zero impact (synthetic, since production has none live — see §5) |
| Combinación con impacto de peso | same | Two fixtures: (a) non-zero `pa.weight`/`pas.weight` impact → base + impact; (b) zero impact (matches 100% of current production reality) → falls back to base, unchanged |
| Múltiples productos (batch) | `tests/unit/catalogService.test.ts` (batchGetProducts) | Mixed success/failure batch; `weightKg` present only on successful items |
| Backward compatibility | `tests/contract/contracts.test.ts` | Snapshot-style assertion that all pre-existing top-level keys of `productResponseSchema` are unchanged, plus the one new key |
| Schema validation | `tests/contract/contracts.test.ts`, `tests/unit/http.test.ts` | `.strict()` schema requires the `weightKg` key present (value may be `null`); rejects a payload that omits it entirely once implemented as required |
| Live query contra PrestaShop | New script, e.g. `scripts/validate-weight-parity.ts` | Mirror the existing `scripts/validate-price-parity.ts` pattern (`npm run validate:prices -- cases.json`, hits a running Catalog Service instance, not the DB directly) — add a `validate:weight` script comparing `getProduct().weightKg` against an expected value sourced from `ps_product.weight` for a curated case list. This repo's unit tests (`tests/unit/mysqlCatalogRepository.test.ts` and friends) run against a **mocked** pool, not a live DB, so the "live" requirement is only satisfiable by this kind of manually-run parity script, consistent with existing convention. |

---

## 12. Archivos que requerirían modificación (follow-up implementation, not done here)

Scoped to `get_product_details` + `batch_get_products` only, per §8:

1. `src/infrastructure/repositories/mysqlCatalogRepository.ts` — add `p.weight` to the `product-core` query; add `COALESCE(pas.weight, pa.weight, 0) AS weightImpact` to the `product-variants` query, joining `ps_product_attribute_shop` the same way `pas.price` already is.
2. `src/domain/catalog/types.ts` — extend `ProductCoreRecord` (base weight) and `VariantSummary` (weight impact); add `weightKg: number | null` to `ProductDetail`.
3. `src/domain/catalog/ports.ts` — extend `CatalogRepository` return types accordingly.
4. `src/application/catalogService.ts` — compute the resolved `weightKg` (`base + impact` when a variant is selected) inside `getProduct()`, alongside where `pricing`/`stock` are already resolved; apply rounding.
5. `src/shared/contracts.ts` — add `weightKg: z.number().nonnegative().nullable()` to `productResponseSchema`. **This step is mandatory, not cosmetic** — see §13, finding 1.
6. `src/shared/money.ts` (or a new `src/shared/weight.ts`) — small rounding helper reusing the existing `Decimal` / `ROUND_HALF_UP` convention.
7. `tests/support/fakes.ts` — repository stub needs a default weight value so existing tests don't need per-test overrides.
8. `tests/unit/mysqlCatalogRepository.test.ts`, `tests/unit/catalogService.test.ts`, `tests/contract/contracts.test.ts`, `tests/unit/http.test.ts` — see §11.
9. `scripts/validate-weight-parity.ts` (new, or extend `validate-price-parity.ts`) — see §11.
10. `client/types.ts` — no direct edit needed; `GetProductResult`/`BatchGetProductsResult` are type aliases of `ProductResponse`/`BatchResponse` and update automatically once `shared/contracts.ts` changes. Worth a confirming look in the follow-up task, not a planned edit.
11. `docs/catalog-commercial-truth.md` or a new `docs/contracts/product-weight.md` — document the field once shipped (hygiene, not part of this audit).

Not touched (out of scope per §8): `mysqlCatalogExploreDataReader.ts`, `mysqlCatalogCommercialDataReader.ts`, `catalogRecommendationCommercialDataProvider.ts`, `mysqlSearchProvider.ts`, and their respective contracts/routes.

---

## 13. Riesgos

1. **Fastify silently drops undeclared response fields.** `src/interfaces/http/app.ts` builds the route's response schema from `productResponseSchema` via `zodToJsonSchema` (`jsonSchema(productResponseSchema, 'ProductResponse')`), and Fastify serializes responses through that JSON Schema (`fast-json-stringify`), which only emits declared properties. Adding `weightKg` to the TypeScript domain type (`ProductDetail`) without also adding it to the Zod schema in `shared/contracts.ts` would compile fine and pass unit tests that inspect the JS object directly, but the field would **silently vanish from the actual HTTP response**. This is the single most likely way this change goes wrong.
2. **Cross-repo `.strict()` risk cannot be verified from here.** If CRM / Sales Agent independently re-implements response validation (rather than consuming this repo's `client/` package or reading fields loosely), its schema must be updated in lockstep or it will reject the new field. Requires a coordination step with that team before rollout — outside this audit's authority.
3. **15 named PACK/bundle SKUs currently report `weight = 0` with no way to distinguish that from a legitimate zero once exposed via the API.** Carrier could under-quote or free-ship these specific physical products until PrestaShop data is backfilled. Bounded and named (§3), not systemic — but must be communicated to Carrier stakeholders before they trust `weightKg` for freight-relevant decisions. This task does not correct that data, per instructions.
4. **Combination weight impact is inert today, not absent.** If the follow-up implementation takes the shortcut of reading only `ps_product.weight` (skipping the `pa.weight`/`pas.weight` join) to save effort, it will produce correct results today and silently wrong results the moment a merchandiser ever populates a non-zero combination weight — with no existing test able to catch that regression, since no current fixture or production row exercises it. Mitigation is in §5/§11: implement and test the full formula now.
5. **Precision.** `decimalNumbers: true` in `src/infrastructure/database/pool.ts` returns `DECIMAL(20,6)` columns as native JS numbers directly (consistent with how price/stock are already handled at the row-mapping layer in this repository — not a new risk class, but weight should still get an explicit rounding step for a stable wire value, see §7).
6. **Standing data-quality dependency.** Catalog Service can only faithfully mirror `ps_product.weight`; it has no way to validate merchandiser-entered data at read time. Weight accuracy for Carrier remains dependent on PrestaShop admin discipline going forward, not something this contract change can guarantee structurally.

---

## 14. Siguiente tarea exacta

```text
CAT-R1-T13B — Implement weightKg on get_product_details / batch_get_products
```

Scope: implement exactly the contract defined in §7, on exactly the endpoints identified in §8, touching exactly the files listed in §12, with exactly the test coverage listed in §11. Do not extend to `search_products`, `explore_catalog`, or `recommend_catalog_products` without a separately justified requirement (per §8). Do not attempt to backfill or correct the 15 PACK/bundle SKUs identified in §3/§12 as part of this task — that is a PrestaShop data-hygiene item to be scoped and owned separately, coordinated with whoever maintains product data in PrestaShop admin.
