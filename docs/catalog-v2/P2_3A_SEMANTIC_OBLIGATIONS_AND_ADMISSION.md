# P2.3A — Semantic Obligations & Admission Contract

La auditoría anterior pudo verificar estructura y contradicciones, pero no certificar consolidación: faltaba un contrato entre familia, requisitos, evidencia y superficie. P2.3A introduce ese contrato sin reclasificar contenido ni activar consumidores. Coverage, clasificación, presencia, resolución y admisión siguen siendo conceptos separados.

## Arquitectura e identidad

`src/domain/catalog-admission/` contiene cuatro piezas: `contracts.ts` define schemas y tipos; `registry.ts` valida y publica `semantic-obligations-v1`; `resolution.ts` adapta facts originales; `evaluator.ts` evalúa obligaciones, evidencia, admisión y consolidación. `index.ts` expone el dominio. No hay DB, network, Fastify, publishers ni fallback a snapshots alternativos.

El contrato tiene `schemaVersion=1`, `contractVersion`, `ontologyVersion`, `ontologyHash` y `contentHash`. `computeSemanticObligationContractHash` reutiliza el hash JSON canónico del repositorio: ordena claves de objetos, preserva el orden explícito de arrays y excluye `contentHash`; el roundtrip JSON conserva la identidad. La instancia publicada es inmutable.

El validator rechaza schemas incompatibles, hash incorrecto, familias duplicadas, dimensiones/superficies duplicadas o incompletas, códigos desconocidos, scopes incoherentes, condiciones inválidas o imposibles, REQUIRED sin criterios/evidencia, NOT_REQUIRED sin rationale/procedencia y UNKNOWN con criterios terminales. Una policy estática ADMITTED está prohibida: sólo un evaluador puede emitirla. El default nunca puede contener una exención.

## Inventario y alcance de las obligaciones

El inventario previo identifica 21 familias reales en la ontología v3. Los records también contienen OTHER, que es residual. BAND aparece en guards históricos pero no es una familia ontológica ni un alias de BAND_SUSPENSION. UNKNOWN representa la ausencia de familia. El output local `cross-projection-audit/family-inventory.json` conserva counts y referencias a ontología, registries, contracts, tests y policies/rules; la presencia textual de un código no demuestra un requisito contractual.

Las 21 entradas son PROVISIONAL; hay cero ACTIVE y cero UNKNOWN entre familias ontológicas reconocidas, más una entrada default UNKNOWN. No se ha inventado una matriz de necesidades técnicas por conocimiento de fitness. Las decisiones conocidas se limitan a los siguientes requisitos respaldados y declarados en esta versión:

| Dimensión | Obligación | Fundamento y límite |
|---|---|---|
| PRODUCT_SEMANTICS | REQUIRED en familias reconocidas | Familia y todos los tags publicados, según ontology/evidence gates. Los ejes opcionales vacíos no son negativas. |
| TRAINING_EXERCISE | CONDITIONAL si hay asignaciones de ejercicios; si no, UNKNOWN | Los facts emitidos deben poder certificarse. Ausencia no demuestra que la familia necesite o no ejercicios. |
| TRAINING_FUNCTION | CONDITIONAL si hay funciones; si no, UNKNOWN | Mismo alcance de facts emitidos. CABLE_MACHINE requiere CABLE_RESISTANCE por la derivación ACTIVE del registry V2 existente. |
| SPECS | CONDITIONAL si existe feature fuente soportada; si no, UNKNOWN | Certifica lo que `buildSpecs` promete para features 3/11/12/15/41, incluyendo todas las claves de dimensiones físicas. No afirma una ficha técnica exhaustiva por familia. |
| TRUST | CONDITIONAL cuando Product/Training usan categorías/features; si no, NOT_REQUIRED | Las reglas de nombre funcionan sin mapas. La exención sólo cubre Trust semántico no utilizado; fuentes ausentes dejan la condición UNKNOWN. |

Cada obligación y policy tiene `rationale` y `sourceReferences`. REQUIRED exige criterios terminales. CONDITIONAL usa sólo condiciones tipadas (`FEATURE_PRESENT`, `SUPPORTED_SPEC_SOURCE_PRESENT`, `TRAINING_ASSIGNMENTS_PRESENT`, `TRUST_EVIDENCE_USED`), resultado true/false/no evaluable y un `whenFalse` explícito. No hay DSL ni ejecución de strings.

Known obligations significa que las cinco decisiones REQUIRED/NOT_REQUIRED son evaluables dentro de ese alcance declarado. No equivale a conocer todas las posibles necesidades de la familia. PROVISIONAL permite medir esa parte respaldada y señala que todavía falta aplicabilidad exhaustiva. UNKNOWN bloquea certificación global, incluso cuando existen facts resueltos; no bloquea por sí mismo una superficie independiente.

Para familia ausente, residual o nueva, las cinco dimensiones son UNKNOWN. No se heredan exenciones ni obligaciones de familias parecidas.

## Resolución y evidencia

Sólo VERIFIED y VERIFIED_NOT_APPLICABLE son terminales válidos. PARTIAL, AMBIGUOUS, DATA_GAP, ONTOLOGY_GAP, SOURCE_CONFLICT, INVALID_STATE, UNAVAILABLE_PROJECTION y UNKNOWN no son terminales. Una resolución terminal todavía necesita cumplir los criterios de su obligación y demostrar evidencia.

Los adaptadores preservan los enums originales:

| Proyección | Adaptación |
|---|---|
| Product | CLASSIFIED → VERIFIED; PARTIALLY_CLASSIFIED → PARTIAL; OTHER → UNKNOWN; NEEDS_REVIEW → AMBIGUOUS; EXCLUDED_NON_PRODUCT → VERIFIED_NOT_APPLICABLE. Categoría débil no certifica evidencia fuerte. Conflicto histórico explicit-name/family-inference → SOURCE_CONFLICT. |
| Training Exercise | COMPLETE con ejercicios → VERIFIED. COMPLETE sólo con funciones → UNKNOWN de ejercicios, sin fabricar negativa. Estados de gaps/review conservan su significado. |
| Training Function | COMPLETE con funciones → VERIFIED, independientemente de la presencia de ejercicios. Se verifica la derivación de familia y su correspondencia con Product. |
| Specs | Todos parsed válidos → VERIFIED; ambiguous → AMBIGUOUS o PARTIAL en mixes; unsupported → DATA_GAP/PARTIAL; missing → UNKNOWN de aplicabilidad, o DATA_GAP cuando la obligación exige fuente soportada. Conflictos numéricos/binding → SOURCE_CONFLICT. |
| Trust | Mappings/hash conocidos sin autoridad consumida → PARTIAL; fuentes ausentes → DATA_GAP/UNKNOWN; autoridad completa verificable y consumida → VERIFIED. La publicación de un mapa no prueba su autoridad runtime. |

Las fuentes aceptadas son únicamente NAME_TEXT, NAME, STRUCTURED_FEATURE, TRUSTED_CATEGORY, FAMILY_INFERENCE, FAMILY_DERIVATION y MANUAL_OVERRIDE. No existe DESCRIPTION. El contrato declara `acceptedEvidenceKinds`, `minimumEvidenceStrength` y `requiresNegativeEvidence`. El mapper no usa confidence para convertir un estado parcial en VERIFIED. Comprueba evidencia vinculada a cada fact; un fact fuerte no compensa otro sin respaldo.

La regla Product v3 `PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3` guarda una cadena conjunta categoría + feature. El adaptador reutiliza el matcher puro existente para verificarla; tratarla como un valor de feature aislado excluiría incorrectamente seis activos. No se cambió el classifier ni el baseline.

`lineage.productVerified/trainingVerified/specsVerified` y `trust.sourceHashesVerified` son facts del lector que verificó schema, hashes y procedencia. El evaluador no fabrica esos flags ni lee archivos para obtenerlos. Ausencia de flags permite expresar resolución observada pero no certificar evidencia. La auditoría los entrega después de validar manifest/source/bundle y los hashes originales.

`NegativeEvidenceState` separa PRESENT, ABSENT, NOT_REQUIRED y UNKNOWN. VERIFIED_NOT_APPLICABLE con ABSENT sigue siendo una resolución válida; una obligación que exige evidencia negativa no se certifica. Un elemento presente con kind no aceptado o sin source verificable tampoco certifica la negativa. Los 836 negativos Training vacíos se conservan válidos, con ABSENT.

El invariant Training es universal, sin special case P12:

```text
VERIFIED_NO_APPLICABLE_CAPABILITY
  ⇒ exerciseCapabilities.length === 0 && trainingFunctions.length === 0
```

Si hay cualquier asignación, ambas dimensiones emiten INVALID_STATE y las consultas Training quedan bloqueadas. Los 51 records existentes se detectan y no se reparan.

Specs reconstruye candidatos de unidad numérica desde `rawValue`, con la misma lógica observable de la auditoría. Reconoce los 82 conflictos que `buildSpecs` convirtió a null/ambiguous; no modifica el snapshot. UNSUPPORTED/MISSING son estados de fuente, NOT_REQUIRED/UNKNOWN_REQUIREMENT son decisiones contractuales: nunca se confunden.

## Admisión por superficie

`evaluateProductAdmission(context, surface, contract?)` es puro, determinista e idempotente. Emite ADMITTED, PARTIAL, REVIEW_REQUIRED, BLOCKED, NOT_APPLICABLE o UNKNOWN; incluye dimensiones requeridas/evaluadas/bloqueantes, reason codes estables, warnings e identidad del contrato. PARTIAL no autoriza admisión completa. Los motivos humanos complementan los códigos y no son la lógica de decisión.

| Superficie | Requisitos y scope |
|---|---|
| LEXICAL_SEARCH | Current, active y listing/visibility explícita. La extracción offline carece de listing: UNKNOWN para activos. |
| PRODUCT_CONTEXT | Existencia current, incluidos inactivos y semántica incompleta. La decisión offline depende de esa evidencia de presencia; no certifica existencia live. |
| COMMERCIAL_PURCHASE | Current/active y facts de la autoridad comercial existente: oferta sellable/backorder con precio. No se infiere stock/precio del flag active. |
| PRODUCT_SEMANTIC_DISCOVERY | Current, non-product excluido; obligación Product conocida, terminal y evidence-backed. Mantiene exactamente los 791 activos estrictos del baseline. |
| TRAINING_DISCOVERY | Current, non-product excluido, SEMANTIC_COMPLETE y obligación/evidencia de la dimensión consultada. Ejercicios por defecto; `trainingDiscoveryDimension=TRAINING_FUNCTION` sólo consulta funciones. |
| SPEC_FILTERING | UNDEFINED/UNKNOWN: parsear fuentes soportadas no crea un contrato de aplicabilidad/filtro por familia. |
| UNIFIED_RETRIEVAL | Todas las obligaciones conocidas, dimensiones required terminales, evidencia suficiente e invariants cross-projection cumplidos. UNKNOWN → REVIEW_REQUIRED; conflictos/inválidos → BLOCKED. |

Los 63 históricos COMPLETE y el non-product COMPLETE quedan NOT_APPLICABLE por scope de Training. Son decisiones propuestas por este contrato: las implementaciones de query/discovery no fueron editadas.

Training Exercise activo admite 89 productos frente a las 98 recomendaciones estrictas observadas antes: nueve tienen familia UNKNOWN y, por tanto, no tienen contrato de obligaciones. Son los IDs 388, 1193, 1331, 1332, 1335, 1619, 1620, 1622 y 1623. Sus asignaciones positivas no se reclasifican como erróneas: quedan REVIEW_REQUIRED por contrato desconocido. La consulta explícita de funciones admite 93 activos. El baseline JSON incluye la comparación exacta y evidencia.

Relationships y Capabilities CAT-V2 siguen siendo proyecciones no disponibles a nivel de plataforma. No forman parte de las cinco obligaciones ni causan penalizaciones individuales.

## Consolidación y ladder

`evaluateProductConsolidation(context, contract?)` es independiente de la admisión por superficie. Expone obligaciones conocidas, dimensiones y estados CONSOLIDATED, CONSOLIDATED_WITH_NOT_APPLICABLE, PARTIALLY_CONSOLIDATED, REVIEW_REQUIRED, BLOCKED_BY_DATA, BLOCKED_BY_ONTOLOGY, BLOCKED_BY_CONFLICT, INVALID o UNKNOWN_OBLIGATIONS.

La prioridad INVALID/conflict conserva contradicciones visibles. `obligationsKnown=false` se cuenta independientemente del estado principal: no se pierde un UNKNOWN sólo porque haya un conflicto. Las estadísticas separan population total, known/unknown y states dentro de known.

La ladder es acumulativa:

1. L0_PRESENT: existe el producto canónico.
2. L1_STRUCTURALLY_VALID: fuente y proyecciones presentes cumplen schema; un invariant semántico puede fallar conservando estructura válida. Una proyección ausente se decide en L2, no se inventa en L1.
3. L2_REQUIRED_SEMANTICALLY_RESOLVED: todas las obligaciones conocidas y cada required satisface sus criterios terminales.
4. L3_REQUIRED_EVIDENCE_BACKED: todas las required tienen evidencia aceptada, incluyendo negativas cuando se exige.
5. L4_REQUIRED_CROSS_VALIDATED: bindings y conflictos relevantes entre proyecciones satisfechos.
6. L5_DESIGNATED_SURFACE_ADMITTED: admisión de `designatedSurface`, UNIFIED_RETRIEVAL por defecto.

Ningún nivel puede pasar si falló el anterior. Cada producto incluye `highestCertifiedLevel`, `nextBlockedLevel` y `blockingReasons`. No se usa un score ponderado ni una meta de coverage.

Las tasas son `certified/totalPopulation` y `certified/knownObligations`. Cero en un denominador produce percentage=null. Con la entrada actual: all 2048 con 46 known; current 1565 con 46 known; active 886 con 31 known. No hay certificados: 0/2048 y 0/46; 0/1565 y 0/46; 0/886 y 0/31. No significa cero calidad: la mayoría tiene obligaciones desconocidas y las conocidas todavía tienen gaps, contradicciones o autoridad de Trust incompleta.

## Producto nuevo y cambios versionados

P_NEW, sin familia/proyecciones, puede pasar L0 y L1 con una fuente válida. L2 queda bloqueado por cinco UNKNOWN. Product Context puede admitir presencia current; Unified queda REVIEW_REQUIRED; Training requiere contrato conocido y resolución COMPLETE apropiada. Tener asignaciones por sí solo nunca admite una familia desconocida.

Para agregar una familia:

1. Confirmar que existe en una ontología versionada y señalar sus fuentes, sin usar alias históricos como nuevas familias.
2. Inventariar facts/reglas/contracts existentes. Declarar UNKNOWN donde no existe fundamento; cada REQUIRED, CONDITIONAL o NOT_REQUIRED debe incluir rationale y referencias revisables.
3. Elegir criterios, evidencia y superficies explícitos. Mantener SPEC_FILTERING indefinido hasta disponer de contrato suficiente.
4. Validar contenido/hash y probar producto nuevo, ausencia, negativa, contradicción, scope y determinismo. Comparar IDs/tasas con la auditoría anterior.

Un cambio sustantivo de obligaciones requiere una nueva `contractVersion` y nuevo `contentHash`, con diff de procedencia, condiciones, decisiones e impacto en denominadores. `schemaVersion` cambia cuando cambia el formato, no por cada regla. No sobrescribir una interpretación histórica bajo el mismo hash. Los futuros consumidores deben seleccionar un contrato validado explícito: no usar automáticamente el más reciente.

## Consumo futuro y observabilidad

El futuro bundle/control plane deberá vincular contractVersion/hash con ontology/source/projection identities verificadas, evaluar admisión antes de habilitar superficies y exponer motivos al consumidor. Debe conservar decisiones por superficie y separar su activación runtime del cálculo offline. P2.3A no añade el contrato a bundles productivos ni modifica pointers, policies, filtros, fallback P2.2A, Commercial Truth ni deployments.

Las proyecciones originales siguen siendo autoridades de facts. Admission entrega una interpretación versionada; no escribe resolución de regreso al snapshot. La reparación de 51 negativos, evidencia negativa, conflictos Specs y autoridad Trust corresponde a fases autorizadas de contenido/integración posteriores.

`AdmissionDecisionMetric` describe `admission_decision_total{surface,decision,reason}`; `ConsolidationStateMetric`, `consolidation_state_total{state,family}`. Families no reconocidas usan UNKNOWN como label acotado. Los IDs quedan en datasets/eventos, nunca en metric labels. No se conectó Prometheus.

## Reproducción y validación

```powershell
node cross-projection-audit/audit.mjs
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=json --outputFile=cross-projection-audit/test-results-P2.3A.json
node cross-projection-audit/audit.mjs --p2-3a
npm run typecheck
node node_modules/eslint/bin/eslint.js src/domain/catalog-admission tests/unit/catalog-admission.test.ts
```

Se usa Vitest directamente porque el pretest del package publica snapshots; esa publicación queda fuera de P2.3A. La suite conserva su configuración y setup existentes. Los fixtures reales se extrajeron con `node cross-projection-audit/build-admission-fixtures.mjs`; procedencia y diferencias de tests contrafactuales están documentadas en su JSON y en tests.

El flag P2.3A preserva los 14 outputs de la auditoría anterior. Nuevos resultados, inventario, test report y hashes de verificación viven localmente en `cross-projection-audit/` y están ignorados por Git. El inventario se genera desde los facts auditados, sin depender de un JSON versionado. Cada ejecución compara el fingerprint de los 173 archivos existentes de artifacts/data, los mismos IDs 791/51/82 y todos los resultados repetidos; una segunda ejecución con idéntico código/contrato/inputs compara hashes de datasets completos. Los outputs locales `REPORT-P2.3A.md` y `verification-P2.3A.json` presentan A–K y G1–G10. El [README de auditoría](../../cross-projection-audit/README.md) explica los inputs y la regeneración desde una salida vacía.

Unified Retrieval permanece **NOT_READY**: implementar un contrato medible no elimina sus bloqueos de aplicabilidad, evidencia, conflictos, autoridad ni revisión del bundle candidato.
