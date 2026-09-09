export type TrainingSemanticSnapshotErrorCode =
  | 'INVALID_SNAPSHOT'
  | 'DUPLICATE_PRODUCT_ID'
  | 'DUPLICATE_ASSIGNMENT'
  | 'UNKNOWN_CAPABILITY'
  | 'DEPRECATED_CAPABILITY'
  | 'INVALID_CLASSIFICATION_RESULT'
  | 'LINEAGE_MISMATCH'
  | 'BASELINE_MISMATCH'
  | 'COUNTS_INCONSISTENT'
  | 'EMPTY_SOURCE_PRODUCTS'
  | 'SNAPSHOT_HASH_FAILURE'
  | 'SNAPSHOT_NOT_FOUND'
  | 'SNAPSHOT_ID_COLLISION'
  | 'RUNTIME_SNAPSHOT_UNAVAILABLE'
  | 'INVALID_RUNTIME_QUERY';

export class TrainingSemanticSnapshotError extends Error {
  constructor(
    readonly code: TrainingSemanticSnapshotErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'TrainingSemanticSnapshotError';
  }
}

export class TrainingSemanticSnapshotStoreError extends TrainingSemanticSnapshotError {
  constructor(code: Extract<TrainingSemanticSnapshotErrorCode, 'INVALID_SNAPSHOT' | 'SNAPSHOT_NOT_FOUND' | 'SNAPSHOT_ID_COLLISION'>, message: string, details?: unknown) {
    super(code, message, details);
    this.name = 'TrainingSemanticSnapshotStoreError';
  }
}
