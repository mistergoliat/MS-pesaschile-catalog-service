# P2.3-QA2 — Independent Semantic Accuracy Audit

Fecha: 2026-10-08, America/Santiago. Candidate offline `sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f` sobre la fuente productiva congelada `sha256:f505ea3f…`. Run: `artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/`. **Disposición: INSUFFICIENT_INDEPENDENT_EVIDENCE. PRODUCTION_ROLLOUT_RECOMMENDATION=DEFER.**

## A. Resumen ejecutivo

QA2 **no está terminada**. La infraestructura de medición está completa y verificada: plan probabilístico para los 886 activos, reutilización verificada de los 280 casos QA1, cohortes críticas censadas, 667 fichas de revisión con 3240 claims (5824 filas claim×faceta), protocolo de doble revisión con adjudicación, motor de estimación estratificado con IC 95% y autoprueba de calibración. **No existe ninguna revisión humana efectiva**: el número de etiquetas humanas consumidas es 0. Por tanto, ninguna exactitud se estima. Las 40 métricas sobre el universo activo y las 40 sobre el canónico quedan `NOT_ESTIMABLE (NO_HUMAN_LABELS)`, y todas las superficies de búsqueda quedan `INSUFFICIENT_SAMPLE` o `UNSUPPORTED_BY_ONTOLOGY`. No se declara el 95% ni su incumplimiento.

La integridad de entradas **sí** pudo verificarse con independencia de la evidencia perdida en QA1 (sección B). Por eso la disposición no es `BLOCKED_BY_EVIDENCE_INTEGRITY`.

Antes de cualquier adjudicación ya hay hallazgos **MEASURED**, es decir, contradicciones internas del propio contrato que no requieren verdad externa:

- **QA2-R1/R2:** 14 accesorios pasivos activos de la categoría 451 «Accesorios de Polea» (agarres, sogas, barras) están clasificados como `CABLE_MACHINE`, cuya definición es «Cable/pulley stations». En cambio, 5 ankle straps de esa misma categoría están en `MACHINE_ATTACHMENT`. El grupo completo de 20 IDs del conflicto cable (16 activos) sigue admitido en Product Discovery. El riesgo recae sobre la búsqueda por familia, no sobre la búsqueda por función.
- **QA2-R4:** la política de packs es inconsistente. 40 packs activos reciben familia y 13 quedan en OTHER.
- **QA2-R6:** de las 79 filas key-conflicto Specs, 62 corresponden a valores multicomponente, de empaque, de contexto de carga o de configuración. Sólo las 17 restantes no se dejaron tipificar. Además, 88 valores Specs publicados (parsed), repartidos en 73 productos activos, llevan un calificador contextual («cada disco», «barra pull up», «incluido peso de usuario»).

Las propuestas del agente sobre las cohortes críticas se publican como `AI_AGENT_PRELIMINARY`. **No son gold labels** y el motor de métricas las rechaza por construcción.

## B. Fase 0 — Integridad del procedimiento

**No conformidad QA1 revisada.** Al iniciar QA1 se importó `cross-projection-audit/production-baseline-rebuild.mjs`. Su bloque top-level `if (process.argv[2] === 'preflight')` se ejecutó porque QA1 también se invocó con `argv[2]=preflight`, y reescribió `artifacts/catalog-v2/p2-3c-prb/preflight.json` y `protected-before.json`. Los demás bloques del auditor PRB (`audit`, `finalize`, `details`, `report`) exigen otros valores de argv y no se ejecutaron.

| Evidencia histórica | Estado | Detalle |
| --- | --- | --- |
| Bytes y SHA-256 originales de los dos archivos | **NOT_RECONSTRUCTIBLE** | Ningún artifact posterior (p2-3c-lr, p2-3c-final-review, QA1) registró sus hashes. Hash actual: `d9e96ea8…` (preflight) y `6e7ea69c…` (protected-before), sin cambios desde la captura QA1. |
| Fingerprint PRB-time del auditor PRB | **NOT_RECONSTRUCTIBLE** | PRB lo capturó y lo excluyó deliberadamente en finalize. |
| protectedCount original | **INFERRED_ONLY = 386** | protected-after contiene todas las claves originales salvo el auditor. El valor reescrito es 1407 y describe la re-ejecución accidental, no PRB. |
| Registro PRB-time de verificación de fuente y `validateBundle` de producción | **NOT_RECONSTRUCTIBLE como registro** | QA2 re-ejecutó las mismas verificaciones sobre los mismos bytes. Es evidencia nueva, no una restauración. |

**Conclusiones con autoridad independiente que se mantienen:**

1. Corpus PRB de 385 archivos íntegro durante PRB. Lo atestiguan `protected-after.json`, escrito por finalize PRB con `assert changed=[]` contra el before original, junto con `hygiene.json` y `finalize.log`. Limitación: entre 13:53 y la captura QA1 (14:51) estos outputs sólo cuentan con mtimes consistentes, que son evidencia débil.
2. Ese corpus sigue idéntico hoy: 385/385 PASS.
3. El protected-before reescrito (estado 14:51) coincide con el protected-after PRB en las 385 claves compartidas. Ningún archivo del corpus cambió entre finalize PRB y la reescritura.
4. Identidades de candidate, fuente y baseline: recalculadas por QA2 desde bytes (punto siguiente).

**Re-verificación desde fuentes autoritativas** ([authority_verification.json](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/authority_verification.json)):

- **Repositorio:** HEAD `3c1e9c4a…` y árbol tracked limpio.
- **Fuente congelada 2a5521…:**
  - `validateManifest`, round-trip de serialización canónica y `recordCounts` PASS.
  - Los cuatro hashes de inputs y el hash del manifest coinciden con las constantes PRB y con el informe LR.
- **Candidate:**
  - bundleId derivado = bddf7f…; manifest físico `6b5fc8ae…`; cinco `contentHash` correctos.
  - `validateBundleForPublication` PASS.
  - Proyecciones protegidas byte-identical con el baseline 84c85d… (`validateBundle` PASS).
  - Training V2: snapshot interno `10cd9a…`, wrapper `b315f1…`.
  - Hashes de ontología v3, registry V2 y contrato Admission `125caf…` recalculados desde código y coincidentes con los snapshots.
- **Atestación cruzada:**
  - Las dos copias de replay Linux (LR) tienen bytes idénticos en las cinco proyecciones y el mismo bundleId derivado. Su manifest difiere **sólo** en `/build/builtAt`, campo excluido de `bundleId()` y ya documentado en LR.
  - `final-review/local-validation.json` y `authority.json` de QA1 coinciden.
- **Admission:** recalculado con el código autoritativo para los 2048 productos: 0 discrepancias por superficie, key Specs o estado de negativa frente a la matriz QA1 (que a su vez se había cotejado con las filas archivadas PRB).

**Controles QA2.** QA2 no importa ningún módulo de auditoría. El cierre de imports de todos los scripts QA2 se verifica estáticamente: no se alcanza ningún módulo de `cross-projection-audit/` ni de `scripts/` ajeno a QA2, y ningún módulo alcanzado referencia `process.argv`. Además:

- Cada entry script lanza una excepción si se importa.
- El escritor es create-only (`flag wx`) y está confinado al run dir.
- El directorio del run es nuevo y exclusivo (`mkdir` no recursivo).
- Las escrituras del preflight ocurren sólo después de pasar todas las verificaciones de lectura.
- Se tomaron fingerprints de 2143 archivos protegidos antes del análisis (artifacts, data, src, scripts, tests, docs, contracts, client, cross-projection-audit, raíz productiva Temp y config). Desde la captura QA1: 0 cambios y 0 faltantes.

**Intento abortado.** El primer preflight (`run-20261008-qa2-bddf7f`) falló en una aserción demasiado estricta: exigía bytes de manifest idénticos en los replays, cuando el informe LR documenta que `builtAt` difiere. Antes de abortar alcanzó a escribir sólo `protected_before.json`. Se conserva intacto y forma parte del corpus protegido del run r2. Tras el fallo se corrigió la aserción y se reordenó el preflight para que no escriba nada hasta haber verificado todo.

## C. Fase 1 — Conjunto de referencia

**A. Muestra estadística de activos (ESTIMATED cuando haya etiquetas).** Universo: 886 productos `current_catalog` activos. Estratos: familia primaria (u OTHER / EXCLUDED_NON_PRODUCT) × estado Training V2 con facts / sin facts, en total 31 estratos. Reglas de asignación:

- Los estratos con N≤6 se censan; hay 6 censales con π=1.
- En el resto, la tasa es 0,5 para FACTS y 0,3 para NOFACTS, con redondeo hacia arriba y mínimo 3, para que la varianza sea estimable.
- Selección: SHA256(`seed:productId`) ascendente con seed `P2.3-QA2|<bundleId>|<sourceExtractionId>|active-v1`. La seed queda fijada por identidades públicas y no es ajustable a posteriori.

Resultado: **n=312**, con probabilidades de inclusión conocidas por estrato ([statistical_sample_active.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/statistical_sample_active.csv)). La muestra es independiente de QA1: el solape de 51 productos es incidental y no altera las probabilidades. Las 152 observaciones activas de QA1 no se usan como muestra uniforme.

| Justificación de tamaño | Valor |
| --- | --- |
| SRS con FPC (N=886) para ±3 / ±2,5 / ±2 pp a p=0,95 | 166 / 220 / 302 |
| Diseño QA2: semi-amplitud IC95 planificada a p=0,95 (p=0,98) | ±2,02 pp (±1,30 pp) |
| n_eff planificado (incluye FPC); efecto de diseño de Kish | 446; 1,05 |
| Exactitud observada mínima para que el límite inferior Clopper-Pearson sea ≥95% | **97,05%** |
| Dominio facts Training (N=150, n=79): semi-amplitud; exactitud mínima | ±3,35 pp; **98,4%** |

Aunque se observe un 95% puntual, no basta: el diseño sólo puede validar el objetivo si la exactitud observada alcanza aproximadamente 97% en familia y 98,4% en facts Training.

**Familias pequeñas.** Una familia es estimable si se censa o si n≥20 y la semi-amplitud planificada es ≤10 pp. Con esa regla:

- **Estimables:** BENCH, DUMBBELL, OTHER, PLATE_LOADED_MACHINE, PROTECTIVE_GEAR y WEIGHT_PLATE.
- **EXACT_CENSUS:** APPAREL.
- **NOT_ESTIMABLE:** las 16 restantes. No se inventan estimaciones para ellas: su precisión será sólo diagnóstica salvo que se amplíe la muestra.

**B. Muestra diagnóstica QA1 (280).** Se reutiliza sin modificación, conservando subset, estrato, π y lanes ([diagnostic_sample_qa1.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/diagnostic_sample_qa1.csv)). Verificaciones:

- La selección STRATIFIED_RANDOM (160) se reprodujo exactamente desde su seed para todas las cuotas, y las poblaciones por estrato coinciden.
- Nombre, familia y clasificación de los 280 coinciden con la autoridad.

Uso estadístico: STRATIFIED_RANDOM es una muestra probabilística del universo canónico **sólo sobre estratos con cuota >0**. Hay 13 estratos de cuota 0 con 33 productos no cubiertos; se reportan como población excluida. PURPOSIVE_DIFFICULT (120) no tiene π y es `DIAGNOSTIC_ONLY`. Cada caso lleva flags de prioridad: cable, OTHER, ABSENT, Specs, multifunción, accesorio/módulo, ONTOLOGY_GAP y FIX2.

**C. Cohortes críticas (censo de cada cohorte).** Se recalcularon desde la autoridad y se contrastaron con QA1:

| Cohorte | n | Activos |
| --- | --- | --- |
| Conflicto cable (= lista QA1) | 20 | 16 |
| Cable en DATA_GAP (P247, P897, P1624) | 3 | 0 |
| Frontera cable activa | 77 | 77 |
| CLASSIFIED no descubribles | 6 | 6 |
| Negativas ABSENT | 50 | 49 |
| OTHER activos | 82 | 82 |
| Conflictos Specs activos | 74 | 74 |
| DATA_GAP / AMBIGUOUS activos | 10 | 10 |
| Conceptos candidatos QA1 activos | 101 | 101 |
| FIX2 con cambio semántico | 156 | — |

Aplicabilidad UNKNOWN (658), ONTOLOGY_GAP (245), multifunción y accesorios se analizan a nivel de cohorte o contrato, sin fichas por producto.

**Regla de no mezcla.** A, B y C nunca se combinan en una exactitud global. A da estimaciones del universo activo; B.STRATIFIED_RANDOM, del canónico cubierto; B.PURPOSIVE y C son `DIAGNOSTIC_ONLY` o `EXACT_CENSUS` de su cohorte.

## D. Fase 2 — Ground truth

**Fichas.** [review_packets.json](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/review_packets.json) contiene 667 productos. Cada ficha incluye:

- Identificación: productId, nombre, presencia y actividad.
- Pertenencia a las muestras A/B/C con su π.
- Categorías y features fuente con su trustClass, y JSON Pointer a la fuente.
- Familia primaria y secundarias, disciplinas, contextos, estado y facts V2 con su relación, estado de la negativa, registros Specs, Admission por superficie y obligaciones.
- Relationships/capabilities = UNAVAILABLE.
- Bloque `reference` vacío, `reviewers=[]`, `adjudicationStatus=NOT_ADJUDICATED` y `humanReviewEffective=false`.

**La fuente congelada no contiene descripción comercial:** el campo es `UNAVAILABLE_IN_FROZEN_SOURCE`. No se consultaron fuentes externas ni producción.

**Claims y facetas.** Cada afirmación del sistema es un claim con una o más facetas juzgables:

| Claim | Facetas |
| --- | --- |
| Familia, OTHER, exclusión, disciplina, contexto | DECISION |
| Ejercicio o función | FACT, RELATION_TYPE, HOST_ATTRIBUTION |
| Negativa o abstención V2 | DECISION |
| Spec parsed | VALUE, UNIT, PHYSICAL_INTERPRETATION |
| Spec no resuelta | UNRESOLVED_JUSTIFIED |
| Conflicto Specs | DECISION |

Una key ausente no genera claim y nunca es INCORRECT por ausencia. Los hechos falsos se separan de los conceptos no modelados: un concepto fuera de la ontología se registra en `reference.unmodeledConcepts` y no convierte una negativa en INCORRECT.

**Outcomes** (exclusivos de QA2): CORRECT, INCORRECT, INCOMPLETE, NOT_APPLICABLE, INSUFFICIENT_REFERENCE_EVIDENCE y NOT_ADJUDICATED. INSUFFICIENT_REFERENCE_EVIDENCE no cuenta como error: se excluye del denominador y se reporta una sensibilidad pesimista que la trata como incorrecta.

**Independencia de evidencia.** La salida de la propia regla (E0) se rechaza. Los niveles aceptados son:

| Nivel | Fuente | Alcance |
| --- | --- | --- |
| E1 | Mismos campos fuente interpretados por un humano | Válido para familia/rol y para fidelidad de parseo |
| E2 | Fuente externa (ficha de fabricante, página, manual, foto, con URL y fecha) | Obligatorio para VALUE e INTERPRETATION factuales de Specs |
| E3 | Inspección física o confirmación del proveedor | Máximo nivel |

**Protocolo** ([adjudication_protocol.json](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/adjudication_protocol.json)):

1. **Etapa A, ciega** ([worksheet_blind.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/worksheet_blind.csv)): R1 y R2 proponen familia, rol, disciplinas, contextos, ejercicios y funciones sin ver la salida del sistema.
2. **Etapa B** ([worksheet_claims.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/worksheet_claims.csv)): cada revisor juzga cada faceta de forma independiente.
3. **Resolución:** si R1 y R2 coinciden, esa es la etiqueta final. Si discrepan, decide un ADJUDICATOR distinto de ambos. Una revisión única no cuenta.
4. Se reporta kappa de Cohen por dimensión.

Las propuestas del agente sólo pueden mostrarse después de la etapa A y nunca se registran como revisión.

**Propuestas del agente.** [agent_preliminary_proposals.json](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/agent_preliminary_proposals.json) contiene propuestas para el 100% de las cohortes cable, de los 6 no descubribles, de ABSENT, de OTHER y de DATA_GAP/AMBIGUOUS. Todas llevan `reviewerType=AI_AGENT_PRELIMINARY`, `humanReviewEffective=false` y base exclusiva en nombre, categorías, features y texto del registry. **Ningún caso quedó adjudicado.**

## E. Fases 3–4 — Métricas y análisis estadístico

**Motor.** [metrics.mjs](../../scripts/audits/qa2/metrics.mjs) y [estimators.mjs](../../scripts/audits/qa2/estimators.mjs) implementan:

- Estimador de razón estratificado, con pesos N_h/n_h y linealización de Taylor con FPC; los estratos censales aportan varianza 0.
- n_eff de Korn-Graubard, con IC 95% Clopper-Pearson (regla de decisión) y Wilson (referencia).
- Estado ESTIMATED, EXACT_CENSUS, DIAGNOSTIC_ONLY o NOT_ESTIMABLE para cada métrica.
- NOT_ESTIMABLE si menos del 90% de los claims del dominio están adjudicados, o si hay menos de 20 unidades de dominio sin censo.
- Veredicto frente al 95% (`TARGET_MET` / `TARGET_NOT_MET` / `INCONCLUSIVE`) basado en el intervalo, nunca en la proporción puntual.

**Métricas definidas por universo** (activo, canónico cubierto y diagnóstico):

| Dimensión | Métricas |
| --- | --- |
| Product Semantics | Exactitud de familia primaria; decisión de familia incluyendo OTHER/exclusión; corrección de la abstención OTHER; precisión de secundarias, disciplinas y contextos; precisión por familia; recall por familia (requiere `reference.primaryFamily`) |
| Training V2 | Precisión de facts de ejercicio y función; tipo de relación DIRECT/SUPPORTED/FAMILY_DERIVED; precisión FAMILY_DERIVED; atribución al host; corrección de negativas; abstención justificada |
| Specs, por cada una de las 6 keys | VALUE factual (E2), fidelidad de parseo (E1), UNIT, interpretación física (E2); no resueltas justificadas; conflicto reconocido |

**Tamaño de dominio en la muestra A** (para anticipar estimabilidad tras adjudicar):

| Métrica | Productos | Claims |
| --- | --- | --- |
| Familia | 282 | — |
| OTHER | 27 | — |
| Disciplinas | 45 | 46 |
| Contextos | 88 | 92 |
| Facts de ejercicio | 55 | 62 |
| Facts de función | 39 | 46 |
| Negativas | 154 | — |
| Abstenciones | 79 | — |
| Specs por key | 59–207 | — |

**FAMILY_DERIVED tiene dominio vacío:** en todo el universo activo sólo existe un claim (P2317). Esa métrica será NOT_ESTIMABLE aun con etiquetas; P2317 se adjudica como censo.

**Estado actual:** 0 etiquetas humanas. Resultados:

- `ACTIVE_886`: 40/40 NOT_ESTIMABLE.
- `CANONICAL_QA1_STRATIFIED`: 40/40 NOT_ESTIMABLE.
- `DIAGNOSTIC_PURPOSIVE`: 40/40 DIAGNOSTIC_ONLY, con 0/0.
- Precisión por familia: NOT_ESTIMABLE en las 23 familias.
- Kappa: no calculable.

Ver [metrics_by_dimension.json](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/metrics_by_dimension.json) y [confidence_intervals.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/confidence_intervals.csv).

**EXACT_CENSUS de estados del sistema** (cobertura y abstención, que **no** miden verdad), sobre 886 activos:

| Estado | Productos |
| --- | --- |
| Familia asignada | 797 |
| OTHER | 82 |
| Excluidos | 7 |
| Con facts Training | 150 |
| CLASSIFIED no descubribles | 6 |
| Negativas ABSENT | 49 |
| DATA_GAP/AMBIGUOUS | 10 |
| ONTOLOGY_GAP | 245 |
| Con alguna obligación UNKNOWN | 658 (QA1 reportó 652 sólo para Training) |
| Conflicto Specs | 74 |
| Specs ambiguas/no soportadas | 183 |

**Autoprueba** ([estimator_selftest.json](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/estimator_selftest.json), **datos SINTÉTICOS**, que no son resultados del catálogo). Sobre 1000 re-muestreos del diseño A:

- Cobertura Clopper-Pearson 96,1% y Wilson 94,8%; sesgo −0,0005.
- Censo exacto y varianza SRS analítica verificados.
- El desacuerdo se resuelve por el adjudicador; la etiqueta del agente se rechaza; la revisión única no cuenta.

## F. Fase 5 — Casos críticos

Ninguna proporción de esta sección es una exactitud adjudicada. «Preliminar» significa propuesta del agente.

| Grupo | ¿Incorrecto realmente? | Fuera de alcance | Causa raíz | Riesgo catalog.discover | Corrección mínima |
| --- | --- | --- | --- | --- | --- |
| 1. Frontera CABLE_MACHINE (20; 16 activos) | NOT_ADJUDICATED. Preliminar: familia INCORRECT 20/20 (HIGH, base contractual); negativa Training CORRECT 20/20 | Dependencia módulo→host y compatibilidad de agarres: UNAVAILABLE | `PF_CABLE_MACHINE_NAME_V1` se activa con «polea» antes que MACHINE_ATTACHMENT; no existe rol accesorio/módulo/estación | **ALTO** en búsqueda por familia (16 accesorios activos admitidos como estación); bajo en búsqueda por función (bloqueados) | Excluir de la regla cable los nombres «Accesorio Polea», agarre, soga, barra, tobillera y asiento sin feature 65, y enviarlos a MACHINE_ATTACHMENT; revisar el override «Smith» en módulos (P1124) |
| 2. Seis CLASSIFIED no descubribles | NOT_ADJUDICATED. Preliminar: familia CORRECT 6/6; es abstención, no error | — | Evidencia sólo por categoría 292 SEMANTIC_WEAK → `WEAK` → PARTIAL ([resolution.ts:53,81](../../src/domain/catalog-admission/resolution.ts#L53); errata: `critical_cases.json` R5 cita `:52,81`). «J-Cups» figura en la definición pero no en la regla por nombre | Bajo (6 falsos negativos en búsqueda por familia) | Ampliar el vocabulario de nombre de MACHINE_ATTACHMENT sin relajar el gate WEAK |
| 3. Negativas ABSENT (50; 49 activas) | NOT_ADJUDICATED. Preliminar: 3 INCORRECT (anillas P53/P54/P2261), 2 INSUFFICIENT (remos de aire y definición de ROW), 45 CORRECT respecto del registry | 33 CARDIO, cuerda de salto y landmine son conceptos no modelados | Negativas emitidas sin evidencia negativa; no hay conceptos cardio/conditioning | Medio, si se interpreta VERIFIED_NO_APPLICABLE como «sin uso de entrenamiento» | No exponer ABSENT como claim técnico; revisar anillas; precisar el alcance de ROW |
| 4. OTHER activos (82) | NOT_ADJUDICATED. Preliminar: 43 CORRECT (abstención), 12 INCORRECT (familia existente omitida: glute bands ×3, SSB, push-ups, salmon ladder, 4 packs de máquinas, multiestación, mat), 27 INSUFFICIENT | Agilidad/pliometría, lastre, timers, hidratación | Roles no modelados + vocabulario de reglas incompleto + sin política de bundles | Medio (falsos negativos; OTHER no se admite y por tanto no genera falsos positivos) | Reglas de vocabulario para familias existentes; decisión de política de packs |
| 5. Conflictos Specs activos (74) | NOT_ADJUDICATED. Las keys en conflicto no publican valor (abstención segura) | Material, espesor, resistencia, etc. no tienen key | Features multivalor tratadas como contradicción: cajas 31, por componente 19, levantamiento vs almacenamiento 7, configuración 5, otros 17 | Bajo para los conflictos; **medio** para 88 valores parsed con calificador contextual (73 productos) | Subtipar el conflicto (MULTI_COMPONENT/PACKAGE/CONTEXT); excluir valores calificados por componente en `max_*_kg` y `weight_kg` de packs |
| 6. Aplicabilidad UNKNOWN (658) | NOT_APPLICABLE: es un estado contractual, no una clasificación | — | Obligaciones de ejercicio/función no definidas para la mayoría de familias (p. ej., WEIGHT_PLATE ejercicio 89, PROTECTIVE_GEAR función 99, BALL_BAG ambos 51); OTHER y excluidos UNKNOWN en todas las dimensiones | **ALTO** para declarar cobertura de búsqueda por ejercicio/función | Declarar REQUIRED o NOT_REQUIRED por familia×dimensión en el contrato; no inferir |
| 7. Conceptos candidatos QA1 (101 activos) | NOT_APPLICABLE: son hipótesis de ontología | 43 coinciden con OTHER | Roles sin familia (agilidad, lastre, timing, bundles) | Medio: no responder con familias cercanas | Decisión de producto/ontología por concepto |

**Inconsistencias reproducibles** ([critical_cases.json](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/critical_cases.json), con comandos de reproducción):

| ID | Hallazgo | Productos |
| --- | --- | --- |
| R1 | Pasivos 451 como CABLE_MACHINE frente a ankle straps como MACHINE_ATTACHMENT | 14 vs 5 activos |
| R2 | La obligación CABLE_RESISTANCE choca con la negativa PRESENT | 20, de los que 16 activos están bloqueados en Function Discovery |
| R3 | Agarres OCR casi idénticos con Training opuesto: P1331/P1332/P1335 PULL_UP DIRECT frente a P1333 negativa | 4 |
| R4 | Packs con y sin familia | 40 vs 13 |
| R5 | J-Cups en la definición sin regla por nombre | 6 |
| R6 | SOURCE_CONFLICT de Specs mayoritariamente multicomponente | 79 filas |
| R7 | ABDOMINAL_CRUNCH huérfano mientras rueda abdominal/AbMat/Core Roller quedan negativos o sin resolver | 4 |

Detalle adicional: [cable_boundary_active.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/cable_boundary_active.csv), [specs_conflict_taxonomy.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/specs_conflict_taxonomy.csv), [specs_interpretation_risk.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/specs_interpretation_risk.csv) y [unknown_applicability_active.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/unknown_applicability_active.csv). Las clasificaciones por regex (señal de rol cable, patrón de conflicto, calificador) son **INFERRED** y sirven para priorizar, no para adjudicar.

**Trust / Relationships.** Trust sólo se valida como consistencia ya implementada: los hashes de mapas verificados y la paridad Admission 0/2048 se mantienen. Compatibilidad, dependencia, sustitución y composición son `UNAVAILABLE`; no se estima exactitud sobre una proyección inexistente y quedan excluidas de toda certificación.

## G. Fase 6 — Decisión de calidad por superficie

| Superficie | Decisión | Riesgo pre-adjudicación / alcance |
| --- | --- | --- |
| Nombre / familia | INSUFFICIENT_SAMPLE | R1/R2 (cable), R4 (packs), 12 OTHER con familia probable (preliminar) |
| Disciplina | INSUFFICIENT_SAMPLE | 46 claims en la muestra A |
| Contexto de uso | INSUFFICIENT_SAMPLE | — |
| Ejercicio | INSUFFICIENT_SAMPLE | Sólo 24 ejercicios modelados; aplicabilidad UNKNOWN; negativas ABSENT |
| Función | INSUFFICIENT_SAMPLE | Sólo 5 funciones; R2, R3 (atribución al host) |
| Especificaciones (6 keys) | INSUFFICIENT_SAMPLE | 88 valores calificados; conflictos multicomponente |
| Múltiples restricciones | INSUFFICIENT_SAMPLE | Hereda todo lo anterior |
| Compatibilidad, sustitución/alternativas, composición/bundles | UNSUPPORTED_BY_ONTOLOGY | relationships/capabilities UNAVAILABLE |
| Specs fuera de las 6 keys; roles agilidad/lastre/timing | UNSUPPORTED_BY_ONTOLOGY | Sin key ni familia |

Ninguna superficie es QUALITY_VALIDATED. QUALITY_INSUFFICIENT exige un intervalo adjudicado por debajo del 95%, que hoy no existe. Los riesgos MEASURED de la columna derecha anticipan que nombre/familia, función y Specs difícilmente alcanzarán el umbral sin remediación.

## H. Backlog de correcciones (no implementadas)

| Prioridad | ID | Issue | Productos (activos) | Bloquea |
| --- | --- | --- | --- | --- |
| P1 | QA2-B1 | Frontera CABLE_MACHINE / MACHINE_ATTACHMENT | 14 (14) | Nombre/familia |
| P1 | QA2-B2 | Ejecutar adjudicación humana de la muestra A y de las cohortes críticas | 312 + cohortes | Todas |
| P1 | QA2-B3 | Negativas ABSENT expuestas como claim | 50 (49) | Ejercicio/función |
| P1 | QA2-B4 | Aplicabilidad UNKNOWN por familia×dimensión | 658 (658) | Ejercicio/función/multi |
| P2 | QA2-B5 | Valores Specs parsed con calificador contextual | 73 (73) | Specs |
| P2 | QA2-B6 | Vocabulario de reglas para familias existentes | 11 (11) | Nombre/familia |
| P2 | QA2-B7 | Política de bundles/packs | 53 (53) | Nombre/familia/multi |
| P2 | QA2-B8 | Subtipado de SOURCE_CONFLICT Specs | 74 (74) | Specs |
| P3 | QA2-B9 | Anillas / ABDOMINAL_CRUNCH / agarres OCR | 9 (8) | Ejercicio/función |

Las filas se solapan entre sí: no deben sumarse. [remediation_backlog.csv](../../artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/remediation_backlog.csv).

## I. Evidencias, reproducción y límites

**Scripts** (nuevos, no funcionales): [lib.mjs](../../scripts/audits/qa2/lib.mjs), [preflight.mjs](../../scripts/audits/qa2/preflight.mjs), [context.mjs](../../scripts/audits/qa2/context.mjs), [estimators.mjs](../../scripts/audits/qa2/estimators.mjs), [design.mjs](../../scripts/audits/qa2/design.mjs), [agent-proposals.mjs](../../scripts/audits/qa2/agent-proposals.mjs), [critical.mjs](../../scripts/audits/qa2/critical.mjs), [metrics.mjs](../../scripts/audits/qa2/metrics.mjs) y [finalize.mjs](../../scripts/audits/qa2/finalize.mjs).

**Orden de ejecución:** `node --import tsx scripts/audits/qa2/<script>.mjs` para preflight → design → critical → metrics → finalize. `QA2_DRY=1` ejecuta design/critical/metrics sin escribir.

**Incorporar etiquetas humanas:** `metrics.mjs --labels <qa2-labels-v1.json>` en un run-dir nuevo. El escritor create-only impide reutilizar este.

**Evidencias en el run dir:** `preflight.json`, `protected_before.json`, `authority_verification.json`, `evidence_integrity.json`, `sampling_plan.json`, muestras A/B, fichas, hojas de trabajo, `adjudication_dataset.json`, protocolo, propuestas del agente, casos críticos, CSVs de análisis, métricas, IC, decisiones por superficie, autoprueba, backlog, `protected_after.json`, `audit_implementation_hashes.json` y `evidence_checksums.json`. `finalize.mjs` vuelve a calcular el fingerprint del corpus protegido, re-verifica el cierre de imports y los hashes del candidate, y registra los hashes de scripts e informe.

**Límites:**

- La fuente es una observación del 1 de octubre, no el catálogo live.
- No hay descripciones comerciales ni evidencia externa.
- Las heurísticas regex son de priorización.
- La autoprueba usa datos sintéticos.
- Las propuestas del agente no son verdad.

**Lo que no se hizo:** no hubo SSH/EC2, deploy, commit, rebuild, activación, cambio de reglas, ontología, código funcional o datos, ni se inició QA3/catalog.discover.

## J. Disposición final

**INSUFFICIENT_INDEPENDENT_EVIDENCE.**

- No es `BLOCKED_BY_EVIDENCE_INTEGRITY`, porque las entradas se verificaron con autoridad independiente de los dos archivos perdidos. La pérdida queda documentada como no reconstruible y no se fabricó ninguna restauración.
- No es `REQUIRES_SEMANTIC_REMEDIATION`, porque esa disposición debe apoyarse en errores adjudicados y no en propuestas del agente. Aun así, si la adjudicación humana confirma R1/R2, la disposición pasará previsiblemente a esa categoría para nombre/familia.
- No es `QUALITY_VALIDATED_FOR_DEFINED_SCOPE`, porque no existe ninguna estimación.

```text
QA2_DESIGN_COMPLETE=YES
INDEPENDENT_LABELS_AVAILABLE=NO
STATISTICAL_ACCURACY_ESTIMATED=NO
CRITICAL_CASES_ADJUDICATED=NO
PRODUCTION_ROLLOUT_RECOMMENDATION=DEFER
```

QA2 permanece abierta hasta que revisores humanos completen las etapas A/B sobre la muestra A (312) y las cohortes críticas, y se re-ejecute `metrics.mjs` con sus etiquetas.
