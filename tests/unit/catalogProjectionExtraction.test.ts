import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aggregateContentHash, canonicalContent, contentHash, EXTRACTOR_VERSION, EXTRACTION_SCHEMA_VERSION,
  normalizeSource, recordCounts, validateManifest, type ExtractionManifest, type SourceRows,
} from '../../src/domain/catalog/projection-input/canonical.js';
import { assertReadOnlySelect, canonicalTrustMap, compatibilityCsv, publishLocalExtraction } from '../../scripts/catalog-v2/extractionArtifacts.js';

const scope = { type: 'prestashop' as const, identity: 'source-A', shopId: 1, langId: 1 };
const source: SourceRows = {
  products: [{ productId: 2, name: 'Banco', active: 0 }, { productId: 1, name: 'Barra oli\u0301mpica', active: 1 }],
  historical: [{ productId: 4, name: 'Producto histórico' }],
  categories: [{ productId: 2, categoryId: 8, name: 'Bancos' }, { productId: 1, categoryId: 3, name: 'Barras' },
    { productId: 1, categoryId: 2, name: 'Fuerza' }],
  features: [{ productId: 1, featureId: 9, featureValueId: 20, name: 'Diámetro', value: null },
    { productId: 1, featureId: 2, featureValueId: 5, name: 'Uso', value: 'Casa\r\nGimnasio' }],
  variants: [{ productId: 1, variantId: 12 }, { productId: 1, variantId: 11 }],
  revenues: [{ productId: 2, revenue: null }, { productId: 1, revenue: '001.5' }],
};

function manifest(canonical = normalizeSource(source, scope)): ExtractionManifest {
  const artifacts = { canonicalInput: contentHash(canonicalContent(canonical)), compatibilityCsv: contentHash(compatibilityCsv(canonical)),
    categoryTrustMap: contentHash('categoryId,trustClass\n1,UNKNOWN\n'), featureTrustMap: contentHash('featureId,trustClass\n1,UNKNOWN\n') };
  return {
    schemaVersion: EXTRACTION_SCHEMA_VERSION, sourceExtractionId: artifacts.canonicalInput,
    extractor: { version: EXTRACTOR_VERSION, buildRef: 'abc123', buildRefSource: 'environment' },
    source: { ...scope, observedAt: '2026-10-01T10:00:00.000Z' },
    recordCounts: recordCounts(canonical), artifacts, aggregateContentHash: aggregateContentHash(artifacts),
  };
}

describe('CAT-V2 canonical source extraction', () => {
  it('sorts SQL rows, categories, features and variants before hashing', () => {
    const first = normalizeSource(source, scope);
    const reversed = normalizeSource({
      products: [...source.products].reverse(), historical: [...source.historical].reverse(),
      categories: [...source.categories].reverse(), features: [...source.features].reverse(),
      variants: [...source.variants].reverse(), revenues: [...source.revenues].reverse(),
    }, scope);
    expect(canonicalContent(first)).toBe(canonicalContent(reversed));
    expect(contentHash(canonicalContent(first))).toBe(contentHash(canonicalContent(reversed)));
    expect(first.products[0]?.variantIds).toEqual([11, 12]);
    expect(recordCounts(first)).toMatchObject({ products: 3, currentProducts: 2, historicalProducts: 1, items: 3, variants: 2 });
  });

  it('normalizes equivalent Unicode, line endings and decimal formatting while retaining null', () => {
    const first = normalizeSource(source, scope);
    const equivalent = normalizeSource({ ...source,
      products: source.products.map((row) => ({ ...row, name: row.name?.normalize('NFC') ?? null })),
      features: source.features.map((row) => ({ ...row, value: row.value?.replace('\r\n', '\n') ?? null })),
      revenues: [{ productId: 1, revenue: '1.500000' }, { productId: 2, revenue: null }],
    }, scope);
    expect(canonicalContent(first)).toBe(canonicalContent(equivalent));
    expect(first.products[0]?.features?.[1]?.value).toBeNull();
    expect(first.products[0]?.revenueTaxIncl).toBe('1.500000');
    expect(first.products[2]?.active).toBeNull();
    expect(first.products[2]?.variantIds).toBeNull();
    expect(first.products[2]?.categoryIds).toBeNull();
    expect(compatibilityCsv(first)).toContain('productId,catalogPresence,name,active,allCategoryIds,features_json,totalRevenueTaxIncl\n');
  });

  it('changes source identity when source content changes, including a null becoming empty', () => {
    const first = contentHash(canonicalContent(normalizeSource(source, scope)));
    const changedName = normalizeSource({ ...source, products: source.products.map((row) => row.productId === 1 ? { ...row, name: 'Otra barra' } : row) }, scope);
    const changedNull = normalizeSource({ ...source, features: source.features.map((row) => row.value === null ? { ...row, value: '' } : row) }, scope);
    expect(contentHash(canonicalContent(changedName))).not.toBe(first);
    expect(contentHash(canonicalContent(changedNull))).not.toBe(first);
    const orphan = normalizeSource({ ...source, categories: [...source.categories, { productId: 4, categoryId: 99, name: 'Archivada' }] }, scope);
    expect(orphan.orphanReferences.categories).toEqual([{ productId: 4, categoryId: 99, name: 'Archivada' }]);
    expect(contentHash(canonicalContent(orphan))).not.toBe(first);
  });

  it('keeps runtime metadata outside the aggregate content hash and rejects invalid manifests', () => {
    const first = manifest();
    const later = { ...first, source: { ...first.source, observedAt: '2026-10-01T11:00:00.000Z' },
      extractor: { ...first.extractor, buildRef: 'different-deployment' } };
    expect(validateManifest(first, first.artifacts).aggregateContentHash).toBe(validateManifest(later, later.artifacts).aggregateContentHash);
    expect(() => validateManifest({ ...first, sourceExtractionId: 'sha256:wrong' }, first.artifacts)).toThrow();
    expect(() => validateManifest({ ...first, aggregateContentHash: contentHash('wrong') }, first.artifacts)).toThrow('INVALID_MANIFEST');
  });

  it('canonicalizes trust-map row order and rejects non-SELECT data queries', () => {
    const left = 'categoryId,categoryName,trustClass\r\n2,Bancos,SEMANTIC_STRONG\r\n1,Raíz,NAVIGATION\r\n';
    const right = 'categoryId,categoryName,trustClass\n1,Rai\u0301z,NAVIGATION\n2,Bancos,SEMANTIC_STRONG\n';
    expect(canonicalTrustMap(left, 'categoryId')).toBe(canonicalTrustMap(right, 'categoryId'));
    expect(() => assertReadOnlySelect(' SELECT p.id_product FROM ps_product p')).not.toThrow();
    expect(() => assertReadOnlySelect('UPDATE ps_product SET active = 1')).toThrow();
    expect(() => assertReadOnlySelect('SELECT 1; DELETE FROM ps_product')).toThrow();
    expect(() => assertReadOnlySelect('SELECT name INTO OUTFILE \'/tmp/out\' FROM ps_product')).toThrow();
    expect(() => assertReadOnlySelect('SELECT * FROM ps_product FOR UPDATE')).toThrow();
  });

  it('does not leave a final artifact if validation fails, then reuses verified content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cat-v2-extract-'));
    const hash = contentHash('content');
    try {
      await expect(publishLocalExtraction(root, hash, { 'canonical_input.json': 'content' }, async () => {
        throw new Error('INVALID_MANIFEST: deliberate failure');
      })).rejects.toThrow('INVALID_MANIFEST');
      expect(await readdir(root)).toEqual([]);
      const first = await publishLocalExtraction(root, hash, { 'canonical_input.json': 'content' }, async (dir) => {
        expect(await readFile(path.join(dir, 'canonical_input.json'), 'utf8')).toBe('content');
      });
      expect(first.reused).toBe(false);
      const second = await publishLocalExtraction(root, hash, { 'canonical_input.json': 'content' }, async () => {});
      expect(second).toEqual({ directory: first.directory, reused: true });
      await expect(publishLocalExtraction(root, hash, { 'canonical_input.json': 'different' }, async () => {}))
        .rejects.toThrow('NON_DETERMINISTIC_OUTPUT');
    } finally {
      if (path.basename(root).startsWith('cat-v2-extract-') && path.dirname(root) === os.tmpdir()) {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});
