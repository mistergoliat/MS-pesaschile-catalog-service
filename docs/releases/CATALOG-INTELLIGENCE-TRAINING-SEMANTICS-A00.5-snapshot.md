# CATALOG-INTELLIGENCE-TRAINING-SEMANTICS-A00.5 — Training Semantic Snapshot

## Decision

`TRAINING_SEMANTIC_SNAPSHOT_READY` cuando el build reproduce el baseline aceptado.
Este release publica Product Truth interno; no crea API, discovery, scoring,
Sales Agent logic ni Customer Profile changes.

## Contract and identity

The immutable snapshot uses schema version `1` and contains registry/classifier
lineage, `semanticChecksum`, `snapshotId`, `generatedAt`, counts and one sparse
record for every source product. Records preserve assignments, evidence,
review state, warnings and explicit coverage status. Deferred findings are not
published.

`semanticChecksum` hashes canonical records. `snapshotId` hashes schema,
registry lineage, classifier/rules lineage, semantic checksum and counts.
Neither identity includes `generatedAt`, `activatedAt` or filesystem paths.
Product records sort by numeric `productId`; assignments sort by capability and
relation; evidence and warnings are sorted deterministically.

The published registry lineage is `training-semantic-registry-v1` with hash
`82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f`.
Classifier lineage is `training-semantic-classifier-v1.1` with rules hash
`83007958a40fd29a87eb01d1fe159812587876c5e57295d7344024bda0123248`.
Derived body regions, muscle groups and training patterns are resolved from the
registry when a runtime fact is read; they are not copied into product records.

## Baseline

The first build is fail-closed against 2011 source products, 180 assignments,
157 `DIRECT`, 23 `SUPPORTED`, 23 multi-assignment products and zero
`NEEDS_REVIEW`. Coverage is 881 `NO_CAPABILITY_APPLICABLE`, 1086 `UNMODELED`,
44 `INSUFFICIENT_EVIDENCE`, zero `NEEDS_REVIEW`.

`ABDOMINAL_CRUNCH` remains active in the registry with zero assignments. The
deferred candidate capabilities, including `SQUAT`, are not Product Truth in
this snapshot.

## Storage and publishing

Default storage is `data/training-semantic-snapshots`, configurable through
`TRAINING_SEMANTIC_SNAPSHOT_DIR`. The layout is `active.json` plus immutable
`snapshots/<sha256>.json` files. Build writes the artifact, validates the
persisted artifact, then atomically updates the active pointer. Rebuilding the
same semantic input returns `already_exists` and does not duplicate the file.

Build:

```text
npm run product:training-semantics:snapshot:build
```

Inspect metadata, coverage or capabilities:

```text
npm run product:training-semantics:snapshot:inspect
npm run product:training-semantics:snapshot:inspect -- --view=coverage-counts
npm run product:training-semantics:snapshot:inspect -- --view=capability-counts
npm run product:training-semantics:snapshot:inspect -- --product-id=123
```

## Runtime behavior and known debt

The read-only runtime reader loads only the active snapshot. It distinguishes
unavailable storage from a present product whose assignments are empty. It does
not classify on demand, query the database or invoke Sales Agent logic. A
missing active snapshot is an unavailable Training Semantics dependency and
does not alter general Catalog readiness.

This release does not decide whether sparse coverage is safe or a semantic gap;
that review belongs to A00.6 — Training Semantic Coverage & Acceptance Review.

## Validation note

`npm run typecheck`, focused Training Semantics tests, classifier/registry tests,
and relevant Product Semantic Snapshot regressions pass. A full-suite run in
this workspace also exposes pre-existing environment-sensitive failures: tests
expect a different checkout directory name, `DB_PASSWORD` is supplied by the
local `.env`, and several unrelated HTTP/acceptance tests exceed the default
5-second timeout under full-suite contention. These do not involve the new
snapshot module or its baseline.
