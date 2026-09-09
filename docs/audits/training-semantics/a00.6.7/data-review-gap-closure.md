# A00.6.7 — Training Semantic Data + Review Gap Closure

## Scope and authority

This audit adjudicates all 16 `ACTIVE TRAINING-RELEVANT` products unresolved
after A00.6.6. It uses the same 240-product denominator and current local
catalog inputs. Descriptions were consulted for investigation only; positive
classifier evidence comes from canonical name, Product Family, trusted
categories and semantic structured features.

- Registry: `training-semantic-registry-v2`
- Registry hash: `7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8`
- Classifier: `training-semantic-classifier-v2.1`
- Rules hash: `5e4e591b45e7704975552f305d59d73535c3889ed655754aa0113844c9c03b6d`
- Prior classifier/rules: `training-semantic-classifier-v2` /
  `a619932df9f2c4241330826cdd4b728164df7fa1672b2941e04fab621da8a78a`
- V1 accepted assignments preserved: `180`

## Adjudication summary

Ten products are safely closed. Six remain unresolved with an exact blocker
and future evidence requirement. No registry change was necessary.

### Resolved complete

- `494`, `495`, `1516`, `1517`: canonical `Polea Cruzada` plus
  `CABLE_MACHINE` and strong cable-machine category establish crossover
  geometry. V2.1 assigns `MULTI_DIRECTIONAL_RESISTANCE` alongside existing
  `CABLE_RESISTANCE`.
- `1427`: canonical `Polea de Muro`, cable family, strong cable category and
  cable-ratio feature establish a single wall cable station. No crossover or
  exercise module is evidenced; `CABLE_RESISTANCE` is complete current truth.
- `1504`: explicit dual seated quadriceps/femoral name and strong selectorizada
  category establish `LEG_EXTENSION` and `LEG_CURL`.
- `1508`: explicit dual pectoral/shoulder press name and strong selectorizada
  category establish `CHEST_PRESS` and `SHOULDER_PRESS`.
- `1604`: explicit `Powerlifting Combo Rack` and rack family/categories
  establish `BARBELL_SUPPORT` only. Powerlifting does not infer `SQUAT`,
  `BENCH_PRESS` or `DEADLIFT`.
- `2139`: canonical `Polea Dual Multifuncional`, cable family, strong cable
  category and semantic feature `Relación de cable y polea: 2:1 - 1:1`
  establish dual cable geometry. It receives
  `MULTI_DIRECTIONAL_RESISTANCE`; no exercise module is inferred.
- `2203`: explicit dual quadriceps/femoral prone name and strong selectorizada
  category establish `LEG_EXTENSION` and `LEG_CURL`; the existing
  `LEG_CURL` assignment is preserved.

### Kept unresolved

- `1122`: `PRODUCT_SEMANTICS_DATA_GAP`. Product Family is `UNKNOWN`; trusted
  structured input has no station/module/mechanism declaration. Description
  mentions possible exercises but cannot override missing upstream Product
  Truth.
- `2025`: `DATA_GAP`. `Multi Hip Extension` does not identify whether the
  mechanism is hip thrust, reverse hyper, back extension or another movement.
  `HIP_THRUST` is not inferred.
- `1945`–`1948`: `AMBIGUOUS`. Feature text lists package component labels, but
  there are no governed component product IDs or configuration relationships.
  No bundle union is projected.

The complete one-decision-per-product record, including exact blockers and
required future actions, is in `gap-closure-decisions.csv` and the unresolved
projection is in `post-closure-resolution-unresolved.csv`.

## Reusable enrichment

V2.1 adds four deterministic, non-product-ID-specific enrichments:

1. `Polea Cruzada` + `CABLE_MACHINE` + strong category 290 →
   `MULTI_DIRECTIONAL_RESISTANCE`.
2. `Polea Dual Multifuncional` + `CABLE_MACHINE` + strong category 290 +
   semantic feature 65 containing both `2:1` and `1:1` →
   `MULTI_DIRECTIONAL_RESISTANCE`.
3. `Dual Cuádriceps / Femoral` + `SELECTORIZED_MACHINE` + strong category 281
   → independent `LEG_EXTENSION` and `LEG_CURL` assignments.
4. `Dual Press Pectoral / Hombros` + `SELECTORIZED_MACHINE` + strong category
   281 → independent `CHEST_PRESS` and `SHOULDER_PRESS` assignments.

Generic cable, generic pulley, generic press, packs, and free-text description
alone do not activate these mappings. The enrichment catalog and hash are in
`trusted-enrichment.csv`.

## Precision review

All 16 unresolved records were manually adjudicated. The 10 newly closed
products were reviewed against their canonical name, family/category and
structured evidence: 10 correct, 0 incorrect, 0 ambiguous. The review sample
also covers direct exercise assignments, direct functions, the existing family
derived cable function, and multifunction products.

## Before and after

| Metric | Before | After |
| --- | ---: | ---: |
| Active training-relevant | 240 | 240 |
| Resolved | 224 | 234 |
| Real semantic resolution rate | 93.33% | 97.50% |
| `DATA_GAP` | 8 | 2 |
| `AMBIGUOUS` | 5 | 4 |
| `NEEDS_REVIEW` | 3 | 0 |
| Remaining unresolved | 16 | 6 |

Maximum safe resolution achieved: `234 / 240 = 97.50%`.

The V2 snapshot remains intentionally unbuilt. The next release is A00.6.8 —
Training Semantic Snapshot V2 + Final Acceptance.
