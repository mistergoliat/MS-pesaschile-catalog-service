import { percentile } from '../../../src/application/catalog/discover-v0/evaluation.js';
import type { GoldConstraint, GoldQuery } from './goldContract.js';

/*
 * CAT-DISCOVER-G1 gold metrics. Pure functions over (a) one engine run normalized by
 * engineAdapter and (b) one ADJUDICATED gold query. They never look at engine scores
 * to decide relevance; unjudged products count as not relevant and the judged
 * coverage of every ranked list is reported next to the metric.
 */

export type Disposition = 'VERIFIED_MATCH' | 'POSSIBLE_MATCH' | 'REJECTED' | 'NOT_IN_EVALUATED_POOL';
export type EngineConstraint = { kind: string; codes?: string[]; specKey?: string; operator?: string; value?: number; groupId?: string };
export type NormalizedRun = {
  engine: string; variant: 'A' | 'B' | 'C' | 'D'; queryId: string;
  /** Comparable top-8 across variants (exact entities, then ranked non-rejected pool). */
  ranked: string[];
  /** What an agent is shown: exact, VERIFIED, POSSIBLE (deduplicated, original order). */
  presented: string[];
  verified: string[]; possible: string[];
  /** Disposition of every product the engine evaluated (whole pool), when the engine verifies. */
  dispositions: Record<string, Disposition> | null;
  interpretation: { hardConstraints: EngineConstraint[]; ambiguityGroups: number; exactResolved: boolean } | null;
  noResultReason: string | null; warnings: string[];
  operation: { firstMs: number; warmMedianMs: number | null; bytes: number; agentBytes: number | null; lexicalTruncated: boolean | null; degraded: string[]; hydrationBounded: boolean | null; hydrationRequested: number | null; technicallyConforming: number | null };
};

const GAIN: Record<string, number> = { RELEVANT: 2, PARTIAL: 1 };
const gradeOf = (gold: GoldQuery) => new Map(gold.judgments.map((judgment) => [judgment.productKey, judgment.grade]));

export function retrievalMetrics(ranked: readonly string[], gold: GoldQuery) {
  const grades = gradeOf(gold);
  const relevant = gold.judgments.filter((judgment) => judgment.grade === 'RELEVANT').map((judgment) => judgment.productKey);
  const top8 = ranked.slice(0, 8);
  const top3 = ranked.slice(0, 3);
  const isRelevant = (key: string) => grades.get(key) === 'RELEVANT';
  const dcg = top8.reduce((sum, key, position) => sum + ((2 ** (GAIN[grades.get(key) ?? ''] ?? 0)) - 1) / Math.log2(position + 2), 0);
  const idealGains = gold.judgments.map((judgment) => GAIN[judgment.grade] ?? 0).filter((gain) => gain > 0).sort((left, right) => right - left).slice(0, 8);
  const idcg = idealGains.reduce((sum, gain, position) => sum + ((2 ** gain) - 1) / Math.log2(position + 2), 0);
  const firstRelevant = top8.findIndex(isRelevant);
  return {
    relevantKnown: relevant.length,
    recallAt8: relevant.length === 0 ? null : top8.filter(isRelevant).length / relevant.length,
    precisionAt3: top3.length === 0 ? 0 : top3.filter(isRelevant).length / 3,
    precisionAt3Lenient: top3.length === 0 ? 0 : top3.filter((key) => grades.get(key) === 'RELEVANT' || grades.get(key) === 'PARTIAL').length / 3,
    mrr: firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1),
    ndcgAt8: idcg === 0 ? null : dcg / idcg,
    missedRelevant: relevant.filter((key) => !top8.includes(key)),
    judgedCoverageAt8: top8.length === 0 ? null : top8.filter((key) => grades.has(key)).length / top8.length,
    unjudgedInTop8: top8.filter((key) => !grades.has(key)),
  };
}

export function verificationMetrics(run: NormalizedRun, gold: GoldQuery) {
  if (!run.dispositions) return null;
  const disposition = (key: string): Disposition => run.dispositions![key] ?? 'NOT_IN_EVALUATED_POOL';
  const tally = { correctlyVerified: 0, incorrectlyVerified: 0, verifiedUnjudged: 0, falseExclusions: 0, possibleRelevant: 0, relevantNotInEvaluatedPool: 0,
    constraintsCorrectlySatisfied: 0, constraintsIncorrectlySatisfied: 0, overclaims: [] as string[], falseExcluded: [] as string[] };
  const judged = new Map(gold.judgments.map((judgment) => [judgment.productKey, judgment]));
  for (const key of run.verified) {
    const judgment = judged.get(key);
    if (!judgment) { tally.verifiedUnjudged += 1; continue; }
    const notMet = Object.values(judgment.constraintJudgments ?? {}).filter((value) => value === 'NOT_MET').length;
    const met = Object.values(judgment.constraintJudgments ?? {}).filter((value) => value === 'MET').length;
    tally.constraintsCorrectlySatisfied += met;
    tally.constraintsIncorrectlySatisfied += notMet;
    if (judgment.grade === 'VIOLATES_CONSTRAINT' || notMet > 0) { tally.incorrectlyVerified += 1; tally.overclaims.push(key); } else if (judgment.grade === 'RELEVANT' || judgment.grade === 'PARTIAL') tally.correctlyVerified += 1;
  }
  for (const judgment of gold.judgments.filter((item) => item.grade === 'RELEVANT')) {
    const state = disposition(judgment.productKey);
    if (state === 'REJECTED') { tally.falseExclusions += 1; tally.falseExcluded.push(judgment.productKey); }
    if (state === 'POSSIBLE_MATCH') tally.possibleRelevant += 1;
    if (state === 'NOT_IN_EVALUATED_POOL') tally.relevantNotInEvaluatedPool += 1;
  }
  const noVerified = run.verified.length === 0;
  const relevantExists = gold.judgments.some((judgment) => judgment.grade === 'RELEVANT');
  const abstention = !noVerified ? 'ANSWERED'
    : (gold.expectedBehavior === 'CLARIFY' || gold.expectedBehavior === 'ABSTAIN' || !relevantExists || gold.insufficientInformation) ? 'JUSTIFIED_ABSTENTION' : 'UNJUSTIFIED_ABSTENTION';
  return { ...tally, abstention };
}

/** Engine constraint ↔ gold constraint, on structured fields only (text-only gold constraints are "not comparable"). */
export function constraintMatches(engine: EngineConstraint, gold: GoldConstraint): boolean {
  if (gold.kind === 'SPEC') {
    return engine.kind === 'SPEC' && engine.specKey === gold.specKey && engine.operator === gold.operator && engine.value !== undefined && gold.value !== undefined
      && Math.abs(engine.value - gold.value) <= Math.max(0.01 * gold.value, 0.05);
  }
  return engine.kind === gold.kind && (gold.codes ?? []).some((code) => (engine.codes ?? []).includes(code));
}

/** Intent the engine expressed, by a FIXED mapping declared in evaluation_plan.json before any labels exist. */
export function engineIntentClass(interpretation: NonNullable<NormalizedRun['interpretation']>): string {
  const kinds = new Set(interpretation.hardConstraints.map((constraint) => constraint.kind));
  if (interpretation.exactResolved) return 'EXACT_PRODUCT';
  if (kinds.has('COMPATIBILITY') || kinds.has('SUBSTITUTION')) return 'COMPATIBILITY_OR_SUBSTITUTE';
  if (kinds.has('BUNDLE_COMPONENT')) return 'MULTI_PRODUCT_OR_BUNDLE';
  if (kinds.has('SPEC')) return 'SPEC_CONSTRAINED';
  if (kinds.has('EXERCISE') || kinds.has('TRAINING_FUNCTION') || kinds.has('ANATOMY')) return 'CAPABILITY_OR_EXERCISE';
  if (kinds.has('DISCIPLINE') || kinds.has('USE_CONTEXT')) return 'USE_CONTEXT_OR_GOAL';
  if (kinds.has('PRODUCT_TYPE')) return 'PRODUCT_TYPE';
  return 'OUT_OF_SCOPE';
}

export function interpretationMetrics(run: NormalizedRun, gold: GoldQuery) {
  if (!run.interpretation) return null;
  const engine = run.interpretation.hardConstraints;
  const comparable = gold.mandatoryConstraints.filter((constraint) => constraint.kind !== 'OTHER' && (constraint.kind === 'SPEC' ? constraint.specKey : (constraint.codes ?? []).length > 0));
  const missing = comparable.filter((constraint) => !engine.some((item) => constraintMatches(item, constraint))).map((constraint) => constraint.id);
  const spurious = engine.filter((item) => !item.groupId && !['NOMINAL_TEXT', 'UNMODELED_NEED', 'VARIANT_ATTRIBUTE'].includes(item.kind)
    && !gold.mandatoryConstraints.some((constraint) => constraintMatches(item, constraint))).map((item) => `${item.kind}:${item.specKey ?? (item.codes ?? []).join('|')}`);
  const engineAsksClarification = run.noResultReason === 'AMBIGUOUS_NEED_UNRESOLVED' || run.warnings.includes('AMBIGUOUS_NEED');
  return {
    intentEngine: engineIntentClass(run.interpretation), intentGold: gold.intent.intentClass, intentCorrect: engineIntentClass(run.interpretation) === gold.intent.intentClass,
    ambiguityGold: gold.interpretations.ambiguous, ambiguityEngine: run.interpretation.ambiguityGroups > 0,
    missingConstraints: missing, spuriousConstraints: spurious, notComparableGoldConstraints: gold.mandatoryConstraints.length - comparable.length,
    clarification: { goldExpects: gold.expectedBehavior === 'CLARIFY', engineSignals: engineAsksClarification },
  };
}

// ---- aggregation with uncertainty ---------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean with a seeded percentile-bootstrap 95% interval over queries (nulls are excluded and counted). */
export function meanWithInterval(values: readonly (number | null)[], resamples = 2000, seed = 20261008) {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return { n: 0, excludedNull: values.length, mean: null, ci95: null };
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length;
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let iteration = 0; iteration < resamples; iteration += 1) {
    let sum = 0;
    for (let draw = 0; draw < present.length; draw += 1) sum += present[Math.floor(random() * present.length)]!;
    means.push(sum / present.length);
  }
  return { n: present.length, excludedNull: values.length - present.length, mean, ci95: [percentile(means, 2.5), percentile(means, 97.5)] as const };
}

/** Minimum queries per class for a class-level estimate to be reported as more than descriptive. */
export const MIN_CLASS_N = 20;
export const estimability = (n: number) => (n >= MIN_CLASS_N ? 'ESTIMATE_WITH_WIDE_INTERVAL' : 'DESCRIPTIVE_ONLY_INSUFFICIENT_N');
