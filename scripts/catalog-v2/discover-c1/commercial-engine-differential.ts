import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CommercialAvailabilityResolver } from '../../../src/domain/catalog/commercial-truth/availabilityResolver.js';
import type { CatalogCommercialContext, CatalogCommercialRawProduct, CatalogCommercialSpecificPrice } from '../../../src/domain/catalog/commercial-truth/contracts.js';
import { CommercialPriceCalculator } from '../../../src/domain/catalog/commercial-truth/priceCalculator.js';
import { SpecificPriceSelector } from '../../../src/domain/catalog/commercial-truth/specificPriceSelector.js';
import { calculatePrice, deriveSellability, selectSpecificPrice, CATALOG_V2_ENGINE_VERSION } from '../../../src/domain/catalog/v2/commercialEngine.js';
import type { CatalogV2Product, CatalogV2SpecificPrice } from '../../../src/domain/catalog/v2/contracts.js';
import type { SpecificPriceCandidate } from '../../../src/domain/pricing/types.js';
import { resolvePrice, selectSpecificPrice as legacySelect } from '../../../src/infrastructure/pricing/priceResolver.js';
import { storefrontPricingCases, STOREFRONT_TAX_RATE } from '../../../tests/fixtures/prestashopStorefrontPricing.js';

/*
 * CAT-DISCOVER-C1 — differential audit of the commercial engines that coexist in
 * the repository. Read-only: it calls the REAL functions/classes with identical
 * inputs and records where their answers differ. It changes no engine.
 *
 *   T11.4  domain/catalog/commercial-truth  (CatalogCommercialTruthService parts)
 *   V2     domain/catalog/v2/commercialEngine (CatalogContractService, R4 contract v2)
 *   LEGACY infrastructure/pricing/priceResolver (SqlPricingProvider → /v1 products, explore)
 *
 * References: tests/fixtures/prestashopStorefrontPricing.ts (20 production storefront
 * prices, R4-J1D-R1) and contracts/catalog/v2/fixtures/pricing-golden.json (V2 golden).
 * Probes are synthetic boundary cases, labelled as such. LEGACY reads Date.now(): only
 * date-free probes or dates far from now are used for it.
 *
 *   npx tsx scripts/catalog-v2/discover-c1/commercial-engine-differential.ts --out-dir=<dir>
 */

const NOW = new Date('2026-10-08T12:00:00.000Z');
type Row = { idSpecificPrice: number; price: number; fromQuantity: number; reduction: number; reductionTax: number; reductionType: string; from: string | null; to: string | null;
  combinationId?: number; shopId?: number; currencyId?: number; countryId?: number; groupId?: number; customerId?: number };
type Case = { set: string; name: string; baseNet: number; impactNet?: number; quantity?: number; rows: Row[]; expected?: { regularGross?: number; finalGross: number }; source: string };

const context = (quantity: number): CatalogCommercialContext => ({ shopId: 1, currencyId: 1, currencyCode: 'CLP', countryId: 0, customerGroupId: 0, customerId: 0, quantity, taxRate: STOREFRONT_TAX_RATE });
const full = (row: Row): CatalogV2SpecificPrice => ({ combinationId: 0, shopId: 0, currencyId: 0, countryId: 0, groupId: 0, customerId: 0, cartId: 0, ...row });

function runT114(item: Case) {
  const rows: CatalogCommercialSpecificPrice[] = item.rows.map((row) => ({ ...full(row), productId: 1 }));
  const raw: CatalogCommercialRawProduct = { productId: 1, combinationId: 0, name: 'x', productReference: null, combinationReference: null, description: null, category: null, linkRewrite: null,
    hasCombinations: false, variantAttributeLabels: [], active: true, availableForOrder: true, productBasePriceNet: item.baseNet, combinationImpactNet: item.impactNet ?? 0, stockQuantity: 5 };
  const ctx = context(item.quantity ?? 1);
  const selection = new SpecificPriceSelector().select({ product: { productId: '1' }, combinationId: 0, specificPrices: rows, context: ctx, evaluatedAt: NOW });
  const result = new CommercialPriceCalculator().calculate({ product: { productId: '1' }, rawProduct: raw, selectedSpecificPrice: selection.selected, context: ctx, evaluatedAt: NOW.toISOString() });
  return { regularGross: result.price?.baseGrossAmount ?? null, finalGross: result.price?.finalGrossAmount ?? null, discounted: result.price?.discountApplied ?? null,
    selectedId: selection.selected?.idSpecificPrice ?? null, warnings: [...selection.warnings, ...result.warnings].map((warning) => warning.code) };
}

function runV2(item: Case) {
  const product: CatalogV2Product = { productId: 1, basePriceNet: item.baseNet, name: 'x', sku: null, shortDescription: null, brand: null, weightKg: null, linkRewrite: null, category: null,
    active: true, listed: true, orderable: true, variants: [], specifications: [], globalBackorderAllowed: null, specificPrices: [], asOf: NOW.toISOString() };
  const variant = { combinationId: 0, sku: null, attributes: [], impactPriceNet: item.impactNet ?? 0, isDefault: true, availableQuantity: 5, outOfStock: 0 };
  const ctx = { ...context(item.quantity ?? 1), currencyCode: 'CLP' as const };
  const rows = item.rows.map(full);
  const result = calculatePrice({ product, variant, specificPrices: rows, context: ctx, now: NOW });
  return { regularGross: result?.regularGross ?? null, finalGross: result?.finalGross ?? null, discounted: result?.discounted ?? null,
    selectedId: selectSpecificPrice(rows, { ...ctx, combinationId: 0 }, NOW)?.idSpecificPrice ?? null, warnings: [] as string[] };
}

function runLegacy(item: Case) {
  const rows: SpecificPriceCandidate[] = item.rows.map((row) => {
    const value = full(row);
    return { id_specific_price: value.idSpecificPrice, id_product_attribute: value.combinationId, id_shop: value.shopId, id_currency: value.currencyId, id_country: value.countryId,
      id_group: value.groupId, id_customer: value.customerId, price: value.price, from_quantity: value.fromQuantity, reduction: value.reduction, reduction_tax: value.reductionTax,
      reduction_type: value.reductionType as 'amount' | 'percentage', from: value.from, to: value.to };
  });
  const ctx = { productId: 1, combinationId: 0, ...context(item.quantity ?? 1) };
  const result = resolvePrice({ baseProductPrice: item.baseNet, combinationImpact: item.impactNet ?? 0, specificPrices: rows }, ctx);
  return { regularGross: result.baseUnitPrice, finalGross: result.effectiveUnitPrice, discounted: result.discountApplied, selectedId: legacySelect(rows, ctx)?.id_specific_price ?? null, warnings: [] as string[] };
}

const probes: Case[] = [
  { set: 'PROBE', name: 'fixed-price override (price=80000, no reduction)', baseNet: 100000, rows: [{ idSpecificPrice: 11, price: 80000, fromQuantity: 1, reduction: 0, reductionTax: 1, reductionType: 'amount', from: null, to: null }], source: 'synthetic; PrestaShop: override is the regular price (catalogV2J1D OD-2)' },
  { set: 'PROBE', name: 'specificity: currency-specific 10% vs generic 20% from qty 2 (qty=2)', baseNet: 100000, quantity: 2, rows: [
    { idSpecificPrice: 21, price: -1, fromQuantity: 1, reduction: 0.1, reductionTax: 1, reductionType: 'percentage', from: null, to: null, currencyId: 1 },
    { idSpecificPrice: 22, price: -1, fromQuantity: 2, reduction: 0.2, reductionTax: 1, reductionType: 'percentage', from: null, to: null }], source: 'synthetic; selector ordering differs by engine' },
  { set: 'PROBE', name: 'percentage reduction > 1 (1.5)', baseNet: 100000, rows: [{ idSpecificPrice: 31, price: -1, fromQuantity: 1, reduction: 1.5, reductionTax: 1, reductionType: 'percentage', from: null, to: null }], source: 'synthetic invalid source row' },
  { set: 'PROBE', name: 'unsupported reduction type', baseNet: 100000, rows: [{ idSpecificPrice: 41, price: -1, fromQuantity: 1, reduction: 0.1, reductionTax: 1, reductionType: 'bogus', from: null, to: null }], source: 'synthetic invalid source row' },
  { set: 'PROBE', name: 'amount larger than price', baseNet: 10000, rows: [{ idSpecificPrice: 51, price: -1, fromQuantity: 1, reduction: 50000, reductionTax: 1, reductionType: 'amount', from: null, to: null }], source: 'synthetic' },
  { set: 'PROBE', name: 'unparseable from date', baseNet: 100000, rows: [{ idSpecificPrice: 61, price: -1, fromQuantity: 1, reduction: 0.1, reductionTax: 1, reductionType: 'percentage', from: 'not-a-date', to: null }], source: 'synthetic' },
];

async function main(): Promise<void> {
  const outDir = /^--out-dir=(.+)$/u.exec(process.argv[2] ?? '')?.[1];
  if (!outDir) throw new Error('INVALID_ARGUMENT: --out-dir is required');
  for (const file of ['engine_differential.json', 'engine_differential.csv']) {
    try { await stat(path.join(outDir, file)); throw new Error(`OUTPUT_EXISTS: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const golden = JSON.parse(await readFile('contracts/catalog/v2/fixtures/pricing-golden.json', 'utf8')) as { name: string; quantity?: number; variantImpactNet?: number; specificPrices: Partial<Row>[]; expected: { regularGross: number; finalGross: number } }[];
  const cases: Case[] = [
    ...storefrontPricingCases.map((item) => ({ set: 'STOREFRONT_PRODUCTION_2026-09-30', name: item.productKey, baseNet: Number(item.baseNet),
      rows: [{ idSpecificPrice: 1, price: -1, fromQuantity: 1, reduction: Number(item.reduction), reductionTax: 1, reductionType: 'percentage', from: null, to: null }],
      expected: { finalGross: item.storefrontFinalGross, ...(item.storefrontRegularGross ? { regularGross: item.storefrontRegularGross } : {}) }, source: 'tests/fixtures/prestashopStorefrontPricing.ts' })),
    ...golden.map((item) => ({ set: 'V2_GOLDEN', name: item.name, baseNet: 100000, impactNet: item.variantImpactNet, quantity: item.quantity,
      rows: item.specificPrices.map((row) => ({ price: -1, fromQuantity: 1, from: null, to: null, ...row }) as Row), expected: item.expected, source: 'contracts/catalog/v2/fixtures/pricing-golden.json' })),
    ...probes,
  ];
  const rows = cases.map((item) => {
    const t114 = runT114(item);
    const v2 = runV2(item);
    const legacy = runLegacy(item);
    const ok = (result: { finalGross: number | null; regularGross: number | null }) => !item.expected ? null
      : result.finalGross === item.expected.finalGross && (item.expected.regularGross === undefined || result.regularGross === item.expected.regularGross);
    return { set: item.set, name: item.name, expectedFinal: item.expected?.finalGross ?? null, expectedRegular: item.expected?.regularGross ?? null,
      t114, v2, legacy, matchesExpected: { t114: ok(t114), v2: ok(v2), legacy: ok(legacy) },
      enginesAgree: { finalGross: new Set([t114.finalGross, v2.finalGross, legacy.finalGross]).size === 1, regularGross: new Set([t114.regularGross, v2.regularGross, legacy.regularGross]).size === 1,
        selectedSpecificPrice: new Set([t114.selectedId, v2.selectedId, legacy.selectedId]).size === 1 }, source: item.source };
  });

  // ---- availability: T11.4 CommercialAvailabilityResolver vs V2 deriveSellability -------------
  const availabilityProbes = [
    { name: 'active, orderable, listed, stock 5', active: true, orderable: true, listed: true, physical: 5, available: 5, backorder: false as boolean | null },
    { name: 'stock 0, backorder allowed', active: true, orderable: true, listed: true, physical: 0, available: 0, backorder: true },
    { name: 'stock 0, backorder denied', active: true, orderable: true, listed: true, physical: 0, available: 0, backorder: false },
    { name: 'stock 0, backorder policy unknown', active: true, orderable: true, listed: true, physical: 0, available: 0, backorder: null },
    { name: 'not listed (visibility=none), stock 5', active: true, orderable: true, listed: false, physical: 5, available: 5, backorder: false },
    { name: 'all units reserved: physical 3, available 0, backorder denied', active: true, orderable: true, listed: true, physical: 3, available: 0, backorder: false },
    { name: 'not orderable, stock 5', active: true, orderable: false, listed: true, physical: 5, available: 5, backorder: false },
    { name: 'inactive', active: false, orderable: true, listed: true, physical: 5, available: 5, backorder: false },
    { name: 'stock row missing', active: true, orderable: true, listed: true, physical: null, available: null, backorder: false },
  ];
  const resolver = new CommercialAvailabilityResolver();
  const availability = availabilityProbes.map((probe) => {
    const t114 = resolver.resolve({ productId: 1, combinationId: 0, name: 'x', productReference: null, combinationReference: null, description: null, category: null, linkRewrite: null,
      hasCombinations: false, variantAttributeLabels: [], active: probe.active, availableForOrder: probe.orderable, productBasePriceNet: 1, combinationImpactNet: 0, stockQuantity: probe.physical }, NOW.toISOString());
    const v2 = deriveSellability({ product: { active: probe.active, listed: probe.listed, orderable: probe.orderable, globalBackorderAllowed: probe.backorder }, availableQuantity: probe.available, requireVariant: false });
    const t114Offer = t114.purchasable;
    const v2Offer = v2.sellability === 'sellable' || v2.sellability === 'backorder';
    return { probe: probe.name, inputs: probe, t114: { status: t114.status, purchasable: t114.purchasable }, v2, offerableAgree: t114Offer === v2Offer,
      note: 'T11.4 reads stock_available.physical_quantity and ignores visibility and out_of_stock policy; V2 reads stock_available.quantity, visibility and out_of_stock/PS_ORDER_OUT_OF_STOCK' };
  });

  const summary = {
    generatedAt: new Date().toISOString(), node: process.version, v2EngineVersion: CATALOG_V2_ENGINE_VERSION, evaluationInstant: NOW.toISOString(),
    pricing: Object.fromEntries(['STOREFRONT_PRODUCTION_2026-09-30', 'V2_GOLDEN', 'PROBE'].map((set) => {
      const subset = rows.filter((row) => row.set === set);
      const count = (engine: 't114' | 'v2' | 'legacy') => subset.filter((row) => row.matchesExpected[engine] === true).length;
      return [set, { cases: subset.length, matchesExpected: set === 'PROBE' ? 'NO_EXPECTATION' : { t114: count('t114'), v2: count('v2'), legacy: count('legacy') },
        finalGrossDisagreements: subset.filter((row) => !row.enginesAgree.finalGross).map((row) => row.name),
        regularGrossDisagreements: subset.filter((row) => !row.enginesAgree.regularGross).map((row) => row.name),
        selectionDisagreements: subset.filter((row) => !row.enginesAgree.selectedSpecificPrice).map((row) => row.name) }];
    })),
    availability: { probes: availability.length, offerabilityDisagreements: availability.filter((row) => !row.offerableAgree).map((row) => row.probe) },
  };
  await writeFile(path.join(outDir, 'engine_differential.json'), `${JSON.stringify({ summary, pricing: rows, availability }, null, 2)}\n`, { flag: 'wx' });
  const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const header = ['set', 'name', 'expectedRegular', 'expectedFinal', 't114Regular', 't114Final', 't114Selected', 't114Warnings', 'v2Regular', 'v2Final', 'v2Selected', 'legacyRegular', 'legacyFinal', 'legacySelected', 'agreeFinal', 'agreeRegular', 'agreeSelection'];
  const lines = rows.map((row) => [row.set, row.name, row.expectedRegular, row.expectedFinal, row.t114.regularGross, row.t114.finalGross, row.t114.selectedId, row.t114.warnings.join(' '),
    row.v2.regularGross, row.v2.finalGross, row.v2.selectedId, row.legacy.regularGross, row.legacy.finalGross, row.legacy.selectedId, row.enginesAgree.finalGross, row.enginesAgree.regularGross, row.enginesAgree.selectedSpecificPrice].map(cell).join(','));
  await writeFile(path.join(outDir, 'engine_differential.csv'), `${[header.map(cell).join(','), ...lines].join('\r\n')}\r\n`, { flag: 'wx' });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
