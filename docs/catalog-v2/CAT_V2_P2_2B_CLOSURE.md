# CAT-V2 P2.2B — Closure

Fecha: **2026-10-05**. Baseline: `8ced63b062185fdd66c9c64c909dbf525b664184`.

```text
DECISION = RETIRE
IMPLEMENTATION_CLOSED = YES
LEGACY_TRAINING_V2_RUNTIME_AUTHORITY = NONE
PRODUCTION_DEPLOYED = NO
PRODUCTION_VALIDATED = NO
```

## Resultado

Training Semantics V2 se construye desde extracción verificada, classifiers/reglas/registry existentes y policy A00.6.7 versionada. El bundle declara su artifact schema 2 separado de Training V1. Runtime carga y congela V2 antes del swap y todos los consumidores runtime reciben el reader ligado al estado capturado. Bootstrap ya no abre el store legacy Training V2.

**Parity PASS:** 2011 productos compartidos equivalentes, cero legacy-only, cero diferencias materiales y 37 adicionales. Clasificación `CAT_V2_SUPERSET`. Las 432 diferencias de origen conservan el significado contractual.

**Reproducción PASS:** publisher aprobado produce el snapshot `sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1`. Dos procesos independientes producen el mismo bundle native y los mismos bytes de los cinco artifacts. Product/V1/specs/trust maps conservan los bytes Phase 1.

## Gates ejecutados

| Comando / prueba | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` incluido pretest aprobado | **112 archivos, 2443 pruebas PASS**, 123.24 s de Vitest |
| `git diff --check` | PASS |
| Suite específica parity/build/reload | 3 archivos, 17 pruebas PASS |
| CLI authority audit sobre candidato completo | PARITY_PASS / CAT_V2_SUPERSET |
| Reproducción completa en procesos separados | IDs y artifact bytes iguales |
| Acceptance HTTP sin restart | B1 LEG_PRESS → B2 ROW → rollback B1; read/query/discovery recuperan respuestas originales |
| Request capture durante promoción | Mantiene bundle, snapshot y capability de B1 hasta completar request |
| V2 inválido, lineage y registry | Rechazo antes de load/swap; conserva last good o unavailable inicial |
| Phase 1 sin V2 / unavailable explícito | Bundle válido; V1 READY, V2 UNAVAILABLE; Training 503 y Commercial Truth independiente |
| Health/context | Native authority, COMPLETE y projection/bundle/activation lineage |

Durante desarrollo se corrigieron una incompatibilidad de tipos readonly en el helper de lineage, valores de enums de fixtures y una etiqueta genérica ROW sin evidencia suficiente. El fixture final usa el patrón aprobado `Seated Row`; los classifiers/reglas productivos no se modificaron. La suite completa final no tiene fallos.

## Candidato local verificable

```text
sourceExtractionId:
sha256:3694b291c89d5f011904b44dc7fe51eb6f355da63d5bb25c485009fadd67d007

code content ref:
sha256:bc983194b0e9dad704753eeadd6f7278d9916eefe4b041c204c8ed8273f2c5e8

projectionBundleId:
sha256:ee4881b5875ee098c8b54c5ee6dfdcd4d4a92d8c91263bd4ce02c1b5e8e0a347

Training V2 projectionId:
sha256:4f5cdc689d07f867c0b571a17150d323967e93ebb9e19a31506eac444b3beb7c
```

Directory local: `artifacts/catalog-v2/p2-2b-final/bundles/<bundle hash>`. El código y los reportes se cierran en dos commits separados: P2.2A audit / RETAIN_TEMPORARILY y P2.2B Training V2 authority migration. Ningún pointer productivo fue promovido y no se realizó deployment.

Para completar operación se requiere desplegar el runtime compatible y activar un bundle con V2, con validación live posterior. Con el bundle Phase 1 anterior, el código nuevo conserva Product/V1/specs y reporta Training V2 UNAVAILABLE. El publisher/store legacy sigue disponible solo para reproducción y fixtures.

## Deuda y límites

- Native mantiene 773 records unknown y los 6 unresolved del cohort curado; no inventa resoluciones.
- El cohort `activeTrainingRelevant` conserva 240 miembros históricos y 234 resueltos; no equivale al estado comercial actual.
- Futuros cambios materiales de productos curados necesitan policy/audit nuevos.
- Producción pendiente de deployment/activation y validación; no se afirma un retiro ya efectuado en el servicio live.
- P2.2A conserva **RETAIN_TEMPORARILY / RETIREMENT_BLOCKED**, con fallback Product solo en NO_ACTIVE_BUNDLE. Training V1, Commercial Truth, Relationships, Capabilities Projection y R4 conservan su alcance.

Audit, matriz de consumidores, mapa de campos, diff por archivo y comandos: [Training V2 authority audit](CAT_V2_P2_2B_TRAINING_V2_AUTHORITY_AUDIT.md).

Evidencia: [parity por producto](evidence/training-v2-parity.json), [reproducción de artifacts](evidence/training-v2-reproducibility.json).
