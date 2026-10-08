import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ConstraintVerifier } from '../../../src/application/catalog/discover-v0/constraintVerifier.js';
import type { ConstraintResult, DiscoverConstraint, DiscoverStageTimings } from '../../../src/application/catalog/discover-v0/contracts.js';
import { compareLists, ndcgAtK, percentile, precisionAtK, recallAtK, reciprocalRank } from '../../../src/application/catalog/discover-v0/evaluation.js';
import { DISCOVER_V0_LEXICON, DISCOVER_V0_LEXICON_VERSION } from '../../../src/application/catalog/discover-v0/lexicon.js';
import { CANDIDATE_BUNDLE_ID, PRODUCTION_BUNDLE_ID } from '../../../src/infrastructure/catalog/discover-v0/frozenInputLoader.js';
import { BENCHMARK_LIMIT, DISCOVER_V0_PATHS, loadWorkspace, nameOf, runVariant, VARIANT_NAMES, VARIANTS, type Variant, type VariantRun } from './workspace.js';

/*
 * CAT-DISCOVER-V0 controlled experiment: same universe, same frozen inputs, same
 * process, same queries, same limit and the same timing strategy for A/B/C/D.
 * Writes only to a NEW run directory (create-only). Inputs are fingerprinted
 * before and after; any change fails the run.
 */

const WARM_REPETITIONS = 5;
const OUT_ROOT = (process.env.DISCOVER_V0_OUT_ROOT ?? 'artifacts/catalog-v2/discover-v0').replaceAll('\\', '/');
const REPRESENTATIVE = ['Q001', 'Q021', 'Q031', 'Q037', 'Q042', 'Q047', 'Q051', 'Q052', 'Q058', 'Q059', 'Q063', 'Q064', 'Q076', 'Q081', 'Q083', 'Q088',
  'Q096', 'Q097', 'Q099', 'Q105', 'Q106', 'Q109', 'Q111', 'Q112', 'Q116'];

type BenchmarkQuery = {
  queryId: string; query: string; queryClass: string; expectedIntent: string; hardConstraints: string[]; softPreferences: string[];
  goldRelevantProductIds: string[]; goldSource: string | null; adjudicationStatus: string;
  fixture?: { kind: 'TOP1' | 'MUST_INCLUDE'; productKeys: string[]; measuredOnly?: boolean };
  adversarialFinding?: string; notEvaluableReason?: string; expectedOutcome?: string;
};
type BenchmarkFile = { benchmarkVersion: string; limit: number; queries: BenchmarkQuery[] };

const sha = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function walk(dir: string, skip: (file: string) => boolean): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name).replaceAll('\\', '/');
    if (skip(full)) return [];
    return entry.isDirectory() ? walk(full, skip) : entry.isFile() ? [full] : [];
  }));
  return files.flat();
}

async function fingerprintProtected(): Promise<Record<string, string>> {
  const skip = (file: string) => file.startsWith(OUT_ROOT);
  const roots = ['artifacts/catalog-v2', 'data', 'docs/catalog-v2', 'scripts/audits', DISCOVER_V0_PATHS.production, DISCOVER_V0_PATHS.source, DISCOVER_V0_PATHS.candidate];
  const files = [...new Set((await Promise.all(roots.map((root) => walk(root, skip)))).flat())].sort();
  const out: Record<string, string> = {};
  for (const file of files) out[file] = sha(await readFile(file));
  return out;
}

function csv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (value: unknown) => `"${String(value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : value).replaceAll('"', '""')}"`;
  return `${[columns.map(cell).join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\r\n')}\r\n`;
}

function constraintLabel(constraint: DiscoverConstraint): string {
  if (constraint.kind === 'SPEC') return `SPEC:${constraint.specKey} ${constraint.operator} ${constraint.value}`;
  if (constraint.kind === 'COMMERCIAL_MAX_PRICE') return `COMMERCIAL_MAX_PRICE LTE ${constraint.value}`;
  if (constraint.kind === 'COMPATIBILITY' || constraint.kind === 'COMMERCIAL_AVAILABILITY') return constraint.kind;
  return `${constraint.kind}:${(constraint.codes ?? []).join('|')}${constraint.subtypeText?.length ? '(subtype)' : ''}`;
}

function stripTimings(run: VariantRun): string {
  return JSON.stringify(run.discover?.response ?? run.search?.response ?? null);
}

type QueryRecord = {
  query: BenchmarkQuery;
  runs: Record<Variant, VariantRun>;
  deterministic: Record<Variant, boolean>;
  warm: Record<Variant, DiscoverStageTimings[]>;
  postHoc: Record<Variant, { productKey: string; results: ConstraintResult[] }[]>;
  selfCheck: { variant: Variant; productKey: string; constraintId: string; state: string; reason: string }[];
  contractChecks: string[];
};

export async function runBenchmark(options: { runId?: string; queriesFile?: string }): Promise<void> {
  const queriesFile = options.queriesFile ?? 'scripts/catalog-v2/discover-v0/benchmark/benchmark_queries.v1.json';
  const queriesBytes = await readFile(queriesFile);
  const benchmark = JSON.parse(queriesBytes.toString('utf8')) as BenchmarkFile;
  const runId = options.runId ?? `run-${new Date().toISOString().replace(/[-:]/gu, '').slice(0, 15)}`;
  const outDir = path.join(OUT_ROOT, runId);
  try { await stat(outDir); throw new Error(`RUN_EXISTS: ${outDir}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

  console.log(`[discover-v0] fingerprinting protected inputs…`);
  const protectedBefore = await fingerprintProtected();
  const loadStarted = performance.now();
  const workspace = await loadWorkspace();
  const loadTotal = performance.now() - loadStarted;
  const { production, candidate } = workspace.indexes;
  if (production.lexicalFingerprint !== candidate.lexicalFingerprint) throw new Error('LEXICAL_INDEX_DIFFERS_ACROSS_BUNDLES');
  if (production.universe.length !== candidate.universe.length || production.universe.some((key, position) => candidate.universe[position] !== key)) throw new Error('UNIVERSE_DIFFERS');
  if (workspace.baseline.universeSize !== candidate.universe.length) throw new Error(`BASELINE_UNIVERSE_DIFFERS ${workspace.baseline.universeSize} vs ${candidate.universe.length}`);
  console.log(`[discover-v0] universe=${candidate.universe.length} queries=${benchmark.queries.length} runId=${runId}`);

  const firstRun: Partial<Record<Variant, number>> = {};
  const records: QueryRecord[] = [];
  const posthocVerifier = new ConstraintVerifier(candidate);
  for (const query of benchmark.queries) {
    const runs = {} as Record<Variant, VariantRun>;
    const deterministic = {} as Record<Variant, boolean>;
    const warm = {} as Record<Variant, DiscoverStageTimings[]>;
    for (const variant of VARIANTS) {
      const run = await runVariant(workspace, variant, query.query);
      firstRun[variant] ??= run.timings.total ?? 0;
      const again = await runVariant(workspace, variant, query.query);
      deterministic[variant] = stripTimings(run) === stripTimings(again) && run.retrieval.join() === again.retrieval.join();
      warm[variant] = [again.timings];
      for (let repetition = 1; repetition < WARM_REPETITIONS; repetition += 1) warm[variant].push((await runVariant(workspace, variant, query.query)).timings);
      runs[variant] = run;
    }
    // Post-hoc diagnostic: every variant's retrieval top-8 judged by the SAME verifier (FIX2 projections, HYBRID rules).
    const interpretation = runs.D.discover!.response.interpretation;
    const postHoc = {} as QueryRecord['postHoc'];
    for (const variant of VARIANTS) {
      postHoc[variant] = runs[variant].retrieval.map((productKey) => ({
        productKey,
        results: interpretation.hardConstraints.map((constraint) => posthocVerifier.verify(candidate.documents.get(productKey)!, constraint, true, 'HYBRID', { status: 'NOT_OBSERVED', reason: 'OFFLINE_RUN_NO_COMMERCIAL_TRUTH' })),
      }));
    }
    // Independent self-check of C/D: every returned eligible candidate must have every hard constraint SATISFIED.
    const selfCheck: QueryRecord['selfCheck'] = [];
    const contractChecks: string[] = [];
    for (const variant of ['C', 'D'] as const) {
      const index = variant === 'C' ? production : candidate;
      const verifier = new ConstraintVerifier(index);
      const response = runs[variant].discover!.response;
      for (const item of response.candidates) {
        for (const constraint of response.interpretation.hardConstraints) {
          const result = verifier.verify(index.documents.get(item.productKey)!, constraint, true, 'HYBRID', item.commercial);
          if (result.state !== 'SATISFIED') selfCheck.push({ variant, productKey: item.productKey, constraintId: constraint.id, state: result.state, reason: result.reason });
        }
      }
    }
    for (const variant of ['B', 'C', 'D'] as const) {
      const response = runs[variant].discover!.response;
      const keys = [...response.candidates, ...response.unverifiedCandidates].map((item) => item.productKey);
      if (new Set(keys).size !== keys.length) contractChecks.push(`${variant}:DUPLICATE_PRODUCT_KEY`);
      if (response.candidates.length > BENCHMARK_LIMIT || response.unverifiedCandidates.length > BENCHMARK_LIMIT) contractChecks.push(`${variant}:LIMIT_EXCEEDED`);
      if ([...response.candidates, ...response.unverifiedCandidates].some((item) => item.commercial.status !== 'NOT_OBSERVED')) contractChecks.push(`${variant}:COMMERCIAL_OBSERVED_OFFLINE`);
      if (response.candidates.some((item) => item.constraintResults.some((result) => result.hard && result.state !== 'SATISFIED'))) contractChecks.push(`${variant}:NON_SATISFIED_IN_ELIGIBLE`);
      const expectedBundle = variant === 'C' ? PRODUCTION_BUNDLE_ID : CANDIDATE_BUNDLE_ID;
      if (response.lineage.bundleId !== expectedBundle || response.lineage.sourceExtractionId !== workspace.source.input.sourceExtractionId) contractChecks.push(`${variant}:LINEAGE_MISMATCH`);
      if (response.interpretation.hardConstraints.some((constraint) => constraint.kind === 'COMPATIBILITY')
        && [...response.candidates, ...response.unverifiedCandidates].some((item) => item.constraintResults.some((result) => result.kind === 'COMPATIBILITY' && result.state !== 'UNSUPPORTED'))) {
        contractChecks.push(`${variant}:COMPATIBILITY_INFERRED`);
      }
    }
    if (runs.A.primary.length > BENCHMARK_LIMIT) contractChecks.push('A:LIMIT_EXCEEDED');
    records.push({ query, runs, deterministic, warm, postHoc, selfCheck, contractChecks });
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  // ---- aggregates ----------------------------------------------------------
  const classes = [...new Set(benchmark.queries.map((query) => query.queryClass))];
  const fixtureResults = records.filter((record) => record.query.adjudicationStatus === 'ENGINEERING_FIXTURE').map((record) => {
    const keys = record.query.fixture!.productKeys;
    const perVariant = Object.fromEntries(VARIANTS.map((variant) => {
      const run = record.runs[variant];
      const presented = run.primary.length > 0 ? run.primary : run.unverified;
      return [variant, {
        retrievalTop1: keys.includes(run.retrieval[0] ?? ''),
        retrievalAllInTop8: keys.every((key) => run.retrieval.includes(key)),
        primaryTop1: keys.includes(run.primary[0] ?? ''),
        presentedTop1: keys.includes(presented[0] ?? ''),
        presentedAllInTop8: keys.every((key) => presented.includes(key)),
        inEligible: keys.filter((key) => run.primary.includes(key)),
      }];
    })) as Record<Variant, { retrievalTop1: boolean; retrievalAllInTop8: boolean; primaryTop1: boolean; presentedTop1: boolean; presentedAllInTop8: boolean; inEligible: string[] }>;
    const pass = (variant: Variant) => record.query.fixture!.kind === 'TOP1' ? perVariant[variant].retrievalTop1 : perVariant[variant].retrievalAllInTop8;
    const regressions = (['B', 'C', 'D'] as const).filter((variant) => pass('A') && !pass(variant)
      || (record.query.queryClass === 'EXACT_NAME_SKU' && perVariant.A.primaryTop1 && !perVariant[variant].presentedTop1));
    return { queryId: record.query.queryId, query: record.query.query, queryClass: record.query.queryClass, kind: record.query.fixture!.kind, measuredOnly: record.query.fixture!.measuredOnly ?? false,
      expected: keys, pass: Object.fromEntries(VARIANTS.map((variant) => [variant, pass(variant)])), detail: perVariant, regressions };
  });
  const exactRegressions = fixtureResults.filter((item) => !item.measuredOnly && item.regressions.length > 0);

  const adjudicated = records.filter((record) => record.query.adjudicationStatus === 'ADJUDICATED');
  const relevance = adjudicated.length === 0
    ? { status: 'NOT_COMPUTABLE', reason: 'NO_ADJUDICATED_RELEVANCE_GOLD', adjudicatedQueries: 0 }
    : { status: 'COMPUTED', adjudicatedQueries: adjudicated.length, metrics: Object.fromEntries(VARIANTS.map((variant) => {
      const values = adjudicated.map((record) => {
        const relevant = new Set(record.query.goldRelevantProductIds);
        const ranked = record.runs[variant].primary;
        return { p3: precisionAtK(ranked, relevant, 3), r8: recallAtK(ranked, relevant, 8), mrr: reciprocalRank(ranked, relevant), ndcg: ndcgAtK(ranked, relevant, 8) };
      });
      const mean = (pick: (value: typeof values[number]) => number | null) => { const xs = values.map(pick).filter((x): x is number => x !== null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
      return [variant, { precisionAt3: mean((v) => v.p3), recallAt8: mean((v) => v.r8), mrr: mean((v) => v.mrr), ndcgAt8: mean((v) => v.ndcg) }];
    })) };

  const postHocSummary = (variant: Variant, subset = records) => {
    const counts = { SATISFIED: 0, VIOLATED: 0, UNKNOWN: 0, UNSUPPORTED: 0 } as Record<string, number>;
    let itemsWithViolation = 0;
    for (const record of subset) for (const item of record.postHoc[variant]) {
      for (const result of item.results) counts[result.state] = (counts[result.state] ?? 0) + 1;
      if (item.results.some((result) => result.state === 'VIOLATED')) itemsWithViolation += 1;
    }
    return { ...counts, itemsWithViolation };
  };

  const perVariant = Object.fromEntries(VARIANTS.map((variant) => {
    const runs = records.map((record) => record.runs[variant]);
    const withPrimary = runs.filter((run) => run.primary.length > 0).length;
    const withAny = runs.filter((run) => run.primary.length + run.unverified.length > 0).length;
    const noResult: Record<string, number> = {};
    for (const run of runs) {
      const reason = run.discover ? run.discover.response.completeness.noResultReason : run.search!.status === 'OK' ? (run.primary.length ? null : 'NO_NOMINAL_MATCH') : run.search!.status;
      if (reason) noResult[reason] = (noResult[reason] ?? 0) + 1;
    }
    const unknownHard = runs.reduce((sum, run) => sum + (run.discover?.response.unverifiedCandidates.reduce((inner, item) => inner + item.constraintResults.filter((r) => r.hard && (r.state === 'UNKNOWN' || r.state === 'UNSUPPORTED')).length, 0) ?? 0), 0);
    return [variant, {
      name: VARIANT_NAMES[variant],
      queriesWithPrimaryResults: withPrimary,
      queriesWithAnyResults: withAny,
      meanPrimaryCount: runs.reduce((sum, run) => sum + run.primary.length, 0) / runs.length,
      meanUnverifiedCount: runs.reduce((sum, run) => sum + run.unverified.length, 0) / runs.length,
      noResultReasons: noResult,
      unknownOrUnsupportedHardResultsInUnverified: unknownHard,
      deterministicQueries: records.filter((record) => record.deterministic[variant]).length,
      postHocHardConstraintsOnRetrievalTop8: postHocSummary(variant),
      byClass: Object.fromEntries(classes.map((queryClass) => {
        const subset = records.filter((record) => record.query.queryClass === queryClass);
        return [queryClass, {
          queries: subset.length,
          withPrimary: subset.filter((record) => record.runs[variant].primary.length > 0).length,
          withAny: subset.filter((record) => record.runs[variant].primary.length + record.runs[variant].unverified.length > 0).length,
          postHoc: postHocSummary(variant, subset),
        }];
      })),
    }];
  }));

  // ---- pairwise --------------------------------------------------------------
  const pairs: [Variant, Variant, string][] = [['A', 'B', 'lexical gain'], ['B', 'C', 'structured semantics gain'], ['C', 'D', 'FIX2 incremental gain']];
  const pairwiseRows: Record<string, unknown>[] = [];
  for (const record of records) {
    for (const [left, right, label] of pairs) {
      for (const list of ['retrieval', 'primary'] as const) {
        const comparison = compareLists(record.runs[left][list], record.runs[right][list]);
        pairwiseRows.push({ queryId: record.query.queryId, queryClass: record.query.queryClass, pair: `${left}->${right}`, attribution: label, list,
          leftCount: comparison.leftCount, rightCount: comparison.rightCount, overlap: comparison.overlap, jaccard: comparison.jaccard?.toFixed(3) ?? '',
          added: comparison.added.join(' '), removed: comparison.removed.join(' '), top1Changed: comparison.top1Changed, meanAbsRankShift: comparison.meanAbsRankShift?.toFixed(2) ?? '' });
      }
    }
  }
  const pairSummary = Object.fromEntries(pairs.map(([left, right, label]) => {
    const rows = pairwiseRows.filter((row) => row.pair === `${left}->${right}`);
    const summarize = (list: string) => {
      const subset = rows.filter((row) => row.list === list);
      const identical = subset.filter((row) => row.added === '' && row.removed === '' && row.meanAbsRankShift !== '' && Number(row.meanAbsRankShift) === 0 && row.leftCount === row.rightCount).length
        + subset.filter((row) => row.leftCount === 0 && row.rightCount === 0).length;
      return { queries: subset.length, identicalLists: identical, changedTop1: subset.filter((row) => row.top1Changed === true).length,
        meanJaccard: subset.filter((row) => row.jaccard !== '').reduce((sum, row) => sum + Number(row.jaccard), 0) / Math.max(1, subset.filter((row) => row.jaccard !== '').length),
        totalAdded: subset.reduce((sum, row) => sum + String(row.added).split(' ').filter(Boolean).length, 0),
        totalRemoved: subset.reduce((sum, row) => sum + String(row.removed).split(' ').filter(Boolean).length, 0),
        leftEmptyRightNonEmpty: subset.filter((row) => row.leftCount === 0 && Number(row.rightCount) > 0).length,
        leftNonEmptyRightEmpty: subset.filter((row) => Number(row.leftCount) > 0 && row.rightCount === 0).length };
    };
    return [`${left}->${right}`, { attribution: label, retrieval: summarize('retrieval'), primary: summarize('primary') }];
  }));

  // ---- latency ---------------------------------------------------------------
  const stages = ['interpret', 'exact', 'lexical', 'structured', 'fusion', 'hydrate', 'verify', 'rank', 'assemble', 'total'] as const;
  const latency = {
    note: 'In-process offline wall time (performance.now) on the operator workstation; no HTTP, no DB, no network. Not an end-to-end latency.',
    strategy: `Per query and variant: 1 first run, 1 determinism re-run, then ${WARM_REPETITIONS} warm runs (the re-run counts as warm #1). Warm per-query value = median of warm runs. Baseline A bypasses the service response cache (fresh instance per call).`,
    processCold: { loadWorkspaceMs: loadTotal, ...workspace.loadMs, firstQueryMsByVariant: firstRun },
    byVariant: Object.fromEntries(VARIANTS.map((variant) => {
      const first = records.map((record) => record.runs[variant].timings.total ?? 0);
      const warmMedians = (stage: typeof stages[number]) => records.map((record) => percentile(record.warm[variant].map((timing) => timing[stage] ?? 0), 50) ?? 0);
      return [variant, {
        firstRunTotal: { p50: percentile(first, 50), p95: percentile(first, 95), max: Math.max(...first) },
        warmTotal: { p50: percentile(warmMedians('total'), 50), p95: percentile(warmMedians('total'), 95), max: Math.max(...warmMedians('total')) },
        warmStages: Object.fromEntries(stages.filter((stage) => stage !== 'total').map((stage) => [stage, { p50: percentile(warmMedians(stage), 50), p95: percentile(warmMedians(stage), 95) }])),
        serializedBytes: { p50: percentile(records.map((record) => record.runs[variant].bytes), 50), p95: percentile(records.map((record) => record.runs[variant].bytes), 95),
          max: Math.max(...records.map((record) => record.runs[variant].bytes)) },
        approxTokensP50: Math.ceil((percentile(records.map((record) => record.runs[variant].bytes), 50) ?? 0) / 4),
        approxTokensNote: 'ESTIMATE = bytes/4 of the serialized response; not a measured model token count.',
      }];
    })),
  };

  // ---- interpretation self-consistency ---------------------------------------
  const interpretationRows = records.map((record) => {
    const actual = record.runs.D.discover!.response.interpretation;
    const actualHard = actual.hardConstraints.filter((constraint) => constraint.kind !== 'NOMINAL_TEXT').map(constraintLabel).sort();
    const expected = [...record.query.hardConstraints].sort();
    return { queryId: record.query.queryId, queryClass: record.query.queryClass, expected, actual: actualHard, agrees: JSON.stringify(expected) === JSON.stringify(actualHard),
      unrecognized: actual.unrecognizedTerms, softActual: actual.softPreferences.map(constraintLabel) };
  });

  const selfCheckViolations = records.flatMap((record) => record.selfCheck.map((item) => ({ queryId: record.query.queryId, ...item })));
  const contractViolations = records.flatMap((record) => record.contractChecks.map((check) => ({ queryId: record.query.queryId, check })));
  const protectedAfter = await fingerprintProtected();
  const changed = [...new Set([...Object.keys(protectedBefore), ...Object.keys(protectedAfter)])].filter((file) => protectedBefore[file] !== protectedAfter[file]);

  // ---- write -----------------------------------------------------------------
  await mkdir(OUT_ROOT, { recursive: true });
  await mkdir(outDir);
  const write = async (file: string, content: string) => writeFile(path.join(outDir, file), content, { flag: 'wx' });
  const json = (file: string, value: unknown) => write(file, `${JSON.stringify(value, null, 2)}\n`);

  await json('benchmark_queries.json', { ...benchmark, sourceFile: queriesFile, sourceFileSha256: sha(queriesBytes) });
  await json('benchmark_gold_status.json', {
    benchmarkVersion: benchmark.benchmarkVersion,
    counts: benchmark.queries.reduce((acc, query) => ({ ...acc, [query.adjudicationStatus]: (acc[query.adjudicationStatus] ?? 0) + 1 }), {} as Record<string, number>),
    byClass: Object.fromEntries(classes.map((queryClass) => [queryClass, benchmark.queries.filter((query) => query.queryClass === queryClass)
      .reduce((acc, query) => ({ ...acc, [query.adjudicationStatus]: (acc[query.adjudicationStatus] ?? 0) + 1 }), {} as Record<string, number>)])),
    independentRelevanceGoldAvailable: adjudicated.length > 0,
    relevanceMetrics: relevance,
    fixtureResults,
  });
  const variantFile: Record<Variant, string> = { A: 'results_baseline.json', B: 'results_lexical.json', C: 'results_hybrid_old.json', D: 'results_hybrid_fix2.json' };
  for (const variant of VARIANTS) {
    await json(variantFile[variant], {
      variant, name: VARIANT_NAMES[variant],
      bundleId: variant === 'C' ? PRODUCTION_BUNDLE_ID : variant === 'A' ? null : CANDIDATE_BUNDLE_ID,
      results: records.map((record) => ({
        queryId: record.query.queryId, query: record.query.query, queryClass: record.query.queryClass,
        primary: record.runs[variant].primary, unverified: record.runs[variant].unverified, retrieval: record.runs[variant].retrieval,
        deterministic: record.deterministic[variant], firstRunMs: record.runs[variant].timings.total, warmTimingsMs: record.warm[variant], serializedBytes: record.runs[variant].bytes,
        ...(variant === 'A' ? { search: { status: record.runs.A.search!.status, matchTypes: record.runs.A.search!.matchTypes, totalMatches: record.runs.A.search!.totalMatches,
          truncated: record.runs.A.search!.truncated, commercial: 'NOT_OBSERVED_OFFLINE' } }
          : { response: record.runs[variant].discover!.response, diagnostics: record.runs[variant].discover!.diagnostics }),
      })),
    });
  }
  await write('pairwise_comparison.csv', csv(pairwiseRows, ['queryId', 'queryClass', 'pair', 'attribution', 'list', 'leftCount', 'rightCount', 'overlap', 'jaccard', 'added', 'removed', 'top1Changed', 'meanAbsRankShift']));
  const diagnosticsRows = records.flatMap((record) => VARIANTS.map((variant) => {
    const run = record.runs[variant];
    const response = run.discover?.response;
    const top = run.retrieval.map((key, position) => `${position + 1}:${key}`).join(' ');
    const matchedBy = response ? [...new Set([...response.candidates, ...response.unverifiedCandidates].flatMap((item) => item.matchedBy))].sort().join(' ') : (run.search!.matchTypes.join(' '));
    const score = response ? [...response.candidates, ...response.unverifiedCandidates].slice(0, 8).map((item) => `${item.productKey}=${item.score}(x${item.scoreComponents.exactTier ?? '-'}/L${item.scoreComponents.lexical}/S${item.scoreComponents.structured}/P${item.scoreComponents.softPreferences})`).join(' ') : '';
    const why = response ? [...response.candidates, ...response.unverifiedCandidates].slice(0, 3).map((item) => `${item.productKey}: ${item.whyMatched.slice(0, 2).join('; ')}`).join(' || ') : '';
    const hardResults = response ? response.candidates.concat(response.unverifiedCandidates).flatMap((item) => item.constraintResults.filter((r) => r.hard).map((r) => r.state))
      .reduce((acc, state) => ({ ...acc, [state]: (acc[state] ?? 0) + 1 }), {} as Record<string, number>) : {};
    return {
      queryId: record.query.queryId, queryClass: record.query.queryClass, query: record.query.query, variant, variantName: VARIANT_NAMES[variant],
      top8Retrieval: top, primary: run.primary.join(' '), unverified: run.unverified.join(' '),
      eligibleCount: response?.completeness.eligibleCount ?? (variant === 'A' ? run.primary.length : ''), unverifiedCount: response?.completeness.unverifiedCount ?? '',
      excludedCount: response?.completeness.excludedCount ?? '', offTargetDropped: run.discover?.diagnostics.offTargetDropped ?? '',
      hardConstraints: response ? response.interpretation.hardConstraints.map(constraintLabel).join(' ; ') : '',
      recognized: response?.interpretation.recognizedConcepts.join(' ') ?? '', unrecognized: response?.interpretation.unrecognizedTerms.join(' ') ?? '',
      hardResultStates: hardResults, unknownConstraints: (hardResults.UNKNOWN ?? 0) + (hardResults.UNSUPPORTED ?? 0),
      postHocViolatedInTop8: record.postHoc[variant].filter((item) => item.results.some((r) => r.state === 'VIOLATED')).map((item) => item.productKey).join(' '),
      matchedBy, scoreComponents: score, whyMatched: why,
      noResultReason: response ? response.completeness.noResultReason ?? '' : (run.search!.status !== 'OK' ? run.search!.status : run.primary.length ? '' : 'NO_NOMINAL_MATCH'),
      firstRunMs: (run.timings.total ?? 0).toFixed(3), warmMedianMs: (percentile(record.warm[variant].map((timing) => timing.total ?? 0), 50) ?? 0).toFixed(3),
      serializedBytes: run.bytes, deterministic: record.deterministic[variant],
    };
  }));
  await write('query_diagnostics.csv', csv(diagnosticsRows, Object.keys(diagnosticsRows[0]!)));
  await json('latency_metrics.json', latency);
  await json('constraint_violations.json', {
    hardConstraintViolationsInEligible: selfCheckViolations.length,
    selfCheck: 'Every eligible candidate returned by C/D re-verified with a fresh ConstraintVerifier on its own bundle; any non-SATISFIED hard constraint is a violation.',
    violations: selfCheckViolations,
    contractChecks: contractViolations,
    postHocNote: 'Diagnostic only: hard constraints of each variant retrieval top-8, judged by the FIX2 projections under HYBRID rules. Projections are not adjudicated; VIOLATED here means "contradicted by an admitted projection", not ground truth.',
    postHocByVariant: Object.fromEntries(VARIANTS.map((variant) => [variant, postHocSummary(variant)])),
    postHocByQuery: records.filter((record) => record.runs.D.discover!.response.interpretation.hardConstraints.length > 0).map((record) => ({
      queryId: record.query.queryId, query: record.query.query,
      byVariant: Object.fromEntries(VARIANTS.map((variant) => [variant, record.postHoc[variant].map((item) => ({ productKey: item.productKey,
        states: item.results.map((result) => `${result.kind}=${result.state}${result.state === 'SATISFIED' ? '' : `:${result.reason}`}`) }))])),
    })),
  });
  await json('lineage.json', {
    runId, generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`,
    retrievalVersion: candidate.lineage.retrievalVersion, documentRulesVersion: candidate.lineage.documentRulesVersion, lexiconVersion: DISCOVER_V0_LEXICON_VERSION,
    lexiconEntries: DISCOVER_V0_LEXICON.length, lexiconSha256: sha(JSON.stringify(DISCOVER_V0_LEXICON)),
    source: { dir: workspace.source.dir, sourceExtractionId: workspace.source.input.sourceExtractionId, aggregateContentHash: workspace.source.aggregateContentHash,
      observedAt: workspace.source.observedAt, fileHashes: workspace.source.fileHashes },
    bundles: Object.fromEntries((['production', 'candidate'] as const).map((key) => {
      const loaded = workspace[key];
      const index = workspace.indexes[key];
      return [key, { dir: loaded.dir, bundleId: loaded.input.bundleId, manifestHash: loaded.manifestHash, fileHashes: loaded.fileHashes, verification: loaded.verification,
        lineage: index.lineage, indexFingerprint: index.fingerprint, lexicalFingerprint: index.lexicalFingerprint, universe: index.universe.length, degraded: index.degraded, buildMs: index.buildMs }];
    })),
    universe: { size: candidate.universe.length, rule: 'current_catalog AND active AND NOT discovery-exclusion-policy (same as catalog.search; listed assumed: visibility not extracted)' },
    activePointer: 'NOT READ, NOT WRITTEN (offline; no activation store opened)',
    protectedInputs: { files: Object.keys(protectedBefore).length, aggregateBefore: sha(JSON.stringify(protectedBefore)), aggregateAfter: sha(JSON.stringify(protectedAfter)), changed },
  });
  await json('interpretation_consistency.json', {
    note: 'Author-expected vs interpreter hard constraints. Self-consistency of the same author, not gold.',
    agreement: interpretationRows.filter((row) => row.agrees).length, total: interpretationRows.length,
    byClass: Object.fromEntries(classes.map((queryClass) => [queryClass, `${interpretationRows.filter((row) => row.queryClass === queryClass && row.agrees).length}/${interpretationRows.filter((row) => row.queryClass === queryClass).length}`])),
    rows: interpretationRows,
  });
  const representative = records.filter((record) => REPRESENTATIVE.includes(record.query.queryId));
  const md: string[] = [];
  for (const record of representative) {
    md.push(`#### ${record.query.queryId} — «${record.query.query}» (${record.query.queryClass})`, '');
    const interpretation = record.runs.D.discover!.response.interpretation;
    md.push(`Interpretación: hard=[${interpretation.hardConstraints.map(constraintLabel).join('; ') || '—'}] soft=[${interpretation.softPreferences.map(constraintLabel).join('; ') || '—'}] desconocidos=[${interpretation.unrecognizedTerms.join(', ') || '—'}]`, '');
    md.push('| Rank | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |', '| --- | --- | --- | --- | --- |');
    const cell = (variant: Variant, position: number) => {
      const run = record.runs[variant];
      const key = run.retrieval[position];
      if (!key) return '';
      const tag = variant === 'A' ? '' : run.primary.includes(key) ? ' ✔' : run.unverified.includes(key) ? ' ?' : '';
      return `${key}${tag} ${nameOf(workspace, key).replace(/\|/gu, '/').slice(0, 42)}`;
    };
    for (let position = 0; position < BENCHMARK_LIMIT; position += 1) {
      if (VARIANTS.every((variant) => !record.runs[variant].retrieval[position])) break;
      md.push(`| ${position + 1} | ${VARIANTS.map((variant) => cell(variant, position)).join(' | ')} |`);
    }
    if (VARIANTS.every((variant) => record.runs[variant].retrieval.length === 0)) md.push('| — | (sin resultados) | (sin resultados) | (sin resultados) | (sin resultados) |');
    md.push('', `Elegibles C=${record.runs.C.discover!.response.completeness.eligibleCount} D=${record.runs.D.discover!.response.completeness.eligibleCount}; no verificables C=${record.runs.C.discover!.response.completeness.unverifiedCount} D=${record.runs.D.discover!.response.completeness.unverifiedCount}; motivo sin elegibles D=${record.runs.D.discover!.response.completeness.noResultReason ?? '—'}.`, '');
  }
  await write('representative_comparisons.md', `${md.join('\n')}\n`);
  const summary = {
    runId, benchmarkVersion: benchmark.benchmarkVersion, queries: records.length, universe: candidate.universe.length,
    perVariant, pairSummary,
    fixtures: { total: fixtureResults.length, gating: fixtureResults.filter((item) => !item.measuredOnly).length,
      passByVariant: Object.fromEntries(VARIANTS.map((variant) => [variant, fixtureResults.filter((item) => !item.measuredOnly && item.pass[variant]).length])),
      exactRegressions: exactRegressions.map((item) => ({ queryId: item.queryId, query: item.query, variants: item.regressions })) },
    relevanceMetrics: relevance,
    hardConstraintViolationsInEligible: selfCheckViolations.length,
    contractViolations: contractViolations.length,
    determinism: Object.fromEntries(VARIANTS.map((variant) => [variant, `${records.filter((record) => record.deterministic[variant]).length}/${records.length}`])),
    familyObligationDowngrades: {
      C: production.universe.filter((key) => (production.documents.get(key)!.admission?.unmetFamilyObligations.length ?? 0) > 0).length,
      D: candidate.universe.filter((key) => (candidate.documents.get(key)!.admission?.unmetFamilyObligations.length ?? 0) > 0).length,
    },
    protectedInputsChanged: changed.length,
    interpretationAgreement: `${interpretationRows.filter((row) => row.agrees).length}/${interpretationRows.length}`,
  };
  await json('summary.json', summary);
  const outputs = await readdir(outDir);
  const checksums: Record<string, string> = {};
  for (const file of outputs.sort()) checksums[file] = sha(await readFile(path.join(outDir, file)));
  await json('evidence_checksums.json', checksums);

  console.log(JSON.stringify({ runId, outDir, determinism: summary.determinism, fixtures: summary.fixtures.passByVariant, exactRegressions: summary.fixtures.exactRegressions.length,
    hardConstraintViolationsInEligible: summary.hardConstraintViolationsInEligible, contractViolations: summary.contractViolations, protectedInputsChanged: changed.length }, null, 2));
  if (changed.length > 0) {
    process.exitCode = 2;
    console.error(`PROTECTED INPUTS CHANGED: ${changed.join(', ')}`);
  }
}
