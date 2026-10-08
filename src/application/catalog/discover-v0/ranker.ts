import type {
  CandidateDisposition,
  ConstraintResult,
  DiscoverCandidate,
  DiscoverConstraint,
  DiscoverV0Mode,
  GeneratedCandidate,
  GroupResult,
  QueryInterpretation,
  RelevanceAssessment,
  RelevanceTier,
  RetrievalSignal,
  ScoreComponents,
} from './contracts.js';
import { requirementHolds } from './generators.js';
import type { DiscoverIndex, ProductRetrievalDocument } from './retrievalDocument.js';
import { discoverTokens } from './text.js';

/*
 * CandidateRanker V0.2 — deterministic and explainable, with four separate inputs:
 *
 *   1. retrieval relevance R (no constraint state, no commercial data)
 *        exact tier      productKey/reference (0) and exact name (1) dominate
 *        L (lexical)     0.6 · BM25/max(BM25 in pool) + 0.4 · nominal tier/4
 *        C (structured)  share of required concept/spec units for which a projection
 *                        signal matched (assigned, regardless of admission)
 *        R               0.5 L + 0.5 C  (L alone without concept units)
 *                        + 0.15 · share of non-gating relevance requirements met
 *   2. constraint fit F  mean over required technical units: SATISFIED 1 (0.85 if
 *                        SUPPORTED/FAMILY_DERIVED/STRONGLY_INFERRED), group satisfied
 *                        under some reading 0.6, UNKNOWN with a projection signal 0.3
 *   3. preferences P     share of technical soft preferences SATISFIED
 *   4. commercial        never in the score (only in disposition, when observed)
 *
 *   order: disposition (VERIFIED, POSSIBLE, REJECTED) → exact tier → 0.7 R + 0.2 F + 0.1 P
 *          → fewer name tokens → productId.
 * A verifiably violating candidate cannot rise above a conforming one by its name:
 * disposition is the first key. Weights are a priori (no adjudicated gold to tune on).
 */

export type RankedCandidate = {
  productKey: string;
  document: ProductRetrievalDocument;
  signals: RetrievalSignal[];
  constraintResults: ConstraintResult[];
  groupResults: GroupResult[];
  relevance: RelevanceAssessment;
  components: ScoreComponents;
  disposition: CandidateDisposition;
  blocking: DiscoverCandidate['blocking'];
};

const TECHNICAL_KINDS = new Set(['PRODUCT_TYPE', 'EXERCISE', 'TRAINING_FUNCTION', 'ANATOMY', 'SPEC']);
const CONCEPT_KINDS = new Set(['PRODUCT_TYPE', 'EXERCISE', 'TRAINING_FUNCTION', 'ANATOMY']);
const WEAKER_RELATIONS = new Set(['SUPPORTED', 'FAMILY_DERIVED', 'STRONGLY_INFERRED']);
const DISPOSITION_ORDER: Record<CandidateDisposition, number> = { VERIFIED_MATCH: 0, POSSIBLE_MATCH: 1, REJECTED: 2 };
const round = (value: number) => Math.round(value * 1e6) / 1e6;

function exactTier(signals: readonly RetrievalSignal[]): number | null {
  if (signals.some((signal) => signal.kind === 'EXACT_PRODUCT_KEY' || signal.kind === 'EXACT_REFERENCE')) return 0;
  return signals.some((signal) => signal.kind === 'EXACT_NAME') ? 1 : null;
}

function signalMatches(signal: RetrievalSignal, constraint: DiscoverConstraint): boolean {
  if (signal.generator !== 'STRUCTURED' || !signal.matchedConcept) return false;
  if (constraint.kind === 'SPEC') return signal.matchedConcept.startsWith(`SPEC:${constraint.specKey}`);
  return (constraint.codes ?? []).some((code) => signal.matchedConcept === `${constraint.axis}:${code}`);
}

/** Required technical units: ungrouped constraints, plus one unit per ambiguity group (any reading). */
function technicalUnits(interpretation: QueryInterpretation): DiscoverConstraint[][] {
  const units: DiscoverConstraint[][] = interpretation.hardConstraints.filter((constraint) => !constraint.groupId && TECHNICAL_KINDS.has(constraint.kind)).map((constraint) => [constraint]);
  for (const group of interpretation.ambiguityGroups) {
    units.push(interpretation.hardConstraints.filter((constraint) => constraint.groupId === group.groupId));
  }
  return units;
}

export class CandidateRanker {
  /** Retrieval relevance only: identical for every mode and independent of verification. */
  relevance(index: DiscoverIndex, interpretation: QueryInterpretation, candidates: readonly GeneratedCandidate[]): Map<string, RelevanceAssessment> {
    const bm25 = (signals: readonly RetrievalSignal[]) => signals.find((signal) => signal.kind === 'BM25')?.score ?? 0;
    const maxBm25 = Math.max(0, ...candidates.map((candidate) => bm25(candidate.signals)));
    const units = technicalUnits(interpretation).filter((unit) => unit.some((constraint) => CONCEPT_KINDS.has(constraint.kind) || constraint.kind === 'SPEC'));
    const preferences = interpretation.relevanceRequirements.filter((requirement) => !requirement.gating);
    const out = new Map<string, RelevanceAssessment>();
    for (const candidate of candidates) {
      const tier = candidate.signals.find((signal) => signal.kind.startsWith('NOMINAL_'))?.score ?? 0;
      const lexical = (maxBm25 > 0 ? 0.6 * (bm25(candidate.signals) / maxBm25) : 0) + 0.4 * (tier / 4);
      const matchedUnits = units.filter((unit) => unit.some((constraint) => candidate.signals.some((signal) => signalMatches(signal, constraint)))).length;
      const structured = units.length === 0 ? 0 : matchedUnits / units.length;
      const met = interpretation.relevanceRequirements.filter((requirement) => requirementHolds(index, candidate.productKey, requirement));
      const metIds = new Set(met.map((requirement) => requirement.id));
      const preferenceShare = preferences.length === 0 ? 0 : preferences.filter((requirement) => metIds.has(requirement.id)).length / preferences.length;
      const coverage = candidate.signals.find((signal) => signal.kind === 'BM25')?.coverage ?? 0;
      const exact = exactTier(candidate.signals);
      const score = (units.length > 0 ? 0.5 * lexical + 0.5 * structured : lexical) + 0.15 * preferenceShare;
      const relevanceTier: RelevanceTier = exact !== null ? 'EXACT'
        : tier > 0 || (units.length > 0 && matchedUnits === units.length) ? 'STRONG'
          : coverage >= 0.5 || matchedUnits > 0 ? 'PARTIAL' : 'WEAK';
      out.set(candidate.productKey, {
        tier: relevanceTier, exactTier: exact, lexical: round(lexical), structured: round(structured), coverage: round(coverage),
        requirementsMatched: met.map((requirement) => requirement.id),
        requirementsMissed: interpretation.relevanceRequirements.filter((requirement) => !metIds.has(requirement.id)).map((requirement) => requirement.id),
        score: round(score),
      });
    }
    return out;
  }

  /** Preliminary order (relevance only): used before verification, e.g. for bounded work. */
  preliminary(candidates: readonly GeneratedCandidate[], relevance: ReadonlyMap<string, RelevanceAssessment>, index: DiscoverIndex): GeneratedCandidate[] {
    return [...candidates].sort((left, right) => {
      const [a, b] = [relevance.get(left.productKey)!, relevance.get(right.productKey)!];
      return (a.exactTier ?? 99) - (b.exactTier ?? 99) || b.score - a.score || index.documents.get(left.productKey)!.productId - index.documents.get(right.productKey)!.productId;
    });
  }

  rank(
    mode: DiscoverV0Mode,
    index: DiscoverIndex,
    interpretation: QueryInterpretation,
    candidates: readonly GeneratedCandidate[],
    relevance: ReadonlyMap<string, RelevanceAssessment>,
    assessed: ReadonlyMap<string, { results: ConstraintResult[]; groups: GroupResult[]; disposition: CandidateDisposition; blocking: DiscoverCandidate['blocking'] }>,
  ): RankedCandidate[] {
    const units = technicalUnits(interpretation);
    const technicalSoft = interpretation.softPreferences.filter((constraint) => TECHNICAL_KINDS.has(constraint.kind) || constraint.kind === 'DISCIPLINE' || constraint.kind === 'USE_CONTEXT');
    const ranked = candidates.map((candidate) => {
      const document = index.documents.get(candidate.productKey)!;
      const assessment = assessed.get(candidate.productKey)!;
      const rel = relevance.get(candidate.productKey)!;
      let fit = 0;
      let preferences = 0;
      if (mode === 'HYBRID') {
        const strength = (unit: DiscoverConstraint[]) => {
          const groupId = unit[0]!.groupId;
          if (groupId) {
            const group = assessment.groups.find((item) => item.groupId === groupId);
            return group?.state === 'SATISFIED' ? 1 : group && group.satisfiedUnder.length > 0 ? 0.6 : 0;
          }
          const result = assessment.results.find((item) => item.constraintId === unit[0]!.id);
          if (!result) return 0;
          if (result.state === 'SATISFIED') return WEAKER_RELATIONS.has(result.confidence ?? '') ? 0.85 : 1;
          return result.state === 'UNKNOWN' && result.matchedConcept ? 0.3 : 0;
        };
        fit = units.length === 0 ? 0 : units.reduce((sum, unit) => sum + strength(unit), 0) / units.length;
        preferences = technicalSoft.length === 0 ? 0
          : technicalSoft.filter((constraint) => assessment.results.find((item) => item.constraintId === constraint.id)?.state === 'SATISFIED').length / technicalSoft.length;
      }
      const total = mode === 'HYBRID' ? 0.7 * rel.score + 0.2 * fit + 0.1 * preferences : rel.score;
      return {
        productKey: candidate.productKey,
        document,
        signals: candidate.signals,
        constraintResults: assessment.results,
        groupResults: assessment.groups,
        relevance: rel,
        components: { exactTier: rel.exactTier, relevance: rel.score, lexical: rel.lexical, structured: rel.structured, constraintFit: round(fit), softPreferences: round(preferences), total: round(total) },
        disposition: assessment.disposition,
        blocking: assessment.blocking,
        nameLength: discoverTokens(document.name).length,
      };
    });
    ranked.sort((left, right) => DISPOSITION_ORDER[left.disposition] - DISPOSITION_ORDER[right.disposition]
      || (left.components.exactTier ?? 99) - (right.components.exactTier ?? 99)
      || right.components.total - left.components.total
      || left.nameLength - right.nameLength
      || left.document.productId - right.document.productId);
    return ranked.map(({ nameLength: _nameLength, ...candidate }) => candidate);
  }
}
