# CATALOG-INTELLIGENCE-A00.5 - Product Semantic Snapshot

Status: **COMPLETE WITH DOCUMENTED DEBT**
Date: **2026-08-29**
Production runtime changed: **NO**
Recommendation behavior changed: **NO**
Relationship Engine behavior changed: **NO**
Customer Profile changed: **NO**

## 1. Scope

A00.5 turns the accepted product-semantic classification into durable, immutable, auditable product
truth owned by `MS-pesaschile-catalog-service`.

It does not:

- change classifier semantics
- rerun classification per request
- change SearchProducts V2
- change relationship scoring, confidence, lift, or support
- touch Customer Profile

## 2. Architecture

Short implementation map:

```text
scripts/product-semantic-classification/
  build-semantic-snapshot.ts
  inspect-semantic-snapshot.ts
  lib/classification-run.ts

src/domain/product-semantic-snapshot/
  contracts.ts
  defaultSnapshotBuilder.ts
  defaultSnapshotPublisher.ts
  inMemorySnapshotStore.ts
  runtime/
    defaultRuntimeIndexBuilder.ts
    defaultActiveSnapshotReader.ts

src/infrastructure/product-semantic/
  fileProductSemanticSnapshotStore.ts

src/shared/
  productSemanticSnapshotConfig.ts
```

The architecture reuses the relationship-snapshot pattern where it is domain-neutral:

- immutable snapshot files
- `sha256:` content identity
- atomic `active.json` publication
- idempotent republish
- read-only runtime reader with in-memory index

Domain-specific behavior stays separate from relationships. A00.5 does not reuse relationship
evidence, scoring, or runtime readiness behavior.

## 3. Ownership boundary

Catalog Service remains the owner of product truth only.

The runtime fact contract contains:

- `productId`
- `classificationStatus`
- `primaryProductFamily`
- `secondaryProductFamilies`
- `disciplines`
- `useContexts`
- `ontologyVersion`
- `ontologyHash`
- structured provenance

It does not expose:

- raw classifier functions
- regexes
- raw feature parsing logic
- raw category interpretation logic
- customer semantics

## 4. Snapshot schema

Published snapshot envelope:

```json
{
  "schemaVersion": "1",
  "snapshotId": "sha256:<64-hex>",
  "builtAt": "<iso-8601>",
  "sourceProductCount": 2011,
  "recordCount": 2011,
  "ontologyVersion": "commercial-product-ontology-v3",
  "ontologyHash": "<64-hex>",
  "classifierVersion": "product-semantic-classifier-v1",
  "semanticChecksum": "<64-hex>",
  "classificationCounts": {
    "CLASSIFIED": 1281,
    "PARTIALLY_CLASSIFIED": 400,
    "OTHER": 317,
    "EXCLUDED_NON_PRODUCT": 13,
    "NEEDS_REVIEW": 0
  },
  "records": []
}
```

Each `records[]` item materializes one source product, including `OTHER` and `EXCLUDED_NON_PRODUCT`.

## 5. classifierVersion decision

`classifierVersion` is now an explicit durable concept and starts at:

- `product-semantic-classifier-v1`

This is intentionally distinct from:

- ontology version (`commercial-product-ontology-v3`)
- snapshot schema version (`1`)

The durable classifier lineage starts here because A00.5 is the first slice that persists accepted
semantic truth. A00.4.2 already changed accepted classifier behavior before any durable snapshot
existed, so starting the persisted classifier lineage at `v1` is correct.

## 6. Snapshot identity

`snapshotId` is deterministic and excludes `builtAt`.

Canonical identity payload:

- `schemaVersion`
- `sourceProductCount`
- `recordCount`
- `ontologyVersion`
- `ontologyHash`
- `classifierVersion`
- `semanticChecksum`
- `classificationCounts`
- canonical `records`

Result on Saturday, August 29, 2026:

- `snapshotId`: `sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12`
- first persisted `builtAt`: `2026-08-29T20:36:33.148Z`
- second build `builtAt`: `2026-08-29T20:36:39.421Z`
- identity unchanged: `true`

Republishing identical semantic truth is idempotent. The store preserves the first immutable file
for that `snapshotId`; later identical builds return `already_exists`.

## 7. Full-universe invariant

The semantic snapshot preserves the full source universe:

- source products: `2011`
- snapshot records: `2011`

Explicitly materialized statuses:

- `CLASSIFIED`: `1281`
- `PARTIALLY_CLASSIFIED`: `400`
- `OTHER`: `317`
- `EXCLUDED_NON_PRODUCT`: `13`
- `NEEDS_REVIEW`: `0`

This prevents ambiguity between:

- product absent from snapshot
- product present but `OTHER`
- product present but `EXCLUDED_NON_PRODUCT`

## 8. Build pipeline

Offline pipeline:

```text
fixture-resolved source universe
-> deterministic classifier
-> snapshot builder validation
-> immutable snapshot write
-> atomic active pointer publish
-> runtime reader / inspect CLI
```

Primary CLI:

- `npm run product:semantic:snapshot:build`

Read-only inspection CLI:

- `npm run product:semantic:snapshot:inspect -- --product-id=<id>`

## 9. Validation

Build validation rejects:

- source-count mismatch
- duplicate `productId`
- mixed ontology versions or hashes
- ontology hash not matching the active registry
- unknown ontology tag
- residual ontology tag assigned as durable fact
- missing or invalid evidence provenance
- invalid exclusion provenance
- malformed snapshot metadata

The builder validates semantic tags against the active ontology registry rather than local
hardcoded tables.

## 10. Atomic publication

Publication flow:

```text
write temp snapshot
-> fsync + close
-> rename immutable snapshot file
-> write temp active pointer
-> atomic rename active pointer
```

`active.json` is never written to a snapshot file that does not already exist.

## 11. Active pointer

Layout:

```text
<PRODUCT_SEMANTIC_SNAPSHOT_DIR>/
  active.json
  snapshots/
    <snapshot-hash>.json
```

`active.json` contains:

```json
{
  "snapshotId": "sha256:<64-hex>",
  "schemaVersion": "1"
}
```

This is sufficient to resolve the active snapshot and detect schema mismatches.

## 12. Runtime reader

Implemented as a read-only in-memory index with:

- `getActiveSnapshotMetadata()`
- `getProductSemanticFact(productId)`
- `hasProduct(productId)`
- `getAllProductSemanticFacts()`

The reader:

- does not classify
- does not call PrestaShop
- does not modify snapshots
- throws explicitly when queried before a snapshot is loaded

## 13. Provenance contract

Each record persists bounded, auditable provenance:

- `provenance.evidence[]` for emitted semantic facts
- `provenance.exclusion` for excluded non-products

No runtime fact depends on raw source rows or classifier code. Provenance remains sufficient to
answer why a product was classified the way it was.

## 14. OTHER and excluded semantics

`OTHER` remains a materialized record, not absence.

`EXCLUDED_NON_PRODUCT` also remains a materialized record, with exclusion provenance preserved.

`PARTIALLY_CLASSIFIED` keeps legitimate historical-name-only semantics.

## 15. Configuration

New validated environment input:

- `PRODUCT_SEMANTIC_SNAPSHOT_DIR`

Default for local/dev/test:

- `data/product-semantic-snapshots`

Recommended EC2 deployment:

- set `PRODUCT_SEMANTIC_SNAPSHOT_DIR` to a persistent absolute directory outside the repo, analogous
  to relationship snapshots

## 16. CLI tooling

Added:

- `npm run product:semantic:snapshot:build`
- `npm run product:semantic:snapshot:inspect -- --product-id=<id>`

`inspect` reads the active snapshot only. It does not rerun classification.

## 17. Reproducibility

Repeated builds on Saturday, August 29, 2026 were deterministic:

- ontology version unchanged: `commercial-product-ontology-v3`
- ontology hash unchanged: `f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955`
- semantic checksum unchanged: `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e`
- record count unchanged: `2011`
- classification counts unchanged: `true`
- `snapshotId` unchanged: `sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12`

## 18. Corruption handling

Focused tests cover:

- missing active pointer
- malformed active pointer
- missing referenced snapshot
- duplicate product ids
- checksum/ontology validation path through builder/runtime
- unknown ontology tag rejection
- runtime explicit failure before load
- stray temp-file tolerance
- idempotent immutable republish

## 19. Representative inspection results

Read from the active snapshot published on 2026-08-29:

- `29` -> `CLASSIFIED`, primary `BARBELL`, rule `PF_BARBELL_NAME_V1`
- `1023` -> `OTHER`, no durable family, no provenance evidence
- `1619` -> `OTHER`, no family, but `USE_CONTEXT=COMMERCIAL_GYM` from structured evidence
- `2134` -> `CLASSIFIED`, primary `PLATE_LOADED_MACHINE`, secondary `CABLE_MACHINE`, `USE_CONTEXT=HOME_GYM`
- `332` -> `PARTIALLY_CLASSIFIED`, primary `WEIGHT_PLATE` from name-only evidence
- `444` -> `EXCLUDED_NON_PRODUCT`, exclusion rule `NON_PRODUCT_KNOWN_ID_V1`

## 20. Tests

Focused snapshot tests:

- `38/38 PASS`

Focused semantic + snapshot suites:

- `316/316 PASS`

Full validation commands on 2026-08-29:

- `npm run typecheck` -> PASS
- `npm run product:semantic:classify` -> PASS
- `npm run product:semantic:acceptance-audit` -> PASS
- `npm run product:semantic:snapshot:build` -> PASS
- `npm run product:semantic:snapshot:build` again -> PASS, same `snapshotId`

Full `npm test` on 2026-08-29:

- `2108/2116 PASS`
- `8` unrelated timeout failures remain outside A00.5:
  - `tests/integration/agent-flow.test.ts`
  - `tests/unit/metricsRoute.test.ts`
  - `tests/unit/readiness.test.ts`
  - `tests/integration/searchProductsV2ClientWiring.test.ts`
  - `tests/http/exploreProductsEndpoint.test.ts`
  - `tests/unit/http.test.ts`
  - `tests/http/resolveProductIntentEndpoint.test.ts`
  - `tests/http/searchProductsV2Endpoint.test.ts`

## 21. Operational instructions

1. Configure `PRODUCT_SEMANTIC_SNAPSHOT_DIR` on the host.
2. Run `npm run product:semantic:snapshot:build`.
3. Verify the returned `snapshotId`, `semanticChecksum`, and classification counts.
4. Use `npm run product:semantic:snapshot:inspect -- --product-id=<id>` for spot checks.
5. Restart or wire future consumers only after an accepted snapshot exists.

## 22. Remaining debt

A00.5 inherits A00.4 debt without expanding it:

- `317` `OTHER` rows remain bounded and documented
- `400` historical partial rows remain acceptable by contract
- no new false-positive cluster was introduced
- no new ontology debt was created by snapshot publication itself

## 23. Future consumer contract

Future consumers can read stable product truth from the snapshot without:

- filesystem access to source fixtures
- classifier internals
- ontology re-interpretation
- customer-domain logic

## 24. Next slice

Next:

- `A00.5.1 Product Semantic Inspection / Catalog Console integration`

