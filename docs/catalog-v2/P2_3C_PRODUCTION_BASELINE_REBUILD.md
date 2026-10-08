# P2.3C-PRB — Production Baseline Rebuild & Candidate Validation

Fecha: 2026-10-08, America/Santiago. Candidate offline construido por el builder nativo, sin activar ni modificar producción.

## A. Fuente productiva verificada

Se verificaron los cinco archivos físicos de la copia descargada en la revisión anterior, en `C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/production-baseline/2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26`. No fue necesaria recuperación desde EC2 ni nueva extracción. Observación fuente: 2026-10-01T22:15:08.158Z; no demuestra estado live de hoy. Se validaron canonical serialization, recordCounts, manifiesto, hashes físicos y aggregateContentHash con validateManifest.

| Campo | Identidad verificada |
| --- | --- |
| aggregateContentHash | sha256:2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26 |
| sourceExtractionId / canonicalInputHash | sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9 |
| compatibilityCsv | sha256:e4f83e5513803e714089a2ad9f7590ffaea1f0b4373203cefc0559054fb7a442 |
| categoryTrustMap | sha256:01ac8a64b5aa20975d0e781eda618890bb7604219963eaf81ffaaed00db278fd |
| featureTrustMap | sha256:88bde84b077f86d21c04b419885f11cfb15c9f1a7ecf082942ef88d7e5dfd2c8 |
| manifest físico | sha256:e25120e2c5dd519707dfe8f16012fd5000073492caca76227119ffd5008b7a6b |
| bundle productivo | sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8 |
| manifest productivo físico | sha256:c1605f9e311fe0ee79164d1c849a93dd1f64e3a5eca172098d4d4015667bd8b6 |

Producción física: `C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/production-baseline/84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8`. validateBundle sobre esos bytes y su fuente productiva: PASS. Evidencia completa: `artifacts/catalog-v2/p2-3c-prb/preflight.json`.

## B. Identidad de implementación FIX2

| Campo | Valor |
| --- | --- |
| commit exacto bajo revisión | 3c1e9c4a17469e9beac4c8cb242aac820635d817 |
| rulesHash | d143736268bff53900de4ceaa7b50b76061fcc73d0b6d44e2a4a645f5834b8a8 |
| policy | training-resolution-policy-p2.3c-fix2-v1 |
| policyHash | sha256:c258f5db606d48f6e62399c5ab3b551c8650309aa2e8d01ac23431adbc99fa03 |
| builder | training-semantic-builder-p2.3c-fix2-v1 |
| registryHash | 7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8 |
| codeRef FIX2 conservado | sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac |
| semantic-obligations-v2 | sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94 |

No se cambió implementación semántica, ontología, overrides ni policy. `code-content.json` recalcula el inventario TypeScript de src/scripts y package-lock, reproduciendo el codeRef FIX2 original. El builder nativo ordena también package-lock junto a las rutas y obtiene sha256:c2692b26ebf2c98d48b12a0ccc54238767964131907c10c8720a10ebec9f474c; el auditor FIX2 ordenaba TypeScript y agregaba package-lock al final. Se conserva legítimamente el codeRef original mediante el parámetro existente --code-ref, respaldado por contenido idéntico. No se modifica un manifest para fijar identidad. Las dos primeras pruebas nativas quedan como diagnósticos en build-1/build-2; no son el candidate final.

## C. Candidate nuevo y hashes

Directorio final: `artifacts/catalog-v2/p2-3c-prb/candidate-1/bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f`.

| Identidad | Valor |
| --- | --- |
| bundleId | sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f |
| Training V2 snapshotId interno | sha256:10cd9a355399eee0d761baacde062d4d74d64aa4e5c326e1337be673795c90c6 |
| snapshot contentHash, serialización canónica | sha256:65c2f88aba9d309276a543231a67005108fc3af4b2e61a9a4a92b9cc2b012883 |
| Training V2 projectionId del wrapper | sha256:b315f13b1b63001ef5bfe4d4ff2b8f947748cede781b53cbc084c5fe2a009b77 |
| Training V2 wrapper contentHash físico | sha256:28f4b01fe50f9e9f61bee2e69e560b93e7f8211ec092ba2cbd8d6ecb1229e7db |
| manifest físico final | sha256:6b5fc8aec02583c46f24e84921917ff1d878e83978459e0dc6b8fe5c243cf850 |
| sourceV1SnapshotId | sha256:414441d0939fcec5aac07dd377b6409d9b283cca6cc5be9a19cd0d1815c906c3 |

Construcción completa desde frozen source: Product → V1 → V2 FIX2 + Specs + Trust → publicación local inmutable. Sin copiar proyecciones entre bundles ni editar JSON generado. La segunda construcción independiente está en `artifacts/catalog-v2/p2-3c-prb/candidate-2/bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f`.

## D. Matriz de proyecciones vs producción

| Proyección | Records | Hash físico idéntico a producción | Diff canónico exacto |
| --- | --- | --- | --- |
| productSemantics | 2048 | sha256:1c665a75468dfb520133973c7371b0a9bc0597282586480c48d89144df22c465 | [] |
| trainingSemantics | 2048 | sha256:a53ddeb2ea2650dd2bf0fd4cdf8e74665f2c7b0a83538068426a941ea6ab3e45 | [] |
| specs | 3163 | sha256:f0a1d85409758fb652bb371f0400d12f9ac1c9c9ee4f3b9d05bc529323e8cee2 | [] |
| trustMaps | 2 | sha256:3c7c2a7f35bec8ffe001e80ab09069e5d408176580c6583ec6886cd8807fc437 | [] |

Comparación completa de bytes y objetos, incluyendo todos los registros, facts, resolución, estados, source references, normalized/raw values y provenance. Product y V1: 2048 records idénticos cada uno. Specs: 3163 records idénticos, 1200 productos; 2599 parsed, 512 ambiguous, 52 unsupported. Mismos 82 conflict product IDs exactos. Trust: mismos maps, hashes, autoridad y configuración de consumo; no hay sustituciones justificadas sólo por counts. `protected-projections.json` conserva hashes y diff vacío por proyección.

## E. Specs provenance

| Producto | Feature | ID anterior FIX2 | featureValueId productivo preservado |
| --- | --- | --- | --- |
| P269 | 12 | 231123 | 241622 |
| P269 | 11 | 231122 | 241621 |
| P269 | 3 | 231121 | 241620 |
| P1839 | 3 | 212768 | 241675 |
| P1840 | 3 | 217555 | 241691 |
| P1853 | 11 | 217836 | 241663 |
| P1853 | 3 | 217832 | 241659 |
| P2132 | 3 | 222211 | 241639 |

Cada ID productivo se comprueba tanto en la extracción como en el record Specs reconstruido. Las otras 58 referencias cambiadas corresponden a features fuera de estas Specs normalizadas: mismo featureId/name/value, sin cambio semántico Training. `specs-provenance.json` contiene cada par, records completos y los 82 IDs conflictivos. `delta-details.json/nonSpecsInterpretation` adjudica las 58 referencias. Admission B→C cambia sólo referencias fuente Specs para IDs P269, P1839, P1840, P1853, P2132; ningún estado, valor o decisión cambia.

## F. Training V2 semantic deltas

A = producción 84c85d15…; B = FIX2 original 2f51d0c8… sobre fuente local; C = candidate final sobre fuente productiva.

| Comparación | Records físicos cambiados | Cambios semánticos | Evidencia | Metadata |
| --- | --- | --- | --- | --- |
| A→C | 1250 | 156 | 1093 | 1 |
| B→C | 124 | 0 | 124 | 0 |

B→C: diff exacto de los 124 records limitado a `/resolutionEvidence/*/sourceId`. Todos los assignments completos, evidence de assignments, relation types, confianza, reviewState, modifiers, provenance, coverageStatus, resolución, resolved y warnings permanecen iguales. Los hashes fuente se recalculan desde el input productivo; no se copian evidence IDs locales. Los otros 1924 records son físicamente idénticos. Se reevaluaron los 2048 y se verificaron invariantes source-bound, identidad de registry y reconciliation nativa/auditoría.

Los 193 productos con asociaciones de categorías distintas fueron adjudicados individualmente en `category-effects.json` y `delta-details.json/categoryAdjudication`, con categorías añadidas/retiradas y before/after. Ninguno cambia interpretación Training ni admission. También hay ocho cambios de revenue en fuente; no intervienen en esta semántica. No se infiere igualdad Training únicamente desde Product: se comparan sus records completos.

Se preservan exactamente los 154 IDs de mejoras semánticas y los 1095 IDs de mejoras de evidencia del informe previo. Al revisar su clasificación, P899 y P1365 tienen realmente CABLE_RESISTANCE FAMILY_DERIVED→DIRECT frente a producción, respaldado por feature 65, Relación de cable y polea: 1:1. Ya eran DIRECT en B y continúan DIRECT en C. El informe previo los clasificó como evidence-only. Por ello la partición correcta es 156 mejoras semánticas + 1093 de evidencia + un warning-only P1354 + 798 records intactos. `historicalClassComparison` y `reclassified` enumeran los dos IDs y sus diffs; ninguna mejora previa desaparece. Se mantiene el informe histórico intacto.

P1354: misma negativa modelada, sin assignments, coverageStatus UNMODELED y warning residual TRAINING_EVIDENCE_DOMAIN_SUPPRESSED:NAME_DEADLIFT_DEDICATED_V2. Sin prueba negativa nueva; continúa en la deuda de 50. No se borra ni se certifica más allá de la evidencia existente.

Targets: P1020 sin CABLE_RESISTANCE; P1856 sin BARBELL_SUPPORT y con BODYWEIGHT_SUPPORT/DIP/PULL_UP; P247/P897/P1624/P930 DATA_GAP sin positivos; P435 AMBIGUOUS. Preservados los diez mecanismos cable DIRECT y los 59 soportes propios aprobados. Negative-with-assignments=0; PRESENT=874, ABSENT=50, NOT_RECONSTRUCTABLE=0. Los 50 IDs ABSENT son exactamente los de B. Se repitieron seis barridos independientes de clases conocidas: cero residuales observados. Evidencias: training-deltas.json, reconciliation.json, targeted-products.json, negative-evidence.json, residual-sweep.json.

Clasificación completa: source-driven semantic change=0; rule-driven A→C=156; evidence-only A→C=1093 y B→C=124; metadata-only A→C=1; lineage-only en wrappers/identidades según sección I; unexpected regression=0 en corpus y clases revisadas. El scope no demuestra ausencia universal de errores futuros.

## G. Universe y source IDs

| Conjunto | Count | Hash del array JSON canónico de IDs numéricos ordenados |
| --- | --- | --- |
| canonical | 2048 | sha256:b3f0df7fed594ca5ef9478047a4a17d5fac51d07648a912f331794a248f206b1 |
| current | 1565 | sha256:55f1a726ec700886d1fbac380d430d44d281aa6202cfcaac2fa42c2290ee43e3 |
| historical | 483 | sha256:2055acdecb86c360405ca9fb8820d79bf4427ca9aed644f34ee88815a8841562 |
| active | 886 | sha256:72b830c5d4c27bd9ade88e320dd2f0a342d6f96283530d03b76682db1d18dcfa |
| inactive | 679 | sha256:49264b62a9821941918c5f245d4fafbed25e76fb0bc8fc3d262e1d0df6658dab |

Conjuntos exactos e hashes iguales entre fuentes productiva y local FIX2. `universes.json` conserva todos los IDs; active/inactive se refieren al current catalog. No se pierden los 483 históricos. Cambio sourceExtractionId local→productivo: sha256:3694b291c89d5f011904b44dc7fe51eb6f355da63d5bb25c485009fadd67d007 → sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9. 208 productos con alguna diferencia fuente, 193 con categorías y 66 referencias featureValueId; los deltas completos están en source-deltas.json.

## H. Admission y Discovery

Mismo contrato sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94 para A/B/C. A se reevalúa con el runtime corregido; no se compara con sus counts archivados usando otro código.

| Baseline | Scope | Total | Product | Exercise | Function | Specs | Known | Certified | ADMITTED | PARTIAL | BLOCKED | REVIEW_REQUIRED | NOT_APPLICABLE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | ALL | 2048 | 1289 | 164 | 148 | 809 | 360 | 181 | 181 | 85 | 168 | 1118 | 496 |
| A | CURRENT | 1565 | 1289 | 164 | 148 | 809 | 360 | 181 | 181 | 85 | 168 | 1118 | 13 |
| A | ACTIVE | 886 | 791 | 89 | 65 | 532 | 228 | 95 | 95 | 63 | 141 | 580 | 7 |
| B | ALL | 2048 | 1289 | 175 | 130 | 809 | 360 | 181 | 181 | 85 | 123 | 1163 | 496 |
| B | CURRENT | 1565 | 1289 | 175 | 130 | 809 | 360 | 181 | 181 | 85 | 123 | 1163 | 13 |
| B | ACTIVE | 886 | 791 | 100 | 71 | 532 | 228 | 95 | 95 | 63 | 96 | 625 | 7 |
| C | ALL | 2048 | 1289 | 175 | 130 | 809 | 360 | 181 | 181 | 85 | 123 | 1163 | 496 |
| C | CURRENT | 1565 | 1289 | 175 | 130 | 809 | 360 | 181 | 181 | 85 | 123 | 1163 | 13 |
| C | ACTIVE | 886 | 791 | 100 | 71 | 532 | 228 | 95 | 95 | 63 | 96 | 625 | 7 |

Product/Exercise/Function/Specs expresan IDs con decisión ADMITTED del evaluator; Certified usa CONSOLIDATED/CONSOLIDATED_WITH_NOT_APPLICABLE. B y C preservan exactamente todos los conjuntos de las siete métricas, todas las decisiones y counts Unified/consolidation en ALL/CURRENT/ACTIVE. `admission-summary.json` incluye IDs, `admission-rows.json` cada evaluación completa y `admission-deltas.json` todos los campos que cambiaron. El diff B→C contiene únicamente sourceReference Specs de los ocho pares indicados. Trust conserva maps y estados; su consumo no cambia por las categorías añadidas.

Training Query y Semantic Discovery reales recorridos en bloques de 100, sin truncamiento, preservan acceso a todos los admitted IDs activos. P435/P930 continúan fuera de Function Discovery. `runtime-discovery.json` registra conjuntos reales de Query/Discovery. P_NEW conserva las 21 familias y UNKNOWN aplicables, sin facts nuevos ni cambio de decisiones; new-products.json.

## I. Compatibilidad de lineage/policy

sourceExtractionId=canonicalInputHash=sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9; compatibilityCsv=sha256:e4f83e5513803e714089a2ad9f7590ffaea1f0b4373203cefc0559054fb7a442; sourceV1SnapshotId=sha256:414441d0939fcec5aac07dd377b6409d9b283cca6cc5be9a19cd0d1815c906c3. Registry/rules/policy/codeRef FIX2 se conservan. Snapshot/projection/bundle se recalculan con la fuente productiva; no se persiguen acf4434a…/2f51d0….

El bundle productivo histórico declara A00.6.7 sha256:1514a58f7ab1a013e1b0c5ab39224846623593f7f30c782ed77d6842d550db33; sus bytes y declaración no se alteran. FIX2 consume realmente sha256:4788d5e878152b36b39e830e61d8b80f43871b8579304ab453904961bb920e2e desde docs/audits/training-semantics/a00.6.7/post-closure-resolution-active.csv, igual que B. previousPolicy es una dependencia efectiva: readAcceptedTrainingResolutionPolicy parsea estados, valida el cohort y sus conteos, y replayHistorical usa estados/productIds antes de la reconciliación fuente. No es sólo una etiqueta informativa. La reconciliación recalcula assignments y nueva evidence desde la fuente productiva, pero puede conservar estados coherentes del seed. Ambos hashes se documentan con su rol: baseline histórico productivo y dependencia de construcción FIX2 aprobada. No existe una regla contractual que exija que previousPolicy sea igual al hash histórico del bundle comparador. No se reemplaza ese hash ni se declara que el archivo local fuera parte de la extracción productiva.

validateBundle, validateBundleForPublication, snapshot/V1 source linkage y validateTrainingSemanticInvariants PASS. RuntimeProjectionManager.reconcile real + ActivationService.candidate real usan bytes físicos mediante un store de lectura sin promote: producción y C quedan READY, sin lastReloadError. No se escribe un pointer. Evidencia: audit.json. No fue necesaria adaptación contractual.

El validator del runtime productivo descargado rechaza C por el schema de resolución extendido (version/builderVersion/previousPolicy); reproducción local en delta-details.json. Se requiere desplegar runtime compatible en la fase de rollout antes de activar; esta fase no lo hace.

## J. Reproducibilidad

Dos construcciones nativas independientes, mismos inputs/codeRef, directorios candidate-1 y candidate-2: mismo snapshotId, hash canónico de snapshot, todas las projection identities, bytes de las cinco proyecciones y bundleId. Reconciliación repetida con sources/contextos invertidos: snapshot y evaluaciones idénticos. generatedAt de snapshots=1970-01-01T00:00:00.000Z.

Los manifests sólo difieren en build.builtAt (2026-10-08T16:47:03.897Z / 2026-10-08T16:47:14.088Z), excluido de bundleId por el contrato. Sus hashes físicos pueden diferir. validation-report.json contiene timings diagnósticos, también fuera de la identidad. No se exige igualdad de esos timings. Las pruebas nativas iniciales con el codeRef automático obtuvieron el mismo snapshot interno y semántica; el candidate final conserva el codeRef FIX2 comprobado.

## K. Tests y gates

| Check | Resultado |
| --- | --- |
| Focalizados | 190/190 PASS (5 archivos) |
| Suite completa | 2680/2680 PASS; 418 suites |
| Typecheck | PASS (exit 0) |
| Lint | PASS (exit 0) |
| Reconciliation / negative evidence / precision | PASS; 2048 reconciliados, 0 negative-with-assignments, seis sweeps sin residuales |
| Registry / family derivations | PASS; identidad y facts exactos B→C |
| Product Discovery / Specs conflicts / Trust | PASS; conjuntos exactos, 82 conflictos, bytes protegidos idénticos |
| P_NEW | PASS; 21 familias |
| Protected projection integrity | PASS; cuatro artifacts idénticos a producción |
| Publication / lineage / runtime real | PASS; candidate y baseline |
| Reproducibility | PASS; dos builds finales independientes |

Comandos directos, sin npm test/pretest/bootstrap:

```text
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=json --outputFile=artifacts/catalog-v2/p2-3c-prb/full-tests.json
node node_modules/vitest/vitest.mjs run tests/unit/trainingRulePrecision.test.ts tests/unit/trainingSemanticReconciliation.test.ts tests/unit/catalog-admission-v2.test.ts tests/unit/training-semantic-classifier-v2.test.ts tests/unit/trainingV2AuthorityParity.test.ts --reporter=json --outputFile=artifacts/catalog-v2/p2-3c-prb/focused-tests.json
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js . --ext .ts
node --import tsx scripts/catalog-v2/build-projection-bundle.ts --source-dir=<fuente verificada> --output-dir=artifacts/catalog-v2/p2-3c-prb/candidate-1 --code-ref=sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac
node --import tsx scripts/catalog-v2/build-projection-bundle.ts --source-dir=<misma fuente> --output-dir=artifacts/catalog-v2/p2-3c-prb/candidate-2 --code-ref=sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac
node --import tsx cross-projection-audit/production-baseline-rebuild.mjs audit
node --import tsx cross-projection-audit/production-baseline-rebuild.mjs details
node --import tsx cross-projection-audit/production-baseline-rebuild.mjs finalize
node --import tsx cross-projection-audit/production-baseline-rebuild.mjs report
```

Logs y JSON de tests locales ignorados. El auditor incluye asserts de integridad, comparadores exactos, targets, corpus, conjuntos y source lineage; no se agregan tests espejo de implementación. Las comprobaciones TypeScript corresponden al código semántico final, sin cambios posteriores. El nuevo auditor MJS se ejecutó con sus asserts.

## L. Repository hygiene

385 fingerprints históricos antes/después idénticos; los 300 del gate FIX2 anterior también coinciden. protected-before.json/protected-after.json conservan los hashes físicos. El único archivo capturado y excluido es este nuevo auditor, que no existía antes de PRB y sigue siendo revisable. Ningún source, test, frozen artifact o pointer protegido se modificó.

Código bajo revisión: 3c1e9c4a17469e9beac4c8cb242aac820635d817; source/tests tracked limpios. Nuevos archivos de esta fase: cross-projection-audit/production-baseline-rebuild.mjs y este informe. El informe P2_3C_BUNDLE_BASELINE_RECONCILIATION.md ya era untracked al comenzar y permanece intacto. Sin stage ni commit nuevo. JSON/CSV/snapshots/bundles/logs generados bajo artifacts/ están ignorados, comprobado con git check-ignore. No se modificó .gitignore ni se incorporaron artifacts grandes a Git.

## M. Riesgos restantes

El candidate está listo para revisión, pendiente de aprobación y rollout posteriores. No se reobservó baseline live, PM2 ni Commercial Truth hoy; se deberán verificar en rollout. El runtime actualmente desplegado no admite C. Los 50 negativos sin evidence, P247/P897/P1624/P930 DATA_GAP, P435 AMBIGUOUS y warning P1354 permanecen visibles. Los 82 conflictos Specs y unavailable relationships/capabilities conservan su estado aprobado; no se desarrolló P2.3D. Se demostró reproducibilidad con la implementación y entorno local de Windows; el codeRef aprobado explícito evita que el orden de rutas del host reidentifique esta revisión en un build posterior. La fuente física reside en un directorio temporal local: debe conservarse junto al candidate/evidencia para revisión posterior.

## N. Disposición final

**READY_FOR_P2_3C_PRODUCTION_ROLLOUT_REVIEW**

Rebuild completo y determinista sobre fuente productiva íntegra; proyecciones protegidas físicamente idénticas; FIX2 preservado sin regresiones observadas; runtime nuevo, control plane y lineage validados. Candidate exclusivamente offline. Sin cambios en EC2, puntero productivo, PM2, PrestaShop, R4, Sales Agent, quote-service ni customer-profile.
