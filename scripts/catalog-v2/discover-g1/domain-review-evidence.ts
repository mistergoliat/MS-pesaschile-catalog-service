import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ConstraintVerifier, nameNamesConcept } from '../../../src/application/catalog/discover-v0/constraintVerifier.js';
import type { ConstraintResult, DiscoverConstraint, QueryInterpretation } from '../../../src/application/catalog/discover-v0/contracts.js';
import { discoverV0 } from '../../../src/application/catalog/discover-v0/discoverV0.js';
import { aggregateGroups, dispositionOf } from '../../../src/application/catalog/discover-v0/disposition.js';
import { requirementHolds } from '../../../src/application/catalog/discover-v0/generators.js';
import { DISCOVER_V0_LEXICON } from '../../../src/application/catalog/discover-v0/lexicon.js';
import { componentCountFromName, interpretSpecQuantity } from '../../../src/application/catalog/discover-v0/quantityScope.js';
import type { DiscoverIndex } from '../../../src/application/catalog/discover-v0/retrievalDocument.js';
import { discoverTokens, stemToken } from '../../../src/application/catalog/discover-v0/text.js';
import { BENCHMARK_LIMIT, loadWorkspace } from '../discover-v0/workspace.js';

/*
 * CAT-DISCOVER-G1 — domain-review evidence (DR-01 … DR-06).
 *
 * READ-ONLY over code, inputs and V0.2 evidence. It runs catalog.discoverV0.2
 * exactly as it is in the worktree on the 120 DEVELOPMENT queries (variants C and D),
 * re-verifies every pooled candidate with a fresh ConstraintVerifier and collects
 * the real firings of the six interpretive rules that need domain review, plus a
 * universe census of the Specs values each rule can touch. It never changes a rule,
 * never labels relevance and never decides a packet: every packet leaves the human
 * decision PENDING.
 *
 *   npx tsx scripts/catalog-v2/discover-g1/domain-review-evidence.ts --run-dir=<dir>
 */

const QUERIES_FILE = 'scripts/catalog-v2/discover-v0/benchmark/benchmark_queries.v1.json';
const V02_RUN = 'artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2';
const OFFLINE = { status: 'NOT_OBSERVED', reason: 'OFFLINE_DOMAIN_REVIEW_EVIDENCE' } as const;

const sha = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const csv = (rows: Record<string, unknown>[], columns: string[]) => {
  const cell = (value: unknown) => `"${String(value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : value).replaceAll('"', '""')}"`;
  return `${[columns.map(cell).join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\r\n')}\r\n`;
};
const parseCsv = (text: string) => {
  const lines = text.replace(/^﻿/u, '').trim().split(/\r?\n/u).map((line) => (line.match(/"((?:[^"]|"")*)"/gu) ?? []).map((cell) => cell.slice(1, -1).replaceAll('""', '"')));
  const [header, ...rows] = lines;
  return rows.map((row) => Object.fromEntries(header!.map((name, position) => [name, row[position] ?? ''])));
};

type Firing = {
  rule: string; queryId: string; query: string; variant: 'C' | 'D'; productKey: string; name: string; family: string;
  constraint: string; state: string; reason: string; evidence: string; disposition: string; poolRank: number | null; inTop8: string;
};

function constraintLabel(constraint: DiscoverConstraint): string {
  if (constraint.kind === 'SPEC') return `SPEC:${constraint.specKey} ${constraint.operator} ${constraint.value}${constraint.quantityScope ? ` [${constraint.quantityScope}/${constraint.quantityScopeRule ?? ''}]` : ''}`;
  return `${constraint.kind}:${(constraint.codes ?? []).join('|')}${constraint.readingId ? ` (${constraint.groupId}/${constraint.readingId})` : ''}`;
}

/** Number of product names (universe) that contain a governed term, and how many families those products span. */
function termReach(index: DiscoverIndex, term: string): { products: number; families: number; familyCodes: string[] } {
  const stems = term.split(' ');
  const hits = index.universe.filter((key) => {
    const name = discoverTokens(index.documents.get(key)!.name).map(stemToken);
    for (let start = 0; start + stems.length <= name.length; start += 1) if (stems.every((token, offset) => name[start + offset] === token)) return true;
    return false;
  });
  const families = [...new Set(hits.map((key) => index.documents.get(key)!.productSemantics?.primaryFamily?.code ?? 'NONE'))].sort();
  return { products: hits.length, families: families.length, familyCodes: families };
}

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z0-9-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
  const runDir = options['run-dir'];
  if (!runDir) throw new Error('INVALID_ARGUMENT: --run-dir is required');
  const outputs = ['domain_review_evidence.json', 'dr_firings.csv', 'dr_spec_census.csv', 'dr05_rejected_to_possible.csv'];
  for (const file of outputs) {
    try { await stat(path.join(runDir, file)); throw new Error(`OUTPUT_EXISTS: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const queriesBytes = await readFile(QUERIES_FILE);
  const benchmark = JSON.parse(queriesBytes.toString('utf8')) as { benchmarkVersion: string; queries: { queryId: string; query: string; queryClass: string }[] };
  const workspace = await loadWorkspace();
  const firings: Firing[] = [];
  const groupRows: Record<string, unknown>[] = [];
  const pairQueries: Record<string, unknown>[] = [];
  const selfConsistency: string[] = [];

  for (const variant of ['C', 'D'] as const) {
    const index = variant === 'C' ? workspace.indexes.production : workspace.indexes.candidate;
    const verifier = new ConstraintVerifier(index);
    for (const query of benchmark.queries) {
      const result = await discoverV0({ schemaVersion: 1, need: query.query, limit: BENCHMARK_LIMIT }, { index, mode: 'HYBRID' });
      const { response, diagnostics } = result;
      const interpretation = response.interpretation as QueryInterpretation;
      const hard = interpretation.hardConstraints;
      const context = {
        requestedFamilies: hard.filter((constraint) => constraint.kind === 'PRODUCT_TYPE').flatMap((constraint) => constraint.codes ?? []),
        requestedExercises: hard.filter((constraint) => constraint.kind === 'EXERCISE').flatMap((constraint) => constraint.codes ?? []),
      };
      if (variant === 'D') {
        for (const constraint of hard.filter((item) => item.kind === 'SPEC' && item.quantityScopeRule === 'PAIR_NAMING_CONVENTION')) {
          pairQueries.push({ queryId: query.queryId, query: query.query, constraint: constraintLabel(constraint), verified: response.completeness.verifiedCount, possible: response.completeness.possibleCount, rejected: response.completeness.rejectedCount });
        }
      }
      const poolOrder = new Map(diagnostics.pool.map((item, position) => [item.productKey, position + 1]));
      const keys = [...new Set([...diagnostics.pool.map((item) => item.productKey), ...diagnostics.rejected.map((item) => item.productKey)])];
      const disposition = new Map<string, string>(diagnostics.pool.map((item) => [item.productKey, item.disposition]));
      for (const item of diagnostics.rejected) disposition.set(item.productKey, 'REJECTED');
      const top8 = new Map<string, string>([...response.verified.map((item) => [item.productKey, 'VERIFIED'] as const), ...response.possible.map((item) => [item.productKey, 'POSSIBLE'] as const)]);
      const groupTally = new Map<string, Record<string, number>>();
      for (const key of keys) {
        const document = index.documents.get(key)!;
        const results: ConstraintResult[] = hard.map((constraint) => verifier.verify(document, constraint, true, 'HYBRID', OFFLINE, context));
        const groups = aggregateGroups(interpretation, results, (id) => {
          const requirement = interpretation.relevanceRequirements.find((entry) => entry.id === id);
          return !requirement || requirementHolds(index, key, requirement);
        });
        const recomputed = dispositionOf(results, groups).disposition;
        // Off-target candidates are dropped before ranking; only compare products the pipeline kept.
        if (disposition.has(key) && recomputed !== disposition.get(key) && !(disposition.get(key) === 'REJECTED' && recomputed === 'REJECTED')) {
          selfConsistency.push(`${variant}:${query.queryId}:${key}:${disposition.get(key)}!=${recomputed}`);
        }
        const family = document.productSemantics?.primaryFamily?.code ?? '';
        const push = (rule: string, constraint: DiscoverConstraint, entry: ConstraintResult) => firings.push({
          rule, queryId: query.queryId, query: query.query, variant, productKey: key, name: document.name, family, constraint: constraintLabel(constraint),
          state: entry.state, reason: entry.reason, evidence: entry.evidence ?? '', disposition: disposition.get(key) ?? recomputed, poolRank: poolOrder.get(key) ?? null, inTop8: top8.get(key) ?? '',
        });
        results.forEach((entry, position) => {
          const constraint = hard[position]!;
          const quantity = entry.quantity;
          if (quantity?.rule === 'INCLUDES_USER') push('DR-01_INCLUDES_USER', constraint, entry);
          if (constraint.quantityScopeRule === 'PAIR_NAMING_CONVENTION' || (quantity && ['EXPLICIT_PAIR', 'MULTI_UNIT_UNQUALIFIED', 'PACK_NAME_TOTAL', 'EXPLICIT_TOTAL'].includes(quantity.rule))
            || (quantity?.rule === 'EXPLICIT_EACH' && (componentCountFromName(document.name) ?? 2) !== 1)) push('DR-02_PAIR_PACK_SCOPE', constraint, entry);
          if (quantity?.scope === 'SUBCOMPONENT' || /^SUBCOMPONENT_NOT_REQUESTED/u.test(entry.reason)) push('DR-03_SUBCOMPONENT_CAPABILITY', constraint, entry);
          if (quantity?.approximate || /APPROXIMATE/u.test(entry.reason)) push('DR-04_APPROXIMATE_QUANTITY', constraint, entry);
          if (/^NEGATIVE_CONFLICTS_WITH_NAME|^CLASSIFICATION_CONFLICTS_WITH_NAME/u.test(entry.reason)) push('DR-05_NAME_CONFLICT', constraint, entry);
        });
        for (const group of groups) {
          const tally = groupTally.get(group.groupId) ?? {};
          const signature = `${group.state}[${group.readings.map((reading) => `${reading.readingId}=${reading.state}`).join(',')}]`;
          tally[signature] = (tally[signature] ?? 0) + 1;
          groupTally.set(group.groupId, tally);
        }
      }
      for (const group of interpretation.ambiguityGroups) {
        groupRows.push({ variant, queryId: query.queryId, query: query.query, groupId: group.groupId, text: group.text,
          readings: group.readings.map((reading) => `${reading.readingId}:${reading.role}:${reading.label}`).join(' | '),
          verified: response.completeness.verifiedCount, possible: response.completeness.possibleCount, rejected: response.completeness.rejectedCount,
          noResultReason: response.completeness.noResultReason ?? '', agentWarnings: result.agent.completeness.warnings.join(' '),
          readingOutcomes: groupTally.get(group.groupId) ?? {},
          possibleTop: response.possible.slice(0, 8).map((item) => `${item.productKey} ${item.name}`).join(' ; ') });
      }
    }
  }

  // ---- universe census of Specs values the rules can touch (candidate bundle) --------------
  const candidate = workspace.indexes.candidate;
  const census = candidate.universe.flatMap((key) => {
    const document = candidate.documents.get(key)!;
    return (document.specs ?? []).filter((spec) => spec.status === 'parsed').map((spec) => ({ key, document, spec, quantity: interpretSpecQuantity(document, spec) }));
  }).filter(({ quantity, document }) => quantity.includesUser || quantity.approximate || quantity.scope === 'SUBCOMPONENT'
    || ['EXPLICIT_PAIR', 'MULTI_UNIT_UNQUALIFIED', 'PACK_NAME_TOTAL', 'EXPLICIT_TOTAL', 'COMPONENT_FAMILY_MISMATCH'].includes(quantity.rule)
    || (quantity.rule === 'EXPLICIT_EACH' && (componentCountFromName(document.name) ?? 2) !== 1))
    .map(({ key, document, spec, quantity }) => ({
      dr: quantity.includesUser ? 'DR-01' : quantity.scope === 'SUBCOMPONENT' ? 'DR-03' : quantity.approximate ? 'DR-04' : 'DR-02',
      productKey: key, name: document.name, family: document.productSemantics?.primaryFamily?.code ?? '', key: spec.key, value: spec.value, rawValue: spec.rawValue,
      scope: quantity.scope, appliesTo: quantity.appliesTo, componentCount: quantity.componentCount ?? '', rule: quantity.rule, status: quantity.status, certification: quantity.certification,
      subcomponentExercises: quantity.subcomponentExercises.join('|'),
    }));

  // ---- DR-05: the D transitions REJECTED -> POSSIBLE recorded by V0.2 r2 ---------------------
  const dispositionDiff = parseCsv(await readFile(path.join(V02_RUN, 'candidate_disposition_diff.csv'), 'utf8'));
  const transitions = dispositionDiff.filter((row) => row.variant === 'D' && row.transition === 'REJECTED->POSSIBLE_MATCH');
  const transitionRows = transitions.map((row) => {
    const term = /NEGATIVE_CONFLICTS_WITH_NAME:"([^"]+)"/u.exec(row.v02Blocking ?? '')?.[1] ?? /CLASSIFICATION_CONFLICTS_WITH_NAME:[A-Z_]+~"([^"]+)"/u.exec(row.v02Blocking ?? '')?.[1] ?? '';
    const cause = /NEGATIVE_CONFLICTS_WITH_NAME/u.test(row.v02Blocking ?? '') ? 'NEGATIVE_CONFLICTS_WITH_NAME'
      : /CLASSIFICATION_CONFLICTS_WITH_NAME/u.test(row.v02Blocking ?? '') ? 'CLASSIFICATION_CONFLICTS_WITH_NAME' : /AMBIGUOUS_NEED/u.test(row.v02Blocking ?? '') ? 'AMBIGUITY_GROUP' : 'OTHER';
    const reach = term ? termReach(candidate, term) : null;
    return { queryId: row.queryId, query: row.query, productKey: row.productKey, name: row.name, cause, matchedTermStem: term,
      termReachProducts: reach?.products ?? '', termReachFamilies: reach?.families ?? '', termFamilyCodes: reach?.familyCodes.join('|') ?? '',
      v0HardResults: row.v0HardResults, v02Blocking: row.v02Blocking, v02Groups: row.v02Groups };
  });
  const termStats = Object.entries(transitionRows.filter((row) => row.matchedTermStem).reduce((acc: Record<string, { transitions: number; queries: Set<string>; products: number; families: number; familyCodes: string }>, row) => {
    const entry = acc[row.matchedTermStem] ?? { transitions: 0, queries: new Set<string>(), products: Number(row.termReachProducts), families: Number(row.termReachFamilies), familyCodes: row.termFamilyCodes };
    entry.transitions += 1; entry.queries.add(row.queryId ?? ''); acc[row.matchedTermStem] = entry; return acc;
  }, {})).map(([term, entry]) => ({ termStem: term, tokens: term.split(' ').length, transitions: entry.transitions, queries: [...entry.queries].sort(), productNamesContainingTerm: entry.products, familiesSpanned: entry.families, familyCodes: entry.familyCodes }))
    .sort((left, right) => right.transitions - left.transitions);
  // Whole-lexicon reach of single-token terms that the conflict rule can match (genericity screen).
  const singleTokenTerms = [...new Set(DISCOVER_V0_LEXICON.flatMap((entry) => (entry.type === 'CONCEPT' && ['EXERCISE_CAPABILITY', 'TRAINING_FUNCTION', 'PRODUCT_FAMILY'].includes(entry.axis)) || entry.type === 'AMBIGUOUS' ? entry.terms : [])
    .map((term) => discoverTokens(term).map(stemToken).join(' ')).filter((term) => term && !term.includes(' ')))].sort();
  const genericScreen = singleTokenTerms.map((term) => ({ termStem: term, ...termReach(candidate, term) })).filter((row) => row.families >= 3).sort((left, right) => right.products - left.products);

  const count = (rule: string, variant: 'C' | 'D', predicate: (firing: Firing) => boolean = () => true) => firings.filter((firing) => firing.rule === rule && firing.variant === variant && predicate(firing)).length;
  const byRule = Object.fromEntries(['DR-01_INCLUDES_USER', 'DR-02_PAIR_PACK_SCOPE', 'DR-03_SUBCOMPONENT_CAPABILITY', 'DR-04_APPROXIMATE_QUANTITY', 'DR-05_NAME_CONFLICT'].map((rule) => [rule, Object.fromEntries((['C', 'D'] as const).map((variant) => [variant, {
    firings: count(rule, variant), satisfied: count(rule, variant, (firing) => firing.state === 'SATISFIED'), violated: count(rule, variant, (firing) => firing.state === 'VIOLATED'),
    unknown: count(rule, variant, (firing) => firing.state === 'UNKNOWN'), satisfiedAndVerified: count(rule, variant, (firing) => firing.state === 'SATISFIED' && firing.disposition === 'VERIFIED_MATCH'),
    queries: [...new Set(firings.filter((firing) => firing.rule === rule && firing.variant === variant).map((firing) => firing.queryId))].sort(),
  }]))]));

  const evidence = {
    generatedAt: new Date().toISOString(), node: process.version, purpose: 'Evidence for CAT-DISCOVER-G1 domain-review packets DR-01..DR-06. Development benchmark only; NOT relevance gold; NOT a decision.',
    benchmark: { version: benchmark.benchmarkVersion, sha256: sha(queriesBytes), use: 'DEVELOPMENT_SET_EVIDENCE_ONLY' },
    code: 'worktree V0.2 (see v02_frozen_authority.json for hashes)', bundles: { C: workspace.production.input.bundleId, D: workspace.candidate.input.bundleId },
    selfConsistency: { recomputedDispositionMismatches: selfConsistency.length, sample: selfConsistency.slice(0, 20) },
    byRule, pairNamingQueries: pairQueries, ambiguityGroups: groupRows,
    dr05: { transitionsD: transitionRows.length, byCause: transitionRows.reduce((acc: Record<string, number>, row) => { acc[row.cause] = (acc[row.cause] ?? 0) + 1; return acc; }, {}), termStats, genericSingleTokenScreen: genericScreen },
    census: { rows: census.length, byDr: census.reduce((acc: Record<string, number>, row) => { acc[row.dr] = (acc[row.dr] ?? 0) + 1; return acc; }, {}),
      byRule: census.reduce((acc: Record<string, number>, row) => { acc[`${row.dr}:${row.rule}:${row.certification}`] = (acc[`${row.dr}:${row.rule}:${row.certification}`] ?? 0) + 1; return acc; }, {}) },
    nameNamesConceptCheck: typeof nameNamesConcept === 'function',
  };
  const write = (file: string, content: string) => writeFile(path.join(runDir, file), content, { flag: 'wx' });
  await write('domain_review_evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
  await write('dr_firings.csv', csv(firings, ['rule', 'variant', 'queryId', 'query', 'productKey', 'name', 'family', 'constraint', 'state', 'reason', 'evidence', 'disposition', 'poolRank', 'inTop8']));
  await write('dr_spec_census.csv', csv(census, Object.keys(census[0]!)));
  await write('dr05_rejected_to_possible.csv', csv(transitionRows, Object.keys(transitionRows[0]!)));
  console.log(JSON.stringify({ byRule: Object.fromEntries(Object.entries(byRule).map(([rule, value]) => [rule, value.D])), dr05: evidence.dr05.byCause, census: evidence.census.byDr, selfConsistency: selfConsistency.length }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
