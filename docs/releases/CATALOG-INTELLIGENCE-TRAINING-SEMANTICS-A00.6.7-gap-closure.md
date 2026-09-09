# CATALOG-INTELLIGENCE-TRAINING-SEMANTICS-A00.6.7 — Data + Review Gap Closure

## Decision

`TRAINING_SEMANTIC_95_PERCENT_TARGET_REACHED`

The release adjudicates all 16 unresolved active training-relevant products
and raises defensible semantic resolution from 224/240 to 234/240. It does not
build Snapshot V2, add an API, integrate Sales Agent or modify Customer
Profile.

## Authority

- Registry: `training-semantic-registry-v2`
- Registry hash unchanged: `7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8`
- Classifier: `training-semantic-classifier-v2.1`
- Rules hash: `5e4e591b45e7704975552f305d59d73535c3889ed655754aa0113844c9c03b6d`
- Prior classifier: `training-semantic-classifier-v2`
- Prior rules hash: `a619932df9f2c4241330826cdd4b728164df7fa1672b2941e04fab621da8a78a`
- V1 accepted assignments preserved: `180`
- V1 registry hash preserved: `82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f`
- V1 snapshot preserved: `sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d`

## Results

| Metric | Before | After |
| --- | ---: | ---: |
| Active training-relevant | 240 | 240 |
| Resolved | 224 | 234 |
| `REAL_SEMANTIC_RESOLUTION_RATE` | 93.33% | 97.50% |
| `DATA_GAP` | 8 | 2 |
| `AMBIGUOUS` | 5 | 4 |
| `NEEDS_REVIEW` | 3 | 0 |
| Remaining unresolved | 16 | 6 |

New classifier assignments: 5 `ExerciseCapability` and 6
`TrainingFunction` assignments across the full catalog universe. Five of the
new functions close unresolved products; the sixth applies the same reusable
crossover rule to an already resolved product.

Ten unresolved products are closed: 494, 495, 1427, 1504, 1508, 1516, 1517,
1604, 2139 and 2203. The four packs (1945–1948) remain `AMBIGUOUS`; 1122
remains a `PRODUCT_SEMANTICS_DATA_GAP`; and 2025 remains `DATA_GAP` because
its hip-extension mechanism is not represented by trusted structured truth.

## Classifier V2.1 changes

V2.1 preserves V2.0 and adds deterministic structured enrichments for:

- `Polea Cruzada` crossover geometry, gated by `CABLE_MACHINE` and strong
  category 290.
- `Polea Dual Multifuncional` dual geometry, gated by strong category 290 and
  semantic cable-ratio feature 65 containing both `2:1` and `1:1`.
- explicit dual quadriceps/femoral machines, producing independent
  `LEG_EXTENSION` and `LEG_CURL` capabilities.
- explicit dual pectoral/shoulder press machines, producing independent
  `CHEST_PRESS` and `SHOULDER_PRESS` capabilities.

No product-ID-specific classifier rule was added. Generic cable, generic press,
pack names, descriptions alone, powerlifting terminology, and hip-extension
wording do not create unsupported semantics.

## Product Truth and precision

Descriptions were used for investigation only. Positive deterministic evidence
comes from canonical names, Product Family, trusted categories and semantic
structured features. Every unresolved record has one adjudication and an exact
blocker in the audit artifacts. All 10 newly closed products passed targeted
manual precision review: 10 correct, 0 incorrect, 0 ambiguous.

## Artifacts and validation

Artifacts are under `docs/audits/training-semantics/a00.6.7/`:

- `data-review-gap-closure.md`
- `gap-closure-decisions.csv`
- `trusted-enrichment.csv`
- `post-closure-resolution-active.csv`
- `post-closure-resolution-unresolved.csv`
- `post-closure-resolution-report.json`

Audit command:

```text
npm run product:training-semantics:v2.1:resolution:audit
```

Typecheck and focused V2.1/V2/V1 regression tests pass. Registry hash is
unchanged, classifier rules are versioned, and the V2 snapshot remains
unbuilt. Next release: A00.6.8 — Training Semantic Snapshot V2 + Final
Acceptance.
