# P_NEW: flujo observado y protocolo propuesto

**Can a newly created product enter the semantic catalog safely today? PARTIALLY.** Hay integración automática bajo ejecución de CLIs y gates técnicos de source/schema/hash/lineage. No existe gate semántico transversal por producto que garantice obligations, evidencia negativa, coherencia y admisión por superficie.

## Etapas actuales

| Etapa | Tipo | Gate/resultado observado | Límite |
|---|---|---|---|
| PrestaShop crea P_NEW | MANUAL / UNKNOWN | Registro creado fuera de este repo; canonical identity P{id} | Workflow de creación externo no verificable |
| Extracción | AUTOMATIC cuando se invoca; MANUAL operacional | SQL de current+historical, normalizeSource, source hashes, extraction manifest | No scheduler verificado; no extrae listed/orderable/stock/backorder/precios |
| Projection input | AUTOMATIC | Canonical immutable content + CSV compatibility + trust CSV/hash | Nuevos ids de category/features pueden no tener trust aprobado |
| Product Semantics | AUTOMATIC / POLICY-DEPENDENT | Classifier name/category/feature/guard; non-product exclusion; provenance por fact | OTHER/partial son publicables; CLASSIFIED no resuelve ejes vacíos ni obligaciones globales |
| Training V1 | AUTOMATIC / POLICY-DEPENDENT | Capability classifier; coverage; source Product snapshot link | Dominio V1 limitado; ausencia de capability no significa ausencia general de Training |
| Training V2 | AUTOMATIC / POLICY-DEPENDENT | Classifier V2.1, registry/rules/trust hashes, V1 assignment preservation | Policy A00.6.7 por id solo cubre cohort existente; P_NEW no entra en cohort automáticamente |
| Specs | AUTOMATIC / POLICY-DEPENDENT | Normaliza feature ids 3,11,12,15,41; conserva ambiguous/unsupported | No family applicability; faltantes fuera de adapter no se resuelven; unidades sin conversiones |
| Trust | POLICY-DEPENDENT / MANUAL para nuevos mappings | Maps fuente gobiernan classifiers; loader warnings bloquean build | Maps hash-only publicados no gobiernan category runtime; static map necesita proceso separado |
| Bundle | AUTOMATIC al invocar CLI | Schemas/hashes/counts/source links/registry, publicación immutable | DomainReview=PENDING permitido; no per-product semantic admission gate |
| Activación | MANUAL o AUTOMATIC por actor; POLICY-DEPENDENT | ActivationService candidate technical validation, compatibility, CAS/history | NO_GATE de domain-review obligatorio y de contradicción negative+assignments |
| Runtime reload | AUTOMATIC | Poll/pointer validation, immutable load, atomic swap, last good on failure | Bundle cargado no acredita productos evidence-backed; deployment actual UNKNOWN |
| Runtime consumers | POLICY-DEPENDENT | Product current/non-product gate; Training COMPLETE gate; commercial live | Training-only no current/non-product gate; specs no filtering contract; Unified Retrieval NO_GATE |

Fuentes: [extract CLI](../scripts/catalog-v2/extract-projection-input.ts), [canonical source](../src/domain/catalog/projection-input/canonical.ts), [bundle build CLI, leído pero no ejecutado](../scripts/catalog-v2/build-projection-bundle.ts), [Training V2 builder](../scripts/catalog-v2/build-training-semantics-v2.ts), [resolutionStateFor](../src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts), [activation](../src/domain/catalog/projection-activation.ts), [runtime projection y reload manager](../src/domain/catalog/runtime-projection.ts), [discovery](../src/application/catalog/semantic-discovery/defaultSemanticDiscoveryService.ts).

## Escenarios de P_NEW bajo código actual

1. Nombre inequívoco y sources/trust conocidos: se clasifica; Product family/tag facts aparecen. Training con cualquier assignment cae en SEMANTIC_COMPLETE por fallback fuera de policy, incluso solo instrumental functions. ActiveTrainingRelevant=false: no altera la tasa cohort publicada de 240. Esto puede publicar certeza terminal mayor que el scope de evidencia.
2. Sin capability aplicable según classifier V1 y sin functions: Training cae en VERIFIED_NO_APPLICABLE_CAPABILITY. `resolutionEvidence` no se genera por defecto; el producto nuevo no aporta prueba negativa persistida. Se debe preservar ausencia modelada, sin inventar capacidades.
3. Sin assignments y cobertura UNMODELED: ONTOLOGY_GAP, aunque aún se desconozca si falta regla, source o vocabulario. No bloquea todo el bundle por producto.
4. Feature técnica supported con parse ambiguo: specs ambiguous/unsupported se publican como warnings. Sin supported feature: no specs; esto no establece exención ni incumplimiento obligatorio.
5. Category id no mapeado: Product loader agrega warning UNKNOWN trust; bundle builder rechaza loaderWarnings. Feature id no mapeado recibe UNKNOWN sin warning equivalente: ciertas features nuevas pueden pasar sin mapping aceptado. P_NEW puede quedar sin family; no se debe interpretar como resolución.
6. Policy asignada a un id existente y source materialmente cambiante: la resolución curada precede assignments y puede quedar obsoleta. El escenario explica los 51 negativos conocidos; hash válido y conteo cohort estable no protegen contra esta contradicción.
7. P_NEW inactive: puede recibir Product Context y clasificación offline; Product/Training discovery no chequean active comercial. Compra requiere commercial owner vivo; no deducir sellability de classification ni activeTrainingRelevant.

No se simularon inserciones ni se construyó bundle nuevo. Estos escenarios se trazan desde branches reales del código; no son resultados de pruebas live.

## Admission protocol que falta

Existe protocolo técnico de extracción/build/activation explícito. Falta un contrato de incorporación semántica por producto/familia/superficie con versión y evidence lineage. Se propone el siguiente, sujeto a decisión de dominio; **no implementado**:

1. Crear canonical identity/presence con sourceExtractionId verificado; separar current/historical y active desconocido.
2. Determinar obligations desde Product Family y la superficie deseada. Si family/obligations no se conocen, mantener UNKNOWN y admisión parcial por superficie; no exigir Training/Specs universalmente ni eximir por intuición.
3. Resolver dimensiones requeridas mediante reglas vigentes y fuentes admitidas. Guardar hechos positivos y negativos con justificación; VERIFIED_NOT_APPLICABLE debe tener scope, reason, evidence/policy refs y owner de revisión.
4. Validar invariants antes de publicar/activar: negative incompatible con assignments, policy por id obsoleta, flag resolved, parent-family derivation, duplicate/conflicting specs, trust/source gates y presence.
5. Separar exercise completeness y instrumental function resolution. Mantener rule/data/ontology gaps diagnosticables y no usar simple assignment presence como certificado integral.
6. Revisar mappings nuevos de category/feature; hacer explícito qué autoridad gobierna runtime, con hash/version compatible. No aceptar silenciosamente unknown trust como verdad terminal.
7. Calcular admission vector para cada superficie; incluir scope histórico, exclusión no-product, freshness/activation y live commercial hydration cuando corresponda. LEXICAL_SEARCH/PRODUCT_CONTEXT no requieren totalidad semántica; compra requiere Commercial Truth.
8. Requerir domain review/admission verificable del candidato para las superficies que lo necesitan; activar técnicamente con CAS y lineage, y comprobar operación desplegada.
9. Reejecutar auditoría por extracción/registry/policy, comparar gaps por id y evidencia, y mantener review pool. El 95% es referencia descriptiva, nunca obligación de clasificar sin respaldo.

Relationships/Capabilities CAT-V2 solo se incorporan a obligations si una superficie los exige explícitamente. Su estado actual unavailable no condena individualmente a P_NEW.

## Evidencia que permitiría afirmar YES

Contrato de required dimensions por familia/superficie; evidence y scope de negativos; completeness y cross-invariants implementados como gate; trust runtime alineado; admission vector persistido/versionado; domain review acreditado; deployment/activation live verificados. Ninguno debe suplirse con coverage porcentual ni con un booleano `resolved=true`.
