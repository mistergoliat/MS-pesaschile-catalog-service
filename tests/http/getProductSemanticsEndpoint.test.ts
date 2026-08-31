import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import type {
  ActiveProductSemanticSnapshotReader,
  ProductSemanticActiveSnapshotMetadata,
  ProductSemanticRuntimeStatus,
} from '../../src/domain/product-semantic-snapshot/runtime/index.js';
import type { ProductSemanticSnapshotFact } from '../../src/domain/product-semantic-snapshot/contracts.js';
import { createRepositoryStub } from '../support/fakes.js';

const ONTOLOGY_HASH = 'a'.repeat(64);
const SEMANTIC_CHECKSUM = 'b'.repeat(64);
const SNAPSHOT_ID = `sha256:${'c'.repeat(64)}`;

function metadata(overrides: Partial<ProductSemanticActiveSnapshotMetadata> = {}): ProductSemanticActiveSnapshotMetadata {
  return {
    snapshotId: SNAPSHOT_ID,
    schemaVersion: '1',
    classifierVersion: 'product-semantic-classifier-v1',
    builtAt: '2026-08-29T20:36:33.148Z',
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: ONTOLOGY_HASH,
    semanticChecksum: SEMANTIC_CHECKSUM,
    sourceProductCount: 2011,
    recordCount: 2011,
    classificationCounts: {
      CLASSIFIED: 1281,
      PARTIALLY_CLASSIFIED: 400,
      OTHER: 317,
      EXCLUDED_NON_PRODUCT: 13,
      NEEDS_REVIEW: 0,
    },
    ...overrides,
  };
}

function fact(overrides: Partial<ProductSemanticSnapshotFact> & { productId: string }): ProductSemanticSnapshotFact {
  return {
    classificationStatus: 'CLASSIFIED',
    primaryProductFamily: null,
    secondaryProductFamilies: [],
    disciplines: [],
    useContexts: [],
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: ONTOLOGY_HASH,
    provenance: { evidence: [], exclusion: null },
    needsReviewCandidates: [],
    ...overrides,
  };
}

function fakeReader(input: { metadata: ProductSemanticActiveSnapshotMetadata | null; facts?: ProductSemanticSnapshotFact[] }): ActiveProductSemanticSnapshotReader {
  const facts = new Map((input.facts ?? []).map((item) => [item.productId, item]));
  return {
    async refresh() {
      throw new Error('refresh is not exercised through this fake');
    },
    getStatus(): ProductSemanticRuntimeStatus {
      return input.metadata ? { state: 'ready', ...input.metadata } : { state: 'not_loaded' };
    },
    getActiveSnapshotMetadata() {
      return input.metadata;
    },
    hasProduct(productId: string) {
      return facts.has(productId);
    },
    getProductSemanticFact(productId: string) {
      return facts.get(productId) ?? null;
    },
    getAllProductSemanticFacts() {
      return [...facts.values()];
    },
  };
}

async function makeApp(reader?: ActiveProductSemanticSnapshotReader) {
  return buildApp({
    service: {
      searchProducts: async () => ({ query: '', items: [], freshness: { cached: false, generatedAt: new Date().toISOString() } }),
      getProduct: async () => {
        throw new Error('not exercised');
      },
      batchGetProducts: async () => ({ items: [] }),
    } as never,
    productSemanticSnapshotReader: reader,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

describe('GET /v1/products/:productId/semantics', () => {
  it('returns 200 with the classified fact for a CLASSIFIED product', async () => {
    const app = await makeApp(fakeReader({
      metadata: metadata(),
      facts: [
        fact({
          productId: '29',
          classificationStatus: 'CLASSIFIED',
          primaryProductFamily: { axis: 'PRODUCT_FAMILY', code: 'BARBELL', confidence: 'EXPLICIT', ruleId: 'PF_BARBELL_NAME_V1' },
          disciplines: [{ axis: 'DISCIPLINE', code: 'CROSSFIT', confidence: 'STRONGLY_INFERRED', ruleId: 'DISC_CROSSFIT_V1' }],
        }),
      ],
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/29/semantics',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      productId: 29,
      classificationStatus: 'CLASSIFIED',
      primaryProductFamily: { code: 'BARBELL' },
      classifierVersion: 'product-semantic-classifier-v1',
      snapshotId: SNAPSHOT_ID,
    });
    await app.close();
  });

  it('returns 200 with classificationStatus OTHER instead of 404 when a product carries no semantic tags', async () => {
    const app = await makeApp(fakeReader({
      metadata: metadata(),
      facts: [fact({ productId: '1023', classificationStatus: 'OTHER' })],
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/1023/semantics',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ productId: 1023, classificationStatus: 'OTHER', primaryProductFamily: null });
    await app.close();
  });

  it('returns 200 with exclusion provenance for EXCLUDED_NON_PRODUCT', async () => {
    const app = await makeApp(fakeReader({
      metadata: metadata(),
      facts: [
        fact({
          productId: '444',
          classificationStatus: 'EXCLUDED_NON_PRODUCT',
          provenance: { evidence: [], exclusion: { ruleId: 'NON_PRODUCT_KNOWN_ID_V1', reason: 'known non-product id' } },
        }),
      ],
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/444/semantics',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      classificationStatus: 'EXCLUDED_NON_PRODUCT',
      provenance: { exclusion: { ruleId: 'NON_PRODUCT_KNOWN_ID_V1', reason: 'known non-product id' } },
    });
    await app.close();
  });

  it('returns 404 when the product is absent from the active snapshot universe', async () => {
    const app = await makeApp(fakeReader({ metadata: metadata(), facts: [] }));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/999999/semantics',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PRODUCT_SEMANTICS_NOT_FOUND');
    await app.close();
  });

  it('returns 503 (not an empty success) when no snapshot has been loaded', async () => {
    const app = await makeApp(fakeReader({ metadata: null }));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/29/semantics',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('PRODUCT_SEMANTICS_UNAVAILABLE');
    await app.close();
  });

  it('returns 503 when the reader dependency is not wired at all', async () => {
    const app = await makeApp(undefined);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/29/semantics',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('PRODUCT_SEMANTICS_UNAVAILABLE');
    await app.close();
  });

  it('returns 401 without an api key', async () => {
    const app = await makeApp(fakeReader({ metadata: metadata(), facts: [fact({ productId: '29' })] }));

    const response = await app.inject({ method: 'GET', url: '/v1/products/29/semantics' });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns 400 for a non-numeric productId', async () => {
    const app = await makeApp(fakeReader({ metadata: metadata(), facts: [] }));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/products/abc/semantics',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
