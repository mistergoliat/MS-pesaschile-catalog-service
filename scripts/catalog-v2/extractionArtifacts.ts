import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CanonicalExtraction } from '../../src/domain/catalog/projection-input/canonical.js';
import { parseCsv, parseCsvRecords, writeCsv } from '../product-semantic-classification/lib/csv.js';

const columns = ['productId', 'catalogPresence', 'name', 'active', 'allCategoryIds', 'features_json', 'totalRevenueTaxIncl'] as const;

export function assertReadOnlySelect(sql: string): void {
  if (!/^\s*SELECT\b/iu.test(sql) || sql.includes(';') || /\bINTO\s+(?:OUTFILE|DUMPFILE)\b|\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/iu.test(sql)) {
    throw new Error('EXTRACTION_FAILED: only nonlocking single SELECT statements are allowed');
  }
}

export function compatibilityCsv(input: CanonicalExtraction): string {
  return writeCsv(columns, input.products.map((product) => ({
    productId: product.productId,
    catalogPresence: product.catalogPresence,
    name: product.name,
    active: product.active === null ? '' : product.active ? '1' : '0',
    allCategoryIds: product.categoryIds?.map((category) => category.categoryId).join('|') ?? '',
    features_json: JSON.stringify((product.features ?? []).map((feature) => ({
      featureId: feature.featureId, featureName: feature.name, value: feature.value ?? '',
    }))),
    totalRevenueTaxIncl: product.revenueTaxIncl ?? '',
  })));
}

export function canonicalTrustMap(csv: string, idColumn: 'categoryId' | 'featureId'): string {
  const [rawHeader, ...rows] = parseCsv(csv.replace(/^\uFEFF/u, ''));
  if (!rawHeader?.includes(idColumn) || rows.length === 0 || rows.some((row) => row.length !== rawHeader.length)) {
    throw new Error(`INVALID_SOURCE_DATA: malformed ${idColumn} trust map`);
  }
  const header = rawHeader.map((field) => field.normalize('NFC'));
  const idIndex = header.indexOf(idColumn);
  const normalized = rows.map((row) => row.map((field) => field.normalize('NFC').replace(/\r\n?/gu, '\n')));
  const ids = normalized.map((row) => Number(row[idIndex]));
  if (ids.some((value) => !Number.isSafeInteger(value) || value <= 0) || new Set(ids).size !== ids.length) {
    throw new Error(`INVALID_SOURCE_DATA: invalid or duplicate ${idColumn} trust map IDs`);
  }
  normalized.sort((a, b) => Number(a[idIndex]) - Number(b[idIndex]));
  return writeCsv(header, normalized.map((row) => Object.fromEntries(header.map((field, index) => [field, row[index]!]))));
}

export function baselineRows(csv: string): readonly Record<string, string>[] {
  const [header, ...rows] = parseCsv(csv.replace(/^\uFEFF/u, ''));
  if (!header?.includes('productId') || rows.some((row) => row.length !== header.length)) {
    throw new Error('INVALID_SOURCE_DATA: baseline CSV is malformed');
  }
  const records = parseCsvRecords(csv.replace(/^\uFEFF/u, ''));
  const ids = records.map((record) => record.productId);
  if (ids.some((value) => !value || !/^\d+$/u.test(value)) || new Set(ids).size !== ids.length) {
    throw new Error('INVALID_SOURCE_DATA: baseline has invalid or duplicate product IDs');
  }
  return records;
}

export function rawDiff(baseline: readonly Record<string, string>[], currentCsv: string) {
  const oldById = new Map(baseline.map((row) => [row.productId!, row] as const));
  const current = baselineRows(currentCsv);
  const newById = new Map(current.map((row) => [row.productId!, row] as const));
  const added = current.filter((row) => !oldById.has(row.productId!)).map((row) => `P${row.productId}`);
  const removed = baseline.filter((row) => !newById.has(row.productId!)).map((row) => `P${row.productId}`);
  const changed = current.flatMap((row) => {
    const old = oldById.get(row.productId!);
    if (!old) return [];
    const fields = columns.filter((column) => column !== 'productId' && normalizedField(column, old[column] ?? '') !== normalizedField(column, row[column] ?? ''));
    return fields.length ? [{ productKey: `P${row.productId}`, fields }] : [];
  });
  const normalizationChanges = current.flatMap((row) => {
    const old = oldById.get(row.productId!);
    if (!old) return [];
    const fields = columns.filter((column) => column !== 'productId' && (old[column] ?? '') !== (row[column] ?? '')
      && normalizedField(column, old[column] ?? '') === normalizedField(column, row[column] ?? ''));
    return fields.length ? [{ productKey: `P${row.productId}`, fields }] : [];
  });
  return { added, removed, changed, normalizationChanges };
}

function normalizedField(column: string, value: string): string {
  if (column === 'allCategoryIds') return value.split('|').filter(Boolean).sort((a, b) => Number(a) - Number(b)).join('|');
  if (column === 'features_json') {
    const features = JSON.parse(value || '[]') as { featureId: number; featureName: string; value: string }[];
    return JSON.stringify(features.map((feature) => [String(feature.featureId), feature.featureName.normalize('NFC'), feature.value.normalize('NFC')])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  if (column === 'totalRevenueTaxIncl' && value) {
    const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/u.exec(value);
    if (match) return `${match[1]}${BigInt(match[2]!).toString()}.${(match[3] ?? '').padEnd(6, '0')}`;
  }
  return value.normalize('NFC').replace(/\r\n?/gu, '\n');
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Publishes complete local files under an aggregate content hash. The manifest is validated before rename. */
export async function publishLocalExtraction(
  outputRoot: string,
  aggregateHash: string,
  files: Readonly<Record<string, string>>,
  validate: (directory: string) => Promise<void>,
): Promise<{ directory: string; reused: boolean }> {
  if (!/^sha256:[a-f0-9]{64}$/u.test(aggregateHash)) throw new Error('HASH_FAILED: invalid aggregate hash');
  const root = path.resolve(outputRoot);
  await mkdir(root, { recursive: true });
  const temporary = await mkdtemp(path.join(root, '.tmp-'));
  const finalDirectory = path.join(root, aggregateHash.slice('sha256:'.length));
  if (!inside(root, temporary) || !inside(root, finalDirectory)) throw new Error('EXTRACTION_FAILED: output path escaped root');
  let published = false;
  try {
    for (const [name, content] of Object.entries(files)) {
      if (!/^[A-Za-z0-9_.-]+$/u.test(name)) throw new Error('SERIALIZATION_FAILED: invalid artifact name');
      await writeFile(path.join(temporary, name), content, 'utf8');
    }
    await validate(temporary);
    let finalExists = false;
    try { await stat(finalDirectory); finalExists = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (finalExists) {
      for (const [name, content] of Object.entries(files)) {
        // Runtime metadata may differ between runs; content artifacts and their hashes must not.
        if (name === 'projection_input_manifest.json') continue;
        if (await readFile(path.join(finalDirectory, name), 'utf8') !== content) {
          throw new Error(`NON_DETERMINISTIC_OUTPUT: existing ${name} differs for ${aggregateHash}`);
        }
      }
      await validate(finalDirectory);
      return { directory: finalDirectory, reused: true };
    }
    await rename(temporary, finalDirectory);
    published = true;
    return { directory: finalDirectory, reused: false };
  } finally {
    if (!published && inside(root, temporary) && path.basename(temporary).startsWith('.tmp-')) {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
