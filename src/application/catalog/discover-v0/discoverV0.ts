import { OFFLINE_COMMERCIAL_NOT_OBSERVED, type CommercialHydrator } from './commercialHydrator.js';
import { ConstraintVerifier } from './constraintVerifier.js';
import {
  DISCOVER_V0_MAX_CANDIDATES,
  type CommercialObservation,
  type ConstraintResult,
  type DiscoverStageTimings,
  type DiscoverV0Mode,
  type DiscoverV0Request,
  type DiscoverV0Response,
  type RetrievalGenerator,
} from './contracts.js';
import { CandidateFusion, ExactCandidateGenerator, hasIndexedText, LexicalCandidateGenerator, StructuredCandidateGenerator } from './generators.js';
import { DiscoverQueryInterpreter, demoteForNominalLookup } from './queryInterpreter.js';
import { CandidateRanker, type Eligibility } from './ranker.js';
import { DiscoverResultAssembler } from './resultAssembler.js';
import type { DiscoverIndex } from './retrievalDocument.js';

/*
 * catalog.discoverV0(request, context) — offline experimental orchestration:
 * interpret → generate (exact, lexical, structured) → fuse by productKey →
 * preliminary rank → hydrate commercial truth (bounded) → verify constraints →
 * rank → split eligible / unverified / excluded → assemble (≤ 8 each).
 */

export const COMMERCIAL_HYDRATION_BOUND = 40;

export type DiscoverV0Context = {
  index: DiscoverIndex;
  mode: DiscoverV0Mode;
  interpreter?: DiscoverQueryInterpreter;
  commercial?: CommercialHydrator;
};

export type DiscoverV0Diagnostics = {
  nominalLookup: boolean;
  offTargetDropped: number;
  pool: { productKey: string; eligibility: Eligibility; total: number; exactTier: number | null }[];
  excluded: { productKey: string; violated: { constraintId: string; reason: string }[] }[];
  eligibleKeys: string[];
};

export type DiscoverV0Result = { response: DiscoverV0Response; timings: DiscoverStageTimings; diagnostics: DiscoverV0Diagnostics };

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

  let interpretation = stage('interpret', () => (context.interpreter ?? defaultInterpreter).interpret(request.need));
  const exactCandidates = stage('exact', () => exact.generate(index, interpretation));
  const nominalLookup = exactCandidates.length === 1 && exactCandidates[0]!.signals.some((signal) => signal.kind === 'EXACT_NAME' || signal.kind === 'EXACT_REFERENCE'
    || (signal.kind === 'EXACT_PRODUCT_KEY' && interpretation.lexicalTokens.length === 0));
  if (nominalLookup) interpretation = demoteForNominalLookup(interpretation);
  const lexicalCandidates = stage('lexical', () => lexical.generate(index, interpretation));
  const structuredCandidates = mode === 'HYBRID' ? stage('structured', () => structured.generate(index, interpretation)) : [];
  const strategy: RetrievalGenerator[] = mode === 'HYBRID' ? ['EXACT', 'LEXICAL', 'STRUCTURED'] : ['EXACT', 'LEXICAL'];
  const fused = stage('fusion', () => fusion.fuse(exactCandidates, lexicalCandidates, structuredCandidates));
  // Subtype relevance gate (lexical, both modes): a candidate must mention the named subtype in its source text.
  const subtypes = interpretation.hardConstraints.filter((constraint) => (constraint.kind === 'PRODUCT_TYPE' || constraint.kind === 'BUNDLE_COMPONENT') && constraint.subtypeText?.length).map((constraint) => constraint.subtypeText!);
  const pool = subtypes.length === 0 ? fused : fused.filter((candidate) => candidate.signals.some((signal) => signal.generator === 'EXACT')
    || subtypes.every((alternatives) => alternatives.some((stems) => hasIndexedText(index, candidate.productKey, stems))));

  const preliminary = stage('rank', () => ranker.rank(mode, index, interpretation, pool));
  const hydrationKeys = preliminary.slice(0, COMMERCIAL_HYDRATION_BOUND).map((candidate) => candidate.productKey);
  const commercialStarted = performance.now();
  const commercial: Map<string, CommercialObservation> = await (context.commercial ?? OFFLINE_COMMERCIAL_NOT_OBSERVED).hydrate(hydrationKeys);
  timings.hydrate = performance.now() - commercialStarted;

  const verifier = new ConstraintVerifier(index);
  const results = stage('verify', () => {
    const map = new Map<string, ConstraintResult[]>();
    for (const candidate of pool) {
      const document = index.documents.get(candidate.productKey)!;
      const observation = commercial.get(candidate.productKey) ?? { status: 'NOT_OBSERVED', reason: 'NOT_HYDRATED_OUTSIDE_BOUND' } as const;
      map.set(candidate.productKey, [
        ...interpretation.hardConstraints.map((constraint) => verifier.verify(document, constraint, true, mode, observation)),
        ...interpretation.softPreferences.map((constraint) => verifier.verify(document, constraint, false, mode, observation)),
      ]);
    }
    return map;
  });
  const ranked = stage('rank', () => ranker.rank(mode, index, interpretation, pool, results));
  const response = stage('assemble', () => assembler.assemble({ mode, index, interpretation, ranked, limit, commercial, strategy }));
  timings.total = performance.now() - started;
  return {
    response,
    timings,
    diagnostics: {
      nominalLookup,
      offTargetDropped: fused.length - pool.length,
      pool: ranked.slice(0, 50).map((candidate) => ({ productKey: candidate.productKey, eligibility: candidate.eligibility, total: candidate.components.total, exactTier: candidate.components.exactTier })),
      excluded: ranked.filter((candidate) => candidate.eligibility === 'EXCLUDED').slice(0, 50).map((candidate) => ({
        productKey: candidate.productKey,
        violated: candidate.constraintResults.filter((result) => result.hard && result.state === 'VIOLATED').map((result) => ({ constraintId: result.constraintId, reason: result.reason })),
      })),
      eligibleKeys: ranked.filter((candidate) => candidate.eligibility === 'ELIGIBLE').map((candidate) => candidate.productKey),
    },
  };
}
