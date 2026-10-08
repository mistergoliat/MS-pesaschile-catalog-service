import { readFile, writeFile } from 'node:fs/promises';

/*
 * CAT-DISCOVER-V0.2 — checks that a replay of the V0 benchmark (code at commit
 * 6469eca) reproduces the frozen V0 run byte-for-byte except for wall-time and
 * generation timestamps. Read-only on both runs; writes one create-only report.
 *
 *   npx tsx scripts/catalog-v2/discover-v0/compare-v0-replay.ts --frozen=<dir> --replay=<dir> --out=<file.json>
 */

const TIMING_KEYS = new Set(['firstRunMs', 'warmTimingsMs', 'generatedAt', 'timingsMs']);
const TIMING_COLUMNS = new Set(['firstRunMs', 'warmMedianMs']);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !TIMING_KEYS.has(key)).map(([key, inner]) => [key, strip(inner)]));
  return value;
}

function csvWithoutTiming(text: string): string {
  const rows = text.trim().split('\r\n').map((row) => row.slice(1, -1).split('","'));
  const keep = rows[0]!.map((name, position) => [name, position] as const).filter(([name]) => !TIMING_COLUMNS.has(name)).map(([, position]) => position);
  return rows.map((cells) => keep.map((position) => cells[position]).join('\u0001')).join('\n');
}

type Lineage = { lexiconSha256: string; source: unknown; bundles: Record<string, { bundleId: string; manifestHash: string; fileHashes: unknown; indexFingerprint: string; lexicalFingerprint: string; universe: number }> };
const identity = (lineage: Lineage) => JSON.stringify([lineage.lexiconSha256, lineage.source, Object.entries(lineage.bundles)
  .map(([key, bundle]) => [key, bundle.bundleId, bundle.manifestHash, bundle.fileHashes, bundle.indexFingerprint, bundle.lexicalFingerprint, bundle.universe])]);

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
  const { frozen, replay, out } = options;
  if (!frozen || !replay || !out) throw new Error('INVALID_ARGUMENT: --frozen, --replay and --out are required');
  const read = (dir: string, file: string) => readFile(`${dir}/${file}`, 'utf8');
  const checks: Record<string, boolean> = {};
  for (const file of ['results_baseline.json', 'results_lexical.json', 'results_hybrid_old.json', 'results_hybrid_fix2.json', 'benchmark_gold_status.json',
    'interpretation_consistency.json', 'constraint_violations.json', 'benchmark_queries.json', 'summary.json']) {
    const [left, right] = [strip(JSON.parse(await read(frozen, file))), strip(JSON.parse(await read(replay, file)))] as Record<string, unknown>[];
    if (file === 'summary.json') { delete left!.runId; delete right!.runId; }
    checks[file] = JSON.stringify(left) === JSON.stringify(right);
  }
  for (const file of ['pairwise_comparison.csv', 'representative_comparisons.md']) checks[file] = (await read(frozen, file)) === (await read(replay, file));
  checks['query_diagnostics.csv (timing columns removed)'] = csvWithoutTiming(await read(frozen, 'query_diagnostics.csv')) === csvWithoutTiming(await read(replay, 'query_diagnostics.csv'));
  const [frozenLineage, replayLineage] = [JSON.parse(await read(frozen, 'lineage.json')) as Lineage, JSON.parse(await read(replay, 'lineage.json')) as Lineage];
  checks['lineage.json (identity fields)'] = identity(frozenLineage) === identity(replayLineage);
  const report = {
    frozen, replay, reproduced: Object.values(checks).every(Boolean), checks,
    ignored: { jsonKeys: [...TIMING_KEYS], csvColumns: [...TIMING_COLUMNS], other: ['summary.runId', 'lineage.json non-identity fields (runId, generatedAt, node, buildMs, protectedInputs)', 'latency_metrics.json', 'evidence_checksums.json'] },
    indexFingerprints: { frozen: Object.fromEntries(Object.entries(frozenLineage.bundles).map(([key, bundle]) => [key, bundle.indexFingerprint])),
      replay: Object.fromEntries(Object.entries(replayLineage.bundles).map(([key, bundle]) => [key, bundle.indexFingerprint])) },
  };
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
