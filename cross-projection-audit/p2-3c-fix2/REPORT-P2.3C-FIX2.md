# P2.3C-FIX2 — Targeted Training Rule Correction & Closure Candidate

Fecha: 2026-10-07 (America/Santiago). Disposición única: **READY_FOR_PRODUCTION_ROLLOUT_REVIEW**.

Candidate nuevo, offline, reconstruido desde fuente congelada para los 2048 productos. P2.3C-FIX se preservó completo e intacto. No hubo activación, publicación de pointer, despliegue, PM2 restart ni commit; no se avanzó a P2.3D. No hay nueva ontology/capability, proyección, Product Functional Role ni overrides por IDs.

## A. Root cause

El matcher nominal de cable no distinguía tobillera compatible de mecanismo propio. El token rack no exigía discriminación de soporte abierto de barra. Un veto de cable en contexto accessory, seguido por V1_ACCESSORY_NAME, convertía falta de positiva en prueba de negativa, incluso para módulos plausibles. La corrección permanece local en reglas V2, coverage V2 y reconciliación; Training V1 conserva su comportamiento y proyección.

## B. Rule changes

| dominio | before | after |
| --- | --- | --- |
| Passive cable | Tobillera no figuraba en el veto; polea producía DIRECT | Tipos vendidos tobillera/ankle/strap/handle/grip/rope/bar/seat/pad vetan herencia de cable, incluso con feature del host |
| Seat versus seated module | Cualquier asiento en nombre implicaba pieza pasiva | Asiento para polea es pasivo; polea con asiento puede ser módulo y requiere prueba propia. Un agarre para un host con asiento sigue pasivo |
| Barbell rack | Rack era suficiente en nombres no vetados | Nombre propio discriminante, categoría fuerte discriminante o feature propia explícita de soporte/carga de barra. Storage/host guards prevalecen |
| Accessory negative | Coverage V1 de accesorio podía certificar negativa V2 | Módulo cable accesorio sin mecanismo explícito: INSUFFICIENT_EVIDENCE → DATA_GAP; V1_ACCESSORY_NAME no es prueba negativa V2 suficiente |
| Passive negative | V1 no tenía branch para tobillera sin más evidence | V2_PASSIVE_CABLE_ATTACHMENT reproducible si parte pasiva, sin facts ni reviews; negativos pasivos V1 ya sustentados se conservan |
| Publication invariant | Negativa de módulo plausible podía pasar | TRAINING_UNPROVEN_CABLE_NEGATIVE rechaza VERIFIED de módulo cable unresolved con source |
| Identity/history | Una identidad vigente y una histórica A00 | Nueva policy/builder/rules/snapshot/bundle; FIX anterior sigue legible sólo con validación canónica de identidad |


No existe prueba positiva nueva basada en carga > 0 o altura > X. Para un módulo accesorio no pasivo, una feature SEMANTIC explícita de mecanismo (Relación de cable y polea, fuera de Material/composición) sigue siendo suficiente. Material o compatibilidad no bastan. Los nombres/categorías de estaciones reales ya aceptados permanecen bajo los guards existentes; CABLE_MACHINE lexical circular no habilita FAMILY_DERIVED.

Polea Alta Remo + carga propia + manga + estructura, sin evidencia explícita de mecanismo, permanece unresolved; esa combinación no certifica una negativa ni emite nueva positiva en FIX2. Dimensión o carga aislada tampoco. P247 utiliza la salida conservadora permitida, sin hacer una heurística adicional. Criterio exacto y combinaciones abiertas: docs/catalog-v2/P2_3C_FIX2_TARGETED_TRAINING_CLOSURE.md; tests genéricos: trainingRulePrecision.test.ts.

## C. Five targeted products

| productId | producto | before facts | after facts | before resolution | after resolution | negativeEvidenceState | classifier coverage | evidence | disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1020 | TOBILLERA PARA POLEA LONA | CABLE_RESISTANCE/DIRECT | [] | SEMANTIC_COMPLETE | VERIFIED_NO_APPLICABLE_CAPABILITY | NEGATIVE_EVIDENCE_PRESENT | NO_CAPABILITY_APPLICABLE | TOBILLERA PARA POLEA LONA | PASS |
| 1856 | Rack Multifuncional Pull Up / Dip Bar / Rising | BARBELL_SUPPORT/DIRECT, BODYWEIGHT_SUPPORT/DIRECT, DIP/DIRECT, PULL_UP/DIRECT | BODYWEIGHT_SUPPORT/DIRECT, DIP/DIRECT, PULL_UP/DIRECT | SEMANTIC_COMPLETE | SEMANTIC_COMPLETE | NOT_REQUIRED | UNMODELED | Rack Multifuncional Pull Up / Dip Bar / Rising; Máquinas Home Gym [SEMANTIC_STRONG]; Barras Pull Up & Push Up [SEMANTIC_STRONG]; Barras de Dominadas [SEMANTIC_STRONG]; Barras Paralelas [SEMANTIC_STRONG]; Clasificación de Uso: USO REGULAR - HOGAR; Peso Neto (N.W.): CAJA 1: 20.4 kg.; Peso Neto (N.W.): CAJA 2: 16.8 kg.; Peso Bruto (G.W.): CAJA 1: 24 kg.; Peso Bruto (G.W.): CAJA 2: 19.1 kg.; Peso máximo de usuario: 120 kg.; Dimensiones del producto armado: Largo: 103 cm. Ancho: 110,5 cm. Alto: 204 cm.; Dimensiones del Empaque: CAJA 1. Largo: 113 cm. Ancho: 63 cm. Alto: 11 cm.; Dimensiones del Empaque: CAJA 2. Largo: 102 cm. Ancho: 61.5 cm. Alto: 10.5 cm.; Perfiles: Redondeado 38*2 mm.; Diámetro de agarre: 38 mm.; Material: Madera, Acero.; Marca: RISING FIT | PASS |
| 247 | Polea Alta Remo (Accesorio Jaula Hell - MJHWM2) / HWM | [] | [] | VERIFIED_NO_APPLICABLE_CAPABILITY | DATA_GAP | NOT_REQUIRED | INSUFFICIENT_EVIDENCE | Polea Alta Remo (Accesorio Jaula Hell - MJHWM2) / HWM; Categoría: Olímpico; Peso Neto (N.W.): 18.8 kg.; Peso Bruto (G.W.): 20.5 kg.; Peso máximo de carga: 80 kg.; Dimensiones del producto armado: Largo: 93 cm. Ancho: 85 cm. (profundidad) Alto: 213 cm.; Dimensiones del Empaque: CAJA 1 Largo: 90 cm. Ancho: 40 cm. Alto: 15 cm. CAJA 2 Largo: 176 cm. Ancho: 6 cm. Alto: 3 cm.; Espesor de material: 2 mm.; Estructura: Acero; Diámetro de manga: Ø50 mm; Marca: HWM | PASS |
| 897 | ACCESORIO POLEA CON ASIENTO HWM171 | [] | [] | VERIFIED_NO_APPLICABLE_CAPABILITY | DATA_GAP | NOT_REQUIRED | INSUFFICIENT_EVIDENCE | ACCESORIO POLEA CON ASIENTO HWM171 | PASS |
| 1624 | Accesorio Polea Alta Remo Jaula Hell / HWM / 2da Selección | [] | [] | VERIFIED_NO_APPLICABLE_CAPABILITY | DATA_GAP | NOT_REQUIRED | INSUFFICIENT_EVIDENCE | Accesorio Polea Alta Remo Jaula Hell / HWM / 2da Selección | PASS |


P1020: parte pasiva; negative rule V2_PASSIVE_CABLE_ATTACHMENT, source-bound y policy actual, scope MODELED_SNAPSHOT_COVERAGE. P1856 mantiene PULL_UP, DIP y BODYWEIGHT_SUPPORT; elimina sólo soporte de barra. P247/P897/P1624: DATA_GAP, assignments=[], resolved=false, negativeEvidenceState=NOT_REQUIRED porque son unresolved, sin CLASSIFIER_NEGATIVE_RULE. Sus señales propias o evidencia escasa quedan representadas; no se restituye automáticamente cable ni soporte del host. NOT_REQUIRED no significa que exista evidencia negativa.

## D. New global deltas

| unidad | conteo |
| --- | --- |
| totalRecords | 2048 |
| totalChangedProducts | 1233 |
| semanticChangedProducts | 5 |
| changedAssignments | 2 |
| changedCodeRelationFacts | 2 |
| changedRelations | 0 |
| changedResolutionStates | 4 |
| changedNegativeEvidence | 877 |
| changedAdmission | 5 |
| changedActiveAdmission | 1 |


Hay 5 productos con cambios de facts/resolution: los cinco targets; productos adicionales con deltas semánticos = 0. Todos los deltas semánticos se revisaron en C. 1228 productos adicionales cambian sólo evidencia de reconciliación/policy; la identidad contractual nueva obliga a renovar policyHash en sus notas. No son nuevos assignments ni readjudicación de los 100 deltas aprobados. Lista completa de IDs de esos cambios de evidencia: global-delta.json/evidenceOnlyProductIds; antes/después semántico/source: global-delta.json/semanticDeltas.

changedAssignments cuenta productos con arrays de assignments distintos; changedCodeRelationFacts cuenta conjuntos code/relation distintos; changedRelations cuenta cambios de relación para un código conservado (0). changedNegativeEvidence incluye la renovación física de notas y salida/entrada al estado negativo. Los estados de evidencia negativa cambian semánticamente sólo para P1020 y P247/P897/P1624; los 874 negativos PRESENT renuevan el policyHash. changedAdmission incluye todos los productos; sólo uno está activo (P1856), conservando sus decisiones admitidas por facts corporales.

## E. Cable semantics

Passive suppressed: P1020 sin CABLE_RESISTANCE; partes vendidas agarre/soga/strap/bar/seat/pad no heredan mecanismo, incluyendo un host con asiento o una feature ratio del host. Mechanical preserved: P1124, P1811, P1812, P1813, P1999, P2006, P2008, P2134, P899, P1365 conservan CABLE_RESISTANCE/DIRECT; P899/P1365 preservan su relación DIRECT por 1:1. Ambiguous unresolved: P247/P897/P1624 ya no se certifican negativos. Product family suppressions siguen evitando derivación circular, sin convertirse en deuda Product para ocultar bugs Training.

## F. Barbell support semantics

Bodyweight-only rack suppressed: P1856; otras capabilities propias intactas. Storage/host/installation siguen sin soporte. 59 verdaderos soportes de la matriz anterior permanecen: P179, P251, P252, P276, P341, P342, P346, P390, P391, P392, P393, P477, P517, P540, P593, P594, P595, P744, P746, P760, P761, P887, P952, P971, P972, P975, P980, P1057, P1063, P1078, P1080, P1121, P1512, P1535, P1536, P1537, P1538, P1539, P1540, P1541, P1543, P1544, P1545, P1546, P1547, P1604, P1640, P1644, P1694, P1697, P1707, P2058, P2063, P2104, P2109, P2161, P2190, P2196, P2332. P435 AMBIGUOUS y P930 DATA_GAP se preservan, sin BARBELL_SUPPORT y fuera de Discovery función/Unified ADMITTED. SQUAT genérico no vuelve a ONTOLOGY_GAP. No se reclama exhaustividad lingüística universal.

## G. Negative evidence

| estado | P2.3C-FIX | P2.3C-FIX2 |
| --- | --- | --- |
| NEGATIVE_EVIDENCE_PRESENT | 876 | 874 |
| NEGATIVE_EVIDENCE_ABSENT | 50 | 50 |
| NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE | 0 | 0 |


Negativos finales: 926 → 924; PRESENT 876 → 874 (tres módulos dejan negativa; tobillera agrega una prueba pasiva reproducible). ABSENT=50 visible, no convertido en proof desde el estado histórico. Los 23 negativos del cohort original mantienen su disposición, incluidos 17 sustentados y seis con deuda ABSENT. negative-with-assignments=0 en los 2048. Notas/source IDs actuales recalculados desde source; no se usa el snapshot anterior como prueba negativa. El snapshot previo es comparador, no entrada para parchear facts.

## H. Discovery

| referencia | Exercise | Function |
| --- | --- | --- |
| Archived P2.3B | 89 | 93 |
| P2.3B reevaluated under corrected P2.3C-FIX rules | 89 | 65 |
| P2.3C-FIX | 100 | 71 |
| P2.3C-FIX2 | 100 | 71 |


| eje | before | after | added IDs | removed IDs | reason |
| --- | --- | --- | --- | --- | --- |
| exercise | 100 | 100 | [] | [] | Se eliminan falsos facts o exceso de certeza en históricos/no activos; P1856 mantiene admisión por función corporal válida |
| function | 71 | 71 | [] | [] | Se eliminan falsos facts o exceso de certeza en históricos/no activos; P1856 mantiene admisión por función corporal válida |


La comparación de calidad no persigue archived 89/93. Admission y Query/Unified runtime se ejecutaron con los contratos existentes, lectores en bloques de 100 sin truncamiento; ningún admitted ID queda fuera de runtime Discovery.

## I. Consolidation / Unified

| métrica activa | P2.3C-FIX | P2.3C-FIX2 |
| --- | --- | --- |
| total | 886 | 886 |
| knownObligations | 228 | 228 |
| exerciseDiscovery | 100 | 100 |
| functionDiscovery | 71 | 71 |
| certified | 95 | 95 |


| estado consolidation | before | after |
| --- | --- | --- |
| UNKNOWN_OBLIGATIONS | 632 | 632 |
| CONSOLIDATED | 95 | 95 |
| REVIEW_REQUIRED | 38 | 38 |
| BLOCKED_BY_CONFLICT | 60 | 60 |
| PARTIALLY_CONSOLIDATED | 59 | 59 |
| BLOCKED_BY_DATA | 2 | 2 |


| Unified Retrieval | before | after |
| --- | --- | --- |
| REVIEW_REQUIRED | 625 | 625 |
| ADMITTED | 95 | 95 |
| BLOCKED | 96 | 96 |
| PARTIAL | 63 | 63 |
| NOT_APPLICABLE | 7 | 7 |


Los conjuntos de 21 certification removals y 28 known-obligation removals contra archived P2.3B son exactamente los aceptados, no sólo el mismo conteo: certification P394, P395, P396, P419, P608, P774, P1001, P1177, P1195, P1196, P1492, P1493, P2009, P2014, P2015, P2083, P2095, P2097, P2098, P2099, P2100; known obligations P389, P394, P395, P396, P417, P419, P479, P608, P774, P1001, P1177, P1194, P1195, P1196, P1492, P1493, P1510, P1919, P2009, P2014, P2015, P2083, P2095, P2096, P2097, P2098, P2099, P2100. No se reabrió su adjudicación. Evaluaciones fuente/negativeEvidence actualizadas: admission-delta.json.

## J. Candidate identities

| identidad | P2.3C-FIX2 |
| --- | --- |
| rulesHash | d143736268bff53900de4ceaa7b50b76061fcc73d0b6d44e2a4a645f5834b8a8 |
| policy version | training-resolution-policy-p2.3c-fix2-v1 |
| policy hash | sha256:c258f5db606d48f6e62399c5ab3b551c8650309aa2e8d01ac23431adbc99fa03 |
| builder | training-semantic-builder-p2.3c-fix2-v1 |
| codeRef | sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac |
| snapshotId | sha256:acf4434ad02dd09c11708111e86b78732f37ffd2647a2ffc98e8e5202196b202 |
| snapshot contentHash (bytes del archivo) | sha256:8b71a46a61012d3ff9e63438360d8dd1757f26638c4a92eb9c58a831d1e5f74a |
| training wrapper contentHash | sha256:711c85a82b285fd7d182249e02b3cc654935e4563dd78674a43eccda02b74853 |
| bundleId | sha256:2f51d0c80a75e331232537c4bf97ffe59c40aef3db4738daeb4b5bcf3d524329 |
| candidate directory | cross-projection-audit\p2-3c-fix2\candidate-bundle\2f51d0c80a75e331232537c4bf97ffe59c40aef3db4738daeb4b5bcf3d524329 |
| ontology registry unchanged | 7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8 |


Ningún hash de identidad anterior se reutiliza para Training candidato. Las proyecciones protegidas sí conservan sus hashes porque sus bytes permanecen idénticos. El contenido se generó desde frozen source → classifier → assignments → reconciliation → evidence → snapshot → native wrapper → nuevo bundle; no se editaron generated JSON para fijar productos. Native/audit finalizers y rebuild con source/context invertidos dan snapshot/evaluaciones idénticos.

## K. Global residual sweep

Población: 2048. Cada búsqueda utiliza nombre, family, features y facts del producto vendido, con predicates de auditoría independientes de las funciones de veto del classifier. No se limita a confirmar que el classifier se reproduzca. Los nuevos deltas son sólo los cinco targets; los 100 deltas previos sin cambios no se readjudican.

| clase conocida | observed residuals |
| --- | --- |
| passive pulley attachment -> CABLE_RESISTANCE | 0 |
| bodyweight-only rack -> BARBELL_SUPPORT | 0 |
| storage rack -> BARBELL_SUPPORT | 0 |
| host rack/jaula -> BARBELL_SUPPORT | 0 |
| mechanical cable module -> verified negative | 0 |
| ambiguous cable accessory/module -> unsupported verified negative | 0 |


**observed equivalent residual defects = 0**. Esto certifica ausencia observada en las clases conocidas y deltas revisados, no perfección para cualquier lenguaje o producto futuro.

## L. Regression / gates

| gate | resultado | evidencia |
| --- | --- | --- |
| G1 | PASS | 300 fingerprints históricos/protegidos; candidate FIX completo intacto |
| G2 | PASS | Sin product-ID predicates en reglas/coverage/reconciliación de producción; IDs sólo audit/tests |
| G3 | PASS | P1020 sin CABLE_RESISTANCE |
| G4 | PASS | P1856 sin BARBELL_SUPPORT; facts corporales intactos |
| G5 | PASS | P247 DATA_GAP |
| G6 | PASS | P897 DATA_GAP |
| G7 | PASS | P1624 DATA_GAP |
| G8 | PASS | 10 fixtures de módulos con DIRECT preservados |
| G9 | PASS | 59 soportes propios aprobados preservados |
| G10 | PASS | 23 negativos originales y clases pasivas sustentadas preservados |
| G11 | PASS | Seis búsquedas corpus; cero residuales observados |
| G12 | PASS | negative-with-assignments=0 |
| G13 | PASS | Product Discovery exact same 791 active IDs |
| G14 | PASS | Specs conflicts exact same 82 IDs |
| G15 | PASS | Product/Training V1/Specs/Trust proyecciones byte a byte idénticas |
| G16 | PASS | semantic-obligations-v2 hash 125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94; requisitos declarados idénticos |
| G17 | PASS | P_NEW exact same 21 familias, sin nuevos facts, UNKNOWN preservado |
| G18 | PASS | Schema/hash/registry/invariants/bundle y rebuild determinista PASS |
| G19 | PASS | Focused/full/typecheck/lint PASS sobre código final |
| G20 | PASS | Generated JSON/bundles/test dumps ignored; source/tests/docs/script/report reviewable; sin commit |


Además: 18 original approvals y 26 original invalid removals conservados; seis false ONTOLOGY_GAP siguen corregidos; 100 external deltas aprobados sin ningún nuevo cambio semántico (0 reabiertos). Product y SPECS evaluated dimensions idénticas; TRUST normalized resolution idéntica. Condiciones Trust dependientes de consumo source pueden cambiar de forma legítima sin alterar trustMaps ni autoridad Trust; esto se separa del contrato y la proyección protegidos.

## M. Tests

| verificación | resultado |
| --- | --- |
| focused tests | 181/181 PASS; cuatro archivos |
| full suite | 2680/2680 PASS; 0 fallos; 418 suites |
| typecheck | PASS (exit 0) |
| lint | PASS (exit 0) |
| freshness | PASS; tests/checks posteriores al último cambio TypeScript |
| snapshot / bundle | PASS |
| deterministic rebuild | PASS |


Comandos ejecutados directamente (sin pretest que reconstruya datos/pointers protegidos):

```text
node node_modules/vitest/vitest.mjs run tests/unit/trainingRulePrecision.test.ts tests/unit/trainingSemanticReconciliation.test.ts tests/unit/catalog-admission-v2.test.ts tests/unit/training-semantic-classifier-v2.test.ts --reporter=json --outputFile=cross-projection-audit/p2-3c-fix2/focused-tests.json
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=json --outputFile=cross-projection-audit/p2-3c-fix2/test-results.json
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js . --ext .ts
node --import tsx cross-projection-audit/training-targeted-closure-audit.mjs
```

Los tests de clase incluyen pasivos con ratio del anfitrión, módulo cargable sin ratio, accessory cable sparse no negativo, mecanismo explícito 1:1 permitido, rack corporal y verdaderos racks, storage/host y validación de negativa no probada. No se añadieron tests espejo de los cinco IDs a producción.

## N. Repository hygiene

candidate tracked/reviewable file count = **35**.
candidate tracked/reviewable content bytes = **464826**.

Esta superficie acumulada incluye cambios que ya estaban presentes antes de FIX2, todos sin commit; “tracked/reviewable” agrupa tracked modificados y archivos nuevos no ignorados. El tamaño cuenta su contenido completo, incluido este informe. Generated JSON, CSV diagnostics, snapshots, bundles y test dumps se mantienen ignored/local; repository-hygiene.json enumera superficie y hashes/fingerprints verificables. .gitignore permite explícitamente sólo el reporte FIX2 dentro del directorio generado. No se staged ni committed nada.

```text
git status --short
M .gitignore
 M cross-projection-audit/README.md
 M scripts/catalog-v2/audit-training-semantics-v2-authority.ts
 M scripts/catalog-v2/build-projection-bundle.ts
 M scripts/catalog-v2/build-training-semantics-v2.ts
 M scripts/training-semantic-classification-v2/classify-catalog.ts
 M scripts/training-semantic-classification/lib/load-input.ts
 M src/domain/catalog-admission/applicability-v2.ts
 M src/domain/catalog/projection-bundle.ts
 M src/domain/catalog/training-semantics-v2-projection.ts
 M src/domain/training-semantic-classification-v2/classifier.ts
 M src/domain/training-semantic-classification-v2/rules.ts
 M src/domain/training-semantic-classification/classifier.ts
 M src/domain/training-semantic-classification/contracts.ts
 M src/domain/training-semantic-snapshot/index.ts
 M src/domain/training-semantic-snapshot/v2Runtime.ts
 M src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts
 M src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.ts
 M tests/unit/catalog-admission-v2.test.ts
 M tests/unit/training-semantic-classifier-v2.test.ts
 M tests/unit/trainingV2AuthorityParity.test.ts
?? cross-projection-audit/p2-3c-fix/
?? cross-projection-audit/p2-3c/
?? cross-projection-audit/training-reconciliation-audit.mjs
?? cross-projection-audit/training-rule-precision-audit.mjs
?? cross-projection-audit/training-targeted-closure-audit.mjs
?? docs/catalog-v2/P2_3C_FIX2_TARGETED_TRAINING_CLOSURE.md
?? docs/catalog-v2/P2_3C_FIX_TRAINING_RULE_PRECISION.md
?? docs/catalog-v2/P2_3C_TRAINING_SEMANTIC_RECONCILIATION.md
?? src/domain/training-semantic-snapshot/reconcileResolution.ts
?? src/domain/training-semantic-snapshot/resolutionPolicy.ts
?? src/domain/training-semantic-snapshot/semanticInvariants.ts
?? tests/unit/trainingRulePrecision.test.ts
?? tests/unit/trainingSemanticReconciliation.test.ts
```

```text
git diff --stat
.gitignore                                         |   9 ++
 cross-projection-audit/README.md                   |  10 ++
 .../audit-training-semantics-v2-authority.ts       |  35 ++----
 scripts/catalog-v2/build-projection-bundle.ts      |  17 ++-
 scripts/catalog-v2/build-training-semantics-v2.ts  |  31 ++++-
 .../classify-catalog.ts                            |   6 +-
 .../lib/load-input.ts                              |   1 +
 src/domain/catalog-admission/applicability-v2.ts   |   1 +
 src/domain/catalog/projection-bundle.ts            |  31 ++++-
 .../catalog/training-semantics-v2-projection.ts    |   5 +-
 .../classifier.ts                                  |   8 +-
 .../training-semantic-classification-v2/rules.ts   | 138 ++++++++++++++++++---
 .../training-semantic-classification/classifier.ts |  14 +++
 .../training-semantic-classification/contracts.ts  |   2 +
 src/domain/training-semantic-snapshot/index.ts     |   3 +
 src/domain/training-semantic-snapshot/v2Runtime.ts |   3 +-
 .../v2SnapshotBuilder.ts                           |  22 +++-
 .../fileTrainingSemanticSnapshotV2Store.ts         |   3 +
 tests/unit/catalog-admission-v2.test.ts            |   6 +
 tests/unit/training-semantic-classifier-v2.test.ts |   6 +-
 tests/unit/trainingV2AuthorityParity.test.ts       |  10 +-
 21 files changed, 289 insertions(+), 72 deletions(-)
```

Archivos revisables:

- .gitignore
- cross-projection-audit/README.md
- cross-projection-audit/p2-3c-fix/REPORT-P2.3C-FIX.md
- cross-projection-audit/p2-3c-fix2/REPORT-P2.3C-FIX2.md
- cross-projection-audit/p2-3c/REPORT-P2.3C.md
- cross-projection-audit/training-reconciliation-audit.mjs
- cross-projection-audit/training-rule-precision-audit.mjs
- cross-projection-audit/training-targeted-closure-audit.mjs
- docs/catalog-v2/P2_3C_FIX2_TARGETED_TRAINING_CLOSURE.md
- docs/catalog-v2/P2_3C_FIX_TRAINING_RULE_PRECISION.md
- docs/catalog-v2/P2_3C_TRAINING_SEMANTIC_RECONCILIATION.md
- scripts/catalog-v2/audit-training-semantics-v2-authority.ts
- scripts/catalog-v2/build-projection-bundle.ts
- scripts/catalog-v2/build-training-semantics-v2.ts
- scripts/training-semantic-classification-v2/classify-catalog.ts
- scripts/training-semantic-classification/lib/load-input.ts
- src/domain/catalog-admission/applicability-v2.ts
- src/domain/catalog/projection-bundle.ts
- src/domain/catalog/training-semantics-v2-projection.ts
- src/domain/training-semantic-classification-v2/classifier.ts
- src/domain/training-semantic-classification-v2/rules.ts
- src/domain/training-semantic-classification/classifier.ts
- src/domain/training-semantic-classification/contracts.ts
- src/domain/training-semantic-snapshot/index.ts
- src/domain/training-semantic-snapshot/reconcileResolution.ts
- src/domain/training-semantic-snapshot/resolutionPolicy.ts
- src/domain/training-semantic-snapshot/semanticInvariants.ts
- src/domain/training-semantic-snapshot/v2Runtime.ts
- src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts
- src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.ts
- tests/unit/catalog-admission-v2.test.ts
- tests/unit/training-semantic-classifier-v2.test.ts
- tests/unit/trainingRulePrecision.test.ts
- tests/unit/trainingSemanticReconciliation.test.ts
- tests/unit/trainingV2AuthorityParity.test.ts

## O. Final disposition

**READY_FOR_PRODUCTION_ROLLOUT_REVIEW**.

Los cinco defects quedan corregidos por clases source-backed; no se observaron equivalentes restantes, los 100 deltas antes aprobados no cambian y las regresiones protegidas pasan. P247/P897/P1624 permanecen DATA_GAP honestos; no bloquean por sí solos al conservar incertidumbre y no inventar capability. Candidate completo y nueva identidad disponibles localmente para la revisión de rollout. No se activó ni desplegó. No avanzar a P2.3D en esta fase.
