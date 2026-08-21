import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { collectRuntimeReadinessChecks } from '../../src/shared/readiness.js';
import { createRepositoryStub } from '../support/fakes.js';

function appWithChecks(checks: { database: 'ok' | 'unavailable'; redis: 'ok' | 'unavailable'; relationshipSnapshot: 'ok' | 'unavailable' }) {
  return buildApp({
    service: {
      searchProducts: vi.fn(),
      getProduct: vi.fn(),
      batchGetProducts: vi.fn(),
    } as never,
    repository: createRepositoryStub(),
    readyCheck: async () => checks,
  });
}

describe('runtime readiness checks', () => {
  it('reports DB ok / Redis ok / snapshot ok', async () => {
    const checks = await collectRuntimeReadinessChecks({
      repository: { ping: vi.fn().mockResolvedValue(undefined) },
      cache: { ping: vi.fn().mockResolvedValue(true) },
      cacheDriver: 'redis',
      relationshipSnapshotReader: { getStatus: () => ({ state: 'ready' as const }) },
    });

    expect(checks).toEqual({
      database: 'ok',
      redis: 'ok',
      relationshipSnapshot: 'ok',
    });
  });

  it('reports DB fail / Redis ok / snapshot ok independently', async () => {
    const checks = await collectRuntimeReadinessChecks({
      repository: { ping: vi.fn().mockRejectedValue(new Error('db down')) },
      cache: { ping: vi.fn().mockResolvedValue(true) },
      cacheDriver: 'redis',
      relationshipSnapshotReader: { getStatus: () => ({ state: 'ready' as const }) },
    });

    expect(checks).toEqual({
      database: 'unavailable',
      redis: 'ok',
      relationshipSnapshot: 'ok',
    });
  });

  it('reports DB ok / Redis fail / snapshot ok independently', async () => {
    const checks = await collectRuntimeReadinessChecks({
      repository: { ping: vi.fn().mockResolvedValue(undefined) },
      cache: { ping: vi.fn().mockRejectedValue(new Error('redis down')) },
      cacheDriver: 'redis',
      relationshipSnapshotReader: { getStatus: () => ({ state: 'ready' as const }) },
    });

    expect(checks).toEqual({
      database: 'ok',
      redis: 'unavailable',
      relationshipSnapshot: 'ok',
    });
  });

  it('reports DB ok / Redis ok / snapshot unavailable', async () => {
    const checks = await collectRuntimeReadinessChecks({
      repository: { ping: vi.fn().mockResolvedValue(undefined) },
      cache: { ping: vi.fn().mockResolvedValue(true) },
      cacheDriver: 'redis',
      relationshipSnapshotReader: { getStatus: () => ({ state: 'not_loaded' as const }) },
    });

    expect(checks).toEqual({
      database: 'ok',
      redis: 'ok',
      relationshipSnapshot: 'unavailable',
    });
  });

  it('reports DB fail / Redis fail / snapshot unavailable without masking states', async () => {
    const checks = await collectRuntimeReadinessChecks({
      repository: { ping: vi.fn().mockRejectedValue(new Error('db down')) },
      cache: { ping: vi.fn().mockResolvedValue(false) },
      cacheDriver: 'redis',
      relationshipSnapshotReader: { getStatus: () => ({ state: 'not_loaded' as const }) },
    });

    expect(checks).toEqual({
      database: 'unavailable',
      redis: 'unavailable',
      relationshipSnapshot: 'unavailable',
    });
  });

  it('treats CACHE_DRIVER=memory as redis ok without issuing a Redis ping', async () => {
    const cache = { ping: vi.fn().mockResolvedValue(false) };
    const checks = await collectRuntimeReadinessChecks({
      repository: { ping: vi.fn().mockResolvedValue(undefined) },
      cache,
      cacheDriver: 'memory',
      relationshipSnapshotReader: { getStatus: () => ({ state: 'ready' as const }) },
    });

    expect(checks).toEqual({
      database: 'ok',
      redis: 'ok',
      relationshipSnapshot: 'ok',
    });
    expect(cache.ping).not.toHaveBeenCalled();
  });
});

describe('/health/ready', () => {
  it('returns 200 when all hard dependencies are ok', async () => {
    const app = await appWithChecks({ database: 'ok', redis: 'ok', relationshipSnapshot: 'ok' });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });

  const degradedCases: Array<{ database: 'ok' | 'unavailable'; redis: 'ok' | 'unavailable'; relationshipSnapshot: 'ok' | 'unavailable' }> = [
    { database: 'unavailable', redis: 'ok', relationshipSnapshot: 'ok' },
    { database: 'ok', redis: 'unavailable', relationshipSnapshot: 'ok' },
    { database: 'ok', redis: 'ok', relationshipSnapshot: 'unavailable' },
  ];

  it.each(degradedCases)('returns 503 when any hard dependency is unavailable: %j', async (checks) => {
    const app = await appWithChecks(checks);
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded', checks });
    await app.close();
  });
});
