# Customer Profile PrestaShop Source Audit

CLI local para auditar evidencia transaccional disponible en la base PrestaShop usando solo la conexion read-only configurada por `DB_*`.

## Uso

```bash
npx tsx scripts/customer-profile-audit/customer-profile-audit.ts preflight
npx tsx scripts/customer-profile-audit/customer-profile-audit.ts run
```

Opcionalmente se puede cambiar el destino local:

```bash
npx tsx scripts/customer-profile-audit/customer-profile-audit.ts run --out scripts/customer-profile-audit/outputs
```

## Guardrails

- Usa `mysql2/promise` y las variables `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- Fuerza `connectionLimit: 1`, por debajo del maximo de 2 conexiones simultaneas.
- Ejecuta las consultas en secuencia.
- Aplica timeout de 15 segundos por consulta.
- Ejecuta `EXPLAIN FORMAT=JSON` antes de consultas agregadas o con joins.
- Detiene la auditoria si `SHOW GRANTS FOR CURRENT_USER()` muestra permisos de escritura o administracion.
- Detecta el prefijo PrestaShop desde `information_schema.tables`; no usa `PRESTASHOP_DB_PREFIX`.
- No usa `SELECT *`.
- Las muestras de clientes/direcciones se anonimizan con `SHA2` y una sal efimera por corrida, no almacenada.
- No lee ni escribe datos de CRM, no crea vistas/tablas y no modifica endpoints.
