import type { RelationshipReliabilityEvaluator } from '../interfaces.js';
import {
  calculatedProductRelationshipSchema,
  type CalculatedProductRelationship,
  type RelationshipEngineRelationshipEvidence,
} from '../contracts.js';
import type { ProductRelationshipCandidate } from '../calculators/contracts.js';
import {
  reliabilityEvaluationParametersSchema,
  relationshipReliabilityScoreSchema,
  UnsupportedRelationshipReliabilityEvidenceError,
  type ReliabilityEvaluationParameters,
  type ProductRelationshipCandidateReliabilityEvaluator,
} from './contracts.js';

export const defaultReliabilityEvaluationParameters: ReliabilityEvaluationParameters = {
  confidenceWeight: 0.5,
  liftWeight: 0.25,
  supportWeight: 0.1,
  jointCountWeight: 0.15,
  jointCountScale: 10,
};

type CoOccurrenceEvidenceForReliability = Extract<RelationshipEngineRelationshipEvidence, { kind: 'co_occurrence' }>;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function liftScore(lift: number): number {
  return lift <= 1 ? 0 : 1 - 1 / lift;
}

function jointCountScore(jointCount: number, scale: number): number {
  return jointCount <= 0 ? 0 : 1 - Math.exp(-jointCount / scale);
}

export function calculateEvidenceReliability(
  evidence: CoOccurrenceEvidenceForReliability,
  parameters: ReliabilityEvaluationParameters = defaultReliabilityEvaluationParameters,
): number {
  const parsedParameters = reliabilityEvaluationParametersSchema.parse(parameters);
  const score =
    parsedParameters.confidenceWeight * evidence.confidence +
    parsedParameters.liftWeight * liftScore(evidence.lift) +
    parsedParameters.supportWeight * evidence.support +
    parsedParameters.jointCountWeight * jointCountScore(evidence.jointCount, parsedParameters.jointCountScale);
  return relationshipReliabilityScoreSchema.parse(clamp01(score));
}

export class EvidenceBasedRelationshipReliabilityEvaluator
  implements RelationshipReliabilityEvaluator, ProductRelationshipCandidateReliabilityEvaluator {
  private readonly parameters: ReliabilityEvaluationParameters;

  constructor(parameters: ReliabilityEvaluationParameters = defaultReliabilityEvaluationParameters) {
    this.parameters = reliabilityEvaluationParametersSchema.parse(parameters);
  }

  evaluate(relationship: Omit<CalculatedProductRelationship, 'reliability'>): number {
    if (relationship.evidence.kind !== 'co_occurrence') {
      throw new UnsupportedRelationshipReliabilityEvidenceError(relationship.evidence.kind);
    }
    return calculateEvidenceReliability(relationship.evidence, this.parameters);
  }

  evaluateCandidate(candidate: ProductRelationshipCandidate): CalculatedProductRelationship {
    const relationship = {
      sourceProduct: candidate.sourceProduct,
      targetProduct: candidate.targetProduct,
      relationshipType: candidate.relationshipType,
      evidence: candidate.evidence,
      reliability: calculateEvidenceReliability(candidate.evidence, this.parameters),
      evidenceWindow: candidate.evidenceWindow,
      modelVersion: candidate.modelVersion,
    };

    return calculatedProductRelationshipSchema.parse(relationship);
  }

  evaluateCandidates(candidates: ProductRelationshipCandidate[]): CalculatedProductRelationship[] {
    return candidates.map((candidate) => this.evaluateCandidate(candidate));
  }
}
