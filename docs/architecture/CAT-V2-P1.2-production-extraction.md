# CAT-V2 P1.2 — Production extraction and determinism validation

## Contract

```text
PrestaShop (SELECT-only account, InnoDB consistent read-only snapshot)
  → normalized canonical_input.json
      ├─ product_catalog_exploration.csv (transitional classifier adapter)
      └─ future projection builders
  → projection_input_manifest.json
```

`sourceExtractionId = SHA-256(UTF-8 canonical_input.json bytes)`. The canonical JSON contains source scope, sorted products and complete orphan references. It excludes runtime metadata. `aggregateContentHash` hashes the extractor/schema versions and the four artifact hashes in a fixed field order. `observedAt`, build reference, local paths, duration and the archived baseline do not enter either content hash. A future `projectionBundleId` will identify derived projections and is not created by P1.2.

The source scope uses an opaque hash of configured database name plus shop/language IDs; no host or credential is serialized. Product rows are ordered by numeric ID. Category, feature, variant and orphan rows are ordered by stable numeric keys. Text is NFC with LF line endings. Revenue uses a six-place decimal string. JSON field order is fixed by the canonical model. The CSV writer fixes header order, LF line endings, escaping, booleans as `1`/`0`, and empty cells for unknown values. Canonical JSON keeps `null` distinct from empty text; historical-only products have unknown active/category/feature/variant values rather than false or empty arrays.

All source SQL is static and read-only: `SHOW GRANTS`, an `information_schema` engine check, and six ordered `SELECT` queries for current products, historical order-line products, category assignments, feature assignments, variants and aggregate valid-order revenue. The extractor rejects mutating or locking SQL, confirms that the account has SELECT without mutation grants, checks all source tables are InnoDB, and reads twice inside one `REPEATABLE READ` consistent read-only transaction. It selects no customer, address, email, phone, order ID, or order-line ID into the canonical artifact. Production output was checked against configured DB host/user/password values, sensitive field names and email patterns; no matches were found.

Build output is written to a temporary directory, hashes and manifest are validated, both legacy classifier loaders accept all products, and only then the directory is renamed to the content-addressed final path. Existing content is compared before reuse. A failed extraction leaves no final artifact. Errors have stable codes: `SOURCE_UNAVAILABLE`, `INVALID_SOURCE_DATA`, `EXTRACTION_FAILED`, `SERIALIZATION_FAILED`, `HASH_FAILED`, `NON_DETERMINISTIC_OUTPUT`, `INVALID_MANIFEST`. SQL errors are sanitized at the CLI boundary.

## Production observation, 2026-10-01

The source was the configured production PrestaShop RDS, shop 1, language 1, accessed with a SELECT-only account. The final observation began at `2026-10-01T16:46:24.135Z`. The manifest records Git `0204f34c0ca66d597c48cc322b171c42b898ee3c-dirty`, since this validation ran with uncommitted extractor code. The generated artifacts are local and ignored by Git.

| Measure | Observed |
| --- | ---: |
| Products | 2,048 |
| Current catalog | 1,565 |
| Historical order-detail only | 483 |
| Active / inactive / unknown active current products | 886 / 679 / 0 |
| Items / variants | 1,898 / 467 |
| Distinct categories / features | 239 / 74 |
| Feature assignments on current products | 14,099 |
| Orphan category / feature / variant / revenue rows | 4 / 88 / 0 / 0 |
| Classifier loader warnings | 0 |

The orphan rows are preserved in canonical JSON and excluded from the current-product classifier adapter. They are source data hygiene debt, not silently discarded.

### Determinism evidence

RUN A and RUN B read the same InnoDB snapshot in one transaction. Canonical bytes, four artifact hashes, aggregate hash and record counts matched exactly.

| Content | RUN A | RUN B |
| --- | --- | --- |
| `sourceExtractionId` / canonical JSON | `sha256:3694b291c89d5f011904b44dc7fe51eb6f355da63d5bb25c485009fadd67d007` | same |
| Compatibility CSV | `sha256:0073f7e76e8914ec3f4924adc84aedb1837a66b7d2677c054bc93c70cedb0d57` | same |
| Category trust map | `sha256:01ac8a64b5aa20975d0e781eda618890bb7604219963eaf81ffaaed00db278fd` | same |
| Feature trust map | `sha256:88bde84b077f86d21c04b419885f11cfb15c9f1a7ecf082942ef88d7e5dfd2c8` | same |
| Aggregate content | `sha256:36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2` | same |

An earlier independent invocation at `2026-10-01T16:35:14.598Z` had a different canonical hash because the source changed between invocations: category 458 was renamed from `CYBERDAY` to `CYBERMONDAY` for 315 products, and valid-order revenue for P1755 rose from `5657586.000000` to `5685576.000000`. Category IDs, product counts and semantic assignments remained unchanged. Each invocation independently passed its own A/B comparison against a stable snapshot; the cross-invocation hash change is source drift, not evidence of nondeterministic extraction.

### Historical comparison

Baseline: archived `product_catalog_exploration(2).csv` from 2026-08-27. The report records 37 added, 0 removed, 873 changed, 1,384 rows with normalization-only differences, 15 semantic assignment changes, and 0 unexplained semantic changes. Changed fields overlap: revenue 720, category IDs 336, features 44, active 35, catalog presence 15, name 1. All 15 semantic changes involve products previously present in the catalog and now present only in historical order lines. For example, P2085 changed `CLASSIFIED` → `PARTIALLY_CLASSIFIED` while retaining `BARBELL`; P2186 retained `BENCH` but lost `HOME_GYM` context. The report preserves every old/new assignment and its source-field explanation. These changes are observed drift and are not automatically approved for a future active projection.

Revenue differences largely reflect sales after the archived export: 1,711 archived values match the reconstructed valid-order aggregate before 2026-08-28, while 455 differ from the current aggregate. Twenty-four archived values match neither that cutoff nor the current aggregate; the archived exporter or later order-validity changes may explain them. Revenue is not used by the current semantic assignment comparison. Investigate this historical metric lineage before using revenue as a projection gate.

### Performance baseline

End-to-end extraction and comparison took 11,767 ms. The seven query groups consumed about 3,854 ms total across both reads; normalization 143 ms, CSV serialization 52 ms, and hashing/manifest work 205 ms. Observed RSS at report creation was 1,209,475,072 bytes; this is an observation, not a measured peak. Artifact sizes: canonical JSON 2,164,318 B; CSV 1,504,343 B; category map 32,587 B; feature map 7,278 B; manifest 1,328 B.

## Validation

The new reproducibility suite passes 6/6 tests. The complete suite passes 2,399/2,399 tests across 101 files. The original Vitest five-second timeout caused an unrelated heavy audit test to fail; the runner now uses two workers and a 30-second test timeout. Three legacy HTTP test files initially failed because this checkout lacked the ignored V1/V2 training semantic snapshot fixture. Rebuilding those fixtures locally from the archived export produced the published snapshot IDs and let the complete suite pass. `npm run typecheck`, `npm run lint` and `git diff --check` pass. Seven pre-existing unused references were removed from legacy files to clear the repository-wide ESLint gate; no business logic changed.

## Review and limits

The production read-only account and transaction provide the no-write guarantee for this run. The future projection activation, bundle contract and immutable publication semantics belong to P1.3. The 15 semantic changes require business review before any future projection is activated. Current source data contains 4 orphan category rows and 88 orphan feature rows. The old CSV encodes some text with mojibake; canonical output uses the current PrestaShop text and NFC normalization. The extraction does not modify J1 or R4 runtime behavior.
