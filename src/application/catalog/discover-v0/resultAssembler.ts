import type { CommercialObservation, ConstraintResult, DiscoverCandidate, DiscoverV0Mode, DiscoverV0Response, QueryInterpretation, RetrievalGenerator } from './contracts.js';
import type { RankedCandidate } from './ranker.js';
import type { DiscoverIndex } from './retrievalDocument.js';

/*
 * DiscoverResultAssembler — bounded, structured output. Eligible candidates and
 * unverifiable-but-relevant candidates are separate lists; excluded (VIOLATED)
 * candidates are only counted. Explanations are short codes, never long text.
 */

const MAX_WHY = 5;
const MAX_EVIDENCE = 5;
const MAX_TEXT = 120;

const KIND_LABELS: Record<string, string> = {
  EXACT_PRODUCT_KEY: 'productKey exacto',
  EXACT_REFERENCE: 'referencia exacta',
  EXACT_NAME: 'nombre exacto',
  NOMINAL_EXACT_NAME: 'nombre exacto',
  NOMINAL_PHRASE: 'frase contenida en el nombre',
  NOMINAL_ALL_TOKENS: 'todos los términos en el nombre',
  GOVERNED_SYNONYM: 'sinónimo gobernado',
  PREFIX_EXPANSION: 'expansión por prefijo',
};

function clip(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

function why(candidate: RankedCandidate): string[] {
  const lines: string[] = [];
  for (const signal of candidate.signals) {
    const label = KIND_LABELS[signal.kind];
    if (label && !lines.includes(label)) lines.push(label);
  }
  const bm25 = candidate.signals.find((signal) => signal.kind === 'BM25');
  if (bm25?.evidence) lines.push(`texto: ${bm25.evidence}`);
  for (const result of candidate.constraintResults) {
    if (result.state === 'SATISFIED') lines.push(`${result.kind} ${result.matchedConcept ?? ''} = ${result.source} ${result.reason}`.replace(/\s+/gu, ' '));
  }
  return lines.slice(0, MAX_WHY).map(clip);
}

function evidence(candidate: RankedCandidate): DiscoverCandidate['evidence'] {
  const out: DiscoverCandidate['evidence'] = [];
  for (const result of candidate.constraintResults) {
    if (result.evidence && result.source) out.push({ source: result.source, ref: clip(result.evidence), ...(result.matchedConcept ? { code: result.matchedConcept } : {}) });
  }
  for (const signal of candidate.signals) {
    if (signal.generator === 'STRUCTURED' && signal.evidence && !out.some((item) => item.code === signal.matchedConcept)) {
      out.push({ source: signal.source, ref: clip(signal.evidence), ...(signal.matchedConcept ? { code: signal.matchedConcept } : {}) });
    }
  }
  return out.slice(0, MAX_EVIDENCE);
}

export class DiscoverResultAssembler {
  candidate(candidate: RankedCandidate, rank: number, commercial: CommercialObservation): DiscoverCandidate {
    return {
      productKey: candidate.productKey,
      name: candidate.document.name,
      rank,
      score: candidate.components.total,
      matchedBy: [...new Set(candidate.signals.map((signal) => `${signal.generator}:${signal.kind}`))],
      whyMatched: why(candidate),
      constraintResults: candidate.constraintResults,
      evidence: evidence(candidate),
      scoreComponents: candidate.components,
      commercial,
    };
  }

  assemble(input: {
    mode: DiscoverV0Mode;
    index: DiscoverIndex;
    interpretation: QueryInterpretation;
    ranked: readonly RankedCandidate[];
    limit: number;
    commercial: ReadonlyMap<string, CommercialObservation>;
    strategy: RetrievalGenerator[];
  }): DiscoverV0Response {
    const { ranked, limit, index, interpretation } = input;
    const observation = (key: string): CommercialObservation => input.commercial.get(key) ?? { status: 'NOT_OBSERVED', reason: 'NOT_HYDRATED_OUTSIDE_BOUND' };
    const eligible = ranked.filter((candidate) => candidate.eligibility === 'ELIGIBLE');
    const unverified = ranked.filter((candidate) => candidate.eligibility === 'UNVERIFIED');
    const excluded = ranked.filter((candidate) => candidate.eligibility === 'EXCLUDED');
    const candidates = eligible.slice(0, limit).map((candidate, offset) => this.candidate(candidate, offset + 1, observation(candidate.productKey)));
    const unverifiedCandidates = unverified.slice(0, limit).map((candidate, offset) => this.candidate(candidate, offset + 1, observation(candidate.productKey)));
    return {
      schemaVersion: 1,
      mode: input.mode,
      interpretation: {
        recognizedConcepts: interpretation.recognizedConcepts,
        unrecognizedTerms: interpretation.unrecognizedTerms,
        hardConstraints: interpretation.hardConstraints,
        softPreferences: interpretation.softPreferences,
        entries: interpretation.entries,
      },
      candidates,
      unverifiedCandidates,
      completeness: {
        candidateCount: ranked.length,
        eligibleCount: eligible.length,
        unverifiedCount: unverified.length,
        excludedCount: excluded.length,
        returnedCount: candidates.length,
        truncated: eligible.length > candidates.length || unverified.length > unverifiedCandidates.length,
        degraded: [...index.degraded],
        strategy: input.strategy,
        noResultReason: candidates.length > 0 ? null : noResultReason(ranked, unverified.flatMap((candidate) => candidate.constraintResults)),
      },
      lineage: {
        bundleId: index.bundleId,
        bundleLabel: index.label,
        sourceExtractionId: index.sourceExtractionId,
        retrievalVersion: index.lineage.retrievalVersion,
        lexiconVersion: index.lineage.lexiconVersion,
        indexFingerprint: index.fingerprint,
        productSemanticsSnapshotId: index.lineage.productSemanticsSnapshotId,
        trainingV2SnapshotId: index.lineage.trainingV2SnapshotId,
        specsSnapshotId: index.lineage.specsSnapshotId,
        admissionContractHash: index.lineage.admissionContractHash,
      },
    };
  }
}

function noResultReason(ranked: readonly RankedCandidate[], unverifiedResults: readonly ConstraintResult[]): string {
  if (ranked.length === 0) return 'NO_CANDIDATES_RETRIEVED';
  const hard = unverifiedResults.filter((result) => result.hard && result.state !== 'SATISFIED');
  if (hard.length === 0) return 'ALL_CANDIDATES_VIOLATE_HARD_CONSTRAINTS';
  if (hard.some((result) => result.state === 'UNSUPPORTED')) return 'HARD_CONSTRAINT_UNSUPPORTED';
  if (hard.some((result) => result.domain === 'COMMERCIAL')) return 'COMMERCIAL_TRUTH_NOT_OBSERVED';
  return 'ONLY_UNVERIFIABLE_CANDIDATES';
}
