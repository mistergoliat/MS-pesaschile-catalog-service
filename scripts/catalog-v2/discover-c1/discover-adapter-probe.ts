import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CatalogContractService } from '../../../src/application/catalog/v2/catalogContractService.js';
import { commercialTruthHydrator } from '../../../src/application/catalog/discover-v0/commercialHydrator.js';
import { ConstraintVerifier } from '../../../src/application/catalog/discover-v0/constraintVerifier.js';
import type { DiscoverConstraint } from '../../../src/application/catalog/discover-v0/contracts.js';
import type { DiscoverIndex, ProductRetrievalDocument } from '../../../src/application/catalog/discover-v0/retrievalDocument.js';
import type { CatalogV2Product, CatalogV2DataReader } from '../../../src/domain/catalog/v2/contracts.js';

/*
 * CAT-DISCOVER-C1 — probe of the CURRENT Discover → Commercial Truth adapter
 * (commercialHydrator.commercialTruthHydrator over CatalogContractService) with an
 * in-memory CatalogV2DataReader. Read-only; no database, no engine change.
 *   1. how many owner reads a bounded hydration of 40 keys costs;
 *   2. what Discover certifies for a priced product that cannot be ordered;
 *   3. whether the observation keeps the owner's price semantics (from/exact, offerable basis).
 *
 *   npx tsx scripts/catalog-v2/discover-c1/discover-adapter-probe.ts --out-dir=<dir>
 */

const NOW = new Date('2026-10-08T12:00:00.000Z');
const product = (productId: number, overrides: Partial<CatalogV2Product> = {}): CatalogV2Product => ({
  productId, basePriceNet: 40000, name: `Producto ${productId}`, sku: `SKU${productId}`, shortDescription: null, brand: null, weightKg: null, linkRewrite: `p-${productId}`, category: null,
  active: true, listed: true, orderable: true, specifications: [], globalBackorderAllowed: false, specificPrices: [], asOf: NOW.toISOString(),
  variants: [{ combinationId: 0, sku: `SKU${productId}`, attributes: [], impactPriceNet: 0, isDefault: true, availableQuantity: 3, outOfStock: 0 }],
  ...overrides,
});

async function main(): Promise<void> {
  const outDir = /^--out-dir=(.+)$/u.exec(process.argv[2] ?? '')?.[1];
  if (!outDir) throw new Error('INVALID_ARGUMENT: --out-dir is required');
  try { await stat(path.join(outDir, 'discover_adapter_probe.json')); throw new Error('OUTPUT_EXISTS'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

  const catalog = new Map<number, CatalogV2Product>(Array.from({ length: 40 }, (_value, offset) => [offset + 1, product(offset + 1)]));
  // P41: priced but not orderable (all units not_sellable) → priceSummary.basis = not_offerable.
  catalog.set(41, product(41, { orderable: false }));
  // P42: two variants, the cheap one cannot be ordered → priceSummary.kind = from, basis offerable on the dearer unit.
  catalog.set(42, product(42, { variants: [
    { combinationId: 1, sku: 'A', attributes: [{ group: 'Peso', value: '10 kg' }], impactPriceNet: 0, isDefault: true, availableQuantity: 0, outOfStock: 0 },
    { combinationId: 2, sku: 'B', attributes: [{ group: 'Peso', value: '20 kg' }], impactPriceNet: 20000, isDefault: false, availableQuantity: 4, outOfStock: 0 }] }));
  const calls: number[][] = [];
  const reader: CatalogV2DataReader = {
    async readProducts(input) {
      calls.push([...(input.productIds ?? [])]);
      return { products: (input.productIds ?? []).flatMap((id) => (catalog.has(id) ? [catalog.get(id)!] : [])), asOf: NOW.toISOString() };
    },
  };
  const owner = new CatalogContractService({ reader, clock: { now: () => NOW }, publicBaseUrl: 'https://example.invalid', serviceBuildRef: 'c1-probe' });
  const hydrator = commercialTruthHydrator(owner);

  const keys = Array.from({ length: 40 }, (_value, offset) => `P${offset + 1}`);
  const observations = await hydrator.hydrate(keys);
  const bounded = { hydratedKeys: keys.length, ownerReadCalls: calls.length, productIdsPerCall: [...new Set(calls.map((call) => call.length))], observed: [...observations.values()].filter((item) => item.status === 'OBSERVED').length };

  calls.length = 0;
  const special = await hydrator.hydrate(['P41', 'P42']);
  const contexts = { P41: await owner.getProductContext({ productKey: 'P41', quantity: 1 }), P42: await owner.getProductContext({ productKey: 'P42', quantity: 1 }) };
  const verifier = new ConstraintVerifier({} as DiscoverIndex);
  const maxPrice: DiscoverConstraint = { id: 'C1', kind: 'COMMERCIAL_MAX_PRICE', domain: 'COMMERCIAL', operator: 'LTE', value: 50000, unit: 'CLP', matchedText: 'menos de 50 mil' };
  const availability: DiscoverConstraint = { id: 'C2', kind: 'COMMERCIAL_AVAILABILITY', domain: 'COMMERCIAL', matchedText: 'en stock' };
  const verdicts = Object.fromEntries((['P41', 'P42'] as const).map((key) => {
    const observation = special.get(key)!;
    const context = contexts[key];
    return [key, {
      ownerPriceSummary: context.status === 'found' ? context.derived.priceSummary : null,
      ownerAvailability: context.status === 'found' ? context.derived.availability : null,
      discoverObservation: observation,
      maxPrice50k: verifier.verify({ productKey: key } as ProductRetrievalDocument, maxPrice, true, 'HYBRID', observation, { now: () => NOW }),
      inStock: verifier.verify({ productKey: key } as ProductRetrievalDocument, availability, true, 'HYBRID', observation, { now: () => NOW }),
    }];
  }));
  const report = {
    generatedAt: new Date().toISOString(), probe: 'in-memory CatalogV2DataReader (synthetic products); real CatalogContractService, commercialTruthHydrator and ConstraintVerifier',
    boundedHydration: bounded,
    notOfferablePrice: verdicts,
    findings: {
      perProductOwnerReads: bounded.ownerReadCalls === keys.length,
      priceBasisDropped: !('basis' in (special.get('P41') as object)),
      notOfferablePriceSatisfiesMaxPrice: (verdicts.P41 as { maxPrice50k: { state: string } }).maxPrice50k.state === 'SATISFIED',
    },
  };
  await writeFile(path.join(outDir, 'discover_adapter_probe.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ boundedHydration: bounded, findings: report.findings,
    P41: { summary: verdicts.P41!.ownerPriceSummary, maxPrice: verdicts.P41!.maxPrice50k.state, inStock: verdicts.P41!.inStock.state },
    P42: { summary: verdicts.P42!.ownerPriceSummary, maxPrice: verdicts.P42!.maxPrice50k.state, inStock: verdicts.P42!.inStock.state } }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
