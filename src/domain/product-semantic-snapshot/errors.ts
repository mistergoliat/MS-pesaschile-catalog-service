import type { JsonValue } from './contracts.js';

export type ProductSemanticSnapshotBuildErrorCode =
  | 'EMPTY_SOURCE_PRODUCTS'
  | 'SOURCE_COUNT_MISMATCH'
  | 'DUPLICATE_PRODUCT_ID'
  | 'MIXED_ONTOLOGY_VERSIONS'
  | 'MIXED_ONTOLOGY_HASHES'
  | 'ONTOLOGY_HASH_MISMATCH'
  | 'INVALID_CLASSIFICATION_RESULT'
  | 'UNKNOWN_ONTOLOGY_TAG'
  | 'INVALID_RESIDUAL_TAG'
  | 'INVALID_EVIDENCE_PROVENANCE'
  | 'EXCLUSION_PROVENANCE_MISSING'
  | 'NON_SERIALIZABLE_SNAPSHOT_CONTENT'
  | 'SNAPSHOT_HASH_FAILURE';

export class ProductSemanticSnapshotBuildError extends Error {
  readonly code: ProductSemanticSnapshotBuildErrorCode;

  readonly details?: JsonValue;

  constructor(code: ProductSemanticSnapshotBuildErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = 'ProductSemanticSnapshotBuildError';
    this.code = code;
    this.details = details;
  }
}

export type ProductSemanticSnapshotStoreErrorCode =
  | 'SNAPSHOT_ID_COLLISION'
  | 'SNAPSHOT_NOT_FOUND'
  | 'INVALID_SNAPSHOT';

export class ProductSemanticSnapshotStoreError extends Error {
  readonly code: ProductSemanticSnapshotStoreErrorCode;

  readonly details?: JsonValue;

  constructor(code: ProductSemanticSnapshotStoreErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = 'ProductSemanticSnapshotStoreError';
    this.code = code;
    this.details = details;
  }
}
