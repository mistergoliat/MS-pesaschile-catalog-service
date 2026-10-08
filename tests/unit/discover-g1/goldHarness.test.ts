import { describe, expect, it } from 'vitest';
import { evaluationReadiness, LABELS_CONTRACT_VERSION, TECHNICAL_CASE_SOURCE, validateGoldLabels, validateHeldoutG1, type GoldLabels, type GoldQuery, type HeldoutQueries } from '../../../scripts/catalog-v2/discover-g1/goldContract.js';
import { normalizeRun } from '../../../scripts/catalog-v2/discover-g1/engineAdapter.js';
import { engineIntentClass, estimability, interpretationMetrics, meanWithInterval, retrievalMetrics, verificationMetrics, type NormalizedRun } from '../../../scripts/catalog-v2/discover-g1/goldMetrics.js';

/* SYNTHETIC: structural checks of the G1 gold contract and metrics. Queries, products and labels are placeholders, NOT a gold set. */

const SOURCE = 'sha256:source';
const heldout = (count: number): HeldoutQueries => ({ heldoutVersion: 'h1', frozenAt: '2026-10-09T00:00:00.000Z', usedForTuning: false, catalogObservation: SOURCE,
  queries: Array.from({ length: count }, (_value, offset) => ({ queryId: `H${String(offset + 1).padStart(3, '0')}`, query: `consulta placeholder ${offset + 1}`, source: 'SALES_TEAM_ELICITATION', adjudication: { status: 'NOT_ADJUDICATED' } })) });

const goldQuery = (queryId: string, overrides: Partial<GoldQuery> = {}): GoldQuery => ({
  queryId, queryClass: 'SPEC', intent: { commercialIntent: 'placeholder', intentClass: 'SPEC_CONSTRAINED' },
  interpretations: { valid: ['a'], ambiguous: false, ambiguousReadings: [] },
  mandatoryConstraints: [{ id: 'GC1', text: 'pesa 20 kg', kind: 'SPEC', specKey: 'weight_kg', operator: 'EQ', value: 20, scope: 'PER_UNIT' }, { id: 'GC2', text: 'kettlebell', kind: 'PRODUCT_TYPE', codes: ['KETTLEBELL'] }],
  preferences: [], expectedBehavior: 'ANSWER', insufficientInformation: false,
  judgments: [
    { productKey: 'P1', grade: 'RELEVANT', constraintJudgments: { GC1: 'MET', GC2: 'MET' }, evidence: [{ level: 'E1', ref: 'name+features' }], foundBy: 'BOTH' },
    { productKey: 'P2', grade: 'RELEVANT', constraintJudgments: { GC1: 'MET', GC2: 'MET' }, evidence: [{ level: 'E2', ref: 'url@2026-10-09' }], foundBy: 'INDEPENDENT_SEARCH' },
    { productKey: 'P3', grade: 'PARTIAL', evidence: [], foundBy: 'POOL' },
    { productKey: 'P4', grade: 'VIOLATES_CONSTRAINT', constraintJudgments: { GC1: 'NOT_MET' }, evidence: [{ level: 'E1', ref: '16 kg' }], foundBy: 'POOL' },
  ],
  pool: { systemPooled: true, independentSearch: true, independentSearchLog: ['busqueda tienda: kettlebell 20'], exhaustive: false },
  adjudication: { status: 'ADJUDICATED', reviewers: ['rev-a', 'rev-b'], adjudicator: 'rev-c', disagreements: 1, cohenKappa: 0.7 },
  ...overrides,
});
const labels = (queries: GoldQuery[], sha = 'sha256:heldout'): GoldLabels => ({ labelsVersion: 'l1', contractVersion: LABELS_CONTRACT_VERSION, frozenAt: '2026-10-20T00:00:00.000Z',
  labelSource: 'HUMAN_ADJUDICATED', heldout: { heldoutVersion: 'h1', sha256: sha }, catalogObservation: SOURCE, usedForTuning: false, queries });

const run = (overrides: Partial<NormalizedRun> = {}): NormalizedRun => ({
  engine: 'X', variant: 'D', queryId: 'H001', ranked: ['P4', 'P1', 'P9'], presented: ['P4', 'P1'], verified: ['P4'], possible: ['P1'],
  dispositions: { P4: 'VERIFIED_MATCH', P1: 'POSSIBLE_MATCH', P2: 'REJECTED' },
  interpretation: { hardConstraints: [{ kind: 'SPEC', specKey: 'weight_kg', operator: 'EQ', value: 20 }, { kind: 'PRODUCT_TYPE', codes: ['KETTLEBELL'] }], ambiguityGroups: 0, exactResolved: false },
  noResultReason: null, warnings: [], operation: { firstMs: 1, warmMedianMs: 1, bytes: 10, agentBytes: 5, lexicalTruncated: false, degraded: [], hydrationBounded: false, hydrationRequested: 0, technicallyConforming: 0 },
  ...overrides,
});

describe('G1 gold label contract', () => {
  it('accepts complete, human, double-reviewed, adjudicated labels bound to the frozen query file', () => {
    const file = heldout(80);
    expect(validateGoldLabels(labels(file.queries.map((query) => goldQuery(query.queryId))), file, 'sha256:heldout', SOURCE)).toEqual([]);
  });

  it('rejects model labels, unbound files, missing reviewers, unproven exhaustiveness and unlabelled queries', () => {
    const file = heldout(3);
    const bad = labels([
      goldQuery('H001', { adjudication: { status: 'ADJUDICATED', reviewers: ['rev-a', 'rev-a'], adjudicator: 'rev-a', disagreements: 0, cohenKappa: null } }),
      goldQuery('H002', { pool: { systemPooled: true, independentSearch: false, independentSearchLog: [], exhaustive: { proof: '' } } }),
    ], 'sha256:other');
    const errors = validateGoldLabels({ ...bad, labelSource: 'LLM' }, file, 'sha256:heldout', SOURCE);
    expect(errors).toEqual(expect.arrayContaining(['LABEL_SOURCE_NOT_HUMAN:LLM', 'HELDOUT_HASH_MISMATCH: labels were produced for a different query file', 'TWO_DISTINCT_REVIEWERS_REQUIRED:H001',
      'DISTINCT_ADJUDICATOR_REQUIRED:H001', 'POOL_INCOMPLETE:H002', 'EXHAUSTIVENESS_WITHOUT_PROOF:H002', 'QUERY_WITHOUT_LABELS:H003']));
  });

  it('accepts attested product-reviewer technical cases up to 30 % of the set and nothing beyond', () => {
    const file = heldout(80);
    file.queries.slice(0, 20).forEach((query) => Object.assign(query, { source: TECHNICAL_CASE_SOURCE, attestation: { reviewer: 'rev-p', notExposedToRankings: true } }));
    file.queries[20] = { ...file.queries[20]!, source: TECHNICAL_CASE_SOURCE };
    expect(validateHeldoutG1(file, [])).toEqual(['TECHNICAL_CASE_WITHOUT_ATTESTATION:H021']);
    file.queries.slice(21, 30).forEach((query) => Object.assign(query, { source: TECHNICAL_CASE_SOURCE, attestation: { reviewer: 'rev-p', notExposedToRankings: true } }));
    expect(validateHeldoutG1(file, [])).toEqual(expect.arrayContaining(['TECHNICAL_CASE_SHARE:30/80 (max 30 %)']));
  });

  it('blocks the official evaluation when queries or labels are missing (never defaults them)', () => {
    expect(evaluationReadiness({ heldout: null, heldoutSha256: null, labels: null, developmentQueries: [], sourceExtractionId: SOURCE }).blocking).toEqual(['HELDOUT_QUERIES_MISSING']);
    const readiness = evaluationReadiness({ heldout: heldout(80), heldoutSha256: 'sha256:heldout', labels: null, developmentQueries: [], sourceExtractionId: SOURCE });
    expect(readiness.ready).toBe(false);
    expect(readiness.blocking).toEqual(['RELEVANCE_LABELS_MISSING']);
  });
});

describe('G1 gold metrics', () => {
  it('computes graded retrieval metrics and reports judged coverage and missed relevant products', () => {
    const metrics = retrievalMetrics(['P4', 'P1', 'P9'], goldQuery('H001'));
    expect(metrics.recallAt8).toBe(0.5);
    expect(metrics.precisionAt3).toBeCloseTo(1 / 3);
    expect(metrics.mrr).toBe(0.5);
    expect(metrics.missedRelevant).toEqual(['P2']);
    expect(metrics.unjudgedInTop8).toEqual(['P9']);
    expect(metrics.ndcgAt8).toBeGreaterThan(0);
    expect(metrics.ndcgAt8).toBeLessThan(1);
  });

  it('counts an over-claim, a false exclusion and a relevant POSSIBLE separately', () => {
    const verification = verificationMetrics(run(), goldQuery('H001'))!;
    expect(verification.incorrectlyVerified).toBe(1);
    expect(verification.overclaims).toEqual(['P4']);
    expect(verification.falseExclusions).toBe(1);
    expect(verification.possibleRelevant).toBe(1);
    expect(verification.constraintsIncorrectlySatisfied).toBe(1);
    expect(verification.abstention).toBe('ANSWERED');
  });

  it('distinguishes justified from unjustified abstention', () => {
    expect(verificationMetrics(run({ verified: [] }), goldQuery('H001'))!.abstention).toBe('UNJUSTIFIED_ABSTENTION');
    expect(verificationMetrics(run({ verified: [] }), goldQuery('H001', { expectedBehavior: 'CLARIFY' }))!.abstention).toBe('JUSTIFIED_ABSTENTION');
  });

  it('compares interpretation on structured fields only and flags missed ambiguity', () => {
    const metrics = interpretationMetrics(run({ interpretation: { hardConstraints: [{ kind: 'SPEC', specKey: 'weight_kg', operator: 'EQ', value: 16 }], ambiguityGroups: 0, exactResolved: false } }),
      goldQuery('H001', { interpretations: { valid: ['a', 'b'], ambiguous: true, ambiguousReadings: ['a', 'b'] } }))!;
    expect(metrics.intentCorrect).toBe(true);
    expect(metrics.missingConstraints).toEqual(['GC1', 'GC2']);
    expect(metrics.spuriousConstraints).toEqual(['SPEC:weight_kg']);
    expect(metrics.ambiguityGold && !metrics.ambiguityEngine).toBe(true);
    expect(engineIntentClass({ hardConstraints: [], ambiguityGroups: 0, exactResolved: true })).toBe('EXACT_PRODUCT');
  });

  it('reports a deterministic bootstrap interval and refuses class estimates below the minimum n', () => {
    const first = meanWithInterval([1, 0, 1, 1, null]);
    expect(first).toEqual(meanWithInterval([1, 0, 1, 1, null]));
    expect(first.n).toBe(4);
    expect(first.excludedNull).toBe(1);
    expect(estimability(12)).toBe('DESCRIPTIVE_ONLY_INSUFFICIENT_N');
    expect(estimability(25)).toBe('ESTIMATE_WITH_WIDE_INTERVAL');
  });

  it('normalizes both engine generations (V0 eligibility and V0.2 disposition)', () => {
    const v0 = normalizeRun('V0', 'H001', { variant: 'C', primary: ['P1'], unverified: ['P2'], retrieval: ['P1', 'P2'], timings: { total: 2 }, bytes: 9,
      discover: { response: { interpretation: { hardConstraints: [] }, completeness: { noResultReason: null, degraded: [] } }, diagnostics: { nominalLookup: false, pool: [{ productKey: 'P1', eligibility: 'ELIGIBLE' }, { productKey: 'P2', eligibility: 'UNVERIFIED' }], excluded: [{ productKey: 'P3' }] } } }, [1, 2, 3]);
    expect(v0.dispositions).toEqual({ P1: 'VERIFIED_MATCH', P2: 'POSSIBLE_MATCH', P3: 'REJECTED' });
    expect(v0.operation.agentBytes).toBeNull();
    const v02 = normalizeRun('V0.2', 'H001', { variant: 'D', primary: ['P1'], unverified: [], exact: ['P7'], retrieval: ['P7', 'P1'], timings: { total: 2 }, bytes: 9, agentBytes: 4,
      discover: { agent: { completeness: { warnings: ['AMBIGUOUS_NEED'] } }, response: { interpretation: { hardConstraints: [], ambiguityGroups: [{}] }, exactResolution: { status: 'RESOLVED', entities: [{ productKey: 'P7', disposition: 'POSSIBLE_MATCH' }] }, completeness: { noResultReason: null, degraded: [] } },
        diagnostics: { pool: [{ productKey: 'P1', disposition: 'VERIFIED_MATCH' }], verifiedKeys: ['P1', 'P8'], possibleKeys: [], rejected: [], lexical: { truncated: true }, hydration: { requested: [], technicallyConforming: 2 } } } }, [1]);
    expect(v02.presented).toEqual(['P7', 'P1']);
    expect(v02.dispositions).toEqual({ P1: 'VERIFIED_MATCH', P8: 'VERIFIED_MATCH', P7: 'POSSIBLE_MATCH' });
    expect(v02.interpretation).toMatchObject({ ambiguityGroups: 1, exactResolved: true });
    expect(v02.operation.lexicalTruncated).toBe(true);
  });
});
