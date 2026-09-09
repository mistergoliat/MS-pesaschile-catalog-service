# CATALOG-INTELLIGENCE-TRAINING-SEMANTICS-A00.6.8 — Training Semantic Snapshot V2

## Decision

`TRAINING_SEMANTIC_SNAPSHOT_V2_ACCEPTED_WITH_DEBT`

The immutable V2 artifact is published locally and passes the snapshot-based
acceptance audit: `234 / 240 = 97.50%`. The six unresolved products remain
explicitly represented.

## Snapshot and lineage

- `schemaVersion`: `2`
- `snapshotId`: `sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1`
- `semanticChecksum`: `e15673be136a730d3e90645446ba55f0734b491163f47b4a617b9c5c974f8941`
- Registry: `training-semantic-registry-v2`
- Registry hash: `7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8`
- Classifier: `training-semantic-classifier-v2.1`
- Rules hash: `5e4e591b45e7704975552f305d59d73535c3889ed655754aa0113844c9c03b6d`
- Source V1 snapshot: `sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d`
- V1 accepted ExerciseCapability assignments preserved: `180`

Timestamps and filesystem paths are excluded from semantic identity. Records,
assignments, evidence and warnings are canonically sorted before hashing.

## Acceptance metrics

| Metric | Value |
| --- | ---: |
| Source products | 2011 |
| Active training-relevant | 240 |
| Resolved active training-relevant | 234 |
| `REAL_SEMANTIC_RESOLUTION_RATE` | 97.50% |
| ExerciseCapability assignments | 275 |
| TrainingFunction assignments | 282 |
| Products with ExerciseCapabilities | 231 |
| Products with TrainingFunctions | 254 |

Resolution states: `SEMANTIC_COMPLETE=122`,
`VERIFIED_NO_APPLICABLE_CAPABILITY=112`, `DATA_GAP=2`, `AMBIGUOUS=4`,
`NEEDS_REVIEW=0`.

Snapshot audit output: `snapshotV2ResolutionRate=97.5`,
`snapshotV2ResolvedCount=234`, `snapshotV2UnresolvedCount=6`, discrepancy `0`.

## Remaining unresolved

- `1122`: `DATA_GAP` — upstream Product Family/mechanism truth is missing.
- `2025`: `DATA_GAP` — Hip Extension is not reinterpreted as HIP_THRUST.
- `1945`, `1946`, `1947`, `1948`: `AMBIGUOUS` packs — no component SKU
  relationship or governed pack projection exists.

No pack semantic inheritance was created.

## Storage and reader behavior

- V1 remains under `data/training-semantic-snapshots/`.
- V2 artifacts are under `data/training-semantic-snapshots/v2/`.
- The immutable artifact is `v2/snapshots/<snapshotId>.json`.
- The V2 pointer is `v2/active.json`, independent of V1.
- Publication validates the persisted artifact before atomically updating the
  V2 pointer. Repeating an identical build is idempotent.
- The V2 reader exposes separate `exerciseCapabilities`, `trainingFunctions`,
  `resolutionState`, `coverageStatus` and runtime-derived exercise semantics.
  TrainingFunctions never derive anatomy. An unavailable snapshot is distinct
  from an existing product with empty assignments.

## Known debt

The six unresolved Product Truth cases require upstream data or a governed pack
policy. Sales Agent semantic discovery was not created. The next releases are
A00.7 (Training Semantics Read Surface V2) and A00.8 (Training Semantic Query
Surface), separately.

## Unrelated global validation failures

The complete `npm test` run also reports failures in
`runtimeConfigHardening.test.ts`, Product Semantic golden-set/v3 cable-machine
tests, and Product Semantic CLI fixture tests. They are outside Training
Semantic Snapshot V2 and were not modified by this release. The focused
Training Semantic V1/V2/V2.1/registry suite passes.
