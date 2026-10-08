import { OFFLINE_COMMERCIAL_NOT_OBSERVED, type CommercialHydrator } from './commercialHydrator.js';
import { ConstraintVerifier, type VerifierContext } from './constraintVerifier.js';
import {
  DISCOVER_V0_MAX_CANDIDATES,
  type CandidateDisposition,
  type CommercialObservation,
  type ConstraintResult,
  type DiscoverAgentResponse,
  type DiscoverCandidate,
  type DiscoverDiagnosticResponse,
  type DiscoverStageTimings,
  type DiscoverV0Mode,
  type DiscoverV0Request,
  type ExactResolution,
  type GroupResult,
  type RetrievalGenerator,
} from './contracts.js';
import { aggregateGroups, dispositionOf } from './disposition.js';
import { CandidateFusion, ExactCandidateGenerator, LexicalCandidateGenerator, requirementHolds, StructuredCandidateGenerator } from './generators.js';
import { DiscoverQueryInterpreter } from './queryInterpreter.js';
import { CandidateRanker } from './ranker.js';
import { DiscoverResultAssembler } from './resultAssembler.js';
import type { DiscoverIndex } from './retrievalDocument.js';

/*
 * catalog.discoverV0 — V0.2 offline experimental orchestration:
 *
 *   query interpretation   (spans, readings, ambiguity groups, relevance requirements)
 *   candidate retrieval    (exact, lexical, structured over every plausible reading)
 *   relevance ranking      (preliminary, relevance only)
 *   evidence assessment +
 *   constraint evaluation  (technical first, over the whole pool)
 *   commercial hydration   (bounded; budget spent on technically conforming candidates first)
 *   candidate disposition  (VERIFIED_MATCH / POSSIBLE_MATCH / REJECTED)
 *   final ranking + both responses (diagnostic and agent)
 *
 * EXACT_ENTITY_RESOLUTION and RELATED_PRODUCT_DISCOVERY are separate: an exact
 * product is always resolved and returned as a lookup (with its own, possibly
 * contradictory, constraint results), while related products keep the ORIGINAL
 * hard constraints — exact identity never demotes them (V0 did).
 */

export const COMMERCIAL_HYDRATION_BOUND = 40;

export type DiscoverV0Context = {
  index: DiscoverIndex;
  mode: DiscoverV0Mode;
  interpreter?: DiscoverQueryInterpreter;
  commercial?: CommercialHydrator;
  /** Commercial hydration budget (default COMMERCIAL_HYDRATION_BOUND). */
  hydrationBound?: number;
  now?: () => Date;
};

export type DiscoverV0Diagnostics = {
  exactResolution: ExactResolution;
  offTargetDropped: number;
  lexical: { qualified: number; truncated: boolean };
  pool: { productKey: string; disposition: CandidateDisposition; total: number; relevance: number; relevanceTier: string; exactTier: number | null }[];
  rejected: { productKey: string; violated: { constraintId: string; reason: string }[] }[];
  verifiedKeys: string[];
  possibleKeys: string[];
  hydration: {
    bound: number;
    requested: string[];
    /** Technically conforming (not rejected) candidates in the order hydration used. */
    technicallyConforming: number;
    technicallyVerified: number;
    /** 1-based positions of technically VERIFIED candidates in the pure-relevance order (the V0 hydration order). */
    verifiedPositionsInRelevanceOrder: number[];
  };
};

export type DiscoverV0Result = { response: DiscoverDiagnosticResponse; agent: DiscoverAgentResponse; timings: DiscoverStageTimings; diagnostics: DiscoverV0Diagnostics };

const defaultInterpreter = new DiscoverQueryInterpreter();
const exact = new ExactCandidateGenerator();
const lexical = new LexicalCandidateGenerator();
const structured = new StructuredCandidateGenerator();
const fusion = new CandidateFusion();
const ranker = new CandidateRanker();
const assembler = new DiscoverResultAssembler();

export async function discoverV0(request: DiscoverV0Request, context: DiscoverV0Context): Promise<DiscoverV0Result> {
  const timings: DiscoverStageTimings = {};
  const started = performance.now();
  const stage = <T>(name: keyof DiscoverStageTimings, run: () => T): T => {
    const at = performance.now();
    const value = run();
    timings[name] = (timings[name] ?? 0) + (performance.now() - at);
    return value;
  };
  const { index, mode } = context;
  const limit = Math.max(1, Math.min(DISCOVER_V0_MAX_CANDIDATES, request.limit ?? DISCOVER_V0_MAX_CANDIDATES));
  const bound = context.hydrationBound ?? COMMERCIAL_HYDRATION_BOUND;

  const interpretation = stage('interpret', () => (context.interpreter ?? defaultInterpreter).interpret(request.need));
  const exactCandidates = stage('exact', () => exact.generate(index, interpretation));
  const exactKinds = new Set(exactCandidates.flatMap((candidate) => candidate.signals.map((signal) => signal.kind)));
  const exactResolution: ExactResolution = exactCandidates.length === 0
    ? { status: 'NONE', kind: null, productKeys: [], relatedDiscovery: 'APPLIED' }
    : {
      status: 'RESOLVED',
      kind: exactKinds.has('EXACT_PRODUCT_KEY') ? 'PRODUCT_KEY' : exactKinds.has('EXACT_REFERENCE') ? 'REFERENCE' : 'NAME',
      productKeys: exactCandidates.map((candidate) => candidate.productKey),
      relatedDiscovery: interpretation.lexicalTokens.length > 0 || interpretation.hardConstraints.length > 0 ? 'APPLIED' : 'NOT_APPLICABLE',
    };
  const lexicalResult = stage('lexical', () => lexical.generateDetailed(index, interpretation));
  const structuredCandidates = mode === 'HYBRID' ? stage('structured', () => structured.generate(index, interpretation)) : [];
  const strategy: RetrievalGenerator[] = mode === 'HYBRID' ? ['EXACT', 'LEXICAL', 'STRUCTURED'] : ['EXACT', 'LEXICAL'];
  const fused = stage('fusion', () => fusion.fuse(exactCandidates, lexicalResult.candidates, structuredCandidates));

  // Relevance gates (lexical, both modes): ungrouped gating requirements must hold; for each ambiguity
  // group at least one reading must be on target. Exact entities are never gated out.
  const gating = interpretation.relevanceRequirements.filter((requirement) => requirement.gating);
  const passes = (productKey: string, requirementId: string) => {
    const requirement = gating.find((item) => item.id === requirementId);
    return !requirement || requirementHolds(index, productKey, requirement);
  };
  const pool = fused.filter((candidate) => candidate.signals.some((signal) => signal.generator === 'EXACT')
    || (gating.filter((requirement) => !requirement.groupId).every((requirement) => passes(candidate.productKey, requirement.id))
      && interpretation.ambiguityGroups.every((group) => group.readings.some((reading) => reading.requirementIds.every((id) => passes(candidate.productKey, id))))));

  const relevance = stage('rank', () => ranker.relevance(index, interpretation, pool));
  const verifier = new ConstraintVerifier(index);
  const verifierContext: VerifierContext = {
    requestedFamilies: [...new Set(interpretation.hardConstraints.filter((constraint) => constraint.kind === 'PRODUCT_TYPE').flatMap((constraint) => constraint.codes ?? []))],
    requestedExercises: [...new Set(interpretation.hardConstraints.filter((constraint) => constraint.kind === 'EXERCISE').flatMap((constraint) => constraint.codes ?? []))],
    ...(context.now ? { now: context.now } : {}),
  };
  const constraints = [...interpretation.hardConstraints.map((constraint) => ({ constraint, hard: true })), ...interpretation.softPreferences.map((constraint) => ({ constraint, hard: false }))];
  const notObserved: CommercialObservation = { status: 'NOT_OBSERVED', reason: 'NOT_HYDRATED_OUTSIDE_BOUND' };

  // Phase 1 — technical evidence for the whole pool (in-memory, unbounded).
  const technical = stage('verify', () => new Map(pool.map((candidate) => {
    const document = index.documents.get(candidate.productKey)!;
    return [candidate.productKey, constraints.map(({ constraint, hard }) => (constraint.domain === 'COMMERCIAL' ? null : verifier.verify(document, constraint, hard, mode, notObserved, verifierContext)))];
  })));
  const technicalDisposition = (productKey: string) => {
    const results = technical.get(productKey)!.filter((result): result is ConstraintResult => result !== null);
    const groups = aggregateGroups(interpretation, results, (id) => passes(productKey, id));
    return dispositionOf(results, groups).disposition;
  };

  // Phase 2 — commercial hydration, bounded, spent on technically conforming candidates first.
  const relevanceOrder = ranker.preliminary(pool, relevance, index);
  const dispositionRank: Record<CandidateDisposition, number> = { VERIFIED_MATCH: 0, POSSIBLE_MATCH: 1, REJECTED: 2 };
  const preliminaryDisposition = new Map(pool.map((candidate) => [candidate.productKey, technicalDisposition(candidate.productKey)]));
  const hydrationOrder = relevanceOrder.map((candidate, position) => ({ candidate, position }))
    .sort((left, right) => dispositionRank[preliminaryDisposition.get(left.candidate.productKey)!] - dispositionRank[preliminaryDisposition.get(right.candidate.productKey)!] || left.position - right.position)
    .map((item) => item.candidate);
  const hydrationKeys = hydrationOrder.filter((candidate) => preliminaryDisposition.get(candidate.productKey) !== 'REJECTED').slice(0, bound).map((candidate) => candidate.productKey);
  const commercialStarted = performance.now();
  let commercial: Map<string, CommercialObservation>;
  let hydrationFailed = false;
  try {
    commercial = await (context.commercial ?? OFFLINE_COMMERCIAL_NOT_OBSERVED).hydrate(hydrationKeys);
  } catch {
    hydrationFailed = true;
    commercial = new Map(hydrationKeys.map((key) => [key, { status: 'NOT_OBSERVED', reason: 'COMMERCIAL_HYDRATION_FAILED' } as const]));
  }
  timings.hydrate = performance.now() - commercialStarted;

  const assessed = stage('verify', () => new Map(pool.map((candidate) => {
    const document = index.documents.get(candidate.productKey)!;
    const observation = commercial.get(candidate.productKey) ?? notObserved;
    const results = technical.get(candidate.productKey)!.map((result, position) => result
      ?? verifier.verify(document, constraints[position]!.constraint, constraints[position]!.hard, mode, observation, verifierContext));
    const groups: GroupResult[] = aggregateGroups(interpretation, results, (id) => passes(candidate.productKey, id));
    const { disposition, blocking } = dispositionOf(results, groups);
    return [candidate.productKey, { results, groups, disposition, blocking: blocking as DiscoverCandidate['blocking'] }];
  })));
  const ranked = stage('rank', () => ranker.rank(mode, index, interpretation, pool, relevance, assessed));
  const conforming = hydrationOrder.filter((candidate) => preliminaryDisposition.get(candidate.productKey) !== 'REJECTED');
  const response = stage('assemble', () => assembler.assemble({
    mode, index, interpretation, ranked, limit, commercial, strategy, exact: exactResolution, retrievalTruncated: lexicalResult.truncated,
    commercialHydration: { bound, requested: hydrationKeys.length, technicallyEligibleBeyondBound: Math.max(0, conforming.length - bound), failed: hydrationFailed },
    degraded: hydrationFailed ? ['COMMERCIAL_HYDRATION_FAILED'] : [],
  }));
  const agent = stage('assemble', () => assembler.agent(response, request.need));
  timings.total = performance.now() - started;
  return {
    response,
    agent,
    timings,
    diagnostics: {
      exactResolution,
      offTargetDropped: fused.length - pool.length,
      lexical: { qualified: lexicalResult.qualified, truncated: lexicalResult.truncated },
      pool: ranked.slice(0, 50).map((candidate) => ({ productKey: candidate.productKey, disposition: candidate.disposition, total: candidate.components.total,
        relevance: candidate.relevance.score, relevanceTier: candidate.relevance.tier, exactTier: candidate.components.exactTier })),
      rejected: ranked.filter((candidate) => candidate.disposition === 'REJECTED').slice(0, 50).map((candidate) => ({
        productKey: candidate.productKey, violated: candidate.blocking.map((item) => ({ constraintId: item.constraintId, reason: item.reason })),
      })),
      verifiedKeys: ranked.filter((candidate) => candidate.disposition === 'VERIFIED_MATCH').map((candidate) => candidate.productKey),
      possibleKeys: ranked.filter((candidate) => candidate.disposition === 'POSSIBLE_MATCH').map((candidate) => candidate.productKey),
      hydration: {
        bound,
        requested: hydrationKeys,
        technicallyConforming: conforming.length,
        technicallyVerified: [...preliminaryDisposition.values()].filter((value) => value === 'VERIFIED_MATCH').length,
        verifiedPositionsInRelevanceOrder: relevanceOrder.map((candidate, position) => ({ key: candidate.productKey, position: position + 1 }))
          .filter((item) => preliminaryDisposition.get(item.key) === 'VERIFIED_MATCH').map((item) => item.position),
      },
    },
  };
}
