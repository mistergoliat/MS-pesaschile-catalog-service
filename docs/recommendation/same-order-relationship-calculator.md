# Same Order Relationship Calculator

## Proposito

T03 detecta productos comprados juntos.

El calculator `same_order` recibe un `ProductInteractionDataset` ya normalizado por T02 y produce candidatos dirigidos con evidencia estadistica.

T03 no decide la recomendacion final.

T03 no personaliza por cliente.

T03 calcula evidencia, no reliability.

Las compras individuales se usan como observaciones agregadas, no como recomendaciones directas para ese cliente.

## Que Significa same_order

`same_order` significa que dos identidades de producto aparecieron en una misma orden elegible.

Una orden con:

```text
A, B, C
```

produce candidatos dirigidos:

```text
A -> B
A -> C
B -> A
B -> C
C -> A
C -> B
```

## Relaciones Dirigidas

Las relaciones son dirigidas porque la confianza puede ser distinta por direccion:

```text
confidence(A -> B) != confidence(B -> A)
```

Ejemplo: muchas ordenes con barra pueden incluir discos, pero no todas las ordenes con discos incluyen barra.

## Seleccion De Transacciones

T03 procesa solo:

```text
transactionType = "order"
```

Los carritos se ignoran y se cuentan en `cartsIgnored`.

Tambien se ignoran:

- ordenes fuera de `buildInput.dataWindow`
- ordenes con un solo producto distinto

No se rechazan ni generan error porque el dataset puede contener mezclas validas de orders y carts.

## Conteos

T03 cuenta presencia por orden, no unidades compradas.

Para una orden:

```text
A x10
B x1
```

la evidencia cuenta:

```text
A presente una vez
B presente una vez
A y B juntos una vez
```

Metricas por candidato:

- `totalTransactions`: ordenes elegibles procesadas
- `sourceCount`: ordenes donde aparece el producto origen
- `targetCount`: ordenes donde aparece el producto destino
- `jointCount`: ordenes donde ambos aparecen juntos

## Metricas

`support`:

```text
jointCount / totalTransactions
```

`confidence(A -> B)`:

```text
jointCount / sourceCount
```

`lift(A -> B)`:

```text
confidence(A -> B) / (targetCount / totalTransactions)
```

Las metricas son finitas, no negativas y no se redondean internamente.

## Evidencia Y Reliability

T03 produce `ProductRelationshipCandidate`, no `CalculatedProductRelationship`.

El candidato no contiene:

- `reliability`
- `rank`
- `publicationId`

La confiabilidad corresponde a T04.

La evidencia de T03 es `co_occurrence` y mantiene compatibilidad semantica con T01B, pero agrega conteos necesarios para auditoria del calculo:

- `sourceCount`
- `targetCount`
- `totalTransactions`

La evidencia publica original no representaba estos conteos, por eso T03 define un contrato intermedio de candidato antes de T04.

## Filtros

T03 aplica filtros desde `ProductRelationshipBuildInput.parameters`:

1. `minimumJointCount`
2. `minimumConfidence`
3. `minimumLift`
4. `maximumRelationshipsPerSource`

Una relacion debe cumplir los tres primeros filtros. Los rechazos se cuentan en ese orden para mantener estadisticas deterministicas.

`maximumDistinctProductsPerTransaction` no se usa en T03 porque ya pertenece a T02.

## Maximo Por Producto Origen

Despues de filtrar, T03 limita relaciones por source con:

```text
maximumRelationshipsPerSource
```

Orden antes de truncar:

1. confidence descendente
2. lift descendente
3. jointCount descendente
4. identidad target ascendente

Si el limite se aplica, se emite `SOURCE_RELATIONSHIP_LIMIT_APPLIED`.

Este orden no es ranking comercial final.

## Identidad De Producto

La identidad respeta:

```text
productId + combinationId
```

Por tanto:

- producto base A
- producto A combinacion 1
- producto A combinacion 2

son identidades distintas.

## Determinismo

La misma entrada y configuracion producen:

- mismos candidatos
- mismas metricas
- mismas estadisticas
- mismos warnings
- mismo orden

Orden de salida:

1. identidad source
2. confidence descendente
3. lift descendente
4. jointCount descendente
5. identidad target

No se usa reloj ni IDs aleatorios.

## Estadisticas

`SameOrderCalculationStatistics` contiene:

- `transactionsRead`
- `ordersRead`
- `cartsIgnored`
- `ordersOutsideDataWindow`
- `singleProductOrdersIgnored`
- `ordersProcessed`
- `distinctProductsObserved`
- `directedPairsObserved`
- `candidatesGenerated`
- `candidatesRejectedByJointCount`
- `candidatesRejectedByConfidence`
- `candidatesRejectedByLift`
- `candidatesRejectedBySourceLimit`
- `candidatesAccepted`

Invariantes:

```text
ordersRead =
ordersOutsideDataWindow + singleProductOrdersIgnored + ordersProcessed
```

```text
transactionsRead = ordersRead + cartsIgnored
```

```text
candidatesAccepted = candidates.length
```

## Warnings

Warnings posibles:

- `EMPTY_DATASET`
- `NO_ELIGIBLE_ORDERS`
- `NO_RELATIONSHIPS_GENERATED`
- `SOURCE_RELATIONSHIP_LIMIT_APPLIED`

`details` debe ser JSON serializable.

## Alcance Excluido

T03 no implementa:

- SQL
- migraciones
- adapters
- endpoints
- publicacion
- runtime reader
- Redis
- `same_cart`
- `next_purchase`
- personalizacion
- reglas comerciales
- ranking final
- ML
- integracion con `/v1` o `/v2`

