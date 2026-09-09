import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { DefaultTrainingSemanticReadService } from '../../src/application/catalog/training-semantic-read/index.js';
import { DefaultActiveTrainingSemanticSnapshotV2Reader, InMemoryTrainingSemanticSnapshotV2Store } from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotV2Store } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.js';
import { createRepositoryStub } from '../support/fakes.js';

const SNAPSHOT_ID = 'sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1';
const REGISTRY_HASH = '7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8';

async function appWith(service: DefaultTrainingSemanticReadService) {
  return buildApp({
    service: { searchProducts: async () => ({ query: '', items: [], freshness: { cached: false, generatedAt: new Date().toISOString() } }), getProduct: async () => { throw new Error('not exercised'); }, batchGetProducts: async () => ({ items: [] }) } as never,
    trainingSemanticReadService: service,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

async function realService() {
  const reader = new DefaultActiveTrainingSemanticSnapshotV2Reader(new FileTrainingSemanticSnapshotV2Store('data/training-semantic-snapshots/v2'));
  await reader.refresh();
  return new DefaultTrainingSemanticReadService(reader);
}

describe('Training Semantic Read Surface V2', () => {
  it('reads complete, verified-negative, and unresolved product truth from the accepted snapshot', async () => {
    const app = await appWith(await realService());
    const complete = await app.inject({ method: 'GET', url: '/v1/products/18/training-semantics', headers: { 'x-api-key': 'test-api-key' } });
    const verifiedNegative = await app.inject({ method: 'GET', url: '/v1/products/7/training-semantics', headers: { 'x-api-key': 'test-api-key' } });
    const dataGap = await app.inject({ method: 'GET', url: '/v1/products/1122/training-semantics', headers: { 'x-api-key': 'test-api-key' } });
    const ambiguous = await app.inject({ method: 'GET', url: '/v1/products/1945/training-semantics', headers: { 'x-api-key': 'test-api-key' } });

    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({ schemaVersion: '2', lineage: { snapshotId: SNAPSHOT_ID, registryHash: REGISTRY_HASH } });
    expect(verifiedNegative.statusCode).toBe(200);
    expect(verifiedNegative.json()).toMatchObject({ resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY', exerciseCapabilities: [], trainingFunctions: [], derived: { bodyRegions: [], trainingPatterns: [] } });
    expect(dataGap.json()).toMatchObject({ productId: 1122, resolutionState: 'DATA_GAP', exerciseCapabilities: [], trainingFunctions: [] });
    expect(ambiguous.json()).toMatchObject({ productId: 1945, resolutionState: 'AMBIGUOUS' });
    await app.close();
  });

  it('returns 404 for a missing snapshot product and 401 without the Catalog key', async () => {
    const app = await appWith(await realService());
    const missing = await app.inject({ method: 'GET', url: '/v1/products/999999/training-semantics', headers: { 'x-api-key': 'test-api-key' } });
    const unauthorized = await app.inject({ method: 'GET', url: '/v1/products/1122/training-semantics' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('TRAINING_SEMANTIC_PRODUCT_NOT_FOUND');
    expect(unauthorized.statusCode).toBe(401);
    await app.close();
  });

  it('deduplicates batch IDs, preserves first order, exposes lineage, and pins the snapshot', async () => {
    const app = await appWith(await realService());
    const response = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/batch', headers: { 'x-api-key': 'test-api-key' }, payload: { productIds: [1945, 1122, 1945, 999999], expectedSnapshotId: SNAPSHOT_ID } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: '2', lineage: { snapshotId: SNAPSHOT_ID }, products: [{ productId: 1945 }, { productId: 1122 }], missingProductIds: [999999] });

    const mismatch = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/batch', headers: { 'x-api-key': 'test-api-key' }, payload: { productIds: [1122], expectedSnapshotId: `sha256:${'d'.repeat(64)}` } });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('TRAINING_SEMANTIC_SNAPSHOT_MISMATCH');
    const tooMany = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/batch', headers: { 'x-api-key': 'test-api-key' }, payload: { productIds: Array.from({ length: 501 }, (_, index) => index + 1) } });
    expect(tooMany.statusCode).toBe(400);
    await app.close();
  });

  it('publishes the V2 registry without product assignments', async () => {
    const app = await appWith(await realService());
    const response = await app.inject({ method: 'GET', url: '/v1/products/training-semantics/registry', headers: { 'x-api-key': 'test-api-key' } });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ schemaVersion: '2', registryVersion: 'training-semantic-registry-v2', registryHash: REGISTRY_HASH });
    expect(body.exerciseCapabilities).toHaveLength(24);
    expect(body.trainingFunctions).toHaveLength(5);
    expect(body.exerciseCapabilities.map((item: { code: string }) => item.code)).not.toContain('SQUAT');
    expect(body.familyTrainingFunctionDerivations).toEqual([expect.objectContaining({ productFamily: 'CABLE_MACHINE', trainingFunctionCode: 'CABLE_RESISTANCE' })]);
    await app.close();
  });

  it('derives anatomy only from exercise capabilities', async () => {
    const app = await appWith(await realService());
    const functionOnly = await app.inject({ method: 'GET', url: '/v1/products/87/training-semantics', headers: { 'x-api-key': 'test-api-key' } });
    const legPress = await app.inject({ method: 'GET', url: '/v1/products/278/training-semantics', headers: { 'x-api-key': 'test-api-key' } });
    const guidedSupportOnly = await app.inject({ method: 'GET', url: '/v1/products/287/training-semantics', headers: { 'x-api-key': 'test-api-key' } });
    expect(functionOnly.json()).toMatchObject({ exerciseCapabilities: [], trainingFunctions: [{ code: 'CABLE_RESISTANCE' }], derived: { bodyRegions: [], primaryMuscleGroups: [], secondaryMuscleGroups: [], trainingPatterns: [] } });
    expect(legPress.json()).toMatchObject({ exerciseCapabilities: [expect.objectContaining({ code: 'LEG_PRESS' })], derived: { bodyRegions: ['LOWER_BODY'], primaryMuscleGroups: ['QUADRICEPS'], trainingPatterns: ['KNEE_EXTENSION'] } });
    expect(guidedSupportOnly.json()).toMatchObject({ exerciseCapabilities: [], trainingFunctions: [{ code: 'GUIDED_BARBELL_SUPPORT' }], derived: { bodyRegions: [], trainingPatterns: [] } });
    await app.close();
  });

  it('returns 503 when the V2 reader has no active snapshot', async () => {
    const reader = new DefaultActiveTrainingSemanticSnapshotV2Reader(new InMemoryTrainingSemanticSnapshotV2Store());
    await reader.refresh();
    const app = await appWith(new DefaultTrainingSemanticReadService(reader));
    const response = await app.inject({ method: 'GET', url: '/v1/products/1122/training-semantics', headers: { 'x-api-key': 'test-api-key' } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('TRAINING_SEMANTICS_UNAVAILABLE');
    await app.close();
  });

  it('uses the stable 400 contract for malformed single and batch requests', async () => {
    const app = await appWith(await realService());
    const single = await app.inject({ method: 'GET', url: '/v1/products/not-an-id/training-semantics', headers: { 'x-api-key': 'test-api-key' } });
    const batch = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/batch', headers: { 'x-api-key': 'test-api-key' }, payload: { productIds: [] } });
    expect(single.statusCode).toBe(400);
    expect(single.json().error.code).toBe('INVALID_TRAINING_SEMANTIC_REQUEST');
    expect(batch.statusCode).toBe(400);
    expect(batch.json().error.code).toBe('INVALID_TRAINING_SEMANTIC_REQUEST');
    await app.close();
  });
});
