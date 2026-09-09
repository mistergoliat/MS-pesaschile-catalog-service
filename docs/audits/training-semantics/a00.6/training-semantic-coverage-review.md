# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.6 — Coverage & Acceptance Review

## Decision: TRAINING_SEMANTIC_COVERAGE_ACCEPTED_WITH_DEBT

The published Training Semantic Snapshot is intentionally sparse for the current Product Truth. It is acceptable for a future read/query surface with explicit non-blocking debt; this audit does not modify registry, classifier, snapshot, API, Sales Agent or Customer Profile.

## Snapshot authority and integrity

- snapshotId: `sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d`
- semanticChecksum: `08fdd83e95d6f682527187fd6e2caff25f52107dc4bf63edd1abd87511eb741e`
- registry: `training-semantic-registry-v1` / `82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f`
- classifier: `training-semantic-classifier-v1.1` / `83007958a40fd29a87eb01d1fe159812587876c5e57295d7344024bda0123248`
- Baseline: 2011 products, 180 assignments, 157 DIRECT, 23 SUPPORTED, 23 multi-assignment products, 0 NEEDS_REVIEW.
- Snapshot integrity matched before any contextual join. All semantic coverage metrics originate from snapshot records.

## Global coverage

| Scope | Products | With assignment | Assignment rate % | DIRECT | SUPPORTED | Multi rate % |
| --- | --- | --- | --- | --- | --- | --- |
| ALL | 2011 | 157 | 7.81 | 157 | 23 | 1.14 |
| ACTIVE | 889 | 69 | 7.76 | 65 | 16 | 1.35 |
| INACTIVE_OR_HISTORICAL | 1122 | 88 | 7.84 | 92 | 7 | 0.98 |
| CURRENT_CATALOG | 1550 | 136 | 8.77 | 135 | 22 | 1.35 |

The low all-product assignment rate is not treated as a defect by itself: the catalog contains non-training products, accessories, historical rows, generic/multifunction products and capabilities intentionally outside V1.

## Active training-relevant coverage

Eligibility definition: A product is TRAINING_SEMANTICS_ELIGIBLE_PRODUCT when it has a V1 assignment, a training-equipment Product Family, a trusted V1 capability signal, a deferred capability signal, or trusted training-equipment wording; clearly non-training families are excluded.

| Metric | Value |
| --- | --- |
| eligibleProducts | 532 |
| activeEligibleProducts | 240 |
| activeProductsWithAssignment | 69 |
| activeTrainingRelevantCoveragePercent | 28.75 |
| activeTrainingRelevantUnmodeled | 181 |
| activeTrainingRelevantInsufficientEvidence | 12 |
| activeAllProducts | 889 |

## Coverage by Product Family

| Family | Total | Active | Assigned products | Coverage % | DIRECT | SUPPORTED | UNMODELED | INSUFFICIENT | NO_CAPABILITY |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| APPAREL | 48 | 2 | 0 | 0 | 0 | 0 | 46 | 0 | 2 |
| BALL_BAG | 89 | 50 | 0 | 0 | 0 | 0 | 85 | 0 | 4 |
| BAND_SUSPENSION | 20 | 17 | 0 | 0 | 0 | 0 | 6 | 0 | 14 |
| BARBELL | 132 | 62 | 0 | 0 | 0 | 0 | 0 | 0 | 132 |
| BENCH | 141 | 64 | 15 | 10.64 | 15 | 0 | 15 | 0 | 126 |
| BODYWEIGHT_GYMNASTICS | 50 | 26 | 23 | 46 | 24 | 0 | 45 | 0 | 5 |
| CABLE_MACHINE | 77 | 39 | 21 | 27.27 | 32 | 1 | 30 | 17 | 30 |
| CARDIO_MACHINE | 78 | 33 | 0 | 0 | 0 | 0 | 75 | 3 | 0 |
| DUMBBELL | 205 | 80 | 0 | 0 | 0 | 0 | 0 | 0 | 205 |
| FLOORING | 61 | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 61 |
| KETTLEBELL | 40 | 25 | 0 | 0 | 0 | 0 | 40 | 0 | 0 |
| MACHINE_ATTACHMENT | 53 | 31 | 0 | 0 | 0 | 0 | 19 | 0 | 34 |
| PLATE_LOADED_MACHINE | 87 | 45 | 31 | 35.63 | 26 | 6 | 81 | 4 | 2 |
| PROTECTIVE_GEAR | 140 | 99 | 0 | 0 | 0 | 0 | 0 | 0 | 140 |
| RACK_CAGE | 64 | 19 | 12 | 18.75 | 0 | 14 | 61 | 1 | 2 |
| RECOVERY_TOOL | 22 | 17 | 0 | 0 | 0 | 0 | 22 | 0 | 0 |
| ROPE_SLED | 25 | 14 | 0 | 0 | 0 | 0 | 23 | 0 | 2 |
| SELECTORIZED_MACHINE | 52 | 23 | 34 | 65.38 | 36 | 2 | 42 | 10 | 0 |
| STORAGE | 32 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 32 |
| UNKNOWN | 330 | 89 | 21 | 6.36 | 24 | 0 | 293 | 9 | 28 |
| WEIGHT_PLATE | 248 | 91 | 0 | 0 | 0 | 0 | 186 | 0 | 62 |
| YOGA_PILATES | 17 | 9 | 0 | 0 | 0 | 0 | 17 | 0 | 0 |

## Coverage by capability

| Capability | Assignments | DIRECT | SUPPORTED | Active products | Families | Unmatched explicit candidates | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LEG_EXTENSION | 11 | 11 | 0 | 4 | PLATE_LOADED_MACHINE\|SELECTORIZED_MACHINE\|UNKNOWN | 0 | HEALTHY |
| LEG_CURL | 20 | 20 | 0 | 8 | BENCH\|PLATE_LOADED_MACHINE\|SELECTORIZED_MACHINE\|UNKNOWN | 0 | HEALTHY |
| HIP_THRUST | 18 | 18 | 0 | 9 | BENCH\|PLATE_LOADED_MACHINE\|UNKNOWN | 0 | HEALTHY |
| CHEST_PRESS | 7 | 7 | 0 | 2 | PLATE_LOADED_MACHINE\|SELECTORIZED_MACHINE\|UNKNOWN | 0 | SPARSE_BUT_VALID |
| PEC_DECK | 1 | 1 | 0 | 0 | SELECTORIZED_MACHINE | 0 | SPARSE_BUT_VALID |
| LAT_PULLDOWN | 24 | 24 | 0 | 8 | CABLE_MACHINE\|PLATE_LOADED_MACHINE\|UNKNOWN | 0 | HEALTHY |
| ROW | 25 | 25 | 0 | 9 | CABLE_MACHINE\|PLATE_LOADED_MACHINE\|SELECTORIZED_MACHINE\|UNKNOWN | 1 | POTENTIAL_GAP |
| SHOULDER_PRESS | 6 | 6 | 0 | 2 | PLATE_LOADED_MACHINE\|SELECTORIZED_MACHINE\|UNKNOWN | 0 | SPARSE_BUT_VALID |
| PULL_UP | 31 | 13 | 18 | 19 | BENCH\|BODYWEIGHT_GYMNASTICS\|CABLE_MACHINE\|PLATE_LOADED_MACHINE\|RACK_CAGE\|SELECTORIZED_MACHINE\|UNKNOWN | 0 | HEALTHY |
| DIP | 21 | 16 | 5 | 13 | BODYWEIGHT_GYMNASTICS\|PLATE_LOADED_MACHINE\|RACK_CAGE\|UNKNOWN | 0 | HEALTHY |
| ABDOMINAL_CRUNCH | 0 | 0 | 0 | 0 |  | 0 | SPARSE_BUT_VALID |
| ADDUCTOR | 7 | 7 | 0 | 3 | SELECTORIZED_MACHINE\|UNKNOWN | 0 | SPARSE_BUT_VALID |
| ABDUCTOR | 9 | 9 | 0 | 4 | PLATE_LOADED_MACHINE\|SELECTORIZED_MACHINE\|UNKNOWN | 0 | SPARSE_BUT_VALID |

### Low-coverage review

| Capability | Assignments | Active | Unassigned explicit candidates | Assessment |
| --- | --- | --- | --- | --- |
| CHEST_PRESS | 7 | 2 | 0 | SPARSE_BUT_VALID |
| PEC_DECK | 1 | 0 | 0 | SPARSE_BUT_VALID |
| SHOULDER_PRESS | 6 | 2 | 0 | SPARSE_BUT_VALID |
| ABDOMINAL_CRUNCH | 0 | 0 | 0 | SPARSE_BUT_VALID |
| ADDUCTOR | 7 | 3 | 0 | SPARSE_BUT_VALID |
| ABDUCTOR | 9 | 4 | 0 | SPARSE_BUT_VALID |

ABDOMINAL_CRUNCH remains an active capability with zero assignments. No assignment was invented. PEC_DECK, SHOULDER_PRESS, CHEST_PRESS, ADDUCTOR and ABDUCTOR are sparse but do not show an unassigned trusted V1 signal large enough to block this review; ADDUCTOR/ABDUCTOR retain intentional registry mapping debt.

## UNMODELED and INSUFFICIENT_EVIDENCE

| UNMODELED bucket | Count | SAFE_SPARSITY |
| --- | --- | --- |
| ACCESSORY_OR_SUPPORT | 99 | true |
| CAPABILITY_NOT_IN_V1 | 20 | true |
| GENERAL_MULTIUSE | 101 | true |
| HISTORICAL_ONLY | 238 | true |
| INSUFFICIENT_METADATA | 142 | true |
| MISSING_RULE | 81 | false |
| NON_TRAINING_PRODUCT | 87 | true |
| PACK_OR_MULTIFUNCTION_AMBIGUITY | 141 | true |
| UNKNOWN | 177 | false |

The 44 INSUFFICIENT_EVIDENCE products are preserved in `training-semantic-insufficient-evidence.csv`; 12 are worth targeted review and none are promoted automatically.

Safe sparsity means the absence is explained by non-training product truth, accessory/support status, historical-only status, deferred capability scope, generic/multifunction ambiguity, or intentionally insufficient trusted evidence. 76.24% of UNMODELED products fall in those safe buckets; explicit active V1-like signals remain non-blocking review debt, not silent assignments.

## Commercial-weighted coverage

| Scope | Eligible products | Assigned products | Revenue coverage % | Order-line coverage % | Units coverage % |
| --- | --- | --- | --- | --- | --- |
| ALL | 532 | 157 | 31.53 | 22.73 | 20.73 |
| ACTIVE_ONLY | 240 | 69 | 33.15 | 23.12 | 20.99 |

Commercial weighting is contextual only and is not semantic scoring. Revenue, order-line and units fields were read from the catalog export; missing values are treated as unavailable rather than zero for interpretation.

## Deferred capability pressure

| Candidate | Observed | Active | Active revenue | Recommendation | Action | Blocking |
| --- | --- | --- | --- | --- | --- | --- |
| BICEPS_CURL | 5 | 2 | 2746511 | KEEP_DEFERRED | NO_ACTION | false |
| DEADLIFT | 1 | 1 | 4008362 | DROP | NO_ACTION | false |
| GLUTE_KICKBACK | 2 | 0 | 0 | KEEP_DEFERRED | NO_ACTION | false |
| LEG_PRESS | 6 | 0 | 0 | KEEP_DEFERRED | NO_ACTION | false |
| SQUAT | 53 | 20 | 158491536.7 | REDEFINE | FUTURE_ONTOLOGY_CANDIDATE | false |
| TRICEPS_EXTENSION | 1 | 1 | 4299957 | KEEP_DEFERRED | NO_ACTION | false |

SQUAT remains REDEFINE and is not resolved here. The active dedicated-machine subset is a future ontology candidate, not a classifier fix. LEG_PRESS, BICEPS_CURL, GLUTE_KICKBACK and TRICEPS_EXTENSION remain deferred per A00.4.1; DEADLIFT remains dropped because its material is an accessory.

## Overclassification and underclassification

| Known boundary | Matched products | Violations | Violation IDs |
| --- | --- | --- | --- |
| HIP_THRUST_BOUNDARY | 87 | 0 |  |
| ABDOMINAL_BENCH_BOUNDARY | 6 | 0 |  |
| CARDIO_ROW_BOUNDARY | 2 | 0 |  |
| GENERIC_CABLE_BOUNDARY | 3 | 0 |  |

Known-boundary overclassification is LOW; the published snapshot preserves the adjudicated negatives for cardio rowers, hip-thrust pads/boxes/bars, abdominal benches and generic cable wording.

Underclassification status is MEDIUM; 1 concrete active/revenue-sensitive candidates are listed in the JSON report and review sample for human validation.

## Derived semantics validation

| Capability | Body region | Primary | Secondary | Pattern | Mapping debt |
| --- | --- | --- | --- | --- | --- |
| LEG_EXTENSION | LOWER_BODY | QUADRICEPS |  | KNEE_EXTENSION |  |
| LEG_CURL | LOWER_BODY | HAMSTRINGS |  | KNEE_FLEXION |  |
| HIP_THRUST | LOWER_BODY | GLUTES |  | HIP_EXTENSION |  |
| CHEST_PRESS | UPPER_BODY | CHEST | TRICEPS\|SHOULDERS | PRESS |  |
| PEC_DECK | UPPER_BODY | CHEST |  | PRESS |  |
| LAT_PULLDOWN | UPPER_BODY | BACK | BICEPS | PULL |  |
| ROW | UPPER_BODY | BACK | BICEPS | PULL |  |
| SHOULDER_PRESS | UPPER_BODY | SHOULDERS | TRICEPS | PRESS |  |
| PULL_UP | UPPER_BODY | BACK | BICEPS | PULL |  |
| DIP | UPPER_BODY | TRICEPS | CHEST | PRESS |  |
| ABDOMINAL_CRUNCH | CORE | CORE |  |  | INTENTIONAL_OR_PENDING |
| ADDUCTOR | LOWER_BODY |  |  |  | INTENTIONAL_OR_PENDING |
| ABDUCTOR | LOWER_BODY |  |  |  | INTENTIONAL_OR_PENDING |

Derived relation quality: NEEDS_REVIEW. Mapping debt is reported separately for ABDOMINAL_CRUNCH, ADDUCTOR, ABDUCTOR; the registry was not modified.

## Precision sample

A deterministic positive sample contains 60 products and 71 assignment observations (62 DIRECT, 9 SUPPORTED). Manual adjudication is not included in A00.6, so DIRECT and SUPPORTED precision are NOT_MEASURED rather than falsely extrapolated. The sample prioritizes capabilities, active products, revenue and multi-assignment cases.

## Coverage matrix

| Dimension | Assessment |
| --- | --- |
| globalCoverage | ACCEPTABLE |
| activeTrainingRelevantCoverage | WEAK |
| commercialWeightedCoverage | WEAK |
| directPrecision | NOT_MEASURED |
| supportedPrecision | NOT_MEASURED |
| overclassification | LOW |
| underclassification | MEDIUM |
| deferredCapabilityPressure | MEDIUM |
| derivedRelationQuality | NEEDS_REVIEW |

## Debt before API

| Debt | Action | Blocking |
| --- | --- | --- |
| Product 2092 ROW | Human review before any classifier change | false |
| ABDOMINAL_CRUNCH, ADDUCTOR, ABDUCTOR derived mapping | Resolve intentional registry mapping debt in a future ontology/review slice | false |
| SQUAT and other deferred capabilities | Keep deferred until explicit ontology decision; do not infer in API | false |
| DIRECT/SUPPORTED precision | Complete manual precision review before relying on quality claims | false |

## Review sample and artifacts

Generated 80 deterministic review rows. Each row has a concrete review question. Source catalog context: `C:\Users\Goli\Pesas Chile\MS\MS-Stock\services\docs\audits\product-intelligence-exploration\inputs\product_catalog_exploration(2).csv`.

Artifacts:

- `training-semantic-coverage-by-family.csv`
- `training-semantic-coverage-by-capability.csv`
- `training-semantic-unmodeled-buckets.csv`
- `training-semantic-insufficient-evidence.csv`
- `training-semantic-coverage-review-sample.csv`
- `training-semantic-coverage-report.json`

No API or read/query surface is implemented by A00.6. If accepted, the next release is A00.7 — Training Semantics Read / Query Surface.
