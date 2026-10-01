import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { aggregateContentHash, canonicalContent, contentHash, EXTRACTOR_VERSION, EXTRACTION_SCHEMA_VERSION, normalizeSource, recordCounts } from '../../src/domain/catalog/projection-input/canonical.js';
import { compatibilityCsv } from './extractionArtifacts.js';

const root = path.resolve(process.argv[2] ?? 'artifacts/catalog-v2/replay-source');
const source = normalizeSource({
  products: [{ productId: 101, name: 'Banco de prueba', active: 1 }, { productId: 102, name: 'Barra de prueba', active: 1 }],
  historical: [{ productId: 103, name: 'Equipo histórico de prueba' }],
  categories: [],
  features: [
    { productId: 101, featureId: 11, featureValueId: 1, name: 'Peso máximo de usuario', value: '150 kg' },
    { productId: 101, featureId: 15, featureValueId: 2, name: 'Dimensiones del producto armado', value: 'Largo: 120 cm Ancho: 50 cm Alto: 60 cm' },
    { productId: 102, featureId: 3, featureValueId: 3, name: 'Peso Neto (N.W.)', value: '20 kg' },
    { productId: 999, featureId: 11, featureValueId: 4, name: 'Peso máximo de usuario', value: '180 kg' },
  ], variants: [], revenues: [],
}, { type: 'prestashop', identity: 'fixture-no-pii', shopId: 1, langId: 1 });
const files = {
  'canonical_input.json': canonicalContent(source),
  'product_catalog_exploration.csv': compatibilityCsv(source),
  'category_trust_map.csv': 'categoryId,categoryName,path,assignedProductCount,levelDepth,trustClass,reason\n1,Fixture,Fixture,0,1,NAVIGATION,fixture\n',
  'feature_trust_map.csv': 'featureId,featureName,assignedProductCount,trustClass,reason\n3,Peso Neto,1,TECHNICAL,fixture\n11,Peso máximo de usuario,1,TECHNICAL,fixture\n15,Dimensiones del producto armado,1,TECHNICAL,fixture\n',
};
const artifacts = { canonicalInput: contentHash(files['canonical_input.json']), compatibilityCsv: contentHash(files['product_catalog_exploration.csv']),
  categoryTrustMap: contentHash(files['category_trust_map.csv']), featureTrustMap: contentHash(files['feature_trust_map.csv']) };
const manifest = { schemaVersion: EXTRACTION_SCHEMA_VERSION, sourceExtractionId: artifacts.canonicalInput,
  extractor: { version: EXTRACTOR_VERSION, buildRef: 'fixture', buildRefSource: 'environment' },
  source: { ...source.source, observedAt: '2026-01-01T00:00:00.000Z' }, recordCounts: recordCounts(source), artifacts,
  aggregateContentHash: aggregateContentHash(artifacts) };
await mkdir(root, { recursive: true });
for (const [name, value] of Object.entries({ ...files, 'projection_input_manifest.json': `${JSON.stringify(manifest)}\n` })) await writeFile(path.join(root, name), value);
console.log(JSON.stringify({ root, sourceExtractionId: manifest.sourceExtractionId }));
