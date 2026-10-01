# CAT-V2 P1.4 — Activation control plane

## Boundary

`catalog:bundle:build` publishes immutable bundles under `artifacts/catalog-v2/bundles/<id>`. It does not activate them. `catalog:projection:activate` and `catalog:projection:rollback` change only `artifacts/catalog-v2/control/`. The API process does not read the pointer yet. `desiredProjectionBundleId` is the control-plane choice; `loadedProjectionBundleId` is unknown (`null`) and `runtimeConsumption` is `NOT_YET_WIRED` until P1.5.

```text
immutable bundle → candidate verification → activation service → atomic active.json
                                                          ↘ append-only history → rollback
CONTROL PLANE: active.json, history, activation CLI
RUNTIME DATA PLANE: existing legacy loaders; no pointer polling or hot reload
```

## Contract and identity

`active.json` schema version `1` has `activeProjectionBundleId`, `activatedAt`, UUID `activationId`, nullable `previousProjectionBundleId` and `previousActivationId`, `{type, identity}` actor, reason, and `bundleManifestHash`. The bundle ID names content; the activation ID names a transition. Rollback to old content creates a fresh activation ID. The pointer never resides inside a bundle. It is checked for schema, referenced bundle existence, manifest schema and exact manifest byte hash on read. Corrupt state is an error, not a fresh installation.

The committed activation history is the chain of `history/<activationId>.json` records reachable through `previousActivationId` from the current pointer. Each record records `from`, `to`, the pointer fields and `candidateValidation: {status: "PASS"}`. A record written before promotion but not referenced by the committed pointer is an interrupted preparation, not a completed activation. History files are created with exclusive write and are never overwritten or deleted by the protocol. The current pointer's `previousProjectionBundleId` is a convenience; rollback reads the committed history chain.

## Candidate gate

Activation accepts only `sha256:<64 lowercase hex>` bundle IDs. It reopens the published directory and requires manifest schema 1, matching directory/manifest identity, a PASS validation report with the same ID, `TECHNICALLY_VALID`, and canonical source bytes matching `sourceExtractionId`. It reruns `validateBundle` against every present artifact: hashes, schemas, snapshot identity, source lineage, and cross-projection links are checked again. Source files are looked up under `artifacts/catalog-projection-input/*/canonical_input.json` and `artifacts/catalog-v2/replay-source/canonical_input.json`, or injected source roots in the programmatic store. An unavailable or altered source prevents activation. These source roots must be retained with published bundles.

Runtime compatibility version 1 accepts manifest 1 and present `productSemantics`, `trainingSemantics`, `specs`, and `trustMaps` schema 1. All four are required. `relationships` and `capabilities` are accepted as unavailable; if present, they fail until an adapter and supported version are added. `domainReview: PENDING` is allowed: technical validity is the P1.4 gate, and no external commercial certification is implied. This P1.4 policy supersedes the earlier P1.3 note that PENDING blocked candidacy.

## Promotion, concurrency and failure

The service reads and verifies the current pointer, checks optional `expectedActiveBundleId`, and returns `already_active` without a new record if the candidate is already desired. It validates the candidate before requesting a promotion. The filesystem store takes an exclusive directory lock, rereads the pointer and compares `activationId` under that lock. This protects even callers that omit the CLI expectation from lost updates. A conflict returns `ACTIVATION_CONFLICT`.

Under the lock, the store writes and fsyncs a unique history record, writes and fsyncs a complete temporary pointer in the same directory, then renames it over `active.json`. Readers see the old or new JSON, never a partial write. A crash before rename leaves the old pointer and possibly an unreferenced preparation file. A crash after rename leaves the new pointer and its history record. A stray temporary file is ignored. The lock may remain after process death; an operator must verify the process is gone and remove `control/.activation-lock` before further mutations. The active pointer remains readable. Local filesystem rename and fsync semantics are assumed; network shares need their own durability review.

Rollback without `--to` targets `from` in the latest committed record. `--to` accepts only a bundle in the committed chain. The target passes the same candidate gate before promotion. Missing/invalid targets return `NO_ROLLBACK_TARGET` or `ROLLBACK_TARGET_INVALID`, leaving the pointer unchanged. First activation is `null → bundle`; it has no rollback target. Both commands are privileged local operations; restrict filesystem write access to operators.

## Commands

```bash
npm run catalog:projection:activate -- --bundle=sha256:<id> --expected-active=sha256:<old-id> --actor=operator --reason=release
npm run catalog:projection:rollback -- --actor=operator
npm run catalog:projection:rollback -- --to=sha256:<historical-id> --actor=operator
npm run catalog:projection:status -- --bundle=sha256:<candidate-id>
```

`--root=<directory>` chooses a separate local control-plane and bundle root for a drill. The default is `artifacts/catalog-v2`. CLI output is structured JSON. `status` reports desired bundle, previous activation, committed history, optional candidate validation, and explicitly reports that runtime consumption is not wired. P1.5 should observe the desired pointer, validate before load, perform an atomic in-memory swap and report the actual loaded bundle independently.
