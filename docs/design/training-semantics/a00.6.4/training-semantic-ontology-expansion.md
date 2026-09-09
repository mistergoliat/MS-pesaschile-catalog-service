# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.6.4 — Ontology Expansion for 95% Semantic Resolution

## Decision: TRAINING_SEMANTIC_ONTOLOGY_EXPANSION_READY_WITH_DEBT

This is a design slice only. It does not modify the registry, classifier, Training Semantic Snapshot, Product Semantic Snapshot, runtime, API, Sales Agent or Customer Profile.

## Baseline and gate

- Active training-relevant denominator: 240
- Current resolved: 180 / 240 = 75%
- Target: 228 / 240 = 95%
- Deficit: 48 products
- A00.5 snapshot lineage: `sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d`
- Registry lineage: `training-semantic-registry-v1` / `82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f`
- Classifier lineage: `training-semantic-classifier-v1.1` / `83007958a40fd29a87eb01d1fe159812587876c5e57295d7344024bda0123248`

## Review of all 41 ontology gaps

All 41 A00.6.2 ONTOLOGY_GAP records are present in `ontology-gap-products.csv`. The proposed closure is 40 records through new ontology concepts, 1 record through existing-V1 rule closure, and 0 SEMANTIC_PARTIAL records under the evidence gates below. Product 2089 is retained as a current HIP_THRUST rule closure, not a new ontology concept.

| Conceptual group | Products | Resolution role | Candidate concepts |
| --- | --- | --- | --- |
| Dedicated exercise machines | 26 | New EXERCISE_CAPABILITY vocabulary | LEG_PRESS, HACK_SQUAT, CALF_RAISE, REAR_DELT_FLY, BICEPS_CURL, TRICEPS_EXTENSION, PENDULUM_SQUAT, BELT_SQUAT, REVERSE_HYPER, DEADLIFT, PULLOVER |
| General/instrumental equipment | 14 | New TRAINING_FUNCTION vocabulary | BARBELL_SUPPORT, GUIDED_BARBELL_SUPPORT, BODYWEIGHT_SUPPORT, CABLE_RESISTANCE, MULTI_DIRECTIONAL_RESISTANCE |
| Existing V1 closure | 1 | Classifier rule closure | HIP_THRUST (product 2089) |

The boundary is deliberate: EXERCISE_CAPABILITY asserts a specific exercise/function; TRAINING_FUNCTION asserts an instrumental training utility without deriving muscles, body regions or a customer workout goal.

## Candidate TRAINING_FUNCTION vocabulary

| Code | Evidence | Decision | Rationale |
| --- | --- | --- | --- |
| EXTERNAL_LOAD | No unique 41-product evidence | DO_NOT_ADD | Too broad; not discriminative for discovery. |
| FREE_WEIGHT_LOAD | BARBELL/DUMBBELL/KETTLEBELL families, no ontology-gap evidence | DO_NOT_ADD | Duplicates Product Family unless modality evidence is added later. |
| SELECTORIZED_RESISTANCE | SELECTORIZED_MACHINE family | DO_NOT_ADD | Directly repeats Product Family. |
| PLATE_LOADED_RESISTANCE | PLATE_LOADED_MACHINE family | DO_NOT_ADD | Directly repeats Product Family. |
| CABLE_RESISTANCE | 1450,1451,1455,1921 | ADD | General resistance delivery is useful without inventing an exercise. |
| MULTI_DIRECTIONAL_RESISTANCE | 1455,1921 | ADD | Only explicit crossover/dual geometry qualifies. |
| BODYWEIGHT_SUPPORT | 1126 | ADD | Represents support/obstacle utility without exercise overclaim. |
| BARBELL_SUPPORT | 1121,1535,1539,1544 | ADD | Represents a rack/stand function, not SQUAT. |
| GUIDED_BARBELL_SUPPORT | 1274,1922,2068,2133,2134 | ADD | Distinguishes Smith/Multipower guided path from open rack. |
| SAFETY_SUPPORT | No sufficient structured evidence in the 41 | CONDITIONAL | Add only when safety arms/catches are explicit structured Product Truth. |
| UNILATERAL_LOAD | 2018 wording is insufficient for universal function | DO_NOT_ADD | Keep as a feature/structured attribute until repeated evidence exists. |
| BILATERAL_LOAD | No sufficient evidence | DO_NOT_ADD | No material resolution gain. |
| BALLISTIC_LOAD | No sufficient evidence | DO_NOT_ADD | No material resolution gain. |
| CARRY_LOAD | No sufficient evidence | DO_NOT_ADD | No material resolution gain. |
| SUSPENSION_SUPPORT | No sufficient evidence in the 41 | DO_NOT_ADD | Revisit only with explicit suspension products. |
| DRAG_PUSH_RESISTANCE | ROPE_SLED is already a verified negative, not an ontology gap | DO_NOT_ADD_IN_MINIMUM | Potential future discovery concept, no A00.6.4 target gain. |
| ANCHOR_SUPPORT | No sufficient evidence | DO_NOT_ADD | No material resolution gain. |

Minimum accepted function set: CABLE_RESISTANCE, MULTI_DIRECTIONAL_RESISTANCE, BODYWEIGHT_SUPPORT, BARBELL_SUPPORT and GUIDED_BARBELL_SUPPORT. SAFETY_SUPPORT remains conditional because the 41 records do not contain sufficient structured safety-feature evidence.

## Candidate EXERCISE_CAPABILITY v2 vocabulary

| Code | Evidence products | Gain | Decision | Precision gate |
| --- | --- | --- | --- | --- |
| HACK_SQUAT | 1229,1272,1654,1660,1661,1884,2019 | 7 | ADD | Explicit dedicated hack/V-squat evidence with mechanism gate. |
| LEG_PRESS | 491,1273,1275,1655,1658,1662,2018,2188 | 8 | ADD | Eight active explicit leg-press products. |
| CALF_RAISE | 1284,1511 | 2 | ADD | Explicit standing/seated calf-raise machines. |
| REAR_DELT_FLY | 1266,1664 | 2 | ADD | Required for exhaustive dual pec-fly/rear-delt products. |
| BICEPS_CURL | 1507 | 1 | ADD | Explicit dual biceps/triceps product. |
| TRICEPS_EXTENSION | 258,1507 | 2 | ADD | One dedicated active product plus one dual machine. |
| PENDULUM_SQUAT | 1663 | 1 | ADD | Explicit pendulum geometry. |
| BELT_SQUAT | 2021 | 1 | ADD | Explicit belt-squat product; no generic SQUAT. |
| REVERSE_HYPER | 2022 | 1 | ADD | Explicit reverse-hyper product. |
| DEADLIFT | 2026 | 1 | LIMITED_ADD | Explicit active machine, distinct from the dropped accessory finding. |
| PULLOVER | 2091 | 1 | ADD | Explicit dedicated pullover machine. |
| HIP_THRUST | 2089 | 1 | RULE_CLOSURE | Existing V1 concept; classifier fix only. |

Generic SQUAT is not reintroduced. HACK_SQUAT is narrow and requires mechanism/geometry evidence. LEG_PRESS is promoted because eight active products have explicit press evidence. GLUTE_KICKBACK remains deferred because no active ontology-gap product establishes a safe gain.

## General equipment family adjudication

| Family | Training Function policy | Direct vs derived | Discovery value | Decision |
| --- | --- | --- | --- | --- |
| BARBELL | FREE_WEIGHT_LOAD is universal but redundant with Product Family; no new function in minimum set. | No new relation | Low incremental value | DO_NOT_ADD |
| DUMBBELL | Do not derive a dummy function; unilateral/bilateral load requires explicit evidence. | No new relation | Potential future value | DO_NOT_ADD |
| KETTLEBELL | BALLISTIC_LOAD is not universal enough from family alone. | No new relation | Potential future value | DO_NOT_ADD |
| WEIGHT_PLATE | EXTERNAL_LOAD is too broad and redundant for this slice. | No new relation | Low incremental value | DO_NOT_ADD |
| BENCH | Generic/adjustable/flat/abdominal/hip-thrust distinctions stay Product Family/features or explicit exercise assignments. | No family-wide function | Avoid CHEST_PRESS overclaim | DO_NOT_ADD |
| RACK_CAGE | BARBELL_SUPPORT may be direct from explicit stand/rack evidence; GUIDED_BARBELL_SUPPORT for Smith/Multipower. | DIRECT; supported modules remain separate | High: safe bar support | ADD_LIMITED |
| CABLE_MACHINE | CABLE_RESISTANCE for generic cable stations; MULTI_DIRECTIONAL_RESISTANCE only for explicit crossover/dual geometry. | FAMILY_DERIVED only for generic cable; DIRECT for geometry | High: “quiero entrenar con poleas” | ADD_LIMITED |
| BAND_SUSPENSION | SUSPENSION_SUPPORT requires explicit product evidence; not family-wide in this slice. | DIRECT/structured only | Future value | DO_NOT_ADD |
| ROPE_SLED | DRAG_PUSH_RESISTANCE is a future candidate; no A00.6.4 ontology-gap gain. | Potential family-derived | Future value | DO_NOT_ADD_IN_MINIMUM |
| BODYWEIGHT_GYMNASTICS | BODYWEIGHT_SUPPORT for explicit support/obstacle equipment; PULL_UP/DIP remain explicit supported capabilities. | DIRECT or constrained family-derived | High without exercise overclaim | ADD_LIMITED |
| MACHINE_ATTACHMENT | No generic Training Function; preserve attachment/support semantics and explicit supported modules. | No family-wide function | Avoid false positives | DO_NOT_ADD |

## Direct vs derived policy

- FAMILY_DERIVED: only stable generic functions where Product Family is authoritative and the function is useful beyond a duplicate family label (generic cable resistance is the accepted example).
- DIRECT: explicit name, trusted category or structured feature establishes a product function or exercise capability.
- SUPPORTED: a rack/module supports PULL_UP or DIP only when the module is explicit; Training Function does not derive anatomy or exercise capabilities.
- MANUAL_OVERRIDE: allowed only as a documented exception with evidence, never as silent classifier fallback.

## Boundary with existing semantics

| Layer | Meaning | Example | Must not do |
| --- | --- | --- | --- |
| EXERCISE_CAPABILITY | Specific exercise/function asserted by Product Truth. | LEG_PRESS, HACK_SQUAT, LEG_EXTENSION. | Do not map generic rack/cable/bench to an exercise. |
| TRAINING_FUNCTION | Instrumental/general training utility. | CABLE_RESISTANCE, BARBELL_SUPPORT. | Do not derive muscle groups, body regions or goals. |
| PRODUCT_FAMILY | Commercial/product classification. | CABLE_MACHINE, RACK_CAGE. | Do not treat family as an exercise assignment. |
| TRAINING_PATTERN | Derived only from an exercise capability where registry semantics support it. | Existing registry derivation. | Do not derive from generic equipment function. |

## 95% simulation

| Option | Resolved | Rate | Remaining | Precision risk | Complexity | Redundancy | Discovery value |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A_EXERCISE_CAPABILITY_ONLY | 206 | 85.83% | 34 | MEDIUM_HIGH | MEDIUM | LOW | MEDIUM |
| B_TRAINING_FUNCTION_ONLY | 194 | 80.83% | 46 | LOW_MEDIUM | LOW | MEDIUM | HIGH_FOR_GENERIC_EQUIPMENT |
| C_COMBINED_MINIMUM_ONTOLOGY | 220 | 91.67% | 20 | MEDIUM_CONTROLLED_BY_EVIDENCE_GATES | HIGH | LOW | HIGH |
| D_COMBINED_PLUS_REQUIRED_CLOSURE | 228 | 95% | 12 | CONTROLLED_WITH_REVIEW | HIGH | LOW | HIGHEST |

Ontology expansion alone reaches 220/240 = 91.67%; it cannot honestly claim 95%. The minimum target path is the combined model plus four classifier closures (products 388, 1270, 2092 and 2089) plus four data closures selected from the highest-value DATA_GAP records (1427, 1517, 494 and 495). That yields 228/240 = 95.00%, leaving 12 unresolved: four remaining DATA_GAP, five AMBIGUOUS and three NEEDS_REVIEW.

## Deferred exercise capability decisions

| Capability | Decision | Active gain observed in this audit | Reason |
| --- | --- | --- | --- |
| SQUAT | REDEFINE | 0 | Generic SQUAT remains heterogeneous; split HACK_SQUAT, BELT_SQUAT, PENDULUM_SQUAT and support functions. |
| HACK_SQUAT | ADD | 7 | Dedicated explicit products with a mechanism gate. |
| LEG_PRESS | ADD | 8 | Eight active explicit products; material resolution gain. |
| BICEPS_CURL | ADD | 1 | Explicit dual biceps/triceps product. |
| TRICEPS_EXTENSION | ADD | 2 | Dedicated and dual explicit products. |
| GLUTE_KICKBACK | DEFER | 0 | No active ontology-gap product establishes a safe gain. |
| DEADLIFT | LIMITED_ADD | 1 | Product 2026 is a dedicated active machine, unlike the dropped accessory finding. |

## Proposed Training Semantics V2

Training Semantics V2 should preserve the existing exercise assignment model and add a separate function relation:

```text
TRAINING_SEMANTICS
├── EXERCISE_CAPABILITY
├── TRAINING_FUNCTION
├── derived BODY_REGION / MUSCLE_GROUP / TRAINING_PATTERN (exercise only)
└── Product Family context (not a semantic assignment)
```

A product may have both DIRECT ExerciseCapability assignments and DIRECT/FAMILY_DERIVED TrainingFunction assignments. Function assignments never derive anatomy. SUPPORTED exercise assignments remain evidence-bound.

## Versioning and migration

- Propose `training-semantic-registry-v2`; the vocabulary and relation model change materially.
- Propose `TrainingSemanticSnapshot` schemaVersion 2 for published V2 artifacts because records gain a separate trainingFunctions collection; keep the v1 reader immutable for the existing snapshot.
- Preserve all v1 exercise assignments byte-for-byte and publish a v2 projection with explicit lineage to v1 snapshotId, v2 registryHash and v2 rulesHash.
- Do not overwrite the v1 artifact or active pointer. A migration should build, validate, persist and activate a separate v2 artifact only after A00.6.5 acceptance.
- No registry, classifier, snapshot or API implementation is included in A00.6.4.

## Remaining debt before A00.6.5

- Enrich structured semantic category/features for all eight DATA_GAP products; the minimum 95% path needs four prioritized closures.
- Human-review the five AMBIGUOUS packs and three NEEDS_REVIEW multifunction products.
- Implement and regression-test the four classifier closures separately from ontology additions.
- Validate precision on representative generic cable, rack, Smith, bench, bodyweight and dual-machine products before registry publication.

## Required artifacts

- `ontology-gap-products.csv` — exhaustive 41-product review.
- `candidate-training-functions.csv` — evaluated function vocabulary and redundancy decisions.
- `candidate-exercise-capabilities-v2.csv` — narrow capability candidates and gains.
- `ontology-expansion-simulation.csv` — quantitative option comparison.
- `training-semantic-v2-proposed-registry.json` — design proposal only; not a published registry.

