import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/interfaces/http/app.js';
import { CatalogContractService } from '../../src/application/catalog/v2/catalogContractService.js';
import {
  catalogSearchResponseSchema,
  itemContextResponseSchema,
  productContextResponseSchema,
} from '../../src/domain/catalog/v2/contracts.js';
import { DatabaseUnavailableError } from '../../src/shared/errors.js';
import { createRepositoryStub } from '../support/fakes.js';
import { FIXTURE_SCENARIOS, fixtureService, runScenario } from '../support/catalogV2FixtureScenarios.js';

/**
 * The published Catalog v2 fixtures are OWNER truth: each one is the exact
 * output of the real service or HTTP app for a declared scenario, and
 * MANIFEST.json pins their content hashes so a consumer can verify an
 * unchanged copy. Regenerate with CATALOG_V2_WRITE_FIXTURES=1.
 */
const fixtureDir = path.resolve('contracts/catalog/v2/fixtures');
const manifestPath = path.join(fixtureDir, 'MANIFEST.json');
const write = process.env.CATALOG_V2_WRITE_FIXTURES === '1';
const CORRELATION_ID = 'fixture-correlation-id';

const ENDPOINTS = {
  search: 'POST /v2/catalog/search',
  productContext: 'GET /v2/catalog/products/{productKey}/context',
  itemContext: 'GET /v2/catalog/items/{itemKey}/context',
} as const;

/** Content hash independent of line endings and whitespace: sha256 of the canonical JSON. */
export function fixtureHash(text: string): string {
  return createHash('sha256').update(JSON.stringify(JSON.parse(text))).digest('hex');
}

const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function schemaFor(file: string) {
  if (file.startsWith('search-')) return catalogSearchResponseSchema;
  if (file.startsWith('product-')) return productContextResponseSchema;
  return itemContextResponseSchema;
}

async function appWith(service: CatalogContractService) {
  return buildApp({
    service: { searchProducts: vi.fn(), getProduct: vi.fn(), batchGetProducts: vi.fn() } as never,
    catalogContractService: service,
    repository: createRepositoryStub(),
    readyCheck: async () => ({ database: 'ok', redis: 'ok' }),
  });
}

async function errorBodies(): Promise<Array<{ file: string; endpoint: string; httpStatus: number; body: unknown }>> {
  const headers = { 'x-api-key': 'test-api-key', 'x-correlation-id': CORRELATION_ID };
  const app = await appWith(fixtureService());
  const invalid = await app.inject({ method: 'POST', url: '/v2/catalog/search', headers, payload: { query: 'x' } });
  const unauthorized = await app.inject({ method: 'GET', url: '/v2/catalog/products/P10/context', headers: { 'x-correlation-id': CORRELATION_ID } });
  await app.close();

  const down = await appWith(new CatalogContractService({ reader: { readProducts: async () => { throw new DatabaseUnavailableError(); } } }));
  const unavailable = await down.inject({ method: 'GET', url: '/v2/catalog/items/P10/context', headers });
  await down.close();

  const limited = await appWith(fixtureService());
  let rateLimited = await limited.inject({ method: 'GET', url: '/v2/catalog/products/P10/context', headers });
  for (let attempt = 0; attempt < 500 && rateLimited.statusCode !== 429; attempt += 1) {
    rateLimited = await limited.inject({ method: 'GET', url: '/v2/catalog/products/P10/context', headers });
  }
  await limited.close();

  return [
    { file: 'error-invalid-request.json', endpoint: ENDPOINTS.search, httpStatus: invalid.statusCode, body: invalid.json() },
    { file: 'error-unauthorized.json', endpoint: ENDPOINTS.productContext, httpStatus: unauthorized.statusCode, body: unauthorized.json() },
    { file: 'error-rate-limited.json', endpoint: ENDPOINTS.productContext, httpStatus: rateLimited.statusCode, body: rateLimited.json() },
    { file: 'error-source-unavailable.json', endpoint: ENDPOINTS.itemContext, httpStatus: unavailable.statusCode, body: unavailable.json() },
  ];
}

describe('published Catalog v2 fixtures are generated owner truth', () => {
  it('every wire fixture equals the real service/app output and the manifest pins its hash', async () => {
    const produced: Array<{ file: string; endpoint: string; httpStatus: number; body: unknown }> = [];
    for (const scenario of FIXTURE_SCENARIOS) {
      produced.push({ file: scenario.file, endpoint: ENDPOINTS[scenario.endpoint], httpStatus: 200, body: await runScenario(scenario) });
    }
    produced.push(...await errorBodies());

    expect(produced.map((p) => p.httpStatus)).toEqual([...FIXTURE_SCENARIOS.map(() => 200), 400, 401, 429, 503]);

    const manifest = {
      contract: 'catalog-commercial-v2',
      schemaVersion: 1,
      owner: 'MS-pesaschile-catalog-service',
      executableSchema: 'src/domain/catalog/v2/contracts.ts',
      generator: 'tests/contract/catalogV2Fixtures.contract.test.ts',
      hash: 'sha256(JSON.stringify(JSON.parse(file)))',
      fixtures: produced.map((p) => ({ file: p.file, endpoint: p.endpoint, httpStatus: p.httpStatus, sha256: fixtureHash(serialize(p.body)) })),
    };

    if (write) {
      for (const p of produced) writeFileSync(path.join(fixtureDir, p.file), serialize(p.body));
      writeFileSync(manifestPath, serialize(manifest));
    }

    for (const p of produced) {
      const onDisk = JSON.parse(readFileSync(path.join(fixtureDir, p.file), 'utf8')) as unknown;
      expect(onDisk, `${p.file} drifted from the service; regenerate with CATALOG_V2_WRITE_FIXTURES=1`).toEqual(p.body);
    }
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual(manifest);

    // No stale, hand-written wire fixture outside the manifest (pricing-golden.json is engine input, not wire).
    const published = readdirSync(fixtureDir).filter((f) => f.endsWith('.json') && f !== 'MANIFEST.json' && f !== 'pricing-golden.json').sort();
    expect(published).toEqual(produced.map((p) => p.file).sort());
  });

  it('every 200 fixture validates against the executable schema', () => {
    for (const scenario of FIXTURE_SCENARIOS) {
      const parsed = schemaFor(scenario.file).safeParse(JSON.parse(readFileSync(path.join(fixtureDir, scenario.file), 'utf8')));
      expect(parsed.success, `${scenario.file}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
    }
  });
});

/** Walks a payload and returns every path whose key is `key`. */
function pathsOfKey(value: unknown, key: string, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => pathsOfKey(item, key, `${at}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [...(k === key ? [`${at}.${k}`] : []), ...pathsOfKey(v, key, `${at}.${k}`)]);
}

describe('identity invariant (R4-J1C): productKey = product, itemKey = sellable item', () => {
  it('search is product-level: every result carries a productKey and no itemKey anywhere', async () => {
    for (const query of ['barra', 'disco', 'opciones', 'BAR-20-XL']) {
      const answer = await fixtureService().search({ query, limit: 10, filters: { sellableOnly: false } });
      expect(answer.results.length, query).toBeGreaterThan(0);
      expect(pathsOfKey(answer, 'itemKey'), query).toEqual([]);
      for (const result of answer.results) expect(result.productKey).toMatch(/^P\d+$/u);
    }
  });

  it('a product WITH variants exposes no product-level sellable item and only variant itemKeys', async () => {
    const context = await fixtureService().getProductContext({ productKey: 'P20', quantity: 1 });
    expect(context.status).toBe('found');
    if (context.status !== 'found') return;
    expect(context.productKey).toBe('P20');
    expect(context.facts.sellableItem).toBeNull();
    expect(context.facts.variantOptions.map((o) => [o.itemKey, o.ref])).toEqual([
      ['P20-V7', { productId: '20', variantId: '7' }],
      ['P20-V8', { productId: '20', variantId: '8' }],
    ]);
    // The only itemKeys in a product context are the sellable units it names.
    expect(pathsOfKey(context, 'itemKey')).toEqual(['.facts.variantOptions[0].itemKey', '.facts.variantOptions[1].itemKey']);
  });

  it('a product WITHOUT variants names P{id} as its sellable item', async () => {
    const context = await fixtureService().getProductContext({ productKey: 'P10', quantity: 1 });
    expect(context.status === 'found' && context.facts.sellableItem).toEqual({ itemKey: 'P10', ref: { productId: '10', variantId: null } });
    expect(context.status === 'found' && context.facts.variantOptions).toEqual([]);
  });

  it('frequently-bought-together names products (productKey), never sellable items', async () => {
    const context = await fixtureService({ frequentlyBoughtTogether: true }).getProductContext({ productKey: 'P10', quantity: 1 });
    expect(context.status === 'found' && context.inferred.frequentlyBoughtTogether).toMatchObject({ status: 'available', items: [{ productKey: 'P20' }] });
  });

  it('item context: P{id} of a product with variants is variant_required, never a sellable item or a guessed variant', async () => {
    expect(await fixtureService().getItemContext({ itemKey: 'P20', quantity: 1 })).toEqual({ schemaVersion: 1, status: 'variant_required', itemKey: 'P20', productKey: 'P20' });
    // A variant key on a product without variants, or a variant of another product, does not exist.
    expect(await fixtureService().getItemContext({ itemKey: 'P10-V7', quantity: 1 })).toEqual({ schemaVersion: 1, status: 'not_found', itemKey: 'P10-V7' });
    expect(await fixtureService().getItemContext({ itemKey: 'P20-V99', quantity: 1 })).toEqual({ schemaVersion: 1, status: 'not_found', itemKey: 'P20-V99' });
    const variant = await fixtureService().getItemContext({ itemKey: 'P20-V7', quantity: 1 });
    expect(variant).toMatchObject({ status: 'found', itemKey: 'P20-V7', ref: { productId: '20', variantId: '7' }, parentProduct: { productKey: 'P20' }, variant: { variantId: '7' } });
  });

  it('a product key is never accepted as a variant key by the product context', async () => {
    expect(await fixtureService().getProductContext({ productKey: 'P20-V7', quantity: 1 })).toEqual({ schemaVersion: 1, status: 'not_found', productKey: 'P20-V7' });
  });
});
