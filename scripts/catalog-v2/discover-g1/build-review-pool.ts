import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadWorkspace } from '../discover-v0/workspace.js';
import { sha256, validateHeldoutG1, type HeldoutQueries } from './goldContract.js';
import { runEngines } from './engineAdapter.js';

/*
 * CAT-DISCOVER-G1 blind relevance-review material.
 *
 *  --mode=template --out-dir=<dir>
 *      Writes the empty worksheets (exact column contract) and the catalog reference
 *      listing reviewers use for INDEPENDENT search. The listing comes from the frozen
 *      SOURCE (name, categories, raw features) — never from Product Semantics,
 *      Training V2, Specs projections, scores or dispositions.
 *  --mode=build --heldout=<frozen file> --engines=<spec> --out-dir=<dir>
 *      Refuses unless the held-out file is valid and frozen. Pools the top-8 ranked and
 *      presented products of every engine/variant per query, shuffles them by a keyed
 *      hash (no system order), and writes one identical worksheet per reviewer without
 *      any score, disposition, variant or engine. Which system retrieved what is written
 *      to pool_provenance.sealed.json (hash recorded) for the evaluator only.
 *
 * It never fills a judgment and never generates a query.
 */

const DEVELOPMENT_SET = 'scripts/catalog-v2/discover-v0/benchmark/benchmark_queries.v1.json';

export const QUERY_SHEET_COLUMNS = ['reviewerId', 'queryId', 'query', 'stage', 'commercialIntent', 'intentClass', 'validInterpretations', 'ambiguous', 'ambiguousReadings',
  'mandatoryConstraints', 'preferences', 'expectedBehavior', 'insufficientInformation', 'clarifyingQuestion', 'independentSearchLog', 'reviewMinutes', 'notes'];
export const PRODUCT_SHEET_COLUMNS = ['reviewerId', 'queryId', 'query', 'rowId', 'productKey', 'productName', 'foundBy', 'grade', 'constraintJudgments', 'evidenceLevel', 'evidenceRef', 'notes'];
const LISTING_COLUMNS = ['productKey', 'name', 'categories', 'rawFeatures'];

const csv = (rows: Record<string, unknown>[], columns: string[]) => {
  const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return `﻿${[columns.map(cell).join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\r\n')}\r\n`;
};
const createOnly = async (file: string, content: string) => {
  try { await stat(file); throw new Error(`OUTPUT_EXISTS: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeFile(file, content, { flag: 'wx' });
};
const keyedOrder = (salt: string, queryId: string, productKey: string) => createHash('sha256').update(`${salt}|${queryId}|${productKey}`).digest('hex');

async function referenceListing(): Promise<Record<string, unknown>[]> {
  const workspace = await loadWorkspace();
  const universe = new Set(workspace.indexes.candidate.universe);
  const products = (workspace.source.input.extraction as unknown as { products: { productId: number; name: string; categoryIds: { name: string }[]; features: { name: string; value: string }[] }[] }).products;
  const generic = new Set(['CATEGORÍAS', 'Inicio', 'Home']);
  return products.filter((product) => universe.has(`P${product.productId}`)).sort((left, right) => left.productId - right.productId).map((product) => ({
    productKey: `P${product.productId}`, name: product.name,
    categories: [...new Set(product.categoryIds.map((category) => category.name).filter((name) => !generic.has(name)))].join(' | '),
    rawFeatures: product.features.map((feature) => `${feature.name}: ${feature.value}`).join(' ; '),
  }));
}

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z0-9-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
  const outDir = options['out-dir'];
  if (!outDir) throw new Error('INVALID_ARGUMENT: --out-dir is required');
  await mkdir(outDir, { recursive: true });

  if (options.mode === 'template') {
    const listing = await referenceListing();
    await createOnly(path.join(outDir, 'relevance_review_worksheet.csv'), csv([], PRODUCT_SHEET_COLUMNS));
    await createOnly(path.join(outDir, 'query_review_sheet.csv'), csv([], QUERY_SHEET_COLUMNS));
    const listingText = csv(listing, LISTING_COLUMNS);
    await createOnly(path.join(outDir, 'catalog_reference_listing.csv'), listingText);
    console.log(JSON.stringify({ mode: 'template', listingProducts: listing.length, listingSha256: sha256(listingText) }, null, 2));
    return;
  }

  if (options.mode === 'build') {
    if (!options.heldout || !options.engines) throw new Error('INVALID_ARGUMENT: --heldout and --engines are required');
    const bytes = await readFile(options.heldout);
    const heldout = JSON.parse(bytes.toString('utf8')) as HeldoutQueries;
    const development = (JSON.parse(await readFile(DEVELOPMENT_SET, 'utf8')) as { queries: { query: string }[] }).queries.map((query) => query.query);
    const errors = validateHeldoutG1(heldout, development);
    if (errors.length > 0) throw new Error(`POOL_REFUSED: held-out file invalid or not frozen: ${errors.slice(0, 10).join(', ')}`);
    const runs = await runEngines(options.engines, heldout.queries.map((query) => ({ queryId: query.queryId, query: query.query })), outDir);
    const names = new Map((await referenceListing()).map((row) => [String(row.productKey), String(row.name)]));
    const salt = sha256(bytes);
    const provenance: Record<string, Record<string, string[]>> = {};
    for (const [engine, list] of runs) {
      for (const run of list) {
        for (const key of [...run.ranked, ...run.presented.slice(0, 8)]) {
          ((provenance[run.queryId] ??= {})[key] ??= []).push(`${engine}/${run.variant}`);
        }
      }
    }
    const rows: Record<string, unknown>[] = [];
    for (const query of heldout.queries) {
      const keys = Object.keys(provenance[query.queryId] ?? {}).sort((left, right) => keyedOrder(salt, query.queryId, left).localeCompare(keyedOrder(salt, query.queryId, right)));
      keys.forEach((key, position) => rows.push({ queryId: query.queryId, query: query.query, rowId: `${query.queryId}-${String(position + 1).padStart(3, '0')}`, productKey: key, productName: names.get(key) ?? '', foundBy: 'POOL' }));
    }
    for (const reviewer of ['R1', 'R2']) {
      await createOnly(path.join(outDir, `relevance_review_worksheet_${reviewer}.csv`), csv(rows.map((row) => ({ ...row, reviewerId: reviewer })), PRODUCT_SHEET_COLUMNS));
      await createOnly(path.join(outDir, `query_review_sheet_${reviewer}.csv`), csv(heldout.queries.map((query) => ({ reviewerId: reviewer, queryId: query.queryId, query: query.query, stage: 'A_BEFORE_POOL' })), QUERY_SHEET_COLUMNS));
    }
    const sealed = `${JSON.stringify({ heldoutSha256: salt, engines: options.engines, provenance }, null, 2)}\n`;
    await createOnly(path.join(outDir, 'pool_provenance.sealed.json'), sealed);
    await createOnly(path.join(outDir, 'pool_manifest.json'), `${JSON.stringify({ builtAt: new Date().toISOString(), heldoutSha256: salt, queries: heldout.queries.length, pooledRows: rows.length,
      provenanceSealedSha256: sha256(sealed), blind: { scores: false, dispositions: false, engineOrVariant: false, systemOrder: false } }, null, 2)}\n`);
    console.log(JSON.stringify({ mode: 'build', queries: heldout.queries.length, pooledRows: rows.length }, null, 2));
    return;
  }
  throw new Error(`INVALID_ARGUMENT: --mode=${options.mode ?? ''}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
