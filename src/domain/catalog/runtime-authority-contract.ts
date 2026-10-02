import type { ProductContextResponse } from './v2/contracts.js';
import type { ProductSemanticSnapshotFact } from '../product-semantic-snapshot/contracts.js';
import type { TrainingSemanticSnapshotRecord } from '../training-semantic-snapshot/contracts.js';
import type { TrainingSemanticRuntimeV2Fact } from '../training-semantic-snapshot/v2-contracts.js';
import type { SpecsArtifact } from './projection-bundle.js';

export type AuthorityLineage = {
  projectionBundleId?: string;
  activationId?: string;
  loadedAt?: string;
  snapshotId?: string;
  schemaVersion?: string;
};

export type AuthorityValue<T> =
  | {
      status: 'available';
      authority: string;
      value: T;
      fallbackUsed: boolean;
      lineage?: AuthorityLineage;
    }
  | {
      status: 'unavailable';
      authority: string | null;
      reason: string;
      fallbackUsed: boolean;
      lineage?: AuthorityLineage;
    };

export type ProductContextFound = Extract<ProductContextResponse, { status: 'found' }>;
export type RuntimeTrustMaps = {
  schemaVersion: '1';
  sourceExtractionId: string;
  categoryHash: string;
  featureHash: string;
};

/** Internal composition. `facts.specifications` remains the live PrestaShop feature list. */
export type CatalogRuntimeProductContext = {
  schemaVersion: 1;
  identity: {
    productKey: ProductContextFound['productKey'];
    productId: ProductContextFound['ref']['productId'];
  };
  facts: ProductContextFound['facts'];
  commercial: {
    price: {
      status: 'available' | 'unavailable';
      summary: ProductContextFound['derived']['priceSummary'];
    };
    availability: {
      availableQuantity: ProductContextFound['facts']['stock']['availableQuantity'];
      scope: ProductContextFound['facts']['stock']['scope'];
      sellability: ProductContextFound['derived']['availability']['sellability'];
      reason: ProductContextFound['derived']['availability']['reason'];
      leadTime: ProductContextFound['derived']['availability']['leadTime'];
    };
  };
  knowledge: {
    productSemantics: AuthorityValue<ProductSemanticSnapshotFact>;
    trainingSemanticsV1CatV2: AuthorityValue<TrainingSemanticSnapshotRecord>;
    trainingSemantics: AuthorityValue<TrainingSemanticRuntimeV2Fact> & { migrationStatus: 'pending' };
    specs: AuthorityValue<SpecsArtifact['records']>;
    trustMaps: AuthorityValue<RuntimeTrustMaps>;
    relationships: AuthorityValue<never>;
    capabilities: AuthorityValue<never>;
  };
  provenance: {
    serviceBuildRef: string;
    commercial: {
      authority: 'prestashop-v2-commercial-runtime';
      source: 'prestashop';
    };
    facts: {
      authority: 'prestashop-v2-catalog-reader';
      source: 'prestashop';
      categorySelectionAuthority: 'static-category-trust-map';
    };
    knowledge: {
      projectionBundleId: string | null;
      activationId: string | null;
      loadedAt: string | null;
    };
  };
  freshness: {
    commercial: ProductContextFound['freshness'];
    knowledge: {
      projectionBundleId: string | null;
      activationId: string | null;
      loadedAt: string | null;
    };
  };
};

export type CatalogAuthorityStatus = 'READY' | 'UNAVAILABLE';

export type CatalogAuthoritySnapshot = {
  schemaVersion: 1;
  projection: {
    bundleId: string | null;
    activationId: string | null;
    loadedAt: string | null;
    desiredBundleId: string | null;
    desiredActivationId: string | null;
    reloadState: string;
  };
  authorities: {
    commercialV2: { authority: 'prestashop-v2-commercial-runtime'; status: CatalogAuthorityStatus };
    productSemantics: {
      authority: string | null;
      status: CatalogAuthorityStatus;
      fallbackEnabled: boolean;
      legacyFallbackReads: number;
    };
    productOntologyRegistry: { authority: 'code-product-ontology-v3'; status: 'READY' };
    trainingSemanticsV1CatV2: { authority: 'cat-v2-training-semantics-v1'; status: CatalogAuthorityStatus };
    trainingSemanticsV2: {
      authority: 'legacy-training-v2';
      status: CatalogAuthorityStatus;
      migrationStatus: 'PENDING';
      snapshotId: string | null;
    };
    trainingRegistry: { authority: 'code-training-semantic-registry-v2'; status: 'READY' };
    specs: { authority: 'cat-v2-specs'; status: CatalogAuthorityStatus };
    trustMaps: {
      authority: 'cat-v2-trust-maps';
      status: CatalogAuthorityStatus;
      consumedByCategorySelection: false;
      categorySelectionAuthority: 'static-category-trust-map';
    };
    relationshipsCatV2: { authority: null; status: 'UNAVAILABLE'; reason: string };
    relationshipsRecommendation: {
      authority: 'legacy-relationship-snapshot';
      status: CatalogAuthorityStatus;
      snapshotId: string | null;
      modelVersion: string | null;
      evidenceWindow: { from: string; to: string } | null;
    };
    capabilitiesCatV2: { authority: null; status: 'UNAVAILABLE'; reason: string };
  };
  build: { serviceBuildRef: string };
};
