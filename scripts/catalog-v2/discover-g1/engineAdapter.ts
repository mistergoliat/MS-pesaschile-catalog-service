import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, rm, rmdir, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { percentile } from '../../../src/application/catalog/discover-v0/evaluation.js';
import { sha256 } from './goldContract.js';
import type { Disposition, EngineConstraint, NormalizedRun } from './goldMetrics.js';

/*
 * CAT-DISCOVER-G1 engine adapter. Normalizes the VariantRun of any frozen Discover
 * version (V0 at 6469eca: candidates/unverifiedCandidates/eligibility; V0.2:
 * verified/possible/disposition) into NormalizedRun, so one harness compares them.
 * It reads results only; it never changes an engine.
 */

const V0_STATE: Record<string, Disposition> = { ELIGIBLE: 'VERIFIED_MATCH', UNVERIFIED: 'POSSIBLE_MATCH', EXCLUDED: 'REJECTED' };

export function normalizeRun(engine: string, queryId: string, run: any, warm: number[]): NormalizedRun {
  const discover = run.discover;
  const response = discover?.response;
  const exact: string[] = run.exact ?? [];
  const presented = [...new Set([...exact, ...run.primary, ...run.unverified])];
  let dispositions: Record<string, Disposition> | null = null;
  if (discover && run.variant !== 'B') {
    dispositions = {};
    for (const item of discover.diagnostics.pool ?? []) dispositions[item.productKey] = item.disposition ?? V0_STATE[item.eligibility] ?? 'POSSIBLE_MATCH';
    // V0.2 lists every technically VERIFIED/POSSIBLE key; V0 only the top-50 pool. Anything else is NOT_IN_EVALUATED_POOL.
    for (const key of discover.diagnostics.verifiedKeys ?? []) dispositions[key] = 'VERIFIED_MATCH';
    for (const key of discover.diagnostics.possibleKeys ?? []) dispositions[key] ??= 'POSSIBLE_MATCH';
    for (const item of discover.diagnostics.rejected ?? discover.diagnostics.excluded ?? []) dispositions[item.productKey] = 'REJECTED';
    for (const item of response.exactResolution?.entities ?? []) dispositions[item.productKey] ??= item.disposition;
  }
  const interpretation = response?.interpretation;
  const completeness = response?.completeness ?? {};
  const agentWarnings: string[] = discover?.agent?.completeness?.warnings ?? [];
  return {
    engine, variant: run.variant, queryId,
    ranked: run.retrieval, presented, verified: run.primary, possible: run.unverified, dispositions,
    interpretation: interpretation ? {
      hardConstraints: (interpretation.hardConstraints as EngineConstraint[]).map((item) => ({ kind: item.kind, codes: item.codes, specKey: item.specKey, operator: item.operator, value: item.value, groupId: item.groupId })),
      ambiguityGroups: interpretation.ambiguityGroups?.length ?? 0,
      exactResolved: (response.exactResolution?.status ?? (discover.diagnostics.nominalLookup ? 'RESOLVED' : 'NONE')) === 'RESOLVED',
    } : null,
    noResultReason: completeness.noResultReason ?? (run.variant === 'A' && run.primary.length === 0 ? 'NO_NOMINAL_MATCH' : null),
    warnings: [...new Set([...agentWarnings, ...(completeness.warnings ?? [])])],
    operation: {
      firstMs: run.timings?.total ?? 0, warmMedianMs: percentile(warm, 50), bytes: run.bytes, agentBytes: run.agentBytes ?? null,
      lexicalTruncated: discover ? Boolean(discover.diagnostics.lexical?.truncated) : null,
      degraded: completeness.degraded ?? [],
      hydrationBounded: discover ? agentWarnings.includes('COMMERCIAL_HYDRATION_BOUNDED') : null,
      hydrationRequested: discover?.diagnostics.hydration?.requested?.length ?? null,
      technicallyConforming: discover?.diagnostics.hydration?.technicallyConforming ?? null,
    },
  };
}

/**
 * Isolated engine tree: git archive <commit> + optional byte overlay of frozen code;
 * node_modules and artifacts/ are junctions to this repository. Same construction as
 * replay-v02.ts. cleanup() removes the junctions (link only) before deleting the tree.
 */
export async function buildEngineTree(repo: string, commit: string, overlayDir: string | null): Promise<{ tree: string; cleanup: () => Promise<void> }> {
  const tree = await mkdtemp(path.join(os.tmpdir(), 'discover-engine-'));
  const tar = `${path.basename(tree)}.tar`;
  execFileSync('git', ['archive', '--format=tar', '-o', path.join(path.dirname(tree), tar), commit], { cwd: repo });
  execFileSync('tar', ['-xf', tar, '-C', path.basename(tree)], { cwd: path.dirname(tree) });
  await rm(path.join(path.dirname(tree), tar), { force: true });
  if (overlayDir) await cp(overlayDir, tree, { recursive: true, force: true });
  const links = ['node_modules', 'artifacts'].map((name) => path.join(tree, name));
  await symlink(path.join(repo, 'node_modules'), links[0]!, 'junction');
  await symlink(path.join(repo, 'artifacts'), links[1]!, 'junction');
  return {
    tree,
    cleanup: async () => {
      for (const link of links) await unlink(link).catch(() => rmdir(link)).catch(() => undefined);
      const remaining = (await Promise.all(links.map((link) => lstat(link).then(() => link, () => null)))).filter(Boolean);
      if (remaining.length === 0) await rm(tree, { recursive: true, force: true, maxRetries: 3 });
      else console.error(`TREE_KEPT: junctions still present in ${tree}`);
    },
  };
}

/** Runs every engine of the spec in its own isolated tree and process (gold-benchmark engine-worker mode). */
export async function runEngines(spec: string, queries: { queryId: string; query: string }[], workDir: string): Promise<Map<string, NormalizedRun[]>> {
  const repo = process.cwd();
  const queriesFile = path.join(workDir, `engine_queries_${sha256(JSON.stringify(queries)).slice(7, 19)}.json`);
  try { await stat(queriesFile); } catch { await writeFile(queriesFile, JSON.stringify(queries), { flag: 'wx' }); }
  const result = new Map<string, NormalizedRun[]>();
  for (const item of spec.split(',').filter(Boolean)) {
    const [label, target] = item.split('@') as [string, string];
    const [commit, overlay] = target.split('+') as [string, string | undefined];
    const { tree, cleanup } = await buildEngineTree(repo, commit, overlay ? path.resolve(overlay) : null);
    const out = path.resolve(workDir, `engine_runs_${label.replace(/[^\w.-]/gu, '_')}.json`);
    try {
      execFileSync(process.execPath, [path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(repo, 'scripts/catalog-v2/discover-g1/gold-benchmark.ts'),
        '--mode=engine-worker', `--engine-root=${tree}`, `--engine=${label}`, `--queries-file=${path.resolve(queriesFile)}`, `--out=${out}`], { cwd: tree, stdio: ['ignore', 'inherit', 'inherit'] });
    } finally { await cleanup(); }
    result.set(label, JSON.parse(await readFile(out, 'utf8')) as NormalizedRun[]);
  }
  return result;
}
