# search-products-v2

## Proposito

`search-products-v2` define la frontera publica agent-facing del futuro Product Recommendation Service de PesasChile.

El Sales Agent consumira:

```text
SearchProductsInput -> Product Recommendation Service -> SearchProductsResult
```

El agente no debe conocer contratos internos del Product Relationship Engine, snapshots, publicaciones, metricas internas, persistencia analitica ni detalles de hidratacion.

Esta tarea solo congela contratos, fixtures e invariantes. No crea endpoint, runtime, bootstrap, ranking, persistencia, cliente nuevo ni integracion CRM.

## Ubicacion

Los schemas Zod y tipos inferidos viven en:

```text
src/domain/recommendation/contracts.ts
```

Los contratos actuales de `/v1` siguen separados en:

```text
src/shared/contracts.ts
```

## Input

`SearchProductsInput` admite:

- `query`: texto libre normalizado, no vacio si existe.
- `need`: necesidad estructurada opcional.
- `sourceProducts`: productos fuente opcionales.
- `budget`: unica fuente de verdad para presupuesto.
- `constraints`: restricciones sin campo dedicado.
- `options`: limite, stock, tipos de expansion y nivel de evidencia.
- `commercialContext`: identificadores tecnicos para resolucion comercial.

`options.limit` acepta enteros entre `1` y `20` en esta version contractual.

Regla minima de intencion:

```text
query no vacio
o need con al menos una senal util
o sourceProducts no vacio
```

Una request completamente vacia es invalida.

## Presupuesto

El presupuesto se expresa solo en `budget`; no se duplica en `constraints`.

`BudgetScope`:

- `per_candidate`: cada candidato se evalua individualmente contra el rango.
- `total_solution`: el presupuesto aplica a la solucion completa recomendada. El `budgetFit` individual puede no bastar para decidir cumplimiento total.
- `additional_spend`: el presupuesto aplica al gasto adicional respecto de un producto base o ya seleccionado.

`budget.required = true` significa que exceder presupuesto invalida al candidato o solucion futura.

`budget.required = false` permite candidatos sobre presupuesto, pero deben reportarse como `budgetFit: "over"` y con limitacion correspondiente.

## Moneda

El contrato puede contener:

```text
budget.currency
commercialContext.currencyId
```

Semantica:

- `budget.currency`: moneda comercial esperada para evaluar presupuesto y respuesta.
- `commercialContext.currencyId`: identificador tecnico de PrestaShop para resolver precio.

No hay precedencia silenciosa. En runtime futuro, si ambos estan presentes y representan monedas distintas, el adapter debe rechazar la request. Esta tarea no implementa el mapping `currencyId -> currency`.

## Identidad Del Cliente

`customerId: 0` no es un sentinel contractual valido.

Si no hay cliente identificado, `customerId` se omite. Los identificadores tecnicos, si existen, deben ser enteros positivos:

- `customerId`
- `customerGroupId`
- `currencyId`
- `countryId`
- `quantity`

## Constraints

`ConstraintCode` contiene solo restricciones sin campo dedicado:

- `BRAND`
- `DIMENSIONS`
- `WEIGHT_CAPACITY`
- `POWER_REQUIREMENT`
- `TECHNICAL_COMPATIBILITY`
- `DELIVERY_LOCATION`

No incluye presupuesto, stock, categoria, tipo de producto, caso de uso ni errores tecnicos.

Cada `ConstraintCode` puede aparecer como maximo una vez por request. Si se necesita expresar varios valores de la misma restriccion, el request debe usar un unico constraint con `value` como `string[]` cuando aplique.

Campos dedicados:

- categoria: `need.requestedCategory`
- tipo de producto: `need.requestedProductTypes`
- caso de uso: `need.useCase`
- presupuesto: `budget`
- stock: `options.includeOutOfStock`

## evidenceLevel

`EvidenceLevel`:

- `none`
- `summary`
- `full`

`none` debe omitir `scoreBreakdown`, `relationship.links`, metricas relacionales y ventanas detalladas. Puede omitir `relationship`.

`summary` permite evidencia resumida por relacion: `sourceProductId`, `relationshipType`, `reliability` y `aggregateReliability`. Debe omitir evidencia cruda detallada, metricas completas y ventanas temporales por evidencia.

`full` incluye `scoreBreakdown`, links completos, evidencia discriminada, metricas, rule IDs, ventanas temporales y `aggregateReliability`.

El schema de output usa una estructura comun con campos opcionales. La validacion cruzada `input.options.evidenceLevel` contra el output pertenece a una futura prueba de conformidad del servicio.

## Relaciones

`RelationshipEvidence` es una union discriminada por `kind`:

- `co_occurrence`: `jointCount`, `support`, `confidence`, `lift`
- `transition`: `transitionCount`, `transitionProbability`, `medianLagDays`
- `rule`: `ruleId`, `ruleVersion`

Compatibilidad obligatoria:

```text
same_cart, same_order, customer_history -> co_occurrence
next_purchase -> transition
technical_compatibility, manual -> rule
```

El contrato rechaza combinaciones incompatibles mediante `superRefine`.

## Output

`SearchProductsResult` contiene:

- `candidates`
- `resultQuality`
- `appliedConstraints`
- `relaxedConstraints`
- `unsupportedConstraints`
- `rankingVersion`
- `dataWindow`
- `provenance`

`SearchProductCandidate` contiene identidad, rank, score, retrieval, producto hidratado, relacion opcional, clasificacion comercial estructurada, `budgetFit` y limitaciones.

El score es normalizado de 0 a 1. No representa probabilidad y solo es comparable dentro del mismo request y `rankingVersion`.

Si `relationship` esta presente en un candidato, debe contener al menos un link. Un candidato sin evidencia relacional debe omitir `relationship`.

## resultQuality

`high`: existe al menos un candidato utilizable que cumple condiciones obligatorias, tiene datos comerciales suficientes, no presenta limitaciones criticas y posee evidencia o coincidencia fuerte.

`medium`: existen candidatos utilizables con cumplimiento parcial, evidencia moderada, preferencias no obligatorias relajadas o faltantes secundarios no criticos.

`low`: solo hay candidatos debiles o amplios, con evidencia insuficiente, varias limitaciones, precio/stock desconocidos, restricciones no soportadas o degradacion importante.

`none`: no existe ningun candidato utilizable.

Invariante obligatoria:

```text
resultQuality = "none" <-> candidates.length = 0
```

Cero resultados no es error HTTP.

## Errores

`SearchProductsErrorResponse`:

```text
error.code
error.message
error.retryable
error.correlationId
error.details?
```

`details` debe ser JSON serializable. No debe contener `Error`, funciones, valores no serializables, secretos, SQL ni stack traces.

Mapping HTTP documentado:

- `400`: `INVALID_REQUEST`, `INVALID_CONSTRAINT`, `UNSUPPORTED_CURRENCY`
- `401 / 403`: `UNAUTHORIZED`
- `429`: `RATE_LIMITED`
- `502 / 503`: `CATALOG_UNAVAILABLE`, `RELATIONSHIP_DATA_UNAVAILABLE`, `PRICE_RESOLUTION_FAILED`
- `504`: timeout o dependencia no disponible, usando el codigo de dependencia correspondiente
- `500`: `INTERNAL_ERROR`
- `409 / 422`: `CONTRACT_INCOMPATIBLE`, si se justifica posteriormente

Esta tarea no crea handlers ni rutas.

## Invariantes Principales

Input:

- request no vacia
- strings no vacios
- arrays deduplicados
- `sourceProducts` unico por `productId + combinationId`
- montos finitos y no negativos
- `minAmount <= maxAmount`
- IDs tecnicos enteros positivos
- constraints sin duplicados contradictorios

Candidate:

- `rank` entero positivo
- `score` entre 0 y 1
- breakdown entre 0 y 1 o null
- reliability entre 0 y 1
- relationship presente con al menos un link
- amounts finitos y no negativos
- `secondaryCandidateTypes` no repite `primaryCandidateType`
- reason codes, limitations y senales deduplicadas

Result:

- ranks unicos, contiguos desde 1 y ordenados
- candidatos unicos por `productId + combinationId`
- quality `none` si y solo si no hay candidatos
- ventanas ISO-8601 validas con `from <= to`; los fixtures usan instantes UTC serializables con `toISOString()`
- constraints de salida deduplicadas y sin solaparse entre estados

Relationship:

- evidencia compatible con relationship type
- counts enteros no negativos
- confidence y transition probability entre 0 y 1
- lift finito no negativo
- rule IDs no vacios

## Compatibilidad

No se modifica:

- `/v1/products/search`
- `/v1/products/:productId`
- `/v1/products/batch`
- `src/shared/contracts.ts`
- `CatalogApplicationService`
- cliente TypeScript actual
- auth
- cache
- bootstrap
- runtime
- Swagger runtime
- providers
- repositorios
- base de datos

## Ejemplos

Request minima:

```json
{
  "query": "disco bumper"
}
```

Resultado vacio:

```json
{
  "candidates": [],
  "resultQuality": "none",
  "appliedConstraints": [],
  "relaxedConstraints": [],
  "unsupportedConstraints": [],
  "rankingVersion": "search-products-v2-ranking.0",
  "provenance": {
    "source": "contract-fixture",
    "generatedAt": "2026-07-22T12:00:00.000Z",
    "cached": false
  }
}
```

## Versionado

La version contractual queda determinada por el futuro endpoint:

```text
POST /v2/products/search
```

No se agrega `contractVersion` al payload en T01A para evitar duplicar la version del endpoint. Para validacion offline, fixtures o adapters, podria agregarse posteriormente como metadata fuera del payload o como campo explicito si el endpoint no basta.
