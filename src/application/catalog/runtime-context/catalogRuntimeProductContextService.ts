import type { ActiveTrainingSemanticSnapshotV2Reader } from '../../../domain/training-semantic-snapshot/v2-contracts.js';
import type { RuntimeProjectionManager } from '../../../domain/catalog/runtime-projection.js';
import type { RuntimeProductSemanticReader } from '../../../domain/catalog/runtime-product-semantic-reader.js';
import type { CatalogContractService } from '../v2/catalogContractService.js';
import type { TrainingSemanticSnapshotRecord } from '../../../domain/training-semantic-snapshot/contracts.js';
import type {
  AuthorityLineage,
  AuthorityValue,
  CatalogRuntimeProductContext,
  ProductContextFound,
  RuntimeTrustMaps,
} from '../../../domain/catalog/runtime-authority-contract.js';
import type { TrainingSemanticRuntimeV2Fact } from '../../../domain/training-semantic-snapshot/v2-contracts.js';

export type CatalogRuntimeProductContextServiceDependencies = {
  commercialReader: Pick<CatalogContractService, 'getProductContext'>;
  projectionRuntimeManager: RuntimeProjectionManager;
  productSemanticReader: RuntimeProductSemanticReader;
  trainingSemanticSnapshotV2Reader: ActiveTrainingSemanticSnapshotV2Reader;
  serviceBuildRef: string;
};

function bundleLineage(state: ReturnType<RuntimeProjectionManager['forRequest']>): AuthorityLineage | undefined {
  return state
    ? { projectionBundleId: state.projectionBundleId, activationId: state.activationId, loadedAt: state.loadedAt }
    : undefined;
}

function unavailable<T>(authority: string | null, reason: string, fallbackUsed = false, lineage?: AuthorityLineage): AuthorityValue<T> {
  return { status: 'unavailable', authority, reason, fallbackUsed, ...(lineage ? { lineage } : {}) };
}

function trainingValue(
  productId: number,
  reader: ActiveTrainingSemanticSnapshotV2Reader,
  projection: ReturnType<RuntimeProjectionManager['forRequest']>,
): AuthorityValue<TrainingSemanticRuntimeV2Fact> & { migrationStatus: 'complete' } {
  const metadata = projection?.trainingSemanticsV2?.snapshot;
  if (!metadata) {
    return { ...unavailable('cat-v2-training-semantics-v2', 'training_v2_projection_unavailable'), migrationStatus: 'complete' };
  }
  const lineage: AuthorityLineage = {
    ...bundleLineage(projection),
    ...(projection?.manifest.projections.trainingSemanticsV2?.status === 'present'
      ? { projectionId: projection.manifest.projections.trainingSemanticsV2.snapshotId } : {}),
    snapshotId: metadata.snapshotId,
    schemaVersion: metadata.schemaVersion,
  };
  try {
    const value = reader.getProductTrainingSemanticFact(productId);
    if (!value) {
      return { ...unavailable('cat-v2-training-semantics-v2', 'training_v2_product_not_present', false, lineage), migrationStatus: 'complete' };
    }
    return {
      status: 'available',
      authority: 'cat-v2-training-semantics-v2',
      value,
      fallbackUsed: false,
      lineage,
      migrationStatus: 'complete',
    };
  } catch {
    return { ...unavailable('cat-v2-training-semantics-v2', 'training_v2_read_failed', false, lineage), migrationStatus: 'complete' };
  }
}

export class CatalogRuntimeProductContextService {
  constructor(private readonly dependencies: CatalogRuntimeProductContextServiceDependencies) {}

  async getProductContext(input: { productKey: string; quantity: number }): Promise<CatalogRuntimeProductContext | null> {
    const response = await this.dependencies.commercialReader.getProductContext(input);
    if (response.status !== 'found') return null;

    const product = response as ProductContextFound;
    const productId = Number(product.ref.productId);
    const projection = this.dependencies.projectionRuntimeManager.forRequest();
    const lineage = bundleLineage(projection);
    const semantics = this.dependencies.productSemanticReader.readWithAuthority(product.ref.productId);
    const trainingV1Record = projection?.trainingSemantics.records.find((record) => record.productId === productId) ?? null;
    const trainingV1: AuthorityValue<TrainingSemanticSnapshotRecord> = trainingV1Record && lineage
      ? { status: 'available' as const, authority: 'cat-v2-training-semantics-v1', value: trainingV1Record, fallbackUsed: false, lineage }
      : unavailable<TrainingSemanticSnapshotRecord>(
        'cat-v2-training-semantics-v1', projection ? 'training_v1_product_not_present' : 'projection_bundle_unavailable', false, lineage,
      );
    const normalizedSpecs = projection
      ? projection.specs.records.filter((record) => record.productKey === product.productKey)
      : null;
    const specsAuthority = 'cat-v2-specs';

    const specs: AuthorityValue<NonNullable<typeof normalizedSpecs>> = normalizedSpecs && normalizedSpecs.length > 0
      ? { status: 'available', authority: specsAuthority, value: normalizedSpecs, fallbackUsed: false, lineage }
      : unavailable(specsAuthority, projection ? 'no_normalized_specs_for_product' : 'projection_bundle_unavailable', false, lineage);

    const trustMaps = projection
      ? { status: 'available' as const, authority: 'cat-v2-trust-maps', value: projection.trustMaps, fallbackUsed: false, lineage }
      : unavailable<RuntimeTrustMaps>('cat-v2-trust-maps', 'projection_bundle_unavailable');

    return {
      schemaVersion: 1,
      identity: { productKey: product.productKey, productId: product.ref.productId },
      facts: product.facts,
      commercial: {
        price: {
          status: product.derived.priceSummary ? 'available' : 'unavailable',
          summary: product.derived.priceSummary,
        },
        availability: {
          availableQuantity: product.facts.stock.availableQuantity,
          scope: product.facts.stock.scope,
          sellability: product.derived.availability.sellability,
          reason: product.derived.availability.reason,
          leadTime: product.derived.availability.leadTime,
        },
      },
      knowledge: {
        productSemantics: semantics,
        trainingSemanticsV1CatV2: trainingV1,
        trainingSemantics: trainingValue(productId, this.dependencies.trainingSemanticSnapshotV2Reader, projection),
        specs,
        trustMaps,
        relationships: unavailable(null, projection?.relationships.reason ?? 'cat_v2_relationships_unavailable'),
        capabilities: unavailable(null, projection?.capabilities.reason ?? 'cat_v2_capabilities_unavailable'),
      },
      provenance: {
        serviceBuildRef: this.dependencies.serviceBuildRef,
        commercial: { authority: 'prestashop-v2-commercial-runtime', source: 'prestashop' },
        facts: {
          authority: 'prestashop-v2-catalog-reader',
          source: 'prestashop',
          categorySelectionAuthority: 'static-category-trust-map',
        },
        knowledge: {
          projectionBundleId: projection?.projectionBundleId ?? null,
          activationId: projection?.activationId ?? null,
          loadedAt: projection?.loadedAt ?? null,
        },
      },
      freshness: {
        commercial: product.freshness,
        knowledge: {
          projectionBundleId: projection?.projectionBundleId ?? null,
          activationId: projection?.activationId ?? null,
          loadedAt: projection?.loadedAt ?? null,
        },
      },
    };
  }
}
