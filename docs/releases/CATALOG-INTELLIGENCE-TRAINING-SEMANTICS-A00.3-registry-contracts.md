# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.3 — Registry + Contracts

Estado: implementado
Alcance: registry, contracts, validation, deterministic hashing/versioning y tests.

## Registry publicado

```text
registryVersion: training-semantic-registry-v1
registryHash:    82fcbe9a014522257ab8b2d460286d0c6ecbeffc6a01814d8d4e2f6b8849023f
status:          PUBLISHED
activeCapabilities: 13
```

El hash cubre únicamente el contenido semántico canónico: definitions, status, vocabularios y relaciones derivadas. La serialización ordena capabilities, códigos y arrays por código; no depende de timestamps, `createdFrom`, orden de inserción de objetos ni orden incidental de filesystem.

## Capabilities activas

```text
LEG_EXTENSION
LEG_CURL
HIP_THRUST
CHEST_PRESS
PEC_DECK
LAT_PULLDOWN
ROW
SHOULDER_PRESS
PULL_UP
DIP
ABDOMINAL_CRUNCH
ADDUCTOR
ABDUCTOR
```

No se incluyeron `LEG_PRESS`, `SQUAT`, `BENCH_PRESS`, `DEADLIFT`, `BICEPS_CURL`, `TRICEPS_EXTENSION`, `GLUTE_KICKBACK`, `CALF_RAISE` ni `BACK_EXTENSION`.

## Vocabularios derivados

Body regions:

```text
UPPER_BODY, LOWER_BODY, CORE, FULL_BODY
```

Muscle groups:

```text
CHEST, BACK, SHOULDERS, BICEPS, TRICEPS,
QUADRICEPS, HAMSTRINGS, GLUTES, CALVES, CORE
```

Training patterns:

```text
PRESS, PULL, KNEE_EXTENSION, KNEE_FLEXION, HIP_EXTENSION
```

`BODY_REGION`, `MUSCLE_GROUP` y `TRAINING_PATTERN` se derivan desde capability. No forman parte de product assignments persistidos. `ADDUCTOR` y `ABDUCTOR` conservan `derivedBodyRegions=LOWER_BODY`, pero no tienen mapping muscular en V1: A00.2 dejó esa decisión pendiente y no se inventó aquí.

`TRAINING_MODALITY` no pertenece al registry nuevo; se deriva de `PRODUCT_FAMILY`/Product Semantics cuando un consumer lo necesite. `TRAINING_GOAL` permanece fuera de V1.

## Contracts

El módulo separado está en `src/domain/training-semantics/` y exporta:

- registry y metadata;
- `TrainingCapabilityDefinition` y vocabularios code-safe;
- `ProductTrainingCapabilityAssignment` para una clasificación futura;
- `DIRECT`/`SUPPORTED`, confidence, evidence y review states;
- coverage separado: `NO_CAPABILITY_APPLICABLE`, `UNMODELED`, `INSUFFICIENT_EVIDENCE`, `NEEDS_REVIEW`;
- derivación pura mediante `deriveTrainingSemantics`;
- validación de registry, assignments y coverage;
- canonical serialization y SHA-256 estable.

El registry no contiene product IDs, assignments, scoring, pesos, customer concepts, ranking hints ni instrucciones del Sales Agent.

## Known debts

- `ADDUCTOR`/`ABDUCTOR` no tienen aún muscle mapping.
- `ROW`, `HIP_THRUST` y `ABDOMINAL_CRUNCH` requieren adjudicación específica de módulos, packs y accesorios en A00.4.
- `SUPPORTED` queda contractual y limitado; no existe un grafo de uso posible para barras, mancuernas, bancos o bandas.
- Los candidatos diferidos necesitan evidencia activa/revisión antes de entrar al registry.

## Exclusiones verificadas

Este release no modifica:

- `commercial-product-ontology-v3`;
- Product Semantic Snapshot o su publisher/reader;
- classifier o product assignments reales;
- endpoints HTTP o semantic discovery;
- search/recommendation ranking;
- Sales Agent, prompts, planner o tool selection;
- Customer Profile.

## Tests y validación

Ejecutado:

```text
npm run typecheck
npx vitest run --config vitest.config.ts tests/unit/training-semantics-registry.test.ts
npx vitest run --config vitest.config.ts \
  tests/unit/training-semantics-registry.test.ts \
  tests/unit/commercial-product-ontology-registry.test.ts \
  tests/unit/product-semantic-classification-classifier.test.ts
```

Resultado: typecheck correcto; 3 archivos de test y 125 tests correctos. El regression guard exige exactamente 13 capabilities activas.

## Próximo release

`A00.4 — Training Semantic Classification Rules`

A00.4 podrá asignar `DIRECT`/`SUPPORTED` a productos usando nombre, categoría confiable, features y overrides. No debe convertir automáticamente family general, conocimiento externo o descripción de marketing en capabilities.
