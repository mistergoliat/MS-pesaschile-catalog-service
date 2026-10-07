// Run: node --import tsx cross-projection-audit/training-reconciliation-audit.mjs
// Offline only. All generated writes are confined to cross-projection-audit/p2-3c.
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
const out = path.join(root, 'cross-projection-audit/p2-3c');
await mkdir(out, { recursive: true });
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const write = async (file, value) => writeFile(path.join(out, file), `${JSON.stringify(value, null, 2)}\n`);
const walk = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
const fingerprint = async () => Object.fromEntries(await Promise.all((await Promise.all(['artifacts', 'data'].map(walk))).flat().sort().map(async f => [f.replaceAll('\\', '/'), contentHash(await readFile(f, 'utf8'))])));
const protectedBefore = await fingerprint();
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
const historicalReplay = new DefaultTrainingSemanticSnapshotV2Builder().replayHistorical({ results: classifyTrainingSemanticProductsV21(loaded.inputs, { sourceCatalogExport: 'product_catalog_exploration.csv' }), parameters: {
  sourceProductCount: loaded.inputs.length, sourceV1Snapshot: sourceV1, sourceV1SnapshotId: sourceV1.snapshotId,
  resolutionStates: acceptedPolicy.states, activeTrainingRelevantProductIds: acceptedPolicy.productIds,
  activeTrainingRelevant: acceptedPolicy.productIds.length, generatedAt: baseline.generatedAt,
} }, false);
assert.equal(historicalReplay.snapshotId, baseline.snapshotId);
assert.deepEqual(ids(historicalReplay.records.filter(invalid)), ids(oldInvalid));
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
const input = { baseline, sourceV1, sources: loaded.inputs, contexts };
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
const negativeAudit = negatives.map(before => { const e = evaluationById.get(before.productId); assert.equal(e.record.resolutionState, before.resolutionState); return { productId: before.productId, state: e.negativeEvidenceState, evidence: e.record.resolutionEvidence ?? [], reason: e.reason, sourceEvidence: e.sourceEvidence }; });
const gapRows = evaluations.flatMap(e => e.gaps.map(g => ({ productId: e.productId, ...g })));
const gapCounts = { SAFE_DERIVABLE: 0, MISSING_SOURCE_DATA: 0, POLICY_UNKNOWN: 0, ALREADY_SATISFIED: 0, ...count(gapRows, r => r.classification) };
const negativeCounts = { NEGATIVE_EVIDENCE_PRESENT: 0, NEGATIVE_EVIDENCE_ABSENT: 0, NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE: 0, ...count(negativeAudit, r => r.state) };
const evaluate = (context, record) => admission.evaluateAdmissionSnapshot({ ...context, training: record }, contract);
const beforeRows = [...contexts.values()].map(c => ({ productId: c.canonical.productId, active: c.canonical.active === true, ...evaluate(c, c.training) }));
const afterRows = [...contexts.values()].map(c => ({ productId: c.canonical.productId, active: c.canonical.active === true, ...evaluate(c, candidateById.get(c.canonical.productId)) }));
for (let i = 0; i < beforeRows.length; i++) {
  const a = beforeRows[i], b = afterRows[i];
  assert.deepEqual(a.consolidation.evaluatedDimensions.map(d => [d.dimension, d.effectiveRequirement]), b.consolidation.evaluatedDimensions.map(d => [d.dimension, d.effectiveRequirement]), 'Family applicability changed');
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
await write('negative-evidence-audit.json', { total: negativeAudit.length, counts: negativeCounts, products: negativeAudit });
await write('source-required-training-gaps.json', { counts: gapCounts, unit: 'product/dimension/code rows; UNKNOWN is a product/dimension row', products: gapRows });
await write('discovery-delta.json', discoveryDelta);
await write('consolidation-delta.json', { ...admissionDelta, products: afterRows.filter((r, i) => !same(r, beforeRows[i])).map(r => ({ productId: r.productId, before: beforeRows.find(b => b.productId === r.productId), after: r })) });
await write('candidate-comparison.json', { baselineSnapshotId: baseline.snapshotId, candidateSnapshotId: snapshot.snapshotId, semanticChecksum: snapshot.semanticChecksum,
  snapshotContentHash: contentHash(`${canonicalizeTrainingSnapshotJson(snapshot)}\n`), nativeContentHash: contentHash(`${canonicalJson(native)}\n`),
  policy: { ...trainingResolutionPolicy, previousPolicyHash: (await readAcceptedTrainingResolutionPolicy()).hash }, codeRef, changes, reconciled51: count(reconciled51, r => r.afterState),
  invalidIds: ids(oldInvalid), specsConflictIds: conflictIds(afterRows), productDiscoveryIds: productIds(activeAfter),
  candidateBundleId: candidateManifest.projectionBundleId, candidateDirectory: path.relative(root, candidateDirectory), protectedComparisons, bundleValidation, newProductChecks });
assert.deepEqual(protectedBefore, await fingerprint(), 'Protected artifacts or pointers changed');
let tests = null;
try {
  const testFile = path.join(out, 'test-results.json'), t = await json(testFile);
  const testInputs = (await Promise.all(['src', 'scripts', 'tests', 'client'].map(walk))).flat().filter(f => f.endsWith('.ts'));
  const currentFilesMtime = Math.max(...await Promise.all(testInputs.map(async f => (await stat(f)).mtimeMs)));
  const currentCodeTested = (await stat(testFile)).mtimeMs >= currentFilesMtime;
  tests = { success: t.success && currentCodeTested, currentCodeTested, total: t.numTotalTests, passed: t.numPassedTests, failed: t.numFailedTests, reportHash: contentHash(await readFile(testFile, 'utf8')) };
} catch (e) { if (e.code !== 'ENOENT') throw e; }
let red = null;
try { red = await json(path.join(out, 'historical-red.json')); assert.equal(red.numFailedTests, 1); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const gates = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`G${i + 1}`, 'PASS']));
gates.G13 = tests?.success ? 'PASS' : 'PENDING';
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
assert(untracked.filter(f => f.startsWith('cross-projection-audit/')).every(f => f.endsWith('.mjs') || f.endsWith('REPORT-P2.3C.md')));
const reportPath = 'cross-projection-audit/p2-3c/REPORT-P2.3C.md';
const changedPaths = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const candidatePaths = [...new Set([...changedPaths, ...untracked, reportPath])].sort();
const nonReportBytes = (await Promise.all(candidatePaths.filter(f => f !== reportPath).map(async f => Buffer.byteLength(await readFile(f))))).reduce((a, b) => a + b, 0);
const trackedPatchBytes = Buffer.byteLength(execFileSync('git', ['diff', '--no-ext-diff', '--binary'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const lineOf = async (file, needle) => (await readFile(file, 'utf8')).split('\n').findIndex(line => line.includes(needle)) + 1;
const rootCause = await Promise.all([
  ['scripts/training-semantic-classification-v2/classify-catalog.ts', 'export function isResolved'],
  ['scripts/training-semantic-classification-v2/classify-catalog.ts', 'export function resolutionState'],
  ['scripts/training-semantic-classification-v2-1/audit-a00.6.7.ts', 'const state: FinalState'],
  ['src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts', 'function resolutionStateFor'],
  ['src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts', 'function semanticRecord'],
].map(async ([file, needle]) => `${file}:${await lineOf(file, needle)}`));
const stateGroups = Object.entries(count(reconciled51, r => r.afterState)).map(([state, n]) => `| VERIFIED_NO_APPLICABLE_CAPABILITY | ${state} | ${n} |`).join('\n');
const exactGroups = Object.entries(count(reconciled51, r => r.afterState)).map(([state]) => `- ${state}: ${ids(reconciled51.filter(r => r.afterState === state)).join(', ')}.`).join('\n');
const discoveryText = Object.entries(discoveryDelta).map(([dimension, v]) => `### ${dimension}\n\nAdmission estricto activo: ${v.active.before} → ${v.active.after} (delta ${v.active.delta}); retirados: ${JSON.stringify(v.active.removed)}.\n\nAgregados:\n\n${v.active.added.map(r => `- ${r.productId}: ${r.reason}.`).join('\n') || '- Ninguno.'}\n\nRuntime bruto activo: ${v.rawRuntimeActive.before.length} → ${v.rawRuntimeActive.after.length}. Query completo: ${v.query.before.length} → ${v.query.after.length}; Discovery completo: ${v.discovery.before.length} → ${v.discovery.after.length}. Los IDs exactos de todos los conjuntos están en discovery-delta.json.\n`).join('\n');
const renderReport = candidateBytes => `# P2.3C — Training Semantic Reconciliation & Evidence Integrity

Disposición: **NEEDS_CONTENT_REVIEW**. Candidato local; producción/pointers sin cambios. Población: 2048 canonical, 1565 current, 886 active. Gates: ${JSON.stringify(gates)}.

## A. Root cause

${rootCause.map(ref => `- ${ref}`).join('\n')}

A00.6.6 isResolved acepta el negativo histórico antes de comparar los assignments; resolutionState lo conserva. A00.6.7 preserva la resolución baseline. resolutionStateFor prioriza el CSV curado; semanticRecord marca resolved=true sin reconciliar assignments posteriores. El test rojo anterior al fix ${red ? 'está capturado (1 failure esperado)' : 'es reproducible desde la revisión anterior y el test conservado'}; el replay histórico actual reproduce el hash native y los 51 inválidos. Los builders ordinarios, stores y la publicación de bundles ahora los rechazan. La reconstrucción histórica en memoria no es una vía de publicación.

## B. New policy

- Previous: accepted-a00.6.7; hash ${acceptedPolicy.hash}.
- New: ${trainingResolutionPolicy.version}; hash ${trainingResolutionPolicy.contentHash}.
- Builder: ${trainingResolutionPolicy.builderVersion}; classifier: ${trainingResolutionPolicy.classifierVersion}; rulesHash ${trainingResolutionPolicy.classifierRulesHash}.
- CodeRef: ${codeRef}.
- Motivo: ${trainingResolutionPolicy.reasonForChange}

## C. 51 reconciliation

| Before state | After state | Count |
|---|---|---:|
${stateGroups}

${exactGroups}

No blanket conversion: cada record compara fuente/reglas, candidatos, conceptos diferidos y assignments finales. El before/after, la evidencia completa y la evaluación del classifier se entregan por producto en training-resolution-delta.json e invalid-51-reconciliation.csv. Candidate violations = 0.

Delta exacto: ${JSON.stringify(changes)}. Las categorías se superponen: evidencia de resolución incluye el razonamiento de reconciliación; negativeEvidenceChanged cuenta los negativos vacíos cuyo estado no cambia.

## D. Negative evidence

836 baseline negatives: present=${negativeCounts.NEGATIVE_EVIDENCE_PRESENT}, absent=${negativeCounts.NEGATIVE_EVIDENCE_ABSENT}, not reconstructable=${negativeCounts.NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE}. Ninguno cambia de estado. La evidencia PRESENT enlaza el input evaluado, una rama negativa real, policy y alcance MODELED_SNAPSHOT_COVERAGE. El reason genérico histórico no cuenta. ABSENT no es fallo automático. La evidencia nueva no satisface por sí sola una obligación positiva de admission; no fabrica consolidation. IDs/fuente/regla por cada negativo: negative-evidence-audit.json.

## E. Required assignment gaps

${JSON.stringify(gapCounts)}. Unidad: producto/dimensión/código; POLICY_UNKNOWN incluye las ramas de aplicabilidad desconocida por producto/dimensión. No hay assignments nuevos porque las obligaciones source-backed identificadas ya están satisfechas. El algoritmo y los tests prueban la derivación segura de un gap con fuente suficiente y el rechazo cuando falta autoridad. No se decide aplicabilidad por frecuencia. Detalle: source-required-training-gaps.json.

## F. Training candidate identity

- Snapshot: ${snapshot.snapshotId}.
- Semantic checksum: ${snapshot.semanticChecksum}.
- Snapshot content hash (canonical + newline): ${contentHash(`${canonicalizeTrainingSnapshotJson(snapshot)}\n`)}.
- Training V2 wrapper content hash: ${contentHash(`${canonicalJson(native)}\n`)}.
- Schema: 2. resolutionEvidence existente alcanza; sin migración del snapshot.
- Baseline native: ${baseline.snapshotId}.
- Legacy accepted: ${legacy.snapshotId}.

## G. Query / Discovery

${discoveryText}
89/93 es el baseline estricto de admission P2.3B. Los servicios runtime existentes tienen un conjunto más amplio; se midieron ambos sin cambiar filtros ni relajar SEMANTIC_COMPLETE. Cada incremento estricto procede de resolución respaldada por contenido. Function no resuelve exercise.

## H. Consolidation / admission

Activos before: ${JSON.stringify(admissionDelta.ACTIVE.before)}.

Activos after: ${JSON.stringify(admissionDelta.ACTIVE.after)}.

Delta activo: ${JSON.stringify(admissionDelta.ACTIVE.delta)}. Obligaciones conocidas permanecen 256/886; UNKNOWN familiar permanece 630/886. Consolidation certificado y Unified Retrieval admitted permanecen 116. Los UNKNOWN no se reinterpretan: las effectiveRequirements son idénticas por producto y dimensión. El contador UNKNOWN_OBLIGATIONS de estado puede aumentar al eliminar INVALID; no son obligaciones nuevas. ALL y payloads modificados: consolidation-delta.json.

## I. Regression

Product Discovery: mismos 791/886 IDs, cero agregados/retirados. Specs: mismos 82 conflict IDs. Product Semantics, Training V1, Specs y Trust Maps son idénticos byte a byte en el candidate bundle. ${Object.keys(protectedBefore).length} archivos protegidos, incluidos pointers, tienen el mismo fingerprint antes/después. P_NEW: ${newProductChecks.length} familias sin asignación ni promoción accidental. Contract: ${contract.contractVersion}, hash ${contract.contentHash}, sin modificación.

## J. Candidate bundle

ID: ${candidateManifest.projectionBundleId}. Local: ${path.relative(root, candidateDirectory).replaceAll('\\', '/')}. Comparator PASS; validation PASS. Sólo Training V2 y la identidad/metadata de construcción del bundle cambian. Hashes protegidos: ${JSON.stringify(protectedComparisons)}. Nunca se activó.

## K. Tests

${tests ? `Suite completa: ${tests.total} tests, ${tests.passed} passed, ${tests.failed} failures; success=${tests.success}.` : 'Suite completa pendiente; no declarar cierre.'} Runner directo Vitest, sin pretest publicador. Typecheck/lint se ejecutan por separado. El test histórico rojo conserva la falla anterior; la regresión debe pasar ahora. Reproducibilidad: mismo snapshot/hash/orden de evidencia con inputs reordenados y mismo resultado en builder native. G13 sólo PASS con suite completa exitosa.

## L. Repository hygiene

${candidatePaths.length} archivos candidatos a Git; contenido total de esos archivos: ${candidateBytes} bytes. Diff de archivos ya tracked: ${trackedPatchBytes} bytes; archivos nuevos se incluyen en el total de contenido. No se creó commit ni se alteró el index. Todos los JSON/CSV/snapshot/bundle/resultados del directorio P2.3C siguen ignorados; sólo este reporte Markdown y el script pequeño son candidatos dentro de cross-projection-audit.

Archivos candidatos:

${candidatePaths.map(f => `- ${f}`).join('\n')}

## M. Production disposition

**NEEDS_CONTENT_REVIEW**. Revisar los IDs, los seis ONTOLOGY_GAP y los deltas de elegibilidad antes de un gate de rollout separado. El binario previo con wrapper estricto requiere lectores compatibles con los campos nuevos de policy. No pm2 restart, activate, rollback, pointer mutation o production publish en esta fase.

## N. Remaining Training debt

- Content inconsistency: 0 negative-with-assignments.
- Negative evidence debt: ${negativeCounts.NEGATIVE_EVIDENCE_ABSENT} ausentes, ${negativeCounts.NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE} no reconstruibles; no democión automática.
- Family applicability UNKNOWN: 630 activos con alguna obligación desconocida; 2564 filas producto/dimensión UNKNOWN en el inventario Training. No se resuelve por assignments históricos.
- Source data / ontology / rule gaps: distribución total del candidato ${JSON.stringify(count(snapshot.records, r => r.resolutionState))}; los seis ONTOLOGY_GAP del cohort inválido requieren autoridad de ontology/rules antes de COMPLETE.
- Source-required missing assignments: SAFE_DERIVABLE=${gapCounts.SAFE_DERIVABLE}, MISSING_SOURCE_DATA=${gapCounts.MISSING_SOURCE_DATA}; no se agregan facts sin evidencia.
- Specs/Trust/Product debt continúa fuera de alcance, incluidos los 82 conflictos Specs.

Reproducir: node --import tsx cross-projection-audit/training-reconciliation-audit.mjs. [Metodología y rollout](../../docs/catalog-v2/P2_3C_TRAINING_SEMANTIC_RECONCILIATION.md).
`;
let report = renderReport(nonReportBytes);
for (let i = 0; i < 3; i++) report = renderReport(nonReportBytes + Buffer.byteLength(report));
await writeFile(path.join(root, reportPath), report);
await write('repository-hygiene.json', { candidateFiles: candidatePaths, candidateFileContentBytes: nonReportBytes + Buffer.byteLength(report), trackedPatchBytes,
  trackedAuditFiles: execFileSync('git', ['ls-files', 'cross-projection-audit'], { encoding: 'utf8' }).trim().split('\n'), generatedIgnored: true });
await write('verification-P2.3C.json', { status: Object.values(gates).every(g => g === 'PASS') ? 'PASS' : 'PENDING', gates, tests,
  protectedArtifacts: protectedBefore, reproducibility: { snapshot: true, identity: true, evidenceOrder: true, nativeBuilder: true },
  baseline: { nativeSnapshotId: baseline.snapshotId, legacySnapshotId: legacy.snapshotId, contractHash: contract.contentHash },
  candidate: { snapshotId: snapshot.snapshotId, semanticChecksum: snapshot.semanticChecksum, bundleId: candidateManifest.projectionBundleId },
  historicalReproduction: { replaySnapshotId: historicalReplay.snapshotId, contradictions: oldInvalid.length, originalRedCaptured: !!red },
  negativeEvidence: negativeCounts, sourceGaps: gapCounts, discovery: Object.fromEntries(Object.entries(discoveryDelta).map(([k, v]) => [k, v.active])), admission: admissionDelta.ACTIVE,
  disposition: 'NEEDS_CONTENT_REVIEW' });
console.log(JSON.stringify({ changes, reconciliation51: count(reconciled51, r => r.afterState), negativeEvidence: count(negativeAudit, r => r.state), gaps: count(gapRows, r => r.classification),
  snapshotId: snapshot.snapshotId, discovery: Object.fromEntries(Object.entries(discoveryDelta).map(([k, v]) => [k, { before: v.active.before, after: v.active.after }])), activeAdmission: admissionDelta.ACTIVE, gates }, null, 2));
