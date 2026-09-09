# Training Semantics A00.4.1 — Targeted Classification Adjudication

## Final gate

```text
TRAINING_SEMANTIC_CLASSIFICATION_ACCEPTED_WITH_DEBT
```

```text
CAN_A00_5_SNAPSHOT_PROCEED: YES_WITH_BOUNDED_DEBT
```

No snapshot, API, Sales Agent, Customer Profile ni ranking fue modificado.

## Estado después de la adjudicación

El classifier quedó en `training-semantic-classifier-v1.1` con rules hash:

```text
83007958a40fd29a87eb01d1fe159812587876c5e57295d7344024bda0123248
```

El registry no cambió:

```text
registryVersion: training-semantic-registry-v1
registryHash:   82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f
```

Resultado del catálogo de 2.011 filas:

| Métrica | Resultado |
|---|---:|
| Assignments | 180 |
| `DIRECT` | 157 |
| `SUPPORTED` | 23 |
| Multi-assignment products | 23 |
| `NO_CAPABILITY_APPLICABLE` | 881 |
| `UNMODELED` | 1.086 |
| `INSUFFICIENT_EVIDENCE` | 44 |
| `NEEDS_REVIEW` | 0 |

La reducción de dos assignments corresponde a `Barra Olímpica Hip Thrust` y `Almohadilla Hip Thrust`, que eran falsos positivos de la frontera `HIP_THRUST`.

## Ocho casos de review

Los ocho casos se cerraron negativamente; no queda decisión humana pendiente:

| ProductId | Producto | Candidate | Decision | Determinación |
|---:|---|---|---|---|
| 290 | Banco Abdominal MO Series | `ABDOMINAL_CRUNCH` | `ONTOLOGY_MISMATCH` | Bench inactivo; no hay mecanismo de crunch |
| 291 | Banco Abdominal Fondo MO Series | `ABDOMINAL_CRUNCH` | `ONTOLOGY_MISMATCH` | Bench mixto; soporte abdominal no equivale a crunch station |
| 471 | Banco Abdominal Ajustable V8 | `ABDOMINAL_CRUNCH` | `ONTOLOGY_MISMATCH` | Categoría fuerte de bancos, no de máquina de crunch |
| 480 | Banco Abdominal Fondo V8 | `ABDOMINAL_CRUNCH` | `ONTOLOGY_MISMATCH` | Features sólo prueban soportes abdominal/fondos |
| 528 | Banco Abdominal/Fondo y Dominada MO | `ABDOMINAL_CRUNCH` | `ONTOLOGY_MISMATCH` | La dominada explícita es evidencia separada; no prueba crunch |
| 1125 | Cajón Hip Thrust Acolchado | `HIP_THRUST` | `REJECT` | Categoría `Cajones de Salto`; facilita posicionamiento, no es estación dedicada |
| 1280 | Banco Abdominal Ajustable MO 2.0 | `ABDOMINAL_CRUNCH` | `ONTOLOGY_MISMATCH` | Bench ajustable sin mecanismo de crunch |
| 1514 | Banco Dip Chin / Abs MO 2.0 | `ABDOMINAL_CRUNCH` | `ONTOLOGY_MISMATCH` | Bench multifunción; `ABS` es wording amplio |

La decisión no se tomó sólo por token: se verificaron family, trusted categories, structured features y estado activo.

## ABDOMINAL_CRUNCH

`ABDOMINAL_CRUNCH` sigue siendo una capability V1 válida y permanece activa con cero assignments aceptados. La definición es deliberadamente estrecha: máquina/estación de crunch explícita. El dataset revisado sólo produjo benches abdominales/mixtos, ruedas, AbMat y accesorios; ninguno probó esa Product Truth.

Por tanto:

- bancos abdominales: `ONTOLOGY_MISMATCH`, no `ABDOMINAL_CRUNCH`;
- AbMat y ruedas: no capability automática;
- accesorios core/abdominales: no capability automática;
- una futura máquina `Abdominal Crunch` explícita podría recibir `DIRECT` sin cambiar la ontología.

No se eliminó ni se amplió la capability para cubrir “cualquier producto abdominal”.

## HIP_THRUST

Se conservaron 18 assignments explícitos de máquinas/bancos dedicados. Se rechazaron el cajón acolchado, la barra olímpica y la almohadilla como productos que facilitan el ejercicio, pero no son la capability autónoma. La frontera actual queda aceptada:

```text
dedicated machine/bench/station -> DIRECT
generic box, pad, belt, barbell, attachment -> no automatic assignment
```

## Deferred capabilities

| Candidate | Observed | Active | Direct-worthy | Supported-only | Recommendation |
|---|---:|---:|---:|---:|---|
| `SQUAT` | 53 | 20 | 11 | 14 rack rows | `REDEFINE` |
| `LEG_PRESS` | 6 | 0 | 5 | 0 | `KEEP_DEFERRED` |
| `BICEPS_CURL` | 5 | 2 | 2 | 0 | `KEEP_DEFERRED` |
| `GLUTE_KICKBACK` | 2 | 0 | 2 | 0 | `KEEP_DEFERRED` |
| `DEADLIFT` | 1 | 1 | 0 | 0 | `DROP` |
| `TRICEPS_EXTENSION` | 1 | 1 | 1 | 0 | `KEEP_DEFERRED` |

`SQUAT` mezcla racks, bancos, accesorios, packs, apparel y máquinas dedicadas. No se promueve por conteo. El subconjunto `Hack Squat` es más coherente como futura capability estrecha, pero requiere una decisión ontológica separada.

`LEG_PRESS` tiene cinco nombres de máquinas explícitas, pero todos los hallazgos son inactivos o históricos/unknown. Se conserva el gate `KEEP_LATER` de A00.2; no se agrega al registry V1 en este slice.

`BICEPS_CURL`, `GLUTE_KICKBACK` y `TRICEPS_EXTENSION` no alcanzan evidencia de disponibilidad/metadata suficiente para promoción. `Deadlift Jack Bar` se clasifica como accesorio de carga: no es `DEADLIFT`.

## Changes and readiness

- Registry changes: ninguno.
- Classifier change: sí, v1.1; se cerraron los ocho boundaries y se excluyeron barbell/pad de `HIP_THRUST`.
- Accepted manual capability decisions: 0 positivas; 8 cierres negativos documentados.
- Rejected review candidates: 7 `ONTOLOGY_MISMATCH` + 1 `REJECT`.
- Remaining `NEEDS_REVIEW`: 0.
- Remaining `INSUFFICIENT_EVIDENCE`: 44, sin candidatos positivos automáticos.
- Snapshot blocker: ninguno absoluto.

Validación: `npm run typecheck`; 36 tests A00.4 y 125 tests de regresión relacionados (`training-semantics-registry`, `commercial-product-ontology` y classifier comercial), todos correctos.

`A00.5` puede comenzar con deuda acotada: capabilities deferred sin promotion y `ABDOMINAL_CRUNCH` activo sin assignments. La primera publicación debe conservar esos estados y no convertirlos en cobertura implícita.
