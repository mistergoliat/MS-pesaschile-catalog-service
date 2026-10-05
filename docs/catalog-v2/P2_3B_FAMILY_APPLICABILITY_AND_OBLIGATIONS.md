# P2.3B — Family Applicability & Obligation Resolution

P2.3B publica `semantic-obligations-v2` para evaluación offline. El formato nuevo tiene `schemaVersion=2`, `contractVersion`, `ontologyVersion`, `ontologyHash` y `contentHash` determinista. V1 permanece disponible con hash `sha256:640d5f3f9015b79ceeb405eb0b54269da9849e37f5184eb8c56954d7030e805f`; los evaluadores siguen seleccionando v1 por defecto. Ningún consumidor runtime importa este dominio, ni se publica un bundle o se cambia un pointer.

## Metodología y jerarquía de fuentes

1. La ontología versionada define identidad, fuentes aceptadas, evidence gates, política histórica y exclusiones. Sus 21 tags no residuales son las familias del contrato. OTHER, BAND y familias ausentes/nuevas usan default UNKNOWN, sin alias ni extrapolaciones.
2. El registry Training V2 define vocabulario ACTIVE y derivaciones autorizadas. Existe una sola derivación familiar: CABLE_MACHINE → CABLE_RESISTANCE. No hay derivaciones de Exercise.
3. Las reglas V1/V2/V2.1 existentes prueban obligaciones condicionales desde NAME, categorías gobernadas y features estructuradas. Se reutilizan sus matchers puros, sin cambiar classifiers o construir uno nuevo. La adjudicación A00.6.4 explicita qué funciones genéricas quedan fuera del mínimo modelado. Las policies A00.6.7 adjudican contenido por producto, no obligaciones universales por familia.
4. `buildSpecs` y el contrato P1.3 definen una promesa limitada de normalización. No establecen una ficha técnica universal. Los Trust Maps gobiernan las fuentes que efectivamente se usan; publicarlos no prueba autoridad de consumo.
5. Canonical source, snapshots, tests y audit sirven para verificar bindings, conflictos, frecuencia y consecuencias. La frecuencia describe disponibilidad y nunca crea una obligación o exención.

Las referencias concretas están en cada dimensión/key y en `family-applicability-inventory.json`. La auditoría valida hashes/schema/lineage de inputs antes de evaluar y conserva el fingerprint completo de artifacts/data y los outputs anteriores. No se consultan web ni fabricantes ni conocimiento general de equipamiento.

## Matriz de aplicabilidad

PRODUCT_SEMANTICS es REQUIRED para las 21 familias reconocidas: la identidad y todos los facts emitidos necesitan satisfacer los gates existentes. Los ejes vacíos DISCIPLINE/USE_CONTEXT no se convierten en requisitos ni negativas. La auditoría revisa cada tag, evidence kinds, weak categories, residual OTHER, non-products y conflictos históricos de explicit-name/family-inference. Una clasificación débil/parcial sigue parcial; exigir identidad no demuestra que el contenido la satisfaga.

En la tabla, C/U significa CONDITIONAL por regla fuente aceptada, con UNKNOWN cuando no hay una regla concluyente. C/N significa la misma condición, con NOT_REQUIRED en la rama falsa respaldada por política explícita. Weak review candidates hacen la condición no evaluable, nunca falsa. No se usa la presencia de assignments ni SEMANTIC_COMPLETE como condición.

| Familia | Product | Exercise | Function | Specs | Trust | Status |
|---|---|---|---|---|---|---|
| BARBELL | REQUIRED | C/N | C/N | C/U | CONDITIONAL | PROVISIONAL |
| WEIGHT_PLATE | REQUIRED | C/U | C/N | C/U | CONDITIONAL | PROVISIONAL |
| DUMBBELL | REQUIRED | C/N | C/N | C/U | CONDITIONAL | PROVISIONAL |
| KETTLEBELL | REQUIRED | C/U | C/N | C/U | CONDITIONAL | PROVISIONAL |
| BENCH | REQUIRED | C/N | C/N | C/U | CONDITIONAL | PROVISIONAL |
| RACK_CAGE | REQUIRED | C/U | C/U | C/U | CONDITIONAL | PROVISIONAL |
| CABLE_MACHINE | REQUIRED | C/U | REQUIRED: CABLE_RESISTANCE | C/U | CONDITIONAL | PROVISIONAL |
| PLATE_LOADED_MACHINE | REQUIRED | C/U | C/U | C/U | CONDITIONAL | PROVISIONAL |
| SELECTORIZED_MACHINE | REQUIRED | C/U | C/U | C/U | CONDITIONAL | PROVISIONAL |
| CARDIO_MACHINE | REQUIRED | C/U | C/U | C/U | CONDITIONAL | PROVISIONAL |
| FLOORING | REQUIRED | C/N | C/U | C/U | CONDITIONAL | PROVISIONAL |
| STORAGE | REQUIRED | C/N | C/U | C/U | CONDITIONAL | PROVISIONAL |
| BALL_BAG | REQUIRED | C/U | C/U | C/U | CONDITIONAL | PROVISIONAL |
| ROPE_SLED | REQUIRED | C/U | C/N | C/U | CONDITIONAL | PROVISIONAL |
| BAND_SUSPENSION | REQUIRED | C/U | C/N | C/U | CONDITIONAL | PROVISIONAL |
| BODYWEIGHT_GYMNASTICS | REQUIRED | C/U | C/U | C/U | CONDITIONAL | PROVISIONAL |
| PROTECTIVE_GEAR | REQUIRED | C/N | C/U | C/U | CONDITIONAL | PROVISIONAL |
| MACHINE_ATTACHMENT | REQUIRED | C/U | C/N | C/U | CONDITIONAL | PROVISIONAL |
| RECOVERY_TOOL | REQUIRED | C/U | C/U | C/U | CONDITIONAL | PROVISIONAL |
| YOGA_PILATES | REQUIRED | C/U | C/U | C/U | CONDITIONAL | PROVISIONAL |
| APPAREL | REQUIRED | C/U | C/U | C/U | CONDITIONAL | PROVISIONAL |

Las seis exenciones genéricas Exercise corresponden exactamente a familias ontológicas de `trainingSemanticRuleCatalog.nonApplicableFamilies` y `determineCoverageStatus`. BAND es un token histórico de esas listas y no exime a BAND_SUSPENSION. Las ocho ramas Function C/N corresponden a las filas DO_NOT_ADD/no-family-wide-function del análisis A00.6.4. Las reglas positivas explícitas siguen teniendo prioridad: un set DUMBBELL con NAME "Rack" puede activar BARBELL_SUPPORT, aunque no exista obligación funcional genérica para todos los dumbbells.

Cuando una regla fuente activa Training, todos sus códigos aceptados forman el required set, incluyendo módulos duales. Exercise y Function se evalúan de forma independiente; una función resuelta no satisface Exercise. No tener un match no implica una exención fuera de las políticas citadas. Las fuentes ausentes, mappings/hash no verificables y candidatos débiles mantienen UNKNOWN. No se generan nuevas policies Training.

## Specs por key y conocimiento adicional

Cada familia tiene seis `SpecRequirement`: `specKey`, requirement, condición tipada, whenFalse, acceptedSourceIds, rationale, sourceReferences y política negativa. Se validan keys/sources reales, duplicados y coherencia de condición. REQUIRED a nivel dimensional necesita keys REQUIRED explícitas.

| Key | Feature IDs aceptados | Condición de la promesa |
|---|---|---|
| max_user_weight_kg | 11 | Fuente 11 presente |
| max_load_kg | 12, 41 | Alguna fuente 12/41 presente |
| weight_kg | 3 | Fuente 3 presente |
| assembled_length_cm | 15 | Fuente 15 presente |
| assembled_width_cm | 15 | Fuente 15 presente |
| assembled_height_cm | 15 | Fuente 15 presente |

Dentro de esa promesa, una fuente presente activa la obligación de publicar cada key correspondiente, con valor/unidad válidos, evidence y binding a feature/value/product/presence. Fuente ausente significa que **esa promesa de normalización** está inactiva: NOT_REQUIRED para esa key dentro de ese alcance. La aplicabilidad técnica básica de la familia continúa UNKNOWN si no hay ninguna fuente soportada. Esta distinción conserva UNKNOWN en SPECS y evita interpretar ausencia como exención universal.

No se requieren automáticamente features TECHNICAL adicionales. Tampoco se inventan keys para manga, geometría, materiales, configuración o datos del fabricante. Los datos existentes permanecen disponibles para Product Manager, contenido, soporte, `catalog.compose` y consumidores futuros; disponibilidad no es obligación. Sin autoridad contractual, un dato difícil/inexistente permanece UNKNOWN. Falta de una key realmente requerida produce DATA_GAP; una key no requerida ausente no produce ese gap.

Se evalúan conflictos por key, reconstruyendo los candidatos numéricos del snapshot sin modificarlo. Los mismos 82 IDs siguen identificados como SOURCE_CONFLICT observado. Una key REQUIRED o CONDITIONAL activa con conflicto bloquea su filtro y la consolidación que depende de ella. Un filtro por otra key válida, Product Context y Product Discovery pueden seguir admitidos. Eximir una key no elimina ni oculta su conflicto disponible.

## Trust y evidencia negativa

TRUST_EVIDENCE_USED es una condición tipada. La conclusión usa Trust si Product/Training fact evidence o una regla fuente que activa una obligación depende de TRUSTED_CATEGORY/STRUCTURED_FEATURE. También puede ser requerida antes de publicar el fact Training. La existencia de mapas, por sí sola, no activa la obligación. No poder determinar uso mantiene UNKNOWN; NAME-only con fuentes evaluables permite la rama NOT_REQUIRED. El corpus conserva `consumedByCategorySelection=false`: los hashes publicados no prueban consumo por autoridad runtime.

Cada family/dimension declara `requiresNegativeEvidence` y `negativeEvidenceRationale`. Product y Training conservan el requisito de evidencia negativa **si un terminal negativo se ofrece para satisfacer una obligación activa**. No se exige un fact negativo para justificar una exención contractual. Specs numéricas y Trust no tienen un terminal negativo que certificar y declaran false. Los 836 negativos Training siguen siendo resoluciones válidas con evidence ABSENT; no se reparan. Los 51 negativos con assignments mantienen el invariant INVALID_STATE, bloquean las consultas Training y siguen INVALID en consolidación.

## Status, métricas y efectos por superficie

ACTIVE exige las cinco dimensiones explícitas, ninguna rama material UNKNOWN, condiciones tipadas/coherentes, criterios/evidencia para obligaciones positivas, rationale/source para requisitos y exenciones, política negativa definida, keys requeridas explícitas y efectos deterministas de las superficies offline. El validator impide declarar ACTIVE un contrato incompleto. El cierre además exige tests. PROVISIONAL tiene un contrato válido con aplicabilidad material UNKNOWN; UNKNOWN se reserva al default no reconocido.

Las 21 familias siguen PROVISIONAL porque no existe autoridad para resolver las necesidades Specs familiares cuando faltan fuentes soportadas. El contrato parcial puede tener obligaciones conocidas para un producto cuyas condiciones concretas son evaluables. La certificación se refiere al alcance declarado del contrato; no afirma conocimiento técnico exhaustivo ni habilita runtime.

`ObligationCoverage = productsWithKnownObligations / population`, por ALL/CURRENT/ACTIVE. Se cuentan desconocidas aunque el estado principal sea INVALID o BLOCKED_BY_CONFLICT. Las tasas de certificación usan denominadores total y known; si known=0, percentage=null. No existe objetivo porcentual.

`requiredFactCount`, `conditionalFactCount` y `unknownRequirementCount` permiten revisar la carga de información. No cuentan SPECS como un segundo fact además de sus seis keys. Las derivaciones familiares requieren códigos explícitos; las specs siguen seis promesas condicionales. Una spec universal REQUIRED sin autoridad existente se marca POTENTIAL_OVERCONSTRAINT y requiere revisión, sin cambiarla silenciosamente ni resolverla por frecuencia.

| Superficie | Efecto offline |
|---|---|
| PRODUCT_CONTEXT | Presencia current; mantiene 886/886 activos ADMITTED |
| PRODUCT_SEMANTIC_DISCOVERY | Identidad/facts Product terminales y respaldados; scope current/no-product |
| TRAINING_DISCOVERY | Dimensión consultada por separado, contenido COMPLETE, códigos requeridos y evidencia; exención sin assignments → NOT_APPLICABLE |
| SPEC_FILTERING | Keys seleccionadas con promesa activa, resolución y evidencia; sin selección evalúa keys activas; ninguna fuente → UNKNOWN |
| UNIFIED_RETRIEVAL | Todas las obligaciones concretas conocidas y satisfechas; sin UNKNOWN, inválidos o conflictos relevantes |
| LEXICAL_SEARCH / COMMERCIAL_PURCHASE | Conservan listing/Commercial Truth live; no se fabrican decisiones comerciales offline |

Un filtro explícito por una key inactiva puede ser NOT_APPLICABLE; un contrato de familia desconocida permanece UNKNOWN. Histórico y non-product quedan fuera de discovery/filtering/unified, aunque tengan contenido disponible. Product Context sigue independiente de consolidación semántica.

## P_NEW y protocolo de ingreso

`declaredProductFamily` selecciona el contrato para onboarding sin crear un fact certificado. Si ya hay Product Semantics, su familia tiene prioridad. La familia conocida sin facts causa DATA_GAP para identidad REQUIRED; las obligaciones cuya condición no se puede evaluar quedan UNKNOWN. Una familia desconocida conserva cinco UNKNOWN.

Por cada familia se registra P_NEW sin facts, luego un ejemplo mínimo respaldado por un witness real: se rebindean IDs únicamente en memoria, se eliminan ejes Product adicionales, features no utilizados y assignments fuera del required set. Se conservan name/source/evidence reales. Se simula explícitamente autoridad Trust consumida para mostrar cómo satisfacer ese requisito; esa hipótesis no modifica ni describe autoridad actual del corpus. No se fabrican assignments, negativas o datos técnicos.

- L2: aplicabilidad concreta conocida y todas las required/key obligations terminales; una family claim sola no alcanza.
- L3: evidencia aceptada para cada obligación activa, con negativas sólo cuando corresponden.
- L4: niveles anteriores más bindings y cross-validation de dependencias relevantes.
- L5: admisión en la superficie designada. Cada escenario conserva las decisiones de todas las superficies.

`new-product-onboarding-P2.3B.json` demuestra que satisfacer lo required disponible no resuelve las obligaciones todavía UNKNOWN. La ladder es acumulativa. Un producto puede alcanzar Product Context/Discovery sin poder certificar L2 global o Unified.

## Cambiar obligaciones y fases posteriores

1. Inspeccionar la ontología, registry ACTIVE, policy contractual y fuentes concretas de la familia. Separar autoridad de supporting frequency y de estados de contenido.
2. Declarar REQUIRED/CONDITIONAL/NOT_REQUIRED/UNKNOWN con rationale y referencias verificables. Para condicionales definir fuente tipada, rama falsa y resultado no evaluable; no usar asignaciones como única autoridad.
3. Declarar keys/sources reales, evidencia negativa y superficies dependientes. Mantener conocimiento adicional disponible y UNKNOWN sin autoridad.
4. Publicar una nueva contractVersion ante cambios sustantivos. No reusar v1/v2 con otra interpretación. Actualizar schemaVersion sólo si cambia el formato. Hash canónico ordena object keys, conserva arrays y excluye contentHash.
5. Validar status/schema/hash, probar onboarding y regresiones, comparar IDs exactos y reportar el delta con family/cambio/reasons/sources.

Sales/Product Manager retrieval profiles corresponden a una fase posterior; no se crean aquí. Los consumidores futuros deberán seleccionar versión/hash explícitos y aplicar las dependencias de su superficie. P2.3C puede reconciliar los 51 inválidos y las obligaciones Training respaldadas, pero no puede resolver por sí sola la falta de autoridad familiar Specs/Training ni la autoridad de Trust.

## Reproducción y artifacts

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --maxWorkers=1 --reporter=json --outputFile=cross-projection-audit/test-results-P2.3B.json
npm run typecheck
node node_modules/eslint/bin/eslint.js src/domain/catalog-admission tests/unit/catalog-admission-v2.test.ts
node cross-projection-audit/audit.mjs --p2-3b
node cross-projection-audit/audit.mjs --p2-3b
```

Se invoca Vitest directamente porque `npm test` tiene un pretest que construye/publica snapshots protegidos. La suite completa y su configuración existente se conservan. El flag v2 reutiliza el lector verificado, compara los 2.048 payloads v1 completos y repite v2. La segunda ejecución compara hashes de todos los datasets para la misma identidad de código/contrato/inputs. Los 12 gates y fingerprints están en verification-P2.3B.json; el informe A–N está en REPORT-P2.3B.md. Los outputs generados permanecen locales/ignorados por Git, según la política existente.

Los artifacts solicitados son inventory JSON/CSV, family-contracts-v2 JSON/CSV, obligation-coverage.json, consolidation/admission/delta P2.3B, unknown-obligations CSV, onboarding JSON, verification JSON e informe. Se preservan outputs anteriores y contenido protegido. `--output-dir` escribe una copia independiente usando el baseline P2.3A verificado de `cross-projection-audit/`.
