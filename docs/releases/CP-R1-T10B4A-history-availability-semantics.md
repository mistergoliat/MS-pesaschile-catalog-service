# CP-R1-T10B4A — Customer History Availability Semantics

Fecha: 2026-08-01.

Rama: `feat/cp-r1-t10b4a-history-availability-semantics`.

Base: `main` actualizado (`601b61a`, incluye CP-R1-T10B3C fusionado vía PR #7).

Estado: implementado en working tree, sin commit, sin push, sin PR.

## Resumen ejecutivo

La revisión contractual previa a T10B4 confirmó que los contratos actuales de T09 no pueden distinguir tres
hechos distintos que Customer Profile ya modela por separado: cliente inexistente, cliente existente sin vínculo
utilizable con PrestaShop, e historial consultado y confirmado vacío. Los ocho warning codes existentes, y en
particular el canal `AFFINITY_PROVIDER_WARNING` pensado para que un provider comunique algo propio, colapsan
cualquier intento de un futuro adapter de decir "no vinculado" o "no encontrado" en el mismo código genérico o en
`NO_CUSTOMER_HISTORY`.

CP-R1-T10B4A cierra esa brecha agregando dos códigos globales nuevos a T09 —
`CUSTOMER_HISTORY_NOT_LINKED` y `CUSTOMER_REFERENCE_NOT_FOUND` — mapeados uno a uno desde un vocabulario
reservado y explícito que un evidence provider puede declarar (`customer_history_not_linked`,
`customer_reference_not_found`), propagados intactos hasta T11, sin degradar la ejecución y sin afectar
`score`/`confidence`/`ranking`/`ownership`. **No implementa el adapter HTTP de Customer Profile** — solo la
semántica que ese adapter futuro (CP-R1-T10B4B) va a necesitar para reportar estos dos estados correctamente.

## Corrección de cierre (misma rama)

La auditoría final de CP-R1-T10B4A detectó un hallazgo Major: `personalization.applied` quedaba en `true` para
`CUSTOMER_HISTORY_NOT_LINKED`/`CUSTOMER_REFERENCE_NOT_FOUND` aunque ninguna afinidad real se hubiera usado —
metadata pública contractualmente falsa, idéntica en efecto numérico al caso `NO_CUSTOMER_HISTORY` que sí
reportaba `applied:false` correctamente. Se corrigió en la misma rama, sin tocar scoring, ranking, `ownership`,
versiones, ni el endpoint:

- `searchProductsV2PersonalizationSchema.reason` (T11) gana `'customer_reference_not_found'` y
  `'customer_history_not_linked'`, aditivo sobre los 3 valores existentes.
- `personalizationMetadata()` (`defaultSearchProductsV2Service.ts`) gana dos ramas nuevas, con precedencia fija:
  sin customer → afinidad degradada técnicamente → `CUSTOMER_REFERENCE_NOT_FOUND` → `CUSTOMER_HISTORY_NOT_LINKED`
  → `NO_CUSTOMER_HISTORY` → `applied:true`. T09 ya rechaza como `INVALID_PROVIDER_RESPONSE` una respuesta que
  declare ambos códigos reservados a la vez, así que el orden entre los dos pasos 3/4 es defensivo, no una
  decisión real.
- `affinityWarningCode()` en `defaultPersonalizedRecommendationService.ts` (T10) gana mapping explícito para
  ambos códigos — sin este cambio, T10 seguía re-emitiendo el hecho bajo `AFFINITY_WARNING_PROPAGATED`, que T11
  traducía a `UPSTREAM_PERSONALIZATION_WARNING`, duplicando el hecho bajo dos códigos distintos en `warnings[]`
  público. `personalizedRecommendationWarningCodeSchema` (T10) gana los mismos dos valores, aditivo — necesario
  para que el tipo/schema de T10 acepte los literales.
- `mapPersonalizationWarningCode()` (T11) gana el mismo mapping explícito para el mismo motivo, en el lado T11
  del mismo pipeline T10→T11.
- Comentarios de `CUSTOMER_AFFINITY_RESERVED_PROVIDER_WARNING_CODES` (contracts.ts) y
  `reservedProviderWarningCode()` (defaultCustomerProductAffinityProvider.ts) corregidos: decían "exact-string
  whitelist" sin calificación: en realidad el match ocurre **después** del trim compartido de
  `nonEmptyStringSchema`, así que un código reservado con espacios periféricos sí se reconoce (comportamiento
  sin cambios, solo se corrigió la documentación para que sea precisa).

La auditoría de esta corrección detectó, a su vez, que el hecho podía seguir apareciendo como **dos entradas
idénticas** del mismo código (una originada directamente en T09, otra relayada por T10) porque
`deduplicateWarnings` en T11 dedupeaba por `(source, code, product)`, y las dos fuentes (`'affinity'` y
`'personalization'`) nunca coincidían. Cerrado en la segunda corrección de cierre, ver más abajo.

## Segunda corrección de cierre (misma rama) — deduplicación pública de warnings

La auditoría de cierre siguiente evaluó explícitamente si el duplicado same-code era aceptable por ser
"preexistente" y concluyó que no: `SearchProductsV2Warning` no expone `source`, así que dos entradas con el
mismo `code` y el mismo alcance (global o el mismo producto) son indistinguibles para el consumidor — el propio
`docs/recommendation/search-products-v2.md` ya prometía "deduplicated by (code, product identity or 'global')",
una promesa que la implementación no cumplía. Se corrigió, localizado enteramente en T11:

- `warningKey()`/`deduplicateWarnings()` (`defaultSearchProductsV2Service.ts`) ya no incluyen `source` en la
  clave de deduplicación. La nueva clave es `code + (product identity o '<global>') + representación canónica
  de details` (usando `canonicalizeJson`, ya existente en `canonicalJson.ts`, para que el orden de las claves de
  `details` no afecte la comparación). `source` sigue existiendo como campo interno (se usa solo para ordenar
  las entradas que sí sobreviven, vía `sourceOrder`), pero nunca participa en si dos entradas se consideran el
  mismo hecho.
- `collectWarnings()` corrige un bug relacionado que hacía inevitable la pérdida de información al deduplicar
  por producto: los warnings por candidato de T09 (`affinity.warnings`, dentro de cada `CustomerProductAffinity`)
  y de T10 (`recommendation.warnings`, dentro de cada `PersonalizedRecommendation`) se construían **sin**
  `product`, así que un warning por producto ya se veía idéntico a uno global del mismo código, y dos productos
  distintos con el mismo código de warning ya colapsaban en una sola entrada anónima — independientemente del
  cambio de clave. Ahora ambos casos pasan `affinity.product`/`recommendation.product` (el candidato que
  efectivamente los contiene) al construir el warning, así que cada producto conserva su propia identidad y un
  warning verdaderamente global sigue siendo distinguible de uno específico de un producto.
- `searchProductsV2Internals` (export de solo-test) gana `deduplicateWarnings`, porque ningún request/response
  público puede hoy construir dos warnings con el mismo código y alcance pero `details` genuinamente distintos
  (los únicos códigos con `details` — `CATALOG_PRODUCT_MISSING` y sus 3 hermanos — se emiten como máximo una vez
  por respuesta), así que la política de `details` en la clave solo se puede probar de forma directa.

No se tocó: contratos de T09, el mapping del provider de T09, el mapping de warnings T10↔T11 agregado en la
corrección anterior, `personalizationMetadata()`, `ownership`, scoring, ranking, versiones, el endpoint, el
adapter HTTP, Customer Profile, ni CRM.

## Arquitectura preservada

T08 → T09 → T10 → T11 sin cambios de frontera. T10 (`personalized-recommendation`) se tocó únicamente para
preservar los dos códigos de warning nuevos en su propio mapping paralelo (`affinityWarningCode()` y
`personalizedRecommendationWarningCodeSchema`, ver "Corrección de cierre") — su scoring, su versión
(`personalized-recommendation-v2`), su ranking y sus reasons estructurados no cambiaron. T11 sigue leyendo
`CustomerProductAffinityResult.warnings` directamente desde T09 para el camino principal, exactamente como ya
hacía con `NO_CUSTOMER_HISTORY`/`PARTIAL_CUSTOMER_HISTORY`. `EmptyCustomerAffinityEvidenceProvider` y
`UnavailableCustomerAffinityEvidenceProvider` (`src/infrastructure/recommendation/customerAffinityEvidenceProviders.ts`)
no se modificaron — ningún adapter HTTP real existe todavía.

## Confirmed empty history

Sin cambios de comportamiento. El provider responde:

```json
{ "customer": { "customerId": "..." }, "productEvidence": [], "warnings": [] }
```

Resultado: `NO_CUSTOMER_HISTORY` global y por producto, `customerAffinity` stage `completed`,
`execution.degraded = false`, `ownership` ausente, `score: 0`, `confidence: 'none'`. Validado explícitamente por
un test nuevo (`still produces NO_CUSTOMER_HISTORY for a plain empty response without a reserved warning
(unchanged)`) que confirma que ninguno de los dos códigos nuevos aparece cuando no hay warning reservado.

## Customer history not linked

Vocabulario reservado del provider: `customer_history_not_linked` →
`CUSTOMER_AFFINITY_RESERVED_PROVIDER_WARNING_CODES.CUSTOMER_HISTORY_NOT_LINKED` (`contracts.ts`). Resultado
público: warning global `CUSTOMER_HISTORY_NOT_LINKED` — nunca por producto.

Semántica cerrada:

- el master customer existe;
- no existe vínculo utilizable con PrestaShop (o sistema comercial equivalente) para consultar historial;
- el historial no fue consultado — no es "cero compras confirmadas";
- no es una falla técnica — no se confunde con `EVIDENCE_PROVIDER_FAILED`/`CUSTOMER_AFFINITY_UNAVAILABLE`;
- no es retryable por defecto (reintentar no crea un vínculo);
- no crea `ownership` (nunca sintetiza `previouslyPurchased: false`);
- no afecta `score`, `confidence`, `signals`, `evidence`, ni ranking.

## Customer reference not found

Vocabulario reservado: `customer_reference_not_found` →
`CUSTOMER_AFFINITY_RESERVED_PROVIDER_WARNING_CODES.CUSTOMER_REFERENCE_NOT_FOUND`. Resultado público: warning
global `CUSTOMER_REFERENCE_NOT_FOUND` — nunca por producto.

Semántica cerrada:

- el identificador maestro del cliente no existe según la fuente de evidencia;
- representa una identidad no reconocida/inconsistente, no "cero compras";
- no es una falla técnica transitoria, no es retryable por defecto;
- no crea `ownership`, no afecta `score`, `confidence`, `signals`, `evidence`, ni ranking.

## Functional state versus technical degradation

Ambos códigos nuevos se producen por una llamada a `getEvidence()`/`getAffinities()` que **completa
normalmente** (sin excepción) — no son degradación. `customerAffinity` stage se mantiene `completed`,
`execution.degraded` se mantiene `false`, `execution.degradationReasons` se mantiene `[]`, y
`CUSTOMER_AFFINITY_UNAVAILABLE` nunca aparece junto a ellos. La degradación implementada en T10B3C
(`EVIDENCE_PROVIDER_FAILED`, `INVALID_PROVIDER_RESPONSE` → `CUSTOMER_AFFINITY_RETRYABLE_FAILURE` /
`CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID`, stage `degraded`, `CUSTOMER_AFFINITY_UNAVAILABLE`) sigue intacta y
sin cambios — sigue siendo la única vía para representar un timeout, un error de red, un 5xx o una respuesta
estructuralmente inválida. Ambas familias nunca se mezclan: un provider que no puede consultar su fuente lanza
una excepción; un provider que sí pudo consultar y aprendió "no vinculado"/"no encontrado" retorna un resultado
normal con uno de los dos warnings nuevos.

## Provider warning mapping

`CUSTOMER_AFFINITY_RESERVED_PROVIDER_WARNING_CODES` (`src/domain/recommendation/customer-affinity/contracts.ts`)
es la whitelist exacta contra la que se compara el `code` de cada warning del provider
(`defaultCustomerProductAffinityProvider.ts`, funciones `reservedProviderWarningCode` /
`findReservedProviderWarningCode`):

```text
'customer_history_not_linked'   -> CUSTOMER_HISTORY_NOT_LINKED   (global)
'customer_reference_not_found'  -> CUSTOMER_REFERENCE_NOT_FOUND  (global)
cualquier otro código           -> AFFINITY_PROVIDER_WARNING     (global, uno por warning no reconocido, sin cambios)
```

El match es por string exacto, no un passthrough: un provider no puede inyectar un código interno de T09
escribiéndolo — un warning de provider literalmente codificado `'NO_CUSTOMER_HISTORY'` sigue mapeando a
`AFFINITY_PROVIDER_WARNING`, nunca se cuela como código de salida real de T09 (test dedicado: `does not treat an
unrecognized warning code as reserved even when it spells a T09-internal code`).
`customerAffinityProviderWarningSchema.code` sigue siendo un string libre sin restricción de schema — la
whitelist vive únicamente en la función de mapping, así que los warnings desconocidos existentes siguen
funcionando exactamente igual que antes de esta tarea.

Un código reservado repetido (el mismo warning enviado más de una vez) colapsa en una única entrada global — no
multiplica `warningsGenerated` (test: `deduplicates a reserved warning sent more than once into a single global
entry`).

**Mutuamente excluyentes, rechazados en vez de resueltos por precedencia.** `CUSTOMER_HISTORY_NOT_LINKED` y
`CUSTOMER_REFERENCE_NOT_FOUND` describen hechos contradictorios sobre el mismo cliente (existe-pero-no-vinculado
vs. no-existe). Una respuesta del provider que declara ambos se rechaza como `INVALID_PROVIDER_RESPONSE`
(`validateProviderResponse`) en vez de elegir uno silenciosamente — no hay una precedencia documentada válida
porque no existe un escenario real donde ambos sean simultáneamente ciertos. Por la misma razón, un código
reservado junto con `productEvidence` no vacío también se rechaza como `INVALID_PROVIDER_RESPONSE`: un provider
no puede afirmar "no se pudo consultar el historial" y a la vez entregar evidencia real de producto. Ambos casos
reutilizan el código de error `INVALID_PROVIDER_RESPONSE` ya existente (documentado en
`src/domain/recommendation/customer-affinity/errors.ts`), que T11 ya trata como degradable
(`CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID`) desde CP-R1-T10B3C — no se introdujo ningún código de error
nuevo.

## Neutrality

Para ambos códigos nuevos, cada candidato del batch recibe exactamente la misma forma neutral que "Missing
Customer" (`neutralAffinity`, sin warning por producto): `score: 0`, `confidence: 'none'`, `signals: []`,
`evidence: []`, sin `ownership`. El evaluator (`DefaultCustomerAffinityEvaluator`) nunca se invoca en estos dos
estados — ni siquiera su propio camino de `NO_CUSTOMER_HISTORY` para evidencia `undefined` — por lo que ningún
candidato recibe warning por producto de ningún tipo. Ninguno de los dos códigos se asocia a un producto
específico; ambos son exclusivamente globales. `DefaultCustomerAffinityEvaluator` y
`DefaultCustomerAffinityScorer` no se modificaron.

## T11 propagation

`searchProductsV2WarningCodeSchema` (`src/application/recommendation/search-products-v2/contracts.ts`) gana
`CUSTOMER_HISTORY_NOT_LINKED` y `CUSTOMER_REFERENCE_NOT_FOUND`. `mapAffinityWarningCode`
(`defaultSearchProductsV2Service.ts`) los mapea 1:1 — a diferencia de la mayoría de los códigos de T09, nunca se
colapsan en `UPSTREAM_AFFINITY_WARNING`. Para ambos, verificado por test:

- `execution.degraded = false`;
- `execution.stages.customerAffinity = 'completed'`;
- `execution.degradationReasons = []`;
- ranking comercial preservado (mismo orden que sin degradación);
- `ownership` ausente en cada recomendación pública;
- sin `CUSTOMER_AFFINITY_UNAVAILABLE`.

No se tocó el endpoint (`POST /api/v2/recommendations/search-products`) ni ningún otro contrato de transporte.

**Corregido en esta ronda (ver "Corrección de cierre"):** `personalizationMetadata()` ahora reconoce ambos
códigos y reporta `personalization.applied: false` con el `reason` específico correspondiente — nunca
`applied: true` cuando todas las afinidades son neutrales por estos dos motivos. `affinityWarningCode()` (T10) y
`mapPersonalizationWarningCode()` (T11) preservan ambos códigos 1:1 en el camino T09→T10→T11, evitando que el
mismo hecho aparezca bajo un código genérico distinto (`AFFINITY_WARNING_PROPAGATED`/
`UPSTREAM_PERSONALIZATION_WARNING`) junto al código correcto.

## Statistics

### A nivel T09 (`CustomerProductAffinityResult.statistics`)

`productsWithEvidence` es `0` y `productsWithoutEvidence` iguala el tamaño del batch deduplicado, igual que en
historial vacío confirmado (la validación de contradicción en `validateProviderResponse` garantiza que
`productEvidence` está vacío siempre que hay un código reservado presente). `warningsGenerated` cuenta
exactamente un warning global por respuesta con estado reservado (más cualquier warning no reconocido del
provider, mapeado a `AFFINITY_PROVIDER_WARNING` como siempre) — cero warnings por producto, porque ningún
candidato recibe uno. No se alteraron las estadísticas de productos con evidencia real; los invariantes
existentes (`requestedProducts = deduplicatedProducts + duplicateProductsRemoved`,
`productsWithEvidence + productsWithoutEvidence = deduplicatedProducts`) se mantienen sin cambios. T09 nunca
relaya el mismo hecho por dos rutas dentro de sí mismo, así que esta capa nunca tuvo el problema de duplicado
same-code — ese problema solo existía una vez que T11 combinaba el resultado de T09 con el de T10 (ver abajo).

### A nivel T11 (`SearchProductsV2Result.statistics.warningsGenerated`)

T11 deduplica los warnings públicos por `code + alcance (global o identidad exacta del producto) + details
canónicos` — nunca por `source` (T09 directo vs. relayado por T10), porque `source` es un detalle interno de
construcción que `SearchProductsV2Warning` no expone. `statistics.warningsGenerated` cuenta el array `warnings[]`
**después** de esa deduplicación (`warnings.length + productWarnings`, calculado sobre el array ya deduplicado,
nunca sobre las entradas internas antes de deduplicar) — por lo tanto siempre coincide con lo que el consumidor
público puede contar por sí mismo. Verificado por test, para los mismos candidatos:

| Escenario | `warnings[]` resultante | `warningsGenerated` |
|---|---|---|
| Un warning global duplicado por origen (p. ej. `CUSTOMER_HISTORY_NOT_LINKED` relayado por T09 y T10) | 1 entrada | `1` |
| `NO_CUSTOMER_HISTORY` global + el mismo código en 3 productos distintos | 1 global + 3 por producto | `4` (no se pierde ningún producto) |
| `PARTIAL_CUSTOMER_HISTORY` en 2 productos distintos, sin global | 2 entradas, una por producto | `2` |
| `PARTIAL_CUSTOMER_HISTORY` global + el mismo código en 1 producto | 2 entradas (global y ese producto) | `2` |
| Mismo código y alcance, `details` genuinamente distintos (p. ej. `count` distinto) | 2 entradas | `2` |
| Mismo código y alcance, `details` idénticos, dos orígenes | 1 entrada | `1` |
| Mismo hecho relayado bajo dos códigos genuinamente distintos (`UPSTREAM_AFFINITY_WARNING`/`UPSTREAM_PERSONALIZATION_WARNING`, código de T09 que T10 no reconoce) | 2 entradas | `2` (correcto — códigos distintos, no un duplicado) |

No queda inflada por rutas internas de ningún tipo: la cuenta refleja exactamente el array público final.

## Security

Los dos warnings nuevos se emiten sin `details` (`warning(reservedWarningCode)` no recibe un tercer argumento).
Ninguno de los dos contiene, ni puede contener por construcción, `customerId` propio, `masterCustomerId`,
`prestashopCustomerId`, email, teléfono, RUT, URLs internas, payload crudo del provider, ni `stack`/`cause` — test
dedicado (`does not expose provider payload markers, PII, or infrastructure identifiers for a reserved
warning`) serializa el resultado completo a JSON y confirma la ausencia de esos marcadores. El código original
que el provider haya usado nunca se serializa tal cual salvo que sea exactamente uno de los dos strings
reservados, y en ese caso se traduce al código de salida de T09, no se re-expone el string del provider.

## Backward compatibility

- Ninguna request anterior cambia de comportamiento: los dos códigos nuevos solo se activan cuando un provider
  los declara explícitamente en su `warnings[]`, algo que ningún provider existente hace hoy.
- `EmptyCustomerAffinityEvidenceProvider` y `UnavailableCustomerAffinityEvidenceProvider` no se modificaron y
  siguen compilando y comportándose exactamente igual (test: comportamiento de historial vacío confirmado sin
  cambios).
- Los warnings desconocidos del provider conservan el fallback genérico a `AFFINITY_PROVIDER_WARNING`.
- `customerAffinityWarningCodeSchema` y `searchProductsV2WarningCodeSchema` son extensiones aditivas de un
  `z.enum` — ningún valor existente se removió ni renombró.
- `CUSTOMER_AFFINITY_SCORING_VERSION` (`customer-affinity-v2`) no cambió.
- `personalized-recommendation-v2` no cambió — T10 se tocó únicamente en su mapping de códigos de warning
  (`affinityWarningCode()`, `personalizedRecommendationWarningCodeSchema`), no en scoring ni en versión.
- `searchProductsV2PersonalizationSchema.reason` es una extensión aditiva del `z.enum` existente; los 3 valores
  previos (`customer_not_provided`, `customer_affinity_unavailable`, `no_customer_history`) no cambiaron de
  nombre ni de condición de activación.
- El endpoint HTTP y su contrato de transporte no cambiaron.

## Tests

Resumen (detalle completo en los archivos de test):

- `tests/unit/customerProductAffinityProvider.test.ts`: nuevo describe `DefaultCustomerProductAffinityProvider
  customer history availability (CP-R1-T10B4A)` con 16 tests — mapping de cada código reservado a un único
  warning global, ausencia de `NO_CUSTOMER_HISTORY`/`AFFINITY_PROVIDER_WARNING` junto a ellos, ausencia de
  warning por producto, neutralidad completa (`score`, `confidence`, `signals`, `evidence`, `ownership`),
  resistencia a que un código no reservado "parecido" (`'NO_CUSTOMER_HISTORY'` como string libre del provider) se
  cuele como reservado, deduplicación de un código reservado repetido, rechazo de ambos códigos simultáneos,
  rechazo de un código reservado junto con evidencia real, ausencia de `details`, estadísticas exactas,
  preservación del comportamiento de historial vacío sin warning reservado, congelamiento profundo, no mutación
  del array de warnings de entrada, y ausencia de marcadores de infraestructura/PII en la serialización.
- `tests/unit/searchProductsV2Service.test.ts`: 4 tests en el describe `SearchProducts V2 T09 behavior and
  degradation` — propagación de cada código nuevo sin degradar, preservación del ranking comercial, y ausencia de
  `ownership` en las recomendaciones públicas. Más, en la corrección de cierre, nuevo describe `SearchProducts V2
  personalization metadata (CP-R1-T10B4A)` con 8 tests: los 4 casos base (`applied:true` con afinidad real,
  `no_customer_history`, `customer_affinity_unavailable`, `customer_not_provided`) más los 2 casos nuevos
  (`customer_history_not_linked`, `customer_reference_not_found`, cada uno confirmando además ranking
  preservado, `ownership` ausente, `execution.degraded=false`, stage `completed`, `degradationReasons=[]`, sin
  `CUSTOMER_AFFINITY_UNAVAILABLE`) y 2 tests confirmando que ninguno de los dos códigos nuevos se colapsa en
  `UPSTREAM_PERSONALIZATION_WARNING`/`UPSTREAM_AFFINITY_WARNING` en ningún punto de la respuesta.
- `tests/unit/customerProductAffinityProvider.test.ts`: 3 tests nuevos en la corrección de cierre — espacios
  periféricos en un código reservado se normalizan y se reconocen, una variante en mayúsculas del código
  reservado no se reconoce (whitelist case-sensitive), y una variante con espacios internos en vez de guiones
  bajos tampoco se reconoce.
- `tests/fixtures/customerProductAffinity.ts`: `evidenceResult()` gana un segundo parámetro opcional
  `warnings` para poder construir respuestas de provider con warnings reservados sin duplicar la función.
- `tests/unit/searchProductsV2Service.test.ts` (segunda corrección de cierre, deduplicación): los 2 tests
  `does not collapse ... into a generic upstream warning` ganan una pareja `reports ... as exactly one global
  entry, not one per relay leg` que fija `result.warnings` exacto (`toEqual([{code: '...'}])`) y
  `statistics.warningsGenerated === 1`. Nuevo describe `SearchProducts V2 warning deduplication (CP-R1-T10B4A
  closure)` con 7 tests: `NO_CUSTOMER_HISTORY` global deduplicado a 1 entrada sin perder los 3 warnings por
  producto; `PARTIAL_CUSTOMER_HISTORY` global relayado por dos fuentes → 1 entrada; `PARTIAL_CUSTOMER_HISTORY`
  en 2 productos distintos → 2 entradas; `PARTIAL_CUSTOMER_HISTORY` global + 1 producto → 2 entradas; un código
  de T09 no reconocido por T10 (`AFFINITY_PROVIDER_WARNING`) sigue produciendo dos códigos públicos genuinamente
  distintos (`UPSTREAM_AFFINITY_WARNING` y `UPSTREAM_PERSONALIZATION_WARNING`), confirmando que esos no se
  fusionan; y 2 tests directos sobre `searchProductsV2Internals.deduplicateWarnings` para la política de
  `details` (idénticos deduplican, distintos se preservan ambos).

## Suite completa

```text
npm run typecheck  -> sin errores.
npm run lint       -> sin errores.
npm run build      -> sin errores.
npm test (x2)      -> 47 archivos, 1573 tests, todos passed en ambas corridas
                       (1532 antes de T10B4A + 21 de la implementación inicial + 11 de la primera corrección de
                       cierre + 9 de la segunda corrección de cierre, deduplicación).
```

## Documentación

`docs/recommendation/customer-product-affinity-provider.md`: "Missing History" aclarada para dejar explícito que
solo cubre "consultado y confirmado vacío"; nueva sección "Customer History Availability (CP-R1-T10B4A)" con
subsecciones "Confirmed Empty History", "Customer History Not Linked", "Customer Reference Not Found",
"Functional State Versus Technical Degradation", "Provider Warning Mapping", "Neutrality" y "Statistics";
"Warnings" lista los dos códigos nuevos; nueva sección "Explicitly Out Of Scope (CP-R1-T10B4A)"; "Next Task"
actualizada a CP-R1-T10B4B.

`docs/recommendation/search-products-v2.md`: "T09 Degradation" gana un párrafo "Not degradation (CP-R1-T10B4A)";
"Warnings" lista los dos códigos nuevos, confirma que `affinityWarningCode()`/`mapPersonalizationWarningCode()`
los preservan en el camino T10→T11, y (segunda corrección de cierre) reescribe el párrafo de deduplicación para
describir la clave real (`code + alcance + details canónico`, nunca `source`) en vez de solo prometerla; nueva
sección "Personalization Metadata" documenta los 5 valores de `reason` y su precedencia fija;
"Explicitly Out Of Scope (CP-R1-T10B4A)" reescrita: ya no lista la deduplicación same-code como pendiente (está
cerrada), y en su lugar aclara por qué el caso de dos *códigos distintos* (`AFFINITY_PROVIDER_WARNING` y
similares no reconocidos por T10) queda fuera de alcance a propósito; "Next Task" actualizada a CP-R1-T10B4B.

Los tres documentos declaran expresamente: `NO_CUSTOMER_HISTORY` solo representa una consulta completada sin
evidencia; ninguno de los dos códigos nuevos significa cero compras; ninguno crea `ownership` falso; ninguno
modifica ranking; ninguno es retryable por defecto; los errores técnicos siguen usando degradación sin cambios;
`warnings[]` público representa hechos únicos (deduplicados por código + alcance + details, nunca por origen
interno); el adapter HTTP de Customer Profile todavía no existe.

## Explicitly out of scope

- Customer Profile HTTP adapter, `fetch`, paginación, base URL, timeout HTTP, `CUSTOMER_AFFINITY_PROVIDER_MODE=http`, autenticación.
- Mapping del endpoint `purchased-products` (u otro) de Customer Profile hacia `CustomerProductEvidence`.
- `ownership: true` u `ownership: false` sintetizado desde cualquiera de los dos estados nuevos.
- Resolución de `masterCustomerId`, integración CRM, RFM, clustering, segmentación.
- Cambios de scoring o de versión (`customer-affinity-v2`/`personalized-recommendation-v2` intactos), nuevos
  `reasons` estructurados de recomendación (distintos de `personalization.reason`), cambios de ranking en T10.
- Extender `affinityWarningCode()` (T10) para reconocer *todos* los códigos de T09 simétricamente. Los códigos
  que T10 no reconoce hoy (`REFERENCE_TIME_UNAVAILABLE`, `INVALID_EVIDENCE_IGNORED`, `CURRENCY_MISMATCH`,
  `SPEND_PROFILE_UNAVAILABLE`, `AFFINITY_PROVIDER_WARNING`) siguen produciendo dos códigos públicos *genuinamente
  distintos* (`UPSTREAM_AFFINITY_WARNING` desde T09 directo, `UPSTREAM_PERSONALIZATION_WARNING` desde el relay
  de T10) para el mismo hecho — esto no es el bug de duplicado same-code que esta tarea cerró (esos dos códigos
  no son iguales, así que `deduplicateWarnings` correctamente no los fusiona), sino una limitación preexistente
  y más amplia que excede el alcance de esta tarea.

## Riesgos pendientes

- **Cerrado por la primera corrección de cierre:** `personalization.reason` ahora distingue
  `customer_history_not_linked`/`customer_reference_not_found` de `no_customer_history`, y
  `personalization.applied` nunca es `true` para ninguno de los dos.
- **Cerrado por la segunda corrección de cierre:** el duplicado same-code en `warnings[]` público
  (`CUSTOMER_HISTORY_NOT_LINKED`/`CUSTOMER_REFERENCE_NOT_FOUND`/`NO_CUSTOMER_HISTORY`/`PARTIAL_CUSTOMER_HISTORY`
  apareciendo dos veces por llegar tanto directo desde T09 como relayado por T10) — `warningKey()` ya no incluye
  `source`, y los warnings por candidato ahora llevan su propio `product`, así que un hecho verdaderamente único
  produce una sola entrada pública, sin perder los hechos genuinamente distintos por producto.
- El futuro adapter HTTP (CP-R1-T10B4B) es quien determinará, contra la API real de Customer Profile, si
  `customer_history_not_linked`/`customer_reference_not_found` son los únicos dos estados funcionales que
  necesita emitir, o si aparecen variantes adicionales (por ejemplo, distintos `CustomerProfileDegradedReason` de
  Customer Profile que hoy se resuelven allá como `degraded`, no como `not_linked`/`not_found`).
- Heredado, sin cambios en esta tarea: no existe adapter HTTP de Customer Profile ni modo
  `CUSTOMER_AFFINITY_PROVIDER_MODE=http`; clasificación durable/consumible sigue sin resolverse; la obligación
  contractual del evidence provider sobre exactitud de variante sigue siendo solo documentación.

## Próxima tarea

CP-R1-T10B4B — Customer Profile HTTP Evidence Adapter.

## Confirmaciones

- No se hizo commit.
- No se hizo push.
- No se creó PR.
- No se implementó el adapter HTTP de Customer Profile.
- No se agregó ningún provider HTTP ni el modo `CUSTOMER_AFFINITY_PROVIDER_MODE=http`.
- No se tocó Customer Profile.
- No se tocó CRM Customer 360.
