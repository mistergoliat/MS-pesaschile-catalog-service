# P2.3 QA1 — Nota de cierre Git

Fecha: 2026-10-08. Acompaña el commit que preserva el informe QA1 y sus cuatro scripts. El informe histórico no se editó.

## Identidad verificada

`artifacts/catalog-v2/qa1/run-20261008-bddf7f/audit_implementation_hashes.json` registra el sha256 de los cuatro scripts y del informe que produjeron la evidencia. Los cinco archivos commiteados coinciden byte a byte (5/5). Además, el run conserva sus `evidence_checksums.json` y verifica 28/28 dentro de `artifacts/catalog-v2/preservation/PRESERVATION_MANIFEST.json`.

## Resultados históricos y reproducidos

- Los resultados del informe son **históricos**: no se reprodujeron en este cierre.
- No se ejecutaron los scripts porque escriben en el directorio de evidencia. En particular, `verify-evidence.mjs` sobrescribe `audit_self_checks.json` y `audit_implementation_hashes.json` sin protección create-only; el informe ya registra un incidente de sobrescritura de evidencia.
- La validación de este cierre se limitó a `node --check`, comparar hashes y verificar el manifest.

## Dependencias

- `ontology-audit.mjs` lee fuente y bundle productivo desde `C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/…`. Las copias verificadas están en `artifacts/catalog-v2/preservation/` (bundle `84c85d15…`) y en `preservation/quarantine/` (fuente `2a5521…`, no autoritativa).
- `verify-evidence.mjs` importa `scripts/product-semantic-classification/lib/csv.ts`, que ya está versionado.

## Estado

El informe sigue siendo válido tal como fue emitido: disposición `QA2_WITH_SCOPE_RESTRICTIONS`, rollout `DEFER`, sin gold humano y sin métricas de exactitud.
