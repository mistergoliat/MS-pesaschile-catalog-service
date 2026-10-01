# CAT-V2 P1.3 — Projection Bundle

## Architecture and use

`npm run catalog:bundle:build -- --source-dir=<P1.2 extraction directory> [--code-ref=<immutable build reference>] [--output-dir=<directory>]` builds offline. It reads and verifies all five P1.2 extraction files, runs existing Product Semantics and Training Semantics V1 classifiers/builders without their publishers, normalizes selected specs, and adapts the P1.2 trust-map hashes. It validates the whole bundle and atomically renames a temporary directory into `artifacts/catalog-v2/bundles/<projectionBundleId without sha256:>/`. No active pointer or runtime reader is touched.

```text
PrestaShop → P1.2 canonical_input.json + extraction manifest
           → verified sourceExtractionId
           → Product Semantics V1 + Training Semantics V1 + Specs V1 + trust-map adapter
           → strict manifest/artifact/cross-projection validation
           → validation-report.json + immutable local bundle directory (not active)
```

The existing Training Semantics V2 snapshot is not copied: its historical baseline does not establish lineage to this P1.2 extraction. The V1 builder is rerun from the verified source, with its `sourceProductSemanticSnapshotId` linked to the Product Semantics snapshot built in the same run. Relationship snapshots are derived from separate order evidence and have no verified source-extraction adapter here. Capabilities as a separate CAT-V2 projection have not been built. Both are explicitly `unavailable`.

## Schema and lineage

The strict Zod contract lives in `src/domain/catalog/projection-bundle.ts`. Manifest version `1` requires `schemaVersion`, `projectionBundleId`, `source`, `build`, all six named projection entries, and `validation`. Unknown manifest fields fail. A present entry requires `schemaVersion: "1"`, `snapshotId`, `contentHash`, `builderVersion`, `recordCount`, and a local JSON artifact name; unavailable requires a reason and no empty placeholder artifact. Each generated artifact has its own version and `sourceExtractionId`. Product and Training wrappers also retain their legacy snapshot IDs and complete validated legacy snapshots. Trust maps are a two-hash adapter back to the verified P1.2 extraction, where the CSV bytes remain available. Each published artifact is content-addressed through its manifest hash and is checked before publication or reuse.

`sourceExtractionId = sha256(UTF-8 canonical_input.json bytes)` from P1.2. A projection `snapshotId = sha256(canonical JSON of the full projection artifact)`, including source lineage and builder output. Legacy snapshot IDs remain separate fields. `projectionBundleId = sha256(canonical JSON of {schemaVersion, source, codeRef, builderVersions, projections, domainReview})`. Canonical JSON sorts object keys recursively while preserving array order. Projection entries contain content hashes, so changing any present artifact changes the bundle ID. The identity includes source extraction ID, canonical input hash, code reference, builder versions, projection statuses and identities, and domain-review state. It excludes `builtAt`, build/validation duration, machine name, local paths, PID, and the separate validation report. By default `codeRef` hashes the content hashes of all `src/**/*.ts`, `scripts/**/*.ts`, and `package-lock.json` files, including untracked source files. CI may supply an immutable `--code-ref` instead. A caller-supplied reference must be attested by that build system.

## Validation and publication

The builder verifies extraction hashes and P1.2 manifest before classification. Bundle validation rejects unsupported/extra manifest fields, unsupported present projection schemas, missing files, content hash mismatch, artifact JSON corruption, source lineage mismatch, snapshot identity mismatch, missing source products, duplicate Product or Training assignments, conflicting parsed specs for one product/key, invalid spec values or states, and incomplete legacy snapshot identities. Product keys use `P<positive integer>`; Product and Training IDs must exist in canonical source. Product presence must match `current_catalog` or `historical_order_detail_only`. Specs point to a recognized product and preserve that presence. Existing orphan category and feature rows stay in canonical source and are counted as warnings. A separate report records validator counts, warnings/errors, durations, and artifact sizes. The bundle manifest says `TECHNICALLY_VALID` with `domainReview: PENDING`; a pass never implies commercial approval.

Publishing first writes and validates a temporary directory, then renames it to the content ID. If the ID already exists, all file names and immutable projection bytes are compared; the existing manifest is semantically compared while allowing only its operational `builtAt` to differ. An existing directory is validated again. Conflicts fail with `IMMUTABLE_ARTIFACT_CONFLICT` or `BUNDLE_ID_COLLISION`. No published file is overwritten by the publisher. Filesystem owners can still edit local files outside the publisher; tampering is detected on validation/reuse. Stronger storage-level immutability is a deployment concern.

Failure codes include `INVALID_BUNDLE_MANIFEST`, `INVALID_PROJECTION_SCHEMA`, `PROJECTION_HASH_MISMATCH`, `SOURCE_LINEAGE_INVALID`, `BUNDLE_VALIDATION_FAILED`, `BUNDLE_ID_COLLISION`, `IMMUTABLE_ARTIFACT_CONFLICT`, and `PUBLICATION_FAILED`. Errors are structured by `BundleError.code`; the CLI prints a JSON failure record and exits nonzero.

## Initial Spec Projection

Rules cover feature IDs 11 (`max_user_weight_kg`), 12 and 41 (`max_load_kg`), 3 (`weight_kg`), and 15 (`assembled_length_cm`, `assembled_width_cm`, `assembled_height_cm`). They parse explicit `kg` or labeled `cm`, accept comma decimals, and preserve `productKey`, `catalogPresence`, feature/value IDs, raw value, rule version, unit and one of `parsed`, `ambiguous`, `unsupported`. Multiple distinct parsed values for a product/key become `ambiguous` with `value: null`; nothing is silently chosen. No other feature is normalized. Orphan feature rows are retained in the source and reported, not converted into product specs. Revenue is ignored by spec rules and identity except indirectly through the required P1.2 source hash; its 24 unexplained historical values do not gate projections.

## Semantic review and reproducibility

P1.2's historical diff records 15 semantic assignment changes caused by `current_catalog → historical_order_detail_only`. This build does not approve them. The diff stays in the P1.2 extraction report; `domainReview: PENDING` blocks treating this bundle as an activation candidate. Commercial review can be recorded in a later manifest revision with a new bundle ID.

`node dist/scripts/catalog-v2/write-bundle-replay-fixture.js` creates a stable, synthetic, PII-free source under ignored `artifacts/catalog-v2/replay-source`. Two independent Node processes built it into distinct output roots. Both produced the same four projection hashes and `projectionBundleId = sha256:81a326338bc2d837c8e0e75028da5ece0b1e3254890769e626136642cabcaa2a` on 2026-10-01 with automatic content-derived code refs. The P1.2 source produced technically valid, inactive bundle `sha256:ac7cafeec50049b0a864803ec16bae8005f36eb94335e15c396693c14005d966` from code ref `sha256:a91bf4cb4a8240944686c96f6a802510a6e83f39a33d45189f4131f1a7b71ea6`. Its 3,163 spec records comprise 2,599 parsed, 512 ambiguous and 52 unsupported values. The observed local run took 1,916 ms through validation (including 329 ms validation), then 512 ms to publish; these are measurements, not service guarantees.
