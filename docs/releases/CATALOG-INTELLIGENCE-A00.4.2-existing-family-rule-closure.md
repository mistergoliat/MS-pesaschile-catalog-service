# CATALOG-INTELLIGENCE-A00.4.2 - Existing Family Miss Rule Closure

Status: **COMPLETE**
Audit date: **2026-08-29**
Production runtime changed: **NO**

## 1. Scope

This slice closes the existing-family false negatives adjudicated by
`docs/releases/CATALOG-INTELLIGENCE-A00.4.1-existing-family-miss-adjudication.md`.

It does not change:

- ontology version
- ontology hash
- active axes
- vocabulary
- runtime production wiring
- SearchProducts V2
- snapshot publication

## 2. Adjudication input

Authoritative A00.4.1 decisions:

- `CLEAR_EXISTING_FAMILY`: `19`
- `CONDITIONAL_EXISTING_FAMILY`: `11`
- `DATA_QUALITY`: `1` -> `1023` must remain `OTHER`
- `FALSE_POSITIVE_IN_A00_4_AUDIT`: `1` -> `1619` must remain `OTHER`

Implemented closure count:

- semantic target closures landed: `30`
- authoritative residuals preserved: `1023`, `1619`

One adjudicated "clear" token was narrowed during neighborhood regression:

- `extension de cuadriceps` was not shipped as a global exact rule
- instead it was shipped behind the selectorized stack guard
- reason: full-neighborhood review on Saturday, August 29, 2026 found current plate-loaded
  collisions on `1656` and `2069`

This keeps the slice inside the A00.4.1 boundary while preserving precision.

## 3. Clear rules added

Added bounded `NAME_TEXT` closures:

- `PF_CARDIO_MACHINE_ERG_EXACT_NAME_V1`
  - `rowerg`
  - `bikeerg`
  - `skierg`
- `PF_CARDIO_MACHINE_ROWER_EXACT_NAME_V1`
  - `remo de aire`
  - `remo de agua`
- `PF_CARDIO_MACHINE_BIKE_EXACT_NAME_V1`
  - `air cycle`
  - `air bike`
- `PF_CARDIO_MACHINE_STAIR_EXACT_NAME_V1`
  - `escalera led`
  - `escalera home led`
- `PF_FLOORING_TURF_NAME_V1`
  - `pasto sintetico`
- `PF_PLATE_LOADED_MACHINE_EXACT_NAME_V1`
  - `linear leg press`
  - `hack squat`
  - `hip thrust machine`
  - `standing leg curl`
- `PF_SELECTORIZED_MACHINE_EXACT_NAME_V1`
  - `seated leg curl`
  - `prone leg curl`
  - `dual leg curl/extension`

No broad generic rules were added for:

- `escalera`
- `remo`
- `press`
- `leg curl`

## 4. Conditional rules added

Added guarded closures:

- `PF_PLATE_LOADED_MACHINE_GUARDED_NAME_V1`
  - `shoulder press`
  - `chest press`
  - `leg extension`
  - `pulldown`
  - `low row`
- `PF_SELECTORIZED_MACHINE_GUARDED_NAME_V1`
  - `extension de cuadriceps`
  - `chest press`
  - `shoulder press`
  - `leg extension`
  - `seated row`
  - `seated leg press`

## 5. Structured guards

Plate-loaded guard:

- requires `Diametro de manga` with `50`
- and at least one supporting plate-loaded signal:
  - `Categoria = Olimpico`
  - non-empty `Largo de la manga`
  - `Peso maximo de carga` containing `por lado`
- rejects cable wording for the pulldown case:
  - `crossover`
  - `cable`
  - `polea`
  - `lat pulldown`

Selectorized guard:

- requires non-empty `Pila de Stack`

If both guarded families match the same ambiguous token, the classifier returns no guarded winner
and falls through to normal resolution rather than guessing.

## 6. Neighborhood regression

Observed rule hits on Saturday, August 29, 2026:

- total products using new A00.4.2 family rules: `42`
- semantic changes: `33`
- representation-only collateral changes: `9`

Semantic target changes:

- `280`, `416`, `448`, `1070`, `1071`, `1072`, `1162`, `1179`, `1180`, `1188`, `1231`, `1232`,
  `1240`, `1241`, `1289`, `1360`, `1361`, `1362`, `1363`, `1364`, `1366`, `1367`, `1372`,
  `1373`, `1374`, `1378`, `1381`, `1385`, `1881`, `2297`

Semantic collateral changes outside the authoritative 30:

- `1699` historical `Remo de Aire Magnetico Lite Series | Obelix | 2da Seleccion`
- `1701` historical `Air Cycle Eco Smart Connect | XEBEX | 2da Seleccion`
- `2138` historical `Hack Squat Lineal MO 2.0 - 2da Seleccion | Obelix`

Representation-only collateral changes:

- `445`, `447`, `449`, `450`, `452`, `492`, `1229`, `1269`, `1272`

These nine collateral rows were already classifiable through category fallback and stayed in the
same family. Only their primary family provenance moved from category fallback to the new bounded
rule.

## 7. Negative controls

Verified controls:

- agility ladders do not classify as cardio from bare `escalera`
- cable-machine products keep priority over `pulldown` wording
- ambiguous `pulldown` without the plate-loaded guard stays `OTHER`
- ambiguous `chest press` without plate-loaded or stack guard stays `OTHER`
- `1619` stays `OTHER`
- `1023` stays `OTHER`
- `2133` remains unchanged relative to guarded cable v3

## 8. Exact changed products

Semantic changes were limited to these `33` product ids:

- `280`, `416`, `448`, `1070`, `1071`, `1072`, `1162`, `1179`, `1180`, `1188`, `1231`, `1232`,
  `1240`, `1241`, `1289`, `1360`, `1361`, `1362`, `1363`, `1364`, `1366`, `1367`, `1372`,
  `1373`, `1374`, `1378`, `1381`, `1385`, `1699`, `1701`, `1881`, `2138`, `2297`

Shape of the semantic change:

- current-catalog target rows: `OTHER -> CLASSIFIED`
- historical collateral rows: `OTHER -> PARTIALLY_CLASSIFIED`
- new primary families were existing ontology families only
- no new secondary family was introduced by this slice

Additional axis impact:

- cardio rows also gained `DISCIPLINE = CARDIO_ENDURANCE` through existing family inference
- pre-existing `USE_CONTEXT` facts remained intact where already supported

## 9. Collateral changes

Collateral representation-only ids:

- `445`, `447`, `449`, `450`, `452`, `492`, `1229`, `1269`, `1272`

Meaning:

- no family drift
- no discipline drift
- no use-context drift
- only family provenance/confidence resolution became explicit through the new bounded rule

## 10. Before/after classification counts

Before A00.4.2:

- `CLASSIFIED`: `1251`
- `PARTIALLY_CLASSIFIED`: `397`
- `OTHER`: `350`
- `EXCLUDED_NON_PRODUCT`: `13`
- `NEEDS_REVIEW`: `0`

After A00.4.2:

- `CLASSIFIED`: `1281`
- `PARTIALLY_CLASSIFIED`: `400`
- `OTHER`: `317`
- `EXCLUDED_NON_PRODUCT`: `13`
- `NEEDS_REVIEW`: `0`

Delta:

- `CLASSIFIED`: `+30`
- `PARTIALLY_CLASSIFIED`: `+3`
- `OTHER`: `-33`

## 11. Checksums

- old semantic checksum: `83d97a9ce4fb90fcf0159f80e81cc64e5518ae8be861659adc68a5c854bc3fe3`
- new semantic checksum: `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e`
- checksum changed: `true`
- registry hash unchanged: `f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955`

## 12. Golden set

- `PRODUCT_FAMILY`: `200/200`
- `DISCIPLINE`: `200/200`
- `USE_CONTEXT`: `200/200`

## 13. Provenance

- semantic facts with rule provenance: `100%`
- semantic facts with evidence provenance: `100%`
- orphan evidence records: `0`
- silent semantic facts: `0`
- forbidden evidence violations: `0`
- rule-contract violations: `0`

## 14. Commercial impact

Semantic target closures only:

- orders: `127`
- units: `135`
- revenue: `110586468`

Including the `3` historical collateral semantic changes:

- orders: `130`
- units: `138`
- revenue: `112303452`

Representation-only collateral rows carried additional commercial history, but they did not change
product truth.

## 15. Validation

Executed on Saturday, August 29, 2026:

- `npm run typecheck`
  - `PASS`
- focused semantic tests
  - `114/114 PASS`
- `npm run product:semantic:classify`
  - checksum `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e`
  - counts `1281 / 400 / 317 / 13 / 0`
- `npm run product:semantic:v2-migration-audit`
  - v2 counts `1276 / 400 / 322 / 13 / 0`
  - unexpected semantic changes `0`
- `npm run product:semantic:existing-family-miss-adjudication`
  - `EXISTING_FAMILY_MISS_ADJUDICATION_COMPLETE`
  - authoritative candidate count `32`
- `npm run product:semantic:acceptance-audit`
  - `PRODUCT_SEMANTIC_CLASSIFICATION_ACCEPTED_WITH_DEBT`
  - summary hash `64cad1c164d2b2da9e75f9b702f0574eb7e15ae0e3400fbee0643e810624fb82`
- `npm test`
  - `2070/2078 PASS`
  - `8` unrelated HTTP/integration timeouts remained outside this slice

## 16. Residual debt

Remaining non-blocking debt after closure:

- unmodeled conditioning/accessory concepts in `OTHER`: `39`
- deferred pack residuals: `90`
- historical-only name-limited rows in `OTHER`: `61`
- data-quality/test rows in `OTHER`: `4`

Preserved intentional residuals from A00.4.1:

- `1023` `MAQUINA CUADRICEPS`
- `1619` `Pack Duo Leg Curl/Extension MO 2.0 | Obelix`

## 17. Updated A00.4 verdict

Updated gate result on Saturday, August 29, 2026:

`PRODUCT_SEMANTIC_CLASSIFICATION_ACCEPTED_WITH_DEBT`

The closure removed the active existing-family false-negative cluster without widening into material
false positives, preserved deterministic reproducibility, and kept provenance/evidence compliance
clean.
