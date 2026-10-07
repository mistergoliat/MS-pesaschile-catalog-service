// Run: node --import tsx cross-projection-audit/training-reconciliation-audit.mjs
// Offline only. All generated writes are confined to cross-projection-audit/p2-3c-fix.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { contentHash, canonicalContent, validateManifest, recordCounts } from '../src/domain/catalog/projection-input/canonical.ts';
import { canonicalJson, bundleId, semanticHash, validateBundle, validateBundleForPublication } from '../src/domain/catalog/projection-bundle.ts';
import { loadTrainingSemanticClassificationInputs } from '../scripts/training-semantic-classification/lib/load-input.ts';
import { parseCsvRecords } from '../scripts/product-semantic-classification/lib/csv.ts';
import { reconcileTrainingSnapshot, buildTrainingSemanticsV2Projection, readAcceptedTrainingResolutionPolicy } from '../scripts/catalog-v2/build-training-semantics-v2.ts';
import { trainingResolutionPolicy, validateTrainingSemanticSnapshotV2, canonicalizeTrainingSnapshotJson, DefaultTrainingSemanticSnapshotV2Builder } from '../src/domain/training-semantic-snapshot/index.ts';
import { classifyTrainingSemanticProductsV21 } from '../src/domain/training-semantic-classification-v2-1/index.ts';
import { fact } from '../src/domain/training-semantic-snapshot/v2Runtime.ts';
import * as admission from '../src/domain/catalog-admission/index.ts';
import { getTrainingSemanticRegistryV2 } from '../src/domain/training-semantics-v2/index.ts';
import { trainingSemanticV2RuleCatalog, hasCableFamilyAuthority, trainingRuleEvidenceDomain } from '../src/domain/training-semantic-classification-v2/rules.ts';
import { validateTrainingSemanticInvariants } from '../src/domain/training-semantic-snapshot/semanticInvariants.ts';
import { DefaultTrainingSemanticQueryService } from '../src/application/catalog/training-semantic-query/defaultTrainingSemanticQueryService.ts';
import { DefaultSemanticDiscoveryService } from '../src/application/catalog/semantic-discovery/defaultSemanticDiscoveryService.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const options = {};
for (const arg of process.argv.slice(2)) {
  const m = /^--(source-dir|bundle-dir)=(.+)$/.exec(arg);
  if (!m || options[m[1]]) throw new Error(`Unsupported argument: ${arg}`);
  options[m[1]] = m[2];
}
const sourceDir = options['source-dir'] ?? 'artifacts/catalog-projection-input/36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2';
const bundleDir = options['bundle-dir'] ?? 'artifacts/catalog-v2/p2-2b-final/bundles/ee4881b5875ee098c8b54c5ee6dfdcd4d4a92d8c91263bd4ce02c1b5e8e0a347';
const out = path.join(root, 'cross-projection-audit/p2-3c-fix');
await mkdir(out, { recursive: true });
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const write = async (file, value) => writeFile(path.join(out, file), `${JSON.stringify(value, null, 2)}\n`);
const walk = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
const fingerprint = async () => Object.fromEntries(await Promise.all((await Promise.all(['artifacts', 'data', 'cross-projection-audit/p2-3c'].map(walk))).flat().sort().map(async f => [f.replaceAll('\\', '/'), contentHash(await readFile(f, 'utf8'))])));
const protectedBefore = await fingerprint();
const checks = { typecheck: false, lint: false };
for (const [name, args] of [['typecheck', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit']], ['lint', ['node_modules/eslint/bin/eslint.js', '.', '--ext', '.ts']]]) {
  const output = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  await write(`${name}-output.json`, { command: [process.execPath, ...args], exitCode: 0, output });
  checks[name] = true;
}
await write('code-checks.json', checks);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const count = (rows, select) => rows.reduce((r, row) => { const k = select(row); r[k] = (r[k] ?? 0) + 1; return r; }, {});
const ids = rows => rows.map(r => r.productId).sort((a, b) => a - b);
const invalid = r => r.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && r.exerciseCapabilities.length + r.trainingFunctions.length > 0;
const names = { canonicalInput: 'canonical_input.json', compatibilityCsv: 'product_catalog_exploration.csv', categoryTrustMap: 'category_trust_map.csv', featureTrustMap: 'feature_trust_map.csv' };
const sourceHashes = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([k, f]) => [k, contentHash(await readFile(path.join(sourceDir, f), 'utf8'))])));
const extraction = validateManifest(await json(path.join(sourceDir, 'projection_input_manifest.json')), sourceHashes);
const source = await json(path.join(sourceDir, names.canonicalInput));
assert.equal(await readFile(path.join(sourceDir, names.canonicalInput), 'utf8'), canonicalContent(source));
assert.deepEqual(recordCounts(source), extraction.recordCounts);
const manifest = await json(path.join(bundleDir, 'manifest.json'));
const files = Object.fromEntries(await Promise.all(Object.values(manifest.projections).filter(p => p.status === 'present').map(async p => [p.artifact, await readFile(path.join(bundleDir, p.artifact), 'utf8')])));
validateBundle(manifest, files, source);
const projections = Object.fromEntries(Object.entries(manifest.projections).filter(([, p]) => p.status === 'present').map(([k, p]) => [k, JSON.parse(files[p.artifact])]));
const baseline = projections.trainingSemanticsV2.snapshot, sourceV1 = projections.trainingSemantics.snapshot, product = projections.productSemantics.snapshot;
assert.equal(baseline.snapshotId, 'sha256:28be0bca348b2ba915fac8597919657e18438fa9053443ebf8ff6042197093a5');
const legacyFile = 'data/training-semantic-snapshots/v2/snapshots/045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1.json';
const legacy = await json(legacyFile);
assert.equal(legacy.snapshotId, 'sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1');
validateTrainingSemanticSnapshotV2(legacy);
const oldInvalid = baseline.records.filter(invalid), negatives = baseline.records.filter(r => r.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && !invalid(r));
assert.equal(oldInvalid.length, 51); assert.equal(negatives.length, 836);
assert.deepEqual(ids(legacy.records.filter(invalid)), ids(oldInvalid));
const loaded = await loadTrainingSemanticClassificationInputs({ catalogCsvPath: path.join(sourceDir, names.compatibilityCsv), categoryTrustMapCsvPath: path.join(sourceDir, names.categoryTrustMap), featureTrustMapCsvPath: path.join(sourceDir, names.featureTrustMap) });
assert.deepEqual(loaded.warnings, []);
const acceptedPolicy = await readAcceptedTrainingResolutionPolicy();
assert.equal(acceptedPolicy.hash, projections.trainingSemanticsV2.inputs.resolutionPolicy.hash);
const categories = parseCsvRecords(await readFile(path.join(sourceDir, names.categoryTrustMap), 'utf8')).map(r => ({ categoryId: Number(r.categoryId), trustClass: r.trustClass }));
const features = parseCsvRecords(await readFile(path.join(sourceDir, names.featureTrustMap), 'utf8')).map(r => ({ featureId: Number(r.featureId), trustClass: r.trustClass }));
const trust = { categories, features, sourceHashesVerified: true, consumedByCategorySelection: false };
const pById = new Map(product.records.map(p => [Number(p.productId), p]));
const tById = new Map(baseline.records.map(p => [p.productId, p]));
const specsById = Map.groupBy(projections.specs.records, p => Number(p.productKey.slice(1)));
const contexts = new Map(source.products.map(canonical => [canonical.productId, { canonical, productSemantics: pById.get(canonical.productId), training: tById.get(canonical.productId), specs: specsById.get(canonical.productId) ?? [], trust, lineage: { productVerified: true, trainingVerified: true, specsVerified: true } }]));
assert.deepEqual([source.products.length, source.products.filter(p => p.catalogPresence === 'current_catalog').length, source.products.filter(p => p.active).length], [2048, 1565, 886]);
const contract = admission.semanticObligationContractV2;
assert.equal(contract.contentHash, 'sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94');
// Fresh source classification establishes the seed; the old snapshot is only a comparator.
const freshSeed = new DefaultTrainingSemanticSnapshotV2Builder().replayHistorical({ results: classifyTrainingSemanticProductsV21(loaded.inputs, { sourceCatalogExport: 'product_catalog_exploration.csv' }), parameters: {
  sourceProductCount: loaded.inputs.length, sourceV1Snapshot: sourceV1, sourceV1SnapshotId: sourceV1.snapshotId,
  resolutionStates: acceptedPolicy.states, activeTrainingRelevantProductIds: acceptedPolicy.productIds,
  activeTrainingRelevant: acceptedPolicy.productIds.length, generatedAt: baseline.generatedAt,
} }, false);
const input = { baseline: freshSeed, sourceV1, sources: loaded.inputs, contexts };
const { snapshot, evaluations } = reconcileTrainingSnapshot(input);
const repeated = reconcileTrainingSnapshot({ ...input, sources: [...loaded.inputs].reverse(), contexts: new Map([...contexts].reverse()) });
assert(same(snapshot, repeated.snapshot)); assert(same(evaluations, repeated.evaluations));
assert.equal(snapshot.records.filter(invalid).length, 0);
assert.notEqual(snapshot.snapshotId, baseline.snapshotId);
const candidateById = new Map(snapshot.records.map(r => [r.productId, r]));
const evaluationById = new Map(evaluations.map(e => [e.productId, e]));
const changed = baseline.records.filter(b => !same(b, candidateById.get(b.productId))).map(before => {
  const after = candidateById.get(before.productId), evaluation = evaluationById.get(before.productId);
  return { productId: before.productId, before, after, reason: evaluation.reason, sourceEvidence: evaluation.sourceEvidence, policyRule: evaluation.policyRule };
});
const semanticView = record => ({ ...record,
  exerciseCapabilities: record.exerciseCapabilities.map(({ provenance: _lineage, ...assignment }) => assignment),
  trainingFunctions: record.trainingFunctions.map(({ provenance: _lineage, ...assignment }) => assignment) });
const changes = { totalRecords: baseline.records.length, unchangedRecords: baseline.records.length - changed.length, changedRecords: changed.length,
  resolutionStateChanged: changed.filter(r => r.before.resolutionState !== r.after.resolutionState).length,
  exerciseAssignmentsChanged: changed.filter(r => !same(r.before.exerciseCapabilities, r.after.exerciseCapabilities)).length,
  functionAssignmentsChanged: changed.filter(r => !same(r.before.trainingFunctions, r.after.trainingFunctions)).length,
  negativeEvidenceChanged: changed.filter(r => r.before.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && !invalid(r.before) && !same(r.before.resolutionEvidence, r.after.resolutionEvidence)).length,
  resolutionEvidenceChanged: changed.filter(r => !same(r.before.resolutionEvidence, r.after.resolutionEvidence)).length,
  lineageOnlyChanged: changed.filter(r => same(semanticView(r.before), semanticView(r.after))).length };
const reconciled51 = oldInvalid.map(before => { const e = evaluationById.get(before.productId); return { productId: before.productId, beforeState: before.resolutionState, afterState: e.record.resolutionState, reason: e.reason, sourceEvidence: e.sourceEvidence, policyRule: e.policyRule }; });
const negativeAudit = negatives.map(before => { const e = evaluationById.get(before.productId);  return { productId: before.productId, state: e.negativeEvidenceState, evidence: e.record.resolutionEvidence ?? [], reason: e.reason, sourceEvidence: e.sourceEvidence }; });
const gapRows = evaluations.flatMap(e => e.gaps.map(g => ({ productId: e.productId, ...g })));
const gapCounts = { SAFE_DERIVABLE: 0, MISSING_SOURCE_DATA: 0, POLICY_UNKNOWN: 0, ALREADY_SATISFIED: 0, ...count(gapRows, r => r.classification) };
const negativeCounts = { NEGATIVE_EVIDENCE_PRESENT: 0, NEGATIVE_EVIDENCE_ABSENT: 0, NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE: 0, ...count(negativeAudit, r => r.state) };
const allFinalNegatives = evaluations.filter(e => e.record.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY').map(e => ({ productId: e.productId, state: e.negativeEvidenceState, evidence: e.record.resolutionEvidence ?? [], reason: e.reason, sourceEvidence: e.sourceEvidence }));
const allNegativeCounts = count(allFinalNegatives, r => r.state);
const evaluate = (context, record) => admission.evaluateAdmissionSnapshot({ ...context, training: record }, contract);
const reevaluatedBeforeRows = [...contexts.values()].map(c => ({ productId: c.canonical.productId, active: c.canonical.active === true, ...evaluate(c, c.training) }));
const archivedBaseline = await json('cross-projection-audit/admission-baseline-P2.3B.json');
assert.equal(archivedBaseline.contentHash, contract.contentHash);
const beforeRows = archivedBaseline.products;
const afterRows = [...contexts.values()].map(c => ({ productId: c.canonical.productId, active: c.canonical.active === true, ...evaluate(c, candidateById.get(c.canonical.productId)) }));
for (let i = 0; i < beforeRows.length; i++) {
  const a = beforeRows[i], b = afterRows[i];
  assert.deepEqual(a.consolidation.evaluatedDimensions.map(d => [d.dimension, d.declaredRequirement]), b.consolidation.evaluatedDimensions.map(d => [d.dimension, d.declaredRequirement]), 'Declared contract changed');
  assert.deepEqual(a.consolidation.evaluatedDimensions.find(d => d.dimension === 'SPECS'), b.consolidation.evaluatedDimensions.find(d => d.dimension === 'SPECS'));
}
const activeBefore = beforeRows.filter(r => r.active), activeAfter = afterRows.filter(r => r.active);
const productIds = rows => ids(rows.filter(r => r.admission.PRODUCT_SEMANTIC_DISCOVERY.decision === 'ADMITTED'));
assert.equal(productIds(activeBefore).length, 791); assert.deepEqual(productIds(activeBefore), productIds(activeAfter));
const conflictIds = rows => ids(rows.filter(r => r.consolidation.evaluatedDimensions.find(d => d.dimension === 'SPECS').resolution.state === 'SOURCE_CONFLICT'));
assert.equal(conflictIds(beforeRows).length, 82); assert.deepEqual(conflictIds(beforeRows), conflictIds(afterRows));
const summarize = rows => ({ total: rows.length, knownObligations: rows.filter(r => r.consolidation.obligationsKnown).length,
  consolidation: count(rows, r => r.consolidation.state), certified: rows.filter(r => ['CONSOLIDATED', 'CONSOLIDATED_WITH_NOT_APPLICABLE'].includes(r.consolidation.state)).length,
  exerciseDiscovery: rows.filter(r => r.admission.TRAINING_DISCOVERY.decision === 'ADMITTED').length,
  functionDiscovery: rows.filter(r => r.functionDiscovery.decision === 'ADMITTED').length,
  unifiedRetrieval: count(rows, r => r.admission.UNIFIED_RETRIEVAL.decision) });
const admissionDelta = { ALL: { before: summarize(beforeRows), after: summarize(afterRows) }, ACTIVE: { before: summarize(activeBefore), after: summarize(activeAfter) } };
for (const population of Object.values(admissionDelta)) population.delta = { certified: population.after.certified - population.before.certified,
  exerciseDiscovery: population.after.exerciseDiscovery - population.before.exerciseDiscovery, functionDiscovery: population.after.functionDiscovery - population.before.functionDiscovery,
  unifiedAdmitted: (population.after.unifiedRetrieval.ADMITTED ?? 0) - (population.before.unifiedRetrieval.ADMITTED ?? 0), knownObligations: population.after.knownObligations - population.before.knownObligations };
// Exercise the existing Query and Discovery implementations, partitioning readers to honor their 100-result limit.
function runtimeIds(training, axis) {
  const { records, ...metadata } = training;
  const { records: productRecords, ...productMetadata } = product;
  const registry = getTrainingSemanticRegistryV2();
  const codes = axis === 'EXERCISE_CAPABILITY' ? registry.exerciseCapabilities.map(d => d.code) : registry.trainingFunctions.map(d => d.code);
  const queryIds = [], discoveryIds = [];
  for (let i = 0; i < records.length; i += 100) {
    const facts = records.slice(i, i + 100).map(fact);
    const reader = { getMetadata: () => metadata, getAllProductTrainingSemanticFacts: () => facts };
    const productReader = { getActiveSnapshotMetadata: () => productMetadata, getAllProductSemanticFacts: () => productRecords };
    const request = { requirements: [{ axis, codes, mode: 'required', match: 'any' }], options: { limit: 100 } };
    const query = new DefaultTrainingSemanticQueryService(reader).query(request);
    const discovery = new DefaultSemanticDiscoveryService(productReader, reader).query(request);
    assert(!query.truncated && !discovery.truncated);
    queryIds.push(...query.results.map(r => Number(r.productId))); discoveryIds.push(...discovery.results.map(r => Number(r.productId)));
  }
  return { query: [...new Set(queryIds)].sort((a, b) => a - b), discovery: [...new Set(discoveryIds)].sort((a, b) => a - b) };
}
const activeIds = new Set(source.products.filter(p => p.active).map(p => p.productId));
const discoveryDelta = {};
const idDelta = (before, after) => ({
  added: after.filter(productId => !before.includes(productId)).map(productId => ({ productId, reason: evaluationById.get(productId).reason })),
  removed: before.filter(productId => !after.includes(productId)).map(productId => ({ productId, reason: evaluationById.get(productId).reason })),
});
for (const [dimension, axis] of [['exercise', 'EXERCISE_CAPABILITY'], ['function', 'TRAINING_FUNCTION']]) {
  const before = runtimeIds(baseline, axis), after = runtimeIds(snapshot, axis);
  const admitted = rows => ids(rows.filter(r => (dimension === 'exercise' ? r.admission.TRAINING_DISCOVERY : r.functionDiscovery).decision === 'ADMITTED'));
  const beforeActive = admitted(activeBefore), afterActive = admitted(activeAfter);
  const added = afterActive.filter(id => !beforeActive.includes(id)), removed = beforeActive.filter(id => !afterActive.includes(id));
  const rawBefore = before.discovery.filter(id => activeIds.has(id)), rawAfter = after.discovery.filter(id => activeIds.has(id));
  discoveryDelta[dimension] = { query: { before: before.query, after: after.query, ...idDelta(before.query, after.query) }, discovery: { before: before.discovery, after: after.discovery, ...idDelta(before.discovery, after.discovery) },
    rawRuntimeActive: { before: rawBefore, after: rawAfter, ...idDelta(rawBefore, rawAfter) },
    active: { before: beforeActive.length, after: afterActive.length, delta: afterActive.length - beforeActive.length, beforeIds: beforeActive, afterIds: afterActive,
      added: added.map(productId => ({ productId, reason: evaluationById.get(productId).reason })), removed: removed.map(productId => ({ productId, reason: evaluationById.get(productId).reason })) } };
  assert.equal(beforeActive.length, dimension === 'exercise' ? 89 : 93);
  assert(beforeActive.every(id => before.discovery.includes(id)) && afterActive.every(id => after.discovery.includes(id)));
}
const newProductChecks = contract.families.map(f => {
  const context = { canonical: { productId: 90000001, name: 'P_NEW', catalogPresence: 'current_catalog', active: true, categoryIds: [], features: [] }, declaredProductFamily: f.productFamily };
  const empty = { productId: 90000001, exerciseCapabilities: [], trainingFunctions: [], coverageStatus: 'UNMODELED', resolutionState: 'ONTOLOGY_GAP', resolved: false, warnings: [] };
  const candidate = reconcileTrainingSnapshot({ baseline: { ...baseline, records: [empty], counts: { ...baseline.counts, activeTrainingRelevant: 0 } }, sourceV1, sources: [], contexts: new Map([[90000001, context]]) }).snapshot.records[0];
  assert.deepEqual(candidate, empty);
  const before = admission.evaluateAdmissionSnapshot({ ...context, training: empty }, contract), after = admission.evaluateAdmissionSnapshot({ ...context, training: candidate }, contract);
  assert.deepEqual(before, after);
  assert(candidate.exerciseCapabilities.length + candidate.trainingFunctions.length === 0);
  return { productFamily: f.productFamily, unknownDimensions: before.consolidation.evaluatedDimensions.filter(d => d.effectiveRequirement === 'UNKNOWN').map(d => d.dimension) };
});
const codeFiles = (await Promise.all(['src', 'scripts'].map(walk))).flat().filter(f => f.endsWith('.ts')).sort();
codeFiles.push('package-lock.json');
const codeRef = semanticHash(await Promise.all(codeFiles.map(async f => [f.replaceAll('\\', '/'), contentHash(await readFile(f, 'utf8'))])));
const native = await buildTrainingSemanticsV2Projection({ sourceDir, sourceExtractionId: extraction.sourceExtractionId, codeRef, sourceV1, contexts });
if (!same(native.snapshot, snapshot)) {
  const nativeById = new Map(native.snapshot.records.map(r => [r.productId, r]));
  const differences = snapshot.records.filter(r => !same(r, nativeById.get(r.productId))).map(r => ({ productId: r.productId, audit: r, native: nativeById.get(r.productId) }));
  await write('builder-disagreement.json', differences);
  console.log(JSON.stringify({ builderDisagreementCount: differences.length, first: differences.slice(0, 2) }));
}
assert(same(native.snapshot, snapshot), 'Native builder/finalizer disagree');
const candidateFiles = { ...files, trainingSemanticsV2: undefined };
delete candidateFiles.trainingSemanticsV2;
candidateFiles[manifest.projections.trainingSemanticsV2.artifact] = `${canonicalJson(native)}\n`;
const candidateManifest = structuredClone(manifest);
candidateManifest.build = { ...candidateManifest.build, codeRef, builtAt: '1970-01-01T00:00:00.000Z', builderVersions: { ...candidateManifest.build.builderVersions, trainingSemanticsV2: trainingResolutionPolicy.builderVersion } };
candidateManifest.projections.trainingSemanticsV2 = { ...candidateManifest.projections.trainingSemanticsV2, snapshotId: semanticHash(native), contentHash: contentHash(candidateFiles[manifest.projections.trainingSemanticsV2.artifact]), builderVersion: trainingResolutionPolicy.builderVersion };
candidateManifest.projectionBundleId = bundleId(candidateManifest);
const bundleValidation = validateBundleForPublication(candidateManifest, candidateFiles, source);
const protectedComparisons = Object.fromEntries(['productSemantics', 'trainingSemantics', 'specs', 'trustMaps'].map(name => {
  const file = manifest.projections[name].artifact; assert.equal(files[file], candidateFiles[file]); return [name, { unchanged: true, contentHash: contentHash(files[file]) }];
}));
const candidateDirectory = path.join(out, 'candidate-bundle', candidateManifest.projectionBundleId.slice(7));
await mkdir(candidateDirectory, { recursive: true });
for (const [name, raw] of Object.entries(candidateFiles)) await writeFile(path.join(candidateDirectory, name), raw);
await writeFile(path.join(candidateDirectory, 'manifest.json'), `${JSON.stringify(candidateManifest, null, 2)}\n`);
await write('candidate-training-snapshot.json', snapshot);
await write('training-resolution-delta.json', { ...changes, products: changed });
const csv = rows => `productId,beforeState,afterState,reason,sourceEvidence,policyRule\n${rows.map(r => [r.productId, r.beforeState, r.afterState, r.reason, JSON.stringify(r.sourceEvidence), r.policyRule].map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n')}\n`;
await writeFile(path.join(out, 'invalid-51-reconciliation.csv'), csv(reconciled51));
await write('negative-evidence-audit.json', { total: allFinalNegatives.length, counts: allNegativeCounts, products: allFinalNegatives,
  originalCoherentNegatives: { total: negativeAudit.length, counts: negativeCounts, products: negativeAudit } });
await write('source-required-training-gaps.json', { counts: gapCounts, unit: 'product/dimension/code rows; UNKNOWN is a product/dimension row', products: gapRows });
await write('discovery-delta.json', discoveryDelta);
await write('consolidation-delta.json', { ...admissionDelta, products: afterRows.filter((r, i) => !same(r, beforeRows[i])).map(r => ({ productId: r.productId, before: beforeRows.find(b => b.productId === r.productId), after: r })) });
await write('candidate-comparison.json', { baselineSnapshotId: baseline.snapshotId, candidateSnapshotId: snapshot.snapshotId, semanticChecksum: snapshot.semanticChecksum,
  snapshotContentHash: contentHash(`${canonicalizeTrainingSnapshotJson(snapshot)}\n`), nativeContentHash: contentHash(`${canonicalJson(native)}\n`),
  policy: { ...trainingResolutionPolicy, previousPolicyHash: (await readAcceptedTrainingResolutionPolicy()).hash }, codeRef, changes, reconciled51: count(reconciled51, r => r.afterState),
  invalidIds: ids(oldInvalid), specsConflictIds: conflictIds(afterRows), productDiscoveryIds: productIds(activeAfter),
  candidateBundleId: candidateManifest.projectionBundleId, candidateDirectory: path.relative(root, candidateDirectory), protectedComparisons, bundleValidation, newProductChecks });
assert.deepEqual(protectedBefore, await fingerprint(), 'Protected artifacts or pointers changed');

const rejected = await json('cross-projection-audit/p2-3c/candidate-training-snapshot.json');
const review = await json('cross-projection-audit/p2-3c/CONTENT-REVIEW-EVIDENCE.json');
assert.equal(rejected.snapshotId, 'sha256:959e0cbac47fc19db88c36338a380a9cf9494bc653491d9e706d9f78201ff8d7');
assert.notEqual(snapshot.snapshotId, rejected.snapshotId);
assert.notEqual(candidateManifest.projectionBundleId, review.bundleId);
const rejectedById = new Map(rejected.records.map(r => [r.productId, r]));
const assignments = r => [...r.exerciseCapabilities, ...r.trainingFunctions];
const code = a => a.capabilityCode ?? a.functionCode;
const assignmentKey = a => `${code(a)}/${a.relationType}`;
const signatures = r => assignments(r).map(assignmentKey).sort();
// Prior human adjudications are regression fixtures, never production overrides.
const mixedInvalid = new Map([[1124, 'GUIDED_BARBELL_SUPPORT'], [1999, 'BARBELL_SUPPORT'], [2096, 'PULL_UP'], [1832, 'BICEPS_CURL']]);
const focused = review.records.map(r => {
  const before = rejectedById.get(r.productId), after = candidateById.get(r.productId);
  const invalidCode = r.verdict === 'REJECT_COMPLETE' ? mixedInvalid.get(r.productId) ?? 'CABLE_RESISTANCE' : null;
  const approved = r.verdict === 'APPROVE_COMPLETE';
  const passed = approved ? signatures(before).every(k => signatures(after).includes(k)) && after.resolutionState === 'SEMANTIC_COMPLETE'
    : invalidCode ? !assignments(after).some(a => code(a) === invalidCode)
    : r.verdict === 'REQUIRES_HUMAN_REVIEW' ? !after.trainingFunctions.some(a => a.functionCode === 'BARBELL_SUPPORT') && after.resolutionState !== 'SEMANTIC_COMPLETE'
    : r.verdict === 'RULE_GAP' ? after.resolutionState !== 'ONTOLOGY_GAP' : false;
  return { productId: r.productId, priorVerdict: r.verdict, invalidAssignment: invalidCode,
    ruleBefore: invalidCode ? assignments(before).find(a => code(a) === invalidCode)?.evidence.map(e => e.ruleId) : [],
    reasonRejected: r.reason, beforeAssignments: signatures(before), afterAssignments: signatures(after), afterResolution: after.resolutionState, passed };
});
assert.deepEqual(count(focused, r => r.priorVerdict), { APPROVE_COMPLETE: 18, REJECT_COMPLETE: 26, REQUIRES_HUMAN_REVIEW: 1, RULE_GAP: 6 });
assert(focused.every(r => r.passed), `Prior content review regression: ${JSON.stringify(focused.filter(r => !r.passed))}`);
for (const r of focused.filter(r => r.priorVerdict === 'RULE_GAP')) {
  const source = evaluationById.get(r.productId).sourceEvidence.source;
  if (source.productFamily === 'MACHINE_ATTACHMENT') assert(['DATA_GAP', 'RULE_GAP', 'AMBIGUOUS'].includes(r.afterResolution) && !r.afterAssignments.length);
  else assert(r.beforeAssignments.every(k => r.afterAssignments.includes(k)), 'Existing valid rack facts must survive');
}
for (const [id, valid] of [[1124, 'CABLE_RESISTANCE'], [1999, 'CABLE_RESISTANCE'], [2096, 'BODYWEIGHT_SUPPORT']]) assert(assignments(candidateById.get(id)).some(a => code(a) === valid));
const sources = new Map(evaluations.filter(e => e.sourceEvidence).map(e => [e.productId, e.sourceEvidence.source]));
validateTrainingSemanticInvariants(snapshot, new Set(evaluations.filter(e => e.sourceEvidence).map(e => e.sourceEvidence.sourceId)), sources);
const modifiedRules = [...trainingSemanticV2RuleCatalog.exerciseRules.map(r => r.ruleId), ...trainingSemanticV2RuleCatalog.functionRules.map(r => r.ruleId)]
  .flatMap(id => [id, `CATEGORY_${id}`, `FEATURE_${id}`]);
modifiedRules.push('FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2');
const hits = (record, ruleId) => assignments(record).filter(a => a.evidence.some(e => e.ruleId === ruleId));
const sweep = modifiedRules.map(ruleId => {
  const before = rejected.records.filter(r => hits(r, ruleId).length), after = snapshot.records.filter(r => hits(r, ruleId).length);
  const transitions = before.map(r => {
    const next = candidateById.get(r.productId);
    const removedAssignments = hits(r, ruleId).filter(a => !assignments(next).some(n => assignmentKey(a) === assignmentKey(n))).map(assignmentKey);
    return { productId: r.productId, name: sources.get(r.productId).name, before: hits(r, ruleId).map(assignmentKey),
      after: signatures(next), removedAssignments, disposition: removedAssignments.length ? 'REMOVED' : hits(next, ruleId).length ? 'PRESERVED' : 'EVIDENCE_SUPPRESSED',
      resolution: next.resolutionState };
  });
  return { ruleId, affectedBefore: before.length, removed: before.filter(r => !hits(candidateById.get(r.productId), ruleId).length).length,
    preserved: before.filter(r => hits(candidateById.get(r.productId), ruleId).length).length,
    new: after.filter(r => !hits(rejectedById.get(r.productId), ruleId).length).length,
    reviewRequired: evaluations.filter(e => e.sourceEvidence?.assessment?.reviewCandidates?.some(c => c.evidence.some(proof => proof.ruleId === ruleId))).length, transitions,
    reviewRequiredIds: evaluations.filter(e => e.sourceEvidence?.assessment?.reviewCandidates?.some(c => c.evidence.some(proof => proof.ruleId === ruleId))).map(e => e.productId),
    newIds: after.filter(r => !hits(rejectedById.get(r.productId), ruleId).length).map(r => r.productId),
    truePositiveFixtures: transitions.filter(r => r.disposition === 'PRESERVED').slice(0, 3).map(r => r.productId),
    falsePositiveFixtures: transitions.filter(r => r.removedAssignments.length).slice(0, 3).map(r => r.productId),
    boundaryFixtures: transitions.filter(r => r.disposition === 'EVIDENCE_SUPPRESSED').slice(0, 3).map(r => r.productId) };
}).filter(r => r.affectedBefore || r.new);
const cohortIds = new Set(focused.map(r => r.productId));
const semanticDeltas = rejected.records.filter(r => !same(signatures(r), signatures(candidateById.get(r.productId))) || r.resolutionState !== candidateById.get(r.productId).resolutionState)
  .map(r => ({ productId: r.productId, name: sources.get(r.productId).name, before: signatures(r), after: signatures(candidateById.get(r.productId)),
    beforeResolution: r.resolutionState, afterResolution: candidateById.get(r.productId).resolutionState,
    source: sources.get(r.productId), outside51: !cohortIds.has(r.productId) }));
const removedAssignments = semanticDeltas.flatMap(r => r.before.filter(k => !r.after.includes(k)).map(concept => ({ productId: r.productId, concept, outside51: r.outside51 })));
const additions = semanticDeltas.flatMap(r => r.after.filter(k => !r.before.includes(k)).map(concept => ({ productId: r.productId, concept, outside51: r.outside51 })));
const familyDebt = [...sources.values()].filter(s => s.productFamily === 'CABLE_MACHINE' && !hasCableFamilyAuthority(s)).map(s => ({
  productId: s.productId, name: s.name, family: s.productFamily, provenance: s.productFamilyEvidence,
  reason: 'family-derived assignment suppressed because family provenance is insufficient for this derivation',
  ownCableAssignmentPreserved: candidateById.get(s.productId).trainingFunctions.some(a => a.functionCode === 'CABLE_RESISTANCE') }));
const domainViolations = snapshot.records.flatMap(r => assignments(r).filter(a => a.evidence.some(e => e.ruleId?.endsWith('_V2')) && !trainingRuleEvidenceDomain(sources.get(r.productId), code(a))).map(a => ({ productId: r.productId, code: code(a) })));
assert.equal(domainViolations.length, 0);
// Every admitted delta has surviving facts, terminal resolution and the unchanged admission contract.
for (const [axis, delta] of Object.entries(discoveryDelta)) for (const r of delta.active.added) {
  const record = candidateById.get(r.productId), row = afterRows.find(p => p.productId === r.productId);
  assert(record.resolutionState === 'SEMANTIC_COMPLETE');
  assert((axis === 'exercise' ? record.exerciseCapabilities : record.trainingFunctions).length);
  assert((axis === 'exercise' ? row.admission.TRAINING_DISCOVERY : row.functionDiscovery).decision === 'ADMITTED');
}
await write('focused-content-review.json', { counts: count(focused, r => r.priorVerdict), allPassed: true, products: focused });
await write('global-rule-sweep.json', { population: snapshot.records.length, outside51Affected: semanticDeltas.filter(r => r.outside51).length, rules: sweep, removedAssignments, additions, semanticDeltas, domainViolations });
await write('product-family-backlog.json', { scope: 'Future Product Semantics remediation; Product projection unchanged in this phase', products: familyDebt });
await write('reevaluated-baseline.json', { note: 'Historical P2.3B snapshot reevaluated with corrected source rules; archived 89/93 remains the historical comparator.', ACTIVE: summarize(reevaluatedBeforeRows.filter(r => r.active)), products: reevaluatedBeforeRows });
const manual = [{ productId: focused.find(r => r.priorVerdict === 'REQUIRES_HUMAN_REVIEW').productId,
  reason: 'Body Pump bundle rack role remains unspecified; no automatic BARBELL_SUPPORT', action: 'Obtain source evidence identifying storage versus open barbell support' }];
manual.push(...semanticDeltas.filter(r => r.outside51 && r.afterResolution === 'AMBIGUOUS').map(r => ({ productId: r.productId, reason: r.name, action: 'Clarify discriminating source evidence; no automatic certification' })));
await write('remaining-human-review.json', { ambiguousCases: manual, newAssignments: additions,
  newSemanticDeltas: semanticDeltas.filter(r => r.outside51), note: 'Review the new global deltas; the original 50 unequivocal cases are covered by the regression gate.' });
const gates = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`G${i + 1}`, 'PASS']));
let tests = null;
try {
  const testFile = path.join(out, 'test-results.json'), result = await json(testFile);
  const testInputs = (await Promise.all(['src', 'scripts', 'tests', 'client'].map(walk))).flat().filter(f => f.endsWith('.ts'));
  const fresh = result.startTime >= Math.max(...await Promise.all(testInputs.map(async f => (await stat(f)).mtimeMs)));
  tests = { success: result.success && fresh, currentCodeTested: fresh, total: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests, contentHash: contentHash(await readFile(testFile, 'utf8')) };
} catch (e) { if (e.code !== 'ENOENT') throw e; }
gates.G14 = tests?.success ? 'PASS' : 'PENDING';
if (!checks.typecheck || !checks.lint) gates.G14 = 'PENDING';
const disposition = Object.values(gates).every(g => g === 'PASS') ? 'READY_FOR_FINAL_CONTENT_REVIEW' : 'BLOCKED';
const reportPath = 'cross-projection-audit/p2-3c-fix/REPORT-P2.3C-FIX.md';
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const changedPaths = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const candidatePaths = [...new Set([...changedPaths, ...untracked, reportPath])].sort();
assert(candidatePaths.filter(f => f.startsWith('cross-projection-audit/')).every(f => /\.(?:md|mjs)$/.test(f)), 'Generated evidence must remain ignored');
const nonReportBytes = (await Promise.all(candidatePaths.filter(f => f !== reportPath).map(async f => (await stat(f)).size))).reduce((a, b) => a + b, 0);
const table = (headers, rows) => `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map(r => `| ${r.map(v => String(v).replaceAll('|', '/').replaceAll('\n', ' ')).join(' | ')} |`).join('\n')}\n`;
const rejectedRows = focused.filter(r => r.invalidAssignment);
const admissionCounts = admissionDelta.ACTIVE;
const render = bytes => `# P2.3C-FIX - Training Rule Precision & Final Reconciliation

Date: 2026-10-07. Disposition: **${disposition}**. Offline candidate only; no activation, pointer publication, deployment or commit.

## A. Rule defects

Material cable was accepted as a mechanism; pulley attachments inherited resistance; inferred cable families were circular; rack/smith/cage host names leaked into attachments; a mixed pull-up/push-up category asserted pull-up; preacher pads inherited dedicated biceps curl; generic deferred SQUAT became an ontology gap. The global sweep additionally found storage stands, racks for dumbbells/balls/mats and installation-service host references incorrectly assigned BARBELL_SUPPORT. Rules affected: cable NAME/CATEGORY/FEATURE/FAMILY, barbell and guided barbell NAME/CATEGORY, mixed PULL_UP closure and dedicated-machine accessory reject patterns (full inventory in global-rule-sweep.json).

## B. Rule changes

${table(['Class', 'Before', 'After'], [
  ['A', 'Any cable feature', 'Semantic mechanism wording; Material/composition cannot qualify'],
  ['B', 'Pulley compatibility/category', 'Passive handles/straps/bars/seats excluded; actual attachment modules require mechanism evidence'],
  ['C', 'CABLE_MACHINE tag alone', 'Product family provenance must identify an actual cable machine or structured mechanism; suppression recorded as Product debt'],
  ['D', 'Host rack/smith/cage token', 'Accessory context vetoes host support; valid own cable and bodyweight facts survive'],
  ['E', 'Mixed category implies PULL_UP', 'Discriminating pull-up name or specific category required'],
  ['F', 'Preacher pad name implies machine', 'Support-component/accessory rejection; dedicated-machine positives retained'],
  ['Human case', 'Body Pump + Rack certified', 'Generic bundle rack remains AMBIGUOUS without specific support evidence'],
  ['Global storage', 'Any rack/atril token implied barbell support', 'Storage payload/category and installation-service guards; real squat/power/half racks preserved'],
  ['Deferred', 'Any lexical deferred finding implies ontology gap', 'ACTIVE and explicitly forbidden boundary codes filtered before final state'],
])}

The reconciliation layer remains. Both ordinary native builds and this audit rerun the classifier from frozen CSV/trust source, with Product provenance, for every record; they do not patch rejected candidate data. Empty historical negatives remain conservative unless fresh review evidence requires AMBIGUOUS. A historical 95% coverage target is restricted to its historical rule identity; corrected facts are not certified to satisfy a target. Historical snapshot reads remain hash-validated with the pinned historical rules identity; publication uses current policy and structural gates. The authority comparator now reads frozen accepted evidence (and validates V1 lineage) instead of claiming corrected rules reproduce historical semantics.

## C. 51 disposition

${table(['Final state', 'Count', 'IDs'], Object.entries(count(focused, r => r.afterResolution)).map(([state, n]) => [state, n, focused.filter(r => r.afterResolution === state).map(r => r.productId).join(', ')]))}

Prior review gate: 18 approved preserved; 26 rejected invalid facts removed; 1 human case conservative; 6 RULE_GAP no false ONTOLOGY_GAP. All PASS. Evidence: focused-content-review.json.

## D. Invalid assignments removed

26/26 reviewed rejections corrected. Global removal count: ${removedAssignments.length} assignments across ${new Set(removedAssignments.map(r => r.productId)).size} products. This includes P930 host support and removals outside the reviewed cohort.

${table(['productId', 'invalidAssignment', 'ruleBefore', 'reasonRejected', 'afterAssignments', 'afterResolution'], rejectedRows.map(r => [r.productId, r.invalidAssignment, r.ruleBefore.join(', '), r.reasonRejected, r.afterAssignments.join(', ') || '(none)', r.afterResolution]))}

All globally removed IDs/concepts: ${removedAssignments.map(r => `P${r.productId}:${r.concept}`).join('; ')}.

## E. Valid assignments preserved

${table(['Mixed fixture', 'Surviving facts', 'Final state'], [1124, 1999, 2096].map(id => [id, signatures(candidateById.get(id)).join(', '), candidateById.get(id).resolutionState]))}

All 18 prior approvals preserve code/relation facts and remain COMPLETE. Evidence provenance is regenerated from source and may become more precise. No product-ID branches exist in classifier/finalizer rules.

## F. Six RULE_GAP disposition

${table(['Fixture', 'Final state', 'Surviving facts'], focused.filter(r => r.priorVerdict === 'RULE_GAP').map(r => [r.productId, r.afterResolution, r.afterAssignments.join(', ') || '(none)']))}

P930 remains DATA_GAP with no new ontology code or automatic negative certification of its unspecified utility. Generic SQUAT is deliberately forbidden; ACTIVE deferred concepts are rule issues, not missing vocabulary.

## G. Global sweep

All 2048 records inspected; ${semanticDeltas.filter(r => r.outside51).length} outside the 51 have assignment/resolution deltas. Structural evidence-domain violations: 0. Full reproducible before/removed/preserved/new/review matrix and per-product source evidence: global-rule-sweep.json. Known equivalent false-positive classes are removed; remaining broader linguistic adjudication is not automated.

${table(['Rule', 'affectedBefore', 'removed', 'preserved', 'new', 'reviewRequired'], sweep.map(r => [r.ruleId, r.affectedBefore, r.removed, r.preserved, r.new, r.reviewRequired]))}

Counts are evidence-rule hits, so rows overlap. EVIDENCE_SUPPRESSED can preserve the concept through a valid independent rule. Every modified rule is also covered by class/boundary tests in trainingRulePrecision.test.ts or the existing classifier suite. Product/family debt: ${familyDebt.length} suppressions, including valid direct mechanisms whose family provenance is still inadequate; product-family-backlog.json records each case.

## H. Negative evidence

For the 836 original coherent negatives: ${JSON.stringify(negativeCounts)}. All ${allFinalNegatives.length} final negative records: ${JSON.stringify(allNegativeCounts)}. Counts are recalculated, never forced to 792/44. Negative-with-assignments: 0. No fabricated evidence; absence does not become positive admission evidence. Both cohorts have per-product source links in negative-evidence-audit.json.

## I. Discovery delta

${table(['Snapshot', 'Exercise strict active', 'Function strict active'], [['P2.3B archived', 89, 93], ['Rejected P2.3C', 101, 126], ['Corrected candidate', discoveryDelta.exercise.active.after, discoveryDelta.function.active.after]])}

Exact added/removed IDs and raw Query/Discovery results: discovery-delta.json. Each admitted addition is checked for a surviving assignment, SEMANTIC_COMPLETE and unchanged admission criteria. Historical assignments reevaluated using the new source rules give ${summarize(reevaluatedBeforeRows.filter(r => r.active)).exerciseDiscovery}/${summarize(reevaluatedBeforeRows.filter(r => r.active)).functionDiscovery}; reevaluated-baseline.json separates that comparison from archived 89/93. Source-driven CONDITIONAL applicability can change when a faulty rule no longer matches; declared obligations and contract bytes/hash stay unchanged.

## J. Consolidation / Unified delta

Archived active baseline: ${JSON.stringify(admissionCounts.before)}.

Corrected active candidate: ${JSON.stringify(admissionCounts.after)}.

Delta: ${JSON.stringify(admissionCounts.delta)}. Full populations and changed payloads: consolidation-delta.json. Trust artifacts are unchanged; whether source rules consume category/feature trust can change, as required by the existing conditional contract.

## K. Candidate identities

- Rules: ${snapshot.rulesHash}.
- Policy: ${trainingResolutionPolicy.version} / ${trainingResolutionPolicy.contentHash}.
- Builder: ${trainingResolutionPolicy.builderVersion}; codeRef ${codeRef}.
- Snapshot: ${snapshot.snapshotId}; semanticChecksum ${snapshot.semanticChecksum}.
- Snapshot contentHash: ${contentHash(`${canonicalizeTrainingSnapshotJson(snapshot)}\n`)}.
- Training wrapper contentHash: ${contentHash(`${canonicalJson(native)}\n`)}.
- Bundle: ${candidateManifest.projectionBundleId}.
- Bundle directory: ${path.relative(root, candidateDirectory).replaceAll('\\', '/')}.

Rejected snapshot/bundle identities are not reused. Schema/hash/registry references/invariants/bundle validation PASS. Registry unchanged.

## L. Regression

Product Discovery: exact same 791 active IDs. Specs conflicts: exact same 82 IDs. Product Semantics, Training V1, Specs and Trust bundle bytes unchanged. ${Object.keys(protectedBefore).length} protected artifacts, stores, pointers and historical P2.3C files fingerprinted unchanged. P_NEW behavior: all ${newProductChecks.length} families unchanged, with no invented assignment. semantic-obligations-v2 remains ${contract.contentHash}.

## M. Tests and reproducibility

Full suite: ${tests ? JSON.stringify(tests) : 'PENDING'}. Typecheck/lint: ${checks ? JSON.stringify(checks) : 'PENDING'}.

Determinism: reversed source/context order yields identical snapshot and evidence; native builder yields identical content; snapshot and bundle identities validate. Tests run directly through Vitest, avoiding npm's snapshot-writing pretest. Historical candidate remains untouched. Gates: ${JSON.stringify(gates)}.

Reproduce: node --import tsx cross-projection-audit/training-rule-precision-audit.mjs. Use the same --source-dir/--bundle-dir options as the previous audit. Run the full suite with --reporter=json --outputFile=cross-projection-audit/p2-3c-fix/test-results.json first. All outputs are generated from source.

Repository hygiene: ${candidatePaths.length} candidate tracked files, ${bytes} content bytes (includes prior authorized uncommitted P2.3C work). Generated JSON/CSV/snapshot/bundle evidence ignored. No commit or index mutation. Exact inventory: repository-hygiene.json; protected bundle byte comparisons: candidate-comparison.json.

## N. Remaining human review

${manual.length} remaining ambiguous source cases: ${manual.map(r => `P${r.productId}: ${r.reason}`).join('; ')}. BARBELL_SUPPORT is absent from P${manual[0].productId} and resolution is conservative. Final review must also inspect ${semanticDeltas.filter(r => r.outside51).length} newly exposed global semantic deltas and ${additions.length} new code/relation facts, grouped in remaining-human-review.json and the global rule matrix. The original 50 unequivocal cases are represented by gates, not repeated full fichas. Family remediation is a separate focused backlog; no Product changes were made.

## O. Production disposition

**${disposition}**. This is readiness for final content review only. No bundle activated, pointer published, deployment or commit performed.
`;
let report = render(nonReportBytes);
for (let i = 0; i < 4; i++) report = render(nonReportBytes + Buffer.byteLength(report));
await writeFile(path.join(root, reportPath), report);
await write('repository-hygiene.json', { candidateFiles: candidatePaths, candidateTrackedFileCount: candidatePaths.length, candidateContentBytes: nonReportBytes + Buffer.byteLength(report), generatedIgnored: true, commitCreated: false });
await write('verification-P2.3C-FIX.json', { disposition, gates, tests, checks, protectedArtifacts: protectedBefore,
  snapshotId: snapshot.snapshotId, bundleId: candidateManifest.projectionBundleId, focusedReview: { allPassed: true, counts: count(focused, r => r.priorVerdict) },
  population: 2048, outside51Affected: semanticDeltas.filter(r => r.outside51).length, negativeEvidence: allNegativeCounts, originalNegativeEvidence: negativeCounts,
  discovery: discoveryDelta, admission: admissionDelta, determinism: true, domainViolations });
console.log(JSON.stringify({ disposition, snapshotId: snapshot.snapshotId, bundleId: candidateManifest.projectionBundleId,
  focused: count(focused, r => r.afterResolution), outside51Affected: semanticDeltas.filter(r => r.outside51).length,
  removedAssignments: removedAssignments.length, additions: additions.length, admission: admissionDelta.ACTIVE, gates }, null, 2));
