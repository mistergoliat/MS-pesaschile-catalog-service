import { describe, expect, it } from 'vitest';
import { buildSpecs, bundleId, canonicalJson, semanticHash, validateBundle, type BundleManifest } from '../../src/domain/catalog/projection-bundle.js';
import { canonicalContent, contentHash, normalizeSource } from '../../src/domain/catalog/projection-input/canonical.js';

const source = normalizeSource({ products: [{ productId: 1, name: 'Fixture', active: 1 }], historical: [], categories: [],
  features: [{ productId: 1, featureId: 11, featureValueId: 1, name: 'Peso máximo de usuario', value: '150 kg' },
    { productId: 1, featureId: 3, featureValueId: 2, name: 'Peso Neto', value: '20,5 kg' },
    { productId: 1, featureId: 12, featureValueId: 3, name: 'Peso máximo de carga', value: '60 kg / 80 kg' },
    { productId: 1, featureId: 15, featureValueId: 4, name: 'Dimensiones del producto armado', value: 'sin medida' },
    { productId: 999, featureId: 11, featureValueId: 5, name: 'Peso máximo de usuario', value: '180 kg' }], variants: [], revenues: [] },
{ type: 'prestashop', identity: 'fixture', shopId: 1, langId: 1 });
const sourceId = contentHash(canonicalContent(source));

function bundle() {
  const value = buildSpecs(source, sourceId);
  const text = `${canonicalJson(value)}\n`;
  const unavailable = { status: 'unavailable', reason: 'fixture' } as const;
  const draft = { schemaVersion: '1', source: { sourceExtractionId: sourceId, canonicalInputHash: sourceId },
    build: { codeRef: 'code-v1', builtAt: '2026-01-01T00:00:00.000Z', builderVersions: { specs: 'spec-rules-v1' } },
    projections: { productSemantics: unavailable, trainingSemantics: unavailable, relationships: unavailable, capabilities: unavailable, trustMaps: unavailable,
      specs: { status: 'present', schemaVersion: '1', snapshotId: semanticHash(value), contentHash: contentHash(text), builderVersion: 'spec-rules-v1', recordCount: value.records.length, artifact: 'specs.json' } },
    validation: { status: 'TECHNICALLY_VALID', domainReview: 'PENDING' },
  } as Omit<BundleManifest, 'projectionBundleId'>;
  return { manifest: { ...draft, projectionBundleId: bundleId(draft) }, files: { 'specs.json': text } };
}

describe('projection bundle', () => {
  it('keeps identity stable across operational metadata and changes it for source/projection/code changes', () => {
    const { manifest } = bundle();
    expect(bundleId({ ...manifest, build: { ...manifest.build, builtAt: '2026-02-01T00:00:00.000Z' } })).toBe(manifest.projectionBundleId);
    expect(bundleId({ ...manifest, source: { ...manifest.source, sourceExtractionId: contentHash('other') } })).not.toBe(manifest.projectionBundleId);
    expect(bundleId({ ...manifest, build: { ...manifest.build, codeRef: 'code-v2' } })).not.toBe(manifest.projectionBundleId);
    expect(bundleId({ ...manifest, projections: { ...manifest.projections, specs: { ...manifest.projections.specs, contentHash: contentHash('other') } } as BundleManifest['projections'] })).not.toBe(manifest.projectionBundleId);
  });
  it('validates optional unavailable entries and reports orphan references', () => {
    const { manifest, files } = bundle();
    const report = validateBundle(manifest, files, source);
    expect(report.status).toBe('PASS');
    expect(report.warnings).toContain('features: 1 orphan references retained in source');
  });
  it('fails on corrupt, missing and unsupported artifacts', () => {
    const { manifest, files } = bundle();
    expect(() => validateBundle(manifest, { 'specs.json': '{}' }, source)).toThrow('PROJECTION_HASH_MISMATCH');
    expect(() => validateBundle(manifest, {}, source)).toThrow('BUNDLE_VALIDATION_FAILED');
    expect(() => validateBundle({ ...manifest, schemaVersion: '2' }, files, source)).toThrow('INVALID_BUNDLE_MANIFEST');
    expect(() => validateBundle({ ...manifest, unexpected: true }, files, source)).toThrow('INVALID_BUNDLE_MANIFEST');
    const wrongSource = { ...manifest, source: { sourceExtractionId: contentHash('other'), canonicalInputHash: contentHash('other') } };
    expect(() => validateBundle({ ...wrongSource, projectionBundleId: bundleId(wrongSource) }, files, source)).toThrow('SOURCE_LINEAGE_INVALID');
  });
  it('retains spec provenance and explicit parsed, ambiguous and unsupported states', () => {
    const rows = buildSpecs(source, sourceId).records;
    expect(rows.find((r) => r.key === 'max_user_weight_kg')).toMatchObject({ status: 'parsed', value: 150, unit: 'kg', sourceFeature: { featureId: 11, featureValueId: 1 } });
    expect(rows.find((r) => r.key === 'weight_kg')).toMatchObject({ status: 'parsed', value: 20.5 });
    expect(rows.find((r) => r.key === 'max_load_kg')).toMatchObject({ status: 'ambiguous', value: null });
    expect(rows.find((r) => r.key === 'assembled_length_cm')).toMatchObject({ status: 'unsupported', value: null });
    expect(rows.every((r) => r.rawValue && r.derivationRule)).toBe(true);
  });
});
