import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedTtlCache } from '../../src/application/catalog/v2/boundedTtlCache.js';
import { CatalogContractService } from '../../src/application/catalog/v2/catalogContractService.js';
import {
  catalogSearchResponseSchema,
  itemContextResponseSchema,
  productContextResponseSchema,
  type CatalogV2DataReader,
  type CatalogV2Product,
  type CatalogV2SpecificPrice,
  type CatalogV2Variant,
} from '../../src/domain/catalog/v2/contracts.js';
import { selectMeaningfulCategory } from '../../src/domain/catalog/v2/meaningfulCategory.js';
import { matchNominal, significantTokens } from '../../src/domain/catalog/v2/nominalSearch.js';
import {
  DefaultActiveProductSemanticSnapshotReader,
  DefaultProductSemanticRuntimeIndexBuilder,
} from '../../src/domain/product-semantic-snapshot/runtime/index.js';
import { productSemanticSnapshotSchema } from '../../src/domain/product-semantic-snapshot/index.js';
import { FileProductSemanticSnapshotStore } from '../../src/infrastructure/product-semantic/fileProductSemanticSnapshotStore.js';
import { MySqlCatalogV2DataReader } from '../../src/infrastructure/catalog/mysqlCatalogV2DataReader.js';
import { buildApp } from '../../src/interfaces/http/app.js';
import { collectRuntimeReadinessChecks } from '../../src/shared/readiness.js';
import { wallTimeToIso } from '../../src/shared/zonedTime.js';
import { clone, runtimeSemanticSnapshot } from '../fixtures/productSemanticSnapshot.js';
import { createRepositoryStub } from '../support/fakes.js';

const AS_OF = '2026-09-29T12:00:00.000Z';

function variant(overrides: Partial<CatalogV2Variant> = {}): CatalogV2Variant {
  return { combinationId: 0, sku: null, attributes: [], impactPriceNet: 0, isDefault: true, availableQuantity: 4, outOfStock: 0, ...overrides };
}

function product(overrides: Partial<CatalogV2Product> = {}): CatalogV2Product {
  return {
    productId: 10,
    basePriceNet: 100000,
    name: 'Barra olímpica',
    sku: 'BAR-10',
    shortDescription: null,
    brand: null,
    weightKg: null,
    linkRewrite: null,
    category: null,
    active: true,
    listed: true,
    orderable: true,
    variants: [variant({ sku: 'BAR-10' })],
    specifications: [],
    globalBackorderAllowed: null,
    specificPrices: [],
    asOf: AS_OF,
    ...overrides,
  };
}

function specificPrice(overrides: Partial<CatalogV2SpecificPrice> = {}): CatalogV2SpecificPrice {
  return {
    idSpecificPrice: 1, combinationId: 0, shopId: 0, currencyId: 0, countryId: 0, groupId: 0, customerId: 0, cartId: 0,
    price: -1, fromQuantity: 1, reduction: 0, reductionTax: 1, reductionType: 'amount', from: null, to: null,
    ...overrides,
  };
}

function reader(products: CatalogV2Product[], calls = { count: 0 }): CatalogV2DataReader {
  return {
    async readProducts() {
      calls.count += 1;
      return { products, asOf: AS_OF };
    },
  };
}

function serviceFor(products: CatalogV2Product[], extra: { now?: () => number; calls?: { count: number }; cacheMaxEntries?: number } = {}) {
  return new CatalogContractService({
    reader: reader(products, extra.calls),
    clock: { now: () => new Date(extra.now?.() ?? Date.parse('2026-09-29T12:00:01.000Z')) },
    cacheMaxEntries: extra.cacheMaxEntries,
  });
}

async function itemPricing(p: CatalogV2Product, itemKey = 'P10') {
  const result = await serviceFor([p]).getItemContext({ itemKey, quantity: 1 });
  expect(itemContextResponseSchema.safeParse(result).success).toBe(true);
  if (result.status !== 'found' || result.pricing.status !== 'available') throw new Error('expected a priced item');
  return result.pricing;
}

describe('OD-1 — priceSummary.from considers only offerable units', () => {
  const variants = (cheap: Partial<CatalogV2Variant>, dear: Partial<CatalogV2Variant>) => [
    variant({ combinationId: 1, sku: 'V-1', impactPriceNet: 0, ...cheap }),
    variant({ combinationId: 2, sku: 'V-2', impactPriceNet: 20000, isDefault: false, ...dear }),
  ];

  it('a cheaper variant that cannot be ordered never lowers the from price', async () => {
    const p = product({ variants: variants({ availableQuantity: 0, outOfStock: 0 }, { availableQuantity: 3 }) });
    const context = await serviceFor([p]).getProductContext({ productKey: 'P10', quantity: 1 });
    expect(productContextResponseSchema.safeParse(context).success).toBe(true);
    if (context.status !== 'found') throw new Error('expected found');
    expect(context.derived.priceSummary).toEqual({
      kind: 'from', basis: 'offerable', finalGross: { amount: 142800, currency: 'CLP' }, regularGross: { amount: 142800, currency: 'CLP' }, discounted: false,
    });
    const search = await serviceFor([p]).search({ query: 'barra', filters: { sellableOnly: false }, limit: 5 });
    expect(search.results[0]?.priceSummary?.finalGross.amount).toBe(142800);
  });

  it('a backorderable variant is offerable and does set the from price', async () => {
    const p = product({ variants: variants({ availableQuantity: 0, outOfStock: 1 }, { availableQuantity: 3 }) });
    const context = await serviceFor([p]).getProductContext({ productKey: 'P10', quantity: 1 });
    if (context.status !== 'found') throw new Error('expected found');
    expect(context.derived.priceSummary).toMatchObject({ basis: 'offerable', finalGross: { amount: 119000 } });
  });

  it('with no offerable unit the fallback is explicit: basis not_offerable', async () => {
    const p = product({ variants: variants({ availableQuantity: 0, outOfStock: 0 }, { availableQuantity: 0, outOfStock: 0 }) });
    const context = await serviceFor([p]).getProductContext({ productKey: 'P10', quantity: 1 });
    if (context.status !== 'found') throw new Error('expected found');
    expect(context.derived.priceSummary).toMatchObject({ kind: 'from', basis: 'not_offerable', finalGross: { amount: 119000 } });
    const simple = await serviceFor([product({ active: false })]).getProductContext({ productKey: 'P10', quantity: 1 });
    if (simple.status !== 'found') throw new Error('expected found');
    expect(simple.derived.priceSummary).toMatchObject({ kind: 'exact', basis: 'not_offerable' });
  });
});

describe('OD-2 — promotions are published in normalized, tax-included terms', () => {
  it('an amount stored tax-excluded is published tax-included', async () => {
    const pricing = await itemPricing(product({ specificPrices: [specificPrice({ reduction: 10000, reductionTax: 0 })] }));
    expect(pricing).toMatchObject({ regularGross: { amount: 119000 }, finalGross: { amount: 107100 } });
    expect(pricing.promotion).toEqual({ type: 'amount', percentOff: null, amountOffGross: { amount: 11900, currency: 'CLP' }, validUntil: null });
  });

  it('an amount stored tax-included gives the same public answer', async () => {
    const pricing = await itemPricing(product({ specificPrices: [specificPrice({ reduction: 11900, reductionTax: 1 })] }));
    expect(pricing).toMatchObject({ finalGross: { amount: 107100 } });
    expect(pricing.promotion).toMatchObject({ type: 'amount', amountOffGross: { amount: 11900 } });
  });

  it('a percentage is a fraction and carries no amount', async () => {
    const pricing = await itemPricing(product({ specificPrices: [specificPrice({ reduction: 0.1, reductionType: 'percentage', to: '2026-10-01T03:00:00.000Z' })] }));
    expect(pricing.promotion).toEqual({ type: 'percentage', percentOff: 0.1, amountOffGross: null, validUntil: '2026-10-01T03:00:00.000Z' });
    expect(pricing.finalGross.amount).toBe(107100);
  });

  it('a fixed-price override is the regular price (PrestaShop semantics), not an invented discount', async () => {
    const override = await itemPricing(product({ specificPrices: [specificPrice({ price: 80000 })] }));
    expect(override).toMatchObject({ regularGross: { amount: 95200 }, finalGross: { amount: 95200 }, promotion: null });
    const overrideAndPercent = await itemPricing(product({ specificPrices: [specificPrice({ price: 80000, reduction: 0.1, reductionType: 'percentage' })] }));
    expect(overrideAndPercent).toMatchObject({ regularGross: { amount: 95200 }, finalGross: { amount: 85680 } });
  });
});

describe('OD-3 — owner freshness is never lengthened', () => {
  it('validUntil stops at the start of a scheduled price change inside the TTL, for item, product and search', async () => {
    const p = product({ specificPrices: [specificPrice({ reduction: 0.2, reductionType: 'percentage', from: '2026-09-29T12:00:05.000Z' })] });
    const service = serviceFor([p]);
    const item = await service.getItemContext({ itemKey: 'P10', quantity: 1 });
    const context = await service.getProductContext({ productKey: 'P10', quantity: 1 });
    const search = await service.search({ query: 'barra', filters: { sellableOnly: false }, limit: 5 });
    for (const answer of [item, context, search]) {
      expect((answer as { freshness: { validUntil: string } }).freshness.validUntil).toBe('2026-09-29T12:00:05.000Z');
    }
    if (item.status === 'found' && item.pricing.status === 'available') expect(item.pricing.promotion).toBeNull();
  });

  it('a cached answer is never served after its own validUntil', async () => {
    let now = Date.parse('2026-09-29T12:00:01.000Z');
    const calls = { count: 0 };
    const p = product({ specificPrices: [specificPrice({ reduction: 0.1, reductionType: 'percentage', to: '2026-09-29T12:00:04.000Z' })] });
    const service = serviceFor([p], { now: () => now, calls });
    const first = await service.getItemContext({ itemKey: 'P10', quantity: 1 });
    now += 1000;
    const hit = await service.getItemContext({ itemKey: 'P10', quantity: 1 });
    now = Date.parse('2026-09-29T12:00:04.000Z');
    await service.getItemContext({ itemKey: 'P10', quantity: 1 });
    expect(calls.count).toBe(2);
    if (first.status === 'found' && hit.status === 'found') {
      expect(hit.freshness).toEqual({ asOf: AS_OF, cache: { hit: true, ageMs: 2000 }, validUntil: '2026-09-29T12:00:04.000Z' });
      expect(first.freshness.validUntil).toBe(hit.freshness.validUntil);
    }
  });
});

describe('J1D-CAT-01 — nominal search recall', () => {
  it('matches natural multi-token nominal queries, measures exactly', () => {
    expect(matchNominal({ query: 'kettlebell 20 kg', name: 'Kettlebell 20 Kg', shortDescription: null, references: [] })?.tier).toBe('exact_name');
    expect(matchNominal({ query: 'kettlebell 20 kg', name: 'Kettlebell Acero 20kg | HWM®', shortDescription: null, references: [] })?.tier).toBe('all_tokens');
    expect(matchNominal({ query: 'kettlebell 20 kilos', name: 'Kettlebell Acero 20kg | HWM®', shortDescription: null, references: [] })?.tier).toBe('all_tokens');
    expect(matchNominal({ query: 'kettlebell 20 kg', name: 'Kettlebell Acero 24kg | HWM®', shortDescription: null, references: [] })).toBeNull();
    expect(matchNominal({ query: 'disco 10 kg', name: 'Par Discos Bumper 10kg', shortDescription: null, references: [] })?.tier).toBe('all_tokens');
    expect(matchNominal({ query: 'disco 10 kg', name: 'Disco Bumper 110 kg', shortDescription: null, references: [] })).toBeNull();
    expect(matchNominal({ query: 'banco ajustable', name: 'Banco Ajustable Pro | HWM®', shortDescription: null, references: [] })?.tier).toBe('phrase');
    expect(matchNominal({ query: 'banco ajustable', name: 'Bancos Ajustables Set', shortDescription: null, references: [] })?.tier).toBe('phrase');
    expect(matchNominal({ query: 'HWM-KB20', name: 'Pesa rusa', shortDescription: null, references: ['hwm-kb20'] })?.tier).toBe('exact_reference');
    expect(significantTokens('disco de 10 kg')).toEqual(['disco', '10kg']);
  });

  it('ranks exact reference, exact name, phrase and all-tokens deterministically; never discovery', async () => {
    const products = [
      product({ productId: 1, name: 'Kettlebell Acero 20kg | HWM®', sku: 'KB-A20' }),
      product({ productId: 2, name: 'Kettlebell 20 Kg', sku: 'KB-20' }),
      product({ productId: 3, name: 'Kettlebell Acero 24kg | HWM®', sku: 'KB-A24' }),
      product({ productId: 4, name: 'Pesa rusa competición', sku: 'KB-C20', shortDescription: 'Pesa para entrenamiento funcional' }),
      product({ productId: 5, name: 'Rack para kettlebell 20 kg', sku: 'RK-20' }),
    ];
    const service = serviceFor(products);
    const nominal = await service.search({ query: 'kettlebell 20 kg', filters: { sellableOnly: false }, limit: 10 });
    expect(nominal.results.map((result) => [result.productKey, result.match.type])).toEqual([
      ['P2', 'exact_name'], ['P5', 'name'], ['P1', 'name'],
    ]);
    expect(catalogSearchResponseSchema.safeParse(nominal).success).toBe(true);
    const bySku = await service.search({ query: 'kb-c20', filters: { sellableOnly: false }, limit: 10 });
    expect(bySku.results.map((result) => [result.productKey, result.match.type])).toEqual([['P4', 'exact_reference']]);
    const concept = await service.search({ query: 'pesa rusa 20 kg', filters: { sellableOnly: false }, limit: 10 });
    expect(concept.results).toEqual([]);
  });

  it('retrieves candidates in SQL by every significant token, measures by their number', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const pool = { async query(options: { sql: string; values: unknown[] }) { queries.push(options); return [[], []]; } };
    await new MySqlCatalogV2DataReader(pool as never).readProducts({ query: 'Kettlebell de 20 kg' });
    const products = queries[0]!;
    expect(products.values).toEqual(expect.arrayContaining(['%Kettlebell de 20 kg%', '%kettlebell%', '%20%']));
    expect(products.values).not.toContain('%de%');
    expect(products.sql).toContain('pl.name LIKE ?');
    expect(products.sql).not.toContain('pl.description LIKE');
  });
});

describe('J1D-CAT-02 — meaningful category', () => {
  const trust = new Map([[65, 'SEMANTIC_STRONG' as const], [69, 'SEMANTIC_STRONG' as const], [70, 'SEMANTIC_WEAK' as const]]);

  it('never names the navigation root, prefers strong, deeper, then lower id', () => {
    expect(selectMeaningfulCategory([{ id: 2, name: 'CATEGORÍAS', levelDepth: 1 }], trust)).toBeNull();
    expect(selectMeaningfulCategory([
      { id: 2, name: 'CATEGORÍAS', levelDepth: 1 },
      { id: 70, name: 'Débil profunda', levelDepth: 5 },
      { id: 69, name: 'Fuerte', levelDepth: 3 },
      { id: 65, name: 'Kettlebells', levelDepth: 3 },
    ], trust)).toEqual({ id: '65', name: 'Kettlebells' });
    expect(selectMeaningfulCategory([{ id: 70, name: 'Débil', levelDepth: 2 }], trust)).toEqual({ id: '70', name: 'Débil' });
  });

  it('the reader derives the category from category_product, not id_category_default', async () => {
    const queries: string[] = [];
    const pool = {
      async query(options: { sql: string; values: unknown[] }) {
        queries.push(options.sql);
        if (options.sql.includes('AS basePriceNet')) return [[{ productId: 10, name: 'Kettlebell', sku: null, shortDescription: null, linkRewrite: null, weightKg: null, basePriceNet: 1000, active: 1, visibility: 'both', orderable: 1, brand: null }], []];
        if (options.sql.includes('category_product')) return [[{ productId: 10, categoryId: 2, categoryName: 'CATEGORÍAS', levelDepth: 1 }, { productId: 10, categoryId: 65, categoryName: 'Kettlebells', levelDepth: 3 }], []];
        return [[], []];
      },
    };
    const { products } = await new MySqlCatalogV2DataReader(pool as never).readProducts({ productIds: [10] });
    expect(products[0]?.category).toEqual({ id: '65', name: 'Kettlebells' });
    expect(queries.find((sql) => sql.includes('AS basePriceNet'))).not.toContain('id_category_default');
  });
});

describe('J1D-CAT-03 — bounded cache', () => {
  it('evicts the least recently used entry and never serves an expired one', () => {
    const cache = new BoundedTtlCache<string>(2);
    cache.set('a', 'A', 1000, 0);
    cache.set('b', 'B', 1000, 0);
    expect(cache.get('a', 10)).toBe('A');
    cache.set('c', 'C', 1000, 20);
    expect(cache.size).toBe(2);
    expect(cache.get('b', 30)).toBeUndefined();
    expect(cache.get('a', 1000)).toBeUndefined();
    cache.set('stale', 'S', 50, 50);
    expect(cache.get('stale', 50)).toBeUndefined();
    expect(() => new BoundedTtlCache(0)).toThrow(RangeError);
  });

  it('stays within its bound under many distinct queries and folds case/whitespace in the key', async () => {
    const calls = { count: 0 };
    const service = serviceFor([product()], { calls, cacheMaxEntries: 3 });
    for (let index = 0; index < 20; index += 1) {
      await service.search({ query: `barra ${index}`, filters: { sellableOnly: false }, limit: 5 });
    }
    expect((service as unknown as { cache: BoundedTtlCache<unknown> }).cache.size).toBeLessThanOrEqual(3);
    calls.count = 0;
    await service.search({ query: 'Barra  Olímpica', filters: { sellableOnly: false }, limit: 5 });
    const hit = await service.search({ query: ' barra olímpica ', filters: { sellableOnly: false }, limit: 5 });
    expect(calls.count).toBe(1);
    expect(hit.freshness.cache.hit).toBe(true);
  });
});

describe('J1D-CAT-04 — incompatible semantic snapshots fail closed', () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('a record without catalogPresence makes the whole snapshot incompatible', () => {
    const legacy = clone(runtimeSemanticSnapshot) as unknown as { records: Array<Record<string, unknown>> };
    delete legacy.records[0]!.catalogPresence;
    expect(productSemanticSnapshotSchema.safeParse(legacy).success).toBe(false);
    expect(productSemanticSnapshotSchema.safeParse(runtimeSemanticSnapshot).success).toBe(true);
  });

  it('keeps the previous valid snapshot active and never loads an incompatible one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'j1d-semantic-'));
    directories.push(directory);
    const store = new FileProductSemanticSnapshotStore(directory);
    await store.save(runtimeSemanticSnapshot);
    await store.activate(runtimeSemanticSnapshot.snapshotId);
    const running = new DefaultActiveProductSemanticSnapshotReader(store, new DefaultProductSemanticRuntimeIndexBuilder());
    await running.refresh();

    const file = join(directory, 'snapshots', `${runtimeSemanticSnapshot.snapshotId.slice('sha256:'.length)}.json`);
    const legacy = JSON.parse(await readFile(file, 'utf8')) as { records: Array<Record<string, unknown>> };
    for (const record of legacy.records) delete record.catalogPresence;
    await writeFile(file, JSON.stringify(legacy));

    await expect(running.refresh()).rejects.toThrow();
    expect(running.getStatus()).toMatchObject({ state: 'ready', snapshotId: runtimeSemanticSnapshot.snapshotId });

    const booting = new DefaultActiveProductSemanticSnapshotReader(store, new DefaultProductSemanticRuntimeIndexBuilder());
    await expect(booting.refresh()).rejects.toThrow();
    expect(booting.getStatus()).toEqual({ state: 'not_loaded' });
  });
});

describe('J1D-CAT-05 — readiness is commercial truth', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports optional capabilities without gating on them', async () => {
    const checks = await collectRuntimeReadinessChecks({
      repository: { ping: async () => undefined },
      cache: { ping: async () => true },
      cacheDriver: 'memory',
      relationshipSnapshotReader: { getStatus: () => ({ state: 'not_loaded' }) },
      productSemanticSnapshotReader: { getStatus: () => ({ state: 'not_loaded' }) },
      trainingSemanticSnapshotReader: { getMetadata: () => null },
    });
    expect(checks.capabilities).toEqual({ commercialTruth: 'ok', relationships: 'unavailable', productSemantics: 'unavailable', trainingSemantics: 'unavailable' });
  });

  async function readiness(checks: Awaited<ReturnType<typeof collectRuntimeReadinessChecks>>) {
    const app = await buildApp({
      service: { searchProducts: vi.fn(), getProduct: vi.fn(), batchGetProducts: vi.fn() } as never,
      catalogContractService: serviceFor([product()]),
      repository: createRepositoryStub(),
      readyCheck: async () => checks,
    });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    const search = await app.inject({ method: 'POST', url: '/v2/catalog/search', headers: { 'x-api-key': 'test-api-key' }, payload: { query: 'barra' } });
    await app.close();
    return { ready, search };
  }

  const optionalDown = {
    database: 'ok' as const, redis: 'ok' as const, relationshipSnapshot: 'unavailable' as const,
    capabilities: { commercialTruth: 'ok' as const, relationships: 'unavailable' as const, productSemantics: 'unavailable' as const, trainingSemantics: 'unavailable' as const },
  };

  it('stays ready (200, degraded) and serves /v2/catalog when only optional intelligence is down', async () => {
    const { ready, search } = await readiness(optionalDown);
    expect(ready.statusCode).toBe(200);
    expect(ready.json().status).toBe('degraded');
    expect(search.statusCode).toBe(200);
  });

  it('is not ready (503) when the commercial source is down', async () => {
    const { ready } = await readiness({ ...optionalDown, database: 'unavailable', capabilities: { ...optionalDown.capabilities, commercialTruth: 'unavailable' } });
    expect(ready.statusCode).toBe(503);
    expect(ready.json().status).toBe('unavailable');
  });
});

describe('B7 preparation — shop-local datetimes become real instants', () => {
  it('converts PrestaShop wall-clock values in the configured zone, DST-aware', () => {
    expect(wallTimeToIso('2026-01-15 12:00:00', 'America/Santiago')).toBe('2026-01-15T15:00:00.000Z');
    expect(wallTimeToIso('2026-07-15 12:00:00', 'America/Santiago')).toBe('2026-07-15T16:00:00.000Z');
    expect(wallTimeToIso('2026-07-15 12:00:00', 'UTC')).toBe('2026-07-15T12:00:00.000Z');
    expect(wallTimeToIso('0000-00-00 00:00:00', 'UTC')).toBeNull();
    expect(wallTimeToIso(null, 'UTC')).toBeNull();
  });
});
