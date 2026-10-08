import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DiscoverBundleInput, DiscoverSourceInput, ProjectionStatus } from '../../../application/catalog/discover-v0/retrievalDocument.js';
import { bundleId, bundleManifestSchema, type SpecsArtifact } from '../../../domain/catalog/projection-bundle.js';
import type { CanonicalExtraction } from '../../../domain/catalog/projection-input/canonical.js';
import type { ProductSemanticSnapshotFact } from '../../../domain/product-semantic-snapshot/index.js';
import type { TrainingSemanticSnapshotV2Record } from '../../../domain/training-semantic-snapshot/v2-contracts.js';

/*
 * Read-only loaders for CAT-DISCOVER-V0. They only call readFile: no pointer,
 * snapshot, bundle or source byte is ever written. Every artifact is verified
 * against the hash its own manifest declares before it is used; a projection
 * whose bytes do not verify is loaded as INVALID (explicit degradation), and an
 * unverifiable SOURCE aborts (the universe itself would be unknown).
 */

export const PRODUCTION_BUNDLE_ID = 'sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8';
export const CANDIDATE_BUNDLE_ID = 'sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f';
export const FROZEN_SOURCE_EXTRACTION_ID = 'sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9';
export const FROZEN_SOURCE_AGGREGATE = 'sha256:2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26';


export function sha256Bytes(bytes: Buffer | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\ufeff/u, '');
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
  const [header, ...body] = rows.filter((cells) => cells.length > 1);
  return body.map((cells) => Object.fromEntries(header!.map((name, position) => [name, cells[position] ?? ''])));
}

export type LoadedSource = {
  input: DiscoverSourceInput;
  dir: string;
  observedAt: string;
  aggregateContentHash: string;
  fileHashes: Record<string, string>;
};

export async function loadFrozenSource(dir: string): Promise<LoadedSource> {
  const manifestBytes = await readFile(path.join(dir, 'projection_input_manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    sourceExtractionId: string; aggregateContentHash: string; source: { observedAt: string };
    artifacts: { canonicalInput: string; categoryTrustMap: string; featureTrustMap: string; compatibilityCsv: string };
  };
  const files = { canonicalInput: 'canonical_input.json', categoryTrustMap: 'category_trust_map.csv', featureTrustMap: 'feature_trust_map.csv' } as const;
  const bytes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(path.join(dir, file))]))) as Record<keyof typeof files, Buffer>;
  const fileHashes: Record<string, string> = { 'projection_input_manifest.json': sha256Bytes(manifestBytes) };
  for (const [key, file] of Object.entries(files)) {
    const actual = sha256Bytes(bytes[key as keyof typeof files]);
    fileHashes[file] = actual;
    if (actual !== manifest.artifacts[key as keyof typeof files]) throw new Error(`SOURCE_INTEGRITY: ${file} hash ${actual} != manifest ${manifest.artifacts[key as keyof typeof files]}`);
  }
  if (manifest.artifacts.canonicalInput !== manifest.sourceExtractionId) throw new Error('SOURCE_INTEGRITY: canonical input hash is not the sourceExtractionId');
  const extraction = JSON.parse(bytes.canonicalInput.toString('utf8')) as CanonicalExtraction;
  const categoryTrust = new Map(parseCsv(bytes.categoryTrustMap.toString('utf8')).map((row) => [Number(row.categoryId), row.trustClass!]));
  const featureTrust = new Map(parseCsv(bytes.featureTrustMap.toString('utf8')).map((row) => [Number(row.featureId), row.trustClass!]));
  return {
    input: { sourceExtractionId: manifest.sourceExtractionId, extraction, categoryTrust, featureTrust, sourceHashesVerified: true },
    dir,
    observedAt: manifest.source.observedAt,
    aggregateContentHash: manifest.aggregateContentHash,
    fileHashes,
  };
}

export type LoadedBundle = {
  input: DiscoverBundleInput;
  dir: string;
  manifestHash: string;
  fileHashes: Record<string, string>;
  verification: { schemaValid: boolean; bundleIdRecomputed: string | null; bundleIdMatches: boolean; expectedBundleIdMatches: boolean | null; sourceMatches: boolean; projectionHashes: Record<string, boolean> };
};

type ManifestProjection = { status: 'present'; snapshotId: string; contentHash: string; artifact: string } | { status: 'unavailable'; reason: string } | undefined;

async function readProjection(dir: string, entry: ManifestProjection, fileHashes: Record<string, string>, checks: Record<string, boolean>, name: string)
  : Promise<{ status: ProjectionStatus; snapshotId: string | null; json: unknown; reason?: string }> {
  if (!entry || entry.status !== 'present') return { status: 'UNAVAILABLE', snapshotId: null, json: null, reason: entry && 'reason' in entry ? entry.reason : 'absent from manifest' };
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(dir, entry.artifact));
  } catch {
    checks[name] = false;
    return { status: 'UNAVAILABLE', snapshotId: entry.snapshotId, json: null, reason: 'artifact file missing' };
  }
  const actual = sha256Bytes(bytes);
  fileHashes[entry.artifact] = actual;
  checks[name] = actual === entry.contentHash;
  if (!checks[name]) return { status: 'INVALID', snapshotId: entry.snapshotId, json: null, reason: `contentHash mismatch ${actual}` };
  return { status: 'PRESENT', snapshotId: entry.snapshotId, json: JSON.parse(bytes.toString('utf8')) };
}

export async function loadFrozenBundle(dir: string, label: string, source: DiscoverSourceInput, expectedBundleId?: string): Promise<LoadedBundle> {
  const manifestBytes = await readFile(path.join(dir, 'manifest.json'));
  const raw = JSON.parse(manifestBytes.toString('utf8'));
  const parsed = bundleManifestSchema.safeParse(raw);
  const manifest = (parsed.success ? parsed.data : raw) as {
    projectionBundleId: string; source: { sourceExtractionId: string };
    projections: Record<string, ManifestProjection>;
  };
  const { projectionBundleId, ...identity } = raw as { projectionBundleId: string };
  const recomputed = parsed.success ? bundleId(identity as Parameters<typeof bundleId>[0]) : null;
  const fileHashes: Record<string, string> = { 'manifest.json': sha256Bytes(manifestBytes) };
  const checks: Record<string, boolean> = {};
  const product = await readProjection(dir, manifest.projections.productSemantics, fileHashes, checks, 'productSemantics');
  const training = await readProjection(dir, manifest.projections.trainingSemanticsV2, fileHashes, checks, 'trainingSemanticsV2');
  const specs = await readProjection(dir, manifest.projections.specs, fileHashes, checks, 'specs');
  const relationships = manifest.projections.relationships;
  const sourceMatches = manifest.source.sourceExtractionId === source.sourceExtractionId;
  const bundleIdMatches = recomputed !== null && recomputed === projectionBundleId;
  const expectedBundleIdMatches = expectedBundleId === undefined ? null : expectedBundleId === projectionBundleId;
  const trainingJson = training.json as { snapshot: { snapshotId: string; records: TrainingSemanticSnapshotV2Record[] } } | null;
  const input: DiscoverBundleInput = {
    label,
    bundleId: projectionBundleId,
    manifestSourceExtractionId: manifest.source.sourceExtractionId,
    lineageVerified: parsed.success && bundleIdMatches && expectedBundleIdMatches !== false && sourceMatches && Object.values(checks).every(Boolean),
    productSemantics: { status: product.status, snapshotId: product.snapshotId,
      records: (product.json as { snapshot: { records: ProductSemanticSnapshotFact[] } } | null)?.snapshot.records ?? null, ...(product.reason ? { reason: product.reason } : {}) },
    trainingV2: { status: training.status, snapshotId: trainingJson?.snapshot.snapshotId ?? null, projectionId: training.snapshotId,
      records: trainingJson?.snapshot.records ?? null, ...(training.reason ? { reason: training.reason } : {}) },
    specs: { status: specs.status, snapshotId: specs.snapshotId, records: (specs.json as SpecsArtifact | null)?.records ?? null, ...(specs.reason ? { reason: specs.reason } : {}) },
    relationships: relationships?.status === 'present' ? { status: 'PRESENT' } : { status: 'UNAVAILABLE', reason: relationships && 'reason' in relationships ? relationships.reason : 'absent' },
  };
  return {
    input,
    dir,
    manifestHash: fileHashes['manifest.json']!,
    fileHashes,
    verification: { schemaValid: parsed.success, bundleIdRecomputed: recomputed, bundleIdMatches, expectedBundleIdMatches, sourceMatches, projectionHashes: checks },
  };
}
