import type { TrainingSemanticClassificationResult } from '../../../src/domain/training-semantic-classification/index.js';
import { trainingCapabilityCodes, trainingCoverageStatuses, type TrainingCapabilityCode } from '../../../src/domain/training-semantics/index.js';

export type TrainingSemanticClassificationSummary = {
  readonly productCount: number;
  readonly classifierVersion: string;
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly rulesHash: string;
  readonly coverageCounts: Record<string, number>;
  readonly capabilityCounts: Record<string, number>;
  readonly relationCounts: Record<string, number>;
  readonly confidenceCounts: Record<string, number>;
  readonly reviewCandidateCount: number;
  readonly multiAssignmentCount: number;
  readonly deferredFindingCount: number;
};

export function buildTrainingSemanticClassificationSummary(results: readonly TrainingSemanticClassificationResult[]): TrainingSemanticClassificationSummary {
  const coverageCounts: Record<string, number> = Object.fromEntries(trainingCoverageStatuses.map((status) => [status, 0]));
  const capabilityCounts: Record<string, number> = Object.fromEntries(trainingCapabilityCodes.map((code) => [code, 0]));
  const relationCounts: Record<string, number> = {};
  const confidenceCounts: Record<string, number> = {};
  let reviewCandidateCount = 0;
  let multiAssignmentCount = 0;
  let deferredFindingCount = 0;
  for (const result of results) {
    coverageCounts[result.coverageStatus] = (coverageCounts[result.coverageStatus] ?? 0) + 1;
    reviewCandidateCount += result.reviewCandidates.length;
    deferredFindingCount += result.deferredFindings.length;
    if (result.assignments.length > 1) multiAssignmentCount += 1;
    for (const assignment of result.assignments) {
      capabilityCounts[assignment.capabilityCode] = (capabilityCounts[assignment.capabilityCode] ?? 0) + 1;
      relationCounts[assignment.relationType] = (relationCounts[assignment.relationType] ?? 0) + 1;
      confidenceCounts[assignment.classificationConfidence] = (confidenceCounts[assignment.classificationConfidence] ?? 0) + 1;
    }
  }
  return {
    productCount: results.length,
    classifierVersion: results[0]?.classifierVersion ?? '',
    registryVersion: results[0]?.registryVersion ?? '',
    registryHash: results[0]?.registryHash ?? '',
    rulesHash: results[0]?.rulesHash ?? '',
    coverageCounts,
    capabilityCounts,
    relationCounts,
    confidenceCounts,
    reviewCandidateCount,
    multiAssignmentCount,
    deferredFindingCount,
  };
}

export function sortCapabilityCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) as Record<TrainingCapabilityCode, number>;
}
