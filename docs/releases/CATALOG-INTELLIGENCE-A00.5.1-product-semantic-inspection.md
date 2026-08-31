# CATALOG-INTELLIGENCE-A00.5.1 - Product Semantic Inspection

Status: **COMPLETE**
Date: **2026-08-29**
Production runtime changed: **YES (additive, read-only)**
Classifier / ontology / snapshot builder changed: **NO**
Relationship engine / recommendation ranking changed: **NO**
Customer Profile / RFM / clustering / CLV / customer affinity changed: **NO**

## 1. Scope

A00.5.1 exposes the product semantic facts published by A00.5's active snapshot through a new
read-only HTTP endpoint, so the CRM Catalog Console can display them for inspection.

It does not:

- classify on request
- query PrestaShop for semantics
- change the classifier, ontology, or snapshot builder
- change SearchProducts V2, relationship scoring, or recommendation ranking
- touch Customer Profile, RFM, clustering, CLV, or customer affinity

## 2. New endpoint

```text
GET /v1/products/:productId/semantics
```

Reuses A00.5's runtime reader (`getActiveSnapshotMetadata`, `getProductSemanticFact`) without
modification. Response reuses the already-audited `ProductSemanticSnapshotFact` contract
(`primaryProductFamily`, `secondaryProductFamilies`, `disciplines`, `useContexts`, `ontologyVersion`,
`ontologyHash`, `provenance`) plus snapshot-level `classifierVersion` and `snapshotId`.

Never returned: regexes, classifier source, raw PrestaShop categories, raw feature dumps, or
filesystem paths - the contract was already bounded to audit-safe fields by A00.5.

## 3. Status behavior

- `CLASSIFIED`, `PARTIALLY_CLASSIFIED`, `OTHER`, `EXCLUDED_NON_PRODUCT` all resolve as `200`, not
  `404` - the full-universe invariant from A00.5 means every product in the snapshot is a
  materialized record, and `OTHER`/`EXCLUDED_NON_PRODUCT` are valid facts, not missing data.
- `EXCLUDED_NON_PRODUCT` responses include `provenance.exclusion` (`ruleId`, `reason`).
- `404 PRODUCT_SEMANTICS_NOT_FOUND` is reserved for a productId that is not part of the active
  snapshot's source universe at all.
- `503 PRODUCT_SEMANTICS_UNAVAILABLE` is returned when no snapshot has been loaded - never an empty
  200, so a missing snapshot cannot be misread as "no semantics".

## 4. Runtime wiring

`bootstrap.ts` now constructs a `FileProductSemanticSnapshotStore` +
`DefaultActiveProductSemanticSnapshotReader` and refreshes it once at boot, mirroring the existing
relationship-snapshot bootstrap pattern. A missing or unloaded snapshot is logged
(`product_semantic_snapshot_not_available` / `product_semantic_snapshot_load_failed`) and does not
fail service boot or `/health/ready` - product semantics is a degradable inspection branch, not a
readiness dependency.

## 5. Files

```text
src/shared/errors.ts                                  (+ProductSemanticsNotFoundError/UnavailableError)
src/interfaces/http/routes/getProductSemanticsRoute.ts (new)
src/interfaces/http/app.ts                             (route registration + dependency wiring)
src/bootstrap.ts                                       (reader construction + initial refresh)
src/server.ts                                          (pass reader into buildApp)
tests/http/getProductSemanticsEndpoint.test.ts         (new)
```

## 6. Tests

- `tests/http/getProductSemanticsEndpoint.test.ts`: 8/8 PASS (`CLASSIFIED`, `OTHER`,
  `EXCLUDED_NON_PRODUCT` with exclusion provenance, unknown productId -> 404, snapshot not loaded ->
  503, reader not wired -> 503, missing api key -> 401, non-numeric productId -> 400).
- Full `npm test`: `2156/2156 PASS`.
- `npm run typecheck`: pre-existing unrelated failure in
  `tests/unit/productSemanticSnapshotBuilder.test.ts` (not touched by this slice); no new errors.

## 7. CRM Catalog Console integration

`CRM-Customer-360` extends `lib/catalog/consoleService.ts` to load semantics in parallel with
product detail and recommendations (`Promise.all`), server-side only. A semantics failure never
fails the product context result - it degrades to a `{ status: "error" }` block while
detail/recommendations remain available. The browser continues to call only the CRM's own API
route; it never talks to Catalog Service directly and never sees `x-api-key`. A "SEMÁNTICA DEL
PRODUCTO" panel renders status, primary/secondary families, disciplines, use contexts, and
ontology/classifier/snapshot metadata, plus the exclusion reason when `EXCLUDED_NON_PRODUCT`. See
that repo's own history for the corresponding adapter/UI changes and tests.

## 8. Next slice

Not scoped here: bulk semantic browsing/filtering in the console, or wiring semantics into search
ranking (explicitly out of scope for this inspection-only slice).
