# CAT-DISCOVER-V0 — Prototipo funcional y benchmark comparativo

Fecha: 2026-10-08, America/Santiago. Vertical slice **offline y experimental** de `catalog.discover`. Run oficial: `artifacts/catalog-v2/discover-v0/run-20261008-discover-v0-r1/`. **Disposición: IMPLEMENTED_WITH_LIMITATIONS. PRODUCTION_ROLLOUT=DEFER.**

Producción no se tocó: no hubo SSH/EC2, deploy, activación, lectura ni escritura de punteros, rebuild de bundles, cambios de ontología/clasificadores/snapshots ni etiquetas humanas. Se agregaron módulos nuevos, pruebas, un script npm y evidencia en una ruta aislada (ignorada por Git). No se hizo commit ni push.

## Resumen ejecutivo

- **Se implementó** `catalog.discoverV0(request, context)` con los nueve componentes pedidos, sobre la fuente congelada `sha256:f505ea3f…` y los dos bundles reales: productivo `sha256:84c85d15…` y candidate FIX2 `sha256:bddf7f36…`. Ambos se cargan desde bytes verificados por hash, sin puntero ni activación.
- **El experimento A/B/C/D está completo:** 120 consultas × 4 variantes, determinismo 120/120 en las cuatro, 0 regresiones de coincidencia exacta, **0 restricciones duras violadas en candidatos elegibles** (re-verificación independiente) y 0 cambios en 1.339 archivos protegidos.
- **No existe gold de relevancia adjudicado.** Por eso no se calcula Precision@K, Recall@K, MRR ni nDCG, y **no se declara ganador**. Lo que sí se puede afirmar con evidencia:
  - **A → B (léxico):** B recupera algo en 103/120 consultas frente a 47/120 de A, incluidos productKey, sinónimos y coincidencias parciales. Pero B no puede verificar restricciones: 72 de sus ítems top-8 contradicen una proyección admitida (p. ej., kettlebells de 24 kg para «20 kg»).
  - **B → C (semántica estructurada):** la lista de candidatos verificados pasa de 31 a 84 consultas con resultados. Además, el híbrido separa explícitamente lo no verificable (precio, compatibilidad, specs calificadas, familias no admitidas).
  - **C → D (FIX2):** cambia la lista elegible en 17/120 consultas, concentradas en dominadas, racks, poleas y soporte de barra. Corrige casos que el bundle viejo certificaba erróneamente (racks de almacenamiento como BARBELL_SUPPORT; paralelas como PULL_UP).
- **El híbrido empeora la experiencia en 12 consultas donde la búsqueda actual sí mostraba productos.** El motor nuevo los deja «no verificables» por calificadores de Specs («cada disco», «cada mancuerna»), por la frontera CABLE_MACHINE (QA2-R1), por J-Cups no admitidos (QA2-R5) o por packs. Además, en «soporte de barra» **excluye** productos que la búsqueda mostraba, por un defecto del léxico nuevo (sección K).
- **Costo:** respuestas de 11 KB en p50 (≈2,8k tokens estimados) frente a 227 bytes de la búsqueda offline. La latencia in-process es de 2,7 ms en p50 y 24 ms en p95.

```text
DISCOVER_V0_IMPLEMENTED=YES
OFFLINE_DEMO_EXECUTABLE=YES
FOUR_WAY_COMPARISON_COMPLETE=YES
EXACT_MATCH_REGRESSION=NO
HARD_CONSTRAINT_VIOLATIONS=0
INDEPENDENT_RELEVANCE_GOLD_AVAILABLE=NO
RETRIEVAL_QUALITY_VALIDATED=NO
PRODUCTION_ROLLOUT=DEFER
```

## A. Arquitectura implementada

```text
DiscoverV0Request{need, limit≤8}
  → DiscoverQueryInterpreter            (determinista, léxico gobernado discover-v0-lexicon-v1)
  → ExactCandidateGenerator             (productKey, referencia, nombre exacto)
  → LexicalCandidateGenerator           (BM25F sobre nombre/marca/categorías y features confiables + nominal tiers)
  → StructuredCandidateGenerator        (solo HYBRID: familia, disciplina, contexto, ejercicio, función, anatomía derivada, specs)
  → CandidateFusion                     (unión por productKey)
  → gate de relevancia de subtipo        (léxico, ambos modos)
  → CandidateRanker (preliminar) → CommercialHydrator (acotado a 40) → ConstraintVerifier → CandidateRanker
  → DiscoverResultAssembler             (candidates ≤8 / unverifiedCandidates ≤8 / excluidos solo contados)
```

| Componente | Archivo |
| --- | --- |
| Contratos y versión `catalog-discover-v0.1` | [contracts.ts](../../src/application/catalog/discover-v0/contracts.ts) |
| Léxico gobernado | [lexicon.ts](../../src/application/catalog/discover-v0/lexicon.ts) |
| Intérprete | [queryInterpreter.ts](../../src/application/catalog/discover-v0/queryInterpreter.ts) |
| Documento e índice | [retrievalDocument.ts](../../src/application/catalog/discover-v0/retrievalDocument.ts) |
| Generadores + fusión | [generators.ts](../../src/application/catalog/discover-v0/generators.ts) |
| Verificador de restricciones | [constraintVerifier.ts](../../src/application/catalog/discover-v0/constraintVerifier.ts) |
| Ranker | [ranker.ts](../../src/application/catalog/discover-v0/ranker.ts) |
| Ensamblador | [resultAssembler.ts](../../src/application/catalog/discover-v0/resultAssembler.ts) |
| Orquestador `discoverV0` | [discoverV0.ts](../../src/application/catalog/discover-v0/discoverV0.ts) |
| Hidratador comercial (puerto) | [commercialHydrator.ts](../../src/application/catalog/discover-v0/commercialHydrator.ts) |
| Baseline A | [currentSearchBaseline.ts](../../src/application/catalog/discover-v0/currentSearchBaseline.ts) |
| Métricas | [evaluation.ts](../../src/application/catalog/discover-v0/evaluation.ts) |
| Loader read-only con verificación de hashes | [frozenInputLoader.ts](../../src/infrastructure/catalog/discover-v0/frozenInputLoader.ts) |
| CLI / workspace / benchmark | [discover-spike.ts](../../scripts/catalog-v2/discover-v0/discover-spike.ts), [workspace.ts](../../scripts/catalog-v2/discover-v0/workspace.ts), [benchmark.ts](../../scripts/catalog-v2/discover-v0/benchmark.ts) |

**Contrato.** La respuesta sigue la forma pedida (`interpretation`, `candidates`, `unverifiedCandidates`, `completeness`, `lineage`). Se adaptó así:

- `completeness` agrega `eligibleCount`, `unverifiedCount`, `excludedCount`, `strategy` y `noResultReason`.
- `lineage` agrega los snapshots de Product Semantics, Training V2 y Specs, la huella del índice, la versión del léxico y el hash del contrato de Admission.
- Cada candidato lleva `scoreComponents` y `commercial`, que offline es siempre `{status: NOT_OBSERVED, reason: OFFLINE_RUN_NO_COMMERCIAL_TRUTH}`.
- Los textos explicativos son códigos cortos: como máximo 5 `whyMatched` de 120 caracteres y 5 referencias de evidencia.

**Modos.** `LEXICAL_PLUS` usa sólo los generadores exacto y léxico y nunca evalúa restricciones técnicas (`NOT_EVALUATED_IN_LEXICAL_MODE`). `HYBRID` agrega el generador estructurado y la verificación.

## B. Componentes reutilizados

| Reutilizado | Uso |
| --- | --- |
| `CatalogContractService.search` real (matchNominal + compareNominal + filtros) | Variante A completa |
| `nominalTokens`, `significantTokens`, `sqlLikeFragments`, `matchNominal` | Tokenización común a las cuatro variantes; nominal tier de B/C/D; emulación del predicado SQL |
| `evaluateAdmissionSnapshot` + `semanticObligationContractV2` (`sha256:125caf…`) | Admission por dimensión de cada documento (no se reimplementó) |
| Registry Training V2 (`deriveExerciseSemantics`) | Anatomía derivada sólo desde ejercicios |
| Ontología v3 (`isResidualOntologyTag`) | Exclusión de OTHER residual |
| `bundleId`, `bundleManifestSchema` | Verificación de identidad de ambos bundles |
| `DISCOVERY_EXCLUDED_PRODUCT_IDS` | Mismo universo que `catalog.search` |
| `DEFAULT_PRODUCT_SEARCH_SYNONYMS` (product-intent) | Sinónimos heredados, marcados `INHERITED_PRODUCTION_TABLE` |
| `CatalogContractService.getProductContext` | Hidratador real de Commercial Truth (probado con dobles; no se usa offline) |

**Diferencias del baseline A respecto del runtime productivo.** Todas se deben a campos ausentes en la extracción congelada y no se compensaron:

- **Sin SKU:** `exact_reference` nunca dispara. Las 5 consultas SKU son `NOT_EVALUABLE_OFFLINE`.
- **Sin descripción corta:** el tier `description` no existe.
- **Sin visibilidad:** los productos activos vigentes se tratan como `listed`.
- **Sin precio/stock:** `priceSummary` es null y la disponibilidad no se observa; el adaptador lo reporta NOT_OBSERVED.
- **Prefiltro SQL:** se emula en memoria con plegado de caso y acentos (superconjunto; decide el servicio).
- **Caché:** se omite la caché de 15 s (una instancia por llamada) para que A/B/C/D midan el mismo trabajo.

No se creó un Commercial Truth paralelo.

## C. Índice de productos (ProductRetrievalDocument V0)

Reglas `retrieval-document-v0.1`:

- **Identidad:** `productKey = P{productId}`.
- **Universo:** el de `catalog.search`, es decir vigente, activo y fuera de la política de exclusión. Son **884** productos (886 activos − P444, P505), idénticos para A/B/C/D (se verifica en cada run).
- **Campos indexados** (sólo los disponibles):
  - nombre;
  - marca (feature 62);
  - categorías fuente con trust SEMANTIC_STRONG (peso 1) o SEMANTIC_WEAK (0,5);
  - valores de features con trust SEMANTIC (0,5).
- **Ausentes en la fuente congelada:** SKU, descripción comercial, precio y stock. No se inventaron.
- Las **clasificaciones no son texto léxico**: no pueden convertirse en coincidencia textual.
- **Por documento** se guardan:
  - familia primaria/secundarias, disciplinas, contextos y estado de clasificación;
  - Training V2 (estado de resolución, ejercicios con relación, funciones, anatomía derivada del registry);
  - Specs normalizadas con `qualifier` según SPEC_QUALIFIER_POLICY_V0;
  - Admission por superficie (product discovery, exercise, function, spec filtering por key, unified, lexical);
  - estado de evidencia negativa y obligaciones familiares incumplidas;
  - presencia vigente/histórica, actividad y motivo de exclusión del universo.
- **Dos índices comparables** se construyen con el mismo código y la misma fuente:

| Índice | Bundle | Huella del índice | Construcción |
| --- | --- | --- | --- |
| C (productivo) | sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8 | sha256:7a50fcca6b135dee22288b59b7c4a53a71a935e58e9ab472ced6f8b21c37028a | 3,31 s |
| D (candidate FIX2) | sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f | sha256:af312f38c56be5d7361325f90de047968bddde8bc52af536492eceb9ad2cedae | 2,80 s |

La huella **léxica** es idéntica en ambos (`sha256:da45eed1…`): las diferencias C/D sólo pueden venir de las proyecciones. Ambos manifests verifican esquema, `bundleId` recalculado, `sourceExtractionId` y el `contentHash` de Product Semantics, Training V2 y Specs. Trust se consume desde los CSV de la fuente verificados por hash. Relationships/capabilities se declaran UNAVAILABLE en ambos.

**SPEC_QUALIFIER_POLICY_V0.** Un valor `parsed` cuyo texto crudo contiene palabras distintas del número, la unidad o (sólo en dimensiones) las etiquetas Largo/Ancho/Alto/Profundidad queda **calificado**. Ejemplos: «cada disco», «el par», «aprox.», «incluido el peso de usuario», «Barra Pull Up:». Un valor calificado puede recuperar un candidato, pero nunca certificar una restricción.

## D. Contrato del intérprete

El intérprete es determinista y acotado. Separa `hardConstraints`, `softPreferences`, `recognizedConcepts` y `unrecognizedTerms`, y registra cada término con estado RECOGNIZED, CONSTRAINT, FILLER o UNKNOWN.

1. **Patrones tipados** (consumen tokens):
   - precio máximo (`menos de 50 mil`, `hasta $120.000`);
   - peso de usuario (`persona/usuario de N kg`);
   - carga (`soporte/soporta N kg`);
   - dimensiones con operador y conversión m/mm→cm (`menos de 1.3 m de largo` → `assembled_length_cm ≤ 130`).
2. **Léxico por coincidencia más larga:** familias, ejercicios, funciones, anatomía (sólo los MUSCLE_GROUP/BODY_REGION del registry), disciplinas, contextos y marcadores (compatibilidad, preferencia, comercial, relleno, no modelado).
3. **Una medida suelta en kg** se vuelve `weight_kg` sólo si se nombró una familia de carga (KETTLEBELL, DUMBBELL, WEIGHT_PLATE, BARBELL, BALL_BAG). En otro caso queda UNKNOWN y se conserva como texto. Las libras **no se convierten** en V0.
4. **Sinónimos léxicos gobernados:** pasada separada que no consume tokens.
5. **Reglas de rol:**
   - Disciplina y contexto de uso son siempre preferencias (alcance contractual de los tags).
   - «idealmente/preferiblemente» vuelve preferencias los conceptos siguientes.
   - `compatible con X` y `<familia> para <familia>` generan COMPATIBILITY.
   - `<familia> con <familia>` genera BUNDLE_COMPONENT (composición de packs no modelada).
   - «parecido/alternativa», objetivos («bajar de peso», «lo mejor») y «talla» generan restricciones bloqueantes UNSUPPORTED.
   - Un término de **subtipo** no modelado («j cups», «agarre para polea») exige que el producto lo mencione en su texto fuente. Es un filtro de relevancia léxica, nunca una certificación.
   - Una consulta sin ninguna estructura reconocida recibe `NOMINAL_TEXT`: sólo es elegible lo que contiene todos los términos en el nombre, como en `catalog.search`.
6. **Coincidencia exacta** (nombre o productKey de un único producto): las restricciones duras se degradan a preferencias. Las coincidencias exactas dominan.

**Léxico** `discover-v0-lexicon-v1`: 106 entradas, `sha256:96d5695d…`. Toda entrada declara procedencia (`PRODUCT_INTENT_SYNONYMS`, `CLASSIFIER_NAME_VOCABULARY` con su ruleId, `REGISTRY_CANONICAL_NAME` o `DISCOVER_V0_TRANSLATION`) y estado de revisión. Todas, salvo las heredadas, están `PENDING_DOMAIN_REVIEW`. Un test verifica que cada código existe en los registries. Las entradas UNMODELED (`sentadilla`, `remo`, `press de banca`, `pesas`) se registran como UNKNOWN en lugar de mapearse a un código cercano.

**Autoconsistencia** (expectativas del mismo autor; no es gold): 110/120. Sólo dos desacuerdos son de fondo:

- Q065 «equipo de cardio»: vacío de vocabulario; no se asigna familia.
- Q073 «almacenamiento para discos»: la regla de propósito lo convierte en COMPATIBILITY.

Los otros ocho son de convención de etiquetas (subtipo, UNKNOWN, restricciones bloqueantes agregadas después de escribir las expectativas).

## E. Estrategias de recuperación

| Generador | Técnica | Emite |
| --- | --- | --- |
| Exacto | productKey `P\d+`; referencia (vacía offline); nombre normalizado idéntico | `EXACT_PRODUCT_KEY`, `EXACT_REFERENCE`, `EXACT_NAME` |
| Léxico | BM25F (k1=1,2, b=0,75) con pesos por campo NAME 3 / BRAND 1 / CATEGORY 1·trust / FEATURE 0,5; plural plegado; expansión por prefijo sólo si el término no existe (≤20, peso 0,5); sinónimos gobernados (0,8); tier nominal reutilizando `matchNominal` (exact_name 4, phrase 3, all_tokens 2, −0,5 vía sinónimo) | `BM25`, `NOMINAL_*`, `GOVERNED_SYNONYM`, `PREFIX_EXPANSION` |
| Estructurado | Buckets por `axis:code` sobre Product Semantics (no residual, no EXCLUDED), Training V2 (ejercicio DIRECT/SUPPORTED, función DIRECT/FAMILY_DERIVED, anatomía derivada del registry) y specs parsed que satisfacen el operador. Las specs refinan el pool de conceptos si existe. | `CONCEPT_MATCH`, `SPEC_MATCH`, `SPEC_MATCH_QUALIFIED`, con source, matchedConcept, evidence, confidence y admission |

Penalización de coincidencias débiles:

- una medida sola nunca genera candidatos;
- la cobertura menor a 1/3 de los tokens (con más de 2 tokens) descarta el candidato;
- el score se amortigua por `0,25 + 0,75·cobertura`.

Todos los generadores devuelven sólo productKeys más señales. Ninguno lee ni produce precio, promoción o stock.

## F. Ranking

Fusión lineal explicable con dominancia exacta. Los **pesos se fijaron a priori y no se ajustaron con el benchmark** (no hay gold contra el cual ajustarlos):

- Primero se ordena por nivel exacto: productKey/referencia, luego nombre exacto.
- `L = 0,6·BM25/max(BM25 del pool) + 0,4·tier_nominal/4`.
- `S` = media, sobre las restricciones técnicas duras, de: SATISFIED 1 (0,85 si SUPPORTED, FAMILY_DERIVED o STRONGLY_INFERRED); UNKNOWN con señal de proyección 0,3; resto 0.
- `P` = fracción de preferencias técnicas SATISFIED.
- HYBRID = `0,45L + 0,45S + 0,10P` si hay restricciones técnicas duras; si no, `0,60L + 0,40P`. LEXICAL_PLUS = `L`.
- Desempates: menos tokens en el nombre, luego productId.

Las señales comerciales no participan en la relevancia (no existen offline).

## G. Restricciones y evidencia

Estados posibles: SATISFIED, VIOLATED, UNKNOWN y UNSUPPORTED. Cada afirmación se evalúa contra la proyección dueña, **condicionada por la Admission de esa dimensión**. Unified Admission nunca se usa como filtro global.

| Restricción | SATISFIED sólo si | UNKNOWN / UNSUPPORTED cuando | VIOLATED cuando |
| --- | --- | --- | --- |
| Tipo de producto | Familia (primaria o secundaria) asignada y PRODUCT_SEMANTIC_DISCOVERY ADMITTED y sin obligación familiar incumplida | No admitida; OTHER/parcial; obligación familiar incumplida (FAMILY_CLAIM_CONSISTENCY_V0); el nombre nombra el tipo pero la familia admitida es otra | Familia admitida distinta y el nombre no la contradice; EXCLUDED_NON_PRODUCT |
| Ejercicio / función | Assignment DIRECT/SUPPORTED (ejercicio) o DIRECT/FAMILY_DERIVED (función) y discovery ADMITTED | Assignment no admitido; ONTOLOGY_GAP, DATA_GAP o AMBIGUOUS; negativa ABSENT; SEMANTIC_COMPLETE sin ese código | VERIFIED_NO_APPLICABLE_CAPABILITY con negativa PRESENT y sin assignments |
| Anatomía | Ejercicio admitido cuyo registry deriva el músculo o la región | Cualquier otro caso: una negativa nunca certifica «no entrena X» | — |
| Spec | Un único valor parsed, sin calificador y con SPEC_FILTERING de esa key ADMITTED | Falta; ambiguous/unsupported; varios valores; calificador; key no admitida | Valor certificado fuera del operador |
| Precio / stock | Commercial Truth real observada (hidratador) | Offline siempre UNKNOWN `COMMERCIAL_TRUTH_NOT_OBSERVED` | Valor observado fuera del límite / not_sellable |
| Compatibilidad / sustitución | — | Siempre UNSUPPORTED: relationships UNAVAILABLE | — |
| Composición de pack | — | Siempre UNKNOWN: no modelada | — |
| Necesidad no modelada / talla | — | Siempre UNSUPPORTED | — |
| `NOMINAL_TEXT` | Todos los términos en el nombre (relevancia nominal, no afirmación técnica) | Coincidencia parcial | — |

**Elegibilidad:**

- `candidates`: todas las restricciones duras están SATISFIED.
- `unverifiedCandidates`: ninguna VIOLATED y al menos una UNKNOWN o UNSUPPORTED.
- Excluidos: alguna VIOLATED. Sólo se cuentan y se registran en el diagnóstico.

Una restricción técnica en una coincidencia sólo textual nunca queda SATISFIED: el test lo verifica con un producto llamado «20kg» sin specs. La única excepción es `NOMINAL_TEXT`, que es explícitamente una condición de relevancia nominal, no técnica.

Nota sobre FAMILY_CLAIM_CONSISTENCY_V0: no es una corrección por producto. Usa el propio contrato de obligaciones. Si la familia exige una dimensión de Training (`effectiveRequirement=REQUIRED`) y Admission reporta `REQUIRED_ASSIGNMENT_MISSING`, la afirmación de familia no se certifica. Afecta a 42 productos del universo con el bundle productivo y a 16 con FIX2, incluidos los 16 accesorios pasivos activos de QA2-R1.

## H. Resultados A/B/C/D

Benchmark `discover-v0-benchmark-v1` ([benchmark_queries.v1.json](../../scripts/catalog-v2/discover-v0/benchmark/benchmark_queries.v1.json), sha256 `581ae835…`). Son 120 consultas: 30 exactas/nombre/SKU, 20 sinónimos, 25 conceptuales, 20 con unidades, 15 adversariales y 10 fuera de alcance.

Estado del gold:

| Estado | Consultas | Uso |
| --- | --- | --- |
| ENGINEERING_FIXTURE | 31 | Mecánicas: 25 copian nombres o productKeys reales; 6 vienen de las regex de `gold-v0`. Dos son typos, medidas sin gating. |
| NOT_EVALUABLE_OFFLINE | 5 | SKU ausente en la fuente |
| NOT_ADJUDICATED | 84 | Sin gold; sólo diagnóstico |

| Métrica (120 consultas) | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| Consultas con ≥1 candidato principal* | 47 | 31 | 84 | 85 |
| Consultas con cualquier lista | 47 | 103 | 108 | 108 |
| Media candidatos principales / no verificables | 0,97 / — | 1,58 / 4,44 | 4,51 / 3,77 | 4,54 / 3,61 |
| Determinismo | 120/120 | 120/120 | 120/120 | 120/120 |
| Fixtures con gating (29) | 24 | 29 | 29 | 29 |
| Ítems top-8 de recuperación con una restricción dura VIOLATED (post-hoc, juzgado con FIX2) | 5 | 72 | 5 | 0 |
| Sin elegibles: no recuperó nada / sólo no verificables / UNSUPPORTED / comercial | 73 sin match nominal | 17 / 65 / 5 / 2 | 12 / 17 / 5 / 2 | 12 / 16 / 5 / 2 |

\* A: resultados de `catalog.search`, que no verifica restricciones. B/C/D: `candidates`, con todas las restricciones duras SATISFIED. B no verifica restricciones técnicas (salvo `NOMINAL_TEXT`), así que cualquier consulta con otra restricción técnica o comercial deja a B sin candidatos elegibles: es lo esperado, no un fallo.

La métrica post-hoc evalúa con las proyecciones FIX2. **D=0 es tautológico** (la vara es el mismo bundle) y **no demuestra que FIX2 sea más correcto**. Sirve para mostrar que A y B presentan ítems contradichos por proyecciones admitidas.

Por clase (consultas con candidatos principales / con alguna lista / total):

| Clase | A | B | C | D |
| --- | --- | --- | --- | --- |
| EXACT_NAME_SKU | 20/20/30 | 25/26/30 | 25/26/30 | 25/26/30 |
| SYNONYM_LEXICAL | 7/7/20 | 0/19/20 | 17/19/20 | 17/19/20 |
| CONCEPTUAL | 2/2/25 | 4/19/25 | 23/24/25 | 23/24/25 |
| STRUCTURED_UNITS | 9/9/20 | 0/20/20 | 14/20/20 | 15/20/20 |
| ADVERSARIAL | 9/9/15 | 2/15/15 | 5/15/15 | 5/15/15 |
| OUT_OF_SCOPE | 0/0/10 | 0/4/10 | 0/4/10 | 0/4/10 |

Comparación por pares ([pairwise_comparison.csv](../../artifacts/catalog-v2/discover-v0/run-20261008-discover-v0-r1/pairwise_comparison.csv)):

| Par | Lista | Idénticas | Top-1 cambia | Jaccard medio | Agregados / quitados | Vacía→no vacía | No vacía→vacía |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A→B (léxico) | recuperación | 18 | 67 | 0,16 | 610 / 5 | 56 | 0 |
| A→B | principal | 66 | 34 | 0,09 | 166 / 93 | 9 | 25 |
| B→C (estructurada) | recuperación | 57 | 20 | 0,62 | 268 / 217 | 5 | 0 |
| B→C | principal | 49 | 54 | 0,23 | 420 / 69 | 53 | 0 |
| C→D (FIX2) | recuperación | 102 | 2 | 0,93 | 41 / 41 | 0 | 0 |
| C→D | principal | 103 | 3 | 0,90 | 47 / 43 | 1 | 0 |

Los conteos miden cambio, **no calidad**. Por diseño del experimento, más resultados no implican mejores resultados.

## I. Ejemplos reales de consultas y productos

Se muestran 19 consultas representativas. Las 25 están en [representative_comparisons.md](../../artifacts/catalog-v2/discover-v0/run-20261008-discover-v0-r1/representative_comparisons.md) y las 120 en [query_diagnostics.csv](../../artifacts/catalog-v2/discover-v0/run-20261008-discover-v0-r1/query_diagnostics.csv), con top-8, rank, matchedBy, whyMatched, componentes de score, restricciones, motivo sin resultados, latencia y tamaño.

Columnas: top-8 de recuperación de cada variante. ✔ = candidato elegible (todas las duras SATISFIED); ? = no verificable. A no verifica restricciones. Precio y stock: NOT_OBSERVED en todas.

##### Q001 — «Kettlebell Acero 20kg | HWM®»

Interpretación (B/C/D): duras = — · preferencias = SPEC weight_kg EQ 20 (degradada por coincidencia exacta); PRODUCT_TYPE KETTLEBELL (degradada por coincidencia exacta) · sin reconocer = acero, hwm

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 | P186 Kettlebell Acero 20kg / HWM | P186 ✔ Kettlebell Acero 20kg / HWM | P186 ✔ Kettlebell Acero 20kg / HWM | P186 ✔ Kettlebell Acero 20kg / HWM |
| 2 |  | P1845 ✔ Clubbell 20kg / Rising | P1845 ✔ Clubbell 20kg / Rising | P1845 ✔ Clubbell 20kg / Rising |
| 3 |  | P180 ✔ Kettlebell Acero 4kg / HWM | P196 ✔ Kettlebell de Vinilo 20kg | P196 ✔ Kettlebell de Vinilo 20kg |
| 4 |  | P181 ✔ Kettlebell Acero 6kg / HWM | P180 ✔ Kettlebell Acero 4kg / HWM | P180 ✔ Kettlebell Acero 4kg / HWM |
| 5 |  | P182 ✔ Kettlebell Acero 8kg / HWM | P181 ✔ Kettlebell Acero 6kg / HWM | P181 ✔ Kettlebell Acero 6kg / HWM |
| 6 |  | P183 ✔ Kettlebell Acero 10kg / HWM | P182 ✔ Kettlebell Acero 8kg / HWM | P182 ✔ Kettlebell Acero 8kg / HWM |
| 7 |  | P184 ✔ Kettlebell Acero 12kg / HWM | P183 ✔ Kettlebell Acero 10kg / HWM | P183 ✔ Kettlebell Acero 10kg / HWM |
| 8 |  | P185 ✔ Kettlebell Acero 16kg / HWM | P184 ✔ Kettlebell Acero 12kg / HWM | P184 ✔ Kettlebell Acero 12kg / HWM |

Conteos: A=1 resultados · B elegibles/no verificables=176/0 · C=184/0 (excluidos 0) · D=184/0 (excluidos 0) · motivo D sin elegibles: —

Diferencias: Las cuatro variantes ponen P186 en rank 1. A devuelve sólo el producto exacto. En B/C/D la coincidencia exacta degrada las restricciones a preferencias y la lista se completa con kettlebells relacionadas; C/D priorizan las que satisfacen peso 20 y familia. Clubbell P1845 figura como KETTLEBELL porque la regla del clasificador incluye «clubbell».

##### Q021 — «P1543»

Interpretación (B/C/D): duras = — · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P1543 ✔ Power Rack Alpha / HWM | P1543 ✔ Power Rack Alpha / HWM | P1543 ✔ Power Rack Alpha / HWM |

Conteos: A=0 resultados · B elegibles/no verificables=1/0 · C=1/0 (excluidos 0) · D=1/0 (excluidos 0) · motivo D sin elegibles: —

Diferencias: `catalog.search` no resuelve productKey; el generador exacto de discover sí. No hay diferencia entre C y D.

##### Q031 — «kettlebell 20 kilos»

Interpretación (B/C/D): duras = SPEC weight_kg EQ 20; PRODUCT_TYPE KETTLEBELL · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 | P186 Kettlebell Acero 20kg / HWM | P186 ? Kettlebell Acero 20kg / HWM | P186 ✔ Kettlebell Acero 20kg / HWM | P186 ✔ Kettlebell Acero 20kg / HWM |
| 2 | P196 Kettlebell de Vinilo 20kg | P196 ? Kettlebell de Vinilo 20kg | P196 ✔ Kettlebell de Vinilo 20kg | P196 ✔ Kettlebell de Vinilo 20kg |
| 3 | P1202 Set 20kg Mancuernas Eco + Kettlebell ( | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( | P1845 ✔ Clubbell 20kg / Rising | P1845 ✔ Clubbell 20kg / Rising |
| 4 |  | P1845 ? Clubbell 20kg / Rising | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( |
| 5 |  | P2090 ? Martillo Thor 20kg / Rising | P2321 ? PACK KETTLEBELL START 18KG HWM | P2321 ? PACK KETTLEBELL START 18KG HWM |
| 6 |  | P180 ? Kettlebell Acero 4kg / HWM | P2323 ? PACK KETTLEBELL APEX 60KG HWM | P2323 ? PACK KETTLEBELL APEX 60KG HWM |
| 7 |  | P181 ? Kettlebell Acero 6kg / HWM | P2324 ? PACK KETTLEBELL HERO 100KG HWM | P2324 ? PACK KETTLEBELL HERO 100KG HWM |
| 8 |  | P182 ? Kettlebell Acero 8kg / HWM | P2322 ? PACK KETTLEBELL EVO 36KG HWM | P2322 ? PACK KETTLEBELL EVO 36KG HWM |

Conteos: A=3 resultados · B elegibles/no verificables=0/37 · C=3/10 (excluidos 24) · D=3/10 (excluidos 24) · motivo D sin elegibles: —

Diferencias: A devuelve P186, P196 y P1202 porque sus nombres contienen «kettlebell» y «20kg». B no verifica nada. C/D certifican P186, P196 y P1845 (`weight_kg=20`, sin calificador, familia admitida). P1202 queda no verificable porque su spec es el peso total del set («incluido discos y barras»); los packs de kettlebells sin spec de peso también.

##### Q037 — «pesa rusa 16 kg»

Interpretación (B/C/D): duras = SPEC weight_kg EQ 16; PRODUCT_TYPE KETTLEBELL · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P195 ? Kettlebell de Vinilo 16kg | P195 ✔ Kettlebell de Vinilo 16kg | P195 ✔ Kettlebell de Vinilo 16kg |
| 2 |  | P185 ? Kettlebell Acero 16kg / HWM | P185 ✔ Kettlebell Acero 16kg / HWM | P185 ✔ Kettlebell Acero 16kg / HWM |
| 3 |  | P180 ? Kettlebell Acero 4kg / HWM | P2321 ? PACK KETTLEBELL START 18KG HWM | P2321 ? PACK KETTLEBELL START 18KG HWM |
| 4 |  | P181 ? Kettlebell Acero 6kg / HWM | P2323 ? PACK KETTLEBELL APEX 60KG HWM | P2323 ? PACK KETTLEBELL APEX 60KG HWM |
| 5 |  | P182 ? Kettlebell Acero 8kg / HWM | P2324 ? PACK KETTLEBELL HERO 100KG HWM | P2324 ? PACK KETTLEBELL HERO 100KG HWM |
| 6 |  | P183 ? Kettlebell Acero 10kg / HWM | P2322 ? PACK KETTLEBELL EVO 36KG HWM | P2322 ? PACK KETTLEBELL EVO 36KG HWM |
| 7 |  | P184 ? Kettlebell Acero 12kg / HWM | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( |
| 8 |  | P186 ? Kettlebell Acero 20kg / HWM | P1203 ? Set 30kg Mancuernas Eco + Kettlebell ( | P1203 ? Set 30kg Mancuernas Eco + Kettlebell ( |

Conteos: A=0 resultados · B elegibles/no verificables=0/42 · C=2/10 (excluidos 30) · D=2/10 (excluidos 30) · motivo D sin elegibles: —

Diferencias: A no devuelve nada: ningún nombre contiene «pesa rusa». B recupera por sinónimo gobernado pero no verifica, y mezcla kettlebells de 4 a 20 kg. C/D certifican sólo las de 16 kg (P195, P185) y separan los packs sin peso.

##### Q051 — «algo para entrenar espalda»

Interpretación (B/C/D): duras = ANATOMY BACK · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  |  | P1035 ✔ Barra Dominadas Puerta / FullFit | P1035 ✔ Barra Dominadas Puerta / FullFit |
| 2 |  |  | P2091 ✔ Pull Over Beast / Obelix | P2091 ✔ Pull Over Beast / Obelix |
| 3 |  |  | P177 ✔ Barra Pull Ups 1.0 / HWM | P177 ✔ Barra Pull Ups 1.0 / HWM |
| 4 |  |  | P300 ✔ Par Barras Paralelas 17cm / HWM | P503 ✔ Remo Bajo V8 Series / Obelix |
| 5 |  |  | P301 ✔ Barras Paralelas 34cm (Par) / HWM | P1267 ✔ Polea Alta MO 2.0 Obelix |
| 6 |  |  | P302 ✔ Barras Paralelas 70cm (Par) / HWM | P1268 ✔ Remo Sentado MO 2.0 Obelix |
| 7 |  |  | P503 ✔ Remo Bajo V8 Series / Obelix | P1503 ✔ Remo Bajo MO 2.0 / Obelix |
| 8 |  |  | P1267 ✔ Polea Alta MO 2.0 Obelix | P2092 ✔ T-Bar Row Beast / Obelix |

Conteos: A=0 resultados · B elegibles/no verificables=0/0 · C=42/17 (excluidos 0) · D=45/5 (excluidos 0) · motivo D sin elegibles: —

Diferencias: A y B no recuperan nada: ningún texto contiene «espalda». C/D usan la anatomía que el registry deriva de los ejercicios. En C entran las paralelas P300–P302 (PULL_UP del bundle viejo → BACK); FIX2 les retira PULL_UP y entran las máquinas de remo P1268, P1503 y P2092.

##### Q052 — «algo para hacer dominadas»

Interpretación (B/C/D): duras = EXERCISE PULL_UP · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P1035 ? Barra Dominadas Puerta / FullFit | P1035 ✔ Barra Dominadas Puerta / FullFit | P1035 ✔ Barra Dominadas Puerta / FullFit |
| 2 |  | P1858 ? Barra Pull Up de Muro / Rising | P1858 ✔ Barra Pull Up de Muro / Rising | P1858 ✔ Barra Pull Up de Muro / Rising |
| 3 |  | P2007 ? Barra Pull Up Accesorio Alpha / HWM | P1705 ✔ Barra Pull Up Para Puerta 2.0 / Forza | P2007 ✔ Barra Pull Up Accesorio Alpha / HWM |
| 4 |  | P1705 ? Barra Pull Up Para Puerta 2.0 / Forza | P1856 ✔ Rack Multifuncional Pull Up / Dip Bar  | P1705 ✔ Barra Pull Up Para Puerta 2.0 / Forza |
| 5 |  | P1810 ? Barra Pull Up Multigrip Accesorio Delt | P528 ✔ Banco Abdominal/Fondo y Dominada MO Se | P1810 ✔ Barra Pull Up Multigrip Accesorio Delt |
| 6 |  | P2017 ? Barra Pull Up Multigrip Accesorio Alph | P177 ✔ Barra Pull Ups 1.0 / HWM | P2017 ✔ Barra Pull Up Multigrip Accesorio Alph |
| 7 |  | P1856 ? Rack Multifuncional Pull Up / Dip Bar  | P1501 ✔ Dual Dominada / Fondo Asistida MO 2.0  | P1856 ✔ Rack Multifuncional Pull Up / Dip Bar  |
| 8 |  | P784 ? Par Agarres OCR Pull Up Bars de Madera | P1181 ✔ Agarre OCR Monkey Rope 60cm 38mm (Unid | P784 ✔ Par Agarres OCR Pull Up Bars de Madera |

Conteos: A=0 resultados · B elegibles/no verificables=0/50 · C=28/22 (excluidos 0) · D=30/18 (excluidos 2) · motivo D sin elegibles: —

Diferencias: A no devuelve nada: la búsqueda nominal exige «algo» y «hacer» en el nombre. B recupera por texto y sinónimo sin verificar. De C a D entran P2007, P1810, P2017 y P784 (FIX2 los resuelve con PULL_UP). P528 y P1501 siguen elegibles en D, pero bajan del top-8.

##### Q058 — «maquina de poleas»

Interpretación (B/C/D): duras = PRODUCT_TYPE CABLE_MACHINE · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P1427 ? Polea de Muro 1.0 ZR Series / PROmachi | P1427 ✔ Polea de Muro 1.0 ZR Series / PROmachi | P1427 ✔ Polea de Muro 1.0 ZR Series / PROmachi |
| 2 |  | P1887 ? Polea Alta/Remo ZR Series / PROmachine | P1887 ✔ Polea Alta/Remo ZR Series / PROmachine | P1887 ✔ Polea Alta/Remo ZR Series / PROmachine |
| 3 |  | P1348 ? Agarre Multipropósito - Accesorio Pole | P176 ✔ Crossover Lat Pulldown ZR Series / PRO | P176 ✔ Crossover Lat Pulldown ZR Series / PRO |
| 4 |  | P437 ? Soga de Tríceps - Accesorio Polea / Ob | P1974 ✔ Pack Crossover + Banco Regulable MO 2. | P1974 ✔ Pack Crossover + Banco Regulable MO 2. |
| 5 |  | P455 ? Barra Corta Recta - Accesorio Polea /  | P1516 ✔ Polea Cruzada MO 2.0 / Obelix | P1516 ✔ Polea Cruzada MO 2.0 / Obelix |
| 6 |  | P466 ? Agarre Remo Neutro - Accesorio Polea / | P2139 ✔ Polea Dual Multifuncional 70kg ZR Seri | P2139 ✔ Polea Dual Multifuncional 70kg ZR Seri |
| 7 |  | P1343 ? Agarre Ergonómico Neutro - Accesorio P | P2142 ✔ Polea Alta/Remo 70kg ZR Series / PROma | P2142 ✔ Polea Alta/Remo 70kg ZR Series / PROma |
| 8 |  | P1344 ? Agarre Ergonómico Medio - Accesorio Po | P495 ✔ Polea Cruzada V8 Series / Obelix | P495 ✔ Polea Cruzada V8 Series / Obelix |

Conteos: A=0 resultados · B elegibles/no verificables=0/200 · C=23/37 (excluidos 141) · D=29/31 (excluidos 141) · motivo D sin elegibles: —

Diferencias: A no devuelve nada. B mezcla estaciones y agarres pasivos sin distinguirlos. C/D certifican sólo estaciones; los agarres (P1348, P437, P455, P466…) quedan no verificables por `FAMILY_OBLIGATION_UNMET`: CABLE_MACHINE sin CABLE_RESISTANCE (QA2-R1). D tiene 29 elegibles frente a 23 de C porque FIX2 resuelve las poleas de rack.

##### Q059 — «rack para sentadillas»

Interpretación (B/C/D): duras = PRODUCT_TYPE RACK_CAGE (subtipo) · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P930 ? Bulgarian Squat (Accesorio Jaula Hell  | P1707 ✔ Squat Rack Ajustable Con Soporte De Fo | P1536 ✔ Squat Rack Delta / HWM |
| 2 |  | P1536 ? Squat Rack Delta / HWM | P1535 ✔ Atril de Sentadillas Delta / HWM | P1545 ✔ Squat Rack Magnum / HWM |
| 3 |  | P1545 ? Squat Rack Magnum / HWM | P1544 ✔ Atril de Sentadillas Magnum / HWM | P1540 ✔ Squat Rack Alpha / HWM |
| 4 |  | P1540 ? Squat Rack Alpha / HWM | P1539 ✔ Atril de Sentadillas Alpha / HWM | P1512 ✔ Squat Rack MO 2.0 / Obelix |
| 5 |  | P1512 ? Squat Rack MO 2.0 / Obelix | P1121 ✔ Atril de Sentadillas 1.0 (Par) / Forza | P761 ✔ Squat Rack Lite Series / HWM |
| 6 |  | P761 ? Squat Rack Lite Series / HWM | P1536 ? Squat Rack Delta / HWM | P1707 ✔ Squat Rack Ajustable Con Soporte De Fo |
| 7 |  | P1707 ? Squat Rack Ajustable Con Soporte De Fo | P1545 ? Squat Rack Magnum / HWM | P1535 ✔ Atril de Sentadillas Delta / HWM |
| 8 |  | P1535 ? Atril de Sentadillas Delta / HWM | P1540 ? Squat Rack Alpha / HWM | P1544 ✔ Atril de Sentadillas Magnum / HWM |

Conteos: A=0 resultados · B elegibles/no verificables=0/23 · C=5/7 (excluidos 11) · D=10/2 (excluidos 11) · motivo D sin elegibles: —

Diferencias: A no devuelve nada. B pone primero «Bulgarian Squat (Accesorio Jaula…)» por el sinónimo sentadilla→squat. C certifica atriles y P1707, pero deja UNKNOWN los Squat Rack P1536, P1545 y P1540: su obligación familiar estaba incumplida en el bundle viejo. D los certifica y los elegibles suben de 5 a 10.

##### Q060 — «soporte de barra»

Interpretación (B/C/D): duras = TRAINING_FUNCTION BARBELL_SUPPORT · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 | P2003 Soporte de Barra x1 Accesorio Alpha /  | P1814 ? Soporte de Barra x1 Accesorio Delta /  | P1707 ✔ Squat Rack Ajustable Con Soporte De Fo | P1707 ✔ Squat Rack Ajustable Con Soporte De Fo |
| 2 | P1814 Soporte de Barra x1 Accesorio Delta /  | P1815 ? Soporte de Barra x2 Accesorio Delta /  | P1543 ✔ Power Rack Alpha / HWM | P1543 ✔ Power Rack Alpha / HWM |
| 3 | P2002 Soporte de Barra x2 Accesorio Alpha /  | P2002 ? Soporte de Barra x2 Accesorio Alpha /  | P2058 ✔ Wall Rack Plegable Alpha / HWM | P2058 ✔ Wall Rack Plegable Alpha / HWM |
| 4 | P1815 Soporte de Barra x2 Accesorio Delta /  | P2003 ? Soporte de Barra x1 Accesorio Alpha /  | P1415 ✔ Set 10 Barras Rectas Peso Fijo PU (10  | P1537 ✔ Half Rack Delta / HWM |
| 5 |  | P1817 ? Soporte Para Fondos Accesorio Delta /  | P434 ✔ Set 10 Barras Peso Fijo Pu (desde 10kg | P1538 ✔ Power Rack Delta / HWM |
| 6 |  | P2004 ? Dip Horns Soporte Para Fondos Accesori | P1856 ✔ Rack Multifuncional Pull Up / Dip Bar  | P1546 ✔ Half Rack Magnum / HWM |
| 7 |  | P1707 ? Squat Rack Ajustable Con Soporte De Fo | P1183 ✔ Pack 105kg Mancuernas Hexagonales + Ra | P1547 ✔ Power Rack Magnum / HWM |
| 8 |  | P2000 ? Par Soportes de Discos Olímpicos Acces | P1939 ✔ Pack 8 Pares de Mancuernas (2.5 a 20kg | P1541 ✔ Half Rack Alpha / HWM |

Conteos: A=4 resultados · B elegibles/no verificables=0/200 · C=24/210 (excluidos 0) · D=19/81 (excluidos 111) · motivo D sin elegibles: —

Diferencias: A devuelve los «Soporte de Barra … Accesorio» (P2003, P1814, P2002, P1815) por nombre. El léxico interpreta «soporte de barra» como la función BARBELL_SUPPORT (defecto, sección K), así que D excluye esos accesorios por negativa PRESENT y presenta racks. C certificaba además sets y packs con rack de almacenamiento (P1415, P434, P1183, P1939), que FIX2 corrige.

##### Q064 — «algo compacto para departamento»

Interpretación (B/C/D): duras = — · preferencias = USE_CONTEXT SMALL_SPACE · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  |  | P1117 ✔ Banco Regulable Plegable 1.0 / Forza | P1117 ✔ Banco Regulable Plegable 1.0 / Forza |
| 2 |  |  | P1447 ✔ Banco Regulable Plegable 2.0 / Forza | P1447 ✔ Banco Regulable Plegable 2.0 / Forza |
| 3 |  |  | P1548 ✔ Banco Regulable Plegable Delta / HWM | P1548 ✔ Banco Regulable Plegable Delta / HWM |
| 4 |  |  | P2052 ✔ Banco Plano Plegable 1.0 / Forza | P2052 ✔ Banco Plano Plegable 1.0 / Forza |
| 5 |  |  | P2058 ✔ Wall Rack Plegable Alpha / HWM | P2058 ✔ Wall Rack Plegable Alpha / HWM |
| 6 |  |  | P1858 ✔ Barra Pull Up de Muro / Rising | P1858 ✔ Barra Pull Up de Muro / Rising |
| 7 |  |  | P1883 ✔ Banco Plano Plegable ZR Series / PROma | P1883 ✔ Banco Plano Plegable ZR Series / PROma |
| 8 |  |  | P2095 ✔ Rack de Muro Almacenamiento Funcional  | P2095 ✔ Rack de Muro Almacenamiento Funcional  |

Conteos: A=0 resultados · B elegibles/no verificables=0/0 · C=17/0 (excluidos 0) · D=17/0 (excluidos 0) · motivo D sin elegibles: —

Diferencias: No hay restricción dura, sólo la preferencia SMALL_SPACE. A y B no devuelven nada: ningún nombre dice «compacto» ni «departamento». C/D ordenan por la preferencia y presentan bancos y racks plegables. C y D coinciden.

##### Q076 — «pesa rusa de 20 kg»

Interpretación (B/C/D): duras = SPEC weight_kg EQ 20; PRODUCT_TYPE KETTLEBELL · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P186 ? Kettlebell Acero 20kg / HWM | P186 ✔ Kettlebell Acero 20kg / HWM | P186 ✔ Kettlebell Acero 20kg / HWM |
| 2 |  | P196 ? Kettlebell de Vinilo 20kg | P196 ✔ Kettlebell de Vinilo 20kg | P196 ✔ Kettlebell de Vinilo 20kg |
| 3 |  | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( | P1845 ✔ Clubbell 20kg / Rising | P1845 ✔ Clubbell 20kg / Rising |
| 4 |  | P1845 ? Clubbell 20kg / Rising | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( |
| 5 |  | P2090 ? Martillo Thor 20kg / Rising | P2321 ? PACK KETTLEBELL START 18KG HWM | P2321 ? PACK KETTLEBELL START 18KG HWM |
| 6 |  | P180 ? Kettlebell Acero 4kg / HWM | P2323 ? PACK KETTLEBELL APEX 60KG HWM | P2323 ? PACK KETTLEBELL APEX 60KG HWM |
| 7 |  | P181 ? Kettlebell Acero 6kg / HWM | P2324 ? PACK KETTLEBELL HERO 100KG HWM | P2324 ? PACK KETTLEBELL HERO 100KG HWM |
| 8 |  | P182 ? Kettlebell Acero 8kg / HWM | P2322 ? PACK KETTLEBELL EVO 36KG HWM | P2322 ? PACK KETTLEBELL EVO 36KG HWM |

Conteos: A=0 resultados · B elegibles/no verificables=0/42 · C=3/10 (excluidos 29) · D=3/10 (excluidos 29) · motivo D sin elegibles: —

Diferencias: Igual que Q031, pero vía sinónimo. A no devuelve nada. B no verifica e incluye P2090 (Martillo Thor) porque su categoría contiene «Kettlebells». C/D certifican P186, P196 y P1845 y excluyen los pesos distintos de 20 kg.

##### Q081 — «bumper 10 kg»

Interpretación (B/C/D): duras = SPEC weight_kg EQ 10; PRODUCT_TYPE WEIGHT_PLATE (subtipo) · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 | P323 Par Bumper Plates Competición 10kg / H | P824 ? Par Bumper Plates Eco 10kg / HWM | P824 ? Par Bumper Plates Eco 10kg / HWM | P824 ? Par Bumper Plates Eco 10kg / HWM |
| 2 | P824 Par Bumper Plates Eco 10kg / HWM | P830 ? Par Bumper Plates Color Stripe 10kg /  | P830 ? Par Bumper Plates Color Stripe 10kg /  | P830 ? Par Bumper Plates Color Stripe 10kg /  |
| 3 | P100 Par Bumper Plates Classic Black 10kg / | P100 ? Par Bumper Plates Classic Black 10kg / | P100 ? Par Bumper Plates Classic Black 10kg / | P100 ? Par Bumper Plates Classic Black 10kg / |
| 4 | P1458 Par Bumper Plates Classic Color 10kg / | P835 ? Par Bumper Plates Full Color 10kg / HW | P835 ? Par Bumper Plates Full Color 10kg / HW | P835 ? Par Bumper Plates Full Color 10kg / HW |
| 5 | P830 Par Bumper Plates Color Stripe 10kg /  | P840 ? Par Bumper Plates Pink Color 10kg / HW | P840 ? Par Bumper Plates Pink Color 10kg / HW | P840 ? Par Bumper Plates Pink Color 10kg / HW |
| 6 | P835 Par Bumper Plates Full Color 10kg / HW | P1458 ? Par Bumper Plates Classic Color 10kg / | P1458 ? Par Bumper Plates Classic Color 10kg / | P1458 ? Par Bumper Plates Classic Color 10kg / |
| 7 | P840 Par Bumper Plates Pink Color 10kg / HW | P323 ? Par Bumper Plates Competición 10kg / H | P323 ? Par Bumper Plates Competición 10kg / H | P323 ? Par Bumper Plates Competición 10kg / H |
| 8 |  | P823 ? Par Bumper Plates Eco 5kg / HWM | P823 ? Par Bumper Plates Eco 5kg / HWM | P823 ? Par Bumper Plates Eco 5kg / HWM |

Conteos: A=7 resultados · B elegibles/no verificables=0/49 · C=0/43 (excluidos 6) · D=0/43 (excluidos 6) · motivo D sin elegibles: ONLY_UNVERIFIABLE_CANDIDATES

Diferencias: A muestra los 7 bumpers de 10 kg. B, C y D los recuperan, pero ninguno es elegible: la spec publicada es «10 kg. cada disco» (calificada). Es peor para el usuario, aunque correcto según la política.

##### Q083 — «banco para una persona de 150 kg»

Interpretación (B/C/D): duras = SPEC max_user_weight_kg GTE 150; PRODUCT_TYPE BENCH · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P1825 ? Banco Sentadilla Búlgara / Rising | P681 ✔ Banco GHD Glute Ham Developer 1.0 / HW | P681 ✔ Banco GHD Glute Ham Developer 1.0 / HW |
| 2 |  | P2094 ? Banco Multifunción Magnum / HWM | P1825 ? Banco Sentadilla Búlgara / Rising | P1825 ? Banco Sentadilla Búlgara / Rising |
| 3 |  | P1090 ? Banco GHD Ergo 2.0 / HWM | P2094 ? Banco Multifunción Magnum / HWM | P2094 ? Banco Multifunción Magnum / HWM |
| 4 |  | P1091 ? Banco Nórdico 1.0 / HWM | P1090 ? Banco GHD Ergo 2.0 / HWM | P1090 ? Banco GHD Ergo 2.0 / HWM |
| 5 |  | P1112 ? Banco Sentadilla Búlgara / HWM | P1091 ? Banco Nórdico 1.0 / HWM | P1091 ? Banco Nórdico 1.0 / HWM |
| 6 |  | P1337 ? Banco Hip Thrust 2.0 / HWM | P1112 ? Banco Sentadilla Búlgara / HWM | P1112 ? Banco Sentadilla Búlgara / HWM |
| 7 |  | P1338 ? Banco Regulable Negro / KONG | P1337 ? Banco Hip Thrust 2.0 / HWM | P1337 ? Banco Hip Thrust 2.0 / HWM |
| 8 |  | P1549 ? Banco Plano Alpha / HWM | P1338 ? Banco Regulable Negro / KONG | P1338 ? Banco Regulable Negro / KONG |

Conteos: A=0 resultados · B elegibles/no verificables=0/70 · C=1/57 (excluidos 13) · D=1/57 (excluidos 13) · motivo D sin elegibles: —

Diferencias: A y B no tienen elegibles. C/D certifican sólo P681 (`max_user_weight_kg=150`). La mayoría de los bancos publica `max_load` «incluido el peso de usuario» (calificado) o no publica peso de usuario, y uno no se infiere desde el otro.

##### Q088 — «barra de dominadas para usuario de 120 kg»

Interpretación (B/C/D): duras = SPEC max_user_weight_kg GTE 120; EXERCISE PULL_UP · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P1858 ? Barra Pull Up de Muro / Rising | P1858 ✔ Barra Pull Up de Muro / Rising | P1858 ✔ Barra Pull Up de Muro / Rising |
| 2 |  | P2007 ? Barra Pull Up Accesorio Alpha / HWM | P1856 ✔ Rack Multifuncional Pull Up / Dip Bar  | P1810 ✔ Barra Pull Up Multigrip Accesorio Delt |
| 3 |  | P1705 ? Barra Pull Up Para Puerta 2.0 / Forza | P1810 ? Barra Pull Up Multigrip Accesorio Delt | P1856 ✔ Rack Multifuncional Pull Up / Dip Bar  |
| 4 |  | P1810 ? Barra Pull Up Multigrip Accesorio Delt | P1181 ✔ Agarre OCR Monkey Rope 60cm 38mm (Unid | P784 ✔ Par Agarres OCR Pull Up Bars de Madera |
| 5 |  | P2017 ? Barra Pull Up Multigrip Accesorio Alph | P1182 ✔ Agarre OCR Monkey Rope 80cm 38mm (Unid | P1578 ✔ Par Agarres OCR Pull Up Bars de Madera |
| 6 |  | P1035 ? Barra Dominadas Puerta / FullFit | P784 ? Par Agarres OCR Pull Up Bars de Madera | P777 ✔ Par Agarres OCR Pull Up Balls de Mader |
| 7 |  | P1856 ? Rack Multifuncional Pull Up / Dip Bar  | P1578 ? Par Agarres OCR Pull Up Bars de Madera | P1386 ✔ Par Agarres OCR Pull Up Balls de Mader |
| 8 |  | P784 ? Par Agarres OCR Pull Up Bars de Madera | P777 ? Par Agarres OCR Pull Up Balls de Mader | P12 ✔ Barra Pull Ups Multigrip 2.0 / HWM |

Conteos: A=0 resultados · B elegibles/no verificables=0/200 · C=9/188 (excluidos 3) · D=12/77 (excluidos 111) · motivo D sin elegibles: —

Diferencias: De C a D entran módulos y agarres OCR resueltos por FIX2 (P1810, P784, P1578, P777, P1386, P12) y salen paralelas y monkey ropes; los elegibles pasan de 9 a 12. El peso de usuario ≥120 está certificado por spec en cada uno.

##### Q096 — «agarre para polea»

Interpretación (B/C/D): duras = PRODUCT_TYPE MACHINE_ATTACHMENT (subtipo) · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 | P1348 Agarre Multipropósito - Accesorio Pole | P1348 ? Agarre Multipropósito - Accesorio Pole | P1348 ? Agarre Multipropósito - Accesorio Pole | P1348 ? Agarre Multipropósito - Accesorio Pole |
| 2 | P1345 Agarre Ergonómico Amplio - Accesorio P | P466 ? Agarre Remo Neutro - Accesorio Polea / | P466 ? Agarre Remo Neutro - Accesorio Polea / | P466 ? Agarre Remo Neutro - Accesorio Polea / |
| 3 | P1344 Agarre Ergonómico Medio - Accesorio Po | P1343 ? Agarre Ergonómico Neutro - Accesorio P | P1343 ? Agarre Ergonómico Neutro - Accesorio P | P1343 ? Agarre Ergonómico Neutro - Accesorio P |
| 4 | P1343 Agarre Ergonómico Neutro - Accesorio P | P1344 ? Agarre Ergonómico Medio - Accesorio Po | P1344 ? Agarre Ergonómico Medio - Accesorio Po | P1344 ? Agarre Ergonómico Medio - Accesorio Po |
| 5 | P466 Agarre Remo Neutro - Accesorio Polea / | P1345 ? Agarre Ergonómico Amplio - Accesorio P | P1345 ? Agarre Ergonómico Amplio - Accesorio P | P1345 ? Agarre Ergonómico Amplio - Accesorio P |
| 6 | P2195 Pack 3 Agarres Ergonómicos - Accesorio | P2195 ? Pack 3 Agarres Ergonómicos - Accesorio | P2195 ? Pack 3 Agarres Ergonómicos - Accesorio | P2195 ? Pack 3 Agarres Ergonómicos - Accesorio |
| 7 | P462 Agarre Manilla Simple de Acero - Acces | P462 ? Agarre Manilla Simple de Acero - Acces | P462 ? Agarre Manilla Simple de Acero - Acces | P462 ? Agarre Manilla Simple de Acero - Acces |
| 8 | P1349 Agarre Manilla Simple de Caucho - Acce | P1349 ? Agarre Manilla Simple de Caucho - Acce | P1349 ? Agarre Manilla Simple de Caucho - Acce | P1349 ? Agarre Manilla Simple de Caucho - Acce |

Conteos: A=8 resultados · B elegibles/no verificables=0/9 · C=0/8 (excluidos 1) · D=0/8 (excluidos 1) · motivo D sin elegibles: ONLY_UNVERIFIABLE_CANDIDATES

Diferencias: A devuelve exactamente los agarres de polea. B/C/D los recuperan, pero no los certifican: están clasificados CABLE_MACHINE mientras el nombre dice «agarre … accesorio polea» (conflicto entre clasificación y nombre, QA2-R1). No hay elegibles.

##### Q099 — «j cups»

Interpretación (B/C/D): duras = PRODUCT_TYPE MACHINE_ATTACHMENT (subtipo) · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 | P1997 Par J-Cups Accesorio Alpha / HWM | P1807 ? Par J-Cups Accesorio Delta / HWM | P1807 ? Par J-Cups Accesorio Delta / HWM | P1807 ? Par J-Cups Accesorio Delta / HWM |
| 2 | P1807 Par J-Cups Accesorio Delta / HWM | P1997 ? Par J-Cups Accesorio Alpha / HWM | P1997 ? Par J-Cups Accesorio Alpha / HWM | P1997 ? Par J-Cups Accesorio Alpha / HWM |

Conteos: A=2 resultados · B elegibles/no verificables=0/2 · C=0/2 (excluidos 0) · D=0/2 (excluidos 0) · motivo D sin elegibles: ONLY_UNVERIFIABLE_CANDIDATES

Diferencias: A devuelve los dos J-Cups. Están clasificados MACHINE_ATTACHMENT pero no admitidos (evidencia WEAK, QA2-R5), así que en B/C/D quedan no verificables. El gate de subtipo evita que landmines o ankle straps se presenten como J-Cups.

##### Q106 — «rack multifuncional con dominadas y fondos»

Interpretación (B/C/D): duras = PRODUCT_TYPE RACK_CAGE; EXERCISE PULL_UP; EXERCISE DIP · preferencias = — · sin reconocer = multifuncional

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P1856 ? Rack Multifuncional Pull Up / Dip Bar  | P1856 ? Rack Multifuncional Pull Up / Dip Bar  | P1856 ? Rack Multifuncional Pull Up / Dip Bar  |
| 2 |  | P2004 ? Dip Horns Soporte Para Fondos Accesori | P1543 ✔ Power Rack Alpha / HWM | P1543 ✔ Power Rack Alpha / HWM |
| 3 |  | P1059 ? Multifuncional Smith ZR Series / PROma | P2058 ✔ Wall Rack Plegable Alpha / HWM | P2058 ✔ Wall Rack Plegable Alpha / HWM |
| 4 |  | P1817 ? Soporte Para Fondos Accesorio Delta /  | P1707 ? Squat Rack Ajustable Con Soporte De Fo | P1707 ? Squat Rack Ajustable Con Soporte De Fo |
| 5 |  | P1543 ? Power Rack Alpha / HWM | P1537 ? Half Rack Delta / HWM | P1537 ? Half Rack Delta / HWM |
| 6 |  | P2007 ? Barra Pull Up Accesorio Alpha / HWM | P1538 ? Power Rack Delta / HWM | P1538 ? Power Rack Delta / HWM |
| 7 |  | P2058 ? Wall Rack Plegable Alpha / HWM | P1546 ? Half Rack Magnum / HWM | P1546 ? Half Rack Magnum / HWM |
| 8 |  | P1810 ? Barra Pull Up Multigrip Accesorio Delt | P1547 ? Power Rack Magnum / HWM | P1547 ? Power Rack Magnum / HWM |

Conteos: A=0 resultados · B elegibles/no verificables=0/21 · C=2/35 (excluidos 32) · D=2/27 (excluidos 39) · motivo D sin elegibles: —

Diferencias: Hay tres restricciones duras (RACK_CAGE, PULL_UP, DIP) y sólo P1543 y P2058 las cumplen todas. P1856 cumple los dos ejercicios, pero su familia admitida es BODYWEIGHT_GYMNASTICS y su nombre dice «rack»: conflicto, no verificable. P1537 y P1707 no afirman uno de los dos ejercicios.

##### Q109 — «pesas rusas de 20 kg menos de 50 mil»

Interpretación (B/C/D): duras = PRECIO ≤ 50000; SPEC weight_kg EQ 20; PRODUCT_TYPE KETTLEBELL · preferencias = — · sin reconocer = —

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P186 ? Kettlebell Acero 20kg / HWM | P186 ? Kettlebell Acero 20kg / HWM | P186 ? Kettlebell Acero 20kg / HWM |
| 2 |  | P196 ? Kettlebell de Vinilo 20kg | P196 ? Kettlebell de Vinilo 20kg | P196 ? Kettlebell de Vinilo 20kg |
| 3 |  | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( | P1845 ? Clubbell 20kg / Rising | P1845 ? Clubbell 20kg / Rising |
| 4 |  | P1845 ? Clubbell 20kg / Rising | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( | P1202 ? Set 20kg Mancuernas Eco + Kettlebell ( |
| 5 |  | P2090 ? Martillo Thor 20kg / Rising | P2321 ? PACK KETTLEBELL START 18KG HWM | P2321 ? PACK KETTLEBELL START 18KG HWM |
| 6 |  | P180 ? Kettlebell Acero 4kg / HWM | P2323 ? PACK KETTLEBELL APEX 60KG HWM | P2323 ? PACK KETTLEBELL APEX 60KG HWM |
| 7 |  | P181 ? Kettlebell Acero 6kg / HWM | P2324 ? PACK KETTLEBELL HERO 100KG HWM | P2324 ? PACK KETTLEBELL HERO 100KG HWM |
| 8 |  | P182 ? Kettlebell Acero 8kg / HWM | P2322 ? PACK KETTLEBELL EVO 36KG HWM | P2322 ? PACK KETTLEBELL EVO 36KG HWM |

Conteos: A=0 resultados · B elegibles/no verificables=0/42 · C=0/13 (excluidos 29) · D=0/13 (excluidos 29) · motivo D sin elegibles: COMMERCIAL_TRUTH_NOT_OBSERVED

Diferencias: Restricción comercial: sin Commercial Truth observada no hay elegibles. Los kettlebells de 20 kg quedan no verificables con `COMMERCIAL_TRUTH_NOT_OBSERVED`; no se fabrica ningún precio.

##### Q116 — «lo mejor para bajar de peso»

Interpretación (B/C/D): duras = UNMODELED_NEED(lo mejor); UNMODELED_NEED(bajar de peso) · preferencias = — · sin reconocer = lo, mejor, bajar, de, peso

| # | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| 1 |  | P358 ? Par Pesos de Tobillo Gris 1.5kg / Full | P358 ? Par Pesos de Tobillo Gris 1.5kg / Full | P358 ? Par Pesos de Tobillo Gris 1.5kg / Full |
| 2 |  | P360 ? Par Pesos de Tobillo Gris 2kg / FullFi | P360 ? Par Pesos de Tobillo Gris 2kg / FullFi | P360 ? Par Pesos de Tobillo Gris 2kg / FullFi |
| 3 |  | P361 ? Par Pesos de Tobillo Gris 2.5kg / Full | P361 ? Par Pesos de Tobillo Gris 2.5kg / Full | P361 ? Par Pesos de Tobillo Gris 2.5kg / Full |
| 4 |  | P351 ? Pesos de Tobillo Morado 1.5kg (Par) /  | P351 ? Pesos de Tobillo Morado 1.5kg (Par) /  | P351 ? Pesos de Tobillo Morado 1.5kg (Par) /  |
| 5 |  | P353 ? Pesos de Tobillo Morado 2.5kg (Par) /  | P353 ? Pesos de Tobillo Morado 2.5kg (Par) /  | P353 ? Pesos de Tobillo Morado 2.5kg (Par) /  |
| 6 |  | P354 ? Pesos de Tobillo Morado 2kg (Par) / Fu | P354 ? Pesos de Tobillo Morado 2kg (Par) / Fu | P354 ? Pesos de Tobillo Morado 2kg (Par) / Fu |
| 7 |  | P647 ? Barra Recta Peso Fijo PU 10kg / Obelix | P647 ? Barra Recta Peso Fijo PU 10kg / Obelix | P647 ? Barra Recta Peso Fijo PU 10kg / Obelix |
| 8 |  | P648 ? Barra Recta Peso Fijo PU 15kg / Obelix | P648 ? Barra Recta Peso Fijo PU 15kg / Obelix | P648 ? Barra Recta Peso Fijo PU 15kg / Obelix |

Conteos: A=0 resultados · B elegibles/no verificables=0/51 · C=0/51 (excluidos 0) · D=0/51 (excluidos 0) · motivo D sin elegibles: HARD_CONSTRAINT_UNSUPPORTED

Diferencias: A no devuelve nada. B/C/D recuperan «Pesos de Tobillo» por la palabra «peso», pero la necesidad («lo mejor», «bajar de peso») es UNSUPPORTED y todo queda no verificable.

## J. Casos donde el híbrido mejora

1. **Necesidades conceptuales sin nombre de producto.** En 23/25 consultas conceptuales C/D presentan candidatos verificados; A en 2 y B en 4. Ejemplos:
   - Q051 «algo para entrenar espalda»: ANATOMY BACK derivado de PULL_UP, ROW y LAT_PULLDOWN del registry. A y B no devuelven nada.
   - Q052 «algo para hacer dominadas».
   - Q058 «maquina de poleas»: las estaciones P1427, P1887, P176, P1516 y P495 quedan elegibles y los agarres pasivos no verificables.
   - Q064 «algo compacto para departamento»: preferencia SMALL_SPACE; bancos plegables P1117, P1447, P1548.
2. **Sinónimos y unidades.**
   - Q037 «pesa rusa 16 kg»: A no devuelve nada; D presenta P195 y P185 con `weight_kg=16` certificado.
   - Q076 «pesa rusa de 20 kg»: P186, P196, P1845.
3. **Unidades verificadas en lugar de tokens.**
   - Q031 «kettlebell 20 kilos»: A presenta P1202 («Set 20kg Mancuernas + Kettlebell»). D lo deja no verificable porque su spec es «peso total incluido discos y barras».
   - A (Q079) presenta P1943 (pack de 275 kg) para «mancuerna de 25 kg»; ese peso queda VIOLATED en el juicio post-hoc.
4. **Restricciones no verificables explícitas.** Para precio (Q109), compatibilidad (Q107, Q108) y «parecido a P1543» (Q115), el híbrido no presenta candidatos conformes y lo dice (`COMMERCIAL_TRUTH_NOT_OBSERVED`, `HARD_CONSTRAINT_UNSUPPORTED`). A nunca los presenta como conformes, porque no los encuentra, pero tampoco explica por qué.
5. **Búsqueda por productKey.** Q021–Q025: A no soporta productKey; B, C y D devuelven el producto en rank 1.

## K. Casos donde empeora o no puede responder

En **12 consultas** A presentaba resultados y D presenta 0 elegibles: Q033, Q073, Q078, Q079, Q080, Q081, Q095, Q096, Q097, Q099, Q100 y Q105. En todas, los productos de A aparecen en `unverifiedCandidates` de D, con el motivo. Para un agente, el resultado útil queda sólo en esa lista.

1. **Specs calificadas o ambiguas (7 de las 12).**
   - Q033, Q080, Q081 «bumper 10 kg» y Q105: los pesos de discos se publican como «10 kg. cada disco».
   - Q078: los pesos de mancuernas se publican «(cada mancuerna)».
   - La política conservadora deja estos valores UNKNOWN, aunque «10 kg cada disco» sea probablemente lo que pide el usuario (QA2-B5).
   - Q079 y Q095 «mancuernas de 2,5 kg»: specs ambiguous.
2. **Frontera CABLE_MACHINE (QA2-R1).** Q096 «agarre para polea» y Q097 «soga de triceps»: A muestra exactamente los agarres y sogas; D los deja no verificables (`CLASSIFICATION_CONFLICTS_WITH_NAME:CABLE_MACHINE`). Es el comportamiento correcto ante un clasificador dudoso (no certifica), pero es peor para el usuario.
3. **J-Cups (QA2-R5).** Q099: P1807 y P1997 están CLASSIFIED pero no admitidos. A los muestra; D sólo como no verificables.
4. **Packs.** Q100 «pack de mancuernas con rack»: la composición no está modelada (QA2-R4), así que no hay elegibles.
5. **Defecto del léxico nuevo, no del catálogo.** Q060 «soporte de barra» se mapeó a la función BARBELL_SUPPORT, mientras la regla del clasificador (`PF_MACHINE_ATTACHMENT_NAME_V1`) y el propio léxico tratan «soporte para barra» como MACHINE_ATTACHMENT. Resultado: D **excluye** P2003, P1814, P2002 y P1815 («Soporte de Barra … Accesorio»), que A mostraba, porque Training V2 tiene negativa PRESENT para esa función. Es una exclusión basada en una interpretación ambigua. No se corrigió después del run oficial para no ajustar el prototipo al benchmark.
6. **Vacíos de vocabulario.**
   - Q065 «equipo de cardio» no reconoce la familia, aunque C/D devuelven candidatos por la disciplina.
   - Q073 «almacenamiento para discos» queda bloqueado como compatibilidad.
   - Q103 «rueda abdominal» y Q104 «safety squat bar» son productos OTHER y sólo se recuperan léxicamente.
7. **Clasificador heredado.** Q076: Clubbell P1845 aparece certificado como KETTLEBELL porque la regla `PF_KETTLEBELL_NAME_V1` incluye «clubbell». El híbrido hereda las decisiones del clasificador sin poder adjudicarlas.
8. **Exactas con contexto.** Para nombres exactos, A devuelve sólo el producto; B/C/D agregan hasta 7 relacionados (p. ej., otras kettlebells en Q001). El rank 1 nunca cambia, pero la respuesta es más larga.
9. **Fuera de alcance.** En 4/10 consultas B/C/D recuperan algo (p. ej., Q116 → pesos de tobillo) y los dejan **sólo** como no verificables (UNSUPPORTED o coincidencia parcial). Nunca se presentan como elegibles.

## L. Cambios atribuibles a FIX2 (C → D)

El único cambio entre C y D es Training V2 (Product Semantics, Specs y Trust son byte-identical). La lista elegible cambia en 17 consultas:

| Efecto | Consultas | Productos |
| --- | --- | --- |
| Módulos de dominadas pasan a SEMANTIC_COMPLETE y quedan elegibles | Q048, Q052, Q088 | +P2007, +P1810, +P2017 (y P784, P1578, P777, P1386 en Q088) |
| Paralelas pierden PULL_UP (conservan DIP) y dejan de ser elegibles para dominadas/espalda/bíceps | Q048, Q051, Q068, Q088 | −P300, −P301, −P302, −P1452 (P300: `DIP+PULL_UP` → `DIP`) |
| Sets/packs con rack de almacenamiento pierden BARBELL_SUPPORT; half/power racks pasan a SEMANTIC_COMPLETE | Q060 | −P1415, −P434, −P1183, −P1939; +P1537, P1538, P1546, P1547, P1541 |
| Squat racks consistentes con su obligación (C los dejaba UNKNOWN por obligación incumplida) | Q059, Q091, Q092, Q004, Q009, Q018 | Elegibles en Q059: 5→10 (+P1536, P1545, P1540, P1512, P761) |
| Poleas de rack con mecanismo propio | Q015, Q058, Q075 | +P1813, P2006, P2008; elegibles en Q058: 23→29 |
| Dual Bíceps/Tríceps y T-Bar Row resueltos | Q068, Q069, Q012, Q020 | +P1880, +P1886 |
| Accesorio lat pulldown pasivo: la negativa pasa de UNKNOWN a PRESENT | Q049 | P454 era no verificable en C (aparecía en su top-8); en D queda excluido |

FAMILY_CLAIM_CONSISTENCY_V0 deja sin certificar la familia de 42 productos en C y de 16 en D. Esto muestra que FIX2 reduce las contradicciones internas entre familia y obligaciones. **Que el cambio sea correcto no está adjudicado:** QA2 sigue sin etiquetas.

## M. Latencia y costo aproximado

Medición in-process offline (`performance.now`) en la estación del operador: Node v22.23.2, win32/x64, sin HTTP, sin DB y sin red. **No es latencia end-to-end.** Estrategia por consulta y variante: una ejecución inicial, una re-ejecución de determinismo y 5 ejecuciones warm (la re-ejecución cuenta como warm #1); el valor warm es la mediana.

| ms | A | B | C | D |
| --- | --- | --- | --- | --- |
| Primera ejecución p50 / p95 | 1,28 / 2,15 | 2,39 / 25,32 | 3,19 / 22,99 | 2,79 / 23,29 |
| Warm p50 / p95 | 1,16 / 1,80 | 2,22 / 22,81 | 2,83 / 24,92 | 2,66 / 24,24 |
| Primera consulta del proceso | 4,1 | 28,0 | 22,1 | 12,6 |

Etapas warm de D, p50 / p95 en ms:

| Etapa | p50 / p95 |
| --- | --- |
| interpret | 0,08 / 0,14 |
| exact | 0,08 / 0,13 |
| lexical | 1,27 / 19,84 |
| structured | 0,05 / 0,25 |
| verify | 0,11 / 1,18 |
| rank | 0,67 / 3,26 |
| assemble | 0,04 / 0,09 |

El p95 lo domina el generador léxico en consultas con términos muy frecuentes (marca «hwm» en 326 productos y tier nominal sobre el pool de 200).

Arranque en frío:

- carga y verificación de la fuente: 40 ms;
- carga y verificación de cada bundle: 42–45 ms;
- construcción del índice: 2,8–3,3 s, dominada por evaluar Admission sobre 884 productos.

En un servicio, esa construcción iría al hot-reload del bundle, no a la petición.

Tamaño serializado de la respuesta, p50 / p95 / máx en bytes:

| Variante | Bytes | Tokens estimados p50 (bytes/4) |
| --- | --- | --- |
| A | 227 / 2.051 / 3.183 | ≈57 |
| B | 6.646 / 8.687 / 10.290 | ≈1,7k |
| C | 11.162 / 19.115 / 27.929 | ≈2,8k |
| D | 11.166 / 18.720 / 26.588 | ≈2,8k |

Los tokens son una **estimación**, no un consumo medido del modelo. A offline es pequeño también porque no lleva datos comerciales. El costo de D viene de las dos listas de 8 con resultados de restricciones y de las `entries` de interpretación. Hay que compactarlo antes de exponerlo a R4.

## N. Limitaciones por falta de gold

- `INDEPENDENT_RELEVANCE_GOLD_AVAILABLE=NO`: 0 consultas adjudicadas. P@3, R@8, MRR y nDCG@8 están implementados y probados, pero el run los reporta `NOT_COMPUTABLE`.
- Las 31 fixtures son de ingeniería: solo prueban no-regresión de identidad, no relevancia comercial.
- Las proyecciones que juzgan elegibilidad no tienen exactitud estimada (QA2: 0 etiquetas humanas). SATISFIED significa «afirmado por una proyección admitida», no «verdadero».
- **Iteración sobre el mismo benchmark.** Dos corridas de desarrollo (en scratch, no publicadas) motivaron cuatro reglas generales antes del run oficial:
  - gate de subtipo;
  - consistencia familia-obligación;
  - restricciones bloqueantes para necesidades no modeladas, packs y `NOMINAL_TEXT`;
  - uso de la consulta completa en `NOMINAL_TEXT`.

  Las pruebas unitarias detectaron además un bug: la regla de componente se activaba dentro de una cláusula de compatibilidad. No se ajustaron pesos ni vocabulario a consultas concretas, pero las reglas se diseñaron observando categorías de este mismo conjunto. **Hace falta un conjunto de consultas held-out** para medir sin ese sesgo.
- El autor de las expectativas de interpretación es el mismo que el del intérprete.
- La fuente es la observación del 1 de octubre, no el catálogo live. Sin SKU ni descripciones.

## O. Dependencias pendientes

1. **Adjudicación humana:** QA2-B2 y un gold de relevancia por consulta, con doble revisión y adjudicación, sobre un subconjunto held-out.
2. **Specs:** subtipo de calificadores (QA2-B5, B8). Hoy «cada disco» bloquea los casos de peso más frecuentes.
3. **Frontera CABLE_MACHINE / MACHINE_ATTACHMENT** (QA2-B1) y vocabulario de J-Cups (QA2-R5). Requieren decisión de ontología y clasificador, fuera de esta fase.
4. **Política de packs/bundles** (QA2-B7) para responder consultas de composición.
5. **Proyección de relationships verificada:** compatibilidad y sustitución siguen UNSUPPORTED.
6. **Commercial Truth en línea:** el puerto `commercialTruthHydrator` envuelve `getProductContext`, pero no se ejerció contra datos reales en esta fase.
7. **Revisión de dominio del léxico** (106 entradas PENDING): resolver la ambigüedad «soporte de/para barra» (función vs. accesorio) y los vacíos («equipo de cardio», «almacenamiento para»).
8. **SKU/referencia y descripción** en una extracción futura para cubrir la clase exact_sku.
9. **Identidad de código.** Este worktree tiene 14 archivos .ts nuevos sin commit. Un cálculo de codeRef sobre el árbol en disco (no sobre el checkout aprobado) cambiaría. No construir bundles desde este worktree sin aislar el prototipo.
10. **Hallazgo lateral.** `labelEs` de [product-family-tags.ts](../../src/domain/commercial-product-ontology/product-family-tags.ts) contiene texto doblemente codificado (p. ej., «MÃ¡quinas de Poleas»). El prototipo no lo usa, pero cualquier consumidor que muestre esas etiquetas lo heredaría.

## P. Recomendación de siguiente iteración

La arquitectura híbrida con verificación por dimensión es **la única de las cuatro variantes que puede decir qué está verificado y qué no**. A y B no pueden distinguir un kettlebell de 20 kg de uno de 24 kg ni un rack de un rack de almacenamiento. Pero el experimento **no demuestra mejor relevancia**, y en las consultas de peso y accesorios el híbrido es hoy más restrictivo que útil. Propuesta:

1. **Mantener la arquitectura** (exact + lexical + structured + verificador por dimensión) y **descartar vector/RAG** en V1: los casos fallidos se deben a calificadores, frontera de familia, packs y vocabulario, no a semántica latente.
2. **Antes de cualquier rollout:**
   - un gold adjudicado de 60–100 consultas held-out;
   - subtipo de calificadores de Specs con reglas explícitas por familia;
   - corregir el léxico («soporte de/para barra», «equipo de cardio») con revisión de dominio;
   - convertir las exclusiones por negativa PRESENT en no verificables cuando el nombre del producto nombre el concepto, como ya se hace con la familia.
3. **Compactar la respuesta para agentes:** ≤8 elegibles, ≤3 no verificables, sin `entries` y con códigos de motivo. Objetivo menor a 3 KB en p50.
4. **Usar FIX2 (D) como autoridad semántica** cuando su rollout P2.3C se complete. En este benchmark ninguna consulta pasa de tener elegibles en C a no tenerlos en D, y FIX2 elimina certificaciones internamente contradictorias (42 → 16 familias con obligación incumplida). Que esos cambios sean correctos sigue sin adjudicarse.
5. **Integración:** exponer `discoverV0` sólo como superficie interna o diagnóstica detrás del runtime de proyecciones (hot-reload del índice) y con hidratación real de Commercial Truth. No integrar a R4 hasta cerrar el punto 2.

## Reproducción

```bash
npm run catalog:discover:spike -- --query="pesa rusa de 20 kg" --mode=hybrid --bundle=candidate
npm run catalog:discover:spike -- --query="pesa rusa de 20 kg" --compare            # A/B/C/D
npm run catalog:discover:spike -- --query="j cups" --compare --brief
npm run catalog:discover:spike -- --query="P1543" --variant=A --format=json --out=/tmp/x.json
npm run catalog:discover:spike -- --benchmark --run-id=<nuevo-id>                   # JSON + CSV, create-only
npx vitest run --config vitest.config.ts tests/unit/discover-v0 tests/integration/discover-v0
```

- **Rutas de entrada** (overridables): `DISCOVER_V0_SOURCE_DIR`, `DISCOVER_V0_PRODUCTION_BUNDLE_DIR` (por defecto la copia productiva verificada en Temp) y `DISCOVER_V0_CANDIDATE_BUNDLE_DIR`.
- **Escritura:** el benchmark sólo escribe un directorio nuevo (falla si existe) y toma huellas de los insumos antes y después.
- **Validación ejecutada:**
  - `tsc --noEmit` PASS;
  - ESLint sobre los archivos nuevos PASS;
  - pruebas focalizadas 40/40 (32 unitarias sintéticas + 8 de aceptación sobre los bundles reales);
  - pruebas existentes relacionadas (`catalogSearchGoldV0`, `catalogV2Endpoint`, `semanticDiscoveryQueryEndpoint`) 9/9.
- **No ejecutado:** `npm test`, porque su `pretest` reconstruye snapshots de Training V1/V2 bajo `data/`.

Evidencia del run: `benchmark_queries.json`, `benchmark_gold_status.json`, `results_baseline.json`, `results_lexical.json`, `results_hybrid_old.json`, `results_hybrid_fix2.json`, `pairwise_comparison.csv`, `query_diagnostics.csv`, `latency_metrics.json`, `constraint_violations.json`, `lineage.json`, `interpretation_consistency.json`, `representative_comparisons.md`, `summary.json` y `evidence_checksums.json`.
