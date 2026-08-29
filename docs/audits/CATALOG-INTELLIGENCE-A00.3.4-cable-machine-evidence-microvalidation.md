# CATALOG-INTELLIGENCE-A00.3.4 - CABLE_MACHINE Evidence Microvalidation

Date: 2026-08-28
Repo: `MS-pesaschile-catalog-service`
Mode: read-only offline audit

## Scope

This pass validated whether product `2134` (`Multifuncional Smith ZR Series | PROmachine`) can be recovered as:

- primary `PLATE_LOADED_MACHINE`
- secondary `CABLE_MACHINE`

without using `FREE_TEXT_DESCRIPTION` as classifier evidence and without modifying ontology v2 or runtime code.

Inputs inspected:

- `docs/audits/product-intelligence-exploration/inputs/product_catalog_exploration(2).csv`
- `docs/audits/product-intelligence-exploration/inputs/category_trust_map(1).csv`
- `docs/audits/product-intelligence-exploration/inputs/feature_trust_map(1).csv`
- `docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/ontology_review_closure.csv`
- `scripts/product-semantic-classification/outputs/product_semantic_classifications.json`
- `src/domain/product-semantic-classification/category-catalog.ts`
- `src/domain/product-semantic-classification/product-family-rules.ts`

## Candidate Categories Present In This Dataset

| categoryId | categoryName | trustClass | assignedProductCount | auditDisposition |
| --- | --- | --- | ---: | --- |
| 290 | Máquinas con Poleas | SEMANTIC_STRONG | 26 | `TOO_BROAD` as a standalone CABLE_MACHINE source; usable only with an additional deterministic structured-evidence guard |
| 451 | Accesorios de Polea | SEMANTIC_STRONG | 21 | `ACCESSORY_MIXED`; reject as CABLE_MACHINE evidence |

No standalone trusted category named `Poleas`, `Crossover`, or `Cable` exists in the local category trust map.

## Product 2134 Direct Audit

Current classifier output:

- `classificationStatus = CLASSIFIED`
- `primaryProductFamily = PLATE_LOADED_MACHINE`
- `secondaryProductFamilies = []`

Non-description evidence available locally:

- trusted categories:
  - `290 / Máquinas con Poleas / SEMANTIC_STRONG`
  - `291 / Máquinas Multifuncionales`
  - `314 / Máquinas Home Gym`
  - `285 / Máquinas con Carga de Discos`
- structured features:
  - `Peso máximo de carga: Poleas: 100 kg por lado.`
  - `Largo de la manga: Poleas: 22 cm (*4) de manga cargable.`
  - `Relación de cable y polea: 1:1`
- current primary family evidence:
  - `PF_SMITH_OVERRIDE_V1` from product name

Conclusion for `2134`:

- `STRUCTURED_EVIDENCE_SUFFICIENT`

Reason: even without reading the description, the product has a strong trusted cable category plus explicit cable-scoped structured features. The current miss exists because ontology v2 allows `CABLE_MACHINE` from `NAME_TEXT` only.

## Full Catalog Population Audit

### Category 290: Máquinas con Poleas

Manual review over all 26 assigned products:

- `TRUE_POSITIVE_PRIMARY = 20`
- `TRUE_POSITIVE_SECONDARY_HYBRID = 5`
- `FALSE_POSITIVE_ATTACHMENT = 0`
- `FALSE_POSITIVE_OTHER_PRODUCT = 1`
- `AMBIGUOUS = 0`

The single blocking member is:

- `2133 / Smith Machine Half Rack ZR Series | PROmachine`

Why `2133` blocks a raw category-only rule:

- product name is pure Smith/Half Rack wording
- structured features include Smith and Half Rack load limits
- no `Relación de cable y polea`
- no `Pila de Stack`
- no `Peso máximo de carga` entry scoped to `Polea`
- no description mention of cable/pulley/crossover was found in the local export

So `2133` is a real non-cable member of `Máquinas con Poleas`, not an evidence gap on the audit side.

### Category 451: Accesorios de Polea

Manual review over all 21 assigned products:

- `TRUE_POSITIVE_PRIMARY = 0`
- `TRUE_POSITIVE_SECONDARY_HYBRID = 0`
- `FALSE_POSITIVE_ATTACHMENT = 21`
- `FALSE_POSITIVE_OTHER_PRODUCT = 0`
- `AMBIGUOUS = 0`

This category is entirely accessory inventory: handles, bars, ropes, ankle straps, and Smith-machine add-ons. It must not be widened into product-family evidence for `CABLE_MACHINE`.

## Current Classifier Coverage

### Category 290 coverage under current v2

- `alreadyPrimaryCableMachine = 15`
- `alreadySecondaryCableMachine = 0`
- `classifiedOtherFamily = 6`
- `classifiedOther = 5`
- `excludedNonProduct = 0`
- `needsReview = 0`

The six non-cable current families are:

- `1021` `PLATE_LOADED_MACHINE`
- `1430` `PLATE_LOADED_MACHINE`
- `1922` `PLATE_LOADED_MACHINE`
- `2133` `PLATE_LOADED_MACHINE`
- `2134` `PLATE_LOADED_MACHINE`
- `2182` `PLATE_LOADED_MACHINE`

Of those six:

- genuine cable hybrids: `1021`, `1430`, `1922`, `2134`, `2182`
- non-cable category contamination: `2133`

### Category 451 coverage under current v2

- `alreadyPrimaryCableMachine = 15`
- `alreadySecondaryCableMachine = 0`
- `classifiedOtherFamily = 6`
- `classifiedOther = 0`

This is existing name-first behavior, not evidence that the category is safe. Fifteen attachments currently land in `CABLE_MACHINE` only because their names contain `polea`, `lat pull down`, or similar cable vocabulary.

## Simulation

### A. Raw category-only enable

Hypothesis tested:

- allow `CABLE_MACHINE` to use trusted category `Máquinas con Poleas`
- no new hybrid-resolution logic
- no new structured-feature gate

Observed impact from current classifier architecture:

- `1207`, `1444`, `1445`, `1450`, `1451`: `OTHER -> primary CABLE_MACHINE`
- `1021`, `1430`, `1922`, `2182`: `PLATE_LOADED_MACHINE -> NEEDS_REVIEW` because category fallback would now vote both `PLATE_LOADED_MACHINE` and `CABLE_MACHINE`
- `2134`: unchanged, because `PF_SMITH_OVERRIDE_V1` short-circuits before category fallback
- `2133`: unchanged for the same reason

Raw category-only totals:

- `productsChanged = 9`
- `primaryFamilyChanges = 5`
- `secondaryFamilyAdditions = 0`
- `otherCountDelta = -5`
- `needsReviewDelta = +4`
- `goldenSetBefore = PRODUCT_FAMILY 199/200`
- `goldenSetAfter = PRODUCT_FAMILY 199/200`

This is not acceptable. It does not recover the target golden-set exception and it introduces four new `NEEDS_REVIEW` rows.

### B. Guarded v3 rule

Safe deterministic guard found in the local dataset:

`TRUSTED_CATEGORY = "Máquinas con Poleas"` and at least one of:

- structured feature `Relación de cable y polea` present
- structured feature `Pila de Stack` present
- structured feature `Peso máximo de carga` explicitly scoped to `Polea(s)`
- structured feature `Largo de la manga` explicitly scoped to `Polea(s)`

Then apply the result as:

- if current primary family is `PLATE_LOADED_MACHINE`, add secondary `CABLE_MACHINE`
- else if current primary family is `null`, set primary `CABLE_MACHINE`
- else no change

Why this guard is materially different from raw category-only enable:

- it recovers genuine hybrids instead of sending category-conflict rows to `NEEDS_REVIEW`
- it excludes `2133`, the only non-cable member of category 290
- it does not touch category 451 at all

Guarded v3 simulated impact:

- `productsChanged = 10`
- `primaryFamilyChanges = 5`
- `secondaryFamilyAdditions = 5`
- `otherCountDelta = -5`
- `needsReviewDelta = 0`
- `falsePositiveCount = 0`
- `goldenSetBefore = PRODUCT_FAMILY 199/200`
- `goldenSetAfter = PRODUCT_FAMILY 200/200`
- `DISCIPLINE = 200/200 unchanged`
- `USE_CONTEXT = 200/200 unchanged`

Products changed under the guarded rule:

- `OTHER -> primary CABLE_MACHINE`: `1207`, `1444`, `1445`, `1450`, `1451`
- `add secondary CABLE_MACHINE`: `1021`, `1430`, `1922`, `2134`, `2182`

## Recommendation

Do not widen ontology v2 as a raw category-only source.

Recommendation:

- `CREATE_V3_WITH_GUARDED_CABLE_MACHINE_CATEGORY_RULE`

Reason:

- `Máquinas con Poleas` is useful but not pristine on its own
- `Accesorios de Polea` is unusable
- the target `2134` is recoverable from structured evidence
- a deterministic category-plus-structured-feature guard produces zero false positives in the full local category population and closes the known `2134` golden-set exception

## Final Report

STATUS:
Completed offline audit and produced the requested markdown and CSV artifacts. No ontology, classifier, or runtime files were changed.

DECISION:
CABLE_MACHINE_V3_READY

PRODUCT_2134:
STRUCTURED_EVIDENCE_SUFFICIENT

CANDIDATE_CATEGORY:
290 / Máquinas con Poleas

CATEGORY_TRUST_CLASS:
SEMANTIC_STRONG

TOTAL_CATEGORY_PRODUCTS:
26

TRUE_CABLE_MACHINES:
20

HYBRID_CABLE_MACHINES:
5

ATTACHMENTS:
0 in category 290; category 451 is 21/21 attachments and rejected

OTHER_PRODUCTS:
1 (`2133`)

AMBIGUOUS:
0

FALSE_POSITIVES_IF_ENABLED:
Raw category-only source is contaminated by `2133`; guarded v3 rule yields `0`.

NEW_RECOVERIES_IF_ENABLED:
Guarded v3 rule adds CABLE_MACHINE semantics to `10` products, including secondary recovery for `2134`.

GOLDEN_SET_IMPACT:
PRODUCT_FAMILY `199/200 -> 200/200`; DISCIPLINE `200/200` unchanged; USE_CONTEXT `200/200` unchanged.

RECOMMENDED_ONTOLOGY_ACTION:
CREATE_V3_WITH_GUARDED_CABLE_MACHINE_CATEGORY_RULE

PRODUCTION_RUNTIME_CHANGED:
NO

NEXT_STEP:
Implement the guarded v3 rule in a separate change; do not widen `CABLE_MACHINE` to raw trusted-category evidence without the structured guard.
