import { createHash } from 'node:crypto';
import { z } from 'zod';

export const EXTRACTION_SCHEMA_VERSION = '1';
export const EXTRACTOR_VERSION = 'catalog-projection-input-v2';
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export type SourceRows = {
  products: readonly { productId: number; name: string | null; active: number | null }[];
  historical: readonly { productId: number; name: string | null }[];
  categories: readonly { productId: number; categoryId: number; name: string | null }[];
  features: readonly { productId: number; featureId: number; featureValueId: number; name: string | null; value: string | null }[];
  variants: readonly { productId: number; variantId: number }[];
  revenues: readonly { productId: number; revenue: string | null }[];
};

export type CanonicalProduct = {
  productId: number;
  catalogPresence: 'current_catalog' | 'historical_order_detail_only';
  name: string;
  active: boolean | null;
  categoryIds: { categoryId: number; name: string | null }[] | null;
  features: { featureId: number; featureValueId: number; name: string; value: string | null }[] | null;
  variantIds: number[] | null;
  revenueTaxIncl: string | null;
};

export type CanonicalExtraction = {
  schemaVersion: typeof EXTRACTION_SCHEMA_VERSION;
  source: { type: 'prestashop'; identity: string; shopId: number; langId: number };
  products: CanonicalProduct[];
  orphanReferences: {
    categories: { productId: number; categoryId: number; name: string | null }[];
    features: { productId: number; featureId: number; featureValueId: number; name: string | null; value: string | null }[];
    variants: { productId: number; variantId: number }[];
    revenues: { productId: number; revenueTaxIncl: string | null }[];
  };
};

export function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function id(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`INVALID_SOURCE_DATA: ${field} must be a positive safe integer`);
  return value;
}

function text(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/gu, '\n');
}

function requiredText(value: string | null, field: string): string {
  if (value === null || !value.trim()) throw new Error(`INVALID_SOURCE_DATA: ${field} is missing`);
  return text(value);
}

function decimal(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/u.exec(value);
  if (!match) throw new Error('INVALID_SOURCE_DATA: revenue must be a decimal with at most six places');
  const integer = BigInt(match[2]!).toString();
  const fraction = (match[3] ?? '').padEnd(6, '0');
  const sign = match[1] === '-' && (integer !== '0' || Number(fraction) !== 0) ? '-' : '';
  return `${sign}${integer}.${fraction}`;
}

export function normalizeSource(rows: SourceRows, scope: CanonicalExtraction['source']): CanonicalExtraction {
  if (scope.type !== 'prestashop' || !scope.identity || !Number.isSafeInteger(scope.shopId) || scope.shopId <= 0
    || !Number.isSafeInteger(scope.langId) || scope.langId <= 0) {
    throw new Error('INVALID_SOURCE_DATA: source scope is invalid');
  }
  const products = new Map<number, CanonicalProduct>();
  for (const row of rows.products) {
    const productId = id(row.productId, 'productId');
    if (products.has(productId)) throw new Error(`INVALID_SOURCE_DATA: duplicate product ${productId}`);
    if (row.active !== null && row.active !== 0 && row.active !== 1) throw new Error(`INVALID_SOURCE_DATA: active for ${productId}`);
    products.set(productId, { productId, catalogPresence: 'current_catalog', name: requiredText(row.name, `product ${productId} name`),
      active: row.active === null ? null : row.active === 1, categoryIds: [], features: [], variantIds: [], revenueTaxIncl: null });
  }
  for (const row of rows.historical) {
    const productId = id(row.productId, 'historical productId');
    if (products.has(productId)) throw new Error(`INVALID_SOURCE_DATA: duplicate historical product ${productId}`);
    products.set(productId, { productId, catalogPresence: 'historical_order_detail_only',
      name: requiredText(row.name, `historical product ${productId} name`), active: null,
      categoryIds: null, features: null, variantIds: null, revenueTaxIncl: null });
  }
  const orphans: CanonicalExtraction['orphanReferences'] = { categories: [], features: [], variants: [], revenues: [] };
  for (const row of rows.categories) {
    const productId = id(row.productId, 'category productId');
    const categoryId = id(row.categoryId, 'categoryId');
    const product = products.get(productId);
    const name = row.name === null ? null : text(row.name);
    if (!product || product.catalogPresence !== 'current_catalog') { orphans.categories.push({ productId, categoryId, name }); continue; }
    if (product.categoryIds!.some((category) => category.categoryId === categoryId)) throw new Error(`INVALID_SOURCE_DATA: duplicate category ${categoryId} on ${productId}`);
    product.categoryIds!.push({ categoryId, name });
  }
  for (const row of rows.features) {
    const productId = id(row.productId, 'feature productId');
    const featureId = id(row.featureId, 'featureId');
    const featureValueId = id(row.featureValueId, 'featureValueId');
    const product = products.get(productId);
    const name = row.name === null ? null : text(row.name);
    const value = row.value === null ? null : text(row.value);
    if (!product || product.catalogPresence !== 'current_catalog') { orphans.features.push({ productId, featureId, featureValueId, name, value }); continue; }
    if (product.features!.some((feature) => feature.featureId === featureId && feature.featureValueId === featureValueId)) {
      throw new Error(`INVALID_SOURCE_DATA: duplicate feature value ${featureValueId} on ${productId}`);
    }
    product.features!.push({ featureId, featureValueId, name: requiredText(name, `feature ${featureId} name`), value });
  }
  for (const row of rows.variants) {
    const productId = id(row.productId, 'variant productId');
    const variantId = id(row.variantId, 'variantId');
    const product = products.get(productId);
    if (!product || product.catalogPresence !== 'current_catalog') { orphans.variants.push({ productId, variantId }); continue; }
    if (product.variantIds?.includes(variantId)) throw new Error(`INVALID_SOURCE_DATA: duplicate variant ${variantId}`);
    product.variantIds!.push(variantId);
  }
  const revenueIds = new Set<number>();
  for (const row of rows.revenues) {
    const productId = id(row.productId, 'revenue productId');
    if (revenueIds.has(productId)) throw new Error(`INVALID_SOURCE_DATA: duplicate revenue ${productId}`);
    revenueIds.add(productId);
    const product = products.get(productId);
    const revenueTaxIncl = decimal(row.revenue);
    if (!product) { orphans.revenues.push({ productId, revenueTaxIncl }); continue; }
    product.revenueTaxIncl = revenueTaxIncl;
  }
  for (const product of products.values()) {
    product.categoryIds?.sort((a, b) => a.categoryId - b.categoryId);
    product.features?.sort((a, b) => a.featureId - b.featureId || a.featureValueId - b.featureValueId);
    product.variantIds?.sort((a, b) => a - b);
  }
  return {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    source: { type: 'prestashop', identity: scope.identity, shopId: scope.shopId, langId: scope.langId },
    products: [...products.values()].sort((a, b) => a.productId - b.productId),
    orphanReferences: {
      categories: orphans.categories.sort((a, b) => a.productId - b.productId || a.categoryId - b.categoryId),
      features: orphans.features.sort((a, b) => a.productId - b.productId || a.featureId - b.featureId || a.featureValueId - b.featureValueId),
      variants: orphans.variants.sort((a, b) => a.productId - b.productId || a.variantId - b.variantId),
      revenues: orphans.revenues.sort((a, b) => a.productId - b.productId),
    },
  };
}

export function canonicalContent(input: CanonicalExtraction): string {
  return `${JSON.stringify(input)}\n`;
}

export function recordCounts(input: CanonicalExtraction) {
  const current = input.products.filter((product) => product.catalogPresence === 'current_catalog');
  return {
    products: input.products.length,
    currentProducts: current.length,
    historicalProducts: input.products.length - current.length,
    activeProducts: current.filter((product) => product.active === true).length,
    inactiveProducts: current.filter((product) => product.active === false).length,
    unknownActiveProducts: current.filter((product) => product.active === null).length,
    items: current.reduce((sum, product) => sum + (product.variantIds?.length || 1), 0),
    variants: current.reduce((sum, product) => sum + (product.variantIds?.length ?? 0), 0),
    categories: new Set(current.flatMap((product) => (product.categoryIds ?? []).map((category) => category.categoryId))).size,
    features: new Set(current.flatMap((product) => (product.features ?? []).map((feature) => feature.featureId))).size,
    featureAssignments: current.reduce((sum, product) => sum + (product.features?.length ?? 0), 0),
  };
}

export const extractionManifestSchema = z.object({
  schemaVersion: z.literal(EXTRACTION_SCHEMA_VERSION),
  sourceExtractionId: hashSchema,
  extractor: z.object({ version: z.literal(EXTRACTOR_VERSION), buildRef: z.string().min(1), buildRefSource: z.enum(['environment', 'git', 'unavailable']) }).strict(),
  source: z.object({ type: z.literal('prestashop'), identity: z.string().min(1), shopId: z.number().int().positive(),
    langId: z.number().int().positive(), observedAt: z.string().datetime() }).strict(),
  recordCounts: z.object({ products: z.number().int().nonnegative(), currentProducts: z.number().int().nonnegative(),
    historicalProducts: z.number().int().nonnegative(), activeProducts: z.number().int().nonnegative(),
    inactiveProducts: z.number().int().nonnegative(), unknownActiveProducts: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(), variants: z.number().int().nonnegative(),
    categories: z.number().int().nonnegative(), features: z.number().int().nonnegative(),
    featureAssignments: z.number().int().nonnegative() }).strict(),
  artifacts: z.object({ canonicalInput: hashSchema, compatibilityCsv: hashSchema,
    categoryTrustMap: hashSchema, featureTrustMap: hashSchema }).strict(),
  aggregateContentHash: hashSchema,
}).strict();

export type ExtractionManifest = z.infer<typeof extractionManifestSchema>;

export function aggregateContentHash(artifacts: ExtractionManifest['artifacts']): string {
  return contentHash(JSON.stringify({ schemaVersion: EXTRACTION_SCHEMA_VERSION, extractorVersion: EXTRACTOR_VERSION,
    canonicalInput: artifacts.canonicalInput, compatibilityCsv: artifacts.compatibilityCsv,
    categoryTrustMap: artifacts.categoryTrustMap, featureTrustMap: artifacts.featureTrustMap }));
}

export function validateManifest(manifest: unknown, artifacts: ExtractionManifest['artifacts']): ExtractionManifest {
  const checked = extractionManifestSchema.safeParse(manifest);
  if (!checked.success) throw new Error('INVALID_MANIFEST: schema is incomplete or incompatible');
  const parsed = checked.data;
  if (parsed.sourceExtractionId !== artifacts.canonicalInput || parsed.aggregateContentHash !== aggregateContentHash(artifacts)
    || JSON.stringify(parsed.artifacts) !== JSON.stringify(artifacts)) throw new Error('INVALID_MANIFEST: content hashes do not match');
  return parsed;
}
