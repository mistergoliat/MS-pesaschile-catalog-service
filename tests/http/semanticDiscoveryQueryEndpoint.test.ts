import { describe, expect, it } from 'vitest';
import { DefaultSemanticDiscoveryService } from '../../src/application/catalog/semantic-discovery/index.js';
import { DefaultTrainingSemanticQueryService } from '../../src/application/catalog/training-semantic-query/index.js';
import { DefaultActiveTrainingSemanticSnapshotV2Reader } from '../../src/domain/training-semantic-snapshot/index.js';
import type { ActiveProductSemanticSnapshotReader, ProductSemanticActiveSnapshotMetadata, ProductSemanticRuntimeStatus } from '../../src/domain/product-semantic-snapshot/runtime/index.js';
import type { ProductSemanticSnapshotFact } from '../../src/domain/product-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotV2Store } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.js';
import { buildApp } from '../../src/interfaces/http/app.js';
import { getTrainingSemanticRegistryV2 } from '../../src/domain/training-semantics-v2/index.js';
import { createRepositoryStub } from '../support/fakes.js';

const PRODUCT_SNAPSHOT_ID = `sha256:${'a'.repeat(64)}`;
const TRAINING_SNAPSHOT_ID = 'sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1';
const ONTOLOGY_HASH = 'b'.repeat(64);
const SEMANTIC_CHECKSUM = 'c'.repeat(64);

function productMetadata(overrides: Partial<ProductSemanticActiveSnapshotMetadata> = {}): ProductSemanticActiveSnapshotMetadata {
  return {
    snapshotId: PRODUCT_SNAPSHOT_ID,
    schemaVersion: '1',
    classifierVersion: 'product-semantic-classifier-v1',
    builtAt: '2026-08-29T20:36:33.148Z',
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: ONTOLOGY_HASH,
    semanticChecksum: SEMANTIC_CHECKSUM,
    sourceProductCount: 4,
    recordCount: 4,
    classificationCounts: { CLASSIFIED: 4, PARTIALLY_CLASSIFIED: 0, OTHER: 0, EXCLUDED_NON_PRODUCT: 0, NEEDS_REVIEW: 0 },
    ...overrides,
  };
}

function productFact(productId: string, input: { family?: string; discipline?: string; useContext?: string; catalogPresence?: ProductSemanticSnapshotFact['catalogPresence'] }): ProductSemanticSnapshotFact {
  const tag = (axis: 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT', code: string) => ({ axis, code, confidence: 'EXPLICIT' as const, ruleId: `TEST_${axis}` });
  return {
    productId,
    catalogPresence: input.catalogPresence ?? 'current_catalog',
    classificationStatus: 'CLASSIFIED',
    primaryProductFamily: input.family ? tag('PRODUCT_FAMILY', input.family) : null,
    secondaryProductFamilies: [],
    disciplines: input.discipline ? [tag('DISCIPLINE', input.discipline)] : [],
    useContexts: input.useContext ? [tag('USE_CONTEXT', input.useContext)] : [],
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: ONTOLOGY_HASH,
    provenance: { evidence: [], exclusion: null },
    needsReviewCandidates: [],
  };
}

function productReader(facts: readonly ProductSemanticSnapshotFact[], metadata: ProductSemanticActiveSnapshotMetadata | null = productMetadata()): ActiveProductSemanticSnapshotReader {
  const byId = new Map(facts.map((fact) => [fact.productId, fact]));
  return {
    async refresh() { throw new Error('not exercised'); },
    getStatus(): ProductSemanticRuntimeStatus { return metadata ? { state: 'ready', ...metadata } : { state: 'not_loaded' }; },
    getActiveSnapshotMetadata() { return metadata; },
    hasProduct(productId: string) { return byId.has(productId); },
    getProductSemanticFact(productId: string) { return byId.get(productId) ?? null; },
    getAllProductSemanticFacts() { return [...byId.values()]; },
  };
}

async function appWith(input: { productReader?: ActiveProductSemanticSnapshotReader; trainingReader?: DefaultActiveTrainingSemanticSnapshotV2Reader }) {
  return buildApp({
    service: { searchProducts: async () => ({ query: '', items: [], freshness: { cached: false, generatedAt: new Date().toISOString() } }), getProduct: async () => { throw new Error('not exercised'); }, batchGetProducts: async () => ({ items: [] }) } as never,
    productSemanticSnapshotReader: input.productReader,
    semanticDiscoveryService: new DefaultSemanticDiscoveryService(input.productReader, input.trainingReader),
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

async function trainingReader() {
  const reader = new DefaultActiveTrainingSemanticSnapshotV2Reader(new FileTrainingSemanticSnapshotV2Store('data/training-semantic-snapshots/v2'));
  await reader.refresh();
  return reader;
}

describe('Combined Semantic Discovery Query', () => {
  it('excludes historical-only product IDs from commercial discovery while retaining their semantic facts', async () => {
    const product = productReader([
      productFact('197', { family: 'DUMBBELL', catalogPresence: 'historical_order_detail_only' }),
      productFact('198', { family: 'DUMBBELL' }),
    ]);
    const app = await appWith({ productReader: product });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/semantic-discovery/query',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { requirements: [{ axis: 'PRODUCT_FAMILY', codes: ['DUMBBELL'], mode: 'required', match: 'any' }] },
    });
    const historicalSemantics = await app.inject({
      method: 'GET',
      url: '/v1/products/197/semantics',
      headers: { 'x-api-key': 'test-api-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results.map((result: { productId: number }) => result.productId)).toEqual([198]);
    expect(historicalSemantics.statusCode).toBe(200);
    expect(historicalSemantics.json()).toMatchObject({ productId: 197, catalogPresence: 'historical_order_detail_only' });
    await app.close();
  });

  it('queries product axes, training axes, and their required intersection', async () => {
    const training = await trainingReader();
    const product = productReader([
      productFact('278', { family: 'SELECTORIZED_MACHINE', useContext: 'HOME_GYM' }),
      productFact('175', { family: 'RACK_CAGE', useContext: 'COMMERCIAL_GYM' }),
      productFact('87', { family: 'CABLE_MACHINE', useContext: 'COMMERCIAL_GYM' }),
      productFact('287', { family: 'RACK_CAGE', useContext: 'HOME_GYM' }),
    ]);
    const app = await appWith({ productReader: product, trainingReader: training });

    const productOnly = await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'PRODUCT_FAMILY', codes: ['RACK_CAGE'], mode: 'required', match: 'any' }] } });
    expect(productOnly.statusCode).toBe(200);
    expect(productOnly.json().results.map((result: { productId: number }) => result.productId)).toEqual([175, 287]);
    expect(productOnly.json().results[0]).toMatchObject({ productSemantics: { primaryProductFamily: { code: 'RACK_CAGE' } }, trainingSemantics: null });

    const crossDomain = await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }, { axis: 'BODY_REGION', codes: ['LOWER_BODY'], mode: 'required', match: 'any' }] } });
    expect(crossDomain.statusCode).toBe(200);
    expect(crossDomain.json().results.map((result: { productId: number }) => result.productId)).toEqual([278]);
    expect(crossDomain.json().results[0].matchedRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis: 'USE_CONTEXT', source: 'PRODUCT_SEMANTICS', matchedCodes: ['HOME_GYM'] }),
      expect.objectContaining({ axis: 'BODY_REGION', source: 'TRAINING_SEMANTICS', matchedCodes: ['LOWER_BODY'] }),
    ]));
    expect(crossDomain.json().lineage).toMatchObject({ productSemantics: { snapshotId: PRODUCT_SNAPSHOT_ID }, trainingSemantics: { snapshotId: TRAINING_SNAPSHOT_ID, registryHash: getTrainingSemanticRegistryV2().registryHash } });
    await app.close();
  });

  it('keeps training-only results consistent with A00.8 and tolerates an unavailable product source', async () => {
    const training = await trainingReader();
    const combinedApp = await appWith({ trainingReader: training });
    const combined = await combinedApp.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['ROW'], mode: 'required', match: 'any' }], options: { limit: 100 } } });
    const trainingService = new DefaultTrainingSemanticQueryService(training);
    const trainingOnly = trainingService.query({ requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['ROW'], mode: 'required', match: 'any' }], options: { limit: 100 } });
    expect(combined.statusCode).toBe(200);
    expect(combined.json().results.map((result: { productId: number }) => result.productId)).toEqual(trainingOnly.results.map((result) => result.productId));
    expect(combined.json().lineage.productSemantics).toBeNull();
    await combinedApp.close();
  });

  it('enforces source-specific pins, strict validation, no relaxation, and dependency errors', async () => {
    const product = productReader([productFact('278', { family: 'SELECTORIZED_MACHINE', useContext: 'HOME_GYM' })]);
    const app = await appWith({ productReader: product });
    const mismatch = await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { expectedSnapshots: { productSemanticSnapshotId: `sha256:${'d'.repeat(64)}` }, requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }] } });
    const unknown = await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME'], mode: 'required', match: 'any' }] } });
    const relation = await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], relations: ['DIRECT'], mode: 'required', match: 'any' }] } });
    const unavailable = await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'BODY_REGION', codes: ['LOWER_BODY'], mode: 'required', match: 'any' }] } });
    const trainingApp = await appWith({ trainingReader: await trainingReader() });
    const trainingMismatch = await trainingApp.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { expectedSnapshots: { trainingSemanticSnapshotId: `sha256:${'e'.repeat(64)}` }, requirements: [{ axis: 'BODY_REGION', codes: ['LOWER_BODY'], mode: 'required', match: 'any' }] } });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH');
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('INVALID_SEMANTIC_DISCOVERY_REQUEST');
    expect(relation.statusCode).toBe(400);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe('TRAINING_SEMANTICS_UNAVAILABLE');
    expect(trainingMismatch.statusCode).toBe(409);
    expect(trainingMismatch.json().error.code).toBe('TRAINING_SEMANTIC_SNAPSHOT_MISMATCH');
    await app.close();
    await trainingApp.close();
  });

  it('returns a valid empty intersection and excludes unresolved training records', async () => {
    const app = await appWith({ productReader: productReader([productFact('278', { family: 'SELECTORIZED_MACHINE', useContext: 'COMMERCIAL_GYM' })]), trainingReader: await trainingReader() });
    const response = await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['LEG_PRESS'], mode: 'required', match: 'any' }, { axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ results: [], totalMatches: 0, truncated: false });
    const trainingOnly = await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['ROW'], mode: 'required', match: 'any' }], options: { limit: 100 } } });
    expect(trainingOnly.statusCode).toBe(200);
    expect(trainingOnly.json().results.map((result: { productId: number }) => result.productId)).not.toEqual(expect.arrayContaining([1122, 2025, 1945, 1946, 1947, 1948]));
    await app.close();
  });
});
