# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.6.2 — Semantic Resolution Quality Model

## Decision: TRAINING_SEMANTIC_RESOLUTION_NEEDS_ONTOLOGY_EXPANSION

This audit evaluates the published A00.5 Product Truth without changing the registry, classifier, snapshot, API, Sales Agent or Customer Profile. Every active training-relevant product receives exactly one product-level resolution state.

## Snapshot authority

- snapshotId: `sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d`
- semanticChecksum: `08fdd83e95d6f682527187fd6e2caff25f52107dc4bf63edd1abd87511eb741e`
- registry: `training-semantic-registry-v1` / `82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f`
- classifier: `training-semantic-classifier-v1.1` / `83007958a40fd29a87eb01d1fe159812587876c5e57295d7344024bda0123248`
- A00.5 baseline guard matched: 2011 products, 180 assignments, 157 DIRECT, 23 SUPPORTED, 0 NEEDS_REVIEW.

## Resolution model

Resolution is intentionally stricter than snapshot assignment coverage. Only SEMANTIC_COMPLETE and VERIFIED_NO_APPLICABLE_CAPABILITY count as REAL_SEMANTIC_RESOLUTION. SEMANTIC_PARTIAL, ONTOLOGY_GAP, RULE_GAP, DATA_GAP, AMBIGUOUS and NEEDS_REVIEW are unresolved for the target KPI.

States:

- SEMANTIC_COMPLETE — published assignments are correct and exhaustive for trusted V1 evidence.
- SEMANTIC_PARTIAL — a published assignment exists but trusted V1 evidence indicates a missing capability.
- VERIFIED_NO_APPLICABLE_CAPABILITY — evidence is sufficient to exclude every current V1 capability.
- ONTOLOGY_GAP — the product has a credible training function not representable by the current registry.
- RULE_GAP — trusted V1 evidence is present but the classifier produced no assignment.
- DATA_GAP — exact structured evidence needed for resolution is missing.
- AMBIGUOUS — evidence supports multiple interpretations without a safe deterministic choice.
- NEEDS_REVIEW — a product-level adjudication is required before publication.

## KPI result

| Metric | Value |
| --- | --- |
| Active training-relevant denominator | 240 |
| Target resolved products (95%) | 228 |
| Resolved products | 180 |
| Products short of 95% target | 48 |
| REAL_SEMANTIC_RESOLUTION_RATE | 75% |
| Gap to 95% target | 20 percentage points |
| Unresolved products allowed | 12 |
| Unresolved products | 60 |
| Positive classification rate | 28.75% |
| Complete positive rate | 28.33% |
| Complete positive rate among published positives | 98.55% |
| Verified negative rate | 46.67% |

Feasibility gate: **NO_REQUIRES_ONTOLOGY_EXPANSION**. Even after resolving all current rule-gap candidates, 41 ontology-gap products remain outside the V1 model; the 95% target requires an ontology expansion or denominator policy decision.

Resolution-state counts:

| State | Products |
| --- | --- |
| SEMANTIC_COMPLETE | 68 |
| SEMANTIC_PARTIAL | 1 |
| VERIFIED_NO_APPLICABLE_CAPABILITY | 112 |
| ONTOLOGY_GAP | 41 |
| RULE_GAP | 2 |
| DATA_GAP | 8 |
| AMBIGUOUS | 5 |
| NEEDS_REVIEW | 3 |

## Active unresolved products

The unresolved file is ordered by active status, revenue, order lines, units, then productId. This is prioritization context only and is not semantic scoring.

| Product | Family | State | Candidates | Missing | Gap | Revenue | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1427 | CABLE_MACHINE | DATA_GAP |  |  | DATA_GAP | 107054339.5 | Exact missing data: trusted structured category or semantic feature evidence needed to decide whether a V1 capability applies. |
| 1504 | SELECTORIZED_MACHINE | NEEDS_REVIEW | LEG_EXTENSION\|LEG_CURL | LEG_EXTENSION\|LEG_CURL | QUALITY_REVIEW | 74825638 | Multiple or multifunction V1 signals require product-level adjudication before publishing LEG_EXTENSION, LEG_CURL. |
| 1273 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 52789198 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1517 | CABLE_MACHINE | DATA_GAP |  |  | DATA_GAP | 51724165 | Exact missing data: trusted structured category or semantic feature evidence needed to decide whether a V1 capability applies. |
| 1455 | CABLE_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 41624731 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1272 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 21103837 | Product is a credible dedicated machine for deferred capability SQUAT; the current V1 registry intentionally cannot represent it. |
| 1508 | SELECTORIZED_MACHINE | NEEDS_REVIEW | CHEST_PRESS\|SHOULDER_PRESS | CHEST_PRESS\|SHOULDER_PRESS | QUALITY_REVIEW | 19407474 | Multiple or multifunction V1 signals require product-level adjudication before publishing CHEST_PRESS, SHOULDER_PRESS. |
| 1122 | UNKNOWN | DATA_GAP |  |  | DATA_GAP | 18554900.5 | Product Family is UNKNOWN; exact missing data: trusted semantic category and/or structured feature evidence needed to distinguish training function from generic merchandise. |
| 494 | CABLE_MACHINE | DATA_GAP |  |  | DATA_GAP | 17920935 | Exact missing data: trusted structured category or semantic feature evidence needed to decide whether a V1 capability applies. |
| 1604 | RACK_CAGE | AMBIGUOUS |  |  | AMBIGUITY | 17576531 | Pack or multi-use wording prevents a deterministic product-level capability decision. |
| 1266 | SELECTORIZED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 17155894 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 2134 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 16628593 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 495 | CABLE_MACHINE | DATA_GAP |  |  | DATA_GAP | 15319928 | Exact missing data: trusted structured category or semantic feature evidence needed to decide whether a V1 capability applies. |
| 1451 | CABLE_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 14049315 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1270 | SELECTORIZED_MACHINE | RULE_GAP | LEG_CURL | LEG_CURL | RULE_GAP | 13182901 | Trusted product evidence indicates LEG_CURL but the published snapshot has no assignment. |
| 1121 | RACK_CAGE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 12713649.5 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 2068 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 12706825 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1274 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 12055946 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1660 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 11385946 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1516 | CABLE_MACHINE | DATA_GAP |  |  | DATA_GAP | 10299947 | Exact missing data: trusted structured category or semantic feature evidence needed to decide whether a V1 capability applies. |
| 1664 | SELECTORIZED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 10159935 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 2133 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 9935233 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1884 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 9824843 | Product is a credible dedicated machine for deferred capability SQUAT; the current V1 registry intentionally cannot represent it. |
| 1922 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 9689964 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1275 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 9407954 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1450 | CABLE_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 9207185 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 491 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 8636960 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1507 | SELECTORIZED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 7979892 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1539 | RACK_CAGE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 7672518.5 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 2139 | CABLE_MACHINE | DATA_GAP |  |  | DATA_GAP | 7113272 | Exact missing data: trusted structured category or semantic feature evidence needed to decide whether a V1 capability applies. |
| 1658 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 5925249 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1284 | SELECTORIZED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 5694955 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1535 | RACK_CAGE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 5296607.5 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1654 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 4759972 | Product is a credible dedicated machine for deferred capability SQUAT; the current V1 registry intentionally cannot represent it. |
| 1544 | RACK_CAGE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 4649868 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 2019 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 4371626 | Product is a credible dedicated machine for deferred capability SQUAT; the current V1 registry intentionally cannot represent it. |
| 258 | UNKNOWN | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 4299957 | Product is a credible dedicated machine for deferred capability TRICEPS_EXTENSION; the current V1 registry intentionally cannot represent it. |
| 1126 | BODYWEIGHT_GYMNASTICS | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 3829296 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 2018 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 3799980 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |
| 1663 | PLATE_LOADED_MACHINE | ONTOLOGY_GAP |  |  | ONTOLOGY_GAP | 3639980 | Generic training equipment has real utility, but no single current V1 capability expresses its supported movement/function set. |

The complete product-level analysis is in `training-semantic-resolution-active.csv` and the full JSON report. 60 products remain unresolved for the KPI.

## Known named cases

| Product | Expected review focus | Observed state |
| --- | --- | --- |
| 1270 | Curl de Femoral Acostado → LEG_CURL | RULE_GAP |
| 1504 | Dual Cuádriceps / Femoral Sentado → LEG_EXTENSION + LEG_CURL | NEEDS_REVIEW |
| 1508 | Dual Press Pectoral / Hombros → CHEST_PRESS + SHOULDER_PRESS | NEEDS_REVIEW |
| 2203 | Dual Cuádriceps / Femoral Acostado → LEG_EXTENSION + LEG_CURL | NEEDS_REVIEW |
| 2092 | T-Bar Row Beast → ROW rule gap | RULE_GAP |

## Resolution by Product Family

| Family | Products | Complete | Partial | Verified no V1 | Ontology | Rule | Data | Ambiguous | Review | REAL rate % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BENCH | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |
| BODYWEIGHT_GYMNASTICS | 26 | 12 | 0 | 13 | 1 | 0 | 0 | 0 | 0 | 96.15 |
| CABLE_MACHINE | 39 | 8 | 0 | 21 | 4 | 0 | 6 | 0 | 0 | 74.36 |
| CARDIO_MACHINE | 33 | 0 | 0 | 33 | 0 | 0 | 0 | 0 | 0 | 100 |
| MACHINE_ATTACHMENT | 31 | 0 | 0 | 31 | 0 | 0 | 0 | 0 | 0 | 100 |
| PLATE_LOADED_MACHINE | 45 | 12 | 0 | 4 | 27 | 1 | 1 | 0 | 0 | 35.56 |
| RACK_CAGE | 19 | 8 | 0 | 6 | 4 | 0 | 0 | 1 | 0 | 73.68 |
| ROPE_SLED | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 100 |
| SELECTORIZED_MACHINE | 23 | 15 | 0 | 0 | 4 | 1 | 0 | 0 | 3 | 65.22 |
| UNKNOWN | 15 | 5 | 1 | 3 | 1 | 0 | 1 | 4 | 0 | 53.33 |

## Gap inventory

| Gap | Products | Active | Revenue | Order lines | Units |
| --- | --- | --- | --- | --- | --- |
| AMBIGUITY | 5 | 5 | 19738745 | 15 | 17 |
| DATA_GAP | 8 | 8 | 230464568 | 943 | 999 |
| NONE | 180 | 180 | 1644835731.12 | 14168 | 17329 |
| ONTOLOGY_GAP | 41 | 41 | 357860672.5 | 713 | 740 |
| QUALITY_REVIEW | 3 | 3 | 95213106 | 76 | 76 |
| RULE_GAP | 3 | 3 | 18306351.5 | 475 | 551 |

## V1 capability review

All 13 active V1 capabilities were reviewed for published positives and active unassigned trusted signals. No capability was added to Product Truth by this audit.

| Capability | Published | Active assigned | Complete | Partial | Active candidate | Unassigned candidate | Assessment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LEG_EXTENSION | 11 | 4 | 4 | 0 | 6 | 2 | ACTIVE_V1_SIGNAL_REQUIRES_REVIEW |
| LEG_CURL | 20 | 8 | 8 | 0 | 8 | 3 | ACTIVE_V1_SIGNAL_REQUIRES_REVIEW |
| HIP_THRUST | 18 | 9 | 9 | 0 | 5 | 0 | NO_ACTIVE_UNASSIGNED_V1_SIGNAL |
| CHEST_PRESS | 7 | 2 | 2 | 0 | 3 | 1 | ACTIVE_V1_SIGNAL_REQUIRES_REVIEW |
| PEC_DECK | 1 | 0 | 0 | 0 | 0 | 0 | NO_ACTIVE_UNASSIGNED_V1_SIGNAL |
| LAT_PULLDOWN | 24 | 8 | 8 | 0 | 5 | 0 | NO_ACTIVE_UNASSIGNED_V1_SIGNAL |
| ROW | 25 | 9 | 9 | 0 | 8 | 1 | ACTIVE_V1_SIGNAL_REQUIRES_REVIEW |
| SHOULDER_PRESS | 6 | 2 | 2 | 0 | 3 | 1 | ACTIVE_V1_SIGNAL_REQUIRES_REVIEW |
| PULL_UP | 31 | 19 | 19 | 0 | 9 | 1 | ACTIVE_V1_SIGNAL_REQUIRES_REVIEW |
| DIP | 21 | 13 | 12 | 1 | 1 | 0 | NO_ACTIVE_UNASSIGNED_V1_SIGNAL |
| ABDOMINAL_CRUNCH | 0 | 0 | 0 | 0 | 0 | 0 | NO_ACTIVE_UNASSIGNED_V1_SIGNAL |
| ADDUCTOR | 7 | 3 | 3 | 0 | 3 | 0 | NO_ACTIVE_UNASSIGNED_V1_SIGNAL |
| ABDUCTOR | 9 | 4 | 4 | 0 | 4 | 0 | NO_ACTIVE_UNASSIGNED_V1_SIGNAL |

## Denominator and generic equipment decision

The denominator is the A00.6 definition reevaluated against the same catalog: 240 active products with a V1 assignment, a training-equipment Product Family, a trusted V1 signal, a deferred signal, or trusted training-equipment wording; clearly non-training families are excluded. No product was removed merely because it was difficult to classify.

Generic equipment is not auto-converted into movement capabilities. Where the current V1 registry cannot express a credible equipment function, the product is ONTOLOGY_GAP; where evidence is sufficient to exclude V1 (for example cardio-only or accessory/support products), it is VERIFIED_NO_APPLICABLE_CAPABILITY; where family or structured evidence is missing, it is DATA_GAP.

## Feasibility and next action

Current decision: TRAINING_SEMANTIC_RESOLUTION_NEEDS_ONTOLOGY_EXPANSION. Do not patch classifier rules to encode deferred or generic equipment semantics. Run an explicit ontology decision slice first.

Future model candidates are documented but not implemented: TRAINING_FUNCTION, EQUIPMENT_CAPABILITY, SUPPORTED_MOVEMENT_PATTERN and LOAD_MODALITY. Deferred SQUAT and other candidates remain outside Product Truth.

Artifacts:

- `training-semantic-resolution-quality.md`
- `training-semantic-resolution-active.csv`
- `training-semantic-resolution-unresolved.csv`
- `training-semantic-resolution-by-family.csv`
- `training-semantic-resolution-by-gap.csv`
- `training-semantic-resolution-report.json`
