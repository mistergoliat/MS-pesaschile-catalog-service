# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.2 — Ontology & Capability Model Design

Fecha: 2026-09-03
Tipo: diseño únicamente. No implementa runtime, registry, classifier, snapshot, API, ranking, prompts, tool selection, Sales Agent ni Customer Profile.

## 1. Decisión

`TRAINING_SEMANTICS_ONTOLOGY_DESIGN_READY_WITH_DEBT`

Siguiente release: `A00.3 — Training Semantics Registry + Contracts`.

La deuda concreta antes de A00.3 es una adjudicación humana acotada de nombres compuestos, accesorios, packs y productos multifunción. El catálogo real sí permite diseñar una capa precisa de capabilities funcionales; no permite publicar una taxonomía muscular amplia ni convertir el uso teórico de una familia en Product Truth.

Modelo central recomendado:

```text
Product
  -> DIRECT EXERCISE_CAPABILITY (evidence-backed)

Training capability registry
  -> derived BODY_REGION
  -> derived MUSCLE_GROUP
  -> derived TRAINING_PATTERN
```

Catalog responde “qué puede afirmar este producto explícita o confiablemente”. El LLM responde qué quiere el cliente y razona sobre la evidencia; Catalog no almacena intención, workouts ni optimalidad individual.

## 2. Autoridad y límites

Fuentes usadas: audit A00, muestra de 60 productos, `commercial-product-ontology-v3`, snapshot/contracts vigentes, export de 2.011 productos y los category/feature trust maps.

Se preservan las decisiones A00:

| Eje | Decisión de diseño |
|---|---|
| `EXERCISE_CAPABILITY` | `KEEP_V1`, entidad central |
| `BODY_REGION` | `DERIVE`, vocabulario pequeño |
| `MUSCLE_GROUP` | `DERIVE`, desde capability |
| `TRAINING_PATTERN` | `DERIVE`, no Product Fact amplio |
| `TRAINING_MODALITY` | derivar desde Product Semantics, no nueva dimensión V1 |
| `TRAINING_GOAL` | `DROP` |
| producto → músculo directo | no recomendado |
| snapshot | separado del Product Semantic Snapshot actual |

No se modifica `PRODUCT_FAMILY`, `DISCIPLINE`, `USE_CONTEXT`, v3, A01 ni el snapshot comercial.

## 3. Entidad central y granularidad

El eje canónico se llama `EXERCISE_CAPABILITY`; el tipo TypeScript puede llamarse `TrainingCapabilityCode`. Una capability es una función de diseño del producto útil para discovery, no una receta ni un ejercicio óptimo.

Ejemplos: `LAT_PULLDOWN` significa que el producto está diseñado para esa función; no significa que sea óptimo para todo usuario ni que sólo trabaje un músculo.

V1 agrupa variantes técnicas:

```text
ROW       incluye SEATED_ROW, LOW_ROW y T_BAR_ROW
LEG_CURL  incluye seated/lying como modifier/evidence
CHEST_PRESS incluye incline/decline como modifier/evidence
```

No se crean códigos por ángulo, orientación, número de estaciones, serie, fabricante, agarre o variante de carga. Un modifier sólo se separa en una versión posterior si existe como atributo confiable, cambia el resultado de discovery y tiene cobertura activa suficiente.

## 4. Product Truth directo

`DIRECT` significa que el catálogo declara una capability como función de diseño del SKU, con evidencia trazable y específica. No significa que la capability sea posible mediante creatividad del usuario.

Requisitos:

1. evidencia en nombre, categoría confiable, feature estructurada u override humano aprobado;
2. coherencia con family/configuración;
3. wording que describa la función del producto, no sólo compatibilidad o marketing;
4. capability en granularidad canónica;
5. estado de revisión publicable.

Ejemplos: `Extensión de Cuádriceps → LEG_EXTENSION`, `Lat Pulldown → LAT_PULLDOWN`, `Press de Pectoral → CHEST_PRESS`, `Contractora de Pectoral → PEC_DECK`.

Fuentes válidas: nombre explícito, categoría semántica confiable, feature funcional explícita y `MANUAL_OVERRIDE`. Fuentes débiles: descripción genérica/marketing, “se puede usar para”, family general, conocimiento externo, pack donde la función pertenece a otro componente y accesorio que sólo facilita el ejercicio.

## 5. `SUPPORTED`

La opción V1 es `DIRECT + SUPPORTED` **limitado**. `SUPPORTED` sólo se publica cuando la configuración o ficha estructurada declara una compatibilidad acotada.

```text
Barra Pull Ups Multigrip -> PULL_UP DIRECT
Rack con módulo de dominadas explícito -> PULL_UP SUPPORTED
Rack con soporte de fondos explícito -> DIP SUPPORTED/DIRECT según wording
```

No se publica automáticamente:

```text
BARBELL  -> SQUAT + BENCH_PRESS + DEADLIFT
DUMBBELL -> todos los curls, presses y rows
BENCH    -> CHEST_PRESS
BAND     -> todos los ejercicios
```

`SUPPORTED` no es un grafo biomecánico completo: expresa una función/configuración documentada, no todo lo que un usuario podría hacer.

## 6. Inventario candidato basado en catálogo

Los conteos son candidatos léxicos en `name`, no assignments aceptados. Se auditaron 2.011 filas; `active` es el subconjunto `active=1`. La columna “decisión” es de diseño.

| Code | Nombre | Conteo | Activos | Ejemplos | Decisión |
|---|---|---:|---:|---|---|
| `LEG_PRESS` | Leg press | 6 | 0 | 451 Leg Press 45°, 1227 Leg Press Solid Rock | `KEEP_LATER` |
| `LEG_EXTENSION` | Leg extension | 8 | 3 | 1269 Extensión de Cuádriceps, 492 Extensión V8 | `KEEP_V1` |
| `LEG_CURL` | Leg curl | 17 | 6 | 279 Curl Femoral, 1619 pack dúo | `KEEP_V1` |
| `HIP_THRUST` | Hip thrust | 31 | 19 | 1125 Cajón, 1337 Banco Hip Thrust | `KEEP_V1` |
| `CHEST_PRESS` | Chest press | 7 | 2 | 271 Press de Pectoral, 1265 Press MO 2.0 | `KEEP_V1` |
| `PEC_DECK` | Pec deck/contractora | 1 | 0 | 272 Contractora de Pectoral | `KEEP_V1` |
| `LAT_PULLDOWN` | Lat pulldown | 5 | 2 | 176 Crossover, 899 Lat Pulldown | `KEEP_V1` |
| `ROW` | Row | 33 | 14 | 1506 Polea/Remo, 1885 Remo Sentado | `KEEP_V1` |
| `SHOULDER_PRESS` | Shoulder press | 6 | 2 | 259 Press de Hombro, 1500 Press MO 2.0 | `KEEP_V1` |
| `BICEPS_CURL` | Biceps curl | 2 | 0 | 256 Curl de Bíceps, 488 Curl V8 | `KEEP_LATER` |
| `TRICEPS_EXTENSION` | Triceps extension | 3 | 1 | 258 Extensión de Tríceps, 490 Press V8 | `KEEP_LATER` |
| `PULL_UP` | Pull-up/dominada | 28 | 16 | 12 Barra Pull Ups, 1501 Dominada asistida | `KEEP_V1` |
| `DIP` | Dip/fondo | 11 | 7 | 1119 soporte para fondos, 1856 Pull Up/Dip | `KEEP_V1` |
| `SQUAT` | Squat | 70 | 24 | 1272 Hack Squat, 746 Squat Rack | `KEEP_LATER` |
| `BENCH_PRESS` | Bench press | 1 | 0 | 987 Pack Press de Banco Home | `KEEP_LATER` |
| `DEADLIFT` | Deadlift | 1 | 1 | 1354 Deadlift Jack | `KEEP_LATER` |
| `CALF_RAISE` | Calf raise | 0 | 0 | sin nombre explícito | `KEEP_LATER` |
| `ABDOMINAL_CRUNCH` | Abdominal crunch | 16 | 6 | 1280 Banco Abdominal, 151 AbMat | `KEEP_V1` |
| `BACK_EXTENSION` | Back extension | 0 | 0 | sin nombre explícito | `KEEP_LATER` |
| `GLUTE_KICKBACK` | Glute kickback | 2 | 0 | 282, 1384 Patada de Glúteo | `KEEP_LATER` |
| `ADDUCTOR` | Adductor | 5 | 3 | 1505 Dual, 497 Dual V8 | `KEEP_V1` |
| `ABDUCTOR` | Abductor | 9 | 4 | 1505 Dual, 497 Dual V8 | `KEEP_V1` |

Los conteos incluyen falsos positivos posteriores por accessory, pack, historical-only y wording ambiguo. En especial `ROW`, `SQUAT`, `HIP_THRUST` y `ABDOMINAL_CRUNCH` necesitan boundary rules.

El inventario reproducible está en [`candidate-capability-registry.csv`](./training-semantics/candidate-capability-registry.csv); sus conteos son los mismos de esta tabla y sus decisiones aún son de diseño, no assignments publicados.

### V1 mínima

```text
LEG_EXTENSION, LEG_CURL, HIP_THRUST, CHEST_PRESS, PEC_DECK,
LAT_PULLDOWN, ROW, SHOULDER_PRESS, PULL_UP, DIP,
ABDOMINAL_CRUNCH, ADDUCTOR, ABDUCTOR
```

`LEG_PRESS`, `SQUAT`, `BENCH_PRESS`, `DEADLIFT`, `BICEPS_CURL`, `TRICEPS_EXTENSION`, `GLUTE_KICKBACK`, `CALF_RAISE` y `BACK_EXTENSION` quedan como candidatos, no como V1 publicada.

## 7. Derivaciones

### Body region

Vocabulario V1: `UPPER_BODY`, `LOWER_BODY`, `CORE`, `FULL_BODY`. Es multi-label y se deriva del capability. No se persiste repetido en cada product fact.

```text
CHEST_PRESS, PEC_DECK, SHOULDER_PRESS, LAT_PULLDOWN, ROW, PULL_UP, DIP -> UPPER_BODY
LEG_PRESS, LEG_EXTENSION, LEG_CURL, HIP_THRUST, ADDUCTOR, ABDUCTOR -> LOWER_BODY
ABDOMINAL_CRUNCH -> CORE
```

`FULL_BODY` sólo se admite por una relación de registry explícita; no es sinónimo de “multifunción” ni se deriva de una family general. `DEADLIFT`, si entra, requerirá una policy explícita para `LOWER_BODY + FULL_BODY`.

### Muscle group

Vocabulario V1: `CHEST`, `BACK`, `SHOULDERS`, `BICEPS`, `TRICEPS`, `QUADRICEPS`, `HAMSTRINGS`, `GLUTES`, `CALVES`, `CORE`.

`ADDUCTORS`, `ABDUCTORS`, `FOREARMS` y `LOWER_BACK` quedan fuera de la taxonomía muscular V1. Las capabilities `ADDUCTOR`/`ABDUCTOR` pueden existir como función de station, pero su mapping anatómico requiere revisión adicional.

El registry puede declarar primary/secondary, no pesos:

```text
LEG_EXTENSION -> primary QUADRICEPS
LEG_CURL -> primary HAMSTRINGS
HIP_THRUST -> primary GLUTES
CHEST_PRESS -> primary CHEST; secondary TRICEPS, SHOULDERS
LAT_PULLDOWN / ROW -> primary BACK; secondary BICEPS
```

Estos mappings son derivados y versionados, no assignments directos. `MUSCLE_GROUP` no se repite por producto salvo override humano excepcional.

### Training pattern

Patterns derivados V1: `PRESS`, `PULL`, `KNEE_EXTENSION`, `KNEE_FLEXION`, `HIP_EXTENSION`. `SQUAT` y `HINGE` quedan posteriores por su ambigüedad con racks/barras; `CARRY`, `ROTATION` y `LOCOMOTION` quedan fuera V1 por falta de Product Truth útil.

```text
CHEST_PRESS, SHOULDER_PRESS, DIP -> PRESS
LAT_PULLDOWN, ROW, PULL_UP -> PULL
LEG_EXTENSION, LEG_PRESS -> KNEE_EXTENSION
LEG_CURL -> KNEE_FLEXION
HIP_THRUST -> HIP_EXTENSION
```

No se asignan patterns a barra, mancuerna, banco o banda por uso teórico.

### Training modality

No se crea dimensión nueva V1. Se deriva como proyección cuando un consumer la necesite:

```text
BARBELL/DUMBBELL/KETTLEBELL -> FREE_WEIGHT
CABLE_MACHINE -> CABLE
SELECTORIZED_MACHINE/PLATE_LOADED_MACHINE -> MACHINE
BODYWEIGHT_GYMNASTICS -> BODYWEIGHT
CARDIO_MACHINE -> CARDIO
```

Esto evita duplicar `PRODUCT_FAMILY` como tags paralelos. `FUNCTIONAL` no es universal y no se asigna sólo por marketing.

### Training goal

`TRAINING_GOAL` queda `DROP`: `STRENGTH`, `HYPERTROPHY`, `POWER`, `CONDITIONING`, `ENDURANCE`, `MOBILITY` y `REHABILITATION` dependen de programa, usuario, carga y contexto. `REHABILITATION` puede estar expresada en `DISCIPLINE`/`USE_CONTEXT`, pero no se duplica como goal de SKU.

## 8. Relation types, confidence y graph

```text
DIRECT       evidence-backed Product -> capability
SUPPORTED    configuración/evidence explícita y acotada
DERIVED      capability -> region/muscle/pattern desde registry
NOT_MODELLED ausencia, evidencia insuficiente o boundary ambigua
```

`PRIMARY`/`SECONDARY` sólo clasifican relevancia capability → muscle. No son relation types de producto y no son porcentajes.

Confidence propuesta: `EXPLICIT`, `HIGH`, `MEDIUM`, `LOW`. La asigna regla/classifier o reviewer; no el LLM en consulta. `DIRECT`/`SUPPORTED` automáticos requieren `EXPLICIT`/`HIGH`; `MEDIUM`/`LOW` pasan a `NEEDS_REVIEW`.

`classificationConfidence` es distinto de `trainingRelevance`. No se almacenan floats como `CHEST=0.83`.

El canonical graph no es un árbol anatómico:

```text
CAPABILITY --derivesTo--> BODY_REGION
CAPABILITY --targetsPrimary/Secondary--> MUSCLE_GROUP
CAPABILITY --followsPattern--> TRAINING_PATTERN
```

`MUSCLE_GROUP belongsTo BODY_REGION` puede ser una agrupación de UI, no una jerarquía normativa; permite evitar problemas como grupos que pertenecen a más de una región.

## 9. Casos difíciles y policy

| Caso | Direct | Supported | Derived | Decisión |
|---|---|---|---|---|
| Olympic barbell (`BARBELL`) | ninguna por family | sólo configuración explícita | ninguno | no músculos/patterns generales |
| Hex dumbbell (`DUMBBELL`) | ninguna por family | sólo evidence específica | ninguno | no todos los ejercicios |
| Adjustable bench (`BENCH`) | ninguna por family | bench press/hip thrust sólo documentado | desde capability aceptada | no equivale a chest press |
| Power rack (`RACK_CAGE`) | pull-up si módulo lo declara | squat/dip si soporte explícito | ninguno por family | soporta; no ejecuta automáticamente |
| Cable crossover (`CABLE_MACHINE`) | módulos nombrados | otros módulos documentados | desde capability | polea genérica no es todo |
| Lat pulldown | `LAT_PULLDOWN` | ninguna adicional | upper/back/pull | nombre específico |
| Multifunction machine | una por módulo explícito | sólo módulos/evidence | unión de derivaciones | revisar si supera 6 capabilities |
| Leg press | `LEG_PRESS` sólo wording específico | ninguna por family | lower/knee extension | candidatos activos débiles |
| Leg extension | `LEG_EXTENSION` | ninguna | lower/quadriceps/knee extension | alta prioridad |
| Leg curl | `LEG_CURL` | ninguna | lower/hamstrings/knee flexion | separar pack/módulo |
| Smith machine | ninguna por “Smith” | squat/press documentado | ninguno por family | no músculo directo |
| Kettlebell | ninguna por family | sólo evidence específica | ninguno | implemento multiuso |
| Resistance band | ninguna por family | pull-up assist documentado | ninguno | facilita != equipo autónomo |
| Chest press | `CHEST_PRESS` | ninguna | upper/chest/press | alta prioridad |
| Pec deck | `PEC_DECK` | ninguna | upper/chest/press | evidencia escasa pero clara |
| Seated row | `ROW` | variante fuera de code | upper/back/pull | canonicalizar a ROW |
| Shoulder press | `SHOULDER_PRESS` | ninguna | upper/shoulders/press | nombre explícito |
| Hip thrust | `HIP_THRUST` si station/banco dedicado | ninguna | lower/glutes/hip extension | cajón/attachment requiere review |
| Calf raise | no V1 | futura evidence | futura | no nombre explícito |
| Abdominal machine | `ABDOMINAL_CRUNCH` si station coherente | ninguna | core | distinguir AbMat/banco |
| Attachment/accessory | ninguna por defecto | sólo función autónoma explícita | ninguno | `NOT_MODELLED` normalmente |

### Packs y multifunción

Un producto puede tener múltiples capabilities `DIRECT` si cada una tiene evidencia propia y, cuando aplica, `moduleId`. “Multifunción”, “full body” o “many exercises” no crean assignments. Más de 6 capabilities directas exige revisión. Un pack barra + discos + banco no obtiene `BENCH_PRESS` automáticamente; los componentes conservan sus propios Product Truth.

### Accesorios

`MACHINE_ATTACHMENT`, handles, bands, straps, platforms, storage y protective gear no reciben músculo/capability por defecto. Sólo un SKU autónomo y explícito puede ser excepción. “Facilitates exercise” no equivale a “is equipment for exercise”.

## 10. Registry y product assignment

Estructura conceptual:

```text
TrainingSemanticRegistry {
  schemaVersion
  registryVersion
  hash
  capabilities[]
  bodyRegions[]
  muscleGroups[]
  trainingPatterns[]
  modalityDerivations[]
  relationships[]
}
```

`CapabilityDefinition` requiere `code`, `canonicalName`, `description`, evidence permitida, status y relaciones derivadas. Se prefieren relaciones explícitas si requieren provenance.

Contrato de assignment futuro:

```ts
type TrainingRelationType = 'DIRECT' | 'SUPPORTED' | 'DERIVED' | 'NOT_MODELLED';
type TrainingClassificationConfidence = 'EXPLICIT' | 'HIGH' | 'MEDIUM' | 'LOW';
type TrainingReviewState =
  | 'AUTO' | 'HUMAN_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'MANUAL_OVERRIDE';

type ProductTrainingCapabilityAssignment = {
  productId: string;
  capabilityCode: string;
  relationType: 'DIRECT' | 'SUPPORTED';
  classificationConfidence: TrainingClassificationConfidence;
  evidence: readonly TrainingSemanticEvidence[];
  reviewState: TrainingReviewState;
  moduleId?: string;
  modifierCodes?: readonly string[];
  provenance: TrainingAssignmentProvenance;
};

type TrainingSemanticEvidence = {
  kind: 'NAME' | 'TRUSTED_CATEGORY' | 'STRUCTURED_FEATURE' | 'MANUAL_OVERRIDE';
  sourceId?: string;
  matchedText?: string;
  ruleId?: string;
  note?: string;
};
```

Las relaciones `DERIVED` viven en el registry/proyección, no en la lista de facts positivos. `NOT_MODELLED` es estado de cobertura, no un capability code.

## 11. Snapshot y overrides

Decisión: `TRAINING_SEMANTICS_SEPARATE`.

Un `TrainingSemanticSnapshot` tendrá `snapshotId`, `semanticChecksum`, registry version/hash, classifier version, timestamps, assignments, review state, provenance, overrides y estados de cobertura. Puede enlazar `sourceProductSemanticSnapshotId`, pero no comparte automáticamente lifecycle ni población con el snapshot comercial.

Separarlo preserva A01 y los parsers actuales, permite cadence/review propio y hace visible la diferencia entre `DIRECT`, `SUPPORTED` y `DERIVED`.

Overrides futuros:

```text
MANUAL_OVERRIDE > ACCEPTED/REJECTED human decision > AUTO > candidate
```

El override es por relación capability-product, con `overrideId`, actor, fecha, razón y evidence. Un rebuild automático no lo sobrescribe. Si el capability se retira, el override queda `UNRESOLVED` y requiere adjudicación; no se remapea silenciosamente.

## 12. Unknown, review y clasificación inicial

Training Semantics distingue:

```text
NO_CAPABILITY_APPLICABLE
UNMODELED
INSUFFICIENT_EVIDENCE
NEEDS_REVIEW
```

`OTHER` de Product Family no se reutiliza. La ausencia de capability no es error: flooring/storage/apparel pueden ser productos válidos sin capability de entrenamiento.

Pipeline A00.3:

1. reglas deterministas sobre nombre y features estructuradas;
2. trusted category mappings;
3. nombre explícito de capability;
4. family sólo para contexto o `SUPPORTED` muy acotado;
5. LLM opcional como propuesta de adjudicación, nunca autoridad;
6. validación humana de activos, high-revenue, máquinas específicas, packs y `OTHER`;
7. publicar sólo assignments aceptados y conservar `UNKNOWN`/`UNMODELED`.

La descripción libre no es fuente fuerte V1. La muestra de A00 tiene 60 filas únicas y cubre activos, high revenue, máquinas específicas, multiuso, borderline, históricos y `OTHER`; debe usarse para validar los thresholds. Las columnas finales de revisión propuestas son:

```text
productId, name, productFamily, candidateCapabilities,
acceptedCapabilities, relationTypes, evidence, reviewState, notes
```

## 13. Compatibilidad y tests

No se modifica ningún runtime ni contrato existente. La integración futura debe primero publicar/validar registry y contracts; después clasificar un subset de alta precisión; y sólo después diseñar semantic discovery.

Tests futuros:

- codes/names únicos y references conocidas;
- relaciones válidas y sin ciclos;
- evidence obligatoria para `DIRECT`;
- boundary de `SUPPORTED` y rechazo de family inference genérica;
- primary/secondary válidos;
- hash, snapshot y derivation deterministas;
- override precedence;
- unknown/unmodeled/review states;
- module evidence en multifunción;
- packs sin capabilities inventadas;
- accesorios y equipos genéricos no sobreclasificados.

## 14. Decision matrix y anti-patterns

| Área | Decisión |
|---|---|
| `EXERCISE_CAPABILITY` | `CORE_V1` |
| `BODY_REGION` | `DERIVE` |
| `MUSCLE_GROUP` | `DERIVE` |
| `TRAINING_PATTERN` | `DERIVE` |
| `TRAINING_MODALITY` | `DERIVE` desde Product Semantics |
| `TRAINING_GOAL` | `DROP` |
| `SUPPORTED RELATIONS` | `LIMITED_V1` |
| `TRAINING SNAPSHOT` | `SEPARATE` |

Prohibido:

```text
BARBELL -> all muscle groups
DUMBBELL -> all exercises
generic PRODUCT_FAMILY -> arbitrary capability
LLM world knowledge -> Product Truth without evidence
CHEST = 0.83 -> Product Truth
customer intent -> stored in Catalog
Sales Agent rules -> stored in ontology
```

La propuesta final conserva precisión y auditabilidad: “este producto explicita estas capabilities”, y el registry deriva regiones, grupos y patterns. No afirma que un producto genérico entrene todo músculo teóricamente posible.
