# CAT-V2 P2.2A — Product Semantics Single Authority Audit

Fecha: **2026-10-05**. Baseline: `8ced63b062185fdd66c9c64c909dbf525b664184`.

**Decision: `RETAIN_TEMPORARILY`**. **Closure status: `RETIREMENT_BLOCKED`**.
**`IMPLEMENTATION_CLOSED = NO`**. No se retiró ni se cambió el fallback runtime de P2.1.

La cobertura de IDs es completa en el replay del baseline, pero todavía no demuestra que todo el conocimiento legacy pueda retirarse. Se reproducen las asignaciones aceptadas de 2011 productos, con seis asignaciones de uso ausentes en CAT-V2, dos productos que quedan sin asignaciones y cambios de scope/estado que afectan consumidores. Falta el snapshot legacy aceptado para verificar su presencia reconciliada. El fallback conserva el caso legítimo de lectura semántica al arrancar sin bundle; nunca corrige registros faltantes de un bundle activo.

## Evidencia y límites

Se trazaron imports, bootstrap, rutas, servicios, SDK local, readiness, health, métricas, builders y tests. No se consultó el deployment ni otro repositorio. El checkout vecino de Customer Profile no está disponible; sus consumidores productivos no se afirman a partir de documentación histórica. Se confirma el contrato y su implementación en el SDK de este repositorio.

Fuentes verificadas:

| Fuente | Identidad / resultado |
|---|---|
| Snapshot legacy aceptado, documentado en A00.5.2 | `sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12`; archivo/pointer ausente en el workspace |
| Baseline de clasificación aceptado | `scripts/product-semantic-classification/lib/accepted-baseline.ts`; 2011 registros; checksum `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e` |
| Replay de CSV archivados y código actual | Mismo checksum, ontología/hash y counts aceptados; snapshot `sha256:f4c0b8374ff20dcdbe030f354319ed854ee6b6354fc86eb3d912b3fbc12c4130` |
| Bundle CAT-V2 seleccionado explícitamente | `sha256:8401b8853b327c84b71c2c3dfa03b9bd5e78bcb7e5b8c254ca89f2a48aef5017`; candidate validation PASS; 2048 registros |
| Extracción de ese bundle | `sha256:3694b291c89d5f011904b44dc7fe51eb6f355da63d5bb25c485009fadd67d007` |
| Reconstrucción independiente del bundle | Mismo bundle ID y Product Semantics content hash `sha256:73db59d459d0d1e233bb666df2592be7143395a3c9f6d02e1ec1d42e9b557d1f` |

El bundle seleccionado es **reproducible**, no una afirmación del pointer productivo actual. Su `codeRef=cat-v2-p1.3-local` se preservó como parámetro del replay; no representa una verificación del commit histórico del builder.

El checksum de clasificación excluye deliberadamente `catalogPresence` (`src/domain/product-semantic-classification/checksum.ts`). El publisher legacy reconcilia presencia contra Commercial Truth activo antes de publicar (`scripts/product-semantic-classification/lib/catalog-presence.ts`). Por eso coincidir en checksum no prueba equivalencia del snapshot aceptado: su ID y la presencia reconciliada siguen **UNKNOWN**. Las cifras legacy de presencia siguientes corresponden únicamente al replay archivado.

Artefacto determinístico: [evidence/product-semantics-parity.json](evidence/product-semantics-parity.json). Incluye IDs completos por población, ambos valores/evidencias de cada diferencia, lineage, hashes de inputs, coverage por eje, status y transiciones. No introduce hechos comerciales ni Training Semantics.

## A. Runtime consumer matrix

FACTS = records de Product Semantics. REGISTRY = vocabulario V3 compilado en código.

| Consumer/path | Reads CAT-V2 | Reads legacy | Fallback possible | Contract exposed | Migration action |
|---|---:|---:|---:|---|---|
| `GET /v1/products/:productId/semantics` → `getProductSemanticsRoute.ts` → reader | Sí, FACTS | Condicional | Solo `NO_ACTIVE_BUNDLE` | Fact completo, status, provenance, scope y metadata; 404 missing; 503 unavailable | Mismo schema representable; adjudicar pérdida histórica antes de retirar |
| `POST /v1/products/semantics/batch` → `getProductSemanticsBatchRoute.ts` → reader | Sí, FACTS | Condicional | Solo `NO_ACTIVE_BUNDLE` | schema 1; tags/code/confidence; status/scope; lineage; missing IDs; pinning 409 | Preservar schema y semántica de pinning; no fija un ID legacy perpetuo |
| Product axes de `/v1/products/semantic-discovery/query` → `DefaultSemanticDiscoveryService` | Sí, FACTS | Condicional | Solo `NO_ACTIVE_BUNDLE` | Solo facts `current_catalog` elegibles; tags/status; snapshot lineage y pinning | Verificar presencia reconciliada: scope afecta inclusión en discovery |
| `CatalogRuntimeProductContextService.getProductContext()` | Sí, FACTS | Condicional | Solo `NO_ACTIVE_BUNDLE` | `knowledge.productSemantics`, authority, fallbackUsed, bundle/snapshot lineage | Ningún campo exclusivo legacy; preservar unavailable sin alterar commercial |
| `getCatalogAuthoritySnapshot()` → `/health/catalog-authority` | Sí, metadata del reader | Condicional, metadata | Describe fallback habilitado | Authority/status/fallbackEnabled/legacyFallbackReads, bundle/activation/loadedAt | Mantener topología P2.1 durante bloqueo |
| `collectRuntimeReadinessChecks()` → `/health/ready` | Sí, estado del reader y manager | Condicional, metadata | Estado del reader | Capability `productSemantics`; Commercial Truth separado | Capability-aware; semántica no tumba readiness comercial |
| `src/bootstrap.ts` | Manager + adapter | Carga `FileProductSemanticSnapshotStore` al startup | Inyecta fallback | Logs de carga legacy y estado; reader único compartido por consumidores | Conservar wiring hasta gate RETIRE |
| `catalog_product_semantic_legacy_fallback_total` y `legacyFallbackReads` | No | Cuenta operaciones delegadas | Solo branch permitido | Counter de lecturas, no requests/productos únicos; inspección de metadata no suma | No retirar mientras fallback existe |
| `GET /v1/products/semantics/registry` → `DefaultProductSemanticsRegistryService` | No | No | No | REGISTRY V3: tags, versiones y hash desde código | Ninguna migración de snapshot; no confundir registry con facts |
| `client/catalogClient.ts`, `client/semanticDiscoveryContracts.ts`, `client/semanticDiscoveryCapability.ts` | Vía HTTP | Vía HTTP, mismo contrato | Según reader servidor | Zod de respuesta, lineage/pinning, codes y confianza | Sin acoplamiento al filesystem o IDs legacy constantes; ejecución externa no comprobada |
| `/v2/catalog/search`, product context e item context | No, en sus lecturas comerciales | No | No | Commercial Truth de `CatalogContractService` / `MySqlCatalogV2DataReader` | Mantener dependencia comercial existente |
| Training V2 read/query y eje Training de discovery | No, Product FACTS | No, Product FACTS | No | Snapshot Training V2 independiente; registry Training de código | Fuera de P2.2A; no sustituir por Product Semantics |
| Builders/inspectores/audits Product legacy y tests de store/reader | Sí, builder de bundle reutiliza snapshot builder/clasificador | Sí, herramientas offline/tests | Runtime solo a través de bootstrap | Publication/inspection/migration fixtures | Mantener herramientas; no expandir taxonomía |

Referencias principales: `src/bootstrap.ts:165–240`, `src/domain/catalog/runtime-product-semantic-reader.ts`, `src/interfaces/http/app.ts`, `src/interfaces/http/routes/getProductSemantics{,Batch,Registry}Route.ts`, `src/application/catalog/semantic-discovery/defaultSemanticDiscoveryService.ts`, `src/application/catalog/runtime-context/*`, `src/shared/{metrics,readiness}.ts`.

## B. Snapshot coverage diff

| Población | Records | Current | Historical | Con asignaciones | Sin asignaciones, no excluidos | Excluidos |
|---|---:|---:|---:|---:|---:|---:|
| Legacy replay total / both legacy | 2011 | 1550 | 461 | 1721 | 277 | 13 |
| CAT-V2 total | 2048 | 1565 | 483 | 1753 | 282 | 13 |
| Both CAT-V2 | 2011 | 1535 | 476 | 1719 | 279 | 13 |
| CAT-V2 only | 37 | 30 | 7 | 34 | 3 | 0 |
| Legacy only | 0 | 0 | 0 | 0 | 0 | 0 |

`both=2011`, `catV2Only=37`, `legacyOnly=0`. Los IDs completos están en el artefacto. No hay productId del replay legacy que falte en CAT-V2. No se puede elevar esa conclusión a un snapshot reconciliado ausente únicamente por su conteo.

Coverage por eje, dentro de `both`:

| Eje | Legacy replay | CAT-V2 |
|---|---:|---:|
| Alguna asignación | 1721 | 1719 |
| Primary family | 1681 | 1681 |
| Secondary family | 40 | 40 |
| Discipline | 244 | 244 |
| Use context | 337 | 331 |

Los estados agregados del artefacto son una convención del audit: `resolved` significa alguna asignación, `unknown` significa sin asignaciones y no excluido, `excluded` preserva `EXCLUDED_NON_PRODUCT`. No reemplazan los enums contractuales: un fact `OTHER` puede contener use contexts. `unavailable=0` dentro de snapshots válidos; ausencia de producto/snapshot se expresa por el reader/endpoint, no por un status inventado del record.

## C. Schema / effective contract parity

| Dimensión | Clasificación | Evidencia / impacto |
|---|---|---|
| Product identity | EQUIVALENT | Mismos IDs canónicos PS; mapping HTTP numérico y `P{id}` contextual |
| Record/envelope schema | EQUIVALENT | Ambos schema 1; CAT-V2 envuelve el mismo snapshot y usa el mismo runtime index builder |
| Ontology/registry | EQUIVALENT | V3/hash `f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955`; registry endpoint independiente |
| Semantic assignments/code/confidence | EQUIVALENT en 2005; LEGACY_SUPERSET en 6 | Sin extras CAT-V2 ni reemplazos incompatibles; pérdida de use context en seis IDs |
| Coverage/status | SEMANTIC_DIFFERENCE | 13 `CLASSIFIED → PARTIALLY_CLASSIFIED`; dos `OTHER` sin cambio de enum pierden la única asignación |
| Presence/current catalog | SEMANTIC_DIFFERENCE en replay; UNKNOWN contra snapshot aceptado | 15 current→historical; discovery filtra current; falta presencia reconciliada aceptada |
| Evidence/provenance | UNKNOWN hasta adjudicar | 36 records cambian evidencia: seis pérdidas y 30 con mismas asignaciones pero otra evidencia fuente |
| Snapshot/checksum identity | REPRESENTATIONAL_ONLY como formato; contenido distinto | IDs `sha256:` compatibles; diferencia de contenido debe invalidar `expectedSnapshotId` previo |
| Build lineage | REPRESENTATIONAL_ONLY | `builtAt` legítimamente difiere; CAT-V2 añade bundle/extraction/activation/loadedAt al contexto y health |
| Product batch order/missing/errors | EQUIVALENT como contrato | Normaliza y deduplica; missing IDs solo para ausentes; unavailable 503; pinning mismatch 409 |

No se exige igualdad byte a byte de metadata/build times. Sí se conserva confidence, role primary/secondary, review candidates, exclusión, status, scope y evidence como dimensiones que pueden cambiar interpretación. El comparador mantiene `UNKNOWN` para provenance distinta sin una equivalencia explícita.

## D. Semantic parity y adjudicación

Métricas sobre los 2011 productos compartidos:

| Métrica | Resultado |
|---|---:|
| Exact record match | 1966 |
| Exact semantic assignment match (incluye ruleId/orden) | 2005 |
| Equivalent semantic assignment match (role/axis/code/confidence, orden normalizado) | 2005 |
| CAT-V2 extra assignments / superset products | 0 / 0 |
| Legacy extra assignments / superset products | 6 / 6 |
| Conflicting assignments | 0 |
| Otros productos con diferencia material de status/scope | 9 |
| Resolved→unknown / unknown→resolved | 2 / 0 |
| Status deltas / presence deltas | 13 / 15 |
| Evidence deltas | 36 |

Clasificación de records, mutuamente exclusiva: `EQUIVALENT=1966`, `CAT_V2_SUPERSET=0`, `LEGACY_SUPERSET=6`, `SEMANTIC_DIFFERENCE=9`, `UNKNOWN=30`, `REPRESENTATIONAL_ONLY=0`. Las 2005 coincidencias de asignaciones incluyen nueve records con status/scope distinto y 30 con evidence distinta. No son 2005 equivalencias del contrato completo.

Pérdidas de conocimiento con evidencia por producto (CAT-V2 conserva el ID, pero elimina la asignación indicada):

| ProductId / key | Legacy assignment / evidence | CAT-V2 value / evidence | Clasificación / impacto |
|---|---|---|---|
| 2186 / P2186 | HOME_GYM, EXPLICIT; feature 1: `USO REGULAR - HOGAR` | Sin use context; solo evidencia BENCH por nombre | LEGACY_SUPERSET; pierde señal de uso y cambia a PARTIALLY_CLASSIFIED |
| 2188 / P2188 | COMMERCIAL_GYM, EXPLICIT; feature 1: `USO INTENSIVO - COMERCIAL` | Sin use context; conserva PLATE_LOADED_MACHINE | LEGACY_SUPERSET; pierde señal de uso y cambia a PARTIALLY_CLASSIFIED |
| 2301 / P2301 | COMMERCIAL_GYM, EXPLICIT; feature 1: `Clase S (Comercial)` | Sin asignaciones/evidence; OTHER | LEGACY_SUPERSET; resolved→unknown aunque enum siga OTHER |
| 2302 / P2302 | COMMERCIAL_GYM, EXPLICIT; feature 1: `USO INTENSIVO - COMERCIAL` | Sin asignaciones/evidence; OTHER | LEGACY_SUPERSET; resolved→unknown aunque enum siga OTHER |
| 2303 / P2303 | COMMERCIAL_GYM, EXPLICIT; feature 1: `USO INTENSIVO - COMERCIAL` | Sin use context; conserva BENCH | LEGACY_SUPERSET; pierde señal de uso y cambia a PARTIALLY_CLASSIFIED |
| 2306 / P2306 | HOME_GYM, EXPLICIT; feature 1: `USO REGULAR - HOGAR` | Sin use context; conserva BENCH | LEGACY_SUPERSET; pierde señal de uso y cambia a PARTIALLY_CLASSIFIED |

El artefacto contiene ambos facts/evidencias completos. En la extracción CAT-V2 estos seis son históricos con categorías/features ausentes; en el archivo legacy archivado eran current con structured features. Esto explica **cómo** se produce la pérdida sin demostrar **si** ese conocimiento histórico continúa válido o requerido por el consumidor. Clasificación causal: **true unresolved discrepancy**, pendiente de decidir la política de retención de hechos históricos con evidencia y del snapshot aceptado. No se declara CAT-V2 regression ni legacy defect sin esa prueba.

Los otros nueve IDs con cambio de scope/status son `2085, 2239, 2261, 2262, 2265, 2266, 2267, 2274, 2305`. Conservan asignaciones, pasan current→historical y CLASSIFIED→PARTIALLY_CLASSIFIED. `classifier.ts` determina status usando `isHistorical`; es una diferencia esperable de fuente temporal, pero su contraste contra presencia legacy reconciliada permanece UNKNOWN.

Los 30 cambios de provenance sin cambio de asignación son `366, 536, 537, 1655, 1656, 1657, 1660, 1661, 1662, 1663, 1807, 1817, 1925, 1926, 1927, 1928, 1929, 1930, 1931, 1933, 1934, 1944, 1995, 1997, 2001, 2016, 2088, 2089, 2091, 2092`. Ejemplo: DUMBBELL de 366 cambia evidencia de categoría 272 `Mancuernas Ajustables` a categoría 267 `Mancuernas`. La ontología/confianza/regla quedan iguales; el inspector expone el cambio de provenance. El comparador no lo acepta automáticamente como mejora o igualdad byte a byte.

No se modificaron clasificadores ni se mezclaron snapshots para obtener paridad artificial.

## E. Legacy-only dependencies y builder

No se encontró campo contractual que CAT-V2 no pueda representar: contiene el mismo fact schema/runtime index, y las respuestas individuales, batch y discovery comparten adapter. El SDK valida schema y lineage sin depender del filesystem de Catalog. El snapshotId público es el del snapshot interno, no el ID del artifact envuelto del manifest; reemplazarlo por projectionBundleId rompería pinning y no es necesario.

Dependencias conservadas: bootstrap lee el store legacy, config `PRODUCT_SEMANTIC_SNAPSHOT_DIR`, refresh inicial, branch `NO_ACTIVE_BUNDLE`, logs, counter y metadata P2.1. Son dependencias de disponibilidad transitoria, no una necesidad de schema diferente. Los seis use contexts son conocimiento legacy-only **candidato material**, cuya vigencia/requisito no se ha resuelto.

Builder legacy: **RUNTIME_REQUIRED** actualmente porque publica el snapshot usado por fallback; también **TEST_REQUIRED** y útil para migration/replay. No hay evidencia local para declarar un proceso externo lector de sus archivos. El bundle llama al clasificador y `DefaultProductSemanticSnapshotBuilder`; eliminar esos módulos rompería CAT-V2. El builder/publisher/store no se eliminan.

## F. Failure semantics

| Caso | P2.1 conservado | Objetivo posible tras RETIRE |
|---|---|---|
| Startup/pointer ausente, sin estado cargado | NO_ACTIVE_BUNDLE; legacy si snapshot cargado; si falta, unavailable | CAT-V2 authority UNAVAILABLE; individual/batch/Product discovery 503; contexto conserva commercial |
| Pointer corrupto/invalid | CONTROL_PLANE_INVALID; sin fallback; conserva último estado CAT-V2 si existe | Igual conservación del estado válido; unavailable si nunca cargó |
| Bundle incompatible/corrupto en startup | FAILED o control invalid; sin fallback; semántica unavailable | Igual, sin sustituir por legacy/commercial |
| ProductId ausente del bundle cargado | No fallback: fact null; individual 404; batch missingProductIds; contexto unavailable tipado | Igual |
| Reload failure tras B1 válido | Mantiene B1; runtime DEGRADED; Product Semantics READY desde B1 | Igual last-known-good CAT-V2; fallo del candidato no elimina estado válido |
| Pointer removido tras B1 cargado | FAILED con B1 retenido; sin legacy | Igual |
| Rollback B2→B1 | Swap atómico; nuevos requests capturan B1; requests iniciados mantienen su estado | Igual, sin restart |

`FAILED` sin una proyección capturada produce unavailable; `FAILED` con B1 capturado sirve B1 válido. Confundir ambas situaciones rediseñaría P1.5/P2.1. `getProductSemanticFact`/`getAllProductSemanticFacts` lanzan `RUNTIME_SNAPSHOT_NOT_LOADED` cuando no hay autoridad disponible; las rutas verifican metadata y responden 503. No se convierte UNKNOWN en FALSE.

Commercial Truth sigue usando sus readers/caches actuales. `/v2/catalog/search`, `/v2/catalog/products/:productKey/context` y `/v2/catalog/items/:itemKey/context` no requieren el snapshot semántico. Readiness comercial depende de DB/cache y permanece operativa con capabilities semánticas unavailable. Se verifica mediante los tests HTTP existentes sin reader semántico y el contexto runtime degradado.

## Decision gate

| Condición RETIRE | Resultado |
|---|---|
| 1. No contractual blocker | No schema blocker local; consumidores externos productivos no inspeccionados |
| 2. Coverage de todos los casos necesarios | IDs del replay cubiertos; presencia del snapshot aceptado sin verificar |
| 3. No conocimiento legacy-only material requerido | **No demostrado**: seis use contexts; dos pérdidas completas |
| 4. Conflictos explicados y aceptables | Causa temporal explicada; aceptación de pérdida histórica/presencia no demostrada |
| 5. Failure semantics sin fallback correctas | Compatibles con contratos 503/readiness; retiro condicionado a evidencia faltante |
| 6. Commercial Truth independiente | PASS por wiring y regresión de rutas comerciales |

Se elige **una decisión: RETAIN_TEMPORARILY**. No se elige FIX_GAP_FIRST porque la pérdida proviene de un cambio de fuente/presencia, sin evidencia de una regresión de clasificador. No se elige MIGRATE_CONSUMER_FIRST porque no se demostró un contrato exclusivo legacy. El caso legítimo protegido temporalmente es Product Semantics disponible con snapshot legacy y `NO_ACTIVE_BUNDLE`.

Para reabrir el gate: obtener el snapshot aceptado/pointer real, validar su identidad/presencia, adjudicar los seis hechos históricos y las diferencias de provenance, y repetir el audit contra el bundle vigente. Si esos hechos siguen válidos/requeridos, resolver el gap antes del retirement; si no, documentar por producto por qué su retirada es aceptable. Esto no autoriza fallback por producto.

Topología final:

```text
Product Semantics facts → RuntimeProductSemanticReader
  captured CAT-V2 state → cat-v2-product-semantics
  NO_ACTIVE_BUNDLE     → legacy-product-semantic-snapshot (si cargado)
  failed/no state      → typed unavailable; no legacy
Product ontology registry → code-product-ontology-v3
Commercial Truth → readers comerciales existentes, independiente
```

## Reproducción y acceptance

Desde el root del repo, con los artifacts locales indicados:

```text
npm run catalog:bundle:build -- --source-dir=artifacts/catalog-projection-input/36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2 --output-dir=artifacts/catalog-v2/p2-2a/replay-bundles --code-ref=cat-v2-p1.3-local
node --import tsx scripts/catalog-v2/audit-product-semantics-authority.ts --bundle-id=sha256:8401b8853b327c84b71c2c3dfa03b9bd5e78bcb7e5b8c254ca89f2a48aef5017 --replay-accepted-baseline=true
```

El audit también está registrado como `npm run catalog:product-semantics:authority-audit -- ...`. El CLI directo retorna **2** después de escribir un reporte bloqueado; **1** si un input/candidate es inválido. npm en este entorno Windows presenta el exit no-cero como 1. No significa fallo de la suite. Con `--legacy-snapshot=<archivo>` exige la identidad aceptada; no reconstruye presencia ni publica/activa snapshots. Sin `--bundle-id`, lee el pointer del `--projection-root`; sin pointer devuelve NO_ACTIVE_BUNDLE. Ningún resultado del diff aprueba automáticamente los gates contractuales/operativos: sin diferencias devuelve `PARITY_PASS_REVIEW_REQUIRED`.

Los artifacts fuente/runtime están ignorados por Git y no se inventaron ni se copiaron a fixtures productivos. El reporte queda versionable. En un checkout limpio, los unit tests usan fixtures sintéticos y la aceptación CLI construye su propio bundle; no necesita el artifact B1 local.

## Cambios y validación

| Archivo | Cambio |
|---|---|
| `package.json` | Comando de auditoría, sin nuevas dependencias |
| `scripts/catalog-v2/product-semantics-parity.ts` | Validación schema/identity/runtime; populations, coverage, metrics, diferencias completas |
| `scripts/catalog-v2/audit-product-semantics-authority.ts` | Candidate/pointer verificado; snapshot aceptado o replay explicitado; reporte determinístico y bloqueo conservador |
| `docs/catalog-v2/evidence/product-semantics-parity.json` | Evidencia local reproducible; hashes y valores por producto |
| Este audit | Consumer matrix, contratos, adjudicación, failure semantics, gate y deuda |
| `tests/unit/productSemanticsAuthorityParity.test.ts` | Populations, determinismo, lineage temporal, pérdida de knowledge, confidence conflict, status/scope, evidence, identidad/duplicados |
| `tests/unit/runtimeProductSemanticReaderAuthority.test.ts` | Missing-product no recurre a legacy por ninguna superficie del reader |
| `tests/integration/projectionBundleReplay.test.ts` | Dos ejecuciones independientes del audit generan bytes idénticos; replay no puede aprobar snapshot aceptado ausente |
| `tests/integration/projectionRuntimeHotReload.test.ts` | B2 sintético cambia BENCH→BARBELL; HTTP B1→B2→B1 restaura fact/lineage original sin restart |

| Gate de validación | Resultado |
|---|---|
| `npm run typecheck` | PASS, exit 0 |
| `npm run build` | PASS, exit 0 |
| `npm test` | PASS, exit 0; 111 archivos, 2432 tests; 158.27 s |
| `git diff --check` | PASS; sin errores de whitespace |
| Acceptance parity CLI | PASS como prueba: ambas ejecuciones independientes producen bytes idénticos y exit 2 esperado para RETIREMENT_BLOCKED |
| Hot reload/rollback semántico HTTP | PASS: BENCH en B1, BARBELL en B2, respuesta/lineage original restaurados en rollback B1 |

La primera ejecución completa, concurrente con typecheck/build, tuvo 2431 tests verdes y un timeout de 30 s en el test existente `productSemanticSnapshotCli.test.ts`. Al repetir `npm test` sin las compilaciones concurrentes, todos pasaron; no se alteró ese test ni su timeout. Log local final: `artifacts/catalog-v2/p2-2a/regression-test.log`.

P2.1 sigue siendo factual; no se modifica su audit ni se crea `CAT_V2_P2_2A_CLOSURE.md`, reservado al retiro implementado y validado.

Deuda residual: snapshot aceptado/presencia reconciliada; decisión documentada de retención semántica histórica; revisión de provenance; verificación del consumidor Customer Profile y rollout operativos. Owner: Catalog Product Semantics / integración Customer Profile. El seguimiento de Product Semantics queda separado de Training, Specs, Capabilities, Relationships y Commercial Truth.
