import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { createPool } from '../../src/infrastructure/database/pool.js';
import { config } from '../../src/shared/config.js';
import {
  aggregateContentHash, canonicalContent, contentHash, EXTRACTOR_VERSION, EXTRACTION_SCHEMA_VERSION,
  normalizeSource, recordCounts, validateManifest, type CanonicalExtraction, type ExtractionManifest, type SourceRows,
} from '../../src/domain/catalog/projection-input/canonical.js';
import { runProductSemanticClassification } from '../product-semantic-classification/lib/classification-run.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from '../product-semantic-classification/lib/load-input.js';
import { loadTrainingSemanticClassificationInputs } from '../training-semantic-classification/lib/load-input.js';
import { assertReadOnlySelect, baselineRows, canonicalTrustMap, compatibilityCsv, publishLocalExtraction, rawDiff } from './extractionArtifacts.js';

type ProductRow = RowDataPacket & SourceRows['products'][number];
type HistoricalRow = RowDataPacket & SourceRows['historical'][number];
type CategoryRow = RowDataPacket & SourceRows['categories'][number];
type FeatureRow = RowDataPacket & SourceRows['features'][number];
type VariantRow = RowDataPacket & SourceRows['variants'][number];
type RevenueRow = RowDataPacket & SourceRows['revenues'][number];
type EngineRow = RowDataPacket & { tableName: string; engine: string | null };

const requiredTables = ['product', 'product_shop', 'product_lang', 'order_detail', 'orders',
  'category_product', 'category_lang', 'feature_product', 'feature_lang', 'feature_value_lang', 'product_attribute'] as const;

function table(suffix: string): string { return `${config.prestashop.prefix}${suffix}`; }

function args(argv: readonly string[]) {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(arg);
    if (!match || !['output-dir', 'baseline', 'input-dir', 'category-trust-map', 'feature-trust-map', 'runs'].includes(match[1]!)) {
      throw new Error(`INVALID_SOURCE_DATA: unsupported argument ${arg}`);
    }
    values[match[1]!] = match[2]!;
  }
  const runs = Number(values.runs ?? '2');
  if (runs !== 1 && runs !== 2) throw new Error('INVALID_SOURCE_DATA: --runs must be 1 or 2');
  return { values, runs };
}

function buildRef(): { buildRef: string; buildRefSource: 'environment' | 'git' | 'unavailable' } {
  const configured = process.env.CATALOG_SERVICE_BUILD_REF?.trim();
  if (configured && configured !== 'catalog-service@local') return { buildRef: configured, buildRefSource: 'environment' };
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^[a-f0-9]{40}$/u.test(sha)) {
      const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
      return { buildRef: dirty ? `${sha}-dirty` : sha, buildRefSource: 'git' };
    }
  } catch { /* Git is optional in deployed environments. */ }
  return { buildRef: 'unavailable', buildRefSource: 'unavailable' };
}

async function readOnlyGrants(connection: PoolConnection): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER()');
  const grants = rows.flatMap(Object.values).map(String);
  const mutating = /\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|EXECUTE|TRIGGER|GRANT OPTION)\b/iu;
  return grants.length > 0 && grants.some((grant) => /\bSELECT\b/iu.test(grant)) && grants.every((grant) => !mutating.test(grant));
}

async function select<T extends RowDataPacket[]>(connection: PoolConnection, name: string, sql: string,
  params: readonly unknown[], queryMs: Record<string, number>): Promise<T> {
  assertReadOnlySelect(sql);
  const started = performance.now();
  try {
    const [rows] = await connection.query<T>({ sql, values: [...params], timeout: 120_000 });
    return rows;
  } finally {
    queryMs[name] = (queryMs[name] ?? 0) + (performance.now() - started);
  }
}

async function confirmSnapshotEngines(connection: PoolConnection, queryMs: Record<string, number>): Promise<void> {
  const names = requiredTables.map(table);
  const rows = await select<EngineRow[]>(connection, 'tableEngines', `
    SELECT table_name AS tableName, engine AS engine
    FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN (${names.map(() => '?').join(', ')})
    ORDER BY table_name
  `, names, queryMs);
  if (rows.length !== names.length || rows.some((row) => row.engine?.toUpperCase() !== 'INNODB')) {
    throw new Error('INVALID_SOURCE_DATA: all source tables must be present and InnoDB for a consistent snapshot');
  }
}

async function readSource(connection: PoolConnection, queryMs: Record<string, number>): Promise<SourceRows> {
  const shop = config.prestashop.shopId;
  const lang = config.prestashop.langId;
  const products = await select<ProductRow[]>(connection, 'products', `
    SELECT p.id_product AS productId, pl.name AS name, COALESCE(ps.active, p.active) AS active
    FROM ${table('product')} p
    LEFT JOIN ${table('product_shop')} ps ON ps.id_product = p.id_product AND ps.id_shop = ?
    LEFT JOIN ${table('product_lang')} pl ON pl.id_product = p.id_product AND pl.id_shop = ? AND pl.id_lang = ?
    ORDER BY p.id_product
  `, [shop, shop, lang], queryMs);
  const historical = await select<HistoricalRow[]>(connection, 'historical', `
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
  `, [], queryMs);
  const categories = await select<CategoryRow[]>(connection, 'categories', `
    SELECT cp.id_product AS productId, cp.id_category AS categoryId, cl.name AS name
    FROM ${table('category_product')} cp
    LEFT JOIN ${table('category_lang')} cl ON cl.id_category = cp.id_category AND cl.id_shop = ? AND cl.id_lang = ?
    ORDER BY cp.id_product, cp.id_category
  `, [shop, lang], queryMs);
  const features = await select<FeatureRow[]>(connection, 'features', `
    SELECT fp.id_product AS productId, fp.id_feature AS featureId, fp.id_feature_value AS featureValueId,
      fl.name AS name, fvl.value AS value
    FROM ${table('feature_product')} fp
    LEFT JOIN ${table('feature_lang')} fl ON fl.id_feature = fp.id_feature AND fl.id_lang = ?
    LEFT JOIN ${table('feature_value_lang')} fvl ON fvl.id_feature_value = fp.id_feature_value AND fvl.id_lang = ?
    ORDER BY fp.id_product, fp.id_feature, fp.id_feature_value
  `, [lang, lang], queryMs);
  const variants = await select<VariantRow[]>(connection, 'variants', `
    SELECT pa.id_product AS productId, pa.id_product_attribute AS variantId
    FROM ${table('product_attribute')} pa
    ORDER BY pa.id_product, pa.id_product_attribute
  `, [], queryMs);
  const revenues = await select<RevenueRow[]>(connection, 'revenues', `
    SELECT od.product_id AS productId, CAST(ROUND(SUM(od.total_price_tax_incl), 6) AS CHAR) AS revenue
    FROM ${table('order_detail')} od
    INNER JOIN ${table('orders')} o ON o.id_order = od.id_order AND o.valid = 1
    WHERE od.product_id > 0
    GROUP BY od.product_id
    ORDER BY od.product_id
  `, [], queryMs);
  return { products, historical, categories, features, variants, revenues };
}

function semanticView(result: Awaited<ReturnType<typeof runProductSemanticClassification>>['results'][number]) {
  return {
    status: result.classificationStatus,
    family: result.primaryProductFamily?.code ?? null,
    secondaryFamilies: result.secondaryProductFamilies.map((tag) => tag.code).sort(),
    disciplines: result.disciplines.map((tag) => tag.code).sort(),
    useContexts: result.useContexts.map((tag) => tag.code).sort(),
  };
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const match = /^(SOURCE_UNAVAILABLE|INVALID_SOURCE_DATA|EXTRACTION_FAILED|SERIALIZATION_FAILED|HASH_FAILED|NON_DETERMINISTIC_OUTPUT|INVALID_MANIFEST):?\s*(.*)$/u.exec(error.message);
    if (match) return { code: match[1]!, message: match[2] || match[1]! };
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (/^(ECONN|ETIMEDOUT|ENOTFOUND|EHOST)/u.test(code)) return { code: 'SOURCE_UNAVAILABLE', message: 'PrestaShop source is unavailable' };
  return { code: 'EXTRACTION_FAILED', message: 'Extraction failed; inspect local environment and source schema' };
}

async function main(): Promise<void> {
  const started = performance.now();
  const { values, runs } = args(process.argv.slice(2));
  const inputPaths = await resolveProductSemanticInputPaths({ inputDir: values['input-dir'],
    categoryTrustMapCsvPath: values['category-trust-map'], featureTrustMapCsvPath: values['feature-trust-map'] });
  const baselinePath = path.resolve(values.baseline ?? inputPaths.catalogCsvPath);
  const [baselineText, categoryTrustText, featureTrustText] = await Promise.all([
    readFile(baselinePath, 'utf8'), readFile(inputPaths.categoryTrustMapCsvPath, 'utf8'), readFile(inputPaths.featureTrustMapCsvPath, 'utf8'),
  ]);
  const categoryTrustMap = canonicalTrustMap(categoryTrustText, 'categoryId');
  const featureTrustMap = canonicalTrustMap(featureTrustText, 'featureId');
  const baseline = baselineRows(baselineText);
  const sourceIdentity = contentHash(JSON.stringify({ database: config.db.database,
    shopId: config.prestashop.shopId, langId: config.prestashop.langId }));
  const scope: CanonicalExtraction['source'] = { type: 'prestashop', identity: sourceIdentity,
    shopId: config.prestashop.shopId, langId: config.prestashop.langId };
  const queryMs: Record<string, number> = {};
  const pool = createPool();
  let observedAt = '';
  let runA = '';
  let runB = '';
  let canonical: CanonicalExtraction;
  let canonicalB: CanonicalExtraction | null = null;
  let readOnlyConfirmed = false;
  let normalizationMs = 0;
  try {
    const connection = await pool.getConnection();
    try {
      readOnlyConfirmed = await readOnlyGrants(connection);
      if (!readOnlyConfirmed) throw new Error('SOURCE_UNAVAILABLE: database grants are not confirmed read-only');
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      observedAt = new Date().toISOString();
      try {
        await confirmSnapshotEngines(connection, queryMs);
        const firstRows = await readSource(connection, queryMs);
        const normalizeStart = performance.now();
        canonical = normalizeSource(firstRows, scope);
        runA = canonicalContent(canonical);
        normalizationMs += performance.now() - normalizeStart;
        if (runs === 2) {
          const secondRows = await readSource(connection, queryMs);
          const secondStart = performance.now();
          canonicalB = normalizeSource(secondRows, scope);
          runB = canonicalContent(canonicalB);
          normalizationMs += performance.now() - secondStart;
          if (runA !== runB) throw new Error('NON_DETERMINISTIC_OUTPUT: canonical bytes differed inside one consistent source snapshot');
        } else runB = runA;
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      }
    } finally { connection.release(); }
  } finally { await pool.end(); }

  const serializationStart = performance.now();
  let csv: string;
  try { csv = compatibilityCsv(canonical!); }
  catch { throw new Error('SERIALIZATION_FAILED: compatibility CSV could not be generated'); }
  const serializationMs = performance.now() - serializationStart;
  const hashingStart = performance.now();
  let artifacts: ExtractionManifest['artifacts'];
  try {
    artifacts = { canonicalInput: contentHash(runA), compatibilityCsv: contentHash(csv),
      categoryTrustMap: contentHash(categoryTrustMap), featureTrustMap: contentHash(featureTrustMap) };
  } catch { throw new Error('HASH_FAILED: artifact hashes could not be calculated'); }
  const manifest: ExtractionManifest = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    sourceExtractionId: artifacts.canonicalInput,
    extractor: { version: EXTRACTOR_VERSION, ...buildRef() },
    source: { ...scope, observedAt },
    recordCounts: recordCounts(canonical!),
    artifacts,
    aggregateContentHash: aggregateContentHash(artifacts),
  };
  validateManifest(manifest, artifacts);
  const runBArtifacts: ExtractionManifest['artifacts'] | null = canonicalB === null ? null : {
    canonicalInput: contentHash(runB), compatibilityCsv: contentHash(compatibilityCsv(canonicalB)),
    categoryTrustMap: contentHash(categoryTrustMap), featureTrustMap: contentHash(featureTrustMap),
  };
  if (runBArtifacts && (JSON.stringify(runBArtifacts) !== JSON.stringify(artifacts)
    || aggregateContentHash(runBArtifacts) !== manifest.aggregateContentHash
    || JSON.stringify(recordCounts(canonicalB!)) !== JSON.stringify(manifest.recordCounts))) {
    throw new Error('NON_DETERMINISTIC_OUTPUT: artifact hashes or record counts differed inside one source snapshot');
  }
  const hashingMs = performance.now() - hashingStart;
  const outputRoot = path.resolve(values['output-dir'] ?? 'artifacts/catalog-projection-input');
  const files = {
    'canonical_input.json': runA,
    'product_catalog_exploration.csv': csv,
    'category_trust_map.csv': categoryTrustMap,
    'feature_trust_map.csv': featureTrustMap,
    'projection_input_manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
  };
  const rawChanges = rawDiff(baseline, csv);
  const baselineById = new Map(baseline.map((row) => [row.productId!, row] as const));
  const currentById = new Map(baselineRows(csv).map((row) => [row.productId!, row] as const));
  let loaderWarnings: readonly string[] = [];
  let semanticChanges: readonly unknown[] = [];
  let unexplained = 0;
  const validate = async (directory: string) => {
    const actualFiles = await Promise.all(Object.keys(files).map((name) => readFile(path.join(directory, name), 'utf8')));
    const actual: ExtractionManifest['artifacts'] = {
      canonicalInput: contentHash(actualFiles[0]!), compatibilityCsv: contentHash(actualFiles[1]!),
      categoryTrustMap: contentHash(actualFiles[2]!), featureTrustMap: contentHash(actualFiles[3]!),
    };
    let savedManifest: unknown;
    try { savedManifest = JSON.parse(actualFiles[4]!); }
    catch { throw new Error('INVALID_MANIFEST: manifest is not valid JSON'); }
    const validatedManifest = validateManifest(savedManifest, actual);
    if (JSON.stringify(validatedManifest.recordCounts) !== JSON.stringify(recordCounts(canonical!))
      || validatedManifest.source.identity !== canonical!.source.identity
      || validatedManifest.source.shopId !== canonical!.source.shopId
      || validatedManifest.source.langId !== canonical!.source.langId) {
      throw new Error('INVALID_MANIFEST: source scope or record counts do not match canonical input');
    }
    if (actualFiles[0] !== runA || actualFiles[1] !== csv || actualFiles[2] !== categoryTrustMap || actualFiles[3] !== featureTrustMap) {
      throw new Error('NON_DETERMINISTIC_OUTPUT: published content differs from current extraction');
    }
    const paths = { inputDir: directory, catalogCsvPath: path.join(directory, 'product_catalog_exploration.csv'),
      categoryTrustMapCsvPath: path.join(directory, 'category_trust_map.csv'), featureTrustMapCsvPath: path.join(directory, 'feature_trust_map.csv') };
    const loaded = await loadProductSemanticClassificationInputs(paths);
    const training = await loadTrainingSemanticClassificationInputs(paths);
    if (loaded.inputs.length !== canonical!.products.length || training.inputs.length !== canonical!.products.length) {
      throw new Error('INVALID_SOURCE_DATA: existing classifiers did not accept every product');
    }
    loaderWarnings = loaded.warnings;
    const [oldRun, newRun] = await Promise.all([
      runProductSemanticClassification({ ...paths, catalogCsvPath: baselinePath }),
      runProductSemanticClassification(paths),
    ]);
    const oldById = new Map(oldRun.results.map((result) => [result.productId, semanticView(result)] as const));
    const changedFields = new Map(rawChanges.changed.map((change) => [change.productKey, change.fields] as const));
    const normalizationFields = new Set(rawChanges.normalizationChanges.map((change) => change.productKey));
    semanticChanges = newRun.results.flatMap((result) => {
      const old = oldById.get(result.productId);
      const current = semanticView(result);
      if (!old || JSON.stringify(old) === JSON.stringify(current)) return [];
      const productKey = `P${result.productId}`;
      const fields = changedFields.get(productKey) ?? [];
      const previousPresence = baselineById.get(String(result.productId))?.catalogPresence ?? null;
      const currentPresence = currentById.get(String(result.productId))?.catalogPresence ?? null;
      const reason = previousPresence !== currentPresence ? 'SOURCE_DATA_CHANGE'
        : fields.some((field) => field !== 'totalRevenueTaxIncl') ? 'SOURCE_DATA_CHANGE'
        : normalizationFields.has(productKey) ? 'NORMALIZATION_CHANGE' : 'UNEXPLAINED';
      const reasonDetail = previousPresence !== currentPresence
        ? `catalogPresence ${previousPresence} -> ${currentPresence}`
        : fields.length ? `source fields changed: ${fields.join(', ')}`
          : normalizationFields.has(productKey) ? 'canonical formatting changed' : 'no source or normalization change found';
      return [{ productKey, classification: 'SEMANTIC_ASSIGNMENT_CHANGE', old, current, reason, reasonDetail, changedFields: fields }];
    });
    unexplained = semanticChanges.filter((change) => (change as { reason: string }).reason === 'UNEXPLAINED').length;
  };
  const publication = await publishLocalExtraction(outputRoot, manifest.aggregateContentHash, files, validate);
  const diffReport = {
    sourceExtractionId: manifest.sourceExtractionId,
    baseline: { name: path.basename(baselinePath), contentHash: contentHash(baselineText) },
    counts: { added: rawChanges.added.length, removed: rawChanges.removed.length,
      changed: rawChanges.changed.length, normalizationChanges: rawChanges.normalizationChanges.length,
      semanticChanges: semanticChanges.length, unexplained },
    changes: rawChanges.changed.map((change) => ({ ...change, classification: 'SOURCE_DATA_CHANGE' })),
    added: rawChanges.added.map((productKey) => ({ productKey, classification: 'PRODUCT_ADDED' })),
    removed: rawChanges.removed.map((productKey) => ({ productKey, classification: 'PRODUCT_REMOVED' })),
    normalizationChanges: rawChanges.normalizationChanges.map((change) => ({ ...change, classification: 'NORMALIZATION_CHANGE' })),
    semanticChanges, loaderWarnings,
  };
  const report = {
    observedAt, readOnlyGrantsConfirmed: readOnlyConfirmed,
    snapshot: { isolation: 'REPEATABLE READ', consistent: true, readOnly: true, innoDbTables: requiredTables.length },
    determinism: { runs, sameSnapshot: runs === 2,
      runA: { sourceExtractionId: artifacts.canonicalInput, artifacts, aggregateContentHash: manifest.aggregateContentHash,
        recordCounts: manifest.recordCounts },
      runB: runBArtifacts ? { sourceExtractionId: runBArtifacts.canonicalInput, artifacts: runBArtifacts,
        aggregateContentHash: aggregateContentHash(runBArtifacts), recordCounts: recordCounts(canonicalB!) } : null,
      canonicalBytesEqual: runs === 2 ? runA === runB : null },
    orphanReferences: { categories: canonical!.orphanReferences.categories.length,
      features: canonical!.orphanReferences.features.length, variants: canonical!.orphanReferences.variants.length,
      revenues: canonical!.orphanReferences.revenues.length },
    performance: { totalMs: Math.round(performance.now() - started), queryMs, normalizationMs: Math.round(normalizationMs),
      serializationMs: Math.round(serializationMs), hashingMs: Math.round(hashingMs), observedRssBytes: process.memoryUsage().rss,
      artifactBytes: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.byteLength(value, 'utf8')])) },
    diff: diffReport,
  };
  const reportDirectory = path.join(outputRoot, 'reports');
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, `${manifest.aggregateContentHash.slice(7)}-${contentHash(baselineText).slice(7, 19)}-${Date.now()}.json`);
  const temporaryReport = path.join(reportDirectory, `.tmp-${randomUUID()}.json`);
  try {
    await writeFile(temporaryReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await rename(temporaryReport, reportPath);
  } catch (error) { await unlink(temporaryReport).catch(() => {}); throw error; }
  console.log(JSON.stringify({ status: 'ok', sourceExtractionId: manifest.sourceExtractionId,
    aggregateContentHash: manifest.aggregateContentHash, outputDir: publication.directory, reused: publication.reused,
    reportPath, recordCounts: manifest.recordCounts, diffCounts: diffReport.counts,
    determinism: report.determinism, performance: report.performance }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: 'failed', ...safeError(error) }));
  process.exitCode = 1;
});
