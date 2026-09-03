import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import type {
  ActiveProductSemanticSnapshotReader,
  ProductSemanticActiveSnapshotMetadata,
  ProductSemanticRuntimeStatus,
} from '../../src/domain/product-semantic-snapshot/runtime/index.js';
import type { ProductSemanticSnapshotFact } from '../../src/domain/product-semantic-snapshot/contracts.js';
import { createRepositoryStub } from '../support/fakes.js';
import { PRODUCT_SEMANTICS_BATCH_MAX_SIZE } from '../../src/interfaces/http/routes/getProductSemanticsBatchRoute.js';

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
    sourceProductCount: 4,
    recordCount: 4,
    classificationCounts: { CLASSIFIED: 1, PARTIALLY_CLASSIFIED: 1, OTHER: 1, EXCLUDED_NON_PRODUCT: 1, NEEDS_REVIEW: 0 },
    ...overrides,
  };
}

function fact(productId: string, classificationStatus: ProductSemanticSnapshotFact['classificationStatus']): ProductSemanticSnapshotFact {
  return {
    productId,
    classificationStatus,
    primaryProductFamily: classificationStatus === 'CLASSIFIED'
      ? { axis: 'PRODUCT_FAMILY', code: 'BARBELL', confidence: 'EXPLICIT', ruleId: 'rule' }
      : null,
    secondaryProductFamilies: [],
    disciplines: [],
    useContexts: [],
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: ONTOLOGY_HASH,
    provenance: { evidence: [], exclusion: classificationStatus === 'EXCLUDED_NON_PRODUCT' ? { ruleId: 'excluded', reason: 'not a product' } : null },
    needsReviewCandidates: [],
  };
}

function reader(input: { metadata: ProductSemanticActiveSnapshotMetadata | null; facts: ProductSemanticSnapshotFact[] }): ActiveProductSemanticSnapshotReader {
  const facts = new Map(input.facts.map((item) => [item.productId, item]));
  return {
    async refresh() { throw new Error('not exercised'); },
    getStatus(): ProductSemanticRuntimeStatus { return input.metadata ? { state: 'ready', ...input.metadata } : { state: 'not_loaded' }; },
    getActiveSnapshotMetadata: () => input.metadata,
    hasProduct: (productId) => facts.has(productId),
    getProductSemanticFact: (productId) => facts.get(productId) ?? null,
    getAllProductSemanticFacts: () => [...facts.values()],
  };
}

async function appWith(input: { metadata: ProductSemanticActiveSnapshotMetadata | null; facts?: ProductSemanticSnapshotFact[] }) {
  return buildApp({
    service: { searchProducts: async () => ({ query: '', items: [], freshness: { cached: false, generatedAt: new Date().toISOString() } }), getProduct: async () => { throw new Error('not exercised'); }, batchGetProducts: async () => ({ items: [] }) } as never,
    productSemanticSnapshotReader: reader({ metadata: input.metadata, facts: input.facts ?? [] }),
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

describe('POST /v1/products/semantics/batch', () => {
  it('returns normalized, ordered facts and missing IDs without exposing provenance', async () => {
    const app = await appWith({ metadata: metadata(), facts: [
      fact('29', 'CLASSIFIED'), fact('31', 'OTHER'), fact('332', 'EXCLUDED_NON_PRODUCT'),
    ] });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/semantics/batch',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { productIds: [31, 29, 31, 332, 999999] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: '1', snapshotId: SNAPSHOT_ID, ontologyVersion: 'commercial-product-ontology-v3',
      ontologyHash: ONTOLOGY_HASH, classifierVersion: 'product-semantic-classifier-v1', semanticChecksum: SEMANTIC_CHECKSUM,
      products: [
        { productId: 31, classificationStatus: 'OTHER', primaryProductFamily: null, secondaryProductFamilies: [], disciplines: [], useContexts: [] },
        { productId: 29, classificationStatus: 'CLASSIFIED', primaryProductFamily: { code: 'BARBELL', confidence: 'EXPLICIT' }, secondaryProductFamilies: [], disciplines: [], useContexts: [] },
        { productId: 332, classificationStatus: 'EXCLUDED_NON_PRODUCT', primaryProductFamily: null, secondaryProductFamilies: [], disciplines: [], useContexts: [] },
      ],
      missingProductIds: [999999],
    });
    await app.close();
  });

  it('pins matching snapshots and rejects a mismatch', async () => {
    const app = await appWith({ metadata: metadata(), facts: [fact('29', 'CLASSIFIED')] });
    const matched = await app.inject({ method: 'POST', url: '/v1/products/semantics/batch', headers: { 'x-api-key': 'test-api-key' }, payload: { productIds: [29], expectedSnapshotId: SNAPSHOT_ID } });
    const mismatched = await app.inject({ method: 'POST', url: '/v1/products/semantics/batch', headers: { 'x-api-key': 'test-api-key' }, payload: { productIds: [29], expectedSnapshotId: `sha256:${'d'.repeat(64)}` } });
    expect(matched.statusCode).toBe(200);
    expect(mismatched.statusCode).toBe(409);
    expect(mismatched.json().error.code).toBe('PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH');
    await app.close();
  });

  it.each([
    [{ productIds: [] }, 'empty array'],
    [{ productIds: [0] }, 'invalid id'],
    [{ productIds: [1], expectedSnapshotId: 'bad' }, 'invalid expected snapshot'],
    [{ productIds: Array.from({ length: PRODUCT_SEMANTICS_BATCH_MAX_SIZE + 1 }, (_, index) => index + 1) }, 'batch limit'],
  ])('returns 400 for %s', async (payload, _label) => {
    const app = await appWith({ metadata: metadata(), facts: [] });
    const response = await app.inject({ method: 'POST', url: '/v1/products/semantics/batch', headers: { 'x-api-key': 'test-api-key' }, payload });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 503 when the active snapshot is unavailable and 401 without auth', async () => {
    const app = await appWith({ metadata: null });
    const unavailable = await app.inject({ method: 'POST', url: '/v1/products/semantics/batch', headers: { 'x-api-key': 'test-api-key' }, payload: { productIds: [29] } });
    const unauthorized = await app.inject({ method: 'POST', url: '/v1/products/semantics/batch', payload: { productIds: [29] } });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe('PRODUCT_SEMANTICS_UNAVAILABLE');
    expect(unauthorized.statusCode).toBe(401);
    await app.close();
  });
});
