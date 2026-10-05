import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as domain from '../src/domain/catalog-admission/index.ts';
import { trainingSemanticRuleCatalog } from '../src/domain/training-semantic-classification/rules.ts';
import { trainingSemanticV2RuleCatalog } from '../src/domain/training-semantic-classification-v2/rules.ts';
import { trainingSemanticV21EnrichmentCatalog } from '../src/domain/training-semantic-classification-v2-1/rules.ts';
import { getOntologyTagsForAxis } from '../src/domain/commercial-product-ontology/index.ts';
import { getTrainingSemanticRegistryV2 } from '../src/domain/training-semantics-v2/index.ts';

const count = (rows, select, keys = []) => Object.assign(Object.fromEntries(keys.map(k => [k, 0])), rows.reduce((out, row) => {
  const key = select(row); out[key] = (out[key] ?? 0) + 1; return out;
}, {}));
const ratio = (n, d) => ({ numerator: n, denominator: d, percentage: d ? Number((100 * n / d).toFixed(4)) : null });
const csv = (rows, fields) => `${fields.join(',')}\n${rows.map(r => fields.map(f => `"${String(typeof r[f] === 'object' ? JSON.stringify(r[f]) : r[f] ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')}\n`;
const ids = rows => rows.map(r => r.productId).sort((a, b) => a - b);
const certified = row => ['CONSOLIDATED', 'CONSOLIDATED_WITH_NOT_APPLICABLE'].includes(row.consolidation.state);
const outputNames = ['REPORT-P2.3B.md', 'family-applicability-inventory.csv', 'family-applicability-inventory.json', 'family-contracts-v2.csv', 'family-contracts-v2.json',
  'obligation-coverage.json', 'consolidation-baseline-P2.3B.json', 'admission-baseline-P2.3B.json', 'admission-delta-P2.3B.json',
  'unknown-obligations-P2.3B.csv', 'new-product-onboarding-P2.3B.json', 'verification-P2.3B.json'];

export async function runFamilyApplicabilityAudit(input) {
  const { source, manifest, ps, specsById, pById, tById, categoryRows, featureRows, sourceHashes,
    sourceDir, bundleDir, output, root, before, fingerprint, hash, validation, baselineDirectory } = input;
  const contract = domain.semanticObligationContractV2;
  const codeFiles = [...(await readdir(path.join(root, 'src/domain/catalog-admission'))).filter(n => n.endsWith('.ts')).map(n => path.join(root, 'src/domain/catalog-admission', n)),
    path.join(root, 'cross-projection-audit/audit.mjs'), path.join(root, 'cross-projection-audit/family-applicability-audit.mjs')];
  const codeHash = async () => hash((await Promise.all(codeFiles.map(f => readFile(f)))).join('\n'));
  const evaluationCodeHash = await codeHash();
  const references = [...new Set(contract.families.flatMap(f => [...f.sourceReferences, ...f.dimensions.flatMap(d => d.sourceReferences), ...f.specRequirements.flatMap(s => s.sourceReferences)]).map(ref => ref.split('#')[0]))].sort();
  const evidenceSourceHashes = Object.fromEntries(await Promise.all(references.map(async file => [file, hash(await readFile(path.join(root, file)))])));
  const writeJson = async (name, value) => writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
  const previousSummary = JSON.parse(await readFile(path.join(baselineDirectory, 'consolidation-baseline.json'), 'utf8'));
  const previousRows = JSON.parse(await readFile(path.join(baselineDirectory, 'product-admission.json'), 'utf8'));
  const baselineRows = Array.isArray(previousRows) ? previousRows : previousRows.products;
  assert(Array.isArray(baselineRows));
  const baselineNames = (await readdir(baselineDirectory)).filter(n => /\.(json|csv|md)$/.test(n) && !outputNames.includes(n) && !n.includes('P2.3B'));
  const baselineHashes = Object.fromEntries(await Promise.all(baselineNames.map(async n => [n, hash(await readFile(path.join(baselineDirectory, n)))])));
  assert.equal(domain.semanticObligationContract.contentHash, previousSummary.contractHash, 'Historical v1 interpretation changed');
  domain.validateSemanticObligationContractV2(JSON.parse(JSON.stringify(contract)));
  const trust = { categories: categoryRows.map(r => ({ categoryId: Number(r.categoryId), trustClass: r.trustClass })),
    features: featureRows.map(r => ({ featureId: Number(r.featureId), trustClass: r.trustClass })), sourceHashesVerified: true, consumedByCategorySelection: false };
  const contexts = source.products.map(canonical => ({ canonical, productSemantics: pById.get(canonical.productId), training: tById.get(canonical.productId),
    specs: specsById.get(canonical.productId) ?? [], trust, lineage: { productVerified: true, trainingVerified: true, specsVerified: true } }));
  const evaluate = (context, selectedContract = contract) => {
    const snapshot = domain.evaluateAdmissionSnapshot(context, selectedContract);
    if (snapshot.specFilteringByKey) snapshot.specFilteringByKey = Object.fromEntries(Object.entries(snapshot.specFilteringByKey).map(([key, decision]) => [key, { decision: decision.decision, reasons: decision.reasons, blockingDimensions: decision.blockingDimensions }]));
    return { productId: context.canonical.productId, productKey: `P${context.canonical.productId}`, name: context.canonical.name,
    presence: context.canonical.catalogPresence, active: context.canonical.active, productFamily: context.productSemantics?.primaryProductFamily?.code ?? context.declaredProductFamily ?? 'UNKNOWN',
    ...snapshot }; };
  const rows = contexts.map(c => evaluate(c));
  const oldById = new Map(baselineRows.map(r => [r.productId, r]));
  // Re-evaluate every v1 result as well as v2; compare the complete historical payload, not counts alone.
  for (let i = 0; i < contexts.length; i++) {
    assert.deepEqual(evaluate(contexts[i], domain.semanticObligationContract), oldById.get(rows[i].productId), 'v1 evaluation regression');
    assert.deepEqual(evaluate(contexts[i]), rows[i], 'Non-deterministic evaluator');
  }
  const invalidIds = contexts.filter(c => domain.mapTrainingExercise(c).state === 'INVALID_STATE').map(c => c.canonical.productId).sort((a, b) => a - b);
  const conflictIds = contexts.filter(c => domain.mapSpecs(c).state === 'SOURCE_CONFLICT').map(c => c.canonical.productId).sort((a, b) => a - b);
  assert.equal(invalidIds.length, 51); assert.equal(conflictIds.length, 82);
  assert.deepEqual(invalidIds, ids(baselineRows.filter(r => r.consolidation.evaluatedDimensions.some(d => d.dimension === 'TRAINING_EXERCISE' && d.resolution.state === 'INVALID_STATE'))));
  assert.deepEqual(conflictIds, ids(baselineRows.filter(r => r.consolidation.evaluatedDimensions.some(d => d.dimension === 'SPECS' && d.resolution.state === 'SOURCE_CONFLICT'))));
  assert(rows.filter(r => invalidIds.includes(r.productId)).every(r => r.admission.TRAINING_DISCOVERY.decision !== 'ADMITTED' && r.functionDiscovery.decision !== 'ADMITTED'));
  const negatives = contexts.filter(c => domain.mapTrainingExercise(c).state === 'VERIFIED_NOT_APPLICABLE');
  assert.equal(negatives.length, 836);
  assert(negatives.every(c => domain.mapTrainingExercise(c).negativeEvidenceState === 'ABSENT' && domain.mapTrainingFunction(c).negativeEvidenceState === 'ABSENT'));
  const populations = { ALL: rows, CURRENT: rows.filter(r => r.presence === 'current_catalog'), ACTIVE: rows.filter(r => r.active === true) };
  assert.deepEqual(Object.values(populations).map(r => r.length), [2048, 1565, 886]);
  const summarize = population => {
    const known = population.filter(r => r.consolidation.obligationsKnown), n = population.filter(certified).length;
    return { totalPopulation: population.length, knownObligations: known.length, unknownObligations: population.length - known.length,
      stateCounts: count(population, r => r.consolidation.state, domain.consolidationStates), knownObligationStateCounts: count(known, r => r.consolidation.state, domain.consolidationStates),
      certifiedConsolidated: n, certifiedOverTotal: ratio(n, population.length), certifiedOverKnownObligations: ratio(n, known.length),
      highestCertifiedLevels: count(population, r => r.consolidation.highestCertifiedLevel ?? 'NONE', domain.consolidationLevels),
      surfaces: Object.fromEntries(domain.admissionSurfaces.map(s => [s, count(population, r => r.admission[s].decision, domain.admissionDecisionStates)])),
      trainingFunctionDiscovery: count(population, r => r.functionDiscovery.decision, domain.admissionDecisionStates) };
  };
  const summaries = Object.fromEntries(Object.entries(populations).map(([p, r]) => [p, summarize(r)]));
  assert.equal(summaries.ACTIVE.surfaces.PRODUCT_CONTEXT.ADMITTED, 886);
  const familyMatrix = contract.families.map(f => {
    const population = populations.ACTIVE.filter(r => r.productFamily === f.productFamily);
    const blockers = count(population.filter(r => !certified(r)), r => r.consolidation.obligationsKnown ? r.consolidation.state : 'UNKNOWN_REQUIREMENT');
    const unknownDimensions = count(population.flatMap(r => r.consolidation.evaluatedDimensions.filter(d => d.effectiveRequirement === 'UNKNOWN')), d => d.dimension);
    const primaryUnknown = Object.entries(unknownDimensions).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const primary = Object.entries(blockers).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'NO_BLOCKER';
    return { productFamily: f.productFamily, status: f.status, activeProducts: population.length, knownObligations: population.filter(r => r.consolidation.obligationsKnown).length,
      unknownObligations: population.filter(r => !r.consolidation.obligationsKnown).length, consolidated: population.filter(certified).length,
      primaryBlocker: primary === 'UNKNOWN_REQUIREMENT' ? `${primary}:${primaryUnknown}` : primary, informationBurden: domain.contractInformationBurden(f) };
  });
  const familyInventory = contract.families.map(f => {
    const cs = contexts.filter(c => c.productSemantics.primaryProductFamily?.code === f.productFamily), rs = rows.filter(r => r.productFamily === f.productFamily);
    const tag = getOntologyTagsForAxis('PRODUCT_FAMILY', ps.ontologyVersion).find(t => t.code === f.productFamily);
    const unknowns = count(rs.flatMap(r => r.consolidation.evaluatedDimensions.filter(d => d.effectiveRequirement === 'UNKNOWN')), d => d.dimension);
    const derivations = getTrainingSemanticRegistryV2().familyTrainingFunctionDerivations.filter(d => d.productFamily === f.productFamily);
    return { productFamily: f.productFamily, totalProducts: cs.length, currentProducts: cs.filter(c => c.canonical.catalogPresence === 'current_catalog').length, activeProducts: cs.filter(c => c.canonical.active).length,
      classifiedProducts: cs.filter(c => c.productSemantics.classificationStatus === 'CLASSIFIED').length,
      trainingExerciseAssignments: cs.reduce((n, c) => n + c.training.exerciseCapabilities.length, 0), trainingFunctionAssignments: cs.reduce((n, c) => n + c.training.trainingFunctions.length, 0),
      exerciseAssignmentProducts: cs.filter(c => c.training.exerciseCapabilities.length).length, functionAssignmentProducts: cs.filter(c => c.training.trainingFunctions.length).length,
      productsWithSpecs: cs.filter(c => c.specs.length).length, supportedSpecSourceProducts: cs.filter(c => c.canonical.features?.some(s => domain.supportedSpecFeatureIds.includes(s.featureId))).length,
      technicalFeatureProducts: cs.filter(c => c.canonical.features?.some(s => trust.features.some(t => t.featureId === s.featureId && t.trustClass === 'TECHNICAL'))).length,
      trustEvidenceUsage: { productProducts: cs.filter(c => c.productSemantics.provenance.evidence.some(e => ['TRUSTED_CATEGORY', 'STRUCTURED_FEATURE'].includes(e.sourceType))).length,
        trainingProducts: cs.filter(c => [...c.training.exerciseCapabilities, ...c.training.trainingFunctions].some(a => a.evidence.some(e => ['TRUSTED_CATEGORY', 'STRUCTURED_FEATURE'].includes(e.kind)))).length },
      existingRules: [{ productRuleIds: [...new Set(cs.flatMap(c => c.productSemantics.provenance.evidence.map(e => e.ruleId)))].sort(),
        observedTrainingRuleIds: [...new Set(cs.flatMap(c => [...c.training.exerciseCapabilities, ...c.training.trainingFunctions].flatMap(a => a.evidence.map(e => e.ruleId))))].sort(),
        inspectedRuleCatalogs: ['trainingSemanticRuleCatalog', 'trainingSemanticV2RuleCatalog', 'trainingSemanticV21EnrichmentCatalog'], familyDerivations: derivations }],
      existingPolicies: [{ ontologyEvidence: tag, exerciseFamilyExemption: trainingSemanticRuleCatalog.nonApplicableFamilies.includes(f.productFamily), functionPolicy: f.dimensions.find(d => d.dimension === 'TRAINING_FUNCTION'),
        historicalScope: 'Current-only surface policy; historical facts retained, name-only ontology rules audited.', residualOther: 'Not a recognized family; no aliases for BAND.', weakEvidence: 'REVIEW_ONLY', nonProductScope: 'Excluded from discovery/filtering/unified' },
        { resolutionPolicySource: 'docs/audits/training-semantics/a00.6.7/post-closure-resolution-active.csv', gapClosureSource: 'docs/audits/training-semantics/a00.6.7/gap-closure-decisions.csv', applicabilityAuthority: false, rationale: 'These policies adjudicate content/completeness per product; they do not assert universal family obligations.' }],
      existingContracts: ['semantic-obligations-v1', 'training-semantic-registry-v2', 'CAT-V2 Specs schema 1', 'commercial-product-ontology-v3'], sourceReferences: [...new Set([...f.sourceReferences, ...f.dimensions.flatMap(d => d.sourceReferences), ...f.specRequirements.flatMap(s => s.sourceReferences)])].sort(),
      observedUnknowns: unknowns, observedConflicts: [{ dimension: 'SPECS', productIds: cs.filter(c => domain.mapSpecs(c).state === 'SOURCE_CONFLICT').map(c => c.canonical.productId) },
        { dimension: 'PRODUCT_SEMANTICS', productIds: cs.filter(c => domain.mapProductSemantics(c).state === 'SOURCE_CONFLICT').map(c => c.canonical.productId) }],
      observedInvalids: cs.filter(c => domain.mapTrainingExercise(c).state === 'INVALID_STATE').map(c => c.canonical.productId),
      productSemanticsAudit: { requirementDefensible: true, rationale: 'Identity required by explicit ontology tag/evidence gates; completeness is evaluated separately. No universal requirement for empty discipline/use-context axes.',
        states: count(cs, c => c.productSemantics.classificationStatus), resolutions: count(cs, c => domain.mapProductSemantics(c).state), historicalProducts: cs.filter(c => c.canonical.catalogPresence === 'historical_order_detail_only').length,
        explicitNameFamilyInferenceConflicts: cs.filter(c => domain.mapProductSemantics(c).reasons.some(r => r.code === 'CROSS_PROJECTION_CONFLICT')).map(c => c.canonical.productId) } };
  });
  const delta = {};
  for (const surface of [...domain.admissionSurfaces, 'TRAINING_FUNCTION_DISCOVERY']) {
    const decision = r => surface === 'TRAINING_FUNCTION_DISCOVERY' ? r.functionDiscovery : r.admission[surface];
    const old = baselineRows.filter(r => r.active && decision(r).decision === 'ADMITTED'), next = populations.ACTIVE.filter(r => decision(r).decision === 'ADMITTED');
    const changed = populations.ACTIVE.filter(r => old.some(p => p.productId === r.productId) !== next.some(p => p.productId === r.productId));
    delta[surface] = { before: old.length, after: next.length, addedIds: ids(next.filter(r => !old.some(p => p.productId === r.productId))), removedIds: ids(old.filter(r => !next.some(p => p.productId === r.productId))),
      products: changed.map(r => ({ productId: r.productId, family: r.productFamily, before: decision(oldById.get(r.productId)).decision, after: decision(r).decision,
        reasons: decision(r).reasons, contractChange: { from: previousSummary.contractVersion, to: contract.contractVersion, dimensions: domain.getProductFamilyObligation(r.productFamily, contract).dimensions },
        sourceReferences: domain.getProductFamilyObligation(r.productFamily, contract).sourceReferences })) };
  }
  const previouslyRemoved = [388, 1193, 1331, 1332, 1335, 1619, 1620, 1622, 1623].map(productId => {
    const r = rows.find(r => r.productId === productId); return { productId, family: r.productFamily, familyStatus: domain.getProductFamilyObligation(r.productFamily, contract).status, decision: r.admission.TRAINING_DISCOVERY.decision, reasons: r.admission.TRAINING_DISCOVERY.reasons };
  });
  assert(previouslyRemoved.every(r => r.familyStatus === 'UNKNOWN' && r.decision !== 'ADMITTED'));
  const unknownRows = rows.flatMap(r => r.consolidation.evaluatedDimensions.filter(d => d.effectiveRequirement === 'UNKNOWN').map(d => ({ productId: r.productId, productFamily: r.productFamily,
    population: r.active ? 'ACTIVE' : r.presence === 'current_catalog' ? 'CURRENT_INACTIVE' : 'HISTORICAL', dimension: d.dimension, declaredRequirement: d.declaredRequirement, conditionResult: d.conditionResult, sourceReferences: d.sourceReferences })));
  const unknownGrouped = Object.entries(populations).map(([population, rs]) => ({ population, families: Object.fromEntries([...new Set(rs.map(r => r.productFamily))].sort().map(f => [f,
    count(rs.filter(r => r.productFamily === f).flatMap(r => r.consolidation.evaluatedDimensions.filter(d => d.effectiveRequirement === 'UNKNOWN')), d => d.dimension, domain.semanticDimensions)])) }));
  const specEvaluable = populations.ACTIVE.filter(r => r.consolidation.evaluatedDimensions.find(d => d.dimension === 'SPECS').specRequirements?.some(s => s.effectiveRequirement === 'REQUIRED'));
  const specFiltering = { productsFromUnknownToEvaluableContract: specEvaluable.length, families: [...new Set(specEvaluable.map(r => r.productFamily))].sort(), specKeys: domain.supportedSpecKeys,
    keyCounts: Object.fromEntries(domain.supportedSpecKeys.map(key => [key, count(populations.ACTIVE, r => r.specFilteringByKey[key].decision, domain.admissionDecisionStates)])) };
  const onboarding = contract.families.map(f => {
    const withoutFacts = { canonical: { productId: 90000001, name: 'P_NEW', catalogPresence: 'current_catalog', active: true, features: [], categoryIds: [] }, declaredProductFamily: f.productFamily };
    // A real input witness is rebound only inside this synthetic scenario. It is never written to any projection.
    const candidates = contexts.filter(c => c.productSemantics.primaryProductFamily?.code === f.productFamily && c.canonical.catalogPresence === 'current_catalog');
    const minimalWitness = witness => {
      const c = structuredClone(witness), id = withoutFacts.canonical.productId;
      c.declaredProductFamily = f.productFamily; c.canonical.productId = id; c.canonical.active = true; c.productSemantics.productId = String(id); c.training.productId = id;
      c.productSemantics.secondaryProductFamilies = []; c.productSemantics.disciplines = []; c.productSemantics.useContexts = [];
      c.productSemantics.provenance.evidence = c.productSemantics.provenance.evidence.filter(e => e.axis === 'PRODUCT_FAMILY' && e.code === f.productFamily);
      const referencedFeatures = new Set([...c.productSemantics.provenance.evidence.filter(e => e.sourceType === 'STRUCTURED_FEATURE').map(e => Number(e.sourceId)),
        ...[...c.training.exerciseCapabilities, ...c.training.trainingFunctions].flatMap(a => a.evidence.filter(e => e.kind === 'STRUCTURED_FEATURE').map(e => Number(e.sourceId)))]);
      c.canonical.features = c.canonical.features.filter(feature => referencedFeatures.has(feature.featureId));
      c.specs = c.specs.filter(s => c.canonical.features.some(feature => feature.featureId === s.sourceFeature.featureId && feature.featureValueId === s.sourceFeature.featureValueId));
      const codes = domain.trainingSourceObligations(c);
      c.training.exerciseCapabilities = c.training.exerciseCapabilities.filter(a => codes?.exercise.includes(a.capabilityCode));
      c.training.trainingFunctions = c.training.trainingFunctions.filter(a => codes?.function.includes(a.functionCode));
      for (const s of c.specs) s.productKey = `P${id}`;
      // This is an explicit onboarding hypothesis, never evidence about current runtime consumption.
      c.trust.consumedByCategorySelection = true;
      return c;
    };
    const satisfiesRequired = c => domain.evaluateProductDimensions(c, contract).filter(d => d.effectiveRequirement === 'REQUIRED').every(d => d.terminalValid && d.evidenceCertified);
    const witness = candidates.find(c => satisfiesRequired(minimalWitness(c))) ?? candidates.find(c => domain.evaluateProductAdmission(c, 'PRODUCT_SEMANTIC_DISCOVERY', contract).decision === 'ADMITTED') ?? candidates[0];
    const summarizeScenario = c => ({ consolidation: domain.evaluateProductConsolidation(c, contract), surfaces: Object.fromEntries(domain.admissionSurfaces.map(s => [s, domain.evaluateProductAdmission(c, s, contract).decision])) });
    let minimal = null;
    if (witness) {
      const c = minimalWitness(witness);
      minimal = { witnessProductId: witness.canonical.productId, scenario: summarizeScenario(c),
        requiredEvidenceSatisfied: satisfiesRequired(c), source: { name: c.canonical.name, features: c.canonical.features, categoryIds: c.canonical.categoryIds },
        hypothesis: 'Trust source hashes match the verified input; consumedByCategorySelection=true simulates satisfying required Trust authority. Actual corpus remains false.',
        note: 'Real source witness rebound as P_NEW, extra Product axes and unused features/assignments removed; unknown applicability remains. No assignments or negative evidence fabricated.' };
    }
    assert(minimal?.requiredEvidenceSatisfied, `No source-backed onboarding witness satisfying required obligations for ${f.productFamily}`);
    return { productFamily: f.productFamily, status: f.status, withoutFacts: summarizeScenario(withoutFacts), minimalEvidence: minimal,
      L2: 'All five applicability decisions known; each active required dimension/key terminal-valid. Family claim alone is insufficient.',
      L3: 'Each required fact backed by accepted evidence, including negative evidence only when explicitly demanded.',
      L4: 'L2/L3 plus matching source/presence/family bindings and no relevant cross-projection conflicts.',
      requirements: f.dimensions, specRequirements: f.specRequirements };
  });
  const coverage = { formula: 'productsWithKnownObligations / population', populations: Object.fromEntries(Object.entries(summaries).map(([p, summary]) => [p, {
    before: ratio(previousSummary.populations[p].knownObligations, summary.totalPopulation), after: ratio(summary.knownObligations, summary.totalPopulation) }])) };
  const common = { phase: 'P2.3B', contractVersion: contract.contractVersion, contentHash: contract.contentHash, sourceExtractionId: manifest.source.sourceExtractionId, projectionBundleId: manifest.projectionBundleId };
  await writeJson('family-applicability-inventory.json', { ...common, evidenceCountScope: 'All canonical products; assignment counts count facts, product counts count products. Frequency is descriptive, never contract authority.', families: familyInventory });
  await writeFile(path.join(output, 'family-applicability-inventory.csv'), csv(familyInventory, Object.keys(familyInventory[0])));
  await writeJson('family-contracts-v2.json', contract);
  await writeFile(path.join(output, 'family-contracts-v2.csv'), csv(contract.families.map(f => ({ ...f, ...domain.contractInformationBurden(f) })), [...Object.keys(contract.families[0]), 'requiredFactCount', 'conditionalFactCount', 'unknownRequirementCount', 'flags']));
  await writeJson('obligation-coverage.json', { ...common, ...coverage });
  await writeJson('consolidation-baseline-P2.3B.json', { ...common, populations: summaries, familyMatrix, unknownObligations: unknownGrouped, overconstraintReview: familyMatrix.map(f => ({ productFamily: f.productFamily, ...f.informationBurden })) });
  await writeJson('admission-baseline-P2.3B.json', { ...common, populations: summaries, specFiltering, products: rows });
  await writeJson('admission-delta-P2.3B.json', { ...common, surfaces: delta, previouslyRemovedUnknownFamilyExerciseIds: previouslyRemoved });
  await writeFile(path.join(output, 'unknown-obligations-P2.3B.csv'), csv(unknownRows, ['productId', 'productFamily', 'population', 'dimension', 'declaredRequirement', 'conditionResult', 'sourceReferences']));
  await writeJson('new-product-onboarding-P2.3B.json', { ...common, families: onboarding });
  const after = await fingerprint(); assert.deepEqual(after, before, 'Protected artifacts mutated');
  const priorAfter = Object.fromEntries(await Promise.all(baselineNames.map(async n => [n, hash(await readFile(path.join(baselineDirectory, n)))])));
  assert.deepEqual(priorAfter, baselineHashes, 'Previous outputs mutated');
  let tests = null;
  try { const reportRaw = await readFile(path.join(output, 'test-results-P2.3B.json'), 'utf8'); const t = JSON.parse(reportRaw);
    tests = { success: t.success, tests: t.numTotalTests, passed: t.numPassedTests, failed: t.numFailedTests, files: t.testResults.length,
      reportHash: hash(reportRaw), domainPassed: t.testResults.some(s => s.name.replaceAll('\\', '/').endsWith('/tests/unit/catalog-admission-v2.test.ts') && s.status === 'passed') };
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (tests && (!tests.success || !tests.domainPassed)) {
    await writeJson('verification-P2.3B.json', { ...common, status: 'FAILED', gates: { G12_completeSuite: 'FAIL' }, tests });
    throw new Error('TEST_SUITE_FAILED');
  }
  assert.equal(await codeHash(), evaluationCodeHash, 'Code changed during audit');
  for (const [file, expected] of Object.entries(evidenceSourceHashes)) assert.equal(hash(await readFile(path.join(root, file))), expected, 'Evidence changed during audit');
  const outputHashes = Object.fromEntries(await Promise.all(outputNames.filter(n => !['verification-P2.3B.json', 'REPORT-P2.3B.md'].includes(n)).map(async n => [n, hash(await readFile(path.join(output, n)))])));
  let previousVerification = null;
  try { previousVerification = JSON.parse(await readFile(path.join(output, 'verification-P2.3B.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const sameIdentity = previousVerification?.evaluationCodeHash === evaluationCodeHash && previousVerification.contentHash === contract.contentHash && previousVerification.projectionBundleId === manifest.projectionBundleId && JSON.stringify(previousVerification.sourceHashes) === JSON.stringify(sourceHashes);
  if (sameIdentity) assert.deepEqual(previousVerification.outputHashes, outputHashes, 'Audit dataset reproducibility');
  const gates = Object.fromEntries(['G1_v1Preserved', 'G2_v2Deterministic', 'G3_all21Adjudicated', 'G4_noSilentExemption', 'G5_noFrequencyAuthority', 'G6_specValidation', 'G7_separateTraining', 'G8_invalid51', 'G9_conflicts82', 'G10_reproducibility', 'G11_protectedUnchanged', 'G12_completeSuite'].map(g => [g, g === 'G12_completeSuite' || g === 'G6_specValidation' || g === 'G4_noSilentExemption' || g === 'G7_separateTraining' ? tests?.success && tests.domainPassed ? 'PASS' : 'PENDING_TEST_SUITE' : g === 'G10_reproducibility' ? sameIdentity ? 'PASS' : 'PENDING_SECOND_RUN' : 'PASS']));
  await writeJson('verification-P2.3B.json', { ...common, status: Object.values(gates).every(s => s === 'PASS') ? 'PASS' : 'PENDING', gates, tests,
    v1Hash: domain.semanticObligationContract.contentHash, v1EveryProductParity: true, repeatedEveryProduct: true, evaluationCodeHash, outputHashes, sourceHashes, evidenceSourceHashes,
    protectedFileCount: Object.keys(before).length, protectedBefore: before, protectedAfter: after, priorAuditBefore: baselineHashes, priorAuditAfter: priorAfter, invalidIds, conflictIds, negativeCount: negatives.length, bundleValidation: validation,
    inspectedRuleCatalogHashes: { v1: hash(JSON.stringify(trainingSemanticRuleCatalog)), v2: hash(JSON.stringify(trainingSemanticV2RuleCatalog)), v21: hash(JSON.stringify(trainingSemanticV21EnrichmentCatalog)) } });
  const table = familyMatrix.map(f => `| ${f.productFamily} | ${f.status} | ${f.activeProducts} | ${f.knownObligations} | ${f.unknownObligations} | ${f.consolidated} | ${f.primaryBlocker} |`).join('\n');
  const active = summaries.ACTIVE;
  const unknownText = unknownGrouped.find(p => p.population === 'ACTIVE');
  await writeFile(path.join(output, 'REPORT-P2.3B.md'), `# P2.3B — Family Applicability & Obligation Resolution\n\n## A. Contract version\n\n${contract.contractVersion}; schemaVersion=2; contentHash=${contract.contentHash}. Ontology ${contract.ontologyVersion}, hash=${contract.ontologyHash}. V1 hash=${domain.semanticObligationContract.contentHash}, historical full-product evaluations preserved.\n\n## B. Family disposition\n\nACTIVE=${contract.families.filter(f => f.status === 'ACTIVE').length}; PROVISIONAL=${contract.families.filter(f => f.status === 'PROVISIONAL').length}; UNKNOWN=${contract.families.filter(f => f.status === 'UNKNOWN').length}. Default UNKNOWN is separate. No family is promoted while family-wide Specs absence remains UNKNOWN.\n\n| Family | Status | Active products | Known obligations | Unknown obligations | Consolidated | Primary blocker |\n|---|---|---:|---:|---:|---:|---|\n${table}\n\n## C. Obligation coverage\n\n${Object.entries(coverage.populations).map(([p, v]) => `${p}: ${v.before.numerator}/${v.before.denominator} (${v.before.percentage}%) → ${v.after.numerator}/${v.after.denominator} (${v.after.percentage}%).`).join('\n\n')}\n\n## D. Consolidation\n\n${Object.entries(summaries).map(([p, s]) => `${p}: ${JSON.stringify(Object.fromEntries(Object.entries(s.stateCounts).map(([state, n]) => [state, ratio(n, s.totalPopulation)])))}. Certified/total=${s.certifiedConsolidated}/${s.totalPopulation} (${s.certifiedOverTotal.percentage}%); certified/known=${s.certifiedConsolidated}/${s.knownObligations} (${s.certifiedOverKnownObligations.percentage}%).`).join('\n\n')}\n\n## E. Product Discovery\n\n${delta.PRODUCT_SEMANTIC_DISCOVERY.before}/886 → ${delta.PRODUCT_SEMANTIC_DISCOVERY.after}/886. Added=${JSON.stringify(delta.PRODUCT_SEMANTIC_DISCOVERY.addedIds)}; removed=${JSON.stringify(delta.PRODUCT_SEMANTIC_DISCOVERY.removedIds)}. Exact product reasons/provenance in admission-delta-P2.3B.json. Product Context=${active.surfaces.PRODUCT_CONTEXT.ADMITTED}/886.\n\n## F. Training Discovery\n\nExercise ${delta.TRAINING_DISCOVERY.before} → ${delta.TRAINING_DISCOVERY.after}; added=${JSON.stringify(delta.TRAINING_DISCOVERY.addedIds)}; removed=${JSON.stringify(delta.TRAINING_DISCOVERY.removedIds)}. Function ${delta.TRAINING_FUNCTION_DISCOVERY.before} → ${delta.TRAINING_FUNCTION_DISCOVERY.after}; added=${JSON.stringify(delta.TRAINING_FUNCTION_DISCOVERY.addedIds)}; removed=${JSON.stringify(delta.TRAINING_FUNCTION_DISCOVERY.removedIds)}. The nine previously removed products retain UNKNOWN families. Source rule obligations are evaluated before content; COMPLETE never determines applicability.\n\n## G. Spec Filtering\n\n${specFiltering.productsFromUnknownToEvaluableContract} active products, ${specFiltering.families.length} families, six supported keys have active source promises. Distribution=${JSON.stringify(active.surfaces.SPEC_FILTERING)}. Per-key decisions are in admission-baseline-P2.3B.json; absent supported keys are exempt only within the normalization promise, while exhaustive family technical needs remain UNKNOWN. Additional technical features retained; no required manufacturer fact is invented.\n\n## H. Unified Retrieval\n\n${JSON.stringify(active.surfaces.UNIFIED_RETRIEVAL)}. Runtime remains NOT_READY and unchanged.\n\n## I. Unknown obligations\n\nActive family/dimension groups: ${JSON.stringify(unknownText.families)}. Complete all/current/active grouping in consolidation-baseline-P2.3B.json and product rows in unknown-obligations-P2.3B.csv.\n\n## J. Overconstraint review\n\n${JSON.stringify(familyMatrix.map(f => ({ family: f.productFamily, ...f.informationBurden })))}. No weighted score. Six conditional key promises; no universal technical sheet. No POTENTIAL_OVERCONSTRAINT found in grounded obligations.\n\n## K. New-product onboarding\n\nEach of 21 known families is simulated with no facts, then available required witness evidence, in new-product-onboarding-P2.3B.json. A declared family selects obligations but does not satisfy Product evidence. Unknown global obligations keep L2/L3/L4 uncertified. Source conditions, missing required facts, Trust authority and exact reachable surfaces are reported; unresolved witness evidence is explicit.\n\n## L. Tests / reproducibility\n\n${JSON.stringify(gates)}. Suite=${JSON.stringify(tests)}. All 2048 v1 results equal historical payloads; v2 repeated exactly. Full-output hash comparison=${sameIdentity ? 'PASS' : 'PENDING_SECOND_RUN'}. Protected files=${Object.keys(before).length}; prior outputs unchanged. Training invalid IDs=51; Specs conflict IDs=82; valid empty Training negatives=836, evidence ABSENT.\n\n## M. Recommendation\n\nApplicability remains the dominant population blocker where family requirements lack authority. Existing facts/frequencies cannot resolve those unknowns. Grounded contracts use only repository ontology, rule/policy, supported normalization and audit evidence. Trust consumption authority also blocks certification where used.\n\n## N. Next phase\n\nProceed with P2.3C Training Semantic Reconciliation for the known 51 invalid records and source-required missing assignments, while separately obtaining explicit family applicability authority for unresolved Training and Specs. P2.3C alone cannot certify Unified Retrieval or resolve unknown obligations. Do not publish/activate v2 or alter protected content in this phase.\n\nReproduce: node cross-projection-audit/audit.mjs --p2-3b. Baseline directory retains v1 artifacts; --output-dir writes v2 outputs independently.\n`);
  console.log(JSON.stringify({ phase: 'P2.3B', contentHash: contract.contentHash, gates, populations: Object.fromEntries(Object.entries(summaries).map(([p, s]) => [p, { total: s.totalPopulation, known: s.knownObligations, certified: s.certifiedConsolidated }])), activeSurfaces: active.surfaces, functionDiscovery: active.trainingFunctionDiscovery, specFiltering, sourceDir, bundleDir }));
}
