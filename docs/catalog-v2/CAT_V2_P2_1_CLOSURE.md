# CAT-V2 P2.1 — Closure Verification

## Decision

```ini
IMPLEMENTATION_CLOSED = YES
PRODUCTION_VALIDATED = NO
```

Verification date: 2026-10-02. Base commit before P2.1 implementation (`HEAD`): `2a76dcd765304c9dac68a3343574a8ea8d30b6e8`. The P2.1 implementation, test bootstrap and this closure record are committed together. No production deployment was inspected or validated.

## Scope implemented

P2.1B makes effective catalog authorities explicit through an internal, versioned runtime context and a read-only health snapshot. Existing commercial calculation paths and HTTP response contracts remain unchanged. The internal product context is not exposed to Agent API consumers.

`CatalogRuntimeProductContext` has `schemaVersion: 1` and separates `identity`, live PrestaShop `facts`, `commercial`, `knowledge`, `provenance`, and `freshness`. `AuthorityValue<T>` represents available values with authority, fallback flag and optional lineage, or unavailable values with authority/reason. Commercial freshness retains the existing `asOf`, `validUntil`, and `cache.hit/ageMs` fields. Knowledge lineage is separate: projection bundle ID, activation ID and loaded time. `facts.specifications` remains live PrestaShop features; normalized CAT-V2 Specs are `knowledge.specs`.

Training V1 from CAT-V2 and the legacy Training V2 record have separate fields and authorities. No V1-to-V2 adapter is introduced. Product Semantics uses CAT-V2 when a projection state is captured; the legacy fallback remains permitted only in `NO_ACTIVE_BUNDLE`, is labeled as legacy, and increments the existing metric. CAT-V2 relationships and capabilities remain unavailable. The legacy relationship recommendation snapshot is reported separately.

## Final authority matrix

| Domain | Effective authority | Status / behavior |
| --- | --- | --- |
| Commercial V2 price, stock and sellability | `prestashop-v2-commercial-runtime` | Live current endpoint path; projection bundles do not supply commercial values. |
| Product facts | `prestashop-v2-catalog-reader` | Live PrestaShop facts. |
| Category selection | `static-category-trust-map` | Existing selection path; CAT-V2 trust maps are not consumed for selection. |
| Product Semantics | `cat-v2-product-semantics` | Primary when CAT-V2 state is captured. `legacy-product-semantic-snapshot` fallback only for `NO_ACTIVE_BUNDLE`, with `fallbackUsed=true`. |
| Product ontology registry | `code-product-ontology-v3` | Code registry, separate from Product Semantics facts. |
| Training V1 | `cat-v2-training-semantics-v1` | Projection value, represented separately. |
| Training V2 | `legacy-training-v2` | Existing V2 consumers remain on legacy snapshot; `migrationStatus=PENDING`. |
| Training registry | `code-training-semantic-registry-v2` | Code registry. |
| Normalized Specs | `cat-v2-specs` | Available only from active CAT-V2 bundle; separate from PrestaShop facts. |
| Trust maps | `cat-v2-trust-maps` | Loaded authority reported; `consumedByCategorySelection=false`. |
| Relationships CAT-V2 | `null` | `UNAVAILABLE`. |
| Recommendation relationships | `legacy-relationship-snapshot` | Separate legacy authority for recommendation path. |
| Capabilities CAT-V2 | `null` | `UNAVAILABLE`; no inference from Training, semantics or features. |

## Health authority contract

`GET /health/catalog-authority` returns `CatalogAuthoritySnapshot` (`schemaVersion: 1`) with active and desired projection IDs, reload state, per-domain authority/status, fallback enabled/read count, Training V1 and V2 separately, Specs/trust-map state, both Relationships authorities, Capabilities and `serviceBuildRef`. The endpoint is read-only, uses `Cache-Control: no-store`, and does not return secret configuration or raw loader errors. `/health/ready` is unchanged.

Illustrative response (IDs/status are runtime-dependent):

```json
{
  "schemaVersion": 1,
  "projection": {
    "bundleId": "sha256:<active-bundle>",
    "activationId": "<activation>",
    "loadedAt": "2026-10-01T12:00:00.000Z",
    "desiredBundleId": "sha256:<active-bundle>",
    "desiredActivationId": "<activation>",
    "reloadState": "READY"
  },
  "authorities": {
    "commercialV2": { "authority": "prestashop-v2-commercial-runtime", "status": "READY" },
    "productSemantics": {
      "authority": "cat-v2-product-semantics",
      "status": "READY",
      "fallbackEnabled": true,
      "legacyFallbackReads": 0
    },
    "productOntologyRegistry": { "authority": "code-product-ontology-v3", "status": "READY" },
    "trainingSemanticsV1CatV2": { "authority": "cat-v2-training-semantics-v1", "status": "READY" },
    "trainingSemanticsV2": {
      "authority": "legacy-training-v2",
      "status": "READY",
      "migrationStatus": "PENDING",
      "snapshotId": "sha256:<training-v2-snapshot>"
    },
    "trainingRegistry": { "authority": "code-training-semantic-registry-v2", "status": "READY" },
    "specs": { "authority": "cat-v2-specs", "status": "READY" },
    "trustMaps": {
      "authority": "cat-v2-trust-maps",
      "status": "READY",
      "consumedByCategorySelection": false,
      "categorySelectionAuthority": "static-category-trust-map"
    },
    "relationshipsCatV2": {
      "authority": null,
      "status": "UNAVAILABLE",
      "reason": "cat_v2_relationship_projection_unavailable"
    },
    "relationshipsRecommendation": {
      "authority": "legacy-relationship-snapshot",
      "status": "READY",
      "snapshotId": "<relationship-snapshot>",
      "modelVersion": "<model-version>",
      "evidenceWindow": null
    },
    "capabilitiesCatV2": {
      "authority": null,
      "status": "UNAVAILABLE",
      "reason": "cat_v2_capabilities_projection_unavailable"
    }
  },
  "build": { "serviceBuildRef": "catalog-service@<git-sha>" }
}
```

## Build provenance contract

`CATALOG_SERVICE_BUILD_REF` is trimmed and must be non-empty in production. With `NODE_ENV=production`, missing or blank configuration fails startup. Outside production, `catalog-service@local` remains the explicit development default. The Docker runtime accepts this ref as a build argument/environment value; the deployment runbook generates it from `git rev-parse HEAD`. The deployed process value remains unverified.

## Training V2 test artifact provenance

Classification: **`GENERATED_DETERMINISTICALLY`**. The accepted snapshot is not an external binary, copied production data, or a hand-authored fixture.

Evidence and source chain:

1. The V1 build uses the versioned product-catalog, category-trust-map and feature-trust-map CSVs under `docs/audits/product-intelligence-exploration/inputs`. Its builder enforces the accepted 2,011-product, 180-assignment baseline and publishes V1 ID `sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d` with semantic checksum `08fdd83e95d6f682527187fd6e2caff25f52107dc4bf63edd1abd87511eb741e`.
2. The V2 build consumes that exact accepted V1 source plus the tracked `docs/audits/training-semantics/a00.6.7/post-closure-resolution-active.csv`. It enforces the 240 active / 234 resolved resolution baseline, persists and validates the snapshot, then activates it.
3. The generated V2 identity matches the accepted A00.6.8 release: snapshot ID `sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1`, semantic checksum `e15673be136a730d3e90645446ba55f0734b491163f47b4a617b9c5c974f8941`, registry hash `7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8`, rules hash `5e4e591b45e7704975552f305d59d73535c3889ed655754aa0113844c9c03b6d`; 2,011 source products, 234/240 resolved, six explicit unresolved records. The release defines timestamps and filesystem paths outside semantic identity.

The generated data tree is ignored by `.gitignore`. Before P2.1C, the three HTTP suites opened that default path directly; `tests/setup.ts` set environment defaults but did not materialize snapshots, and there was no repository-local CI workflow. The earlier P1.6 test audit also recorded that the suites required manual rebuilding. The deterministic builders and versioned source inputs make acquisition reproducible.

`npm test` now runs `pretest`, which invokes `test:bootstrap:training-v2`: it builds V1 into `data/training-semantic-snapshots/.test-v1`, then builds and activates V2 at the path the existing suites read. No test is skipped, relaxed or redirected to an unavailable result. The V2 CLI argument parser was corrected to accept the digit in `--source-v1-dir`, enabling the isolated V1 source directory.

Exact bootstrap command:

```text
npm run test:bootstrap:training-v2
```

It is composed of the existing approved generator commands:

```text
npm run product:training-semantics:snapshot:build -- --snapshot-dir=data/training-semantic-snapshots/.test-v1
npm run product:training-semantics:v2:snapshot:build -- --source-v1-dir=data/training-semantic-snapshots/.test-v1 --snapshot-dir=data/training-semantic-snapshots/v2
```

No external CI configuration is present in this repository to inspect. Any CI invocation of `npm test` receives the same bootstrap through the npm lifecycle.

## Verification results

| Gate | Result |
| --- | --- |
| V1/V2 deterministic generation | PASS; accepted IDs, hashes and baselines reproduced; zero loader warnings |
| V2 persisted metadata inspection | PASS; ID, checksum, registry/rules lineage and counts match A00.6.8 |
| V2 resolution acceptance audit | PASS; 234/240, 97.5%, six unresolved, discrepancy 0; precision regression 10 checked, discrepancy 0 |
| Three Training V2 HTTP suites | PASS; 3 files, 16 tests |
| P2.1B focused suites | PASS; 5 files, 11 tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` (including automatic `pretest`) | PASS; 110 files, 2,424 tests |
| `git diff --check` | PASS |

## Residual debt

- Commercial calculations remain on the existing separate runtime paths; consolidation requires a later parity gate.
- Public Training V2 remains `legacy-training-v2`; CAT-V2 currently carries distinct Training V1.
- CAT-V2 Relationships and Capabilities remain unavailable; recommendation relationships still use their legacy snapshot.
- Category selection still uses `static-category-trust-map`; loaded CAT-V2 trust maps are not consumed by that selection.
- R4 source and production deployment/runtime metadata are outside this checkout; production validation remains open.
- The accepted Training V2 artifact is regenerated locally for tests and remains ignored by Git.

## Deferred no-go items

Commercial Truth engine consolidation; Training V2 CAT-V2 projection; Relationships and Capabilities projections; `catalog.discover`; embeddings/vector search/new semantic ranking; recommendation redesign; extraction scheduler; R4 modifications; authorization scopes; and PrestaShop schema changes remain outside P2.1.

## Closure assessment

**P2.1 implementation is closed.** Runtime authority decisions are explicit, the complete test gate is reproducible through the approved deterministic builders, and the complete suite passes. **Production is not validated**: no deployment was inspected, so `PRODUCTION_VALIDATED = NO` remains in effect.
