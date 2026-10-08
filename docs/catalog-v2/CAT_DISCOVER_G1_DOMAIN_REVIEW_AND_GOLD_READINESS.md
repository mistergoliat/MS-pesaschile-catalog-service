# CAT-DISCOVER-G1 — Revisión de dominio y preparación del gold held-out independiente

Fecha: 2026-10-08, America/Santiago. Run: `artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/`. **Disposición: READY_FOR_HUMAN_DOMAIN_REVIEW.** La pista de benchmark está `BLOCKED_BY_MISSING_REVIEW_INPUTS`. `PRODUCTION_ROLLOUT=DEFER`.

Esta fase no mejora métricas ni toca reglas. Prepara las condiciones para medir `catalog.discoverV0.2` de forma objetiva.

- No se modificaron Product Semantics, Training V2, Specs, Trust, Admission, bundles, snapshots ni producción.
- No se cambiaron pesos, intérprete, léxico ni reglas de Discover: el agregado del código Discover es el mismo antes y después, `sha256:dc955cf7…`.
- No hubo deploy, commit ni push.
- No se generaron consultas ni etiquetas: ni humanas simuladas ni con LLM.

## A. Resumen ejecutivo

- **V0.2 está congelado y es reproducible sin commit.** Su autoridad queda definida como `6469eca` + `v02_worktree.patch`, con una copia byte a byte en `v02-code/`. Un árbol aislado construido desde `git archive 6469eca` más esa copia reprodujo el run oficial r2 en **12/12 artefactos deterministas**. El harness nuevo reproduce además las listas de V0 y V0.2 en **480/480 consulta×variante** cada uno.
- **Riesgo técnico encontrado y mitigado: el bundle productivo `84c85d15…` sólo existía en un directorio Temp de Windows.** Se archivó una copia verificada por hash; no se reconstruyó.
- **Seis expedientes de revisión de dominio están listos** (DR-01…DR-06), con ejemplos reales, productos afectados, evidencia, riesgo y una decisión propuesta. Los seis siguen en `PENDING_HUMAN_DOMAIN_REVIEW`: ningún agente aprobó reglas.
- **Hallazgos de la auditoría:**
  - Las **48 transiciones REJECTED → POSSIBLE** de V0.2 no vienen sólo de los conflictos nombre/negativa y de los grupos, como dice el informe V0.2 §J. Sólo **13** vienen de `NEGATIVE_CONFLICTS_WITH_NAME` y **4** del grupo de Q060. **31** vienen de QuantityScope (packs y pares).
  - `INCLUDES_USER` (DR-01) es el **riesgo de sobrecertificación más alto**: certifica 9 de los 13 bancos verificados de Q084 bajo una lectura de la consulta que nadie ha validado.
  - El margen del 10 % (DR-04) no certificó nada en el set de desarrollo. El riesgo es latente.
  - La regla de conflicto por nombre (DR-05) se dispara con términos de un solo token que abarcan muchas familias, como «rack» (55 nombres, 7 familias) y «mancuerna» (87, 3).
- **El gold held-out tiene proceso, contratos, validadores, plantillas y harness, pero no tiene consultas.** No hay consultas históricas autorizadas ni personal comercial o revisores asignados. `heldout_queries.json` está vacío a propósito. El harness **se niega** a calcular métricas con etiquetas incompletas, y se comprobó.
- **No se declara calidad de recuperación.** `RETRIEVAL_QUALITY_VALIDATED=NO`.

## B. Autoridad V0.2 congelada

Detalle completo en [v02_frozen_authority.json](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/v02_frozen_authority.json).

| Elemento | Valor |
| --- | --- |
| HEAD / rama | `6469eca2009a0cbdd897d43deadb1a7ff0d10c2c` / `feat/cat-discover-v0` (sin cambios durante G1) |
| Cambios V0.2 preservados | 14 modificados y 33 no rastreados preexistentes, listados uno a uno (incluyen docs P2.3C/QA y scripts de QA que no son código V0.2). Los archivos que agrega G1 se listan aparte (`addedByG1Session`) |
| Parche | `v02_worktree.patch` `sha256:808210be…`: 26 archivos de las raíces de código Discover más el informe V0.2, incluidos los no rastreados. Se construyó con un índice temporal (`GIT_INDEX_FILE`), así que no se tocó el índice, las refs ni el worktree. Se escribieron blobs sueltos sin referencia en `.git/objects`, que `git gc` elimina |
| Código Discover | 33 archivos, agregado `sha256:dc955cf7…`, idéntico a `protected_before.json` |
| Versiones | retrieval `catalog-discover-v0.2`; léxico `discover-v0.2-lexicon-v1` (108 entradas, `sha256:b1cac443…`, 101 pendientes de revisión de dominio); `quantity-scope-v0.2` (16 reglas, margen aproximado 0,1); documento `retrieval-document-v0.1`; límite de hidratación 40 |
| Intérprete y ranking | **No tienen constante de versión propia**, así que se identifican por el hash de su archivo (`queryInterpreter.ts`, `ranker.ts`). Pesos a priori sin ajustar |
| Fuente | `sourceExtractionId sha256:f505ea3f…`, agregado `2a5521b7…`; coincide con r2 |
| Bundles | productivo `sha256:84c85d15…` y FIX2 `sha256:bddf7f36…`; los archivos coinciden con r2 |
| Benchmark V0 | `discover-v0-benchmark-v1`, `sha256:581ae835…`, 120 consultas, **sólo desarrollo y regresión** |
| Evidencia V0 | run congelado `run-20261008-discover-v0-r1` (15 archivos) y replay desde HEAD |
| Evidencia V0.2 | r2: 13 checksums registrados intactos; agregado de los 33 archivos del run (incluido `reproducibility/`) en la autoridad |

**Mecanismo de replay** (`scripts/catalog-v2/discover-g1/replay-v02.ts`):

1. Construye `git archive 6469eca` en Temp.
2. Superpone `v02-code/` y verifica que el árbol reproduce los hashes de la autoridad.
3. Enlaza `node_modules` y `artifacts/` por junction.
4. Ejecuta el `benchmark-v02.ts` **del árbol**, no del worktree, con las mismas rutas relativas que r2.
5. Lo compara con r2 mediante `compare-v02-runs.ts`.

Resultado: `reproduced=true`, 12/12 ([v02_replay_check.json](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/v02_replay_check.json)). Una versión futura se congela y se reproduce igual, y su `results_v02.json` se compara por consulta con el de r2. La limpieza elimina primero las junctions y luego el árbol; se verificó que `node_modules` y `artifacts/` siguen intactos.

**Propuesta de commit de referencia (no ejecutada).** Crear la rama `ref/catalog-discover-v0.2` desde `6469eca`, aplicar el parche, hacer commit y crear el tag `catalog-discover-v0.2-r2` después de repetir el replay sobre ese commit. La decisión corresponde al owner del repositorio.

**Bundle productivo en Temp.** Mientras viva en `C:/Users/dell/AppData/Local/Temp/p23c-rollout-…`, cualquier limpieza del sistema rompe todo replay de las variantes A/B/C. Hay una copia byte a byte verificada en `inputs/production-bundle/84c85d15…/`, utilizable con `DISCOVER_V0_PRODUCTION_BUNDLE_DIR`. Se recomienda que el owner la traslade a una ubicación durable bajo `artifacts/catalog-v2/`.

## C. Expedientes de revisión de dominio

Los expedientes están en [domain_review_packets.json](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/domain_review_packets.json) y las decisiones, que debe completar un humano, en [domain_review_decisions.csv](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/domain_review_decisions.csv).

La evidencia se produjo así ([domain-review/](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/domain-review/)):

- se ejecutó V0.2 en modo read-only sobre las 120 consultas de desarrollo, variantes C y D;
- se re-verificó cada candidato del pool con un `ConstraintVerifier` nuevo, con **0 discrepancias** de disposición frente al pipeline;
- se hizo un censo de los valores de Specs que cada regla puede tocar en el universo de 884 productos.

| Expediente | Hecho clave en datos reales (D) | Riesgo | Propuesta (no aprobada) |
| --- | --- | --- | --- |
| **DR-01 INCLUDES_USER** | 37 valores en el universo (35 bancos). En Q084 «banco que soporte 300 kg»: 13 VERIFIED, de los cuales **9 por INCLUDES_USER**: P1338, P1549, P1550, P1339, P638, P898, P475, P476 y P269. P269 declara exactamente 300 kg incluido el usuario. Los otros 4 vienen de valores **sin calificador**, cuyo alcance respecto al usuario tampoco se conoce | **ALTO**. Si «soporte 300 kg» significa carga externa, un banco de 350 kg con el usuario incluido sólo soporta 300 kg de barra con un usuario de ≤50 kg | B: tratar «soporte N kg» como ambigua (total o carga externa). C: certificar con evidencia E2 del fabricante |
| **DR-02 PAIR_NAMING_CONVENTION** | Se aplica en Q105 (11 VERIFIED), Q006 (9) y Q010 (7). Censo: 112 `EXPLICIT_EACH` certificables en productos multiunidad, 23 `EXPLICIT_PAIR`, 14 `PACK_NAME_TOTAL`, 8 `MULTI_UNIT_UNQUALIFIED`. **31 de las 48 transiciones REJECTED → POSSIBLE** son packs y pares con `PACK_TOTAL_NOT_PER_UNIT` o `MULTI_UNIT_UNQUALIFIED` | MEDIO. La convención viene de los nombres del catálogo, no del lenguaje del cliente | C: conservar las reglas de producto con texto explícito; decidir la lectura de «par de X de N kg» con datos del gold |
| **DR-03 SUBCOMPONENT_CAPABILITY** | Q088: **8 certificaciones nuevas**: P1059, P1537, P1538, P1541, P1543, P1546, P1547 y P2058, con capacidades de 150 a 200 kg de la barra de dominadas. 4 REJECTED con 100 kg: P1862, P2333, P176 y P2182. Censo: 15 condicionales y 12 no certificables | MEDIO. Es la capacidad de la barra, no la del producto instalado. P2058 es un rack de muro y depende del anclaje | B: sólo USER_CAPACITY y el ejercicio exacto. POSSIBLE si depende de la instalación. Revisar los 8 casos con E2 |
| **DR-04 APPROXIMATE_QUANTITY** | 30 valores, todos `weight_kg`: barras «No calibrada» y agarres «≈». **45 evaluaciones, todas UNKNOWN y 0 certificaciones por margen**, porque las consultas de peso son EQ | LATENTE. «Barra de al menos 18 kg» certificaría P545 («20 kg aprox.») sin una tolerancia documentada | B: tolerancia por familia sólo si está documentada; si no, C: un valor aproximado nunca certifica GTE/LTE |
| **DR-05 NEGATIVE_CONFLICTS_WITH_NAME** | 13 transiciones, ver abajo. 179 evaluaciones de conflicto por nombre, todas UNKNOWN, en 37 consultas; 48 en un top-8. Términos genéricos de un solo token: rack (55 nombres / 7 familias), mancuerna (87/3), barra (87/5), banco (66/3), disco (49/5) | Bajo para la certificación (nunca certifica). Medio para el ruido: genera falsas no-exclusiones | B: conflicto sólo si el término es el núcleo nominal del nombre; excluir términos de un token que abarcan 3 o más familias; revisar las 13 |
| **DR-06 AMBIGUITY_GROUP** | Sólo 2 ambigüedades gobernadas. Q060: 0 VERIFIED, 110 POSSIBLE y 114 REJECTED; 50 productos fallan en ambas lecturas. Q065: 34 VERIFIED porque, en los datos, disciplina y familia coinciden | BAJO, porque la política es conservadora. Pero con lecturas excluyentes nada puede verificarse nunca | A: mantener la política. Contrato de aclaración para R4 **sólo como propuesta**, sin integrar |

**Detalle de las 13 transiciones `NEGATIVE_CONFLICTS_WITH_NAME`:**

- Q056 «máquina para hip thrust»: 7 productos, todos **accesorios**: seis cinturones Hip Thrust (P1163–P1166, P1432, P1433) y la almohadilla P2125. El nombre nombra el ejercicio como propósito, no como capacidad.
- Q053: P1119, P1876 y P1514.
- Q049 y Q098: P454.
- Q044: P1874.

P1874 y P1876 son accesorios que sí habilitan el ejercicio una vez montados, así que parecen conflictos legítimos. Archivo: [dr05_rejected_to_possible.csv](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/domain-review/dr05_rejected_to_possible.csv).

**Revisores requeridos:** un experto en equipamiento (producto/técnico) y un líder comercial. Ninguno puede ser autor de reglas de Discover. Valores de decisión: `APPROVE_AS_IS`, `APPROVE_WITH_CHANGES`, `REJECT` o `NEEDS_EVIDENCE`.

## D. Gold held-out

| Entregable | Estado |
| --- | --- |
| [heldout_collection_protocol.md](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/heldout_collection_protocol.md) | Listo: roles, fuentes, prohibiciones, composición guía, congelamiento, separación entre tuning y evaluación |
| [heldout_queries.json](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/heldout_queries.json) | **Vacío a propósito**: `PENDING_COLLECTION_NO_QUERIES` |
| Contrato | Se mantiene `discover-heldout-contract-v1`. `heldout.ts` es parte del código V0.2 congelado y no se edita, así que la extensión G1 (`validateHeldoutG1`) acepta una tercera fuente, `PRODUCT_REVIEWER_TECHNICAL_CASE`, sólo con una atestación de no exposición a los rankings y hasta un 30 % del set |

**Fuentes, en orden de preferencia:**

1. Logs comerciales autorizados y anonimizados, con una regla de muestreo declarada antes de exportar.
2. Consultas elicitadas al equipo comercial, que no ve ninguna salida del sistema.
3. Casos técnicos de un revisor de producto que no ha visto los rankings.

**Prohibido:**

- reutilizar consultas del benchmark de desarrollo o reformularlas de forma trivial (el owner revisa a mano lo que el validador no detecta);
- usar consultas del autor de Discover;
- usar consultas sintéticas presentadas como comerciales.

**Congelamiento:**

- `frozenAt` y un sha256 antes de ejecutar cualquier versión.
- Toda edición crea una versión nueva.
- Un set usado para ajustar reglas pasa a ser de desarrollo, y el material para mejorar el motor se recolecta como un set aparte.

## E. Protocolo de relevancia y adjudicación

[adjudication_protocol.json](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/adjudication_protocol.json) sigue el patrón de QA2: R1 y R2 trabajan de forma independiente y a ciegas, y un adjudicador distinto resuelve.

| Etapa | Material | Recoge |
| --- | --- | --- |
| A — sin productos | `query_review_sheet` | Intención comercial, interpretaciones válidas y ambiguas, restricciones obligatorias (con el [picklist](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/constraint_picklist.json) de códigos de registro), preferencias, comportamiento esperado (`ANSWER`, `ANSWER_WITH_CAVEATS`, `CLARIFY` o `ABSTAIN`), información insuficiente y pregunta de aclaración |
| B — búsqueda independiente | Tienda y [catalog_reference_listing.csv](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/catalog_reference_listing.csv): 884 productos con nombre, categorías y features **crudos de la fuente congelada**, sin proyecciones semánticas | Productos que el revisor encuentra por su cuenta, con un log de búsqueda |
| C — pool ciego | `build-review-pool.ts --mode=build`: unión del top-8 de V0 y V0.2 en A/B/C/D, **barajada por hash**, sin scores, disposiciones, variante ni orden del sistema | Grado (`RELEVANT`, `PARTIAL`, `NOT_RELEVANT`, `VIOLATES_CONSTRAINT` o `INSUFFICIENT_INFORMATION`), juicio por restricción (`MET`, `NOT_MET` o `CANNOT_DETERMINE`) y evidencia E1/E2/E3. Qué sistema recuperó qué queda en `pool_provenance.sealed.json` |
| D — adjudicación | Sólo los desacuerdos | Etiqueta final, κ de Cohen. Si κ < 0,6 en una clase, se revisa la guía y se re-etiqueta |

- **La etapa A se entrega antes de ver el pool**, para que la interpretación humana no se ancle en lo que recuperó el sistema.
- **La salida de una regla (E0) no es evidencia.** Para juzgar el valor o el ámbito de una cifra hace falta E2.
- **El conjunto relevante es pooled más búsqueda independiente, no exhaustivo** (`exhaustive=false`, salvo prueba). El Recall@8 es relativo al conjunto juzgado.

El contrato de etiquetas (`discover-g1-relevance-labels-v1`, `goldContract.ts`) rechaza:

- `labelSource` distinto de `HUMAN_ADJUDICATED`;
- revisores repetidos o un adjudicador que no sea distinto;
- un pool sin búsqueda independiente;
- exhaustividad sin prueba;
- consultas sin etiqueta;
- etiquetas atadas a otro archivo de consultas (por sha256).

## F. Benchmark y métricas

El harness está en `scripts/catalog-v2/discover-g1/gold-benchmark.ts` y el plan prerregistrado en [evaluation_plan.json](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/evaluation_plan.json). Cada motor (V0 en `6469eca`, V0.2 congelado o una versión futura) corre en su propio árbol y proceso aislados, con las variantes A CURRENT_SEARCH, B LEXICAL_PLUS, C HYBRID_OLD y D HYBRID_FIX2.

| Grupo | Métricas |
| --- | --- |
| Recuperación | Recall@8, Precision@3 (estricta y laxa), MRR, nDCG@8 graduado, relevantes omitidos y cobertura juzgada del top-8 |
| Verificación | Restricciones correcta e incorrectamente satisfechas, VERIFIED que violan una restricción (sobrecertificación), falsas exclusiones (cota inferior), POSSIBLE relevantes, abstenciones justificadas o no |
| Interpretación | Exactitud de intención (mapeo fijo), ambigüedades reconocidas, perdidas o espurias, restricciones faltantes o espurias, necesidad de repregunta |
| Operación | Latencia (primera ejecución y warm, p50/p95), bytes de respuesta diagnóstica y de agente, truncación, degradación, hidratación acotada |

**Estadística:**

- Bootstrap por consultas con semilla fija; las comparaciones V0 frente a V0.2 y C frente a D son **pareadas por consulta**.
- Las clases con n < 20 son sólo descriptivas.
- Con 80–100 consultas, una clase de unas 15 tiene un IC95 de exactitud de aproximadamente ±20 pp. QA2 calculó que hacen falta unas 300 unidades para ±2 pp. **Esta evaluación es una primera evaluación independiente, no una certificación del 95 % por clase.**

**Verificación del harness** ([benchmark_readiness.json](../../artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1/benchmark_readiness.json)):

| Comprobación | Resultado |
| --- | --- |
| Smoke sobre las 120 consultas de **desarrollo**, sin métricas de relevancia | Reproduce las listas ranked, verified y possible del run V0 congelado y de V0.2 r2 en 480/480 consulta×variante cada uno |
| `run` y `compare` sobre un fixture **sintético** de 80 consultas, en el scratchpad de la sesión | Funciona de punta a punta. Las salidas se descartaron |
| `--mode=run` sobre el held-out actual | Termina con `EVALUATION_REFUSED: HELDOUT_INVALID, RELEVANCE_LABELS_MISSING` |
| Pruebas | 10/10 de G1 (`tests/unit/discover-g1`, fixtures rotulados como sintéticos) y 86/86 de las suites Discover existentes, sin cambios |
| Análisis estático | `tsc --noEmit` y ESLint: PASS |

**Límites del harness:**

- Las falsas exclusiones son una cota inferior: los diagnósticos listan como máximo 50 productos REJECTED por consulta.
- La interpretación sólo se compara en restricciones estructuradas; las de texto libre se cuentan como no comparables.
- La latencia es in-process, no end-to-end.
- Commercial Truth no se observa.

## G. Integridad

Se capturó `protected_before.json` antes de crear cualquier archivo, y `protected_after.json` al cierre. La comparación está en `protected_comparison.json`.

- HEAD sin cambios.
- Código Discover sin cambios (`dc955cf7…`).
- Las 19 entradas (fuente y bundles) sin cambios.
- Evidencia V0 congelada sin cambios.
- **Ningún archivo protegido preexistente cambió ni se eliminó.** Los únicos archivos protegidos agregados son este informe (en `docs/catalog-v2`) y el directorio nuevo `artifacts/catalog-v2/discover-g1/`. La captura excluye `discover-g1` del corpus, como el run V0.2 excluyó el suyo.
- Las entradas preexistentes de `git status` siguen presentes.

Archivos nuevos de G1 fuera de `artifacts/`:

- `scripts/catalog-v2/discover-g1/` (10 scripts);
- `tests/unit/discover-g1/goldHarness.test.ts`;
- este informe.

## H. Riesgos y pendientes

1. **Inputs humanos.** No hay consultas autorizadas, R1, R2, adjudicador ni revisores de dominio asignados. Es el bloqueo principal.
2. **INCLUDES_USER y los `max_load_kg` sin calificador** (DR-01) pueden estar sobrecertificando hoy. Antes de cualquier exposición, conviene la revisión humana de DR-01 y DR-03.
3. **El informe V0.2 §J atribuye mal las 48 transiciones.** La corrección está documentada en DR-05; el informe V0.2 no se editó.
4. **Fragilidad de entradas.** El bundle productivo vive en Temp; hay copia archivada.
5. **Identidad de código.** V0.2 sigue sin commit. Hay una propuesta de tag de referencia en la sección B.
6. **El léxico tiene 101 entradas pendientes de revisión de dominio.** Este paquete no las cubre; sólo cubre las seis reglas pedidas.
7. **No se inició V0.3 ni se integró R4.**

## I. Cierre

```text
V02_AUTHORITY_FROZEN=YES
DOMAIN_REVIEW_PACKETS_READY=YES
DOMAIN_REVIEW_HUMAN_COMPLETED=NO
HELDOUT_COLLECTION_READY=YES
HELDOUT_QUERIES_AVAILABLE=NO
INDEPENDENT_RELEVANCE_LABELS_AVAILABLE=NO
BENCHMARK_HARNESS_READY=YES
RETRIEVAL_QUALITY_VALIDATED=NO
PRODUCTION_ROLLOUT=DEFER
```

**Disposición: READY_FOR_HUMAN_DOMAIN_REVIEW.**

- La revisión de dominio puede empezar ya con los seis expedientes.
- La pista de benchmark está `BLOCKED_BY_MISSING_REVIEW_INPUTS`: faltan consultas independientes, revisores y etiquetas. No hay ninguna dependencia técnica pendiente; la autoridad, el replay, el harness y las plantillas están verificados.

No se declara calidad certificada. V0.2 sigue siendo una arquitectura técnicamente verificada (separa la recuperación de la certificación, es reproducible y tiene 0 violaciones duras contra sus propias proyecciones). **Que devuelva los productos adecuados no está demostrado.**

## Reproducción

```bash
RUN=artifacts/catalog-v2/discover-g1/run-20261008-discover-g1-r1
npx tsx scripts/catalog-v2/discover-v0/integrity.ts --out=$RUN/protected_before.json --exclude=artifacts/catalog-v2/discover-g1
npx tsx scripts/catalog-v2/discover-g1/freeze-v02-authority.ts --out-dir=$RUN
npx tsx scripts/catalog-v2/discover-g1/replay-v02.ts --authority-dir=$RUN --replay-dir=$RUN/v02-replay
npx tsx scripts/catalog-v2/discover-g1/domain-review-evidence.ts --run-dir=$RUN/domain-review
npx tsx scripts/catalog-v2/discover-g1/build-review-pool.ts --mode=template --out-dir=$RUN
npx tsx scripts/catalog-v2/discover-g1/write-constraint-picklist.ts --out=$RUN/constraint_picklist.json
npx tsx scripts/catalog-v2/discover-g1/gold-benchmark.ts --mode=smoke --dev-queries=120 \
  --engines="V0@6469eca2009a0cbdd897d43deadb1a7ff0d10c2c,V0.2@6469eca2009a0cbdd897d43deadb1a7ff0d10c2c+$RUN/v02-code" \
  --reference-v02=artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/results_v02.json \
  --reference-v0=artifacts/catalog-v2/discover-v0/run-20261008-discover-v0-r1 --out=$RUN/harness-smoke/harness_smoke.json
npx tsx scripts/catalog-v2/discover-g1/gold-benchmark.ts --mode=readiness --heldout=$RUN/heldout_queries.json --out=$RUN/harness-smoke/readiness_check.json
npx tsx scripts/catalog-v2/discover-v0/integrity.ts --out=$RUN/protected_after.json --exclude=artifacts/catalog-v2/discover-g1
npx tsx scripts/catalog-v2/discover-g1/compare-protected.ts --before=$RUN/protected_before.json --after=$RUN/protected_after.json --out=$RUN/protected_comparison.json
npx vitest run --config vitest.config.ts tests/unit/discover-g1 tests/unit/discover-v0 tests/integration/discover-v0
```

Cuando existan las consultas y las etiquetas: `build-review-pool.ts --mode=build`, luego `gold-benchmark.ts --mode=readiness`, `--mode=run` y `--mode=compare` (ver `evaluation_plan.json`). No se ejecutó `npm test`, porque su `pretest` reconstruye snapshots de Training bajo `data/`.
