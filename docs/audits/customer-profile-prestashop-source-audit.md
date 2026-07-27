# Customer Profile PrestaShop Source Audit

Fecha de ejecucion: 2026-07-27.

Rama local: `audit/customer-profile-source-discovery`.

Alcance: auditoria read-only de la base PrestaShop para determinar que evidencia real permite construir un Customer Profile transaccional de PesasChile. No se consulto CRM, no se modificaron endpoints, no se escribieron datos ni esquema, no se crearon vistas/tablas/migraciones y no se extrajo PII completa.

## Artefactos

- CLI reproducible: `scripts/customer-profile-audit/customer-profile-audit.ts`.
- Guia de uso: `scripts/customer-profile-audit/README.md`.
- Outputs locales ignorados por git: `scripts/customer-profile-audit/outputs/`.
- Evidencia principal:
  - `preflight.json`: conexion, permisos, carga y prefijo detectado.
  - `inventory.json`: tablas, columnas, indices y relaciones declaradas/inferidas.
  - `index-checks.json`: indices necesarios para agregaciones ejecutadas.
  - `source-audit.json`: volumenes, identidad, calidad, metricas y muestras anonimizadas.
  - `explains.json`: `EXPLAIN FORMAT=JSON` de consultas potencialmente costosas.
  - `query-log.json`: orden secuencial, tiempos y cantidad de filas retornadas.

## Guardrails Verificados

- Conexion reutilizada desde `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`; no se almacenaron credenciales nuevas.
- Host logico auditado: `pesas-productiva.cz0wkq9tvrby.us-east-1.rds.amazonaws.com`.
- Base auditada: `pesas_productiva`.
- Permisos observados: `GRANT SELECT ON *.* ...`; hash de autenticacion redactado en outputs.
- Carga previa: `Threads_running=8`, `Threads_connected=48`, `max_connections=646`, ratio `0.0124`.
- Conexion del script: `connectionLimit=1`, menor al maximo de 2.
- Timeout por query: 15.000 ms.
- Consultas ejecutadas secuencialmente.
- `SELECT *`: no usado.
- Prefijo PrestaShop: detectado desde `information_schema.tables`, no desde `PRESTASHOP_DB_PREFIX`. Prefijo ganador: `ps_`.
- Muestras con PII: solo hashes con `SHA2` y sal efimera por corrida; no se guardo la sal.

## Inventario

Se detectaron 417 tablas base en la base, 405 con prefijo `ps_`, 39 tablas objetivo iniciales y 2.551 columnas. `information_schema.key_column_usage` no reporto foreign keys declaradas; se infirieron 348 relaciones candidatas por coincidencia de columnas `id_*` con primary keys descubiertas.

Tablas clave verificadas:

| Area | Tablas | Evidencia de columnas/indices |
| --- | --- | --- |
| Identidad | `ps_customer`, `ps_guest`, `ps_address` | PKs `id_customer`, `id_guest`, `id_address`; indices `customer_email`, `id_customer`, `address_customer`; columnas PII presentes y no extraidas completas: `email`, `firstname`, `lastname`, `phone`, `phone_mobile`, `dni`, `address1`, `city`, `rut_fact`. |
| Carritos | `ps_cart`, `ps_cart_product` | `ps_cart` contiene `id_customer`, `id_guest`, `id_cart`, fechas e indices sobre cliente/guest/cart; `ps_cart_product` contiene PK compuesta `id_cart`, `id_product`, `id_product_attribute`, `id_customization`. |
| Ordenes | `ps_orders`, `ps_order_detail`, `ps_order_state`, `ps_order_state_lang` | `ps_orders` contiene `id_customer`, `id_cart`, `current_state`, totales y fechas; no contiene `id_guest`. `ps_order_detail` contiene `id_order`, `product_id`, cantidades, precios y referencia/nombre historicos. |
| Catalogo | `ps_product`, `ps_product_lang`, `ps_category`, `ps_category_product` | Productos, nombres por idioma/shop y relaciones categoria-producto verificadas. |
| Descuentos | `ps_specific_price`, `ps_cart_rule`, `ps_order_cart_rule` | Descuentos por cliente/carrito/producto/regla y descuentos aplicados a ordenes. |
| Servicio | `ps_customer_thread`, `ps_customer_message`, `ps_message` | Tickets/hilos ligados a cliente, orden y producto; mensajes no se extrajeron, solo conteos y longitudes. |

Todos los indices requeridos por las agregaciones finales estuvieron presentes. La metrica guest/order fue omitida porque `ps_orders.id_guest` no existe en el esquema. La metrica `topOrderedCategories` fue omitida despues de que una corrida protegida superara 15s.

## Cobertura Temporal Y Volumen

| Fuente | Filas | Primer registro | Ultimo registro |
| --- | ---: | --- | --- |
| `ps_customer` | 71.820 | 2022-09-02 | 2026-07-27 |
| `ps_guest` | 1.114.719 | sin fecha en tabla | sin fecha en tabla |
| `ps_cart` | 127.679 | 2025-01-01 | 2026-07-27 |
| `ps_cart_product` | 461.452 | 2022-09-02 | 2026-07-27 |
| `ps_orders` | 80.133 | 2022-09-02 | 2026-07-27 |
| `ps_order_detail` | 170.564 | sin fecha en tabla | sin fecha en tabla |
| `ps_address` | 82.728 | `MIN(date_add)` nulo | 2026-07-27 |
| `ps_specific_price` | 9.395 | sin `date_add` | sin `date_add` |
| `ps_cart_rule` | 7.431 | 2022-09-08 | 2026-07-27 |
| `ps_order_cart_rule` | 8.494 | sin fecha en tabla | sin fecha en tabla |
| `ps_customer_thread` | 17.436 | 2022-09-03 | 2026-07-27 |
| `ps_customer_message` | 18.525 | 2022-09-03 | 2026-07-27 |
| `ps_connections` | 5.601.761 | 2026-05-25 | 2026-07-27 |

Nota: timestamps en outputs fueron normalizados por el cliente MySQL con timezone `Z`.

Nota operativa: la base estaba viva durante la auditoria read-only. Como las consultas se ejecutaron secuencialmente y sin snapshot transaccional largo, algunos conteos difieren levemente entre secciones tomadas en momentos distintos, por ejemplo `ps_guest` y `ps_cart`.

## Identidad Customer / Guest / Order

- `ps_customer`: 71.820 clientes, 71.426 emails distintos, 0 emails faltantes, 71.818 activos, 1 borrado.
- La diferencia entre clientes y emails distintos indica al menos 394 clientes sobre emails repetidos o normalizados iguales; el email puede ayudar como fingerprint, pero no debe ser unica clave.
- `ps_guest`: 1.114.745 guests, solo 641 ligados a `id_customer`.
- `ps_cart`: 127.679 carritos; 35.946 con `id_customer`, 112.405 con `id_guest`, 60.178 sin customer y 3.644 sin guest.
- `ps_orders`: 80.133 ordenes, 44.736 clientes compradores distintos, 64.209 `id_cart` distintos, 0 ordenes sin `id_customer`.
- Hay 8 ordenes cuyo `id_customer` no tiene registro en `ps_customer`.
- Hay 51.656 ordenes sin registro coincidente en `ps_cart`; esto coincide con que `ps_cart` inicia en 2025 mientras ordenes inician en 2022. La relacion orden-carrito es parcial para historia larga.
- `ps_orders` no contiene `id_guest`; la identidad guest-order no es calculable directamente desde ordenes.
- `ps_address`: 82.728 direcciones, 71.785 clientes con direccion, 1.909 direcciones borradas, 84 sin telefono y 20 sin DNI/RUT.

Conclusion: el identificador transaccional primario confiable para Customer Profile v1 es `ps_orders.id_customer -> ps_customer.id_customer`. `guest` sirve mejor para analisis de navegacion/carrito y abandono, no para unir directamente historico de ordenes.

## Calidad De Ordenes Y Detalles

- Ordenes: 80.133.
- Total pagado historico: 11.461.132.002,65 CLP; ticket promedio global: 143.026,37 CLP.
- Ordenes con total no positivo: 50.
- Lineas de detalle: 170.564.
- Ordenes con lineas: 80.130.
- Ordenes sin detalle: 3.
- Productos distintos en detalle: 1.714.
- Lineas con cantidad no positiva: 0.
- Lineas sin producto: 0.
- Lineas cuyo `product_id` no encuentra registro actual en `ps_product`: 4.165. Esto afecta enriquecimiento actual, pero `ps_order_detail.product_name` y referencias historicas pueden preservar contexto.
- Lineas con total negativo o faltante: 0.

Distribucion por cantidad de lineas:

| Bucket | Ordenes |
| --- | ---: |
| 1 | 42.655 |
| 2-3 | 26.337 |
| 4-10 | 10.308 |
| 11+ | 830 |

Estados principales por volumen:

| Estado | Flag pago | Flag logable | Ordenes |
| --- | ---: | ---: | ---: |
| 5 - Entregado | 1 | 1 | 42.252 |
| 4 - Entregado a Transportista | 1 | 1 | 19.227 |
| 2 - Pago aceptado | 1 | 1 | 15.914 |
| 36 - Entregado a BlueExpress | 0 | 1 | 1.422 |
| 6 - Cancelado | 0 | 0 | 954 |

La semantica de estados debe validarse con negocio antes de definir "orden valida". Como regla inicial basada en evidencia, `paid=1 OR logable=1` no equivale siempre a finalizada; hay estados logisticos con `paid=0` y `logable=1`.

## Catalogo, Categorias Y Productos

- Productos: 1.582.
- Productos activos: 1.103.
- Productos sin referencia: 3.
- `ps_product_lang`: 1.582 filas para cada shop 1, 2 y 3 en `id_lang=1`, sin nombres faltantes.
- Categorias: 250.
- Relaciones categoria-producto: 7.930.
- Productos categorizados: 1.586.

Top productos por ordenes fue calculable y quedo en `source-audit.json`. Los primeros lugares son:

| Producto | Ordenes | Unidades |
| --- | ---: | ---: |
| 444 - Servicio vendedor Pesas Chile | 4.586 | 13.896 |
| 80 - Magnesio 56gr (Unidad) \| Araknido | 2.962 | 63.330 |
| 8 - Banda de Resistencia X-Light 13mm 25Lbs Rojo \| HWM | 1.922 | 11.559 |
| 9 - Banda de Resistencia Light 22mm 50Lbs Negro \| HWM | 1.732 | 8.349 |
| 818 - Cinturon de Levantamiento Straight Black \| HWM | 1.705 | 5.808 |

`topOrderedCategories` no se calculo en la corrida final porque una ejecucion protegida previa supero el timeout de 15s. Debe construirse luego como query preagregada o vista materializable con indices adecuados.

## Carritos Y Descuentos

- Carritos: 127.682 en conversion join.
- Carritos con orden asociada: 28.477.
- Carritos sin orden asociada: 99.205.
- Lineas de carrito: 461.452.
- Carritos con lineas: 249.805.
- Productos distintos en carrito: 1.307.
- Lineas de carrito con cantidad no positiva: 3.
- `ps_specific_price`: 9.395 reglas; 356 ligadas a cliente, 458 ligadas a carrito, 0 ligadas a grupo.
- `ps_cart_rule`: 7.431 reglas; 7.073 activas.
- `ps_order_cart_rule`: 8.494 descuentos aplicados sobre 8.448 ordenes; valor total observado 103.954.360,5 CLP.

Los carritos permiten senales fuertes de abandono y afinidad previa a compra, pero su cobertura temporal empieza en 2025 para `ps_cart`. Para snapshots historicos completos, no debe usarse como fuente unica.

## Customer Service

- Hilos: 17.436.
- Clientes con hilos: 13.060.
- Ordenes con hilos: 15.529.
- Productos con hilos: 279.
- Estados distintos: 1 valor efectivo (`open`) mas 33 vacios.
- Mensajes: 18.525.
- Longitud promedio de mensaje: 144 caracteres; maximo 4.594.

El contenido del mensaje no se debe incluir en v1 por privacidad y porque el objetivo es transaccional. Si se usa la fuente, debe limitarse a conteos, fechas, cliente/orden/producto y presencia de soporte.

## Metricas Transaccionales Calculables

Sobre clientes con ordenes, hay 44.736 snapshots transaccionales posibles:

- `order_count`, `first_order_at`, `last_order_at`.
- `gross_total_paid`, `avg_order_value`, `non_positive_paid_order_count`.
- `paid/logable/shipped/state` counts por estado verificado.
- `line_count`, `units_purchased`, `distinct_products_purchased`.
- Afinidad producto-cliente por `id_customer + product_id`: calculada como top 50 anonimizado en outputs.
- `repeat_buyer`: 10.148 clientes tienen 2 o mas ordenes.
- `one_order_customer`: 34.588 clientes.
- `four_plus_orders`: 2.117 clientes.
- Descuentos: conteo y monto de `order_cart_rule`; presencia de `specific_price` por cliente/carrito.
- Carrito: presencia de carritos recientes, carritos sin orden y lineas de carrito, con cautela por cobertura temporal.
- Servicio: conteos de hilos/mensajes por cliente, orden y producto, sin texto.
- Direccion: cobertura de direccion/telefono/RUT como flags de calidad, no como payload PII.

## Metricas No Confiables O No Calculables

- Guest-order directo: no calculable porque `ps_orders.id_guest` no existe.
- Conversion historica completa de carrito a orden: no confiable para todo el periodo; `ps_cart` empieza en 2025 y hay 51.656 ordenes sin registro de carrito actual.
- Timeline de guests: no calculable desde `ps_guest` porque no hay fechas.
- Categorias mas compradas: no calculada por timeout de `categories.top-ordered`; requiere preagregacion o vista posterior.
- Segmentos basados en estado final: requieren decision de negocio sobre `current_state`; flags `paid/logable/shipped` no son suficientes por si solos.
- Geografia/direccion detallada: existe en `ps_address`, pero debe tratarse como PII; v1 solo deberia usar flags o agregados anonimizados.
- Mensajeria de soporte semantica: no se analizo texto; solo metadata.
- Enriquecimiento de catalogo actual para todo historico: 4.165 lineas apuntan a productos no presentes actualmente en `ps_product`.
- Emails como identidad unica: hay menos emails distintos que clientes, aunque no hay emails vacios.

## Segmentos Deterministicos Posibles

- `registered_no_order`: customer existe, sin orden asociada.
- `first_time_buyer`: una orden.
- `repeat_buyer`: dos o mas ordenes.
- `high_frequency_buyer`: cuatro o mas ordenes.
- `recent_buyer`: `last_order_at` dentro de ventana definida.
- `dormant_buyer`: tuvo ordenes, pero no en ventana definida.
- `high_value_customer`: por percentiles posteriores de `gross_total_paid` o `avg_order_value`.
- `discount_sensitive`: uso de `order_cart_rule` o `specific_price` ligado a customer/cart.
- `cart_abandoner_recent`: carrito con lineas y sin orden, restringido al periodo confiable de `ps_cart`.
- `support_contacted`: cliente con hilos/mensajes.
- `product_affinity_*`: afinidad deterministica por productos comprados.
- `category_affinity_*`: posible despues de preagregar categoria-producto sin timeout.
- `data_quality_risk`: cliente/orden con señales faltantes, por ejemplo orden sin customer record, orden sin detalle, direccion sin telefono/RUT.

## Propuesta CustomerProfileSnapshot v1

Basado solo en evidencia real, v1 deberia ser un snapshot transaccional por `id_customer`, sin CRM y sin PII completa:

```ts
type CustomerProfileSnapshotV1 = {
  schemaVersion: 'customer-profile-snapshot.v1';
  generatedAt: string;
  source: {
    system: 'prestashop';
    database: string;
    detectedPrefix: string;
  };
  identity: {
    prestashopCustomerId: string;
    customerHashForAudit?: string;
    hasEmail: boolean;
    emailFingerprint?: string;
    active: boolean;
    deleted: boolean;
    createdAt: string | null;
  };
  transactionSummary: {
    orderCount: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    totalPaid: number;
    averageOrderValue: number | null;
    distinctProductsPurchased: number;
    unitsPurchased: number;
    nonPositivePaidOrderCount: number;
  };
  orderStateSummary: Array<{
    stateId: number;
    orders: number;
    paidFlag: boolean;
    shippedFlag: boolean;
    logableFlag: boolean;
  }>;
  productAffinities: Array<{
    productId: number;
    orders: number;
    units: number;
    lastPurchasedAt: string;
  }>;
  cartSignals: {
    cartCount: number;
    openCartCount: number;
    lastCartAt: string | null;
    cartCoverageWarning?: string;
  };
  discountSignals: {
    ordersWithDiscount: number;
    totalDiscountValue: number;
    hasCustomerSpecificPrice: boolean;
  };
  serviceSignals: {
    threadCount: number;
    messageCount: number;
    lastThreadAt: string | null;
  };
  dataQuality: {
    missingCustomerRecordOrders: number;
    missingCartRecordOrders: number;
    ordersWithoutDetails: number;
    missingCurrentProductLines: number;
    warnings: string[];
  };
};
```

PII como nombre, email completo, telefono, RUT y direccion no debe formar parte del snapshot v1. Si se requiere matching externo posteriormente, usar fingerprints/HMAC gestionados fuera de este microservicio y con reglas de acceso explicitas.

## Consultas O Vistas Posteriores Recomendadas

- `customer_order_rollup`: `id_customer`, counts, fechas, totales, flags de calidad.
- `customer_order_state_rollup`: distribucion de estados por customer con semantica aprobada por negocio.
- `customer_product_affinity_rollup`: `id_customer + product_id`, ordenes, unidades, ultima compra.
- `customer_discount_rollup`: uso de `order_cart_rule`, `specific_price` y montos.
- `customer_cart_rollup_2025_plus`: senales de carrito con advertencia de cobertura temporal.
- `customer_service_rollup`: hilos/mensajes por customer/order/product sin contenido.
- `customer_address_quality_rollup`: flags de cobertura de direccion/telefono/RUT sin PII.
- `category_affinity_rollup`: preagregado order_detail -> category_product -> category_lang para evitar timeout.
- `identity_bridge_customer_cart_guest`: puente customer/cart/guest, separado de ordenes por ausencia de `ps_orders.id_guest`.
- `order_quality_flags`: ordenes sin detalle, lineas sin producto actual, totales no positivos, estados no aceptados.

## Riesgos Residuales

- La auditoria es read-only y factual, pero no reemplaza definicion de negocio para estados validos.
- Las tablas no tienen foreign keys declaradas; las relaciones deben implementarse como contratos verificados por tests y monitoreo.
- La fuente `connections` es grande y contiene datos potencialmente sensibles; v1 no deberia depender de ella.
- Cualquier implementacion posterior debe mantener limites de lectura, anonimizacion y no mezclar CRM hasta que exista una decision explicita.
