import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { canonicalContent, contentHash, recordCounts, validateManifest, type CanonicalExtraction } from '../../src/domain/catalog/projection-input/canonical.js';
import { DefaultProductSemanticSnapshotBuilder, productSemanticClassifierVersion } from '../../src/domain/product-semantic-snapshot/index.js';
import { buildSpecs, bundleId, BundleError, canonicalJson, semanticHash, validateBundle, type BundleManifest, type ProjectionName } from '../../src/domain/catalog/projection-bundle.js';
import { runProductSemanticClassification } from '../product-semantic-classification/lib/classification-run.js';
import { loadTrainingSemanticClassificationInputs } from '../training-semantic-classification/lib/load-input.js';
import { classifyTrainingSemanticProducts } from '../../src/domain/training-semantic-classification/index.js';
import { DefaultTrainingSemanticSnapshotBuilder } from '../../src/domain/training-semantic-snapshot/index.js';

function args(argv: string[]) {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--(source-dir|output-dir|code-ref)=(.+)$/u.exec(arg);
    if (!match) throw new Error(`INVALID_BUNDLE_MANIFEST: unsupported argument ${arg}`);
    values[match[1]!] = match[2]!;
  }
  if (!values['source-dir']) throw new Error('SOURCE_LINEAGE_INVALID: --source-dir is required');
  return { sourceDir: path.resolve(values['source-dir']), outputDir: path.resolve(values['output-dir'] ?? 'artifacts/catalog-v2/bundles'), codeRef: values['code-ref'] };
}
async function localCodeRef() {
  const files = (await Promise.all(['src', 'scripts'].map(async (root) => (await readdir(root, { recursive: true }))
    .filter((name) => name.endsWith('.ts')).map((name) => path.join(root, name))))).flat();
  files.push('package-lock.json');
  const contents = await Promise.all(files.sort().map(async (file) => [file.replaceAll(path.sep, '/'), contentHash(await readFile(file, 'utf8'))]));
  return semanticHash(contents);
}
async function verifySource(dir: string) {
  const [raw, csv, category, feature, rawManifest] = await Promise.all(['canonical_input.json', 'product_catalog_exploration.csv', 'category_trust_map.csv', 'feature_trust_map.csv', 'projection_input_manifest.json'].map((name) => readFile(path.join(dir, name), 'utf8')));
  const hashes = { canonicalInput: contentHash(raw!), compatibilityCsv: contentHash(csv!), categoryTrustMap: contentHash(category!), featureTrustMap: contentHash(feature!) };
  const manifest = validateManifest(JSON.parse(rawManifest!), hashes);
  const source = JSON.parse(raw!) as CanonicalExtraction;
  if (raw !== canonicalContent(source) || source.schemaVersion !== '1' || !Array.isArray(source.products)
    || JSON.stringify(recordCounts(source)) !== JSON.stringify(manifest.recordCounts)) throw new Error('SOURCE_LINEAGE_INVALID: canonical source malformed');
  return { source, manifest };
}
async function samePublished(dir: string, files: Record<string, string>, source: CanonicalExtraction) {
  const found = await readdir(dir);
  if (found.length !== Object.keys(files).length || found.some((name) => !(name in files))) throw new BundleError('IMMUTABLE_ARTIFACT_CONFLICT', 'file set differs');
  for (const [name, value] of Object.entries(files)) {
    const old = await readFile(path.join(dir, name), 'utf8');
    if (name !== 'manifest.json' && name !== 'validation-report.json' && old !== value) throw new BundleError('IMMUTABLE_ARTIFACT_CONFLICT', name);
  }
  const existing = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as BundleManifest;
  const incoming = JSON.parse(files['manifest.json']!) as BundleManifest;
  if (canonicalJson({ ...existing, build: { ...existing.build, builtAt: '' } }) !== canonicalJson({ ...incoming, build: { ...incoming.build, builtAt: '' } })) throw new BundleError('BUNDLE_ID_COLLISION', 'manifest semantic content differs');
  const oldFiles = Object.fromEntries(await Promise.all(found.filter((n) => n !== 'manifest.json' && n !== 'validation-report.json').map(async (n) => [n, await readFile(path.join(dir, n), 'utf8')])));
  validateBundle(existing, oldFiles, source);
}
async function publish(root: string, id: string, files: Record<string, string>, source: CanonicalExtraction) {
  await mkdir(root, { recursive: true });
  const final = path.join(root, id.slice(7));
  const temp = await mkdtemp(path.join(root, '.tmp-'));
  try {
    for (const [name, value] of Object.entries(files)) await writeFile(path.join(temp, name), value, { flag: 'wx' });
    validateBundle(JSON.parse(files['manifest.json']!), files, source);
    try { await stat(final); await samePublished(final, files, source); return { directory: final, reused: true }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { await rename(temp, final); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error; await samePublished(final, files, source); return { directory: final, reused: true }; }
    return { directory: final, reused: false };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
async function main() {
  const started = performance.now();
  const options = args(process.argv.slice(2));
  const codeRef = options.codeRef ?? await localCodeRef();
  const { source, manifest: extraction } = await verifySource(options.sourceDir);
  const builtAt = new Date().toISOString();
  const run = await runProductSemanticClassification({ inputDir: options.sourceDir, catalogCsvPath: path.join(options.sourceDir, 'product_catalog_exploration.csv'), categoryTrustMapCsvPath: path.join(options.sourceDir, 'category_trust_map.csv'), featureTrustMapCsvPath: path.join(options.sourceDir, 'feature_trust_map.csv') });
  const snapshot = new DefaultProductSemanticSnapshotBuilder().build({ results: run.results, parameters: { sourceProductCount: run.inputs.length, classifierVersion: productSemanticClassifierVersion, builtAt: '1970-01-01T00:00:00.000Z' } }).snapshot;
  if (run.loaderWarnings.length) throw new Error(`BUNDLE_VALIDATION_FAILED: classifier input warnings: ${run.loaderWarnings.join('; ')}`);
  const trainingInput = await loadTrainingSemanticClassificationInputs({ catalogCsvPath: path.join(options.sourceDir, 'product_catalog_exploration.csv'),
    categoryTrustMapCsvPath: path.join(options.sourceDir, 'category_trust_map.csv'), featureTrustMapCsvPath: path.join(options.sourceDir, 'feature_trust_map.csv') });
  if (trainingInput.warnings.length) throw new Error(`BUNDLE_VALIDATION_FAILED: training input warnings: ${trainingInput.warnings.join('; ')}`);
  const trainingResults = classifyTrainingSemanticProducts(trainingInput.inputs, { sourceCatalogExport: 'product_catalog_exploration.csv' });
  const trainingSnapshot = new DefaultTrainingSemanticSnapshotBuilder().build({ results: trainingResults,
    parameters: { sourceProductCount: trainingInput.inputs.length, sourceProductSemanticSnapshotId: snapshot.snapshotId, generatedAt: '1970-01-01T00:00:00.000Z' } });
  const sourceExtractionId = extraction.sourceExtractionId;
  const artifacts = {
    productSemantics: { schemaVersion: '1', sourceExtractionId, legacySnapshotId: snapshot.snapshotId, snapshot },
    trainingSemantics: { schemaVersion: '1', sourceExtractionId, legacySnapshotId: trainingSnapshot.snapshotId, snapshot: trainingSnapshot },
    specs: buildSpecs(source, sourceExtractionId),
    trustMaps: { schemaVersion: '1', sourceExtractionId, categoryHash: extraction.artifacts.categoryTrustMap, featureHash: extraction.artifacts.featureTrustMap },
  };
  const files: Record<string, string> = {};
  const projections = {} as BundleManifest['projections'];
  for (const [name, value] of Object.entries(artifacts) as [ProjectionName, unknown][]) {
    const artifact = `${name}.json`;
    const serialized = `${canonicalJson(value)}\n`;
    files[artifact] = serialized;
    projections[name] = { status: 'present', schemaVersion: '1', snapshotId: semanticHash(value), contentHash: contentHash(serialized),
      builderVersion: name === 'productSemantics' ? productSemanticClassifierVersion : name === 'trainingSemantics' ? trainingSnapshot.classifierVersion : name === 'specs' ? 'spec-rules-v1' : 'source-trust-map-adapter-v1',
      recordCount: name === 'productSemantics' ? snapshot.recordCount : name === 'trainingSemantics' ? trainingSnapshot.records.length : name === 'specs' ? artifacts.specs.records.length : 2, artifact };
  }
  for (const name of ['relationships', 'capabilities'] as const) projections[name] = { status: 'unavailable', reason: 'No sourceExtractionId-verified offline adapter in P1.3' };
  const draft: Omit<BundleManifest, 'projectionBundleId'> = { schemaVersion: '1', source: { sourceExtractionId, canonicalInputHash: extraction.artifacts.canonicalInput },
    build: { codeRef, builtAt, builderVersions: { productSemantics: productSemanticClassifierVersion, trainingSemantics: trainingSnapshot.classifierVersion, specs: 'spec-rules-v1', trustMaps: 'source-trust-map-adapter-v1' } },
    projections, validation: { status: 'TECHNICALLY_VALID', domainReview: 'PENDING' } };
  const bundle: BundleManifest = { ...draft, projectionBundleId: bundleId(draft) };
  const validationStart = performance.now();
  const report = validateBundle(bundle, files, source);
  const validationMs = Math.round(performance.now() - validationStart);
  files['manifest.json'] = `${JSON.stringify(bundle, null, 2)}\n`;
  files['validation-report.json'] = `${JSON.stringify({ ...report, buildDurationMs: Math.round(performance.now() - started), validationDurationMs: validationMs,
    artifactBytes: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.byteLength(value)])) }, null, 2)}\n`;
  const publicationStart = performance.now();
  const result = await publish(options.outputDir, bundle.projectionBundleId, files, source);
  console.log(JSON.stringify({ ...result, sourceExtractionId, projectionBundleId: bundle.projectionBundleId, projections,
    validation: report, buildMs: Math.round(publicationStart - started), validationMs, publicationMs: Math.round(performance.now() - publicationStart),
    artifactBytes: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.byteLength(value)])) }, null, 2));
}
main().catch((error: unknown) => { console.error(JSON.stringify({ status: 'FAIL', code: error instanceof Error && 'code' in error ? error.code : 'PUBLICATION_FAILED', message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
