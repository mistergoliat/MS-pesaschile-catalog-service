# R4-J1A — Catalog commercial contract remediation

Fecha de implementación: 2026-09-29
Fuente autoritativa: `E:\dev\codex\R4-agent-platform\docs\architecture\R4-J1_CATALOG_CONTRACT_AND_SERVICE_AUDIT.md`
Servicio: `MS-pesaschile-catalog-service`

## 1. Executive summary

Se implementó una superficie comercial v2 read-only para R4, separada de las APIs legacy de CRM.
La superficie nueva tiene identidad de unidad vendible, lifecycle explícito, disponibilidad basada en
`stock_available.quantity`, política de backorder, precio público fijo, freshness honesta, búsqueda
léxica agrupada por producto y contextos de producto/ítem.

No se conectó R4 automáticamente y no se modificó ninguna base de datos. La auditoría productiva
read-only no pudo ejecutarse porque no existe autorización/túnel/configuración de producción en este
checkout; esas observaciones permanecen `UNKNOWN`.

## 2. B1–B7 status

| Paquete | Estado | Evidencia |
|---|---|---|
| B1 Identity/lifecycle | COMPLETO | `src/domain/catalog/v2/commercialEngine.ts`, `CatalogContractService`, tests de `P{id}`/`P{id}-V{id}` y lifecycle |
| B2 Unified pricing | COMPLETO para el contrato v2 | `commercialEngine.ts`, golden cases `contracts/catalog/v2/fixtures/pricing-golden.json`, alineación de `priceResolver`/`CommercialPriceCalculator` |
| B3 Availability truth | COMPLETO para v2 | `mysqlCatalogV2DataReader.ts` lee `quantity`, `visibility`, `available_for_order`, `out_of_stock`; tests de stock 0, backorder y desconocido |
| B4 Honest freshness | COMPLETO para v2 | `asOf`, `cache.ageMs`, `validUntil`; caché acotada a 15 s y sin timestamp fabricado |
| B5 Search | COMPLETO | `POST /v2/catalog/search`, ranking antes de truncar, una fila por producto y filtros explícitos |
| B6 Product context | COMPLETO | `GET /v2/catalog/products/{productKey}/context`, facts/derived/inferred/provenance/freshness/specifications |
| B7 Sellable item context | COMPLETO | `GET /v2/catalog/items/{itemKey}/context?quantity=N` |

Las APIs v1 se mantienen por compatibilidad CRM y no son contrato de R4. Sus limitaciones históricas
no se reutilizan internamente para las superficies v2.

## 3. Contratos finales

Schemas ejecutables: `src/domain/catalog/v2/contracts.ts`. Publicación estable:
`contracts/catalog/v2/schemas/catalog-v2.schema.json`.

Endpoints:

- `POST /v2/catalog/search`: request `{ query, filters?, limit }`; respuesta a nivel producto con `itemKey`, categoría, resumen de variantes, precio, sellability, match, `totalMatches`, `truncated`, `searchMode` y freshness.
- `GET /v2/catalog/products/{productKey}/context`: producto `P{id}`, sin seleccionar una variante; devuelve facts autoritativos, precio agregado, disponibilidad agregada, URL, FBT inferido opcional y provenance.
- `GET /v2/catalog/items/{itemKey}/context?quantity=N`: unidad `P{id}` sin variantes o `P{id}-V{variantId}`; devuelve precio, promoción, impuesto, engine version, cantidad disponible, sellability, razón y freshness.

Reglas relevantes:

- `P{id}` sólo es una unidad vendible cuando el producto no tiene variantes.
- SKU es dato de display/lookup, nunca identidad canónica.
- La búsqueda no oculta stock cero por defecto; `sellableOnly` es explícito.
- `quantity` es neto de reservas y una fila ausente es `stock_unknown`.
- Cero stock no implica backorder: se lee `out_of_stock` y, cuando hereda, la configuración global.
- El contexto de precio es público fijo: cliente 0, grupo/moneda/país configurados; no usa headers del llamador.
- `frequentlyBoughtTogether` sólo aparece bajo `inferred`; compatibilidad, sustitutos y bundles no se emiten.

## 4. Gap register completo

`Fixed` significa resuelto para la superficie comercial v2 requerida por R4. `Deferred` significa
que queda fuera del gate J1 o depende de evidencia productiva/R4 posterior.

| ID | Original | Disposición final | Estado | Evidencia |
|---|---|---|---|---|
| CAT-ID-01 | KEEP | Se conservan IDs PS como base de identidad | Fixed | `commercialEngine.ts` |
| CAT-ID-02 | FIX | `CatalogItemRef`, `itemKey` y no pseudo-base con variantes | Fixed | `commercialEngine.ts`, tests v2 |
| CAT-ID-03 | FIX | `found`/`not_found`; inactivo permanece encontrado | Fixed | `CatalogContractService`, `product-inactive.json` |
| CAT-ID-04 | ADAPT | SKU no se usa como identidad; adapter R4 posterior | Deferred | contrato v2 `ref`/`itemKey` |
| CAT-PR-01 | FIX | Precio v2 único y semántica legacy alineada | Fixed | `commercialEngine.ts`, `priceResolver.ts`, `priceCalculator.ts` |
| CAT-PR-02 | FIX | `asOf` del lector y edad real en v2 | Fixed | `catalogContractService.ts`, freshness tests |
| CAT-PR-03 | FIX | TTL de contexto v2 acotado a 15 s; no usa ProductDetail v1 | Fixed | caché local v2 |
| CAT-PR-04 | EXTEND | `promotion.validUntil` y `freshness.validUntil` | Fixed | contratos v2 y golden cases |
| CAT-PR-05 | FIX | Se declara `configured_flat_rate`; reglas PS siguen UNKNOWN | Deferred | `taxBasis`, sin acceso productivo |
| CAT-PR-06 | FIX | Desempate determinista por especificidad/ID; prioridad PS real queda pendiente | Deferred | `commercialEngine.ts`, audit UNKNOWN |
| CAT-PR-07 | ADAPT | Contexto público fijo en Catalog; wiring R4 posterior | Deferred | `publicContext()` |
| CAT-PR-08 | KEEP | Se mantiene precio regular/final y promoción | Fixed | schemas v2 |
| CAT-PR-09 | EXTEND | `quantity` soporta `from_quantity`; no se publica tabla de tramos | Deferred | pricing golden |
| CAT-AV-01 | FIX | `stock_available.quantity`, no `physical_quantity`, en v2 | Fixed | `mysqlCatalogV2DataReader.ts` |
| CAT-AV-02 | FIX | `listed` y `orderable` derivados de PS | Fixed | lector/engine |
| CAT-AV-03 | EXTEND | `out_of_stock` local + política global heredada | Fixed | lector/engine/tests |
| CAT-AV-04 | KEEP | Se conserva modelo explícito de sellability | Fixed | `commercialEngine.ts` |
| CAT-AV-05 | FIX | Stock ausente no tumba contexto; produce `stock_unknown` | Fixed | item context contract |
| CAT-RL-01 | KEEP | FBT se reserva a `inferred.frequentlyBoughtTogether` | Fixed | `contracts.ts`, `inferred()` |
| CAT-RL-02 | EXTEND | No se inventan relaciones curadas | Deferred | contrato no contiene compatibilidad |
| CAT-RL-03 | REMOVE | Vocabulario no soportado ausente del contrato v2 | Fixed | schemas v2 |
| CAT-RL-04 | FIX | Exclusiones aplicadas por el lector v2 | Fixed | `DISCOVERY_EXCLUDED_PRODUCT_IDS` |
| CAT-RL-05 | FIX | Rama opcional no bloquea ProductContext | Deferred | readiness legacy no modificada |
| CAT-SR-01 | FIX | Se rankea el conjunto completo antes de truncar | Fixed | `CatalogContractService.search()` |
| CAT-SR-02 | FIX | Stock 0 visible salvo `sellableOnly` | Fixed | search HTTP test |
| CAT-SR-03 | FIX | Una fila por producto, variantes resumidas | Fixed | `toSearchCandidate()` |
| CAT-SR-04 | EXTEND | Precio/categoría/completitud/filtros en v2 | Fixed | `CatalogSearchResponse` |
| CAT-SR-05 | EXTEND | `searchMode=lexical`; typo/stemming no se inventa | Deferred | contrato v2 |
| CAT-SR-06 | KEEP | Ranking determinista existente reutilizado | Fixed | `searchTextRelevance.ts` |
| CAT-SR-07 | FIX | Sin heurística `barra` en v2; política de exclusión central | Fixed | lector/servicio v2 |
| CAT-SR-08 | FIX | LIKE wildcards escapados | Fixed | `escapeLike()` |
| CAT-SR-09 | REMOVE | R4 no depende de intent resolution | Deferred | sólo rutas legacy |
| CAT-SM-01 | KEEP | Snapshots semánticos existentes preservados | Fixed | sin cambios destructivos |
| CAT-SM-02 | FIX | Reconciliación live queda posterior a J1 | Deferred | audit/source evidence |
| CAT-CX-01 | EXTEND | ProductContext coherente en una operación de servicio | Fixed | `getProductContext()` |
| CAT-CX-02 | EXTEND | Features estructuradas como `specifications[]` | Fixed | lector/fixtures |
| CAT-CX-03 | EXTEND | Brand nullable leído en v2 | Fixed | `manufacturer` query |
| CAT-CX-04 | EXTEND | Media no inventada | Deferred | no hay fuente requerida por J1 |
| CAT-CX-05 | KEEP | Peso y URL pública conservados | Fixed | product context |
| CAT-CX-06 | ADAPT | Descripción corta limitada a 600; hardening final en R4 | Deferred | lector v2 + adapter pendiente |
| CAT-FP-01 | EXTEND | `sourceUpdatedAt` permanece nullable | Deferred | `date_upd` productivo no leído |
| CAT-FP-02 | ADAPT | Catalog publica freshness; TTL de capability R4 posterior | Deferred | contrato v2 |
| CAT-FL-01 | ADAPT | v2 normaliza `invalid_request`/source unavailable; mapeo DomainError R4 posterior | Fixed/Deferred | `catalogV2Routes.ts` |
| CAT-FL-02 | FIX | Batch legacy no es dependencia v2 | Deferred | compatibilidad CRM |
| CAT-FL-03 | FIX | Redis legacy no es dependencia v2; hardening global posterior | Deferred | rutas v2 no dependen de Redis |
| CAT-FL-04 | FIX | Round trips v2 están acotados por batch read; pool global posterior | Deferred | `MySqlCatalogV2DataReader` |
| CAT-FL-05 | KEEP | Correlation ID y errores internos preservados | Fixed | `app.ts` |
| CAT-SE-01 | KEEP | Read-only, SQL parametrizado, schemas estrictos y API key | Fixed | rutas/lector v2 |
| CAT-SE-02 | REMOVE | R4 no usa inputs de intent/recommendation ni Customer Profile | Fixed | nueva superficie independiente |
| CAT-PF-01 | FIX | Explore full-scan queda fuera de v2 | Deferred | no se introduce datastore |
| CAT-R4-01 | REMOVE | Contrato v2 reemplaza puerto R4 defectuoso, pero adapter R4 es gate posterior | Deferred | `contracts/catalog/v2/` |

## 5. Cambios semánticos realizados

- Se separó la identidad de producto (`P{id}`) de la unidad vendible (`P{id}-V{id}`).
- Se eliminó la interpretación de `physical_quantity` en la ruta v2.
- Se introdujo una política explícita de `sellability` y razones tipadas.
- Se corrigió el cálculo de montos con `reduction_tax=0` en espacio neto y se mantuvo el precio regular independiente del precio específico.
- Se eliminó el truncado previo al ranking en la búsqueda nueva y se agrupó a nivel producto.
- Se limitaron descripciones a 600 caracteres y se expusieron features estructuradas.
- Se separaron hechos `facts`, cálculos `derived` e inferencias `inferred`.
- Se introdujeron `engineVersion`, `asOf`, `cache.ageMs` y `validUntil`.

## 6. Archivos modificados y añadidos

Principales:

- `src/domain/catalog/v2/contracts.ts`
- `src/domain/catalog/v2/commercialEngine.ts`
- `src/application/catalog/v2/catalogContractService.ts`
- `src/infrastructure/catalog/mysqlCatalogV2DataReader.ts`
- `src/interfaces/http/routes/catalogV2Routes.ts`
- `src/interfaces/http/app.ts`, `src/bootstrap.ts`, `src/server.ts`
- `src/domain/catalog/commercial-truth/priceCalculator.ts`
- `src/infrastructure/pricing/priceResolver.ts`
- `contracts/catalog/v2/schemas/catalog-v2.schema.json`
- `contracts/catalog/v2/fixtures/`
- `tests/unit/catalogV2ContractService.test.ts`
- `tests/contract/catalogV2.contract.test.ts`, `tests/contract/catalogV2PricingParity.test.ts`
- `tests/http/catalogV2Endpoint.test.ts`

La auditoría original recibió únicamente una sección final `Implementation outcome` en el checkout
de R4; su contenido histórico no fue reemplazado.

## 7. Tests ejecutados

- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- Tests nuevos v2 — PASS: 13 tests de pricing/fixtures y 12 tests de dominio/HTTP en las ejecuciones aisladas.
- `npm test -- --no-file-parallelism` — 2286 pass, 12 fail. Los 12 fallos son los 3 archivos de training semantics que requieren `data/training-semantic-snapshots/v2`, el mismo artefacto local ignorado por Git identificado en la auditoría; no dependen de Catalog v2.
- `npm run lint` — 7 errores preexistentes del checkout, todos fuera de esta tarea. El error nuevo de `mysqlCatalogV2DataReader` fue eliminado; los archivos afectados por esta remediación pasan lint de forma aislada.

## 8. Pricing parity evidence

Casos versionados en `contracts/catalog/v2/fixtures/pricing-golden.json` y ejecutados por
`tests/contract/catalogV2PricingParity.test.ts`:

| Caso | Regular CLP | Final CLP |
|---|---:|---:|
| sin descuento | 119000 | 119000 |
| percentage 10 % | 119000 | 107100 |
| amount `reduction_tax=1` 10000 | 119000 | 109000 |
| amount `reduction_tax=0` 10000 | 119000 | 107100 |
| empate de especificidad (id 5/id 9) | 119000 | 95200 |
| `from_quantity=2`, quantity 2 | 119000 | 107100 |
| promoción futura | 119000 | 119000 |
| promoción expirada | 119000 | 119000 |
| variante +10000 neto | 130900 | 130900 |

Estos son golden cases ejecutables y reproducibles; no se presentan como validación storefront
productiva hasta resolver el UNKNOWN de acceso a PrestaShop.

## 9. UNKNOWN productivos

No resueltos: distribución real de `id_tax_rules_group`; filas productivas con `reduction_tax=0`
o empates; configuración efectiva de backorder; collation; conteos de `ps_accessory`/`ps_pack`;
estabilidad de combinaciones; multi-bodega/advanced stock management; latencia real; topología y
rate-limit; configuración productiva de exclusiones; significado comercial de Commercial/Final.

No hubo conexión de producción, túnel ni credenciales disponibles, por lo que no se ejecutaron
consultas SQL live y no se modificó DB.

## 10. Legacy compatibility impact

Se mantienen las rutas v1 y de discovery para CRM. R4 debe consumir únicamente las tres rutas v2
publicadas aquí. El motor legacy quedó alineado en los casos de precio modificados; las limitaciones
legacy restantes (cache composite de ProductDetail, physical stock en v1, readiness acoplada al
snapshot de relaciones y errores batch embebidos) están explícitamente fuera del contrato R4 y se
clasifican como deferred en la tabla.

## 11. Fixtures publicadas

`contracts/catalog/v2/fixtures/` contiene `search-success`, `search-empty`, `search-truncated`,
`product-simple`, `product-with-variants`, `product-inactive`, `product-not-found`, `item-simple`,
`item-variant`, `item-promotion`, `item-backorder`, `item-not-sellable`, `item-stock-unknown`,
`upstream-unavailable` y `pricing-golden`.

## 12. Commit

No se creó commit: no se recibió autorización explícita para commit/push.

## 13. Confirmación

**catalog-service now owns all Catalog commercial repair logic required by R4; R4 does not need to interpret PrestaShop semantics.**
