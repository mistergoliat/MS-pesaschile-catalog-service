import type { CategoryTrustClass } from '../commercial-product-ontology/index.js';
import type { FeatureTrustClass } from '../product-semantic-classification/contracts.js';
import type {
  ProductTrainingCapabilityAssignment,
  TrainingCapabilityCode,
  TrainingClassificationConfidence,
  TrainingCoverageStatus,
  TrainingRelationType,
  TrainingSemanticEvidence,
} from '../training-semantics/index.js';

export const trainingSemanticClassifierVersion = 'training-semantic-classifier-v1.1' as const;
export type TrainingSemanticClassifierVersion = typeof trainingSemanticClassifierVersion;

export const deterministicTrainingClassificationGeneratedAt = '1970-01-01T00:00:00.000Z' as const;

export type TrainingSemanticClassificationCategory = {
  readonly categoryId: string;
  readonly name: string;
  readonly trustClass: CategoryTrustClass;
};

export type TrainingSemanticClassificationFeature = {
  readonly featureId: string;
  readonly featureName: string;
  readonly value: string;
  readonly trustClass: FeatureTrustClass;
};

/** Catalog evidence projected from the existing Product Semantic Classification input. */
export type TrainingSemanticClassificationInput = {
  readonly productId: number;
  readonly name: string;
  readonly productFamily?: string | null;
  readonly activeStatus?: boolean | null;
  readonly catalogPresence?: 'current_catalog' | 'historical_order_detail_only';
  readonly revenue?: number | null;
  readonly categories: readonly TrainingSemanticClassificationCategory[];
  readonly features: readonly TrainingSemanticClassificationFeature[];
};

export type TrainingSemanticCandidate = {
  readonly capabilityCode: TrainingCapabilityCode;
  readonly relationType: TrainingRelationType;
  readonly classificationConfidence: TrainingClassificationConfidence;
  readonly reviewState: 'HUMAN_REVIEW';
  readonly evidence: readonly TrainingSemanticEvidence[];
  readonly reason: string;
};

export type TrainingDeferredCapabilityFinding = {
  readonly productId: number;
  readonly candidateCode: string;
  readonly matchedText: string;
  readonly reason: string;
};

export type TrainingSemanticClassificationResult = {
  readonly productId: number;
  readonly classifierVersion: TrainingSemanticClassifierVersion;
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly rulesHash: string;
  readonly assignments: readonly ProductTrainingCapabilityAssignment[];
  readonly coverageStatus: TrainingCoverageStatus;
  readonly reviewCandidates: readonly TrainingSemanticCandidate[];
  readonly warnings: readonly string[];
  readonly deferredFindings: readonly TrainingDeferredCapabilityFinding[];
};

export type TrainingSemanticClassificationOptions = {
  readonly generatedAt?: string;
  readonly sourceCatalogExport?: string;
};
