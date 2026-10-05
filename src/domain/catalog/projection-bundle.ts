import { z } from 'zod';
import { contentHash, type CanonicalExtraction } from './projection-input/canonical.js';
import { productSemanticSnapshotSchema } from '../product-semantic-snapshot/contracts.js';
import { createProductSemanticSnapshotId } from '../product-semantic-snapshot/defaultSnapshotBuilder.js';
import { trainingSemanticSnapshotSchema, type TrainingSemanticSnapshot } from '../training-semantic-snapshot/contracts.js';
import { validateTrainingSemanticSnapshot } from '../training-semantic-snapshot/defaultSnapshotBuilder.js';
import { validateTrainingSemanticSnapshotV2, validateTrainingSemanticV2Source } from '../training-semantic-snapshot/v2SnapshotBuilder.js';
import { trainingSemanticsV2ProjectionSchema } from './training-semantics-v2-projection.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const names = ['productSemantics', 'trainingSemantics', 'specs', 'relationships', 'capabilities', 'trustMaps'] as const;
export type ProjectionName = typeof names[number] | 'trainingSemanticsV2';
const present = z.object({ status: z.literal('present'), schemaVersion: z.literal('1'), snapshotId: hash,
  contentHash: hash, builderVersion: z.string().min(1), recordCount: z.number().int().nonnegative(),
  artifact: z.string().regex(/^[a-zA-Z0-9-]+\.json$/u) }).strict();
const unavailable = z.object({ status: z.literal('unavailable'), reason: z.string().min(1) }).strict();
export const bundleManifestSchema = z.object({ schemaVersion: z.literal('1'), projectionBundleId: hash,
  source: z.object({ sourceExtractionId: hash, canonicalInputHash: hash }).strict(),
  build: z.object({ codeRef: z.string().min(1), builtAt: z.string().datetime(), builderVersions: z.record(z.string()) }).strict(),
  projections: z.object({
    ...Object.fromEntries(names.map((name) => [name, z.discriminatedUnion('status', [present, unavailable])])) as Record<typeof names[number], z.ZodDiscriminatedUnion<'status', [typeof present, typeof unavailable]>>,
    trainingSemanticsV2: z.discriminatedUnion('status', [present.extend({ schemaVersion: z.literal('2') }), unavailable]).optional(),
  }).strict(),
  validation: z.object({ status: z.literal('TECHNICALLY_VALID'), domainReview: z.enum(['PENDING', 'DOMAIN_REVIEWED']) }).strict(),
}).strict();
export type BundleManifest = z.infer<typeof bundleManifestSchema>;

const spec = z.object({ productKey: z.string().regex(/^P[1-9]\d*$/u), catalogPresence: z.enum(['current_catalog', 'historical_order_detail_only']),
  key: z.enum(['max_user_weight_kg', 'max_load_kg', 'assembled_length_cm', 'assembled_width_cm', 'assembled_height_cm', 'weight_kg']),
  value: z.number().positive().nullable(), unit: z.enum(['kg', 'cm']), sourceFeature: z.object({ featureId: z.number().int().positive(), featureValueId: z.number().int().positive() }).strict(),
  rawValue: z.string(), derivationRule: z.string().min(1), status: z.enum(['parsed', 'ambiguous', 'unsupported']) }).strict().superRefine((value, ctx) => {
  if ((value.status === 'parsed') !== (value.value !== null)) ctx.addIssue({ code: 'custom', message: 'Only parsed specs have a value' });
});
export const specsArtifactSchema = z.object({ schemaVersion: z.literal('1'), sourceExtractionId: hash,
  records: z.array(spec) }).strict();
export type SpecsArtifact = z.infer<typeof specsArtifactSchema>;

export class BundleError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}
function fail(code: string, message: string): never { throw new BundleError(code, message); }
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function semanticHash(value: unknown): string { return contentHash(canonicalJson(value)); }
export function bundleId(manifest: Omit<BundleManifest, 'projectionBundleId'>): string {
  const identity = { schemaVersion: manifest.schemaVersion, source: manifest.source,
    codeRef: manifest.build.codeRef, builderVersions: manifest.build.builderVersions,
    projections: manifest.projections, domainReview: manifest.validation.domainReview };
  return semanticHash(identity);
}

const rules: Record<number, { keys: SpecsArtifact['records'][number]['key'][]; unit: 'kg' | 'cm'; version: string }> = {
  11: { keys: ['max_user_weight_kg'], unit: 'kg', version: 'feature-11-kg-v1' },
  12: { keys: ['max_load_kg'], unit: 'kg', version: 'feature-12-kg-v1' },
  41: { keys: ['max_load_kg'], unit: 'kg', version: 'feature-41-kg-v1' },
  3: { keys: ['weight_kg'], unit: 'kg', version: 'feature-3-kg-v1' },
  15: { keys: ['assembled_length_cm', 'assembled_width_cm', 'assembled_height_cm'], unit: 'cm', version: 'feature-15-cm-v1' },
};
function parseMeasurement(raw: string, unit: 'kg' | 'cm', label?: string) {
  const text = label ? (raw.match(new RegExp(`${label}\\s*:\\s*([^;]+?)(?=\\b(?:Largo|Ancho|Alto)\\s*:|$)`, 'iu'))?.[1] ?? '') : raw;
  const matches = [...text.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${unit}\\b`, 'giu'))];
  if (matches.length === 1) return { status: 'parsed' as const, value: Number(matches[0]![1]!.replace(',', '.')) };
  return { status: matches.length > 1 || /\d/u.test(text) ? 'ambiguous' as const : 'unsupported' as const, value: null };
}
export function buildSpecs(source: CanonicalExtraction, sourceExtractionId: string): SpecsArtifact {
  const records: SpecsArtifact['records'] = [];
  for (const product of source.products) for (const feature of product.features ?? []) {
    const rule = rules[feature.featureId];
    if (!rule) continue;
    for (const key of rule.keys) {
      const rawValue = feature.value ?? '';
      const label = key.startsWith('assembled_') ? ({ assembled_length_cm: 'Largo', assembled_width_cm: 'Ancho', assembled_height_cm: 'Alto' } as const)[key as 'assembled_length_cm'] : undefined;
      const parsed = parseMeasurement(rawValue, rule.unit, label);
      records.push({ productKey: `P${product.productId}`, catalogPresence: product.catalogPresence, key,
        value: parsed.value, unit: rule.unit, sourceFeature: { featureId: feature.featureId, featureValueId: feature.featureValueId },
        rawValue, derivationRule: rule.version, status: parsed.status });
    }
  }
  records.sort((a, b) => Number(a.productKey.slice(1)) - Number(b.productKey.slice(1)) || a.key.localeCompare(b.key) || a.sourceFeature.featureId - b.sourceFeature.featureId || a.sourceFeature.featureValueId - b.sourceFeature.featureValueId);
  const values = new Map<string, Set<number>>();
  for (const row of records) if (row.status === 'parsed') {
    const identity = `${row.productKey}/${row.key}`;
    if (!values.has(identity)) values.set(identity, new Set());
    values.get(identity)!.add(row.value!);
  }
  for (const row of records) if (values.get(`${row.productKey}/${row.key}`)?.size && values.get(`${row.productKey}/${row.key}`)!.size > 1) {
    row.status = 'ambiguous'; row.value = null;
  }
  return specsArtifactSchema.parse({ schemaVersion: '1', sourceExtractionId, records });
}

export function validateBundle(manifestValue: unknown, files: Readonly<Record<string, string>>, source?: CanonicalExtraction) {
  const parsed = bundleManifestSchema.safeParse(manifestValue);
  if (!parsed.success) return fail('INVALID_BUNDLE_MANIFEST', parsed.error.message);
  const manifest = parsed.data;
  if (manifest.source.sourceExtractionId !== manifest.source.canonicalInputHash
    || (source && manifest.source.sourceExtractionId !== contentHash(`${JSON.stringify(source)}\n`))) fail('SOURCE_LINEAGE_INVALID', 'canonical source hash differs');
  if (manifest.projectionBundleId !== bundleId(manifest)) fail('INVALID_BUNDLE_MANIFEST', 'bundle identity differs');
  const errors: string[] = [], warnings: string[] = [];
  const validators = [] as { name: string; status: 'PASS'; checked: number; warnings: number; errors: number }[];
  const catalog = new Map(source?.products.map((p) => [`P${p.productId}`, p.catalogPresence]) ?? []);
  const artifactNames = new Set<string>();
  for (const name of [...names, 'trainingSemanticsV2'] as const) {
    const entry = manifest.projections[name];
    if (!entry) continue; // Phase 1 bundle identity and compatibility stay intact.
    if (entry.status === 'unavailable') { warnings.push(`${name}: unavailable (${entry.reason})`); continue; }
    if (artifactNames.has(entry.artifact)) fail('INVALID_BUNDLE_MANIFEST', `duplicate artifact ${entry.artifact}`);
    artifactNames.add(entry.artifact);
    const raw = files[entry.artifact];
    if (raw === undefined) fail('BUNDLE_VALIDATION_FAILED', `missing ${entry.artifact}`);
    if (contentHash(raw) !== entry.contentHash) fail('PROJECTION_HASH_MISMATCH', entry.artifact);
    let artifact: unknown;
    let projectionWarnings = 0;
    try { artifact = JSON.parse(raw); } catch { fail('INVALID_PROJECTION_SCHEMA', entry.artifact); }
    if (name === 'specs') {
      const specs = specsArtifactSchema.safeParse(artifact);
      if (!specs.success) fail('INVALID_PROJECTION_SCHEMA', specs.error.message);
      if (specs.data.sourceExtractionId !== manifest.source.sourceExtractionId) fail('SOURCE_LINEAGE_INVALID', 'specs');
      if (specs.data.records.length !== entry.recordCount) fail('INVALID_PROJECTION_SCHEMA', 'spec count');
      if (catalog.size) for (const row of specs.data.records) if (catalog.get(row.productKey) !== row.catalogPresence) errors.push(`spec product/presence: ${row.productKey}`);
      const statusCounts = { parsed: 0, ambiguous: 0, unsupported: 0 };
      for (const row of specs.data.records) statusCounts[row.status] += 1;
      projectionWarnings = statusCounts.ambiguous + statusCounts.unsupported;
      warnings.push(`specs: ${statusCounts.parsed} parsed, ${statusCounts.ambiguous} ambiguous, ${statusCounts.unsupported} unsupported`);
      const assignments = new Map<string, number>();
      for (const row of specs.data.records.filter((r) => r.status === 'parsed')) {
        const identity = `${row.productKey}/${row.key}`;
        if (assignments.has(identity) && assignments.get(identity) !== row.value) errors.push(`conflicting spec: ${identity}`);
        assignments.set(identity, row.value!);
      }
    } else if (name === 'productSemantics') {
      const wrapper = z.object({ schemaVersion: z.literal('1'), sourceExtractionId: hash,
        legacySnapshotId: hash, snapshot: productSemanticSnapshotSchema }).strict().safeParse(artifact);
      if (!wrapper.success) fail('INVALID_PROJECTION_SCHEMA', wrapper.error.message);
      if (wrapper.data.sourceExtractionId !== manifest.source.sourceExtractionId) fail('SOURCE_LINEAGE_INVALID', 'product semantics');
      const s = wrapper.data.snapshot;
      if (s.snapshotId !== createProductSemanticSnapshotId(s)) fail('INVALID_PROJECTION_SCHEMA', 'legacy snapshot identity');
      if (s.recordCount !== entry.recordCount || wrapper.data.legacySnapshotId !== s.snapshotId) fail('INVALID_PROJECTION_SCHEMA', 'semantic count/identity');
      const seen = new Set<string>();
      for (const row of s.records) {
        const key = `P${row.productId}`;
        if (!/^P[1-9]\d*$/u.test(key) || (source && catalog.get(key) !== row.catalogPresence)) errors.push(`semantic product/presence: ${key}`);
        if (seen.has(key)) errors.push(`duplicate semantic product: ${key}`);
        seen.add(key);
        if (!source) catalog.set(key, row.catalogPresence);
      }
      if (source && seen.size !== catalog.size) errors.push(`product semantics covers ${seen.size}/${catalog.size} source products`);
    } else if (name === 'trainingSemantics') {
      const wrapper = z.object({ schemaVersion: z.literal('1'), sourceExtractionId: hash, legacySnapshotId: hash,
        snapshot: trainingSemanticSnapshotSchema }).strict().safeParse(artifact);
      if (!wrapper.success) fail('INVALID_PROJECTION_SCHEMA', wrapper.error.message);
      if (wrapper.data.sourceExtractionId !== manifest.source.sourceExtractionId) fail('SOURCE_LINEAGE_INVALID', 'training semantics');
      const s = wrapper.data.snapshot;
      try { validateTrainingSemanticSnapshot(s); } catch { fail('INVALID_PROJECTION_SCHEMA', 'training snapshot identity'); }
      if (s.snapshotId !== wrapper.data.legacySnapshotId || s.records.length !== entry.recordCount) fail('INVALID_PROJECTION_SCHEMA', 'training count/identity');
      const product = manifest.projections.productSemantics;
      if (product.status !== 'present') fail('SOURCE_LINEAGE_INVALID', 'training requires product semantics');
      const productArtifact = JSON.parse(files[product.artifact]!) as { legacySnapshotId: string };
      if (s.sourceProductSemanticSnapshotId !== productArtifact.legacySnapshotId) fail('SOURCE_LINEAGE_INVALID', 'training/product snapshot link');
      const seen = new Set<string>();
      for (const row of s.records) {
        const key = `P${row.productId}`;
        if ((catalog.size > 0 && !catalog.has(key)) || seen.has(key)) errors.push(`training product: ${key}`);
        seen.add(key);
      }
      if (catalog.size > 0 && seen.size !== catalog.size) errors.push(`training semantics covers ${seen.size}/${catalog.size} product semantics products`);
    } else if (name === 'trainingSemanticsV2') {
      const wrapper = trainingSemanticsV2ProjectionSchema.safeParse(artifact);
      if (!wrapper.success) fail('INVALID_PROJECTION_SCHEMA', wrapper.error.message);
      const value = wrapper.data;
      if (value.sourceExtractionId !== manifest.source.sourceExtractionId || value.codeRef !== manifest.build.codeRef) fail('SOURCE_LINEAGE_INVALID', 'training V2 source/code');
      try { validateTrainingSemanticSnapshotV2(value.snapshot); } catch (error) { fail('INVALID_PROJECTION_SCHEMA', String(error)); }
      const v1 = manifest.projections.trainingSemantics;
      if (v1.status !== 'present') fail('SOURCE_LINEAGE_INVALID', 'training V2 requires native V1');
      const sourceV1 = JSON.parse(files[v1.artifact]!) as { snapshot: TrainingSemanticSnapshot };
      try { validateTrainingSemanticV2Source(value.snapshot, sourceV1.snapshot); } catch (error) { fail('SOURCE_LINEAGE_INVALID', String(error)); }
      if (value.snapshot.records.length !== entry.recordCount || entry.builderVersion !== value.snapshot.classifierVersion) fail('INVALID_PROJECTION_SCHEMA', 'training V2 count/classifier');
      const trust = manifest.projections.trustMaps;
      if (trust.status !== 'present') fail('SOURCE_LINEAGE_INVALID', 'training V2 requires trust maps');
      const maps = JSON.parse(files[trust.artifact]!) as { categoryHash: string; featureHash: string };
      if (value.inputs.categoryTrustMap !== maps.categoryHash || value.inputs.featureTrustMap !== maps.featureHash) fail('SOURCE_LINEAGE_INVALID', 'training V2 trust inputs');
      const ids = new Set(value.snapshot.records.map((row) => `P${row.productId}`));
      if (ids.size !== catalog.size || [...ids].some((id) => !catalog.has(id))) fail('SOURCE_LINEAGE_INVALID', 'training V2 product universe');
    } else if (name === 'trustMaps') {
      const trust = z.object({ schemaVersion: z.literal('1'), sourceExtractionId: hash, categoryHash: hash, featureHash: hash }).strict().safeParse(artifact);
      if (!trust.success) fail('INVALID_PROJECTION_SCHEMA', 'trust maps');
      if (trust.data.sourceExtractionId !== manifest.source.sourceExtractionId || entry.recordCount !== 2) fail('SOURCE_LINEAGE_INVALID', 'trust maps');
    } else fail('INVALID_PROJECTION_SCHEMA', `no adapter for ${name}`);
    if (entry.snapshotId !== semanticHash(artifact)) fail('INVALID_PROJECTION_SCHEMA', `${name} snapshot identity`);
    validators.push({ name, status: 'PASS', checked: entry.recordCount, warnings: projectionWarnings, errors: 0 });
  }
  if (source) for (const [name, rows] of Object.entries(source.orphanReferences)) if (rows.length) warnings.push(`${name}: ${rows.length} orphan references retained in source`);
  if (errors.length) fail('BUNDLE_VALIDATION_FAILED', errors.join('; '));
  return { projectionBundleId: manifest.projectionBundleId, status: 'PASS' as const, validators, warnings, errors };
}
