# CAT-DISCOVER-C1 — Auditoría de Commercial Truth J1 v2 y del adaptador de Discover

Fecha: 2026-10-08. HEAD `37595c7` (`feat/cat-discover-v0`), tag `catalog-discover-v0.2-r2` → `41d4a01`. Run: `artifacts/catalog-v2/discover-c1/run-20261008-discover-c1-r1/`. **Disposición productiva: DEFER.**

Es una auditoría técnica, read-only sobre producción, bundles, snapshots y código funcional. No se implementó C2. No hubo commit, push ni deploy, y no se tocaron los artifacts de preservación ni los archivos sin seguimiento de P2.3C, QA1 y QA2. La falta de gold humano no bloquea esta fase.

## A. Resumen

- **El núcleo comercial correcto para Discover es J1 v2: `CatalogContractService` sobre `commercialEngine` (`catalog-commercial-v2.2.0`).** Es el que R4-J1A declara contrato de R4. Es el único que publica frescura (`validUntil`, OD-3), precio «desde» sobre unidades ofrecibles (OD-1), stock neto de reservas y política de backorder. Con los 20 precios reales de producción (fixture R4-J1D-R1) acierta **20/20**.
- **En el servicio conviven tres motores comerciales.** Además de J1 v2 están T11.4 (`CatalogCommercialTruthService`, que R4-J1D-R1 llama «legacy calculator») y el `priceResolver` de v1 («third implementation»). Comparados con las mismas entradas (`engine_differential.json`):
  - `priceResolver` acierta **1/20** precios de producción: publica 1 CLP menos en 19 unidades. Lo usan `/v1/products/*` y `/v1/products/explore`.
  - Hay tres órdenes distintos de selección de precio específico. T11.4 elige otra fila que V2 en el caso de prueba.
  - El precio regular difiere cuando hay precio fijo: T11.4 y v1 lo muestran como descuento; V2 no.
  - Con un porcentaje > 1 en el dato fuente, v1 publica **0 CLP**.
  - La disponibilidad cambia en 3 de 9 casos de prueba. T11.4 lee `physical_quantity` e ignora la visibilidad y la política de backorder.
- **Dos rutas `/api/v2/...` funcionan sobre T11.4, no sobre J1 v2:** `resolve-product-intent` y `recommendations/search-products`. Que una ruta se llame «v2» no implica que use el motor v2.
- **Discover ya apunta al dueño correcto, pero su adaptador tiene tres defectos medidos** (`discover_adapter_probe.json`, ejecutado con el código real):
  1. 40 claves generan 40 lecturas del dueño.
  2. Descarta `priceSummary.kind` y `priceSummary.basis`, así que «menos de 50 mil» queda **SATISFIED con el precio de referencia de un producto que no se puede comprar**.
  3. No distingue un precio «desde» de la variante que fija la consulta.
- **C2 cabe en una integración interna pequeña:**
  - en el dueño, un método batch aditivo `getProductContexts` (unas 40 líneas, sin endpoint ni cambios de motor);
  - en Discover, adaptador batch, observación enriquecida y dos reglas semánticas (unas 100 líneas);
  - las pruebas indicadas en la sección E.

```text
J1V2_CORE_AUDITED=YES
COMMERCIAL_ENGINES_FOUND=3 (J1 v2, T11.4, v1 priceResolver)
LEGACY_PRICE_PATH_IN_USE=YES (v1 products, explore)
DISCOVER_OWNER=J1_V2 (CatalogContractService)
DISCOVER_ADAPTER_DEFECTS=3
C2_ARCHITECTURE_READY=YES
C2_IMPLEMENTED=NO
PRODUCTION_ROLLOUT=DEFER
```

## B. Comportamiento real de J1 v2

| Aspecto | Implementación | Evidencia |
| --- | --- | --- |
| Precio unitario | `commercialEngine.calculatePrice` → `prestashopUnitPrice`: doble redondeo PHP, a 6 decimales y luego a CLP | `prestashopPrice.ts`; 20/20 contra la tienda; 10/10 golden |
| Precio fijo y promociones | El precio fijo es el precio regular. La promoción se publica con IVA incluido; `reduction_tax=0` se convierte a bruto | `catalogV2J1D.test.ts` OD-2 |
| Selección de precio específico | `selectSpecificPrice`: combinación > tienda > moneda > país > grupo > cliente > `from_quantity` > `from` > id. Las fechas inválidas se excluyen sin advertencia | `commercialEngine.ts` |
| Precio de producto | `priceSummary`: `kind` es `exact` o `from` (desde); `basis` es `offerable` (sólo unidades ofrecibles) o `not_offerable` (referencia) | `catalogContractService.ts`, OD-1 |
| Vendibilidad | `deriveSellability`: inactive → not_listed → not_orderable → stock desconocido → stock>0 → backorder (permitido, negado o desconocido) | `catalogV2ContractService.test.ts` |
| Stock | `stock_available.quantity` (neto de reservas), `out_of_stock` y `PS_ORDER_OUT_OF_STOCK` | `mysqlCatalogV2DataReader.ts:333,503` |
| Frescura | `asOf`, `cache.ageMs` y `validUntil = min(asOf + 15 s, próximo cambio de precio)`. La caché nunca sirve un valor pasado su vigencia | OD-3 |
| Identidad | `P{id}` (producto) y `P{id}-V{id}` (unidad vendible); `variant_required` explícito | `parseCatalogItemKey` |
| Lectura | `CatalogV2DataReader.readProducts({ productIds })` **en batch**, aunque `getProductContext` lo invoca con un único id | `catalogContractService.ts:119` |
| Pruebas | 455/455 en 24 archivos (comerciales, contract, http y Discover) | `validation_results.json` |

`CatalogRuntimeProductContextService` combina la capa comercial V2 con las proyecciones, con autoridad y lineage. Se construye en `bootstrap.ts` pero **ninguna ruta lo expone**.

## C. Mecanismos duplicados o legacy

El registro completo está en `duplication_register.csv` y el inventario de superficies en `commercial_surface_inventory.json`.

| ID | Mecanismo | Divergencia medida | ¿Afecta a C2? |
| --- | --- | --- | --- |
| DUP-01 | Aritmética de precio | v1 `resolvePrice` acierta 1/20 precios de tienda (−1 CLP); no se migró en J1D-R1 | No |
| DUP-02 | Selección de precio específico | Tres órdenes. Caso de prueba: T11.4 elige la fila 22 (95.200), V2 y v1 la fila 21 (107.100) | No |
| DUP-03 | Precio regular con precio fijo | V2: 95.200 sin descuento. T11.4 y v1: 119.000 → 95.200 «con descuento» | No |
| DUP-04 | Porcentaje > 1 | v1 publica 0 CLP; T11.4 lo ignora y advierte; V2 lo ignora | No |
| DUP-05/06 | Vendibilidad y fuente de stock | Backorder permitido, visibilidad `none` y stock reservado cambian la ofrecibilidad. T11.4, v1 y explore usan `physical_quantity` | No, si Discover sigue en V2 |
| DUP-08 | Frescura | Sólo V2 publica `validUntil` | **Sí**: Discover lo exige (P9) |
| DUP-09 | Semántica de «precio ≤ X» | Tanto el filtro `maxUnitPrice` de V2 como Discover ignoran `basis`/`kind` | **Sí** |
| DUP-11 | Documentación | `docs/catalog-commercial-truth.md` y el título de un test dicen que T11.4 no usa `reduction_tax`; el código sí lo usa desde J1D-R1, y no hay test con `reduction_tax=0` | No |

Mapa de superficies:

| Motor | Superficies |
| --- | --- |
| **J1 v2** | `/v2/catalog/search`, `products/:key/context`, `items/:key/context`; Discover |
| **T11.4** | `/api/v2/catalog/resolve-product-intent` (su recuperación usa además la búsqueda legacy v1); `/api/v2/recommendations/search-products` |
| **v1** | `/v1/products/search`, `/:productId`, `/batch` |
| **Híbrido** | `/v1/products/explore`: precio v1 con disponibilidad T11.4 |

## D. Qué reutiliza Discover y qué valida por sí mismo

Detalle en `validation_boundary.json`.

**Reutiliza del dueño, sin reimplementar:**

- precio, impuesto y redondeo;
- selección de promociones;
- precio «desde» y su `basis`;
- vendibilidad y política de backorder;
- stock neto;
- frescura;
- identidad de producto o ítem, `variant_required`;
- el estado `not_found` frente a inactivo.

**Valida por sí mismo, porque es semántica de la consulta:**

| Validación | Estado |
| --- | --- |
| Interpretar «menos de 50 mil», «en stock» y «barato» | Existe; el léxico está pendiente de revisión de dominio |
| Decidir qué vendibilidad satisface la consulta: `sellable` → SATISFIED, `not_sellable` → VIOLATED, `backorder` y `check_with_staff` → UNKNOWN | Existe |
| Tratar una observación vencida como UNKNOWN | Existe |
| Presupuesto y orden de hidratación | Existe |
| Ante falta de datos, NOT_OBSERVED y nunca cero | Existe |
| Lo comercial no decide la relevancia | Existe |
| Un precio de referencia no ofrecible no certifica | **Falta** |
| Un precio «desde» no certifica la variante fijada por una restricción técnica | **Falta** |

**Prohibido en Discover:**

- importar T11.4 o `priceResolver`;
- recalcular precio o vendibilidad;
- leer tablas de PrestaShop;
- alargar la vigencia del dueño;
- elegir una variante.

## E. Arquitectura C2 implementable

Detalle en `c2_architecture.json`. Estado: propuesta, no implementada.

| # | Lado | Cambio | Reutiliza | Pruebas |
| --- | --- | --- | --- | --- |
| C2-1 | Dueño, aditivo | `CatalogContractService.getProductContexts({ productKeys, quantity })`: caché por clave, **una** llamada a `readProducts({ productIds })` y el `buildProductContext` existente | `parseCatalogItemKey`, `getCached`/`setCached`, `freshness` (OD-3), `MySqlCatalogV2DataReader` | Equivalencia con N× `getProductContext` sobre `tests/support/catalogV2FixtureScenarios.ts`; una lectura para N claves; `validUntil` nunca mayor (casos OD-3 de `catalogV2J1D.test.ts`) |
| C2-2 | Discover | `CommercialObservation` agrega `priceKind`, `priceBasis`, `regularGrossClp`, `discounted`, `sellableVariants`, `cacheAgeMs` y `serviceBuildRef` | `ProductContextResponse` | Estilo de `discoverV02.test.ts` |
| C2-3 | Discover | `commercialTruthHydrator(owner: Pick<CatalogContractService, 'getProductContexts'>)` en batch, copiando los campos sin aritmética | `COMMERCIAL_HYDRATION_FAILED` existente | Sustituir el test con `as never` por uno con el `CatalogContractService` **real** y un lector en memoria (patrón `discover-adapter-probe.ts`); 40 claves → 1 lectura |
| C2-4 | Discover, semántica | `ConstraintVerifier.commercial`: precio con `basis` `not_offerable` → UNKNOWN `PRICE_REFERENCE_NOT_OFFERABLE`; precio `from` junto con un SPEC que fija variante → UNKNOWN `VARIANT_PRICE_UNRESOLVED` | — | P41 → POSSIBLE; P42 más peso → UNKNOWN; los dobles comerciales existentes siguen pasando |
| C2-5 | Composición | Una factory para tests y el CLI spike. `bootstrap.ts` y las rutas no cambian (sin R4) | — | E2E `discoverV0` con el dueño real en memoria |

**Gates de regresión:**

- el replay V0.2 y el smoke del harness G1 deben seguir reproduciendo r2 en 480/480 sin Commercial Truth;
- las suites del dueño sin cambios, incluidos los hashes del MANIFEST de fixtures;
- las suites Discover y G1;
- `tsc` y `eslint`.

**Tamaño:** unas 40 líneas en el dueño y 80–120 en Discover, más las pruebas. Sin SQL, endpoints ni contratos nuevos.

**Decisiones del owner:**

- la etiqueta de versión de Discover para el comportamiento C2 (G1 prohibió iniciar V0.3);
- la semántica del filtro `maxUnitPrice` de `/v2/catalog/search` cuando el `basis` es `not_offerable`.

**Fuera de C2** (backlog del dueño, sin bloquear Discover):

- DUP-01 a DUP-06 y DUP-11;
- migrar a V2 los consumidores de T11.4: intent, recomendaciones y explore;
- exponer o retirar `CatalogRuntimeProductContextService`.

## F. Límites de la auditoría

- No hay acceso a la base de datos productiva. Los precios reales provienen del fixture R4-J1D-R1 (20 unidades observadas el 2026-09-30); los casos de prueba son sintéticos y están rotulados.
- El fixture fija `reduction_tax = 1` y sólo porcentajes, así que la parity real de montos con `reduction_tax = 0` no está medida en producción.
- **`priceResolver` acierta hoy 1/20, no 19/20 como dice J1D-R1.** J1D-R1 se refería a una regla legacy anterior, no a `priceResolver`. Medido hoy con el mismo fixture, `priceResolver` redondea una sola vez.
- La identidad Git de los commits sigue registrada como defecto de metadatos históricos. No hay commits nuevos.

## G. Preservación previa a C1

Ejecutada según lo instruido:

- **Cuarentena.** 10 archivos de `p23c-rollout-Vs7KXj` copiados a `preservation/quarantine/` en sólo lectura, sin seguir links y con un registro de 2.629 archivos de esa área. Incluye `old-runtime.tar`, `review-export.json` y la línea base `2a5521…`. **No son autoritativos.**
- **Inventario.** `preservation/inventories/p2-3c-prb_inventory.json` cubre 61 archivos, 533 MB: 522 MB de contenido único, 7 grupos duplicados y 20 archivos ya presentes en los bundles preservados. El 89 % es `admission-rows.json` (476 MB).
- **Manifest.** `PRESERVATION_MANIFEST.json` no cambió y verifica sus 266 archivos sin errores.

## Reproducción

```bash
C1=artifacts/catalog-v2/discover-c1/run-20261008-discover-c1-r1
npx tsx scripts/catalog-v2/discover-v0/integrity.ts --out=$C1/protected_before.json --exclude=artifacts/catalog-v2/discover-c1
npx tsx scripts/catalog-v2/discover-c1/commercial-engine-differential.ts --out-dir=$C1
DB_HOST=offline.invalid DB_USER=offline DB_PASSWORD=offline DB_NAME=offline CATALOG_API_KEYS=offline-c1 LOG_LEVEL=silent \
  npx tsx scripts/catalog-v2/discover-c1/discover-adapter-probe.ts --out-dir=$C1
npx vitest run --config vitest.config.ts tests/contract tests/http/catalogV2Endpoint.test.ts tests/http/exploreProductsEndpoint.test.ts \
  tests/unit/catalogCommercialTruthService.test.ts tests/unit/catalogV2ContractService.test.ts tests/unit/catalogV2J1D.test.ts \
  tests/unit/prestashopStorefrontPricing.test.ts tests/unit/priceResolver.test.ts tests/unit/exploreProductsService.test.ts \
  tests/unit/mysqlCatalogCommercialDataReader.test.ts tests/unit/mysqlCatalogV2DataReader.test.ts \
  tests/unit/catalogRuntimeProductContextService.test.ts tests/unit/discover-v0 tests/unit/discover-g1 tests/integration/discover-v0
npx tsx scripts/catalog-v2/discover-v0/integrity.ts --out=$C1/protected_after.json --exclude=artifacts/catalog-v2/discover-c1
npx tsx scripts/catalog-v2/discover-g1/compare-protected.ts --before=$C1/protected_before.json --after=$C1/protected_after.json --out=$C1/protected_comparison.json
node artifacts/catalog-v2/preservation/tools/preserve.mjs verify
```
