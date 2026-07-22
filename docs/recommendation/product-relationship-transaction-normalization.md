# Product Relationship Transaction Normalization

## Proposito

T02 implementa la capa pura de dominio que transforma registros transaccionales raw-neutral en:

```text
ProductInteractionDataset
```

T02 no calcula relaciones producto-producto.

T02 no implementa recomendaciones.

T02 no personaliza por cliente.

`customerKey` solo habilita futuros calculos longitudinales agregados.

`customer_history` no equivale a afinidad individual cliente-producto.

## Arquitectura

La frontera es:

```text
Fuente operacional
  -> Source Reader
  -> RawTransactionRecord[]
  -> Neutral Transaction Normalizer
  -> ProductInteractionDataset
  -> Product Relationship Calculators
```

T02 implementa solo:

```text
RawTransactionRecord[] -> ProductInteractionDataset
```

El normalizer no lee fuentes. No ejecuta SQL, HTTP, PrestaShop, CRM, repositorios ni Customer 360.

## Contratos Raw-Neutral

`RawTransactionRecord` contiene:

- `transactionId`
- `transactionType`
- `occurredAt`
- `status?`
- `customerKey?`
- `lines`
- `source?`

`source` es solo trazabilidad para rechazos o warnings. No pasa al dataset neutral.

`RawTransactionLine` contiene:

- `lineId?`
- `productId`
- `combinationId?`
- `quantity`
- `lineStatus?`

No contiene nombre, categoria, precio, descuento, margen, stock, imagen, descripcion, proveedor ni marca.

## Configuracion

`ProductTransactionNormalizationConfig` inyecta la politica de elegibilidad:

- `acceptedOrderStatuses`
- `acceptedCartStatuses?`
- `rejectedLineStatuses?`
- `maximumDistinctProductsPerTransaction`
- `minimumOccurredAt?`
- `maximumOccurredAt?`
- `allowAnonymousTransactions`
- `duplicateTransactionStrategy`
- `duplicateProductStrategy`
- `outputOrder`

Los estados aceptados no se hardcodean. El adapter futuro debe mapear estados operacionales a estados canonicos configurables.

Errores de configuracion lanzan `ProductTransactionNormalizationConfigError`.

## Estados

Para `order`, `status` debe pertenecer a `acceptedOrderStatuses`.

Para `cart`, si `acceptedCartStatuses` esta configurado, `status` debe pertenecer a esa lista. Si no esta configurado, el estado del carrito no se usa como filtro.

Lineas con `lineStatus` dentro de `rejectedLineStatuses` se rechazan individualmente.

## Timestamps

El normalizer acepta timestamps ISO-8601 validos con timezone explicito.

El output normaliza a UTC usando:

```text
Date.toISOString()
```

Ejemplo:

```text
2025-03-10T10:00:00-04:00 -> 2025-03-10T14:00:00.000Z
```

No inventa timestamps.

## Identidad De Producto

La identidad es:

```text
productId + combinationId
```

Se distinguen:

- producto base
- producto con combinacion A
- producto con combinacion B

El normalizer valida que IDs no esten vacios, pero conserva el valor original valido. No cambia casing, no quita ceros, no castea numeros y no concatena IDs.

## Cantidades

`quantity` debe ser entero positivo y finito.

No se redondea.

No se convierten strings numericos.

## Duplicados

Transacciones duplicadas por:

```text
transactionType + transactionId
```

se manejan con estrategia fija `reject`:

- se mantiene la primera ocurrencia segun orden de input;
- se rechazan las posteriores;
- se registra `DUPLICATE_TRANSACTION`.

Productos duplicados dentro de una transaccion se agregan por identidad compuesta:

```text
A x 1
A x 2
-> A x 3
```

Esto emite `PRODUCT_LINES_AGGREGATED` y aumenta `duplicateProductLinesAggregated`.

## Procesamiento Parcial

Una transaccion puede conservar lineas validas aunque algunas lineas sean rechazadas.

Si queda al menos una linea valida, la transaccion se acepta y se emite `PARTIAL_TRANSACTION`.

Si todas las lineas son rechazadas, la transaccion se rechaza con `NO_VALID_LINES`.

## Transacciones Anonimas

Si `allowAnonymousTransactions = true`, una transaccion sin `customerKey` es valida.

Esto permite calculos futuros como `same_order` y `same_cart`, pero no permite calculos longitudinales por cliente.

Si `allowAnonymousTransactions = false`, la ausencia de `customerKey` rechaza la transaccion con `MISSING_CUSTOMER_KEY`.

## Limites

La transaccion completa se rechaza si:

```text
distinct accepted product identities > maximumDistinctProductsPerTransaction
```

El limite se aplica despues de eliminar lineas invalidas y despues de agregar duplicados.

No se trunca la transaccion.

## Determinismo

La misma entrada y configuracion producen:

- mismo dataset;
- mismos rechazos;
- mismos warnings;
- mismas estadisticas;
- mismo orden de salida.

Orden de transacciones:

- `occurred_at_then_transaction_id`
- o `transaction_id`

Orden de productos dentro de transaccion:

```text
productId
combinationId ausente primero
combinationId
```

No se usa reloj ni IDs aleatorios.

## Estadisticas

`ProductTransactionNormalizationStatistics` contiene:

- `transactionsRead`
- `transactionsAccepted`
- `transactionsRejected`
- `linesRead`
- `linesAccepted`
- `linesRejected`
- `duplicateProductLinesAggregated`
- `anonymousTransactionsAccepted`
- `distinctProductsObserved`

Invariantes:

```text
transactionsAccepted + transactionsRejected = transactionsRead
linesAccepted + linesRejected = linesRead
```

`linesAccepted` cuenta lineas raw aceptadas aunque se agreguen en un solo `TransactionProduct`.

`distinctProductsObserved` se calcula sobre identidades compuestas aceptadas en el dataset final.

## Rechazos

Rechazos de transaccion:

- `INVALID_TRANSACTION_ID`
- `INVALID_TRANSACTION_TYPE`
- `INVALID_OCCURRED_AT`
- `OUTSIDE_DATA_WINDOW`
- `STATUS_NOT_ACCEPTED`
- `MISSING_CUSTOMER_KEY`
- `NO_VALID_LINES`
- `TOO_MANY_DISTINCT_PRODUCTS`
- `DUPLICATE_TRANSACTION`
- `INVALID_TRANSACTION`

Rechazos de linea:

- `INVALID_PRODUCT_ID`
- `INVALID_COMBINATION_ID`
- `INVALID_QUANTITY`
- `LINE_STATUS_REJECTED`
- `INVALID_LINE`

Los rechazos no incluyen el registro raw completo.

## Warnings

Warnings:

- `ANONYMOUS_TRANSACTION`
- `PRODUCT_LINES_AGGREGATED`
- `PARTIAL_TRANSACTION`
- `EMPTY_INPUT`
- `SOURCE_REFERENCE_MISSING`

`details` debe ser JSON serializable y no debe contener `Error`, funciones, simbolos, bigint, ciclos, stack traces, secretos ni SQL.

## Compatibilidad Con T01B

El output se valida contra:

```ts
productInteractionDatasetSchema
```

El dataset resultante siempre usa:

```text
rules = []
```

T02 procesa exclusivamente transacciones.

## Alcance Excluido

T02 no implementa:

- `same_order`
- `same_cart`
- `support`
- `confidence`
- `lift`
- `jointCount`
- `transition`
- reliability scoring
- ranking
- snapshot
- publication
- runtime lookup
- Redis
- Neo4j
- ML
- customer affinity
- endpoints
- SQL
- migraciones
- adapters PrestaShop

