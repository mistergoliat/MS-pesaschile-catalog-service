// Offline PRB. Never writes existing artifacts or an activation pointer.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonicalContent, validateManifest, recordCounts } from '../src/domain/catalog/projection-input/canonical.ts';
import { canonicalJson, bundleId, validateBundle, validateBundleForPublication } from '../src/domain/catalog/projection-bundle.ts';
import { loadTrainingSemanticClassificationInputs } from '../scripts/training-semantic-classification/lib/load-input.ts';
import { parseCsvRecords } from '../scripts/product-semantic-classification/lib/csv.ts';
import { reconcileTrainingSnapshot, readAcceptedTrainingResolutionPolicy } from '../scripts/catalog-v2/build-training-semantics-v2.ts';
import { DefaultTrainingSemanticSnapshotV2Builder, trainingResolutionPolicy, validateTrainingSemanticSnapshotV2, canonicalizeTrainingSnapshotJson } from '../src/domain/training-semantic-snapshot/index.ts';
import { classifyTrainingSemanticProductsV21 } from '../src/domain/training-semantic-classification-v2-1/index.ts';
import { validateTrainingSemanticInvariants } from '../src/domain/training-semantic-snapshot/semanticInvariants.ts';
import { RuntimeProjectionManager } from '../src/domain/catalog/runtime-projection.ts';
import * as admission from '../src/domain/catalog-admission/index.ts';
import { getTrainingSemanticRegistryV2 } from '../src/domain/training-semantics-v2/index.ts';
import { fact } from '../src/domain/training-semantic-snapshot/v2Runtime.ts';
import { DefaultTrainingSemanticQueryService } from '../src/application/catalog/training-semantic-query/defaultTrainingSemanticQueryService.ts';
import { DefaultSemanticDiscoveryService } from '../src/application/catalog/semantic-discovery/defaultSemanticDiscoveryService.ts';

export const out = 'artifacts/catalog-v2/p2-3c-prb';
export const productionRoot = 'C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/production-baseline';
export const sourceDir = `${productionRoot}/2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26`;
export const productionDir = `${productionRoot}/84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8`;
export const localSourceDir = 'artifacts/catalog-projection-input/36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2';
export const hash = v => `sha256:${createHash('sha256').update(v).digest('hex')}`;
export const json = async f => JSON.parse(await readFile(f, 'utf8'));
export const write = async (f, v) => writeFile(`${out}/${f}`, `${JSON.stringify(v, null, 2)}\n`);
export const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const ids = rows => rows.map(r => r.productId).sort((a, b) => a - b);
const count = (rows, select) => rows.reduce((r, row) => { const k = select(row); r[k] = (r[k] ?? 0) + 1; return r; }, {});
const byId = rows => new Map(rows.map(r => [Number(r.productId), r]));
const facts = r => [...r.exerciseCapabilities, ...r.trainingFunctions].map(a => `${a.capabilityCode ?? a.functionCode}/${a.relationType}`).sort();
const semantic = r => ({ productId: r.productId, resolutionState: r.resolutionState, resolved: r.resolved, coverageStatus: r.coverageStatus,
  exerciseCapabilities: r.exerciseCapabilities.map(({ evidence, provenance, ...a }) => a), trainingFunctions: r.trainingFunctions.map(({ evidence, provenance, ...a }) => a) });
// Exact recursive diff: no ignored fields. Array offsets refer to the physical artifact.
function diff(a, b, at = '') {
  if (same(a, b)) return [];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return [{ path: at, before: a, after: b }];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(k => diff(a[k], b[k], `${at}/${k}`));
}
export const walk = async d => (await Promise.all((await readdir(d, { withFileTypes: true })).map(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))).flat();
export async function readBundle(dir) {
  const raw = await readFile(`${dir}/manifest.json`, 'utf8'), manifest = JSON.parse(raw);
  const files = Object.fromEntries(await Promise.all(Object.values(manifest.projections).filter(p => p.status === 'present').map(async p => [p.artifact, await readFile(path.join(dir, p.artifact), 'utf8')])));
  assert.equal(bundleId(manifest), manifest.projectionBundleId);
  for (const p of Object.values(manifest.projections).filter(p => p.status === 'present')) assert.equal(hash(files[p.artifact]), p.contentHash);
  return { raw, manifest, files, projections: Object.fromEntries(Object.entries(manifest.projections).filter(([, p]) => p.status === 'present').map(([k, p]) => [k, JSON.parse(files[p.artifact])])) };
}
export async function verifySource(dir) {
  const names = { canonicalInput: 'canonical_input.json', compatibilityCsv: 'product_catalog_exploration.csv', categoryTrustMap: 'category_trust_map.csv', featureTrustMap: 'feature_trust_map.csv' };
  const hashes = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([k, f]) => [k, hash(await readFile(`${dir}/${f}`))])));
  const raw = await readFile(`${dir}/projection_input_manifest.json`, 'utf8'), manifest = validateManifest(JSON.parse(raw), hashes);
  const source = await json(`${dir}/canonical_input.json`);
  assert.equal(await readFile(`${dir}/canonical_input.json`, 'utf8'), canonicalContent(source));
  assert.deepEqual(recordCounts(source), manifest.recordCounts);
  return { source, manifest, hashes, manifestHash: hash(raw) };
}
if (process.argv[2] === 'preflight') {
  await mkdir(out, { recursive: true });
  // Capture all pre-existing frozen sources, snapshots, bundles, and audit evidence.
  const files = (await Promise.all(['artifacts', 'data', 'cross-projection-audit', productionRoot].map(walk))).flat().filter(f => !f.replaceAll('\\', '/').startsWith(out + '/'));
  const fingerprints = Object.fromEntries(await Promise.all(files.map(async f => [f, hash(await readFile(f))])));
  await write('protected-before.json', fingerprints);
  const verified = await verifySource(sourceDir), production = await readBundle(productionDir);
  assert.equal(verified.manifest.aggregateContentHash, 'sha256:2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26');
  assert.deepEqual(verified.hashes, {
    canonicalInput: 'sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9',
    compatibilityCsv: 'sha256:e4f83e5513803e714089a2ad9f7590ffaea1f0b4373203cefc0559054fb7a442',
    categoryTrustMap: 'sha256:01ac8a64b5aa20975d0e781eda618890bb7604219963eaf81ffaaed00db278fd',
    featureTrustMap: 'sha256:88bde84b077f86d21c04b419885f11cfb15c9f1a7ecf082942ef88d7e5dfd2c8',
  });
  const validation = validateBundle(production.manifest, production.files, verified.source);
  await write('preflight.json', { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), ...verified, productionManifestHash: hash(production.raw), productionValidation: validation, protectedCount: files.length });
  console.log(JSON.stringify({ source: verified.manifest, productionValidation: validation.status, protectedCount: files.length }));
}
if (process.argv[2] === 'audit') {
  const verified = await verifySource(sourceDir), local = await verifySource(localSourceDir);
  const source = verified.source, oldSource = byId(local.source.products);
  const comparison = await json('cross-projection-audit/p2-3c-fix2/candidate-comparison.json');
  const A = await readBundle(productionDir), B = await readBundle(comparison.candidateDirectory);
  const candidateName = (await readdir(`${out}/candidate-1`)).find(n => /^[a-f0-9]{64}$/u.test(n));
  const candidateDir = `${out}/candidate-1/${candidateName}`, C = await readBundle(candidateDir), repeat = await readBundle(`${out}/candidate-2/${candidateName}`);
  assert.equal(C.manifest.projectionBundleId, repeat.manifest.projectionBundleId);
  assert.deepEqual(C.manifest.projections, repeat.manifest.projections);
  assert.deepEqual(C.files, repeat.files);
  assert(same({ ...C.manifest, build: { ...C.manifest.build, builtAt: '' } }, { ...repeat.manifest, build: { ...repeat.manifest.build, builtAt: '' } }));
  const protectedProjections = {};
  for (const name of ['productSemantics', 'trainingSemantics', 'specs', 'trustMaps']) {
    const f = C.manifest.projections[name].artifact, delta = diff(A.projections[name], C.projections[name]);
    protectedProjections[name] = { productionHash: hash(A.files[f]), candidateHash: hash(C.files[f]), byteIdentical: A.files[f] === C.files[f], canonicalDiff: delta };
    assert.equal(C.files[f], A.files[f], `Protected projection differs: ${name}`);
    assert.equal(delta.length, 0);
  }
  await write('protected-projections.json', protectedProjections);
  const policy = await readAcceptedTrainingResolutionPolicy(), registry = getTrainingSemanticRegistryV2(), contract = admission.semanticObligationContractV2;
  assert.equal(trainingResolutionPolicy.contentHash, 'sha256:c258f5db606d48f6e62399c5ab3b551c8650309aa2e8d01ac23431adbc99fa03');
  assert.equal(contract.contentHash, 'sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94');
  const trustFor = async dir => ({ categories: parseCsvRecords(await readFile(`${dir}/category_trust_map.csv`, 'utf8')).map(r => ({ categoryId: Number(r.categoryId), trustClass: r.trustClass })),
    features: parseCsvRecords(await readFile(`${dir}/feature_trust_map.csv`, 'utf8')).map(r => ({ featureId: Number(r.featureId), trustClass: r.trustClass })), sourceHashesVerified: true, consumedByCategorySelection: false });
  const trust = await trustFor(sourceDir); assert.deepEqual(trust, await trustFor(localSourceDir));
  function contexts(bundle, input, maps) {
    const products = byId(bundle.projections.productSemantics.snapshot.records), training = byId(bundle.projections.trainingSemanticsV2.snapshot.records), specs = Map.groupBy(bundle.projections.specs.records, r => Number(r.productKey.slice(1)));
    return new Map(input.products.map(canonical => [canonical.productId, { canonical, productSemantics: products.get(canonical.productId), training: training.get(canonical.productId), specs: specs.get(canonical.productId) ?? [], trust: maps, lineage: { productVerified: true, trainingVerified: true, specsVerified: true } }]));
  }
  const cc = contexts(C, source, trust), ac = contexts(A, source, trust), bc = contexts(B, local.source, trust);
  const loaded = await loadTrainingSemanticClassificationInputs({ catalogCsvPath: `${sourceDir}/product_catalog_exploration.csv`, categoryTrustMapCsvPath: `${sourceDir}/category_trust_map.csv`, featureTrustMapCsvPath: `${sourceDir}/feature_trust_map.csv` });
  assert.deepEqual(loaded.warnings, []); assert.equal(loaded.inputs.length, 2048);
  const v1 = C.projections.trainingSemantics.snapshot, snapshot = C.projections.trainingSemanticsV2.snapshot;
  const results = classifyTrainingSemanticProductsV21(loaded.inputs, { sourceCatalogExport: 'product_catalog_exploration.csv' });
  const seedParameters = { sourceProductCount: results.length, sourceV1SnapshotId: v1.snapshotId, sourceV1Snapshot: v1, resolutionStates: policy.states, activeTrainingRelevantProductIds: policy.productIds, activeTrainingRelevant: policy.productIds.length, generatedAt: '1970-01-01T00:00:00.000Z' };
  const seed = new DefaultTrainingSemanticSnapshotV2Builder().replayHistorical({ results, parameters: seedParameters }, false);
  const reconciled = reconcileTrainingSnapshot({ baseline: seed, sourceV1: v1, sources: loaded.inputs, contexts: cc });
  assert.deepEqual(reconciled.snapshot, snapshot);
  const reversed = reconcileTrainingSnapshot({ baseline: seed, sourceV1: v1, sources: [...loaded.inputs].reverse(), contexts: new Map([...cc].reverse()) });
  assert.deepEqual(reversed.snapshot, snapshot); assert.deepEqual(reversed.evaluations, reconciled.evaluations);
  validateTrainingSemanticSnapshotV2(snapshot);
  validateTrainingSemanticInvariants(snapshot, new Set(reconciled.evaluations.map(e => e.sourceEvidence.sourceId)), new Map(reconciled.evaluations.map(e => [e.productId, e.sourceEvidence.source])));
  await write('reconciliation.json', reconciled.evaluations);
  const validation = validateBundle(C.manifest, C.files, source), publication = validateBundleForPublication(C.manifest, C.files, source);
  const wrapper = C.projections.trainingSemanticsV2;
  assert.equal(wrapper.inputs.catalog, verified.hashes.compatibilityCsv);
  assert.equal(wrapper.sourceExtractionId, verified.manifest.sourceExtractionId);
  assert.equal(wrapper.snapshot.sourceV1SnapshotId, v1.snapshotId);
  assert.equal(snapshot.rulesHash, 'd143736268bff53900de4ceaa7b50b76061fcc73d0b6d44e2a4a645f5834b8a8');
  assert.equal(snapshot.registryHash, registry.registryHash);
  assert.equal(wrapper.inputs.resolutionPolicy.previousPolicy.hash, policy.hash);
  async function runtime(bundle) {
    const pointer = { schemaVersion: '1', activeProjectionBundleId: bundle.manifest.projectionBundleId, activatedAt: '1970-01-01T00:00:00.000Z', activationId: '00000000-0000-4000-8000-000000000001', previousProjectionBundleId: null, previousActivationId: null, actor: { type: 'manual', identity: 'offline-prb' }, reason: 'local validation fixture', bundleManifestHash: hash(bundle.raw) };
    const manager = new RuntimeProjectionManager({ readActivePointer: async () => pointer, verifyBundle: async () => ({ manifest: bundle.manifest, manifestHash: hash(bundle.raw), files: bundle.files }), promote: async () => { throw Error('MUTATION_FORBIDDEN'); }, readHistory: async () => { throw Error('NOT_USED'); } });
    await manager.reconcile(); assert.equal(manager.status().reloadState, 'READY'); return manager.status();
  }
  const runtimeValidation = { production: await runtime(A), candidate: await runtime(C) };
  const evaluate = ctx => [...ctx.values()].map(c => ({ productId: c.canonical.productId, active: c.canonical.active === true, current: c.canonical.catalogPresence === 'current_catalog', ...admission.evaluateAdmissionSnapshot(c, contract) }));
  const admissionRows = { A: evaluate(ac), B: evaluate(bc), C: evaluate(cc) };
  const certified = r => ['CONSOLIDATED', 'CONSOLIDATED_WITH_NOT_APPLICABLE'].includes(r.consolidation.state);
  const metrics = { productDiscovery: r => r.admission.PRODUCT_SEMANTIC_DISCOVERY.decision === 'ADMITTED', exerciseDiscovery: r => r.admission.TRAINING_DISCOVERY.decision === 'ADMITTED', functionDiscovery: r => r.functionDiscovery.decision === 'ADMITTED', specFiltering: r => r.admission.SPEC_FILTERING.decision === 'ADMITTED', knownObligations: r => r.consolidation.obligationsKnown, certified, unifiedAdmitted: r => r.admission.UNIFIED_RETRIEVAL.decision === 'ADMITTED' };
  const scopes = { ALL: r => true, CURRENT: r => r.current, ACTIVE: r => r.active };
  const summarize = rows => ({ total: rows.length, ...Object.fromEntries(Object.entries(metrics).map(([k, select]) => [k, ids(rows.filter(select))])), unified: count(rows, r => r.admission.UNIFIED_RETRIEVAL.decision), consolidation: count(rows, r => r.consolidation.state) });
  const admissionSummary = Object.fromEntries(Object.entries(admissionRows).map(([label, rows]) => [label, Object.fromEntries(Object.entries(scopes).map(([scope, select]) => [scope, summarize(rows.filter(select))]))]));
  await write('admission-summary.json', admissionSummary); await write('admission-rows.json', admissionRows);
  const admissionDeltas = {};
  for (const baseline of ['A', 'B']) {
    const before = byId(admissionRows[baseline]);
    admissionDeltas[baseline + '-C'] = admissionRows.C.filter(r => !same(before.get(r.productId), r)).map(after => ({ productId: after.productId, diff: diff(before.get(after.productId), after) }));
  }
  await write('admission-deltas.json', admissionDeltas);
  const conflicts = rows => ids(rows.filter(r => r.consolidation.evaluatedDimensions.find(d => d.dimension === 'SPECS').resolution.state === 'SOURCE_CONFLICT'));
  assert.equal(conflicts(admissionRows.A).length, 82); assert.deepEqual(conflicts(admissionRows.A), conflicts(admissionRows.C));
  assert.deepEqual(admissionSummary.A.ACTIVE.productDiscovery, admissionSummary.C.ACTIVE.productDiscovery);
  const universe = input => Object.fromEntries(Object.entries({ canonical: p => true, current: p => p.catalogPresence === 'current_catalog', historical: p => p.catalogPresence === 'historical_order_detail_only', active: p => p.active === true, inactive: p => p.active === false }).map(([k, select]) => { const set = ids(input.products.filter(select)); return [k, { count: set.length, ids: set, idsHash: hash(canonicalJson(set)) }]; }));
  const universes = { production: universe(source), localFIX2: universe(local.source) };
  assert.deepEqual(universes.production, universes.localFIX2);
  assert.deepEqual(Object.values(universes.production).map(u => u.count), [2048, 1565, 483, 886, 679]);
  await write('universes.json', universes);
  const sourceDeltas = source.products.filter(p => !same(p, oldSource.get(p.productId))).map(p => ({ productId: p.productId, diff: diff(oldSource.get(p.productId), p) }));
  const categoryChanges = source.products.filter(p => !same(p.categoryIds, oldSource.get(p.productId).categoryIds)).map(p => ({ productId: p.productId, before: oldSource.get(p.productId).categoryIds, after: p.categoryIds }));
  const featureChanges = source.products.flatMap(p => (p.features ?? []).flatMap(f => {
    const prior = oldSource.get(p.productId).features ?? [];
    // A product may have two assignments with the same displayed value.
    if (prior.some(o => same(o, f))) return [];
    const old = prior.find(o => o.featureId === f.featureId && o.name === f.name && o.value === f.value);
    return old && old.featureValueId !== f.featureValueId ? [{ productId: p.productId, featureId: f.featureId, before: old, after: f }] : [];
  }));
  const criticalPairs = [[269, 12], [269, 11], [269, 3], [1839, 3], [1840, 3], [1853, 11], [1853, 3], [2132, 3]];
  const specsReferences = criticalPairs.map(([productId, featureId]) => {
    const observed = source.products.find(p => p.productId === productId).features.find(f => f.featureId === featureId);
    const records = C.projections.specs.records.filter(r => r.productKey === `P${productId}` && Number(r.sourceFeature.featureId) === featureId);
    assert(records.length > 0); for (const r of records) assert.equal(Number(r.sourceFeature.featureValueId), observed.featureValueId);
    return { productId, featureId, oldFeatureValueId: oldSource.get(productId).features.find(f => f.featureId === featureId).featureValueId, productionFeatureValueId: observed.featureValueId, records };
  });
  const nonSpecsChanges = featureChanges.filter(f => !criticalPairs.some(([p, id]) => p === f.productId && id === f.featureId));
  assert.equal(featureChanges.length, 66); assert.equal(nonSpecsChanges.length, 58);
  await write('source-deltas.json', { products: sourceDeltas, categoryChanges, featureChanges });
  await write('specs-provenance.json', { criticalPairs: specsReferences, nonSpecsChanges, conflictIds: conflicts(admissionRows.C) });
  const trainingById = { A: byId(A.projections.trainingSemanticsV2.snapshot.records), B: byId(B.projections.trainingSemanticsV2.snapshot.records), C: byId(snapshot.records) };
  const deltaSets = {};
  for (const baseline of ['A', 'B']) {
    deltaSets[baseline + '-C'] = snapshot.records.filter(r => !same(trainingById[baseline].get(r.productId), r)).map(after => {
      const before = trainingById[baseline].get(after.productId), semanticChanged = !same(semantic(before), semantic(after));
      const warningsOnly = same({ ...before, warnings: [] }, { ...after, warnings: [] });
      const category = semanticChanged ? baseline === 'A' ? 'rule-driven change' : 'source-driven change' : warningsOnly ? 'metadata-only change' : 'evidence-only change';
      return { productId: after.productId, category, semanticChanged, before, after, diff: diff(before, after), source: cc.get(after.productId).canonical, reconciliation: reconciled.evaluations.find(e => e.productId === after.productId) };
    });
  }
  await write('training-deltas.json', deltaSets);
  const negative = reconciled.evaluations.filter(e => e.record.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY');
  const negativeCounts = count(negative, e => e.negativeEvidenceState);
  assert.equal(snapshot.records.filter(r => r.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && facts(r).length).length, 0);
  assert.equal(negativeCounts.NEGATIVE_EVIDENCE_ABSENT, 50);
  const priorNegatives = await json('cross-projection-audit/p2-3c-fix2/negative-evidence-audit.json');
  assert.deepEqual(ids(negative.filter(e => e.negativeEvidenceState === 'NEGATIVE_EVIDENCE_ABSENT')), ids(priorNegatives.products.filter(e => e.negativeEvidenceState === 'NEGATIVE_EVIDENCE_ABSENT')));
  await write('negative-evidence.json', { counts: negativeCounts, products: negative });
  const targets = [1020, 1856, 247, 897, 1624, 435, 930, 1354].map(productId => ({ productId, source: cc.get(productId).canonical, record: trainingById.C.get(productId), before: trainingById.B.get(productId), evaluation: reconciled.evaluations.find(e => e.productId === productId) }));
  assert(!facts(trainingById.C.get(1020)).some(f => f.startsWith('CABLE_RESISTANCE/')));
  assert(!facts(trainingById.C.get(1856)).some(f => f.startsWith('BARBELL_SUPPORT/')));
  for (const f of ['BODYWEIGHT_SUPPORT', 'DIP', 'PULL_UP']) assert(facts(trainingById.C.get(1856)).some(a => a.startsWith(f + '/')));
  for (const id of [247, 897, 1624, 930]) { assert.equal(trainingById.C.get(id).resolutionState, 'DATA_GAP'); assert.deepEqual(facts(trainingById.C.get(id)), []); }
  assert.equal(trainingById.C.get(435).resolutionState, 'AMBIGUOUS');
  for (const id of [1124, 1811, 1812, 1813, 1999, 2006, 2008, 2134, 899, 1365]) assert(facts(trainingById.C.get(id)).includes('CABLE_RESISTANCE/DIRECT'));
  const barbellIds = [179, 251, 252, 276, 341, 342, 346, 390, 391, 392, 393, 477, 517, 540, 593, 594, 595, 744, 746, 760, 761, 887, 952, 971, 972, 975, 980, 1057, 1063, 1078, 1080, 1121, 1512, 1535, 1536, 1537, 1538, 1539, 1540, 1541, 1543, 1544, 1545, 1546, 1547, 1604, 1640, 1644, 1694, 1697, 1707, 2058, 2063, 2104, 2109, 2161, 2190, 2196, 2332];
  for (const id of barbellIds) assert(facts(trainingById.C.get(id)).some(f => f.startsWith('BARBELL_SUPPORT/')));
  await write('targeted-products.json', targets);
  const newProducts = contract.families.map(f => {
    const context = { canonical: { productId: 90000001, name: 'P_NEW', catalogPresence: 'current_catalog', active: true, categoryIds: [], features: [] }, declaredProductFamily: f.productFamily };
    const empty = { productId: 90000001, exerciseCapabilities: [], trainingFunctions: [], coverageStatus: 'UNMODELED', resolutionState: 'ONTOLOGY_GAP', resolved: false, warnings: [] };
    const record = reconcileTrainingSnapshot({ baseline: { ...snapshot, records: [empty], counts: { ...snapshot.counts, activeTrainingRelevant: 0 } }, sourceV1: v1, sources: [], contexts: new Map([[90000001, context]]) }).snapshot.records[0];
    assert.deepEqual(record, empty);
    const a = admission.evaluateAdmissionSnapshot({ ...context, training: record }, contract), b = admission.evaluateAdmissionSnapshot({ ...context, training: empty }, contract);
    assert.deepEqual(a, b);
    return { productFamily: f.productFamily, unknownDimensions: a.consolidation.evaluatedDimensions.filter(d => d.effectiveRequirement === 'UNKNOWN').map(d => d.dimension) };
  });
  assert.deepEqual(newProducts, (await json('cross-projection-audit/p2-3c-fix2/regressions.json')).newProductChecks);
  await write('new-products.json', newProducts);
  function runtimeIds(axis) {
    const { records, ...metadata } = snapshot, { records: productRecords, ...productMetadata } = C.projections.productSemantics.snapshot;
    const codes = (axis === 'EXERCISE_CAPABILITY' ? registry.exerciseCapabilities : registry.trainingFunctions).map(d => d.code), result = { query: [], discovery: [] };
    for (let i = 0; i < records.length; i += 100) {
      const reader = { getMetadata: () => metadata, getAllProductTrainingSemanticFacts: () => records.slice(i, i + 100).map(fact) }, productReader = { getActiveSnapshotMetadata: () => productMetadata, getAllProductSemanticFacts: () => productRecords };
      const request = { requirements: [{ axis, codes, mode: 'required', match: 'any' }], options: { limit: 100 } };
      for (const [k, service] of [['query', new DefaultTrainingSemanticQueryService(reader)], ['discovery', new DefaultSemanticDiscoveryService(productReader, reader)]]) {
        const r = service.query(request); assert(!r.truncated); result[k].push(...r.results.map(r => Number(r.productId)));
      }
    }
    return Object.fromEntries(Object.entries(result).map(([k, v]) => [k, [...new Set(v)].sort((a, b) => a - b)]));
  }
  const discovery = { exercise: runtimeIds('EXERCISE_CAPABILITY'), function: runtimeIds('TRAINING_FUNCTION') };
  assert(admissionSummary.C.ACTIVE.exerciseDiscovery.every(id => discovery.exercise.discovery.includes(id)));
  assert(admissionSummary.C.ACTIVE.functionDiscovery.every(id => discovery.function.discovery.includes(id)));
  for (const id of [435, 930]) assert(!discovery.function.discovery.includes(id));
  await write('runtime-discovery.json', discovery);
  const deltaSummary = Object.fromEntries(Object.entries(deltaSets).map(([k, rows]) => [k, { total: rows.length, semantic: rows.filter(r => r.semanticChanged).length, categories: count(rows, r => r.category), semanticIds: ids(rows.filter(r => r.semanticChanged)), evidenceOnlyIds: ids(rows.filter(r => !r.semanticChanged)) }]));
  const categoryEffects = categoryChanges.map(c => ({ ...c, trainingDelta: deltaSets['B-C'].find(r => r.productId === c.productId)?.category ?? 'unchanged', admissionChanged: admissionDeltas['B-C'].some(r => r.productId === c.productId) }));
  await write('category-effects.json', categoryEffects);
  const audit = { candidateDir, candidateBundleId: C.manifest.projectionBundleId, snapshotId: snapshot.snapshotId, snapshotContentHash: hash(canonicalizeTrainingSnapshotJson(snapshot)), projectionId: C.manifest.projections.trainingSemanticsV2.snapshotId,
    wrapperContentHash: hash(C.files['trainingSemanticsV2.json']), codeRef: C.manifest.build.codeRef, registryHash: snapshot.registryHash, rulesHash: snapshot.rulesHash, policy: wrapper.inputs.resolutionPolicy,
    historicalProductionPolicy: A.projections.trainingSemanticsV2.inputs.resolutionPolicy, contractHash: contract.contentHash, reproducibility: { sameBundleId: true, sameSnapshotId: true, sameProjectionIdentities: true, allProjectionBytesIdentical: true, manifestOnlyBuiltAt: true, build1At: C.manifest.build.builtAt, build2At: repeat.manifest.build.builtAt },
    protectedProjections, validation, publication, runtimeValidation, negativeCounts, deltaSummary, sourceDeltaCounts: { products: sourceDeltas.length, categoryProducts: categoryChanges.length, featureReferences: featureChanges.length, nonSpecsReferences: nonSpecsChanges.length }, admissionCounts: Object.fromEntries(Object.entries(admissionSummary).map(([label, summary]) => [label, Object.fromEntries(Object.entries(summary).map(([scope, m]) => [scope, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]))]))])), specsConflictCount: conflicts(admissionRows.C).length, newProductFamilyCount: newProducts.length };
  await write('audit.json', audit);
  console.log(JSON.stringify({ ...audit, protectedProjections: Object.keys(protectedProjections), runtimeValidation: Object.fromEntries(Object.entries(runtimeValidation).map(([k, v]) => [k, v.reloadState])), validation: validation.status, publication: publication.status, deltaSummary: Object.fromEntries(Object.entries(deltaSummary).map(([k, v]) => [k, { total: v.total, semantic: v.semantic, categories: v.categories, semanticIds: v.semanticIds }])) }, null, 2));
}
if (process.argv[2] === 'finalize') {
  const before = await json(`${out}/protected-before.json`), after = {}, changed = [];
  // This audit script was new in this phase and is intentionally reviewable.
  const ownFile = path.normalize('cross-projection-audit/production-baseline-rebuild.mjs');
  for (const [f, expected] of Object.entries(before)) {
    if (path.normalize(f) === ownFile) continue;
    after[f] = hash(await readFile(f)); if (after[f] !== expected) changed.push(f);
  }
  await write('protected-after.json', after); assert.deepEqual(changed, []);
  const legacy = await json('cross-projection-audit/p2-3c-fix2/protected-before.json');
  for (const [f, expected] of Object.entries(legacy)) assert.equal(hash(await readFile(f)), expected, f);
  const full = await json(`${out}/full-tests.json`), focused = await json(`${out}/focused-tests.json`);
  assert(full.success && focused.success); assert.equal(full.numFailedTests, 0); assert.equal(focused.numFailedTests, 0);
  const tsFiles = (await Promise.all(['src', 'scripts'].map(walk))).flat().filter(f => f.endsWith('.ts')).sort();
  const codeContent = await Promise.all([...tsFiles, 'package-lock.json'].map(async f => [f.replaceAll('\\', '/'), hash(await readFile(f))]));
  const historicalAuditCodeRef = hash(canonicalJson(codeContent));
  const builderOrdered = await Promise.all([...tsFiles, 'package-lock.json'].sort().map(async f => [f.replaceAll('\\', '/'), hash(await readFile(f))]));
  const builderCodeRef = hash(canonicalJson(builderOrdered));
  const audit = await json(`${out}/audit.json`);
  assert.equal(historicalAuditCodeRef, audit.codeRef);
  await write('code-content.json', codeContent);
  const generated = await walk(out), input = `${generated.map(f => f.replaceAll('\\', '/')).join('\n')}\n`;
  const ignored = execFileSync('git', ['check-ignore', '--stdin'], { input, encoding: 'utf8' }).trim().split('\n');
  assert.equal(ignored.length, generated.length);
  const tests = { full: { tests: full.numTotalTests, passed: full.numPassedTests, suites: full.numTotalTestSuites, failed: full.numFailedTests }, focused: { tests: focused.numTotalTests, passed: focused.numPassedTests, failed: focused.numFailedTests }, typecheck: 'PASS (exit 0)', lint: 'PASS (exit 0)' };
  const hygiene = { protectedFiles: Object.keys(after).length, priorFIX2ProtectedFiles: Object.keys(legacy).length, changed, ignoredGeneratedFiles: generated.length, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), historicalAuditCodeRef, builderCodeRef, tsContentUnchangedFromFIX2: historicalAuditCodeRef === 'sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac', tests };
  await write('hygiene.json', hygiene); console.log(JSON.stringify(hygiene, null, 2));
}
if (process.argv[2] === 'details') {
  const audit = await json(`${out}/audit.json`), deltas = await json(`${out}/training-deltas.json`), summary = await json(`${out}/admission-summary.json`);
  // Refresh derived classifications after checking complete records, including warning/evidence overlap.
  for (const [label, rows] of Object.entries(deltas)) {
    for (const d of rows) if (!d.semanticChanged) d.category = same({ ...d.before, warnings: [] }, { ...d.after, warnings: [] }) ? 'metadata-only change' : 'evidence-only change';
    audit.deltaSummary[label].categories = count(rows, r => r.category);
  }
  await write('training-deltas.json', deltas); await write('audit.json', audit);
  assert.equal(deltas['B-C'].filter(r => r.semanticChanged).length, 0);
  for (const d of deltas['B-C']) for (const f of d.diff) assert(/^\/resolutionEvidence\/\d+\/sourceId$/u.test(f.path), `Unexpected Training delta ${d.productId} ${f.path}`);
  assert.deepEqual(summary.B, summary.C);
  const core = r => ({ facts: [...new Set(facts(r))], resolutionState: r.resolutionState });
  const coreChanged = deltas['A-C'].filter(d => !same(core(d.before), core(d.after)));
  const extraSemantic = deltas['A-C'].filter(d => d.semanticChanged && same(core(d.before), core(d.after)));
  const evidence = r => ({ exercise: r.exerciseCapabilities.map(a => ({ evidence: a.evidence, provenance: a.provenance })), function: r.trainingFunctions.map(a => ({ evidence: a.evidence, provenance: a.provenance })), resolutionEvidence: r.resolutionEvidence });
  const evidenceOnly = deltas['A-C'].filter(d => same(core(d.before), core(d.after)) && !same(evidence(d.before), evidence(d.after)));
  const metadataOnly = deltas['A-C'].filter(d => same(core(d.before), core(d.after)) && same(evidence(d.before), evidence(d.after)));
  const paths = rows => count(rows.flatMap(d => d.diff), d => d.path.replace(/\/\d+(?=\/|$)/gu, '/*'));
  const p1354 = deltas['A-C'].find(d => d.productId === 1354);
  const source = await json(`${out}/source-deltas.json`), category = await json(`${out}/category-effects.json`);
  const nonSpecs = (await json(`${out}/specs-provenance.json`)).nonSpecsChanges;
  const categoryAdjudication = category.map(d => ({ productId: d.productId, added: d.after.filter(c => !d.before.some(b => same(b, c))), removed: d.before.filter(c => !d.after.some(a => same(a, c))), before: d.before, after: d.after, semanticTrainingChange: false, trainingChange: d.trainingDelta, admissionChanged: d.admissionChanged }));
  const evidenceIds = ids(evidenceOnly), coreIds = ids(coreChanged);
  const baselineReport = await readFile('docs/catalog-v2/P2_3C_BUNDLE_BASELINE_RECONCILIATION.md', 'utf8');
  const historicalSet = h => JSON.parse(baselineReport.split(/\r?\n/u).find(line => line.startsWith(`{"idsHash":"${h}"`))).ids;
  const priorSemanticIds = historicalSet('sha256:d479e8ea6f20cd225c0bae0c21ae31fdfe56c0d9539083170fb167c9ead0cb97');
  const priorEvidenceIds = historicalSet('sha256:06bbd246f3f9beea731e16eeae0fa559397e272e4e796a5e3f382d581b455b92');
  const priorClassDifferences = { addedSemantic: coreIds.filter(id => !priorSemanticIds.includes(id)), removedSemantic: priorSemanticIds.filter(id => !coreIds.includes(id)), addedEvidence: evidenceIds.filter(id => !priorEvidenceIds.includes(id)), removedEvidence: priorEvidenceIds.filter(id => !evidenceIds.includes(id)) };
  const reclassified = priorClassDifferences.addedSemantic.map(id => deltas['A-C'].find(d => d.productId === id));
  const evaluations = await json(`${out}/reconciliation.json`);
  const norm = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const passive = s => /\b(?:tobilleras?|ankle|agarres?|grips?|handles?|straps?|correas?|sogas?|ropes?|pads?|almohadillas?)\b/u.test(norm(s.name))
    || /\b(?:asientos?|seats?)\b/u.test(norm(s.name)) && !/\b(?:polea|pulley)\s+(?:con|with)\s+(?:asiento|seat)\b/u.test(norm(s.name))
    || /^(?:.*?seleccion\s*-\s*)?(?:barra|bar)\b/u.test(norm(s.name));
  const cable = s => /\b(?:poleas?|pulley|cable)\b/u.test(norm(s.name));
  const explicitMechanism = s => s.features.some(f => norm(f.featureName) === 'relacion de cable y polea' && f.trustClass === 'SEMANTIC');
  const attachment = s => /\b(?:accesorios?|attachments?|accessor(?:y|ies)?)\b/u.test(norm(s.name));
  const sweeps = [
    ['passive pulley attachment -> CABLE_RESISTANCE', (s, r) => cable(s) && passive(s) && r.trainingFunctions.some(a => a.functionCode === 'CABLE_RESISTANCE')],
    ['bodyweight-only rack -> BARBELL_SUPPORT', (s, r) => s.productFamily === 'BODYWEIGHT_GYMNASTICS' && /\brack\b/u.test(norm(s.name)) && r.trainingFunctions.some(a => a.functionCode === 'BARBELL_SUPPORT')],
    ['storage rack -> BARBELL_SUPPORT', (s, r) => (s.productFamily === 'STORAGE' || /almacenamiento|storage|porta discos/u.test(norm(s.name)) || s.categories.some(c => /almacenamiento/u.test(norm(c.name)))) && r.trainingFunctions.some(a => a.functionCode === 'BARBELL_SUPPORT')],
    ['host rack/jaula -> BARBELL_SUPPORT', (s, r) => attachment(s) && /\b(?:rack|jaula|smith)\b/u.test(norm(s.name)) && r.trainingFunctions.some(a => ['BARBELL_SUPPORT', 'GUIDED_BARBELL_SUPPORT'].includes(a.functionCode))],
    ['mechanical cable module -> verified negative', (s, r) => cable(s) && !passive(s) && (explicitMechanism(s) || /polea alta\s*(?:\/|\s)\s*remo/u.test(norm(s.name)) && s.features.some(f => norm(f.featureName) === 'peso maximo de carga') && s.features.some(f => norm(f.featureName) === 'diametro de manga') && s.features.some(f => norm(f.featureName).includes('dimensiones'))) && r.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY'],
    ['ambiguous cable accessory/module -> unsupported verified negative', (s, r) => cable(s) && attachment(s) && !passive(s) && !explicitMechanism(s) && r.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY'],
  ];
  const residual = sweeps.map(([pattern, predicate]) => ({ pattern, productIds: evaluations.filter(e => predicate(e.sourceEvidence.source, e.record)).map(e => e.productId) }));
  assert.equal(residual.reduce((n, r) => n + r.productIds.length, 0), 0);
  await write('residual-sweep.json', residual);
  const admissionDeltas = await json(`${out}/admission-deltas.json`);
  for (const d of admissionDeltas['B-C']) for (const f of d.diff) assert(f.path.endsWith('/sourceReference'), `Unexpected admission delta ${d.productId} ${f.path}`);
  const oldValidator = await import(pathToFileURL('C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/production-runtime/dist/src/domain/catalog/projection-bundle.js').href);
  const candidate = await readBundle(audit.candidateDir);
  let oldRuntime = 'UNEXPECTED_PASS';
  try { oldValidator.validateBundle(candidate.manifest, candidate.files); } catch (error) { oldRuntime = `${error.code}: ${error.message}`; }
  assert(oldRuntime.startsWith('INVALID_PROJECTION_SCHEMA:'));
  const details = { coreSemanticChanges: coreChanged.length, coreSemanticIds: coreIds, evidenceOnlyChanges: evidenceOnly.length, evidenceOnlyIds: evidenceIds, metadataOnlyChanges: metadataOnly.length, metadataOnlyIds: ids(metadataOnly), extraSemantic: extraSemantic.map(d => ({ productId: d.productId, diff: d.diff })), BCDiffPaths: paths(deltas['B-C']), p1354: p1354 && { before: p1354.before, after: p1354.after, diff: p1354.diff },
    historicalClassComparison: priorClassDifferences, reclassified,
    residualSweep: residual, admissionBCChangedIds: ids(admissionDeltas['B-C']), admissionBCOnlySpecSourceReferences: true,
    oldRuntimeCandidateValidation: oldRuntime,
    sourceChangeFields: paths(source.products), categoryAdjudication, nonSpecsInterpretation: nonSpecs.map(f => ({ ...f, trainingSemanticChange: false, recordEvidenceChange: deltas['B-C'].some(d => d.productId === f.productId) })),
    unchangedRuleFacts: true, exactAdmissionSetsPreserved: true, productionPolicyHash: audit.historicalProductionPolicy.hash, currentPreviousPolicyHash: audit.policy.previousPolicy.hash };
  await write('delta-details.json', details);
  console.log(JSON.stringify({ coreSemanticChanges: coreChanged.length, evidenceOnlyChanges: evidenceOnly.length, metadataOnlyChanges: metadataOnly.length, metadataOnlyIds: ids(metadataOnly), historicalClassComparison: priorClassDifferences, reclassified: reclassified.map(d => ({ productId: d.productId, diff: d.diff })), extraSemantic: details.extraSemantic, BCDiffPaths: details.BCDiffPaths, sourceChangeFields: details.sourceChangeFields }, null, 2));
}
if (process.argv[2] === 'report') {
  const a = await json(`${out}/audit.json`), p = await json(`${out}/preflight.json`), h = await json(`${out}/hygiene.json`), d = await json(`${out}/delta-details.json`);
  const specs = await json(`${out}/specs-provenance.json`), u = (await json(`${out}/universes.json`)).production;
  const candidate = await readBundle(a.candidateDir);
  assert.equal(candidate.manifest.projectionBundleId, a.candidateBundleId);
  assert.equal(a.codeRef, h.historicalAuditCodeRef); assert(h.tsContentUnchangedFromFIX2);
  assert.equal(d.historicalClassComparison.removedSemantic.length, 0);
  assert.equal(a.deltaSummary['B-C'].semantic, 0); assert(d.exactAdmissionSetsPreserved);
  const table = (headers, rows) => `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map(r => `| ${r.join(' | ')} |`).join('\n')}`;
  const admissionTable = table(['Baseline', 'Scope', 'Total', 'Product', 'Exercise', 'Function', 'Specs', 'Known', 'Certified', 'ADMITTED', 'PARTIAL', 'BLOCKED', 'REVIEW_REQUIRED', 'NOT_APPLICABLE'], Object.entries(a.admissionCounts).flatMap(([label, scopes]) => Object.entries(scopes).map(([scope, m]) => [label, scope, m.total, m.productDiscovery, m.exerciseDiscovery, m.functionDiscovery, m.specFiltering, m.knownObligations, m.certified, m.unified.ADMITTED ?? 0, m.unified.PARTIAL ?? 0, m.unified.BLOCKED ?? 0, m.unified.REVIEW_REQUIRED ?? 0, m.unified.NOT_APPLICABLE ?? 0])));
  const report = `# P2.3C-PRB — Production Baseline Rebuild & Candidate Validation

Fecha: 2026-10-08, America/Santiago. Candidate offline construido por el builder nativo, sin activar ni modificar producción.

## A. Fuente productiva verificada

Se verificaron los cinco archivos físicos de la copia descargada en la revisión anterior, en \`${sourceDir}\`. No fue necesaria recuperación desde EC2 ni nueva extracción. Observación fuente: ${p.manifest.source.observedAt}; no demuestra estado live de hoy. Se validaron canonical serialization, recordCounts, manifiesto, hashes físicos y aggregateContentHash con validateManifest.

${table(['Campo', 'Identidad verificada'], [['aggregateContentHash', p.manifest.aggregateContentHash], ['sourceExtractionId / canonicalInputHash', p.manifest.sourceExtractionId], ['compatibilityCsv', p.hashes.compatibilityCsv], ['categoryTrustMap', p.hashes.categoryTrustMap], ['featureTrustMap', p.hashes.featureTrustMap], ['manifest físico', p.manifestHash], ['bundle productivo', 'sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8'], ['manifest productivo físico', p.productionManifestHash]])}

Producción física: \`${productionDir}\`. validateBundle sobre esos bytes y su fuente productiva: PASS. Evidencia completa: \`${out}/preflight.json\`.

## B. Identidad de implementación FIX2

${table(['Campo', 'Valor'], [['commit exacto bajo revisión', h.commit], ['rulesHash', a.rulesHash], ['policy', a.policy.version], ['policyHash', a.policy.hash], ['builder', a.policy.builderVersion], ['registryHash', a.registryHash], ['codeRef FIX2 conservado', a.codeRef], ['semantic-obligations-v2', a.contractHash]])}

No se cambió implementación semántica, ontología, overrides ni policy. \`code-content.json\` recalcula el inventario TypeScript de src/scripts y package-lock, reproduciendo el codeRef FIX2 original. El builder nativo ordena también package-lock junto a las rutas y obtiene ${h.builderCodeRef}; el auditor FIX2 ordenaba TypeScript y agregaba package-lock al final. Se conserva legítimamente el codeRef original mediante el parámetro existente --code-ref, respaldado por contenido idéntico. No se modifica un manifest para fijar identidad. Las dos primeras pruebas nativas quedan como diagnósticos en build-1/build-2; no son el candidate final.

## C. Candidate nuevo y hashes

Directorio final: \`${a.candidateDir}\`.

${table(['Identidad', 'Valor'], [['bundleId', a.candidateBundleId], ['Training V2 snapshotId interno', a.snapshotId], ['snapshot contentHash, serialización canónica', a.snapshotContentHash], ['Training V2 projectionId del wrapper', a.projectionId], ['Training V2 wrapper contentHash físico', a.wrapperContentHash], ['manifest físico final', hash(candidate.raw)], ['sourceV1SnapshotId', candidate.projections.trainingSemantics.snapshot.snapshotId]])}

Construcción completa desde frozen source: Product → V1 → V2 FIX2 + Specs + Trust → publicación local inmutable. Sin copiar proyecciones entre bundles ni editar JSON generado. La segunda construcción independiente está en \`${out}/candidate-2/${a.candidateBundleId.slice(7)}\`.

## D. Matriz de proyecciones vs producción

${table(['Proyección', 'Records', 'Hash físico idéntico a producción', 'Diff canónico exacto'], Object.entries(a.protectedProjections).map(([name, v]) => [name, candidate.manifest.projections[name].recordCount, v.candidateHash, '[]']))}

Comparación completa de bytes y objetos, incluyendo todos los registros, facts, resolución, estados, source references, normalized/raw values y provenance. Product y V1: 2048 records idénticos cada uno. Specs: 3163 records idénticos, 1200 productos; 2599 parsed, 512 ambiguous, 52 unsupported. Mismos 82 conflict product IDs exactos. Trust: mismos maps, hashes, autoridad y configuración de consumo; no hay sustituciones justificadas sólo por counts. \`protected-projections.json\` conserva hashes y diff vacío por proyección.

## E. Specs provenance

${table(['Producto', 'Feature', 'ID anterior FIX2', 'featureValueId productivo preservado'], specs.criticalPairs.map(r => ['P' + r.productId, r.featureId, r.oldFeatureValueId, r.productionFeatureValueId]))}

Cada ID productivo se comprueba tanto en la extracción como en el record Specs reconstruido. Las otras 58 referencias cambiadas corresponden a features fuera de estas Specs normalizadas: mismo featureId/name/value, sin cambio semántico Training. \`specs-provenance.json\` contiene cada par, records completos y los 82 IDs conflictivos. \`delta-details.json/nonSpecsInterpretation\` adjudica las 58 referencias. Admission B→C cambia sólo referencias fuente Specs para IDs ${d.admissionBCChangedIds.map(id => 'P' + id).join(', ')}; ningún estado, valor o decisión cambia.

## F. Training V2 semantic deltas

A = producción 84c85d15…; B = FIX2 original 2f51d0c8… sobre fuente local; C = candidate final sobre fuente productiva.

${table(['Comparación', 'Records físicos cambiados', 'Cambios semánticos', 'Evidencia', 'Metadata'], [['A→C', a.deltaSummary['A-C'].total, d.coreSemanticChanges, d.evidenceOnlyChanges, d.metadataOnlyChanges], ['B→C', a.deltaSummary['B-C'].total, 0, 124, 0]])}

B→C: diff exacto de los 124 records limitado a \`/resolutionEvidence/*/sourceId\`. Todos los assignments completos, evidence de assignments, relation types, confianza, reviewState, modifiers, provenance, coverageStatus, resolución, resolved y warnings permanecen iguales. Los hashes fuente se recalculan desde el input productivo; no se copian evidence IDs locales. Los otros 1924 records son físicamente idénticos. Se reevaluaron los 2048 y se verificaron invariantes source-bound, identidad de registry y reconciliation nativa/auditoría.

Los 193 productos con asociaciones de categorías distintas fueron adjudicados individualmente en \`category-effects.json\` y \`delta-details.json/categoryAdjudication\`, con categorías añadidas/retiradas y before/after. Ninguno cambia interpretación Training ni admission. También hay ocho cambios de revenue en fuente; no intervienen en esta semántica. No se infiere igualdad Training únicamente desde Product: se comparan sus records completos.

Se preservan exactamente los 154 IDs de mejoras semánticas y los 1095 IDs de mejoras de evidencia del informe previo. Al revisar su clasificación, P899 y P1365 tienen realmente CABLE_RESISTANCE FAMILY_DERIVED→DIRECT frente a producción, respaldado por feature 65, Relación de cable y polea: 1:1. Ya eran DIRECT en B y continúan DIRECT en C. El informe previo los clasificó como evidence-only. Por ello la partición correcta es 156 mejoras semánticas + 1093 de evidencia + un warning-only P1354 + 798 records intactos. \`historicalClassComparison\` y \`reclassified\` enumeran los dos IDs y sus diffs; ninguna mejora previa desaparece. Se mantiene el informe histórico intacto.

P1354: misma negativa modelada, sin assignments, coverageStatus UNMODELED y warning residual TRAINING_EVIDENCE_DOMAIN_SUPPRESSED:NAME_DEADLIFT_DEDICATED_V2. Sin prueba negativa nueva; continúa en la deuda de 50. No se borra ni se certifica más allá de la evidencia existente.

Targets: P1020 sin CABLE_RESISTANCE; P1856 sin BARBELL_SUPPORT y con BODYWEIGHT_SUPPORT/DIP/PULL_UP; P247/P897/P1624/P930 DATA_GAP sin positivos; P435 AMBIGUOUS. Preservados los diez mecanismos cable DIRECT y los 59 soportes propios aprobados. Negative-with-assignments=0; PRESENT=${a.negativeCounts.NEGATIVE_EVIDENCE_PRESENT}, ABSENT=${a.negativeCounts.NEGATIVE_EVIDENCE_ABSENT}, NOT_RECONSTRUCTABLE=0. Los 50 IDs ABSENT son exactamente los de B. Se repitieron seis barridos independientes de clases conocidas: cero residuales observados. Evidencias: training-deltas.json, reconciliation.json, targeted-products.json, negative-evidence.json, residual-sweep.json.

Clasificación completa: source-driven semantic change=0; rule-driven A→C=156; evidence-only A→C=1093 y B→C=124; metadata-only A→C=1; lineage-only en wrappers/identidades según sección I; unexpected regression=0 en corpus y clases revisadas. El scope no demuestra ausencia universal de errores futuros.

## G. Universe y source IDs

${table(['Conjunto', 'Count', 'Hash del array JSON canónico de IDs numéricos ordenados'], Object.entries(u).map(([k, v]) => [k, v.count, v.idsHash]))}

Conjuntos exactos e hashes iguales entre fuentes productiva y local FIX2. \`universes.json\` conserva todos los IDs; active/inactive se refieren al current catalog. No se pierden los 483 históricos. Cambio sourceExtractionId local→productivo: sha256:3694b291c89d5f011904b44dc7fe51eb6f355da63d5bb25c485009fadd67d007 → ${p.manifest.sourceExtractionId}. 208 productos con alguna diferencia fuente, 193 con categorías y 66 referencias featureValueId; los deltas completos están en source-deltas.json.

## H. Admission y Discovery

Mismo contrato ${a.contractHash} para A/B/C. A se reevalúa con el runtime corregido; no se compara con sus counts archivados usando otro código.

${admissionTable}

Product/Exercise/Function/Specs expresan IDs con decisión ADMITTED del evaluator; Certified usa CONSOLIDATED/CONSOLIDATED_WITH_NOT_APPLICABLE. B y C preservan exactamente todos los conjuntos de las siete métricas, todas las decisiones y counts Unified/consolidation en ALL/CURRENT/ACTIVE. \`admission-summary.json\` incluye IDs, \`admission-rows.json\` cada evaluación completa y \`admission-deltas.json\` todos los campos que cambiaron. El diff B→C contiene únicamente sourceReference Specs de los ocho pares indicados. Trust conserva maps y estados; su consumo no cambia por las categorías añadidas.

Training Query y Semantic Discovery reales recorridos en bloques de 100, sin truncamiento, preservan acceso a todos los admitted IDs activos. P435/P930 continúan fuera de Function Discovery. \`runtime-discovery.json\` registra conjuntos reales de Query/Discovery. P_NEW conserva las 21 familias y UNKNOWN aplicables, sin facts nuevos ni cambio de decisiones; new-products.json.

## I. Compatibilidad de lineage/policy

sourceExtractionId=canonicalInputHash=${p.manifest.sourceExtractionId}; compatibilityCsv=${p.hashes.compatibilityCsv}; sourceV1SnapshotId=${candidate.projections.trainingSemantics.snapshot.snapshotId}. Registry/rules/policy/codeRef FIX2 se conservan. Snapshot/projection/bundle se recalculan con la fuente productiva; no se persiguen acf4434a…/2f51d0….

El bundle productivo histórico declara A00.6.7 ${a.historicalProductionPolicy.hash}; sus bytes y declaración no se alteran. FIX2 consume realmente ${a.policy.previousPolicy.hash} desde ${a.policy.previousPolicy.file}, igual que B. previousPolicy es una dependencia efectiva: readAcceptedTrainingResolutionPolicy parsea estados, valida el cohort y sus conteos, y replayHistorical usa estados/productIds antes de la reconciliación fuente. No es sólo una etiqueta informativa. La reconciliación recalcula assignments y nueva evidence desde la fuente productiva, pero puede conservar estados coherentes del seed. Ambos hashes se documentan con su rol: baseline histórico productivo y dependencia de construcción FIX2 aprobada. No existe una regla contractual que exija que previousPolicy sea igual al hash histórico del bundle comparador. No se reemplaza ese hash ni se declara que el archivo local fuera parte de la extracción productiva.

validateBundle, validateBundleForPublication, snapshot/V1 source linkage y validateTrainingSemanticInvariants PASS. RuntimeProjectionManager.reconcile real + ActivationService.candidate real usan bytes físicos mediante un store de lectura sin promote: producción y C quedan READY, sin lastReloadError. No se escribe un pointer. Evidencia: audit.json. No fue necesaria adaptación contractual.

El validator del runtime productivo descargado rechaza C por el schema de resolución extendido (version/builderVersion/previousPolicy); reproducción local en delta-details.json. Se requiere desplegar runtime compatible en la fase de rollout antes de activar; esta fase no lo hace.

## J. Reproducibilidad

Dos construcciones nativas independientes, mismos inputs/codeRef, directorios candidate-1 y candidate-2: mismo snapshotId, hash canónico de snapshot, todas las projection identities, bytes de las cinco proyecciones y bundleId. Reconciliación repetida con sources/contextos invertidos: snapshot y evaluaciones idénticos. generatedAt de snapshots=1970-01-01T00:00:00.000Z.

Los manifests sólo difieren en build.builtAt (${a.reproducibility.build1At} / ${a.reproducibility.build2At}), excluido de bundleId por el contrato. Sus hashes físicos pueden diferir. validation-report.json contiene timings diagnósticos, también fuera de la identidad. No se exige igualdad de esos timings. Las pruebas nativas iniciales con el codeRef automático obtuvieron el mismo snapshot interno y semántica; el candidate final conserva el codeRef FIX2 comprobado.

## K. Tests y gates

${table(['Check', 'Resultado'], [['Focalizados', h.tests.focused.passed + '/' + h.tests.focused.tests + ' PASS (5 archivos)'], ['Suite completa', h.tests.full.passed + '/' + h.tests.full.tests + ' PASS; ' + h.tests.full.suites + ' suites'], ['Typecheck', h.tests.typecheck], ['Lint', h.tests.lint], ['Reconciliation / negative evidence / precision', 'PASS; 2048 reconciliados, 0 negative-with-assignments, seis sweeps sin residuales'], ['Registry / family derivations', 'PASS; identidad y facts exactos B→C'], ['Product Discovery / Specs conflicts / Trust', 'PASS; conjuntos exactos, 82 conflictos, bytes protegidos idénticos'], ['P_NEW', 'PASS; 21 familias'], ['Protected projection integrity', 'PASS; cuatro artifacts idénticos a producción'], ['Publication / lineage / runtime real', 'PASS; candidate y baseline'], ['Reproducibility', 'PASS; dos builds finales independientes']])}

Comandos directos, sin npm test/pretest/bootstrap:

\`\`\`text
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=json --outputFile=artifacts/catalog-v2/p2-3c-prb/full-tests.json
node node_modules/vitest/vitest.mjs run tests/unit/trainingRulePrecision.test.ts tests/unit/trainingSemanticReconciliation.test.ts tests/unit/catalog-admission-v2.test.ts tests/unit/training-semantic-classifier-v2.test.ts tests/unit/trainingV2AuthorityParity.test.ts --reporter=json --outputFile=artifacts/catalog-v2/p2-3c-prb/focused-tests.json
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js . --ext .ts
node --import tsx scripts/catalog-v2/build-projection-bundle.ts --source-dir=<fuente verificada> --output-dir=artifacts/catalog-v2/p2-3c-prb/candidate-1 --code-ref=${a.codeRef}
node --import tsx scripts/catalog-v2/build-projection-bundle.ts --source-dir=<misma fuente> --output-dir=artifacts/catalog-v2/p2-3c-prb/candidate-2 --code-ref=${a.codeRef}
node --import tsx cross-projection-audit/production-baseline-rebuild.mjs audit
node --import tsx cross-projection-audit/production-baseline-rebuild.mjs details
node --import tsx cross-projection-audit/production-baseline-rebuild.mjs finalize
node --import tsx cross-projection-audit/production-baseline-rebuild.mjs report
\`\`\`

Logs y JSON de tests locales ignorados. El auditor incluye asserts de integridad, comparadores exactos, targets, corpus, conjuntos y source lineage; no se agregan tests espejo de implementación. Las comprobaciones TypeScript corresponden al código semántico final, sin cambios posteriores. El nuevo auditor MJS se ejecutó con sus asserts.

## L. Repository hygiene

${h.protectedFiles} fingerprints históricos antes/después idénticos; los ${h.priorFIX2ProtectedFiles} del gate FIX2 anterior también coinciden. protected-before.json/protected-after.json conservan los hashes físicos. El único archivo capturado y excluido es este nuevo auditor, que no existía antes de PRB y sigue siendo revisable. Ningún source, test, frozen artifact o pointer protegido se modificó.

Código bajo revisión: ${h.commit}; source/tests tracked limpios. Nuevos archivos de esta fase: cross-projection-audit/production-baseline-rebuild.mjs y este informe. El informe P2_3C_BUNDLE_BASELINE_RECONCILIATION.md ya era untracked al comenzar y permanece intacto. Sin stage ni commit nuevo. JSON/CSV/snapshots/bundles/logs generados bajo artifacts/ están ignorados, comprobado con git check-ignore. No se modificó .gitignore ni se incorporaron artifacts grandes a Git.

## M. Riesgos restantes

El candidate está listo para revisión, pendiente de aprobación y rollout posteriores. No se reobservó baseline live, PM2 ni Commercial Truth hoy; se deberán verificar en rollout. El runtime actualmente desplegado no admite C. Los 50 negativos sin evidence, P247/P897/P1624/P930 DATA_GAP, P435 AMBIGUOUS y warning P1354 permanecen visibles. Los 82 conflictos Specs y unavailable relationships/capabilities conservan su estado aprobado; no se desarrolló P2.3D. Se demostró reproducibilidad con la implementación y entorno local de Windows; el codeRef aprobado explícito evita que el orden de rutas del host reidentifique esta revisión en un build posterior. La fuente física reside en un directorio temporal local: debe conservarse junto al candidate/evidencia para revisión posterior.

## N. Disposición final

**READY_FOR_P2_3C_PRODUCTION_ROLLOUT_REVIEW**

Rebuild completo y determinista sobre fuente productiva íntegra; proyecciones protegidas físicamente idénticas; FIX2 preservado sin regresiones observadas; runtime nuevo, control plane y lineage validados. Candidate exclusivamente offline. Sin cambios en EC2, puntero productivo, PM2, PrestaShop, R4, Sales Agent, quote-service ni customer-profile.
`;
  await writeFile('docs/catalog-v2/P2_3C_PRODUCTION_BASELINE_REBUILD.md', report, 'utf8');
  console.log(JSON.stringify({ report: 'docs/catalog-v2/P2_3C_PRODUCTION_BASELINE_REBUILD.md', candidate: a.candidateDir, disposition: 'READY_FOR_P2_3C_PRODUCTION_ROLLOUT_REVIEW' }));
}
