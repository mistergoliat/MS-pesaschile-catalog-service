# Catalog Service

Microservicio read-only para entregar información comercial real de PrestaShop al sistema autónomo.

## Alcance

- Búsqueda de productos activos.
- Consulta de producto simple o con variantes.
- Stock físico desde `ps_stock_available.physical_quantity`.
- Precio base, precio efectivo y descuentos vigentes.
- API privada versionada.
- Cliente TypeScript consumible por el agente.

## Arranque local

```bash
cp .env.example .env
npm ci
npm run dev
```

## Variables mínimas

- `API_KEY` o `CATALOG_API_KEYS`
- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

## Contrato del agente

El cliente en `client/` expone:

- `searchProducts()`
- `getProduct()`
- `batchGetProducts()`
- `catalogToolDefinition`

## Notas de seguridad

- La API requiere `x-api-key`.
- La comparación de claves es segura.
- El prefijo de tablas se valida estrictamente antes de construir SQL.
- No se aceptan nombres de tabla desde la request.

## Paridad de precios

El proveedor SQL de precios se etiqueta explícitamente como `sql_specific_price`.
No debe asumirse paridad con storefront hasta ejecutar `npm run validate:prices` contra casos reales.
