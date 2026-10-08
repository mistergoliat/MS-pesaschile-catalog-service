# P2.3C — Nota de cierre Git

Fecha: 2026-10-08. Esta nota acompaña el commit que preserva los informes P2.3C y sus dos scripts. Los informes históricos **no se editaron**; esta nota registra lo que cambió después.

## Archivos preservados

| Archivo | Verificación de identidad |
| --- | --- |
| `P2_3C_PRODUCTION_BASELINE_REBUILD.md` (PRB) | sha256 idéntico al registrado desde el primer `protected_before` posterior a P2.3C (QA1, 14:51) y en todas las capturas siguientes (QA2, V0.2, G1, C1) |
| `P2_3C_BUNDLE_BASELINE_RECONCILIATION.md` (BR, 1,9 MB) | Ídem. El propio informe declara ser la única salida persistida de su auditoría: sus anexos son la evidencia |
| `P2_3C_FINAL_PRODUCTION_ROLLOUT_REVIEW.md` | Ídem |
| `P2_3C_LINUX_REPRODUCIBILITY_REPORT.md` (LR) | Ídem |
| `cross-projection-audit/production-baseline-rebuild.mjs` | sha256 `35742800…` igual al registrado en `artifacts/catalog-v2/p2-3c-prb/protected-before.json` |
| `cross-projection-audit/code-identity-fix2.mjs` | sha256 `b56d08a5…`, ídem |

Los commits citados (`3c1e9c4` revisado, `b19fe209` anterior) existen en `main`. Los bundles citados (`84c85d15…` productivo y `bddf7f36…` candidate FIX2) son los mismos que fija `discover-g1/…/v02_frozen_authority.json`.

## Hechos posteriores que los informes no reflejan

1. **Disposición de rollout.** LR concluye `READY_FOR_CONTROLLED_ROLLOUT` para el procedimiento acreditado. Después:
   - QA1 recomendó `PRODUCTION_ROLLOUT=DEFER` y QA2 dictaminó `INSUFFICIENT_INDEPENDENT_EVIDENCE`;
   - Discover V0.2, G1 y C1 mantienen `PRODUCTION_ROLLOUT=DEFER`.

   No hubo publicación ni activación. P2.3C sigue abierto, como dicen sus propios informes.
2. **Rutas temporales.** `production-baseline-rebuild.mjs` y los informes PRB y BR apuntan a `C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/…`, que el sistema puede purgar. Copias verificadas:
   - bundle `84c85d15…`: `artifacts/catalog-v2/preservation/bundles/` (manifest aprobado, cargado y validado con `frozenInputLoader`);
   - línea base de fuente `2a5521…`, `old-runtime.tar`, `review-export.json` y scripts de revisión: `artifacts/catalog-v2/preservation/quarantine/p23c-rollout-Vs7KXj/` (**no autoritativos**).

   Para volver a ejecutar el script hace falta restaurar esas rutas; el script no se modificó.
3. **Datos de infraestructura.** `P2_3C_FINAL_PRODUCTION_ROLLOUT_REVIEW.md` contiene la IP pública y el usuario SSH del servidor productivo, igual que `P2_3C_PRODUCTION_ROLLOUT_REVIEW.md`, ya versionado. No hay credenciales, claves ni tokens: la API key aparece sólo como nombre de variable.
