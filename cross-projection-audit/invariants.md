# Invariants y mappings de auditoría v1

Este documento define criterios de observación. Las recomendaciones más conservadoras que el runtime se identifican como criterio de auditoría; no son policies nuevas implementadas. `audit.mjs` ejecuta exclusivamente lecturas y replay en memoria. Ningún publisher, activation store ni conexión DB se utiliza.

## Poblaciones e identidad

- ALL_CANONICAL_PRODUCTS: cada `source.products` único, current o historical.
- CURRENT_PRODUCTS: `catalogPresence=current_catalog`, independientemente de active.
- HISTORICAL_PRODUCTS: `historical_order_detail_only`; active/category/features/variants null por contrato, no inactive ni arrays vacíos inventados.
- ACTIVE_PRODUCTS: current con active=true. INACTIVE_PRODUCTS: current con active=false. Se verifica la partición current=active+inactive+unknownActive.
- SELLABLE: no derivable offline. Active no contiene listed/orderable/stock/backorder/pricing. Las variantes son unidades comerciales; el producto con variantes no es un item vendible directamente.

Fuentes: [canonical.ts](../src/domain/catalog/projection-input/canonical.ts), [commercialEngine.ts](../src/domain/catalog/v2/commercialEngine.ts), [CatalogContractService](../src/application/catalog/v2/catalogContractService.ts).

Se verifica hash de los cuatro source artifacts, schema/aggregate manifest, byte-form canonical, recordCounts y bundle/artifact/snapshot identities con los validadores existentes. Las únicas extracciones disponibles enumeradas son las realmente encontradas; no se sustituye identidad por coincidencia cardinal con el input histórico ausente.

## Taxonomía común

| Audit state | Significado |
|---|---|
| VERIFIED | Hechos o dimensión modelada terminales y coherentes; evidence acceptance se mide por separado |
| VERIFIED_NOT_APPLICABLE | Negativo terminal coherente en el dominio de la proyección; necesita evidencia aceptable para consolidar |
| PARTIAL | Algunos hechos resueltos; coverage/scope/completitud pendientes |
| AMBIGUOUS | Fuente o candidatos no permiten decisión única |
| DATA_GAP | Estado explícito de fuente insuficiente o unsupported sin otro spec utilizable |
| ONTOLOGY_GAP | Estado persistido de vocabulario/UNMODELED; no demuestra causalmente necesidad de ontología nueva |
| SOURCE_CONFLICT | Valores distintos para misma verdad o discrepancia documentada de policy/implementación/scope |
| INVALID_STATE | Violación estructural o lógica dura de invariant |
| UNAVAILABLE_PROJECTION | Proyección ausente de plataforma, separada de fallo individual |
| NOT_REQUIRED | Dimensión exenta por contrato explícito; no se usa si no hay exención verificable |
| UNKNOWN | Causa/aplicabilidad/resolución no conocida; no se convierte en negativo |

Una dimensión terminal de estado puede no superar evidence-backed resolution. En particular VERIFIED_NOT_APPLICABLE sin evidencia negativa persistida conserva la coherencia del estado, pero no alcanza consolidación.

## Product mappings

| Internal | Audit mapping | Condiciones |
|---|---|---|
| CLASSIFIED | VERIFIED | Primary family, ontology/hash, provenance por tag y replay válidos |
| PARTIALLY_CLASSIFIED | PARTIAL | `determineStatus` usa historical scope; no se interpreta como incapacidad de clasificar family |
| OTHER | UNKNOWN | Sin family; puede conservar discipline/use-context. No tiene diagnóstico source/rule/ontology |
| NEEDS_REVIEW | AMBIGUOUS | Candidatos mutuamente excluyentes; no aparece en baseline |
| EXCLUDED_NON_PRODUCT | VERIFIED_NOT_APPLICABLE | Arrays/tag facts vacíos y exclusion rule/reason conservados |
| Sole weak category fact | PARTIAL | Criterio de auditoría más estricto: PRODUCT_FAMILY permite SEMANTIC_WEAK en código, pero no se certifica ese hecho como fuerte |
| Historical FAMILY_INFERENCE discipline | SOURCE_CONFLICT | Global policy exige name explícito; discipline implementation permite derivación familiar explícitamente |
| Schema/tag/hash/evidence/replay violation | INVALID_STATE | Tiene precedencia sobre otros estados |

Fuentes: [snapshot contracts](../src/domain/product-semantic-snapshot/contracts.ts), [snapshot builder](../src/domain/product-semantic-snapshot/defaultSnapshotBuilder.ts), [classifier](../src/domain/product-semantic-classification/classifier.ts), [global policy](../src/domain/commercial-product-ontology/global-rules.ts), [discipline rules](../src/domain/product-semantic-classification/discipline-rules.ts).

Los ejes discipline/context admiten múltiples etiquetas y cero etiquetas no prueba no-aplicabilidad. CLASSIFIED acredita la family y los hechos emitidos, no una revisión exhaustiva de cada eje vacío. La auditoría conserva esa limitación en el estándar global.

## Training mappings

| Internal V2 | Audit | Condiciones |
|---|---|---|
| SEMANTIC_COMPLETE | VERIFIED | Assignments estructuralmente válidos, replay y confidence/review consistentes |
| SEMANTIC_COMPLETE, solo functions | PARTIAL | Criterio global de auditoría: function resuelta no prueba exercise completeness. Puede servir como candidato para queries de TRAINING_FUNCTION |
| VERIFIED_NO_APPLICABLE_CAPABILITY, arrays vacíos | VERIFIED_NOT_APPLICABLE | Coherencia lógica; evidencia negativa se evalúa separadamente |
| VERIFIED_NO_APPLICABLE_CAPABILITY, cualquier assignment | INVALID_STATE | Invariant conocido de 51 records; jamás convertir arrays en vacío para mejorar counts |
| SEMANTIC_PARTIAL | PARTIAL | No terminal |
| DATA_GAP | DATA_GAP | Policy persistida o cobertura insuficiente |
| ONTOLOGY_GAP | ONTOLOGY_GAP | Mapping de UNMODELED/no assignments; puede ser falso diagnóstico causal |
| AMBIGUOUS / NEEDS_REVIEW | AMBIGUOUS | No terminal |
| RULE_GAP | PARTIAL | Falta regla; taxonomía requerida no incluye RULE_GAP. Se conserva internal state e issue para distinguir de ontology |
| Missing resolutionState | UNKNOWN | Ausencia; validators existentes exigen estado persistido |
| Schema/resolved flag/replay/weak AUTO invalid | INVALID_STATE | Error duro |

V1: assignment válido -> VERIFIED para capability emitida; vacío NO_CAPABILITY_APPLICABLE -> VERIFIED_NOT_APPLICABLE scoped al registry V1; INSUFFICIENT_EVIDENCE -> DATA_GAP; UNMODELED -> ONTOLOGY_GAP; NEEDS_REVIEW -> AMBIGUOUS. V1 nunca reemplaza V2 para public discovery. UNMODELED con assignments no viola invariant: coverage es una dimensión distinta de resolution.

Fuentes: [V2 contracts](../src/domain/training-semantic-snapshot/v2-contracts.ts), [resolution builder](../src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts), [classifier V2](../src/domain/training-semantic-classification-v2/classifier.ts), [V2 validation](../src/domain/training-semantic-classification-v2/validation.ts), [V1 classifier](../src/domain/training-semantic-classification/classifier.ts).

`activeTrainingRelevant` es pertenencia a cohort curado de revisión. No expresa estado comercial vigente. `counts.resolutionStateCounts`, `resolvedCount` y `resolutionRate` resumen ese cohort; los estados de toda la población se recomputan recorriendo records.

Evidence-backed negatives exigen justificación de no-aplicabilidad rastreable, no solamente coverage fallback o razón `Preserved from baseline`. No se convierte esta exigencia en 836 tareas manuales automáticas: se separa policy/evidence pool.

## Specs mappings

| Records del producto | Audit |
|---|---|
| Ninguno | UNKNOWN, specsRequired=UNKNOWN |
| Todos parsed, válidos sin conflicto | VERIFIED para los keys publicados; no certifica requisitos técnicos exhaustivos |
| Parsed y ambiguous | PARTIAL |
| Solo ambiguous | AMBIGUOUS |
| Unsupported más otro estado | PARTIAL |
| Solo unsupported | DATA_GAP |
| Mismo product/key, valores numéricos distintos | SOURCE_CONFLICT, incluso cuando buildSpecs los nulifica como ambiguous |
| Schema/value/status/unit/source violation | INVALID_STATE |

`parsed iff value!=null`; value positivo; `_kg`->kg, `_cm`->cm; sourceFeature refiere al featureId/valueId real y rawValue coincide con extracción. Histórico/specs presence deben coincidir. Duplicate sourceFeature en mismo key es inválido; varias fuentes con valor igual son advertencia de multivalue, no contradicción automática.

Se reproduce [buildSpecs/parseMeasurement](../src/domain/catalog/projection-bundle.ts) en memoria y se reconstruyen candidatos previos a nulificación para detectar conflictos. Las reglas cubren ids 3,11,12,15,41; dimensional feature15 emite Largo/Ancho/Alto. No hay conversiones entre unidades. Technical features fuera de esos ids son coverage gap de adapter, no obligación inferida por producto.

## Trust mappings

Coverage/mapping completo y classes reconocidas -> categoryTrustState/featureTrustState VERIFIED, aunque no haya fuentes en arrays vacíos. Fuente null histórica -> UNKNOWN. Id asignado sin mapping -> DATA_GAP. Duplicate ids o trust classes desconocidas fallan validación de auditoría, evitando last-write-wins/silent coercion. TrustState agregado=PARTIAL cuando build maps cubren pero runtime selection sigue authority estática independiente; DATA_GAP tiene precedencia si falta mapping.

Fuentes: [input loader](../scripts/product-semantic-classification/lib/load-input.ts), [meaningfulCategory](../src/domain/catalog/v2/meaningfulCategory.ts), [static trust](../src/domain/catalog/v2/categoryTrustMap.ts), [runtime authority contract](../src/domain/catalog/runtime-authority-contract.ts).

Product PRODUCT_FAMILY admite STRONG/WEAK; DISCIPLINE/USE_CONTEXT STRONG. Training V2 STRONG->HIGH y WEAK->MEDIUM review-only; merged hints weak no equivalen a asignación terminal independiente. Guarded features pueden necesitar combinación. Detalle completo de autoridad/confidence/auto-resolution/hints: [evidence-policy.json](evidence-policy.json). MANUAL_OVERRIDE existe como fuente contractual pero no hay assignments observados de ese tipo. DESCRIPTION no es evidencia positiva de los classifiers actuales. Exclusion rule y resolution policy son provenance/authority, no enums nuevos de evidencia.

## Invariants cross-projection ejecutados

| ID / issue | Invariant y fuente | Tratamiento |
|---|---|---|
| PRODUCT_PRESENCE_CONFLICT / SPEC_PRESENCE_CONFLICT | Membership idéntico al canonical source; validateBundle | INVALID |
| SPEC_SOURCE_REFERENCE_INVALID | FeatureId/valueId/rawValue existen en producto canónico; buildSpecs | INVALID |
| PRODUCT_TRAINING_FAMILY_CONFLICT | FAMILY_DERIVED function corresponde a primary family y mapping registry aprobado | INVALID |
| HISTORICAL_UNAVAILABLE_SOURCE_USED | Category/features no disponibles para historical; globalHistoricalPolicy | INVALID |
| HISTORICAL_POLICY_IMPLEMENTATION_CONFLICT | Global historical name-only vs permitted family discipline derivation | SOURCE_CONFLICT de contrato, no source corruption |
| TRAINING_HISTORICAL_DISCOVERY_EXPOSURE | Training-only query indexa COMPLETE sin current gate; Product discovery exige current | Scope conflict respecto de admisión corriente propuesta, no error estructural de snapshot |
| TRAINING_NON_PRODUCT_DISCOVERY_EXPOSURE | Training-only no consulta non-product exclusion; Product sí | Scope conflict; política común pendiente |
| TRAINING_NEGATIVE_WITH_ASSIGNMENTS | Negative terminal y arrays positivos se contradicen | INVALID conocido, 51; consumers Training discovery lo excluyen |
| SPEC_CONFLICTING_RAW_CANDIDATES | Dos valores para misma verdad product/key, invariant de buildSpecs | SOURCE_CONFLICT, underlying values preservados en JSON |
| Exercise-derived anatomy | deriveExerciseSemantics usa registry de capabilities; functions nunca anatomía | Contrato separado; arrays derivados en dataset |

Fuentes adicionales: [family registry](../src/domain/training-semantics-v2/registry.ts), [family validation](../src/domain/training-semantics-v2/validation.ts), [semantic discovery](../src/application/catalog/semantic-discovery/defaultSemanticDiscoveryService.ts), [Training query](../src/application/catalog/training-semantic-query/defaultTrainingSemanticQueryService.ts), [Training runtime fact](../src/domain/training-semantic-snapshot/v2Runtime.ts).

Se conserva evidencia de código para el gap de scopes sin afirmar una prohibición runtime inexistente. Products históricos que solo cumplen Training no se recomiendan para discovery corriente; consultas históricas futuras necesitan contrato propio. Required Product+Training intersection limita históricos por Product; Training-only query no.

No existe matriz exhaustiva family×exercise ni spec numeric value->machine type, de modo que no se emiten esas contradicciones por intuición. Trust static/source classes coinciden en baseline, pero sus authorities/hashes se mantienen separados.

## Consolidación y ladder

Precedencia: INVALID; luego SOURCE_CONFLICT; después ONTOLOGY/DATA blocker solamente cuando trainingRequired=YES; ambiguity o primary family UNKNOWN -> REVIEW_REQUIRED; resto PARTIALLY_CONSOLIDATED. CONSOLIDATED y CONSOLIDATED_WITH_NOT_APPLICABLE requieren obligations conocidas y todas terminales con evidencia; actualmente no certificables por `specsRequired=UNKNOWN` y matriz global ausente. Labels negativos sin evidencia no cumplen consolidación aunque sean coherentes.

L0 canonical presence; L1 source y schemas de records/proyecciones presentes; L2 required dimensions terminales; L3 evidencia de todos los terminales; L4 cross-invariants; L5 designated-surface admission. Acumulativos. L2-L5 tienen cero certificado y estado **no evaluable** por contrato ausente, no cero calidad factual. Los checks auxiliares de dimensiones publicadas y admisión por superficie son métricas independientes; no rellenan niveles desconocidos.

## Admission observado y recomendado

- LEXICAL_SEARCH: active && listed en live CatalogContractService. Listed no extraído, por tanto activos UNKNOWN; inactive/historical NO.
- PRODUCT_CONTEXT: current existence permite contexto aun inactive; current YES condicionado a que siga existiendo live. Historical NO para contexto live.
- COMMERCIAL_PURCHASE: inactive/historical NO; active UNKNOWN por campos comerciales ausentes. Variants requieren item context.
- PRODUCT_SEMANTIC_DISCOVERY: runtime current + no exclusion + al menos tag no residual. Audit YES requiere Product state VERIFIED y evidencia aceptable; partial facts -> PARTIAL. Otros problemas Training/specs no invalidan automáticamente esa superficie limitada.
- TRAINING_DISCOVERY: runtime COMPLETE + assignments. Audit YES exige current/non-excluded, evidence-backed VERIFIED; function-only COMPLETE -> REVIEW_REQUIRED para Training global, aunque sus functions puedan servir en superficie específica.
- SPEC_FILTERING: NO_CONTRACT; CANDIDATE/ PARTIAL describen potencial offline de filas, sin afirmar admission operativo.
- FUTURE_UNIFIED_RETRIEVAL: NO_CONTRACT / REVIEW_REQUIRED. Relationships/Capabilities no requeridos salvo dependencia explícita futura.

Todas las eligibility se refieren al candidato offline. `deployedEligibility=UNKNOWN` se conserva para toda superficie; no se conectó al servicio live.

## Verificación y límites

`verification.json` prueba hashes/lineage, replay, denominadores, contraejemplos negative/historical y fingerprints de todos los archivos artifacts/data antes/después. Hashes de código/policy/lock se incluyen; no se afirma equivalencia con código desplegado. Reproducción: `node cross-projection-audit/audit.mjs`.

El script conserva el assert de 51 invalid conocidos como detector de drift del baseline, no como regla general de dominio. Las opciones permiten source/bundle distintos con lineage coincidente; si la cantidad conocida cambia, exige revisar este baseline audit. No se ejecuta el pretest del repo: publica snapshots, operación expresamente fuera del alcance autorizado.
