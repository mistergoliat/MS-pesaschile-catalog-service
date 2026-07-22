import type { JsonValue } from './contracts.js';

export type ProductRelationshipSnapshotBuildErrorCode =
  | 'EMPTY_SNAPSHOT_NOT_ALLOWED'
  | 'EMPTY_SNAPSHOT_METADATA_REQUIRED'
  | 'INVALID_EMPTY_SNAPSHOT_METADATA'
  | 'INVALID_VALIDATED_WRAPPER'
  | 'MODEL_VERSION_MISMATCH'
  | 'MIXED_MODEL_VERSIONS'
  | 'MIXED_EVIDENCE_WINDOWS'
  | 'DUPLICATE_VALIDATED_RELATIONSHIP'
  | 'NON_SERIALIZABLE_SNAPSHOT_CONTENT'
  | 'SNAPSHOT_HASH_FAILURE';

export class ProductRelationshipSnapshotBuildError extends Error {
  readonly code: ProductRelationshipSnapshotBuildErrorCode;

  readonly details?: JsonValue;

  constructor(code: ProductRelationshipSnapshotBuildErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = 'ProductRelationshipSnapshotBuildError';
    this.code = code;
    this.details = details;
  }
}

export type ProductRelationshipSnapshotStoreErrorCode =
  | 'SNAPSHOT_ID_COLLISION'
  | 'SNAPSHOT_NOT_FOUND'
  | 'INVALID_SNAPSHOT';

export class ProductRelationshipSnapshotStoreError extends Error {
  readonly code: ProductRelationshipSnapshotStoreErrorCode;

  readonly details?: JsonValue;

  constructor(code: ProductRelationshipSnapshotStoreErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = 'ProductRelationshipSnapshotStoreError';
    this.code = code;
    this.details = details;
  }
}
