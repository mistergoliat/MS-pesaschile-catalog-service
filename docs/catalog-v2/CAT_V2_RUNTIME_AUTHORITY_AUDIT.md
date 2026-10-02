# CAT-V2 P2.1 — Runtime Authority Audit

**Fecha de auditoría:** 2026-10-02

**Checkout:** `main`, commit `2a76dcd765304c9dac68a3343574a8ea8d30b6e8`

**Alcance del baseline:** auditoría de código y propuesta previa a P2.1B. La sección 10 registra la implementación posterior; no altera los hechos del baseline.

## 1. Resumen ejecutivo

CAT-V2 convive con varias autoridades efectivas. El bundle activo sí gobierna Product Semantics en las rutas de producto cuando está cargado, pero no gobierna todavía Training Semantics V2, Specs normalizadas ni Relationships. El hecho de que `/health/projections` muestre una proyección `READY` solo acredita que el artefacto está cargado; no acredita que un endpoint la consuma.

Hallazgos principales:

1. **Las tres rutas centrales `/v2/catalog/*` responden con datos comerciales vivos de PrestaShop**, pero `CatalogContractService` lee y calcula su propia verdad con `MySqlCatalogV2DataReader` y `commercialEngine`. No llama a `CatalogCommercialTruthService`. Además, las rutas V1 usan `CatalogApplicationService` y proveedores distintos. La fuente de datos es PrestaShop en los tres casos, pero el owner runtime no es único.
2. **Product Semantics usa el bundle CAT-V2 si hay un estado capturado.** Si no hay bundle y el runtime está específicamente en `NO_ACTIVE_BUNDLE`, el adaptador delega al snapshot legacy y suma `catalog_product_semantic_legacy_fallback_total`. No agrega autoridad/fallback a cada respuesta, y el resultado no contiene `projectionBundleId` ni `activationId`.
3. **Training Semantics V2 público y el eje Training de semantic discovery leen el snapshot legacy V2** (`FileTrainingSemanticSnapshotV2Store`). El Training Semantics V1 del bundle no es una sustitución contractual: los schemas y dominios de campos difieren. Clasificación: **C — representan conceptos/esquemas distintos**. V2 debe seguir como autoridad temporal de esos endpoints hasta que exista una proyección CAT-V2 V2 y un contrato de migración.
4. **El bundle contiene Specs normalizadas y trust metadata, pero no hay lector de esos valores en el contexto HTTP V2.** `facts.specifications` son feature facts leídos en vivo desde PrestaShop. La selección de categoría usa una trust map estática generada e incluida en código, no la trust map CAT-V2.
5. **Relationships CAT-V2 y Capabilities CAT-V2 permanecen `UNAVAILABLE`.** La recomendación `SearchProducts V2` usa otro snapshot legacy de relaciones y Commercial Truth para hidratar resultados. El campo `frequentlyBoughtTogether` de product context queda `unavailable/not_supported` en la composición real porque no se inyecta provider.
6. **Frescura/lineage no están unificados:** `/v2/catalog/*` emite `freshness.asOf/cache/validUntil` comercial; el manager conoce `projectionBundleId`, `activationId` y `loadedAt`, pero solo los publica en `/health/projections`. La semántica legacy publica `snapshotId`; ninguna respuesta Product Semantics vincula ese ID con el bundle y activation que lo sirven.
7. **Build provenance no está garantizada en producción por este repo.** `serviceBuildRef` cae a `catalog-service@local` si no se inyecta `CATALOG_SERVICE_BUILD_REF`. El Dockerfile, `.env.example` y runbook no establecen esa variable. P1.6 ya la registra como deuda operativa. Este checkout no permite verificar el valor actualmente desplegado.
8. **No existe `GET /health/catalog-authority`.** `/health/projections` expone estado de carga, mientras `/health/ready` combina readiness de distintas generaciones bajo etiquetas iguales; `trainingSemantics`, en particular, puede significar Training V1 del bundle o Training V2 legacy según el objeto consultado.
9. El repo no contiene el runtime R4. El audit arquitectónico previo clasifica Search y Product Context como API del agente y Item Context como lectura interna de R4/Quote, pero el uso productivo y las herramientas/modelos que reciben cada respuesta no se pueden comprobar desde este checkout.

**Resultado:** P2.1 aún no cumple el criterio de contrato unificado. Esta auditoría es evidencia para definir el cambio mínimo; no implementa el contrato ni altera authorities existentes.

## 2. Método y límites de evidencia

Se trazaron rutas Fastify → controller/service → adapters/readers → runtime state o PrestaShop, junto con loaders, caches, startup y health. También se buscaron los términos `product semantic snapshot`, `training semantic snapshot`, `relationship snapshot`, `RuntimeProjectionState`, `Commercial Truth`, `catalog search`, `product context` e `item context` en `src`, `tests` y documentación.

Evidencia de código actual: `src/bootstrap.ts`, `src/server.ts`, `src/interfaces/http/app.ts`, `src/interfaces/http/routes/*`, `src/application/*`, `src/domain/catalog/*`, `src/domain/product-semantic-snapshot/*`, `src/domain/training-semantic-snapshot/*`, `src/domain/recommendation/relationship-engine/*` e infraestructura indicada en las filas de la matriz.

La auditoría de cierre P1.6 (`docs/architecture/CAT-V2-P1.6-phase1-closure-audit.md`) registra pruebas de producción reportadas por el operador, pero también dice que el repo no tiene acceso directo al deployment ni logs de los drills. El alias B1 y su hash reportado en la solicitud son contexto de partida; no se consultó el runtime desplegado. La evidencia local solo confirma wiring/código.

## 3. Flujo runtime observado

```text
HTTP /v2/catalog/*
  → CatalogContractService
  → MySqlCatalogV2DataReader (PrestaShop)
  → comercialEngine + facts PS + categoryTrustMap estática
  → cache Map local de hasta 500 entradas, TTL/freshness por defecto 15 s

HTTP /v1/products/* (truth)
  → CatalogApplicationService
  → MySqlCatalogRepository + MySqlSearchProvider
  → SqlPricingProvider + PrestaShopPhysicalStockProvider
  → CacheProvider (memory o Redis; TTL por área)

HTTP /api/v2/recommendations/search-products
  → SearchProductsV2Service
  → snapshot legacy de relaciones + CatalogCommercialTruthService para hidratar
  → afinidad opcional

HTTP Product Semantics
  → RuntimeProductSemanticReader
  → Product Semantics del RuntimeProjectionState si está presente
  → snapshot Product Semantics legacy solo si reloadState=NO_ACTIVE_BUNDLE

HTTP Training Semantics V2 / semantic discovery Training axis
  → TrainingSemanticRead/Query/SemanticDiscoveryService
  → snapshot V2 legacy; el Training V1 del bundle no se consulta
```

Referencias de wiring: [bootstrap.ts](../../src/bootstrap.ts#L82), [app.ts](../../src/interfaces/http/app.ts#L196), [runtime-projection.ts](../../src/domain/catalog/runtime-projection.ts#L9), [RuntimeProductSemanticReader](../../src/domain/catalog/runtime-product-semantic-reader.ts#L6), [CatalogContractService](../../src/application/catalog/v2/catalogContractService.ts#L49), [CatalogApplicationService](../../src/application/catalogService.ts#L75), [recommendationRuntime.ts](../../src/recommendationRuntime.ts#L61).

## 4. Authority Matrix

| Domain | Field / capability | Autoridad efectiva actual | Autoridad deseada | Runtime path | Dependencia legacy / estado | Freshness y lineage actual | Acción propuesta |
|---|---|---|---|---|---|---|---|
| commercial | price, regular price, promotion | PrestaShop `product.price`/combination impact + `specific_price`, calculados por cada engine consumidor | Commercial Truth runtime | `/v2/catalog/*` → `MySqlCatalogV2DataReader` + `commercialEngine`; recomendaciones → `CatalogCommercialTruthService`; V1 → `SqlPricingProvider`/`priceResolver` | Tres paths de cálculo/precio coexisten; solo comparten la fuente PS, no un servicio único | V2 catalog: `asOf`, cache local, 15 s; commercial-truth service: `evaluatedAt`; V1 cache por precio y detalle con TTL configurado | El nuevo contexto debe marcar autoridad comercial explícita y reutilizar el path ya aprobado de cada endpoint durante esta fase. Consolidar motores requiere decisión aparte; no hacerlo dentro del contrato sin paridad demostrada. |
| commercial | tax | `TAX_RATE` de config aplicado por `commercialEngine`; default 0.19. El cálculo usa esa tasa configurada | Commercial Truth runtime | `CatalogContractService.publicContext()` → `commercialEngine` | No se lee una tasa por producto desde proyección; V1 y `CatalogCommercialTruthService` tienen sus propios contextos/calculadores | Hereda `asOf` y TTL de cada path; no tiene provenance de fuente fiscal independiente | Exponer base/configuración del cálculo en el contrato sin alterar reglas comerciales; documentar que es tasa configurada. |
| commercial | stock, backorder, availability | Stock vivo de `stock_available`; políticas de backorder y lifecycle PS; sellability derivada en engine | Commercial Truth runtime | V2 data reader → variants/simple stock/backorder → `deriveSellability`; V1 usa repository + `PrestaShopPhysicalStockProvider`; recomendaciones usan `CommercialAvailabilityResolver` | No hay fallback al bundle. Hay engines/rutas separados | V2 catalog: 15 s local; V1 stock default 15 s; commercial service evalúa en request | Contexto separado `commercial.availability`; si PS no está disponible devolver error/unavailable tipado, nunca sustituir desde bundle. |
| identity | `productKey`, `itemKey`, `productId` | PrestaShop `id_product`; V2 forma `P{id}` y `P{id}-V{combinationId}` | Identidad canónica de catálogo | `buildProductKey/buildItemKey` y parsers en `commercialEngine.ts`; V2 reader consulta IDs PS | APIs V1 aún aceptan IDs numéricos; adapters legacy usan otra forma de referencia | Estable mientras persiste identidad PS; no versionada por bundle | Mantener formato opaco V2, fijar `productId` como referencia interna y declarar owner de identidad. |
| product | name, SKU, category, brand, status, descriptions, variant facts | PrestaShop live, mapeado por `MySqlCatalogV2DataReader` | Fuente canónica/owner definido; actualmente PrestaShop | `/v2/catalog/search` y contexts → reader; V1 detail/search → repository/providers distintos | Categoría incluye clasificación con `categoryTrustMap.ts` generado estáticamente. No consume trustMaps del bundle | V2 cache 15 s; V1 por cache área (search 300 s, product 900 s por defaults) | Separar `facts` de `commercial`; atribuir campos al reader/owner y decidir más adelante una sola ruta de lectura. |
| semantics | Product Semantics | CAT-V2 runtime si un bundle está capturado; legacy product snapshot solo para `NO_ACTIVE_BUNDLE` | CAT-V2 bundle activo | GET/BATCH `/v1/products/.../semantics`, Product axis en semantic discovery → `RuntimeProductSemanticReader` → `RuntimeProjectionState.productSemantics` | Fallback legacy medido por counter; no ocurre en `FAILED`/pointer corrupto ni cuando el bundle cargado no contiene el producto. No lleva `authority` ni fallback flag por respuesta | API expone `snapshotId`/semantic metadata; runtime health conoce bundle/activation/loadedAt; la respuesta no trae bundle/activation | Poner lineage del bundle/activation en contexto común. Mantener fallback solo tipado y observable o retirarlo tras la condición de P1.6; nunca usar `legacy ?? catV2` por producto. |
| semantics | Product ontology registry | Ontología V3 servida desde registry determinista en código, no desde el bundle ni el snapshot de hechos | Registry versionado/compatible con la autoridad declarada para hechos | GET `/v1/products/semantics/registry` → `defaultProductSemanticsRegistryService` | No usa fallback de snapshots; es vocabulario, separado de Product Semantics records | Version/hash del registry de código | Declarar registry y facts como capabilities/provenance distintas para evitar que “Product Semantics = CAT-V2” sugiera que ambos vienen del bundle. |
| semantics | Training Semantics | Snapshot Training Semantics V2 legacy | Futuro artefacto CAT-V2 con contrato V2; conservar V2 como autoridad hasta migración | V1 product/batch/registry/query + semantic discovery Training axis → `FileTrainingSemanticSnapshotV2Store`/V2 reader | `RuntimeProjectionState.trainingSemantics` contiene V1 distinto y no tiene consumidor HTTP; no sustituye V2 | Legacy expone snapshotId/checksums/schema lineage; su freshness es build-time. CAT-V2 guarda V1 bajo bundle distinto | Clasificación **C** (schemas/dominios distintos). Decisión de runtime temporal: V2 legacy sigue authority. No migrar V1→V2 sin adapter contractual/evidencia. |
| semantics | Training ontology registry | Registry V2 compilado en código; el endpoint no necesita snapshot de datos para responder vocabulario | Registry versionado junto al futuro artefacto Training V2 | GET `/v1/products/training-semantics/registry` → `getTrainingSemanticRegistryV2()` | Registry independiente del snapshot Training V2 | Versión/hash de registry en el payload | Exponer authority/version del registry por separado del authority del Training Semantics por producto. |
| specs | Specs normalizadas | No hay consumidor HTTP de `RuntimeProjectionState.specs`; `facts.specifications` de product context son facts/features de PrestaShop | CAT-V2 bundle para specs normalizadas | V2 reader `readSpecifications()` → `CatalogV2Product.specifications` → `facts.specifications`; el manager carga por separado `get('specs')` | La proyección CAT-V2 está cargada pero no gana autoridad de ningún endpoint actual | PS feature facts: freshness comercial 15 s. Specs CAT-V2: `projectionBundleId`/`activationId` globales + `loadedAt`, solo health | Introducir un campo separado `knowledge.specs` con estado disponible/desconocido y bundle lineage. Preservar la limitación `source-derived deterministic truth != externally certified physical truth`. |
| trust | source/category/feature trust metadata | `trustMaps` CAT-V2 se carga y valida, pero no hay consumidor runtime; selección de categoría usa `categoryTrustMap.ts` generado y versionado en código | CAT-V2 bundle trust metadata para conocimiento normalizado | `RuntimeProjectionManager.load()` → hash/artifact; selección category en `meaningfulCategory.ts` usa `CATEGORY_TRUST_BY_ID` estático | El mapa estático es una autoridad/adaptador legacy por fuera del bundle; trustMaps CAT-V2 no gobierna esa selección | CAT-V2 `loadedAt` y bundle/activation en health; la respuesta V2 no reporta qué mapa seleccionó categoría | No presentar el hash cargado como si el endpoint lo usara. En P2.1 exponer autoridad actual y reservar sustitución hasta comparar/paridad de datos. |
| relationships | `relationships`, FBT | CAT-V2 `UNAVAILABLE`; recomendación SearchProducts usa snapshot legacy independiente. FBT en product context `unavailable/not_supported` en composición real | CAT-V2 futuro (P2.3); no mezclar con bundle hasta entonces | `/api/v2/recommendations/search-products` → `FileProductRelationshipSnapshotStore` + reader; product context `inferred` no recibe provider | Legacy relationship snapshot sigue temporalmente siendo authority solo para recomendación; falla con 503 si está ausente. FBT no está wired | Snapshot `builtAt`/`snapshotId`; enriquecimiento comercial tiene freshness propia. CAT-V2 estado unavailable | Exponer ambas cosas con scopes diferentes: `knowledge.relationships.status=unavailable`; diagnóstico separado del lector legacy solo para su endpoint. |
| capabilities | `capabilities` | CAT-V2 `UNAVAILABLE`; Training V2 legacy contiene `exerciseCapabilities` como datos del schema legado | CAT-V2 futura (P2.4) | Runtime manifest/readiness marca unavailable; las rutas de training V2 leen otro snapshot | No inferir capabilities CAT-V2 desde training V1/V2 ni convertir ausencia en false | CAT-V2 status unavailable. Training V2 tiene lineage de snapshot legacy | Mantener `status=unavailable` y razón explícita en contexto; excluir inferencia runtime en P2.1. |

### Evidencia de rutas principales

| Ruta | Clasificación de contrato | Lo que entrega hoy | Nota sobre consumidor R4 |
|---|---|---|---|
| `POST /v2/catalog/search` | **AGENT API**; también apta para HUMAN/BFF | resultados nominales a nivel producto con facts mínimos, resumen de precio/disponibilidad y `freshness`; no trae lineage CAT-V2 | Audit arquitectónico previo la enumera como superficie pública del agente. El repo no trae el source de R4 para verificar llamadas productivas. |
| `GET /v2/catalog/products/:productKey/context` | **AGENT API**; también apta para HUMAN/BFF | facts PS, raw feature specifications, derived price/availability, FBT unavailable y provenance comercial | Documentación de P1.6 registra humo de producción; audit arquitectónico lo clasifica para agente y humano. R4 source ausente aquí. |
| `GET /v2/catalog/items/:itemKey/context` | **SERVICE API / INTERNAL** para resolución de unidad/Quote; R4 lo consume como paso interno según audit previo | facts de variante, precio y disponibilidad de unidad | El audit previo dice “interno de R4, no tool del modelo”; no exponerlo directamente al modelo solo por estar registrado. |

Clasificaciones restantes propuestas según la superficie/código actual:

- **SERVICE API / INTERNAL ONLY:** `/v1/products/semantics*`, `/v1/products/*/training-semantics`, `/v1/products/semantic-discovery/query`, `/api/v2/catalog/resolve-product-intent`, `/api/v2/recommendations/search-products`. Son building blocks/diagnóstico/contratos de servicio; no se recomienda presentarlos como tools nuevas del agente durante P2.1.
- **HUMAN API / INTERNAL:** `/v1/products/explore` y SearchProducts V2 para consola/diagnóstico según consumidores externos documentados. Mantener API key; hoy las keys no distinguen scopes Agent/Human/Service.
- **INTERNAL ONLY (ops):** `/health/*`, `/metrics`, `/openapi.json`, `/docs`. `/health/*` está excluido del api-key hook; readiness/debug debe limitar campos a metadata no sensible.
- **Legacy consumer paths:** `/v1/products/search`, `/:id`, `/batch`, explore, intent-resolution y snapshots semánticos continúan registrados; no eliminarlos en este alcance.

Fuentes de esta tabla: rutas registradas en [app.ts](../../src/interfaces/http/app.ts#L252), [catalogV2Routes.ts](../../src/interfaces/http/routes/catalogV2Routes.ts#L80), [searchProductsV2Route.ts](../../src/interfaces/http/routes/searchProductsV2Route.ts#L94); clasificación previa en [CATALOG_PLATFORM_ARCHITECTURE_AUDIT.md](../architecture/CATALOG_PLATFORM_ARCHITECTURE_AUDIT.md#L837). La clasificación de R4 procede de ese documento y no de inspección del repo R4.

## 5. Decisiones por migration path legacy

### Product Semantics

- Las rutas individuales, batch y Product axis de discovery reciben `RuntimeProductSemanticReader` desde `bootstrap.ts`.
- `/v1/products/semantics/registry` es distinto: devuelve el vocabulario ontology V3 por `defaultProductSemanticsRegistryService`, independiente del active bundle y del legacy product snapshot.
- Con estado capturado CAT-V2, las facts se leen del bundle. Si el bundle no contiene un `productId`, el resultado es missing; no se rellena con snapshot legacy.
- Solo el estado explícito `NO_ACTIVE_BUNDLE` habilita el reader legacy; pointer corrupto/fallo de carga no habilita fallback. Esto evita ganar con legacy ante un estado CAT-V2 roto.
- El fallback está documentado y tiene métrica (`catalog_product_semantic_legacy_fallback_total`), pero la respuesta no reporta cuál authority la produjo. La métrica cuenta delegaciones/lecturas, no requests únicos.
- **Decisión:** conservar la regla acotada de P1.6 durante migración; P2.1 debe exponer `authority`/`fallbackUsed` en el contrato interno y lineage del bundle. La salida pública actual puede conservarse aditiva/compatible o seguir siendo legacy mientras no se migre.

### Training Semantics

- Schema CAT-V2 Training V1: `schemaVersion: '1'`, `records[].assignments[]` con `capabilityCode`, `relationType`, `coverageStatus`, evidencia y provenance (`training-semantic-snapshot/contracts.ts`).
- Legacy Training V2: `schemaVersion: '2'`, `exerciseCapabilities[]`, `trainingFunctions[]`, estados de resolución/coverage, metadata `sourceV1SnapshotId`, `classifierV2RulesHash` (`training-semantic-snapshot/v2-contracts.ts`).
- `/v1/products/training-semantics/registry` devuelve vocabulario V2 desde el registry de código, aunque las rutas de hechos/query dependan del snapshot V2 activo.
- Los endpoints V2 y la query de discovery exigen reader V2. El estado V1 del bundle no participa. Las respuestas contienen snapshot lineage legacy; CAT-V2 bundle lineage no aplica a esa autoridad.
- **Clasificación:** **C**. No son schemas intercambiables y no se ha demostrado una transformación que conserve semántica. **Decisión temporal:** D en términos de authority operacional: Training V2 legacy permanece owner hasta una proyección CAT-V2 V2 con pruebas de contrato/linaje.

### Relationships y Capabilities

- `RuntimeProjectionState.relationships/capabilities` se carga desde el manifest como unavailable. No es el reader usado por recomendación.
- `recommendationRuntime` carga un snapshot legacy al boot. El fallo de esa carga se captura y no impide arrancar; el endpoint dependiente de relaciones responde 503.
- `CatalogContractService.inferred()` retorna `unavailable/not_supported` cuando no tiene provider; `bootstrap.ts` no inyecta uno.
- **Decisión:** dejar la autoridad legacy de recomendaciones claramente externa al futuro `knowledge.relationships`; no mezclarla en el contexto unified ni etiquetarla como CAT-V2. Mantener capabilities CAT-V2 unavailable sin inferencia.

## 6. Frescura, lineage, failure y observabilidad actuales

| Capability | Comportamiento actual ante ausencia/fallo | Observabilidad actual | Gap P2.1 |
|---|---|---|---|
| Commercial Truth | `/v2/catalog/*` mapea `DatabaseUnavailableError` a HTTP 503. No consulta projections. Las rutas V1 fallan desde sus DB/providers; no hay fallback a bundle. | `freshness` de la ruta V2; `/health/ready` database/cache status | El contrato runtime común no existe y paths comerciales calculan en más de un engine. No usar stock/precio bundle como failover. |
| Product Semantics | CAT-V2 ausente puede usar legacy solo en `NO_ACTIVE_BUNDLE`; carga fallida/pointer inválido no. Sin valor usable produce error/not-found según condición. | Counter de fallback; `snapshotId`; health projections separado | Falta provenance por respuesta: authority, bundle ID, activation ID y `fallbackUsed`. |
| Training V2 | Sin snapshot activo o snapshot inválido: rutas dedicadas responden unavailable/503; no clasifican ni leen SQL en request. | `snapshotId`, checksum/schema metadata y log de load | Identificar que authority es `legacy-training-v2`; separar de la readiness Training V1 del bundle. |
| Specs/trustMaps | Manager requerido en boot/reload puede estar unavailable; endpoint actual no consume esas proyecciones. | `/health/projections` dice loaded/unavailable | Health `READY` no prueba consumo; el contexto no publica unavailable/available de esas proyecciones. |
| Relationships | Snapshot legacy no disponible → SearchProducts V2 devuelve 503; CAT-V2 Relationships sigue unavailable. | `/health/ready.relationshipSnapshot`, loader status/logs | Dos authorities necesitan claves independientes y scopes de respuesta separados. |
| Capabilities | CAT-V2 sigue unavailable; no hay projection runtime de capabilities. | `/health/projections.readiness.capabilities=UNAVAILABLE` | No confundirlo con campos capability del Training V2 legacy. |

Frescura V2 comercial se construye en `CatalogContractService`: por defecto 15 s; `asOf` viene de `MySqlCatalogV2DataReader` antes de ejecutar lecturas paralelas; cache `Map` acotado localmente; `validUntil` termina en el TTL o antes si cambia el precio programado. Ese `asOf` no es timestamp de snapshot transaccional de todas las consultas. El runtime CAT-V2 conserva `loadedAt`, `projectionBundleId` y `activationId`; esos valores actualmente solo salen por `/health/projections`. No se mezclan hoy en un mismo JSON, pero falta el contexto único que preserve ambas dimensiones.

`/health/ready` y `/health/projections` son públicos respecto al api-key hook porque `app.ts` excluye todas las rutas `/health`. `/health/ready` solo devuelve 503 por database/Redis (dependencias comerciales); las capacidades opcionales pueden degradar a 200. `/health/projections` incluye estado de carga, IDs, errores y readiness, no un mapa de autoridades efectivamente consultadas por endpoint.

`serviceBuildRef` se genera por `CatalogContractService.provenance()` y aparece en Product/Item Context, no en Search. El constructor lee `dependencies.serviceBuildRef`, luego `process.env.CATALOG_SERVICE_BUILD_REF`, y por último usa `catalog-service@local`. No hay `BUILD_SHA`/deployment metadata obligatorio ni validación productiva en `shared/config.ts`; el Dockerfile copia `dist` y no define el ref. El runbook tampoco lo establece.

## 7. Propuesta de cambios para implementar tras revisar esta evidencia

Propuesta acotada a P2.1, en este orden:

1. Definir `CatalogRuntimeProductContext` interno, versionado y compuesto por `identity`, `facts`, `commercial`, `knowledge`, `provenance` y `freshness`. Reutilizar types actuales y no cambiar las respuestas HTTP existentes por defecto.
2. Crear un composer/authority adapter que reciba el resultado comercial del path aprobado y el estado CAT-V2 capturado del request. Para knowledge añadir estados tipados y lineage `{ projectionBundleId, activationId, loadedAt }`; separar `freshness.commercial` de `freshness.knowledge`.
3. Conectar Product Semantics al composer con authority explícita y fallback legado solo cuando `NO_ACTIVE_BUNDLE`. Medirlo sin etiquetar valores legacy como CAT-V2. Evitar el fallback si una projection requerida se corrompe/no carga.
4. Conectar Specs normalizadas CAT-V2 a un campo separado de los feature facts actuales. No declarar el campo actual `facts.specifications` como projection normalizada.
5. Mantener Training Semantics V2 legacy con `authority=legacy-training-v2`, `migrationStatus=PENDING`; no inyectar Training V1 del bundle como V2. Versionar Training V2 en CAT-V2 en una fase posterior.
6. Representar Relationships CAT-V2 y Capabilities CAT-V2 como unavailable. Exponer provenance legacy de relaciones solo dentro del resultado/estado del endpoint de recomendaciones que sí depende de ese snapshot.
7. Añadir health/debug catalog authority que reporte por dominio authority/status/fallback, active bundle ID + activation ID, loaders legacy habilitados/usados y build ref. No exponer valores secretos; conservar health readiness actual independiente para no retirar nodos por knowledge opcional.
8. Resolver `serviceBuildRef` desde metadata de build/deployment sin escribir SHA manual: inyección en build/deploy, fallback de desarrollo explícito y validación que impida `@local` en producción.
9. Añadir pruebas de aislamiento: el bundle no puede suministrar precio/stock/sellability; product semantics/specs cambian con B1→B2 y rollback; snapshots Training V2 y Relationships conservan autoridad explícita; fallos devuelven unavailable/503 sin convertir UNKNOWN en FALSE.

Este plan no incluye `catalog.discover`, embeddings, semantic ranking, Relationship/Capabilities Projection, recomendador, scheduler ni cambios a DB PrestaShop. La consolidación de los motores de Commercial Truth detectada se registra como deuda y queda fuera de estos cambios de contrato salvo la selección explícita del path que compone cada respuesta.

## 8. Deuda residual visible antes de iniciar implementación

| Item | Evidencia | Consideración de cierre |
|---|---|---|
| Fuentes de R4 no incluidas en este repo | Rutas y clientes HTTP del servicio sí están; no hay adapter/tool R4 aquí | Validar consumo real con contrato/config de R4 antes de anunciar qué campos recibe el modelo en producción. |
| Tres paths de Commercial Truth | `CatalogApplicationService`, `CatalogCommercialTruthService`, `CatalogContractService` usan lectores/calculadores distintos | P2.1 no debe asumir un owner runtime único ni cambiar cálculo sin parity gate. |
| Trust map fuera del bundle | `meaningfulCategory.ts` consume `categoryTrustMap.ts`, mientras RuntimeProjectionState solo carga hashes | Definir owner de trust de categoría o dejar explícito que esta authority sigue fuera del bundle. |
| Build ref de producción no verificado | default `@local`; deploy config externa no disponible | Verificar metadata inyectada en proceso y hacerla obligatoria en deployment. |
| Readiness con nombre ambiguo | `health/ready.capabilities.trainingSemantics` mira snapshot V2; `health/projections.readiness.trainingSemantics` mira presencia del bundle V1 | Renombrar/estructurar authority/capability para indicar versión y loader. |
| APIs legacy accesibles bajo lista común de keys | un solo mecanismo `CATALOG_API_KEYS`/`API_KEY`; rutas no distinguen scope agent/service/human | Consumidores nuevos deben recibir rutas y permisos explícitos; no toda ruta registrada se vuelve Agent API. |
| Evidencia de producción no contenida aquí | P1.6 reporta pruebas operator-owned; IDs completos/logs y build SHA no constan en docs | Mantener status de deployment como “no re-verificado por esta auditoría”. |

## 9. Estado de entregables P2.1 en esta etapa

| Entregable | Estado |
|---|---|
| Authority Audit | **Completado** — este documento |
| Authority Matrix | **Completada** — §4 |
| Runtime contract/type | Pendiente de la etapa de implementación |
| Implementación runtime mínima | Pendiente de revisar esta evidencia/propuesta |
| Provenance/freshness unificada | Gap identificado; pendiente |
| Health authority view | Gap identificado; pendiente |
| Tests P2.1 | No agregados ni ejecutados en esta etapa de auditoría |
| Migration decisions legacy | **Completadas como decisiones propuestas** — §5 |
| Residual debt list | **Completada** — §8 |
| P2.1 closure report | Pendiente hasta implementación y pruebas |

**P2.1 no se declara cerrado.** Esta etapa deja el estado actual y el plan de cambio verificables antes de modificar comportamiento.

## 10. Actualizacion P2.1B — estado implementado

Las secciones anteriores documentan la evidencia baseline previa a P2.1B. El estado de codigo posterior a la implementacion es:

- Existe `CatalogRuntimeProductContext` interno, versionado `schemaVersion: 1`, en `src/domain/catalog/runtime-authority-contract.ts`; el composer vive en `src/application/catalog/runtime-context/catalogRuntimeProductContextService.ts` y queda en el objeto de bootstrap, sin publicarse en las respuestas Agent API.
- `facts.specifications` sigue viniendo del reader PrestaShop. `knowledge.specs` se toma de `RuntimeProjectionState.specs` y reporta disponibilidad y lineage del bundle por separado. Trust maps cargados se informan como CAT-V2, junto con `categorySelectionAuthority=static-category-trust-map` y `consumedByCategorySelection=false`.
- Product Semantics expone `readWithAuthority()`: bundle cargado produce `cat-v2-product-semantics`; el fallback solo puede producir `legacy-product-semantic-snapshot` cuando el manager esta en `NO_ACTIVE_BUNDLE`. Se conserva el counter existente y el status de runtime agrega lecturas legacy observables. FAILED/carga invalida no habilita fallback.
- Training V1 CAT-V2 y Training V2 legacy estan separados en el contexto y en health. Training V2 conserva `legacy-training-v2` y `migrationStatus=PENDING`; no hay adapter entre versiones. Relationships CAT-V2 y Capabilities CAT-V2 siguen `UNAVAILABLE`; el snapshot legacy de recomendaciones se reporta en una autoridad operacional independiente.
- El contexto separa `freshness.commercial` (shape actual: `asOf`, `validUntil`, `cache.hit`, `cache.ageMs`) de `freshness.knowledge` (`projectionBundleId`, `activationId`, `loadedAt`). No se afirma que `asOf` sea un snapshot SQL global.
- Se agrego `GET /health/catalog-authority`, read-only y sin datos secretos, para estado efectivo, lineage, fallback, build ref y las autoridades de Training/Relationships separadas. `/health/ready` y los contratos HTTP de catalogo existentes no cambiaron.
- `CATALOG_SERVICE_BUILD_REF` ahora es opcional en desarrollo (default explicito `catalog-service@local`) y obligatorio con `NODE_ENV=production`. Dockerfile, `.env.example` y runbook describen la inyeccion. El deployment productivo no fue inspeccionado desde este checkout.

### Verificacion P2.1B en este checkout

- `npm run typecheck`: pasa.
- `npm run build`: pasa.
- Suites nuevas P2.1B: 5 archivos, 11 tests pasan.
- `npm test`: 110 archivos; 107 pasan y 3 fallan (2.412 tests pasan, 12 fallan). Los 12 fallos pertenecen a las suites HTTP de Training V2 que cargan el snapshot de `data/training-semantic-snapshots/v2`; ese directorio no existe en este checkout y esta ignorado por Git. Las respuestas observadas son `TRAINING_SEMANTICS_UNAVAILABLE`. Este entorno no contiene el artefacto externo requerido para validar esas suites.
- `git diff --check`: pasa.

Por el resultado no verde de `npm test`, no se crea `CAT_V2_P2_1_CLOSURE.md` y P2.1 no se declara cerrado en esta verificacion. Ejecutar la suite completa en un checkout que tenga el snapshot V2 aceptado sigue siendo requisito para satisfacer el gate de cierre.

## 11. P2.1C — verificacion de cierre

Esta seccion sustituye el resultado provisional de gates de §10. La procedencia del snapshot Training V2 se clasifico como `GENERATED_DETERMINISTICALLY`: los builders aprobados reproducen desde inputs versionados el V1 aceptado `sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d` y el V2 aceptado `sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1`, con checksums y conteos del release A00.6.8.

El gap era de test bootstrap: `.gitignore` excluye `data/training-semantic-snapshots`, las tres suites HTTP abrian el path por defecto, `tests/setup.ts` no lo materializaba y no hay workflow CI versionado en este repo. P1.6 ya habia registrado el requisito de rebuild manual. `npm test` ahora prepara la fuente V1 aislada en `.test-v1`, genera/activa el V2 aceptado y luego ejecuta Vitest. El parser V2 acepta ahora argumentos con digitos, incluido `--source-v1-dir`.

Verificacion P2.1C:

- Builders V1/V2: IDs aceptados reproducidos; V2 `semanticChecksum=e15673be136a730d3e90645446ba55f0734b491163f47b4a617b9c5c974f8941`; loader warnings `0`.
- Inspect y acceptance audit: PASS; 234/240 resueltos, 97.5%, discrepancia `0`, 10 regresiones de precision verificadas.
- Tres suites Training V2: PASS, 16/16.
- Suites P2.1B: PASS, 11/11.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- `npm test` con bootstrap automatico: PASS, 110 archivos y 2.424 tests.
- `git diff --check`: PASS.

Decision: `IMPLEMENTATION_CLOSED=YES`; `PRODUCTION_VALIDATED=NO`. El deployment y su `CATALOG_SERVICE_BUILD_REF` no se validaron en produccion. Ver [CAT_V2_P2_1_CLOSURE.md](CAT_V2_P2_1_CLOSURE.md) para matriz final, contratos, fixture provenance, deuda y no-go items.
