# CATALOG-INTELLIGENCE-A00.3.5 - Commercial Product Ontology v3 Guarded CABLE_MACHINE Structured-Evidence Rule

Status: **READY**
Type: guarded ontology version increment with targeted semantic recovery.

## 1. Scope

This slice adds an immutable `commercial-product-ontology-v3` alongside the existing immutable v1/v2
registries.

v3 changes exactly one semantic capability:

- `PRODUCT_FAMILY/CABLE_MACHINE` now allows `STRUCTURED_FEATURE` evidence in addition to `NAME_TEXT`;
- the classifier may recover `CABLE_MACHINE` only when both of these are true:
  - trusted category `290` = `Maquinas con Poleas`;
  - one accepted structured feature is present:
    - `Relacion de cable y polea`
    - `Pila de Stack`
    - `Peso maximo de carga` scoped to `Polea(s)`
    - `Largo de la manga` scoped to `Polea(s)`

No other ontology tag meaning changed. v1 and v2 remain untouched.

## 2. Guardrails

The new rule is intentionally narrow:

- no raw category-only classification from category `290`;
- no `FREE_TEXT_DESCRIPTION`;
- no category `451` (`Accesorios de Polea`) activation;
- if the current primary family is `OTHER`, guarded evidence promotes primary to `CABLE_MACHINE`;
- if the current primary family is `PLATE_LOADED_MACHINE`, guarded evidence adds secondary
  `CABLE_MACHINE`;
- every other primary family remains unchanged.

## 3. Fixture self-containment

Zero-argument fixture resolution is now centralized in:

`scripts/product-semantic-classification/lib/fixture-paths.ts`

That helper resolves the migrated local fixture filenames by prefix from:

`docs/audits/product-intelligence-exploration/inputs/`

It is used by:

- `scripts/product-semantic-classification/classify-catalog.ts`
- `scripts/product-semantic-classification/non-product-policy-v2-migration.ts`
- `scripts/product-semantic-classification/golden-set-regression.ts`
- semantics tests that consume the same fixture set

Result: the repo is self-contained for ontology tests, classifier tests, golden-set regression, full
catalog classification, and the v1/v2 migration audit. No sibling-repo filesystem access is needed.

## 4. Verified semantic delta

Full-catalog v2 -> v3 comparison produces exactly 10 intended semantic changes and no spillover.

`OTHER` -> primary `CABLE_MACHINE`:

- `1207`
- `1444`
- `1445`
- `1450`
- `1451`

Primary `PLATE_LOADED_MACHINE` + secondary `CABLE_MACHINE`:

- `1021`
- `1430`
- `1922`
- `2134`
- `2182`

Negative control unchanged:

- `2133` remains primary `PLATE_LOADED_MACHINE` with no secondary `CABLE_MACHINE`

Known hybrid recovered:

- `2134` remains primary `PLATE_LOADED_MACHINE` and now correctly carries secondary
  `CABLE_MACHINE`

False-positive controls remain clean:

- category `451` contributes zero `PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3` matches
- category `290` alone is still insufficient

## 5. Counts and checksums

Canonical registry hashes:

- v2: `22cfbe3bcf2ac2777fa6b99d840cf3574ccc2d79af81fa114727b9abda1dd0cb`
- v3: `f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955`

Full classification checksums:

- v2: `a4d544906355e557a7c0e260f168847c4aad376ba727688bb9e8a6710c27ca1c`
- v3: `83d97a9ce4fb90fcf0159f80e81cc64e5518ae8be861659adc68a5c854bc3fe3`

Semantic projection checksums:

- v2: `be3d7b86c5a52250546db43613ef8ba86ee582d3f53f8d5785337f339fe502bd`
- v3: `6543fc87cda2a2418fb198a24a928412c574626630a58d4b05317f043fff065a`

v3 classification counts:

- source products: `2011`
- semantic universe: `1998`
- excluded non-products: `13`
- `CLASSIFIED`: `1251`
- `PARTIALLY_CLASSIFIED`: `397`
- `OTHER`: `350`
- `EXCLUDED_NON_PRODUCT`: `13`
- `NEEDS_REVIEW`: `0`

Golden set under v3:

- `PRODUCT_FAMILY`: `200/200`
- `DISCIPLINE`: `200/200`
- `USE_CONTEXT`: `200/200`

## 6. Validation

Executed and passing:

```bash
npm run typecheck
npm run test -- tests/unit/product-semantic-classification-classifier.test.ts tests/unit/product-semantic-classification-cli-fixtures.test.ts tests/unit/product-semantic-classification-golden-set-regression.test.ts tests/unit/product-semantic-classification-v2-non-product-policy.test.ts tests/unit/product-semantic-classification-v3-cable-machine.test.ts tests/unit/commercial-product-ontology-registry.test.ts tests/unit/product-semantic-classification-product-family.test.ts tests/unit/product-semantic-classification-discipline.test.ts tests/unit/product-semantic-classification-use-context.test.ts
npm run product:semantic:classify
npm run product:semantic:v2-migration-audit
npm test
```

Observed command outputs:

- `npm run product:semantic:classify` resolved local fixtures and produced checksum
  `83d97a9ce4fb90fcf0159f80e81cc64e5518ae8be861659adc68a5c854bc3fe3`
- `npm run product:semantic:v2-migration-audit` resolved local fixtures and preserved the known v1
  -> v2 non-product-only delta with zero unexpected semantic changes
- focused semantics suite: `240` tests passed
- full suite: `2040` tests passed

## 7. Decision

`commercial-product-ontology-v3` is ready for the next gate.

Next step:

`A00.4 Classification Acceptance & Quality Gate`
