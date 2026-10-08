// P2.3-QA2 Phase 5: critical-case analysis. MEASURED facts from the design outputs (authority-derived);
// agent proposals are attached as PRELIMINARY and never converted into reference labels.
import assert from 'node:assert/strict';
import { assertEntry, OUT, readJson, guardedWriter, countBy, uniqueSorted, loadAuthoritative } from './lib.mjs';
import { evaluateAdmission } from './context.mjs';
import { PROPOSALS, PROPOSAL_META } from './agent-proposals.mjs';

assertEntry(import.meta.url);
const w = process.env.QA2_DRY === '1' ? { json: async () => {}, csv: async () => {}, text: async () => {} } : guardedWriter();
const packets = await readJson(`${OUT}/review_packets.json`), plan = await readJson(`${OUT}/sampling_plan.json`);
const by = new Map(packets.map(p => [p.productId, p])), C = plan.C_criticalCohorts;
const ids = k => C[k].productIds, pk = id => by.get(id);
const activeIds = k => ids(k).filter(id => pk(id).active === true);

// ---------- Proposals: validate and index ----------
for (const p of PROPOSALS) { assert(by.has(p.productId), `proposal for unknown packet ${p.productId}`);
  assert(['CORRECT', 'INCORRECT', 'INCOMPLETE', 'NOT_APPLICABLE', 'INSUFFICIENT_REFERENCE_EVIDENCE'].includes(p.outcome)); }
const prop = (id, claim) => PROPOSALS.filter(p => p.productId === id && (!claim || p.claim === claim));
const coverage = (cohort, claims) => { const miss = ids(cohort).filter(id => !claims.some(c => prop(id, c).length)); return { cohort, products: ids(cohort).length, withProposal: ids(cohort).length - miss.length, missing: miss }; };
const proposalCoverage = [coverage('CABLE_TRAINING_CONFLICT', ['FAMILY_PRIMARY']), coverage('CABLE_DATA_GAP', ['FAMILY_PRIMARY']), coverage('CLASSIFIED_NOT_PRODUCT_DISCOVERABLE', ['FAMILY_PRIMARY']),
  coverage('NEGATIVE_ABSENT', ['TRAINING_NEGATIVE']), coverage('OTHER_ACTIVE', ['FAMILY_PRIMARY']), coverage('TRAINING_DATA_GAP_OR_AMBIGUOUS_ACTIVE', ['TRAINING_ABSTENTION'])];
const summarise = (cohort, claim, active = false) => {
  const pop = active ? activeIds(cohort) : ids(cohort), rows = pop.flatMap(id => prop(id, claim));
  return { basis: 'AI_AGENT_PRELIMINARY — not adjudicated, not an accuracy estimate', population: pop.length, proposals: rows.length, byProposedOutcome: countBy(rows, r => r.outcome),
    byConfidence: countBy(rows, r => `${r.outcome}/${r.confidence}`) };
};

// ---------- Measured analyses ----------
const nameOf = id => pk(id).name;
const hasF65 = id => pk(id).evidence.sourceFeatures.some(f => f.featureId === 65);
const in451 = id => pk(id).evidence.sourceCategories.some(c => c.categoryId === 451);
const cableBoundary = ids('CABLE_BOUNDARY_ACTIVE').map(id => { const p = pk(id), s = p.system;
  const passive = /agarre|soga|barra (corta|de tr|lat|pulldown)|barra pulldown|tobiller|ankle strap|asiento/i.test(p.name) && !hasF65(id);
  const roleSignal = hasF65(id) ? (/accesorio/i.test(p.name) ? 'MODULE_WITH_OWN_MECHANISM_SIGNAL' : 'STATION_SIGNAL') : passive ? 'PASSIVE_ACCESSORY_SIGNAL' : 'NO_CABLE_ROLE_SIGNAL';
  return { productId: id, name: p.name, family: s.family, secondary: s.secondaryFamilies.join('|'), category451: in451(id), feature65: hasF65(id), roleSignal,
    trainingState: s.trainingV2State, cableResistance: s.trainingFacts.find(f => f.code === 'CABLE_RESISTANCE')?.relationType ?? 'NONE',
    productDiscovery: s.admission.surfaces.product, functionDiscovery: s.admission.surfaces.function, proposal: prop(id, 'FAMILY_PRIMARY')[0]?.proposed ?? null }; });
const crossTab = countBy(cableBoundary, r => `${r.roleSignal}→${r.family}`);
const passiveIn451 = cableBoundary.filter(r => r.category451 && r.roleSignal === 'PASSIVE_ACCESSORY_SIGNAL');

// Specs conflicts: which key is blocked, and what the competing raw values look like.
const conflictRows = activeIds('SPECS_CONFLICT_ACTIVE').flatMap(id => { const s = pk(id).system;
  const blocked = Object.entries(s.admission.specFilteringByKey).filter(([, d]) => d === 'BLOCKED').map(([k]) => k);
  return (blocked.length ? blocked : ['UNRESOLVED_KEY']).map(key => { const recs = s.specs.filter(r => r.key === key), raws = recs.map(r => String(r.rawValue));
    const pattern = raws.some(r => /caja/i.test(r)) ? 'PACKAGE_BOXES' : raws.some(r => /levantamiento|almacenamiento/i.test(r)) ? 'LOAD_CONTEXT_LIFT_VS_STORAGE'
      : raws.some(r => /plegad|posici[oó]n/i.test(r)) ? 'CONFIGURATION_STATES' : raws.some(r => /cada|por lado|accesorio|zona|barra|disco|rack|total/i.test(r)) ? 'PER_COMPONENT_VALUES'
      : new Set(recs.map(r => r.sourceFeature?.featureId)).size > 1 ? 'CROSS_FEATURE_DISAGREEMENT' : 'OTHER_MULTI_VALUE';
    return { productId: id, name: pk(id).name, family: s.family, key, records: recs.length, pattern, parsedValuesForKey: recs.filter(r => r.status === 'parsed').map(r => r.value), rawValues: raws }; }); });
// Published (parsed) spec values whose raw text carries a context qualifier: interpretation risk screen.
const qualifier = /incluido peso de usuario|cada|por lado|barra pull up|zona|accesorio|solo |sin peso|aprox|hasta|desde|\bmin\b|\bmax\b|:/i;
const interpretationRisk = packets.filter(p => p.active === true).flatMap(p => p.system.specs.filter(s => s.status === 'parsed' && qualifier.test(String(s.rawValue).replace(/^(Largo|Ancho|Alto)\b.*$/i, '')) && !/^(largo|ancho|alto)/i.test(String(s.rawValue).trim()))
  .map(s => ({ productId: p.productId, name: p.name, key: s.key, value: s.value, unit: s.unit, rawValue: s.rawValue, statisticalSample: !!p.membership.statisticalActive })));

// Unknown contractual applicability (active universe, per family x dimension) from the statistical/critical packets is partial;
// recompute from the full cohort list recorded in the design (IDs) plus packets where available.
const unknownIds = ids('UNKNOWN_APPLICABILITY_ACTIVE');
const L = await loadAuthoritative();
const unknownRows = unknownIds.map(id => { const p = L.src.products[L.sourceIndex.get(id)], ps = L.product.get(id), a = evaluateAdmission(L, p);
  return { productId: id, family: ps.primaryProductFamily?.code ?? ps.classificationStatus, unknownDimensions: Object.entries(a.obligations).filter(([, o]) => o.effectiveRequirement === 'UNKNOWN').map(([k]) => k).join('+') }; });

// ---------- Reproducible, contract-internal inconsistencies (MEASURED; no external truth needed) ----------
const reproducible = [
  { id: 'QA2-R1', title: 'Accesorios pasivos de polea clasificados como estación CABLE_MACHINE', basis: 'MEASURED inconsistency with registry definition text',
    products: passiveIn451.filter(r => r.family === 'CABLE_MACHINE').map(r => r.productId), contrast: passiveIn451.filter(r => r.family === 'MACHINE_ATTACHMENT').map(r => r.productId),
    evidence: 'Same category 451 and passive role; family depends on whether the name contains "polea". Definitions: CABLE_MACHINE="Cable/pulley stations"; MACHINE_ATTACHMENT lists ankle straps; category 451 is listed as CABLE_MACHINE negative evidence.',
    reproduce: `node -e "const p=require('./${OUT}/review_packets.json');for(const x of p)if(x.active&&x.evidence.sourceCategories.some(c=>c.categoryId===451))console.log(x.productId,x.system.family,x.name)"` },
  { id: 'QA2-R2', title: 'Obligación familiar CABLE_MACHINE→CABLE_RESISTANCE incompatible con negativa Training PRESENT', basis: 'MEASURED',
    products: ids('CABLE_TRAINING_CONFLICT'), activeBlockedFromFunctionDiscovery: activeIds('CABLE_TRAINING_CONFLICT').filter(id => pk(id).system.admission.surfaces.function === 'BLOCKED'),
    evidence: 'Admission keeps them in Product Discovery as CABLE_MACHINE while Function Discovery blocks them. Error surface: family search, not function search.' },
  { id: 'QA2-R3', title: 'Agarres OCR casi idénticos con Training opuesto', basis: 'MEASURED',
    products: [1331, 1332, 1335, 1333].filter(id => by.has(id)), evidence: uniqueSorted([1331, 1332, 1335, 1333]).map(id => `${id}:${pk(id)?.system.trainingFacts.map(f => f.code + '/' + f.relationType).join(',') || pk(id)?.system.trainingV2State}`).join('; ') },
  { id: 'QA2-R4', title: 'Política de packs inconsistente', basis: 'MEASURED',
    withFamily: packets.filter(p => p.active && /^pack /i.test(p.name) && p.system.family !== 'OTHER').map(p => `${p.productId}:${p.system.family}+${p.system.secondaryFamilies.join('+')}`),
    withoutFamily: packets.filter(p => p.active && /^pack /i.test(p.name) && p.system.family === 'OTHER').map(p => p.productId),
    evidence: 'Packs of machines/equipment receive primary+secondary families in some cases and OTHER in others; no bundle policy in the registry.' },
  { id: 'QA2-R5', title: 'J-Cups en la definición de MACHINE_ATTACHMENT sin regla por nombre', basis: 'MEASURED', products: ids('CLASSIFIED_NOT_PRODUCT_DISCOVERABLE'),
    evidence: 'All six rely only on category 292 (SEMANTIC_WEAK) → strength WEAK → ProductSemantics PARTIAL → not admitted (src/domain/catalog-admission/resolution.ts:52,81). Abstention, not false positive.' },
  { id: 'QA2-R6', title: 'SOURCE_CONFLICT de Specs dominado por valores multicomponente/empaque', basis: 'MEASURED pattern counts (regex taxonomy INFERRED)', patterns: countBy(conflictRows, r => r.pattern),
    evidence: 'The mapper treats several legitimately different values (boxes, per-bar loads, lift vs storage capacity, folded vs open) as source contradictions. The key is withheld from filtering (safe), but the label overstates contradiction.' },
  { id: 'QA2-R7', title: 'ABDOMINAL_CRUNCH sin assignments mientras rueda abdominal/AbMat/Core Roller quedan negativos o sin resolver', basis: 'MEASURED orphan + HYPOTHESIS false negative',
    products: [1863, 151, 1127, 1823].filter(id => by.has(id)) },
];

// ---------- Phase 5 groups ----------
const pct = (a, b) => b ? `${a}/${b} (${(100 * a / b).toFixed(1)}%)` : 'N/A';
const groups = [
  { group: 'CABLE_MACHINE frontera accesorio/módulo/estación', population: { conflict: ids('CABLE_TRAINING_CONFLICT').length, conflictActive: activeIds('CABLE_TRAINING_CONFLICT').length, boundaryActive: ids('CABLE_BOUNDARY_ACTIVE').length },
    measured: { roleSignalByFamily: crossTab, passiveAccessoriesIn451: { CABLE_MACHINE: passiveIn451.filter(r => r.family === 'CABLE_MACHINE').length, MACHINE_ATTACHMENT: passiveIn451.filter(r => r.family === 'MACHINE_ATTACHMENT').length } },
    preliminary: summarise('CABLE_TRAINING_CONFLICT', 'FAMILY_PRIMARY'), preliminaryTraining: summarise('CABLE_TRAINING_CONFLICT', 'TRAINING_NEGATIVE'),
    actuallyIncorrect: 'NOT_ADJUDICATED (agent proposes 20/20 family INCORRECT, HIGH confidence, contract-text basis)', outOfScope: 'Dependencia módulo→host y compatibilidad de agarres: UNAVAILABLE.',
    rootCause: 'Precedencia de PF_CABLE_MACHINE_NAME_V1 ("polea" en el nombre) sobre MACHINE_ATTACHMENT; ontología sin rol accesorio/módulo/estación.',
    discoverRisk: 'ALTO para búsqueda por familia "máquinas de poleas" (16 accesorios activos admitidos en Product Discovery). BAJO para búsqueda por función (bloqueados).',
    minimalCorrection: 'Excluir de PF_CABLE_MACHINE_NAME_V1 los nombres "Accesorio Polea"/agarre/soga/barra/tobillera/asiento sin feature 65 y enviarlos a MACHINE_ATTACHMENT; revisar override "Smith" para módulos (P1124).' },
  { group: 'Seis CLASSIFIED activos fuera de Product Discovery', population: ids('CLASSIFIED_NOT_PRODUCT_DISCOVERABLE').length,
    measured: { reasons: countBy(ids('CLASSIFIED_NOT_PRODUCT_DISCOVERABLE'), id => pk(id).system.admission.productDiscoveryReasons.join('+')) },
    preliminary: summarise('CLASSIFIED_NOT_PRODUCT_DISCOVERABLE', 'FAMILY_PRIMARY'), actuallyIncorrect: 'NOT_ADJUDICATED (agent: familia plausible 6/6; abstención, no error)',
    rootCause: 'Evidencia sólo por categoría 292 SEMANTIC_WEAK → PARTIAL; regla por nombre no cubre J-Cups/almohadilla/roller/bowl.', discoverRisk: 'BAJO (falsos negativos: 6 productos ausentes de búsqueda por familia).',
    minimalCorrection: 'Añadir vocabulario de nombre (J-Cups, soporte para fondos, almohadilla, roller, bowl + "Accesorio <serie>") a la regla MACHINE_ATTACHMENT; no relajar el gate WEAK.' },
  { group: 'Negativas Training ABSENT', population: { total: ids('NEGATIVE_ABSENT').length, active: activeIds('NEGATIVE_ABSENT').length },
    measured: { byFamily: countBy(ids('NEGATIVE_ABSENT'), id => pk(id).system.family) }, preliminary: summarise('NEGATIVE_ABSENT', 'TRAINING_NEGATIVE'),
    actuallyIncorrect: 'NOT_ADJUDICATED (agent: 3 probables falsos negativos en anillas; 2 ambiguos por definición ROW; resto correctos respecto del registry pero sin evidencia negativa)',
    outOfScope: 'Cardio, cuerda de salto, landmine: conceptos no modelados — la negativa es cierta sólo respecto del registry V2.',
    rootCause: 'Negativas emitidas por familia sin evidencia negativa explícita; ausencia de conceptos cardio/conditioning.', discoverRisk: 'MEDIO si catalog.discover interpreta VERIFIED_NO_APPLICABLE como "sin uso de entrenamiento".',
    minimalCorrection: 'No exponer negativas ABSENT como claim técnico; revisar anillas (PULL_UP/DIP/BODYWEIGHT_SUPPORT); aclarar alcance de ROW para ergómetros.' },
  { group: 'Productos OTHER activos', population: ids('OTHER_ACTIVE').length, measured: { trainingStates: countBy(ids('OTHER_ACTIVE'), id => pk(id).system.trainingV2State),
      withTrainingFacts: ids('OTHER_ACTIVE').filter(id => pk(id).system.trainingFacts.length).length, productDiscovery: countBy(ids('OTHER_ACTIVE'), id => pk(id).system.admission.surfaces.product) },
    preliminary: summarise('OTHER_ACTIVE', 'FAMILY_PRIMARY'), actuallyIncorrect: 'NOT_ADJUDICATED',
    outOfScope: 'Agilidad/pliometría, lastre corporal, timers, accesorios de hidratación: fuera de la ontología v3 (abstención correcta respecto del registry).',
    rootCause: 'Mezcla de (a) roles no modelados, (b) vocabulario de reglas incompleto para familias existentes (glute bands, SSB, mat), (c) ausencia de política de bundles.',
    discoverRisk: 'MEDIO: falsos negativos en búsquedas por familia (bandas, barras, máquinas en pack); ningún falso positivo porque OTHER no se admite.',
    minimalCorrection: 'Reglas de vocabulario para familias existentes (P427/P878/P879, P797, P388, P1193, P2113) y decisión de política de packs; nuevos roles sólo con contrato propio.' },
  { group: 'Conflictos Specs activos', population: activeIds('SPECS_CONFLICT_ACTIVE').length, measured: { conflictKeyRows: conflictRows.length, patterns: countBy(conflictRows, r => r.pattern), byKey: countBy(conflictRows, r => r.key) },
    interpretationRiskParsedValues: { activeRecords: interpretationRisk.length, products: uniqueSorted(interpretationRisk.map(r => r.productId)).length, byKey: countBy(interpretationRisk, r => r.key) },
    actuallyIncorrect: 'NOT_ADJUDICATED; los conflictos no publican valor para la key bloqueada (abstención segura). El riesgo real está en valores parsed con calificador contextual (lista interpretation_risk).',
    rootCause: 'Features multivalor (cajas, componentes, contextos de carga, configuraciones) tratadas como contradicción de fuentes.', discoverRisk: 'BAJO para conflictos (bloqueados); MEDIO para filtros por max_user_weight_kg/max_load_kg con valores calificados.',
    minimalCorrection: 'Subtipo de conflicto (MULTI_COMPONENT/PACKAGE/CONTEXT) y exclusión de valores con calificador de componente en max_*_kg.' },
  { group: 'Aplicabilidad contractual desconocida', population: unknownIds.length,
    measured: { byDimensions: countBy(unknownRows, r => r.unknownDimensions), byFamilyAndDimensions: countBy(unknownRows, r => `${r.family}:${r.unknownDimensions}`) },
    actuallyIncorrect: 'NOT_APPLICABLE — UNKNOWN es un estado contractual, no una clasificación; no se adjudica por producto.',
    rootCause: 'Obligaciones de TRAINING_EXERCISE/FUNCTION no definidas para la mayoría de familias (fuera del mínimo A00.6.4).', discoverRisk: 'ALTO para afirmaciones de cobertura: no se puede certificar búsqueda por ejercicio/función sobre estas familias.',
    minimalCorrection: 'Declarar explícitamente NOT_REQUIRED o REQUIRED por familia×dimensión en el contrato; no inferir.' },
  { group: 'Conceptos posiblemente faltantes (QA1)', population: ids('QA1_CANDIDATE_MISSING_CONCEPT_ACTIVE').length,
    measured: { otherOverlap: ids('QA1_CANDIDATE_MISSING_CONCEPT_ACTIVE').filter(id => ids('OTHER_ACTIVE').includes(id)).length },
    actuallyIncorrect: 'NOT_APPLICABLE — hipótesis de ontología, no errores de clasificación.', rootCause: 'Roles comerciales sin familia (agilidad, lastre, timing, bundles).',
    discoverRisk: 'MEDIO: consultas por estos roles no tienen soporte; no deben responderse con familias cercanas.', minimalCorrection: 'Decisión de producto/ontología por concepto; QA2 no la toma.' },
];

const backlog = [
  { priority: 'P1', id: 'QA2-B1', issue: 'Frontera CABLE_MACHINE / MACHINE_ATTACHMENT', products: reproducible[0].products.length, active: reproducible[0].products.filter(id => pk(id).active).length, dimension: 'PRODUCT_SEMANTICS', type: 'RULE_PRECEDENCE', blocksSurface: 'NAME_FAMILY', ref: 'QA2-R1,QA2-R2' },
  { priority: 'P1', id: 'QA2-B2', issue: 'Ejecutar adjudicación humana de la muestra A (312) y cohortes críticas', products: plan.A_statisticalActive.n, active: plan.A_statisticalActive.n, dimension: 'ALL', type: 'PROCESS', blocksSurface: 'ALL', ref: 'adjudication_protocol.json' },
  { priority: 'P1', id: 'QA2-B3', issue: 'Negativas ABSENT expuestas como claim', products: ids('NEGATIVE_ABSENT').length, active: activeIds('NEGATIVE_ABSENT').length, dimension: 'TRAINING_V2', type: 'CLAIM_SCOPE', blocksSurface: 'EXERCISE,FUNCTION', ref: 'critical_cases.json' },
  { priority: 'P1', id: 'QA2-B4', issue: 'Aplicabilidad UNKNOWN por familia×dimensión', products: unknownIds.length, active: unknownIds.length, dimension: 'TRAINING_V2', type: 'CONTRACT', blocksSurface: 'EXERCISE,FUNCTION,MULTI', ref: 'critical_cases.json' },
  { priority: 'P2', id: 'QA2-B5', issue: 'Valores Specs parsed con calificador contextual', products: uniqueSorted(interpretationRisk.map(r => r.productId)).length, active: uniqueSorted(interpretationRisk.map(r => r.productId)).length, dimension: 'SPECS', type: 'INTERPRETATION', blocksSurface: 'SPECS', ref: 'specs_interpretation_risk.csv' },
  { priority: 'P2', id: 'QA2-B6', issue: 'Vocabulario de reglas para familias existentes (bandas, SSB, push-up, salmon ladder, mat, J-cups)', products: 11, active: 11, dimension: 'PRODUCT_SEMANTICS', type: 'RULE_VOCABULARY', blocksSurface: 'NAME_FAMILY', ref: 'agent_preliminary_proposals.json' },
  { priority: 'P2', id: 'QA2-B7', issue: 'Política de bundles/packs', products: reproducible[3].withFamily.length + reproducible[3].withoutFamily.length, active: reproducible[3].withFamily.length + reproducible[3].withoutFamily.length, dimension: 'PRODUCT_SEMANTICS', type: 'ONTOLOGY_POLICY', blocksSurface: 'NAME_FAMILY,MULTI', ref: 'QA2-R4' },
  { priority: 'P2', id: 'QA2-B8', issue: 'Subtipado de SOURCE_CONFLICT Specs', products: activeIds('SPECS_CONFLICT_ACTIVE').length, active: activeIds('SPECS_CONFLICT_ACTIVE').length, dimension: 'SPECS', type: 'NORMALIZATION', blocksSurface: 'SPECS', ref: 'QA2-R6' },
  { priority: 'P3', id: 'QA2-B9', issue: 'Anillas / ABDOMINAL_CRUNCH / OCR grips: posibles falsos negativos o atribución al host', products: 9, active: 8, dimension: 'TRAINING_V2', type: 'RULE_OR_DEFINITION', blocksSurface: 'EXERCISE,FUNCTION', ref: 'QA2-R3,QA2-R7' },
];

await w.json('agent_preliminary_proposals.json', { ...PROPOSAL_META, count: PROPOSALS.length, coverage: proposalCoverage, proposals: PROPOSALS });
await w.json('critical_cases.json', { basis: 'MEASURED cohorts and patterns; proposals are AI_AGENT_PRELIMINARY', groups, reproducibleInconsistencies: reproducible });
await w.csv('cable_boundary_active.csv', cableBoundary);
await w.csv('specs_conflict_taxonomy.csv', conflictRows);
await w.csv('specs_interpretation_risk.csv', interpretationRisk);
await w.csv('remediation_backlog.csv', backlog);
await w.csv('unknown_applicability_active.csv', unknownRows);
console.log(JSON.stringify({ proposals: PROPOSALS.length, proposalCoverage, crossTab, passive451: groups[0].measured.passiveAccessoriesIn451, conflictPatterns: countBy(conflictRows, r => r.pattern),
  interpretationRisk: interpretationRisk.length, unknown: unknownIds.length, groupsPrelim: groups.map(g => [g.group, g.preliminary?.byProposedOutcome]) }, null, 1));
