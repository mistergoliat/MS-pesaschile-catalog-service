# CATALOG-INTELLIGENCE-TRAINING-SEMANTICS-A00.6.5 — Training Semantic Registry V2

## Decision

`TRAINING_SEMANTIC_REGISTRY_V2_READY_WITH_DEBT`

This release publishes the versioned V2 vocabulary and contracts only. It does
not classify products, migrate assignments, build or activate a snapshot, add
an HTTP API, or change the active V1 runtime.

## Registry identity

- `schemaVersion`: `2`
- `registryVersion`: `training-semantic-registry-v2`
- `registryHash`: `7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8`
- `status`: `PUBLISHED`
- V1 registry hash preserved: `82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f`
- V1 snapshot preserved: `sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d`

The hash canonicalizes semantic definitions, statuses, derived relations,
family policies and boundaries. It excludes provenance, timestamps and
filesystem order.

## Exercise capabilities

V2 has exactly 24 active capabilities. The 13 V1 definitions and derived
semantics are copied unchanged:

`LEG_EXTENSION`, `LEG_CURL`, `HIP_THRUST`, `CHEST_PRESS`, `PEC_DECK`,
`LAT_PULLDOWN`, `ROW`, `SHOULDER_PRESS`, `PULL_UP`, `DIP`,
`ABDOMINAL_CRUNCH`, `ADDUCTOR`, `ABDUCTOR`.

The 11 approved additions are:

`HACK_SQUAT`, `LEG_PRESS`, `CALF_RAISE`, `REAR_DELT_FLY`, `BICEPS_CURL`,
`TRICEPS_EXTENSION`, `PENDULUM_SQUAT`, `BELT_SQUAT`, `REVERSE_HYPER`,
`DEADLIFT`, `PULLOVER`.

`SQUAT` and `GLUTE_KICKBACK` are absent by contract. No product IDs or
evidence-product lists are stored in the registry.

## Training functions

V2 has exactly five active training functions:

`CABLE_RESISTANCE`, `MULTI_DIRECTIONAL_RESISTANCE`, `BODYWEIGHT_SUPPORT`,
`BARBELL_SUPPORT`, `GUIDED_BARBELL_SUPPORT`.

These are not exercise capabilities and have no anatomy, training-pattern or
training-goal derivation fields. `GUIDED_BARBELL_SUPPORT` is a distinct code
from `BARBELL_SUPPORT`.

Function assignments use their own relation model: `DIRECT` and
`FAMILY_DERIVED`. Function `SUPPORTED` was not added because the approved
design reserves module support semantics for explicit exercise evidence rather
than introducing a third, ambiguous function relation.

Allowed evidence kinds are `NAME`, `TRUSTED_CATEGORY`, `STRUCTURED_FEATURE`,
`FAMILY_DERIVATION` and `MANUAL_OVERRIDE`. Family derivation is only valid for
an explicitly registered mapping.

## Family derivation policy

The only V2 family-derived mapping is:

`CABLE_MACHINE` → `CABLE_RESISTANCE`

It is versioned in `familyTrainingFunctionDerivations`. `RACK_CAGE` does not
derive `BARBELL_SUPPORT`, and `BODYWEIGHT_GYMNASTICS` does not derive
`BODYWEIGHT_SUPPORT`. Those functions require direct Product Truth evidence.

## Semantic boundaries

- A dedicated deadlift machine may receive `DEADLIFT` by direct evidence.
- A deadlift jack is `NOT_DEADLIFT`.
- A barbell is not `DEADLIFT` automatically.
- No family-derived `DEADLIFT` exists.
- Generic racks, Smith equipment and support equipment do not receive generic
  `SQUAT`; they remain a specific exercise capability only when the explicit
  hack, pendulum or belt mechanism is asserted, or a training function/other
  Product Truth is appropriate.
- Training functions cannot derive `BODY_REGION`, `MUSCLE_GROUP`,
  `TRAINING_PATTERN` or `TRAINING_GOAL`.

## Mapping debt

The existing V1 derived vocabulary is intentionally not expanded into an
exhaustive anatomy taxonomy. Consequently:

- `CALF_RAISE`, `BICEPS_CURL`, `TRICEPS_EXTENSION`, `REAR_DELT_FLY` and
  `PULLOVER` have partial mappings where a stable body region or muscle group
  is sufficiently firm, but no invented training pattern.
- `HACK_SQUAT`, `PENDULUM_SQUAT` and `BELT_SQUAT` use the existing
  `KNEE_EXTENSION` vocabulary and retain `GLUTES` as secondary anatomy; the
  combined squat pattern is not represented separately.
- `DEADLIFT` is deliberately partial: it uses lower-body, glutes/hamstrings
  and hip extension without claiming a new full-body or posterior-chain
  vocabulary.
- No new `BODY_REGION`, `MUSCLE_GROUP` or `TRAINING_PATTERN` code was needed.

These are registry mapping debts, not product assignments. They should be
reviewed before any classifier rule uses the affected capability.

## Snapshot V2 contract

The V2-only snapshot contract is defined but not built or activated. A future
record contains:

```json
{
  "productId": 123,
  "exerciseCapabilities": [],
  "trainingFunctions": [],
  "coverageStatus": "UNMODELED",
  "warnings": []
}
```

The future snapshot lineage must include `sourceV1SnapshotId`,
`registryV2Hash` and `classifierV2RulesHash`. V1 assignments remain
semantically byte-for-byte preservable, and the V1 registry/snapshot artifact
is never overwritten. No active snapshot pointer was changed.

## Validation results

The V2 validator checks unique codes, cross-type collisions, active counts,
valid derived references, V1 compatibility, anatomy isolation, approved family
derivations, SQUAT/GLUTE_KICKBACK guards, canonical hashing and hash
determinism. It also rejects product-specific fields in the registry.

Verification completed:

- TypeScript typecheck: passed.
- V1 training semantics/classification/snapshot tests: 55 passed.
- V2 registry and contract tests: 7 passed.
- Product assignments changed: `NO`.
- Classifier changed: `NO`.
- Snapshot changed: `NO`.

Next release, if the debt is accepted, is A00.6.6: classifier V2 and existing
rule closures. It is intentionally outside this release.

