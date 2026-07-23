import type { RawTransactionRecord } from '../../../domain/recommendation/relationship-engine/normalization/index.js';
import type { JsonValue } from '../../../domain/recommendation/relationship-engine/publication/index.js';

export type RelationshipSourceWindow = {
  readonly from: string;
  readonly to?: string;
};

export type RelationshipSourceReaderConfig = {
  readonly from: string;
  readonly to?: string;
  readonly acceptedOrderStates: readonly string[];
  readonly excludedProductIds: readonly string[];
};

export type RelationshipSourceReadStatistics = {
  readonly sourceOrdersRead: number;
  readonly sourceLinesRead: number;
  readonly sourceOrdersExcluded: number;
  readonly sourceLinesExcluded: number;
  readonly sourceDuplicateLinesExcluded: number;
  readonly sourceProductsExcluded: number;
};

export type RelationshipSourceReadResult = {
  readonly records: readonly RawTransactionRecord[];
  readonly statistics: RelationshipSourceReadStatistics;
};

export interface HistoricalOrderTransactionReader {
  read(config: RelationshipSourceReaderConfig): Promise<RelationshipSourceReadResult>;
}

export type RelationshipSnapshotBuildConfig = {
  readonly source: RelationshipSourceReaderConfig;
  readonly maximumDistinctProductsPerOrder: number;
  readonly snapshotDirectory: string;
  readonly modelVersion: string;
  readonly minimumJointCount: number;
  readonly minimumConfidence: number;
  readonly minimumLift: number;
  readonly maximumRelationshipsPerSource: number;
  readonly minimumReliability: number;
};

export type RelationshipSnapshotBuildSummary = {
  readonly sourceOrdersRead: number;
  readonly sourceLinesRead: number;
  readonly ordersAccepted: number;
  readonly ordersExcluded: number;
  readonly distinctProducts: number;
  readonly pairCandidates: number;
  readonly reliableCandidates: number;
  readonly validRelationships: number;
  readonly rejectedRelationships: number;
  readonly snapshotId: string;
  readonly snapshotVersion: string;
  readonly snapshotHash: string;
  readonly snapshotPath: string;
  readonly activePointerPath: string;
  readonly durationMs: number;
  readonly details: JsonValue;
};

export interface RelationshipSnapshotBuildService {
  build(config: RelationshipSnapshotBuildConfig): Promise<RelationshipSnapshotBuildSummary>;
}
