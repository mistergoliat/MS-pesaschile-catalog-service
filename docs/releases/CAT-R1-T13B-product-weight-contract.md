# CAT-R1-T13B — Product Weight Contract (`weightKg`)

## Objetivo

Implementar el contrato de peso aprobado en [CAT-R1-T13A](../audits/CAT-R1-T13A-product-weight-authority-contract-audit.md) (veredicto `PRODUCT_WEIGHT_READY_FOR_ADDITIVE_CONTRACT`) para que CRM / Sales Agent pueda obtener, por línea, `productId + combinationId + priceTaxIncl + stock + weightKg` directamente desde Catalog Service, sin consultar PrestaShop. Alcance limitado a `GET /v1/products/:productId` y `POST /v1/products/batch`. No shipping, no Carrier, no cambios en CRM.

## Auditoría previa (matriz)

| LAYER | CURRENT FIELD | WEIGHT CHANGE | RISK |
|---|---|---|---|
| SQL `getProductCore` | `id_product, name, sku, description_short, description, link_rewrite` | `+ p.weight AS baseWeight` en la misma query | Bajo |
| SQL `getVariants` | `impactPrice` vía `COALESCE(pas.price, pa.price, 0)`, ya hace `LEFT JOIN product_attribute_shop` | `+ COALESCE(pas.weight, pa.weight, 0) AS weightImpact`, mismas columnas agregadas al `GROUP BY` | Medio (GROUP BY) |
| Domain types | `ProductCoreRecord`, `VariantSummary`, `ProductDetail` sin peso | `+baseWeightKg`, `+weightImpactKg` (interno), `+weightKg` (público) | Bajo, con fuga a `variants[]` si no se excluye explícitamente |
| Application (`catalogService.ts`) | `pricing`/`stock` resueltos junto a `selectedVariant`, `null` cuando no hay combinación resoluble | `weightKg` resuelto en el mismo punto, mismo `selectedVariant`/`selectedVariantBase` | Bajo |
| Errores | `StockUnavailableError` (503) es el patrón vivo para "este hecho comercial de la variante seleccionada no se pudo resolver" | `WeightUnavailableError` (503), mismo patrón | Bajo |
| Zod/HTTP (`shared/contracts.ts`, `app.ts`) | `productResponseSchema.strict()`, Fastify deriva su JSON Schema de este mismo schema | `weightKg` agregado al schema | **Alto si se omite** — Fastify elimina en silencio campos no declarados |
| `search_products` / `explore_catalog` / `recommend_catalog_products` | 3 lectores SQL independientes (`mysqlSearchProvider`, `mysqlCatalogExploreDataReader`, `mysqlCatalogCommercialDataReader`) | Ninguno | Ninguno — confirmado estructuralmente aislado |

La auditoría no encontró sorpresas frente a lo documentado en T13A; no fue necesario rediseñar el enfoque.

## Fuente autoritativa y fórmula efectiva

```text
ps_product.weight                              DECIMAL(20,6) NOT NULL DEFAULT 0, unidad kg
ps_product_attribute.weight                    DECIMAL(20,6) NOT NULL DEFAULT 0 (impacto, no absoluto)
ps_product_attribute_shop.weight               DECIMAL(20,6) NOT NULL DEFAULT 0 (override por shop)

effectiveWeightKg =
  ps_product.weight
  + COALESCE(ps_product_attribute_shop.weight, ps_product_attribute.weight, 0)
```

Implementado exactamente así desde el día uno, aunque la auditoría T13A confirmó que en producción los 453 `ps_product_attribute` y 461 `ps_product_attribute_shop` tienen impacto 0 — el formato evita un *drift* silencioso futuro si algún día se puebla un impacto real, sin requerir migración posterior.

## Contrato público

```ts
// ProductDetail / productResponseSchema — sibling de pricing y stock
weightKg: number | null
```

- Zod: `z.number().nonnegative().nullable()`, clave **requerida** (nunca ausente; el valor puede ser `null`).
- No se agregó wrapper (`{weightKg, source, unit}`) ni campos extra (`weightSource`, `weightUnit`, `weightImpact`, `baseWeight`) al contrato público — tal como se pidió.
- `weightImpactKg` (impacto interno) se mantiene fuera de `variants[]`: `catalogService.ts` lo excluye explícitamente vía destructuring (`const { weightImpactKg: _weightImpactKg, ...publicVariant }`), no depende de que Fastify lo recorte en silencio.

### Cero y null

- `ps_product.weight = 0` → `weightKg: 0`, nunca `null`. No hay heurística por nombre/SKU/tipo de producto.
- `weightKg: null` ocurre **únicamente** en el mismo caso ya existente en que `pricing`/`stock` son `null` (producto con combinaciones sin variante `default_on` resoluble) — no se creó una nueva rama de resolución solo para peso.

### Precisión y redondeo

`DECIMAL(20,6)` de origen → redondeado a 3 decimales con `ROUND_HALF_UP`, reutilizando el motor `Decimal` ya configurado en `src/shared/money.ts` (no se introdujo una dependencia matemática nueva). Nuevo helper específico: `src/shared/weight.ts` (`toWeightKg`), ya que `money.ts` es semánticamente monetario.

```text
20.000000 → 20
0.100000  → 0.1
20.123400 → 20.123
20.123500 → 20.124
```

### Guardia de peso negativo

Producción no tiene hoy productos ni combinaciones con peso negativo, pero el contrato HTTP nunca debe poder cruzar un valor negativo. Se revisaron los patrones de error existentes: `StockUnavailableError` (503) es el patrón **vivo** — se lanza realmente desde `prestashopPhysicalStockProvider.ts` cuando un hecho comercial de la variante seleccionada no puede resolverse; `PriceUnavailableError` existe pero nunca se lanza (vestigial). Se optó por replicar el patrón vivo en lugar de inventar un sistema de warnings nuevo (el sistema `CatalogCommercialWarning` pertenece a la familia de endpoints T11.4/search-v2, explícitamente fuera de alcance aquí).

Decisión: `resolveEffectiveWeightKg()` en `catalogService.ts` lanza `WeightUnavailableError` (`WEIGHT_UNAVAILABLE`, 503) cuando `base + impact < 0`. Falla el `getProduct()` completo (mismo comportamiento que `StockUnavailableError` hoy), no se inventa `0`. Cubierto por un test sintético (`fails closed with WeightUnavailableError...`) ya que no hay caso real en producción.

## Endpoints afectados

| Endpoint | Cambio |
|---|---|
| `GET /v1/products/:productId` | `weightKg` agregado |
| `POST /v1/products/batch` | Heredado automáticamente — reutiliza `CatalogApplicationService.getProduct()`/`ProductDetail`, cero código adicional |
| `GET /v1/products/search` | Sin cambios (confirmado por schema-shape test) |
| `POST /v1/products/explore` | Sin cambios (confirmado por schema-shape test) |
| `POST /api/v2/recommendations/search-products` | Sin cambios (confirmado por schema-shape test + assertion end-to-end en `searchProductsV2ClientWiring.test.ts`) |

## Compatibilidad

`ADDITIVE_BACKWARD_COMPATIBLE` dentro de este repositorio: campo nuevo, requerido-pero-nullable, agregado a un schema `.strict()` compartido por servidor y `client/` (mismo objeto Zod importado en ambos lados, no pueden desincronizarse). Ningún campo existente cambió de forma, tipo o requerido.

### CRM-Customer-360 (verificado, no adivinado)

Se inspeccionó (solo lectura, sin modificar) `CRM-Customer-360/lib/catalog/httpCatalogAdapter.ts` y `lib/catalog/types.ts`:

- `parseProductResponse()` es un parser manual, explícito, campo-por-campo (`isRecord(payload) && isRecord(payload.product)`, luego lee `product.*`, `payload.variants`, `payload.selectedVariant`, `payload.pricing`, `payload.stock`, `payload.freshness`, `payload.publicLink` uno por uno).
- No usa Zod `.strict()` ni `additionalProperties: false` en ningún punto de la ruta de catálogo (`grep` sin resultados en `lib/catalog/`).
- `weightKg` no existe hoy en `CatalogProduct` ni se lee en `parseProductResponse()` — un campo nuevo en la respuesta HTTP simplemente no es tocado por el parser: no lanza, no rompe, no lo produce el `unknown` intermedio.

```text
CRM_ACCEPTS_ADDITIVE_FIELD
```

Con una salvedad honesta: esto confirma que el adapter **no se rompe**, no que **ya use** `weightKg` — hoy lo ignoraría en silencio. Para que Carrier consuma el peso, CRM necesita una tarea propia (fuera de este alcance) que agregue `weightKg` a `CatalogProduct` y lo lea en `parseProductResponse()`. Ver "Siguiente integración esperada".

## Tests

Nuevo o extendido (56 archivos de test, 1764 tests, 0 fallas — ver comparación de baseline):

- `tests/unit/weight.test.ts` (nuevo) — `toWeightKg`: entero, decimal pequeño, redondeo hacia abajo/arriba en el límite exacto, cero.
- `tests/unit/mysqlCatalogRepository.test.ts` — nueva sección `product weight`: `p.weight` en la query existente (no una nueva), decimal, cero, `COALESCE(pas.weight, pa.weight, 0)` con la misma precedencia que precio, impacto sintético no-cero, `weightImpactKg` no se filtra a `getSearchCandidates`.
- `tests/unit/catalogService.test.ts` — producto simple, producto con combinación (impacto sintético +2.5), redondeo `ROUND_HALF_UP`, cero literal (usando el SKU real `id_product 505` de T13A), guardia de negativo (`WeightUnavailableError`), inmutabilidad del objeto `VariantSummary` de origen, `weightKg: null` en el caso sin combinación resoluble, batch con item exitoso + item fallido.
- `tests/contract/contracts.test.ts` — nueva sección `weightKg`: clave requerida, número válido, cero válido, `null` válido, negativo rechazado, no-numérico rechazado, `.strict()` sigue rechazando claves desconocidas, **serialización real por HTTP** (guarda explícitamente el riesgo de T13A: Fastify puede eliminar en silencio un campo no declarado en el schema), y confirmación de que `search_products`/`explore_catalog`/`recommend_catalog_products` no ganaron `weightKg` (inspección directa del `.shape` de sus schemas).
- `tests/unit/http.test.ts` — nuevas pruebas explícitas de `GET /v1/products/:productId` y `POST /v1/products/batch` leyendo el JSON real de respuesta.
- `tests/integration/agent-flow.test.ts` — round-trip HTTP real (Fastify `listen` + cliente real `getProduct()`) con base(20) + impacto(0.5) = 20.5, y confirma que `weightImpactKg` no aparece en `variants[]`.
- `tests/integration/searchProductsV2ClientWiring.test.ts` — flujo real recommend→get_product_details: confirma que la recomendación NO trae `weightKg` y que el detalle posterior sí (20 + 0.2 = 20.2).
- Fixtures ajustados en `tests/support/fakes.ts` y en las integraciones de `productIntentRuntimeWiring`/`relationshipSnapshotBuildPipeline`/`searchProductsV2RuntimeWiring` (solo para satisfacer el nuevo campo requerido `baseWeightKg`, sin relación funcional con esas suites).

## Validación live (read-only, sin escribir en PrestaShop)

`scripts/validate-weight-parity.ts` (nuevo, espejo de `scripts/validate-price-parity.ts`, `npm run validate:weight -- <cases.json>`) ejecutado contra una instancia real de Catalog Service (`npm run dev`, DB de producción vía las credenciales de solo-lectura `pc_consultor` ya configuradas en `.env`):

| productId | combinationId | expectedWeightKg | serviceWeightKg | match | nota |
|---|---|---|---|---|---|
| 12 | 0 | 17 | 17 | ✅ | simple, entero (BFM) |
| 7 | 0 | 1.5 | 1.5 | ✅ | simple, decimal (BC100) |
| 13 | 5 | 0.25 | 0.25 | ✅ | con combinación, impacto real = 0 (BKT/BKTAM) |
| 444 | 0 | 0 | 0 | ✅ | SKU de servicio, peso 0 conocido (SVPC) |
| 1210 | 0 | 826 | 826 | ✅ | outlier pesado, plausible (PRMC2) |

`expectedWeightKg` se calculó independientemente vía SQL directo (`ps_product.weight + COALESCE(ps_product_attribute_shop.weight, ps_product_attribute.weight, 0)`) antes de invocar el servicio. Los 5 casos exigidos por la tarea (entero, decimal, combinación, cero, outlier) están cubiertos. `npm run smoke` también se corrió contra la misma instancia real como verificación general no relacionada a peso (búsqueda + detalle siguen funcionando; `weightKg: 17` visible junto a `pricing`/`stock` para un producto real).

No se modificó ningún dato de PrestaShop. El servidor de desarrollo se detuvo al finalizar.

## Los 15 PACK con `weight = 0`

Documentado en T13A, sin tocar: 15 SKUs tipo PACK activos y con stock (`941, 942, 945, 946, 947, 949, 961, 968, 978, 988, 989, 991, 992, 993, 1002`) tienen `ps_product.weight = 0` en PrestaShop porque nunca se completó ese campo, no porque el paquete realmente pese cero. Esta implementación **no** distingue ese caso — `weightKg: 0` se sirve igual para esos 15 productos que para un SKU de servicio genuinamente sin peso, porque Catalog Service no tiene información para diferenciarlos sin inventar una heurística.

No se agregaron `weightReliable`, `weightVerified` ni `shippingEligible` al contrato, tal como se pidió. La limitación queda documentada aquí; corregirla requiere una tarea de limpieza de datos en PrestaShop, fuera del alcance de Catalog Service.

## Comparación de baseline

| | Baseline (pre-cambio, 3 corridas) | Post-cambio (3 corridas) |
|---|---|---|
| Test files | 55 | 56 (+1: `weight.test.ts`) |
| Tests | 1737 | 1764 (+27) |
| Fallas | 0 en la corrida limpia; 1 y 5 fallas transitorias por `testTimeout` en las dos corridas frías anteriores, en archivos distintos cada vez (confirmado ambiental — cold-start de transformación TS, no relacionado a código) | 0 en las 3 corridas |
| Nombres de fallas nuevas | — | Ninguna |

`npm run typecheck`, `npm run lint` y `npm run build` — limpios. `lint` requirió un ajuste mínimo: `eslint.config.js` ahora también ignora variables (no solo argumentos) con prefijo `_`, extendiendo la convención `argsIgnorePattern: '^_'` ya existente a `varsIgnorePattern: '^_'`, necesario para el patrón "destructurar y descartar" usado para excluir `weightImpactKg` de `variants[]`.

## Riesgos

1. El campo debía agregarse a `shared/contracts.ts`, no solo a los tipos de dominio — verificado explícitamente con un test que llama a `app.inject()` real y lee el JSON, no solo el objeto en memoria.
2. `CRM_ACCEPTS_ADDITIVE_FIELD` está verificado a nivel de "no rompe", no de "ya lo usa" — sin una tarea de seguimiento en CRM, `weightKg` llega a CRM pero no se propaga a Carrier.
3. Los 15 PACK con `weight = 0` siguen siendo indistinguibles de un cero legítimo; cualquier consumidor de `weightKg` para cotizar flete debe tratar `0` en un producto físico como una señal a revisar, no como un hecho confiable, hasta que se limpie el dato en PrestaShop.
4. Cache: entradas ya cacheadas de `ProductDetail` (TTL `PRODUCT_CACHE_TTL_SECONDS`, 900s por defecto) de antes del despliegue no tendrán `weightKg`; se autolimpian al expirar el TTL. No se versionó la clave de caché porque no hay precedente de hacerlo para otros campos agregados y el TTL es corto.

## Siguiente integración esperada

```text
CRM-Customer-360 (repo separado, no modificado aquí):
  lib/catalog/types.ts            → agregar weightKg: number | null a CatalogProduct
  lib/catalog/httpCatalogAdapter.ts → leer payload.weightKg en parseProductResponse()

Luego, y solo después de eso:
  Carrier / Quote Service (fuera de alcance total en T13A y T13B)
```
