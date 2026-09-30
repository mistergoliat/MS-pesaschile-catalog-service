import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { createPool } from '../../src/infrastructure/database/pool.js';
import { config } from '../../src/shared/config.js';
import { parseCsv, parseCsvRecords, writeCsv } from '../product-semantic-classification/lib/csv.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from '../product-semantic-classification/lib/load-input.js';
import { runProductSemanticClassification } from '../product-semantic-classification/lib/classification-run.js';
import { loadTrainingSemanticClassificationInputs } from '../training-semantic-classification/lib/load-input.js';

const schemaVersion = 1;
const extractorVersion = 'catalog-projection-input-v1';
const columns = ['productId', 'catalogPresence', 'name', 'active', 'allCategoryIds', 'features_json', 'totalRevenueTaxIncl'] as const;
const comparedColumns = columns.filter((column) => column !== 'productId');

type ProductRow = RowDataPacket & { productId: number; name: string | null; active: number | null };
type HistoricalRow = RowDataPacket & { productId: number; name: string | null };
type CategoryRow = RowDataPacket & { productId: number; categoryId: number };
type FeatureRow = RowDataPacket & { productId: number; featureId: number; featureName: string | null; value: string | null };
type RevenueRow = RowDataPacket & { productId: number; revenue: number | null };
type InputRow = Record<(typeof columns)[number], string>;

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function table(suffix: string): string {
  return `${config.prestashop.prefix}${suffix}`;
}

function parseArgs(argv: readonly string[]) {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(arg);
    if (!match || !['output-dir', 'baseline', 'input-dir', 'category-trust-map', 'feature-trust-map'].includes(match[1]!)) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
    values[match[1]!] = match[2]!;
  }
  return values;
}

async function query<T extends RowDataPacket[]>(connection: PoolConnection, sql: string, params: readonly unknown[] = []): Promise<T> {
  const [rows] = await connection.query<T>({ sql, values: [...params], timeout: 120_000 });
  return rows;
}

async function extract(connection: PoolConnection): Promise<InputRow[]> {
  const shop = config.prestashop.shopId;
  const lang = config.prestashop.langId;
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    const products = await query<ProductRow[]>(connection, `
      SELECT p.id_product AS productId, pl.name AS name, COALESCE(ps.active, p.active) AS active
      FROM ${table('product')} p
      LEFT JOIN ${table('product_shop')} ps ON ps.id_product = p.id_product AND ps.id_shop = ?
      LEFT JOIN ${table('product_lang')} pl ON pl.id_product = p.id_product AND pl.id_shop = ? AND pl.id_lang = ?
      ORDER BY p.id_product
    `, [shop, shop, lang]);
    const historical = await query<HistoricalRow[]>(connection, `
      SELECT od.product_id AS productId, od.product_name AS name
      FROM ${table('order_detail')} od
      INNER JOIN (
        SELECT product_id, MAX(id_order_detail) AS lastLineId
        FROM ${table('order_detail')}
        WHERE product_id > 0
        GROUP BY product_id
      ) latest ON latest.lastLineId = od.id_order_detail
      LEFT JOIN ${table('product')} p ON p.id_product = od.product_id
      WHERE p.id_product IS NULL
      ORDER BY od.product_id
    `);
    const categories = await query<CategoryRow[]>(connection, `
      SELECT cp.id_product AS productId, cp.id_category AS categoryId
      FROM ${table('category_product')} cp
      INNER JOIN ${table('product')} p ON p.id_product = cp.id_product
      ORDER BY cp.id_product, cp.id_category
    `);
    const features = await query<FeatureRow[]>(connection, `
      SELECT fp.id_product AS productId, fp.id_feature AS featureId, fl.name AS featureName, fvl.value AS value
      FROM ${table('feature_product')} fp
      INNER JOIN ${table('product')} p ON p.id_product = fp.id_product
      LEFT JOIN ${table('feature_lang')} fl ON fl.id_feature = fp.id_feature AND fl.id_lang = ?
      LEFT JOIN ${table('feature_value_lang')} fvl ON fvl.id_feature_value = fp.id_feature_value AND fvl.id_lang = ?
      ORDER BY fp.id_product, fp.id_feature, fp.id_feature_value
    `, [lang, lang]);
    const revenues = await query<RevenueRow[]>(connection, `
      SELECT od.product_id AS productId, ROUND(SUM(od.total_price_tax_incl), 6) AS revenue
      FROM ${table('order_detail')} od
      INNER JOIN ${table('orders')} o ON o.id_order = od.id_order AND o.valid = 1
      WHERE od.product_id > 0
      GROUP BY od.product_id
      ORDER BY od.product_id
    `);
    const categoryByProduct = new Map<number, number[]>();
    for (const row of categories) {
      const ids = categoryByProduct.get(row.productId) ?? [];
      ids.push(row.categoryId);
      categoryByProduct.set(row.productId, ids);
    }
    const featureByProduct = new Map<number, { featureId: number; featureName: string; value: string }[]>();
    for (const row of features) {
      if (!row.featureName?.trim()) throw new Error(`Missing translated feature name: product ${row.productId}, feature ${row.featureId}`);
      const values = featureByProduct.get(row.productId) ?? [];
      values.push({ featureId: row.featureId, featureName: row.featureName, value: row.value ?? '' });
      featureByProduct.set(row.productId, values);
    }
    const revenueByProduct = new Map(revenues.map((row) => [row.productId, row.revenue] as const));
    const rows: InputRow[] = [];
    for (const row of products) {
      if (!row.name?.trim()) throw new Error(`Missing translated product name: ${row.productId}`);
      rows.push({
        productId: String(row.productId), catalogPresence: 'current_catalog', name: row.name,
        active: row.active === null ? '' : String(row.active),
        allCategoryIds: (categoryByProduct.get(row.productId) ?? []).join('|'),
        features_json: JSON.stringify(featureByProduct.get(row.productId) ?? []),
        totalRevenueTaxIncl: revenueByProduct.get(row.productId)?.toFixed(6) ?? '',
      });
    }
    for (const row of historical) {
      if (!row.name?.trim()) throw new Error(`Missing historical order product name: ${row.productId}`);
      rows.push({
        productId: String(row.productId), catalogPresence: 'historical_order_detail_only', name: row.name,
        active: '', allCategoryIds: '', features_json: '[]',
        totalRevenueTaxIncl: revenueByProduct.get(row.productId)?.toFixed(6) ?? '',
      });
    }
    rows.sort((left, right) => Number(left.productId) - Number(right.productId));
    if (rows.some((row, index) => index > 0 && row.productId === rows[index - 1]!.productId)) {
      throw new Error('Duplicate productId in extracted input');
    }
    await connection.query('COMMIT');
    return rows;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  }
}

function compare(baselineText: string, rows: readonly InputRow[]) {
  const [header, ...data] = parseCsv(baselineText);
  if (!header?.includes('productId') || data.some((row) => row.length !== header.length)) {
    throw new Error('Baseline CSV has no productId column or contains malformed rows');
  }
  const baselineRows = parseCsvRecords(baselineText);
  const baseline = new Map(baselineRows.map((row) => [row.productId, row] as const));
  if (baseline.size !== baselineRows.length) throw new Error('Baseline CSV contains duplicate product IDs');
  const current = new Map(rows.map((row) => [row.productId, row] as const));
  const added = rows.filter((row) => !baseline.has(row.productId)).map((row) => row.productId);
  const removed = [...baseline.keys()].filter((id): id is string => !!id && !current.has(id)).sort((a, b) => Number(a) - Number(b));
  const changed = rows.flatMap((row) => {
    const old = baseline.get(row.productId);
    if (!old) return [];
    const fields = comparedColumns.filter((column) => {
      if (column === 'allCategoryIds') {
        const normalize = (value: string) => value.split('|').filter(Boolean).sort((a, b) => Number(a) - Number(b)).join('|');
        return normalize(old[column] ?? '') !== normalize(row[column]);
      }
      if (column === 'features_json') {
        const normalize = (value: string) => JSON.stringify((JSON.parse(value || '[]') as { featureId: number; featureName: string; value: string }[])
          .map((feature) => [String(feature.featureId), feature.featureName, feature.value])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
        return normalize(old[column] ?? '') !== normalize(row[column]);
      }
      return (old[column] ?? '') !== row[column];
    });
    return fields.length ? [{ productId: row.productId, fields }] : [];
  });
  return { baselineProducts: baseline.size, extractedProducts: rows.length, added, removed, changed };
}

function semanticSignature(result: Awaited<ReturnType<typeof runProductSemanticClassification>>['results'][number]): string {
  return JSON.stringify({
    status: result.classificationStatus,
    primary: result.primaryProductFamily ? [result.primaryProductFamily.code, result.primaryProductFamily.confidence] : null,
    secondary: result.secondaryProductFamilies.map((tag) => `${tag.code}:${tag.confidence}`).sort(),
    disciplines: result.disciplines.map((tag) => `${tag.code}:${tag.confidence}`).sort(),
    useContexts: result.useContexts.map((tag) => `${tag.code}:${tag.confidence}`).sort(),
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPaths = await resolveProductSemanticInputPaths({
    inputDir: args['input-dir'], categoryTrustMapCsvPath: args['category-trust-map'], featureTrustMapCsvPath: args['feature-trust-map'],
  });
  const baselinePath = path.resolve(args.baseline ?? inputPaths.catalogCsvPath);
  const [baselineText, categoryTrustText, featureTrustText] = await Promise.all([
    readFile(baselinePath, 'utf8'), readFile(inputPaths.categoryTrustMapCsvPath, 'utf8'), readFile(inputPaths.featureTrustMapCsvPath, 'utf8'),
  ]);
  if (!parseCsvRecords(categoryTrustText).length || !parseCsvRecords(featureTrustText).length) {
    throw new Error('Category and feature trust maps must contain records');
  }
  const pool = createPool();
  let rows: InputRow[];
  try {
    const connection = await pool.getConnection();
    try { rows = await extract(connection); } finally { connection.release(); }
  } finally {
    await pool.end();
  }
  const catalogText = writeCsv(columns, rows);
  const catalogHash = sha256(catalogText);
  const categoryTrustHash = sha256(categoryTrustText);
  const featureTrustHash = sha256(featureTrustText);
  const sourceHash = sha256(JSON.stringify({ schemaVersion, extractorVersion, database: config.db.database,
    shopId: config.prestashop.shopId, langId: config.prestashop.langId, catalogHash, categoryTrustHash, featureTrustHash }));
  const outputRoot = path.resolve(args['output-dir'] ?? 'artifacts/catalog-projection-input');
  const outputDir = path.join(outputRoot, sourceHash.slice('sha256:'.length));
  await mkdir(outputDir, { recursive: true });
  const catalogCsvPath = path.join(outputDir, 'product_catalog_exploration.csv');
  const categoryTrustMapCsvPath = path.join(outputDir, 'category_trust_map.csv');
  const featureTrustMapCsvPath = path.join(outputDir, 'feature_trust_map.csv');
  await Promise.all([
    writeFile(catalogCsvPath, catalogText, 'utf8'),
    writeFile(categoryTrustMapCsvPath, categoryTrustText, 'utf8'),
    writeFile(featureTrustMapCsvPath, featureTrustText, 'utf8'),
  ]);
  const loaded = await loadProductSemanticClassificationInputs({ catalogCsvPath, categoryTrustMapCsvPath, featureTrustMapCsvPath });
  if (loaded.inputs.length !== rows.length) throw new Error('Classifier loader did not accept every extracted product');
  const training = await loadTrainingSemanticClassificationInputs({ catalogCsvPath, categoryTrustMapCsvPath, featureTrustMapCsvPath });
  if (training.inputs.length !== rows.length) throw new Error('Training classifier loader did not accept every extracted product');
  const diff = compare(baselineText, rows);
  const [baselineClassification, extractedClassification] = await Promise.all([
    runProductSemanticClassification({ inputDir: path.dirname(baselinePath), catalogCsvPath: baselinePath,
      categoryTrustMapCsvPath, featureTrustMapCsvPath }),
    runProductSemanticClassification({ inputDir: outputDir, catalogCsvPath, categoryTrustMapCsvPath, featureTrustMapCsvPath }),
  ]);
  const baselineSemantics = new Map(baselineClassification.results.map((result) => [result.productId, semanticSignature(result)] as const));
  const changedSemanticProductIds = extractedClassification.results
    .filter((result) => baselineSemantics.has(result.productId) && baselineSemantics.get(result.productId) !== semanticSignature(result))
    .map((result) => result.productId);
  const manifest = {
    schemaVersion, extractorVersion, sourceHash,
    source: { database: config.db.database, shopId: config.prestashop.shopId, langId: config.prestashop.langId,
      transaction: 'repeatable-read-consistent-snapshot-read-only', revenue: 'valid orders, order_detail.total_price_tax_incl' },
    files: { catalog: { name: path.basename(catalogCsvPath), sha256: catalogHash },
      categoryTrustMap: { name: path.basename(categoryTrustMapCsvPath), sha256: categoryTrustHash },
      featureTrustMap: { name: path.basename(featureTrustMapCsvPath), sha256: featureTrustHash } },
    counts: { products: rows.length, current: rows.filter((row) => row.catalogPresence === 'current_catalog').length,
      historical: rows.filter((row) => row.catalogPresence === 'historical_order_detail_only').length,
      loaderWarnings: loaded.warnings.length, trainingInputs: training.inputs.length },
  };
  await writeFile(path.join(outputDir, 'projection_input_diff.json'), `${JSON.stringify({
    baseline: { file: path.basename(baselinePath), sha256: sha256(baselineText) },
    ...diff,
    semanticAssignments: { baselineChecksum: baselineClassification.checksum,
      extractedChecksum: extractedClassification.checksum, changedProductIds: changedSemanticProductIds },
    loaderWarnings: loaded.warnings,
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputDir, 'projection_input_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputDir, sourceHash, counts: manifest.counts,
    diff: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length,
      semanticAssignmentsChanged: changedSemanticProductIds.length } }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
