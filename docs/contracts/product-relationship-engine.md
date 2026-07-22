# Product Relationship Engine Contracts

## Proposito

Este documento define los contratos internos neutrales del `Product Relationship Engine` para PesasChile.

T01B no implementa algoritmos.

El Product Relationship Engine no interpreta queries del agente.

El Product Relationship Engine no personaliza por cliente.

## Frontera Build/Runtime

El modulo separa dos momentos:

- build-time: lectura de dataset neutral, calculo, evaluacion de confiabilidad, validacion y publicacion.
- runtime: lectura de relaciones ya publicadas.

El runtime no calcula relaciones. Solo consulta una publicacion estable y publicada.

## Neutralidad Respecto De PrestaShop

El engine no recibe filas SQL, tablas PrestaShop, DTOs HTTP, entidades ORM, documentos CRM ni estructuras del cliente TypeScript.

El input build usa un dataset neutral:

```text
ProductInteractionDataset
```

La integracion futura con PrestaShop debe ocurrir fuera del contrato del engine mediante un reader/adapter.

## Identidad De Producto

`ProductRelationshipProductReference` contiene:

```text
productId
combinationId?
```

La identidad compuesta es:

```text
productId + combinationId
```

La ausencia de `combinationId` representa producto base. El contrato no normaliza IDs silenciosamente.

## Dataset

`ProductTransaction` representa una transaccion neutral `cart` u `order` con:

- `transactionId`
- `transactionType`
- `occurredAt`
- `customerKey?`
- `products`

`customerKey` es opcional y solo existe para soportar futuros calculos longitudinales. No representa personalizacion runtime.

Una transaccion debe traer productos ya deduplicados por identidad compuesta. El schema rechaza duplicados y no fusiona cantidades.

`ProductInteractionDataset` contiene:

- `transactions`
- `rules`

El dataset completo puede estar vacio. El tratamiento de dataset vacio corresponde al build result y warnings.

## Reglas

`ProductRelationshipRule` solo permite:

- `technical_compatibility`
- `manual`

No permite relaciones estadisticas como `same_cart`, `same_order`, `next_purchase` o `customer_history`.

Las reglas requieren source y target diferentes, reliability entre 0 y 1, rule ID/version no vacios y ventanas temporales validas si existen.

## Evidencia

El engine reutiliza la evidencia discriminada del contrato publico:

- `co_occurrence`
- `transition`
- `rule`

Compatibilidad obligatoria:

```text
same_cart, same_order, customer_history -> co_occurrence
next_purchase -> transition
technical_compatibility, manual -> rule
```

No existe un objeto generico de metricas.

## Relaciones Dirigidas

Toda relacion calculada es dirigida:

```text
sourceProduct -> targetProduct
```

Esto aplica incluso cuando la evidencia venga de coocurrencia simetrica, porque `confidence(A -> B)` puede ser distinta de `confidence(B -> A)`.

## Parametros De Build

`RelationshipBuildParameters` contiene parametros neutrales:

- `minimumJointCount`
- `minimumConfidence`
- `minimumLift`
- `maximumRelationshipsPerSource`
- `maximumDistinctProductsPerTransaction`

No contiene pesos de ranking, formulas ML, criterios comerciales, precio, stock ni necesidad del cliente.

## Build Input

`ProductRelationshipBuildInput` identifica una futura publicacion:

- `publicationId`
- `modelVersion`
- `dataWindow`
- `relationshipTypes`
- `parameters`

No incluye dataset. La lectura de dataset es una dependencia separada.

## Relacion Calculada

`CalculatedProductRelationship` es un artefacto analitico neutral:

- source product
- target product
- relationship type
- evidence discriminada
- reliability
- evidence window
- model version

No admite datos runtime como rank, precio, stock, nombre de producto, categoria ni producto hidratado.

## Estadisticas Y Warnings

`ProductRelationshipBuildStatistics` resume conteos de lectura, aceptacion y rechazo.

Las invariantes permiten desigualdad:

```text
accepted + rejected <= read/generated
```

Esto evita acoplar el contrato a fases internas futuras.

`RelationshipBuildWarning` acepta detalles JSON serializables. No debe contener `Error`, funciones, simbolos, bigint, ciclos, stack traces, secretos ni SQL.

## Validacion

`ProductRelationshipValidationResult` contiene:

- `valid`
- `issues`

Invariante:

```text
valid = true
si y solo si no existe issue con severity = "error"
```

Warnings no invalidan por si mismos.

## Publicacion

`ProductRelationshipPublication` describe el estado neutral de una publicacion:

- `building`
- `validated`
- `published`
- `failed`

`published` requiere `validatedAt` y `publishedAt`.

`building` no puede contener `publishedAt`.

Este contrato no define persistencia, transacciones ni maquina ejecutable de estados.

## Runtime Reader

`ProductRelationshipReadInput` permite buscar relaciones publicadas por:

- source products
- relationship types opcionales
- limit per source

No incluye query, customerId, budget, stock, categorias, filtros comerciales ni necesidad actual.

`ProductRelationshipReadResult` exige una publicacion con status `published`. Los items deben compartir `publicationId` y `modelVersion`, y sus ranks deben ser unicos, contiguos y ordenados por source.

Un resultado runtime vacio es valido.

## Interfaces

El modulo define interfaces, no implementaciones:

- `ProductRelationshipDatasetReader`
- `ProductRelationshipCalculator`
- `RelationshipReliabilityEvaluator`
- `ProductRelationshipValidator`
- `ProductRelationshipPublisher`
- `ProductRelationshipReader`

No hay agregador, repositorio real, SQL ni clases concretas en T01B.

## Invariantes

Principales invariantes:

- timestamps ISO-8601 UTC serializables
- ventanas con `from <= to`
- IDs no vacios
- productos unicos por identidad compuesta
- source y target diferentes
- evidencia compatible con relationship type
- metricas finitas
- reliability entre 0 y 1
- relaciones dirigidas y unicas por source, target y type
- publicaciones runtime solo desde status `published`
- ranks runtime unicos, contiguos y ordenados por source

## Compatibilidad

T01B no modifica:

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
- providers
- repositorios
- base de datos
- Swagger runtime

No crea endpoint `/v2`.

## Alcance Excluido

T01B excluye:

- algoritmos de `same_cart`
- algoritmos de `same_order`
- calculo SQL
- migraciones
- tablas
- repositorios reales
- publicacion atomica real
- handlers
- rutas
- integracion con PrestaShop
- integracion con `SearchProductsInput`
- personalizacion por cliente
- CRM

## Roadmap Posterior

Pasos posteriores razonables:

1. Definir ADR de evolucion Catalog Service a Product Recommendation Service.
2. Crear migraciones de persistencia analitica separada.
3. Implementar normalizador neutral desde una fuente controlada.
4. Implementar calculadora `same_cart`.
5. Agregar validacion y publicacion atomica.
6. Conectar runtime reader contra snapshot publicado.
7. Integrar expansion por relaciones en `/v2/products/search`.

