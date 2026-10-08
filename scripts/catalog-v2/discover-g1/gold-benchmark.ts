import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { percentile } from '../../../src/application/catalog/discover-v0/evaluation.js';
import { FROZEN_SOURCE_EXTRACTION_ID } from '../../../src/infrastructure/catalog/discover-v0/frozenInputLoader.js';
import { evaluationReadiness, sha256, type GoldLabels, type GoldQuery, type HeldoutQueries } from './goldContract.js';
import { normalizeRun, runEngines } from './engineAdapter.js';
import { estimability, interpretationMetrics, meanWithInterval, retrievalMetrics, verificationMetrics, type NormalizedRun } from './goldMetrics.js';

/*
 * CAT-DISCOVER-G1 independent benchmark harness.
 *
 *  --mode=readiness  [--heldout=<file>] [--labels=<file>] --out=<json>
 *      Checks whether an OFFICIAL evaluation may run. Missing or invalid inputs are
 *      reported as blocking; nothing is defaulted, nothing is generated.
 *  --mode=smoke      --engines=<spec> --dev-queries=<n> --out=<json>
 *      Plumbing check ONLY on the first n DEVELOPMENT queries: every engine tree builds,
 *      every variant runs and normalizes. No relevance metric is computed.
 *  --mode=run        --heldout=<file> --labels=<file> --engines=<spec> --out-dir=<dir>
 *      Refuses unless readiness passes. Runs A/B/C/D for each engine and writes metrics.
 *  --mode=compare    --runs=<gold_results_*.json,...> --out=<json>
 *
 * Engine spec: "LABEL@commit[+overlayDir]" comma-separated, e.g.
 *   V0@6469eca2009a0cbdd897d43deadb1a7ff0d10c2c,V0.2@6469eca2009a0cbdd897d43deadb1a7ff0d10c2c+artifacts/.../v02-code
 * Each engine runs in its own isolated tree and process (engine-worker mode).
 */

const DEVELOPMENT_SET = 'scripts/catalog-v2/discover-v0/benchmark/benchmark_queries.v1.json';
const VARIANTS = ['A', 'B', 'C', 'D'] as const;
const WARM = 5;

type Options = Record<string, string>;
const parseOptions = (): Options => Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z0-9-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
const createOnly = async (file: string, content: string) => {
  try { await stat(file); throw new Error(`OUTPUT_EXISTS: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeFile(file, content, { flag: 'wx' });
};
const readJson = async <T>(file: string | undefined): Promise<{ value: T; sha: string } | null> => {
  if (!file) return null;
  const bytes = await readFile(file);
  return { value: JSON.parse(bytes.toString('utf8')) as T, sha: sha256(bytes) };
};

// ---- engine worker (runs with cwd = engine tree) ----------------------------------------------
async function engineWorker(options: Options): Promise<void> {
  const root = options['engine-root']!;
  const workspaceModule = await import(pathToFileURL(path.join(root, 'scripts/catalog-v2/discover-v0/workspace.ts')).href) as {
    loadWorkspace: () => Promise<unknown>; runVariant: (workspace: unknown, variant: string, query: string) => Promise<{ timings: { total?: number } }>;
  };
  const queries = JSON.parse(await readFile(options['queries-file']!, 'utf8')) as { queryId: string; query: string }[];
  const workspace = await workspaceModule.loadWorkspace();
  const runs: NormalizedRun[] = [];
  for (const query of queries) {
    for (const variant of VARIANTS) {
      const first = await workspaceModule.runVariant(workspace, variant, query.query);
      const warm: number[] = [];
      for (let repetition = 0; repetition < WARM; repetition += 1) warm.push((await workspaceModule.runVariant(workspace, variant, query.query)).timings.total ?? 0);
      runs.push(normalizeRun(options.engine!, query.queryId, first, warm));
    }
  }
  await createOnly(options.out!, `${JSON.stringify(runs)}\n`);
}

// ---- metrics --------------------------------------------------------------------------------------
function summarize(runs: NormalizedRun[], gold: Map<string, GoldQuery>) {
  const scored = runs.filter((run) => gold.has(run.queryId)).map((run) => {
    const query = gold.get(run.queryId)!;
    return { run, query, retrieval: retrievalMetrics(run.ranked, query), presented: retrievalMetrics(run.presented, query), verification: verificationMetrics(run, query), interpretation: interpretationMetrics(run, query) };
  });
  const block = (items: typeof scored) => {
    const pick = (selector: (item: typeof scored[number]) => number | null) => meanWithInterval(items.map(selector));
    const verification = items.map((item) => item.verification).filter((item): item is NonNullable<typeof item> => item !== null);
    const interpretation = items.map((item) => item.interpretation).filter((item): item is NonNullable<typeof item> => item !== null);
    const sum = (key: keyof NonNullable<ReturnType<typeof verificationMetrics>>) => verification.reduce((total, item) => total + Number(item[key] as number), 0);
    const ops = items.map((item) => item.run.operation);
    const stats = (values: number[]) => ({ p50: percentile(values, 50), p95: percentile(values, 95), max: values.length ? Math.max(...values) : null });
    return {
      queries: items.length, estimability: estimability(items.length),
      retrieval: { recallAt8: pick((item) => item.retrieval.recallAt8), precisionAt3: pick((item) => item.retrieval.precisionAt3), precisionAt3Lenient: pick((item) => item.retrieval.precisionAt3Lenient),
        mrr: pick((item) => item.retrieval.mrr), ndcgAt8: pick((item) => item.retrieval.ndcgAt8), judgedCoverageAt8: pick((item) => item.retrieval.judgedCoverageAt8),
        missedRelevantTotal: items.reduce((total, item) => total + item.retrieval.missedRelevant.length, 0), presentedRecallAt8: pick((item) => item.presented.recallAt8) },
      verification: verification.length === 0 ? 'NOT_APPLICABLE (engine does not verify)' : {
        correctlyVerified: sum('correctlyVerified'), incorrectlyVerified: sum('incorrectlyVerified'), verifiedUnjudged: sum('verifiedUnjudged'),
        constraintsCorrectlySatisfied: sum('constraintsCorrectlySatisfied'), constraintsIncorrectlySatisfied: sum('constraintsIncorrectlySatisfied'),
        falseExclusionsLowerBound: sum('falseExclusions'), possibleRelevant: sum('possibleRelevant'), relevantNotInEvaluatedPool: sum('relevantNotInEvaluatedPool'),
        justifiedAbstentions: verification.filter((item) => item.abstention === 'JUSTIFIED_ABSTENTION').length, unjustifiedAbstentions: verification.filter((item) => item.abstention === 'UNJUSTIFIED_ABSTENTION').length,
        overclaims: items.flatMap((item) => (item.verification?.overclaims ?? []).map((key) => `${item.run.queryId}:${key}`)) },
      interpretation: interpretation.length === 0 ? 'NOT_APPLICABLE' : {
        intentAccuracy: meanWithInterval(interpretation.map((item) => (item.intentCorrect ? 1 : 0))),
        ambiguity: { truePositive: interpretation.filter((item) => item.ambiguityGold && item.ambiguityEngine).length, missed: interpretation.filter((item) => item.ambiguityGold && !item.ambiguityEngine).length,
          spurious: interpretation.filter((item) => !item.ambiguityGold && item.ambiguityEngine).length },
        queriesWithMissingConstraint: interpretation.filter((item) => item.missingConstraints.length > 0).length, queriesWithSpuriousConstraint: interpretation.filter((item) => item.spuriousConstraints.length > 0).length,
        clarification: { neededAndSignalled: interpretation.filter((item) => item.clarification.goldExpects && item.clarification.engineSignals).length,
          neededNotSignalled: interpretation.filter((item) => item.clarification.goldExpects && !item.clarification.engineSignals).length,
          signalledNotNeeded: interpretation.filter((item) => !item.clarification.goldExpects && item.clarification.engineSignals).length } },
      operation: { firstMs: stats(ops.map((op) => op.firstMs)), warmMedianMs: stats(ops.map((op) => op.warmMedianMs ?? 0)), bytes: stats(ops.map((op) => op.bytes)),
        agentBytes: stats(ops.map((op) => op.agentBytes).filter((value): value is number => value !== null)),
        lexicalTruncated: ops.filter((op) => op.lexicalTruncated).length, degraded: ops.filter((op) => op.degraded.length > 0).length,
        hydrationBounded: ops.filter((op) => op.hydrationBounded).length },
    };
  };
  const classes = [...new Set(scored.map((item) => item.query.queryClass))].sort();
  return { overall: block(scored), byClass: Object.fromEntries(classes.map((queryClass) => [queryClass, block(scored.filter((item) => item.query.queryClass === queryClass))])),
    perQuery: scored.map((item) => ({ queryId: item.run.queryId, retrieval: item.retrieval, verification: item.verification, interpretation: item.interpretation })) };
}

async function main(): Promise<void> {
  const options = parseOptions();
  const mode = options.mode;
  if (mode === 'engine-worker') return engineWorker(options);
  const developmentQueries = (JSON.parse(await readFile(DEVELOPMENT_SET, 'utf8')) as { queries: { queryId: string; query: string }[] }).queries;

  if (mode === 'readiness' || mode === 'run') {
    const heldout = await readJson<HeldoutQueries>(options.heldout);
    const labels = await readJson<GoldLabels>(options.labels);
    const readiness = evaluationReadiness({ heldout: heldout?.value ?? null, heldoutSha256: heldout?.sha ?? null, labels: labels?.value ?? null,
      developmentQueries: developmentQueries.map((query) => query.query), sourceExtractionId: FROZEN_SOURCE_EXTRACTION_ID });
    const report = { checkedAt: new Date().toISOString(), heldout: options.heldout ?? null, heldoutSha256: heldout?.sha ?? null, labels: options.labels ?? null, labelsSha256: labels?.sha ?? null, ...readiness };
    if (mode === 'readiness') {
      if (options.out) await createOnly(options.out, `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (!readiness.ready) throw new Error(`EVALUATION_REFUSED: ${readiness.blocking.join(', ')} — no quality metric is computed on incomplete labels`);
    const outDir = options['out-dir'];
    if (!outDir || !options.engines) throw new Error('INVALID_ARGUMENT: --out-dir and --engines are required');
    const gold = new Map(labels!.value.queries.map((query) => [query.queryId, query]));
    const engines = await runEngines(options.engines, heldout!.value.queries.map((query) => ({ queryId: query.queryId, query: query.query })), outDir);
    for (const [engine, runs] of engines) {
      const byVariant = Object.fromEntries(VARIANTS.map((variant) => [variant, summarize(runs.filter((run) => run.variant === variant), gold)]));
      await createOnly(path.join(outDir, `gold_results_${engine.replace(/[^\w.-]/gu, '_')}.json`), `${JSON.stringify({ engine, readiness: report, heldoutSha256: heldout!.sha, labelsSha256: labels!.sha,
        caveat: 'First independent evaluation on 80-100 queries. Not a statistical certification per class; classes with n<20 are descriptive only. Recall is relative to the pooled+independently-searched judged set, not to an exhaustive relevant set.',
        byVariant }, null, 2)}\n`);
    }
    return;
  }

  if (mode === 'smoke') {
    if (!options.engines || !options.out) throw new Error('INVALID_ARGUMENT: --engines and --out are required');
    const n = Number(options['dev-queries'] ?? '6');
    const sample = developmentQueries.slice(0, n).map((query) => ({ queryId: query.queryId, query: query.query }));
    const workDir = path.dirname(options.out);
    const engines = await runEngines(options.engines, sample, workDir);
    // Reference lists: the official V0.2 run (r2) and the frozen V0 run must be reproduced by the adapter.
    const reference: Record<string, Map<string, { ranked: string[]; verified: string[]; possible: string[] }>> = {};
    if (options['reference-v02']) {
      const rows = JSON.parse(await readFile(options['reference-v02'], 'utf8')) as { queryId: string; variants: Record<string, { retrieval: string[]; primary: string[]; possible: string[] }> }[];
      reference['V0.2'] = new Map(rows.flatMap((row) => VARIANTS.map((variant) => [`${row.queryId}/${variant}`, { ranked: row.variants[variant]!.retrieval, verified: row.variants[variant]!.primary, possible: row.variants[variant]!.possible }] as const)));
    }
    if (options['reference-v0']) {
      const files = { A: 'results_baseline.json', B: 'results_lexical.json', C: 'results_hybrid_old.json', D: 'results_hybrid_fix2.json' } as const;
      const map = new Map<string, { ranked: string[]; verified: string[]; possible: string[] }>();
      for (const variant of VARIANTS) {
        for (const row of (JSON.parse(await readFile(path.join(options['reference-v0'], files[variant]), 'utf8')) as { results: { queryId: string; retrieval: string[]; primary: string[]; unverified: string[] }[] }).results) {
          map.set(`${row.queryId}/${variant}`, { ranked: row.retrieval, verified: row.primary, possible: row.unverified });
        }
      }
      reference.V0 = map;
    }
    const checks: Record<string, unknown> = {};
    for (const [engine, runs] of engines) {
      const ref = reference[engine];
      const mismatches = ref ? runs.filter((run) => { const expected = ref.get(`${run.queryId}/${run.variant}`); return !expected || expected.ranked.join() !== run.ranked.join()
        || expected.verified.join() !== run.verified.join() || expected.possible.join() !== run.possible.join(); }).map((run) => `${run.queryId}/${run.variant}`) : null;
      checks[engine] = {
        runs: runs.length, expected: sample.length * VARIANTS.length,
        everyVariantRan: VARIANTS.every((variant) => runs.filter((run) => run.variant === variant).length === sample.length),
        rankedAtMost8: runs.every((run) => run.ranked.length <= 8),
        dispositionsForVerifyingVariants: runs.filter((run) => run.variant === 'C' || run.variant === 'D').every((run) => run.dispositions !== null && Object.keys(run.dispositions).length > 0 || run.ranked.length === 0),
        interpretationPresentBCD: runs.filter((run) => run.variant !== 'A').every((run) => run.interpretation !== null),
        operationFieldsPresent: runs.every((run) => typeof run.operation.firstMs === 'number' && typeof run.operation.bytes === 'number'),
        agentBytesAvailable: runs.some((run) => run.operation.agentBytes !== null),
        reproducesReferenceRun: mismatches === null ? 'NO_REFERENCE_GIVEN' : mismatches.length === 0,
        referenceMismatches: mismatches ?? [],
      };
    }
    const report = { mode: 'smoke', purpose: 'PLUMBING ONLY on development queries (never a quality measurement; no relevance metric computed)', engines: options.engines, devQueries: sample.map((query) => query.queryId), checks,
      passed: Object.values(checks).every((check) => Object.entries(check as Record<string, unknown>).filter(([key]) => !['runs', 'expected', 'agentBytesAvailable', 'referenceMismatches'].includes(key)).every(([, value]) => value === true || value === 'NO_REFERENCE_GIVEN')) };
    await createOnly(options.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (mode === 'compare') {
    const runs = await Promise.all((options.runs ?? '').split(',').filter(Boolean).map(async (file) => JSON.parse(await readFile(file, 'utf8')) as { engine: string; labelsSha256: string; byVariant: Record<string, ReturnType<typeof summarize>> }));
    if (new Set(runs.map((run) => run.labelsSha256)).size !== 1) throw new Error('COMPARE_REFUSED: runs were scored against different label files');
    const table = runs.flatMap((run) => VARIANTS.map((variant) => ({ engine: run.engine, variant, ...run.byVariant[variant]!.overall.retrieval })));
    // Paired per-query differences (right − left) with a bootstrap interval: engines on the same variant, and C vs D within an engine.
    type PerQuery = ReturnType<typeof summarize>['perQuery'][number];
    const paired = (left: PerQuery[], right: PerQuery[]) => {
      const byId = new Map(right.map((item) => [item.queryId, item]));
      const diff = (metric: 'recallAt8' | 'ndcgAt8' | 'mrr' | 'precisionAt3') => meanWithInterval(left.filter((item) => byId.has(item.queryId)).map((item) => {
        const a = item.retrieval[metric];
        const b = byId.get(item.queryId)!.retrieval[metric];
        return a === null || b === null ? null : b - a;
      }));
      return { recallAt8: diff('recallAt8'), ndcgAt8: diff('ndcgAt8'), mrr: diff('mrr'), precisionAt3: diff('precisionAt3') };
    };
    const pairs: Record<string, unknown> = {};
    for (const [leftIndex, left] of runs.entries()) {
      for (const right of runs.slice(leftIndex + 1)) for (const variant of VARIANTS) pairs[`${right.engine}−${left.engine}/${variant}`] = paired(left.byVariant[variant]!.perQuery, right.byVariant[variant]!.perQuery);
      pairs[`${left.engine}/D−C`] = paired(left.byVariant.C!.perQuery, left.byVariant.D!.perQuery);
    }
    await createOnly(options.out!, `${JSON.stringify({ comparedAt: new Date().toISOString(), labelsSha256: runs[0]!.labelsSha256, table, pairedDifferences: pairs,
      reading: 'An interval that contains 0 is not evidence of a difference. No winner is declared on point estimates.' }, null, 2)}\n`);
    return;
  }
  throw new Error(`INVALID_ARGUMENT: --mode=${mode ?? ''}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
