import { createHash } from 'node:crypto';
import { validateHeldout } from '../discover-v0/heldout.js';

/*
 * CAT-DISCOVER-G1 relevance gold contract (discover-g1-relevance-labels-v1).
 *
 * The held-out QUERY file keeps the existing contract (discover-heldout-contract-v1,
 * validated by heldout.ts) and is frozen first. Relevance LABELS live in a separate,
 * later-frozen file that points at the query file by sha256, so labels can never
 * silently follow an edited query set. Labels are human-only: there is no field for
 * a model-produced label and the validator rejects any labelSource other than
 * HUMAN_ADJUDICATED.
 */

export const LABELS_CONTRACT_VERSION = 'discover-g1-relevance-labels-v1';

export const INTENT_CLASSES = ['EXACT_PRODUCT', 'PRODUCT_TYPE', 'CAPABILITY_OR_EXERCISE', 'SPEC_CONSTRAINED', 'USE_CONTEXT_OR_GOAL', 'MULTI_PRODUCT_OR_BUNDLE', 'COMPATIBILITY_OR_SUBSTITUTE', 'OUT_OF_SCOPE', 'OTHER'] as const;
export const GRADES = ['RELEVANT', 'PARTIAL', 'NOT_RELEVANT', 'VIOLATES_CONSTRAINT', 'INSUFFICIENT_INFORMATION'] as const;
export const BEHAVIORS = ['ANSWER', 'ANSWER_WITH_CAVEATS', 'CLARIFY', 'ABSTAIN'] as const;
export const CONSTRAINT_KINDS = ['PRODUCT_TYPE', 'EXERCISE', 'TRAINING_FUNCTION', 'ANATOMY', 'DISCIPLINE', 'USE_CONTEXT', 'SPEC', 'COMMERCIAL_MAX_PRICE', 'COMMERCIAL_AVAILABILITY', 'COMPATIBILITY', 'OTHER'] as const;
export const EVIDENCE_LEVELS = ['E1', 'E2', 'E3'] as const;

export type Grade = typeof GRADES[number];
export type GoldConstraint = {
  id: string; text: string; kind: typeof CONSTRAINT_KINDS[number];
  /** Ontology/registry code(s) the reviewer picked from the provided picklist (any-of). */
  codes?: string[];
  specKey?: string; operator?: 'EQ' | 'GTE' | 'LTE'; value?: number; unit?: string;
  /** Physical scope for quantities as the reviewer understands the query (PER_UNIT, PER_PAIR, PACK_TOTAL, PRODUCT_TOTAL, USER_CAPACITY…). */
  scope?: string;
};
export type GoldJudgment = {
  productKey: string;
  grade: Grade;
  /** Per mandatory constraint: MET / NOT_MET / CANNOT_DETERMINE (from evidence, not from the system). */
  constraintJudgments?: Record<string, 'MET' | 'NOT_MET' | 'CANNOT_DETERMINE'>;
  evidence: { level: typeof EVIDENCE_LEVELS[number]; ref: string }[];
  foundBy: 'POOL' | 'INDEPENDENT_SEARCH' | 'BOTH';
  note?: string;
};
export type GoldQuery = {
  queryId: string;
  queryClass: string;
  intent: { commercialIntent: string; intentClass: typeof INTENT_CLASSES[number] };
  interpretations: { valid: string[]; ambiguous: boolean; ambiguousReadings: string[] };
  mandatoryConstraints: GoldConstraint[];
  preferences: { id: string; text: string }[];
  expectedBehavior: typeof BEHAVIORS[number];
  insufficientInformation: boolean;
  judgments: GoldJudgment[];
  pool: { systemPooled: boolean; independentSearch: boolean; independentSearchLog: string[]; exhaustive: false | { proof: string } };
  adjudication: { status: 'ADJUDICATED' | 'NOT_ADJUDICATED'; reviewers: string[]; adjudicator: string | null; disagreements: number; cohenKappa: number | null };
};
export type GoldLabels = {
  labelsVersion: string; contractVersion: string; frozenAt: string; labelSource: string;
  heldout: { heldoutVersion: string; sha256: string };
  catalogObservation: string;
  usedForTuning: boolean;
  queries: GoldQuery[];
};
export type HeldoutQueries = Parameters<typeof validateHeldout>[0] & { queries: (Parameters<typeof validateHeldout>[0]['queries'][number] & { queryClass?: string })[] };

export const sha256 = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/**
 * G1 extension of discover-heldout-contract-v1 (heldout.ts is part of the frozen V0.2
 * code and is not edited). A third source, PRODUCT_REVIEWER_TECHNICAL_CASE, is accepted
 * only with a written attestation that the reviewer never saw V0/V0.2 rankings, and at
 * most 30 % of the set, so the held-out stays mainly commercial language.
 */
export const TECHNICAL_CASE_SOURCE = 'PRODUCT_REVIEWER_TECHNICAL_CASE';
export const TECHNICAL_CASE_MAX_SHARE = 0.3;
export function validateHeldoutG1(file: HeldoutQueries, developmentQueries: readonly string[]): string[] {
  const technical = file.queries.filter((query) => query.source === TECHNICAL_CASE_SOURCE);
  const errors = validateHeldout(file, developmentQueries).filter((error) => !technical.some((query) => error === `SOURCE_NOT_ALLOWED:${query.queryId}:${TECHNICAL_CASE_SOURCE}`));
  for (const query of technical as (typeof technical[number] & { attestation?: { reviewer?: string; notExposedToRankings?: boolean } })[]) {
    if (!query.attestation?.reviewer || query.attestation.notExposedToRankings !== true) errors.push(`TECHNICAL_CASE_WITHOUT_ATTESTATION:${query.queryId}`);
  }
  if (file.queries.length > 0 && technical.length / file.queries.length > TECHNICAL_CASE_MAX_SHARE) errors.push(`TECHNICAL_CASE_SHARE:${technical.length}/${file.queries.length} (max ${TECHNICAL_CASE_MAX_SHARE * 100} %)`);
  return errors;
}

/** Errors that make a label file unusable for an OFFICIAL evaluation (empty = valid). */
export function validateGoldLabels(labels: GoldLabels, heldout: HeldoutQueries, heldoutSha256: string, sourceExtractionId: string): string[] {
  const errors: string[] = [];
  if (labels.contractVersion !== LABELS_CONTRACT_VERSION) errors.push(`CONTRACT_VERSION:${labels.contractVersion}`);
  if (labels.labelSource !== 'HUMAN_ADJUDICATED') errors.push(`LABEL_SOURCE_NOT_HUMAN:${labels.labelSource}`);
  if (labels.usedForTuning !== false) errors.push('USED_FOR_TUNING');
  if (!labels.frozenAt || Number.isNaN(Date.parse(labels.frozenAt))) errors.push('LABELS_NOT_FROZEN');
  if (labels.heldout.sha256 !== heldoutSha256) errors.push('HELDOUT_HASH_MISMATCH: labels were produced for a different query file');
  if (labels.heldout.heldoutVersion !== heldout.heldoutVersion) errors.push('HELDOUT_VERSION_MISMATCH');
  if (labels.catalogObservation !== sourceExtractionId || heldout.catalogObservation !== sourceExtractionId) errors.push('CATALOG_OBSERVATION_MISMATCH');
  if (Date.parse(labels.frozenAt) < Date.parse(heldout.frozenAt)) errors.push('LABELS_FROZEN_BEFORE_QUERIES');
  const queryIds = new Set(heldout.queries.map((query) => query.queryId));
  const labelled = new Set<string>();
  for (const query of labels.queries) {
    const id = query.queryId;
    if (!queryIds.has(id)) errors.push(`UNKNOWN_QUERY:${id}`);
    if (labelled.has(id)) errors.push(`DUPLICATE_LABEL:${id}`);
    labelled.add(id);
    const adjudication = query.adjudication;
    if (adjudication.status !== 'ADJUDICATED') errors.push(`NOT_ADJUDICATED:${id}`);
    if (adjudication.reviewers.length !== 2 || adjudication.reviewers[0] === adjudication.reviewers[1]) errors.push(`TWO_DISTINCT_REVIEWERS_REQUIRED:${id}`);
    if (!adjudication.adjudicator || adjudication.reviewers.includes(adjudication.adjudicator)) errors.push(`DISTINCT_ADJUDICATOR_REQUIRED:${id}`);
    if (!INTENT_CLASSES.includes(query.intent.intentClass)) errors.push(`INTENT_CLASS:${id}`);
    if (!BEHAVIORS.includes(query.expectedBehavior)) errors.push(`BEHAVIOR:${id}`);
    if (query.interpretations.ambiguous && query.interpretations.ambiguousReadings.length < 2) errors.push(`AMBIGUOUS_NEEDS_TWO_READINGS:${id}`);
    if (!query.pool.systemPooled || !query.pool.independentSearch) errors.push(`POOL_INCOMPLETE:${id}`);
    if (query.pool.exhaustive !== false && !query.pool.exhaustive.proof) errors.push(`EXHAUSTIVENESS_WITHOUT_PROOF:${id}`);
    const constraintIds = new Set(query.mandatoryConstraints.map((constraint) => constraint.id));
    const seen = new Set<string>();
    for (const constraint of query.mandatoryConstraints) if (!CONSTRAINT_KINDS.includes(constraint.kind)) errors.push(`CONSTRAINT_KIND:${id}:${constraint.id}`);
    for (const judgment of query.judgments) {
      if (seen.has(judgment.productKey)) errors.push(`DUPLICATE_JUDGMENT:${id}:${judgment.productKey}`);
      seen.add(judgment.productKey);
      if (!GRADES.includes(judgment.grade)) errors.push(`GRADE:${id}:${judgment.productKey}`);
      if ((judgment.grade === 'RELEVANT' || judgment.grade === 'VIOLATES_CONSTRAINT') && judgment.evidence.length === 0) errors.push(`EVIDENCE_REQUIRED:${id}:${judgment.productKey}`);
      if (judgment.evidence.some((item) => !EVIDENCE_LEVELS.includes(item.level))) errors.push(`EVIDENCE_LEVEL:${id}:${judgment.productKey}`);
      for (const key of Object.keys(judgment.constraintJudgments ?? {})) if (!constraintIds.has(key)) errors.push(`UNKNOWN_CONSTRAINT_JUDGED:${id}:${judgment.productKey}:${key}`);
      if (judgment.grade === 'VIOLATES_CONSTRAINT' && !Object.values(judgment.constraintJudgments ?? {}).includes('NOT_MET')) errors.push(`VIOLATION_WITHOUT_CONSTRAINT:${id}:${judgment.productKey}`);
    }
  }
  for (const id of queryIds) if (!labelled.has(id)) errors.push(`QUERY_WITHOUT_LABELS:${id}`);
  return errors;
}

export type Readiness = { ready: boolean; blocking: string[]; heldoutErrors: string[]; labelErrors: string[]; queries: number; adjudicated: number };

/** Whether an OFFICIAL benchmark may run. Missing inputs are blocking, never defaulted. */
export function evaluationReadiness(input: { heldout: HeldoutQueries | null; heldoutSha256: string | null; labels: GoldLabels | null; developmentQueries: readonly string[]; sourceExtractionId: string }): Readiness {
  const blocking: string[] = [];
  if (!input.heldout || !input.heldoutSha256) {
    blocking.push('HELDOUT_QUERIES_MISSING');
    return { ready: false, blocking, heldoutErrors: [], labelErrors: [], queries: 0, adjudicated: 0 };
  }
  const heldoutErrors = validateHeldoutG1(input.heldout, input.developmentQueries);
  if (heldoutErrors.length > 0) blocking.push('HELDOUT_INVALID');
  if (!input.labels) blocking.push('RELEVANCE_LABELS_MISSING');
  const labelErrors = input.labels ? validateGoldLabels(input.labels, input.heldout, input.heldoutSha256, input.sourceExtractionId) : [];
  if (labelErrors.length > 0) blocking.push('RELEVANCE_LABELS_INVALID');
  return { ready: blocking.length === 0, blocking, heldoutErrors, labelErrors, queries: input.heldout.queries.length,
    adjudicated: input.labels?.queries.filter((query) => query.adjudication.status === 'ADJUDICATED').length ?? 0 };
}
