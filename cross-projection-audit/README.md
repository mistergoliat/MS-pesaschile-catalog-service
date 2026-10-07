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
# P2.3B offline family applicability

`node cross-projection-audit/audit.mjs --p2-3b` evaluates `semantic-obligations-v2` against the same verified source/bundle. It preserves prior outputs and compares every v1 product payload with `product-admission.json`. Run the complete suite directly through Vitest with `--reporter=json --outputFile=cross-projection-audit/test-results-P2.3B.json`, then run the audit twice for all 12 gates and full-output reproducibility. Do not use the snapshot-publishing npm pretest for this phase. Generated P2.3B artifacts remain ignored; `--output-dir` supports an independent v2 output directory. Methodology: [P2.3B contract documentation](../docs/catalog-v2/P2_3B_FAMILY_APPLICABILITY_AND_OBLIGATIONS.md).

## P2.3C local Training candidate

Historical instructions from before the content-review rejection. Do not rerun this builder under the corrected rules or overwrite `p2-3c/`; use the P2.3C-FIX workflow below.

Run `node --import tsx cross-projection-audit/training-reconciliation-audit.mjs` after the full suite writes `p2-3c/test-results.json`. The script accepts the same `--source-dir` and `--bundle-dir` overrides, reads frozen baselines and confines every write to `p2-3c/`. It reproduces the historical snapshot and validates the original `historical-red.json` evidence when available; later runs do not fabricate that historical failure. The small [REPORT-P2.3C](p2-3c/REPORT-P2.3C.md) is explicitly eligible for Git; generated JSON, CSV, snapshots and the local candidate bundle remain ignored. [P2.3C methodology](../docs/catalog-v2/P2_3C_TRAINING_SEMANTIC_RECONCILIATION.md). No activation or deployment is performed.

## P2.3C-FIX rule precision

P2.3C was rejected by content review. Preserve `p2-3c/` as historical evidence and use `node --import tsx cross-projection-audit/training-rule-precision-audit.mjs` for the corrected source rebuild. The new audit writes only to `p2-3c-fix/`, runs the 18/26/1/6 regression gate and sweeps all 2048 records. [Methodology](../docs/catalog-v2/P2_3C_FIX_TRAINING_RULE_PRECISION.md) and [report](p2-3c-fix/REPORT-P2.3C-FIX.md). The report is eligible for Git; generated evidence and the candidate bundle remain ignored.
