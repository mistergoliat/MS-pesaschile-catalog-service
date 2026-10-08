import { discoverV0, type DiscoverV0Result } from '../../../src/application/catalog/discover-v0/discoverV0.js';
import type { DiscoverStageTimings } from '../../../src/application/catalog/discover-v0/contracts.js';
import { ProductRetrievalDocumentBuilder, type DiscoverIndex } from '../../../src/application/catalog/discover-v0/retrievalDocument.js';
import {
  CANDIDATE_BUNDLE_ID,
  FROZEN_SOURCE_AGGREGATE,
  FROZEN_SOURCE_EXTRACTION_ID,
  loadFrozenBundle,
  loadFrozenSource,
  PRODUCTION_BUNDLE_ID,
  type LoadedBundle,
  type LoadedSource,
} from '../../../src/infrastructure/catalog/discover-v0/frozenInputLoader.js';
import type { CurrentSearchBaseline, CurrentSearchOutcome } from '../../../src/application/catalog/discover-v0/currentSearchBaseline.js';

/*
 * Offline workspace for CAT-DISCOVER-V0: one frozen source, two bundles, four
 * variants. Read-only: inputs are verified by hash and never written.
 */

export const DISCOVER_V0_PATHS = {
  source: process.env.DISCOVER_V0_SOURCE_DIR ?? 'artifacts/catalog-v2/p2-3c-lr/frozen-source',
  production: process.env.DISCOVER_V0_PRODUCTION_BUNDLE_DIR
    ?? 'C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/production-baseline/84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8',
  candidate: process.env.DISCOVER_V0_CANDIDATE_BUNDLE_DIR
    ?? 'artifacts/catalog-v2/p2-3c-prb/candidate-1/bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f',
};

export const VARIANTS = ['A', 'B', 'C', 'D'] as const;
export type Variant = typeof VARIANTS[number];
export const VARIANT_NAMES: Record<Variant, string> = { A: 'CURRENT_SEARCH', B: 'LEXICAL_PLUS', C: 'HYBRID_OLD_BUNDLE', D: 'HYBRID_FIX2_BUNDLE' };
export const BENCHMARK_LIMIT = 8;

// The search service reads its config at import time; the offline baseline never opens a database.
export function setOfflineConfigPlaceholders(): void {
  for (const [name, value] of Object.entries({ DB_HOST: 'offline.invalid', DB_USER: 'offline', DB_PASSWORD: 'offline', DB_NAME: 'offline', CATALOG_API_KEYS: 'offline-discover-v0', LOG_LEVEL: 'silent' })) {
    process.env[name] ??= value;
  }
}

export type Workspace = {
  source: LoadedSource;
  production: LoadedBundle;
  candidate: LoadedBundle;
  indexes: { production: DiscoverIndex; candidate: DiscoverIndex };
  baseline: CurrentSearchBaseline;
  loadMs: { source: number; production: number; candidate: number; productionIndex: number; candidateIndex: number; baseline: number };
};

export async function loadWorkspace(paths = DISCOVER_V0_PATHS): Promise<Workspace> {
  setOfflineConfigPlaceholders();
  const timed = async <T>(run: () => Promise<T> | T): Promise<[T, number]> => {
    const started = performance.now();
    const value = await run();
    return [value, performance.now() - started];
  };
  const [source, sourceMs] = await timed(() => loadFrozenSource(paths.source));
  if (source.input.sourceExtractionId !== FROZEN_SOURCE_EXTRACTION_ID || source.aggregateContentHash !== FROZEN_SOURCE_AGGREGATE) {
    throw new Error(`SOURCE_IDENTITY: expected ${FROZEN_SOURCE_EXTRACTION_ID}/${FROZEN_SOURCE_AGGREGATE}`);
  }
  const [production, productionMs] = await timed(() => loadFrozenBundle(paths.production, 'production', source.input, PRODUCTION_BUNDLE_ID));
  const [candidate, candidateMs] = await timed(() => loadFrozenBundle(paths.candidate, 'candidate-fix2', source.input, CANDIDATE_BUNDLE_ID));
  for (const bundle of [production, candidate]) {
    if (!bundle.input.lineageVerified) throw new Error(`BUNDLE_LINEAGE: ${bundle.input.label} ${JSON.stringify(bundle.verification)}`);
  }
  const builder = new ProductRetrievalDocumentBuilder();
  const [productionIndex, productionIndexMs] = await timed(() => builder.build(source.input, production.input));
  const [candidateIndex, candidateIndexMs] = await timed(() => builder.build(source.input, candidate.input));
  const { CurrentSearchBaseline: Baseline } = await import('../../../src/application/catalog/discover-v0/currentSearchBaseline.js');
  const [baseline, baselineMs] = await timed(() => new Baseline(source.input.extraction, source.observedAt));
  return {
    source, production, candidate,
    indexes: { production: productionIndex, candidate: candidateIndex },
    baseline,
    loadMs: { source: sourceMs, production: productionMs, candidate: candidateMs, productionIndex: productionIndexMs, candidateIndex: candidateIndexMs, baseline: baselineMs },
  };
}

export type VariantRun = {
  variant: Variant;
  /** The list a consumer is shown: A results; B/C/D VERIFIED_MATCH candidates. */
  primary: string[];
  unverified: string[];
  /** EXACT_ENTITY_RESOLUTION (B/C/D): exact productKey/name lookups, whatever their disposition. */
  exact: string[];
  /** Top-8 comparable across variants: exact entities first, then the ranked pool with REJECTED removed. */
  retrieval: string[];
  search?: CurrentSearchOutcome;
  discover?: DiscoverV0Result;
  timings: DiscoverStageTimings;
  bytes: number;
  /** Serialized DiscoverAgentResponse (B/C/D only). */
  agentBytes?: number;
};

export async function runVariant(workspace: Workspace, variant: Variant, query: string): Promise<VariantRun> {
  if (variant === 'A') {
    const started = performance.now();
    const search = await workspace.baseline.search(query, BENCHMARK_LIMIT);
    const total = performance.now() - started;
    return { variant, primary: search.productKeys, unverified: [], exact: [], retrieval: search.productKeys, search, timings: { total },
      bytes: Buffer.byteLength(JSON.stringify(search.response ?? { status: search.status })) };
  }
  const index = variant === 'C' ? workspace.indexes.production : workspace.indexes.candidate;
  const discover = await discoverV0({ schemaVersion: 1, need: query, limit: BENCHMARK_LIMIT }, { index, mode: variant === 'B' ? 'LEXICAL_PLUS' : 'HYBRID' });
  const exact = discover.response.exactResolution.productKeys;
  return {
    variant,
    primary: discover.response.verified.map((candidate) => candidate.productKey),
    unverified: discover.response.possible.map((candidate) => candidate.productKey),
    exact,
    retrieval: [...exact, ...discover.diagnostics.pool.filter((item) => item.disposition !== 'REJECTED' && !exact.includes(item.productKey)).map((item) => item.productKey)]
      .slice(0, BENCHMARK_LIMIT),
    discover,
    timings: discover.timings,
    bytes: Buffer.byteLength(JSON.stringify(discover.response)),
    agentBytes: Buffer.byteLength(JSON.stringify(discover.agent)),
  };
}

export function nameOf(workspace: Workspace, productKey: string): string {
  return workspace.indexes.candidate.documents.get(productKey)?.name ?? '(unknown)';
}
