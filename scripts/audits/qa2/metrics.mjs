// P2.3-QA2 Phases 3-4 and 6: metric engine, exact-census system metrics, surface decisions.
// Consumes ONLY human labels (reviewerType HUMAN). Without labels every accuracy metric is NOT_ESTIMABLE.
// Usage: node --import tsx scripts/audits/qa2/metrics.mjs [--labels <qa2-labels-v1.json>]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertEntry, OUT, CANDIDATE_ID, readJson, guardedWriter, countBy, rankIds } from './lib.mjs';
import { ratioEstimate, targetVerdict, clopperPearson } from './estimators.mjs';

assertEntry(import.meta.url);
const w = process.env.QA2_DRY === '1' ? { json: async () => {}, csv: async () => {}, text: async () => {} } : guardedWriter();
const dataset = await readJson(`${OUT}/adjudication_dataset.json`), plan = await readJson(`${OUT}/sampling_plan.json`), packets = await readJson(`${OUT}/review_packets.json`);
const labelArg = process.argv.indexOf('--labels');
const labels = labelArg > 0 ? await readJson(process.argv[labelArg + 1]) : { schemaVersion: 'qa2-labels-v1', candidate: CANDIDATE_ID, reviews: [], productReferences: [] };

export const OUTCOMES = ['CORRECT', 'INCORRECT', 'INCOMPLETE', 'NOT_APPLICABLE', 'INSUFFICIENT_REFERENCE_EVIDENCE', 'NOT_ADJUDICATED'];
const JUDGED = new Set(['CORRECT', 'INCORRECT', 'INCOMPLETE']);
const MIN_ADJUDICATED_SHARE = 0.9, MIN_DOMAIN_UNITS = 20;

// ---------- Label resolution (human only; two-reviewer protocol) ----------
function resolveLabels(lbl) {
  assert.equal(lbl.schemaVersion, 'qa2-labels-v1'); assert.equal(lbl.candidate, CANDIDATE_ID);
  const rejected = [], groups = new Map();
  for (const r of lbl.reviews) {
    if (r.reviewerType !== 'HUMAN') { rejected.push({ ...r, why: 'NON_HUMAN_REVIEWER' }); continue; }
    if (!OUTCOMES.includes(r.outcome) || r.outcome === 'NOT_ADJUDICATED') { rejected.push({ ...r, why: 'INVALID_OUTCOME' }); continue; }
    if (!['E1', 'E2', 'E3'].includes(r.evidenceIndependence)) { rejected.push({ ...r, why: 'EVIDENCE_NOT_INDEPENDENT' }); continue; }
    const k = `${r.claimId}|${r.facet}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r);
  }
  const final = new Map(), agreement = [];
  for (const [k, rs] of groups) {
    const r1 = rs.find(r => r.role === 'R1'), r2 = rs.find(r => r.role === 'R2'), adj = rs.find(r => r.role === 'ADJUDICATOR');
    if (r1 && r2 && r1.reviewerId === r2.reviewerId) { rejected.push({ key: k, why: 'SAME_REVIEWER_R1_R2' }); continue; }
    if (r1 && r2) agreement.push({ key: k, dimension: k.split(':')[1], r1: r1.outcome, r2: r2.outcome });
    if (r1 && r2 && r1.outcome === r2.outcome) final.set(k, { outcome: r1.outcome, basis: 'AGREEMENT', evidence: [r1.evidenceIndependence, r2.evidenceIndependence].sort()[0] });
    else if (adj) final.set(k, { outcome: adj.outcome, basis: 'ADJUDICATED', evidence: adj.evidenceIndependence });
    else final.set(k, { outcome: 'NOT_ADJUDICATED', basis: r1 && r2 ? 'DISAGREEMENT_PENDING' : 'SINGLE_REVIEW_NOT_COUNTED' });
  }
  return { final, rejected, agreement };
}
function kappa(pairs) {
  if (!pairs.length) return null;
  const cats = [...new Set(pairs.flatMap(p => [p.r1, p.r2]))], n = pairs.length;
  const po = pairs.filter(p => p.r1 === p.r2).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(p => p.r1 === c).length / n) * (pairs.filter(p => p.r2 === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

// ---------- Metric definitions ----------
const claimsOf = id => dataset.records.find(r => r.productId === id)?.claims ?? [];
const facetUnit = (pred, facet, opts = {}) => (id, final) => {
  let y = 0, z = 0, pending = 0, insufficient = 0, domain = 0;
  for (const c of claimsOf(id).filter(pred)) {
    if (!(facet in c.facets)) continue; domain++;
    const f = final.get(`${c.claimId}|${facet}`) ?? { outcome: 'NOT_ADJUDICATED' };
    if (f.outcome === 'NOT_ADJUDICATED') { pending++; continue; }
    if (f.outcome === 'INSUFFICIENT_REFERENCE_EVIDENCE') { insufficient++; continue; }
    if (opts.minEvidence === 'E2' && f.evidence === 'E1' && JUDGED.has(f.outcome)) { insufficient++; continue; }
    if (!JUDGED.has(f.outcome)) continue;
    z++; if (f.outcome === 'CORRECT' || (opts.lenient && f.outcome === 'INCOMPLETE')) y++;
  }
  return { y, z, pending, insufficient, domain };
};
const isType = (...t) => c => t.includes(c.claimType);
const SPEC_KEYS = ['max_user_weight_kg', 'max_load_kg', 'assembled_length_cm', 'assembled_width_cm', 'assembled_height_cm', 'weight_kg'];
const METRICS = [
  { id: 'PS-FAMILY-ACCURACY', dimension: 'PRODUCT_SEMANTICS', surface: 'NAME_FAMILY', unit: 'product', fn: facetUnit(c => c.claimType === 'FAMILY_PRIMARY' && c.code !== 'OTHER', 'DECISION') },
  { id: 'PS-FAMILY-DECISION-INCL-OTHER', dimension: 'PRODUCT_SEMANTICS', surface: 'NAME_FAMILY', unit: 'product', fn: facetUnit(isType('FAMILY_PRIMARY', 'EXCLUSION'), 'DECISION') },
  { id: 'PS-OTHER-ABSTENTION-CORRECT', dimension: 'PRODUCT_SEMANTICS', surface: 'NAME_FAMILY', unit: 'product', fn: facetUnit(c => c.claimType === 'FAMILY_PRIMARY' && c.code === 'OTHER', 'DECISION') },
  { id: 'PS-SECONDARY-FAMILY-PRECISION', dimension: 'PRODUCT_SEMANTICS', surface: 'NAME_FAMILY', unit: 'claim', fn: facetUnit(isType('FAMILY_SECONDARY'), 'DECISION') },
  { id: 'PS-DISCIPLINE-PRECISION', dimension: 'PRODUCT_SEMANTICS', surface: 'DISCIPLINE', unit: 'claim', fn: facetUnit(isType('DISCIPLINE'), 'DECISION') },
  { id: 'PS-USE-CONTEXT-PRECISION', dimension: 'PRODUCT_SEMANTICS', surface: 'USE_CONTEXT', unit: 'claim', fn: facetUnit(isType('USE_CONTEXT'), 'DECISION') },
  { id: 'TR-EXERCISE-FACT-PRECISION', dimension: 'TRAINING_V2', surface: 'EXERCISE', unit: 'claim', fn: facetUnit(isType('EXERCISE'), 'FACT') },
  { id: 'TR-EXERCISE-RELATION-TYPE', dimension: 'TRAINING_V2', surface: 'EXERCISE', unit: 'claim', fn: facetUnit(isType('EXERCISE'), 'RELATION_TYPE') },
  { id: 'TR-FUNCTION-FACT-PRECISION', dimension: 'TRAINING_V2', surface: 'FUNCTION', unit: 'claim', fn: facetUnit(isType('FUNCTION'), 'FACT') },
  { id: 'TR-FUNCTION-RELATION-TYPE', dimension: 'TRAINING_V2', surface: 'FUNCTION', unit: 'claim', fn: facetUnit(isType('FUNCTION'), 'RELATION_TYPE') },
  { id: 'TR-FAMILY-DERIVED-PRECISION', dimension: 'TRAINING_V2', surface: 'FUNCTION', unit: 'claim', fn: facetUnit(c => c.claimType === 'FUNCTION' && c.code.endsWith('/FAMILY_DERIVED'), 'FACT') },
  { id: 'TR-HOST-ATTRIBUTION-CORRECT', dimension: 'TRAINING_V2', surface: 'FUNCTION', unit: 'claim', fn: facetUnit(isType('EXERCISE', 'FUNCTION'), 'HOST_ATTRIBUTION') },
  { id: 'TR-NEGATIVE-CORRECT', dimension: 'TRAINING_V2', surface: 'EXERCISE', unit: 'product', fn: facetUnit(isType('NEGATIVE'), 'DECISION') },
  { id: 'TR-ABSTENTION-JUSTIFIED', dimension: 'TRAINING_V2', surface: 'EXERCISE', unit: 'product', fn: facetUnit(c => c.claimType === 'ABSTENTION' && c.dimension === 'TRAINING_V2', 'DECISION') },
  ...SPEC_KEYS.flatMap(k => [
    { id: `SP-${k}-VALUE-FACT`, dimension: 'SPECS', surface: 'SPECS', unit: 'claim', fn: facetUnit(c => c.claimType === 'SPEC_VALUE' && c.code.startsWith(k + '#'), 'VALUE', { minEvidence: 'E2' }) },
    { id: `SP-${k}-VALUE-PARSE-FIDELITY`, dimension: 'SPECS', surface: 'SPECS', unit: 'claim', fn: facetUnit(c => c.claimType === 'SPEC_VALUE' && c.code.startsWith(k + '#'), 'VALUE') },
    { id: `SP-${k}-UNIT`, dimension: 'SPECS', surface: 'SPECS', unit: 'claim', fn: facetUnit(c => c.claimType === 'SPEC_VALUE' && c.code.startsWith(k + '#'), 'UNIT') },
    { id: `SP-${k}-INTERPRETATION`, dimension: 'SPECS', surface: 'SPECS', unit: 'claim', fn: facetUnit(c => c.claimType === 'SPEC_VALUE' && c.code.startsWith(k + '#'), 'PHYSICAL_INTERPRETATION', { minEvidence: 'E2' }) }]),
  { id: 'SP-UNRESOLVED-JUSTIFIED', dimension: 'SPECS', surface: 'SPECS', unit: 'claim', fn: facetUnit(isType('SPEC_UNRESOLVED'), 'UNRESOLVED_JUSTIFIED') },
  { id: 'SP-CONFLICT-RECOGNIZED', dimension: 'SPECS', surface: 'SPECS', unit: 'product', fn: facetUnit(isType('SPEC_CONFLICT'), 'DECISION') },
];

// ---------- Universes ----------
const A = plan.A_statisticalActive, designA = new Map(A.allocation.map(a => [a.stratum, { N: a.N, n: a.n }]));
const unitsA = A.allocation.flatMap(a => a.selectedIds.map(id => ({ id, stratum: a.stratum })));
const qa1Quotas = (await readJson('artifacts/catalog-v2/qa1/run-20261008-bddf7f/sampling_plan.json')).representativeSubset.quotas.filter(q => q.n > 0);
const designB = new Map(qa1Quotas.map(q => [q.stratum, { N: q.population, n: q.n }]));
const unitsB = qa1Quotas.flatMap(q => q.selectedIds.map(id => ({ id, stratum: q.stratum })));
const coveredB = qa1Quotas.reduce((s, q) => s + q.population, 0);
const diagnosticIds = plan.B_diagnosticQA1 && dataset.records.filter(r => r.membership.diagnosticQA1?.subset === 'PURPOSIVE_DIFFICULT').map(r => r.productId);

function evaluate(metric, universe, final) {
  if (universe === 'DIAGNOSTIC_PURPOSIVE') {
    const rows = diagnosticIds.map(id => metric.fn(id, final)), z = rows.reduce((s, r) => s + r.z, 0), y = rows.reduce((s, r) => s + r.y, 0);
    const pending = rows.reduce((s, r) => s + r.pending, 0), domain = rows.reduce((s, r) => s + r.domain, 0);
    return { metric: metric.id, universe, status: 'DIAGNOSTIC_ONLY', numerator: y, denominator: z, observed: z ? y / z : null, domainClaimsInSample: domain, notAdjudicated: pending, weights: 'NONE (purposive)' };
  }
  const [units, design, popLabel] = universe === 'ACTIVE_886' ? [unitsA, designA, 886] : [unitsB, designB, coveredB];
  const rows = units.map(u => ({ ...u, ...metric.fn(u.id, final) }));
  const domain = rows.reduce((s, r) => s + r.domain, 0), pending = rows.reduce((s, r) => s + r.pending, 0), insufficient = rows.reduce((s, r) => s + r.insufficient, 0);
  const domainUnits = rows.filter(r => r.domain > 0).length, adjudicatedShare = domain ? (domain - pending) / domain : 0;
  const base = { metric: metric.id, dimension: metric.dimension, surface: metric.surface, unit: metric.unit, universe, population: popLabel, sampledUnits: units.length,
    domainUnitsInSample: domainUnits, domainClaimsInSample: domain, notAdjudicated: pending, insufficientReferenceEvidence: insufficient, adjudicatedShare };
  if (!domain) return { ...base, status: 'NOT_ESTIMABLE', reason: 'EMPTY_DOMAIN_IN_SAMPLE' };
  if (adjudicatedShare < MIN_ADJUDICATED_SHARE) return { ...base, status: 'NOT_ESTIMABLE', reason: final.size ? 'ADJUDICATION_INCOMPLETE' : 'NO_HUMAN_LABELS' };
  const est = ratioEstimate(rows.map(r => ({ stratum: r.stratum, y: r.y, z: r.z })), design);
  if (est.estimate === null) return { ...base, status: 'NOT_ESTIMABLE', reason: est.reason };
  if (!est.allCensus && est.sampleDenominatorUnits < MIN_DOMAIN_UNITS) return { ...base, status: 'NOT_ESTIMABLE', reason: 'INSUFFICIENT_SAMPLE', numerator: est.rawNumerator, denominator: est.rawDenominator };
  const pessimistic = ratioEstimate(rows.map(r => ({ stratum: r.stratum, y: r.y, z: r.z + r.insufficient })), design).estimate;
  return { ...base, status: est.allCensus ? 'EXACT_CENSUS' : 'ESTIMATED', numerator: est.rawNumerator, denominator: est.rawDenominator, estimate: est.estimate, se: est.se,
    nEff: est.nEff, nEffBasis: est.nEffBasis, ci95ClopperPearson: est.clopperPearson95, ci95Wilson: est.wilson95, weighted: { numerator: est.populationNumerator, denominator: est.populationDenominator },
    sensitivityInsufficientAsIncorrect: pessimistic, target95: targetVerdict(est) };
}
function runAll(final) {
  return METRICS.flatMap(m => ['ACTIVE_886', 'CANONICAL_QA1_STRATIFIED', 'DIAGNOSTIC_PURPOSIVE'].map(u => evaluate(m, u, final)));
}
const familiesA = [...new Set(A.allocation.map(a => a.family))].sort();
function perFamily(final) {
  return familiesA.map(f => {
    const est = A.familyEstimability.find(x => x.family === f);
    const m = { id: `PS-FAMILY-PRECISION:${f}`, fn: (id, fin) => facetUnit(c => c.claimType === 'FAMILY_PRIMARY' && c.code === f, 'DECISION')(id, fin) };
    const r = evaluate({ ...m, dimension: 'PRODUCT_SEMANTICS', surface: 'NAME_FAMILY', unit: 'product' }, 'ACTIVE_886', final);
    return { family: f, design: est, ...r, status: est.status === 'NOT_ESTIMABLE_INSUFFICIENT_SAMPLE' && r.status !== 'NOT_ESTIMABLE' ? 'NOT_ESTIMABLE' : r.status,
      recall: final.size ? 'REQUIRES reference.primaryFamily on every sampled product' : 'NOT_ESTIMABLE (NO_HUMAN_LABELS)' };
  });
}

// ---------- Exact census of SYSTEM states over the 886 active (coverage/abstention, not accuracy) ----------
const census = (() => {
  // Packets do not hold every active product; counts here come from sampling_plan strata (exact) and cohort lists (exact).
  const N = 886, C = plan.C_criticalCohorts, strata = A.allocation;
  const sum = f => strata.filter(f).reduce((s, a) => s + a.N, 0);
  return { basis: 'EXACT_CENSUS of system states; says nothing about truth', universe: N,
    familyAssigned: sum(a => !['OTHER', 'EXCLUDED_NON_PRODUCT'].includes(a.family)), other: sum(a => a.family === 'OTHER'), excluded: sum(a => a.family === 'EXCLUDED_NON_PRODUCT'),
    withTrainingFacts: sum(a => a.factsFlag === 'FACTS'), classifiedNotProductDiscoverable: C.CLASSIFIED_NOT_PRODUCT_DISCOVERABLE.n, negativeAbsentActive: C.NEGATIVE_ABSENT.active,
    trainingDataGapOrAmbiguous: C.TRAINING_DATA_GAP_OR_AMBIGUOUS_ACTIVE.n, ontologyGap: C.ONTOLOGY_GAP_ACTIVE.n, unknownApplicability: C.UNKNOWN_APPLICABILITY_ACTIVE.n,
    specsConflict: C.SPECS_CONFLICT_ACTIVE.n, specsAmbiguousOrUnsupported: C.SPECS_AMBIGUOUS_ACTIVE.n, cableTrainingConflict: C.CABLE_TRAINING_CONFLICT.active };
})();

// ---------- Phase 6: surface decisions ----------
const SURFACES = {
  NAME_FAMILY: ['PS-FAMILY-ACCURACY', 'PS-FAMILY-DECISION-INCL-OTHER'], DISCIPLINE: ['PS-DISCIPLINE-PRECISION'], USE_CONTEXT: ['PS-USE-CONTEXT-PRECISION'],
  EXERCISE: ['TR-EXERCISE-FACT-PRECISION', 'TR-EXERCISE-RELATION-TYPE', 'TR-NEGATIVE-CORRECT'], FUNCTION: ['TR-FUNCTION-FACT-PRECISION', 'TR-FUNCTION-RELATION-TYPE', 'TR-HOST-ATTRIBUTION-CORRECT'],
  SPECS: SPEC_KEYS.flatMap(k => [`SP-${k}-VALUE-FACT`, `SP-${k}-UNIT`, `SP-${k}-INTERPRETATION`]),
  MULTIPLE_CONSTRAINTS: ['PS-FAMILY-ACCURACY', 'TR-EXERCISE-FACT-PRECISION', 'TR-FUNCTION-FACT-PRECISION', ...SPEC_KEYS.map(k => `SP-${k}-VALUE-FACT`)],
};
const PRE_ADJ = { NAME_FAMILY: 'QA2-R1/R2 (accesorios de polea como CABLE_MACHINE), QA2-R4 (packs), 12 OTHER con familia existente probable (preliminar)',
  EXERCISE: 'Aplicabilidad UNKNOWN en la mayoría de familias; negativas ABSENT; anillas/AbMat posibles falsos negativos', FUNCTION: 'QA2-R2, QA2-R3 (atribución al host)',
  SPECS: '88 valores parsed con calificador contextual; conflictos multicomponente', MULTIPLE_CONSTRAINTS: 'Hereda todos los anteriores; intersección de 15 activos según QA1' };
function decide(results) {
  const get = id => results.find(r => r.metric === id && r.universe === 'ACTIVE_886');
  const out = Object.entries(SURFACES).map(([surface, ids]) => {
    const rs = ids.map(get), statuses = rs.map(r => r.status), targets = rs.map(r => r.target95);
    const decision = rs.some(r => ['TARGET_NOT_MET', 'TARGET_NOT_MET_EXACT'].includes(r.target95)) ? 'QUALITY_INSUFFICIENT'
      : rs.every(r => ['ESTIMATED', 'EXACT_CENSUS'].includes(r.status) && ['TARGET_MET', 'TARGET_MET_EXACT'].includes(r.target95)) ? 'QUALITY_VALIDATED' : 'INSUFFICIENT_SAMPLE';
    return { surface, decision, requiredMetrics: ids, statuses: countBy(statuses, s => s), targets: countBy(targets, t => t ?? 'NOT_ESTIMABLE'), preAdjudicationRisk: PRE_ADJ[surface] ?? null,
      scopeRestriction: surface === 'EXERCISE' || surface === 'FUNCTION' ? 'Sólo los 24 ejercicios / 5 funciones modelados y familias con obligación conocida' : surface === 'SPECS' ? 'Sólo las 6 keys modeladas' : null };
  });
  for (const s of ['COMPATIBILITY', 'SUBSTITUTION_ALTERNATIVES', 'COMPOSITION_BUNDLES', 'SPECS_OUTSIDE_SIX_KEYS', 'AGILITY_WEARABLE_TIMING_ROLES'])
    out.push({ surface: s, decision: 'UNSUPPORTED_BY_ONTOLOGY', reason: s === 'SPECS_OUTSIDE_SIX_KEYS' ? 'Material, espesor, resistencia, largo total, ancho, circunferencia, relación de polea sin key Specs' : 'relationships/capabilities UNAVAILABLE o rol no modelado; excluido de certificación' });
  return out;
}

// ---------- Estimator self-test (SYNTHETIC data; validates code, not the catalog) ----------
function selfTest() {
  const h = s => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16) / 0xffffffff;
  const pop = A.allocation.flatMap(a => Array.from({ length: a.N }, (_, i) => ({ stratum: a.stratum, id: `${a.stratum}#${i}`, p: a.factsFlag === 'FACTS' ? 0.93 : 0.97 })));
  const truthY = pop.map(u => (h('truth:' + u.id) < u.p ? 1 : 0)), trueRate = truthY.reduce((a, b) => a + b, 0) / pop.length;
  let covered = 0, coveredW = 0, sumEst = 0; const R = 1000;
  for (let r = 0; r < R; r++) {
    const units = A.allocation.flatMap(a => { const idx = pop.map((u, i) => [u, i]).filter(([u]) => u.stratum === a.stratum);
      return rankIds(`rep${r}`, idx.map(([, i]) => i)).slice(0, a.n).map(i => ({ stratum: a.stratum, y: truthY[i], z: 1 })); });
    const e = ratioEstimate(units, designA); sumEst += e.estimate;
    if (e.clopperPearson95[0] <= trueRate && trueRate <= e.clopperPearson95[1]) covered++;
    if (e.wilson95[0] <= trueRate && trueRate <= e.wilson95[1]) coveredW++;
  }
  const censusDesign = new Map([['X', { N: 5, n: 5 }]]), c = ratioEstimate([1, 1, 0, 1, 1].map(y => ({ stratum: 'X', y, z: 1 })), censusDesign);
  const srs = ratioEstimate(Array.from({ length: 100 }, (_, i) => ({ stratum: 'S', y: i < 95 ? 1 : 0, z: 1 })), new Map([['S', { N: 1000, n: 100 }]]));
  const srsVarExpected = (1 - 0.1) * 0.95 * 0.05 / 99;
  const synthLabels = { schemaVersion: 'qa2-labels-v1', candidate: CANDIDATE_ID, reviews: [
    { claimId: 'X:1', facet: 'DECISION', reviewerId: 'h1', reviewerType: 'HUMAN', role: 'R1', outcome: 'CORRECT', evidenceIndependence: 'E2' },
    { claimId: 'X:1', facet: 'DECISION', reviewerId: 'h2', reviewerType: 'HUMAN', role: 'R2', outcome: 'INCORRECT', evidenceIndependence: 'E2' },
    { claimId: 'X:1', facet: 'DECISION', reviewerId: 'h3', reviewerType: 'HUMAN', role: 'ADJUDICATOR', outcome: 'INCORRECT', evidenceIndependence: 'E3' },
    { claimId: 'X:2', facet: 'DECISION', reviewerId: 'claude', reviewerType: 'AI_AGENT_PRELIMINARY', role: 'R1', outcome: 'CORRECT', evidenceIndependence: 'E1' },
    { claimId: 'X:3', facet: 'DECISION', reviewerId: 'h1', reviewerType: 'HUMAN', role: 'R1', outcome: 'CORRECT', evidenceIndependence: 'E1' }] };
  const res = resolveLabels(synthLabels);
  const checks = {
    ciCoverageClopperPearson: covered / R, ciCoverageWilson: coveredW / R, meanEstimateMinusTruth: sumEst / R - trueRate,
    censusExact: c.allCensus && c.estimate === 0.8 && c.variance === 0, srsVarianceMatches: Math.abs(srs.variance - srsVarExpected) < 1e-12,
    disagreementResolvedByAdjudicator: res.final.get('X:1|DECISION')?.outcome === 'INCORRECT', agentLabelRejected: res.rejected.some(r => r.why === 'NON_HUMAN_REVIEWER'),
    singleReviewNotCounted: res.final.get('X:3|DECISION')?.outcome === 'NOT_ADJUDICATED',
  };
  assert(checks.censusExact && checks.srsVarianceMatches && checks.disagreementResolvedByAdjudicator && checks.agentLabelRejected && checks.singleReviewNotCounted);
  assert(checks.ciCoverageClopperPearson >= 0.93, `CI coverage too low: ${checks.ciCoverageClopperPearson}`);
  return { basis: 'SYNTHETIC — validates estimator and label-resolution code only; NOT catalog results', replicates: R, syntheticTrueRate: trueRate, checks };
}

// ---------- Run ----------
const { final, rejected, agreement } = resolveLabels(labels);
const results = runAll(final), families = perFamily(final), decisions = decide(results), selftest = selfTest();
const claimDimension = new Map(dataset.records.flatMap(r => r.claims.map(c => [c.claimId, c.dimension])));
const kappaByDimension = Object.fromEntries(['PRODUCT_SEMANTICS', 'TRAINING_V2', 'SPECS'].map(d => [d, kappa(agreement.filter(a => claimDimension.get(a.key.split('|')[0]) === d))]));
const statusCount = countBy(results, r => `${r.universe}:${r.status}`);
const humanLabelsUsed = [...final.values()].filter(f => f.outcome !== 'NOT_ADJUDICATED').length;
const flags = {
  QA2_DESIGN_COMPLETE: 'YES', INDEPENDENT_LABELS_AVAILABLE: humanLabelsUsed > 0 ? 'YES' : 'NO',
  STATISTICAL_ACCURACY_ESTIMATED: results.some(r => r.universe === 'ACTIVE_886' && r.status === 'ESTIMATED') ? 'YES' : 'NO',
  CRITICAL_CASES_ADJUDICATED: 'NO', PRODUCTION_ROLLOUT_RECOMMENDATION: 'DEFER',
};
await w.json('adjudication_protocol.json', {
  schemaVersion: 'qa2-labels-v1', outcomes: OUTCOMES, outcomeDefinitions: {
    CORRECT: 'La afirmación del sistema es verdadera para el producto según evidencia independiente.', INCORRECT: 'La afirmación es falsa (falso positivo) o, para negativas/abstenciones, un concepto modelado sí aplica.',
    INCOMPLETE: 'La afirmación es verdadera pero omite un hecho modelado que aplica (p. ej., familia correcta sin secundaria, ejercicio faltante).', NOT_APPLICABLE: 'La afirmación no es evaluable para este producto (p. ej., servicio).',
    INSUFFICIENT_REFERENCE_EVIDENCE: 'La evidencia independiente disponible no permite decidir. No equivale a INCORRECT.', NOT_ADJUDICATED: 'Sin revisión humana final.' },
  errorTypes: ['FALSE_FACT', 'UNMODELED_CONCEPT', 'HOST_ATTRIBUTION', 'FAMILY_DERIVATION_FALSE_POSITIVE', 'WRONG_RELATION_TYPE', 'WRONG_VALUE', 'WRONG_UNIT', 'WRONG_INTERPRETATION', 'MISSING_CLAIM', 'MISSED_EXISTING_FAMILY', 'FAMILY_BOUNDARY'],
  unmodeledVsFalse: 'Un concepto que la ontología no modela se registra en reference.unmodeledConcepts y NO convierte una negativa/abstención en INCORRECT; sólo un concepto modelado que aplica lo hace.',
  evidenceIndependence: { E0: 'Sólo la salida de la regla (rechazado).', E1: 'Mismos campos fuente (nombre/categorías/features) interpretados por un humano. Válido para familia/rol y fidelidad de parseo; no para verdad física de Specs.',
    E2: 'Fuente externa independiente: ficha del fabricante, página del producto, manual, foto (registrar URL/documento y fecha).', E3: 'Inspección física o confirmación escrita del proveedor/comercial.' },
  workflow: ['Stage A (worksheet_blind.csv): R1 y R2 proponen familia, rol, disciplinas, contextos, ejercicios y funciones sin ver la salida del sistema.',
    'Stage B (worksheet_claims.csv): R1 y R2 juzgan cada claim/facet de forma independiente.', 'Acuerdo R1=R2 → final. Desacuerdo → ADJUDICATOR (tercera persona) decide con nota.',
    'Un solo revisor → NOT_ADJUDICATED (no cuenta).', 'R1 y R2 deben ser personas distintas; el adjudicador no puede ser R1 ni R2.', 'Las propuestas del agente (agent_preliminary_proposals.json) se muestran sólo después de Stage A y nunca se registran como review.'],
  thresholds: { minAdjudicatedShareForEstimate: MIN_ADJUDICATED_SHARE, minDomainUnitsForEstimate: MIN_DOMAIN_UNITS, target: 0.95, targetRule: 'Límite inferior Clopper-Pearson (Korn-Graubard n_eff) ≥ 0.95' },
  priorityOrder: ['CABLE_TRAINING_CONFLICT', 'OTHER_ACTIVE', 'NEGATIVE_ABSENT', 'SPECS_CONFLICT_ACTIVE + specs_interpretation_risk', 'multifunción', 'accesorios/módulos', 'ONTOLOGY_GAP', 'FIX2_SEMANTIC_CHANGE', 'resto de la muestra A'],
  labelFileShape: { schemaVersion: 'qa2-labels-v1', candidate: CANDIDATE_ID, reviews: [{ productId: 0, claimId: 'P<id>:<type>:<code>', facet: 'DECISION|FACT|RELATION_TYPE|HOST_ATTRIBUTION|VALUE|UNIT|PHYSICAL_INTERPRETATION|UNRESOLVED_JUSTIFIED',
    reviewerId: 'string', reviewerType: 'HUMAN', role: 'R1|R2|ADJUDICATOR', outcome: 'CORRECT|…', errorType: 'string|null', evidenceIndependence: 'E1|E2|E3', referenceSources: ['url or document'], reviewedAt: 'ISO-8601' }],
    productReferences: [{ productId: 0, reviewerId: 'string', role: 'R1|R2|ADJUDICATOR', primaryFamily: 'code|OTHER', productRole: 'STATION|MODULE_WITH_OWN_MECHANISM|PASSIVE_ACCESSORY|FREE_WEIGHT_OR_IMPLEMENT|CONSUMABLE|SERVICE|BUNDLE|OTHER',
      disciplines: [], useContexts: [], exercises: [], functions: [], unmodeledConcepts: [], evidenceIndependence: 'E1|E2|E3', referenceSources: [] }] },
  rerun: 'node --import tsx scripts/audits/qa2/metrics.mjs --labels <file>  (en un run-dir nuevo: cambiar RUN_ID en lib.mjs o copiar los insumos; el escritor no sobrescribe).',
});
await w.json('metrics_by_dimension.json', { basis: 'Design-based estimators; human labels only', labelsFile: labelArg > 0 ? process.argv[labelArg + 1] : null, humanLabelsUsed, rejectedLabels: rejected.length,
  kappaByDimension, statusCount, results, perFamilyPrecisionActive: families, exactCensusSystemStates: census });
await w.csv('confidence_intervals.csv', results.map(r => ({ metric: r.metric, universe: r.universe, status: r.status, reason: r.reason ?? '', numerator: r.numerator ?? '', denominator: r.denominator ?? '',
  estimate: r.estimate ?? '', ci95_low: r.ci95ClopperPearson?.[0] ?? '', ci95_high: r.ci95ClopperPearson?.[1] ?? '', nEff: r.nEff ?? '', domainClaimsInSample: r.domainClaimsInSample, notAdjudicated: r.notAdjudicated ?? '', target95: r.target95 ?? '' })));
await w.json('discovery_surface_decisions.json', { basis: 'Phase 6; QUALITY_VALIDATED requires ESTIMATED/EXACT metrics whose 95% lower bound ≥ 0.95', decisions, flags });
await w.json('estimator_selftest.json', selftest);
console.log(JSON.stringify({ humanLabelsUsed, statusCount, decisions: decisions.map(d => `${d.surface}:${d.decision}`), selftest: selftest.checks, flags,
  domainSizesActive: results.filter(r => r.universe === 'ACTIVE_886').map(r => `${r.metric}:${r.domainUnitsInSample}u/${r.domainClaimsInSample}c`) }, null, 1));
