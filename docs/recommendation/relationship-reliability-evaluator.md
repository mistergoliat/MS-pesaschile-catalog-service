# Relationship Reliability Evaluator

## Proposito

T04 convierte `ProductRelationshipCandidate` en `CalculatedProductRelationship`.

Entrada:

```text
ProductRelationshipCandidate
```

Salida:

```text
CalculatedProductRelationship
```

T04 calcula `reliability`.

T04 no recalcula `support`, `confidence` ni `lift`.

T04 no modifica la evidencia producida por T03.

## Separacion Evidence/Reliability

T03 calcula evidencia estadistica:

- `jointCount`
- `sourceCount`
- `targetCount`
- `totalTransactions`
- `support`
- `confidence`
- `lift`

T04 interpreta esa evidencia y produce un unico valor:

```text
reliability: 0..1
```

`reliability` no es ranking comercial, no es probabilidad de compra y no es recomendacion final.

## Formula Implementada

Para evidencia `co_occurrence`:

```text
confidenceScore = confidence
liftScore =
  lift <= 1 ? 0 : 1 - 1 / lift
supportScore = support
jointCountScore = 1 - exp(-jointCount / jointCountScale)

reliability =
  0.50 * confidenceScore
+ 0.25 * liftScore
+ 0.10 * supportScore
+ 0.15 * jointCountScore
```

El resultado se limita al rango:

```text
0..1
```

## Justificacion

La formula combina cuatro senales de evidencia:

- `confidence`: fuerza direccional principal.
- `lift`: asociacion por sobre aparicion esperada. `lift <= 1` no aporta senal positiva.
- `support`: presencia global dentro de la ventana.
- `jointCount`: respaldo muestral con retornos decrecientes.

`jointCountScore` usa amortiguacion exponencial para que una relacion con una sola orden no parezca tan confiable como una con muchas observaciones, sin permitir que el volumen domine por completo.

`support` y `jointCount` estan relacionados porque `support = jointCount / totalTransactions`. La V1 conserva ambos de forma consciente, pero reduce `support` a 10% y deja `jointCount` en 15%: `support` expresa cobertura global y `jointCount` protege contra muestras pequenas.

Los parametros V1 son:

```text
confidenceWeight = 0.50
liftWeight = 0.25
supportWeight = 0.10
jointCountWeight = 0.15
jointCountScale = 10
```

Los pesos deben sumar exactamente 1. `jointCountScale` es configurable por constructor para evitar que la calibracion quede oculta dentro del evaluador.

Estos pesos son version inicial auditable. No fueron calibrados con aprendizaje automatico.

## Compatibilidad

T04 conserva:

- `sourceProduct`
- `targetProduct`
- `relationshipType`
- evidencia completa
- `evidenceWindow`
- `modelVersion`

T04 agrega:

- `reliability`

T04 no agrega:

- `rank`
- `publicationId`
- datos de producto hidratado
- precio
- stock
- cliente

## Alcance Soportado

T04 implementa reliability para la evidencia `co_occurrence` producida por T03 `same_order`.

Si se invoca el evaluador generico con evidencia `transition` o `rule`, falla explicitamente con `UnsupportedRelationshipReliabilityEvidenceError`.

Esto evita inventar formulas para `next_purchase`, reglas manuales o compatibilidad tecnica en esta tarea.

## Alcance Excluido

T04 no implementa:

- publicacion
- snapshot
- runtime reader
- `same_cart`
- `next_purchase`
- `customer_history`
- SQL
- adapters
- endpoints
- Redis
- Neo4j
- ML
- personalizacion
- ranking comercial
