import type { ConstraintResult, DiscoverV0Mode, GeneratedCandidate, QueryInterpretation, RetrievalSignal, ScoreComponents } from './contracts.js';
import type { DiscoverIndex, ProductRetrievalDocument } from './retrievalDocument.js';
import { discoverTokens } from './text.js';

/*
 * CandidateRanker — explainable weighted fusion with exact-match dominance.
 * Weights are fixed a priori for V0; they were NOT tuned on the benchmark
 * (there is no adjudicated relevance gold to tune against).
 *
 *   exact tier      productKey/reference (0) and exact name (1) rank first
 *   L (lexical)     0.6 · BM25/max(BM25 in pool) + 0.4 · nominal tier/4
 *   S (structured)  mean strength over technical hard constraints:
 *                   SATISFIED 1 (0.85 if SUPPORTED/FAMILY_DERIVED/STRONGLY_INFERRED),
 *                   UNKNOWN with a matching projection signal 0.3, else 0
 *   P (preferences) share of technical soft preferences SATISFIED
 *   HYBRID          0.45 L + 0.45 S + 0.10 P   (technical hard constraints present)
 *                   0.60 L + 0.40 P            (otherwise)
 *   LEXICAL_PLUS    L
 * Ties: name token count (closer names first), then productId.
 */

export type Eligibility = 'ELIGIBLE' | 'UNVERIFIED' | 'EXCLUDED';

export type RankedCandidate = {
  productKey: string;
  document: ProductRetrievalDocument;
  signals: RetrievalSignal[];
  constraintResults: ConstraintResult[];
  components: ScoreComponents;
  eligibility: Eligibility;
};

const TECHNICAL_KINDS = new Set(['PRODUCT_TYPE', 'EXERCISE', 'TRAINING_FUNCTION', 'ANATOMY', 'SPEC']);
const WEAKER_RELATIONS = new Set(['SUPPORTED', 'FAMILY_DERIVED', 'STRONGLY_INFERRED']);

export function eligibilityOf(results: readonly ConstraintResult[]): Eligibility {
  const hard = results.filter((result) => result.hard);
  if (hard.some((result) => result.state === 'VIOLATED')) return 'EXCLUDED';
  return hard.every((result) => result.state === 'SATISFIED') ? 'ELIGIBLE' : 'UNVERIFIED';
}

function exactTier(signals: readonly RetrievalSignal[]): number | null {
  if (signals.some((signal) => signal.kind === 'EXACT_PRODUCT_KEY' || signal.kind === 'EXACT_REFERENCE')) return 0;
  return signals.some((signal) => signal.kind === 'EXACT_NAME') ? 1 : null;
}

export class CandidateRanker {
  rank(
    mode: DiscoverV0Mode,
    index: DiscoverIndex,
    interpretation: QueryInterpretation,
    candidates: readonly GeneratedCandidate[],
    results: ReadonlyMap<string, ConstraintResult[]> = new Map(),
  ): RankedCandidate[] {
    const bm25 = (signals: readonly RetrievalSignal[]) => signals.find((signal) => signal.kind === 'BM25')?.score ?? 0;
    const maxBm25 = Math.max(0, ...candidates.map((candidate) => bm25(candidate.signals)));
    const technicalHard = interpretation.hardConstraints.filter((constraint) => TECHNICAL_KINDS.has(constraint.kind));
    const technicalSoft = interpretation.softPreferences.filter((constraint) => TECHNICAL_KINDS.has(constraint.kind) || constraint.kind === 'DISCIPLINE' || constraint.kind === 'USE_CONTEXT');
    const ranked = candidates.map((candidate) => {
      const document = index.documents.get(candidate.productKey)!;
      const constraintResults = results.get(candidate.productKey) ?? [];
      const tier = candidate.signals.find((signal) => signal.kind.startsWith('NOMINAL_'))?.score ?? 0;
      const lexical = (maxBm25 > 0 ? 0.6 * (bm25(candidate.signals) / maxBm25) : 0) + 0.4 * (tier / 4);
      let structured = 0;
      let preferences = 0;
      let total = lexical;
      if (mode === 'HYBRID') {
        const strength = (constraintId: string) => {
          const result = constraintResults.find((item) => item.constraintId === constraintId);
          if (!result) return 0;
          if (result.state === 'SATISFIED') return WEAKER_RELATIONS.has(result.confidence ?? '') ? 0.85 : 1;
          return result.state === 'UNKNOWN' && result.matchedConcept ? 0.3 : 0;
        };
        structured = technicalHard.length === 0 ? 0 : technicalHard.reduce((sum, constraint) => sum + strength(constraint.id), 0) / technicalHard.length;
        preferences = technicalSoft.length === 0 ? 0
          : technicalSoft.filter((constraint) => constraintResults.find((item) => item.constraintId === constraint.id)?.state === 'SATISFIED').length / technicalSoft.length;
        total = technicalHard.length > 0 ? 0.45 * lexical + 0.45 * structured + 0.1 * preferences : 0.6 * lexical + 0.4 * preferences;
      }
      const round = (value: number) => Math.round(value * 1e6) / 1e6;
      return {
        productKey: candidate.productKey,
        document,
        signals: candidate.signals,
        constraintResults,
        components: { exactTier: exactTier(candidate.signals), lexical: round(lexical), structured: round(structured), softPreferences: round(preferences), total: round(total) },
        eligibility: eligibilityOf(constraintResults),
        nameLength: discoverTokens(document.name).length,
      };
    });
    ranked.sort((left, right) => (left.components.exactTier ?? 99) - (right.components.exactTier ?? 99)
      || right.components.total - left.components.total
      || left.nameLength - right.nameLength
      || left.document.productId - right.document.productId);
    return ranked.map(({ nameLength: _nameLength, ...candidate }) => candidate);
  }
}
