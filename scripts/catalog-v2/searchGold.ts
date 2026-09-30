import { readFileSync } from 'node:fs';
import { CatalogContractService } from '../../src/application/catalog/v2/catalogContractService.js';
import type { CatalogSearchResponse, CatalogV2Product } from '../../src/domain/catalog/v2/contracts.js';
import { stripHtml } from '../../src/shared/html.js';

/*
 * Catalog search Gold Set v0 (R4-J1D §5). One evaluator, two sources:
 *  - offline: the production export replayed through the real CatalogContractService
 *    (matching + ranking; SQL retrieval is covered by reader tests and the live run);
 *  - http:    a deployed /v2/catalog/search (production smoke, read-only).
 * Metrics are reported per class, never as one global score.
 */

export type GoldCase = {
  id: string;
  class: string;
  query: string;
  top1?: number[];
  mustInclude?: number[];
  mustExclude?: number[];
};

export type GoldSet = {
  goldSetVersion: string;
  limit: number;
  classes: Record<string, { gate: 'hard' | 'measured'; threshold?: number }>;
  cases: GoldCase[];
};

export type CaseOutcome = {
  id: string;
  class: string;
  query: string;
  pass: boolean;
  top1Hit: boolean | null;
  recall: number | null;
  exclusionViolations: number[];
  missing: number[];
  returned: number[];
};

export type ClassReport = {
  gate: 'hard' | 'measured';
  cases: number;
  passed: number;
  passRate: number;
  hitAt1: number | null;
  recallAtLimit: number | null;
  exclusionViolations: number;
  gatePassed: boolean;
};

export type GoldReport = {
  goldSetVersion: string;
  source: string;
  classes: Record<string, ClassReport>;
  outcomes: CaseOutcome[];
  deterministic: boolean;
  passed: boolean;
};

export type SearchFn = (query: string, limit: number) => Promise<CatalogSearchResponse>;

export function loadGoldSet(path = 'contracts/catalog/eval/gold-v0.json'): GoldSet {
  return JSON.parse(readFileSync(path, 'utf8')) as GoldSet;
}

function productIds(response: CatalogSearchResponse): number[] {
  return response.results.map((result) => Number(result.ref.productId));
}

function evaluateCase(goldCase: GoldCase, returned: number[]): CaseOutcome {
  const top1Hit = goldCase.top1 ? goldCase.top1.includes(returned[0] ?? -1) : null;
  const missing = (goldCase.mustInclude ?? []).filter((id) => !returned.includes(id));
  const recall = goldCase.mustInclude ? (goldCase.mustInclude.length - missing.length) / goldCase.mustInclude.length : null;
  const exclusionViolations = (goldCase.mustExclude ?? []).filter((id) => returned.includes(id));
  return {
    id: goldCase.id,
    class: goldCase.class,
    query: goldCase.query,
    pass: top1Hit !== false && missing.length === 0 && exclusionViolations.length === 0,
    top1Hit,
    recall,
    exclusionViolations,
    missing,
    returned,
  };
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function evaluateGoldSet(gold: GoldSet, search: SearchFn, source: string): Promise<GoldReport> {
  const outcomes: CaseOutcome[] = [];
  let deterministic = true;
  for (const goldCase of gold.cases) {
    const first = productIds(await search(goldCase.query, gold.limit));
    const second = productIds(await search(goldCase.query, gold.limit));
    if (JSON.stringify(first) !== JSON.stringify(second)) deterministic = false;
    outcomes.push(evaluateCase(goldCase, first));
  }
  const classes: Record<string, ClassReport> = {};
  for (const [name, definition] of Object.entries(gold.classes)) {
    const inClass = outcomes.filter((outcome) => outcome.class === name);
    const passed = inClass.filter((outcome) => outcome.pass).length;
    const passRate = inClass.length === 0 ? 1 : passed / inClass.length;
    classes[name] = {
      gate: definition.gate,
      cases: inClass.length,
      passed,
      passRate,
      hitAt1: mean(inClass.flatMap((outcome) => (outcome.top1Hit === null ? [] : [outcome.top1Hit ? 1 : 0]))),
      recallAtLimit: mean(inClass.flatMap((outcome) => (outcome.recall === null ? [] : [outcome.recall]))),
      exclusionViolations: inClass.reduce((sum, outcome) => sum + outcome.exclusionViolations.length, 0),
      gatePassed: definition.gate === 'measured' || passRate >= (definition.threshold ?? 1),
    };
  }
  return {
    goldSetVersion: gold.goldSetVersion,
    source,
    classes,
    outcomes,
    deterministic,
    passed: deterministic && Object.values(classes).every((report) => report.gatePassed),
  };
}

// ---- offline source: the production export ------------------------------------

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export const OFFLINE_EXPORT = 'docs/audits/product-intelligence-exploration/inputs/product_catalog_exploration(2).csv';

/** Current, active, listed products of the export as v2 reader products (search-relevant fields). */
export function loadExportProducts(path = OFFLINE_EXPORT): CatalogV2Product[] {
  const [header, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  const column = (name: string) => header!.indexOf(name);
  const asOf = '2026-08-29T00:00:00.000Z';
  return rows
    .filter((row) => row.length === header!.length)
    .filter((row) => row[column('catalogPresence')] === 'current_catalog' && row[column('active')] === '1' && row[column('visibility')] !== 'none')
    .map((row) => {
      const stock = Number(row[column('stockQuantity')]);
      const combinations = row[column('hasCombinations')] === 'true'
        ? (JSON.parse(row[column('combinations_json')] || '[]') as Array<{ combinationId: number; reference: string | null; priceImpact: string }>)
        : [];
      return {
        productId: Number(row[column('productId')]),
        basePriceNet: Number(row[column('price')]),
        name: row[column('name')]!,
        sku: row[column('reference')] || null,
        shortDescription: stripHtml(row[column('shortDescription')] ?? '') || null,
        brand: null,
        weightKg: null,
        linkRewrite: null,
        category: null,
        active: true,
        listed: true,
        orderable: row[column('availableForOrder')] === '1',
        variants: combinations.length > 0
          ? combinations.map((combination, index) => ({
            combinationId: combination.combinationId,
            sku: combination.reference || null,
            attributes: [],
            impactPriceNet: Number(combination.priceImpact) || 0,
            isDefault: index === 0,
            availableQuantity: null,
            outOfStock: null,
          }))
          : [{ combinationId: 0, sku: row[column('reference')] || null, attributes: [], impactPriceNet: 0, isDefault: true, availableQuantity: Number.isFinite(stock) ? stock : null, outOfStock: null }],
        specifications: [],
        globalBackorderAllowed: false,
        specificPrices: [],
        asOf,
      } satisfies CatalogV2Product;
    });
}

export function offlineSearch(products = loadExportProducts()): SearchFn {
  const service = new CatalogContractService({
    reader: { readProducts: async () => ({ products, asOf: '2026-08-29T00:00:00.000Z' }) },
    clock: { now: () => new Date('2026-08-29T00:00:01.000Z') },
    serviceBuildRef: 'catalog-service@gold-offline',
  });
  return (query, limit) => service.search({ query, filters: { sellableOnly: false }, limit });
}

export function httpSearch(baseUrl: string, apiKey: string): SearchFn {
  return async (query, limit) => {
    const response = await fetch(new URL('/v2/catalog/search', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'x-correlation-id': `gold-v0-${Date.now()}` },
      body: JSON.stringify({ query, limit }),
    });
    if (!response.ok) throw new Error(`search "${query}" failed with HTTP ${response.status}`);
    return (await response.json()) as CatalogSearchResponse;
  };
}
