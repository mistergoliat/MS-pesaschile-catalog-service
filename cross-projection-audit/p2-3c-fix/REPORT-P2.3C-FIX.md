# P2.3C-FIX - Training Rule Precision & Final Reconciliation

Date: 2026-10-07. Disposition: **READY_FOR_FINAL_CONTENT_REVIEW**. Offline candidate only; no activation, pointer publication, deployment or commit.

## A. Rule defects

Material cable was accepted as a mechanism; pulley attachments inherited resistance; inferred cable families were circular; rack/smith/cage host names leaked into attachments; a mixed pull-up/push-up category asserted pull-up; preacher pads inherited dedicated biceps curl; generic deferred SQUAT became an ontology gap. The global sweep additionally found storage stands, racks for dumbbells/balls/mats and installation-service host references incorrectly assigned BARBELL_SUPPORT. Rules affected: cable NAME/CATEGORY/FEATURE/FAMILY, barbell and guided barbell NAME/CATEGORY, mixed PULL_UP closure and dedicated-machine accessory reject patterns (full inventory in global-rule-sweep.json).

## B. Rule changes

| Class | Before | After |
| --- | --- | --- |
| A | Any cable feature | Semantic mechanism wording; Material/composition cannot qualify |
| B | Pulley compatibility/category | Passive handles/straps/bars/seats excluded; actual attachment modules require mechanism evidence |
| C | CABLE_MACHINE tag alone | Product family provenance must identify an actual cable machine or structured mechanism; suppression recorded as Product debt |
| D | Host rack/smith/cage token | Accessory context vetoes host support; valid own cable and bodyweight facts survive |
| E | Mixed category implies PULL_UP | Discriminating pull-up name or specific category required |
| F | Preacher pad name implies machine | Support-component/accessory rejection; dedicated-machine positives retained |
| Human case | Body Pump + Rack certified | Generic bundle rack remains AMBIGUOUS without specific support evidence |
| Global storage | Any rack/atril token implied barbell support | Storage payload/category and installation-service guards; real squat/power/half racks preserved |
| Deferred | Any lexical deferred finding implies ontology gap | ACTIVE and explicitly forbidden boundary codes filtered before final state |


The reconciliation layer remains. Both ordinary native builds and this audit rerun the classifier from frozen CSV/trust source, with Product provenance, for every record; they do not patch rejected candidate data. Empty historical negatives remain conservative unless fresh review evidence requires AMBIGUOUS. A historical 95% coverage target is restricted to its historical rule identity; corrected facts are not certified to satisfy a target. Historical snapshot reads remain hash-validated with the pinned historical rules identity; publication uses current policy and structural gates. The authority comparator now reads frozen accepted evidence (and validates V1 lineage) instead of claiming corrected rules reproduce historical semantics.

## C. 51 disposition

| Final state | Count | IDs |
| --- | --- | --- |
| SEMANTIC_COMPLETE | 26 | 12, 761, 777, 784, 1021, 1124, 1386, 1512, 1536, 1540, 1545, 1578, 1810, 1811, 1813, 1817, 1880, 1886, 1999, 2004, 2006, 2007, 2008, 2017, 2059, 2096 |
| VERIFIED_NO_APPLICABLE_CAPABILITY | 23 | 87, 437, 454, 455, 462, 463, 466, 1022, 1137, 1138, 1139, 1140, 1343, 1344, 1345, 1346, 1347, 1348, 1349, 1350, 1832, 1996, 2195 |
| AMBIGUOUS | 1 | 435 |
| DATA_GAP | 1 | 930 |


Prior review gate: 18 approved preserved; 26 rejected invalid facts removed; 1 human case conservative; 6 RULE_GAP no false ONTOLOGY_GAP. All PASS. Evidence: focused-content-review.json.

## D. Invalid assignments removed

26/26 reviewed rejections corrected. Global removal count: 116 assignments across 113 products. This includes P930 host support and removals outside the reviewed cohort.

| productId | invalidAssignment | ruleBefore | reasonRejected | afterAssignments | afterResolution |
| --- | --- | --- | --- | --- | --- |
| 87 | CABLE_RESISTANCE | FEATURE_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | Material: Cable de acero recubierto en pvc y mangos de aluminio describe una cuerda de salto (categoría Cuerdas de Salto), no entrega de resistencia por poleas. FEATURE_NAME_CABLE_RESISTANCE_EXPLICIT_V2 confunde material con mecanismo; HIGH injustificado. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 437 | CABLE_RESISTANCE | NAME_CABLE_RESISTANCE_EXPLICIT_V2, CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 454 | CABLE_RESISTANCE | NAME_CABLE_RESISTANCE_EXPLICIT_V2, CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 455 | CABLE_RESISTANCE | NAME_CABLE_RESISTANCE_EXPLICIT_V2, CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 462 | CABLE_RESISTANCE | FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 463 | CABLE_RESISTANCE | CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 466 | CABLE_RESISTANCE | FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1022 | CABLE_RESISTANCE | FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1124 | GUIDED_BARBELL_SUPPORT | NAME_GUIDED_BARBELL_SUPPORT_EXPLICIT_V2 | Lat Pull Down / Accesorio Smith Machine contiene el nombre de la máquina anfitriona. GUIDED_BARBELL_SUPPORT se obtiene sólo de smith; las fuentes describen un módulo de polea con relación 2:1, sin trayectoria guiada de barra del producto vendido. CABLE_RESISTANCE sí está sustentado, pero un assignment inválido impide COMPLETE. | CABLE_RESISTANCE/DIRECT | SEMANTIC_COMPLETE |
| 1137 | CABLE_RESISTANCE | CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1138 | CABLE_RESISTANCE | CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1139 | CABLE_RESISTANCE | CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1140 | CABLE_RESISTANCE | CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1343 | CABLE_RESISTANCE | FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1344 | CABLE_RESISTANCE | FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1345 | CABLE_RESISTANCE | FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1346 | CABLE_RESISTANCE | NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1347 | CABLE_RESISTANCE | NAME_CABLE_RESISTANCE_EXPLICIT_V2, CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1348 | CABLE_RESISTANCE | FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1349 | CABLE_RESISTANCE | FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1350 | CABLE_RESISTANCE | FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1832 | BICEPS_CURL | NAME_BICEPS_CURL_EXPLICIT_V2 | Preacher Pad Biceps Curl: material Espuma Foam, PU y dimensiones 65×35×20 cm describen un pad, no una máquina dedicada. BICEPS_CURL DIRECT/EXPLICIT procede sólo del ejercicio nombrado. El rejectPattern de la regla V2 omite pad; familia null no valida el mecanismo. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1996 | CABLE_RESISTANCE | NAME_CABLE_RESISTANCE_EXPLICIT_V2 | Asiento Polea Accesorio Alpha tiene tapizado Espuma Foam/PU, montaje apto para perfil 60×60 y perforaciones; no hay mecanismo ni relación de cable. polea identifica compatibilidad del asiento. No sustenta CABLE_RESISTANCE DIRECT/EXPLICIT. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |
| 1999 | BARBELL_SUPPORT | NAME_BARBELL_SUPPORT_EXPLICIT_V2 | Cable Polea Rack Pro 2.0 Accesorio Alpha y relación 1:1 sustentan CABLE_RESISTANCE. rack identifica la máquina receptora del módulo; no hay evidencia de soporte abierto de barra en este accesorio. BARBELL_SUPPORT DIRECT/EXPLICIT es extrapolación del anfitrión. | CABLE_RESISTANCE/DIRECT | SEMANTIC_COMPLETE |
| 2096 | PULL_UP | CATEGORY_CATEGORY_PULL_UP_PUSH_UP_BARS_CLOSURE_V2 | Par Paralelas Triple Grip, categoría Barras Paralelas y dimensiones 37×37×33 cm sustentan BODYWEIGHT_SUPPORT. PULL_UP deriva exclusivamente de la categoría mixta Barras Pull Up & Push Up, que no discrimina dominadas de push-ups. No existe nombre, feature ni categoría específica de dominadas: DIRECT/HIGH no sustentado. | BODYWEIGHT_SUPPORT/DIRECT | SEMANTIC_COMPLETE |
| 2195 | CABLE_RESISTANCE | NAME_CABLE_RESISTANCE_EXPLICIT_V2, CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | El producto es un agarre, soga o strap para conectarse a una polea. La evidencia describe compatibilidad/accesorio; no entrega resistencia por cable. CABLE_RESISTANCE exige resistance delivery. DIRECT/HIGH o EXPLICIT no queda sustentado; cuando es FAMILY_DERIVED la mapping está autorizada, pero la familia CABLE_MACHINE procede del mismo nombre del accesorio y no prueba una estación de cable. | (none) | VERIFIED_NO_APPLICABLE_CAPABILITY |


All globally removed IDs/concepts: P87:CABLE_RESISTANCE/DIRECT; P88:CABLE_RESISTANCE/DIRECT; P246:BARBELL_SUPPORT/DIRECT; P247:BARBELL_SUPPORT/DIRECT; P247:CABLE_RESISTANCE/DIRECT; P248:BARBELL_SUPPORT/DIRECT; P249:BARBELL_SUPPORT/DIRECT; P250:BARBELL_SUPPORT/DIRECT; P253:BARBELL_SUPPORT/DIRECT; P300:PULL_UP/DIRECT; P301:PULL_UP/DIRECT; P302:PULL_UP/DIRECT; P382:BARBELL_SUPPORT/DIRECT; P388:PULL_UP/DIRECT; P389:BARBELL_SUPPORT/DIRECT; P394:BARBELL_SUPPORT/DIRECT; P395:BARBELL_SUPPORT/DIRECT; P396:BARBELL_SUPPORT/DIRECT; P414:BARBELL_SUPPORT/DIRECT; P415:BARBELL_SUPPORT/DIRECT; P417:BARBELL_SUPPORT/DIRECT; P419:BARBELL_SUPPORT/DIRECT; P434:BARBELL_SUPPORT/DIRECT; P435:BARBELL_SUPPORT/DIRECT; P437:CABLE_RESISTANCE/DIRECT; P454:CABLE_RESISTANCE/DIRECT; P455:CABLE_RESISTANCE/DIRECT; P462:CABLE_RESISTANCE/FAMILY_DERIVED; P463:CABLE_RESISTANCE/DIRECT; P466:CABLE_RESISTANCE/FAMILY_DERIVED; P479:BARBELL_SUPPORT/DIRECT; P577:BARBELL_SUPPORT/DIRECT; P608:BARBELL_SUPPORT/DIRECT; P643:BARBELL_SUPPORT/DIRECT; P644:BARBELL_SUPPORT/DIRECT; P646:BARBELL_SUPPORT/DIRECT; P773:BARBELL_SUPPORT/DIRECT; P774:BARBELL_SUPPORT/DIRECT; P888:BARBELL_SUPPORT/DIRECT; P889:BARBELL_SUPPORT/DIRECT; P889:LEG_PRESS/DIRECT; P890:BARBELL_SUPPORT/DIRECT; P891:BARBELL_SUPPORT/DIRECT; P892:BARBELL_SUPPORT/DIRECT; P893:BARBELL_SUPPORT/DIRECT; P894:BARBELL_SUPPORT/DIRECT; P895:BARBELL_SUPPORT/DIRECT; P896:BARBELL_SUPPORT/DIRECT; P897:CABLE_RESISTANCE/DIRECT; P899:CABLE_RESISTANCE/FAMILY_DERIVED; P903:BARBELL_SUPPORT/DIRECT; P930:BARBELL_SUPPORT/DIRECT; P934:PULL_UP/DIRECT; P983:BARBELL_SUPPORT/DIRECT; P999:BARBELL_SUPPORT/DIRECT; P1000:BARBELL_SUPPORT/DIRECT; P1001:BARBELL_SUPPORT/DIRECT; P1002:BARBELL_SUPPORT/DIRECT; P1004:CABLE_RESISTANCE/DIRECT; P1022:CABLE_RESISTANCE/FAMILY_DERIVED; P1089:BARBELL_SUPPORT/DIRECT; P1124:GUIDED_BARBELL_SUPPORT/DIRECT; P1137:CABLE_RESISTANCE/DIRECT; P1138:CABLE_RESISTANCE/DIRECT; P1139:CABLE_RESISTANCE/DIRECT; P1140:CABLE_RESISTANCE/DIRECT; P1177:BARBELL_SUPPORT/DIRECT; P1183:BARBELL_SUPPORT/DIRECT; P1194:BARBELL_SUPPORT/DIRECT; P1195:BARBELL_SUPPORT/DIRECT; P1196:BARBELL_SUPPORT/DIRECT; P1210:BARBELL_SUPPORT/DIRECT; P1298:BARBELL_SUPPORT/DIRECT; P1309:BARBELL_SUPPORT/DIRECT; P1343:CABLE_RESISTANCE/FAMILY_DERIVED; P1344:CABLE_RESISTANCE/FAMILY_DERIVED; P1345:CABLE_RESISTANCE/FAMILY_DERIVED; P1346:CABLE_RESISTANCE/DIRECT; P1347:CABLE_RESISTANCE/DIRECT; P1348:CABLE_RESISTANCE/FAMILY_DERIVED; P1349:CABLE_RESISTANCE/FAMILY_DERIVED; P1350:CABLE_RESISTANCE/FAMILY_DERIVED; P1365:CABLE_RESISTANCE/FAMILY_DERIVED; P1415:BARBELL_SUPPORT/DIRECT; P1416:BARBELL_SUPPORT/DIRECT; P1452:PULL_UP/DIRECT; P1453:PULL_UP/DIRECT; P1454:PULL_UP/DIRECT; P1492:BARBELL_SUPPORT/DIRECT; P1493:BARBELL_SUPPORT/DIRECT; P1510:BARBELL_SUPPORT/DIRECT; P1624:BARBELL_SUPPORT/DIRECT; P1624:CABLE_RESISTANCE/DIRECT; P1704:BARBELL_SUPPORT/DIRECT; P1812:BARBELL_SUPPORT/DIRECT; P1832:BICEPS_CURL/DIRECT; P1917:CABLE_RESISTANCE/FAMILY_DERIVED; P1919:BARBELL_SUPPORT/DIRECT; P1939:BARBELL_SUPPORT/DIRECT; P1941:BARBELL_SUPPORT/DIRECT; P1996:CABLE_RESISTANCE/DIRECT; P1999:BARBELL_SUPPORT/DIRECT; P2009:BARBELL_SUPPORT/DIRECT; P2014:BARBELL_SUPPORT/DIRECT; P2015:BARBELL_SUPPORT/DIRECT; P2083:BARBELL_SUPPORT/DIRECT; P2095:BARBELL_SUPPORT/DIRECT; P2096:PULL_UP/DIRECT; P2097:BARBELL_SUPPORT/DIRECT; P2098:BARBELL_SUPPORT/DIRECT; P2099:BARBELL_SUPPORT/DIRECT; P2100:BARBELL_SUPPORT/DIRECT; P2195:CABLE_RESISTANCE/DIRECT; P2228:BARBELL_SUPPORT/DIRECT; P2285:CABLE_RESISTANCE/FAMILY_DERIVED; P2305:BARBELL_SUPPORT/DIRECT.

## E. Valid assignments preserved

| Mixed fixture | Surviving facts | Final state |
| --- | --- | --- |
| 1124 | CABLE_RESISTANCE/DIRECT | SEMANTIC_COMPLETE |
| 1999 | CABLE_RESISTANCE/DIRECT | SEMANTIC_COMPLETE |
| 2096 | BODYWEIGHT_SUPPORT/DIRECT | SEMANTIC_COMPLETE |


All 18 prior approvals preserve code/relation facts and remain COMPLETE. Evidence provenance is regenerated from source and may become more precise. No product-ID branches exist in classifier/finalizer rules.

## F. Six RULE_GAP disposition

| Fixture | Final state | Surviving facts |
| --- | --- | --- |
| 761 | SEMANTIC_COMPLETE | BARBELL_SUPPORT/DIRECT |
| 930 | DATA_GAP | (none) |
| 1512 | SEMANTIC_COMPLETE | BARBELL_SUPPORT/DIRECT |
| 1536 | SEMANTIC_COMPLETE | BARBELL_SUPPORT/DIRECT |
| 1540 | SEMANTIC_COMPLETE | BARBELL_SUPPORT/DIRECT |
| 1545 | SEMANTIC_COMPLETE | BARBELL_SUPPORT/DIRECT |


P930 remains DATA_GAP with no new ontology code or automatic negative certification of its unspecified utility. Generic SQUAT is deliberately forbidden; ACTIVE deferred concepts are rule issues, not missing vocabulary.

## G. Global sweep

All 2048 records inspected; 103 outside the 51 have assignment/resolution deltas. Structural evidence-domain violations: 0. Full reproducible before/removed/preserved/new/review matrix and per-product source evidence: global-rule-sweep.json. Known equivalent false-positive classes are removed; remaining broader linguistic adjudication is not automated.

| Rule | affectedBefore | removed | preserved | new | reviewRequired |
| --- | --- | --- | --- | --- | --- |
| CATEGORY_PULL_UP_PUSH_UP_BARS_CLOSURE_V2 | 10 | 1 | 9 | 0 | 0 |
| CATEGORY_CATEGORY_PULL_UP_PUSH_UP_BARS_CLOSURE_V2 | 23 | 9 | 14 | 0 | 0 |
| NAME_PEC_FLY_CLOSURE_V2 | 6 | 0 | 6 | 0 | 0 |
| NAME_LEG_CURL_DE_FEMORAL_CLOSURE_V2 | 2 | 0 | 2 | 0 | 0 |
| NAME_T_BAR_ROW_CLOSURE_V2 | 2 | 0 | 2 | 0 | 0 |
| NAME_HIP_THRUSTER_CLOSURE_V2 | 1 | 0 | 1 | 0 | 0 |
| NAME_HACK_SQUAT_DEDICATED_V2 | 11 | 0 | 11 | 0 | 0 |
| NAME_LEG_PRESS_DEDICATED_V2 | 21 | 1 | 20 | 0 | 0 |
| NAME_CALF_RAISE_DEDICATED_V2 | 3 | 0 | 3 | 0 | 0 |
| NAME_REAR_DELT_FLY_EXPLICIT_V2 | 6 | 0 | 6 | 0 | 0 |
| NAME_BICEPS_CURL_EXPLICIT_V2 | 6 | 1 | 5 | 0 | 0 |
| NAME_TRICEPS_EXTENSION_EXPLICIT_V2 | 4 | 0 | 4 | 0 | 0 |
| NAME_PENDULUM_SQUAT_DEDICATED_V2 | 1 | 0 | 1 | 0 | 0 |
| NAME_BELT_SQUAT_DEDICATED_V2 | 1 | 0 | 1 | 0 | 0 |
| NAME_REVERSE_HYPER_DEDICATED_V2 | 1 | 0 | 1 | 0 | 0 |
| NAME_DEADLIFT_DEDICATED_V2 | 1 | 0 | 1 | 0 | 0 |
| NAME_PULLOVER_DEDICATED_V2 | 1 | 0 | 1 | 0 | 0 |
| NAME_MULTI_DIRECTIONAL_RESISTANCE_EXPLICIT_V2 | 10 | 0 | 10 | 0 | 0 |
| FEATURE_NAME_MULTI_DIRECTIONAL_RESISTANCE_EXPLICIT_V2 | 2 | 0 | 2 | 0 | 0 |
| NAME_BODYWEIGHT_SUPPORT_EXPLICIT_V2 | 4 | 0 | 4 | 0 | 0 |
| CATEGORY_NAME_BODYWEIGHT_SUPPORT_EXPLICIT_V2 | 12 | 0 | 12 | 0 | 0 |
| NAME_BARBELL_SUPPORT_EXPLICIT_V2 | 133 | 73 | 60 | 0 | 1 |
| NAME_GUIDED_BARBELL_SUPPORT_EXPLICIT_V2 | 22 | 1 | 21 | 0 | 0 |
| NAME_CABLE_RESISTANCE_EXPLICIT_V2 | 51 | 11 | 40 | 0 | 0 |
| CATEGORY_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | 38 | 12 | 26 | 0 | 0 |
| FEATURE_NAME_CABLE_RESISTANCE_EXPLICIT_V2 | 49 | 2 | 47 | 0 | 0 |
| FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2 | 18 | 13 | 5 | 0 | 0 |


Counts are evidence-rule hits, so rows overlap. EVIDENCE_SUPPRESSED can preserve the concept through a valid independent rule. Every modified rule is also covered by class/boundary tests in trainingRulePrecision.test.ts or the existing classifier suite. Product/family debt: 70 suppressions, including valid direct mechanisms whose family provenance is still inadequate; product-family-backlog.json records each case.

## H. Negative evidence

For the 836 original coherent negatives: {"NEGATIVE_EVIDENCE_PRESENT":792,"NEGATIVE_EVIDENCE_ABSENT":44,"NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE":0}. All 926 final negative records: {"NEGATIVE_EVIDENCE_PRESENT":876,"NEGATIVE_EVIDENCE_ABSENT":50}. Counts are recalculated, never forced to 792/44. Negative-with-assignments: 0. No fabricated evidence; absence does not become positive admission evidence. Both cohorts have per-product source links in negative-evidence-audit.json.

## I. Discovery delta

| Snapshot | Exercise strict active | Function strict active |
| --- | --- | --- |
| P2.3B archived | 89 | 93 |
| Rejected P2.3C | 101 | 126 |
| Corrected candidate | 100 | 71 |


Exact added/removed IDs and raw Query/Discovery results: discovery-delta.json. Each admitted addition is checked for a surviving assignment, SEMANTIC_COMPLETE and unchanged admission criteria. Historical assignments reevaluated using the new source rules give 89/65; reevaluated-baseline.json separates that comparison from archived 89/93. Source-driven CONDITIONAL applicability can change when a faulty rule no longer matches; declared obligations and contract bytes/hash stay unchanged.

## J. Consolidation / Unified delta

Archived active baseline: {"total":886,"knownObligations":256,"consolidation":{"UNKNOWN_OBLIGATIONS":563,"INVALID":51,"CONSOLIDATED":116,"REVIEW_REQUIRED":38,"BLOCKED_BY_CONFLICT":54,"PARTIALLY_CONSOLIDATED":62,"BLOCKED_BY_DATA":2},"certified":116,"exerciseDiscovery":89,"functionDiscovery":93,"unifiedRetrieval":{"REVIEW_REQUIRED":556,"BLOCKED":141,"ADMITTED":116,"PARTIAL":66,"NOT_APPLICABLE":7}}.

Corrected active candidate: {"total":886,"knownObligations":228,"consolidation":{"UNKNOWN_OBLIGATIONS":632,"CONSOLIDATED":95,"REVIEW_REQUIRED":38,"BLOCKED_BY_CONFLICT":60,"PARTIALLY_CONSOLIDATED":59,"BLOCKED_BY_DATA":2},"certified":95,"exerciseDiscovery":100,"functionDiscovery":71,"unifiedRetrieval":{"REVIEW_REQUIRED":625,"ADMITTED":95,"BLOCKED":96,"PARTIAL":63,"NOT_APPLICABLE":7}}.

Delta: {"certified":-21,"exerciseDiscovery":11,"functionDiscovery":-22,"unifiedAdmitted":-21,"knownObligations":-28}. Full populations and changed payloads: consolidation-delta.json. Trust artifacts are unchanged; whether source rules consume category/feature trust can change, as required by the existing conditional contract.

## K. Candidate identities

- Rules: 75718209edd239bd15ba03a65242adaf75863c6de630061198e2d12da87a6839.
- Policy: training-resolution-policy-p2.3c-fix-v1 / sha256:0f658cc7521f7501d6136ec8c4a005fd7341b6033cc1d3abd17b8ebaf12f8736.
- Builder: training-semantic-builder-p2.3c-fix-v1; codeRef sha256:7fdb4435838390692a7bc9c7341847d4da3deed2cb75d84b21b1559e3439621c.
- Snapshot: sha256:a6ab5971185ccfe1f47cff88ae6cd432068c3eecb4465e07c39643ff09cba546; semanticChecksum d33afc946a920f5eebb37b959c674fdf364682a95bfba3a0314df0dc32a75ce9.
- Snapshot contentHash: sha256:8160f3836f1965f2b69bafd00bdeab6b1f0cf39fdca0b489f9828d91e009dc96.
- Training wrapper contentHash: sha256:dd67292682d2125c85dca3f5a3c1255d6206f67731af1e3687748fe8a801f1db.
- Bundle: sha256:6c2e38000173ff7a7d225d1458640c2d2df0c9e611255c58795e677af903ad55.
- Bundle directory: cross-projection-audit/p2-3c-fix/candidate-bundle/6c2e38000173ff7a7d225d1458640c2d2df0c9e611255c58795e677af903ad55.

Rejected snapshot/bundle identities are not reused. Schema/hash/registry references/invariants/bundle validation PASS. Registry unchanged.

## L. Regression

Product Discovery: exact same 791 active IDs. Specs conflicts: exact same 82 IDs. Product Semantics, Training V1, Specs and Trust bundle bytes unchanged. 217 protected artifacts, stores, pointers and historical P2.3C files fingerprinted unchanged. P_NEW behavior: all 21 families unchanged, with no invented assignment. semantic-obligations-v2 remains sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94.

## M. Tests and reproducibility

Full suite: {"success":true,"currentCodeTested":true,"total":2655,"passed":2655,"failed":0,"contentHash":"sha256:7291f65ba028ccec1b12a1976ad92fb771f2a0457fa318579843d69a5a594114"}. Typecheck/lint: {"typecheck":true,"lint":true}.

Determinism: reversed source/context order yields identical snapshot and evidence; native builder yields identical content; snapshot and bundle identities validate. Tests run directly through Vitest, avoiding npm's snapshot-writing pretest. Historical candidate remains untouched. Gates: {"G1":"PASS","G2":"PASS","G3":"PASS","G4":"PASS","G5":"PASS","G6":"PASS","G7":"PASS","G8":"PASS","G9":"PASS","G10":"PASS","G11":"PASS","G12":"PASS","G13":"PASS","G14":"PASS","G15":"PASS","G16":"PASS"}.

Reproduce: node --import tsx cross-projection-audit/training-rule-precision-audit.mjs. Use the same --source-dir/--bundle-dir options as the previous audit. Run the full suite with --reporter=json --outputFile=cross-projection-audit/p2-3c-fix/test-results.json first. All outputs are generated from source.

Repository hygiene: 32 candidate tracked files, 380439 content bytes (includes prior authorized uncommitted P2.3C work). Generated JSON/CSV/snapshot/bundle evidence ignored. No commit or index mutation. Exact inventory: repository-hygiene.json; protected bundle byte comparisons: candidate-comparison.json.

## N. Remaining human review

1 remaining ambiguous source cases: P435: Body Pump bundle rack role remains unspecified; no automatic BARBELL_SUPPORT. BARBELL_SUPPORT is absent from P435 and resolution is conservative. Final review must also inspect 103 newly exposed global semantic deltas and 2 new code/relation facts, grouped in remaining-human-review.json and the global rule matrix. The original 50 unequivocal cases are represented by gates, not repeated full fichas. Family remediation is a separate focused backlog; no Product changes were made.

## O. Production disposition

**READY_FOR_FINAL_CONTENT_REVIEW**. This is readiness for final content review only. No bundle activated, pointer published, deployment or commit performed.
