# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00 — Discovery & Architecture Audit

Fecha de auditoría: 2026-09-03
Alcance: Catalog Service, CRM-Customer-360 y verificación de estado de Customer Profile.
Modo: read-only/audit-first. No se modificaron código, ontología, classifier, snapshots, Sales Agent, Customer Profile ni ranking.

## 1. Veredicto ejecutivo

Clasificación de uso actual: `SEMANTICS_NOT_IN_DISCOVERY_PATH`

Diagnóstico primario: `INTEGRATION_GAP` + `CONTRACT_GAP`
Diagnósticos secundarios: `PLANNER_GAP`
No hay evidencia suficiente para declarar `ONTOLOGY_GAP` ni `SEARCH_GAP`.

Decisión: `TRAINING_SEMANTICS_NEEDED_BUT_INTEGRATION_FIRST`

Siguiente release recomendado: `A00.1 — Runtime semantic discovery integration`.

La semántica de Catalog existe para `PRODUCT_FAMILY`, `DISCIPLINE` y `USE_CONTEXT`, con registry versionado y snapshot publicable. El problema observado no es que el LLM no pueda entender “pecho”, “piernas” o “home gym”; es que el runtime de discovery no entrega esa interpretación como constraints estructuradas a Catalog. Hoy `search_products` usa texto libre y los endpoints semánticos son de inspección.

Conclusión operativa: antes de crear tags nuevos, hay que conectar el runtime con el registry/product facts existentes y hacer explícito el contrato de discovery. La primera extensión funcional de entrenamiento, si la evidencia manual la valida, debe ser `EXERCISE_CAPABILITY` directa y acotada. `BODY_REGION`, `MUSCLE_GROUP`, `TRAINING_PATTERN` y `TRAINING_GOAL` no deben entrar como Product Truth general en esta etapa.

## 2. Checkouts auditados

| Checkout | Path | Branch / HEAD | Status relevante |
|---|---|---|---|
| Catalog | `C:\Users\Goli\Pesas Chile\MS\MS-Stock\services` | `main` / `eb21869` (`feat(catalog): expose product semantics registry`) | limpio al iniciar la auditoría |
| CRM | `C:\Users\Goli\Pesas Chile\CRM-Customer-360` | `develop` / `ff4c7b1` | limpio |
| Customer Profile | `C:\Users\Goli\Pesas Chile\MS\MS-pesaschile-customer-profile` | `main` / `45af344` | conserva un untracked preexistente: `docs/design/CUSTOMER-INTELLIGENCE-AUDIENCE-A03-CRM-WORKSPACE-DESIGN.md`; no se tocó |

No se ejecutaron `pull`, `stash`, `reset`, `commit` ni cambios en los dos repos externos.

## 3. Runtime actual del Sales Agent

### 3.1 Ruta real

La ruta nativa entra por `runNativeAutonomousCycle`. La selección es fail-closed y depende de flags/allowlists. El runtime R3 (`runSalesAgentRuntimeCycle`) y el Agent Tool Loop usan el mismo proveedor/modelo configurado, pero el planner multi-intent está apagado por defecto y además restringido a `BRAIN_AUTONOMOUS_TEST_WA_IDS`. En la ruta Agent Tool Loop, `search_products` es el capability LLM-facing; `explore_catalog` y `recommend_catalog_products` son capabilities separadas.

La cadena observada es:

```text
mensaje WhatsApp
  -> runNativeAutonomousCycle
  -> runNativeAgentToolLoopCycle / runSalesAgentRuntimeCycle
  -> proveedor LLM (tool choice)
  -> Capability Gateway CRM
  -> CatalogPort HTTP adapter
  -> endpoint Catalog
  -> resolver/búsqueda/explore/recommendation de Catalog
  -> observación compacta al LLM
  -> respuesta/fallback
```

El planner multi-intent sólo produce tipos de intención y `queryHint` libre; no produce códigos de ontology ni constraints de entrenamiento.

### 3.2 Trazas de las seis frases

Los argumentos exactos del LLM no están hardcodeados: dependen del proveedor y de la respuesta del modelo. El código valida la forma (`query` string, `limit` opcional), pero no transforma de forma determinista estas frases en tags. Por eso se distingue abajo entre ejemplo comprobado y comportamiento permitido por el contrato vigente.

| Mensaje | Interpretación actual | Tool y argumentos | CRM → Catalog | Participación semántica | Resultado/fallback |
|---|---|---|---|---|---|
| “quiero una barra olímpica” | producto/categoría concreta; puede pedir aclaración de peso o variante | `search_products({query: "barra olimpica"})` es la forma esperada; el benchmark comprobado usa `"barra olimpica 20kg"` | `Capability Gateway search_products` → `resolveProductIntent({query, limit})` → `POST /api/v2/catalog/resolve-product-intent` | no usa `ProductSemanticFact`; el resolver trabaja intent/texto y sus filtros | devuelve `resolved`, `clarification_required` o `no_match`; el LLM responde con productos o pregunta |
| “quiero algo para home gym” | necesidad amplia/recomendación; el planner puede conservar `queryHint: "home gym"` | no existe argumento semántico garantizado; normalmente `search_products({query: "home gym"})` o respuesta/pregunta | mismo `resolve-product-intent` | `HOME_GYM` existe en registry, pero no se envía ni filtra | depende de coincidencia textual; puede pedir tipo/presupuesto |
| “quiero algo para powerlifting” | disciplina/uso, no SKU | no hay mapping contractual a `DISCIPLINE=POWERLIFTING`; el modelo sólo puede emitir query libre o pedir aclaración | mismo endpoint textual | `POWERLIFTING` existe, pero no participa | no hay garantía de recall/precision por disciplina |
| “quiero entrenar piernas” | necesidad funcional ambigua | el test de necesidad ambigua permite responder/preguntar sin tool; si decide buscar, sólo puede usar `search_products` con query libre, por ejemplo `"entrenar piernas"` | `resolve-product-intent` | ninguna; no existe capability de semantic discovery | pregunta por máquina/pesas/presupuesto o devuelve texto coincidente |
| “quiero entrenar pecho” | necesidad funcional ambigua | no hay transformación fija; query libre o aclaración | `resolve-product-intent` si llama tool | ninguna | no puede exigir `CHEST_PRESS`, `PEC_DECK` o una familia semántica |
| “quiero algo para levantar pesas” | modalidad/objetivo amplio | query libre, por ejemplo `"levantar pesas"`, o aclaración; no hay argumento estructurado | `resolve-product-intent` | ninguna; no confundir `BARBELL` con toda la necesidad | depende del texto y de la cobertura del resolver |

Puntos verificables en código: `search_products` recibe `{query, limit?}`; el adapter CRM llama `/api/v2/catalog/resolve-product-intent`; `getProductSemantics` llama `GET /v1/products/:productId/semantics` y sólo se usa en la console. No existe una llamada LLM-facing a `getProductSemantics`, batch semántico, registry ni semantic discovery.

## 4. ¿Product Semantics se usa hoy?

| Consumer / componente | Uso real | Clasificación |
|---|---|---|
| `GET /v1/products/:productId/semantics` | inspección de facts de un producto | `INSPECTION_ONLY` |
| `GET /v1/products/semantics/batch` | lectura batch para consumidores explícitos del contrato | `INSPECTION_ONLY` |
| `GET /v1/products/semantics/registry` | publicación/consulta del vocabulario vigente | `OTHER` / contrato de inspección |
| CRM `httpCatalogAdapter.getProductSemantics` | adapter opcional | `INSPECTION_ONLY` |
| CRM `consoleService` | carga la semántica junto al detalle y recomendaciones para UI | `INSPECTION_ONLY` |
| `search_products` | envía texto al resolver de intent | no usa Product Semantics |
| `explore_catalog` | filtros/orden por categoría, tipo, precio, stock, nombre y disponibilidad | no usa Product Semantics |
| `recommend_catalog_products` | source product + recomendación v2/relaciones comerciales | no usa Product Semantics |
| planner / multi-intent / Sales Agent | tipos de intención y `queryHint` textual | no recibe vocabulario estructurado |
| Customer Profile | no se encontró consumer runtime de estos facts | no conectado |

Respuestas explícitas:

- `search_products` usa Product Semantics: **no**.
- `explore_catalog` usa Product Semantics: **no**.
- `recommend_catalog_products` usa Product Semantics: **no**.
- El planner recibe vocabulario semántico estructurado: **no**.
- El Sales Agent puede emitir constraints semánticas: **no**; sólo `{query, limit}` para búsqueda y los schemas comerciales de cada capability.
- Catalog puede resolver hoy una query estructurada por tags de ontology: **no**. Puede publicar el registry y leer facts, pero no tiene una operación de discovery que reciba esos códigos.

## 5. Ontología vigente y Product Truth

El registry vigente es `commercial-product-ontology-v3`, hash `f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955`. Sus tres ejes son exactamente:

- `PRODUCT_FAMILY`: incluye `BARBELL`, `DUMBBELL`, `BENCH`, `RACK_CAGE`, `CABLE_MACHINE`, `SELECTORIZED_MACHINE`, `PLATE_LOADED_MACHINE`, etc.
- `DISCIPLINE`: incluye `POWERLIFTING`, `CROSSFIT`, `HYROX`, `CALISTHENICS`, `CARDIO_ENDURANCE`, `YOGA_PILATES`, `BOXING_MMA`, `REHABILITATION`.
- `USE_CONTEXT`: incluye `HOME_GYM`, `SMALL_SPACE`, `COMMERCIAL_GYM`, `SEMI_COMMERCIAL_STUDIO`, etc.

Así, conceptualmente, el lenguaje humano puede expresar:

```text
barra -> PRODUCT_FAMILY=BARBELL
home gym -> USE_CONTEXT=HOME_GYM
powerlifting -> DISCIPLINE=POWERLIFTING
```

Lo que falta es el borde de ejecución: CRM no emite esos constraints y Catalog no los recibe para filtrar/rankear. Ampliar la ontología sin cerrar este borde no resolvería los seis casos.

## 6. Evidencia del catálogo real

Dataset auditado: `docs/audits/product-intelligence-exploration/inputs/product_catalog_exploration(2).csv`, con sus category/feature trust maps.

| Población | Conteo |
|---|---:|
| Filas/productos fuente | 2.011 |
| Activos (`active=1`) | 889 |
| `current_catalog` | 1.550 |
| `historical_order_detail_only` | 461 |
| Semántica v3 `CLASSIFIED` | 1.281 |
| `PARTIALLY_CLASSIFIED` | 400 |
| `OTHER` | 317 |
| `EXCLUDED_NON_PRODUCT` | 13 |
| `NEEDS_REVIEW` | 0 |

Los campos de categorías confiables sí describen familias, disciplina y uso. Las features confiables contienen principalmente uso, categoría, carga, motor, dimensiones y capacidades técnicas; no contienen un campo consistente de músculo, región o ejercicio.

La siguiente tabla es un conteo de filas que contienen vocabulario candidato en nombre, categoría o feature estructurada. Es una **cota léxica para priorizar revisión**, no una clasificación ni Product Truth; hay solapamientos y falsos positivos deliberados.

| Candidato | Nombre | Categoría | Feature | Unión |
|---|---:|---:|---:|---:|
| `BODY_REGION` | 92 | 22 | 29 | 124 |
| `MUSCLE_GROUP` | 166 | 34 | 21 | 193 |
| `EXERCISE_CAPABILITY` | 218 | 50 | 42 | 270 |
| `TRAINING_MODALITY` | 563 | 827 | 361 | 1.140 |
| `TRAINING_PATTERN` | 162 | 44 | 49 | 228 |
| `TRAINING_GOAL` | 79 | 552 | 95 | 647 |

Lectura correcta de esos números:

- Los 270 candidatos de `EXERCISE_CAPABILITY` son el mejor punto de partida, pero requieren normalización y revisión. Ejemplos reales: `Lat Pulldown`, `Polea Alta / Remo Bajo`, `Hip Thrust`, `Extensión de Cuádriceps`, `Squat Rack`.
- `BODY_REGION` y `MUSCLE_GROUP` tienen menciones reales, pero muchas provienen de nombres compuestos, categorías comerciales, accesorios o features técnicas; no prueban que todo el producto entrene exclusivamente esa zona.
- `TRAINING_MODALITY` y `TRAINING_GOAL` se inflan con categorías amplias y lenguaje de marketing. No son evidencia suficiente para Product Truth directo.
- Las descripciones tienen muchas menciones potenciales, pero no se elevan a fuente fuerte: son texto libre, marketing y pueden describir ejercicios posibles, no una capacidad garantizada.
- Familias generales con alta venta —barra, mancuerna, banco, rack, cable y bandas— son precisamente las que más se sobreclasificarían si se asignan todos los músculos que podrían trabajar.

La muestra determinista de revisión está en [`training_semantics_review_sample.csv`](./training-semantics/training_semantics_review_sample.csv). Incluye activos, altos ingresos, máquinas específicas, multiuso, borderline, históricos y `OTHER`.

## 7. Evaluación de candidatos

| Eje | Decisión | Evidencia y límite |
|---|---|---|
| `BODY_REGION` | `KEEP_LATER` | Algunas máquinas tienen región explícita, pero para equipos generales sería una inferencia. Derivable desde capacidades validadas; no como tag directo masivo. |
| `MUSCLE_GROUP` | `KEEP_LATER` | Hay señales en nombres (`cuádriceps`, `pectoral`, `lat`, `glúteo`), pero no un feature confiable y consistente. Úsese sólo para máquinas/capacidades explícitas tras revisión. |
| `TRAINING_PATTERN` | `DERIVE` | `PRESS`, `PULL`, `SQUAT`, `HINGE`, etc. son propiedades de ejercicios/capacidades; no deben asignarse automáticamente a una barra, banco o rack. |
| `EXERCISE_CAPABILITY` | `KEEP_V1` | Es el candidato con mejor evidencia directa: nombres de máquinas y ejercicios reconocibles. Primera capa mínima, con estado y provenance. |
| `TRAINING_MODALITY` | `DERIVE` / `KEEP_LATER` | Parte puede derivarse de `PRODUCT_FAMILY` y `DISCIPLINE` (`CARDIO_MACHINE`, `CABLE_MACHINE`, `BODYWEIGHT_GYMNASTICS`), pero el texto de categoría no justifica una taxonomía nueva todavía. |
| `TRAINING_GOAL` | `DROP` por ahora | Fuerza, hipertrofia, conditioning, potencia y movilidad aparecen sobre todo como lenguaje externo/marketing; no hay Product Truth consistente. |

Conceptos relevantes que aparecen por conocimiento externo, pero no están representados con suficiente autoridad estructurada: una barra “sirve” para squat/bench/deadlift; una mancuerna puede trabajar casi cualquier grupo; una banda puede soportar movilidad, asistencia o resistencia; un rack puede soportar múltiples patrones. Ésos son usos posibles, no facts directos del SKU.

## 8. Política de relaciones directas y derivadas

### Política propuesta

- `DIRECT`: el producto declara explícitamente una capacidad en nombre/categoría semántica fuerte o feature estructurada compatible. Ejemplos: `Extensión de Cuádriceps` → `LEG_EXTENSION`; `Lat Pulldown` → `LAT_PULLDOWN`; `Hip Thrust` → `HIP_THRUST`.
- `SUPPORTED`: la familia o configuración soporta una capacidad, pero no garantiza que sea su única o principal finalidad. Ejemplo: rack con accesorios documentados que soporta dominadas; no implica `BACK` directo.
- `DERIVED`: una relación de conocimiento versionada deriva patrón/región/músculo a partir de una capacidad directa. Ejemplo: `LEG_EXTENSION` → `QUADRICEPS`; la relación no se guarda como afirmación primaria del SKU.
- `NOT_MODELLED`: no hay evidencia confiable o el producto es ambiguo/multiuso/accesorio. Se conserva `UNKNOWN`/`UNMODELED`; no se recicla `OTHER` automáticamente.

### Casos difíciles

| Caso | `PRODUCT_FAMILY` actual | Región directa | Músculo directo | Capability posible | Riesgo | Persistencia recomendada |
|---|---|---|---|---|---|---|
| Barra olímpica | `BARBELL` | no | no | `SQUAT`, `BENCH_PRESS`, `DEADLIFT` sólo `SUPPORTED` | muy alto: casi todos los patrones | family directa; capabilities soportadas sólo si hay evidencia de configuración |
| Mancuerna | `DUMBBELL` | no | no | press/row/curl como `SUPPORTED` | muy alto | no músculo; no capability directa genérica |
| Banco regulable | `BENCH` | no | no | apoyo para press/hip thrust como `SUPPORTED` | alto | sólo `SUPPORTED` documentado |
| Rack/jaula | `RACK_CAGE` | no | no | `SQUAT`, `PULL_UP`, `DIPS` si están explícitos | alto | direct capability por configuración; no músculo |
| Polea/cable | `CABLE_MACHINE` | no | no | sólo ejercicios declarados | alto | direct capability por nombre/configuración |
| Multifuncional | `SELECTORIZED_MACHINE` o `PLATE_LOADED_MACHINE` según caso | no | no | sólo módulos explícitos | muy alto | separar módulos/capabilities; no inferir desde “multifunción” |
| Prensa de piernas | `PLATE_LOADED_MACHINE` o `SELECTORIZED_MACHINE` | `LOWER_BODY` derivable | `QUADRICEPS` derivado | `LEG_PRESS` directa | medio | capability directa + mapping derivado |
| Extensión de cuádriceps | `SELECTORIZED_MACHINE` | `LOWER_BODY` derivable | `QUADRICEPS` derivado | `LEG_EXTENSION` directa | bajo | capability directa; músculo derivado |
| Curl femoral | máquina según producto | `LOWER_BODY` derivable | `HAMSTRINGS` derivado | `LEG_CURL` directa | bajo | capability directa; músculo derivado |
| Smith machine | `PLATE_LOADED_MACHINE` | no | no | `SQUAT`/press sólo `SUPPORTED` | alto | no asignar músculo directo |
| Kettlebell | `KETTLEBELL` | no | no | patrones como `SUPPORTED`, no directos | alto | family directa; sin músculo |
| Bandas | `BAND_SUSPENSION` | no | no | asistencia/resistencia sólo si explícito | muy alto | no músculo; capability específica si existe |
| Chest press | `SELECTORIZED_MACHINE` o `PLATE_LOADED_MACHINE` | `UPPER_BODY` derivable | `CHEST` derivado | `CHEST_PRESS` directa | bajo | capability directa + mapping derivado |
| Pec deck | `SELECTORIZED_MACHINE` | `UPPER_BODY` derivable | `CHEST` derivado | capability directa | bajo | capability directa + mapping derivado |
| Lat pulldown | `CABLE_MACHINE` | `UPPER_BODY` derivable | `BACK` derivado | `LAT_PULLDOWN` directa | bajo | capability directa + mapping derivado |
| Row machine | máquina según producto | `UPPER_BODY` derivable | `BACK` derivado | `ROW` directa | bajo | capability directa + mapping derivado |
| Hip thrust machine | máquina/banco según producto | `LOWER_BODY` derivable | `GLUTES` derivado | `HIP_THRUST` directa | medio | capability directa; revisar accesorios |
| Accesorio | `MACHINE_ATTACHMENT`, `ROPE_SLED`, etc. | no | no | sólo lo declarado por el accesorio | muy alto | mantener `NOT_MODELLED` si no hay contexto del equipo compatible |

## 9. ¿Hace falta una capa intermedia?

El modelo simple `PRODUCT → BODY_REGION[] / MUSCLE_GROUP[]` es corto, pero mezcla capacidad biomecánica con intención comercial y convierte todo equipo multiuso en una lista de músculos. Es difícil de auditar, poco explainable y destruye discriminación.

Se recomienda una capa intermedia mínima:

```text
PRODUCT
  -> direct EXERCISE_CAPABILITY (evidence-backed)
  -> SUPPORTED capability/pattern (bounded, optional)
  -> versioned DERIVED mapping
       capability -> TRAINING_PATTERN
       capability -> BODY_REGION / MUSCLE_GROUP
  -> Catalog semantic discovery
```

La capa no necesita una ontología biomecánica completa. La primera versión puede contener sólo capabilities explícitas y un mapping pequeño, versionado y revisable. Esto preserva precisión, auditabilidad, extensibilidad, ranking explainable y evita que “puede usarse para” se vuelva Product Truth.

## 10. Contrato conceptual LLM ↔ Catalog

El LLM debe interpretar lenguaje y Catalog debe resolver constraints. El nombre recomendado para una futura operación es `POST /api/v2/catalog/semantic-discovery`; `search-by-semantics` también sería válido, pero `semantic-discovery` expresa mejor que recibe criterios ya interpretados. No debe llamarse intent resolution si la interpretación ya pertenece al LLM.

Request conceptual, no implementado:

```json
{
  "schemaVersion": "catalog.semantic-discovery.v1",
  "ontology": {
    "productSemanticsRegistryVersion": "commercial-product-ontology-v3",
    "productSemanticsRegistryHash": "f2de79f...bdb955"
  },
  "requirements": [
    { "axis": "PRODUCT_FAMILY", "codes": ["BARBELL"], "mode": "required", "match": "any" },
    { "axis": "USE_CONTEXT", "codes": ["HOME_GYM"], "mode": "preferred", "match": "any" },
    { "axis": "TRAINING", "codes": ["LEG_PRESS"], "mode": "preferred", "match": "any" }
  ],
  "commercial": { "budgetMax": null, "inStockOnly": true },
  "options": { "limit": 5 }
}
```

Reglas necesarias:

- `required` es filtro duro; `preferred` sólo rank signal explicable.
- Dentro de un requisito `match=any` es OR; entre requisitos distintos la combinación es AND.
- El contrato debe distinguir `DIRECT`, `SUPPORTED`, `DERIVED` y exigir qué estados son aceptables.
- `classification confidence` no se mezcla con `training relevance`; la primera es confianza de evidencia, la segunda es categoría de relación (`PRIMARY`, `SECONDARY`, `SUPPORTED`) si algún día se necesita.
- Tag/código desconocido debe devolver `INVALID_CONSTRAINT`, no ampliar silenciosamente ni buscar texto.
- Criterios vacíos deben ser inválidos para semantic discovery; el caller debe usar `search_products`/`explore_catalog` para browse general.
- La respuesta debe devolver snapshot/registry lineage, filtros aplicados, exclusions y razones por producto.

La primera integración debería reutilizar el registry/hash y los facts publicados sin modificar el contrato A01. Los training facts, si se crean, deben versionarse por separado hasta que exista evidencia de que comparten ciclo de publicación y gobernanza.

## 11. Boundary: `search_products` versus semantic discovery

- Producto, SKU, marca o categoría explícita: `search_products`.
- Necesidad amplia (“quiero entrenar piernas”): semantic discovery cuando exista; hoy requiere aclaración/fallback.
- “Quiero máquina para piernas”: semantic discovery con capability/región preferida y preferencia de equipo; no mapping fijo a prensa.
- “Quiero una prensa de piernas”: `search_products` puede resolver el nombre exacto; semantic discovery específica sería equivalente cuando exista `LEG_PRESS`.
- “Quiero algo para home gym/powerlifting”: semantic discovery usando `USE_CONTEXT`/`DISCIPLINE`, no un query textual como único mecanismo.

Estas son reglas de selección de capability, no un diccionario hardcodeado de frases a SKU. DeepSeek no debe contener “piernas → prensa”; sólo debe emitir criterios estructurados válidos.

## 12. Persistencia recomendada

Recomendación inicial: **snapshot separado de training semantics**, relacionado por `productId`, no ampliar ahora `ProductSemanticSnapshot` ni el contrato A01.

```text
TrainingSemanticRegistry
TrainingSemanticRelationship[]
  productId
  capabilityCode
  relationType: DIRECT | SUPPORTED | DERIVED
  evidence[]
  classifierVersion
  reviewState: AUTO | HUMAN_REVIEW | ACCEPTED | REJECTED
  sourceProductSemanticSnapshotId?
TrainingSemanticSnapshot
  snapshotId / semanticChecksum / generatedAt / activatedAt
  ontologyVersion / ontologyHash
  UNKNOWN / UNMODELED handling
manualOverrides
```

Razón: training semantics tiene relaciones, provenance, revisión y lifecycle distintos a los tres ejes comerciales. Un snapshot separado permite iterar sin romper `PRODUCT_FAMILY`, `DISCIPLINE`, `USE_CONTEXT`, A01, consumidores actuales ni fallback de snapshots ausentes. El link opcional al snapshot comercial preserva lineage sin hacer equivalentes ambos modelos.

## 13. Estrategia de clasificación inicial

Si A00.1 confirma la necesidad, el pipeline para unos 2.000 productos debe ser:

1. reglas deterministas sobre nombres y features estructuradas;
2. mappings de categorías confiables;
3. evidencia de nombre explícita para capabilities;
4. inferencia por family sólo para `SUPPORTED`, nunca para músculo directo;
5. adjudicación asistida por LLM sólo como propuesta, no como autoridad;
6. validación humana de muestra y casos de alto revenue/activos;
7. umbrales de aceptación y `HUMAN_REVIEW`; todo lo ambiguo queda `UNKNOWN`/`UNMODELED`.

No usar descripción libre como fuente fuerte sin una política adicional de evidencia, porque puede ser marketing o describir usos posibles. No usar floats arbitrarios como Product Truth (`CHEST=0.9`). Si se necesita relevancia para ranking, usar `PRIMARY`/`SECONDARY`/`SUPPORTED` y mantener por separado la confidence de clasificación.

Los conteos de la sección 6 no permiten prometer porcentajes de auto-clasificación. Sí permiten una estimación de trabajo: capabilities explícitas constituyen un subconjunto revisable; regiones/músculos derivados son más pequeños; objetivos de entrenamiento y usos generales son mayormente no modelados. La muestra CSV debe calibrar los umbrales antes de publicar assignments.

## 14. Customer Profile y compatibilidad

No se implementaron cambios en Customer Profile y no debe inferirse afinidad de entrenamiento desde una compra comercial aislada:

```text
customer bought BARBELL -> customer likes CHEST
```

no es una inferencia segura. Señales futuras potencialmente seguras: una preferencia explícita del cliente, una repetición de consultas/capabilities, o feedback explícito vinculado a un capability code. Señales inseguras: familia comprada → músculo, categoría amplia → objetivo, o descripción de SKU → interés del cliente.

La propuesta preserva el snapshot actual, `search_products`, `explore_catalog`, `recommend_catalog_products`, Customer Profile y A01. No incorpora training semantics al mismo contrato durante este audit.

## 15. Readiness matrix

| Capacidad | Estado |
|---|---|
| `CURRENT PRODUCT SEMANTICS IN AGENT DISCOVERY` | `MISSING` |
| `STRUCTURED SEMANTIC SEARCH CAPABILITY` | `MISSING` |
| `BODY_REGION EVIDENCE` | `WEAK` |
| `MUSCLE_GROUP EVIDENCE` | `WEAK` |
| `TRAINING_PATTERN EVIDENCE` | `WEAK` |
| `EXERCISE_CAPABILITY EVIDENCE` | `PARTIAL` |
| `TRAINING_GOAL EVIDENCE` | `WEAK` |
| `DIRECT PRODUCT→MUSCLE MODEL` | `NOT_RECOMMENDED` |
| `INTERMEDIATE CAPABILITY MODEL` | `RECOMMENDED` |

## 16. Diagnóstico y decisión final

Primary problem:

`INTEGRATION_GAP`
`CONTRACT_GAP`

Secondary diagnoses:

`PLANNER_GAP`

Final decision:

`TRAINING_SEMANTICS_NEEDED_BUT_INTEGRATION_FIRST`

Next release:

`A00.1 — Runtime semantic discovery integration`

Orden recomendado para ese release: hacer que una capability de discovery pueda transportar y validar `PRODUCT_FAMILY`, `DISCIPLINE` y `USE_CONTEXT`; verificar con los seis casos; sólo después decidir si el catálogo necesita publicar `EXERCISE_CAPABILITY` y su mapping derivado. Este audit no implementa endpoint, tags, classifier, snapshot ni cambios del Sales Agent.
