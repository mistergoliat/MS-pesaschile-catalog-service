import type { ActiveProductRelationshipSnapshotReader } from '../../../domain/recommendation/relationship-engine/runtime/index.js';
import type { ActiveTrainingSemanticSnapshotV2Reader } from '../../../domain/training-semantic-snapshot/v2-contracts.js';
import type { RuntimeProjectionManager } from '../../../domain/catalog/runtime-projection.js';
import type { RuntimeProductSemanticReader } from '../../../domain/catalog/runtime-product-semantic-reader.js';
import type { CatalogAuthoritySnapshot, CatalogAuthorityStatus } from '../../../domain/catalog/runtime-authority-contract.js';

export type CatalogAuthoritySnapshotDependencies = {
  projectionRuntimeManager: RuntimeProjectionManager;
  productSemanticReader: RuntimeProductSemanticReader;
  trainingSemanticSnapshotV2Reader: ActiveTrainingSemanticSnapshotV2Reader;
  relationshipSnapshotReader: ActiveProductRelationshipSnapshotReader;
  serviceBuildRef: string;
  getCommercialV2Status: () => Promise<CatalogAuthorityStatus>;
};

export async function getCatalogAuthoritySnapshot(
  dependencies: CatalogAuthoritySnapshotDependencies,
): Promise<CatalogAuthoritySnapshot> {
  const projection = dependencies.projectionRuntimeManager.forRequest();
  const projectionStatus = dependencies.projectionRuntimeManager.status();
  const productSemanticsStatus = dependencies.productSemanticReader.getAuthorityStatus();
  const trainingV2 = projection?.trainingSemanticsV2?.snapshot;
  const trainingV2Entry = projection?.manifest.projections.trainingSemanticsV2;
  const relationship = dependencies.relationshipSnapshotReader.getActiveSnapshotMetadata();
  const commercialStatus = await dependencies.getCommercialV2Status();

  return {
    schemaVersion: 1,
    projection: {
      bundleId: projection?.projectionBundleId ?? null,
      activationId: projection?.activationId ?? null,
      loadedAt: projection?.loadedAt ?? null,
      desiredBundleId: projectionStatus.desiredProjectionBundleId,
      desiredActivationId: projectionStatus.desiredActivationId,
      reloadState: projectionStatus.reloadState,
    },
    authorities: {
      commercialV2: { authority: 'prestashop-v2-commercial-runtime', status: commercialStatus },
      productSemantics: {
        authority: productSemanticsStatus.authority,
        status: productSemanticsStatus.status,
        fallbackEnabled: productSemanticsStatus.fallbackEnabled,
        legacyFallbackReads: productSemanticsStatus.legacyFallbackReads,
      },
      productOntologyRegistry: { authority: 'code-product-ontology-v3', status: 'READY' },
      trainingSemanticsV1CatV2: {
        authority: 'cat-v2-training-semantics-v1',
        status: projection ? 'READY' : 'UNAVAILABLE',
      },
      trainingSemanticsV2: {
        authority: 'cat-v2-training-semantics-v2',
        status: trainingV2 ? 'READY' : 'UNAVAILABLE',
        migrationStatus: 'COMPLETE',
        snapshotId: trainingV2?.snapshotId ?? null,
        projectionId: trainingV2Entry?.status === 'present' ? trainingV2Entry.snapshotId : null,
        projectionBundleId: trainingV2 ? projection!.projectionBundleId : null,
        activationId: trainingV2 ? projection!.activationId : null,
        loadedAt: trainingV2 ? projection!.loadedAt : null,
      },
      trainingRegistry: { authority: 'code-training-semantic-registry-v2', status: 'READY' },
      specs: { authority: 'cat-v2-specs', status: projection ? 'READY' : 'UNAVAILABLE' },
      trustMaps: {
        authority: 'cat-v2-trust-maps',
        status: projection ? 'READY' : 'UNAVAILABLE',
        consumedByCategorySelection: false,
        categorySelectionAuthority: 'static-category-trust-map',
      },
      relationshipsCatV2: {
        authority: null,
        status: 'UNAVAILABLE',
        reason: projection?.relationships.reason ?? 'cat_v2_relationship_projection_unavailable',
      },
      relationshipsRecommendation: {
        authority: 'legacy-relationship-snapshot',
        status: relationship ? 'READY' : 'UNAVAILABLE',
        snapshotId: relationship?.snapshotId ?? null,
        modelVersion: relationship?.modelVersion ?? null,
        evidenceWindow: relationship?.evidenceWindow ?? null,
      },
      capabilitiesCatV2: {
        authority: null,
        status: 'UNAVAILABLE',
        reason: projection?.capabilities.reason ?? 'cat_v2_capabilities_projection_unavailable',
      },
    },
    build: { serviceBuildRef: dependencies.serviceBuildRef },
  };
}
