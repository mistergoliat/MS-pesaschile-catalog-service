import { config } from '../shared/config.js';
import { createPool } from '../infrastructure/database/pool.js';
import { PrestashopHistoricalOrderTransactionReader } from '../infrastructure/recommendation/prestashopOrderTransactionReader.js';
import { FileProductRelationshipSnapshotStore } from '../infrastructure/recommendation/fileProductRelationshipSnapshotStore.js';
import {
  DefaultRelationshipSnapshotBuildService,
  type RelationshipSnapshotBuildConfig,
} from '../application/recommendation/relationship-snapshot-build/index.js';

function assertIsoDateTime(name: string, value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid ISO-8601 timestamp`);
  }
  return new Date(parsed).toISOString();
}

function assertUniqueNonEmpty(name: string, values: readonly string[]): string[] {
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }
  const seen = new Set<string>();
  for (const value of values) {
    if (value.trim().length === 0) {
      throw new Error(`${name} must not contain empty values`);
    }
    if (seen.has(value)) {
      throw new Error(`${name} must not contain duplicate values`);
    }
    seen.add(value);
  }
  return [...values];
}

function buildConfig(): RelationshipSnapshotBuildConfig {
  const sourceConfig = config.recommendation.relationshipSource;
  if (!sourceConfig.fromDate) {
    throw new Error('RELATIONSHIP_SOURCE_FROM_DATE is required for relationship:snapshot:build');
  }
  const from = assertIsoDateTime('RELATIONSHIP_SOURCE_FROM_DATE', sourceConfig.fromDate);
  const to = sourceConfig.toDate
    ? assertIsoDateTime('RELATIONSHIP_SOURCE_TO_DATE', sourceConfig.toDate)
    : undefined;
  if (to && Date.parse(from) > Date.parse(to)) {
    throw new Error('RELATIONSHIP_SOURCE_FROM_DATE must be before or equal to RELATIONSHIP_SOURCE_TO_DATE');
  }

  return {
    source: {
      from,
      ...(to ? { to } : {}),
      acceptedOrderStates: assertUniqueNonEmpty('RELATIONSHIP_SOURCE_ORDER_STATES', sourceConfig.orderStates),
      excludedProductIds: [...new Set(sourceConfig.excludedProductIds)],
    },
    maximumDistinctProductsPerOrder: sourceConfig.maxProductsPerOrder,
    snapshotDirectory: config.recommendation.relationshipSnapshotDir,
    modelVersion: 'same-order.real-prestashop.v1',
    minimumJointCount: 2,
    minimumConfidence: 0,
    minimumLift: 1,
    maximumRelationshipsPerSource: 50,
    minimumReliability: 0.3,
  };
}

async function main(): Promise<void> {
  const buildServiceConfig = buildConfig();
  const pool = createPool();
  try {
    const reader = new PrestashopHistoricalOrderTransactionReader(pool, config.prestashop.prefix);
    const store = new FileProductRelationshipSnapshotStore(buildServiceConfig.snapshotDirectory);
    const service = new DefaultRelationshipSnapshotBuildService(reader, store);
    const summary = await service.build(buildServiceConfig);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown relationship snapshot build error';
  const name = error instanceof Error ? error.name : 'Error';
  console.error(JSON.stringify({ status: 'failed', error: { name, message } }, null, 2));
  process.exitCode = 1;
});
