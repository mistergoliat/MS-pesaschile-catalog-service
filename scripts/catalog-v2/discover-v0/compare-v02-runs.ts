import { readFile, writeFile } from 'node:fs/promises';

/*
 * CAT-DISCOVER-V0.2 — reproducibility check between two benchmark-v02 runs on
 * identical inputs. Only wall-time fields/columns and the run directory/generation
 * timestamp are ignored; everything else must be byte-identical. Read-only on
 * both runs; writes one create-only report.
 *
 *   npx tsx scripts/catalog-v2/discover-v0/compare-v02-runs.ts --left=<dir> --right=<dir> --out=<file.json>
 */

const TIMING_COLUMN = /^latency/u;

function strip(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item, keys));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)).map(([key, inner]) => [key, strip(inner, keys)]));
  return value;
}

function csvWithoutTiming(text: string): string {
  const rows = text.trim().split('\r\n').map((row) => row.slice(1, -1).split('","'));
  const keep = rows[0]!.map((name, position) => [name, position] as const).filter(([name]) => !TIMING_COLUMN.test(name)).map(([, position]) => position);
  return rows.map((cells) => keep.map((position) => cells[position]).join('\u0001')).join('\n');
}

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
  const { left, right, out } = options;
  if (!left || !right || !out) throw new Error('INVALID_ARGUMENT: --left, --right and --out are required');
  const read = (dir: string, file: string) => readFile(`${dir}/${file}`, 'utf8');
  const checks: Record<string, boolean> = {};
  for (const file of ['results_v02.json', 'input_authority.json', 'agent_response_sizes.json', 'hydration_bound_audit.json']) {
    checks[file] = (await read(left, file)) === (await read(right, file));
  }
  checks['implementation_summary.json (generatedAt, runDir removed)'] = JSON.stringify(strip(JSON.parse(await read(left, 'implementation_summary.json')), new Set(['generatedAt', 'runDir'])))
    === JSON.stringify(strip(JSON.parse(await read(right, 'implementation_summary.json')), new Set(['generatedAt', 'runDir'])));
  for (const file of ['query_interpretation_diff.csv', 'constraint_assessment_diff.csv', 'spec_quantity_scope_cases.csv', 'candidate_disposition_diff.csv', 'priority_queries.md']) {
    checks[file] = (await read(left, file)) === (await read(right, file));
  }
  for (const file of ['abcd_comparison.csv', 'v0_v02_regression.csv']) checks[`${file} (latency columns removed)`] = csvWithoutTiming(await read(left, file)) === csvWithoutTiming(await read(right, file));
  const report = { left, right, reproduced: Object.values(checks).every(Boolean), checks,
    ignored: { jsonKeys: ['implementation_summary.generatedAt', 'implementation_summary.runDir'], csvColumns: 'latency*', files: ['latency_metrics.json', 'evidence_checksums_benchmark.json'] } };
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
