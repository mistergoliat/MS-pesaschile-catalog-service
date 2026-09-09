# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.4 — Classification Rules

Estado: implementado como classifier offline; la adjudicación A00.4.1 dejó una versión v1.1 sin publicación de snapshot.

## Versiones y límites

```text
classifierVersion: training-semantic-classifier-v1.1
rulesHash:         83007958a40fd29a87eb01d1fe159812587876c5e57295d7344024bda0123248
registryVersion:   training-semantic-registry-v1
registryHash:      82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f
```

El classifier vive en `src/domain/training-semantic-classification/`. No modifica `src/domain/training-semantics/registry.ts`, `commercial-product-ontology-v3`, Product Semantic Snapshot, ranking, Sales Agent ni Customer Profile.

## Contrato y policy

Cada producto produce `assignments`, `coverageStatus`, `reviewCandidates`, `warnings` y `deferredFindings`. Los assignments automáticos sólo pueden ser `DIRECT`/`SUPPORTED` con confianza `EXPLICIT` o `HIGH`. `MEDIUM`/`LOW` no se convierten automáticamente en truth.

Fuentes automáticas admitidas: nombre, categoría confiable y feature estructurada semántica. La descripción libre, marketing, categorías de campaña/navegación, family genérica y conocimiento externo no son evidencia positiva.

La cobertura respeta esta precedencia:

1. `NEEDS_REVIEW` para candidatos `MEDIUM`/`LOW` o más de seis assignments.
2. `NO_CAPABILITY_APPLICABLE` para familias/productos claramente fuera de capability.
3. `INSUFFICIENT_EVIDENCE` para lenguaje candidato débil.
4. `UNMODELED` para productos no resolubles sin inventar capabilities.

Un producto con assignments puede conservar `UNMODELED`: indica que no existe una declaración de cobertura exhaustiva fuera de las capabilities explícitas detectadas.

## Ejecución sobre catálogo

Comando:

```text
npm run product:training-semantics:classify
```

El run procesó 2.011 filas válidas del export y generó artefactos en `docs/audits/training-semantics/a00.4/`.

### Coverage

| Status | Count |
|---|---:|
| `NO_CAPABILITY_APPLICABLE` | 881 |
| `UNMODELED` | 1.086 |
| `INSUFFICIENT_EVIDENCE` | 44 |
| `NEEDS_REVIEW` | 0 |

### Assignments

| Capability | Count |
|---|---:|
| `ABDUCTOR` | 9 |
| `ADDUCTOR` | 7 |
| `CHEST_PRESS` | 7 |
| `DIP` | 21 |
| `HIP_THRUST` | 18 |
| `LAT_PULLDOWN` | 24 |
| `LEG_CURL` | 20 |
| `LEG_EXTENSION` | 11 |
| `PEC_DECK` | 1 |
| `PULL_UP` | 31 |
| `ROW` | 25 |
| `SHOULDER_PRESS` | 6 |
| `ABDOMINAL_CRUNCH` | 0 |

Total: 180 assignments; 157 `DIRECT`, 23 `SUPPORTED`; 23 productos tienen más de un assignment.

## Review y debt

Los ocho candidatos iniciales de A00.4 fueron adjudicados en A00.4.1: siete `ONTOLOGY_MISMATCH` de `ABDOMINAL_CRUNCH` y un `REJECT` de `HIP_THRUST`. Ya no quedan `NEEDS_REVIEW`.

Los deferred findings detectados fueron: `SQUAT` 53, `LEG_PRESS` 6, `BICEPS_CURL` 5, `GLUTE_KICKBACK` 2, `DEADLIFT` 1 y `TRICEPS_EXTENSION` 1. Ninguno fue mapeado a una capability V1.

Límites deliberados: no se asigna `ROW` a cardio rowers, no se asigna `LAT_PULLDOWN` a una cable machine genérica, no se asigna `PULL_UP` a un rack sin módulo, no se asigna `CHEST_PRESS` a un bench y no se asigna `ABDOMINAL_CRUNCH` a rueda/AbMat.

## Tests y regresión

Ejecutado:

```text
npm run typecheck
npx vitest run --config vitest.config.ts tests/unit/training-semantic-classification.test.ts
```

Resultado: typecheck correcto; 36 tests A00.4 correctos. El test verifica invariancia al ordenar categorías/features, los cuatro estados de cobertura, evidencia por módulo, relaciones `DIRECT`/`SUPPORTED`, boundaries negativas y el hash publicado del registry.

## Decisión final

```text
TRAINING_SEMANTIC_CLASSIFIER_READY_WITH_DEBT
```

El classifier está listo para aceptación con deuda acotada y genera resultados reproducibles/auditables. `A00.5` puede comenzar con las capabilities deferred fuera del registry y `ABDOMINAL_CRUNCH` activo sin assignments; el registry V1 permanece intacto.
