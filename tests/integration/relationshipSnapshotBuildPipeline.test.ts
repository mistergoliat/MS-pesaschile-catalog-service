import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DefaultRelationshipSnapshotBuildService } from '../../src/application/recommendation/relationship-snapshot-build/index.js';
import type {
  HistoricalOrderTransactionReader,
  RelationshipSourceReaderConfig,
} from '../../src/application/recommendation/relationship-snapshot-build/index.js';
import { FileProductRelationshipSnapshotStore } from '../../src/infrastructure/recommendation/fileProductRelationshipSnapshotStore.js';
import {
  PrestashopHistoricalOrderTransactionReader,
  type PrestashopOrderTransactionReaderDatabase,
} from '../../src/infrastructure/recommendation/prestashopOrderTransactionReader.js';
import {
  DefaultActiveProductRelationshipSnapshotReader,
  DefaultProductRelationshipRuntimeIndexBuilder,
} from '../../src/domain/recommendation/relationship-engine/runtime/index.js';
import { buildApp } from '../../src/interfaces/http/app.js';
import { CatalogApplicationService } from '../../src/application/catalogService.js';
import { createRecommendationRuntime } from '../../src/recommendationRuntime.js';
import { EmptyCustomerAffinityEvidenceProvider } from '../../src/infrastructure/recommendation/customerAffinityEvidenceProviders.js';
import {
  createCacheStub,
  createPricingProviderStub,
  createRepositoryStub,
  createSearchProviderStub,
  createStockProviderStub,
} from '../support/fakes.js';

type TestRow = {
  readonly orderId: number;
  readonly occurredAt: string;
  readonly orderState: number;
  readonly lineId: number;
  readonly productId: number;
  readonly productAttributeId: number;
  readonly quantity: number;
};

function fakeDatabase(rows: readonly TestRow[]): PrestashopOrderTransactionReaderDatabase {
  return {
    async query<T extends any[]>(): Promise<[T, unknown]> {
      return [rows as T, []];
    },
  };
}

function snapshotRows(extraRows: readonly TestRow[] = []): TestRow[] {
  return [
    { orderId: 1, occurredAt: '2025-01-01 10:00:00', orderState: 5, lineId: 11, productId: 29, productAttributeId: 0, quantity: 1 },
    { orderId: 1, occurredAt: '2025-01-01 10:00:00', orderState: 5, lineId: 12, productId: 30, productAttributeId: 0, quantity: 1 },
    { orderId: 2, occurredAt: '2025-01-02 10:00:00', orderState: 5, lineId: 21, productId: 29, productAttributeId: 0, quantity: 1 },
    { orderId: 2, occurredAt: '2025-01-02 10:00:00', orderState: 5, lineId: 22, productId: 30, productAttributeId: 0, quantity: 1 },
    { orderId: 3, occurredAt: '2025-01-03 10:00:00', orderState: 5, lineId: 31, productId: 29, productAttributeId: 0, quantity: 1 },
    { orderId: 3, occurredAt: '2025-01-03 10:00:00', orderState: 5, lineId: 32, productId: 31, productAttributeId: 0, quantity: 1 },
    { orderId: 4, occurredAt: '2025-01-04 10:00:00', orderState: 5, lineId: 41, productId: 32, productAttributeId: 0, quantity: 1 },
    { orderId: 4, occurredAt: '2025-01-04 10:00:00', orderState: 5, lineId: 42, productId: 30, productAttributeId: 0, quantity: 1 },
    { orderId: 5, occurredAt: '2025-01-05 10:00:00', orderState: 5, lineId: 51, productId: 33, productAttributeId: 0, quantity: 1 },
    { orderId: 5, occurredAt: '2025-01-05 10:00:00', orderState: 5, lineId: 52, productId: 34, productAttributeId: 0, quantity: 1 },
    ...extraRows,
  ];
}

async function tempStore() {
  const directory = await mkdtemp(join(tmpdir(), 'relationship-snapshot-build-'));
  return {
    directory,
    store: new FileProductRelationshipSnapshotStore(directory),
  };
}

function buildConfig(directory: string) {
  return {
    source: {
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-12-31T23:59:59.000Z',
      acceptedOrderStates: ['5'],
      excludedProductIds: [],
    },
    maximumDistinctProductsPerOrder: 3,
    snapshotDirectory: directory,
    modelVersion: 'same-order.test.v1',
    minimumJointCount: 2,
    minimumConfidence: 0,
    minimumLift: 1,
    maximumRelationshipsPerSource: 20,
    minimumReliability: 0.3,
  };
}

async function buildWithRows(rows: readonly TestRow[]) {
  const { directory, store } = await tempStore();
  const reader = new PrestashopHistoricalOrderTransactionReader(fakeDatabase(rows), 'ps_');
  const service = new DefaultRelationshipSnapshotBuildService(reader, store);
  const summary = await service.build(buildConfig(directory));
  return { directory, store, summary };
}

function catalogService() {
  const repository = createRepositoryStub({
    getProductCore: vi.fn(async (productId: number) => ({
      productId,
      name: `Producto ${productId}`,
      sku: `SKU-${productId}`,
      shortDescription: null,
      longDescription: null,
      active: true,
    })),
  });
  return {
    repository,
    service: new CatalogApplicationService({
      repository,
      searchProvider: createSearchProviderStub(),
      stockProvider: createStockProviderStub(),
      pricingProvider: createPricingProviderStub(),
      cache: createCacheStub(),
    }),
  };
}

describe('relationship snapshot build pipeline', () => {
  it('runs the T02-T06 pipeline and activates an immutable snapshot', async () => {
    const { directory, store, summary } = await buildWithRows(snapshotRows());

    expect(summary).toMatchObject({
      sourceOrdersRead: 5,
      sourceLinesRead: 10,
      ordersAccepted: 5,
      ordersExcluded: 0,
      distinctProducts: 6,
      pairCandidates: 8,
      reliableCandidates: 2,
      validRelationships: 2,
      rejectedRelationships: 0,
      snapshotVersion: '1',
      snapshotPath: expect.stringContaining(join(directory, 'snapshots')),
      activePointerPath: join(directory, 'active.json'),
    });
    const active = await store.getActive();
    expect(active?.snapshotId).toBe(summary.snapshotId);
    expect(active?.relationships[0]?.sourceProduct).toEqual({ productId: '29' });
    expect(active?.relationships[0]?.targetProduct).toEqual({ productId: '30' });
  });

  it('excludes configured products before calculating relationships', async () => {
    const { directory, store } = await tempStore();
    const reader = new PrestashopHistoricalOrderTransactionReader(fakeDatabase(snapshotRows()), 'ps_');
    const service = new DefaultRelationshipSnapshotBuildService(reader, store);

    await expect(service.build({
      ...buildConfig(directory),
      source: {
        ...buildConfig(directory).source,
        excludedProductIds: ['30'],
      },
    })).rejects.toThrow('No valid relationships');
  });

  it('applies the maximum products per order limit during normalization', async () => {
    const { directory, store } = await tempStore();
    const reader = new PrestashopHistoricalOrderTransactionReader(fakeDatabase(snapshotRows([
      { orderId: 6, occurredAt: '2025-01-06 10:00:00', orderState: 5, lineId: 61, productId: 29, productAttributeId: 0, quantity: 1 },
      { orderId: 6, occurredAt: '2025-01-06 10:00:00', orderState: 5, lineId: 62, productId: 30, productAttributeId: 0, quantity: 1 },
      { orderId: 6, occurredAt: '2025-01-06 10:00:00', orderState: 5, lineId: 63, productId: 31, productAttributeId: 0, quantity: 1 },
      { orderId: 6, occurredAt: '2025-01-06 10:00:00', orderState: 5, lineId: 64, productId: 32, productAttributeId: 0, quantity: 1 },
    ])), 'ps_');
    const summary = await new DefaultRelationshipSnapshotBuildService(reader, store).build(buildConfig(directory));

    expect(summary.ordersAccepted).toBe(5);
    expect(summary.ordersExcluded).toBe(1);
  });

  it('keeps the previous active snapshot when a later build produces no valid relationships', async () => {
    const { directory, store, summary } = await buildWithRows(snapshotRows());
    const previous = await store.getActive();
    const reader: HistoricalOrderTransactionReader = {
      async read(_config: RelationshipSourceReaderConfig) {
        return {
          records: [
            {
              transactionId: 'single',
              transactionType: 'order',
              occurredAt: '2025-01-10T00:00:00.000Z',
              status: '5',
              lines: [{ productId: '99', quantity: 1 }],
            },
          ],
          statistics: {
            sourceOrdersRead: 1,
            sourceLinesRead: 1,
            sourceOrdersExcluded: 0,
            sourceLinesExcluded: 0,
            sourceDuplicateLinesExcluded: 0,
            sourceProductsExcluded: 0,
          },
        };
      },
    };

    await expect(new DefaultRelationshipSnapshotBuildService(reader, store).build(buildConfig(directory))).rejects.toThrow(
      'No valid relationships',
    );
    expect((await store.getActive())?.snapshotId).toBe(previous?.snapshotId);
    expect((await store.getActive())?.snapshotId).toBe(summary.snapshotId);
  });

  it('generates a snapshot readable by T07 without rebuilding metrics', async () => {
    const { store } = await buildWithRows(snapshotRows());
    const reader = new DefaultActiveProductRelationshipSnapshotReader(
      store,
      new DefaultProductRelationshipRuntimeIndexBuilder(),
    );

    await expect(reader.refresh()).resolves.toMatchObject({ status: 'loaded' });
    const result = reader.findBySource({ sourceProduct: { productId: '29' } });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.reliability).toBeGreaterThanOrEqual(0.3);
  });

  it('lets SearchProducts V2 return 200 using the generated active snapshot', async () => {
    const { store } = await buildWithRows(snapshotRows());
    const { service, repository } = catalogService();
    const runtime = await createRecommendationRuntime({
      catalogService: service,
      snapshotStore: store,
      customerAffinityEvidenceProvider: new EmptyCustomerAffinityEvidenceProvider(),
    });
    const app = await buildApp({
      service,
      searchProductsV2Service: runtime.searchProductsV2Service,
      repository,
      readyCheck: async () => ({
        database: 'ok',
        redis: 'ok',
        relationshipSnapshot: runtime.relationshipSnapshotReader.getStatus().state === 'ready' ? 'ok' : 'unavailable',
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key' },
      payload: {
        query: 'complementos',
        sourceProduct: { productId: '29' },
        limit: 3,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recommendations[0]).toMatchObject({
      product: { productId: '30' },
    });
    await app.close();
  }, 15000);
});
