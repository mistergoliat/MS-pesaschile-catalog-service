# CUSTOMER-INTELLIGENCE-R2-A00.3.3 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Product Semantics Separation Closure

Status: **READY**
Type: boundary cleanup and self-containment hardening.

## 1. What changed

This slice closes the two defects left by the separation audit:

- removed the affinity-oriented field from the commercial product ontology contract, all registry tag
  data, validator rules, tests, serialized registry output, and release documentation;
- unified product-semantic fixture resolution so the local migrated fixture files are discovered by
  prefix from `docs/audits/product-intelligence-exploration/inputs/` in both CLI and test flows.

No product semantic rule, ontology tag, exclusion pattern, confidence policy, or historical policy was
changed.

## 2. Boundary result

`catalog-service` now exposes product-semantic truth only:

- active semantic tags remain ordinary `status='ACTIVE'`, `residual=false` facts;
- `OTHER` remains the unique residual tag with `axis='PRODUCT_FAMILY'`, `status='RESIDUAL'`,
  `residual=true`;
- no affinity-oriented vocabulary remains in the ontology contract.

Any future decision about whether a semantic fact contributes to customer affinity belongs downstream in
`customer-profile`, not in the catalog ontology.

## 3. CLI self-containment

Added one shared helper:

`scripts/product-semantic-classification/lib/fixture-paths.ts`

That helper now drives:

- `scripts/product-semantic-classification/classify-catalog.ts`
- `scripts/product-semantic-classification/non-product-policy-v2-migration.ts`
- `scripts/product-semantic-classification/golden-set-regression.ts`
- full-catalog and golden-set tests that previously reimplemented prefix resolution

As a result, these zero-arg commands now run successfully inside this repo without any
`customer-profile` filesystem access:

```bash
npm run product:semantic:classify
npm run product:semantic:v2-migration-audit
```

## 4. Semantic equivalence

Removing the deleted affinity-oriented field changes registry serialization only. It does **not** change any of:

- `classificationStatus`
- `primaryProductFamily`
- `secondaryProductFamilies`
- `disciplines`
- `useContexts`
- tag confidence

Pre-fix semantic projection checksum across all 2011 products:

```text
be3d7b86c5a52250546db43613ef8ba86ee582d3f53f8d5785337f339fe502bd
```

Post-fix semantic projection checksum:

```text
be3d7b86c5a52250546db43613ef8ba86ee582d3f53f8d5785337f339fe502bd
```

Representation-only changes:

- `commercial-product-ontology-v1` registry hash changed to
  `32d0b7f4a9a87ed5b1316b63f07af452d2f8a6b4ed012be3aa53729d149aefb9`
- `commercial-product-ontology-v2` registry hash changed to
  `22cfbe3bcf2ac2777fa6b99d840cf3574ccc2d79af81fa114727b9abda1dd0cb`
- full classification checksum changed to
  `a4d544906355e557a7c0e260f168847c4aad376ba727688bb9e8a6710c27ca1c`

That checksum change is expected because `registryHash` is embedded in every classification result.

## 5. Validation

Current catalog results remain unchanged:

- source products: `2011`
- semantic universe: `1998`
- excluded non-products: `13`
- `CLASSIFIED`: `1246`
- `PARTIALLY_CLASSIFIED`: `397`
- `OTHER`: `355`
- `EXCLUDED_NON_PRODUCT`: `13`
- `NEEDS_REVIEW`: `0`

Golden set remains unchanged:

- `PRODUCT_FAMILY`: `199/200`
- `DISCIPLINE`: `200/200`
- `USE_CONTEXT`: `200/200`
- known exception: productId `2134`

Validation run:

```bash
npm run typecheck
npx vitest run --config vitest.config.ts tests/unit/commercial-product-ontology-registry.test.ts tests/unit/product-semantic-classification-classifier.test.ts tests/unit/product-semantic-classification-golden-set-regression.test.ts tests/unit/product-semantic-classification-v2-non-product-policy.test.ts tests/unit/product-semantic-classification-cli-fixtures.test.ts
npm run product:semantic:classify
npm run product:semantic:v2-migration-audit
npm test
```
