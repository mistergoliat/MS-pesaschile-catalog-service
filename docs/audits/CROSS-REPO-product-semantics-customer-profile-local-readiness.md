# Cross-repo local readiness audit

## Product Semantics → Customer Profile Integration

**Fecha de captura:** 2026-09-02  
**Alcance:** checkouts locales, incluyendo cambios no commiteados observados durante la captura.  
**Fuente de autoridad:** filesystem y Git local. No se usó GitHub remoto como fuente funcional.

El único cambio realizado por esta auditoría es este archivo de informe. No se modificó código, configuración ni historial Git de los repos auditados.

## 0. Estado local real

### Resumen Git

| repo | absolute path | branch | HEAD | upstream | ahead/behind |
|---|---|---|---|---|---|
| catalog-service | `C:\\Users\\Goli\\Pesas Chile\\MS\\MS-Stock\\services` | `main` | `1e1bd193957165644b0d4e3a8ab6d1b2af96c00e` | `origin/main` | `0 / 0` |
| customer-profile | `C:\\Users\\Goli\\Pesas Chile\\MS\\MS-pesaschile-customer-profile` | `main` | `59014c790ddb791f08e3f6af5bd5dbc75f2f6429` | `origin/main` | `0 / 0` |
| CRM-Customer-360 | `C:\\Users\\Goli\\Pesas Chile\\CRM-Customer-360` | `develop` | `41dfa95479dbf0638b11cdf11ec5115e8575e8e5` | `origin/develop` | `0 / 0` |
| quote-service (opcional) | `C:\\Users\\Goli\\Pesas Chile\\MS\\MS-pesaschile-quote-service` | `main` | `a2bc2cf4d90836658634fd863976e4a50afad84c` | `origin/main` | `0 / 0` |

### `git status --short`

- **catalog-service:** limpio; sin tracked modified, untracked ni staged files.
- **customer-profile:** 4 tracked modified; sin untracked ni staged files.
- **CRM-Customer-360:** 16 tracked modified y 6 untracked; ningún archivo staged.
- **quote-service:** 20 artefactos `.tmp-*` y 1 PDF untracked; ningún archivo tracked modified ni staged.

No hay local commits not pushed ni remote commits not pulled en ninguno de los cuatro repos: todos reportaron `ahead/behind = 0 / 0`.

Los cambios locales completos están detallados en la sección 11.

## 1. Catalog-service

El checkout `services` es el catalog-service. El estado de Product Semantics está implementado en varias capas, pero su superficie de integración externa todavía es single-product.

### A. Ontology

**Existe.** La fuente está en:

- `src/domain/commercial-product-ontology/`
- `src/domain/commercial-product-ontology/registry.ts`
- `src/domain/commercial-product-ontology/rules.ts`

El registry es versionado y expone versión/hash y tags por eje. La ontología pertenece a Catalog.

### B. Classifier

**Existe.** Está en:

- `src/domain/product-semantic-classification/contracts.ts`
- `src/domain/product-semantic-classification/classifier.ts`
- `src/domain/product-semantic-classification/index.ts`

Existe `ProductSemanticClassificationResult`, estados de clasificación, primary/secondary product families, disciplines, use contexts, evidencia, warnings, exclusiones y review candidates. El clasificador es determinista y tiene `classifyProduct`/`classifyProducts`.

### C. Snapshot builder

**Existe.** Está en:

- `src/domain/product-semantic-snapshot/contracts.ts`
- `src/domain/product-semantic-snapshot/defaultSnapshotBuilder.ts`
- `src/domain/product-semantic-snapshot/defaultSnapshotPublisher.ts`
- `scripts/product-semantic-classification/build-semantic-snapshot.ts`

El snapshot lleva `schemaVersion`, `snapshotId`, `ontologyVersion`, `ontologyHash`, `classifierVersion`, `semanticChecksum`, counts y records. El builder verifica tags conocidos, duplicados, evidencia/provenance y consistencia de counts antes de calcular hashes y publicar.

### D. Snapshot runtime reader

**Existe.** Está en:

- `src/domain/product-semantic-snapshot/runtime/contracts.ts`
- `src/domain/product-semantic-snapshot/runtime/defaultActiveSnapshotReader.ts`
- `src/domain/product-semantic-snapshot/runtime/defaultRuntimeIndexBuilder.ts`
- `src/infrastructure/product-semantic/fileProductSemanticSnapshotStore.ts`

El reader indexa por `productId` y expone tanto:

- `getProductSemanticFact(productId)`
- `getAllProductSemanticFacts()`

El store de runtime es filesystem-based, con `active.json` y snapshots versionados por hash. El bootstrap hace refresh al iniciar. Si falta el snapshot, el proceso puede arrancar, pero la dependencia semántica queda no disponible.

### E. Runtime endpoint

**Existe:** `GET /v1/products/:productId/semantics` en:

- `src/interfaces/http/routes/getProductSemanticsRoute.ts`

Está registrado desde `src/interfaces/http/app.ts`. Tiene API key, validación de `productId` numérico positivo, respuesta 200 con clasificación, lineage y provenance, 404 sin fact y 503 sin snapshot activo. El endpoint es read-only, no clasifica on demand y no consulta PrestaShop para completar datos.

**Conclusión:** es una superficie de inspección single-product razonablemente endurecida, pero no es suficiente como interfaz productiva de integración masiva. Para `N` productos comprados implica `N` lecturas HTTP.

### F. Batch access

**No existe batch de Product Semantics.**

Sí existe `POST /v1/products/batch` en `src/interfaces/http/app.ts`, pero corresponde a detalles comerciales de productos y llama a `batchGetProducts`; no devuelve semantic facts.

No existe una ruta `semantics/batch`, ni un contrato batch semántico HTTP.

### G. Client support

El cliente local del catálogo está en:

- `client/catalogClient.ts`
- `client/types.ts`

Tiene `getProduct`, `batchGetProducts`, búsquedas y herramientas comerciales, pero no tiene `getProductSemanticFact`, `getAllProductSemanticFacts` ni un método batch de Product Semantics. Por lo tanto, el contrato de dominio/runtime existe, pero el SDK/consumer client no está cerrado.

### H. Audit tooling

**Existe.** `package.json` contiene, entre otros:

- `product:semantic:classify`
- `product:semantic:snapshot:build`
- `product:semantic:snapshot:inspect`
- `product:semantic:coverage-audit`
- `product:semantic:acceptance-audit`
- `product:semantic:v2-migration-audit`
- `product:semantic:existing-family-miss-adjudication`

El tooling de coverage y snapshot inspection está implementado en `scripts/product-semantic-classification/`. Esto cubre el trabajo de A00.5.2/inspección local; no reemplaza un endpoint batch de consumo.

### I. EC2/runtime configuration docs

La configuración runtime relevante está en:

- `src/shared/productSemanticSnapshotConfig.ts`
- `src/bootstrap.ts`
- `src/infrastructure/product-semantic/fileProductSemanticSnapshotStore.ts`

`PRODUCT_SEMANTIC_SNAPSHOT_DIR` existe y por defecto resuelve a `data/product-semantic-snapshots`. El bootstrap crea el file store y el runtime reader. La ausencia del snapshot no hace fallar el boot/readiness general; el endpoint semántico responde 503.

Hay base de configuración HTTP, API key, timeout, status mapping y comportamiento degradado en `src/infrastructure/recommendation/httpCustomerAffinityEvidenceProvider.ts` y `src/shared/config.ts`, pero ese flujo es Catalog → Customer Profile para affinity evidence. No es todavía Customer Profile → Catalog para Product Semantics.

### Respuestas solicitadas sobre Catalog

1. **¿Existe actualmente un batch endpoint?** No para Product Semantics. Existe un batch comercial distinto.
2. **¿Existe batch method en catalog client?** Sí existe `batchGetProducts`, pero no semantic batch. Para Product Semantics: no.
3. **¿Existe contrato reutilizable para consumers?** Sí en el snapshot contract/runtime (`ProductSemanticSnapshot`, `ProductSemanticSnapshotFact`, metadata, checksums y lineage). Falta cerrar la proyección HTTP batch para consumers.
4. **¿El endpoint single-product es production-ready?** Está listo como endpoint de inspección read-only, con auth/validaciones/404/503. No está listo como mecanismo productivo de carga masiva de Customer Profile por el N+1 y la falta de client contract batch.
5. **¿Hay cambios locales relacionados aún no commiteados?** No. El catálogo está limpio.
6. **¿Hay deuda que bloquee customer-profile?** No bloquea comenzar el trabajo de contrato/adaptador; sí bloquea poblar de forma eficiente y operable una población completa: falta batch semantic access y su integración client-side.

## 2. Customer-profile

### A. Existing purchase evidence

**Existe y está conectado a PrestaShop.**

Contratos y paths:

- `src/domain/customer-purchased-products/contracts.ts`
- `src/application/customer-purchased-products/ports.ts`
- `src/infrastructure/prestashop/mysql-purchased-products-reader.ts`
- `src/domain/customer-purchase-behavior/contracts.ts`
- `src/application/customer-purchase-behavior/ports.ts`
- `src/infrastructure/prestashop/mysql-customer-product-behavior-reader.ts`
- `src/infrastructure/prestashop/mysql-customer-affinity-purchase-reader.ts`
- `src/application/customer-commercial-affinity-population/ports.ts`

`PurchasedProduct` conserva `productId`, `productAttributeId`, `totalQuantityPurchased`, `orderCount`, primera/última compra y `totalSpentTaxIncl`. Purchase behavior conserva agregados por producto y variante, shares de spend/order/quantity y fechas.

La lectura SQL usa `ps_order_detail.product_id`, cuenta órdenes distintas, suma cantidad, suma `total_price_tax_incl` y calcula `MIN/MAX` de fecha. La lectura bulk para affinity usa keyset pagination por órdenes y líneas.

### B. Existing product-level aggregation

**Existe.** `mysql-purchased-products-reader.ts` y `mysql-customer-product-behavior-reader.ts` agregan por `product_id` y por `(product_id, product_attribute_id)`. La agregación de customer behavior ya calcula:

- order count
- units/quantity
- spend
- first/last purchase
- revenue/order/quantity shares
- recency-related fields

Esto resuelve producto y variante. Todavía no existe un modelo persistido específico y canónico de `customer × product family` con todos los campos solicitados.

### C. Customer identity available

**Existe.** Los endpoints y readers principales usan `customerId` de `ps_customer`; el contrato de perfil identifica `identityAuthority: prestashop_customer`. También existe una ruta legacy para `masterCustomerId` en RFM, pero no sustituye al customer identity canónico de la integración.

Paths relevantes:

- `src/domain/customer-commercial-profile/contracts.ts`
- `src/application/customer-commercial-profile/customer-commercial-profile-service.ts`
- `src/http/routes/index.ts`
- `src/infrastructure/crm/mysql-rfm-canonical-identity-resolver.ts`

### D. Existing persistence/snapshot infrastructure

**Existe y es reutilizable.** Hay patrones de snapshots, readers, repositories, run records, estado publicado, versioning y checksums para:

- RFM: `src/infrastructure/rfm/` y `src/application/customer-rfm/`
- analytics: `src/infrastructure/customer-analytics/` y `src/application/customer-analytics/`
- clustering: `src/infrastructure/clustering/` y `src/application/customer-clustering/`
- CLV: `src/infrastructure/clv/mysql-customer-clv-snapshot-store.ts`
- commercial affinity: `src/application/customer-commercial-affinity-snapshot/` y `src/infrastructure/clv/mysql-customer-commercial-affinity-snapshot-store.ts`

Los scripts existentes incluyen `scripts/snapshots/rfm-snapshot.ts`, `scripts/snapshots/rfm-snapshot-scheduled.ts`, `scripts/analytics/snapshot-features.ts`, `scripts/clustering/publish-snapshot.ts`, `scripts/customer-commercial-affinity/a01-4-population.ts` y `scripts/customer-commercial-affinity/a01-5-snapshot-build.ts`.

### E. Existing API/read models

`src/http/routes/index.ts` ya registra:

- `/v1/customers/:customerId/profile`
- `/v1/customers/:customerId/commercial-summary`
- `/v1/customers/:customerId/purchased-products`
- `/v1/customers/:customerId/purchase-behavior`
- `/v1/customers/:customerId/rfm`
- `/v1/customers/:customerId/cluster`
- `/v1/customers/:customerId/clv`
- `/v1/customers/:customerId/affinity`
- `/v1/customer-commercial-affinity/snapshot`
- `/v1/customers/:customerId/intelligence`
- `/v1/customers/:customerId/commercial-profile`

Existe por lo tanto una read surface para afinidad y perfil comercial. La ausencia no está en el API read model, sino en conectar la fuente Product Semantics y construir/evidenciar el dataset correcto.

### F. Existing Catalog HTTP integration

**No existe para Product Semantics.** El único source concreto del consumer semántico es:

- `src/infrastructure/catalog-product-semantics/file-product-semantic-snapshot-source.ts`

Lee el snapshot activo desde filesystem y detecta cambios de pointer durante la lectura. No hay `HttpProductSemanticSnapshotSource`, URL de Catalog, API key de Catalog ni wiring HTTP en `src/bootstrap.ts`.

### G. Existing ProductSemanticFactsPort o equivalente

**Existe parcialmente como consumer/port, no como integración de servicio.**

Está en `src/application/product-semantic-snapshot/consumer.ts`. Expone refresh, metadata y `getAllProductSemanticFacts()`, valida schema version, ids numéricos, duplicados, ejes y lineage ontology/hash; además calcula `consumerNormalizedChecksum` y no mantiene datos stale si el refresh falla.

El source implementado es file-only y el consumer no está creado/wireado en el bootstrap de producción. Sus usos observados son scripts y tests, incluyendo:

- `scripts/product-semantic-snapshot/compatibility-read.ts`
- `scripts/customer-commercial-affinity/a01-4-population.ts`
- `scripts/customer-commercial-affinity/a01-5-snapshot-build.ts`

### H. Existing Commercial Evidence domain

**Existe parcialmente/como pipeline de población.**

Existe evidencia transaccional bulk y el builder:

- `src/application/customer-commercial-affinity-population/population-builder.ts`
- `src/application/customer-commercial-affinity-population/ports.ts`
- `src/infrastructure/prestashop/mysql-customer-affinity-purchase-reader.ts`

El input bulk actual contiene `customerId`, `orderId`, `orderDetailId`, `orderCreatedAt`, `productId` y `lineRevenueTaxIncl`. **No contiene quantity/units** en este reader. El builder conserva internamente fechas, order IDs y spend para agregación, pero la fila final de affinity no equivale todavía a un modelo dedicado `CustomerCommercialEvidence` con `units` y `firstPurchasedAt`.

### I. Existing Commercial Affinity domain

**Existe.** No se debe recrear el scoring como parte de la primera integración.

Paths:

- `src/domain/customer-commercial-affinity/contracts.ts`
- `src/domain/customer-commercial-affinity/eligibility.ts`
- `src/domain/customer-commercial-affinity/scoring.ts`
- `src/domain/customer-commercial-affinity/policy.ts`
- `src/application/customer-commercial-affinity-population/population-builder.ts`
- `src/application/customer-commercial-affinity/get-customer-commercial-affinity.ts`
- `src/application/customer-commercial-affinity-snapshot/create-customer-commercial-affinity-snapshot.ts`
- `src/infrastructure/clv/mysql-customer-commercial-affinity-snapshot-store.ts`

El scoring hace join por `productId` con `ProductSemanticFact`, aplica elegibilidad por estado y ejes y soporta recency/monetary weighting. Las filas y snapshots llevan lineage del semantic snapshot, ontology version/hash y checksums.

## 3. Product identity contract

### Hallazgos

- En Catalog, el `productId` de dominio es numérico y proviene de `ps_product.id_product`/lectores de catálogo. El runtime semántico indexa el mismo identificador como `string` para lookup.
- En Customer Profile, los readers SQL usan directamente `ps_order_detail.product_id`, que es el mismo `ps_product.id_product`.
- `productAttributeId` proviene de `ps_order_detail.product_attribute_id` y se conserva separadamente para identidad de variante.
- En Catalog, el equivalente de variante aparece como `combinationId`/`id_product_attribute` en los modelos comerciales.
- CRM usa strings para transporte en algunos tipos, pero parsea/normaliza el identificador numérico; no se observó un mapper que cambie el valor.
- El lookup actual de Product Semantics es exclusivamente por `productId`. El `productAttributeId` no debe intervenir en esta integración mientras la ontología sea product-level. El builder de affinity también hace join semántico solo por `productId`.

### Clasificación

**IDENTITY_COMPATIBLE**

La diferencia observada es de representación (`number` en dominio/SQL y `string` en la key del snapshot/algún transporte), no de identidad. `productAttributeId` queda como evidencia opcional de variante y no como parte de la key semántica actual.

## 4. Cross-service access

### Customer Profile

Existe infraestructura HTTP saliente específica para el copilot en:

- `src/infrastructure/customer-intelligence-copilot/http-json-copilot-model.ts`
- `src/infrastructure/customer-intelligence-copilot/openai-compatible-copilot-model.ts`

Ese patrón incluye `fetch`, `AbortController`, timeout, API key y clasificación de errores. Además, el repositorio tiene errores de timeout/unavailable/schema incompatible, query timeouts por datasource y capacidades degradadas.

No hay, sin embargo, un generic HTTP client reutilizable orientado a Catalog dentro de Customer Profile. Tampoco existe configuración `CATALOG_BASE_URL`, `CATALOG_API_KEY` o equivalente semántico en `src/config.ts`/`.env.example`, ni health/readiness para Catalog.

La conclusión es:

- **La infraestructura de bajo nivel es reutilizable como patrón.**
- **Debe crearse un adapter/source específico Catalog Product Semantics.**
- Debe definir timeout, retry solo para fallas retryable, auth, validación de schema, manejo degradado y política de stale data.
- La dependencia semántica no debe hacer que endpoints de purchase history fallen; el job de evidencia puede fallar cerrado o publicarse como unavailable según la política que se cierre.

## 5. Bulk access requirement

La ruta de purchased products tiene paginación `limit/offset` y límites de página. El número de productos por customer no está fijado como un “typical count” en código; puede ser grande y el endpoint expone como máximo una página acotada por llamada. Purchase behavior también expone agregados, pero no convierte el acceso semántico en bulk cross-customer.

Para construcción masiva ya existe una ruta mejor: `mysql-customer-affinity-purchase-reader.ts` lee líneas elegibles históricas por keyset pagination de órdenes, con batch configurable, retries y watermark. Eso permite derivar el conjunto de `productId` sin hacer una lectura por cliente.

Usar exclusivamente `GET /v1/products/:productId/semantics` requeriría una llamada por cada distinct purchased product: es un N+1 cross-service y además perdería la ventaja del snapshot/lineage batch.

**Decisión: `BATCH_REQUIRED_NOW`.**

Opciones válidas a cerrar en A01: endpoint batch en Catalog o distribución/lectura de snapshot versionado accesible al job de Customer Profile. La primera opción es la integración de servicio más clara; el single endpoint debe quedar para inspección y casos puntuales.

## 6. Commercial Evidence readiness

### Per customer × product family

| campo | estado | evidencia local |
|---|---|---|
| `orderCount` | **EXISTING** a nivel producto/línea; **DERIVABLE** por family | purchased-products, purchase-behavior y order IDs del bulk reader |
| `units` | **EXISTING** en purchased-products/purchase-behavior; **MISSING** en el bulk affinity reader actual | SQL de `mysql-purchased-products-reader.ts` suma quantity; `CustomerAffinityPurchaseEvidence` no tiene quantity |
| `spend` | **EXISTING** | `totalSpentTaxIncl` y `lineRevenueTaxIncl` |
| `firstPurchasedAt` | **EXISTING** a nivel producto; **DERIVABLE** por family | `MIN`/first date en readers; builder conserva line dates internamente |
| `lastPurchasedAt` | **EXISTING** a nivel producto; **DERIVABLE** por family | `MAX`/last date y reference time |
| revenue share | **DERIVABLE**; parte del comportamiento existente | shares en purchase behavior; suma por family requiere join semántico |
| order share | **DERIVABLE** | order counts y customer order totals existentes |
| recency weighting | **EXISTING como capacidad de scoring**, pendiente de aplicarlo al evidence model | `src/domain/customer-commercial-affinity/scoring.ts` |

### Resultado

Customer Profile tiene suficiente evidencia de producto para comenzar la integración y ya tiene el builder/scoring de affinity. Lo que falta no es inventar la matemática de affinity, sino:

1. hacer disponible Product Semantic Facts desde Catalog en forma bulk y versionada;
2. decidir si A01 exige units en el reader bulk y agregar ese campo a la evidencia de entrada si la respuesta es sí;
3. formalizar/persistir un modelo de `CustomerCommercialEvidence` por family si se necesita exponer esos cinco campos antes o aparte de la fila de affinity.

## 7. Snapshot / persistence reuse

### Reutilizable

- Repository/reader de snapshot con estado published/active.
- Header con `referenceTime`, `calculationVersion`, lineage y checksums.
- Separación entre population build, snapshot build y runtime read.
- Validación de schema y compatibilidad de versiones.
- Publicación transaccional/atómica mediante tablas de snapshot y estado.
- Run repositories y métricas operativas.
- Customer commercial affinity snapshot store existente en MySQL.
- `ProductSemanticSnapshotConsumer` como punto de normalización y validación de lineage.

### No copiar mecánicamente de RFM

RFM resume customer-level recency/frequency/monetary. Commercial Evidence necesita preservar la relación customer × product/family, cobertura semántica, product lineage, order-line scope y posiblemente units/first/last. Se puede reutilizar el patrón de lifecycle, checksum y publicación, pero no el modelo semántico ni las métricas RFM.

### Scheduling/worker

Hay scripts schedulable para RFM y scripts de población/snapshot de affinity (`a01-4`/`a01-5`). No se observó en `src/bootstrap.ts` un worker de producción que conecte simultáneamente:

`bulk purchase reader → Catalog semantic source → population builder → affinity snapshot publication`.

Ese wiring operativo es parte de A01, no una pieza que falte en el dominio.

## 8. CRM-Customer-360

### Superficies existentes

- `components/catalog/ProductSemantics.tsx` ya muestra Product Semantics para un producto.
- `lib/catalog/types.ts` define `CatalogProductSemantics` y `CatalogPort.getProductSemantics`.
- `lib/catalog/httpCatalogAdapter.ts` implementa el GET single-product, timeout con `AbortController`, API key y mapeo 404 a `null`.
- `lib/catalog/consoleService.ts` carga semantics junto a detail/recommendations como rama degradable.
- `app/(hub)/customers/[id]/page.tsx` tiene una pantalla local de Customer 360, pero sus perfiles comerciales son del modelo CRM local y no un render de Customer Profile affinity.
- `app/(hub)/marketing/customer-intelligence/page.tsx` y `components/marketing/CustomerIntelligenceDashboardWorkspace.tsx` muestran inteligencia RFM/clusters/intersections, no commercial affinity.

### Adapter hacia Customer Profile

`lib/integrations/customer-profile/types.ts` y `lib/integrations/customer-profile/http-client.ts` soportan profile, commercial summary, purchased products, purchase behavior, order status, RFM y readiness. Usan base URL configurable, timeout, Bearer token y estados unavailable/not found.

No exponen `getAffinity`, `getCommercialProfile` ni una sección de Product Semantics dentro del customer screen. Tampoco se observó un adapter nuevo local para commercial affinity.

### Respuestas

1. **¿Existe superficie donde mostrar affinity posteriormente?** Existe una pantalla Customer 360 extensible y un dashboard de inteligencia; no existe todavía un componente/contrato específico de affinity.
2. **¿Hay código local ya empezado?** Sí para inspección de Product Semantics de producto y adapters base; no para affinity en Customer Profile.
3. **¿CRM es bloqueante para A01?** No. Es trabajo posterior de read surface/UI.
4. **¿Hay cambios locales no commiteados relevantes?** Sí: cambios de audience evaluator en Customer Profile y agent-session compaction en CRM; ninguno está relacionado con esta integración.

## 9. Quote-service

Inspección rápida de `C:\\Users\\Goli\\Pesas Chile\\MS\\MS-pesaschile-quote-service`:

- No hay referencias a `customer-profile`.
- No hay referencias a Catalog semantics, commercial affinity ni Product Semantics.
- El checkout está sincronizado (`0 / 0`), pero contiene artefactos untracked temporales y un PDF de marca.

**Conclusión:** quote-service no es prerequisito de A01.

## 10. Duplication / ownership

La búsqueda local en `customer-profile` no encontró runtime duplicado de:

- `commercial-product-ontology`
- `product-semantic-classification`
- `classifyProduct`

Lo que sí existe en Customer Profile es un consumer/projection contract (`src/application/product-semantic-snapshot/consumer.ts`), validación de facts, population builder y scoring que consume facts. Eso es una dependencia downstream viva, no una copia del classifier.

Las referencias históricas/documentales a esos nombres no constituyen runtime. No se observó una dependencia live a un classifier/ontology duplicado.

Boundary confirmado:

- **Catalog = product truth:** ontology, classifier, product semantic snapshot y product semantic facts.
- **Customer Profile = customer truth:** customer identity, purchase evidence, aggregation por customer/product, commercial evidence y affinity read model.

## 11. Local-only changes

La siguiente tabla refleja el estado local capturado, no el contenido de una rama remota.

| repo | file | status | relevance | must_commit_before_A01 | risk_if_lost |
|---|---|---|---|---|---|
| catalog-service | — | clean | No hay cambios locales | No | No hay trabajo local semántico que perder |
| customer-profile | `docs/releases/CUSTOMER-INTELLIGENCE-AUDIENCE-A01-deterministic-evaluator.md` | modified | Release/audience evaluator; no Product Semantics | No | Se pierde documentación local de audience |
| customer-profile | `scripts/customer-intelligence-audience/a01-1-helpers.ts` | modified | Audience evaluator; no Product Semantics | No | Se pierde validación/hardening de audience |
| customer-profile | `scripts/customer-intelligence-audience/a01-1-operational-validation.ts` | modified | Audience operational validation; no Product Semantics | No | Se pierde validación operacional de audience |
| customer-profile | `tests/unit/customer-intelligence-audience-a01-1-runner.test.ts` | modified | Tests de audience; no Product Semantics | No | Se pierde cobertura de audience |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/deriveMessages.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde hardening de reconstrucción de mensajes/compaction |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/inMemoryAgentSessionStore.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde wiring de compaction en store |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/index.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde exportación/wiring de compaction |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/loadPersistentSessionContext.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde ajuste de carga de contexto compactado |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/mariaDbAgentSessionStore.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde persistencia de compaction |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/store.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde contrato/wiring del store |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/types.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde contrato/validación de payload de compaction |
| CRM-Customer-360 | `lib/brain/commercial/config/commercialCycleConfig.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde configuración de compaction |
| CRM-Customer-360 | `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde integración de compaction en native cycle |
| CRM-Customer-360 | `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts` | modified | Agent session compaction; no Product Semantics | No | Se pierde integración de compaction en sales runtime |
| CRM-Customer-360 | `tests/commercial/agentSessionStore.test.ts` | modified | Tests de agent session; no Product Semantics | No | Se pierde cobertura de store/compaction |
| CRM-Customer-360 | `tests/commercial/deriveMessages.test.ts` | modified | Tests de agent session; no Product Semantics | No | Se pierde cobertura de compaction |
| CRM-Customer-360 | `tests/commercial/loadPersistentSessionContext.test.ts` | modified | Tests de agent session; no Product Semantics | No | Se pierde cobertura de carga compactada |
| CRM-Customer-360 | `tests/commercial/resolvePersistentSessionCognitionContext.test.ts` | modified | Tests de agent session; no Product Semantics | No | Se pierde cobertura de contexto persistente |
| CRM-Customer-360 | `tests/commercial/runPersistentSessionShadow.test.ts` | modified | Tests de agent session; no Product Semantics | No | Se pierde cobertura de shadow runtime |
| CRM-Customer-360 | `tests/commercial/salesAgentRuntimeSessionWriteWiring.test.ts` | modified | Tests de agent session; no Product Semantics | No | Se pierde cobertura de wiring |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/compactAgentSessionHistory.ts` | untracked | Agent session compaction; no Product Semantics | No | Se pierde implementación nueva de compaction |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/compactedSessionPrefixContent.ts` | untracked | Agent session compaction; no Product Semantics | No | Se pierde parser/contrato de prefijo compactado |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/runSessionCompaction.ts` | untracked | Agent session compaction; no Product Semantics | No | Se pierde runner de compaction |
| CRM-Customer-360 | `lib/brain/commercial/agent-session/sessionCompactionPolicy.ts` | untracked | Agent session compaction; no Product Semantics | No | Se pierde política nueva de compaction |
| CRM-Customer-360 | `tests/commercial/compactAgentSessionHistory.test.ts` | untracked | Tests de agent session; no Product Semantics | No | Se pierde cobertura de compaction |
| CRM-Customer-360 | `tests/commercial/sessionCompactionPolicy.test.ts` | untracked | Tests de agent session; no Product Semantics | No | Se pierde cobertura de política de compaction |
| quote-service | `.tmp-*` (20 artefactos temporales) | untracked | Smoke outputs/assets; no Product Semantics | No | Se pierden diagnósticos/artefactos temporales; no afecta A01 |
| quote-service | `docs/PesasChile_Guia de Marca_2025.pdf` | untracked | Documento de marca; no Product Semantics | No | Se pierde copia local del PDF; no afecta A01 |

No hay hotfix, build fix, tsconfig exclusion, A00.5.2 semantic inspection ni batch work local no commiteado en Catalog o Customer Profile al momento de la captura. Los cambios actuales de Customer Profile son de audience evaluator/operational validation y no afectan esta integración. El tooling A00.5.2 y la inspección semántica encontrados están en commits/árboles limpios, no en cambios pendientes.

## 12. Readiness matrix

| área | capability | estado |
|---|---|---|
| CATALOG | Product semantics runtime | **PASS** |
| CATALOG | Single semantics endpoint | **PARTIAL** |
| CATALOG | Batch semantics endpoint | **MISSING** |
| CATALOG | Stable consumer contract | **PARTIAL** |
| CATALOG | Product identity | **PASS** |
| CUSTOMER PROFILE | Canonical customer identity | **PASS** |
| CUSTOMER PROFILE | Purchase history by productId | **PASS** |
| CUSTOMER PROFILE | Spend/order/unit evidence | **PASS** |
| CUSTOMER PROFILE | Product semantics port | **PARTIAL** |
| CUSTOMER PROFILE | Commercial evidence model | **PARTIAL** |
| CUSTOMER PROFILE | Persistence pattern reusable | **PASS** |
| CUSTOMER PROFILE | HTTP service integration reusable | **PARTIAL** |
| CRM | Customer profile inspection surface | **PARTIAL** |
| CRM | Affinity UI | **MISSING** |
| CRM | Blocking | **NO** |

Interpretación de los `PARTIAL` críticos:

- Catalog single endpoint funciona para inspección, pero no para bulk integration.
- El stable contract existe en snapshot/domain y en el consumer normalizer, pero falta el contrato HTTP cross-service y su método batch.
- Customer Profile tiene consumer y dominio de affinity, pero solo source filesystem y sin wiring de producción.
- La evidencia base tiene spend/order/units, pero el bulk affinity reader no transporta units y no hay aún un modelo family-level dedicado.
- CRM tiene superficies relacionadas, pero no una vista affinity end-to-end.

## 13. Minimum next work

Derivado del código real, los slices mínimos son:

### A01.0 — Contract closure

Cerrar la elección de transporte y el contrato entre Catalog y Customer Profile. Reutilizar el schema/version/lineage ya existente del snapshot consumer; definir respuesta batch, estados por producto, snapshot metadata, ontology hash, classifier version, checksum, 404/unknown y unavailable.

Este slice es necesario porque existen contratos de dominio separados, pero no un contrato HTTP batch operativo.

### A01.1 — Catalog batch semantics access

Implementar en Catalog un endpoint batch de semantic facts o una superficie equivalente de lectura de snapshot versionado, con límites, API key, validación y respuesta determinista. Agregar el método correspondiente al Catalog client si el consumidor lo requiere.

El endpoint single-product ya existe; no se debe duplicar como `N` llamadas.

### A01.2 — Customer Profile semantic source/port

Agregar un `ProductSemanticFactsPort`/source HTTP en Customer Profile que:

- consuma el contrato batch;
- valide schema y lineage con el consumer existente;
- aplique timeout, retry de fallas retryable y auth;
- defina comportamiento degraded/unavailable;
- mantenga el file source para tests/offline o lo reemplace detrás de la misma interfaz;
- se configure explícitamente en `config.ts`/`.env.example`.

No hace falta crear un nuevo classifier ni copiar la ontología.

### A01.3 — Commercial evidence field closure

Decidir si Customer Commercial Evidence requiere `units`. Si sí, extender el bulk evidence reader/contrato para transportar quantity. Formalizar el modelo customer × product family con `orderCount`, `units`, `spend`, `firstPurchasedAt` y `lastPurchasedAt`; derivar shares/recency después de fijar denominadores y reference time.

La fuente PrestaShop de purchased-products ya tiene quantity y fechas; el reader bulk actual solo necesita cerrar el alcance de datos que debe alimentar la población.

### A01.4 — Production population and snapshot wiring

Conectar el bulk purchase reader, el semantic source, `population-builder.ts` y el snapshot store/publisher en un job/worker operable. Reutilizar checksum, lineage, coverage diagnostics y publicación existentes. Este slice debe registrar semantic snapshot id/version/hash y distinguir unknown products/no semantic evidence.

No implementar un nuevo affinity scoring: `scoring.ts`, eligibility, population builder y snapshot persistence ya existen.

### A01.5 — Runtime/API verification

Verificar que `/v1/customers/:customerId/affinity` y `/commercial-profile` lean el snapshot publicado y exponen estados unavailable/not-found correctos. Solo agregar cambios si la nueva evidencia family-level requiere un read model adicional; las rutas base ya existen.

### Trabajo posterior, no prerequisito

CRM affinity UI, adapter `getAffinity`/`getCommercialProfile`, explainability visual y ajustes de scoring pueden hacerse después de tener snapshot y API estables.

## 14. Blockers

| hallazgo | clasificación | motivo |
|---|---|---|
| Falta Catalog semantic batch access | **REQUIRED_DURING_A01** | Impide bulk eficiente, pero no impide comenzar el cierre de contrato/adaptador |
| Falta HTTP semantic source/wiring en Customer Profile | **REQUIRED_DURING_A01** | El consumer actual es file-only y no está wireado en bootstrap |
| Falta decidir/preservar units en bulk evidence | **REQUIRED_BEFORE_A01** si A01 promete units; si no, **REQUIRED_DURING_A01** | El source bulk actual no tiene quantity |
| Falta modelo persistido explícito customer × product family | **REQUIRED_DURING_A01** | Hay inputs/builders/affinity rows, pero no el evidence read model completo solicitado |
| CRM affinity UI | **DEFERRED** | No participa en la primera integración backend |
| Customer Profile audience evaluator changes | **NOT_RELEVANT** | Son cambios no commiteados ajenos a Product Semantics |
| CRM local agent-session compaction changes | **NOT_RELEVANT** | Son cambios no commiteados ajenos a Product Semantics |
| quote-service | **NOT_RELEVANT** | No tiene referencias a esta integración |
| Identity mismatch | **NOT_RELEVANT** | La identidad es compatible |
| Duplicate ontology/classifier runtime en Customer Profile | **NOT_RELEVANT** | No existe runtime duplicado |

No se identificó un **BLOCKER** absoluto para comenzar el primer slice de integración. Sí hay prerequisitos funcionales antes de ejecutar una población bulk confiable: contrato, batch/source HTTP y cierre de units/persistencia.

## 15. Final decision

**READY_WITH_SMALL_PREREQUISITES**

El trabajo puede comenzar porque Catalog ya es dueño de la verdad de producto, Customer Profile ya tiene identidad, purchase evidence, consumer validation, affinity domain, population builder, scoring, snapshot persistence y read routes, y la identidad `productId` es compatible.

Antes de la primera integración efectiva que lea Product Semantics desde Customer Profile deben implementarse o quedar comprometidos estos puntos:

1. contrato cross-service estable, incluyendo versioning/lineage/checksum;
2. acceso batch de Product Semantics en Catalog o una distribución equivalente del snapshot;
3. source/adapter HTTP y configuración en Customer Profile, con timeout/auth/degraded behavior;
4. decisión y soporte de `units` en la evidencia bulk si el contrato A01 las exige;
5. wiring operativo del population/snapshot pipeline y publicación verificable.

No es necesario antes de A01:

- modificar el classifier/ontology de Catalog;
- crear un segundo runtime semántico en Customer Profile;
- rehacer affinity scoring;
- construir la UI de CRM;
- involucrar quote-service;
- commitear los cambios locales actuales de CRM, porque no son parte de esta integración.

### What exactly must be implemented or committed before the first Customer Profile integration slice can begin?

No hay un commit local pendiente de Catalog o Customer Profile que deba rescatarse antes de empezar; Catalog está limpio y Customer Profile está sincronizado pero tiene cambios no commiteados de audience, ajenos a esta integración. El primer slice puede comenzar con **A01.0 contract closure**. Antes de ejecutar la primera integración backend real, deben estar implementados o comprometidos el contrato batch, el adapter/source de Customer Profile y la política de evidencia (`units`, fechas, spend/order) junto con el wiring de publicación. Los cambios uncommitted de CRM deben conservarse/gestionarse según su propio flujo, pero no son requisito de A01.


