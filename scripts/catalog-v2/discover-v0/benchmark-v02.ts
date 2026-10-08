import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ConstraintVerifier } from '../../../src/application/catalog/discover-v0/constraintVerifier.js';
import { DISCOVER_V0_RETRIEVAL_VERSION, type ConstraintResult, type DiscoverConstraint, type DiscoverDiagnosticResponse, type DiscoverStageTimings } from '../../../src/application/catalog/discover-v0/contracts.js';
import { aggregateGroups, dispositionOf } from '../../../src/application/catalog/discover-v0/disposition.js';
import { compareLists, percentile } from '../../../src/application/catalog/discover-v0/evaluation.js';
import { requirementHolds } from '../../../src/application/catalog/discover-v0/generators.js';
import { DISCOVER_V0_LEXICON, DISCOVER_V0_LEXICON_VERSION } from '../../../src/application/catalog/discover-v0/lexicon.js';
import { componentCountFromName, interpretSpecQuantity, QUANTITY_RULES, QUANTITY_SCOPE_VERSION } from '../../../src/application/catalog/discover-v0/quantityScope.js';
import { CANDIDATE_BUNDLE_ID, PRODUCTION_BUNDLE_ID } from '../../../src/infrastructure/catalog/discover-v0/frozenInputLoader.js';
import { BENCHMARK_LIMIT, loadWorkspace, nameOf, runVariant, VARIANT_NAMES, VARIANTS, type Variant, type VariantRun, type Workspace } from './workspace.js';

/*
 * CAT-DISCOVER-V0.2 regression and A/B/C/D benchmark.
 *
 * Same frozen source, same two bundles, same 120 queries (discover-v0-benchmark-v1,
 * used as a REGRESSION/DEVELOPMENT set, never as gold), same limit and timing
 * strategy as V0. Every V0.2 result is diffed per query against the V0 run
 * reproduced from commit 6469eca (--v0). Writes create-only into --run-dir.
 *
 *   npx tsx scripts/catalog-v2/discover-v0/benchmark-v02.ts --run-dir=<dir> --v0=<v0 replay dir> [--quantity-cohort=<csv>]
 */

const WARM_REPETITIONS = 5;
const QUERIES_FILE = 'scripts/catalog-v2/discover-v0/benchmark/benchmark_queries.v1.json';
const PRIORITY_LOST = ['Q033', 'Q073', 'Q078', 'Q079', 'Q080', 'Q081', 'Q095', 'Q096', 'Q097', 'Q099', 'Q100', 'Q105'];
const PRIORITY_EXTRA = ['Q060', 'Q001', 'Q031', 'Q051', 'Q052', 'Q058', 'Q059', 'Q064', 'Q076', 'Q083', 'Q088', 'Q106'];
const AGENT_BYTES_TARGET = 3072;

type BenchmarkQuery = { queryId: string; query: string; queryClass: string; hardConstraints: string[]; adjudicationStatus: string;
  fixture?: { kind: 'TOP1' | 'MUST_INCLUDE'; productKeys: string[]; measuredOnly?: boolean } };
type V0Constraint = { id: string; kind: string; codes?: string[]; specKey?: string; operator?: string; value?: number; target?: string; subtypeText?: string[][]; demotedFrom?: string };
type V0Result = { constraintId: string; kind: string; hard: boolean; state: string; reason: string };
type V0Candidate = { productKey: string; constraintResults: V0Result[]; scoreComponents: { total: number } };
type V0Row = {
  queryId: string; primary: string[]; unverified: string[]; retrieval: string[]; serializedBytes: number; firstRunMs?: number;
  response?: { interpretation: { hardConstraints: V0Constraint[]; softPreferences: V0Constraint[]; unrecognizedTerms: string[] }; candidates: V0Candidate[]; unverifiedCandidates: V0Candidate[];
    completeness: { eligibleCount: number; unverifiedCount: number; excludedCount: number; noResultReason: string | null } };
  diagnostics?: { pool: { productKey: string; eligibility: string }[]; excluded: { productKey: string; violated: { reason: string }[] }[]; nominalLookup: boolean };
};

const sha = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const csv = (rows: Record<string, unknown>[], columns: string[]) => {
  const cell = (value: unknown) => `"${String(value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : value).replaceAll('"', '""')}"`;
  return `${[columns.map(cell).join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\r\n')}\r\n`;
};

function v0Label(constraint: V0Constraint): string {
  if (constraint.kind === 'SPEC') return `SPEC:${constraint.specKey} ${constraint.operator} ${constraint.value}`;
  if (constraint.kind === 'COMMERCIAL_MAX_PRICE') return `COMMERCIAL_MAX_PRICE LTE ${constraint.value}`;
  if (constraint.kind === 'COMPATIBILITY' || constraint.kind === 'COMMERCIAL_AVAILABILITY') return constraint.kind;
  return `${constraint.kind}:${(constraint.codes ?? []).join('|')}${constraint.subtypeText?.length ? '(subtype)' : ''}`;
}

/** V0.2 labels; grouped readings are rendered as one ANY_OF group (alternatives, never a conjunction). */
function v02Labels(constraints: readonly DiscoverConstraint[]): string[] {
  const ungrouped = constraints.filter((constraint) => !constraint.groupId).map((constraint) => (constraint.kind === 'SPEC' && constraint.quantityScope && constraint.specKey === 'weight_kg'
    ? `${v0Label(constraint as V0Constraint)} [${constraint.quantityScope}]` : v0Label(constraint as V0Constraint)));
  const groups = [...new Set(constraints.filter((constraint) => constraint.groupId).map((constraint) => constraint.groupId!))]
    .map((groupId) => `ANY_OF(${constraints.filter((constraint) => constraint.groupId === groupId).map((constraint) => `${constraint.readingId}=${v0Label(constraint as V0Constraint)}`).join(' | ')})`);
  return [...ungrouped, ...groups].sort();
}

const V0_STATE: Record<string, string> = { ELIGIBLE: 'VERIFIED_MATCH', UNVERIFIED: 'POSSIBLE_MATCH', EXCLUDED: 'REJECTED' };

type Record_ = {
  query: BenchmarkQuery;
  runs: Record<Variant, VariantRun>;
  deterministic: Record<Variant, boolean>;
  warm: Record<Variant, DiscoverStageTimings[]>;
  selfCheck: { variant: Variant; productKey: string; constraintId: string; state: string; reason: string }[];
  contractChecks: string[];
};

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z0-9-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
  const runDir = options['run-dir'];
  const v0Dir = options.v0;
  if (!runDir || !v0Dir) throw new Error('INVALID_ARGUMENT: --run-dir and --v0 are required');
  const outputs = ['implementation_summary.json', 'input_authority.json', 'v0_v02_regression.csv', 'abcd_comparison.csv', 'query_interpretation_diff.csv', 'constraint_assessment_diff.csv',
    'spec_quantity_scope_cases.csv', 'candidate_disposition_diff.csv', 'agent_response_sizes.json', 'latency_metrics.json', 'hydration_bound_audit.json', 'priority_queries.md', 'results_v02.json'];
  for (const file of outputs) {
    try { await stat(path.join(runDir, file)); throw new Error(`OUTPUT_EXISTS: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const queriesBytes = await readFile(QUERIES_FILE);
  const benchmark = JSON.parse(queriesBytes.toString('utf8')) as { benchmarkVersion: string; queries: BenchmarkQuery[] };
  const v0Files: Record<Variant, string> = { A: 'results_baseline.json', B: 'results_lexical.json', C: 'results_hybrid_old.json', D: 'results_hybrid_fix2.json' };
  const v0 = {} as Record<Variant, Map<string, V0Row>>;
  for (const variant of VARIANTS) {
    const parsed = JSON.parse(await readFile(path.join(v0Dir, v0Files[variant]), 'utf8')) as { results: V0Row[] };
    v0[variant] = new Map(parsed.results.map((row) => [row.queryId, row]));
  }
  const v0Queries = JSON.parse(await readFile(path.join(v0Dir, 'benchmark_queries.json'), 'utf8')) as { sourceFileSha256: string };
  if (v0Queries.sourceFileSha256 !== sha(queriesBytes)) throw new Error('BENCHMARK_QUERIES_DIFFER_FROM_V0');

  const loadStarted = performance.now();
  const workspace = await loadWorkspace();
  const loadTotal = performance.now() - loadStarted;
  const { production, candidate } = workspace.indexes;
  if (production.lexicalFingerprint !== candidate.lexicalFingerprint) throw new Error('LEXICAL_INDEX_DIFFERS_ACROSS_BUNDLES');
  if (production.universe.join() !== candidate.universe.join()) throw new Error('UNIVERSE_DIFFERS');
  console.log(`[discover-v0.2] universe=${candidate.universe.length} queries=${benchmark.queries.length}`);

  const records: Record_[] = [];
  const firstRun: Partial<Record<Variant, number>> = {};
  for (const query of benchmark.queries) {
    const runs = {} as Record<Variant, VariantRun>;
    const deterministic = {} as Record<Variant, boolean>;
    const warm = {} as Record<Variant, DiscoverStageTimings[]>;
    for (const variant of VARIANTS) {
      const run = await runVariant(workspace, variant, query.query);
      firstRun[variant] ??= run.timings.total ?? 0;
      const again = await runVariant(workspace, variant, query.query);
      const stable = (item: VariantRun) => JSON.stringify([item.discover?.response ?? item.search?.response ?? null, item.discover?.agent ?? null, item.retrieval]);
      deterministic[variant] = stable(run) === stable(again);
      warm[variant] = [again.timings];
      for (let repetition = 1; repetition < WARM_REPETITIONS; repetition += 1) warm[variant].push((await runVariant(workspace, variant, query.query)).timings);
      runs[variant] = run;
    }
    const selfCheck: Record_['selfCheck'] = [];
    const contractChecks: string[] = [];
    for (const variant of ['C', 'D'] as const) {
      const index = variant === 'C' ? production : candidate;
      const verifier = new ConstraintVerifier(index);
      const response = runs[variant].discover!.response;
      const interpretation = response.interpretation;
      const context = {
        requestedFamilies: interpretation.hardConstraints.filter((constraint) => constraint.kind === 'PRODUCT_TYPE').flatMap((constraint) => constraint.codes ?? []),
        requestedExercises: interpretation.hardConstraints.filter((constraint) => constraint.kind === 'EXERCISE').flatMap((constraint) => constraint.codes ?? []),
      };
      // Independent re-verification: a fresh verifier and a fresh disposition for every VERIFIED_MATCH returned.
      for (const item of [...response.verified, ...response.exactResolution.entities.filter((entity) => entity.disposition === 'VERIFIED_MATCH')]) {
        const document = index.documents.get(item.productKey)!;
        const results: ConstraintResult[] = interpretation.hardConstraints.map((constraint) => verifier.verify(document, constraint, true, 'HYBRID', item.commercial, context));
        const groups = aggregateGroups({ ...interpretation, lexicalTokens: [], synonymExpansions: [], productKeyLookups: [], lexiconVersion: '' }, results,
          (id) => { const requirement = interpretation.relevanceRequirements.find((entry) => entry.id === id); return !requirement || requirementHolds(index, item.productKey, requirement); });
        if (dispositionOf(results, groups).disposition !== 'VERIFIED_MATCH') {
          for (const result of results.filter((entry) => !entry.groupId && entry.state !== 'SATISFIED')) selfCheck.push({ variant, productKey: item.productKey, constraintId: result.constraintId, state: result.state, reason: result.reason });
          for (const group of groups.filter((entry) => entry.state !== 'SATISFIED')) selfCheck.push({ variant, productKey: item.productKey, constraintId: group.groupId, state: group.state, reason: group.reason });
        }
      }
    }
    for (const variant of ['B', 'C', 'D'] as const) {
      const response = runs[variant].discover!.response;
      const keys = [...response.verified, ...response.possible].map((item) => item.productKey);
      if (new Set(keys).size !== keys.length) contractChecks.push(`${variant}:DUPLICATE_PRODUCT_KEY`);
      if (response.rejected.some((item) => keys.includes(item.productKey))) contractChecks.push(`${variant}:REJECTED_IN_LISTS`);
      if (response.verified.length > BENCHMARK_LIMIT || response.possible.length > BENCHMARK_LIMIT) contractChecks.push(`${variant}:LIMIT_EXCEEDED`);
      const agent = runs[variant].discover!.agent;
      if (agent.verified.length > 8 || agent.possible.length > 3) contractChecks.push(`${variant}:AGENT_LIMIT_EXCEEDED`);
      if ([...response.verified, ...response.possible].some((item) => item.commercial.status !== 'NOT_OBSERVED')) contractChecks.push(`${variant}:COMMERCIAL_OBSERVED_OFFLINE`);
      if (!agent.completeness.warnings.includes('COMMERCIAL_TRUTH_NOT_OBSERVED')) contractChecks.push(`${variant}:COMMERCIAL_WARNING_DROPPED`);
      if (response.interpretation.ambiguityGroups.length > 0 && !agent.completeness.warnings.includes('AMBIGUOUS_NEED')) contractChecks.push(`${variant}:AMBIGUITY_WARNING_DROPPED`);
      if (response.verified.some((item) => item.disposition !== 'VERIFIED_MATCH') || response.possible.some((item) => item.disposition !== 'POSSIBLE_MATCH')) contractChecks.push(`${variant}:DISPOSITION_LIST_MISMATCH`);
      const expectedBundle = variant === 'C' ? PRODUCTION_BUNDLE_ID : CANDIDATE_BUNDLE_ID;
      if (response.lineage.bundleId !== expectedBundle || agent.lineage.bundleId !== expectedBundle || response.lineage.retrievalVersion !== DISCOVER_V0_RETRIEVAL_VERSION) contractChecks.push(`${variant}:LINEAGE_MISMATCH`);
      if ([...response.verified, ...response.possible].some((item) => item.constraintResults.some((result) => result.kind === 'COMPATIBILITY' && result.state !== 'UNSUPPORTED'))) contractChecks.push(`${variant}:COMPATIBILITY_INFERRED`);
    }
    const aV0 = v0.A.get(query.queryId)!;
    if (aV0.primary.join() !== runs.A.primary.join()) contractChecks.push('A:BASELINE_CHANGED_VS_V0');
    records.push({ query, runs, deterministic, warm, selfCheck, contractChecks });
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  // ---- per query × variant rows ------------------------------------------------
  const lineageOf = (variant: Variant) => (variant === 'A' ? 'catalog.search@frozen-source' : `${variant === 'C' ? PRODUCTION_BUNDLE_ID.slice(0, 19) : CANDIDATE_BUNDLE_ID.slice(0, 19)}…/${DISCOVER_V0_RETRIEVAL_VERSION}`);
  const warmMedian = (record: Record_, variant: Variant) => percentile(record.warm[variant].map((timing) => timing.total ?? 0), 50) ?? 0;
  const abcdRows = records.flatMap((record) => VARIANTS.map((variant) => {
    const run = record.runs[variant];
    const response = run.discover?.response;
    const signals = response ? [...response.verified, ...response.possible].slice(0, 3).map((item) => `${item.productKey}:${item.relevance.tier}(L${item.relevance.lexical}/C${item.relevance.structured})[${item.matchedBy.join('+')}]`).join(' ; ') : (run.search?.matchTypes ?? []).join(' ');
    return {
      queryId: record.query.queryId, query: record.query.query, queryClass: record.query.queryClass, variant, variantName: VARIANT_NAMES[variant], version: variant === 'A' ? 'catalog.search' : DISCOVER_V0_RETRIEVAL_VERSION,
      topK: run.retrieval.join(' '), exactEntity: run.exact.join(' '), verifiedCandidates: run.primary.join(' '), possibleCandidates: run.unverified.join(' '),
      verifiedCount: response?.completeness.verifiedCount ?? (variant === 'A' ? run.primary.length : ''), possibleCount: response?.completeness.possibleCount ?? '',
      rejectedCandidates: response?.completeness.rejectedCount ?? '', noResultReason: response ? response.completeness.noResultReason ?? '' : (run.primary.length ? '' : (run.search!.status !== 'OK' ? run.search!.status : 'NO_NOMINAL_MATCH')),
      ambiguityGroups: response?.interpretation.ambiguityGroups.length ?? '', relevanceSignals: signals,
      latencyFirstMs: (run.timings.total ?? 0).toFixed(3), latencyWarmMedianMs: warmMedian(record, variant).toFixed(3),
      responseBytes: run.bytes, agentResponseBytes: run.agentBytes ?? '', deterministic: record.deterministic[variant], lineage: lineageOf(variant),
    };
  }));

  const regressionRows: Record<string, unknown>[] = [];
  const dispositionRows: Record<string, unknown>[] = [];
  for (const record of records) {
    for (const variant of VARIANTS) {
      const before = v0[variant].get(record.query.queryId)!;
      const after = record.runs[variant];
      const response = after.discover?.response;
      const retrieval = compareLists(before.retrieval, after.retrieval);
      const primary = compareLists(before.primary, after.primary);
      const v0Hard = (before.response?.interpretation.hardConstraints ?? []).map(v0Label).sort();
      const v0Soft = (before.response?.interpretation.softPreferences ?? []).map(v0Label).sort();
      const v02Hard = response ? v02Labels(response.interpretation.hardConstraints) : [];
      const v02Soft = response ? v02Labels(response.interpretation.softPreferences) : [];
      const interpretationChanged = variant !== 'A' && (JSON.stringify(v0Hard) !== JSON.stringify(v02Hard) || JSON.stringify(v0Soft) !== JSON.stringify(v02Soft));
      const v0States = new Map<string, V0Result[]>([...(before.response?.candidates ?? []), ...(before.response?.unverifiedCandidates ?? [])].map((item) => [item.productKey, item.constraintResults.filter((result) => result.hard)]));
      const v02States = new Map([...(response?.verified ?? []), ...(response?.possible ?? [])].map((item) => [item.productKey, item.constraintResults.filter((result) => result.hard)]));
      const common = [...v0States.keys()].filter((key) => v02States.has(key));
      const evidenceChanged = common.filter((key) => JSON.stringify(v0States.get(key)!.map((result) => `${result.state}:${result.reason}`).sort()) !== JSON.stringify(v02States.get(key)!.map((result) => `${result.state}:${result.reason}`).sort()));
      const constraintChanged = common.filter((key) => JSON.stringify(v0States.get(key)!.map((result) => result.state).sort()) !== JSON.stringify(v02States.get(key)!.map((result) => result.state).sort()));
      const v0Scores = new Map([...(before.response?.candidates ?? []), ...(before.response?.unverifiedCandidates ?? [])].map((item) => [item.productKey, item.scoreComponents.total]));
      const scoreChanged = [...(response?.verified ?? []), ...(response?.possible ?? [])].filter((item) => v0Scores.has(item.productKey) && Math.abs(v0Scores.get(item.productKey)! - item.score) > 1e-6).length;
      const eligibilityChanged = primary.added.length + primary.removed.length > 0;
      const rankingChanged = !eligibilityChanged && primary.leftCount > 0 && before.primary.join() !== after.primary.join();
      const categories = [
        ...(retrieval.added.length ? ['RECUPERACION_NUEVA'] : []), ...(retrieval.removed.length ? ['RECUPERACION_PERDIDA'] : []),
        ...(interpretationChanged ? ['CAMBIO_INTERPRETACION'] : []), ...(eligibilityChanged ? ['CAMBIO_ELEGIBILIDAD'] : []),
        ...(rankingChanged || (!retrieval.added.length && !retrieval.removed.length && retrieval.meanAbsRankShift !== null && retrieval.meanAbsRankShift > 0) ? ['CAMBIO_RANKING'] : []),
        ...(evidenceChanged.length ? ['CAMBIO_EVIDENCIA'] : []), ...(variant !== 'A' ? ['CAMBIO_FORMATO'] : []),
      ];
      regressionRows.push({
        queryId: record.query.queryId, query: record.query.query, queryClass: record.query.queryClass, variant, version: `catalog-discover-v0.1 -> ${variant === 'A' ? 'catalog.search (unchanged)' : DISCOVER_V0_RETRIEVAL_VERSION}`,
        priority: PRIORITY_LOST.includes(record.query.queryId) ? 'P0_LOST_VS_SEARCH' : PRIORITY_EXTRA.includes(record.query.queryId) ? 'P1_EXTRA' : '',
        topK_v0: before.retrieval.join(' '), topK_v02: after.retrieval.join(' '),
        verifiedCandidates_v0: before.primary.join(' '), verifiedCandidates_v02: after.primary.join(' '),
        possibleCandidates_v0: before.unverified.join(' '), possibleCandidates_v02: after.unverified.join(' '),
        rejectedCandidates_v0: before.response?.completeness.excludedCount ?? '', rejectedCandidates_v02: response?.completeness.rejectedCount ?? '',
        verifiedCount_v0: before.response?.completeness.eligibleCount ?? (variant === 'A' ? before.primary.length : ''), verifiedCount_v02: response?.completeness.verifiedCount ?? (variant === 'A' ? after.primary.length : ''),
        retrievalAdded: retrieval.added.join(' '), retrievalRemoved: retrieval.removed.join(' '), verifiedAdded: primary.added.join(' '), verifiedRemoved: primary.removed.join(' '),
        interpretationChanges: interpretationChanged ? `${v0Hard.join(' ; ')} => ${v02Hard.join(' ; ')}${JSON.stringify(v0Soft) !== JSON.stringify(v02Soft) ? ` || soft ${v0Soft.join(' ; ')} => ${v02Soft.join(' ; ')}` : ''}` : '',
        constraintChanges: constraintChanged.join(' '), evidenceChanges: evidenceChanged.join(' '), scoreChanges: scoreChanged,
        relevanceSignals: abcdRows.find((row) => row.queryId === record.query.queryId && row.variant === variant)!.relevanceSignals,
        noResultReason_v0: before.response?.completeness.noResultReason ?? '', noResultReason_v02: response?.completeness.noResultReason ?? '',
        latency_v0_firstMs: before.firstRunMs?.toFixed(3) ?? '', latency_v02_firstMs: (after.timings.total ?? 0).toFixed(3),
        responseBytes_v0: before.serializedBytes, responseBytes_v02_diagnostic: after.bytes, responseBytes_v02_agent: after.agentBytes ?? '',
        categories: categories.join(' '), lineage: lineageOf(variant),
      });
      if (variant === 'C' || variant === 'D') {
        const beforePool = new Map((before.diagnostics?.pool ?? []).map((item) => [item.productKey, V0_STATE[item.eligibility] ?? item.eligibility]));
        for (const excluded of before.diagnostics?.excluded ?? []) beforePool.set(excluded.productKey, 'REJECTED');
        const afterPool = new Map((after.discover!.diagnostics.pool).map((item) => [item.productKey, item.disposition as string]));
        for (const rejected of after.discover!.diagnostics.rejected) afterPool.set(rejected.productKey, 'REJECTED');
        const keys = [...new Set([...before.primary, ...before.unverified, ...after.primary, ...after.unverified, ...after.exact])];
        for (const key of keys) {
          const from = beforePool.get(key) ?? 'NOT_IN_TOP50';
          const to = afterPool.get(key) ?? 'NOT_IN_TOP50';
          const item = [...response!.verified, ...response!.possible, ...response!.exactResolution.entities].find((entry) => entry.productKey === key);
          const v0Item = [...(before.response?.candidates ?? []), ...(before.response?.unverifiedCandidates ?? [])].find((entry) => entry.productKey === key);
          dispositionRows.push({
            queryId: record.query.queryId, query: record.query.query, variant, productKey: key, name: nameOf(workspace, key), dispositionV0: from, dispositionV02: to,
            transition: from === to ? 'UNCHANGED' : `${from}->${to}`, inTop8V0: before.primary.includes(key) ? 'VERIFIED' : before.unverified.includes(key) ? 'POSSIBLE' : '',
            inTop8V02: after.primary.includes(key) ? 'VERIFIED' : after.unverified.includes(key) ? 'POSSIBLE' : after.exact.includes(key) ? 'EXACT_ENTITY' : '',
            v0HardResults: v0Item ? v0Item.constraintResults.filter((result) => result.hard).map((result) => `${result.kind}=${result.state}:${result.reason}`).join(' ; ') : '',
            v02Blocking: item ? item.blocking.map((entry) => `${entry.constraintId}=${entry.state}:${entry.reason}${entry.conflict ? ':CONFLICTING_EVIDENCE' : ''}`).join(' ; ') : '',
            v02Groups: item ? item.groupResults.map((group) => `${group.groupId}:${group.state}[${group.readings.map((reading) => `${reading.readingId}=${reading.state}`).join(',')}]`).join(' ; ') : '',
          });
        }
      }
    }
  }

  const interpretationRows = records.map((record) => {
    const before = v0.D.get(record.query.queryId)!.response!.interpretation;
    const after = record.runs.D.discover!.response.interpretation;
    const v0Hard = before.hardConstraints.map(v0Label).sort();
    const v02Hard = v02Labels(after.hardConstraints);
    const v0Demoted = before.softPreferences.filter((constraint) => constraint.demotedFrom === 'HARD').map(v0Label);
    return {
      queryId: record.query.queryId, query: record.query.query, queryClass: record.query.queryClass,
      v0Hard: v0Hard.join(' ; '), v0DemotedByExactMatch: v0Demoted.join(' ; '), v02Hard: v02Hard.join(' ; '),
      v0Soft: before.softPreferences.map(v0Label).sort().join(' ; '), v02Soft: v02Labels(after.softPreferences).join(' ; '),
      v02AmbiguityGroups: after.ambiguityGroups.map((group) => `${group.text}{${group.readings.map((reading) => `${reading.readingId}:${reading.role}`).join('|')}}`).join(' ; '),
      v02RelevanceRequirements: after.relevanceRequirements.map((requirement) => `${requirement.role}:${requirement.gating ? 'GATE' : 'PREF'}${requirement.field === 'NAME' ? '@NAME' : ''}:"${requirement.text}"`).join(' ; '),
      v02Spans: after.spans.map((span) => `${span.text}{${span.readings.map((reading) => `${reading.role}/${reading.status}`).join(',')}}`).join(' ; '),
      v0Unrecognized: before.unrecognizedTerms.join(' '), v02Unrecognized: after.unrecognizedTerms.join(' '),
      authorExpectedHard: [...record.query.hardConstraints].sort().join(' ; '),
      hardChanged: JSON.stringify(v0Hard) !== JSON.stringify(v02Hard), demotionRemoved: v0Demoted.length > 0,
      changeKind: v0Demoted.length > 0 ? 'EXACT_MATCH_NO_DEMOTION' : after.ambiguityGroups.length > 0 ? 'AMBIGUITY_GROUP'
        : after.relevanceRequirements.some((requirement) => requirement.role === 'USE_PURPOSE') ? 'USE_PURPOSE' : JSON.stringify(v0Hard) !== JSON.stringify(v02Hard) ? 'CONSTRAINT_LABEL' : '',
    };
  });

  const constraintRows: Record<string, unknown>[] = [];
  for (const record of records.filter((item) => PRIORITY_LOST.includes(item.query.queryId) || PRIORITY_EXTRA.includes(item.query.queryId))) {
    const before = v0.D.get(record.query.queryId)!;
    const response = record.runs.D.discover!.response;
    const v0Items = [...(before.response?.candidates ?? []), ...(before.response?.unverifiedCandidates ?? [])];
    const v02Items = [...response.verified, ...response.possible, ...response.exactResolution.entities];
    for (const key of [...new Set([...v0Items.map((item) => item.productKey), ...v02Items.map((item) => item.productKey)])]) {
      const v0Item = v0Items.find((item) => item.productKey === key);
      const v02Item = v02Items.find((item) => item.productKey === key);
      constraintRows.push({
        queryId: record.query.queryId, query: record.query.query, productKey: key, name: nameOf(workspace, key),
        v0: v0Item ? v0Item.constraintResults.map((result) => `${result.hard ? 'H' : 's'}:${result.kind}=${result.state}:${result.reason}`).join(' ; ') : 'NOT_IN_V0_LISTS',
        v02: v02Item ? v02Item.constraintResults.map((result) => `${result.hard ? 'H' : 's'}:${result.kind}${result.readingId ? `[${result.readingId}]` : ''}=${result.state}:${result.reason}${result.conflict ? ':CONFLICTING_EVIDENCE' : ''}${result.quantity ? `{${result.quantity.scope}/${result.quantity.rule}${result.quantity.derived ? '/derived' : ''}}` : ''}`).join(' ; ') : 'NOT_IN_V02_LISTS',
        v02Disposition: v02Item?.disposition ?? (response.rejected.some((item) => item.productKey === key) ? 'REJECTED' : 'NOT_IN_TOP_LISTS'),
        v02Groups: v02Item ? v02Item.groupResults.map((group) => `${group.groupId}=${group.state}`).join(' ') : '',
      });
    }
  }

  // ---- quantity cohort ---------------------------------------------------------
  const cohortFile = options['quantity-cohort'] ?? 'artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/specs_interpretation_risk.csv';
  const cohortBytes = await readFile(cohortFile);
  const cohort = cohortBytes.toString('utf8').replace(/^﻿/u, '').trim().split(/\r?\n/u).slice(1).map((line) => line.match(/"((?:[^"]|"")*)"/gu)!.map((cell) => cell.slice(1, -1).replaceAll('""', '"')));
  const cohortClass = (status: string, certification: string) => status === 'CONFLICTING' ? 'CONFLICTING'
    : status !== 'INTERPRETED' || certification === 'NOT_CERTIFIABLE' ? 'UNSUPPORTED' : certification === 'CONDITIONAL' ? 'AMBIGUOUS_CONTEXT_DEPENDENT' : 'INTERPRETABLE_SUFFICIENT';
  const quantityRows = cohort.map(([productId, name, key, value, , rawValue]) => {
    const document = candidate.documents.get(`P${productId}`)!;
    const spec = document.specs!.find((item) => item.key === key && item.rawValue === rawValue)!;
    const quantity = interpretSpecQuantity(document, spec);
    return { productId: `P${productId}`, name, family: document.productSemantics?.primaryFamily?.code ?? '', key, value, rawValue, v0Qualifier: spec.qualifier ?? '', v0Behavior: 'UNKNOWN (SPEC_CONTEXTUAL_QUALIFIER)',
      magnitude: quantity.magnitude, scope: quantity.scope, appliesTo: quantity.appliesTo, componentCount: quantity.componentCount ?? '', approximate: quantity.approximate, includesUser: quantity.includesUser,
      subcomponentExercises: quantity.subcomponentExercises.join('|'), status: quantity.status, certification: quantity.certification, rule: quantity.rule,
      cohortClass: cohortClass(quantity.status, quantity.certification), ruleText: QUANTITY_RULES[quantity.rule] ?? quantity.rule };
  });
  const universeQuantities = candidate.universe.flatMap((key) => {
    const document = candidate.documents.get(key)!;
    return (document.specs ?? []).filter((spec) => spec.status === 'parsed').map((spec) => ({ key, spec, quantity: interpretSpecQuantity(document, spec) }));
  });
  const tally = (items: { quantity: { status: string; certification: string; rule: string } }[]) => items.reduce((acc, item) => {
    const cls = cohortClass(item.quantity.status, item.quantity.certification);
    acc.byClass[cls] = (acc.byClass[cls] ?? 0) + 1;
    acc.byRule[item.quantity.rule] = (acc.byRule[item.quantity.rule] ?? 0) + 1;
    return acc;
  }, { byClass: {} as Record<string, number>, byRule: {} as Record<string, number> });

  // ---- sizes, latency, hydration --------------------------------------------------
  const sizeStats = (values: number[]) => ({ p50: percentile(values, 50), p95: percentile(values, 95), max: Math.max(...values), count: values.length });
  const agentSizes = {
    note: 'Serialized bytes of JSON.stringify(response). Agent = DiscoverAgentResponse; diagnostic = DiscoverDiagnosticResponse. V0 = run reproduced from 6469eca (single response format).',
    targetAgentP50Bytes: AGENT_BYTES_TARGET,
    byVariant: Object.fromEntries((['B', 'C', 'D'] as const).map((variant) => {
      const agent = records.map((record) => record.runs[variant].agentBytes!);
      const diagnostic = records.map((record) => record.runs[variant].bytes);
      const before = records.map((record) => v0[variant].get(record.query.queryId)!.serializedBytes);
      return [variant, { agent: sizeStats(agent), diagnosticV02: sizeStats(diagnostic), v0Response: sizeStats(before),
        agentApproxTokensP50: Math.ceil((percentile(agent, 50) ?? 0) / 4), agentOverTarget: agent.filter((bytes) => bytes > AGENT_BYTES_TARGET).length,
        agentP50MeetsTarget: (percentile(agent, 50) ?? Infinity) < AGENT_BYTES_TARGET }];
    })),
    largestAgentResponsesD: records.map((record) => ({ queryId: record.query.queryId, query: record.query.query, bytes: record.runs.D.agentBytes! })).sort((left, right) => right.bytes - left.bytes).slice(0, 10),
    criticalWarningsPreserved: records.every((record) => !record.contractChecks.some((check) => check.endsWith('WARNING_DROPPED'))),
  };
  const stages = ['interpret', 'exact', 'lexical', 'structured', 'fusion', 'hydrate', 'verify', 'rank', 'assemble', 'total'] as const;
  const latency = {
    note: 'In-process offline wall time (performance.now) on the operator workstation; no HTTP, no DB, no network. Not an end-to-end latency.',
    strategy: `Same as V0: per query and variant 1 first run, 1 determinism re-run, then ${WARM_REPETITIONS} warm runs (the re-run counts as warm #1); warm value = median.`,
    processCold: { loadWorkspaceMs: loadTotal, ...workspace.loadMs, firstQueryMsByVariant: firstRun },
    byVariant: Object.fromEntries(VARIANTS.map((variant) => {
      const first = records.map((record) => record.runs[variant].timings.total ?? 0);
      const warmMedians = (stage: typeof stages[number]) => records.map((record) => percentile(record.warm[variant].map((timing) => timing[stage] ?? 0), 50) ?? 0);
      const v0First = records.map((record) => v0[variant].get(record.query.queryId)!.firstRunMs ?? 0);
      return [variant, {
        firstRunTotal: { p50: percentile(first, 50), p95: percentile(first, 95), max: Math.max(...first) },
        warmTotal: { p50: percentile(warmMedians('total'), 50), p95: percentile(warmMedians('total'), 95), max: Math.max(...warmMedians('total')) },
        warmStages: Object.fromEntries(stages.filter((stage) => stage !== 'total').map((stage) => [stage, { p50: percentile(warmMedians(stage), 50), p95: percentile(warmMedians(stage), 95) }])),
        v0FirstRunTotal: { p50: percentile(v0First, 50), p95: percentile(v0First, 95), note: 'from the V0 replay run (same machine, different process)' },
      }];
    })),
  };
  const hydration = {
    note: 'V0 hydrated commercial truth for the top-40 of a PRELIMINARY ranking computed before verification. V0.2 verifies technical constraints first and spends the same bound on technically conforming candidates (VERIFIED, then POSSIBLE), in relevance order.',
    bound: records[0]!.runs.D.discover!.diagnostics.hydration.bound,
    byVariant: Object.fromEntries((['C', 'D'] as const).map((variant) => {
      const rows = records.map((record) => {
        const hydrationInfo = record.runs[variant].discover!.diagnostics.hydration;
        const verifiedBeyond = hydrationInfo.verifiedPositionsInRelevanceOrder.filter((position) => position > hydrationInfo.bound).length;
        return { queryId: record.query.queryId, technicallyVerified: hydrationInfo.technicallyVerified, technicallyConforming: hydrationInfo.technicallyConforming,
          verifiedBeyondBoundInRelevanceOrder: verifiedBeyond, requested: hydrationInfo.requested.length, verifiedNotHydratedInV02: Math.max(0, hydrationInfo.technicallyVerified - hydrationInfo.bound) };
      });
      return [variant, {
        queriesWithVerifiedBeyondBoundInRelevanceOrder: rows.filter((row) => row.verifiedBeyondBoundInRelevanceOrder > 0).map((row) => `${row.queryId}:${row.verifiedBeyondBoundInRelevanceOrder}`),
        queriesWithMoreVerifiedThanBound: rows.filter((row) => row.verifiedNotHydratedInV02 > 0).map((row) => `${row.queryId}:${row.technicallyVerified}`),
        maxTechnicallyVerified: Math.max(...rows.map((row) => row.technicallyVerified)), maxTechnicallyConforming: Math.max(...rows.map((row) => row.technicallyConforming)),
        rows,
      }];
    })),
    lexicalPoolTruncation: Object.fromEntries((['B', 'C', 'D'] as const).map((variant) => [variant, records.filter((record) => record.runs[variant].discover!.diagnostics.lexical.truncated).map((record) => record.query.queryId)])),
  };

  // ---- fixtures / exact regression -------------------------------------------------
  const fixtureRows = records.filter((record) => record.query.adjudicationStatus === 'ENGINEERING_FIXTURE').map((record) => {
    const keys = record.query.fixture!.productKeys;
    const pass = (list: string[]) => (record.query.fixture!.kind === 'TOP1' ? keys.includes(list[0] ?? '') : keys.every((key) => list.includes(key)));
    const presented = (variant: Variant) => { const run = record.runs[variant]; return [...run.exact, ...run.primary.filter((key) => !run.exact.includes(key)), ...run.unverified]; };
    const v0Presented = (variant: Variant) => { const row = v0[variant].get(record.query.queryId)!; return row.primary.length ? row.primary : row.unverified; };
    return {
      queryId: record.query.queryId, kind: record.query.fixture!.kind, measuredOnly: record.query.fixture!.measuredOnly ?? false, expected: keys,
      v0: Object.fromEntries(VARIANTS.map((variant) => [variant, pass(v0[variant].get(record.query.queryId)!.retrieval)])),
      v02: Object.fromEntries(VARIANTS.map((variant) => [variant, pass(record.runs[variant].retrieval)])),
      presentedV0: Object.fromEntries((['B', 'C', 'D'] as const).map((variant) => [variant, pass(v0Presented(variant))])),
      presentedV02: Object.fromEntries((['B', 'C', 'D'] as const).map((variant) => [variant, pass(presented(variant))])),
    };
  });
  const exactRegressions = fixtureRows.filter((row) => !row.measuredOnly && (['B', 'C', 'D'] as const).some((variant) => (row.v0[variant] && !row.v02[variant]) || (row.presentedV0[variant] && !row.presentedV02[variant])));

  // ---- summaries -----------------------------------------------------------------
  const perVariant = Object.fromEntries(VARIANTS.map((variant) => {
    const runs = records.map((record) => record.runs[variant]);
    const before = records.map((record) => v0[variant].get(record.query.queryId)!);
    const noResult: Record<string, number> = {};
    for (const run of runs) { const reason = run.discover ? run.discover.response.completeness.noResultReason : run.primary.length ? null : 'NO_NOMINAL_MATCH'; if (reason) noResult[reason] = (noResult[reason] ?? 0) + 1; }
    return [variant, {
      name: VARIANT_NAMES[variant],
      queriesWithVerified: runs.filter((run) => run.primary.length > 0).length, queriesWithVerifiedV0: before.filter((row) => row.primary.length > 0).length,
      queriesWithAnyList: runs.filter((run) => run.primary.length + run.unverified.length + run.exact.length > 0).length, queriesWithAnyListV0: before.filter((row) => row.primary.length + row.unverified.length > 0).length,
      meanVerifiedReturned: runs.reduce((sum, run) => sum + run.primary.length, 0) / runs.length, meanVerifiedReturnedV0: before.reduce((sum, row) => sum + row.primary.length, 0) / before.length,
      meanPossibleReturned: runs.reduce((sum, run) => sum + run.unverified.length, 0) / runs.length,
      totalVerifiedPool: runs.reduce((sum, run) => sum + (run.discover?.response.completeness.verifiedCount ?? 0), 0),
      totalVerifiedPoolV0: before.reduce((sum, row) => sum + (row.response?.completeness.eligibleCount ?? 0), 0),
      queriesWithAmbiguity: runs.filter((run) => (run.discover?.response.interpretation.ambiguityGroups.length ?? 0) > 0).map((_run, position) => position).length,
      noResultReasons: noResult,
      deterministic: `${records.filter((record) => record.deterministic[variant]).length}/${records.length}`,
      byClass: Object.fromEntries([...new Set(records.map((record) => record.query.queryClass))].map((queryClass) => {
        const subset = records.filter((record) => record.query.queryClass === queryClass);
        return [queryClass, `${subset.filter((record) => record.runs[variant].primary.length > 0).length}/${subset.filter((record) => record.runs[variant].primary.length + record.runs[variant].unverified.length + record.runs[variant].exact.length > 0).length}/${subset.length}`
          + ` (V0 ${subset.filter((record) => v0[variant].get(record.query.queryId)!.primary.length > 0).length}/${subset.filter((record) => { const row = v0[variant].get(record.query.queryId)!; return row.primary.length + row.unverified.length > 0; }).length})`];
      })),
    }];
  }));
  const categoryCounts = (variant: Variant) => regressionRows.filter((row) => row.variant === variant).reduce((acc: Record<string, number>, row) => {
    for (const category of String(row.categories).split(' ').filter(Boolean)) acc[category] = (acc[category] ?? 0) + 1;
    return acc;
  }, {});
  const transitions = (variant: Variant) => dispositionRows.filter((row) => row.variant === variant && row.transition !== 'UNCHANGED').reduce((acc: Record<string, number>, row) => {
    acc[String(row.transition)] = (acc[String(row.transition)] ?? 0) + 1; return acc;
  }, {});
  const priorityStatus = PRIORITY_LOST.map((queryId) => {
    const record = records.find((item) => item.query.queryId === queryId)!;
    const aKeys = record.runs.A.primary;
    const run = record.runs.D;
    return { queryId, query: record.query.query, aResults: aKeys.length, v0Verified: v0.D.get(queryId)!.primary.length, v02Verified: run.discover!.response.completeness.verifiedCount,
      aKeysVerifiedInV02: aKeys.filter((key) => run.discover!.diagnostics.verifiedKeys.includes(key)).length,
      aKeysPossibleInV02: aKeys.filter((key) => run.discover!.diagnostics.possibleKeys.includes(key)).length,
      aKeysRejectedInV02: aKeys.filter((key) => run.discover!.diagnostics.rejected.some((item) => item.productKey === key)).length,
      noResultReason: run.discover!.response.completeness.noResultReason };
  });
  const selfCheck = records.flatMap((record) => record.selfCheck.map((item) => ({ queryId: record.query.queryId, ...item })));
  const contractViolations = records.flatMap((record) => record.contractChecks.map((check) => ({ queryId: record.query.queryId, check })));

  const summary = {
    runDir, generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`,
    retrievalVersion: DISCOVER_V0_RETRIEVAL_VERSION, lexiconVersion: DISCOVER_V0_LEXICON_VERSION, lexiconEntries: DISCOVER_V0_LEXICON.length, lexiconSha256: sha(JSON.stringify(DISCOVER_V0_LEXICON)),
    lexiconEntriesByType: DISCOVER_V0_LEXICON.reduce((acc: Record<string, number>, entry) => { acc[entry.type] = (acc[entry.type] ?? 0) + 1; return acc; }, {}),
    lexiconPendingDomainReview: DISCOVER_V0_LEXICON.filter((entry) => entry.reviewStatus === 'PENDING_DOMAIN_REVIEW').length,
    quantityScopeVersion: QUANTITY_SCOPE_VERSION, quantityRules: QUANTITY_RULES,
    benchmark: { version: benchmark.benchmarkVersion, file: QUERIES_FILE, sha256: sha(queriesBytes), queries: records.length, use: 'REGRESSION_AND_DEVELOPMENT_SET (not gold; not held-out)' },
    v0Reference: { dir: v0Dir, code: 'commit 6469eca (reproduced byte-for-byte except timings: see v0_baseline_reproduction.json)' },
    perVariant, changeCategories: Object.fromEntries(VARIANTS.map((variant) => [variant, categoryCounts(variant)])),
    dispositionTransitions: { C: transitions('C'), D: transitions('D') },
    priorityLostVsSearch: priorityStatus,
    fixtures: { total: fixtureRows.length, gating: fixtureRows.filter((row) => !row.measuredOnly).length,
      passV0: Object.fromEntries(VARIANTS.map((variant) => [variant, fixtureRows.filter((row) => !row.measuredOnly && row.v0[variant]).length])),
      passV02: Object.fromEntries(VARIANTS.map((variant) => [variant, fixtureRows.filter((row) => !row.measuredOnly && row.v02[variant]).length])),
      exactRegressions: exactRegressions.map((row) => row.queryId), rows: fixtureRows },
    hardConstraintViolationsInVerified: selfCheck.length, selfCheckViolations: selfCheck, contractViolations,
    determinism: Object.fromEntries(VARIANTS.map((variant) => [variant, `${records.filter((record) => record.deterministic[variant]).length}/${records.length}`])),
    quantityScope: { cohortFile, cohortSha256: sha(cohortBytes), cohortRows: quantityRows.length, cohort: tally(quantityRows.map((row) => ({ quantity: { status: row.status, certification: row.certification, rule: row.rule } }))),
      universeParsedValues: universeQuantities.length, universe: tally(universeQuantities),
      universeV0QualifiedValues: universeQuantities.filter((item) => item.spec.qualifier).length,
      universeV0QualifiedNowCertifiable: universeQuantities.filter((item) => item.spec.qualifier && item.quantity.certification === 'CERTIFIABLE').length,
      universeV0UnqualifiedNowNotCertifiable: universeQuantities.filter((item) => !item.spec.qualifier && item.quantity.certification !== 'CERTIFIABLE').map((item) => `${item.key}:${item.spec.key}:${item.quantity.rule}`),
      multiUnitProducts: candidate.universe.filter((key) => (componentCountFromName(candidate.documents.get(key)!.name) ?? 2) !== 1).length },
    agentSizes: agentSizes.byVariant, relevanceMetrics: { status: 'NOT_COMPUTABLE', reason: 'NO_ADJUDICATED_RELEVANCE_GOLD', adjudicatedQueries: 0 },
  };

  // ---- write -------------------------------------------------------------------------
  const write = (file: string, content: string) => writeFile(path.join(runDir, file), content, { flag: 'wx' });
  const json = (file: string, value: unknown) => write(file, `${JSON.stringify(value, null, 2)}\n`);
  await json('implementation_summary.json', summary);
  await json('input_authority.json', {
    source: { dir: workspace.source.dir, sourceExtractionId: workspace.source.input.sourceExtractionId, aggregateContentHash: workspace.source.aggregateContentHash, observedAt: workspace.source.observedAt, fileHashes: workspace.source.fileHashes },
    bundles: Object.fromEntries((['production', 'candidate'] as const).map((key) => {
      const loaded = workspace[key];
      const index = workspace.indexes[key];
      return [key, { dir: loaded.dir, bundleId: loaded.input.bundleId, manifestHash: loaded.manifestHash, fileHashes: loaded.fileHashes, verification: loaded.verification,
        lineage: index.lineage, indexFingerprint: index.fingerprint, lexicalFingerprint: index.lexicalFingerprint, universe: index.universe.length, degraded: index.degraded }];
    })),
    expected: { production: PRODUCTION_BUNDLE_ID, candidate: CANDIDATE_BUNDLE_ID },
    benchmark: summary.benchmark, v0Reference: summary.v0Reference, qa2QuantityCohort: { file: cohortFile, sha256: sha(cohortBytes) },
    activePointer: 'NOT READ, NOT WRITTEN (offline; no activation store opened)', commercialTruth: 'NOT CONNECTED (offline hydrator: COMMERCIAL_TRUTH_NOT_OBSERVED)',
  });
  const regressionColumns = Object.keys(regressionRows[0]!);
  await write('v0_v02_regression.csv', csv(regressionRows, regressionColumns));
  await write('abcd_comparison.csv', csv(abcdRows, Object.keys(abcdRows[0]!)));
  await write('query_interpretation_diff.csv', csv(interpretationRows, Object.keys(interpretationRows[0]!)));
  await write('constraint_assessment_diff.csv', csv(constraintRows, Object.keys(constraintRows[0]!)));
  await write('spec_quantity_scope_cases.csv', csv(quantityRows, Object.keys(quantityRows[0]!)));
  await write('candidate_disposition_diff.csv', csv(dispositionRows, Object.keys(dispositionRows[0]!)));
  await json('agent_response_sizes.json', agentSizes);
  await json('latency_metrics.json', latency);
  await json('hydration_bound_audit.json', hydration);
  await json('results_v02.json', records.map((record) => ({ queryId: record.query.queryId, query: record.query.query,
    variants: Object.fromEntries(VARIANTS.map((variant) => [variant, { primary: record.runs[variant].primary, possible: record.runs[variant].unverified, exact: record.runs[variant].exact, retrieval: record.runs[variant].retrieval,
      ...(record.runs[variant].discover ? { response: record.runs[variant].discover!.response, agent: record.runs[variant].discover!.agent, diagnostics: record.runs[variant].discover!.diagnostics } : {}) }])) })));
  await write('priority_queries.md', priorityMarkdown(records, v0, workspace));
  const checksums: Record<string, string> = {};
  for (const file of (await readdir(runDir)).filter((name) => outputs.includes(name)).sort()) checksums[file] = sha(await readFile(path.join(runDir, file)));
  await json('evidence_checksums_benchmark.json', checksums);
  console.log(JSON.stringify({ determinism: summary.determinism, fixtures: { v0: summary.fixtures.passV0, v02: summary.fixtures.passV02, exactRegressions: summary.fixtures.exactRegressions },
    hardConstraintViolationsInVerified: selfCheck.length, contractViolations: contractViolations.length, agentP50: Object.fromEntries((['B', 'C', 'D'] as const).map((variant) => [variant, agentSizes.byVariant[variant]!.agent.p50])),
    priority: priorityStatus.map((item) => `${item.queryId}:${item.v0Verified}->${item.v02Verified}`).join(' ') }, null, 2));
}

function priorityMarkdown(records: Record_[], v0: Record<Variant, Map<string, V0Row>>, workspace: Workspace): string {
  const out: string[] = ['# Priority queries — V0 (6469eca) vs V0.2, variant D (FIX2) and A (catalog.search)', ''];
  for (const queryId of [...PRIORITY_LOST, ...PRIORITY_EXTRA]) {
    const record = records.find((item) => item.query.queryId === queryId)!;
    const before = v0.D.get(queryId)!;
    const response: DiscoverDiagnosticResponse = record.runs.D.discover!.response;
    const label = (key: string) => `${key} ${nameOf(workspace, key).replace(/\|/gu, '/').slice(0, 44)}`;
    out.push(`## ${queryId} — «${record.query.query}» ${PRIORITY_LOST.includes(queryId) ? '(perdida vs búsqueda en V0)' : ''}`, '');
    out.push(`- A catalog.search: ${record.runs.A.primary.map(label).join('; ') || '—'}`);
    out.push(`- V0 D interpretación: ${(before.response?.interpretation.hardConstraints ?? []).map(v0Label).join('; ') || '—'}${before.diagnostics?.nominalLookup ? ' (restricciones degradadas por coincidencia exacta)' : ''}`);
    out.push(`- V0.2 D interpretación: ${v02Labels(response.interpretation.hardConstraints).join('; ') || '—'}${response.interpretation.relevanceRequirements.length ? ` · requisitos de texto: ${response.interpretation.relevanceRequirements.map((requirement) => `${requirement.role}${requirement.gating ? '' : '(pref)'} «${requirement.text}»`).join(', ')}` : ''}`);
    out.push(`- V0 D elegibles/no verificables/excluidos: ${before.response?.completeness.eligibleCount}/${before.response?.completeness.unverifiedCount}/${before.response?.completeness.excludedCount} · V0.2 D VERIFIED/POSSIBLE/REJECTED: ${response.completeness.verifiedCount}/${response.completeness.possibleCount}/${response.completeness.rejectedCount}`);
    out.push(`- V0 D top elegibles: ${before.primary.slice(0, 5).map(label).join('; ') || '—'}`);
    out.push(`- V0.2 D exact: ${response.exactResolution.entities.map((entity) => `${label(entity.productKey)} [${entity.disposition}]`).join('; ') || '—'}`);
    out.push(`- V0.2 D VERIFIED: ${response.verified.slice(0, 5).map((item) => label(item.productKey)).join('; ') || '—'}`);
    out.push(`- V0.2 D POSSIBLE: ${response.possible.slice(0, 4).map((item) => `${label(item.productKey)} ⟨${item.blocking.map((entry) => `${entry.state}:${entry.reason.slice(0, 60)}${entry.conflict ? ' CONFLICT' : ''}`).join(' / ')}⟩`).join('; ') || '—'}`);
    out.push(`- V0.2 D REJECTED (muestra): ${response.rejected.slice(0, 3).map((item) => `${label(item.productKey)} ⟨${item.violated.map((entry) => entry.reason.slice(0, 50)).join(' / ')}⟩`).join('; ') || '—'}`);
    out.push(`- Motivo sin VERIFIED: ${response.completeness.noResultReason ?? '—'}`, '');
  }
  return `${out.join('\n')}\n`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
