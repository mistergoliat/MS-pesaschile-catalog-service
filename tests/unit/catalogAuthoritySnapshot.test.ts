import { describe, expect, it } from 'vitest';
import { getCatalogAuthoritySnapshot } from '../../src/application/catalog/runtime-context/catalogAuthoritySnapshot.js';
import type { RuntimeProjectionManager, RuntimeProjectionState } from '../../src/domain/catalog/runtime-projection.js';
import type { RuntimeProductSemanticReader } from '../../src/domain/catalog/runtime-product-semantic-reader.js';
import type { ActiveTrainingSemanticSnapshotV2Reader } from '../../src/domain/training-semantic-snapshot/v2-contracts.js';
import type { ActiveProductRelationshipSnapshotReader } from '../../src/domain/recommendation/relationship-engine/runtime/index.js';

describe('CatalogAuthoritySnapshot', () => {
  it('distinguishes CAT-V2 Training V1, legacy Training V2, and the two relationship authorities', async () => {
    const state = {
      projectionBundleId: 'sha256:bundle', activationId: 'activation', loadedAt: '2026-10-01T12:00:00.000Z',
      relationships: { status: 'unavailable', reason: 'not_projected' },
      capabilities: { status: 'unavailable', reason: 'not_projected' },
    } as RuntimeProjectionState;
    const projectionRuntimeManager = {
      forRequest: () => state,
      status: () => ({ desiredProjectionBundleId: 'sha256:bundle', desiredActivationId: 'activation',
        loadedProjectionBundleId: 'sha256:bundle', loadedActivationId: 'activation', loadedAt: state.loadedAt, reloadState: 'READY' }),
    } as unknown as RuntimeProjectionManager;
    const snapshot = await getCatalogAuthoritySnapshot({
      projectionRuntimeManager,
      productSemanticReader: { getAuthorityStatus: () => ({ authority: 'cat-v2-product-semantics', status: 'READY', fallbackEnabled: true, legacyFallbackReads: 2 }) } as unknown as RuntimeProductSemanticReader,
      trainingSemanticSnapshotV2Reader: { getMetadata: () => ({ snapshotId: 'training-v2-legacy', schemaVersion: '2' }) } as unknown as ActiveTrainingSemanticSnapshotV2Reader,
      relationshipSnapshotReader: { getActiveSnapshotMetadata: () => ({ snapshotId: 'relationship-legacy', modelVersion: 'same-order-v1', evidenceWindow: { from: '2026-01-01', to: '2026-09-30' } }) } as unknown as ActiveProductRelationshipSnapshotReader,
      serviceBuildRef: 'catalog-service@abc123',
      getCommercialV2Status: async () => 'READY',
    });

    expect(snapshot.projection).toMatchObject({ bundleId: 'sha256:bundle', activationId: 'activation' });
    expect(snapshot.authorities.trainingSemanticsV1CatV2).toEqual({ authority: 'cat-v2-training-semantics-v1', status: 'READY' });
    expect(snapshot.authorities.trainingSemanticsV2).toMatchObject({ authority: 'legacy-training-v2', status: 'READY', migrationStatus: 'PENDING', snapshotId: 'training-v2-legacy' });
    expect(snapshot.authorities.relationshipsCatV2).toMatchObject({ authority: null, status: 'UNAVAILABLE' });
    expect(snapshot.authorities.relationshipsRecommendation).toMatchObject({ authority: 'legacy-relationship-snapshot', status: 'READY', snapshotId: 'relationship-legacy' });
    expect(snapshot.authorities.trustMaps).toMatchObject({ status: 'READY', consumedByCategorySelection: false, categorySelectionAuthority: 'static-category-trust-map' });
    expect(snapshot.authorities.capabilitiesCatV2.status).toBe('UNAVAILABLE');
    expect(snapshot.authorities.productSemantics.legacyFallbackReads).toBe(2);
    expect(snapshot.build.serviceBuildRef).toBe('catalog-service@abc123');
  });
});
