# Catalog Platform Architecture Audit

Estado: **auditoría y diseño — no autoriza implementación**. Fecha: 2026-09-29.
Alcance: `MS-pesaschile-catalog-service` completo, evaluado como futura plataforma de Catálogo
para agentes R4, aplicaciones humanas y otros consumidores. No deshace R4-J1.

## 0. Convenciones de evidencia

| Prefijo / etiqueta | Significado |
|---|---|
| (sin prefijo) | este repositorio, HEAD `4fd891f` + working tree J1C sin commit (ver `git status`) |
| `R4/` | `E:\dev\codex\R4-agent-platform` @ `60651b8` (+ J1C sin commit) — sólo lectura |
| `CRM/` | `E:\dev\codex\CRM-Customer-360` @ `686874c` — sólo lectura |
| `CP/` | `E:\dev\codex\MS\MS-pesaschile-customer-profile` @ `23a2ef3` — sólo lectura |
| `EXPORT` | `docs/audits/product-intelligence-exploration/inputs/product_catalog_exploration(2).csv`: extracto real de producción (MariaDB 10.6.25, `pesas_productiva`) generado 2026-08-27 por `customer-intelligence-r2-a00-product-exploration-v1` (`CP/docs/audits/product-intelligence-exploration/inputs/metadata(1).json`). 2011 filas; 889 activos; 873 activos + listados + pedibles ("vendibles") |
| `SNAP-LOCAL` | `data/product-semantic-snapshots/snapshots/79cef493….json` (builtAt 2026-08-29, único snapshot presente localmente; los de training v2 y relaciones están gitignorados y ausentes) |
| `SIM-V2` | simulación ejecutada en esta auditoría: el `CatalogContractService` **real** (`src/application/catalog/v2/catalogContractService.ts`) con un lector falso que replica el predicado SQL de `mysqlCatalogV2DataReader.ts:230-291` sobre las 873 filas vendibles de `EXPORT`. Supuestos: collation `*_ci` insensible a acentos (D1 UNKNOWN), sin specific prices, variantes aplanadas a stock agregado |
| `EXEC-DISC` | ejecución en esta auditoría del `DefaultSemanticDiscoveryService` real contra `SNAP-LOCAL` |

Reglas: el código ejecutable prevalece sobre la documentación. Se distingue **DECLARED** (existe
tipo/enum/schema), **IMPLEMENTED** (existe productor), **USED** (existe consumidor verificado) y
**PRODUCTION-RELEVANT** (usado por un flujo productivo). Lo no determinable se marca **UNKNOWN**.
Se reutilizan hallazgos ya probados de `R4/docs/architecture/R4-J1_CATALOG_CONTRACT_AND_SERVICE_AUDIT.md`
(en adelante **J1-AUDIT**) y `R4/docs/architecture/R4-J1C_CATALOG_CONTRACT_CONVERGENCE.md` (**J1C**)
sin re-derivarlos, citando la sección.

---

## 1. Executive Findings

1. **catalog-service no es un servicio, son cuatro sistemas en un proceso:** (a) read model
   comercial live sobre PrestaShop en **tres generaciones** (v1, commercial-truth, v2); (b) inteligencia
   de producto offline (dos ontologías con snapshots propios); (c) recomendación estadística
   (`same_order` + afinidad de cliente); (d) orquestación específica de consumidores
   (resolve-intent, explore, capability R3 en `client/`). Expone **17 endpoints de negocio**
   (`src/interfaces/http/app.ts:234-381`).
2. **Hay tres motores de verdad comercial** (`priceResolver` v1, `CatalogCommercialTruthService`,
   `commercialEngine` v2). Sólo v2 lee `quantity`, `visibility`, `out_of_stock` y declara frescura honesta.
   Todos los consumidores humanos y R2/R3 siguen viendo la verdad v1.
3. **La búsqueda v2 perdió recall respecto de v1** en consultas multi-token/unidad: el SQL sólo
   busca la frase normalizada (`mysqlCatalogV2DataReader.ts:237-251`), sin fallback por tokens ni
   sinónimos. `SIM-V2`: `kettlebell 20 kg` → 0, `disco 10 kg` → 0, `banco ajustable` → 1 (existen 6).
   v1 tiene el defecto opuesto (trunca por ID antes de rankear, J1-AUDIT §9). Ninguna es suficiente.
4. **`category` en v2 no aporta información:** es `id_category_default`, que en `EXPORT` es la raíz
   `CATEGORÍAS` en **873/873** productos vendibles; el filtro `categoryId` de v2
   (`catalogContractService.ts:72`) es por tanto inútil.
5. **Las especificaciones existen pero no son estructuradas:** 870/873 tienen features (69 nombres
   distintos), pero capacidad ("Peso máximo de usuario/carga": 370 productos) y dimensiones son
   texto libre con unidades mezcladas (`220 lb. / 100 kg.`); `width/height/depth = 0` en todos.
   Restricciones duras ("banco que soporte 150 kg") no son evaluables por Catalog hoy.
6. **Product semantics (ontología v3) es un activo sólido y conservador:** 22 familias, 8 disciplinas,
   6 contextos de uso; sobre vendibles 791 `CLASSIFIED`, 711 con familia `EXPLICIT`. Pero cobertura
   de disciplina 14 % y de contexto de uso 26 %, y **no tiene eje de rol** (accesorios de polea
   clasificados como `CABLE_MACHINE`).
7. **Training semantics v2 es centrado en máquinas por diseño:** 24 capacidades de ejercicio + 5
   funciones; `BARBELL`, `DUMBBELL`, `KETTLEBELL`, `BENCH` están explícitamente excluidos del
   universo (`scripts/training-semantic-snapshot/audit-training-semantic-resolution.ts:24`). No existe
   `SQUAT`, `BENCH_PRESS`, conditioning, cardio ni mobility. Responde "máquina para espalda", no
   "entrenar espalda".
8. **Las proyecciones semánticas son congeladas y no reproducibles desde este repo:** se construyen
   desde un CSV extraído a mano (2026-08-27) por una herramienta de otro repositorio; se recargan
   sólo al reiniciar; no hay scheduler (`docs/operations/catalog-service-ec2-deployment.md:52-56`).
   Productos nuevos no tienen semántica hasta un rebuild manual.
9. **El drift de schema degrada en silencio:** `SNAP-LOCAL` no trae `catalogPresence` y el schema lo
   defaultea a `historical_order_detail_only` (`src/domain/product-semantic-snapshot/contracts.ts:71`).
   `EXEC-DISC`: 2011/2011 productos históricos ⇒ semantic discovery devuelve **0** para
   `KETTLEBELL`, `BENCH`, `RACK_CAGE`. Estado en producción: UNKNOWN.
10. **No existe ninguna relación de compatibilidad, dependencia, sustituto ni bundle.** Sólo
    `same_order` estadístico. `ps_accessory`/`ps_pack` nunca se leen. El bloque FBT del contexto v2
    nunca se cablea (`src/bootstrap.ts:104-107`) ⇒ siempre `unavailable`. Un vocabulario amplio
    (presupuesto `total_solution`, `WEIGHT_CAPACITY`, `TECHNICALLY_COMPATIBLE`, retrieval
    `semantic`/`hybrid`) está **DECLARED** en `src/domain/recommendation/contracts.ts:80-135` pero sólo
    lo importan tests.
11. **Composición multi-producto no existe y no es construible todavía:** faltan rol de producto,
    dependencias, capacidades para pesos libres y specs normalizadas. El cuello de botella son
    **datos curados**, no algoritmos.
12. **Por qué R2/R3 se "mareaban":** el agente CRM tenía 6 tools de catálogo solapadas
    (`search_products`, `get_product_details`, `batch_get_products`, `explore_catalog`,
    `search_products_by_semantics`, `recommend_catalog_products`) enrutadas por reglas en prosa
    (`CRM/lib/brain/commercial/capability-gateway/registry.ts:400-409`), 7 representaciones de
    identidad, 3 verdades de precio y un discovery que devuelve IDs sin nombre ni precio.
13. **J1 redujo la verdad a 3 endpoints coherentes (correcto, preservar)**, pero no ofrece ningún
    camino para consultas conceptuales, de meta o multi-producto.
14. **La superficie humana está construida sobre lo peor del legado:** la consola `/catalog` del CRM
    usa v1 search (trunca por ID, oculta sin stock), v1 detail (caché 900 s) y ensambla su propio
    "product context" con 3 llamadas (`CRM/lib/catalog/consoleService.ts:289-298`). No existe
    browse/facets/paginación en ninguna API.
15. **Veredicto RAG/vector:** no es el primer paso. Con ~873 vendibles, el grueso del gap se cierra
    con léxico corregido + léxico de conceptos + semántica estructurada existente. Vector es una
    **extensión opcional** (generador de candidatos que devuelve sólo `productKey`), in-process,
    habilitada sólo si el gold set lo justifica.
16. **Veredicto hybrid:** sí — léxico + estructurado (ontologías) + filtros duros, con `vector`
    como tercer generador opcional; score de retrieval separado del score comercial.
17. **Veredicto `catalog.discover`:** sí, como **única primitive agéntica nueva** a corto plazo;
    internaliza search → semantics → training → context. **`catalog.compose`:** diferido y
    condicionado a datos (fase 5).
18. **Economía de tokens:** catálogo vendible compacto ≈ 2,2 M caracteres (~0,55–0,65 M tokens) +
    2,0 M de descripciones largas. Una búsqueda v2 (5 resultados) ≈ 2,7 KB; un contexto ≈ 2,4 KB (p50).
    El camino R3 conceptual cuesta ≥ 4 llamadas y ~20 KB sólo en registries + IDs + hidratación.
19. **Riesgos operativos de v2:** caché in-process sin cota con clave = query cruda
    (`catalogContractService.ts:52,381-397`), lectura completa de todos los matches sin `LIMIT`,
    readiness acoplada al snapshot de relaciones (`src/shared/readiness.ts:35`), métricas de
    discovery con labels de cardinalidad no acotada (`src/shared/metrics.ts:119-123`).
20. **Recomendación:** Opción B+ — *truth única + retrieval híbrido + `discover`*, sin datastore nuevo;
    composición como opción C posterior con gate de datos. Roadmap incremental de 7 fases (0–6).

---

## 2. Why Catalog Exists Today

catalog-service nació (2026-07-03) como **read model read-only de PrestaShop** para que un agente
comercial no hiciera scraping ni SQL: buscar, leer un producto con precio/stock, leer varios.
Desde entonces cada iniciativa de agentes (R2 en CRM, Customer Intelligence en CP, R3 capability
gateway, R4) necesitó "algo más del catálogo" y, como catalog-service era el único dueño de la
conexión a PrestaShop, **todo se agregó allí**: recomendaciones, afinidad de cliente, resolución
de intención, exploración, ontologías, semántica de entrenamiento, discovery y finalmente un
contrato comercial nuevo.

El resultado tiene una frontera de dominio correcta en su núcleo (Catalog = "qué es verdad sobre
los productos") pero **sin capa de composición interna**: cada necesidad se expuso como un endpoint
nuevo en lugar de como un bloque interno reutilizable. Por eso hoy los consumidores (y los modelos)
hacen los joins que debería hacer Catalog.

---

## 3. Architectural Evolution

Reconstruido desde `git log` (79 commits, 2026-07-03 → 2026-09-29) y los documentos de release.

| Gen. | Fechas | Motivación | Capabilities añadidas (commit) | Consumidor | Problema que resolvía |
|---|---|---|---|---|---|
| G0 Read model v1 | 07-03 → 07-06 | acceso a PS sin scraping | `/v1/products/search`, `/:id`, `/batch`, Swagger (`4ca161d`, `a156270`) | CRM R2 | lookup + precio/stock |
| G1 Recommendation engine | 07-22 → 07-23 | "¿qué más ofrecer?" para R2 | afinidad de cliente T09 (`17ba763`), recomendación personalizada T10 (`effa7e9`), SearchProducts V2 T11 (`7ce4dc9`), snapshot `same_order` desde pedidos (`fca8de2`), **resolve-product-intent** T12 (`14f7cb8`, `dc61b3e`), **commercial truth** = 2º motor de precio (`f483adf`, `bcd2f3a`) | CRM R2 | recomendar y resolver nombres ambiguos |
| G2 Exploration & CP | 07-27 → 08-04 | preguntas de ranking/extremos; afinidad real | public links (`18fb8e9`), **explore** (`efc2f7e`), denylist (`6f5c466`), evidencia de ownership/recompra CP-R1-T10B* (`6e1ef0b`…`ea3ba5f`), cliente (`a15a6d7`), normalización de unidades y ranking textual (`1838490`, `dba77a9`) | CRM R2, CP | "el más barato", "top-N", personalización |
| G3 Hardening CAT-R1 | 08-10 → 08-24 | operar en EC2 | peso efectivo (`1d11ec7`), tasa de IVA expuesta (`6f49ed1`), runtime hardening (`33dcaf7`), stopwords (`b60b624`) | ops, CRM | estabilidad |
| G4 Product semantics | 08-29 → 09-03 | clasificar productos para Customer Intelligence; migración de ownership desde CP | ontología comercial v1→v3, clasificador, snapshot A00.5 (`d379a7d`…`972f2e3`), endpoints semantics/batch/registry (`58686b4`, `549002f`, `eb21869`) | CP, CRM | "qué tipo de producto es" |
| G5 Training semantics | 09-03 → 09-09 | "para qué ejercicio sirve" | registry v1 (`9d962f9`), clasificación/adjudicación, snapshot v1 (`a719a42`), registry v2 + clasificador v2/v2.1 + snapshot v2 (`96c6e98`…`68a39be`), query surface (`f15043a`) | CRM R3 | discovery funcional |
| G6 Semantic discovery | 09-09 → 09-10 | combinar ambas ontologías para R3 | combined query (`c609ece`), capability R3 en `client/` (`2a8a2d0`), exclusión de históricos (`ddeec0e`, `7a214f4`) | CRM R3 | "productos que cumplen requisitos" |
| G7 Commercial contract v2 | 09-29 | contrato confiable para R4 | `/v2/catalog/search`, `products/{productKey}/context`, `items/{itemKey}/context` (`7097db2`, `4fd891f`) + J1C sin commit | R4 | verdad comercial coherente |

Lectura: **cada generación resolvió el problema de un consumidor concreto con un endpoint propio**
y ninguna retiró lo anterior. De ahí las superposiciones (§15): 3 motores de precio (G0, G1, G7),
6 mecanismos de retrieval (G0, G1, G2, G5, G6, G7) y 2 ontologías (G4, G5) unidas sólo en G6.

---

## 4. Current System Map

```text
PrestaShop MariaDB (producción; lectura directa, SHOP_ID/LANG_ID configurados)
 │
 ├─ LIVE (por request) ───────────────────────────────────────────────────────────────┐
 │   MySqlCatalogRepository ─► MySqlSearchProvider / SqlPricingProvider(priceResolver) │  G0 v1
 │        └─ CatalogApplicationService  (caché memory|redis: 300/900/60/15 s)          │
 │   MySqlCatalogCommercialDataReader ─► CatalogCommercialTruthService (sin caché)     │  G1
 │        ├─ CatalogProductIntentProvider ─► DefaultProductIntentResolutionService     │
 │        └─ CatalogRecommendationCommercialDataProvider ─► recomendaciones            │
 │   MySqlCatalogExploreDataReader (full scan) ─► DefaultExploreProductsService         │  G2
 │   MySqlCatalogV2DataReader ─► commercialEngine ─► CatalogContractService (caché 15 s)│  G7
 │                                                                                      │
 ├─ OFFLINE (CLI manual + restart) ─────────────────────────────────────────────────────┤
 │   ps_orders/ps_order_detail ─► relationship:snapshot:build ─► data/relationship-snapshots
 │   EXPORT CSV (otro repo) + trust maps ─► product:semantic:* ─► data/product-semantic-snapshots
 │   EXPORT CSV + CSV de adjudicación ─► product:training-semantics:v2:* ─► data/training-semantic-snapshots/v2
 │        └─ runtime readers en memoria (refresh sólo al boot: bootstrap.ts:159-191)     │
 │                                                                                      │
 └─ EXTERNO: Customer Profile  GET /v1/customers/:id/purchased-products  (afinidad; modo default 'unavailable')
                                                                                        │
HTTP (Fastify, x-api-key, 120 req/min/IP)                                               ▼
  v1:   search · :id · batch · explore · :id/semantics · semantics/batch · semantics/registry
        :id/training-semantics · training-semantics/{batch,registry,query} · semantic-discovery/query
  api/v2: catalog/resolve-product-intent · recommendations/search-products
  v2:   catalog/search · catalog/products/{productKey}/context · catalog/items/{itemKey}/context
                                                                                        │
Consumidores: CRM (adapter propio + consola /catalog + gateway R2/R3) · CP (semantics/batch) · R4 (v2, perfil no habilitado)
```

Evidencia de composición: `src/bootstrap.ts:79-209`, `src/server.ts:9-28`,
`src/recommendationRuntime.ts:61-127`, rutas `src/interfaces/http/app.ts:185-381`.

---

## 5. Complete Capability Inventory

Leyenda F/D/I: **F**actual (copiado de PS), **D**erivado (calculado con reglas declaradas),
**I**nferido (clasificador/estadística). Uso: "live CRM" = consumidor productivo verificado por código;
"no prod" = consumidor existe pero no habilitado.

| # | Capability | Entry point | Purpose | Input | Output | Owner/domain | Data source | Consumer | Current usage | Freshness | Determ.? | F/D/I | Legacy? | Overlap | Assessment |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | v1 lexical search | `GET /v1/products/search` `app.ts:234-266` → `catalogService.ts:97-130` → `mysqlSearchProvider.ts:17-63` | lookup textual por combinación | `q` 2–120, `limit`≤10, `includeOutOfStock` (def. false) | ítems por combinación + `matchType` | Retrieval | PS live, `LIMIT max(10·limit,50)` ordenado por ID (`mysqlCatalogRepository.ts:397-408`) | CRM adapter (`CRM/lib/catalog/httpCatalogAdapter.ts:1191`), consola, intent (interno) | live CRM | caché 300 s | sí | F+D | sí | #15, #5, #4 | DEPRECATE para consumidores nuevos |
| 2 | v1 product detail | `GET /v1/products/:id` `app.ts:268-321` | detalle + precio/stock de variante default | id, combinationId, qty, headers de contexto | `ProductDetail` | Truth | PS live, `priceResolver` | CRM adapter/consola/benchmark | live CRM | caché 900 s (J1-AUDIT §10) | sí | F+D | sí | #16, #17 | DEPRECATE (migrar) |
| 3 | v1 batch | `POST /v1/products/batch` `app.ts:323-368` | ≤20 detalles | items | `items[].ok` | Truth | idem #2 | CRM grounded message (`CRM/lib/brain/commercial/native-cycle/buildCatalogGroundedMessage.ts:8`), hidratación R3 (`client/semanticDiscoveryCapability.ts:466-470`) | live CRM | 900 s | sí | F+D | sí | #16 (sin batch) | KEEP hasta migración; v2 necesita batch interno |
| 4 | explore | `POST /v1/products/explore` `exploreProductsRoute.ts:134` | filtrar/ordenar un alcance (extremos, top-N) | query, categoría, `productType`, precio, disponibilidad, sort | ≤10 productos, `totalMatched`, `exhaustiveForScope` | Retrieval/browse | full scan por request (`mysqlCatalogExploreDataReader.ts:166-323`); `productType` con reglas fijas (`defaultExploreProductsService.ts:42-64`) | CRM adapter (`:1215`), tool `explore_catalog` | live CRM | live | sí | D | sí | browse futuro, #1 | DEPRECATE → browse |
| 5 | resolve product intent | `POST /api/v2/catalog/resolve-product-intent` `resolveProductIntentRoute.ts:123` | NL acotado → `resolved`/`clarification_required`/`no_match` | query ≤240, context, filters | resolución + candidatos con score | Consumer-specific (decide por el agente) | v1 search × ≤8 términos + commercial-truth (`catalogProductIntentProvider.ts:69-120`); 8 reglas de sinónimos (`synonyms.ts:8-20`); 10 tipos de producto (`constraints.ts:14-28`); umbrales 0.82/0.12 (`resolutionPolicy.ts:16-21`) | CRM adapter (`:1222`), benchmark | live CRM | live + caché v1 | sí | I (heurístico) | sí | #15, discover | INTERNALIZE piezas; DEPRECATE endpoint |
| 6 | SearchProducts V2 (recs) | `POST /api/v2/recommendations/search-products` `searchProductsV2Route.ts:98` | recomendaciones para un producto fuente, con afinidad | sourceProduct, customer, filters | recommendations, excluded, snapshot, execution | Recommendation + personalización | snapshot `same_order` + commercial-truth + CP HTTP | CRM client (`CRM/lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client.ts:61`), consola | live CRM | build del snapshot | sí | I (estadístico) | parcial | FBT de #16 | KEEP interno/humano; personalización fuera |
| 7 | product semantics (1) | `GET /v1/products/:id/semantics` `getProductSemanticsRoute.ts:106` | tags + evidencia + lineage | id | fact con provenance | Product intelligence | snapshot semántico | CRM adapter (`:1225`), consola | live CRM | build | sí | I | no | #14 | INTERNAL/diagnostic |
| 8 | product semantics batch | `POST /v1/products/semantics/batch` `getProductSemanticsBatchRoute.ts:150` | facts en bloque, pinneables | ≤500 ids, `expectedSnapshotId` | facts públicos + `missingProductIds` | PI | idem | CP (`CP/src/infrastructure/catalog-product-semantics/http-product-semantic-facts-source.ts:110`) | live CP | build | sí | I | no | — | KEEP (service-to-service) |
| 9 | product semantics registry | `GET /v1/products/semantics/registry` `getProductSemanticsRegistryRoute.ts:67` | vocabulario ontología v3 | — | ejes/valores (5,5 KB) | PI | código | CRM, `client/` | live | versión de código | sí | declarado | no | #12 | INTERNAL |
| 10 | training semantics (1) | `GET /v1/products/:id/training-semantics` | facts TS v2 | id | capacidades, funciones, anatomía derivada | PI | snapshot TS v2 | CRM gateway | UNKNOWN (snapshot ausente local) | build | sí | I | no | #14 | INTERNAL/diagnostic |
| 11 | training semantics batch | `POST /v1/products/training-semantics/batch` | idem en bloque | ≤500 ids | facts | PI | idem | no se encontró consumidor | DECLARED+IMPLEMENTED | build | sí | I | no | #14 | INTERNAL |
| 12 | training registry | `GET /v1/products/training-semantics/registry` | vocabulario TS v2 (14 KB) | — | registry | PI | código | `client/` R3 | live R3 | código | sí | declarado | no | #9 | INTERNAL |
| 13 | training query | `POST /v1/products/training-semantics/query` `queryTrainingSemanticsRoute.ts:87` | query estructurada TS | requirements | resultados | PI retrieval | snapshot TS v2 | no se encontró consumidor en CRM/R4/CP | IMPLEMENTED, no USED | build | sí | I | no | #14 (superset) | CONSOLIDATE en #14 |
| 14 | semantic discovery | `POST /v1/products/semantic-discovery/query` `semanticDiscoveryQueryRoute.ts:44` | retrieval estructurado cruzado | ≤10 requirements, limit≤100 | `productId` + matchedRequirements + facts (sin nombre/precio) | PI retrieval | ambos snapshots | CRM gateway (`CRM/lib/brain/commercial/capability-gateway/registry.ts:516`), `client/` | live R3 | build | sí | I | no | #13, #4 | INTERNALIZE → `discover` |
| 15 | v2 search | `POST /v2/catalog/search` `catalogV2Routes.ts:84-109` | búsqueda a nivel producto con precio/sellability | query, filters, limit≤10 | results, completeness, freshness | Truth + Retrieval | PS live (`mysqlCatalogV2DataReader.ts:108-228`) | R4 (`R4/adapters/domains/catalog/http/src/adapter.ts:82`) | no prod (J1C §12) | 15 s | sí | F+D | no | #1, #5 | KEEP + FIX recall |
| 16 | v2 product context | `GET /v2/catalog/products/{productKey}/context` | contexto coherente facts/derived/inferred | productKey, qty | context | Truth | PS live | R4 | no prod | 15 s | sí | F+D(+I) | no | #2, consola CRM | KEEP |
| 17 | v2 item context | `GET /v2/catalog/items/{itemKey}/context` | precio/disponibilidad de la unidad vendible | itemKey, qty | item | Truth | PS live | R4 (interno, no tool del modelo: J1C §10) | no prod | 15 s | sí | F+D | no | #2 | KEEP |
| 18 | readiness | `GET /health/ready` `app.ts:195-211` | salud | — | checks | Ops | DB, Redis, snapshot relaciones | ops | live | live | sí | — | — | — | FIX acoplamiento |
| 19 | liveness/metrics/docs | `/health/live`, `/metrics`, `/docs`, `/openapi.json` | ops | — | — | Ops | — | ops/dev | live | — | sí | — | — | — | KEEP |
| 20 | build relaciones | `npm run relationship:snapshot:build` (`src/cli/buildRelationshipSnapshot.ts:48-62`) | snapshot `same_order` | ventana/estados por env | snapshot versionado | Recommendation | `ps_orders`, `ps_order_detail` | runtime reader | manual | manual + restart | sí | I estadístico | no | — | KEEP interno |
| 21 | build product semantics | `product:semantic:*` (`package.json:36-42`) | clasificar + snapshot | EXPORT + trust maps (+ DB para presence) | snapshot `sha256:` | PI | CSV 2026-08-27 | runtime | manual | manual | sí | I | — | #22 | KEEP; extractor in-repo |
| 22 | build training semantics | `product:training-semantics:*` v1/v2/v2.1 (`package.json:43-56`) | clasificar + snapshot | EXPORT + CSV de resolución (`build-training-semantic-snapshot-v2.ts:16`) | snapshot v2 | PI | CSV | runtime | manual | manual | sí | I | v1/v2 sí | #21 | CONSOLIDATE scripts |
| 23 | eval search v1 | `scripts/evaluate-search-relevance.ts` + `tests/fixtures/catalogSearchRelevanceCases.ts` (43 queries, sin juicios) | medir v1 | queries | reporte | Eval | DB | dev | manual | — | sí | — | — | — | EXTEND a gold set |
| 24 | paridad / smoke | `scripts/validate-price-parity.ts`, `validate-weight-parity.ts`, `smoke-runtime.ts` | verificación | casos | reporte | Ops | DB | dev | UNKNOWN | — | sí | — | — | — | KEEP |
| 25 | motor precio v1 | `src/infrastructure/pricing/priceResolver.ts` | precio | — | pricing | Truth | `specific_price` | #2, #3, #4 | live | — | sí | D | sí | #26, #27 | CONSOLIDATE → #27 |
| 26 | motor commercial-truth | `src/domain/catalog/commercial-truth/catalogCommercialTruthService.ts:68-201` | precio + disponibilidad | refs + contexto | productos | Truth | `MySqlCatalogCommercialDataReader` | #5, #6, build semántico | live | sin caché | sí | D | parcial | #25, #27 | CONSOLIDATE → #27 |
| 27 | motor v2 | `src/domain/catalog/v2/commercialEngine.ts:49-217` | claves, sellability, precio | producto + contexto público | resultado | Truth | `MySqlCatalogV2DataReader` | #15–17 | no prod | 15 s | sí | D | no | #25, #26 | KEEP como único motor |
| 28 | ranking léxico | `src/domain/catalog/searchTextRelevance.ts:93-157` | scoring determinista | query, ítem | señales | Retrieval | — | #1, #15 | live | — | sí | D | no | — | KEEP (compartido) |
| 29 | relationship engine | `src/domain/recommendation/relationship-engine/**` | cálculo, validación, reliability, publicación, lectura | pedidos | snapshot | Recommendation | pedidos | #6 | live CRM | build | sí | I | no | — | KEEP interno |
| 30 | afinidad + personalización | `src/domain/recommendation/customer-affinity/**`, `personalized-recommendation/**` | personalizar recomendaciones | cliente | scores | **Customer** (no Catalog) | CP HTTP (`httpCustomerAffinityEvidenceProvider.ts:221`) | #6 | modo default `unavailable` (`src/shared/config.ts:62`) | live | sí | I | — | — | DEPRECATE en Catalog (mover) |
| 31 | cachés | `src/infrastructure/cache/*` (v1), `Map` en `catalogContractService.ts:52` (v2) | latencia | — | — | Infra | — | #1–3, #15–17 | live | 15–900 s | — | — | — | — | FIX: cota en v2 |
| 32 | client library | `client/catalogClient.ts`, `client/semanticDiscoveryCapability.ts` | HTTP tipado + capability R3 | — | — | Consumer-side | v1 + discovery | **no se encontró consumidor** (CRM usa adapter propio: `CRM/lib/catalog/httpCatalogAdapter.ts`) | DECLARED+IMPLEMENTED | — | — | — | sí | CRM adapter | DEPRECATE; generar cliente v2 desde schema |
| 33 | consola humana `/catalog` | `CRM/app/(hub)/catalog/page.tsx` → `CRM/lib/catalog/consoleService.ts` | inspección humana | búsqueda, producto | detalle + recs + semántica | UI (CRM) | #1, #2, #6, #7 | humanos | live | mezcla 15–900 s | — | — | — | #16 | MIGRATE a browse/inspect |
| 34 | contratos de recomendación declarados | `src/domain/recommendation/contracts.ts:80-135` | vocabulario aspiracional (presupuesto, restricciones, retrieval híbrido) | — | — | — | — | sólo tests (`tests/contract/searchProductsV2.contract.test.ts`) | DECLARED | — | — | — | — | — | REMOVE_LATER |
| 35 | datasets offline | `docs/audits/product-intelligence-exploration/inputs/*.csv`, `docs/audits/training-semantics/**` | entradas y adjudicaciones de clasificadores | — | — | PI | extracto prod 2026-08-27 | scripts de build | estático | congelado | — | F snapshot | — | — | KEEP como fixture; no como fuente |

---

## 6. Data / Projection Map

```text
PrestaShop tables                        readers                       normalización / motor           proyección                 API
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ps_product(_shop,_lang)  ─┬─► MySqlCatalogRepository (v1) ────► priceResolver + physical_qty ─────── (live) ──► /v1/*
ps_product_attribute*    ─┤─► MySqlCatalogCommercialDataReader ─► CommercialTruth ─────────────────── (live) ──► intent, recs
ps_stock_available       ─┤─► MySqlCatalogExploreDataReader ───► priceResolver + agregados ────────── (live) ──► explore
ps_specific_price        ─┤─► MySqlCatalogV2DataReader ────────► commercialEngine v2 ─────────────── (live, 15 s) ─► /v2/catalog/*
ps_feature*, category*   ─┘
ps_manufacturer, configuration(PS_ORDER_OUT_OF_STOCK) ─► sólo v2
ps_orders/order_detail ──► PrestashopHistoricalOrderTransactionReader ─► same_order calc ─► snapshot relaciones ─► recs
[extractor externo, CP] ─► EXPORT CSV ─► clasificador PS ─► snapshot product semantics ─► semantics, discovery, CP
                                     └─► clasificador TS v2.1 (+ CSV adjudicación) ─► snapshot TS v2 ─► training-*, discovery
Customer Profile HTTP ──► afinidad de cliente ─► personalización ─► recs
```

| Dato | Source of truth | Transformación | Owner | Persistencia | Freshness | Provenance expuesta | Consumidores |
|---|---|---|---|---|---|---|---|
| identidad | `id_product`, `id_product_attribute` | `P{id}` / `P{id}-V{id}` (`commercialEngine.ts:49-65`) en v2; number en v1; `id::comb|<base>` en commercial-truth | PS / Catalog (claves) | live | live | `ref` en v2 | todos |
| nombre, descripciones | `ps_product_lang` | `stripHtml`, truncado 600 en v2 (`mysqlCatalogV2DataReader.ts:208`) | PS | live | live | no | todos |
| categoría | `id_category_default` + `category_lang` | ninguna (v2: `:269-270`) | PS | live | live | no | v2 search/context — **valor = raíz en 873/873 (EXPORT)** |
| fabricante/marca | `ps_manufacturer` | trim | PS | live | live | no | sólo v2 (828/873 con marca) |
| features/specs | `ps_feature_product`, `feature(_value)_lang` | verbatim ≤40 (`:144-151,381-409`); en explore como texto concatenado | PS | live | live | no | v2 context, explore, clasificadores (vía EXPORT) |
| variantes / SKU | `ps_product_attribute(_shop,_combination)`, `attribute(_group)_lang` | atributos por grupo | PS | live | live | `ref.variantId` | v1, v2 |
| precio base | `COALESCE(ps.price, p.price)` + impacto | 3 motores (§7) | Catalog (derivado) | live | v1 60/900 s, v2 15 s | `engineVersion` sólo v2 | todos |
| specific prices | `ps_specific_price` | selección + ventana (fechas cero→NULL en v2 `:437-440`) | Catalog | live | idem | `promotion.validUntil` sólo v2 | todos |
| IVA | configuración `TAX_RATE` (`config.ts:54`) | tasa plana | Catalog | config | — | `tax.basis` en v2 | todos |
| stock | v1: `physical_quantity`; v2: `quantity` (`:311`) | agregados | PS | live | 15 s | `stock.scope` | todos |
| sellability | `active`, `visibility`, `available_for_order`, `out_of_stock`, `PS_ORDER_OUT_OF_STOCK` | `deriveSellability` (`commercialEngine.ts:67-83`) | Catalog | live | 15 s | `reason` | v2 |
| relaciones | pedidos válidos | `same_order` (support/confidence/lift/reliability) | Catalog (estadístico) | snapshot archivo | build manual + restart | `snapshotId`, evidencia | recs, consola |
| tags semánticos | EXPORT + trust maps | clasificador reglas v1 (nombre, categoría confiable, feature) | Catalog (inferido) | snapshot archivo | 2026-08-27/29 | `ruleId`, `sourceType`, evidencia | CP, CRM, discovery |
| training semantics | EXPORT + CSV adjudicación | clasificador v2.1 + overrides manuales | Catalog (inferido) | snapshot v2 | build manual | lineage (registry/rules hash) | CRM R3, discovery |
| catalogPresence | DB (commercial-truth) al build | reconciliación (`scripts/product-semantic-classification/lib/catalog-presence.ts`) | Catalog | congelado en snapshot | build | no | discovery (filtro) |
| afinidad de cliente | CP (`purchased-products`) | scoring | **Customer Profile** | live | live | evidencia | recs |

---

## 7. Commercial Truth

**Tres motores coexisten** (detalle de divergencias numéricas en J1-AUDIT §6.3):

| Aspecto | v1 `priceResolver` | commercial-truth | v2 `commercialEngine` |
|---|---|---|---|
| Rutas | `/v1/products/:id`, batch, explore | intent, recs, build semántico (presence) | `/v2/catalog/*` |
| Stock | `physical_quantity` | `physical_quantity` | `quantity` (neto reservas) |
| visibility / out_of_stock | no | no | sí (`mysqlCatalogV2DataReader.ts:267`, `:312`) |
| Frescura | timestamps fabricados, 900 s | `evaluatedAt` real | `asOf`, `cache.ageMs`, `validUntil` (`catalogContractService.ts:368-379`) |
| Contrato validado en salida | no | no | sí (`catalogV2Routes.ts:57-73`) |

**Preservar:** v2 como *único* motor (identidad `productKey`/`itemKey`, sellability con razón,
precio público fijo, frescura honesta, fixtures del owner con manifest). Es lo mejor del repo.

**Pendiente heredado (no re-auditado aquí):** bloqueantes J1C B1–B8 (columnas, reglas de impuesto,
specific prices, zona horaria, cotas), OD-1 (precio "desde" incluye variantes sin stock), OD-2
(`discountValue` amount), OD-3 (ventana de frescura) — J1C §9, §12.

**Nuevos hallazgos de esta auditoría:**

- **Categoría sin información.** `category` = categoría default (`mysqlCatalogV2DataReader.ts:269-270`,
  `catalogContractService.ts:183,230`); en `EXPORT` el default es `CATEGORÍAS` (id 2, raíz) para 873/873
  vendibles. El filtro `categoryId` (`:72`) sólo discrimina "raíz vs. no raíz". Las categorías reales
  están en `ps_category_product` (mediana 6 por producto, J1-AUDIT §3) y la trust map
  (`docs/audits/product-intelligence-exploration/inputs/category_trust_map(1).csv`, 253 filas) ya
  clasifica cuáles son semánticas. **UNKNOWN:** si `ps_product_shop.id_category_default` difiere
  (la lectura usa `ps_product`).
- **FBT nunca cableado** (`src/bootstrap.ts:104-107` no pasa `frequentlyBoughtTogether`):
  `inferred.frequentlyBoughtTogether` es siempre `unavailable/snapshot_unavailable`
  (`catalogContractService.ts:328-331`). También registrado como no bloqueante en J1C.
- **Specs verbatim.** Correcto para autoridad (texto del owner), insuficiente para restricciones:
  ver §18/§21.

---

## 8. Search / Retrieval

### 8.1 Mecanismos existentes

| Mecanismo | Código | Precision | Recall aprox. | Determ. | Explicabilidad | Filtros | Latencia | Freshness | Cobertura | Failure modes |
|---|---|---|---|---|---|---|---|---|---|---|
| Exact SKU/reference | v1 `mysqlCatalogRepository.ts:290-291`; v2 `mysqlCatalogV2DataReader.ts:240,245-249` | alta | alta en v2 (`BORE20` → 1, `SIM-V2`); v1 oculta sin stock | sí | `exact_reference` | — | 1 query | live | 873/873 con reference | colisiones combinación↔producto (4, J1-AUDIT §5) |
| Lexical v1 | frase + fallback AND por tokens de nombre (`mysqlCatalogRepository.ts:280-330`) + ranking (`searchTextRelevance.ts:142-157`) | media | **baja en genéricas** (trunca 50 por ID antes de rankear) | sí | `matchType` | stock | ≤4 queries secuenciales | caché 300 s | por combinación | vacío≠no existe; ID-order bias |
| Lexical v2 | frase normalizada LIKE (`:237-251`) + `matchesLexically` en memoria (`catalogContractService.ts:434-448`) + mismo ranking | media | **baja en multi-token/unidades** (§8.2) | sí | `match.type`, tokens | sellableOnly, maxUnitPrice, categoryId (inútil) | 6 queries paralelas, sin LIMIT | 15 s | por producto | 0 resultados en consultas naturales; lee todos los matches |
| Intent resolution | ≤8 términos × v1 search + sinónimos + restricciones (`catalogProductIntentProvider.ts:69-120`) | media | media | sí | reasons/score | inStock/active | hasta 32 queries (J1-AUDIT §12) | v1 | 8 sinónimos, 10 tipos | hereda truncado v1; heurística `barra` |
| Explore | full scan + reglas `productType` (`defaultExploreProductsService.ts:42-128`) | media-alta en tipos definidos | alta dentro del alcance | sí | `classificationSource` | categoría, precio, disponibilidad, sort | full scan | live | 3 tipos con reglas (`machine`, `bench`, `banca`) | tipos arbitrarios → text fallback |
| Taxonomy (product semantics) | discovery ejes `PRODUCT_FAMILY/DISCIPLINE/USE_CONTEXT` | alta (EXPLICIT 711/873) | familia alta; disciplina 14 %, uso 26 % | sí | ruleId + evidencia | required/preferred, any/all | in-memory | build | 791 clasificados | snapshot drift (§1-9) |
| Training semantics | ejes capacidad/función/región/músculo/patrón (`defaultSemanticDiscoveryService.ts:147-150` sólo `SEMANTIC_COMPLETE`) | alta (revisión 10/10 en A00.6.7) | sólo máquinas (240 relevantes) | sí | matchedCodes, relation | idem | in-memory | build | 231 productos con capacidades | pesos libres invisibles |
| Feature matching | sólo texto concatenado en explore (`mysqlCatalogExploreDataReader.ts:256-273`) | baja | — | sí | no | — | — | live | 870/873 con features | sin parseo de unidades |
| Recommendation retrieval | `same_order` por producto fuente | estadística | ≤50 por fuente | sí | support/confidence/lift | inStock, productIds | in-memory + hidratación | build | 693 activos con relaciones (J1-AUDIT §12) | no es similitud ni compatibilidad |

### 8.2 `SIM-V2` — recall de la búsqueda v2 sobre el catálogo real

Oráculo = todos los tokens significativos presentes en el nombre (semántica del fallback v1 sin
truncado). Payload = bytes del JSON de respuesta con `limit: 5`.

| Query | v2 `totalMatches` | top-3 v2 | oráculo nombre | bytes |
|---|---:|---|---:|---:|
| `kettlebell` | 22 | Kettlebell Acero 10kg · 12kg · 16kg | 21 | 2667 |
| `kettlebell 20 kg` | **0** | — | 2 | 227 |
| `pesa rusa` | 20 | Kettlebell Acero 10kg · 12kg · 16kg (vía descripción) | 0 | 2701 |
| `pesa rusa 20 kg` | **0** | — | 0 | 227 |
| `mancuerna` | 113 | Barra Preolímpica Mancuerna · … | 88 | 2778 |
| `mancuena` (typo) | 0 | — | 0 | 227 |
| `barra olímpica 20 kg` | 4 | Barra Olímpica 20kg 220cm Eco Serie · … | 10 | 2243 |
| `banco` | 71 | Ab Crunch Accesorio Banco B814 · Banco Abdominal … | 63 | 2789 |
| `banco ajustable` | **1** | Banco Olímpico Ajustable ZR Series | 6 | 735 |
| `banca ajustable` | 0 | — | 0 | 227 |
| `rack sentadillas` | 0 | — | 0 | 227 |
| `disco 10 kg` | **0** | — | 2 | 227 |
| `maquina de remo` | 2 | Remo Bajo MO 2.0 · T-Bar Row Beast | 0 | 1240 |
| `dominadas` | 17 | Barra Dominadas Puerta · **Ab Straps** · **Agarre OCR Nunchuck** | 1 | 2780 |
| `espalda` | 45 | **AbMat 1.0 · AbMat Ergo · Banco Hip Thrust** | 0 | 2752 |
| `entrenar espalda` | 0 | — | 0 | 227 |
| `home gym` | 31 | Máquina Home Gym PRO · Home Gym ULTRA · **Barra EZ Peso Fijo** | 2 | 2795 |
| `gimnasio en casa` | 25 | Atril de Sentadillas … | 0 | 2817 |
| `departamento` | 9 | **Barra Preolímpica Mancuerna** · … · **Pack 100kg Pink Series** | 0 | 2783 |
| `BORE20` | 1 | Barra Olímpica 20kg 220cm Eco Serie | 0 | 755 |

Conclusiones: (1) la frase normalizada `20kg` no hace match con nombres no contiguos
("Kettlebell de Vinilo 20kg") y no hay fallback por tokens ⇒ **regresión real respecto de v1**
(`mysqlCatalogRepository.ts:309-329` sí lo tiene); (2) sinónimos (`pesa rusa`→`kettlebell`) existen sólo en
intent (`synonyms.ts:10`); (3) consultas conceptuales matchean descripciones y producen ruido que el
ranking no puede separar; (4) respuestas vacías son frecuentes y el agente no puede distinguir
"no existe" de "no lo encontré" más allá de `searchMode: 'lexical'`.

---

## 9. Product Semantics

**Qué representa:** "qué tipo de producto comercial es", en tres ejes — `PRODUCT_FAMILY` (22 códigos,
`src/domain/commercial-product-ontology/product-family-tags.ts:10-327`), `DISCIPLINE` (8,
`discipline-tags.ts:18-138`), `USE_CONTEXT` (6, `use-context-tags.ts:9-108`). Ontología v1→v2 (política
de no-productos)→v3 (regla guardada de máquinas de polea, `product-family-tags-v3.ts`). Ejes descartados
con justificación permanente: `TRAINING_OBJECTIVE` (DEFER), `COMMERCIAL_LEVEL`, `COMMERCIAL_ROLE` (DROP)
(`deferred-axes.ts:7-26`); tags rechazados `WEIGHTLIFTING`, `FUNCTIONAL_TRAINING`, `BODYBUILDING`,
`PACK_SET`… (`:29-65`).

**Evidencia y confianza:** sólo `EXPLICIT` y `STRONGLY_INFERRED` (no existe "weakly inferred" por
diseño); fuentes permitidas `NAME_TEXT`, `TRUSTED_CATEGORY`, `STRUCTURED_FEATURE`, `FAMILY_INFERENCE`;
**prohibido** el texto libre de descripción por falsos positivos medidos
(`src/domain/commercial-product-ontology/contracts.ts:44-66`).

**Cobertura (SNAP-LOCAL ∩ 873 vendibles de EXPORT):**

| Métrica | Valor |
|---|---|
| status | `CLASSIFIED` 791 · `OTHER` 81 · `EXCLUDED_NON_PRODUCT` 1 |
| familia primaria | 791/873 (90,6 %); `EXPLICIT` 711, `STRONGLY_INFERRED` 80 |
| con disciplina | 124 (14,2 %): CARDIO_ENDURANCE 33, CALISTHENICS 27, HYROX 26, POWERLIFTING 16, BOXING_MMA 12, YOGA_PILATES 9, REHABILITATION 4 |
| con contexto de uso | 225 (25,8 %): COMMERCIAL_GYM 127, HOME_GYM 75, SMALL_SPACE 17, SEMI_COMMERCIAL 11, CLINICAL 4, OUTDOOR 3 |
| evidencia | NAME_TEXT 765 · STRUCTURED_FEATURE 222 · TRUSTED_CATEGORY 125 · FAMILY_INFERENCE 59 |
| top familias | PROTECTIVE_GEAR 97, WEIGHT_PLATE 91, DUMBBELL 80, BENCH 64, BARBELL 61, BALL_BAG 50, PLATE_LOADED 44, CABLE_MACHINE 38 … |

**Lineage:** `snapshotId` content-hash, `ontologyHash`, `classifierVersion`, `semanticChecksum`,
`expectedSnapshotId` pinneable (409 si difiere). Muy buen diseño.

**Deuda:**
- **Rol ausente:** accesorios de polea ("Agarre Manilla Simple … Accesorio Polea") aparecen con familia
  primaria `CABLE_MACHINE`; "Barra Preolímpica Mancuerna" (manilla) como `BARBELL`; "Discos Deslizantes"
  como `WEIGHT_PLATE` (EXPORT + SNAP-LOCAL). Para buscar es tolerable; para componer es inaceptable.
- **Schema drift silencioso** (hallazgo 9, `EXEC-DISC`).
- **Presencia congelada** al build: un producto desactivado después sigue como `current_catalog`.
- **Fuente no reproducible:** CSV de otro repo.

**Activos reutilizables:** registro versionado con hash, reglas con evidencia, trust maps,
golden set (`scripts/product-semantic-classification/golden-set-regression.ts`), política de no-productos.

---

## 10. Training Semantics

**Qué representa:** "qué ejercicio/función de entrenamiento permite un equipo". Registry v2
(`src/domain/training-semantics-v2/contracts.ts:29-62`):

- 24 **ExerciseCapabilities**: LEG_EXTENSION, LEG_CURL, HIP_THRUST, CHEST_PRESS, PEC_DECK, LAT_PULLDOWN,
  ROW, SHOULDER_PRESS, PULL_UP, DIP, ABDOMINAL_CRUNCH, ADDUCTOR, ABDUCTOR, HACK_SQUAT, LEG_PRESS, CALF_RAISE,
  REAR_DELT_FLY, BICEPS_CURL, TRICEPS_EXTENSION, PENDULUM_SQUAT, BELT_SQUAT, REVERSE_HYPER, DEADLIFT, PULLOVER;
  cada una deriva regiones, músculos primarios/secundarios y patrón (p. ej. ROW → UPPER_BODY, BACK, BICEPS, PULL).
- 5 **TrainingFunctions** (utilidad sin anatomía): CABLE_RESISTANCE, MULTI_DIRECTIONAL_RESISTANCE,
  BODYWEIGHT_SUPPORT, BARBELL_SUPPORT, GUIDED_BARBELL_SUPPORT.
- Fronteras semánticas explícitas: `SQUAT` genérico **prohibido**; `DEADLIFT` sólo máquina dedicada; barra ≠
  deadlift automático (`src/domain/training-semantics-v2/registry.ts:193-208`).
- Confianza: `EXPLICIT/HIGH/MEDIUM/LOW` y relación `DIRECT/SUPPORTED/FAMILY_DERIVED`
  (`src/domain/training-semantics/contracts.ts:92-96`).

**Cobertura** (`docs/releases/CATALOG-INTELLIGENCE-TRAINING-SEMANTICS-A00.6.8-snapshot-v2.md`):
denominador 240 "activos relevantes"; 234 resueltos (97,5 %) = 122 `SEMANTIC_COMPLETE` + 112
`VERIFIED_NO_APPLICABLE_CAPABILITY`; 275 asignaciones de capacidad en 231 productos; precisión de cierres
revisada 10/10.

**El denominador excluye por diseño los pesos libres**: `NON_TRAINING_FAMILIES = {APPAREL, FLOORING,
PROTECTIVE_GEAR, STORAGE, BARBELL, DUMBBELL, KETTLEBELL, BAND, BENCH}`
(`scripts/training-semantic-snapshot/audit-training-semantic-resolution.ts:24`). Nota de deuda: `BAND` no es
un código de la ontología (el código es `BAND_SUSPENSION`), por lo que ese elemento nunca coincide.

**Superposición:** v1 registry (13 capacidades) sigue en el árbol (`src/domain/training-semantics/registry.ts`),
v2 lo embebe; clasificadores v1, v2 y v2.1 coexisten (`src/domain/training-semantic-classification*`); scripts
duplicados (`package.json:51,53` ejecutan el mismo archivo con dos nombres).

**Mapa pedido por el encargo (¿existe hoy?):**

| Capability de negocio | Estado actual | Evidencia |
|---|---|---|
| squat | **No** genérico (prohibido); sólo HACK/PENDULUM/BELT_SQUAT + función BARBELL_SUPPORT (racks) | `registry.ts:202-206` |
| bench_press | **No**; CHEST_PRESS es máquina; BENCH excluido | contracts v2; `audit-…-resolution.ts:24` |
| deadlift | Sólo máquina dedicada | `registry.ts:196-201` |
| pull_up | Sí (PULL_UP) | contracts v2 |
| rowing | ROW (máquinas de remo de fuerza); ergómetro = familia `CARDIO_MACHINE` | contracts v2 |
| conditioning | No; parcial por disciplina HYROX/CROSSFIT | `discipline-tags.ts` |
| free_weight_training | No como capacidad; implícito por familia DUMBBELL/KETTLEBELL/BARBELL/WEIGHT_PLATE | ontología |
| functional_training | Rechazado explícitamente | `deferred-axes.ts` |
| cardio | Disciplina CARDIO_ENDURANCE + familia CARDIO_MACHINE | ontología |
| mobility | No; parcial RECOVERY_TOOL, YOGA_PILATES | ontología |

**Conclusión:** producto → capabilities es **mapeable con alta calidad para máquinas y estaciones**
(≈230 productos) y **no mapeable hoy para pesos libres, bancos y cardio** salvo por inferencia de familia,
que no existe como proyección gobernada. Para "quiero entrenar espalda" el sistema actual responde sólo
con máquinas (LAT_PULLDOWN/ROW/PULL_UP/PULLOVER).

---

## 11. Relationships / Recommendations

| Relación | Estado | Tipo | Evidencia |
|---|---|---|---|
| `same_order` | IMPLEMENTED + USED (recs, consola) | estadística (support/confidence/lift/reliability ≥0.3, jointCount ≥2, ≤50/fuente) | `src/cli/buildRelationshipSnapshot.ts:56-62`; `defaultRelationshipSnapshotBuildService.ts:73` |
| `same_cart`, `next_purchase`, `customer_history` | DECLARED | — | `src/domain/recommendation/contracts.ts:91-98` |
| `technical_compatibility`, `manual` | DECLARED + validador; sin productor | curada (prevista) | `relationship-engine/contracts.ts:158` |
| accesorios PS (`ps_accessory`), packs (`ps_pack`) | **no leídos** (grep en `src`/`scripts`: 0) | — | UNKNOWN contenido (J1C D2/D3) |
| FBT en contexto v2 | IMPLEMENTED en servicio, **no cableado** | estadística | `src/bootstrap.ts:104-107` |
| afinidad de cliente | IMPLEMENTED, modo default `unavailable` | inferida (cliente) | `src/shared/config.ts:62` |
| sustitutos/alternativas | DECLARED (`LOWER_PRICE_ALTERNATIVE`, `OUT_OF_STOCK_SUBSTITUTE`) | — | `contracts.ts:99-112` |

Riesgos: `same_order` no es similitud ni compatibilidad; la exclusión de no-productos en relaciones
depende de `RELATIONSHIP_SOURCE_EXCLUDED_PRODUCT_IDS` (`config.ts:60`), distinta de la denylist de
discovery (J1-AUDIT §8). La personalización introduce un **ciclo de servicios**: Catalog → CP
(`purchased-products`) y CP → Catalog (`semantics/batch`).

---

## 12. Current Consumers

| Endpoint | CRM (adapter/gateway) | CRM consola `/catalog` | CP | R4 | `client/` |
|---|---|---|---|---|---|
| v1 search | ✔ `httpCatalogAdapter.ts:1191`, tool `search_products` | ✔ | | | ✔ |
| v1 `:id` | ✔ `:1197`, `get_product_details` | ✔ | | | ✔ |
| v1 batch | ✔ `:1212`, grounded message | | | | ✔ (hidratación R3) |
| explore | ✔ `:1215`, `explore_catalog` | | | | |
| resolve-intent | ✔ `:1222`, benchmark | | | | |
| search-products v2 | ✔ `recommend_catalog_products` | ✔ | | | ✔ |
| semantics `:id` | ✔ `:1225` | ✔ | | | |
| semantics batch | | | ✔ `http-product-semantic-facts-source.ts:110` | | ✔ |
| semantics / training registry | ✔ `:1246,1249` | | | | ✔ |
| semantic discovery | ✔ `:1243`, `search_products_by_semantics` | | | | ✔ |
| training `:id`/batch/query | no encontrado | | | | |
| v2 search / product / item | | | | ✔ `adapter.ts:82,89,98` (perfil v2 no habilitado) | |

Volumen real por endpoint: **UNKNOWN** (no se revisaron métricas productivas).

---

## 13. Agent-readiness Analysis

### 13.1 Si se expusiera todo a un agente

17 endpoints ⇒ al menos **12–14 tools** con conceptos distintos: combinación vs producto vs `<base>` vs
`productKey`/`itemKey`; 3 motores de precio; 3 nociones de disponibilidad (`available`, `status/purchasable`,
`sellability`); 2 vocabularios semánticos (familia/disciplina/uso vs capacidad/función/anatomía) que
requieren leer registries (5,5 KB + 14 KB) antes de consultar; discovery que devuelve IDs sin nombre ni
precio; recomendaciones con scores (`score`, `commercialScore`, `affinityScore`) que el modelo podría
presentar como "compatibilidad".

### 13.2 Recorridos (APIs actuales)

"J1" = lo que R4 ve hoy (search + product context; item context interno). "Todo" = superficie completa.

| Caso | Recorrido | Calls | Payload aprox. | Faltante / reconstruido por el agente | Riesgo |
|---|---|---|---|---|---|
| A. "¿Cuánto cuesta X?" | J1: search → (si `requiresSelection`) context → item context | 1–3 | 3–6 KB | elegir variante; "desde" incluye sin stock (OD-1) | bajo si search encuentra X |
| B. "¿Pesa rusa de 20 kg?" | J1: `pesa rusa 20 kg` → 0; reintento `kettlebell` → 22, truncado a 10, sin filtro de peso | 2–3 | 3–6 KB | sinónimo, filtro por atributo, paginación | **afirmar "no tenemos"** falso; o no encontrar la de 20 kg (sin stock, existe) |
| C. "Algo para trabajar espalda" | J1: imposible (`espalda` → AbMat…). Todo: registries (2) → discovery `MUSCLE_GROUP=BACK` (1) → batch v1 (1) | 4 | ~20–30 KB | mapear "espalda"→`BACK`; hidratar; sólo máquinas | omite mancuernas/barras; mezcla verdad v1 |
| D. "Equipamiento para home gym" | J1: `home gym` → 31 ruidosos. Todo: discovery `USE_CONTEXT=HOME_GYM` (75 vendibles etiquetados) + batch | 3–4 | 15–25 KB | diversidad por familia; cobertura 26 % | lista sesgada, sin estructura |
| E. "$500.000 gym en casa" | Nada existe. Agente: N búsquedas por familia + contextos + suma + dependencias | 10–20 | 30–60 KB | presupuesto, roles, dependencias (barra→discos, press→rack) | **alto**: combinaciones absurdas, precios sumados mal |
| F. "Similar pero más barato" | semantics de X → discovery por familia → batch → filtrar precio | 3–4 | 10–20 KB | similitud = misma familia (grosera); `same_order` no sirve | presentar co-compra como sustituto |
| G. "Banco que soporte 150 kg y mida < X" | search `banco` (71, trunca 10) → context por candidato → leer specs texto | 1 + N (≥7) | 20+ KB | parsear `Peso máximo de usuario` con unidades; dimensiones en texto | error de parseo, candidatos fuera del top-10 |
| H. "¿Qué comprar con esta máquina?" | J1: FBT siempre `unavailable`. Todo: search-products v2 (`same_order`) | 1–2 | 5–10 KB | compatibilidad real inexistente | co-compra presentada como requisito |

### 13.3 Por qué R2/R3 se "mareaban"

1. **Enrutamiento en prosa entre tools solapadas**: el gateway CRM describe `explore_catalog` con
   `useWhen`/`doNotUseWhen` que remiten a otras 3 tools (`CRM/lib/brain/commercial/capability-gateway/registry.ts:400-409`).
2. **El modelo hacía los joins**: discovery (IDs) + batch (verdad) + semantics (explicación) + recs.
3. **Vocabulario controlado expuesto al modelo**: debía conocer `BACK`, `HOME_GYM`, `LAT_PULLDOWN`.
4. **Verdades inconsistentes**: tres motores y relojes (`generatedAt`, `productCheckedAt`, `evaluatedAt`, `snapshotId`).
5. **Resultados vacíos ambiguos**: v1 oculta sin stock por defecto; v2 no encuentra multi-token.
6. **Decisiones delegadas a Catalog y al modelo a la vez**: resolve-intent "resuelve" con umbrales fijos, pero el modelo podía ignorarlo.

### 13.4 Modelo de coste / tokens (caso E, conceptual)

Supuesto ≈ 3,5–4 caracteres/token para JSON en español.

| Estrategia | Payload al modelo | Tool calls | Latencia | Carga de razonamiento |
|---|---|---|---|---|
| A. Catálogo completo al prompt | ≈2,2 M chars vendibles (≈0,55–0,65 M tokens) + 2,0 M de descripciones; precio/stock volátiles invalidan cualquier caché de prompt | 0 | muy alta (prefill) | extrema; alucinación de precios |
| B. Tool loop sobre endpoints actuales | 30–60 KB (≈8–15 k tokens) + razonamiento entre llamadas | 10–20 | alta (secuencial) | alta; joins y dependencias en el modelo |
| C. Narrow structured (J1 actual) | 3–6 KB por consulta, pero sin recall conceptual | 1+N | baja | media; recae en reintentos |
| D. Hybrid retrieval detrás de search | 3–8 KB | 1–3 | baja | media |
| E. `discover` / `compose` | discover ≈3–4 KB (≤8 candidatos); compose ≈4–6 KB (≤3 planes) | 1–2 | baja-media (en Catalog) | baja; el modelo explica, no calcula |

---

## 14. Human-readiness Analysis

Consumidor humano real: consola `/catalog` del CRM (V1 → V1.2.1: `CRM/docs/releases/CRM-CATALOG-CONSOLE-V1*.md`),
master-detail con búsqueda, detalle comercial, explorador de relaciones (scores, evidencia, lift/support)
y bloque semántico degradable; ensamblado en el BFF del CRM (`CRM/lib/catalog/consoleService.ts:264-382`).

| Necesidad humana | ¿Existe? | Dónde / gap |
|---|---|---|
| búsqueda | parcial | v1 (trunca por ID, oculta sin stock) |
| browse por categorías / facets / paginación / sort | **no** | explore es top-10 sin paginación; categorías default = raíz |
| filtros por specs | no | specs no estructuradas |
| comparación | no | — |
| inspección completa (precio, stock, specs, variantes) | parcial | v1 detail (sin specs, caché 900 s); v2 context tiene specs pero la consola no lo usa |
| relaciones | sí | search-products v2 |
| explicación de semántica | sí | semantics `:id` con evidencia |
| auditoría/debug (lineage, snapshots, scores) | parcial | disperso en 4 endpoints |
| operaciones masivas visuales | no | batch ≤20 (v1), semantics batch ≤500 |

Humanos toleran y valoran más datos (evidencia, scores, paginación, facets) que el modelo. La respuesta al
encargo es **sí**: un mismo dominio con **tres representaciones** (§22) evita duplicar lógica, siempre que
la representación humana se construya sobre el mismo motor v2 y el mismo retrieval (hoy la consola usa v1).

---

## 15. API Surface Overlap

| Capability A | Capability B | Overlap | Diferencia semántica | Diferencia técnica | ¿Consolidar? | ¿Separadas? | Razón |
|---|---|---|---|---|---|---|---|
| v1 search | v2 search | lookup textual | combinación vs producto; oculta sin stock vs no | truncado por ID vs sin LIMIT; con vs sin fallback | **sí** (v2 + fallback de v1) | no | una sola semántica de búsqueda |
| v1 `:id` / batch | v2 product/item context | detalle comercial | variante default implícita vs `variant_required` | motor v1 vs v2; 900 s vs 15 s | **sí** (v2) | no | una verdad |
| commercial-truth | v2 engine | precio/disponibilidad | `<base>` vs identidad v2 | `physical_quantity` vs `quantity` | **sí** | no | J1-AUDIT §6 |
| resolve-intent | v2 search / discover | NL → candidatos | decide (`resolved`) vs devuelve candidatos | sinónimos + restricciones sólo en intent | **sí** (piezas a discover) | no | Catalog no decide por el agente |
| explore | browse humano / search filtros | filtrado/orden | top-N vs búsqueda | full scan | **sí** (browse) | no | — |
| training query | semantic discovery | query estructurada TS | subconjunto | mismo snapshot | **sí** | no | discovery es superset |
| semantic discovery | explore `productType` | "productos de tipo X" | ontología vs reglas ad hoc | snapshot vs live | **sí** (ontología) | no | dos taxonomías para lo mismo |
| product semantics | training semantics | "qué es / para qué sirve" | naturaleza vs uso | snapshots y lineage separados | **manifest común** | **sí** (ejes distintos) | complementarias; unir lineage, no ontologías |
| search-products v2 | FBT en v2 context | co-compra | personalizada vs no | mismo snapshot | parcial | sí (humano vs agente) | la personalización no es Catalog |
| `client/` capability R3 | CRM adapter | cliente | — | duplicado; `client/` sin consumidor | **sí** (cliente generado) | no | — |
| consola CRM (3 llamadas) | v2 product context | vista de producto | — | ensamblado en CRM | **sí** | no | Catalog debe ensamblar |

---

## 16. RAG / Vector Feasibility

### 16.1 Alternativas

| Opción | Qué resuelve | Qué no | Coste | Veredicto |
|---|---|---|---|---|
| A. Lexical only (corregido) | nombres, SKU, atributos con unidades, sinónimos curados | paráfrasis/objetivos ("para departamento") | bajo | **necesario, no suficiente** |
| B. Structured semantics only | familia, uso, disciplina, capacidad | texto libre del cliente; productos sin clasificar | bajo (ya existe) | necesario, no suficiente |
| C. Vector only | paráfrasis | SKU, números, unidades, restricciones; no explicable | medio | **rechazado** |
| D. Lexical + vector | recall de paráfrasis | restricciones; semántica controlada | medio | parcial |
| E. Lexical + taxonomía existente | casi todo el gap medido (§8.2) vía léxico de conceptos → códigos | paráfrasis fuera del léxico | bajo | **recomendado como primer paso** |
| F. Lexical + vector + metadata estructurada | máximo recall con explicabilidad | — | medio | **objetivo condicional** si el gold set muestra gap residual |

Tamaño del problema: 873 vendibles / 1550 en catálogo (EXPORT). Todo el espacio cabe en memoria; no hay
problema de escala que justifique infraestructura.

### 16.2 Documento a embeber (si se habilita)

No se embeben descripciones crudas (HTML, marketing largo, superficie de inyección: mediana 2420 chars,
J1-AUDIT §12). Documento derivado y determinista:

```ts
type ProductSemanticDocument = {
  productKey: string;                 // P{id}; única salida del retrieval
  documentVersion: string;            // hash del contenido abajo
  name: string;
  brand: string | null;
  semanticCategoryPath: string[];     // categorías con trust SEMANTIC_STRONG (no la raíz default)
  shortDescription: string | null;    // truncada, sin HTML
  specifications: Array<{ name: string; value: string }>; // sólo features "semánticas" de la trust map
  taxonomy: { family: string[]; discipline: string[]; useContext: string[] }; // códigos + labelEs
  trainingCapabilities: string[];     // códigos + nombres canónicos
  synonyms: string[];                 // del léxico de conceptos gobernado
};
// Excluido siempre: precio, promoción, stock, sellability, URL, descripción larga.
```

### 16.3 Arquitectura

```text
query ─► query understanding determinista ─► generadores: exact | lexical | structured | (vector)
      ─► productKeys + señales ─► merge/dedupe/rank ─► hidratación v2 (live) ─► candidatos estructurados
```

Nunca: chunks → prompt; precio/stock citados desde el índice.

### 16.4 Index / storage

| Opción | Operación | Coste | Complejidad | Latencia | Durabilidad | Rebuild | Versioning | Deploy | Observabilidad | Veredicto |
|---|---|---|---|---|---|---|---|---|---|---|
| In-memory + archivo versionado (patrón actual de snapshots) | ninguna nueva | ~0 | baja | <5 ms brute force (1550 × 1024 float32 ≈ 6 MB) | archivo content-hash | batch completo en segundos (excepto cómputo de embeddings) | `snapshotId` + `active.json` ya existen | igual que hoy | igual | **recomendado** |
| PostgreSQL + pgvector | nueva DB para catalog-service (hoy sólo MariaDB) | medio | media | baja | alta | incremental | manual | nueva dependencia | media | no justificado |
| DB existente (MariaDB PS) | escribir en la DB de PrestaShop | — | — | — | — | — | — | **prohibido** (Catalog es read-only) | — | rechazado |
| Vector DB dedicada | nuevo servicio | alto | alta | red | alta | incremental | sí | nuevo servicio | nueva | sobrediseño |
| Servicio externo de búsqueda | proveedor | medio-alto | media | red | proveedor | proveedor | proveedor | dependencia externa | proveedor | no para ~1,5 k docs |

Coste real del vector no es el índice sino **el modelo de embedding en query-time** (dependencia externa o
modelo local, latencia, disponibilidad). Por eso: opcional, con timeout corto y fallback léxico, y decisión
explícita (D4).

---

## 17. Hybrid Retrieval Proposal

```text
1 Query understanding (determinista, sin LLM)
  normalización (searchTextNormalization) · detección de SKU · unidades · extracción de restricciones
  (reutilizar product-intent/constraints.ts) · léxico de conceptos: término → códigos de ontología/TS
  ("pesa rusa"→KETTLEBELL, "espalda"→MUSCLE_GROUP:BACK, "departamento"→USE_CONTEXT:SMALL_SPACE)
2 Generadores de candidatos (en paralelo, sobre índice in-memory + SQL acotado)
  G1 exact reference · G2 lexical (frase + fallback AND por tokens + sinónimos) ·
  G3 structured (buckets de discovery) · G4 vector (opcional)
3 Filtros duros: presencia live (v2), sellableOnly, precio máx., restricciones de specs normalizadas
4 Merge por productKey, dedupe, ranking de retrieval
5 Hidratación comercial v2 (batch interno) ─► 6 respuesta con whyMatched y completitud
```

**Señales de retrieval** (explican "por qué es relevante"): tipo de match (exact_reference > exact_name >
nombre completo > frase > sinónimo > descripción), cobertura de tokens en nombre, código estructurado
matcheado y su confianza (`EXPLICIT` > `STRONGLY_INFERRED`; `DIRECT` > `FAMILY_DERIVED`), similitud vectorial
(si existe), satisfacción de restricciones (`satisfied` / `unknown` / `violated` → se filtra).
Fusión recomendada: **por niveles** (tiers) para exact/lexical fuerte y **RRF** dentro del mismo nivel,
reproducible y explicable, sin pesos arbitrarios calibrados a mano.

**Score comercial** (qué conviene ofrecer): sellability, promoción, stock, popularidad. **No se mezcla** con
el de retrieval: se expone aparte y sólo se aplica como desempate o por `sort` explícito. Mezclarlos haría que
una promoción desplace al producto que el cliente nombró, y convierte a Catalog en vendedor (anti-goal).

---

## 18. Product Capability Model

Hoy hay tres piezas que contestan partes de "este producto permite hacer X":

| Pieza | Responde | Cobertura | Calidad |
|---|---|---|---|
| ExerciseCapability (TS v2) | ejercicio específico en máquina/estación | ~231 productos | alta, revisada |
| TrainingFunction (TS v2) | utilidad instrumental (soporte de barra, polea…) | 254 productos | alta |
| PRODUCT_FAMILY / DISCIPLINE / USE_CONTEXT | naturaleza, disciplina, contexto | 791 / 124 / 225 | alta en familia |

**Gap:** pesos libres, bancos, cardio y accesorios no tienen capacidades; no hay rol (principal / accesorio /
consumible / servicio).

**Propuesta de modelo (sin inventar taxonomía):** una **Capability Projection** derivada, que no
reemplaza los registries sino que los proyecta en una sola vista por producto:

```text
ProductCapabilities(productKey) = {
  exercise: códigos TS v2 (DIRECT/SUPPORTED)                 ← existente
  function: funciones TS v2 (DIRECT/FAMILY_DERIVED)          ← existente
  familyImplied: reglas curadas familia→capacidad            ← NUEVO, gobernado (p. ej. DUMBBELL ⇒ entrenamiento libre multi-grupo)
  role: primary_equipment | attachment | consumable | service ← NUEVO eje (decisión D1)
  provenance por asignación: EXPLICIT | FAMILY_IMPLIED | CURATED
}
```

Los códigos nuevos (p. ej. un `SQUAT` genérico, `BENCH_PRESS`, `CONDITIONING`) **no se definen aquí**:
el registry v2 prohíbe `SQUAT` genérico por razones documentadas, y reabrirlo es una decisión de ontología
con evidencia (D1). La proyección permite agregarlos después sin cambiar APIs.

---

## 19. Discover Capability

**Conveniencia:** alta. Es la pieza que falta entre "búsqueda nominal" (J1) y "respuesta conceptual", y
es donde Catalog puede absorber los joins que hoy hace el modelo.

**Límites:** devuelve **candidatos**, nunca una decisión ni texto persuasivo; no resuelve presupuesto
total (eso es compose); no personaliza por cliente.

```ts
type DiscoverRequest = {
  schemaVersion: 1;
  need: string;                        // texto del cliente, ≤240
  hints?: {                            // opcional; lo que el agente ya entendió
    concepts?: Array<{ axis: 'PRODUCT_FAMILY'|'USE_CONTEXT'|'DISCIPLINE'|'EXERCISE_CAPABILITY'|'MUSCLE_GROUP'|'TRAINING_FUNCTION'; code: string }>;
  };
  constraints?: {
    maxUnitPrice?: number;             // CLP, final bruto
    sellableOnly?: boolean;            // default false
    specs?: Array<{ key: 'max_user_weight_kg'|'max_load_kg'|'assembled_length_cm'|'assembled_width_cm'|'assembled_height_cm'|'weight_kg'; op: 'gte'|'lte'; value: number }>;
  };
  limit?: number;                      // 1–8, default 5
};

type DiscoverResponse = {
  schemaVersion: 1;
  interpretation: {                    // lo que Catalog entendió; auditable, sin prosa libre
    concepts: Array<{ axis: string; code: string; source: 'lexicon'|'hint'|'lexical' }>;
    appliedConstraints: string[];
    unrecognizedTerms: string[];
  };
  candidates: Array<{
    productKey: string;
    name: string;
    whyMatched: Array<{ kind: 'exact_reference'|'name'|'synonym'|'concept'|'spec'|'vector'; code?: string; confidence?: 'EXPLICIT'|'STRONGLY_INFERRED' }>;
    capabilities: string[];            // códigos, no texto
    constraintResults: Array<{ key: string; status: 'satisfied'|'unknown'|'violated_excluded'; evidence?: string }>;
    priceSummary: { kind: 'exact'|'from'; finalGross: { amount: number; currency: 'CLP' } } | null;
    availabilitySummary: { sellability: string; reason: string };
  }>;
  completeness: { totalCandidates: number; truncated: boolean; strategy: Array<'exact'|'lexical'|'structured'|'vector'>; degraded: string[] };
  lineage: { semanticIndexVersion: string; productSemanticsSnapshotId: string; trainingSemanticsSnapshotId: string | null };
  freshness: { asOf: string; validUntil: string };  // de la hidratación v2
};
```

R4 deja de encadenar search → semantics → training → context: llama `discover` y luego
`get_product_context` sólo para el producto que se discute. `whyMatched` es estructurado (códigos) para
que el modelo explique sin inventar.

---

## 20. Multi-product Composition

Caso: "Tengo $500.000 y quiero armar un gym en casa".

| Pieza | ¿Existe? | Qué falta |
|---|---|---|
| goal ("home gym fuerza") | no | **plantillas de objetivo** curadas: roles requeridos/opcionales |
| budget | sólo DECLARED (`budgetScope: total_solution`, `contracts.ts:80`) | motor de suma con precios hidratados |
| required / optional capabilities | parcial (máquinas) | capability projection §18 |
| constraints (espacio, capacidad) | no estructurado | specs normalizadas (dimensiones sólo en texto en 155–378 productos) |
| candidate generation | discovery (roto por drift) / search | `discover` por rol |
| dependencies / incompatibilities | no | modelo §21 |
| redundancy | no | rol + capacidad |
| price / sellability | sí (v2) | batch interno |
| coverage / optimization | no | solver |

Datos de factibilidad (EXPORT, vendibles con stock, precio neto × 1,19 sin specific prices): entrada por
familia — rack desde $72.990 (atril) / $109.990 (squat rack), banco desde $44.990 (p50 $269.990),
mancuernas desde $9.990 el par, kettlebell desde $6.990, discos desde $7.990 el par, piso desde $5.990. Un
plan de fuerza básico cabe en $500.000; el riesgo no es encontrar productos sino **combinar mal**
(manilla de mancuerna tratada como barra, barra sin discos compatibles, press de banca sin soporte).

**Primitive futura `catalog.compose` (determinista):**

```ts
type ComposeRequest = { schemaVersion: 1; goalTemplate: string; budget: { max: number; currency: 'CLP' };
  requirements?: { mustInclude?: string[]; exclude?: string[] };        // roles o capacidades
  constraints?: { maxFootprintCm2?: number; sellableOnly?: boolean } };
type ComposeResponse = { schemaVersion: 1; plans: Array<{
  items: Array<{ itemKey: string; role: string; quantity: number; unitFinalGross: number }>;
  total: number; coverage: { covered: string[]; unmetNeeds: string[] };
  tradeoffs: string[];                  // códigos (p. ej. 'NO_RACK_BUDGET'), no prosa
  evidence: { dependencyRules: string[]; priceAsOf: string } }>;
  infeasible?: { reason: 'BUDGET_TOO_LOW'|'NO_CANDIDATES_FOR_ROLE'|'MISSING_COMPATIBILITY_DATA'; minimumBudget?: number } };
```

Algoritmo: plantilla → roles → `discover` por rol (≤5 candidatos) → filtros → enumeración exhaustiva
(≤5^5 = 3.125 combinaciones, trivial) con restricciones duras (presupuesto, dependencias, sellability) →
ranking por cobertura, versatilidad, holgura de presupuesto → 1–3 planes. Sin LLM.

---

## 21. Dependency / Compatibility Model

| Tipo | Semántica | Dirección | Fuente candidata | Estado |
|---|---|---|---|---|
| `compatible` | A funciona con B | simétrica | **derivable de features**: "Diámetro de manga" (133 productos) vs "Diámetro interno" (110) ⇒ barra↔disco (olímpico/preolímpico) | no existe; derivación determinista factible |
| `required_dependency` | A no se usa sin B | A→B (por rol) | reglas curadas por rol (barra ⇒ discos; press de banca con barra ⇒ rack/soporte) | no existe |
| `optional_accessory` | B mejora A | A→B | `ps_accessory` (UNKNOWN), rol `attachment`, curación | no existe |
| `substitute` | B reemplaza A | simétrica | misma familia + capacidad + rango de specs | no existe |
| `frequently_bought_together` | co-compra | A→B | `same_order` | existe (sólo estadística) |
| `bundle_component` | A contiene B | A→B | `ps_pack` (UNKNOWN), packs en nombre (4 packs AMBIGUOUS en TS) | no existe |

Reglas: `same_order` **nunca** se reinterpreta como compatibilidad (J1-AUDIT §8); toda relación lleva
`source ∈ {derived_feature, curated, prestashop_accessory, prestashop_pack, statistical}` y `confidence`;
lo no curado se expone como `unknown`, no como `false`. Lo curado vive como archivo versionado en el repo
(mismo patrón de registry con hash), revisado por negocio.

---

## 22. Human + Agent Platform Boundaries

```text
                    ┌──────────────── Catalog core (una sola lógica) ───────────────┐
                    │ v2 commercial engine · projections · retrieval · discover · compose │
                    └───────┬──────────────────────┬──────────────────────┬──────────┘
                            ▼                      ▼                      ▼
                 AGENT DOMAIN API          HUMAN / BROWSE API      INTERNAL / DIAGNOSTIC API
                 /v2/catalog/*             /v2/catalog/browse …    /internal/catalog/*
                 estrecha, closed enums,   paginación, sort,       semantics+evidencia, lineage,
                 ≤8 candidatos, códigos,   facets, compare,        snapshots, scores de debug,
                 schemaVersion, fixtures   detalle completo        relaciones, rebuild status
                 key R4 (scope agent)      key BFF CRM (scope human) key ops/servicios (scope internal)
```

Regla: las tres superficies son **representaciones** del mismo resultado de dominio (mismo motor, mismo
retrieval); ninguna recalcula precio ni relevancia. El Agent API no reutiliza la representación humana
(payloads grandes) ni la diagnóstica (evidencia cruda). Los scopes de API key permiten rate limits y
auditoría distintos (hoy una sola lista de keys y límite por IP: `app.ts:90-94,213-225`).

---

## 23. Internal vs External Capability Matrix

| Endpoint / capability | Decisión | Razón |
|---|---|---|
| `POST /v2/catalog/search` | **PUBLIC AGENT** + PUBLIC HUMAN (vía browse) | verdad a nivel producto; arreglar recall |
| `GET /v2/catalog/products/{productKey}/context` | **PUBLIC AGENT** + PUBLIC HUMAN | contexto coherente |
| `GET /v2/catalog/items/{itemKey}/context` | PUBLIC AGENT (interno de R4, no tool) + Quote | precio de unidad |
| `catalog.discover` (nuevo) | **PUBLIC AGENT** | primitive conceptual |
| `catalog.compose` (futuro) | PUBLIC AGENT (gated) + HUMAN | composición |
| browse/facets/compare (nuevo) | **PUBLIC HUMAN** | consola |
| `/v1/products/search` | LEGACY → DEPRECATE | reemplazado por v2 |
| `/v1/products/:id`, `/batch` | LEGACY → DEPRECATE (tras migrar CRM) | motor v1 |
| `/v1/products/explore` | LEGACY → DEPRECATE (→ browse) | full scan, reglas ad hoc |
| `/api/v2/catalog/resolve-product-intent` | LEGACY → REMOVE EVENTUALLY; piezas INTERNAL | decide por el agente |
| `/api/v2/recommendations/search-products` | INTERNAL (datos de relaciones) + HUMAN diagnóstico; personalización fuera | no es Catalog truth |
| `/v1/products/:id/semantics` | INTERNAL / diagnostic | evidencia cruda |
| `/v1/products/semantics/batch` | INTERNAL (service-to-service, CP) | contrato pinneable estable |
| `/v1/products/semantics/registry`, `training-semantics/registry` | INTERNAL | vocabulario para herramientas internas |
| `/v1/products/:id/training-semantics`, `/batch` | INTERNAL / diagnostic | — |
| `/v1/products/training-semantics/query` | DEPRECATE (consolidar en discovery) | sin consumidor |
| `/v1/products/semantic-discovery/query` | INTERNAL building block (de `discover`) | IDs sin verdad |
| `client/` (catalogClient, capability R3) | DEPRECATE; reemplazar por cliente generado de schemas v2 | sin consumidor |
| health / metrics / docs | INTERNAL | ops |

Nada se elimina en esta tarea.

---

## 24. Evaluation Strategy

Un score por capa, nunca uno global:

| Capa | Métricas | Gate |
|---|---|---|
| Search quality | exact lookup accuracy (SKU/nombre = 100 %), recall@10 léxico, precision@5, MRR para nominales, nDCG@10 para genéricas | ninguna regresión en exact; recall@10 ≥ oráculo en multi-token |
| Discovery quality | cobertura de relevantes (recall@8 sobre juicios), tasa de irrelevantes en top-5, satisfacción de restricciones (0 violaciones en `satisfied`), tasa de `unknown` | juicios humanos por fase |
| Composition quality | adherencia a presupuesto (100 %), corrección de dependencias (100 % en reglas curadas), cobertura funcional, redundancia, diversidad, explicabilidad (cada ítem con rol y regla) | 100 % en duras |
| Commercial truth | precio vs storefront (golden), stock/sellability vs PS, lifecycle, frescura (`asOf` real) | J1C B1–B8 |

**Gold set versionado** (`contracts/catalog/eval/gold-v1.json` propuesto), con `productKey`s juzgados
(0–3) por un revisor comercial, sin PII, regenerable contra EXPORT y contra lectura productiva read-only:

| Clase | Ejemplos |
|---|---|
| exact SKU | `BORE20`, `DOBE10` |
| nombre | `Rack de Almacenamiento Barras Fijas`, `barra olímpica 20 kg` |
| sinónimo | `pesa rusa`, `pesa rusa 20 kg`, `discos de goma`, `collarines` |
| typo | `mancuena`, `kettelbell` |
| capacidad | `quiero entrenar espalda`, `algo para sentadillas` |
| objetivo | `home gym`, `algo compacto para departamento` |
| restricción | `banco para 150 kg`, `rack de menos de 2 m de alto` |
| multi-producto/presupuesto | `home gym 500 lucas`, `gym para fuerza 1 millón` |
| similitud | `algo parecido a X más barato` |

Activos existentes: 43 queries sin juicios (`tests/fixtures/catalogSearchRelevanceCases.ts`), casos
`SIM-SEARCH` de J1-AUDIT §9.2, golden set del clasificador, benchmarks CRM
(`CRM/lib/brain/commercial/agent-loop/benchmark/`, `CRM/tests/commercial/a13ConversationalReliabilityBenchmark.test.ts`).
Conversaciones reales: no se revisaron (PII); pueden aportar queries anonimizadas (D13).

---

## 25. Observability

Por request (log estructurado + métricas de baja cardinalidad):

| Campo | Log | Métrica |
|---|---|---|
| `requestType` (search/discover/compose/context) | ✔ | label |
| `strategy` usada y `degraded[]` | ✔ | label (enum) |
| conteos por generador, tras filtros, devueltos | ✔ | histograma |
| `noResultReason` (`no_lexical_match`, `all_filtered`, `unknown_concept`, `index_unavailable`) | ✔ | label (enum) |
| `semanticIndexVersion`, snapshot ids | ✔ | gauge de edad del snapshot activo |
| edad de hidratación (`asOf`, `cache.ageMs`) | ✔ | histograma |
| latencia por etapa (understanding, generadores, merge, hidratación) | ✔ | histograma |
| compose: plantilla, restricciones, resultado del solver, planes, `infeasible.reason` | ✔ | label (enum) |
| query | **hash + clase normalizada**, no texto crudo | — |

Corregir la métrica existente de discovery (labels `candidateCount`, `resultCount`, `snapshotId`
sin cota: `src/shared/metrics.ts:119-123`, `defaultSemanticDiscoveryService.ts:423`).

---

## 26. Update / Rebuild Strategy

**Hoy:**

| Proyección | Build | Fuente | Publicación | Recarga | Rollback |
|---|---|---|---|---|---|
| commercial truth | — | PS live | — | caché 15 s (v2) / 900 s (v1) | — |
| product semantics | CLI manual | EXPORT (otro repo) + trust maps + DB (presence) | archivo content-hash + `active.json` | **sólo restart** (`bootstrap.ts:163-173`) | puntero |
| training semantics v2 | CLI manual | EXPORT + CSV adjudicación | idem | sólo restart (`:181-191`) | puntero |
| relaciones | CLI manual | pedidos | idem (`rename` atómico) | sólo restart | puntero |

**Objetivo:**

```text
cambio en PS ─► extractor read-only in-repo (reemplaza EXPORT externo; misma forma de datos)
 ─► build de proyecciones (semantics, TS, specs normalizadas, relaciones, capability, índice de retrieval)
 ─► validación (schema estricto sin defaults silenciosos; gates de cobertura/precisión vs. versión activa;
    golden sets; diff por producto)
 ─► publicación atómica (content-hash + manifest único con todas las versiones)
 ─► hot reload por polling del puntero (sin restart) + métrica de edad
 ─► rollback = mover puntero
```

Detección de cambios: `date_upd` (hoy no se lee) + hash del `ProductSemanticDocument` por producto.
Embeddings (si se habilitan): re-embeber sólo documentos cuyo hash cambió; `embeddingModelId` es parte de
la versión del índice; cambio de modelo ⇒ rebuild completo; **nunca** mezclar vectores de modelos distintos
en un índice; el índice activo y el snapshot semántico se publican juntos en el manifest.

---

## 27. Failure / Degradation Model

| Falla | Degradación | Nunca |
|---|---|---|
| DB caída | 503 `catalog_source_unavailable retryable` (ya en v2) | devolver precio/stock cacheados como actuales fuera de `validUntil` |
| índice semántico/vector no disponible | `discover` sigue con exact + lexical; `completeness.degraded: ['structured'|'vector']` | 503 total |
| snapshot semántico stale | servir con `lineage` + edad; alerta | ocultar la edad |
| schema de snapshot inválido/campo faltante | **rechazar carga** (fail-closed), mantener anterior | defaultear (`contracts.ts:71`) |
| timeout de retrieval | devolver lo obtenido con `truncated`/`degraded` | resultados vacíos presentados como "no existe" |
| hidratación comercial falla | candidato sin precio con `priceSummary: null` + razón, o excluir con conteo | precio del índice |
| falla parcial de candidatos | incluir los hidratados, contar los fallidos | 200 silencioso |
| compose no satisface | `infeasible` con razón y presupuesto mínimo | plan parcial presentado como completo |
| presupuesto muy bajo | `BUDGET_TOO_LOW` + mínimo viable | — |
| objetivo desconocido | `unrecognizedTerms` + candidatos léxicos | inventar plantilla |
| falta compatibilidad | `unknown` + `MISSING_COMPATIBILITY_DATA` | asumir compatible |
| snapshot de relaciones ausente | sólo recs/FBT degradan | `/health/ready` 503 para todo el servicio (hoy `readiness.ts:35`) |

### 27.1 Seguridad y confianza

- **Texto editable por staff** (nombres, descripciones, features): es dato, no instrucción. `discover` y
  `compose` responden con **códigos**; el texto libre se limita a `name`/`shortDescription` truncados y
  R4 lo rotula como contenido del catálogo (J1B/J1C). No embeber descripciones largas (superficie de
  inyección y *semantic poisoning* sobre el índice).
- **Poisoning de semántica:** la ontología ya prohíbe texto libre como evidencia (`contracts.ts:44-66`);
  mantener esa regla para el léxico de conceptos y el documento embebido.
- **Metadata malformada:** validación estricta en build (fail-closed) y en salida (`sendChecked`, ya en v2).
- **Query arbitraria / DoS:** la caché v2 sin cota con clave cruda (`catalogContractService.ts:52,62-93`) y la
  lectura de todos los matches sin `LIMIT` permiten amplificación; acotar caché (LRU), acotar candidatos
  tras ranking, límites por key/scope, presupuesto de CPU para compose.
- **PII / contexto de cliente:** Catalog no debe recibir identidad de cliente en discover/compose;
  la personalización actual (CP) se retira de Catalog (D7).
- **Catalog devuelve DATA**: nada de "recomienda X", "di al cliente…".

---

## 28. Target Architecture Options

| | **A. Racionalizar APIs actuales** | **B. Truth + hybrid retrieval + discover** | **C. B + composition engine** |
|---|---|---|---|
| Qué es | consolidar en v2, arreglar search, deprecar legado, sin capacidades nuevas | A + retrieval interno (léxico corregido, léxico de conceptos, estructurado, vector opcional) + `discover` + proyecciones reproducibles | B + capability/role/compat curados + `compose` |
| Beneficio | una verdad, menos tools | consultas conceptuales en 1 llamada; humanos y agentes sobre el mismo retrieval | presupuesto y kits sin razonamiento del modelo |
| Coste | bajo | medio (sin infraestructura nueva) | medio-alto (**curación** humana continua) |
| Complejidad | baja | media | alta |
| Migración | CRM a v2 | + R4 agrega una tool | + plantillas, reglas, revisión |
| Calidad agente | mejora nominal; conceptual sigue imposible | alta en nominal y conceptual | alta también en multi-producto |
| Utilidad humana | media | alta (browse sobre el mismo retrieval) | alta (armador de kits) |
| Carga operativa | baja | media (rebuilds, gold set) | alta (datos curados) |

Descartada: **"RAG-first"** (vector DB + chunks al prompt): viola anti-goals (autoridad del índice,
precio desde embeddings, tokens) y no resuelve restricciones ni SKU.

---

## 29. Recommended Target Architecture

**Recomendación: B ahora, C condicionada.** B resuelve la mayor parte del gap medido (§8.2, §13.2 B–D, F–G)
con activos existentes y sin datastore nuevo; C depende de datos que hoy no existen (rol, dependencias,
capacidades de pesos libres) y debe esperar a que existan y se evalúen.

```text
PrestaShop (read-only)
   │
   ├── Commercial Truth (motor v2 único; batch interno) ─────────────────────────────┐
   │                                                                                 │
   └── Extractor read-only in-repo ─► Projection build (offline, versionado, manifest)│
          ├─ Product Semantics (ontología v3)                                        │
          ├─ Training Semantics (TS v2)                                              │
          ├─ Spec Projection (capacidad, dimensiones, diámetros; con provenance)     │
          ├─ Relationship Projection (same_order; luego compat/dep curadas)          │
          └─ Capability Projection (+ rol)          ─► Retrieval index (in-memory)   │
                                                            │                        │
                                     Retrieval layer: exact · lexical · structured · (vector)
                                                            │ productKeys + señales  │
                                                            ▼                        │
                                              Candidate hydration ◄──────────────────┘
                                                 │                 │
                                              discover        compose (fase 5, gated)
                                                 └────────┬────────┘
                                   Representations: Agent API · Human/Browse API · Internal API
                                                          │
                                       R4 (search, context, discover)   CRM consola/BFF   CP (semantics batch)
```

Fuera de Catalog: personalización por cliente (→ CP o capa de recomendación), política comercial y
decisión de qué ofrecer (→ R4), autorización (→ Governance).

---

## 30. Gap Register

Clasificación: KEEP · CONSOLIDATE · EXTEND · FIX · INTERNALIZE · DEPRECATE · REMOVE_LATER · NEW.
Owner: CS = catalog-service; R4; CRM; CP; NEG = negocio/curación.

| ID | Area | Current | Desired | Impact | A/H/B | Class. | Owner | Prio | Evidence | Phase |
|---|---|---|---|---|---|---|---|---|---|---|
| CPA-01 | Truth | 3 motores de precio/disponibilidad | motor v2 único para toda superficie | verdades contradictorias | B | CONSOLIDATE | CS | P1 | §7; J1-AUDIT §6 | 1, 6 |
| CPA-02 | Truth | `category` = raíz en 873/873 | categoría semántica (trust map) + todas las categorías para filtros | filtro inútil; ruido en contexto | B | FIX | CS | P0 | `mysqlCatalogV2DataReader.ts:269-270`; EXPORT | 0 |
| CPA-03 | Truth | J1C B1–B8, OD-1..3 abiertos | respondidos | J1 no cerrado | A | FIX | CS/R4 | P0 | J1C §9, §12 | 0 |
| CPA-04 | Truth | FBT no cableado | cablear o retirar bloque | bloque siempre `unavailable` | A | FIX | CS | P2 | `bootstrap.ts:104-107` | 1 |
| CPA-05 | Retrieval | v2 sin fallback por tokens | frase + AND de tokens significativos + unidades | 0 resultados en consultas naturales | B | FIX | CS | P0 | §8.2; `mysqlCatalogV2DataReader.ts:237-251` | 0 |
| CPA-06 | Retrieval | sinónimos sólo en intent (8 reglas) | léxico de conceptos gobernado → códigos | recall conceptual | B | NEW | CS/NEG | P1 | `synonyms.ts:8-20` | 2 |
| CPA-07 | Retrieval | sin tolerancia a typos | edición acotada sobre vocabulario de nombres | `mancuena` → 0 | B | EXTEND | CS | P3 | §8.2 | 2 |
| CPA-08 | Retrieval | sin merge de candidatos | retrieval layer híbrido | — | B | NEW | CS | P1 | §17 | 2 |
| CPA-09 | Retrieval | v1 trunca por ID / oculta sin stock | deprecar | resultados falsos en CRM | H | DEPRECATE | CS/CRM | P2 | `mysqlCatalogRepository.ts:397-408` | 6 |
| CPA-10 | Ops/Sec | caché v2 sin cota; lectura sin LIMIT | LRU + tope de candidatos post-ranking | memoria/DoS | B | FIX | CS | P1 | `catalogContractService.ts:52,381-397` | 0 |
| CPA-11 | Specs | specs verbatim; dims=0 | Spec Projection normalizada con provenance | restricciones imposibles | B | NEW | CS | P1 | §1-5; EXPORT | 1 |
| CPA-12 | Semantics | build desde CSV externo | extractor read-only in-repo reproducible | proyecciones congeladas | B | FIX | CS | P1 | `load-input.ts:24-31`; `metadata(1).json` | 1 |
| CPA-13 | Semantics | default silencioso `historical` | fail-closed + versión de schema | discovery vacío (`EXEC-DISC`) | B | FIX | CS | P0 | `product-semantic-snapshot/contracts.ts:71` | 0 |
| CPA-14 | Semantics | recarga sólo por restart | hot reload + métrica de edad | rebuild ⇒ downtime | B | EXTEND | CS | P2 | `bootstrap.ts:159-191` | 1 |
| CPA-15 | Semantics | presencia congelada al build | presencia live al consultar (join con v2) | productos desactivados sugeridos | B | FIX | CS | P1 | `catalog-presence.ts` | 1 |
| CPA-16 | Semantics | sin eje de rol; accesorios como máquina | eje `role` | composición y ranking erróneos | B | EXTEND | CS/NEG | P1 | §9 | 4 |
| CPA-17 | Training | pesos libres excluidos | capacidades implicadas por familia (curadas) | "entrenar espalda" sólo máquinas | A | EXTEND | CS/NEG | P1 | `audit-training-semantic-resolution.ts:24` | 4 |
| CPA-18 | Training | `BAND` ≠ `BAND_SUSPENSION` en scripts | corregir | cobertura mal medida | Int. | FIX | CS | P3 | idem | 1 |
| CPA-19 | Semantics | 2 ontologías con lineage separado | manifest único de proyecciones | pins múltiples, drift | B | CONSOLIDATE | CS | P2 | `semantic-discovery/contracts.ts:27-31` | 1 |
| CPA-20 | Training | registry/clasificadores v1, v2, v2.1 y scripts duplicados | un clasificador activo; resto archivado | deuda | Int. | CONSOLIDATE | CS | P3 | `package.json:43-56` | 1 |
| CPA-21 | Discovery | discovery devuelve IDs; hidratación v1 en cliente | bloque interno de `discover` | joins en el modelo | A | INTERNALIZE | CS | P1 | `client/semanticDiscoveryCapability.ts:466-470` | 3 |
| CPA-22 | Agent | sin primitive conceptual | `catalog.discover` | casos C, D, F, G | A | NEW | CS/R4 | P1 | §13.2 | 3 |
| CPA-23 | Agent | `training-semantics/query` sin consumidor | consolidar en discovery | superficie | Int. | DEPRECATE | CS | P3 | §12 | 3 |
| CPA-24 | Legacy | resolve-intent decide; `barra` hardcodeada | reutilizar constraints/sinónimos dentro de discover; deprecar | decisiones duplicadas | B | INTERNALIZE/DEPRECATE | CS/CRM | P2 | `catalogProductIntentProvider.ts:69-103` | 3, 6 |
| CPA-25 | Relationships | vocabulario DECLARED sin productor | retirar de `src` hasta tener productor | consumidores asumen semántica | B | REMOVE_LATER | CS | P2 | `recommendation/contracts.ts:80-135` | 4 |
| CPA-26 | Compat | sin compatibilidad | derivación barra↔disco por diámetros + tabla curada | combinaciones absurdas | B | NEW | CS/NEG | P2 | §21 | 4 |
| CPA-27 | Compat | `ps_accessory`/`ps_pack` no leídos | auditar (D2/D3) e ingerir como fuente candidata | datos desaprovechados | B | EXTEND | CS | P2 | grep 0; J1C D2/D3 | 4 |
| CPA-28 | Composition | inexistente | plantillas de objetivo + `compose` determinista | caso E | A(+H) | NEW | CS/NEG | P3 | §20 | 5 |
| CPA-29 | Human | sin browse/facets/paginación | Browse API sobre el mismo retrieval | consola limitada | H | NEW | CS/CRM | P2 | §14 | 6 |
| CPA-30 | Human | CRM ensambla vista con 3 llamadas v1 | consola sobre v2 context + internal inspect | verdad v1 a humanos | H | FIX | CRM/CS | P2 | `CRM/lib/catalog/consoleService.ts:289-298` | 6 |
| CPA-31 | Legacy | explore full scan + reglas ad hoc | absorber en browse | dos taxonomías | H | DEPRECATE | CS | P3 | `defaultExploreProductsService.ts:42-64` | 6 |
| CPA-32 | Boundary | personalización con CP dentro de Catalog (ciclo) | mover a CP/capa de recomendación | acoplamiento | B | DEPRECATE | CS/CP | P3 | `httpCustomerAffinityEvidenceProvider.ts:221`; `CP/…/http-product-semantic-facts-source.ts:110` | 6 |
| CPA-33 | Ops | readiness depende de snapshot de relaciones | readiness por capability; truth = DB | caída total por rama opcional | B | FIX | CS | P1 | `readiness.ts:35`; `app.ts:204-209` | 0 |
| CPA-34 | Obs | labels de cardinalidad no acotada | enums + logs estructurados | Prometheus | Int. | FIX | CS | P2 | `metrics.ts:119-123` | 1 |
| CPA-35 | Obs | sin estrategia/no-result reason | modelo §25 | no se puede evaluar | B | NEW | CS | P2 | §25 | 2 |
| CPA-36 | Eval | sin gold set con juicios; v2 sin suite de relevancia | gold set versionado + harness | sin gates | B | NEW | CS/NEG | P0 | `catalogSearchRelevanceCases.ts` | 0, 2 |
| CPA-37 | Sec | un solo scope de keys; límite por IP | scopes agent/human/internal + límites por key | abuso, auditoría | B | EXTEND | CS | P2 | `app.ts:90-94,213-225` | 3 |
| CPA-38 | Test | 12 tests dependen de snapshot gitignorado | fixture de snapshot versionada | CI rojo crónico | Int. | FIX | CS | P2 | ejecución: 12 fail / 2304 pass | 1 |
| CPA-39 | Client | `client/` sin consumidor, adapter CRM a mano | cliente generado de schemas v2 | divergencia de contratos | B | DEPRECATE | CS/CRM | P3 | §12 | 6 |
| CPA-40 | Vector | inexistente | generador vectorial opcional, eval-gated | recall de paráfrasis | B | NEW (condicional) | CS | P3 | §16 | 2b |
| CPA-41 | Contract | `searchMode: z.literal('lexical')` | evolución aditiva coordinada con R4 (o híbrido sólo en discover) | ruptura de consumidor estricto | A | EXTEND | CS/R4 | P2 | `v2/contracts.ts:118` | 2 |

---

## 31. Incremental Migration Roadmap

| Fase | Contenido | Prerrequisitos | Outputs | Riesgo de migración | Evaluation gate |
|---|---|---|---|---|---|
| **0 — Preservar y estabilizar J1** | commit J1C; B1–B8; CPA-02, -05, -10, -13, -33; gold set v0 (sólo nominal/sinónimo/typo) | autorización read-only prod | J1 cerrado; search v2 sin regresiones | bajo (aditivo, mismo contrato) | exact = 100 %; recall@10 ≥ oráculo en gold v0; fixtures del owner sin cambios de forma |
| **1 — Racionalizar proyecciones** | extractor in-repo; manifest único; fail-closed; hot reload; presencia live; Spec Projection; FBT; consolidar clasificadores; fixture de snapshot | fase 0 | builds reproducibles con hash; specs normalizadas con provenance | medio (reemplazo de fuente) | build del mismo input ⇒ mismo hash; precisión revisada de specs: DEFERRED / WAIVED BY PRODUCT DECISION (normalización determinista, sin verificación física externa); diff semántico vs snapshot anterior revisado |
| **2 — Retrieval híbrido** | léxico de conceptos; generadores exact/lexical/structured; merge/rank; observabilidad; 2b: vector opcional tras flag | fases 0–1, gold v1 con juicios | retrieval layer interno usado por v2 search (sin cambio de contrato) | medio (ranking cambia) | nDCG@10 y recall@10 mejoran sin regresión en exact/nombre; 2b sólo si el vector aporta ≥ X pp en recall conceptual (X = decisión D4) |
| **3 — `catalog.discover`** | endpoint agente; semantic discovery → interno; piezas de intent → interno; scopes de keys | fase 2 | tool R4 nueva; discovery interno | medio (R4 agrega tool) | discovery eval: cobertura relevante, irrelevantes top-5, 0 violaciones de restricciones; eval de conversación R4 |
| **4 — Capability / rol / compatibilidad** | eje rol; capacidades implicadas por familia; compat barra↔disco derivada; ingesta `ps_accessory`/`ps_pack` si aplica; retirar vocabulario muerto | decisiones D1, D5; revisión NEG | proyecciones curadas versionadas | medio (curación) | precisión ≥ 95 % en muestra revisada por negocio; 0 relaciones sin `source` |
| **5 — `catalog.compose`** | plantillas de objetivo; solver determinista | fase 4 | endpoint (agente y humano) | alto (nuevo dominio) | 100 % presupuesto y dependencias; revisión humana de planes por plantilla |
| **6 — Convergencia humana y retiro de legado** | Browse API; consola CRM sobre v2; deprecar v1/explore/intent/cliente; personalización fuera | fases 0–3 | una sola verdad para humanos | medio (CRM) | paridad funcional de la consola; tráfico v1 = 0 antes de remover |

---

## 32. Decisions Required

| ID | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | Dueño y alcance de la taxonomía de capacidades/rol (¿reabrir `SQUAT` genérico, `BENCH_PRESS`?) | Catalog / Sales / conjunto | Catalog dueño, negocio revisa, con evidencia |
| D2 | Precio "desde" (OD-1) | todas las variantes / sólo vendibles | sólo vendibles, con fallback explícito |
| D3 | Fuente de "categoría" en v2 | default / trust map / familia | categoría semántica de la trust map + lista completa |
| D4 | ¿Se permite embedding en query-time? proveedor, umbral de ganancia | no / local / externo | no en fase 2; decidir con gold v1 |
| D5 | Gobierno del léxico de conceptos y reglas curadas | CS / NEG / ambos | archivo versionado en CS, revisión NEG |
| D6 | Dueño de plantillas de objetivo de `compose` | Catalog / R4 | Catalog (datos), R4 (cuándo usarlo) |
| D7 | Personalización por cliente | queda / sale de Catalog | sale (CP o capa de recomendación) |
| D8 | Superficie humana | browse en Catalog / BFF CRM | browse en Catalog, BFF delgado |
| D9 | Exposición de FBT al agente | cablear / retirar | cablear como `inferred` rotulado |
| D10 | Cuándo R4 ve `discover` | tras fase 2 / directo | tras fase 2 (sobre retrieval corregido) |
| D11 | Evolución de `searchMode` en v2 search | nuevo valor / mantener `lexical` y exponer híbrido sólo en discover | mantener search nominal; híbrido en discover |
| D12 | Calendario de deprecación legado | — | tras migración CRM y tráfico v1 = 0 |
| D13 | Uso de conversaciones reales anonimizadas para el gold set | sí / no | sí, sólo queries, sin PII |

---

## 33. UNKNOWN / Missing Evidence

| # | UNKNOWN | Evidencia necesaria |
|---|---|---|
| U1 | Estado de los snapshots en producción (¿incluye `catalogPresence`? ¿existen TS v2 y relaciones?) | `active.json` y cabecera del snapshot activo en el host; `GET /v1/products/semantic-discovery/query` read-only |
| U2 | Collation productiva (afecta `SIM-V2`: acentos) | `SHOW FULL COLUMNS FROM ps_product_lang` (J1C D1) |
| U3 | ¿`ps_product_shop.id_category_default` difiere de `ps_product`? | `SELECT COUNT(*) … WHERE ps.id_category_default <> p.id_category_default` |
| U4 | Contenido de `ps_accessory` y `ps_pack` | J1C D2/D3 |
| U5 | J1C B1–B8 | `docs/audits/r4-j1c-production-unknowns.sql` (autorización) |
| U6 | Latencia real de v2 search con consultas amplias (lee todos los matches) | smoke read-only autorizado |
| U7 | Ubicación y reproducibilidad del extractor que generó EXPORT | repositorio/script de `customer-intelligence-r2-a00-product-exploration-v1` |
| U8 | Volumen de uso real por endpoint y consumidor | métricas `/metrics` productivas |
| U9 | ¿R3 (gateway CRM) sigue en producción? | configuración de despliegue CRM |
| U10 | Topología de rate limit (R4 y CRM por la misma IP) | J1C D9 |
| U11 | Specific prices reales (SIM-V2 no los incluye; precios de §20 son netos × 1,19) | lectura productiva |
| U12 | Precisión real del parseo de specs (formatos de "Peso máximo…", "Dimensiones…") | muestra revisada en fase 1 |
| U13 | Disponibilidad/coste de un modelo de embedding en español | decisión D4 |
| U14 | Productos agregados a PS después de 2026-08-27 sin semántica | diff DB vs snapshot |

---

*Archivo generado por la auditoría CATALOG PLATFORM ARCHITECTURE AUDIT. Nada se implementó, commiteó ni
pusheó. Análisis ejecutados: suite de tests (2304 pass / 12 fail, los mismos 12 del baseline J1C que
requieren el snapshot TS v2 gitignorado), `SIM-V2` y `EXEC-DISC` como scripts temporales eliminados tras
la ejecución.*
