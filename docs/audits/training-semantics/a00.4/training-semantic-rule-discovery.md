# Training Semantics A00.4 — Rule discovery

Fuente de revisión: export real de catálogo utilizado en A00/A00.2, trust maps de categorías/features y `training_semantics_review_sample.csv`.

El classifier sólo usa `NAME`, `TRUSTED_CATEGORY` y `STRUCTURED_FEATURE`. No inspecciona `shortDescription`, `fullDescription`, tags, conocimiento externo ni lenguaje del cliente.

## Señales aceptadas

| Capability | Señales de nombre/feature | Guardas y falsos positivos |
|---|---|---|
| `LEG_EXTENSION` | `leg extension`, `extensión de cuádriceps` | excluye attachment; no hereda desde pack genérico |
| `LEG_CURL` | `leg curl`, `curl femoral` | `curl` solo no alcanza; attachment/pack requiere evidencia de módulo |
| `HIP_THRUST` | `hip thrust` en máquina/banco dedicado | cajón/box/pad/cinturón queda rechazado como facilitador, no capability autónoma |
| `CHEST_PRESS` | `chest press`, `press de pectoral/pecho` | bench, barbell y dumbbell no son chest press |
| `PEC_DECK` | `pec deck`, `contractora pectoral`; `mariposa/fly` sólo con contexto pectoral | fly/cable attachment genérico no alcanza |
| `LAT_PULLDOWN` | `lat pulldown`, `pulldown`, `jalón al pecho`, `polea alta` | `CABLE_MACHINE` por sí sola no crea assignment |
| `ROW` | `remo sentado`, `remo bajo`, `low row`, `t-row`, `remo contrapeso` | `CARDIO_MACHINE`, ergómetro/rower y `remo` genérico no se auto-publican |
| `SHOULDER_PRESS` | `shoulder press`, `press de hombro` | bench, barbell, dumbbell y Smith genérico no alcanzan |
| `PULL_UP` | barra/estación de dominadas o pull-up | rack/crossover sólo `SUPPORTED` con módulo explícito; band/grip/attachment no |
| `DIP` | dip station, paralelas, fondos dedicados | rack con soporte explícito es `SUPPORTED`; `fondo` ambiguo no alcanza |
| `ABDOMINAL_CRUNCH` | `abdominal crunch`, `crunch machine`, máquina abdominal explícita | rueda, AbMat, banco abdominal y `abs/core` no son assignments automáticos; A00.4.1 cerró los benches como mismatch ontológico |
| `ADDUCTOR` | estación/máquina aductora o `aductor` explícito | no se deriva muscle mapping adicional |
| `ABDUCTOR` | estación/máquina abductora o `abductor` explícito | no se deriva muscle mapping adicional |

## Fuentes y confianza

- Nombre explícito: `EXPLICIT`.
- Feature estructurada semántica y categoría `SEMANTIC_STRONG`: `HIGH`.
- Categoría `SEMANTIC_WEAK` y boundaries explícitas: `MEDIUM` + `HUMAN_REVIEW`.
- `LOW` no produce assignment positivo.
- Cada assignment conserva evidencia individual; las evidencias se ordenan por kind, sourceId y ruleId.

## Family y accesorios

`productFamily` sólo opera como guardia negativa o resolutor de ambigüedad. No hay reglas positivas del tipo `CABLE_MACHINE -> LAT_PULLDOWN`.

Flooring, storage, barbell, dumbbell, band, protective gear y bench genérico quedan `NO_CAPABILITY_APPLICABLE`. Máquinas sin señal resoluble quedan `UNMODELED`; lenguaje candidato débil queda `INSUFFICIENT_EVIDENCE` o `NEEDS_REVIEW`.

## Packs y multifunción

Los packs no heredan capabilities teóricas. Un módulo explícito puede conservar su capability activa si cada evidencia es trazable. Más de seis assignments obliga a `NEEDS_REVIEW`.

Los candidatos `LEG_PRESS`, `SQUAT`, `BENCH_PRESS`, `DEADLIFT`, `BICEPS_CURL`, `TRICEPS_EXTENSION`, `GLUTE_KICKBACK`, `CALF_RAISE` y `BACK_EXTENSION` sólo se registran como deferred findings.
