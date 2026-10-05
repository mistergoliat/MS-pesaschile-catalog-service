// Explicit development fixture extraction; never a publisher or an audit-run side effect.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { register } from 'tsx/esm/api';
register();
const domain = await import('../src/domain/catalog-admission/index.ts');
const { parseCsvRecords } = await import('../scripts/product-semantic-classification/lib/csv.ts');
const sourceDir = 'artifacts/catalog-projection-input/36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2';
const bundleDir = 'artifacts/catalog-v2/p2-2b-final/bundles/ee4881b5875ee098c8b54c5ee6dfdcd4d4a92d8c91263bd4ce02c1b5e8e0a347';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const [source, ps, tr, specs, manifest, categories, features] = await Promise.all([
  json(`${sourceDir}/canonical_input.json`), json(`${bundleDir}/productSemantics.json`), json(`${bundleDir}/trainingSemanticsV2.json`),
  json(`${bundleDir}/specs.json`), json(`${bundleDir}/manifest.json`),
  readFile(`${sourceDir}/category_trust_map.csv`, 'utf8').then(parseCsvRecords), readFile(`${sourceDir}/feature_trust_map.csv`, 'utf8').then(parseCsvRecords),
]);
const pById = new Map(ps.snapshot.records.map(p => [Number(p.productId), p])), tById = new Map(tr.snapshot.records.map(t => [t.productId, t]));
const specsById = Map.groupBy(specs.records, s => Number(s.productKey.slice(1)));
const contexts = source.products.map(canonical => ({ canonical, productSemantics: pById.get(canonical.productId), training: tById.get(canonical.productId),
  specs: specsById.get(canonical.productId) ?? [], trust: {
    categories: categories.filter(c => canonical.categoryIds?.some(p => p.categoryId === Number(c.categoryId))).map(c => ({ categoryId: Number(c.categoryId), trustClass: c.trustClass })),
    features: features.filter(f => canonical.features?.some(p => p.featureId === Number(f.featureId))).map(f => ({ featureId: Number(f.featureId), trustClass: f.trustClass })),
    sourceHashesVerified: true, consumedByCategorySelection: false }, lineage: { productVerified: true, trainingVerified: true, specsVerified: true } }));
const pick = predicate => { const context = contexts.find(predicate); if (!context) throw new Error('Missing real fixture'); return context; };
const fixtures = {
  classified: pick(c => c.canonical.active === true && domain.evaluateProductAdmission(c, 'PRODUCT_SEMANTIC_DISCOVERY').decision === 'ADMITTED'),
  training: pick(c => c.canonical.active === true && domain.evaluateProductAdmission(c, 'TRAINING_DISCOVERY').decision === 'ADMITTED'),
  negative: pick(c => domain.mapTrainingExercise(c).state === 'VERIFIED_NOT_APPLICABLE'),
  invalid: pick(c => c.canonical.productId === 12),
  specConflict: pick(c => domain.mapSpecs(c).state === 'SOURCE_CONFLICT'),
  ambiguous: pick(c => domain.mapSpecs(c).state === 'AMBIGUOUS'),
  historical: pick(c => c.canonical.catalogPresence === 'historical_order_detail_only' && c.training.resolutionState === 'SEMANTIC_COMPLETE'),
  nonProduct: pick(c => c.productSemantics.classificationStatus === 'EXCLUDED_NON_PRODUCT' && c.training.resolutionState === 'SEMANTIC_COMPLETE'),
  functionOnly: pick(c => c.canonical.active && !c.training.exerciseCapabilities.length && domain.evaluateProductAdmission({ ...c, trainingDiscoveryDimension: 'TRAINING_FUNCTION' }, 'TRAINING_DISCOVERY').decision === 'ADMITTED'),
  inactive: pick(c => c.canonical.active === false),
  parsedSpecs: pick(c => domain.mapSpecs(c).state === 'VERIFIED'),
  combinedEvidence: pick(c => c.canonical.productId === 1450),
};
await mkdir('tests/fixtures/catalog-admission', { recursive: true });
await writeFile('tests/fixtures/catalog-admission/contexts.json', `${JSON.stringify({ provenance: { sourceDir, bundleDir,
  sourceExtractionId: manifest.source.sourceExtractionId, projectionBundleId: manifest.projectionBundleId,
  note: 'Exact real source/projection facts, trust rows restricted to used source IDs. No reclassification. P_NEW is synthetic in test code. Ambiguous fixture is real Specs ambiguity; Product NEEDS_REVIEW test is an explicit counterfactual.' }, fixtures }, null, 2)}\n`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(fixtures).map(([name, c]) => [name, { productId: c.canonical.productId, family: c.productSemantics.primaryProductFamily?.code }]))));
