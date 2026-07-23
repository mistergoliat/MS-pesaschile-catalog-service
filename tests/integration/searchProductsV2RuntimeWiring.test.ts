import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/interfaces/http/app.js';
import { CatalogApplicationService } from '../../src/application/catalogService.js';
import { FileProductRelationshipSnapshotStore } from '../../src/infrastructure/recommendation/fileProductRelationshipSnapshotStore.js';
import {
  EmptyCustomerAffinityEvidenceProvider,
  UnavailableCustomerAffinityEvidenceProvider,
} from '../../src/infrastructure/recommendation/customerAffinityEvidenceProviders.js';
import { createRecommendationRuntime } from '../../src/recommendationRuntime.js';
import { CatalogCommercialTruthService } from '../../src/domain/catalog/commercial-truth/index.js';
import { DefaultProductRelationshipSnapshotBuilder } from '../../src/domain/recommendation/relationship-engine/publication/index.js';
import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import type { ProductRelationshipProductReference } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import type { ValidatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/validation/index.js';
import { createCacheStub, createPricingProviderStub, createRepositoryStub, createSearchProviderStub, createStockProviderStub } from '../support/fakes.js';

const sourceProduct = { productId: '1' } as const;
const targetProduct = { productId: '2' } as const;
const secondTargetProduct = { productId: '3' } as const;

function relationship(target: ProductRelationshipProductReference = targetProduct): CalculatedProductRelationship {
  return {
    sourceProduct,
    targetProduct: target,
    relationshipType: 'same_order',
    evidence: {
      kind: 'co_occurrence',
      jointCount: 12,
      sourceCount: 20,
      targetCount: 16,
      totalTransactions: 40,
      support: 0.3,
      confidence: 0.6,
      lift: 2,
    },
    reliability: 0.8,
    evidenceWindow: {
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-12-31T23:59:59.000Z',
    },
    modelVersion: 'same-order.0',
  };
}

function validated(item: CalculatedProductRelationship): ValidatedProductRelationship {
  return {
    relationship: item,
    validatedAtModelVersion: item.modelVersion,
  };
}

function snapshot(relationships: readonly CalculatedProductRelationship[] = [relationship(), relationship(secondTargetProduct)]) {
  return new DefaultProductRelationshipSnapshotBuilder().build({
    relationships: relationships.map(validated),
  }).snapshot;
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

function commercialTruthService() {
  return new CatalogCommercialTruthService({
    dataReader: {
      async read(input) {
        return {
          products: input.products.map((product) => ({
            productId: Number(product.productId),
            combinationId: product.combinationId === undefined ? 0 : Number(product.combinationId),
            name: `Producto ${product.productId}`,
            productReference: `SKU-${product.productId}`,
            combinationReference: null,
            description: null,
            category: null,
            active: true,
            availableForOrder: true,
            productBasePriceNet: 1000,
            combinationImpactNet: 0,
            stockQuantity: 10,
          })),
          specificPrices: [],
        };
      },
    },
    clock: { now: () => new Date('2026-07-23T12:00:00.000Z') },
  });
}

async function runtimeWithSnapshot(options: {
  activeSnapshot?: ReturnType<typeof snapshot>;
  affinityUnavailable?: boolean;
} = {}) {
  const { repository } = catalogService();
  const store = new FileProductRelationshipSnapshotStore(await mkdtemp(join(tmpdir(), 'relationship-runtime-')));
  if (options.activeSnapshot) {
    await store.save(options.activeSnapshot);
    await store.activate(options.activeSnapshot.snapshotId);
  }
  const runtime = await createRecommendationRuntime({
    catalogCommercialTruthService: commercialTruthService(),
    snapshotStore: store,
    customerAffinityEvidenceProvider: options.affinityUnavailable
      ? new UnavailableCustomerAffinityEvidenceProvider()
      : new EmptyCustomerAffinityEvidenceProvider(),
  });
  return {
    runtime,
    repository,
    store,
  };
}

async function appWithRuntime(options: Parameters<typeof runtimeWithSnapshot>[0] = {}) {
  const { runtime, repository } = await runtimeWithSnapshot(options);
  const app = await buildApp({
    service: catalogService().service,
    searchProductsV2Service: runtime.searchProductsV2Service,
    repository,
    readyCheck: async () => ({
      database: 'ok',
      redis: 'ok',
      relationshipSnapshot: runtime.relationshipSnapshotReader.getStatus().state === 'ready' ? 'ok' : 'unavailable',
    }),
  });
  return { app, runtime };
}

const validRequest = {
  query: 'productos complementarios',
  sourceProduct,
  customer: { customerId: 'customer-1' },
  limit: 2,
} as const;

describe('SearchProducts V2 production runtime wiring', () => {
  it('loads a valid snapshot into T07 during runtime creation', async () => {
    const { runtime } = await runtimeWithSnapshot({ activeSnapshot: snapshot() });
    expect(runtime.relationshipSnapshotReader.getStatus()).toMatchObject({ state: 'ready', relationshipCount: 2 });
  });

  it('wires T07 -> T08 -> T09 -> T10 -> T11 and returns recommendations', async () => {
    const { runtime } = await runtimeWithSnapshot({ activeSnapshot: snapshot() });
    const result = await runtime.searchProductsV2Service.search(validRequest);
    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations[0]).toMatchObject({ rank: 1, product: targetProduct });
    expect(result.execution.stages).toEqual({
      commercialRecommendation: 'completed',
      customerAffinity: 'completed',
      personalization: 'completed',
    });
  });

  it('returns 200 with an explicit warning for a valid product without relationships', async () => {
    const { runtime } = await runtimeWithSnapshot({ activeSnapshot: snapshot() });
    const result = await runtime.searchProductsV2Service.search({
      ...validRequest,
      sourceProduct: { productId: '99' },
    });
    expect(result.recommendations).toEqual([]);
    expect(result.warnings.some((warning) => warning.code === 'NO_COMMERCIAL_CANDIDATES')).toBe(true);
  });

  it('degrades affinity without blocking commercial recommendations', async () => {
    const { runtime } = await runtimeWithSnapshot({ activeSnapshot: snapshot(), affinityUnavailable: true });
    const result = await runtime.searchProductsV2Service.search(validRequest);
    expect(result.recommendations).toHaveLength(2);
    expect(result.execution.degraded).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'CUSTOMER_AFFINITY_UNAVAILABLE')).toBe(true);
  });

  it('returns an operational 503 when no snapshot is loaded', async () => {
    const { runtime } = await runtimeWithSnapshot();
    await expect(runtime.searchProductsV2Service.search(validRequest)).rejects.toMatchObject({
      code: 'COMMERCIAL_RECOMMENDATION_UNAVAILABLE',
    });
    expect(runtime.relationshipSnapshotReader.getStatus()).toEqual({ state: 'not_loaded' });
  });

  it('HTTP endpoint returns 200 with a valid snapshot', async () => {
    const { app } = await appWithRuntime({ activeSnapshot: snapshot() });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key', 'x-correlation-id': 'runtime-http' },
      payload: validRequest,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().recommendations).toHaveLength(2);
    await app.close();
  }, 15000);

  it('HTTP endpoint returns 200 with zero recommendations for a source without relationships', async () => {
    const { app } = await appWithRuntime({ activeSnapshot: snapshot() });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { ...validRequest, sourceProduct: { productId: '99' } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().recommendations).toEqual([]);
    expect(response.json().warnings[0].code).toBe('NO_COMMERCIAL_CANDIDATES');
    await app.close();
  });

  it('HTTP endpoint returns degraded 200 when affinity is unavailable', async () => {
    const { app } = await appWithRuntime({ activeSnapshot: snapshot(), affinityUnavailable: true });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key' },
      payload: validRequest,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().execution.degraded).toBe(true);
    await app.close();
  });

  it('HTTP endpoint returns 503 when snapshot is absent', async () => {
    const { app } = await appWithRuntime();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/recommendations/search-products',
      headers: { 'x-api-key': 'test-api-key' },
      payload: validRequest,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('COMMERCIAL_RECOMMENDATION_UNAVAILABLE');
    await app.close();
  });

  it('readiness reports relationshipSnapshot ok when loaded', async () => {
    const { app } = await appWithRuntime({ activeSnapshot: snapshot() });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().checks.relationshipSnapshot).toBe('ok');
    await app.close();
  });

  it('readiness is degraded when no relationship snapshot is loaded', async () => {
    const { app } = await appWithRuntime();
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().checks.relationshipSnapshot).toBe('unavailable');
    await app.close();
  });

  it('OpenAPI documents SearchProducts V2 with security and examples', async () => {
    const { app } = await appWithRuntime({ activeSnapshot: snapshot() });
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    const route = response.json().paths['/api/v2/recommendations/search-products'].post;
    expect(route.security).toEqual([{ apiKeyAuth: [] }]);
    expect(route.description).toContain('"sourceProduct":{"productId":"173"}');
    expect(route.responses).toHaveProperty('503');
    await app.close();
  });
});
