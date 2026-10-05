import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { createRepositoryStub } from '../support/fakes.js';

describe('GET /health/catalog-authority', () => {
  it('serves the injected read-only authority view without exposing secrets or requiring an API key', async () => {
    const authoritySnapshot = {
      schemaVersion: 1,
      projection: { bundleId: 'sha256:bundle', activationId: 'activation', loadedAt: '2026-10-01T12:00:00.000Z',
        desiredBundleId: 'sha256:bundle', desiredActivationId: 'activation', reloadState: 'READY' },
      authorities: {
        commercialV2: { authority: 'prestashop-v2-commercial-runtime', status: 'READY' },
        productSemantics: { authority: 'cat-v2-product-semantics', status: 'READY', fallbackEnabled: true, legacyFallbackReads: 0 },
        productOntologyRegistry: { authority: 'code-product-ontology-v3', status: 'READY' },
        trainingSemanticsV1CatV2: { authority: 'cat-v2-training-semantics-v1', status: 'READY' },
        trainingSemanticsV2: { authority: 'cat-v2-training-semantics-v2', status: 'READY', migrationStatus: 'COMPLETE', snapshotId: 'native-v2',
          projectionId: 'projection-v2', projectionBundleId: 'sha256:bundle', activationId: 'activation', loadedAt: '2026-10-01T12:00:00.000Z' },
        trainingRegistry: { authority: 'code-training-semantic-registry-v2', status: 'READY' },
        specs: { authority: 'cat-v2-specs', status: 'READY' },
        trustMaps: { authority: 'cat-v2-trust-maps', status: 'READY', consumedByCategorySelection: false,
          categorySelectionAuthority: 'static-category-trust-map' },
        relationshipsCatV2: { authority: null, status: 'UNAVAILABLE', reason: 'not_projected' },
        relationshipsRecommendation: { authority: 'legacy-relationship-snapshot', status: 'READY', snapshotId: 'legacy-relationships', modelVersion: 'same-order-v1', evidenceWindow: null },
        capabilitiesCatV2: { authority: null, status: 'UNAVAILABLE', reason: 'not_projected' },
      },
      build: { serviceBuildRef: 'catalog-service@test' },
    };
    const app = await buildApp({
      service: { searchProducts: vi.fn(), getProduct: vi.fn(), batchGetProducts: vi.fn() } as never,
      repository: createRepositoryStub(),
      readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
      catalogAuthoritySnapshot: async () => authoritySnapshot as never,
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/health/catalog-authority' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().authorities.trainingSemanticsV1CatV2.authority).toBe('cat-v2-training-semantics-v1');
      expect(response.json().authorities.trainingSemanticsV2).toMatchObject({ authority: 'cat-v2-training-semantics-v2', migrationStatus: 'COMPLETE', projectionId: 'projection-v2' });
      expect(response.json().authorities.relationshipsCatV2.status).toBe('UNAVAILABLE');
      expect(response.json().authorities.relationshipsRecommendation.status).toBe('READY');
      expect(JSON.stringify(response.json())).not.toContain('DB_PASSWORD');
      expect(JSON.stringify(response.json())).not.toContain('catalog_reader_password');

      const ready = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
