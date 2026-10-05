#!/usr/bin/env node
// Offline observation only. Outputs are confined to this directory; no publishers or stores are invoked.
import { readFile, writeFile, readdir, access, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const auditDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(auditDirectory);
process.chdir(root);
const options = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--p2-3a' && !options.p23a) { options.p23a = true; continue; }
  if (arg === '--p2-3b' && !options.p23b) { options.p23b = true; continue; }
  const m = /^--(source-dir|bundle-dir|output-dir)=(.+)$/.exec(arg);
  if (!m || options[m[1]]) throw new Error(`Unsupported/duplicate argument: ${arg}`);
  options[m[1]] = m[2];
}
const output = options['output-dir'] ? path.resolve(root, options['output-dir']) : auditDirectory;
for (const protectedDirectory of ['artifacts', 'data']) {
  const relative = path.relative(path.join(root, protectedDirectory), output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('AUDIT_OUTPUT_DIRECTORY_IS_PROTECTED');
}
await mkdir(output, { recursive: true });
if (output !== auditDirectory) await Promise.all(['invariants.md', 'new-product-admission.md'].map(file =>
  copyFile(path.join(auditDirectory, file), path.join(output, file))));
const sourceDir = options['source-dir'] ?? 'artifacts/catalog-projection-input/36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2';
const bundleDir = options['bundle-dir'] ?? 'artifacts/catalog-v2/p2-2b-final/bundles/ee4881b5875ee098c8b54c5ee6dfdcd4d4a92d8c91263bd4ce02c1b5e8e0a347';
const imp = (file) => import(pathToFileURL(path.join(root, file)).href);
const [canonical, bundle, psContracts, t1Contracts, t2Contracts, ontology, trainingRegistry,
  csv, productLoader, trainingLoader, productClassifier, trainingClassifier, t1Classifier] = await Promise.all([
  imp('src/domain/catalog/projection-input/canonical.ts'), imp('src/domain/catalog/projection-bundle.ts'),
  imp('src/domain/product-semantic-snapshot/contracts.ts'), imp('src/domain/training-semantic-snapshot/contracts.ts'),
  imp('src/domain/training-semantic-snapshot/v2-contracts.ts'), imp('src/domain/commercial-product-ontology/index.ts'),
  imp('src/domain/training-semantics-v2/index.ts'), imp('scripts/product-semantic-classification/lib/csv.ts'),
  imp('scripts/product-semantic-classification/lib/load-input.ts'), imp('scripts/training-semantic-classification/lib/load-input.ts'),
  imp('src/domain/product-semantic-classification/classifier.ts'), imp('src/domain/training-semantic-classification-v2-1/classifier.ts'),
  imp('src/domain/training-semantic-classification/classifier.ts'),
]);
const hash = (raw) => `sha256:${createHash('sha256').update(raw).digest('hex')}`;
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const exists = async (file) => { try { await access(file); return true; } catch { return false; } };
const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(
  e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
const fingerprint = async () => Object.fromEntries(await Promise.all((await Promise.all(['artifacts', 'data'].map(walk))).flat().sort()
  .map(async file => [file.replaceAll('\\', '/'), hash(await readFile(file))])));
const before = await fingerprint();
const sourceRaw = await readFile(path.join(sourceDir, 'canonical_input.json'), 'utf8');
const source = JSON.parse(sourceRaw);
const sourceFiles = { canonicalInput: 'canonical_input.json', compatibilityCsv: 'product_catalog_exploration.csv',
  categoryTrustMap: 'category_trust_map.csv', featureTrustMap: 'feature_trust_map.csv' };
const sourceHashes = Object.fromEntries(await Promise.all(Object.entries(sourceFiles).map(async ([k, f]) => [k, hash(await readFile(path.join(sourceDir, f)))])));
const extraction = canonical.validateManifest(await json(path.join(sourceDir, 'projection_input_manifest.json')), sourceHashes);
assert.equal(sourceRaw, canonical.canonicalContent(source));
assert.deepEqual(canonical.recordCounts(source), extraction.recordCounts);
const manifest = await json(path.join(bundleDir, 'manifest.json'));
const files = Object.fromEntries(await Promise.all(Object.values(manifest.projections).filter(e => e.status === 'present')
  .map(async e => [e.artifact, await readFile(path.join(bundleDir, e.artifact), 'utf8')])));
const validation = bundle.validateBundle(manifest, files, source);
const projections = Object.fromEntries(Object.entries(manifest.projections).filter(([, e]) => e.status === 'present')
  .map(([k, e]) => [k, JSON.parse(files[e.artifact])]));
const ps = projections.productSemantics.snapshot, t1 = projections.trainingSemantics.snapshot, t2 = projections.trainingSemanticsV2.snapshot;
const specs = projections.specs.records;
const inputPaths = { catalogCsvPath: path.join(sourceDir, sourceFiles.compatibilityCsv),
  categoryTrustMapCsvPath: path.join(sourceDir, sourceFiles.categoryTrustMap), featureTrustMapCsvPath: path.join(sourceDir, sourceFiles.featureTrustMap) };
const [pLoaded, tLoaded] = await Promise.all([productLoader.loadProductSemanticClassificationInputs(inputPaths), trainingLoader.loadTrainingSemanticClassificationInputs(inputPaths)]);
assert.deepEqual(pLoaded.warnings, []); assert.deepEqual(tLoaded.warnings, []);
const policyFile = projections.trainingSemanticsV2.inputs.resolutionPolicy.file;
const policyRaw = await readFile(policyFile, 'utf8');
assert.equal(hash(policyRaw), projections.trainingSemanticsV2.inputs.resolutionPolicy.hash);
const strictCsv = (raw) => {
  const rows = csv.parseCsv(raw);
  assert(rows.length > 1 && rows.slice(1).every(r => r.length === rows[0].length), 'CSV must not silently drop rows');
  return csv.parseCsvRecords(raw);
};
const categoryRows = strictCsv(await readFile(inputPaths.categoryTrustMapCsvPath, 'utf8'));
const featureRows = strictCsv(await readFile(inputPaths.featureTrustMapCsvPath, 'utf8'));
const categories = new Map(categoryRows.map(r => [r.categoryId, r]));
const features = new Map(featureRows.map(r => [r.featureId, r]));
const policy = new Map(strictCsv(policyRaw).map(r => [Number(r.productId), r]));
const pInputs = new Map(pLoaded.inputs.map(p => [Number(p.productId), p]));
const tInputs = new Map(tLoaded.inputs.map(p => [p.productId, p]));
const pById = new Map(ps.records.map(p => [Number(p.productId), p]));
const tById = new Map(t2.records.map(p => [p.productId, p]));
const v1ById = new Map(t1.records.map(p => [p.productId, p]));
const specsById = Map.groupBy(specs, s => Number(s.productKey.slice(1)));
const registry = ontology.getCommercialProductOntologyRegistry(ps.ontologyVersion);
assert.equal(ontology.computeCommercialProductOntologyRegistryHash(registry), ps.ontologyHash);
const tr = trainingRegistry.getTrainingSemanticRegistryV2();
assert.equal(tr.registryHash, t2.registryHash);
assert.equal(source.products.length, new Set(source.products.map(p => p.productId)).size);
for (const map of [pInputs, tInputs, pById, tById, v1ById]) {
  assert.equal(map.size, source.products.length);
  assert(source.products.every(p => map.has(p.productId)));
}
if (options.p23a && options.p23b) throw new Error('SELECT_ONE_ADMISSION_CONTRACT_VERSION');
if (options.p23b) {
  const { runFamilyApplicabilityAudit } = await import('./family-applicability-audit.mjs');
  await runFamilyApplicabilityAudit({ source, manifest, ps, t2, specsById, pById, tById, categoryRows, featureRows,
    sourceHashes, extraction, sourceDir, bundleDir, output, root, before, fingerprint, hash, validation, baselineDirectory: auditDirectory });
  process.exit(0);
}
if (options.p23a) {
  const { runAdmissionAudit } = await import('./admission-audit.mjs');
  await runAdmissionAudit({ source, manifest, ps, t2, specsById, pById, tById, categoryRows, featureRows,
    sourceHashes, extraction, sourceDir, bundleDir, output, root, before, fingerprint, hash, validation });
  process.exit(0);
}
const canonicalJson = bundle.canonicalJson;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const unique = a => [...new Set(a)].sort();
const tags = p => [...(p.primaryProductFamily ? [p.primaryProductFamily] : []), ...p.secondaryProductFamilies, ...p.disciplines, ...p.useContexts];
const terminal = s => ['VERIFIED', 'VERIFIED_NOT_APPLICABLE', 'NOT_REQUIRED'].includes(s);
const issue = (code, detail = {}, severity = 'WARNING') => ({ code, severity, ...detail });
const rate = (n, d, scope) => ({ count: n, denominator: d, percentage: d ? Number((100 * n / d).toFixed(4)) : null, scope });
const counts = (rows, fn) => rows.reduce((a, r) => { const k = fn(r) ?? 'UNKNOWN'; a[k] = (a[k] ?? 0) + 1; return a; }, {});
const countTable = obj => `| Estado | Count |\n|---|---:|\n${Object.entries(obj).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}`;
const mapsDuplicate = rows => rows.length !== new Set(rows.map(r => r.categoryId ?? r.featureId)).size;
assert(!mapsDuplicate(categoryRows) && !mapsDuplicate(featureRows));
const catClasses = ['SEMANTIC_STRONG', 'SEMANTIC_WEAK', 'CAMPAIGN', 'NAVIGATION', 'LEGACY', 'UNKNOWN'];
const featureClasses = ['SEMANTIC', 'TECHNICAL', 'NOISE', 'PRESENTATION', 'LOGISTICS'];
assert(categoryRows.every(r => catClasses.includes(r.trustClass)) && featureRows.every(r => featureClasses.includes(r.trustClass)));
const assignmentView = a => ({ code: a.capabilityCode ?? a.functionCode, relationType: a.relationType,
  classificationConfidence: a.classificationConfidence, reviewState: a.reviewState, evidence: [...a.evidence].sort((x, y) => canonicalJson(x).localeCompare(canonicalJson(y))),
  productFamily: a.productFamily ?? null, moduleId: a.moduleId ?? null, modifierCodes: a.modifierCodes ?? [] });
const assignmentsView = a => a.map(assignmentView).sort((x, y) => canonicalJson(x).localeCompare(canonicalJson(y)));
const negativeInvalid = t => t.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && t.exerciseCapabilities.length + t.trainingFunctions.length > 0;
const legacyFile = 'data/training-semantic-snapshots/v2/snapshots/045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1.json';
const legacyTraining = await json(legacyFile);
const v2Validator = await imp('src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts');
v2Validator.validateTrainingSemanticSnapshotV2(legacyTraining);
const legacyInvalidIds = legacyTraining.records.filter(negativeInvalid).map(r => r.productId).sort((a, b) => a - b);
assert.deepEqual(legacyInvalidIds, t2.records.filter(negativeInvalid).map(r => r.productId).sort((a, b) => a - b), 'Known invalid baseline differs across legacy/native');
// Replay the private parseMeasurement rule for pre-conflict candidates; buildSpecs turns differing values into null/ambiguous.
const measurementCandidate = s => {
  const label = ({ assembled_length_cm: 'Largo', assembled_width_cm: 'Ancho', assembled_height_cm: 'Alto' })[s.key];
  const text = label ? (s.rawValue.match(new RegExp(`${label}\\s*:\\s*([^;]+?)(?=\\b(?:Largo|Ancho|Alto)\\s*:|$)`, 'iu'))?.[1] ?? '') : s.rawValue;
  const matches = [...text.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${s.unit}\\b`, 'giu'))];
  return { value: matches.length === 1 ? Number(matches[0][1].replace(',', '.')) : null,
    reason: matches.length > 1 ? 'MULTIPLE_VALUES_WITH_TARGET_UNIT' : matches.length === 1 ? 'SINGLE_VALUE_WITH_TARGET_UNIT'
      : label && !text ? 'MISSING_DIMENSION_LABEL' : /\d/u.test(text) ? 'NUMERIC_WITHOUT_UNIQUE_TARGET_UNIT' : 'NO_NUMERIC_VALUE' };
};
assert(same(bundle.buildSpecs(source, extraction.sourceExtractionId).records, specs), 'Specs read-only replay drift');
const rows = [];
for (const p of source.products) {
  const productId = p.productId, key = `P${productId}`, product = pById.get(productId), training = tById.get(productId), v1 = v1ById.get(productId);
  const pReplay = productClassifier.classifyProduct(pInputs.get(productId), ps.ontologyVersion);
  const tReplay = trainingClassifier.classifyTrainingSemanticProductV21(tInputs.get(productId), { sourceCatalogExport: 'product_catalog_exploration.csv' });
  const v1Replay = t1Classifier.classifyTrainingSemanticProduct(tInputs.get(productId));
  const pIssues = [], tIssues = [], sIssues = [], trustIssues = [], crossIssues = [], warnings = [];
  const productStructural = psContracts.productSemanticSnapshotFactSchema.safeParse(product).success;
  const trainingStructural = t2Contracts.trainingSemanticSnapshotV2RecordSchema.safeParse(training).success;
  const v1Structural = t1Contracts.trainingSemanticSnapshotRecordSchema.safeParse(v1).success;
  const sourceStructural = Number.isSafeInteger(productId) && productId > 0 && typeof p.name === 'string' && !!p.name.trim()
    && (p.catalogPresence === 'current_catalog' ? typeof p.active === 'boolean' && Array.isArray(p.features) && Array.isArray(p.categoryIds) && Array.isArray(p.variantIds)
      : p.catalogPresence === 'historical_order_detail_only' && p.active === null && p.features === null && p.categoryIds === null && p.variantIds === null);
  if (!productStructural) pIssues.push(issue('PRODUCT_SCHEMA_INVALID', {}, 'ERROR'));
  if (product.catalogPresence !== p.catalogPresence) crossIssues.push(issue('PRODUCT_PRESENCE_CONFLICT', {}, 'ERROR'));
  if (product.ontologyVersion !== ps.ontologyVersion || product.ontologyHash !== ps.ontologyHash) pIssues.push(issue('PRODUCT_ONTOLOGY_LINEAGE_INVALID', {}, 'ERROR'));
  const expectedEvidence = pReplay.evidence.map(psContracts.toSnapshotEvidence);
  if (!same(tags(product), [...(pReplay.primaryProductFamily ? [pReplay.primaryProductFamily] : []), ...pReplay.secondaryProductFamilies, ...pReplay.disciplines, ...pReplay.useContexts].map(psContracts.toSnapshotTag))
    || !same(product.provenance.evidence, expectedEvidence) || product.classificationStatus !== pReplay.classificationStatus)
    pIssues.push(issue('PRODUCT_REPLAY_MISMATCH', {}, 'ERROR'));
  const weakTags = [], historicalDerived = [];
  for (const tag of tags(product)) {
    const e = product.provenance.evidence.find(e => e.axis === tag.axis && e.code === tag.code && e.ruleId === tag.ruleId);
    if (!e || !ontology.getOntologyTag(tag.axis, tag.code, ps.ontologyVersion)) { pIssues.push(issue('PRODUCT_UNSUPPORTED_TAG', { tag }, 'ERROR')); continue; }
    if (e.sourceType === 'TRUSTED_CATEGORY') {
      const c = categories.get(e.sourceId);
      if (!p.categoryIds?.some(c => String(c.categoryId) === e.sourceId) || !c || !registry.globalRules.categoryTrustGate[tag.axis].includes(c.trustClass))
        pIssues.push(issue('PRODUCT_TRUST_GATE_VIOLATION', { evidence: e }, 'ERROR'));
      else if (c.trustClass === 'SEMANTIC_WEAK') weakTags.push(tag);
    }
    if (p.catalogPresence === 'historical_order_detail_only' && e.sourceType === 'FAMILY_INFERENCE') historicalDerived.push(tag);
    if (p.catalogPresence === 'historical_order_detail_only' && ['TRUSTED_CATEGORY', 'STRUCTURED_FEATURE'].includes(e.sourceType))
      pIssues.push(issue('HISTORICAL_UNAVAILABLE_SOURCE_USED', { evidence: e }, 'ERROR'));
  }
  if (weakTags.length) pIssues.push(issue('PRODUCT_WEAK_CATEGORY_TERMINAL', { tags: weakTags, currentPolicyAllows: true, auditTreatment: 'review sole weak category facts' }));
  if (historicalDerived.length) {
    crossIssues.push(issue('HISTORICAL_POLICY_IMPLEMENTATION_CONFLICT', { tags: historicalDerived,
      policy: 'globalHistoricalPolicy.disciplineRequiresExplicitNameEvidence', implementation: 'discipline-rules explicitly permits FAMILY_INFERENCE' }, 'CONFLICT'));
  }
  const pEvidenceAccepted = productStructural && !pIssues.some(i => i.severity === 'ERROR') && !weakTags.length && !historicalDerived.length
    && (product.classificationStatus === 'EXCLUDED_NON_PRODUCT' ? !!product.provenance.exclusion?.ruleId : tags(product).length > 0);
  let pState = ({ CLASSIFIED: 'VERIFIED', PARTIALLY_CLASSIFIED: 'PARTIAL', OTHER: 'UNKNOWN', NEEDS_REVIEW: 'AMBIGUOUS', EXCLUDED_NON_PRODUCT: 'VERIFIED_NOT_APPLICABLE' })[product.classificationStatus] ?? 'UNKNOWN';
  if (weakTags.length) pState = 'PARTIAL';
  if (historicalDerived.length) pState = 'SOURCE_CONFLICT';
  if (pIssues.some(i => i.severity === 'ERROR')) pState = 'INVALID_STATE';
  if (product.classificationStatus === 'OTHER') pIssues.push(issue('PRODUCT_FAMILY_UNRESOLVED', { cause: 'OTHER does not distinguish source/rule/ontology gap' }));
  if (product.classificationStatus === 'PARTIALLY_CLASSIFIED') pIssues.push(issue('PRODUCT_HISTORICAL_PARTIAL', { cause: 'historical scope, not proof of weak family assignment' }));
  if (!trainingStructural) tIssues.push(issue('TRAINING_SCHEMA_INVALID', {}, 'ERROR'));
  if (!same(assignmentsView(training.exerciseCapabilities), assignmentsView(tReplay.exerciseCapabilities)) || !same(assignmentsView(training.trainingFunctions), assignmentsView(tReplay.trainingFunctions)))
    tIssues.push(issue('TRAINING_REPLAY_MISMATCH', {}, 'ERROR'));
  if (negativeInvalid(training)) tIssues.push(issue('TRAINING_NEGATIVE_WITH_ASSIGNMENTS', { knownBaseline: true, exercises: training.exerciseCapabilities.map(a => a.capabilityCode), functions: training.trainingFunctions.map(a => a.functionCode) }, 'ERROR'));
  const resolvedExpected = ['SEMANTIC_COMPLETE', 'VERIFIED_NO_APPLICABLE_CAPABILITY'].includes(training.resolutionState);
  if (training.resolved !== resolvedExpected) tIssues.push(issue('TRAINING_RESOLVED_FLAG_CONFLICT', {}, 'ERROR'));
  for (const a of [...training.exerciseCapabilities, ...training.trainingFunctions]) {
    if (!['EXPLICIT', 'HIGH'].includes(a.classificationConfidence) && !['ACCEPTED', 'MANUAL_OVERRIDE'].includes(a.reviewState))
      tIssues.push(issue('TRAINING_WEAK_AUTO_ASSIGNMENT', { assignment: assignmentView(a) }, 'ERROR'));
    if (a.relationType === 'FAMILY_DERIVED' && (!tr.familyTrainingFunctionDerivations.some(d => d.productFamily === a.productFamily && d.trainingFunctionCode === a.functionCode)
      || !a.evidence.some(e => e.kind === 'FAMILY_DERIVATION'))) tIssues.push(issue('TRAINING_FAMILY_DERIVATION_INVALID', { functionCode: a.functionCode }, 'ERROR'));
    if (a.relationType === 'FAMILY_DERIVED' && product.primaryProductFamily?.code !== a.productFamily)
      crossIssues.push(issue('PRODUCT_TRAINING_FAMILY_CONFLICT', { productFamily: product.primaryProductFamily?.code, trainingFamily: a.productFamily }, 'ERROR'));
  }
  const functionOnly = training.resolutionState === 'SEMANTIC_COMPLETE' && training.trainingFunctions.length > 0 && training.exerciseCapabilities.length === 0;
  if (functionOnly) tIssues.push(issue('TRAINING_FUNCTION_ONLY_COMPLETE_SCOPE', { cause: 'Builder promotes any assignment to COMPLETE; classifier warns function does not establish exercise completeness', acceptedPolicyComplete: policy.get(productId)?.resolutionState === 'SEMANTIC_COMPLETE' }));
  const negative = training.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && !negativeInvalid(training);
  // A carried-forward state is not a reviewed negative justification. Preserve state, expose evidence gap.
  const negativeEvidence = negative && training.resolutionEvidence?.length > 0;
  if (negative && !negativeEvidence) tIssues.push(issue('TRAINING_NEGATIVE_EVIDENCE_NOT_PERSISTED', { coverage: training.coverageStatus,
    replayCoverage: v1Replay.coverageStatus, policyMember: policy.has(productId), policyReason: policy.get(productId)?.reason ?? null }));
  const tPositiveAccepted = !tIssues.some(i => i.severity === 'ERROR') && training.exerciseCapabilities.length + training.trainingFunctions.length > 0
    && !training.trainingFunctions.some(a => a.relationType === 'FAMILY_DERIVED' && !pEvidenceAccepted);
  const tEvidenceAccepted = negative ? !!negativeEvidence : tPositiveAccepted;
  let tState = ({ SEMANTIC_COMPLETE: 'VERIFIED', VERIFIED_NO_APPLICABLE_CAPABILITY: 'VERIFIED_NOT_APPLICABLE', SEMANTIC_PARTIAL: 'PARTIAL',
    AMBIGUOUS: 'AMBIGUOUS', NEEDS_REVIEW: 'AMBIGUOUS', DATA_GAP: 'DATA_GAP', ONTOLOGY_GAP: 'ONTOLOGY_GAP', RULE_GAP: 'PARTIAL' })[training.resolutionState] ?? 'UNKNOWN';
  if (functionOnly) tState = 'PARTIAL';
  if (tIssues.some(i => i.severity === 'ERROR')) tState = 'INVALID_STATE';
  const ss = specsById.get(productId) ?? [], parsed = ss.filter(s => s.status === 'parsed'), ambiguous = ss.filter(s => s.status === 'ambiguous'), unsupported = ss.filter(s => s.status === 'unsupported');
  const sStructural = ss.every(s => bundle.specsArtifactSchema.safeParse({ ...projections.specs, records: [s] }).success);
  if (!sStructural) sIssues.push(issue('SPEC_SCHEMA_INVALID', {}, 'ERROR'));
  const specGroups = Map.groupBy(ss, s => s.key), duplicates = [];
  for (const [k, group] of specGroups) {
    if (group.length > 1) duplicates.push({ key: k, count: group.length });
    const values = new Set(group.filter(s => s.status === 'parsed').map(s => `${s.value}/${s.unit}`));
    if (values.size > 1) sIssues.push(issue('SPEC_CONFLICTING_VALUES', { key: k, values: [...values] }, 'CONFLICT'));
    const rawValues = new Set(group.map(measurementCandidate).filter(c => c.value !== null).map(c => c.value));
    if (rawValues.size > 1) sIssues.push(issue('SPEC_CONFLICTING_RAW_CANDIDATES', { key: k, values: [...rawValues], cause: 'buildSpecs demoted differing parsed candidates to ambiguous' }, 'CONFLICT'));
    if (new Set(group.map(s => `${s.sourceFeature.featureId}/${s.sourceFeature.featureValueId}`)).size !== group.length)
      sIssues.push(issue('SPEC_DUPLICATE_SOURCE', { key: k }, 'ERROR'));
  }
  if (duplicates.length) sIssues.push(issue('SPEC_MULTIPLE_ASSIGNMENTS', { keys: duplicates }));
  for (const s of ss) {
    if (s.unit !== (s.key.endsWith('_kg') ? 'kg' : 'cm')) sIssues.push(issue('SPEC_UNIT_KEY_CONFLICT', { key: s.key, unit: s.unit }, 'ERROR'));
    if (!p.features?.some(f => f.featureId === s.sourceFeature.featureId && f.featureValueId === s.sourceFeature.featureValueId && (f.value ?? '') === s.rawValue))
      crossIssues.push(issue('SPEC_SOURCE_REFERENCE_INVALID', { key: s.key, source: s.sourceFeature }, 'ERROR'));
    if (s.catalogPresence !== p.catalogPresence) crossIssues.push(issue('SPEC_PRESENCE_CONFLICT', { key: s.key }, 'ERROR'));
  }
  if (ambiguous.length) sIssues.push(issue('SPEC_AMBIGUOUS', { keys: unique(ambiguous.map(s => s.key)), rules: unique(ambiguous.map(s => s.derivationRule)) }));
  if (unsupported.length) sIssues.push(issue('SPEC_UNSUPPORTED', { keys: unique(unsupported.map(s => s.key)) }));
  const ignoredTechnical = (p.features ?? []).filter(f => features.get(String(f.featureId))?.trustClass === 'TECHNICAL' && ![3, 11, 12, 15, 41].includes(f.featureId));
  if (ignoredTechnical.length) sIssues.push(issue('SPEC_TECHNICAL_FEATURE_OUTSIDE_ADAPTER', { featureIds: unique(ignoredTechnical.map(f => f.featureId)), scope: 'coverage gap, not proof each feature requires normalized spec' }));
  let sState = !ss.length ? 'UNKNOWN' : unsupported.length ? (parsed.length || ambiguous.length ? 'PARTIAL' : 'DATA_GAP')
    : ambiguous.length ? (parsed.length ? 'PARTIAL' : 'AMBIGUOUS') : 'VERIFIED';
  if (sIssues.some(i => i.severity === 'CONFLICT')) sState = 'SOURCE_CONFLICT';
  if (sIssues.some(i => i.severity === 'ERROR')) sState = 'INVALID_STATE';
  if (!ss.length) sIssues.push(issue('SPEC_ABSENCE_APPLICABILITY_UNKNOWN', { historical: p.catalogPresence !== 'current_catalog' }));
  const missingCat = (p.categoryIds ?? []).filter(c => !categories.has(String(c.categoryId)));
  const missingFeat = (p.features ?? []).filter(f => !features.has(String(f.featureId)));
  if (missingCat.length) trustIssues.push(issue('CATEGORY_TRUST_MISSING', { categoryIds: missingCat.map(c => c.categoryId) }));
  if (missingFeat.length) trustIssues.push(issue('FEATURE_TRUST_MISSING', { featureIds: unique(missingFeat.map(f => f.featureId)) }));
  const cState = p.categoryIds === null ? 'UNKNOWN' : missingCat.length ? 'DATA_GAP' : 'VERIFIED';
  const fState = p.features === null ? 'UNKNOWN' : missingFeat.length ? 'DATA_GAP' : 'VERIFIED';
  trustIssues.push(issue('TRUST_RUNTIME_STATIC_AUTHORITY', { consumedByCategorySelection: false, categorySelectionAuthority: 'static-category-trust-map' }));
  const trustState = [cState, fState].includes('DATA_GAP') ? 'DATA_GAP' : 'PARTIAL';
  const trainingRequired = training.exerciseCapabilities.length + training.trainingFunctions.length > 0 || tr.familyTrainingFunctionDerivations.some(d => d.productFamily === product.primaryProductFamily?.code) ? 'YES' : 'UNKNOWN';
  const specsRequired = 'UNKNOWN'; // No contract maps Product Family to required normalized attributes.
  const blocking = [issue('DIMENSION_REQUIREMENTS_UNDEFINED', { trainingRequired, specsRequired, productFamily: product.primaryProductFamily?.code ?? null }),
    ...pIssues, ...tIssues, ...sIssues, ...trustIssues, ...crossIssues];
  let consolidation = 'REVIEW_REQUIRED';
  if ([pState, tState, sState].includes('INVALID_STATE') || crossIssues.some(i => i.severity === 'ERROR')) consolidation = 'INVALID';
  else if ([pState, sState].includes('SOURCE_CONFLICT') || crossIssues.some(i => i.severity === 'CONFLICT')) consolidation = 'BLOCKED_BY_CONFLICT';
  else if (trainingRequired === 'YES' && tState === 'ONTOLOGY_GAP') consolidation = 'BLOCKED_BY_ONTOLOGY';
  else if (trainingRequired === 'YES' && tState === 'DATA_GAP') consolidation = 'BLOCKED_BY_DATA';
  else if ([pState, tState, sState].includes('AMBIGUOUS') || pState === 'UNKNOWN') consolidation = 'REVIEW_REQUIRED';
  else consolidation = 'PARTIALLY_CONSOLIDATED';
  // Unknown applicability is never silently relaxed into consolidated, even for services.
  const excluded = product.classificationStatus === 'EXCLUDED_NON_PRODUCT';
  const current = p.catalogPresence === 'current_catalog';
  const hasProductTag = tags(product).some(t => !ontology.isResidualOntologyTag(t.axis, t.code, ps.ontologyVersion));
  const runtimeProduct = current && !excluded && hasProductTag;
  const runtimeTraining = training.resolutionState === 'SEMANTIC_COMPLETE' && training.exerciseCapabilities.length + training.trainingFunctions.length > 0;
  const safeProduct = runtimeProduct && pEvidenceAccepted && pState === 'VERIFIED';
  const safeTraining = runtimeTraining && current && !excluded && tState === 'VERIFIED' && tEvidenceAccepted && !crossIssues.some(i => i.severity === 'ERROR');
  const surface = (runtimeEligibility, recommendation, reasons, contract) => ({ runtimeEligibility, recommendation, reasons, contract, deployedEligibility: 'UNKNOWN' });
  const admission = {
    LEXICAL_SEARCH: surface(!current || p.active === false ? 'NO' : 'UNKNOWN', !current || p.active === false ? 'NO' : 'UNKNOWN', ['listing/visibility absent from offline extraction; active alone insufficient'], 'CatalogContractService.search: active && listed'),
    PRODUCT_CONTEXT: surface(current ? 'YES' : 'NO', current ? 'YES' : 'NO', ['offline existence only; live DB may differ'], 'CatalogContractService.getProductContext: product existence; inactive permitted'),
    COMMERCIAL_PURCHASE: surface(!current || p.active === false ? 'NO' : 'UNKNOWN', !current || p.active === false ? 'NO' : 'UNKNOWN', ['orderable/listed/stock/backorder/pricing absent; variants need itemKey'], 'commercialEngine.deriveSellability'),
    PRODUCT_SEMANTIC_DISCOVERY: surface(runtimeProduct ? 'YES' : 'NO', safeProduct ? 'YES' : runtimeProduct ? 'PARTIAL' : 'NO', pIssues.map(i => i.code), 'addProductFacts: current/non-excluded/non-residual tags'),
    TRAINING_DISCOVERY: surface(runtimeTraining ? 'YES' : 'NO', safeTraining ? 'YES' : runtimeTraining ? 'REVIEW_REQUIRED' : 'NO',
      [...tIssues.map(i => i.code), ...(!current ? ['TRAINING_INDEX_LACKS_CURRENT_GATE'] : []), ...(excluded ? ['TRAINING_INDEX_LACKS_NON_PRODUCT_GATE'] : [])], 'addTrainingFacts/buildIndex: SEMANTIC_COMPLETE only'),
    SPEC_FILTERING: surface('NO_CONTRACT', current && sState === 'VERIFIED' ? 'CANDIDATE' : current && parsed.length ? 'PARTIAL' : 'UNKNOWN', sIssues.map(i => i.code), 'normalized specs exposed in internal context; filtering admission contract absent'),
    FUTURE_UNIFIED_RETRIEVAL: surface('NO_CONTRACT', 'REVIEW_REQUIRED', ['DIMENSION_REQUIREMENTS_UNDEFINED', 'UNIFIED_ADMISSION_CONTRACT_ABSENT'], null),
  };
  if (runtimeTraining && !current) crossIssues.push(issue('TRAINING_HISTORICAL_DISCOVERY_EXPOSURE', { scope: 'unrestricted Training-only queries; Product-axis required conjunction filters these' }, 'CONFLICT'));
  if (runtimeTraining && excluded) crossIssues.push(issue('TRAINING_NON_PRODUCT_DISCOVERY_EXPOSURE', {}, 'CONFLICT'));
  if (crossIssues.some(i => i.severity === 'CONFLICT') && consolidation !== 'INVALID') consolidation = 'BLOCKED_BY_CONFLICT';
  for (const c of crossIssues) if (!blocking.includes(c)) blocking.push(c);
  if (!current) warnings.push(issue('HISTORICAL_ACTIVE_UNKNOWN', { activeTrainingRelevantIsNotCommercialActive: training.activeTrainingRelevant }));
  const structural = sourceStructural && productStructural && trainingStructural && v1Structural && sStructural;
  const dimensionTerminal = terminal(pState) && terminal(tState) && terminal(sState);
  rows.push({ productId, canonicalProductKey: key, name: p.name, presenceState: p.catalogPresence,
    currentHistorical: current ? 'CURRENT' : 'HISTORICAL', activeInactive: p.active === null ? 'UNKNOWN' : p.active ? 'ACTIVE' : 'INACTIVE',
    productSemanticsState: pState, productFamily: product.primaryProductFamily?.code ?? null, classificationStatus: product.classificationStatus,
    secondaryProductFamilies: product.secondaryProductFamilies, disciplines: product.disciplines, useContexts: product.useContexts,
    productSemanticsEvidenceStrength: { sources: unique(product.provenance.evidence.map(e => e.sourceType)), confidences: unique(tags(product).map(t => t.confidence)), accepted: pEvidenceAccepted },
    productSemanticsEvidence: product.provenance, productSemanticsIssues: pIssues, trainingRequired, trainingSemanticsState: tState,
    trainingResolutionState: training.resolutionState, trainingCoverageStatus: training.coverageStatus, activeTrainingRelevant: training.activeTrainingRelevant,
    trainingResolved: training.resolved, exerciseCapabilityCount: training.exerciseCapabilities.length, trainingFunctionCount: training.trainingFunctions.length,
    trainingEvidenceStrength: { sources: unique([...training.exerciseCapabilities, ...training.trainingFunctions].flatMap(a => a.evidence.map(e => e.kind))),
      confidences: unique([...training.exerciseCapabilities, ...training.trainingFunctions].map(a => a.classificationConfidence)), accepted: tEvidenceAccepted,
      negativeEvidencePersisted: !!negativeEvidence, policyMember: policy.has(productId) }, trainingIssues: tIssues,
    exerciseCapabilities: training.exerciseCapabilities, trainingFunctions: training.trainingFunctions,
    derived: { bodyRegions: unique(training.exerciseCapabilities.flatMap(a => trainingRegistry.deriveExerciseSemantics(a.capabilityCode).bodyRegions)),
      primaryMuscleGroups: unique(training.exerciseCapabilities.flatMap(a => trainingRegistry.deriveExerciseSemantics(a.capabilityCode).primaryMuscleGroups)),
      secondaryMuscleGroups: unique(training.exerciseCapabilities.flatMap(a => trainingRegistry.deriveExerciseSemantics(a.capabilityCode).secondaryMuscleGroups)),
      trainingPatterns: unique(training.exerciseCapabilities.flatMap(a => trainingRegistry.deriveExerciseSemantics(a.capabilityCode).trainingPatterns)) },
    trainingV1: { coverageStatus: v1.coverageStatus, assignmentCount: v1.assignments.length, structuralValid: v1Structural,
      state: v1.assignments.length ? 'VERIFIED' : ({ NO_CAPABILITY_APPLICABLE: 'VERIFIED_NOT_APPLICABLE', UNMODELED: 'ONTOLOGY_GAP', INSUFFICIENT_EVIDENCE: 'DATA_GAP', NEEDS_REVIEW: 'AMBIGUOUS' })[v1.coverageStatus] },
    specsRequired, specsState: sState, specCount: ss.length, parsedSpecCount: parsed.length, ambiguousSpecCount: ambiguous.length,
    unsupportedSpecCount: unsupported.length, specIssues: sIssues, specs: ss, categoryTrustState: cState, featureTrustState: fState,
    categoryTrustClasses: unique((p.categoryIds ?? []).map(c => categories.get(String(c.categoryId))?.trustClass ?? 'MISSING')),
    featureTrustClasses: unique((p.features ?? []).map(f => features.get(String(f.featureId))?.trustClass ?? 'MISSING')),
    trustState, trustIssues, crossProjectionIssues: crossIssues, semanticConsolidationState: consolidation,
    platformProjectionStates: { relationships: 'UNAVAILABLE_PROJECTION', capabilities: 'UNAVAILABLE_PROJECTION', requiredForConsolidation: false },
    admissionRecommendation: admission, blockingReasons: blocking, warnings,
    structuralValidity: { source: sourceStructural, product: productStructural, trainingV1: v1Structural, trainingV2: trainingStructural, specs: sStructural, all: structural },
    ladder: { L0_PRESENT: true, L1_STRUCTURALLY_VALID: structural, L2_REQUIRED_SEMANTICALLY_RESOLVED: false, L3_REQUIRED_EVIDENCE_BACKED: false,
      L4_REQUIRED_CROSS_VALIDATED: false, L5_DESIGNATED_SURFACE_ADMITTED: false },
    ladderAssessment: { L0_PRESENT: 'CERTIFIED', L1_STRUCTURALLY_VALID: structural ? 'CERTIFIED' : 'FAILED',
      L2_REQUIRED_SEMANTICALLY_RESOLVED: 'NOT_EVALUABLE_REQUIREMENTS_UNKNOWN', L3_REQUIRED_EVIDENCE_BACKED: 'NOT_EVALUABLE_REQUIREMENTS_UNKNOWN',
      L4_REQUIRED_CROSS_VALIDATED: 'NOT_EVALUABLE_REQUIREMENTS_UNKNOWN', L5_DESIGNATED_SURFACE_ADMITTED: 'NO_GLOBAL_ADMISSION_CONTRACT' },
    observedDimensionChecks: { allPublishedDimensionsTerminal: dimensionTerminal, allTerminalEvidenceAccepted: dimensionTerminal && pEvidenceAccepted && tEvidenceAccepted,
      crossProjectionKnownInvariantsPass: !crossIssues.length && ![...pIssues, ...tIssues, ...sIssues].some(i => ['ERROR', 'CONFLICT'].includes(i.severity)) },
  });
}
const allIssues = r => [...r.productSemanticsIssues, ...r.trainingIssues, ...r.specIssues, ...r.trustIssues, ...r.crossProjectionIssues];
const hasIssue = (r, code) => allIssues(r).some(i => i.code === code);
const populations = { ALL_CANONICAL_PRODUCTS: rows, CURRENT_PRODUCTS: rows.filter(r => r.currentHistorical === 'CURRENT'),
  HISTORICAL_PRODUCTS: rows.filter(r => r.currentHistorical === 'HISTORICAL'), ACTIVE_PRODUCTS: rows.filter(r => r.activeInactive === 'ACTIVE'),
  INACTIVE_PRODUCTS: rows.filter(r => r.activeInactive === 'INACTIVE') };
const consolidationStates = ['CONSOLIDATED', 'CONSOLIDATED_WITH_NOT_APPLICABLE', 'PARTIALLY_CONSOLIDATED', 'REVIEW_REQUIRED', 'BLOCKED_BY_DATA', 'BLOCKED_BY_ONTOLOGY', 'BLOCKED_BY_CONFLICT', 'INVALID'];
const aggregates = Object.fromEntries(Object.entries(populations).map(([k, pop]) => [k, { denominator: pop.length,
  consolidation: Object.fromEntries(consolidationStates.map(s => [s, rate(pop.filter(r => r.semanticConsolidationState === s).length, pop.length, k)])),
  dimensions: Object.fromEntries(['productSemanticsState', 'trainingSemanticsState', 'specsState', 'trustState'].map(d => [d, counts(pop, r => r[d])])),
  certifiedConsolidated: rate(pop.filter(r => ['CONSOLIDATED', 'CONSOLIDATED_WITH_NOT_APPLICABLE'].includes(r.semanticConsolidationState)).length, pop.length, 'certifiable lower bound; actual unknown'),
  actualGenuinelyConsolidated: { count: null, percentage: null, denominator: pop.length, reason: 'Required-dimension contract absent' },
  ladder: Object.fromEntries(Object.keys(rows[0].ladder).map(l => [l, rate(pop.filter(r => r.ladder[l]).length, pop.length, k)])),
  ladderAssessment: Object.fromEntries(Object.keys(rows[0].ladderAssessment).map(l => [l, counts(pop, r => r.ladderAssessment[l])])),
  surfaceAdmission: Object.fromEntries(Object.keys(rows[0].admissionRecommendation).map(s => [s, {
    runtimeEligibility: counts(pop, r => r.admissionRecommendation[s].runtimeEligibility), recommendation: counts(pop, r => r.admissionRecommendation[s].recommendation) }])),
  issueProducts: { invalid: pop.filter(r => r.semanticConsolidationState === 'INVALID').length,
    ambiguity: pop.filter(r => r.ambiguousSpecCount || [r.productSemanticsState, r.trainingSemanticsState, r.specsState].includes('AMBIGUOUS')).length,
    dataGap: pop.filter(r => [r.trainingSemanticsState, r.specsState, r.categoryTrustState, r.featureTrustState].includes('DATA_GAP')).length,
    ontologyGap: pop.filter(r => r.trainingSemanticsState === 'ONTOLOGY_GAP').length,
    sourceConflict: pop.filter(r => r.crossProjectionIssues.some(i => i.severity === 'CONFLICT') || r.specsState === 'SOURCE_CONFLICT').length } }]));
const gapDefinitions = {
  DIMENSION_REQUIREMENTS_UNDEFINED: ['platform', 'CRITICAL', 'No required-dimension contract by family/surface; applicability unknown', 'POLICY_CONTRACT', true, false, false, false],
  UNIFIED_ADMISSION_CONTRACT_ABSENT: ['platform', 'CRITICAL', 'No unified per-product gate', 'ADMISSION_CONTRACT', true, false, false, false],
  TRAINING_NEGATIVE_WITH_ASSIGNMENTS: ['trainingV2', 'HIGH', 'Frozen per-id resolution policy overrides positive assignments; known 51 baseline', 'POLICY_ADJUDICATION_AND_VALIDATOR', true, false, false, true],
  TRAINING_NEGATIVE_EVIDENCE_NOT_PERSISTED: ['trainingV2', 'HIGH', 'No resolutionEvidence; coverage fallback or preserved baseline reason alone', 'NEGATIVE_EVIDENCE_CONTRACT', true, false, true, true],
  TRAINING_FUNCTION_ONLY_COMPLETE_SCOPE: ['trainingV2', 'HIGH', 'Any assignment promoted to SEMANTIC_COMPLETE although function is not exercise completeness', 'RESOLUTION_SCOPE_POLICY', true, false, false, false],
  PRODUCT_WEAK_CATEGORY_TERMINAL: ['product', 'MEDIUM', 'PRODUCT_FAMILY permits a sole SEMANTIC_WEAK category to produce CLASSIFIED', 'EVIDENCE_POLICY_REVIEW', true, false, false, true],
  PRODUCT_FAMILY_UNRESOLVED: ['product', 'MEDIUM', 'OTHER has no causal gap taxonomy', 'DIAGNOSTIC_THEN_ADJUDICATION', false, false, true, true],
  PRODUCT_HISTORICAL_PARTIAL: ['product', 'LOW', 'PARTIALLY_CLASSIFIED is historical scope; missing metadata is unknown', 'HISTORICAL_SCOPE_POLICY', true, false, true, false],
  HISTORICAL_POLICY_IMPLEMENTATION_CONFLICT: ['product', 'MEDIUM', 'Global historical policy requires explicit discipline name; discipline-rules permits family inference', 'POLICY_ALIGNMENT', true, false, false, true],
  TRAINING_HISTORICAL_DISCOVERY_EXPOSURE: ['crossProjection', 'HIGH', 'Training-only index has no current membership filter', 'SURFACE_SCOPE_POLICY', true, false, false, false],
  TRAINING_NON_PRODUCT_DISCOVERY_EXPOSURE: ['crossProjection', 'HIGH', 'Training-only index has no non-product exclusion filter', 'SURFACE_SCOPE_POLICY', true, false, false, false],
  SPEC_AMBIGUOUS: ['specs', 'MEDIUM', 'Single-unit parser requires one number and exact kg/cm; dimensional labels required', 'PARSER_POLICY_AND_SOURCE_REVIEW', true, false, true, true],
  SPEC_UNSUPPORTED: ['specs', 'MEDIUM', 'No usable number in supported feature/label; unsupported is not not-applicable', 'SOURCE_DATA_REVIEW', false, false, true, true],
  SPEC_ABSENCE_APPLICABILITY_UNKNOWN: ['specs', 'MEDIUM', 'No supported feature or historical metadata; no family applicability policy', 'SPEC_APPLICABILITY_CONTRACT', true, false, true, false],
  SPEC_TECHNICAL_FEATURE_OUTSIDE_ADAPTER: ['specs', 'MEDIUM', 'Only feature ids 3,11,12,15,41 normalized; other technical fields retained only in source', 'SPEC_SCOPE_DESIGN', true, true, false, false],
  SPEC_MULTIPLE_ASSIGNMENTS: ['specs', 'LOW', 'Multiple source feature values for one spec key; requires equivalence or variant semantics', 'MULTIVALUE_POLICY', true, false, true, true],
  SPEC_CONFLICTING_RAW_CANDIDATES: ['specs', 'HIGH', 'Different values for the same product/key were nulled into ambiguous by buildSpecs', 'SOURCE_MULTIVALUE_ADJUDICATION', true, false, true, true],
  TRUST_RUNTIME_STATIC_AUTHORITY: ['trust', 'HIGH', 'Bundle publishes hashes; selection uses generated static map with independent hash', 'AUTHORITY_ALIGNMENT', true, false, false, false],
};
const gapInventory = [];
for (const [code, def] of Object.entries(gapDefinitions)) {
  const affected = ['DIMENSION_REQUIREMENTS_UNDEFINED', 'UNIFIED_ADMISSION_CONTRACT_ABSENT'].includes(code) ? rows : rows.filter(r => hasIssue(r, code));
  if (!affected.length) continue;
  const [projection, severity, cause, fixType, requiresPolicyChange, requiresOntologyChange, requiresSourceData, requiresManualReview] = def;
  gapInventory.push({ gapId: code, projection, affectedProductCount: affected.length, affectedCurrentProductCount: affected.filter(r => r.currentHistorical === 'CURRENT').length,
    affectedActiveProductCount: affected.filter(r => r.activeInactive === 'ACTIVE').length, severity, cause, fixType, requiresPolicyChange,
    requiresOntologyChange, requiresSourceData, requiresManualReview, blocksUnifiedRetrieval: true, affectedProductIds: affected.map(r => r.productId),
    certainty: 'observed gap; proposed remedy not executed', autoFixableNow: false });
}
for (const [state, fixType] of [['ONTOLOGY_GAP', 'REQUIRES_ONTOLOGY_WORK'], ['DATA_GAP', 'REQUIRES_SOURCE_DATA']]) {
  const affected = rows.filter(r => r.trainingSemanticsState === state);
  gapInventory.push({ gapId: `TRAINING_${state}`, projection: 'trainingV2', affectedProductCount: affected.length,
    affectedCurrentProductCount: affected.filter(r => r.currentHistorical === 'CURRENT').length, affectedActiveProductCount: affected.filter(r => r.activeInactive === 'ACTIVE').length,
    severity: 'MEDIUM', cause: state === 'ONTOLOGY_GAP' ? 'UNMODELED/no positive assignments -> ONTOLOGY_GAP; actual rule-vs-ontology cause not disambiguated' : 'Explicit resolution policy or INSUFFICIENT_EVIDENCE',
    fixType, requiresPolicyChange: false, requiresOntologyChange: state === 'ONTOLOGY_GAP', requiresSourceData: state === 'DATA_GAP', requiresManualReview: true,
    blocksUnifiedRetrieval: 'POLICY_DEPENDENT', affectedProductIds: affected.map(r => r.productId), autoFixableNow: false });
}
for (const projection of ['relationships', 'capabilities']) gapInventory.push({ gapId: `${projection.toUpperCase()}_UNAVAILABLE_PLATFORM`, projection, affectedProductCount: null,
  affectedCurrentProductCount: null, affectedActiveProductCount: null, severity: 'INFO', cause: manifest.projections[projection].reason,
  fixType: 'VERIFIED_OFFLINE_ADAPTER', requiresPolicyChange: false, requiresOntologyChange: false, requiresSourceData: true, requiresManualReview: false,
  blocksUnifiedRetrieval: 'ONLY_IF_SURFACE_EXPLICITLY_REQUIRES', affectedProductIds: [], autoFixableNow: false });
const review = rows.filter(r => r.semanticConsolidationState === 'INVALID' || r.productSemanticsState === 'SOURCE_CONFLICT' || r.productSemanticsState === 'UNKNOWN'
  || hasIssue(r, 'PRODUCT_WEAK_CATEGORY_TERMINAL') || r.ambiguousSpecCount || r.unsupportedSpecCount || r.trainingSemanticsState === 'AMBIGUOUS' || r.trainingSemanticsState === 'DATA_GAP')
  .map(r => ({ productId: r.productId, canonicalProductKey: r.canonicalProductKey, name: r.name, currentHistorical: r.currentHistorical,
    activeInactive: r.activeInactive, commerciallySellable: r.admissionRecommendation.COMMERCIAL_PURCHASE.recommendation,
    priority: r.activeInactive === 'ACTIVE' && (r.semanticConsolidationState === 'INVALID' || r.productSemanticsState === 'SOURCE_CONFLICT') ? 'P0'
      : r.activeInactive === 'ACTIVE' ? 'P1' : r.currentHistorical === 'CURRENT' ? 'P2' : 'P3',
    semanticConsolidationState: r.semanticConsolidationState,
    queues: unique(['REQUIRES_HUMAN_REVIEW', ...(r.trainingSemanticsState === 'ONTOLOGY_GAP' ? ['REQUIRES_ONTOLOGY_WORK'] : []),
      ...(r.trainingSemanticsState === 'DATA_GAP' || r.unsupportedSpecCount || r.productSemanticsState === 'UNKNOWN' ? ['REQUIRES_SOURCE_DATA'] : [])]),
    reasons: unique(allIssues(r).filter(i => !['TRUST_RUNTIME_STATIC_AUTHORITY', 'PRODUCT_HISTORICAL_PARTIAL', 'SPEC_TECHNICAL_FEATURE_OUTSIDE_ADAPTER', 'SPEC_ABSENCE_APPLICABILITY_UNKNOWN'].includes(i.code)).map(i => i.code)) }))
  .sort((a, b) => a.priority.localeCompare(b.priority) || a.productId - b.productId);
const queues = { AUTO_FIXABLE_BY_POLICY: { count: 0, denominator: rows.length, reason: 'No approved deterministic remediation demonstrated; a proposed policy is not an executable fix' },
  REQUIRES_ONTOLOGY_WORK: { productIds: rows.filter(r => r.trainingSemanticsState === 'ONTOLOGY_GAP').map(r => r.productId), certainty: '753 labels need diagnosis; not proof all need new ontology' },
  REQUIRES_SOURCE_DATA: { productIds: rows.filter(r => r.trainingSemanticsState === 'DATA_GAP' || r.unsupportedSpecCount || r.productSemanticsState === 'UNKNOWN').map(r => r.productId) },
  REQUIRES_HUMAN_REVIEW: { productIds: review.map(r => r.productId), certainty: 'Prioritized candidate pool, not proof each needs manual correction' },
  NEGATIVE_EVIDENCE_POLICY_POOL: { productIds: rows.filter(r => hasIssue(r, 'TRAINING_NEGATIVE_EVIDENCE_NOT_PERSISTED')).map(r => r.productId), reason: 'Group policy/evidence review before creating 836 manual tasks' } };
const remediationQueues = rows.map(r => ({ productId: r.productId, canonicalProductKey: r.canonicalProductKey, name: r.name,
  currentHistorical: r.currentHistorical, activeInactive: r.activeInactive,
  priority: review.find(v => v.productId === r.productId)?.priority ?? (r.activeInactive === 'ACTIVE' ? 'P1' : r.currentHistorical === 'CURRENT' ? 'P2' : 'P3'),
  queues: Object.entries(queues).filter(([, q]) => q.productIds?.includes(r.productId)).map(([name]) => name),
  applicabilityPolicyPending: true, autoFixDemonstrated: false })).filter(r => r.queues.length);
const evidencePolicy = [
  { sources: ['NAME_TEXT', 'NAME'], domains: ['Product', 'Training'], authority: 'canonical product name and approved pattern/classifier rules',
    confidence: ['EXPLICIT', 'STRONGLY_INFERRED', 'HIGH'], autoResolution: 'YES_FOR_APPROVED_PATTERNS', combination: 'Dedicated-machine/accessory/category/feature guards where rule requires them',
    hintOnly: 'Generic exercise language routed to review/deferred, not positive terminal', source: 'product-family-rules.ts; training-semantic-classification*/rules.ts' },
  { sources: ['TRUSTED_CATEGORY'], domains: ['Product', 'Training'], authority: 'verified source CSV trust class + axis/rule gate',
    confidence: ['EXPLICIT', 'STRONGLY_INFERRED', 'HIGH', 'MEDIUM'], autoResolution: 'Product family permits STRONG/WEAK; discipline/context STRONG; Training STRONG HIGH, WEAK MEDIUM review-only',
    combination: 'Name precedence / hybrid policy / Training-specific guards; merged weak hints do not independently authorize assignments',
    hintOnly: 'Audit rejects sole weak Product facts for strong certification', source: 'global-rules.ts; product-family-rules.ts; training V2 rules.ts' },
  { sources: ['STRUCTURED_FEATURE'], domains: ['Product', 'Training'], authority: 'canonical feature value + trust class + explicit rule',
    confidence: ['EXPLICIT', 'STRONGLY_INFERRED', 'HIGH'], autoResolution: 'RULE_DEPENDENT', combination: 'Guarded cable requires strong category and feature; dedicated-family guarded name requires supporting features; Training uses SEMANTIC',
    hintOnly: 'TECHNICAL alone does not infer discipline/affinity; noise/presentation/logistics excluded from positive inference', source: 'product-family-rules.ts; use-context-rules.ts; training V2/V2.1 rules.ts' },
  { sources: ['FAMILY_INFERENCE'], domains: ['Product discipline'], authority: 'approved primary family plus discipline rule', confidence: ['STRONGLY_INFERRED'],
    autoResolution: 'Implementation YES; historical global-policy conflict flagged', combination: 'Parent family must have acceptable evidence', hintOnly: false, source: 'discipline-rules.ts; global-rules.ts' },
  { sources: ['FAMILY_DERIVATION'], domains: ['Training function'], authority: 'training registry approved CABLE_MACHINE -> CABLE_RESISTANCE mapping', confidence: ['HIGH'],
    autoResolution: 'YES_FOR_THIS_MAPPING_ONLY', combination: 'Parent family must be backed; exercises/anatomy cannot be derived from family/function', hintOnly: false,
    source: 'training-semantics-v2/registry.ts; validation.ts; training V2 rules.ts' },
  { sources: ['MANUAL_OVERRIDE'], domains: ['Training'], authority: 'explicit reviewed assignment/override provenance', confidence: ['EXPLICIT', 'HIGH', 'MEDIUM', 'LOW'],
    autoResolution: 'NO_NEW_AUTOMATIC_INFERENCE', combination: 'Accepted reviewState and provenance must remain valid; does not bypass state invariants', hintOnly: false,
    source: 'training-semantics/contracts.ts; v2-contracts.ts; classifier validation' },
];
const metrics = { definitions: { rate: 'count / exact denominator; percentage null when not measurable', terminal: 'VERIFIED or VERIFIED_NOT_APPLICABLE, separate from evidence acceptance',
  applicability: 'No total applicable denominator can be asserted for Training/Specs; observable canonical rates reported separately', crossProjection: 'Only documented invariants; no intuitive family/spec contradictions' }, populations: {} };
for (const [k, pop] of Object.entries(populations)) {
  const dimensions = {};
  for (const [d, structuralKey, evidenceKey] of [['productSemanticsState', 'product', 'productSemanticsEvidenceStrength'], ['trainingSemanticsState', 'trainingV2', 'trainingEvidenceStrength'], ['specsState', 'specs', null], ['trustState', null, null]]) {
    const eligible = d === 'specsState' ? pop.filter(r => r.specCount > 0) : pop;
    const terminals = eligible.filter(r => terminal(r[d]));
    dimensions[d] = { structuralValidity: rate(eligible.filter(r => structuralKey ? r.structuralValidity[structuralKey] : r.categoryTrustState !== 'DATA_GAP' && r.featureTrustState !== 'DATA_GAP').length, eligible.length, structuralKey ?? 'map references; not consumption'),
      semanticConsistency: rate(eligible.filter(r => r[d] !== 'INVALID_STATE' && r[d] !== 'SOURCE_CONFLICT').length, eligible.length, 'known invariants, not resolution'),
      terminalResolutionObserved: rate(terminals.length, eligible.length, 'observed records; not applicable population'),
      terminalResolutionApplicable: { count: null, denominator: null, percentage: null, reason: 'Applicability contract absent' },
      evidenceBackedResolution: rate(terminals.filter(r => evidenceKey ? r[evidenceKey].accepted : d === 'specsState' && r.parsedSpecCount === r.specCount).length, terminals.length, 'accepted terminal evidence; audit stricter than presence'),
      stateRates: Object.fromEntries(['AMBIGUOUS', 'DATA_GAP', 'ONTOLOGY_GAP', 'SOURCE_CONFLICT', 'INVALID_STATE', 'VERIFIED_NOT_APPLICABLE', 'PARTIAL', 'UNKNOWN'].map(s => [s, rate(eligible.filter(r => r[d] === s).length, eligible.length, d)])) };
  }
  metrics.populations[k] = { dimensions, structuralValidity: rate(pop.filter(r => r.structuralValidity.all).length, pop.length, k),
    crossProjectionCoherence: rate(pop.filter(r => r.observedDimensionChecks.crossProjectionKnownInvariantsPass).length, pop.length, 'documented invariants only'),
    crossProjectionConflict: rate(pop.filter(r => r.crossProjectionIssues.length > 0).length, pop.length, 'includes policy/scope conflicts'),
    issueRates: Object.fromEntries(Object.entries(aggregates[k].issueProducts).map(([i, n]) => [i, rate(n, pop.length, k)])) };
}
const specSummary = { records: specs.length, statuses: counts(specs, s => s.status), keys: counts(specs, s => s.key), units: counts(specs, s => s.unit),
  byRuleAndStatus: counts(specs, s => `${s.derivationRule}/${s.status}`), parseCandidateReasons: counts(specs, s => measurementCandidate(s).reason),
  conflictsBeforeNullingProducts: rows.filter(r => hasIssue(r, 'SPEC_CONFLICTING_RAW_CANDIDATES')).length,
  structuralValidity: rate(specs.filter(s => bundle.specsArtifactSchema.safeParse({ ...projections.specs, records: [s] }).success).length, specs.length, 'spec records'),
  semanticConsistency: rate(specs.filter(s => s.unit === (s.key.endsWith('_kg') ? 'kg' : 'cm') && !rows.find(r => r.canonicalProductKey === s.productKey)?.specIssues.some(i => ['SPEC_CONFLICTING_VALUES', 'SPEC_CONFLICTING_RAW_CANDIDATES', 'SPEC_DUPLICATE_SOURCE'].includes(i.code) && i.key === s.key)).length, specs.length, 'spec records'),
  normalizationMeaning: 'kg/cm target units; parser extracts explicit unit, does not convert g/lb/mm/m; raw source preserved',
  productDistribution: { withSpecs: rows.filter(r => r.specCount).length, withoutSpecs: rows.filter(r => !r.specCount).length,
    allParsed: rows.filter(r => r.specCount && r.parsedSpecCount === r.specCount).length,
    mixedParsedAmbiguous: rows.filter(r => r.parsedSpecCount && r.ambiguousSpecCount).length,
    onlyAmbiguous: rows.filter(r => r.specCount && r.ambiguousSpecCount === r.specCount).length,
    withUnsupported: rows.filter(r => r.unsupportedSpecCount).length, onlyUnsupported: rows.filter(r => r.specCount && r.unsupportedSpecCount === r.specCount).length },
  byFamily: Object.fromEntries(unique(rows.map(r => r.productFamily ?? 'UNKNOWN')).map(f => { const pop = rows.filter(r => (r.productFamily ?? 'UNKNOWN') === f); return [f, { denominator: pop.length, withSpecs: pop.filter(r => r.specCount).length,
    allParsed: pop.filter(r => r.specCount && r.parsedSpecCount === r.specCount).length, states: counts(pop, r => r.specsState), required: 'UNKNOWN' }]; })) };
const staticMap = await imp('src/domain/catalog/v2/categoryTrustMap.ts');
const sourceCategoryIds = unique(source.products.flatMap(p => (p.categoryIds ?? []).map(c => c.categoryId)));
const sourceFeatureIds = unique(source.products.flatMap(p => (p.features ?? []).map(f => f.featureId)));
const staticDifferences = categoryRows.filter(c => ['SEMANTIC_STRONG', 'SEMANTIC_WEAK'].includes(c.trustClass)
  ? staticMap.CATEGORY_TRUST_BY_ID.get(Number(c.categoryId)) !== c.trustClass : staticMap.CATEGORY_TRUST_BY_ID.has(Number(c.categoryId)))
  .map(c => ({ categoryId: Number(c.categoryId), extractionTrust: c.trustClass, staticTrust: staticMap.CATEGORY_TRUST_BY_ID.get(Number(c.categoryId)) ?? null,
    affectedProductIds: source.products.filter(p => p.categoryIds?.some(x => x.categoryId === Number(c.categoryId))).map(p => p.productId) }));
const trustSummary = { recordCountMeaning: '2 hash descriptors, not 2 mapping rows', categoryRows: categoryRows.length, featureRows: featureRows.length,
  categoryClasses: counts(categoryRows, c => c.trustClass), featureClasses: counts(featureRows, f => f.trustClass),
  categoryCoverage: rate(sourceCategoryIds.filter(id => categories.has(String(id))).length, sourceCategoryIds.length, 'distinct assigned canonical categories'),
  featureCoverage: rate(sourceFeatureIds.filter(id => features.has(String(id))).length, sourceFeatureIds.length, 'distinct assigned canonical features'),
  missingCategoryIds: sourceCategoryIds.filter(id => !categories.has(String(id))), missingFeatureIds: sourceFeatureIds.filter(id => !features.has(String(id))),
  duplicateCategoryIds: false, duplicateFeatureIds: false, categorySelectionAuthority: 'static-category-trust-map', consumedByCategorySelection: false,
  staticMapVersion: staticMap.CATEGORY_TRUST_MAP_VERSION, staticDifferences,
  consumers: ['Product classifier and Training classifier use verified CSV trust maps at build', 'Training V2 validates source trust hashes', 'runtime context/health publishes hash metadata', 'meaningfulCategory uses generated static map'],
  conflictResolution: 'Product: name rules before category vote; mutually-exclusive category votes -> NEEDS_REVIEW except approved hybrids; runtime: strong then deeper then lower id; loaders duplicate ids last wins (none here)' };
const extractionsAvailable = await Promise.all(Object.keys(before).filter(f => f.endsWith('/canonical_input.json')).map(async f => ({ file: f, hash: before[f], products: (await json(f)).products.length })));
const summary = { schemaVersion: 'cross-projection-audit-v1', date: '2026-10-05', timezone: 'America/Santiago', scope: 'OFFLINE_CANDIDATE_NOT_DEPLOYMENT',
  inputs: { sourceDir, bundleDir, sourceExtractionId: extraction.sourceExtractionId, aggregateContentHash: extraction.aggregateContentHash,
    projectionBundleId: manifest.projectionBundleId, manifestHash: hash(await readFile(path.join(bundleDir, 'manifest.json'))), codeRef: manifest.build.codeRef,
    expectedHistoricalSourceExtractionId: 'sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9',
    expectedPhysicalInput: 'artifacts/catalog-projection-input/2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26',
    expectedPhysicalInputPresent: await exists('artifacts/catalog-projection-input/2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26'),
    productionRootPointerPresent: await exists('artifacts/catalog-v2/control/active.json'), availableExtractions: extractionsAvailable,
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHashes },
  validation, domainReview: manifest.validation.domainReview, recordCounts: extraction.recordCounts,
  commercialPopulation: { count: null, denominator: rows.length, reason: 'offline extraction omits listing/orderable/stock/backorder/prices; current/active not sellability' },
  populations: aggregates, product: { lineage: { ontologyVersion: ps.ontologyVersion, ontologyHash: ps.ontologyHash, classifierVersion: ps.classifierVersion, snapshotId: ps.snapshotId },
    internalStates: counts(ps.records, p => p.classificationStatus), evidenceSources: counts(ps.records.flatMap(p => p.provenance.evidence), e => e.sourceType),
    weakCategoryTerminalProducts: rows.filter(r => hasIssue(r, 'PRODUCT_WEAK_CATEGORY_TERMINAL')).length,
    knownP22A: { shared: 2011, catV2Only: 37, legacyOnly: 0, legacyOnlyAssignments: [2186, 2188, 2301, 2302, 2303, 2306], authority: 'CAT_V2_PRIMARY', fallback: 'NO_ACTIVE_BUNDLE_ONLY' } },
  trainingV1: { counts: t1.counts, stateCounts: counts(rows, r => r.trainingV1.state), consumers: 'Internal runtime knowledge.trainingSemanticsV1CatV2; native V2 lineage source. Public training endpoints use V2.' },
  trainingV2: { lineage: { registryVersion: t2.registryVersion, registryHash: t2.registryHash, classifierVersion: t2.classifierVersion,
      rulesHash: t2.rulesHash, sourceV1SnapshotId: t2.sourceV1SnapshotId, snapshotId: t2.snapshotId, resolutionPolicy: projections.trainingSemanticsV2.inputs.resolutionPolicy },
    allInternalResolutionStates: counts(t2.records, t => t.resolutionState), allCoverageStates: counts(t2.records, t => t.coverageStatus),
    declaredCounts: t2.counts, validTerminalStates: rate(rows.filter(r => terminal(r.trainingSemanticsState)).length, rows.length, 'canonical observed states'),
    knownInvalidNegativeProductIds: rows.filter(r => hasIssue(r, 'TRAINING_NEGATIVE_WITH_ASSIGNMENTS')).map(r => r.productId),
    knownInvalidCurrent: rows.filter(r => hasIssue(r, 'TRAINING_NEGATIVE_WITH_ASSIGNMENTS') && r.currentHistorical === 'CURRENT').length,
    knownInvalidActive: rows.filter(r => hasIssue(r, 'TRAINING_NEGATIVE_WITH_ASSIGNMENTS') && r.activeInactive === 'ACTIVE').length,
    legacyKnownInvalidVerification: { file: legacyFile, fileHash: before[legacyFile], snapshotId: legacyTraining.snapshotId,
      denominator: legacyTraining.records.length, invalidProductIds: legacyInvalidIds, sameIdsAsNative: true,
      allInternalResolutionStates: counts(legacyTraining.records, r => r.resolutionState), validatorStatus: 'PASS_DESPITE_KNOWN_INVALID_SEMANTIC_PAIR' },
    cohortCommercialMembership: counts(rows.filter(r => r.activeTrainingRelevant), r => r.activeInactive),
    cohortValidTerminal: rate(rows.filter(r => r.activeTrainingRelevant && terminal(r.trainingSemanticsState)).length, rows.filter(r => r.activeTrainingRelevant).length, 'curated cohort; function-only partial audit'),
    cohortDeclaredResolvedMinusInvalid: rate(rows.filter(r => r.activeTrainingRelevant && r.trainingResolved && !hasIssue(r, 'TRAINING_NEGATIVE_WITH_ASSIGNMENTS')).length, rows.filter(r => r.activeTrainingRelevant).length, 'cohort only, label-valid after known invariant'),
    exerciseEvidenceKinds: counts(t2.records.flatMap(t => t.exerciseCapabilities.flatMap(a => a.evidence)), e => e.kind),
    functionEvidenceKinds: counts(t2.records.flatMap(t => t.trainingFunctions.flatMap(a => a.evidence)), e => e.kind),
    historicalTrainingDiscovery: rows.filter(r => hasIssue(r, 'TRAINING_HISTORICAL_DISCOVERY_EXPOSURE')).map(r => r.productId),
    nonProductTrainingDiscovery: rows.filter(r => hasIssue(r, 'TRAINING_NON_PRODUCT_DISCOVERY_EXPOSURE')).map(r => r.productId) },
  specs: specSummary, trust: trustSummary, platformUnavailable: { relationships: manifest.projections.relationships, capabilities: manifest.projections.capabilities, individualPenalty: false },
  sourceOrphanReferences: Object.fromEntries(Object.entries(source.orphanReferences).map(([name, refs]) => [name, { count: refs.length,
    affectedCanonicalProductIds: unique(refs.filter(ref => source.products.some(p => p.productId === ref.productId)).map(ref => ref.productId)),
    treatment: 'Retained in canonical orphanReferences; not merged into historical/current product metadata and not penalized automatically' }])),
  review: { count: review.length, denominator: rows.length, priorities: counts(review, r => r.priority), queues }, unifiedRetrievalReadiness: 'NOT_READY' };
assert.equal(rows.length, source.products.length);
assert.equal(new Set(rows.map(r => r.productId)).size, rows.length);
assert.equal(summary.trainingV2.knownInvalidNegativeProductIds.length, 51, 'Known negative-state baseline drift: investigate, do not silently normalize');
for (const [k, pop] of Object.entries(populations)) {
  assert.equal(Object.values(aggregates[k].consolidation).reduce((n, r) => n + r.count, 0), pop.length);
  assert(aggregates[k].certifiedConsolidated.count === 0, 'Cannot certify unknown applicability');
}
// Counterexample checks protect the audit's substantive boundaries, not the classifiers.
assert(negativeInvalid({ resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY', exerciseCapabilities: [{}], trainingFunctions: [] }));
assert(!negativeInvalid({ resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY', exerciseCapabilities: [], trainingFunctions: [] }));
assert(!terminal('UNKNOWN') && !terminal('PARTIAL') && terminal('VERIFIED_NOT_APPLICABLE'));
assert.equal(measurementCandidate({ key: 'weight_kg', unit: 'kg', rawValue: '12,5 kg.' }).value, 12.5);
assert.equal(measurementCandidate({ key: 'weight_kg', unit: 'kg', rawValue: '25 lbs' }).value, null);
assert.equal(measurementCandidate({ key: 'weight_kg', unit: 'kg', rawValue: '10 kg / 20 kg' }).value, null);
assert.equal(measurementCandidate({ key: 'assembled_width_cm', unit: 'cm', rawValue: 'Largo: 120 cm. Ancho: 84 cm. Alto: 79 cm.' }).value, 84);
assert(rows.filter(r => r.currentHistorical === 'HISTORICAL').every(r => r.admissionRecommendation.PRODUCT_SEMANTIC_DISCOVERY.runtimeEligibility === 'NO'));
assert(rows.filter(r => hasIssue(r, 'TRAINING_NEGATIVE_WITH_ASSIGNMENTS')).every(r => r.admissionRecommendation.TRAINING_DISCOVERY.runtimeEligibility === 'NO'));
const after = await fingerprint();
assert.deepEqual(after, before, 'Protected source/projection stores changed during audit');
const saveJson = (file, data) => writeFile(path.join(output, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
const saveCsv = (file, data, columns = Object.keys(data[0] ?? {})) => writeFile(path.join(output, file), csv.writeCsv(columns, data.map(r =>
  Object.fromEntries(columns.map(k => [k, typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : r[k]])))), 'utf8');
const codeFiles = (await Promise.all(['src', 'scripts'].map(walk))).flat().filter(f => f.endsWith('.ts')).sort();
const codeHashes = Object.fromEntries(await Promise.all([...codeFiles, 'package-lock.json', path.relative(root, fileURLToPath(import.meta.url)),
  'cross-projection-audit/invariants.md', 'cross-projection-audit/new-product-admission.md', policyFile].map(async f => [f.replaceAll('\\', '/'), hash(await readFile(f))])));
await Promise.all([saveJson('product-consolidation.json', { schemaVersion: summary.schemaVersion, inputs: summary.inputs, rows }), saveCsv('product-consolidation.csv', rows),
  saveJson('projection-summary.json', summary), saveJson('quality-metrics.json', metrics), saveJson('gap-inventory.json', gapInventory), saveCsv('gap-inventory.csv', gapInventory),
  saveJson('manual-review.json', { rows: review, queues }), saveCsv('manual-review.csv', review),
  saveJson('evidence-policy.json', { sources: evidencePolicy, notSources: ['DESCRIPTION is not admitted by current classifiers', 'coverageStatus and policy carry-forward reason are authority metadata, not persisted negative resolutionEvidence'],
    negativeEvidence: { persistedRecords: t2.records.filter(t => t.resolutionEvidence?.length).length, terminalEmptyNegativeRecords: rows.filter(r => hasIssue(r, 'TRAINING_NEGATIVE_EVIDENCE_NOT_PERSISTED')).length } }),
  saveCsv('remediation-queues.csv', remediationQueues),
  saveJson('verification.json', { status: 'PASS', protectedFiles: Object.keys(before).length, protectedBefore: before, protectedAfter: after,
    checks: ['source manifest/hashes/canonical byte form/counts', 'bundle identity/artifact hashes/schema/lineage/registry', 'one row per canonical id',
      'Product and Training classifier replay (in memory, no publication)', '51 known invalid-state baseline', 'population partitions and exact denominators',
      'negative-state and historical admission counterexamples', 'all artifacts/data bytes unchanged'], codeHashes })]);
// The narrative is generated below so every number is reproducible with the datasets.
const nIssue = code => rows.filter(r => hasIssue(r, code)).length;
const report = `# CAT-V2 Cross-projection Quality and Consolidation Audit

Fecha: 2026-10-05, America/Santiago. Auditoría offline del candidato local P2.2B; no verifica deployment ni activación. Sin fixes ni cambios en stores.

## 1. Executive conclusion

\`CANONICAL_PRODUCTS = ${rows.length}\`; \`CURRENT_PRODUCTS = ${populations.CURRENT_PRODUCTS.length}\`; \`ACTIVE_PRODUCTS = ${populations.ACTIVE_PRODUCTS.length}\`.

| Medida | Cantidad real | Porcentaje real / denominador | Límite inferior certificable |
|---|---|---|---|
| GENUINELY_CONSOLIDATED_ALL | No determinable | N/D / ${rows.length} | 0/${rows.length} (0%) |
| GENUINELY_CONSOLIDATED_CURRENT | No determinable | N/D / ${populations.CURRENT_PRODUCTS.length} | 0/${populations.CURRENT_PRODUCTS.length} (0%) |
| GENUINELY_CONSOLIDATED_ACTIVE | No determinable | N/D / ${populations.ACTIVE_PRODUCTS.length} | 0/${populations.ACTIVE_PRODUCTS.length} (0%) |

**Cero es el límite inferior certificable, no una afirmación de que todos los productos carecen de conocimiento válido.** No existe matriz de dimensiones obligatorias por familia ni admission contract de Unified Retrieval. Afirmar un porcentaje real con esas obligaciones desconocidas fabricaría certeza. Se miden las dimensiones y superficies conocidas por separado.

Extracción utilizada: \`${extraction.sourceExtractionId}\`, input físico \`${sourceDir}\`, bundle \`${manifest.projectionBundleId}\`. El hash histórico solicitado f505… y el directorio 2a552… no están disponibles localmente. Los tres inputs disponibles se enumeran en projection-summary.json: dos poblaciones de 2048 y un fixture de 3. No se puede afirmar identidad con la extracción histórica ausente. El baseline cardinal sí coincide íntegramente: ${JSON.stringify(extraction.recordCounts)}. Historical=${populations.HISTORICAL_PRODUCTS.length}; inactive=${populations.INACTIVE_PRODUCTS.length}, ambos separados de active desconocido histórico.

No hay \`artifacts/catalog-v2/control/active.json\` local; los pointers encontrados están en drills. Domain review del candidato=\`${manifest.validation.domainReview}\`. Los artifacts/hashes/lineage pasan los validadores reales, que no verifican todos los invariants semánticos.

## 2. Consolidation standard

Un producto queda consolidado solo si cada dimensión **exigida por un contrato explícito para su familia y superficie** alcanza estado terminal válido, con evidencia aceptable y sin conflicto conocido. VERIFIED_NOT_APPLICABLE es terminal; UNKNOWN, clasificación forzada, default negativo y ausencia de datos no lo son. Product family no basta para inventar obligaciones de Training o Specs. TrainingRequired=YES únicamente cuando hay assignments o derivación instrumental aprobada por registry; en los demás casos UNKNOWN. SpecsRequired=UNKNOWN para todos: no hay contrato de atributos obligatorios por familia. No se exige Training a toda la población ni se convierte falta de specs en DATA_GAP automáticamente.

States/mappings exactos y reglas de precedencia: [invariants.md](invariants.md). Product \`CLASSIFIED\` acredita familia y hechos emitidos, no resolución de todo eje vacío. Histórico \`PARTIALLY_CLASSIFIED\` refleja scope contractual. \`OTHER\` conserva UNKNOWN: no prueba por sí solo ontology gap. Training negativo sin assignments conserva VERIFIED_NOT_APPLICABLE como estado declarado válido, pero no acredita evidencia negativa persistida. Trust hashes válidos acreditan publicación/build inputs, no gobierno del runtime.

Estados transversales: VERIFIED, VERIFIED_NOT_APPLICABLE, PARTIAL, AMBIGUOUS, DATA_GAP, ONTOLOGY_GAP, SOURCE_CONFLICT, INVALID_STATE, UNAVAILABLE_PROJECTION, NOT_REQUIRED, UNKNOWN. NOT_REQUIRED se reserva para exención contractual; no se asigna silenciosamente. Relationships/Capabilities son UNAVAILABLE_PROJECTION de plataforma y no penalizan productos.

### Resultados con denominadores separados

| Estado | All (${rows.length}) | Current (${populations.CURRENT_PRODUCTS.length}) | Active (${populations.ACTIVE_PRODUCTS.length}) |
|---|---:|---:|---:|
${consolidationStates.map(s => `| ${s} | ${['ALL_CANONICAL_PRODUCTS', 'CURRENT_PRODUCTS', 'ACTIVE_PRODUCTS'].map(k => { const x = aggregates[k].consolidation[s]; return `${x.count}/${x.denominator} (${x.percentage}%)`; }).join(' | ')} |`).join('\n')}

Precedencia: INVALID antes de conflictos; después blockers de Training **solo si TrainingRequired=YES**; ambiguity/familia UNKNOWN -> REVIEW_REQUIRED; resto PARTIALLY_CONSOLIDATED por obligaciones pendientes. Estados blocked por data/ontology pueden ser cero aunque existan gaps dimensionales: no se presume que Training sea obligatorio para todos.

## 3. Consolidation ladder

| Nivel acumulativo | All | Current | Active |
|---|---:|---:|---:|
${Object.keys(rows[0].ladder).map(l => `| ${l} | ${['ALL_CANONICAL_PRODUCTS', 'CURRENT_PRODUCTS', 'ACTIVE_PRODUCTS'].map(k => { const m = aggregates[k].ladder[l]; return `${m.count}/${m.denominator} (${m.percentage}%)`; }).join(' | ')} |`).join('\n')}

L0 exige presencia canónica; L1 records/source y proyecciones presentes con schemas válidos. L2 necesita conocer y resolver obligaciones; L3 añade evidencia; L4 añade cross-invariants; L5 añade admisión designada. Desde L2, 0 certificado / población significa **no evaluable**, no fallo demostrado de todos. El ladder estricto no se sustituye por un número de productos clasificados. Checks auxiliares de dimensiones publicadas: ${rows.filter(r => r.observedDimensionChecks.allPublishedDimensionsTerminal).length}/${rows.length} terminales Product+Training+specs presentes; ${rows.filter(r => r.observedDimensionChecks.allTerminalEvidenceAccepted).length}/${rows.length} además evidence-backed; ninguno acredita obligaciones desconocidas de familia ni Trust completo.

## 4. Projection quality

### Product Semantics V1

${countTable(summary.product.internalStates)}

Schemas válidos: ${rows.filter(r => r.structuralValidity.product).length}/${rows.length}. Ontology=${ps.ontologyVersion}, hash=${ps.ontologyHash}; replay determinista y provenance por hecho comprobados. ${nIssue('PRODUCT_WEAK_CATEGORY_TERMINAL')} productos reciben clasificación terminal basada en alguna categoría SEMANTIC_WEAK: permitido por PRODUCT_FAMILY, insuficiente para certificar esos facts sin revisión en esta auditoría. ${nIssue('PRODUCT_FAMILY_UNRESOLVED')} OTHER no distingue causa source/rule/ontology. ${nIssue('HISTORICAL_POLICY_IMPLEMENTATION_CONFLICT')} históricos tienen FAMILY_INFERENCE de disciplina permitido explícitamente por implementation pero contrario al texto del globalHistoricalPolicy: conflicto de contrato/policy, no dato corrupto ni inferencia intuitiva.

P2.2A se conserva: shared=2011, CAT-V2-only=37, legacy-only=0; seis hechos legacy-only en P2186/P2188/P2301/P2302/P2303/P2306 siguen documentados. Authority Product CAT-V2; fallback únicamente NO_ACTIVE_BUNDLE. No se rehace comparación legacy. El conflicto historical-policy es evidencia material para una revisión focalizada de contrato, no motivo para retirar o extender fallback.

### Training V1 / V2

V1: ${t1.records.length} records, ${t1.counts.assignmentCount} assignments; todavía utilizado como lineage native V2 y knowledge interno, no autoridad de discovery público. Coverage V1=${JSON.stringify(t1.counts.coverageCounts)}; UNMODELED con assignments no es inconsistencia: enum de cobertura no indica por sí mismo resolución.

V2 tiene ${t2.records.length}/${rows.length} records estructuralmente válidos. Registry=${t2.registryVersion}/${t2.registryHash}; classifier=${t2.classifierVersion}; rules=${t2.rulesHash}. Counts internos de resolutionState solo resumen cohort de 240; los counts completos recalculados son:

${countTable(summary.trainingV2.allInternalResolutionStates)}

277 exercise assignments y 289 functions, verificadas contra replay. Derived bodyRegions/muscles/patterns se calculan solo desde registry de exerciseCapabilities; functions no generan anatomía. ${nIssue('TRAINING_FUNCTION_ONLY_COMPLETE_SCOPE')} COMPLETE solo con functions se mapean PARTIAL para consolidación de Training global: las functions mismas pueden ser válidas; no acreditan completeness de ejercicios. ${nIssue('TRAINING_NEGATIVE_EVIDENCE_NOT_PERSISTED')} negativos vacíos son coherentes, pero carecen de resolutionEvidence; el reason de policy conserva baseline, no explica exclusión semántica. Esto no obliga a inferir capacidades nuevas.

El 97,5% interno es 234/240 en cohort curado; después de excluir los 51 negativos inválidos quedan ${summary.trainingV2.cohortDeclaredResolvedMinusInvalid.count}/240 (${summary.trainingV2.cohortDeclaredResolvedMinusInvalid.percentage}%) label-valid. El cohort actual se distribuye ${JSON.stringify(summary.trainingV2.cohortCommercialMembership)}: activeTrainingRelevant no equivale a active comercial ni a historical_order_detail_only. No aplicar su porcentaje a all/current/active.

### Specs

${specs.length} records: ${JSON.stringify(specSummary.statuses)}. Structural validity=${specSummary.structuralValidity.count}/${specs.length}; semantic consistency=${specSummary.semanticConsistency.count}/${specs.length}. Distribución por producto (denominador ${rows.length}): ${JSON.stringify(specSummary.productDistribution)}. Distribución por familia, keys, units y todos los records fuente: projection-summary.json/product-consolidation.json.

Units normalizadas de salida kg/cm; parseMeasurement no convierte lb/g/mm/m ni normaliza distintas magnitudes. Ambiguous mezcla varias cifras o formatos/labels insuficientes; unsupported carece de valor extraíble. ${nIssue('SPEC_MULTIPLE_ASSIGNMENTS')} productos con más de un assignment del mismo key; ${specSummary.conflictsBeforeNullingProducts} tienen candidatos numéricos diferentes que buildSpecs convirtió a ambiguous/null. Se reconstruye el parse exacto para no ocultar SOURCE_CONFLICT bajo ambiguity. Candidate reasons=${JSON.stringify(specSummary.parseCandidateReasons)} (denominador ${specs.length}); rule/status groups en JSON. ${nIssue('SPEC_TECHNICAL_FEATURE_OUTSIDE_ADAPTER')} productos tienen features TECHNICAL fuera de los cinco ids soportados: parsed total no implica specs técnicas completas. Sin specs=${specSummary.productDistribution.withoutSpecs}/${rows.length}; no se declara not-applicable ni fallo sin contrato.

### Trust Maps

2 descriptors/hash; ${categoryRows.length} filas de categoría, ${featureRows.length} filas de feature. Cobertura de ids asignados: category ${trustSummary.categoryCoverage.count}/${trustSummary.categoryCoverage.denominator} y feature ${trustSummary.featureCoverage.count}/${trustSummary.featureCoverage.denominator}. Classes=${JSON.stringify(trustSummary.categoryClasses)} / ${JSON.stringify(trustSummary.featureClasses)}. Sin duplicate ids; loaders aplicarían last-write-wins si aparecieran.

Trust maps sí gobiernan classifiers offline: gates por eje y trusted features; runtime publica metadata hashes. \`consumedByCategorySelection=false\`; \`categorySelectionAuthority=static-category-trust-map\`. Static version=${trustSummary.staticMapVersion}; ${staticDifferences.length} diferencias de mapping con extraction (ids y afectados en JSON). Igualdad de una clase concreta no elimina autoridades/hash/frescura separados. Historical maps son UNKNOWN por ausencia contractual, no categoría sin mapping. TrustState=PARTIAL porque publicación/coverage no equivale a autoridad efectiva unificada.

### Dashboard independiente

[quality-metrics.json](quality-metrics.json) entrega structural validity, semantic consistency, terminal resolution observada, evidence-backed terminal, ambiguity/data/ontology/conflict/invalid/NA rates y cross-coherence para all/current/historical/active/inactive. Cada métrica tiene count, denominator, percentage y scope. Terminal/applicable queda null cuando applicability no se conoce; el ratio de records observados se etiqueta por separado. Sin score global. [evidence-policy.json](evidence-policy.json) documenta las fuentes reales, autoridad, confidence, auto-resolution y combinaciones/hints; DESCRIPTION no es fuente admitida.

## 5. Cross-projection consistency

Invariants ejecutados: identidad/presence, source references de specs, hash/ontology lineage, family-derived function compatible con primary family/registry, historical evidence gates, separación exercise/function/anatomía y scope de discovery. Sources y severidad están en [invariants.md](invariants.md); issues JSON conservan detalles.

${summary.trainingV2.historicalTrainingDiscovery.length} productos históricos con COMPLETE y assignments son indexables en Training-only queries; Product axis filtra current y Training no. ${summary.trainingV2.nonProductTrainingDiscovery.length} no-product records indexables en Training. Esto es un gap de **admission por superficie**, no cambio de current membership en source. Contratos no definen incompatibilidad exhaustiva familia×ejercicio ni inferencia tipo máquina desde dimensiones físicas; esas reglas no se inventan ni se evalúan.

Known-invariants coherence: ${metrics.populations.ALL_CANONICAL_PRODUCTS.crossProjectionCoherence.count}/${rows.length} (${metrics.populations.ALL_CANONICAL_PRODUCTS.crossProjectionCoherence.percentage}%). Es ausencia de contradicción conocida, no prueba universal de consistencia ni consolidación.

## 6. Invalid states

Los **51 Training V2 conocidos** están preservados: ${summary.trainingV2.knownInvalidCurrent} current, ${summary.trainingV2.knownInvalidActive} active, todos detallados por id en JSON. Se validó también el snapshot legacy aceptado de ${legacyTraining.records.length} records: exactamente los mismos 51 ids; lineage/schema pasan allí igualmente. VERIFIED_NO_APPLICABLE_CAPABILITY + assignments -> INVALID_STATE; resolved=true no rescata el record. Causa: resolutionStateFor aplica policy por id antes de assignments; validators recomputan hashes/counts y aceptan el par contradictorio. Training query/discovery exige SEMANTIC_COMPLETE: estos 51 no participan, aunque los endpoints de lectura/contexto sí pueden exponerlos. No se corrigió ninguno.

Productos INVALID en total: ${aggregates.ALL_CANONICAL_PRODUCTS.issueProducts.invalid}/${rows.length}; current=${aggregates.CURRENT_PRODUCTS.issueProducts.invalid}/${populations.CURRENT_PRODUCTS.length}; active=${aggregates.ACTIVE_PRODUCTS.issueProducts.invalid}/${populations.ACTIVE_PRODUCTS.length}. SOURCE_CONFLICT se conserva distinto de invalid structural.

## 7. Gaps

Conteos de productos deduplicados por fenómeno, con solapamiento entre fenómenos:

| Fenómeno | All | Current | Active |
|---|---:|---:|---:|
${Object.keys(aggregates.ALL_CANONICAL_PRODUCTS.issueProducts).map(i => `| ${i} | ${['ALL_CANONICAL_PRODUCTS', 'CURRENT_PRODUCTS', 'ACTIVE_PRODUCTS'].map(k => `${aggregates[k].issueProducts[i]}/${aggregates[k].denominator}`).join(' | ')} |`).join('\n')}

Evidence/applicability desconocida no se suma automáticamente a DATA_GAP. ${nIssue('SPEC_AMBIGUOUS')} productos con specs ambiguous pueden tener SpecsState=PARTIAL; la métrica de productos con ambiguity usa records, no solo el enum. Training ONTOLOGY_GAP es traducción contractual de UNMODELED sin assignment: no demuestra que las ${aggregates.ALL_CANONICAL_PRODUCTS.issueProducts.ontologyGap} filas necesiten vocabulario nuevo; algunas requieren diagnóstico de reglas/source/aplicabilidad. Gaps agrupados en [gap-inventory.csv](gap-inventory.csv), con counts all/current/active, causa, flags y affectedProductIds estructurados en JSON. Relationship/Capabilities unavailable tienen affectedProductCount=null: gap plataforma, sin penalización individual.

Source conserva orphanReferences: category=${source.orphanReferences.categories.length}, features=${source.orphanReferences.features.length}, variants=${source.orphanReferences.variants.length}, revenues=${source.orphanReferences.revenues.length}. No se reintegran automáticamente a historical metadata; afectados y tratamiento en projection-summary.json. No se confunden references retenidas con facts admitidos por el contrato histórico.

## 8. Admission by runtime surface

| Surface | Runtime offline candidate counts | Audit recommendation counts |
|---|---|---|
${Object.entries(aggregates.ALL_CANONICAL_PRODUCTS.surfaceAdmission).map(([s, v]) => `| ${s} | ${JSON.stringify(v.runtimeEligibility)} | ${JSON.stringify(v.recommendation)} |`).join('\n')}

Denominador de todas esas distribuciones=${rows.length}. YES significa elegibilidad según datos del candidato para queries compatibles, no presencia en cada resultado ni deployment. Product Context se basa en existencia y puede informar inactive; compra necesita live Commercial Truth; lexical active && listed no es derivable para activos sin visibility. Spec filtering y Future Unified Retrieval carecen de contrato de admisión. CANDIDATE de specs describe filas utilizables si se diseña la superficie, no un endpoint operativo.

Product semantic discovery con evidencia fuerte y scope adecuado: ${populations.ACTIVE_PRODUCTS.filter(r => r.admissionRecommendation.PRODUCT_SEMANTIC_DISCOVERY.recommendation === 'YES').length}/${populations.ACTIVE_PRODUCTS.length} (${(100 * populations.ACTIVE_PRODUCTS.filter(r => r.admissionRecommendation.PRODUCT_SEMANTIC_DISCOVERY.recommendation === 'YES').length / populations.ACTIVE_PRODUCTS.length).toFixed(4)}%) activos. Training discovery recomendado estricto: ${populations.ACTIVE_PRODUCTS.filter(r => r.admissionRecommendation.TRAINING_DISCOVERY.recommendation === 'YES').length}/${populations.ACTIVE_PRODUCTS.length}. No confundir estas superficies con consolidación global. Matriz completa por producto incluye runtimeEligibility, recommendation, contract, reasons y deployedEligibility=UNKNOWN.

## 9. New-product admission

**Can P_NEW enter safely today? PARTIALLY.** La extracción y los classifiers pueden incluirlo automáticamente cuando se ejecutan; source/hash/schema/lineage y swap son gates técnicos explícitos. No hay gate semántico integral por producto. Policy A00.6.7 está congelada por id; los productos nuevos quedan fuera del cohort y resolutionState se deriva de presence de assignments/coverage. Specs genera únicamente features soportadas. Una categoría nueva sin trust map genera warning y puede bloquear build; un feature nuevo sin mapping cae en UNKNOWN sin warning equivalente. Static runtime map requiere regeneración separada. La activación admite DOMAIN_REVIEW=PENDING. Scheduler/deployment live no verificable localmente.

Flujo, tipo de control de cada etapa y protocolo **propuesto, no implementado**: [new-product-admission.md](new-product-admission.md).

## 10. Manual review pool

Pool priorizado=${review.length}/${rows.length}; prioridades=${JSON.stringify(summary.review.priorities)}. P0 active invalid/conflict; P1 otros active ambiguos/unknown/source; P2 current inactive; P3 historical. Sellability=UNKNOWN para activos, no se inventa ranking comercial. Familias de alto valor no tienen policy económica formal; se prioriza evidencia de conflicto antes de adivinar valor.

REQUIRES_HUMAN_REVIEW=${review.length} candidatos; REQUIRES_ONTOLOGY_WORK=${queues.REQUIRES_ONTOLOGY_WORK.productIds.length} etiquetas a diagnosticar; REQUIRES_SOURCE_DATA=${queues.REQUIRES_SOURCE_DATA.productIds.length} candidatos; AUTO_FIXABLE_BY_POLICY=0/${rows.length} **demostrados**. No significa que no haya automatización posible: requiere policy aprobada y evidencia suficiente. Los ${nIssue('TRAINING_NEGATIVE_EVIDENCE_NOT_PERSISTED')} negativos coherentes se separan en pool colectivo de evidence policy, no 836 fixes manuales. Queues se solapan y no son partición. [manual-review.csv](manual-review.csv) y JSON incluyen ids, reasons, priorities; historical y NA no suben de prioridad solo por no tener metadatos.

## 11. 95% interpretation

La fracción real de consolidación all/current/active no es calculable todavía. Fracción certificable estricta=0/${rows.length}, 0/${populations.CURRENT_PRODUCTS.length}, 0/${populations.ACTIVE_PRODUCTS.length}; todas 0% como límite inferior por falta de contrato, no score de calidad. Los porcentajes de dimensión/superficie sí son calculables y no se optimizan a 95%. El gate existente en v2SnapshotBuilder usa 95%/97.5% del cohort; se observa como deuda de aceptación histórica, no se aplica ni se cambia en esta auditoría. Los gaps se explican sin completar clasificaciones.

## 12. Unified Retrieval readiness

**NOT_READY** para afirmar admisión transversal. Blockers: dimensiones requeridas desconocidas; evidencia negativa incompleta; 51 estados contradictorios; COMPLETE puede representar solo función; Training-only histórico/no-product sin scope gate; Trust publicado y authority estática separados; specs no tienen applicability/filters contract. Product OTHER y Training UNMODELED carecen de diagnóstico causal suficiente. Relationships/Capabilities no son blockers obligatorios: solo lo serían si una superficie definiera dependencia explícita.

Las superficies existentes siguen teniendo utilidad; una respuesta PRODUCT_CONTEXT o una etiqueta fuerte puede estar respaldada sin que el producto entero esté certificado. Falta además verificar activation/deployment live para afirmar operatividad del candidato.

## 13. Recommended remediation order

1. Definir obligations y admission por familia/superficie, incluyendo VERIFIED_NOT_APPLICABLE con prueba negativa, scopes históricos y estados desconocidos. Esto hace medible el baseline real sin fabricar certeza.
2. Adjudicar los 51 negativos con assignments y añadir invariant de publicación/activation. No convertirlos automáticamente a COMPLETE sin resolver qué afirma cada estado.
3. Corregir por policy aprobada el scope de Training discovery y distinguir función resuelta de ejercicio resuelto. Alinear cohort con su significado histórico de revisión, conservando separación comercial.
4. Resolver autoridad/lineage de Trust y conflicto histórico entre global policy y discipline implementation. No reabrir toda P2.2A; revisión focalizada con evidencia material.
5. Resolver ambiguity/spec units/multivalue con evidencia fuente y applicability definida; preservar UNKNOWN cuando no corresponda requisito.
6. Diagnosticar OTHER/UNMODELED por family y prioridad active, separar rule gaps/ontology/data antes de ampliar ontología.
7. Verificar candidate domain-review/admission y deployment/activation; medir de nuevo. Añadir adapters Relationship/Capabilities solo con requisito explícito de superficie.

### Respuestas finales

1. Estándar real: obligaciones contractuales conocidas, terminales válidos y evidence-backed, sin contradicción y admisión por superficie.
2. Productos que lo cumplen de forma certificable: 0; cantidad real desconocida por contrato incompleto.
3. Certificables: 0/${rows.length}=0% canonical; 0/${populations.CURRENT_PRODUCTS.length}=0% current; 0/${populations.ACTIVE_PRODUCTS.length}=0% active. Porcentaje real=N/D.
4. Product: schema/replay completos; ${summary.product.internalStates.CLASSIFIED} CLASSIFIED, ${summary.product.internalStates.PARTIALLY_CLASSIFIED} partial, ${summary.product.internalStates.OTHER} OTHER, ${summary.product.internalStates.EXCLUDED_NON_PRODUCT} exclusiones; revisar ${nIssue('PRODUCT_WEAK_CATEGORY_TERMINAL')} weak y ${nIssue('HISTORICAL_POLICY_IMPLEMENTATION_CONFLICT')} policy conflicts.
5. Training: schema/lineage completos; 51 negativos contradictorios, ${nIssue('TRAINING_FUNCTION_ONLY_COMPLETE_SCOPE')} function-only COMPLETE, ${nIssue('TRAINING_NEGATIVE_EVIDENCE_NOT_PERSISTED')} negativos sin evidencia persistida; 97.5% cohort no describe activos.
6. Specs: ${specs.length} records, parsed=${specSummary.statuses.parsed}, ambiguous=${specSummary.statuses.ambiguous}, unsupported=${specSummary.statuses.unsupported}; applicability desconocida.
7. Trust: category=${trustSummary.categoryCoverage.count}/${trustSummary.categoryCoverage.denominator}, feature=${trustSummary.featureCoverage.count}/${trustSummary.featureCoverage.denominator} asignados cubiertos; gobierna build, category runtime usa static map; ${staticDifferences.length} divergencias.
8. Invalid products=${aggregates.ALL_CANONICAL_PRODUCTS.issueProducts.invalid}/${rows.length}.
9. Con ambiguity=${aggregates.ALL_CANONICAL_PRODUCTS.issueProducts.ambiguity}/${rows.length}.
10. Con data gaps conocidos=${aggregates.ALL_CANONICAL_PRODUCTS.issueProducts.dataGap}/${rows.length}; unknown applicability no se fuerza a gap.
11. Con ontology gaps declarados=${aggregates.ALL_CANONICAL_PRODUCTS.issueProducts.ontologyGap}/${rows.length}; causa real aún necesita diagnóstico.
12. Pool humano priorizado=${review.length}/${rows.length}; no estimación de trabajo manual inevitable.
13. Auto-fixables mediante policy aprobada y evidencia demostrada=0/${rows.length}; potencial aún no determinado.
14. Activos listos para Product semantic discovery estricto=${populations.ACTIVE_PRODUCTS.filter(r => r.admissionRecommendation.PRODUCT_SEMANTIC_DISCOVERY.recommendation === 'YES').length}/${populations.ACTIVE_PRODUCTS.length} (${(100 * populations.ACTIVE_PRODUCTS.filter(r => r.admissionRecommendation.PRODUCT_SEMANTIC_DISCOVERY.recommendation === 'YES').length / populations.ACTIVE_PRODUCTS.length).toFixed(4)}%); no equivale a compra ni Unified Retrieval.
15. Nuevo producto: extracción/classifiers/build técnicos lo incluyen, policy curada no lo revisa; runtime tras activation usa lo publicado y sus gates parciales.
16. Admission protocol técnico explícito sí; protocolo semántico integral por producto no.
17. Faltan obligations, evidence negatives, scope/completeness, admission por superficie y gate domain review verificable.
18. Unified Retrieval=NOT_READY.
19. Blockers concretos en sección 12 y gap inventory; unavailable platform no se penaliza automáticamente.
20. Remediación por impacto en sección 13: contratos y contradicciones antes de ampliar coverage; ninguna certeza fabricada.

Reproducir desde raíz: \`node cross-projection-audit/audit.mjs\`. Opcional \`--source-dir=... --bundle-dir=...\`; lineage/hashes deben coincidir. Node 22 + dependencias ya instaladas (tsx para importar contratos TypeScript). Ningún builder/publisher/store se ejecuta. Verification incluye fingerprints antes/después de todos los archivos artifacts/data y hashes de código utilizado; outputs deterministas para mismo checkout/input. Issues estructurados en JSON y serializados como JSON en CSV.
`;
await writeFile(path.join(output, 'REPORT.md'), report, 'utf8');
console.log(JSON.stringify({ status: 'PASS', outputs: output, populations: extraction.recordCounts,
  consolidatedCertified: 0, actualConsolidated: null, invalidTraining: summary.trainingV2.knownInvalidNegativeProductIds.length,
  review: review.length, protectedFilesUnchanged: Object.keys(before).length }, null, 2));
