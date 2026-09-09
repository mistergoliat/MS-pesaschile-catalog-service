import type {
  ActiveTrainingSemanticSnapshotV2Reader,
  TrainingSemanticResolutionState,
  TrainingSemanticRuntimeV2Fact,
  TrainingSemanticSnapshotV2Metadata,
} from '../../../domain/training-semantic-snapshot/index.js';
import type { TrainingSemanticRegistryV2 } from '../../../domain/training-semantics-v2/index.js';

export type TrainingSemanticReadPort = Pick<
  ActiveTrainingSemanticSnapshotV2Reader,
  'getMetadata' | 'getProductTrainingSemanticFact'
>;

export type PublicTrainingSemanticEvidence = {
  readonly kind: string;
  readonly sourceId?: string;
  readonly matchedText?: string;
  readonly ruleId?: string;
  readonly note?: string;
};

export type PublicTrainingExerciseCapability = {
  readonly code: string;
  readonly relationType: string;
  readonly classificationConfidence: string;
  readonly evidence: readonly PublicTrainingSemanticEvidence[];
};

export type PublicTrainingFunction = {
  readonly code: string;
  readonly relationType: string;
  readonly evidence: readonly PublicTrainingSemanticEvidence[];
};

export type PublicTrainingSemanticLineage = {
  readonly snapshotId: string;
  readonly semanticChecksum: string;
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly classifierVersion: string;
  readonly rulesHash: string;
};

export type PublicDerivedTrainingSemantics = {
  readonly bodyRegions: readonly string[];
  readonly primaryMuscleGroups: readonly string[];
  readonly secondaryMuscleGroups: readonly string[];
  readonly trainingPatterns: readonly string[];
};

export type PublicTrainingSemanticProduct = {
  readonly schemaVersion: '2';
  readonly productId: number;
  readonly resolutionState: TrainingSemanticResolutionState;
  readonly coverageStatus: string;
  readonly exerciseCapabilities: readonly PublicTrainingExerciseCapability[];
  readonly trainingFunctions: readonly PublicTrainingFunction[];
  readonly derived: PublicDerivedTrainingSemantics;
  readonly lineage: PublicTrainingSemanticLineage;
};

export type PublicTrainingSemanticBatchResponse = {
  readonly schemaVersion: '2';
  readonly lineage: PublicTrainingSemanticLineage;
  readonly products: readonly PublicTrainingSemanticBatchProduct[];
  readonly missingProductIds: readonly number[];
};

export type PublicTrainingSemanticBatchProduct = Omit<PublicTrainingSemanticProduct, 'schemaVersion' | 'lineage'>;

export type PublicTrainingSemanticRegistry = {
  readonly schemaVersion: '2';
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly status: string;
  readonly exerciseCapabilities: readonly unknown[];
  readonly trainingFunctions: readonly unknown[];
  readonly bodyRegions: readonly string[];
  readonly muscleGroups: readonly string[];
  readonly trainingPatterns: readonly string[];
  readonly exerciseDerivedRelations: readonly unknown[];
  readonly familyTrainingFunctionDerivations: readonly unknown[];
  readonly semanticBoundaries: TrainingSemanticRegistryV2['semanticBoundaries'];
};

export type TrainingSemanticReadService = {
  getProduct(productId: number): PublicTrainingSemanticProduct;
  getProducts(productIds: readonly number[], expectedSnapshotId?: string): PublicTrainingSemanticBatchResponse;
  getRegistry(): PublicTrainingSemanticRegistry;
};

export type TrainingSemanticReadMetadata = TrainingSemanticSnapshotV2Metadata;
export type TrainingSemanticRuntimeFact = TrainingSemanticRuntimeV2Fact;
