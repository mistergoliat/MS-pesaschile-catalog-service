import {
  DISCOVER_AGENT_MAX_POSSIBLE,
  DISCOVER_AGENT_MAX_VERIFIED,
  type AgentCandidate,
  type CommercialObservation,
  type ConstraintResult,
  type DiscoverAgentResponse,
  type DiscoverCandidate,
  type DiscoverCompleteness,
  type DiscoverConstraint,
  type DiscoverDiagnosticResponse,
  type DiscoverV0Mode,
  type ExactResolution,
  type QueryInterpretation,
  type RetrievalGenerator,
} from './contracts.js';
import type { RankedCandidate } from './ranker.js';
import type { DiscoverIndex } from './retrievalDocument.js';

/*
 * DiscoverResultAssembler — two representations of ONE internal result.
 *
 *  - DiscoverDiagnosticResponse: interpretations, retrieval signals, score
 *    breakdown, constraints with evidence, rejected candidates, versions. It is
 *    the authority for debugging.
 *  - DiscoverAgentResponse: compact (≤8 verified, ≤3 possible), short structured
 *    codes, known/unverified constraints, commercial status, minimal lineage and
 *    completeness/warnings. No raw signals, tokens or source dumps; critical
 *    warnings are never dropped to save bytes.
 */

const MAX_WHY = 5;
const MAX_EVIDENCE = 5;
const MAX_TEXT = 120;
const MAX_REJECTED = 8;

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

function clip(text: string, max = MAX_TEXT): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
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
  return lines.slice(0, MAX_WHY).map((line) => clip(line));
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

/** Short, stable label of a constraint for the agent representation. */
export function constraintCode(constraint: DiscoverConstraint): string {
  switch (constraint.kind) {
    case 'SPEC':
      return `${constraint.specKey}${constraint.operator === 'GTE' ? '>=' : constraint.operator === 'LTE' ? '<=' : '='}${constraint.value}${constraint.unit ?? ''}${constraint.quantityScope && constraint.specKey === 'weight_kg' ? `/${constraint.quantityScope}` : ''}`;
    case 'COMMERCIAL_MAX_PRICE':
      return `price<=${constraint.value}CLP`;
    case 'COMMERCIAL_AVAILABILITY':
      return 'sellable';
    case 'COMMERCIAL_LOW_PRICE':
      return 'low_price';
    case 'COMPATIBILITY':
      return `compatible_with:${constraint.target}`;
    case 'BUNDLE_COMPONENT':
      return `pack_component:${constraint.target}`;
    case 'NOMINAL_TEXT':
      return `name_contains:"${clip(constraint.matchedText, 40)}"`;
    case 'SUBSTITUTION':
    case 'UNMODELED_NEED':
    case 'VARIANT_ATTRIBUTE':
      return `${constraint.kind.toLowerCase()}:"${clip(constraint.matchedText, 30)}"`;
    default:
      return `${constraint.kind}:${(constraint.codes ?? []).join('|')}`;
  }
}

/** The leading code of a verdict reason ("QUANTITY_AMBIGUOUS:MULTI_UNIT..." → "QUANTITY_AMBIGUOUS"). */
function reasonCode(reason: string): string {
  return reason.split(':')[0]!.split(' ')[0]!.slice(0, 48);
}

export class DiscoverResultAssembler {
  candidate(candidate: RankedCandidate, rank: number, commercial: CommercialObservation): DiscoverCandidate {
    return {
      productKey: candidate.productKey,
      name: candidate.document.name,
      rank,
      disposition: candidate.disposition,
      score: candidate.components.total,
      relevance: candidate.relevance,
      matchedBy: [...new Set(candidate.signals.map((signal) => `${signal.generator}:${signal.kind}`))],
      whyMatched: why(candidate),
      blocking: candidate.blocking,
      constraintResults: candidate.constraintResults,
      groupResults: candidate.groupResults,
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
    exact: ExactResolution;
    retrievalTruncated: boolean;
    commercialHydration: DiscoverCompleteness['commercialHydration'];
    degraded: string[];
  }): DiscoverDiagnosticResponse {
    const { ranked, limit, index, interpretation } = input;
    const observation = (key: string): CommercialObservation => input.commercial.get(key) ?? { status: 'NOT_OBSERVED', reason: 'NOT_HYDRATED_OUTSIDE_BOUND' };
    const verifiedPool = ranked.filter((candidate) => candidate.disposition === 'VERIFIED_MATCH');
    const possiblePool = diversify(ranked.filter((candidate) => candidate.disposition === 'POSSIBLE_MATCH'), interpretation);
    const rejectedPool = ranked.filter((candidate) => candidate.disposition === 'REJECTED');
    const verified = verifiedPool.slice(0, limit).map((candidate, offset) => this.candidate(candidate, offset + 1, observation(candidate.productKey)));
    const possible = possiblePool.slice(0, limit).map((candidate, offset) => this.candidate(candidate, offset + 1, observation(candidate.productKey)));
    const entities = input.exact.productKeys.map((key) => ranked.find((candidate) => candidate.productKey === key)).filter((candidate): candidate is RankedCandidate => candidate !== undefined)
      .map((candidate) => this.candidate(candidate, 1, observation(candidate.productKey)));
    return {
      schemaVersion: 2,
      mode: input.mode,
      interpretation: {
        normalizedQuery: interpretation.normalizedQuery,
        recognizedConcepts: interpretation.recognizedConcepts,
        unrecognizedTerms: interpretation.unrecognizedTerms,
        hardConstraints: interpretation.hardConstraints,
        softPreferences: interpretation.softPreferences,
        relevanceRequirements: interpretation.relevanceRequirements,
        spans: interpretation.spans,
        ambiguityGroups: interpretation.ambiguityGroups,
        entries: interpretation.entries,
      },
      exactResolution: { ...input.exact, entities },
      verified,
      possible,
      rejected: rejectedPool.slice(0, MAX_REJECTED).map((candidate) => ({
        productKey: candidate.productKey, name: candidate.document.name, relevanceTier: candidate.relevance.tier,
        violated: candidate.blocking.map((item) => ({ constraintId: item.constraintId, reason: item.reason })),
      })),
      completeness: {
        candidateCount: ranked.length,
        verifiedCount: verifiedPool.length,
        possibleCount: possiblePool.length,
        rejectedCount: rejectedPool.length,
        returnedCount: verified.length,
        truncated: verifiedPool.length > verified.length || possiblePool.length > possible.length,
        retrievalTruncated: input.retrievalTruncated,
        commercialHydration: input.commercialHydration,
        degraded: [...index.degraded, ...input.degraded],
        strategy: input.strategy,
        noResultReason: verified.length > 0 ? null : noResultReason(ranked, possiblePool.flatMap((candidate) => candidate.constraintResults), interpretation),
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

  /** The compact agent representation, derived only from the diagnostic response. */
  agent(response: DiscoverDiagnosticResponse, need: string): DiscoverAgentResponse {
    const { interpretation } = response;
    const constraintById = new Map([...interpretation.hardConstraints, ...interpretation.softPreferences].map((constraint) => [constraint.id, constraint]));
    const groupLabel = new Map(interpretation.ambiguityGroups.flatMap((group) => group.readings.map((reading) => [`${group.groupId}.${reading.readingId}`, reading.label] as const)));
    const ungrouped = interpretation.hardConstraints.filter((constraint) => !constraint.groupId);
    const neverVerifiable = new Set(['COMPATIBILITY', 'SUBSTITUTION', 'UNMODELED_NEED', 'VARIANT_ATTRIBUTE', 'BUNDLE_COMPONENT']);
    const textOnly = interpretation.relevanceRequirements.filter((requirement) => requirement.role === 'USE_PURPOSE' || (requirement.gating && !requirement.groupId))
      .map((requirement) => `text_only:"${clip(requirement.text, 40)}"`);
    const commercialObserved = [...response.verified, ...response.possible].map((candidate) => candidate.commercial).find((item) => item.status === 'OBSERVED');
    const commercialOffline = !commercialObserved;
    const toAgent = (candidate: DiscoverCandidate): AgentCandidate => {
      const satisfied = candidate.constraintResults.filter((result) => result.hard && result.state === 'SATISFIED');
      const verified = satisfied.map((result) => agentCode(result, constraintById.get(result.constraintId)));
      const unverified = [
        ...candidate.blocking.map((item) => `${constraintById.get(item.constraintId) ? constraintCode(constraintById.get(item.constraintId)!) : item.constraintId}:${item.state}:${reasonCode(item.reason)}${item.conflict ? ':CONFLICTING_EVIDENCE' : ''}`),
        ...candidate.constraintResults.filter((result) => result.quantity?.derived && result.state === 'SATISFIED').map((result) => `${result.kind}:DERIVED:${result.quantity!.rule}`),
      ];
      const readings = candidate.groupResults.flatMap((group) => group.satisfiedUnder.map((reading) => `${reading}:${clip(groupLabel.get(`${group.groupId}.${reading}`) ?? reading, 48)}`));
      const price = candidate.commercial.status === 'OBSERVED'
        ? { finalGrossClp: candidate.commercial.finalGrossClp, sellability: candidate.commercial.sellability, asOf: candidate.commercial.asOf,
          fresh: !candidate.commercial.validUntil || candidate.constraintResults.every((result) => !result.reason.startsWith('COMMERCIAL_OBSERVATION_EXPIRED')) }
        : undefined;
      return {
        productKey: candidate.productKey, name: clip(candidate.name, 70), disposition: candidate.disposition, verified: [...new Set(verified)],
        ...(unverified.length > 0 ? { unverified: [...new Set(unverified)] } : {}), ...(readings.length > 0 ? { readings } : {}), ...(price ? { price } : {}),
      };
    };
    const exactEntity = response.exactResolution.entities[0];
    const exactKey = exactEntity?.productKey;
    const verified = response.verified.filter((candidate) => candidate.productKey !== exactKey).slice(0, DISCOVER_AGENT_MAX_VERIFIED - (exactEntity ? 1 : 0)).map(toAgent);
    const possible = response.possible.filter((candidate) => candidate.productKey !== exactKey && candidate.relevance.tier !== 'WEAK').slice(0, DISCOVER_AGENT_MAX_POSSIBLE).map(toAgent);
    const warnings = [
      ...(commercialOffline ? ['COMMERCIAL_TRUTH_NOT_OBSERVED'] : []),
      ...(interpretation.ambiguityGroups.length > 0 ? ['AMBIGUOUS_NEED'] : []),
      ...(response.completeness.retrievalTruncated ? ['RETRIEVAL_TRUNCATED'] : []),
      ...(response.completeness.commercialHydration.technicallyEligibleBeyondBound > 0 && ungrouped.some((constraint) => constraint.domain === 'COMMERCIAL') ? ['COMMERCIAL_HYDRATION_BOUNDED'] : []),
      ...(response.completeness.commercialHydration.failed ? ['COMMERCIAL_HYDRATION_FAILED'] : []),
      ...([...response.verified, ...response.possible].some((candidate) => candidate.blocking.some((item) => item.conflict)) ? ['CONFLICTING_EVIDENCE_PRESENT'] : []),
      ...(response.possible.some((candidate) => candidate.relevance.tier === 'WEAK') ? ['WEAK_MATCHES_OMITTED'] : []),
    ];
    return {
      schemaVersion: 1,
      version: response.lineage.retrievalVersion,
      interpretation: {
        need: clip(need.trim(), 120),
        required: ungrouped.map(constraintCode),
        preferred: interpretation.softPreferences.map(constraintCode),
        notVerifiable: [...new Set([...ungrouped.filter((constraint) => neverVerifiable.has(constraint.kind) || (constraint.domain === 'COMMERCIAL' && commercialOffline)).map(constraintCode), ...textOnly])],
        ambiguities: interpretation.ambiguityGroups.map((group) => ({ text: group.text, readings: group.readings.map((reading) => `${reading.readingId}:${reading.label}`) })),
        unrecognized: interpretation.unrecognizedTerms,
      },
      exactMatch: exactEntity ? toAgent(exactEntity) : null,
      verified,
      possible,
      completeness: {
        verified: response.completeness.verifiedCount,
        possible: response.completeness.possibleCount,
        rejected: response.completeness.rejectedCount,
        truncated: response.completeness.truncated,
        degraded: response.completeness.degraded,
        noVerifiedReason: response.completeness.noResultReason,
        warnings,
      },
      commercial: commercialObserved && commercialObserved.status === 'OBSERVED'
        ? { status: 'OBSERVED', authority: commercialObserved.authority, asOf: commercialObserved.asOf }
        : { status: 'NOT_OBSERVED', reason: response.completeness.commercialHydration.failed ? 'COMMERCIAL_HYDRATION_FAILED' : 'COMMERCIAL_TRUTH_NOT_OBSERVED' },
      lineage: { bundleId: response.lineage.bundleId, sourceExtractionId: response.lineage.sourceExtractionId, version: response.lineage.retrievalVersion, lexicon: response.lineage.lexiconVersion },
    };
  }
}

function agentCode(result: ConstraintResult, constraint: DiscoverConstraint | undefined): string {
  if (result.kind === 'SPEC') return `${constraint ? constraintCode(constraint) : result.constraintId}@SPECS`;
  if (result.matchedConcept && !result.matchedConcept.startsWith('SPEC')) return `${result.matchedConcept.split(':')[1] ?? result.matchedConcept}@${result.source ?? ''}`;
  return `${constraint ? constraintCode(constraint) : result.kind}@${result.source ?? ''}`;
}

/**
 * Under a material ambiguity, possible matches are interleaved by the reading that
 * supports them, so one reading never hides the other's alternatives.
 */
function diversify(possible: readonly RankedCandidate[], interpretation: QueryInterpretation): RankedCandidate[] {
  if (interpretation.ambiguityGroups.length === 0) return [...possible];
  const lanes = new Map<string, RankedCandidate[]>();
  for (const candidate of possible) {
    const lane = candidate.groupResults.flatMap((group) => group.satisfiedUnder).sort().join('+') || '~none';
    lanes.set(lane, [...(lanes.get(lane) ?? []), candidate]);
  }
  const ordered = [...lanes.keys()].sort((left, right) => (left === '~none' ? 1 : 0) - (right === '~none' ? 1 : 0) || left.localeCompare(right));
  const supported = ordered.filter((lane) => lane !== '~none');
  const out: RankedCandidate[] = [];
  for (let round = 0; out.length < possible.length - (lanes.get('~none')?.length ?? 0); round += 1) {
    for (const lane of supported) {
      const next = lanes.get(lane)![round];
      if (next) out.push(next);
    }
  }
  return [...out, ...(lanes.get('~none') ?? [])];
}

function noResultReason(ranked: readonly RankedCandidate[], possibleResults: readonly ConstraintResult[], interpretation: QueryInterpretation): string {
  if (ranked.length === 0) return 'NO_CANDIDATES_RETRIEVED';
  const hard = possibleResults.filter((result) => result.hard && result.state !== 'SATISFIED');
  if (ranked.every((candidate) => candidate.disposition === 'REJECTED')) return 'ALL_CANDIDATES_VIOLATE_HARD_CONSTRAINTS';
  if (hard.some((result) => result.state === 'UNSUPPORTED' && !result.groupId)) return 'HARD_CONSTRAINT_UNSUPPORTED';
  if (hard.some((result) => result.domain === 'COMMERCIAL')) return 'COMMERCIAL_TRUTH_NOT_OBSERVED';
  if (interpretation.ambiguityGroups.length > 0) return 'AMBIGUOUS_NEED_UNRESOLVED';
  return 'ONLY_UNVERIFIABLE_CANDIDATES';
}
