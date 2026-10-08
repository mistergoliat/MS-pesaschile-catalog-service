// P2.3-QA2 Phases 1-2: sampling design, critical cohorts, review packets and adjudication dataset.
// Reads authoritative candidate/source bytes; QA1 files are read only to reuse and verify the diagnostic sample.
import assert from 'node:assert/strict';
import { assertEntry, OUT, QA1_DIR, BASELINE_DIR, CANDIDATE_ID, SOURCE_EXTRACTION_ID, CANDIDATE_DIR, SOURCE_DIR, readJson, guardedWriter, loadAuthoritative,
  countBy, uniqueSorted, rankIds, factsOf, parseCsv } from './lib.mjs';
import { evaluateAdmission } from './context.mjs';
import { plannedHalfWidth, minimumObservedForTarget, Z95 } from './estimators.mjs';
import { readFile } from 'node:fs/promises';

assertEntry(import.meta.url);
const w = process.env.QA2_DRY === "1" ? { json: async () => {}, csv: async () => {}, text: async () => {} } : guardedWriter();
const L = await loadAuthoritative();
const baselineV2 = new Map((await readJson(`${BASELINE_DIR}/trainingSemanticsV2.json`)).snapshot.records.map(r => [Number(r.productId), r]));

// ---------- Universe with authoritative Admission ----------
const familyOf = ps => ps.primaryProductFamily?.code ?? ps.classificationStatus;
const semanticCore = r => JSON.stringify({ s: r.resolutionState, rs: r.resolved, c: r.coverageStatus,
  e: r.exerciseCapabilities.map(({ evidence, provenance, ...a }) => a), f: r.trainingFunctions.map(({ evidence, provenance, ...a }) => a) });
const universe = L.src.products.toSorted((a, b) => a.productId - b.productId).map(p => {
  const ps = L.product.get(p.productId), v2 = L.v2.get(p.productId), adm = evaluateAdmission(L, p), facts = factsOf(v2), specs = L.specGroups.get(p.productId) ?? [];
  return { productId: p.productId, name: p.name, catalogPresence: p.catalogPresence, active: p.active, family: familyOf(ps), classificationStatus: ps.classificationStatus,
    secondary: ps.secondaryProductFamilies.map(t => t.code), disciplines: ps.disciplines.map(t => t.code), useContexts: ps.useContexts.map(t => t.code),
    v2State: v2.resolutionState, facts, factsFlag: facts.length ? 'FACTS' : 'NOFACTS', adm,
    negativeEvidence: v2.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' ? adm.obligations.TRAINING_EXERCISE.negativeEvidenceState : 'NOT_APPLICABLE',
    specs, specStatuses: countBy(specs, s => s.status), specsConflict: adm.obligations.SPECS?.resolution === 'SOURCE_CONFLICT',
    fix2SemanticChange: semanticCore(baselineV2.get(p.productId)) !== semanticCore(v2),
    unknownApplicability: Object.entries(adm.obligations).filter(([, o]) => o.effectiveRequirement === 'UNKNOWN').map(([k]) => k) };
});
const byId = new Map(universe.map(u => [u.productId, u]));
const active = universe.filter(u => u.catalogPresence === 'current_catalog' && u.active === true);
assert.equal(universe.length, 2048); assert.equal(active.length, 886);

// Cross-check recomputed Admission against QA1 matrix (QA1 itself asserted equality with archived PRB rows).
const qa1Matrix = new Map(parseCsv(await readFile(`${QA1_DIR}/product_semantic_matrix.csv`, 'utf8')).map(r => [Number(r.productId), r]));
const admissionMismatches = universe.filter(u => { const q = qa1Matrix.get(u.productId);
  return q.admissionStatus !== u.adm.unified || JSON.stringify(JSON.parse(q.discoveryEligibility)) !== JSON.stringify(u.adm.surfaces)
    || JSON.stringify(JSON.parse(q.specFilteringByKey)) !== JSON.stringify(u.adm.specFilteringByKey) || q.trainingNegativeEvidenceStatus !== u.negativeEvidence; }).map(u => u.productId);

// ---------- A. Probability sample of the 886 active products ----------
const SEED_A = `P2.3-QA2|${CANDIDATE_ID}|${SOURCE_EXTRACTION_ID}|active-v1`;
const RATE = { FACTS: 0.5, NOFACTS: 0.3 }, CENSUS_MAX = 6;
const strataA = new Map();
for (const u of active) { const h = `${u.family}|${u.factsFlag}`; if (!strataA.has(h)) strataA.set(h, []); strataA.get(h).push(u.productId); }
const allocation = [...strataA.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([h, ids]) => {
  const N = ids.length, census = N <= CENSUS_MAX, n = census ? N : Math.max(3, Math.ceil(RATE[h.split('|')[1]] * N));
  const selected = rankIds(SEED_A, ids).slice(0, n).sort((a, b) => a - b);
  return { stratum: h, family: h.split('|')[0], factsFlag: h.split('|')[1], N, n, census, inclusionProbability: n / N, weight: N / n, selectedIds: selected };
});
const designA = new Map(allocation.map(a => [a.stratum, { N: a.N, n: a.n }]));
const sampleA = allocation.flatMap(a => a.selectedIds.map(id => ({ productId: id, stratum: a.stratum, N_h: a.N, n_h: a.n, inclusionProbability: a.inclusionProbability, weight: a.weight, census: a.census })));
const nA = sampleA.length;
assert.equal(allocation.reduce((s, a) => s + a.N, 0), 886);
const weights = sampleA.map(s => s.weight), kishDeff = nA * weights.reduce((a, x) => a + x * x, 0) / weights.reduce((a, x) => a + x, 0) ** 2;
const srsN = (e, p = 0.95, N = 886) => { const n0 = Z95 ** 2 * p * (1 - p) / e ** 2; return Math.ceil(n0 / (1 + (n0 - 1) / N)); };
// Domain planning: facts precision (FACTS strata) and Specs (products with spec records).
const domainDesign = filter => new Map(allocation.filter(filter).map(a => [a.stratum, { N: a.N, n: a.n }]));
const planning = {
  overall: { ...plannedHalfWidth(designA, 0.95), at98: plannedHalfWidth(designA, 0.98).halfWidth, ...minimumObservedForTarget(designA) },
  trainingFactsDomain: { N: allocation.filter(a => a.factsFlag === 'FACTS').reduce((s, a) => s + a.N, 0), n: allocation.filter(a => a.factsFlag === 'FACTS').reduce((s, a) => s + a.n, 0),
    ...plannedHalfWidth(domainDesign(a => a.factsFlag === 'FACTS'), 0.95), ...minimumObservedForTarget(domainDesign(a => a.factsFlag === 'FACTS')) },
  srsReference: { halfWidth3pp: srsN(0.03), halfWidth2_5pp: srsN(0.025), halfWidth2pp: srsN(0.02) },
  kishDesignEffect: kishDeff,
};
const familyEstimability = uniqueSorted(active.map(u => u.family)).map(f => {
  const rows = allocation.filter(a => a.family === f), N = rows.reduce((s, a) => s + a.N, 0), n = rows.reduce((s, a) => s + a.n, 0);
  const census = rows.every(a => a.census), plan = plannedHalfWidth(new Map(rows.map(a => [a.stratum, { N: a.N, n: a.n }])), 0.95);
  const status = census ? 'EXACT_CENSUS_WHEN_ADJUDICATED' : n >= 20 && plan.halfWidth <= 0.1 ? 'ESTIMABLE_WHEN_ADJUDICATED' : 'NOT_ESTIMABLE_INSUFFICIENT_SAMPLE';
  return { family: f, N, n, census, plannedHalfWidthAt95: census ? 0 : plan.halfWidth, status };
});

// ---------- B. QA1 diagnostic sample (280): reuse, verify reproducibility, keep origin ----------
const qa1Plan = await readJson(`${QA1_DIR}/sampling_plan.json`), qa1Cases = await readJson(`${QA1_DIR}/qa2_sample_cases.json`);
assert.equal(qa1Cases.length, 280);
const qa1Strata = new Map();
for (const u of universe) { const a = u.active === null ? 'UNKNOWN' : u.active ? 'ACTIVE' : 'INACTIVE', fam = L.product.get(u.productId).primaryProductFamily?.code ?? 'UNAVAILABLE';
  const h = `${u.catalogPresence}|${a}|${fam}`; if (!qa1Strata.has(h)) qa1Strata.set(h, []); qa1Strata.get(h).push(u.productId); }
const qa1Repro = qa1Plan.representativeSubset.quotas.map(q => { const pop = qa1Strata.get(q.stratum) ?? [];
  const recomputed = rankIds(qa1Plan.seed, pop).slice(0, q.n).sort((a, b) => a - b);
  return { stratum: q.stratum, populationRecorded: q.population, populationRecomputed: pop.length, n: q.n,
    selectionReproduced: JSON.stringify(recomputed) === JSON.stringify([...q.selectedIds].sort((a, b) => a - b)) }; });
const zeroQuotaStrata = [...qa1Strata.entries()].filter(([h]) => !qa1Plan.representativeSubset.quotas.some(q => q.stratum === h && q.n > 0)).map(([h, ids]) => ({ stratum: h, population: ids.length }));
const caseIds = new Set(qa1Cases.map(c => c.productId));
const sampleB = qa1Cases.map(c => { const u = byId.get(c.productId);
  return { productId: c.productId, subset: c.subset, qa1Stratum: c.stratum, qa1InclusionProbability: c.subset === 'STRATIFIED_RANDOM' ? c.inclusionProbability : null,
    qa1SelectionReasons: c.selectionReasons, nameMatchesAuthority: c.name === u.name, familyMatchesAuthority: c.observedFamily === (L.product.get(c.productId).primaryProductFamily?.code ?? 'UNAVAILABLE'),
    classificationMatchesAuthority: c.currentClassification === u.classificationStatus }; });

// ---------- C. Critical cohorts (census of each group, recomputed from authority) ----------
const hasFn = (u, code) => u.facts.some(f => f.kind === 'FUNCTION' && f.code === code);
const isCable = u => u.family === 'CABLE_MACHINE' || u.secondary.includes('CABLE_MACHINE');
const nameRole = u => /accesorio|repuesto|m[oó]dulo|adaptador|agarre|manilla|maneral|tobillera|soga de tr[ií]ceps|barra (de )?(polea|tr[ií]ceps|lat)|mosquet[oó]n|cable de repuesto/i.test(u.name);
const qa1MissingConcepts = parseCsv(await readFile(`${QA1_DIR}/candidate_missing_concepts.csv`, 'utf8'));
const cohorts = {
  CABLE_TRAINING_CONFLICT: universe.filter(u => isCable(u) && !hasFn(u, 'CABLE_RESISTANCE') && u.v2State === 'VERIFIED_NO_APPLICABLE_CAPABILITY'),
  CABLE_DATA_GAP: universe.filter(u => isCable(u) && !hasFn(u, 'CABLE_RESISTANCE') && u.v2State === 'DATA_GAP'),
  CABLE_BOUNDARY_ACTIVE: active.filter(u => isCable(u) || u.family === 'MACHINE_ATTACHMENT' || L.src.products[L.sourceIndex.get(u.productId)].categoryIds?.some(c => c.categoryId === 451)),
  CLASSIFIED_NOT_PRODUCT_DISCOVERABLE: active.filter(u => u.classificationStatus === 'CLASSIFIED' && u.adm.surfaces.product !== 'ADMITTED'),
  NEGATIVE_ABSENT: universe.filter(u => u.negativeEvidence === 'ABSENT'),
  OTHER_ACTIVE: active.filter(u => u.classificationStatus === 'OTHER'),
  SPECS_CONFLICT_ACTIVE: active.filter(u => u.specsConflict),
  SPECS_AMBIGUOUS_ACTIVE: active.filter(u => (u.specStatuses.ambiguous ?? 0) + (u.specStatuses.unsupported ?? 0) > 0),
  UNKNOWN_APPLICABILITY_ACTIVE: active.filter(u => u.unknownApplicability.length),
  TRAINING_DATA_GAP_OR_AMBIGUOUS_ACTIVE: active.filter(u => ['DATA_GAP', 'AMBIGUOUS'].includes(u.v2State)),
  ONTOLOGY_GAP_ACTIVE: active.filter(u => u.v2State === 'ONTOLOGY_GAP'),
  FIX2_SEMANTIC_CHANGE: universe.filter(u => u.fix2SemanticChange),
  ACCESSORY_OR_MODULE_ACTIVE: active.filter(u => u.family === 'MACHINE_ATTACHMENT' || nameRole(u)),
  MULTIFUNCTION_ACTIVE: active.filter(u => u.secondary.length > 0 || new Set(u.facts.map(f => f.code)).size >= 2 || /multi|combo|\bpack\b|\bset\b|\bkit\b/i.test(u.name)),
  QA1_CANDIDATE_MISSING_CONCEPT_ACTIVE: active.filter(u => qa1MissingConcepts.some(r => Number(r.productId) === u.productId)),
};
const qa1Cable = [437, 454, 455, 462, 466, 1004, 1020, 1022, 1343, 1344, 1345, 1346, 1347, 1348, 1349, 1350, 1917, 1996, 2195, 2285];
const cohortChecks = {
  cableConflictMatchesQA1: JSON.stringify(cohorts.CABLE_TRAINING_CONFLICT.map(u => u.productId)) === JSON.stringify(qa1Cable),
  cableConflictCounts: { total: cohorts.CABLE_TRAINING_CONFLICT.length, current: cohorts.CABLE_TRAINING_CONFLICT.filter(u => u.catalogPresence === 'current_catalog').length,
    active: cohorts.CABLE_TRAINING_CONFLICT.filter(u => u.active === true).length },
  sixNotDiscoverable: cohorts.CLASSIFIED_NOT_PRODUCT_DISCOVERABLE.map(u => u.productId),
  negativeAbsent: { total: cohorts.NEGATIVE_ABSENT.length, active: cohorts.NEGATIVE_ABSENT.filter(u => u.active === true).length },
  otherActive: cohorts.OTHER_ACTIVE.length, specsConflictActive: cohorts.SPECS_CONFLICT_ACTIVE.length, fix2SemanticChange: cohorts.FIX2_SEMANTIC_CHANGE.length,
  qa1MissingConceptCsvColumns: Object.keys(qa1MissingConcepts[0] ?? {}),
};

// ---------- Review packets (fichas) and claims ----------
// Cohorts adjudicated product by product; the rest are analysed at cohort/contract level (flags only).
const PACKET_COHORTS = ['CABLE_TRAINING_CONFLICT', 'CABLE_DATA_GAP', 'CABLE_BOUNDARY_ACTIVE', 'CLASSIFIED_NOT_PRODUCT_DISCOVERABLE', 'NEGATIVE_ABSENT', 'OTHER_ACTIVE', 'SPECS_CONFLICT_ACTIVE', 'TRAINING_DATA_GAP_OR_AMBIGUOUS_ACTIVE', 'QA1_CANDIDATE_MISSING_CONCEPT_ACTIVE'];
const units = uniqueSorted([...sampleA.map(s => s.productId), ...sampleB.map(s => s.productId), ...PACKET_COHORTS.flatMap(k => cohorts[k].map(u => u.productId))]);
const ADJ = () => ({ R1: null, R2: null, ADJUDICATOR: null, final: 'NOT_ADJUDICATED', finalBasis: null });
const sourceRef = id => `${SOURCE_DIR}/canonical_input.json#/products/${L.sourceIndex.get(id)}`;
function claimsFor(u) {
  const ps = L.product.get(u.productId), v2 = L.v2.get(u.productId), c = [];
  const add = (dimension, claimType, code, assertion, facets, systemEvidence, extra = {}) =>
    c.push({ claimId: `P${u.productId}:${claimType}:${code}`, dimension, claimType, code, assertion, systemEvidence, facets: Object.fromEntries(facets.map(f => [f, ADJ()])), ...extra });
  if (ps.classificationStatus === 'EXCLUDED_NON_PRODUCT') add('PRODUCT_SEMANTICS', 'EXCLUSION', 'EXCLUDED_NON_PRODUCT', 'El ítem es un servicio/costo, no un producto físico.', ['DECISION'], ps.provenance.exclusion);
  else if (!ps.primaryProductFamily) add('PRODUCT_SEMANTICS', 'FAMILY_PRIMARY', 'OTHER', 'Ninguna familia del registry v3 aplica (OTHER).', ['DECISION'], ps.provenance.evidence, { abstention: true });
  else add('PRODUCT_SEMANTICS', 'FAMILY_PRIMARY', ps.primaryProductFamily.code, `Familia primaria = ${ps.primaryProductFamily.code}.`, ['DECISION'],
    ps.provenance.evidence.filter(e => e.code === ps.primaryProductFamily.code), { ruleId: ps.primaryProductFamily.ruleId, confidence: ps.primaryProductFamily.confidence });
  for (const t of ps.secondaryProductFamilies) add('PRODUCT_SEMANTICS', 'FAMILY_SECONDARY', t.code, `Familia secundaria = ${t.code}.`, ['DECISION'], ps.provenance.evidence.filter(e => e.code === t.code), { ruleId: t.ruleId });
  for (const t of ps.disciplines) add('PRODUCT_SEMANTICS', 'DISCIPLINE', t.code, `Disciplina = ${t.code}.`, ['DECISION'], ps.provenance.evidence.filter(e => e.code === t.code), { ruleId: t.ruleId, confidence: t.confidence });
  for (const t of ps.useContexts) add('PRODUCT_SEMANTICS', 'USE_CONTEXT', t.code, `Contexto de uso = ${t.code}.`, ['DECISION'], ps.provenance.evidence.filter(e => e.code === t.code), { ruleId: t.ruleId, confidence: t.confidence });
  for (const a of v2.exerciseCapabilities) add('TRAINING_V2', 'EXERCISE', `${a.capabilityCode}/${a.relationType}`, `El producto permite ${a.capabilityCode} (${a.relationType}).`, ['FACT', 'RELATION_TYPE', 'HOST_ATTRIBUTION'], a.evidence);
  for (const a of v2.trainingFunctions) add('TRAINING_V2', 'FUNCTION', `${a.functionCode}/${a.relationType}`, `El producto aporta la función ${a.functionCode} (${a.relationType}).`, ['FACT', 'RELATION_TYPE', 'HOST_ATTRIBUTION'], a.evidence,
    { familyDerived: a.relationType === 'FAMILY_DERIVED' });
  if (v2.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY') add('TRAINING_V2', 'NEGATIVE', 'NO_MODELED_CAPABILITY', 'Ninguna Exercise Capability ni Training Function modelada aplica.', ['DECISION'],
    v2.resolutionEvidence, { negativeEvidenceState: u.negativeEvidence });
  if (['DATA_GAP', 'AMBIGUOUS', 'ONTOLOGY_GAP'].includes(v2.resolutionState)) add('TRAINING_V2', 'ABSTENTION', v2.resolutionState, `Training V2 se abstiene (${v2.resolutionState}).`, ['DECISION'], v2.resolutionEvidence, { abstention: true });
  for (const s of u.specs) add('SPECS', s.status === 'parsed' ? 'SPEC_VALUE' : 'SPEC_UNRESOLVED', `${s.key}#${s._index}`,
    s.status === 'parsed' ? `${s.key} = ${s.value} ${s.unit}.` : `${s.key} queda ${s.status} (no se publica valor).`,
    s.status === 'parsed' ? ['VALUE', 'UNIT', 'PHYSICAL_INTERPRETATION'] : ['UNRESOLVED_JUSTIFIED'],
    { rawValue: s.rawValue, sourceFeature: s.sourceFeature, derivationRule: s.derivationRule, specsRef: `${CANDIDATE_DIR}/specs.json#/records/${s._index}` });
  if (u.specsConflict) add('SPECS', 'SPEC_CONFLICT', 'SOURCE_CONFLICT', 'Las fuentes de Specs se contradicen; el sistema no admite filtrado por la key en conflicto.', ['DECISION'], u.adm.obligations.SPECS.reasons);
  return c;
}
const packets = units.map(id => {
  const u = byId.get(id), p = L.src.products[L.sourceIndex.get(id)], a = sampleA.find(s => s.productId === id), b = sampleB.find(s => s.productId === id);
  return {
    productId: id, name: u.name, catalogPresence: u.catalogPresence, active: u.active,
    membership: { statisticalActive: a ? { stratum: a.stratum, inclusionProbability: a.inclusionProbability, weight: a.weight } : null,
      diagnosticQA1: b ? { subset: b.subset, qa1InclusionProbability: b.qa1InclusionProbability, reasons: b.qa1SelectionReasons } : null,
      criticalCohorts: Object.entries(cohorts).filter(([, c]) => c.some(x => x.productId === id)).map(([k]) => k) },
    evidence: {
      sourceCategories: (p.categoryIds ?? []).map(c => ({ ...c, trustClass: L.categoryTrust.get(c.categoryId) ?? 'UNMAPPED' })),
      sourceFeatures: (p.features ?? []).map(f => ({ ...f, trustClass: L.featureTrust.get(f.featureId) ?? 'UNMAPPED' })),
      commercialDescription: 'UNAVAILABLE_IN_FROZEN_SOURCE', externalIndependentEvidence: [], sourceReference: sourceRef(id),
    },
    system: { family: u.family, classificationStatus: u.classificationStatus, secondaryFamilies: u.secondary, disciplines: u.disciplines, useContexts: u.useContexts,
      trainingV2State: u.v2State, trainingFacts: u.facts.map(({ evidence, ...f }) => f), negativeEvidence: u.negativeEvidence,
      specs: u.specs.map(({ _index, ...s }) => s), admission: u.adm, relationships: 'UNAVAILABLE', capabilitiesProjection: 'UNAVAILABLE' },
    claims: claimsFor(u),
    reference: { primaryFamily: null, productRole: null, disciplines: null, useContexts: null, exercises: null, functions: null, missingClaims: [], unmodeledConcepts: [],
      evidenceIndependence: null, referenceSources: [] },
    reviewers: [], adjudicationStatus: 'NOT_ADJUDICATED', humanReviewEffective: false,
  };
});
const claimCount = packets.reduce((s, p) => s + p.claims.length, 0);

// ---------- Write design evidence ----------
await w.json('sampling_plan.json', {
  basis: 'MEASURED counts; design choices documented', candidate: CANDIDATE_ID, sourceExtractionId: SOURCE_EXTRACTION_ID,
  A_statisticalActive: { universe: 886, seed: SEED_A, ranking: 'SHA256(seed + ":" + productId) hex ascending; productId tie-break', strataDefinition: 'primary family (or OTHER / EXCLUDED_NON_PRODUCT) x Training V2 facts present (FACTS/NOFACTS)',
    allocationRule: { censusIfNAtMost: CENSUS_MAX, rate: RATE, minimumPerSampledStratum: 3, rounding: 'ceil' }, n: nA, strata: allocation.length,
    censusStrata: allocation.filter(a => a.census).map(a => a.stratum), allocation, planning, familyEstimability,
    independenceFromQA1: 'Seed differs from QA1; overlap with QA1 cases is incidental and does not change inclusion probabilities.',
    overlapWithQA1Cases: sampleA.filter(s => caseIds.has(s.productId)).length },
  B_diagnosticQA1: { n: 280, subsets: countBy(sampleB, s => s.subset), qa1Seed: qa1Plan.seed, representativeReproducibility: qa1Repro,
    allRepresentativeSelectionsReproduced: qa1Repro.every(r => r.selectionReproduced && r.populationRecorded === r.populationRecomputed),
    zeroQuotaStrata, canonicalUniverseUse: 'STRATIFIED_RANDOM (160) is a stratified probability sample of the canonical 2048 only over strata with quota>0; zero-quota strata are not covered and must be reported as excluded population.',
    purposiveUse: 'PURPOSIVE_DIFFICULT (120) has no inclusion probability: DIAGNOSTIC_ONLY.', authorityConsistency: { name: sampleB.every(s => s.nameMatchesAuthority), family: sampleB.every(s => s.familyMatchesAuthority), classification: sampleB.every(s => s.classificationMatchesAuthority) } },
  C_criticalCohorts: Object.fromEntries(Object.entries(cohorts).map(([k, v]) => [k, { n: v.length, active: v.filter(u => u.active === true).length, design: 'CENSUS_OF_COHORT', productLevelPackets: PACKET_COHORTS.includes(k), productIds: v.map(u => u.productId) }])),
  cohortChecks, admissionRecomputation: { products: universe.length, mismatchesVsQA1Matrix: admissionMismatches },
  noMixingRule: 'A, B and C are never pooled into one accuracy figure. A -> ESTIMATED (active); B.STRATIFIED_RANDOM -> ESTIMATED (canonical, covered strata); B.PURPOSIVE and C -> DIAGNOSTIC_ONLY or EXACT_CENSUS of the cohort.',
});
await w.csv('statistical_sample_active.csv', sampleA.map(s => ({ ...s, name: byId.get(s.productId).name })));
await w.csv('diagnostic_sample_qa1.csv', sampleB.map(s => ({ ...s, name: byId.get(s.productId).name, priorityFlags: Object.entries(cohorts).filter(([, c]) => c.some(x => x.productId === s.productId)).map(([k]) => k).join('|') })));
await w.json('review_packets.json', packets);
await w.csv('worksheet_blind.csv', packets.map(p => ({ productId: p.productId, name: p.name, active: p.active,
  categories: p.evidence.sourceCategories.map(c => `${c.name} [${c.trustClass}]`).join(' | '), features: p.evidence.sourceFeatures.map(f => `${f.name}: ${f.value}`).join(' | '),
  reviewerId: '', reviewedAt: '', proposedPrimaryFamily: '', proposedProductRole: '', proposedDisciplines: '', proposedUseContexts: '', proposedExercises: '', proposedFunctions: '',
  unmodeledConcepts: '', referenceSources: '', evidenceIndependence: '', notes: '' })),
  ['productId', 'name', 'active', 'categories', 'features', 'reviewerId', 'reviewedAt', 'proposedPrimaryFamily', 'proposedProductRole', 'proposedDisciplines', 'proposedUseContexts', 'proposedExercises', 'proposedFunctions', 'unmodeledConcepts', 'referenceSources', 'evidenceIndependence', 'notes']);
await w.csv('worksheet_claims.csv', packets.flatMap(p => p.claims.flatMap(c => Object.keys(c.facets).map(f => ({ productId: p.productId, name: p.name, claimId: c.claimId, dimension: c.dimension,
  claimType: c.claimType, facet: f, assertion: c.assertion, systemEvidence: c.systemEvidence, reviewerId: '', reviewedAt: '', outcome: '', errorType: '', evidenceIndependence: '', referenceSource: '', notes: '' })))));
await w.json('adjudication_dataset.json', { schemaVersion: 'qa2-adjudication-v1', candidate: CANDIDATE_ID, createdAt: new Date().toISOString(), units: packets.length, claims: claimCount,
  outcomes: ['CORRECT', 'INCORRECT', 'INCOMPLETE', 'NOT_APPLICABLE', 'INSUFFICIENT_REFERENCE_EVIDENCE', 'NOT_ADJUDICATED'],
  status: 'NO_HUMAN_LABELS', records: packets.map(p => ({ productId: p.productId, membership: p.membership, claims: p.claims.map(c => ({ claimId: c.claimId, dimension: c.dimension, claimType: c.claimType,
    code: c.code, facets: c.facets })), reference: p.reference, reviewers: p.reviewers, adjudicationStatus: p.adjudicationStatus, humanReviewEffective: false })) });
console.log(JSON.stringify({ nA, strata: allocation.length, census: allocation.filter(a => a.census).length, planning, units: packets.length, claimCount, admissionMismatches: admissionMismatches.length, cohortChecks,
  qa1Repro: qa1Repro.every(r => r.selectionReproduced), zeroQuota: zeroQuotaStrata.length, overlap: sampleA.filter(s => caseIds.has(s.productId)).length,
  families: familyEstimability.map(f => `${f.family}:${f.n}/${f.N}:${f.status}`) }, null, 1));
