# Cross-projection audit

Git contiene los scripts, los criterios de observación escritos a mano (`invariants.md`, `new-product-admission.md`) y la documentación del contrato en `docs/catalog-v2/`. Los CSV, JSON y `REPORT*.md` son evidencia reproducible local y están ignorados. Los fixtures pequeños de `tests/fixtures/catalog-admission/` son inputs versionados de tests, independientes del catálogo completo.

## Requisitos

Instalar las dependencias del repositorio y disponer de los inputs canónicos, trust maps, bundle y snapshots legacy verificados que usa `audit.mjs`. Los stores `artifacts/` y `data/` siguen siendo locales: estos comandos no extraen datos, publican snapshots ni activan bundles.

Los defaults del script fijan la extracción y el bundle del baseline de P2.3A. Para indicar sus ubicaciones, usar `--source-dir=...` y `--bundle-dir=...` en ambas ejecuciones.

## Regenerar evidencia

Desde la raíz del repositorio:

```powershell
node cross-projection-audit/audit.mjs
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=json --outputFile=cross-projection-audit/test-results-P2.3A.json
node cross-projection-audit/audit.mjs --p2-3a
```

La primera ejecución genera la auditoría base; la segunda produce el resultado completo de tests sin el pretest que publica snapshots; la tercera genera el inventario y la evaluación de admisión. No hace falta recuperar un `family-inventory.json` de Git ni construirlo manualmente. Repetir la tercera ejecución compara hashes de los datasets completos.

Los outputs incluyen `REPORT.md`, `REPORT-P2.3A.md`, `product-consolidation.*`, `product-admission.*`, `family-inventory.*`, `family-obligations.*`, `consolidation-baseline.json`, `unknown-obligations.csv` y verificaciones. Se pueden borrar y regenerar; no se deben agregar con `git add -f`.

Para generar en una carpeta vacía sin sobrescribir evidencia local anterior, pasar el mismo `--output-dir=...` en las dos ejecuciones de auditoría y dirigir allí el test report. Por ejemplo:

```powershell
node cross-projection-audit/audit.mjs --output-dir=cross-projection-audit/.repro-check
node cross-projection-audit/audit.mjs --p2-3a --output-dir=cross-projection-audit/.repro-check
```

Sin test report, los gates que dependen del runner quedan pendientes; la verificación offline continúa disponible. Se rechaza usar `artifacts/` o `data/` como destino de auditoría para preservar los stores.

`build-admission-fixtures.mjs` es una herramienta de desarrollo para extraer fixtures representativos. No se ejecuta en la auditoría ni es necesario para correr los tests del checkout.
