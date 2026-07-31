# CP-R1-T10B3C — Ownership Propagation and Explicit Repurchase

Fecha: 2026-07-31.

Rama: `feat/cp-r1-t10b3c-ownership-repurchase`.

Base: `main` actualizado (`6f6e1f4`, incluye CP-R1-T10B3B fusionado vía PR #6).

Estado: implementado en working tree, sin commit, sin push, sin PR.

## Resumen ejecutivo

CP-R1-T10B3B dejó `ProductOwnershipEvidence` correctamente neutral dentro de T09, pero sin salida pública: T10 y
T11 ni siquiera podían recibirlo. CP-R1-T10B3C implementa dos capacidades independientes, sin tocar T09:

**A. Propagación neutral de ownership** — `CustomerProductAffinity.ownership` (T09) ahora fluye,
pass-through, clonado y congelado, sin recalcularse, sin convertirse en signal/reason/score/exclusión, hasta
`PersonalizedRecommendation.ownership` (T10) y `SearchProductsV2Recommendation.ownership` (T11, respuesta
pública).

**B. Recompra explícita** — nuevo contrato `context.explicitRepurchaseProducts` (T11) →
`context.explicitRepurchaseProductIds` (T10), con su propio parámetro (`explicitRepurchaseBoost`, default
`0.15`, separado de `explicitPreferenceBoost`) y su propia razón auditable (`EXPLICIT_REPURCHASE_INTENT`),
matcheado por identidad runtime exacta (producto o variante), nunca derivado de historial.

Además, se corrigieron dos hallazgos pendientes de la auditoría CP-R1-T10B3A: `INVALID_PROVIDER_RESPONSE` ya
no bloquea T11 (degrada), y `CUSTOMER_MISMATCH` dejó de ser código muerto (queda correctamente cableado como
ruta defensiva).

## Arquitectura preservada

T08 → T09 → T10 → T11 sin cambios de frontera. **T09 no se tocó** (verificado: `git diff --stat main` no
incluye ningún archivo de `src/domain/recommendation/customer-affinity/`). SearchProducts V2 sigue siendo el
único motor de recomendación; no se propuso ni implementó un segundo motor de ranking en CRM. El historial
completo de Customer Profile sigue sin convertirse en estrategia de recomendación — la recompra explícita viene
exclusivamente de la intención declarada actual del cliente, nunca inferida desde `ownership`.

## Ownership en T10

`src/domain/recommendation/personalized-recommendation/`:

- `contracts.ts`: `personalizedRecommendationSchema` gana `ownership?: ProductOwnershipEvidence` (reexportado
  desde `customer-affinity`, no redefinido).
- `defaultPersonalizedRecommendationService.ts`: el mapeo final de `recommendations` agrega
  `...(candidate.customerAffinity?.ownership === undefined ? {} : { ownership: cloneJsonValue(...) })` — fuente
  exclusiva `CustomerProductAffinity.ownership`, clonado, y luego congelado junto con el resto del resultado
  (`deepFreeze(cloneJsonValue(recommendations))`, sin cambios). No se agregó a `signals`, no se usó en
  `buildReasons()`, no se usó en `createStatistics()`, no se usó en el comparador de ranking. Ausente cuando
  T09 no lo entrega — nunca se sintetiza `previouslyPurchased: false`.

## Ownership en T11

`src/application/recommendation/search-products-v2/`:

- `contracts.ts`: `searchProductsV2RecommendationSchema` gana `ownership?: ProductOwnershipEvidence` (mismo
  schema reexportado de `customer-affinity`, sin duplicar la definición).
- `defaultSearchProductsV2Service.ts`: `mapResult()` agrega `ownership` al construir cada recomendación
  pública, clonado igual que el resto de los campos. Ausente en `sourceProduct` (T09 nunca es consultado sobre
  el producto fuente), ausente en `excluded[]` (ese schema no tiene campo `ownership`), nunca en `warnings`
  globales, nunca altera `commercialReason` (que solo reacciona a `normalizedAffinityContribution`, sin
  cambios).

## Explicit repurchase

- **T11** (`contracts.ts`): `searchProductsV2ContextSchema` gana `explicitRepurchaseProducts` — array opcional,
  deduplicado por identidad runtime exacta (mismo criterio que `preferredProducts`/`excludedProducts`), y una
  nueva regla de `superRefine` que rechaza la request (`400 INVALID_REQUEST`) si la misma identidad aparece a
  la vez en `excludedProducts` y `explicitRepurchaseProducts`.
- **T11 → T10**: `mapPersonalizationContext()` mapea `context.explicitRepurchaseProducts` →
  `context.explicitRepurchaseProductIds` (naming real del repositorio, que ya terminaba en `Ids` para
  `preferredProductIds`/`excludedProductIds`).
- **T10** (`contracts.ts`): `personalizedRecommendationContextSchema.explicitRepurchaseProductIds`,
  `personalizedRecommendationParametersSchema.explicitRepurchaseBoost` (default `0.15`, separado de
  `explicitPreferenceBoost` default `0.1`, nunca reusado silenciosamente), reason code
  `EXPLICIT_REPURCHASE_INTENT`, y `personalizedRecommendationScoreComponentsSchema.explicitRepurchaseContribution`.

## Scoring

`defaultPersonalizedRecommendationScorer.ts`:

```text
explicitRepurchaseContribution =
  exact runtime identity match (context.explicitRepurchaseProductIds) ? explicitRepurchaseBoost : 0

rawScore =
  normalizedCommercialContribution
+ normalizedAffinityContribution
+ explicitPreferenceBoost
+ explicitRepurchaseContribution
- rejectionPenalty

finalScore = clamp(rawScore, 0, 1)
```

No se tocaron los pesos comerciales ni de afinidad existentes. Verificado por identidad exacta: recompra del
producto base no bonifica sus variantes; recompra de la variante 10 no bonifica la variante 11; la misma
identidad exacta sí aplica (tests dedicados). `effectivePersonalization` y las estadísticas
`recommendationsWithEffectivePersonalization`/`commercialFallbackRecommendations` se corrigieron para incluir
`explicitRepurchaseContribution > 0` — de lo contrario un candidato boosteado solo por recompra se contaba
incorrectamente como fallback comercial, rompiendo el invariante `efectiva + fallback = retornadas` que ya
exigía el schema. No se agregó ninguna estadística nueva; se corrigió el cálculo de las existentes.

`PERSONALIZED_RECOMMENDATION_SCORING_VERSION` sube de `personalized-recommendation-v1` a
`personalized-recommendation-v2` (fórmula cambió, cambio aditivo — a diferencia de `customer-affinity-v2`, aquí
no existe riesgo de "denominador" porque `commercialWeight + affinityWeight` ya sumaba 1 de forma independiente
y los boosts son aditivos por fuera de ese peso; verificado que ninguna combinación existente cambia de valor
cuando `explicitRepurchaseProductIds` está ausente o vacío). `customer-affinity-v2` no se tocó.

## Razones

`EXPLICIT_REPURCHASE_INTENT` se agrega a `personalizedRecommendationReasonCodeSchema` (T10) y
`searchProductsV2ReasonCodeSchema` (T11). Aparece únicamente cuando `explicitRepurchaseContribution > 0` para
esa identidad exacta. No aparece por `ownership`, `directPurchases`, `REPEAT_PURCHASE_PATTERN`, ni
`preferredProducts` por sí solos. `EXPLICIT_CONTEXT_PREFERENCE` no cambió de significado. Ambas razones pueden
coexistir (deduplicadas por código, no fusionadas) si el caller envía la misma identidad en ambos contextos —
representan señales distintas (preferencia general vs. intención de recompra actual).

## Exclusiones

`excludedProducts` conserva precedencia máxima, sin cambios de código en T10 (`isContextExcluded` sigue siendo
el primer chequeo del loop). La única adición es la validación de **contradicción en el request** (T11,
`searchProductsV2ContextSchema`): la misma identidad no puede estar simultáneamente en `excludedProducts` y
`explicitRepurchaseProducts` — se rechaza en el boundary (`400`) en vez de decidir en silencio cuál gana. El
boost de recompra nunca puede revertir una exclusión activa porque, dado el rechazo de la contradicción, ese
escenario ya no puede llegar a T10.

## Degradación

`isRetryableAffinityError` se reemplazó por `degradableAffinityErrorReason` en
`defaultSearchProductsV2Service.ts`: además de cualquier error con `retryable: true` (network/timeout,
`EVIDENCE_PROVIDER_FAILED`, ya cubierto antes), ahora también degrada `INVALID_PROVIDER_RESPONSE` — customer
mismatch reportado por el provider, productos fuera del batch, evidencia duplicada, payload corrupto. No
degrada `INVALID_CUSTOMER_REFERENCE`/`INVALID_PRODUCT_REFERENCE`/`INVALID_PARAMETERS`/`INVALID_REQUEST` de T09
(errores de que Catalog Service construyó mal su propia request a T09), ni errores de T08, ni errores de T10,
ni errores de catálogo, ni request inválido — esos siguen fallando. `cause` y el payload del provider nunca se
serializan en la respuesta; el logger interno recibe el código de error para observabilidad.

**Corrección de cierre (misma rama):** la auditoría final detectó que `execution.degradationReasons` devolvía
siempre `['CUSTOMER_AFFINITY_RETRYABLE_FAILURE']` sin importar la causa real — incluyendo los 4 nuevos casos de
`INVALID_PROVIDER_RESPONSE`, que no son reintentables. Se corrigió: `searchProductsV2DegradationCodeSchema`
ahora tiene dos valores (`CUSTOMER_AFFINITY_RETRYABLE_FAILURE`, `CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID`),
y `degradableAffinityErrorReason()` resuelve explícitamente cuál corresponde en el momento del catch —
`mapResult()` ya no infiere la razón desde el booleano `degraded`, recibe el array ya resuelto (`degradationReasons: readonly SearchProductsV2DegradationCode[]`, transportado como parámetro explícito, no
como `input.degraded ? [...] : []`). Ver "T09 Degradation" en `docs/recommendation/search-products-v2.md` para
el detalle de cuándo corresponde cada valor.

`CUSTOMER_MISMATCH`: T10 ya lanzaba este error internamente (mismatch entre `context.customer` y
`customerAffinities.customer`), pero T11 lo capturaba genéricamente como `INVALID_PERSONALIZATION_RESULT`
(422), perdiendo el código específico y dejando el mapping documentado a `409` como código muerto. Se agregó
un chequeo específico en el catch de personalización que preserva `CUSTOMER_MISMATCH` → `409`. Sigue siendo
una ruta defensiva (inalcanzable hoy vía una request validada, porque T11 deriva ambos valores del mismo
`request.customer`), pero ahora el código y la documentación coinciden, en vez de prometer un `409` que nunca
ocurre. La validación de mismatch a nivel de request (`context.customerId` vs `customer.customerId`) se
mantiene como `400 INVALID_REQUEST`, sin cambios — es la vía real por la que un mismatch se detecta hoy.

## Warnings

`collectWarnings()`: los warnings comerciales de T08 (`recommendation.warnings.map(...)`) ahora se etiquetan
con `recommendation.product` en vez de quedar anónimos — dos productos con el mismo código de warning generan
dos entradas globales distintas en vez de colapsar en una. `mapResult()`: cada recomendación pública ahora
expone sus propios warnings comerciales (`recommendation.commercialRecommendation.warnings`) en vez de
`warnings: []` fijo — esto ya estaba anticipado por el invariante del schema
(`statistics.warningsGenerated = result.warnings.length + productWarnings`), que hasta ahora se cumplía
trivialmente porque `productWarnings` siempre era 0. `statistics.warningsGenerated` se corrigió para sumar
ambos. `ALREADY_PURCHASED` (u otro código comercial) nunca excluye ni bonifica — es puramente informativo.

## Versionado

- `customer-affinity-v2`: sin cambios (T09 no se tocó).
- `personalized-recommendation-v2`: nueva, ver "Scoring".
- Endpoint HTTP: sin cambios de nombre ni de contrato de transporte (`POST /api/v2/recommendations/search-products`).
- Todos los campos nuevos son opcionales; ningún campo existente cambió de tipo o de obligatoriedad.

## Compatibilidad

- Un request sin `context.explicitRepurchaseProducts` produce el mismo resultado que antes (test dedicado:
  `keeps prior behavior identical when the request omits explicitRepurchaseProducts`).
- `searchProductsV2RequestSchema`/`searchProductsV2ResultSchema` siguen aceptando/produciendo payloads que no
  usan los campos nuevos (`.strict()` en los objetos no rechaza porque los campos son `.optional()`, no
  eliminados de otros).
- `personalized-recommendation-v1` deja de generarse (la versión sube incondicionalmente a v2), pero ningún
  consumidor depende de un valor literal de `scoringVersion` — es metadata de auditoría, no una condición de
  negocio (mismo patrón verificado en la auditoría de T10B3B para `customer-affinity-v1`).

## Seguridad

`ownership` público solo contiene `previouslyPurchased`, `exactVariantPreviouslyPurchased`, `totalOrderCount`,
`firstPurchasedAt`, `lastPurchasedAt` — mismo shape `.strict()` que T09 ya definía en CP-R1-T10B3B, reexportado
sin duplicar ni relajar. `explicitRepurchaseProducts` solo acepta `ProductReference` (`productId`,
`combinationId?`). Ningún campo nuevo expone `masterCustomerId`, `prestashopCustomerId`, nombres, correos,
teléfonos, RUT, montos, errores de provider, o URLs internas — verificado por los tests existentes de
"forbidden infrastructure markers" (sin cambios, siguen pasando) y por los nuevos tests de shape exacto de
`ownership`.

## Tests

Resumen (detalle completo en los archivos de test):

- `tests/unit/personalizedRecommendationScorer.test.ts`: 5 tests nuevos de `explicitRepurchaseContribution`
  (exacto para match, cero para no-match, independiente de `explicitPreferenceBoost`, marca
  `effectivePersonalization`), `keeps components auditable` actualizado con la clave nueva.
- `tests/unit/personalizedRecommendationService.test.ts`: describe `ownership propagation` (7 tests: ausente,
  presente, no cambia score, no cambia rank, no genera reason, clonado, frozen) y describe
  `explicit repurchase` (11 tests: producto exacto, variante exacta, base no boostea variante, variante 10 no
  boostea 11, reason condicional, valor exacto de score, clamp a 1, separado de `preferredProductIds`, nunca
  activado solo por ownership, no reusa `explicitPreferenceBoost`).
- `tests/unit/searchProductsV2Service.test.ts`: describes `ownership propagation` (6 tests), `explicit
  repurchase` (6 tests), `CUSTOMER_MISMATCH` (2 tests), `per-product commercial warnings` (5 tests),
  `backward compatibility` (3 tests), más 4 tests nuevos de degradación (`customer mismatch`, `producto fuera
  de batch`, `evidencia duplicada`, y confirmación de que un error no-degradable sigue fallando), más 6 tests
  de schema para `explicitRepurchaseProducts` (aceptación, duplicados, conflicto con `excludedProducts`,
  identidades distintas de la misma base).
- `tests/unit/personalizedRecommendationService.test.ts` y `tests/unit/searchProductsV2Service.test.ts`: 3
  tests preexistentes actualizados porque su expectativa era exactamente el comportamiento corregido (versión
  de scoring v1→v2, y el test que verificaba que `INVALID_PROVIDER_RESPONSE` fallaba en vez de degradar,
  reemplazado por dos tests que verifican la degradación correcta).

**Corrección de cierre (5 tests nuevos adicionales):**

- `tests/unit/searchProductsV2Service.test.ts`: `degradationReasons` afirmado exacto en los 5 escenarios de
  degradación (`EVIDENCE_PROVIDER_FAILED` → `CUSTOMER_AFFINITY_RETRYABLE_FAILURE`; `INVALID_PROVIDER_RESPONSE`
  en sus 3 variantes de provider + el caso estructural preexistente → `CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID`),
  más 3 tests nuevos: ranking comercial preservado en degradación retryable, y ausencia de `cause`/mensaje del
  provider en la respuesta serializada para ambos tipos de degradación.
- `tests/unit/personalizedRecommendationScorer.test.ts`: 1 test nuevo combinando `explicitRepurchaseContribution`
  (0.15) con `CATEGORY_REJECTION` (penalidad 0.25) y confirmando `rawScore`/`finalScore` exactos (0.46).
- `tests/unit/personalizedRecommendationService.test.ts`: 1 test nuevo confirmando que `PRODUCT_REJECTION`
  sigue excluyendo un candidato (`EXPLICIT_PRODUCT_REJECTION`) aunque esté presente en
  `explicitRepurchaseProductIds` — la intención de recompra no revierte un rechazo de afinidad.

## Suite completa

```text
npm run typecheck  -> sin errores.
npm run lint       -> sin errores.
npm run build      -> sin errores.
npm test           -> 47 archivos, 1532 tests, todos passed (1527 antes de esta corrección + 5 nuevos).
```

## Documentación

`docs/recommendation/personalized-recommendation-service.md`: "Scoring V1" → "Scoring V2" con la fórmula
actualizada; nuevas secciones "Ownership Propagation" y "Explicit Repurchase" (con tabla comparativa contra
`preferredProductIds`); "Structured Reasons" documenta `EXPLICIT_REPURCHASE_INTENT` y la coexistencia con
`EXPLICIT_CONTEXT_PREFERENCE`; "Statistics" documenta la corrección de los contadores; nuevas secciones
"Explicitly Out Of Scope (CP-R1-T10B3C)" y "Next Task".

`docs/recommendation/search-products-v2.md`: "T09 Degradation" reescrita para reflejar el criterio ampliado
(`INVALID_PROVIDER_RESPONSE` ya no aparece en "Non-Degradable Errors"); "HTTP Error Mapping" corregida para
que el `409` documentado coincida con el comportamiento real; nuevas secciones "Ownership", "Explicit
Repurchase" y "Product And Variant Semantics"; "Warnings" documenta la preservación por producto; nuevas
secciones "Explicitly Out Of Scope (CP-R1-T10B3C)" y "Next Task".

Ambos documentos declaran explícitamente: el historial completo sirve para segmentación/clustering/lifecycle
en Customer Profile, no define la estrategia de recomendación; la intención actual domina; la recompra
explícita nunca se infiere; SearchProducts V2 sigue siendo el motor; el adapter de Customer Profile y la
integración CRM siguen sin existir; RFM y clustering no pertenecen al runtime de Catalog Service.

## Riesgos pendientes

Cerrados por la auditoría final y esta corrección (ya no son riesgos pendientes):

- `execution.degradationReasons` etiquetaba todo tipo de degradación como `CUSTOMER_AFFINITY_RETRYABLE_FAILURE`,
  incluyendo los 4 casos de `INVALID_PROVIDER_RESPONSE` que no son reintentables — corregido (ver "Degradación").
- Cobertura de test faltante para la interacción `explicitRepurchaseProductIds` + penalidad de rechazo —
  corregido (scorer y service).
- Fixture `timeoutAffinityFailure()` sin uso — eliminado.
- `INVALID_PROVIDER_RESPONSE` sin doc-comment reservando su semántica — corregido en
  `src/domain/recommendation/customer-affinity/errors.ts`.

Heredados y no resueltos en esta tarea (fuera de alcance explícito):

- No existe adapter HTTP de Customer Profile ni modo `CUSTOMER_AFFINITY_PROVIDER_MODE=http` — `ownership` y
  `explicitRepurchaseProducts` están completamente cableados pero no tienen fuente de datos real todavía.
- Clasificación durable/consumible para `REPEAT_PURCHASE_PATTERN` sigue sin resolverse (T10B3A/T10B3B).
- La obligación contractual del evidence provider sobre exactitud de variante sigue siendo solo documentación,
  no verificable por código (T10B3B, sin cambios).
- `recentPurchaseWindowDays` en T09 sigue sin usarse (gap preexistente, no introducido ni corregido aquí).
- El mapping `CUSTOMER_MISMATCH` → `409` sigue siendo, por diseño, una ruta defensiva no ejercitable por una
  request real hasta que exista un escenario donde T10 reciba contextos de cliente genuinamente divergentes —
  no es una regresión, es la naturaleza de una validación de defensa en profundidad.
- T10 (`personalizedRecommendationContextSchema`) sigue sin validar por sí mismo la contradicción
  `excludedProductIds`/`explicitRepurchaseProductIds` — hoy es inofensivo porque T11 la bloquea antes de
  invocar T10 y porque la exclusión siempre gana determinísticamente si igual se invocara sin esa guarda
  (mismo patrón preexistente que `preferredProductIds`/`excludedProductIds`); no se corrigió porque la
  auditoría lo calificó como informativo, no como defecto.

## Próxima tarea

CP-R1-T10B4 — Customer Profile Evidence Adapter.

## Confirmaciones

- No se hizo commit.
- No se hizo push.
- No se creó PR.
- No se implementó el adapter HTTP de Customer Profile.
- No se agregó ningún provider HTTP ni el modo `CUSTOMER_AFFINITY_PROVIDER_MODE=http`.
- No se tocó CRM Customer 360.
- No se implementó RFM ni clustering.
