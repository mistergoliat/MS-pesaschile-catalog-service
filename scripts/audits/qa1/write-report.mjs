import {readFile,writeFile} from 'node:fs/promises';
import {parseCsvRecords} from '../../product-semantic-classification/lib/csv.ts';
const out='artifacts/catalog-v2/qa1/run-20261008-bddf7f';
const read=async f=>JSON.parse(await readFile(`${out}/${f}`,'utf8'));
const s=await read('audit_summary.json'),authority=await read('authority.json'),inventory=await read('ontology_inventory.json'),sample=await read('sampling_plan.json'),gaps=await read('known_gap_cohorts.json');
const matrix=parseCsvRecords((await readFile(`${out}/product_semantic_matrix.csv`,'utf8')).replace(/^\ufeff/u,''));
const current=matrix.filter(r=>r.catalogPresence==='current_catalog'),active=current.filter(r=>r.activeStatus==='ACTIVE');
const pct=(n,d)=>`${n}/${d} (${(100*n/d).toFixed(2)}%)`;
const table=(headers,rows)=>[headers.join(' | '),headers.map(()=>'---').join(' | '),...rows.map(r=>r.join(' | '))].map(r=>'| '+r+' |').join('\n');
const link=f=>`[${f}](../../${out}/${f})`;
const names=ids=>ids.map(id=>{const r=matrix.find(r=>Number(r.productId)===id);return `P${id} «${r?.productName??'UNAVAILABLE'}»`;}).join('; ');
const exerciseRequired=active.filter(r=>JSON.parse(r.applicableSemanticObligations).some(d=>d.dimension==='TRAINING_EXERCISE'&&d.effectiveRequirement==='REQUIRED'));
const functionRequired=active.filter(r=>JSON.parse(r.applicableSemanticObligations).some(d=>d.dimension==='TRAINING_FUNCTION'&&d.effectiveRequirement==='REQUIRED'));
const nonadmitted=active.filter(r=>r.classificationStatus==='CLASSIFIED'&&JSON.parse(r.discoveryEligibility).product!=='ADMITTED').map(r=>Number(r.productId));
const bRows=s.backlog.map(b=>[b.priority,b.issueId,b.productCount,b.activeExposure,b.rootCause]);
const query=s.queryCoverage.map(q=>[q.queryType,q.ONTOLOGY_SUPPORT,q.SOURCE_DATA_SUPPORT,q.CLASSIFICATION_SUPPORT,q.EVIDENCE_SUPPORT,q.CONTRACTUAL_ADMISSION,typeof q.activeSupportedFactProducts==='number'?pct(q.activeSupportedFactProducts,886):q.activeSupportedFactProducts]);
const family=s.families.filter(f=>f.canonical).map(f=>[f.family,f.canonical,f.current,f.active,f.classified,f.partial,f.other,f.activeAdmission.product,f.activeAdmission.exercise,f.activeAdmission.function,f.activeAdmission.specs]);
const specFeatures=parseCsvRecords((await readFile(`${out}/feature_consumer_coverage.csv`,'utf8')).replace(/^\ufeff/u,''));
const text=`# P2.3-QA1 — Ontology & Semantic Coverage Audit

Fecha: 2026-10-08, America/Santiago. Candidate offline P2.3C-FIX2 sobre fuente productiva congelada. **Disposición analítica: QA2_WITH_SCOPE_RESTRICTIONS. PRODUCTION_ROLLOUT_RECOMMENDATION=DEFER.**

## A. Executive Summary

La ontología permite validar de forma independiente la identidad de familias y el conjunto estrecho de ejercicios y funciones publicados. **No sustenta una declaración global de suficiencia para todas las búsquedas o recomendaciones.** Es necesario restringir QA2 por población, dimensión y obligaciones efectivamente modeladas. No se calcula exactitud, Precision@K ni cumplimiento de 95%.

Resultados **MEASURED**: matriz de 2048 IDs únicos, 1565 vigentes, 483 históricos y 886 activos. Hay 1295 CLASSIFIED, 419 PARTIALLY_CLASSIFIED, 321 OTHER y 13 EXCLUDED_NON_PRODUCT; NEEDS_REVIEW=0. Todos los 419 parciales son históricos. En activos: 797 CLASSIFIED, 82 OTHER y siete exclusiones. El estado CLASSIFIED no adjudica verdad comercial; Product Discovery admite ${pct(791,886)} activos.

Hallazgo estructural **MEASURED**, interpretación comercial **INFERRED**: 20 productos CABLE_MACHINE (18 vigentes, 16 activos) tienen negativa Training sin funciones, aunque la obligación familiar requiere CABLE_RESISTANCE. La regla familiar incorpora accesorios de polea deliberadamente. Deben distinguirse estación, módulo con mecanismo y agarre pasivo antes de utilizar la familia como afirmación técnica. FIX2 eliminó positivos improcedentes, pero Product Semantics permanece intacto.

Otros límites: 50 negativas sin evidencia (49 activas), 82 conflictos Specs (74 activos), compatibilidad/dependencias/alternativas sin relaciones verificadas y seis keys Specs insuficientes para muchos filtros comerciales. Los 735 ONTOLOGY_GAP no son 735 defectos ontológicos demostrados.

**No conformidad de procedimiento:** al iniciar esta ejecución, importar el auditor PRB ejecutó su bloque CLI preflight y reescribió dos evidencias históricas locales: \`artifacts/catalog-v2/p2-3c-prb/preflight.json\` y \`protected-before.json\`. Se retiró la importación y se usaron lectores puros. No se alteraron fuentes, bundles, snapshots, código funcional ni producción. No se conservaban los bytes originales de esos dos archivos; no se fabricó una restauración. La integridad posterior al preflight QA1 es comprobable, pero **no se declara cumplida la restricción de inmutabilidad histórica durante toda la ejecución**. Detalle: ${link('process_incident.json')}. Este incidente no se presenta como una brecha de ontología y requiere revisión junto con el informe.

## B. Candidate / Source Authority

${table(['Campo','Identidad'],[
['Candidate bundleId',s.candidate],['SourceExtractionId',s.sourceExtractionId],['Commit revisado','3c1e9c4a17469e9beac4c8cb242aac820635d817'],['Baseline histórico',s.baseline],['Candidate manifest físico','sha256:6b5fc8aec02583c46f24e84921917ff1d878e83978459e0dc6b8fe5c243cf850'],['Baseline manifest físico','sha256:c1605f9e311fe0ee79164d1c849a93dd1f64e3a5eca172098d4d4015667bd8b6'],['Source manifest físico',authority.sourceManifestHash],['Training V2 snapshot interno','sha256:10cd9a355399eee0d761baacde062d4d74d64aa4e5c326e1337be673795c90c6'],['Training V2 projection wrapper','sha256:b315f13b1b63001ef5bfe4d4ff2b8f947748cede781b53cbc084c5fe2a009b77'],['Admission contract',inventory.admission.contentHash]])}

Lecturas iniciales: [baseline reconciliation](P2_3C_BUNDLE_BASELINE_RECONCILIATION.md), [rebuild productivo](P2_3C_PRODUCTION_BASELINE_REBUILD.md), [rollout review](P2_3C_FINAL_PRODUCTION_ROLLOUT_REVIEW.md), [Linux reproducibility](P2_3C_LINUX_REPRODUCIBILITY_REPORT.md). Se revisaron contratos reales de registries/snapshots/Admission, [P2.3B](P2_3B_FAMILY_APPLICABILITY_AND_OBLIGATIONS.md), [PRD CAT-V2](../architecture/CATALOG_PLATFORM_V2_PRD.md), [Product Registry](../contracts/product-semantics-registry.md), diseño Training A00.6.4 y código de Specs/Trust. El PRD separa Unified Retrieval de la fase posterior catalog.discover; no se implementó ninguna.

Se recalcularon SHA físicos, bundleId derivado, canonical serialization, manifest fuente y recordCounts. validateBundleForPublication(candidate) y validateBundle(baseline) PASS; warnings Specs y proyecciones unavailable se conservan. \`domainReview=PENDING\` no se convierte en aprobación de calidad. Fuente observada el 1 de octubre de 2026, 22:15:08.158Z; no es observación live del catálogo actual. Copias descargadas históricas se leen localmente, sin SSH en QA1. Directorios y hashes completos: ${link('authority.json')}.

Product Semantics, Training V1, Specs y Trust son **byte-identical** frente a 84c85d15…; todas sus brechas preexistían. Training V2: 156 records con cambio semántico, 1093 de evidencia, uno metadata/warning-only (P1354) y 798 intactos. Partición recalculada y cotejada por IDs/records con PRB. P899/P1365 son mejoras semánticas DIRECT, no simples wrappers. No se atribuyen source lineage, codeRef o hash de wrapper a mejoras ontológicas. ${link('baseline_training_comparison.csv')} conserva los 2048 before/after.

La búsqueda local de \`docs/audits/product-semantic-coverage/\` no encontró artifacts. El rollout review registra seis archivos untracked en EC2, pero no aporta aquí sus bytes, fecha, código ejecutado ni población verificable. Se tratan como **evidencia histórica no evaluable**, sin sobrescribirlos, descargarlos o asumir vigencia.

## C. Product Universe

${table(['Cohort','Cantidad','Denominador / significado'],[['Canonical',2048,'IDs únicos del source'],['Current',1565,'2048; no incluye históricos'],['Historical',483,'2048; source metadata null'],['Active current',886,'1565 vigentes'],['Inactive current',679,'1565 vigentes'],['Unknown active current',0,'1565 vigentes']])}

${link('product_semantic_matrix.csv')} tiene un registro por ID, referencias JSON Pointer al source/snapshot y sus identidades; contiene categorías/features originales, familias primarias/secundarias, tags, estados/evidence, V1/V2, Specs, Trust, obligaciones efectivas y Admission por superficie. ${link('product_evidence.json')} retiene source y records completos, evaluaciones por dimensión y seis evaluaciones Specs por key.

UNAVAILABLE describe fuente/proyección no expuesta; UNKNOWN conserva incertidumbre de actividad histórica o aplicabilidad; NOT_APPLICABLE se usa para una dimensión/negativa que no aplica. Celdas vacías no sustituyen esos estados. Un array vacío es una asignación observada vacía; no demuestra que el concepto sea falso. Historicals tienen active=UNKNOWN; no se inventa inactive ni features.

## D. Ontology Inventory

**MEASURED** desde registries importados y hashes de snapshots, sin listas alternativas de producción:

- Product Semantics v3: 21 familias no residuales y OTHER, ocho disciplinas (${inventory.ontology.axes.find(a=>a.axis==='DISCIPLINE').tags.map(t=>t.code).join(', ')}) y seis contextos (${inventory.ontology.axes.find(a=>a.axis==='USE_CONTEXT').tags.map(t=>t.code).join(', ')}). No existe eje libre de semantic tags: tags son assignments de estos tres ejes.
- Training V1: ${inventory.trainingV1.capabilities.length} capacidades históricas. Training V2: ${inventory.trainingV2.exerciseCapabilities.length} Exercise Capabilities y cinco Functions (${inventory.trainingV2.trainingFunctions.map(t=>t.code).join(', ')}), con anatomía/patrones derivados sólo desde Exercise.
- Exercises admiten DIRECT y SUPPORTED bajo evidencia de módulo/configuración. Functions admiten DIRECT o FAMILY_DERIVED; no se inventa SUPPORTED para Functions. Única derivación familiar: CABLE_MACHINE → CABLE_RESISTANCE. No hay derivación familiar de ejercicios.
- Specs: seis keys, números positivos o null, unidades kg/cm, sourceFeature ID/valueId y reglas vinculadas. Trust publica hashes de dos mapas, no una ficha técnica ni autoridad comercial universal.

Inventario completo con definiciones, evidence gates, políticas positivas/negativas/históricas, reglas globales, ejes diferidos/rechazados y obligaciones por familia: ${link('ontology_inventory.json')}.

**Jerarquía:** el contrato de tags es plano: no hay campo parent ni edges parent-child. No se verifica una jerarquía inexistente ni se infiere que categorías PrestaShop sean subclases formales. Las inferencias de disciplina desde familia son reglas funcionales de clasificación, no aristas taxonómicas. Granularidad BALL_BAG/ROPE_SLED/BAND_SUSPENSION y MACHINE_ATTACHMENT fusiona papeles comerciales distintos; se puede buscar la familia amplia, pero no deducir mecanismo, accesorio objetivo o sustitución.

**Conceptos huérfanos:** ABDOMINAL_CRUNCH no tiene assignments V2. Esto mide ausencia de uso, no demuestra que la capacidad falte en todos los productos: P1823 Core Roller requiere evidencia independiente. OTHER tiene cero assignments de tag por diseño y 321 estados residuales sin primary family; no es un huérfano defectuoso. No hay otros códigos Exercise/Function o tags ordinarios sin uso en este candidate. ${link('orphan_concepts.csv')} distingue códigos definidos y sus IDs de uso.

**Extensibilidad, INFERRED:** registries versionados, reglas fuente y hashes permiten incorporar conceptos; Admission exige cubrir todas las familias reconocidas. Existen exclusiones explícitas por productId y dependency previousPolicy con adjudicaciones históricas. Por tanto no se afirma extensión completamente libre de excepciones por ID. Añadir una familia exige su contrato/evidence policy; añadir una relación requiere una proyección fuente-verificada propia.

## E. Product Semantics Coverage

${table(['Estado','Canonical / 2048','Activos / 886'],Object.entries(s.classification).map(([k,n])=>[k,pct(n,2048),pct(s.activeClassification[k]??0,886)]))}

Product Discovery admite 1289/1565 vigentes y 791/886 activos. Seis CLASSIFIED activos no pasan sus evidence gates: ${names(nonadmitted)}. CLASSIFIED no garantiza que el snapshot satisfaga el mapper contractual. Las 419 parciales históricas requieren separación de población; no son una remediación automática del catálogo activo.

OTHER: 257 vigentes, 64 históricos, 82 activos. Existen candidatos diferentes: P797 Safety Squat Bar puede caber en BARBELL; P388 Push Ups puede caber en BODYWEIGHT_GYMNASTICS; P427 Glute Bands puede caber en BAND_SUSPENSION. Son **HYPOTHESIS de reglas/evidencia**, no prueba de que falte una familia. En cambio P420 Rep Timer y P1190 Timer, lastres de tobillo y plataformas de agilidad requieren comparar roles contra definiciones reales; no se adjudica su clasificación por LLM.

## F. Training V1/V2 Coverage

${table(['V2 resolutionState','Canonical','Activos'],Object.entries(s.trainingV2).map(([k,n])=>[k,n,s.activeTrainingV2[k]??0]))}

V1 coverageStatus: ${Object.entries(s.trainingV1).map(([k,v])=>k+'='+v).join('; ')}. V1 no publica el contrato de resolutionState V2; no se fabrica uno. V1 puede conservar assignments con UNMODELED: coverageStatus no equivale a ausencia de capabilities. V2 SEMANTIC_COMPLETE tampoco certifica todos los ejercicios posibles.

Ejercicios admitidos: 175 vigentes y 100 activos. Funciones: 130 vigentes y 71 activas. Para evaluar la obligación aplicable en activos, el denominador contractual es **${exerciseRequired.length} REQUIRED Exercise** y **${functionRequired.length} REQUIRED Function**; el denominador de 886 sólo describe disponibilidad de facts en toda la población activa, no exactitud ni suficiencia para todos los productos. Las cantidades por familia se entregan en coverage_by_family.

735 ONTOLOGY_GAP: 543 vigentes, 192 históricos, 245 activos. Grandes grupos: WEIGHT_PLATE=186, residual sin familia=252, BALL_BAG=86, KETTLEBELL=45, CARDIO_MACHINE=44. Varias familias tienen general-equipment functions explícitamente fuera del mínimo A00.6.4. Ausencia de funciones duplicadas de familia o ejercicios genéricos no es defecto automático; la aplicabilidad UNKNOWN impide certificar una cobertura general.

45 DATA_GAP: 34 vigentes y cinco activos exactos: ${names([930,1122,1823,2025,2319])}. Los targets P247/P897/P1624 son deuda fuente retenida, no positivos recuperados artificialmente. AMBIGUOUS: cinco activos exactos P435/P1945/P1946/P1947/P1948, con packs y geometría/configuración no adjudicadas. No se transforman en negativas.

Negativas: PRESENT=874 y ABSENT=50 (49 vigentes/activas, un histórico). Todas las 924 negativas tienen assignments vacíos. PRESENT certifica evidencia bajo la policy modelada, no demuestra que el producto no permita ningún entrenamiento. ABSENT no es prueba de un concepto ausente. CARDIO_MACHINE aporta 33 ABSENT: no puede deducirse que bicicletas/trotadoras carezcan de capacidad física por no tener una capacidad V2 estrecha. P1354 conserva warning y deuda sin evidencia nueva. IDs/evidence en ${link('known_gap_cohorts.json')} y ${link('ontology_gaps.csv')}.

## G. Specs Coverage

3163 records en 1200 productos. Parsed 2599/3163 (82.17%); ambiguous 512/3163 (16.19%); unsupported 52/3163 (1.64%). **512 records corresponden a 305 productos (181 activos); 52 records a 24 productos (seis activos)**; 82 conflictos de fuente son 82 productos (74 activos). El conjunto de productos ambiguous/unsupported tiene 319 IDs, no 329: hay solapamiento. No se suman estados de dimensiones diferentes.

Keys reales: max_user_weight_kg, max_load_kg, weight_kg, assembled_length_cm, assembled_width_cm, assembled_height_cm. Fuentes 11/12/41/3/15 respectivamente; dimensiones requieren etiquetas Largo/Ancho/Alto y unidades cm. Más de un candidato numérico, texto compuesto/unidades no admitidas o valores incompatibles entre fuentes generan incertidumbre. mapSpecs vuelve a contrastar candidatos fuente y bindings; un valor parsed aislado no autoriza usar un key conflictivo.

${table(['Feature fuente sin key Specs','Vigentes con fuente','Activos con fuente'],specFeatures.filter(f=>['8','14','42','43','44','51','65'].includes(f.featureId)).map(f=>[f.featureId+' '+f.name,f.productCount,f.activeCount]))}

Estos filtros son insuficientemente representados **MEASURED** en Specs; su prioridad comercial es **INFERRED**. Feature14 mezcla resistencia en kg/lbs y niveles de cardio: no debe normalizarse como un único número sin subtipo/unidad. Material es categórico; cable ratio relacional; total length no equivale a assembled length. Features 16/48 (dimensiones del producto/diámetro de manga) de P1124 son evidencia comercial útil que no prueba fit por sí sola. Inventario de las ${inventory.trust.featureRows.length} filas del mapa y consumidores observados: ${link('feature_consumer_coverage.csv')}. No observado en assignments no equivale a cero consumidores: reglas pueden inspeccionar y rechazar, y autoridad comercial queda fuera de esa medición.

## H. Trust Consumption

Hash category/feature verificado contra fuente y wrapper. Productos vigentes con categorías sin mapping: ${inventory.trust.sourceCoverage.categoryMissingProducts}; con features sin mapping: ${inventory.trust.sourceCoverage.featureMissingProducts}. Metadata histórica no está disponible. Los orphan references de extracción (cuatro categorías y 88 features) permanecen como warnings fuera de asignaciones válidas; no se convierten en productos adicionales.

Los loaders de Product y Training consumen mapas para clasificar/evidence gates. Admission los consume para obligaciones desde reglas fuente y certification. Sin embargo meaningfulCategory usa \`CATEGORY_TRUST_BY_ID\` estático, y runtime declara \`static-category-trust-map\`. Publicar trustMaps.json no demuestra que el selector comercial use el bundle; \`consumedByCategorySelection=false\` conserva PARTIAL por contrato. No se declara drift ni valores erróneos del selector sin compararlos con evidencia de esa autoridad. Referencias: src/domain/catalog/v2/meaningfulCategory.ts, categoryTrustMap.ts, src/application/catalog/runtime-context/catalogAuthoritySnapshot.ts, src/domain/catalog-admission/resolution.ts. ${link('category_consumer_coverage.csv')} muestra uso observado y cobertura de todas las categorías del mapa.

## I. Relationships / Capabilities Limitations

relationships y capabilities CAT-V2 = **UNAVAILABLE**, razón contractual «No sourceExtractionId-verified offline adapter in P1.3». No se activó ningún adapter ni se adoptó una proyección legacy como prueba.

${table(['Relación','Representación verificada','Consecuencia'],[['Taxonómica','Axes/tags planos; parent-child UNAVAILABLE','Sin inferencia jerárquica de subtipos'],['Funcional','Exercise/Function assignments y una family derivation','DIRECT/SUPPORTED no describen fit entre dos productos'],['Compatibilidad física','UNAVAILABLE','No prometer diámetro/interfaz/polea compatible'],['Dependencia técnica','UNAVAILABLE','Un módulo no se certifica autónomo ni se identifica equipo requerido'],['Complementariedad comercial','UNAVAILABLE','Compartir familia/ejercicio no prueba complemento'],['Alternativa/sustitución','UNAVAILABLE','Same-family no significa equivalencia técnica']])}

${s.backlog.find(b=>b.issueId==='RELATION_COMPATIBILITY').productCount} IDs candidatos de accesorios/repuestos, ${s.backlog.find(b=>b.issueId==='RELATION_COMPATIBILITY').activeExposure} activos, están en backlog con fuentes exactas. Es una cota por papeles detectados, no el total universal de productos que necesitarían relaciones.

## J. Family-Level Diagnostics

${table(['Familia primaria','Canonical','Vigentes','Activos','CLASSIFIED','Partial','OTHER','Active Product','Exercise','Function','Specs'],family)}

UNAVAILABLE es ausencia de primary family expuesta en el record; no es una familia nueva. OTHER se mantiene como classificationStatus. Familias cero del registry permanecen en el CSV de cobertura. Se agrupa por primary family para que cada ID pertenezca a una sola fila; secundarios completos quedan en la matriz. En CSV, denominadores canonical/current/active y REQUIRED por dimensión son explícitos.

Las seis categorías diagnósticas MODELED_AND_APPLICABLE, MODELED_BUT_NOT_APPLICABLE, POTENTIALLY_UNMODELED, SOURCE_DATA_INSUFFICIENT, CLASSIFICATION_UNCERTAIN y NOT_EVALUABLE se aplican por dimensión con criterio publicado en el script. NOT_REQUIRED contractual no es una prueba negativa; UNKNOWN no se reclasifica como defecto ontológico. POTENTIALLY_UNMODELED puede tener cero casos en el recorrido REQUIRED cuando el contrato deja la dimensión UNKNOWN: las hipótesis independientes se publican separadamente. ${link('dimension_diagnostics.csv')} conserva los 10240 pares producto×cinco dimensiones; ${link('coverage_by_family.csv')} agrega estados, evidence, capabilities/functions/spec keys, conflictos y admission por superficie.

## K. Cross-Dimension Consistency

**Tensión estructural cable, MEASURED:** la definición/guard v3 excluye categoría Accesorios de Polea como evidencia de máquina, pero PF_CABLE_MACHINE_NAME_V1 antepone polea/cable sobre MACHINE_ATTACHMENT e incluye literalmente accesorios. Obligation requiere CABLE_RESISTANCE. Training FIX2 rechaza negativos no respaldados y mecanismos inexistentes. Los 20 IDs son ${s.cableBoundary.productIds.map(id=>'P'+id).join(', ')}. Dieciséis activos siguen fuera de Function Discovery; su Product family permanece admitida. Esto demuestra una frontera conceptual/rule-policy inconsistente, no adjudica por sí solo etiquetas verdaderas. P437 Soga de Tríceps contrasta con P1124 módulo Lat Pull Down con feature65=2:1: ambos mencionan accesorio, pero sólo el segundo tiene evidencia de mecanismo propia.

**Historical policy, MEASURED:** 45 IDs históricos emiten FAMILY_INFERENCE para disciplinas mientras mapProductSemantics registra SOURCE_CONFLICT por explicit-name policy. Ejemplos P397/P1093/P1107; cero exposición activa. Es conflicto de reglas/policy/provenance preexistente, no defecto por falta de una nueva familia. Los 45 IDs completos están en structural_consistency_checks y backlog.

**Specs/source, MEASURED:** 82 IDs conflictivos conservan raw values/source IDs; no se resuelve autoridad ni se llama contradicción ontológica a un desacuerdo de números. **Exercise vs Specs, NOT_MEASURABLE:** registry no codifica mínimos físicos universales por capability; no disponer de altura/peso no prueba incompatibilidad. **Source category vs family, PARTIAL/INFERRED:** múltiples categorías débiles/campaign no constituyen verdad taxonómica. **Disciplina vs contexto, UNKNOWN:** no hay disjointness contractual; coexistencia Home/Commercial no es contradicción automática.

${link('cross_dimension_conflicts.csv')} distingue SOURCE_CONFLICT, tensión de rol y hipótesis por nombre. ${link('structural_consistency_checks.json')} documenta checks que no se pueden evaluar razonablemente. Ningún P0 técnico/comercial falso de alto impacto fue demostrado en este scope.

## L. Ontology Gaps

${table(['Cohort verificado','Productos','Vigentes','Activos','Interpretación'],Object.entries(gaps).map(([k,g])=>[k,g.products,g.current,g.active,k==='ONTOLOGY_GAP'?'Scope/policy o concepto candidato; no defecto probado':k==='PARTIALLY_CLASSIFIED'?'Historia y evidencia limitada':k.startsWith('SPECS_')?'Fuente/normalización/autoridad':'Datos/evidencia/clasificación por adjudicar']))}

Cada cohort entrega todos los IDs, distribución por familia, source references y diagnóstico preliminar. Las hipótesis concretas siguientes no alteran el registry:

${table(['Concepto candidato','IDs vigentes detectados','Activos','Ejemplos / alcance'],s.qualitativeConcepts.map(c=>[c.conceptId,c.productIds.length,c.activeProductIds.length,c.activeProductIds.slice(0,6).map(id=>'P'+id).join(', ')]))}

Criterios exactos y ejemplos fuente se publican en ${link('candidate_missing_concepts.csv')} y ${link('qualitative_findings.json')}. Agilidad/plataformas, temporizadores y lastre corporal se marcan **HYPOTHESIS** de concepto, con comparación de definiciones pendiente. Packs/sets requieren relación de componentes: 220 vigentes/77 activos detectados por nombre son candidatos, no prueba de que todo set sea un bundle heterogéneo. Los cuatro candidatos de reglas existentes se mantienen separados de extensión ontológica. No se convierten todos los estados o hipótesis en remediación obligatoria.

## M. Discovery Readiness by Query Type

${table(['Consulta','Ontology','Source','Classification','Evidence','Admission','Facts activos / 886'],query)}

Los estados de soporte son sólo SUPPORTED/PARTIAL/UNAVAILABLE/UNKNOWN. Los conteos miden disponibilidad de facts bajo **superficies existentes**, no resultados de catalog.discover. Ejercicios/funciones cuentan sus admitted IDs separados; nombre/tipo utiliza Product Admission como proxy de tipo (nombre fuente existe en todos). Disciplina/contexto requieren tag presente y Product Admission, porque no hay gate separado por eje. Accesorios cuenta sólo MACHINE_ATTACHMENT admitido: no es cobertura universal de todos los accesorios. Multirrestricción=15 activos es un ejemplo deliberado de intersección Product+Exercise+Function+Specs; no es estimación de todas las consultas multirrestricción. Compatibilidad y alternativas no tienen denominador adjudicable ni superficie propia: NOT_MEASURABLE en conteos.

Las limitaciones y conjuntos exactos por consulta están en ${link('discovery_capability_matrix.csv')}. Antes de catalog.discover: resolver/aislar la frontera cable, formalizar qué restricciones tienen evidencia y contrato, excluir fit/dependencias/alternativas de claims generales, y validar independientemente clasificaciones en QA2. No se ejecutó retrieval, ranking, benchmarks o recomendaciones.

## N. QA2 Sampling Plan

280 IDs únicos: 160 STRATIFIED_RANDOM y 120 PURPOSIVE_DIFFICULT. Seed \`${sample.seed}\`. Ranking SHA256(seed + ':' + productId), digest ascendente, desempate ID. Estratos: current/historical × activeStatus × familia primaria. Asignación proporcional para 160: floor y mayores restos; desempate lexicográfico de estrato. Criterios, cuotas, probabilidades e IDs: ${link('sampling_plan.json')}.

La muestra estratificada representa el universo canónico por asignación proporcional. Estratos pequeños con cuota cero quedan declarados: no se afirma muestreo probabilístico no sesgado de cada familia rara ni se calcula precisión sin ponderación/adjudicación. El subconjunto intencional incluye targets FIX2, ambiguos, DATA_GAP, negativas ABSENT, Specs, OTHER activos, parciales históricos, multifunción y accesorios; deduplicación por ID con cuotas publicadas. Selección conjunta enriquecida **no representa la distribución del catálogo**.

Cobertura: ${sample.coverage.active} activos, ${sample.coverage.byClassification.CLASSIFIED} CLASSIFIED, ${sample.coverage.byClassification.PARTIALLY_CLASSIFIED} parciales, ${sample.coverage.byClassification.OTHER} OTHER y ${sample.coverage.byClassification.EXCLUDED_NON_PRODUCT} exclusiones; todas las 21 familias con población más residual. Cohorts: ${Object.entries(sample.coverage.knownGapCohorts).map(([k,n])=>k+'='+n).join(', ')}. Incluye todos los cinco AMBIGUOUS y los 15 targets explícitos de FIX2.

${link('qa2_review_sample.csv')} y ${link('qa2_sample_cases.json')} contienen nombre/familia/clasificación, evidence/provenance, conceptos usados/posiblemente ausentes, contradicciones, diagnóstico, certeza y requiresHumanAdjudication=true. Fuente independiente/gold label=UNAVAILABLE; adjudicationStatus=NOT_STARTED. Preparar la muestra no inicia QA2. Las fichas se inspeccionan como evidencia e hipótesis, no como verdad adjudicada por un LLM.

## O. Prioritized Remediation Backlog

${table(['Prioridad','Issue concreto','IDs afectados','Activos','Causa'],bRows)}

Ordenado por prioridad y exposición activa dentro de cada prioridad. Counts de issues se superponen: **no sumarlos**. Incluye problemas contractuales/policy, candidatos semánticos, datos y normalización; cantidad alta no prueba defecto ontológico. P0=ninguno demostrado. P1 prioriza riesgo de recuperación/claims en cable, compatibilidad, carga/dimensiones conflictivas y negativa sin evidencia; P2 localiza reglas/historia/parsers/roles candidatos; P3 mantiene deuda histórica sin exposición activa.

${link('prioritized_remediation_backlog.csv')} contiene IDs completos y activos, referencias de origen reproducibles, concepto, causa, severidad, exposición, impacto retrieval, riesgo de recomendación, evidencia, certeza, dependencias y siguiente decisión concreta. Ninguna corrección fue aplicada. Los keys Specs comercialmente útiles se enumeran por feature/unidad/contexto en G, sin recomendar un parser universal para texto heterogéneo.

## P. Evidence and Limitations

Entregables mínimos presentes: ontology_inventory.json, product_semantic_matrix.csv, coverage_by_family.csv, ontology_gaps.csv, cross_dimension_conflicts.csv, orphan_concepts.csv, discovery_capability_matrix.csv, qa2_review_sample.csv, prioritized_remediation_backlog.csv y audit_summary.json. Sidecars documentan cohorts, baseline, fuente completa, sampling, consumidores, checks estructurales e incidente. Todos los archivos grandes permanecen bajo artifacts/ ignorado por Git; informe y scripts son revisables sin commit/push.

Scripts independientes: [ontology-audit.mjs](../../scripts/audits/qa1/ontology-audit.mjs), [qualitative-review.mjs](../../scripts/audits/qa1/qualitative-review.mjs), [write-report.mjs](../../scripts/audits/qa1/write-report.mjs). Ejecución: \`node --import tsx scripts/audits/qa1/ontology-audit.mjs analyze\`, \`qualitative-review.mjs\`, \`write-report.mjs\` y luego \`ontology-audit.mjs finalize\`. Preflight exige un directorio nuevo; para un replay posterior elegir otro out y capturar sus fingerprints antes del análisis. No reutiliza npm hooks/builders ni el auditor anterior ejecutable. No instala dependencias.

Verificaciones de esta ejecución: hashes fuente/manifests/artifacts y lineage, asserts de cohorts/grupos, igualdad exacta de Admission por producto/superficie/seis keys con evidencia PRB no reescrita, comparación V2 completa por ID, round-trip CSV de 2048 filas y 280 fichas, unicidad, membership y cobertura de targets. No se ejecutaron npm test/pretest/bootstrap; no se necesitó la suite funcional porque no cambió runtime. Validadores leen las proyecciones; no reconstruyen bundles. No hubo EC2, deploy, PM2, extracción, pointer, commit/push ni cambios de ontología/reglas.

Fingerprint inicial QA1: ${authority.protectedFileCount} archivos preexistentes, incluidos artifacts/data/código/tests/docs/evidencias y copias locales productivas. El cierre verificó el mismo conjunto con **PASS_SINCE_QA1_PREFLIGHT: 2072/2072 fingerprints idénticos**; ${link('protected_before.json')}, ${link('protected_after.json')} y ${link('evidence_checksums.json')}. La captura fue **posterior al incidente de dos evidencias históricas**; igualdad posterior no lo borra. El corpus de 385 fingerprints del histórico PRB protected-after también coincide, documentado en ${link('historical_corpus_integrity.json')}; ese corpus no incluía los dos archivos reescritos. No se afirma «historia íntegra antes/después» para toda la sesión.

MEASURED = bytes/counts/estados/uso/contratos verificados; INFERRED = diagnóstico e impacto a partir de esas fuentes; HYPOTHESIS = nuevos roles/label correctness pendiente de adjudicación; NOT_MEASURABLE = precisión real, compatibilidad, fulfillment de consultas y suficiencia física de capacidades sin reference contract. No hay score único de productos defectuosos, precisión global ni 95% declarado.

## Q. Final Disposition

**QA2_WITH_SCOPE_RESTRICTIONS**

Se puede iniciar posteriormente una validación independiente de familias conocidas y facts modelados, separando vigentes/activos/históricos y DIRECT/SUPPORTED/FAMILY_DERIVED. Deben quedar fuera de cualquier declaración general de calidad: compatibilidad/sustitución/dependencias/composición, restricciones Specs no modeladas, grupos de papeles residuales sin definición adjudicada, negativa ABSENT como claim técnico, familias/dimensiones con UNKNOWN y frontera cable accesorio/máquina pendiente. Los históricos pueden revisarse como estrato propio, pero no inflar cobertura del catálogo activo. Las restricciones limitan claims; no exigen borrar los casos difíciles de las fichas QA2.

Los flags siguientes describen entregables analíticos, **no aprobación del procedimiento read-only completo** ni calidad verdadera del catálogo. La no conformidad de A/P permanece abierta a revisión.

\`\`\`text
QA1_COMPLETED=YES
ONTOLOGY_INVENTORY_COMPLETE=YES
PRODUCT_MATRIX_COMPLETE=YES
FAMILY_COVERAGE_MEASURED=YES
DISCOVERY_READINESS_ASSESSED=YES
QA2_SAMPLE_READY=YES
PRODUCTION_ROLLOUT_RECOMMENDATION=DEFER
\`\`\`

No se inició QA2/QA3, catalog.discover ni remediación. Rollout permanece DEFER hasta la validación independiente y decisión conjunta de calidad.
`;
await writeFile('docs/catalog-v2/P2_3_QA1_ONTOLOGY_SEMANTIC_COVERAGE_AUDIT.md',text);
console.log('Report written; active REQUIRED denominators '+exerciseRequired.length+'/'+functionRequired.length+'; active CLASSIFIED but not admitted '+nonadmitted.join(','));
