# CATALOG-INTELLIGENCE-TRAINING-SEMANTICS-A00.6.6 — Training Semantic Classifier V2

## Decision

`TRAINING_SEMANTIC_CLASSIFIER_V2_READY_WITH_DEBT`

Classifier V2 is implemented and audited against the unchanged 240-product
active training-relevant denominator. It materially improves semantic
resolution while retaining the accepted V1 assignments and precision-first
boundaries. The remaining debt is intentionally limited to the eight existing
`DATA_GAP`, five `AMBIGUOUS` and three `NEEDS_REVIEW` products.

## Authority and identity

- `classifierVersion`: `training-semantic-classifier-v2`
- `registryVersion`: `training-semantic-registry-v2`
- `registryHash`: `7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8`
- `rulesHash`: `a619932df9f2c4241330826cdd4b728164df7fa1672b2941e04fab621da8a78a`
- V1 registry hash preserved: `82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f`
- V1 snapshot preserved: `sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d`

The rules hash deterministically includes the V1 projection, all V2 exercise
capability and training-function rules, the single permitted family-derived
mapping, and the explicit false-positive boundary guards. It has no timestamp
or filesystem-order dependency.

## Implemented classification

V2 projects every accepted V1 assignment unchanged, then adds deterministic
V2 exercise-capability and training-function assignments. The 11 new exercise
capabilities are supported using only trusted name, trusted category,
structured feature and manual-override evidence. Free-text descriptions are
not positive evidence.

The five training functions remain separate from exercise capabilities:

- `CABLE_RESISTANCE`
- `MULTI_DIRECTIONAL_RESISTANCE`
- `BODYWEIGHT_SUPPORT`
- `BARBELL_SUPPORT`
- `GUIDED_BARBELL_SUPPORT`

The only family-derived function is `CABLE_MACHINE` →
`CABLE_RESISTANCE`. All other function assignments require direct explicit
Product Truth evidence. Training functions do not infer anatomy, exercise
capabilities, patterns or goals.

Multifunction products can receive multiple direct exercise capabilities when
each module is explicitly evidenced. This includes dual hack/leg press,
pec/rear-delt, and biceps/triceps products. Generic squat, rack, Smith,
barbell, cable, attachment and accessory boundaries remain guarded. In
particular, Deadlift Jack, barbell products, generic racks, generic cable
stations and cardio rowers do not acquire `DEADLIFT`, `SQUAT`,
`LAT_PULLDOWN` or `ROW` by inference.

## Rule closures

The four previously identified gaps are resolved with reusable rules and
positive/nearest-negative regression coverage:

- Product `388`: trusted parallel-bar/pull-up categories now preserve `DIP`
  and add explicit `PULL_UP`.
- Product `1270`: explicit lying leg-curl naming closes `LEG_CURL`.
- Product `2089`: explicit hip-thruster naming closes `HIP_THRUST`.
- Product `2092`: explicit T-Bar Row naming closes `ROW`.

No product-ID-specific classifier patch was added.

## Resolution audit

The audit classified the full 2,011-product input universe and evaluated the
same 240 active training-relevant products used by the V1 baseline:

| Metric | Result |
| --- | ---: |
| V1 assignments preserved | 180 (157 `DIRECT`, 23 `SUPPORTED`) |
| New ExerciseCapability assignments | 52 |
| Existing-code rule-closure assignments | 38 |
| TrainingFunction assignments | 276 |
| Targeted ontology gaps resolved | 40 / 40 |
| Rule closures completed | 4 / 4 |
| Active training-relevant resolved | 224 / 240 |
| `REAL_SEMANTIC_RESOLUTION_RATE` | 93.33% |

Final active resolution states:

- `SEMANTIC_COMPLETE`: 112
- `VERIFIED_NO_APPLICABLE_CAPABILITY`: 112
- `DATA_GAP`: 8
- `AMBIGUOUS`: 5
- `NEEDS_REVIEW`: 3
- `SEMANTIC_PARTIAL`, `ONTOLOGY_GAP`, `RULE_GAP`: 0

The 16 unresolved products remain explicit in the unresolved CSV. Training
Function receipt alone does not mark a product complete when known Product
Truth still has unresolved exercise modules.

## Deterministic audit tooling and artifacts

Commands:

```text
npm run product:training-semantics:v2:classify
npm run product:training-semantics:v2:resolution:audit
```

Artifacts are under `docs/audits/training-semantics/a00.6.6/`:

- `training-semantic-v2-classification.csv`
- `training-semantic-v2-training-functions.csv`
- `training-semantic-v2-resolution-active.csv`
- `training-semantic-v2-resolution-unresolved.csv`
- `training-semantic-v2-resolution-report.json`

The V2 snapshot, API, semantic discovery, Sales Agent, Customer Profile and
ranking remain out of scope. The V1 snapshot and active V1 runtime were not
modified.

## Validation

The release includes focused coverage for all 11 new capabilities, all five
training functions, V1 projection preservation, family-derivation policy,
multifunction products, false-positive boundaries and deterministic hashes.

Focused V2, registry V1/V2, classification V1 and snapshot V1 regression
tests passed: 81 tests. Typecheck and build passed. Lint passes for the new V2
module, classifier test and audit script.

The global pre-existing suite still reports eight unrelated failures: the
runtime-config missing-password test, two catalog fixture-path assertions, two
Product Semantic golden-set timeouts, three Product Semantic V3 cable-machine
timeouts, and one Product Semantic snapshot fixture-path assertion. Global
lint still reports seven pre-existing unused-variable errors outside the V2
module. These are recorded as unrelated debt and do not change the V2 audit
decision.

The next release is A00.6.7 — Data + Review Gap Closure. It may use trusted
enrichment to address at least four of the eight `DATA_GAP` products; it must
not infer missing Product Truth and must not build a V2 snapshot.
