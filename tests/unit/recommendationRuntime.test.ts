import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileProductRelationshipSnapshotStore } from '../../src/infrastructure/recommendation/fileProductRelationshipSnapshotStore.js';
import { createRecommendationRuntime } from '../../src/recommendationRuntime.js';
import { CatalogCommercialTruthService } from '../../src/domain/catalog/commercial-truth/index.js';
import { DefaultProductRelationshipSnapshotBuilder } from '../../src/domain/recommendation/relationship-engine/publication/index.js';
import { EmptyCustomerAffinityEvidenceProvider } from '../../src/infrastructure/recommendation/customerAffinityEvidenceProviders.js';

const sourceProduct = { productId: '1' } as const;
const targetProduct = { productId: '2' } as const;

function snapshot() {
  return new DefaultProductRelationshipSnapshotBuilder().build({
    relationships: [{
      relationship: {
        sourceProduct,
        targetProduct,
        relationshipType: 'same_order',
        evidence: {
          kind: 'co_occurrence',
          jointCount: 12,
          sourceCount: 20,
          targetCount: 16,
          totalTransactions: 40,
          support: 0.3,
          confidence: 0.6,
          lift: 2,
        },
        reliability: 0.8,
        evidenceWindow: {
          from: '2025-01-01T00:00:00.000Z',
          to: '2025-12-31T23:59:59.000Z',
        },
        modelVersion: 'same-order.0',
      },
      validatedAtModelVersion: 'same-order.0',
    }],
  }).snapshot;
}

function commercialTruthService() {
  return new CatalogCommercialTruthService({
    dataReader: {
      async read() {
        return { products: [], specificPrices: [] };
      },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRecommendationRuntime snapshot observability', () => {
  it('logs structured success fields when a snapshot is loaded', async () => {
    const store = new FileProductRelationshipSnapshotStore(await mkdtemp(join(tmpdir(), 'relationship-runtime-')));
    const activeSnapshot = snapshot();
    await store.save(activeSnapshot);
    await store.activate(activeSnapshot.snapshotId);
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    await createRecommendationRuntime({
      catalogCommercialTruthService: commercialTruthService(),
      snapshotStore: store,
      customerAffinityEvidenceProvider: new EmptyCustomerAffinityEvidenceProvider(),
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith('relationship_snapshot_loaded', expect.objectContaining({
      snapshotId: activeSnapshot.snapshotId,
      relationshipCount: activeSnapshot.relationshipCount,
      modelVersion: activeSnapshot.modelVersion,
      evidenceWindow: activeSnapshot.evidenceWindow,
    }));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs structured failure when no active snapshot is available', async () => {
    const store = new FileProductRelationshipSnapshotStore(await mkdtemp(join(tmpdir(), 'relationship-runtime-')));
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    await createRecommendationRuntime({
      catalogCommercialTruthService: commercialTruthService(),
      snapshotStore: store,
      customerAffinityEvidenceProvider: new EmptyCustomerAffinityEvidenceProvider(),
      logger,
    });

    expect(logger.error).toHaveBeenCalledWith('relationship_snapshot_load_failed', {
      reasonCode: 'NO_ACTIVE_SNAPSHOT',
      retryable: false,
    });
    expect(logger.info).not.toHaveBeenCalled();
  });
});
