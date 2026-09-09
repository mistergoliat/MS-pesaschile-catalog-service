import { describe, expect, it } from 'vitest';
import { DefaultTrainingSemanticQueryService } from '../../src/application/catalog/training-semantic-query/index.js';
import { DefaultActiveTrainingSemanticSnapshotV2Reader } from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotV2Store } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.js';
import { buildApp } from '../../src/interfaces/http/app.js';
import { createRepositoryStub } from '../support/fakes.js';

const SNAPSHOT_ID = 'sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1';

async function appWithQueryService() {
  const reader = new DefaultActiveTrainingSemanticSnapshotV2Reader(new FileTrainingSemanticSnapshotV2Store('data/training-semantic-snapshots/v2'));
  await reader.refresh();
  return buildApp({
    service: { searchProducts: async () => ({ query: '', items: [], freshness: { cached: false, generatedAt: new Date().toISOString() } }), getProduct: async () => { throw new Error('not exercised'); }, batchGetProducts: async () => ({ items: [] }) } as never,
    trainingSemanticQueryService: new DefaultTrainingSemanticQueryService(reader),
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

describe('Training Semantic Query Surface V2', () => {
  it('answers capability and derived-axis constraints from the frozen snapshot', async () => {
    const app = await appWithQueryService();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/training-semantics/query',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { schemaVersion: 1, requirements: [{ axis: 'BODY_REGION', codes: ['LOWER_BODY'], mode: 'required', match: 'any' }], options: { limit: 100 } },
    });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.lineage).toMatchObject({ snapshotId: SNAPSHOT_ID });
    expect(body.totalMatches).toBeGreaterThan(0);
    expect(body.results.every((result: { productId: number }) => result.productId !== 1122 && result.productId !== 2025 && result.productId !== 1945 && result.productId !== 1946 && result.productId !== 1947 && result.productId !== 1948)).toBe(true);
    expect(body.results[0].matchedRequirements[0]).toMatchObject({ axis: 'BODY_REGION', matchedCodes: ['LOWER_BODY'], reason: 'required_match' });
    await app.close();
  });

  it('uses preferred requirements only for ranking and does not make them a catalog-wide fallback', async () => {
    const app = await appWithQueryService();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/products/training-semantics/query',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['ROW'], mode: 'preferred', match: 'any' }], options: { limit: 100 } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results.length).toBeGreaterThan(0);
    expect(response.json().results.every((result: { matchedRequirements: unknown[] }) => result.matchedRequirements.length === 1)).toBe(true);
    await app.close();
  });

  it('keeps training functions separate from anatomy and enforces registry validation', async () => {
    const app = await appWithQueryService();
    const functionOnly = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'TRAINING_FUNCTION', codes: ['CABLE_RESISTANCE'], mode: 'required', match: 'any' }], options: { limit: 100 } } });
    expect(functionOnly.statusCode).toBe(200);
    expect(functionOnly.json().results.filter((result: { exerciseCapabilities: unknown[]; trainingFunctions: { code: string }[] }) => result.exerciseCapabilities.length === 0 && result.trainingFunctions.some((assignment) => assignment.code === 'CABLE_RESISTANCE')).every((result: { derived: { bodyRegions: string[]; primaryMuscleGroups: string[]; trainingPatterns: string[] } }) => result.derived.bodyRegions.length === 0 && result.derived.primaryMuscleGroups.length === 0 && result.derived.trainingPatterns.length === 0)).toBe(true);

    const unknownCode = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['SQUAT'], mode: 'required', match: 'any' }] } });
    const unknownAxis = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'TRAINING_GOAL', codes: ['STRENGTH'], mode: 'required', match: 'any' }] } });
    expect(unknownCode.statusCode).toBe(400);
    expect(unknownAxis.statusCode).toBe(400);
    await app.close();
  });

  it('supports any/all, pinning, empty results, and authentication errors', async () => {
    const app = await appWithQueryService();
    const all = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['LEG_PRESS', 'ROW'], mode: 'required', match: 'all' }] } });
    const empty = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', headers: { 'x-api-key': 'test-api-key' }, payload: { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['LEG_PRESS', 'ROW'], mode: 'required', match: 'any' }], options: { limit: 1 } } });
    const mismatch = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', headers: { 'x-api-key': 'test-api-key' }, payload: { expectedSnapshotId: `sha256:${'d'.repeat(64)}`, requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['ROW'], mode: 'required', match: 'any' }] } });
    const unauthorized = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', payload: { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['ROW'], mode: 'required', match: 'any' }] } });
    expect(all.statusCode).toBe(200);
    expect(all.json().results).toEqual([]);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ totalMatches: expect.any(Number), truncated: expect.any(Boolean) });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('TRAINING_SEMANTIC_SNAPSHOT_MISMATCH');
    expect(unauthorized.statusCode).toBe(401);
    await app.close();
  });
});
