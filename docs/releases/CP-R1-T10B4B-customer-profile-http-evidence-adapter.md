# CP-R1-T10B4B — Customer Profile HTTP Evidence Adapter

Fecha: 2026-08-03.

Rama: `feat/cp-r1-t10b4b-customer-profile-evidence-adapter`.

Base: `main` actualizado (`a6270f8`, incluye CP-R1-T10B4A fusionado vía PR #8).

Estado: implementado en working tree, sin commit, sin push, sin PR.

## Resumen ejecutivo

T10B3B/T10B3C/T10B4A dejaron el contrato de T09 completamente preparado para ownership neutral y para los dos
estados de disponibilidad de historial (`customer_history_not_linked`/`customer_reference_not_found`), pero sin
ningún provider real: solo existían `EmptyCustomerAffinityEvidenceProvider` y
`UnavailableCustomerAffinityEvidenceProvider`, ambos stubs sin I/O. CP-R1-T10B4B cierra esa brecha implementando
`HttpCustomerAffinityEvidenceProvider`: el primer `CustomerAffinityEvidenceProvider` real, que consulta Customer
Profile (`GET /v1/customers/:masterCustomerId/purchased-products`), recorre su paginación completa, y traduce
compras históricas reales en ownership neutral, positive-only, sin construir afinidad histórica amplia y sin
alterar ranking.

No se tocó Customer Profile, CRM Customer 360, ni ningún contrato de T09/T10/T11.

## Corrección de cierre (misma rama)

La auditoría final de CP-R1-T10B4B encontró dos hallazgos Major y tres Minor, todos dentro del propio adapter
HTTP — ninguno en T09/T10/T11/Customer Profile/CRM. Corregidos en la misma rama, sin cambiar contratos, scoring,
ranking, ni el endpoint:

1. **Timeout durante la lectura del body clasificado incorrectamente.** `readJsonBody()` (`httpCustomerAffinityEvidenceProvider.ts`)
   capturaba cualquier fallo de `response.json()` como `reason: 'invalid_response_body'`, sin distinguir si la
   causa real era el `AbortController` compartido disparándose mientras el body todavía se estaba transmitiendo.
   Verificado con un servidor HTTP real (`http.createServer`) que envía headers 200 de inmediato y nunca cierra
   el body: el abort **sí** se propaga a `response.json()` (el deadline global cubre el parseo, tal como
   documenta este archivo), pero el error resultante decía `invalid_response_body` en vez de `timeout`. Corregido:
   `readJsonBody()` ahora comprueba `isAbortError(error)` antes de clasificar, igual que ya hacía el catch
   alrededor de `fetchImpl(...)` en `fetchPage()`. No cambia el comportamiento observable en T09/T11 (cualquier
   throw se envuelve igual como `EVIDENCE_PROVIDER_FAILED { retryable: true }`) — es una corrección de
   observabilidad/clasificación interna, no de degradación end-to-end.
2. **Página incompleta con `hasMore=true` aceptada silenciosamente.** `parseAvailablePage()` nunca verificaba que
   `products.length`/`pagination.returned` igualaran `pagination.limit` cuando `pagination.hasMore === true`.
   Verificado con un fetch fake que devolvía `hasMore:true` con `returned:0` dos veces seguidas: `getEvidence()`
   resolvía sin error, avanzando `offset` sin haber leído ninguna fila real — un salto silencioso de historial
   real ante una respuesta inconsistente. Corregido: `parseAvailablePage()` ahora exige
   `pagination.returned === PAGE_LIMIT` siempre que `pagination.hasMore === true` (el reader real de Customer
   Profile solo puede afirmar `hasMore=true` cuando la página devuelta tiene exactamente `limit` filas — ver
   "Pagination" más abajo); si no, lanza `pagination_inconsistent` antes de avanzar `offset` o fabricar
   evidencia.
3. **Sentinel cero con ceros a la izquierda no rechazado (Minor).** `toMasterCustomerId()` comparaba
   `trimmed === '0'` en vez de reconocer `'00'`/`'000'`/... como la misma sentinela numérica. Corregido a
   `/^0+$/.test(trimmed)`. `'001'`, `'010'`, etc. (positivos con cero a la izquierda) siguen aceptándose tal
   cual — sin normalizar a `'1'` — porque no existe un contrato confirmado sobre cómo Customer Profile trata un
   `masterCustomerId` positivo con padding; esta tarea no inventa esa normalización.
4. **`totalSpentTaxIncl` negativo rechazado (Minor).** `decimalMoneyStringSchema` no aceptaba signo negativo, pese
   a que el campo se valida pero nunca se usa ni se expone — un ajuste o crédito legítimo con valor negativo
   tumbaría la página completa (y con ella, ownership real) por un campo que nadie lee. Corregido: el regex
   ahora acepta un `-` inicial opcional, sigue rechazando `NaN`, `Infinity`, vacíos y separadores ambiguos.
5. **Fragment no rechazado en `CUSTOMER_PROFILE_BASE_URL` (Minor).** `config.ts` rechazaba query string pero no
   `#fragment`, pese a que `buildPageUrl()` siempre resetea `url.hash=''` antes de cada request — una URL con
   fragmento pasaba el arranque en silencio en vez de fallar como sí hace el query string. Corregido: mismo
   `throw` agregado para `parsedCustomerProfileUrl.hash`.

Ningún hallazgo afectó T09, T10, T11, scoring, ranking, el endpoint, autenticación, retries, cache, ni Customer
Profile/CRM — confirmado por `git diff main` (ver "Archivos modificados" más abajo).

## Purpose

Implementar el adapter de infraestructura que cierra el flujo:

```text
SearchProducts V2 (T11)
  -> T09 Customer Product Affinity
  -> HttpCustomerAffinityEvidenceProvider (nuevo, esta tarea)
  -> Customer Profile GET /v1/customers/:masterCustomerId/purchased-products
  -> ownership neutral
  -> T09 -> T10 -> T11
```

El adapter responde únicamente cuatro preguntas por candidato: ¿compró el producto exacto?, ¿compró la variante
exacta?, ¿cuántas órdenes válidas distintas?, ¿primera y última fecha de compra? No calcula RFM, clustering,
lifecycle, category/brand affinity, ni repurchase inference.

## Architecture

Sin cambios respecto a la arquitectura aprobada:

- **Customer Profile** conserva el historial completo, resuelve `masterCustomerId -> prestashop_customer_id`,
  lee únicamente órdenes `ps_orders.valid = 1`, y expone `purchased-products`. No se modificó ningún archivo de
  ese repositorio (solo lectura, auditado en `MS-pesaschile-customer-profile`).
- **Catalog Service** genera candidatos (T08), consulta Customer Profile a través de este adapter, mapea
  ownership neutral, y no duplica historial ni resuelve identidad. Tampoco consulta PrestaShop directamente para
  personalización individual.
- **CRM Customer 360** y **Sales Agent** no se tocaron; siguen fuera de alcance (ver "Next Task").

## Customer identity

En `mode=http`, `customer.customerId` (el campo neutral que T09 ya validaba como `nonEmptyString`, no sentinel)
se interpreta específicamente como el `masterCustomerId` de Customer Profile — nunca un `id_customer` de
PrestaShop, email, teléfono, o DNI. Esa interpretación es local a este adapter; el contrato público de T09
(`CustomerAffinityCustomerReference`) no cambió.

`toMasterCustomerId()` (`httpCustomerAffinityEvidenceProvider.ts`) valida, antes de construir cualquier URL:

- `string`, `trim()`;
- solo dígitos (`/^[0-9]+$/`) — rechaza alfanumérico, email, teléfono, DNI por construcción (ninguno matchea el
  patrón);
- longitud máxima 20 (igual al `masterCustomerId` de Customer Profile: bigint(20) unsigned como texto,
  `src/http/routes/index.ts` de ese repositorio);
- no es puramente cero (`/^0+$/`: rechaza `'0'`, `'00'`, `'000'`, ... — corrección de cierre; el chequeo original
  solo comparaba `=== '0'`, dejando pasar variantes con ceros a la izquierda que son numéricamente la misma
  sentinela).

`'001'`, `'010'` y demás positivos con cero a la izquierda **sí se aceptan** y se preservan tal cual (nunca se
normalizan a `'1'`/`'10'`) — decisión explícita: no existe un contrato confirmado sobre cómo Customer Profile
trata un `masterCustomerId` positivo con padding, así que esta tarea no inventa una normalización. El path de la
URL contendrá exactamente el string recibido (verificado por test: `customerId: '001'` produce
`/v1/customers/001/purchased-products`).

Una referencia inválida lanza (`HttpCustomerAffinityEvidenceProviderError` con `reason: 'invalid_customer_identity'`)
**antes** de cualquier request HTTP — verificado por test (`calls` de fetch queda en `0`). No se agregó
`identityType`; no se redefinió ningún contrato público de T09. `masterCustomerId` nunca aparece en warnings
públicos, en logs de error, ni en el payload retornado (ver "Security").

## Customer Profile endpoint

Contrato real confirmado por auditoría directa del código fuente de `MS-pesaschile-customer-profile`
(`src/domain/customer-purchased-products/contracts.ts`, `src/http/routes/index.ts`,
`src/infrastructure/prestashop/mysql-purchased-products-reader.ts`, tests de integración) — coincide
exactamente con lo esperado, sin ninguna divergencia:

```text
GET /v1/customers/:masterCustomerId/purchased-products?limit=&offset=

available:
{
  status: 'available',
  products: [{
    productId: number, productAttributeId: number, productName: string,
    productReference: string | null, totalQuantityPurchased: number, orderCount: number,
    firstPurchasedAt: string (ISO), lastPurchasedAt: string (ISO), totalSpentTaxIncl: string,
    catalogStatus: 'linked' | 'deleted_or_unavailable'
  }],
  pagination: { limit, offset, returned, hasMore }
}

customer_not_found | customer_not_linked:
{ status: 'customer_not_found' } | { status: 'customer_not_linked' }   // HTTP 404

degraded:
{ status: 'degraded', reason: 'prestashop_unavailable' | 'prestashop_timeout' }   // HTTP 503
```

`orderCount` es `COUNT(DISTINCT id_order)` sobre órdenes `valid = 1`; `limit` default `20`/máx `100`, `offset`
default `0`; el reader pide `limit + 1` filas para calcular `hasMore` sin `COUNT` total. `productAttributeId = 0`
representa producto sin variante. Nada de esto difiere de lo documentado en
`docs/releases/CP-R1-T08-purchased-products.md` de ese repositorio — no fue necesario adaptar ningún supuesto.

## Pagination

`limit=100` fijo, `offset` incremental, mientras `pagination.hasMore === true`. Un único timeout
(`AbortController` + `setTimeout`) cubre todas las páginas — no se reinicia por página.

Guardas implementadas en `HttpCustomerAffinityEvidenceProvider.getEvidence()`:

- `pagination.offset` devuelto debe coincidir exactamente con el solicitado (si no, `pagination_inconsistent`);
- `pagination.limit` devuelto debe ser exactamente `100` (si no, `pagination_inconsistent`);
- `pagination.returned` debe igualar `products.length` (validado en el schema Zod, `invalid_response_schema` si
  no);
- **página completa cuando `hasMore=true`** (corrección de cierre): `pagination.hasMore === true` exige
  `pagination.returned === 100` (y por lo tanto `products.length === 100`, ya cubierto por el punto anterior) —
  el reader real de Customer Profile solo puede afirmar `hasMore=true` pidiendo `limit+1` filas, así que una
  página con `hasMore=true` siempre trae exactamente `limit` filas; una página que afirma "hay más" devolviendo
  menos de `limit` es contractualmente inconsistente y lanza `pagination_inconsistent` **antes** de avanzar
  `offset` o fabricar evidencia — de lo contrario el adapter saltaría en silencio las filas no leídas;
- máximo `200` páginas (`MAX_PAGES`) — protege contra un `hasMore=true` que nunca termina;
- máximo `20000` filas históricas acumuladas (`MAX_TOTAL_HISTORICAL_ROWS`) — protege contra una única página
  malformada que reporte muchísimas más filas de las que su propio `pagination.limit` permite (el guard de
  páginas no cubre ese caso, porque cuenta requests, no filas);
- la misma identidad producto/variante repetida, dentro de una página o entre páginas, lanza
  (`duplicate_identity`) — nunca se suma silenciosamente ni se elige "la última";
- el estado (`available`/`customer_not_linked`/`customer_not_found`) solo se evalúa en la primera página; si una
  página posterior reporta un estado distinto de `available`, es una inconsistencia contractual y lanza
  (`pagination_inconsistent`);
- nunca se cierra la evaluación con `hasMore=true`: o se llega a `hasMore=false`, o se lanza.

La paginación completa se mantiene aunque el modelo sea positive-only y técnicamente podría detenerse en cuanto
todos los candidatos tuvieran match — se decidió no optimizar eso para mantener invariantes simples y una
respuesta siempre consistente (ver spec de la tarea, sección 16). No se agregó cache.

## Positive-only ownership

Decisión cerrada: el adapter emite únicamente ownership positivo.

```text
match exacto:
{
  product: candidate,
  ownership: {
    previouslyPurchased: true,
    exactVariantPreviouslyPurchased: candidate.combinationId !== undefined,
    totalOrderCount: row.orderCount,
    firstPurchasedAt: row.firstPurchasedAt,
    lastPurchasedAt: row.lastPurchasedAt,
  },
}

sin match: se omite el candidato de productEvidence (nunca previouslyPurchased: false)
```

Razón (sin cambios respecto a la decisión ya documentada en T10B3B): Customer Profile certifica una cuenta
PrestaShop vinculada, no otras cuentas ni otros canales; el vínculo puede ser incompleto; la ausencia de una fila
nunca prueba universalmente "nunca comprado". Solo se mapean `orderCount` -> `totalOrderCount`,
`firstPurchasedAt`, `lastPurchasedAt`. Nunca `totalQuantityPurchased`, `totalSpentTaxIncl`, `productName`,
`productReference`, ni `catalogStatus` — verificado por test que confirma que ninguno de esos valores aparece en
el resultado serializado. Una fila con `catalogStatus: 'deleted_or_unavailable'` sigue produciendo ownership: el
historial es válido aunque el producto esté eliminado hoy en el catálogo de Customer Profile; la vigencia
comercial actual ya la determina el candidato que llega desde Catalog Service, no esta fila.

**`totalSpentTaxIncl` negativo aceptado (corrección de cierre).** El campo se valida (formato decimal) pero nunca
se usa ni se expone — antes de la corrección, `decimalMoneyStringSchema` rechazaba cualquier signo negativo, así
que un ajuste o crédito legítimo con valor negativo (dato real, aunque no leído por este adapter) tumbaba la
página completa vía `invalid_response_schema`, descartando ownership real por un campo que nadie usa. El regex
ahora acepta un `-` inicial opcional (`0`, `0.00`, `100`, `100.50`, `-10`, `-10.25` válidos; `NaN`, `Infinity`,
strings vacíos o con separadores ambiguos siguen rechazados). Este campo nunca se mapea a `ownership`.

## Product and variant mapping

Mapping exacto usando `createProductRuntimeIdentity` (la misma función usada en T07/T08/T09/T10/T11):

```text
String(row.productId)              -> productId
row.productAttributeId === 0       -> combinationId ausente (producto base)
row.productAttributeId > 0         -> combinationId = String(row.productAttributeId)
```

No se usa `Number(candidate.combinationId)` como fuente de comparación — la identidad candidata y la identidad
de la fila se comparan siempre como el string canónico que produce `createProductRuntimeIdentity`, nunca
convirtiendo el lado del candidato a número. Verificado por test: producto base no matchea variante, variante 10
no matchea variante 11, variante no matchea producto base, y ninguna evidencia se propaga entre identidades
distintas.

## Functional states

| Respuesta Customer Profile | Resultado del adapter | Warning T09 | `ownership` | ¿Lanza? |
|---|---|---|---|---|
| `available`, con matches | `productEvidence` con los matches | `[]` | presente en los matches | no |
| `available`, sin matches | `productEvidence: []` | `[]` (T09 deriva `NO_CUSTOMER_HISTORY`) | ausente | no |
| `customer_not_linked` | `productEvidence: []` | `[{ code: 'customer_history_not_linked' }]` | ausente | no |
| `customer_not_found` | `productEvidence: []` | `[{ code: 'customer_reference_not_found' }]` | ausente | no |

`customer_history_not_linked`/`customer_reference_not_found` son exactamente el vocabulario reservado que
CP-R1-T10B4A ya definía (`CUSTOMER_AFFINITY_RESERVED_PROVIDER_WARNING_CODES`); este adapter es el primer emisor
real. Ninguno de los dos casos lanza, degrada, ni sintetiza ownership — verificado por test tanto a nivel del
adapter como a nivel de T09 (`DefaultCustomerProductAffinityProvider`) y de extremo a extremo (T11
`personalization.applied: false` con el `reason` correspondiente, `execution.degraded: false`).

## Technical degradation

Todo lo demás lanza (`HttpCustomerAffinityEvidenceProviderError`, capturado por
`DefaultCustomerProductAffinityProvider` y envuelto como `EVIDENCE_PROVIDER_FAILED { retryable: true }`, sin
código nuevo en T09 — ver `errors.ts` de T09, sin modificar):

- `degraded` con `reason: 'prestashop_unavailable'` o `'prestashop_timeout'` (HTTP 503);
- HTTP `500`/`502`/`504` (cualquier estado no reconocido cae en el mismo `unexpected_http_status`);
- HTTP `401`/`403` (`auth_or_config_error` — Customer Profile no los usa hoy, pero el adapter los trata como
  falla técnica, nunca como evidencia vacía);
- HTTP `400` (`bad_request` — bug/config del propio adapter, nunca fabrica ownership);
- error de red, `AbortError`/timeout total, JSON inválido, payload que no valida contra los schemas Zod locales,
  o un `status` desconocido/inesperado.

Aguas arriba (T11): `execution.degraded = true`, `customerAffinity` stage `degraded`, warning público
`CUSTOMER_AFFINITY_UNAVAILABLE`, ranking comercial preservado, `ownership` ausente — comportamiento ya existente
desde T10B3C, sin cambios; verificado de extremo a extremo con el adapter real en
`tests/integration/searchProductsV2HttpCustomerAffinityWiring.test.ts`.

## Timeout

`CUSTOMER_PROFILE_TIMEOUT_MS` (default `2500`) cubre la operación lógica completa: todas las páginas, el parseo
de cada respuesta, y el mapping final. Un único `AbortController` se crea al inicio de `getEvidence()` y su
`signal` se pasa a cada `fetch`; el timer no se reinicia por página. Si el tiempo se agota, el request en curso
se aborta y el adapter lanza — T09/T11 degradan, `ownership` queda ausente, el ranking comercial se preserva. No
hay reintentos internos.

**Clasificación correcta del abort durante el parseo (corrección de cierre).** El `AbortSignal` compartido está
atado al `fetch()` que produjo el `Response`, así que abortarlo mientras el body todavía se está transmitiendo
también rechaza `response.json()` con `AbortError` — no solo el `fetch()` inicial. `readJsonBody()` comprueba
`isAbortError(error)` antes de clasificar, así que este caso se reporta como `reason: 'timeout'`, igual que un
abort durante la espera de headers; antes de la corrección, cualquier fallo de `response.json()` — incluido un
abort real — se reportaba como `reason: 'invalid_response_body'`, ocultando que la causa era un timeout.
Verificado con un servidor HTTP real (`http.createServer`) que envía headers 200 de inmediato y nunca cierra el
body (`tests/unit/httpCustomerAffinityEvidenceProvider.test.ts`, describe de paginación) — un mock de `fetch`
no puede probar esto, porque su `json()` nunca consulta el `AbortSignal` de verdad.

Validado en `config.ts` al arrancar (entero, `100 <= timeout <= 30000`), nunca por request — un valor inválido
falla el arranque de la aplicación, no una llamada individual.

## Security

Cliente HTTP: `fetch` nativo (Node 24), `AbortController`, método `GET`, `Accept: application/json`, sin body,
`redirect: 'error'` (nunca sigue una redirección silenciosamente), URL construida con la clase `URL` (nunca
concatenación de strings), query `limit`/`offset` vía `URLSearchParams`. Sin axios, sin retries, sin
credenciales inventadas (Customer Profile no tiene autenticación hoy).

Logging interno permitido (`logSuccess`/`logFailure`, vía logger inyectado): código de evento, `outcome`,
`reason` de falla, HTTP status, duración, número de páginas, número de productos históricos, número de matches.

Nunca se loguea ni se expone en errores: `masterCustomerId`, la URL completa, el response body crudo, nombre o
referencia de producto, montos, headers, o el `cause`/stack de un error dentro de un payload público —
verificado por test dedicado que serializa el error completo y confirma la ausencia de esos marcadores. Para
respuestas HTTP `401`/`403`/`400`/`5xx`, el adapter ni siquiera llama a `response.json()`: el body nunca se lee.

## Performance

Como mucho una llamada lógica al provider por request de T11 (igual que cualquier otro
`CustomerAffinityEvidenceProvider`); N llamadas HTTP físicas, una por página, hasta `hasMore=false`. T11 ya
limita candidatos a 60. Optimización mínima: `Map` de identidades candidatas, se mapean solo las filas que
coinciden, no se conserva el payload crudo más de lo necesario, duplicados se detectan globalmente con memory
footprint acotado por los guards de paginación. No se agregó cache en esta tarea.

## Configuration

```env
CUSTOMER_AFFINITY_PROVIDER_MODE=unavailable   # unavailable | empty | http (default: unavailable, sin cambios)
CUSTOMER_PROFILE_BASE_URL=http://customer-profile.internal:4020   # requerida solo si mode=http
CUSTOMER_PROFILE_TIMEOUT_MS=2500              # entero, 100-30000, default 2500
```

`CUSTOMER_PROFILE_BASE_URL`: URL absoluta http(s), sin credenciales embebidas, sin query string, sin fragment,
trailing slash normalizado. La app falla al arrancar (no por request) si `mode=http` y falta la base URL, si la
URL es inválida, si el protocolo no es http/https, si contiene credenciales, si contiene query string, si
contiene un fragment (`#...`), o si el timeout es inválido. Cuando `mode != http`, la base URL puede estar
ausente y no se instancia el adapter HTTP. No hay restricción de "no localhost" en desarrollo. El default de modo
sigue siendo `unavailable` — no se cambió.

**Fragment rechazado (corrección de cierre).** Antes de la corrección, `config.ts` rechazaba una query string
pero no un fragment, pese a que `buildPageUrl()` siempre resetea `url.hash = ''` antes de cada request — una
`CUSTOMER_PROFILE_BASE_URL` con `#fragment` pasaba el arranque en silencio en vez de fallar como sí hace la query
string, dejando pasar sin aviso un probable error de copiado/pegado en la configuración de despliegue. Corregido
con el mismo patrón que la validación de query string.

## Bootstrap

`createCustomerAffinityEvidenceProvider(mode, deps)` (nueva función exportada en `src/bootstrap.ts`) centraliza
la selección: `'empty'` -> `EmptyCustomerAffinityEvidenceProvider`, `'http'` -> `HttpCustomerAffinityEvidenceProvider`
(con `baseUrl`, `timeoutMs`, logger), cualquier otro valor (incluido el default `'unavailable'`) ->
`UnavailableCustomerAffinityEvidenceProvider`. `createRuntime()` la invoca con `config.recommendation` real; no
se creó un provider HTTP global fuera de ese wiring, ni un service locator. Ningún `fetch` ocurre durante el
arranque — el constructor del adapter solo guarda configuración.

## Backward compatibility

- `EmptyCustomerAffinityEvidenceProvider`/`UnavailableCustomerAffinityEvidenceProvider` no se modificaron; sus
  tests existentes (`tests/unit/customerAffinityEvidenceProviders.test.ts`) siguen intactos y en verde.
- El default de `CUSTOMER_AFFINITY_PROVIDER_MODE` sigue siendo `'unavailable'` — ninguna request/despliegue
  existente cambia de comportamiento sin activar `mode=http` explícitamente.
- Cuando `mode != 'http'`, no se instancia el adapter HTTP y no se realiza ningún `fetch`.
- El endpoint de SearchProducts V2, su request/response, su scoring (`customer-affinity-v2`,
  `personalized-recommendation-v2`), y el ranking no cambiaron; `ownership` sigue siendo opcional.
- No se llama a Customer Profile cuando no hay `customer` en el request, ni cuando el batch de candidatos está
  vacío (`providerCalls` sigue en `0` en ambos casos — comportamiento existente de T09, mas un guard adicional
  propio del adapter que retorna sin `fetch` si `products.length === 0`).
- No se tocaron `errors.ts` de T09, ni las decisiones de T10B4A.

## Tests

- `tests/unit/httpCustomerAffinityEvidenceProvider.test.ts` (63 tests, +10 en la corrección de cierre): identidad
  (incluye ahora el sentinel `/^0+$/` parametrizado sobre `'0'`/`'00'`/`'000'`/`'0000'`, y `'001'` aceptado y
  preservado verbatim en la URL)/forma de request, respuestas `available` (match base, match variante, no-match
  cruzado, varios candidatos, `deleted_or_unavailable`, campos no expuestos, `totalSpentTaxIncl` negativo
  aceptado sin exponerse), paginación (2/3 páginas — ahora con páginas `hasMore=true` realistas de 100 filas —,
  offsets, duplicados dentro/entre páginas, guard de páginas con filas únicas, guard de filas, timeout en primera
  y en página posterior, **timeout durante el parseo del body con servidor HTTP real** (nuevo), y los 4 casos de
  completitud de página: `hasMore=true`+`returned=0` lanza, `hasMore=true`+`returned=50/limit=100` lanza,
  `hasMore=true`+`returned=100` válido, `hasMore=false`+`returned<limit` válido, todos confirmando que no hay
  request adicional tras el error), estados funcionales (`not_linked`/`not_found`), degradación técnica (13 casos
  parametrizados: `degraded` x2, `5xx` x3, `401`/`403`/`400`, status desconocido, red, JSON inválido, schema
  inválido, status literal desconocido, más `AbortError` inmediato y estado inconsistente mid-paginación),
  seguridad e inmutabilidad (no filtra body/URL/`masterCustomerId`, no muta `customer`/`products`, no comparte
  estado de duplicados entre llamadas, resultado válido contra `customerAffinityEvidenceResultSchema`).
- `tests/unit/customerProfileConfig.test.ts` (13 tests, +1): agrega fallo al arrancar cuando la base URL contiene
  un fragment. El resto sin cambios: default `unavailable` sin URL, `mode=empty`/`unavailable` sin requerir URL,
  `mode=http` válido con normalización de trailing slash, https, fallos por URL faltante, URL inválida, protocolo
  inválido, credenciales embebidas, query string, timeout inválido (cero/negativo/decimal) y timeout fuera de
  rango.
- `tests/unit/bootstrapCustomerAffinityProvider.test.ts` (5 tests, sin cambios): selección correcta por modo,
  ausencia de `fetch` al construir el provider http, fallo defensivo si `mode=http` sin base URL.
- `tests/integration/httpCustomerAffinityEvidenceProviderWiring.test.ts` (8 tests, +2): el adapter real, envuelto
  en `DefaultCustomerProductAffinityProvider` (T09), produce ownership positivo, `PARTIAL_CUSTOMER_HISTORY`,
  `NO_CUSTOMER_HISTORY`, los dos warnings reservados, `EVIDENCE_PROVIDER_FAILED { retryable: true }` ante una
  falla técnica genérica, **y ahora también específicamente ante un timeout durante el parseo del body y ante
  una página con `hasMore=true` incompleta** (nuevos).
- `tests/integration/searchProductsV2HttpCustomerAffinityWiring.test.ts` (8 tests, +2): de extremo a extremo
  (T09 real + adapter real -> T10 real -> T11), cubre los 6 escenarios de la sección 23 de la tarea original
  (ownership positivo, parcial, historial vacío, no-link, not-found, falla técnica genérica) **más los dos
  escenarios específicos requeridos por la sección 7 de esta corrección**: timeout durante el parseo del body y
  paginación inconsistente — ambos confirmando `execution.degraded=true`, `customerAffinity` stage `degraded`,
  `CUSTOMER_AFFINITY_UNAVAILABLE`, ranking comercial intacto, y `ownership` ausente en todas las recomendaciones.

Total: 97 tests nuevos (82 de la implementación inicial + 15 de esta corrección de cierre).

## Suite completa

```text
npm run typecheck  -> sin errores.
npm run lint       -> sin errores.
npm run build      -> sin errores.
npm test (x2)      -> 52 archivos, 1670 tests, todos passed en ambas corridas
                       (1655 antes de esta corrección de cierre + 15 nuevos: 10 en el adapter,
                       1 en config, 2 en el wiring T09, 2 en el wiring T11).
```

## Documentation

- `docs/recommendation/customer-product-affinity-provider.md`: sección "Degradation" actualizada (tres modos,
  no dos); nueva sección "HTTP Evidence Adapter (CP-R1-T10B4B)"; párrafo de "Product And Variant Semantics"
  actualizado de "future provider" a implementación real; nueva sección "Explicitly Out Of Scope (CP-R1-T10B4B)";
  "Next Task" actualizada a CP-R1-T10B5.
- `docs/recommendation/search-products-v2.md`: nueva sección "Explicitly Out Of Scope (CP-R1-T10B4B)"; "Next
  Task" actualizada a CP-R1-T10B5.
- `.env.example`: `CUSTOMER_PROFILE_BASE_URL`, `CUSTOMER_PROFILE_TIMEOUT_MS` documentados, con nota de que
  Customer Profile no tiene autenticación y que `mode=http` requiere red privada/gateway protegido.
- Este documento.

## Operational activation conditions

La implementación puede fusionarse y compilar sin que `mode=http` esté activo en ningún ambiente. La activación
productiva queda condicionada, sin bloquear esta tarea, a:

- Customer Profile accesible solo por red privada o gateway protegido (no tiene autenticación propia hoy);
- cobertura real de `master_customer.prestashop_customer_id` medida — sin esa medición no se sabe qué fracción
  de clientes recibirá `customer_history_not_linked` en vez de historial real;
- URLs/config de despliegue (`CUSTOMER_PROFILE_BASE_URL` por ambiente) definidas por el equipo de
  infraestructura;
- prueba de latencia real con clientes de historial largo (muchas páginas), para calibrar
  `CUSTOMER_PROFILE_TIMEOUT_MS` en producción con datos reales en vez del default conservador.

## Explicitly out of scope

- Autenticación en Customer Profile, API key saliente ficticia.
- Endpoint batch filtrado en Customer Profile (el adapter siempre lee el historial completo del cliente y
  filtra localmente contra el batch de candidatos).
- Cache, circuit breaker, retries.
- `master_customer` population, resolución de `masterCustomerId`, `identityType`.
- CRM Customer 360, Sales Agent.
- RFM, clustering, lifecycle, category affinity, brand affinity, repeat purchase mapping, observed spend,
  interests, `preferredProducts`, `explicitRepurchaseProducts`, clasificación durable/consumable.
- Cambios a las decisiones de T10B4A (los dos warnings reservados, `personalization.reason`, deduplicación de
  warnings).
- Cambios de scoring o de versión (`customer-affinity-v2`, `personalized-recommendation-v2` intactos).

## Next task

CP-R1-T10B5 — CRM SearchProducts V2 Client and Identity Wiring.

## Confirmaciones

- No se hizo commit.
- No se hizo push.
- No se creó PR.
- No se modificó Customer Profile.
- No se tocó CRM Customer 360.
- No se implementó autenticación.
- No se agregaron retries.
- No se implementó RFM ni clustering.
