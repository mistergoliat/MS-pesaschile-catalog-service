# CP-R1-T10B3B — Neutral Ownership Contracts

Fecha: 2026-07-31.

Rama: `feat/cp-r1-t10b3b-neutral-ownership`.

Base: `main` (`f1de2eca9d788de7f87cb6624df6ab22f`, actualizado con `origin/main` al iniciar).

Estado: implementado en working tree, sin commit, sin push, sin PR.

## Convención de este documento

El repositorio no tenía `docs/releases/` antes de esta tarea. No existe tampoco una convención previa de "notas
de tarea de implementación" distinta de `docs/audits/CP-R1-T##-slug.md` (que es para auditorías read-only). Se
crea `docs/releases/` reutilizando el mismo esquema de nombre (`CP-R1-T##-slug.md`) porque es la convención real
más cercana ya establecida en el repositorio, y porque el prompt de la tarea pedía explícitamente seguir la
convención real si `docs/releases` no existía.

## Resumen ejecutivo

CP-R1-T10B3A (auditoría previa) concluyó `DESIGN_CHANGES_REQUIRED`: `DIRECT_PRODUCT_PURCHASE` en T09 Customer
Product Affinity se comportaba como una señal positiva ponderada, de forma que una compra histórica podía subir
`affinityScore`, y por lo tanto `personalizedScore` en T10, y por lo tanto el ranking del mismo producto que el
cliente ya compró. Esto violaba la política aprobada.

CP-R1-T10B3B corrige esa semántica dentro de T09:

- se agrega `ProductOwnershipEvidence`, un hecho neutral, estructural, separado de `signals`/`score`/`confidence`;
- `DIRECT_PRODUCT_PURCHASE` deja de contribuir a `score` y a `confidence` (se mantiene en el enum como código
  deprecado, no se elimina, para no romper compatibilidad de tipos/serialización);
- `REPEAT_PURCHASE_PATTERN` ahora exige `context.referenceTime` y `lastPurchasedAt` dentro de una ventana
  (`repeatPurchaseWindowDays`, default 365, documentado);
- la versión de scoring sube de `customer-affinity-v1` a `customer-affinity-v2`.

El criterio de cierre pedido por la tarea se cumple: una evidencia de "el cliente compró previamente el
producto" produce exactamente `ownership.previouslyPurchased = true`, `score = 0`, `confidence = 'none'`,
`signals = []`, y no cambia el ranking. Esto está probado en
`tests/unit/customerProductAffinityProvider.test.ts` (test `derives ownership from legacy direct purchases
without touching score or confidence`).

## Corrección post-auditoría (misma tarea, misma rama)

Una auditoría posterior (`CP-R1-T10B3B — Auditoría`, mismo día) encontró tres defectos reales en la primera
entrega, confirmados por ejecución directa del código, no solo por lectura, y los corrigió en esta misma rama
antes de considerarse cerrada:

1. **Escala del score no preservada.** Al retirar `directProductPurchaseWeight` de `maximumPositiveWeight`, el
   denominador bajó de `1.0` (v1) a `0.8`, inflando en 25% relativo el score de toda señal que no fuera compra
   directa (`CATEGORY_PURCHASE`, `BRAND_PURCHASE`, `RECENT_PRODUCT_INTEREST`, etc.), sin que ningún test lo
   detectara (solo había `toBeGreaterThan(0)`). **Corregido**: se agrega una reserva fija y documentada,
   `CUSTOMER_AFFINITY_V2_RESERVED_DIRECT_PURCHASE_WEIGHT = 0.2`, de forma que el denominador con parámetros por
   defecto vuelve a ser `1.0` exacto. El techo efectivo alcanzable hoy por las 7 señales restantes queda en
   `0.80` — es una decisión de producto explícita, no un error: se prioriza no alterar los rankings existentes
   por sobre usar el rango completo `0..1` con el set de señales actual.
2. **`directProductPurchaseWeight` no era realmente compatible hacia atrás.** Se había eliminado del schema
   `.strict()` en vez de mantenerlo como campo aceptado e ignorado; cualquier caller que enviara parámetros con
   la forma v1 completa fallaba con `unrecognized_keys`. **Corregido**: el campo vuelve a `contracts.ts` como
   `nonNegativeNumberSchema.optional()`, deprecado, validado (rechaza negativos), nunca leído por el scorer, y
   no materializado en `DEFAULT_CUSTOMER_AFFINITY_PARAMETERS`.
3. **Contradicción `ownership` vs. `directPurchases` legado se resolvía en silencio.** `ownership.previouslyPurchased: false` junto con `directPurchases` no vacío no generaba ningún warning, incumpliendo el requisito original de "no permitir que contradicciones se fusionen silenciosamente". **Corregido**: se agrega detección explícita en el evaluador; la precedencia (`ownership` explícito gana) no cambia, pero ahora se emite `INVALID_EVIDENCE_IGNORED` con `details: { field: 'directPurchases', reason: 'contradicts_explicit_ownership' }`.

Un cuarto punto (obligación contractual del evidence provider sobre exactitud de variante) era una brecha de
documentación, no de lógica — la garantía estructural de aislamiento por identidad ya era correcta y está
verificada por tests nuevos; se corrigió únicamente la documentación (ver "Documentación" más abajo).

Los detalles completos de cada hallazgo (archivo, línea, evidencia de ejecución) están en el reporte de la
auditoría, no se duplican aquí. El resto de este documento ya refleja el estado corregido.

## Alcance respetado

Todo el trabajo de negocio queda dentro de T09 (`src/domain/recommendation/customer-affinity/`). Los únicos
archivos fuera de T09 modificados son dos literales de compatibilidad (ver "Archivos modificados"), ninguno
cambia contrato público de T10 ni de T11. No se implementó: propagación pública de `ownership` por T10/T11,
`explicitRepurchaseProducts`, `EXPLICIT_REPURCHASE_INTENT`, boost de recompra, provider HTTP de Customer
Profile, integración CRM/Sales Agent, resolución de `masterCustomerId`, clasificación durable/consumible,
compatibilidad técnica real, ni un nuevo motor de ranking.

## Cambios implementados

### Contratos (`src/domain/recommendation/customer-affinity/contracts.ts`)

- `CUSTOMER_AFFINITY_SCORING_VERSION`: `'customer-affinity-v1'` → `'customer-affinity-v2'`.
- Nuevo `productOwnershipEvidenceSchema` / tipo `ProductOwnershipEvidence`: `previouslyPurchased` y
  `exactVariantPreviouslyPurchased` obligatorios (booleanos), `totalOrderCount` entero no negativo opcional,
  `firstPurchasedAt`/`lastPurchasedAt` ISO-8601 opcionales, `.strict()` (sin campos adicionales), con
  `superRefine` que exige `previouslyPurchased` cuando `exactVariantPreviouslyPurchased` es `true`, y que
  `firstPurchasedAt <= lastPurchasedAt` cuando ambos existen.
- `customerProductEvidenceSchema` gana `ownership?: ProductOwnershipEvidence` (input, lo puede entregar el
  provider). `directPurchases` se documenta como deprecado, se conserva sin cambios de forma.
- `customerProductAffinitySchema` gana `ownership?: ProductOwnershipEvidence` (output).
- `customerAffinityParametersSchema`: `directProductPurchaseWeight` se conserva como
  `nonNegativeNumberSchema.optional()` — deprecado, aceptado por compatibilidad con parámetros v1-shaped,
  validado (rechaza negativos), **nunca leído** por el scorer (ni para `score`, ni para el denominador, ni para
  `confidence`); no se agrega a `DEFAULT_CUSTOMER_AFFINITY_PARAMETERS`. Se agrega
  `repeatPurchaseWindowDays: positiveNumberSchema`, default `365`.
- `CustomerAffinityEvaluation` (tipo interno evaluador→scorer) gana `ownership?: ProductOwnershipEvidence`.
- `DIRECT_PRODUCT_PURCHASE` se mantiene en `customerAffinitySignalCodeSchema`, documentado como deprecado desde
  v2, para no romper serialización/compatibilidad de tipos existentes.

### Evaluator (`defaultCustomerAffinityEvaluator.ts`)

- Ya no genera señal ni resumen de evidencia `DIRECT_PRODUCT_PURCHASE` desde `directPurchases`.
- Nueva función `deriveOwnership(product, item)`: si `item.ownership` viene explícito del provider, se usa tal
  cual; si no, y `directPurchases` tiene al menos una entrada, se deriva `previouslyPurchased = true`,
  `exactVariantPreviouslyPurchased = product.combinationId !== undefined` (usando la identidad del candidato,
  no la del payload de evidencia, porque el provider ya garantiza que coinciden por identidad exacta antes de
  llamar al evaluador), `totalOrderCount` (suma de counts) y `firstPurchasedAt`/`lastPurchasedAt` (mínimo/máximo
  `occurredAt`). Si no hay evidencia de ningún tipo, `ownership` queda ausente (nunca se inventa).
- `REPEAT_PURCHASE_PATTERN` ahora requiere, además de `purchaseCount >= 2`: `context.referenceTime` presente
  (si falta, se emite el warning existente `REFERENCE_TIME_UNAVAILABLE` con
  `details.signal = 'REPEAT_PURCHASE_PATTERN'`, mismo patrón que `RECENT_PRODUCT_INTEREST`) y `lastPurchasedAt`
  dentro de `repeatPurchaseWindowDays` de `referenceTime` (límite inclusive, mismo helper `inWindow` ya usado
  para intereses/rechazos). Si falta `lastPurchasedAt` o cae fuera de ventana: neutral, sin señal, sin warning.
- Nueva detección de contradicción: si `item.ownership?.previouslyPurchased === false` y la suma de counts de
  `item.directPurchases` es mayor a 0, se agrega un warning `INVALID_EVIDENCE_IGNORED` con
  `details: { field: 'directPurchases', reason: 'contradicts_explicit_ownership' }`. La precedencia no cambia
  (`ownership` explícito siempre gana), solo se hace visible la contradicción. No se duplica el warning por
  múltiples entradas de `directPurchases` (una sola verificación agregada, no por entrada).

### Scorer (`defaultCustomerAffinityScorer.ts`)

- La fórmula de `positive` ya no tiene término para `DIRECT_PRODUCT_PURCHASE`.
- `maximumPositiveWeight` suma los 7 pesos configurables **más una constante fija documentada**,
  `CUSTOMER_AFFINITY_V2_RESERVED_DIRECT_PURCHASE_WEIGHT = 0.2` — no derivada de `parameters`, no configurable.
  Con los valores por defecto (que no cambiaron), el denominador vuelve a ser `1.0` exacto, igual que v1; el
  techo alcanzable hoy por las 7 señales restantes es `0.80`.
- Endurecimiento adicional no exigido explícitamente por la tarea pero necesario para el criterio de cierre:
  `distinctSignalTypes` (usado por `confidence`) ahora excluye explícitamente `DIRECT_PRODUCT_PURCHASE` de la
  cuenta, de forma que ni siquiera un evaluador alternativo que todavía emitiera esa señal podría subir la
  confianza a través de ella.

### Provider (`defaultCustomerProductAffinityProvider.ts`)

- Propaga `ownership` desde `evaluation.ownership` hacia el resultado, clonado (`cloneJsonValue`) y congelado
  (`deepFreeze`) igual que `signals`/`evidence`/`warnings`; ausente cuando `evaluation.ownership` es `undefined`.
- `neutralAffinity(...)` usa `CUSTOMER_AFFINITY_SCORING_VERSION` en vez del literal `'customer-affinity-v1'`.

### Providers stub (`src/infrastructure/recommendation/customerAffinityEvidenceProviders.ts`)

- Sin cambios de código. Se verificó y se agregó test dedicado
  (`tests/unit/customerAffinityEvidenceProviders.test.ts`): `EmptyCustomerAffinityEvidenceProvider` no inventa
  `ownership` (`productEvidence: []`); `UnavailableCustomerAffinityEvidenceProvider` conserva el error
  retryable existente.

### Fuera de T09 (documentado explícitamente, mínimo e indispensable)

- `src/application/recommendation/search-products-v2/defaultSearchProductsV2Service.ts`:
  `createNeutralCustomerAffinityResult` usaba el literal `'customer-affinity-v1'` para el `scoringVersion` de
  las afinidades neutrales que T11 fabrica cuando no hay cliente o cuando T09 se degrada. Se cambió para
  importar y usar `CUSTOMER_AFFINITY_SCORING_VERSION`. No es un cambio de contrato público (T11 no expone
  `scoringVersion` en su respuesta HTTP) ni estaba cubierto por ningún test que fijara el valor `v1`; se hizo
  para no dejar una inconsistencia de versión entre resultados reales y neutrales dentro del mismo sistema.
  No se tocó ninguna otra lógica de T11 (mapeo, exclusiones, warnings, controller, rutas).
- `tests/fixtures/customerProductAffinity.ts` (`customAffinityParameters`): usaba `directProductPurchaseWeight`,
  campo que ya no existe en el schema; se reemplazó por `categoryPurchaseWeight` para mantener el mismo
  propósito del fixture (parámetros custom con dos pesos distintos del default) sin fallar la validación
  `.strict()`.

## Archivos modificados

```text
src/domain/recommendation/customer-affinity/contracts.ts
src/domain/recommendation/customer-affinity/defaultCustomerAffinityEvaluator.ts
src/domain/recommendation/customer-affinity/defaultCustomerAffinityScorer.ts
src/domain/recommendation/customer-affinity/defaultCustomerProductAffinityProvider.ts
src/application/recommendation/search-products-v2/defaultSearchProductsV2Service.ts   (fuera de T09, documentado arriba)
tests/fixtures/customerProductAffinity.ts
tests/fixtures/personalizedRecommendation.ts   (literal de versión cosmético, corrección auditoría punto 6)
tests/unit/customerAffinityEvaluator.test.ts
tests/unit/customerAffinityScorer.test.ts
tests/unit/customerProductAffinityProvider.test.ts
tests/unit/customerAffinityEvidenceProviders.test.ts   (nuevo)
docs/recommendation/customer-product-affinity-provider.md
docs/releases/CP-R1-T10B3B-neutral-ownership-contracts.md   (nuevo)
```

No se modificaron: `src/infrastructure/recommendation/customerAffinityEvidenceProviders.ts`,
`src/domain/recommendation/personalized-recommendation/**`,
`src/application/recommendation/search-products-v2/contracts.ts`,
`src/interfaces/http/**`, `src/bootstrap.ts`, `src/shared/config.ts`, `src/recommendationRuntime.ts`, ni
ningún archivo de CRM/Customer Profile/SQL/Redis/rutas HTTP.

## Tests

Actualizados/agregados en T09:

- `tests/unit/customerAffinityEvaluator.test.ts`: schema de `productOwnershipEvidenceSchema` (8 casos), no
  emisión de `DIRECT_PRODUCT_PURCHASE`, derivación de `ownership` (producto base vs. variante exacta, conteo,
  primera/última compra, precedencia de `ownership` explícito sobre `directPurchases`), ventana temporal de
  `REPEAT_PURCHASE_PATTERN` (falta de `lastPurchasedAt`, falta de `referenceTime`, dentro/fuera de ventana,
  borde exacto inclusive, un segundo fuera del borde, timestamp futuro), y que el resto de señales
  (`CATEGORY_PURCHASE`, `BRAND_PURCHASE`, intereses, rechazos, `OWNED_COMPATIBLE_PRODUCT`, `OBSERVED_SPEND_FIT`)
  siguen funcionando igual.
- `tests/unit/customerAffinityScorer.test.ts`: `DIRECT_PRODUCT_PURCHASE` no aporta score ni cambia el score de
  otra señal, no existe `directProductPurchaseWeight` en los defaults, default de `repeatPurchaseWindowDays`,
  `DIRECT_PRODUCT_PURCHASE` no cuenta para diversidad de señales (confidence), `scoringVersion` es
  `customer-affinity-v2`.
- `tests/unit/customerProductAffinityProvider.test.ts`: una y tres compras legacy no generan score ni señal ni
  confianza; `ownership` se deriva sin tocar score/confidence; agregar `directPurchases` encima de señales
  reales no cambia la confianza resultante; `scoringVersion` es v2; resúmenes de evidencia ya no incluyen
  `DIRECT_PRODUCT_PURCHASE`; estadística `positiveSignalsGenerated` no cuenta compras legacy;
  congelamiento profundo de `ownership`; no fuga de referencias mutables a través de `ownership` (se muta el
  objeto original después de la llamada y se confirma que el resultado no cambia).
- `tests/unit/customerAffinityEvidenceProviders.test.ts` (nuevo): `Empty` no inventa `ownership`;
  `Unavailable` mantiene el error retryable.

Agregados en la corrección post-auditoría:

- `tests/unit/customerAffinityScorer.test.ts`: valores exactos de score para cada señal restante a strength 1
  (0.10/0.05/0.25/0.10/0.15/0.10/0.05), combinación completa → 0.80, clamp superior aún alcanzable como red de
  seguridad, compatibilidad del parámetro legacy (v1-shaped aceptado, v2 sin el campo aceptado, negativo
  rechazado, valor entre 0 y 1 no cambia el score).
- `tests/unit/customerAffinityEvaluator.test.ts`: los 4 casos de contradicción/no-contradicción
  `ownership`/`directPurchases` (contradictorio con warning, sin duplicar, determinístico; `previouslyPurchased:
  true` con `directPurchases` vacío o presente, sin warning; ausencia de `ownership` deriva sin contradicción
  posible).
- `tests/unit/customerProductAffinityProvider.test.ts`: aislamiento de identidad por variante — evidencia base
  no se aplica a un candidato variante en el mismo batch, evidencia de variante "10" no se aplica a variante
  "11" en el mismo batch, `exactVariantPreviouslyPurchased=true` solo cuando la evidencia está matcheada
  exactamente a esa variante.

Criterio de cierre verificado explícitamente por
`customerProductAffinityProvider.test.ts > derives ownership from legacy direct purchases without touching
score or confidence`.

## Validación ejecutada (post-corrección)

```text
npx vitest run --config vitest.config.ts tests/unit/customerAffinityEvaluator.test.ts tests/unit/customerAffinityScorer.test.ts tests/unit/customerProductAffinityProvider.test.ts tests/unit/customerAffinityEvidenceProviders.test.ts
  -> 4 test files, 171 tests, todos passed (148 antes de la corrección + 23 tests nuevos).

npm run typecheck   -> sin errores.
npm run lint        -> sin errores.
npm run build       -> sin errores.
npm test (suite completa) -> 47 archivos, 1474 tests, todos passed (1451 antes + 23 nuevos).
npm test (segunda corrida, verificación de estabilidad) -> 47 archivos, 1474 tests, todos passed, sin timeouts.
```

Sin `.only`/`.skip`/`.todo` en los archivos de test tocados. `vitest.config.ts` no define `retries`.

## Riesgos y deuda conocida

Resueltos en la corrección post-auditoría (ver arriba): escala del score, compatibilidad de
`directProductPurchaseWeight`, silencio ante contradicción `ownership`/`directPurchases`, documentación de la
obligación contractual del provider sobre exactitud de variante.

Heredados de CP-R1-T10B3A, deliberadamente no resueltos en T10B3B (fuera de alcance):

- `INVALID_PROVIDER_RESPONSE` (evidencia estructuralmente inválida) sigue sin ser `retryable`, por lo que T11
  sigue bloqueando la respuesta completa ante ese caso en vez de degradar. No se toca en esta tarea (fuera de
  T09 y del alcance explícito).
- El interruptor `excludePreviouslyPurchasedProducts` de T08 (relationship-engine/recommendation) sigue
  existiendo, apagado por default, sin usar (T11 nunca puebla `alreadyPurchasedProducts`). Riesgo latente de
  exclusión automática global si alguien lo activa; no se toca aquí.
- `CUSTOMER_MISMATCH` en `SearchProductsV2Error` sigue siendo código muerto (el mismatch real se captura como
  `INVALID_REQUEST`/400 en el schema de T11); no se toca aquí.
- `recentPurchaseWindowDays` en `customerAffinityParametersSchema`/`DEFAULT_CUSTOMER_AFFINITY_PARAMETERS` sigue
  sin usarse en ningún cálculo (gap preexistente, detectado durante esta tarea, no introducido por ella; se deja
  documentado aquí en vez de tocarlo, para no ampliar el alcance de T10B3B).
- Clasificación durable/consumible sigue sin resolverse; `repeatPurchaseWindowDays` reduce el riesgo del Caso B
  de la auditoría pero no lo cierra.
- La garantía de exactitud de variante sigue siendo estructural (aislamiento por identidad, verificado por
  tests), no semántica: T09 no puede verificar que un evidence provider real etiquete correctamente sus datos
  por variante. Ahora es una obligación contractual explícita en la documentación, pero su cumplimiento depende
  del futuro adapter (T10B4), no de código en este repositorio.

## Próxima tarea

CP-R1-T10B3C — Ownership Propagation and Explicit Repurchase.

## Confirmaciones

- No se hizo commit.
- No se hizo push.
- No se creó PR.
- No se implementó el adapter HTTP de Customer Profile.
- No se agregó ningún provider HTTP ni el modo `CUSTOMER_AFFINITY_PROVIDER_MODE=http`.
- No se tocó CRM Customer 360.
- No se agregó recompra explícita (`explicitRepurchaseProducts`, `EXPLICIT_REPURCHASE_INTENT`) todavía.
