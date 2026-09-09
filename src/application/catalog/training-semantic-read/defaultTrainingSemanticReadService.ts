import {
  getTrainingSemanticRegistryV2,
  type TrainingSemanticRegistryV2,
} from '../../../domain/training-semantics-v2/index.js';
import {
  InvalidTrainingSemanticRequestError,
  TrainingSemanticProductNotFoundError,
  TrainingSemanticSnapshotMismatchError,
  TrainingSemanticsUnavailableError,
} from '../../../shared/errors.js';
import type {
  PublicDerivedTrainingSemantics,
  PublicTrainingSemanticBatchResponse,
  PublicTrainingSemanticEvidence,
  PublicTrainingSemanticLineage,
  PublicTrainingSemanticProduct,
  PublicTrainingSemanticRegistry,
  TrainingSemanticReadPort,
  TrainingSemanticReadService,
} from './contracts.js';

const snapshotIdPattern = /^sha256:[a-f0-9]{64}$/u;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function evidence(value: { readonly kind: string; readonly sourceId?: string; readonly matchedText?: string; readonly ruleId?: string; readonly note?: string }): PublicTrainingSemanticEvidence {
  return {
    kind: value.kind,
    ...(value.sourceId !== undefined ? { sourceId: value.sourceId } : {}),
    ...(value.matchedText !== undefined ? { matchedText: value.matchedText } : {}),
    ...(value.ruleId !== undefined ? { ruleId: value.ruleId } : {}),
    ...(value.note !== undefined ? { note: value.note } : {}),
  };
}

function lineage(metadata: NonNullable<ReturnType<TrainingSemanticReadPort['getMetadata']>>): PublicTrainingSemanticLineage {
  return {
    snapshotId: metadata.snapshotId,
    semanticChecksum: metadata.semanticChecksum,
    registryVersion: metadata.registryVersion,
    registryHash: metadata.registryHash,
    classifierVersion: metadata.classifierVersion,
    rulesHash: metadata.rulesHash ?? metadata.classifierV2RulesHash,
  };
}

function derived(fact: NonNullable<ReturnType<TrainingSemanticReadPort['getProductTrainingSemanticFact']>>): PublicDerivedTrainingSemantics {
  // Only exercise capabilities can contribute derived anatomy or patterns.
  return {
    bodyRegions: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.bodyRegions)),
    primaryMuscleGroups: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.primaryMuscleGroups)),
    secondaryMuscleGroups: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.secondaryMuscleGroups)),
    trainingPatterns: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.trainingPatterns)),
  };
}

function projectProduct(
  fact: NonNullable<ReturnType<TrainingSemanticReadPort['getProductTrainingSemanticFact']>>,
  productLineage: PublicTrainingSemanticLineage,
): PublicTrainingSemanticProduct {
  if (!fact.resolutionState) throw new TrainingSemanticsUnavailableError('Active Training Semantic Snapshot V2 record has no resolutionState');
  return {
    schemaVersion: '2',
    productId: fact.productId,
    resolutionState: fact.resolutionState,
    coverageStatus: fact.coverageStatus,
    exerciseCapabilities: fact.exerciseCapabilities.map((assignment) => ({
      code: assignment.capabilityCode,
      relationType: assignment.relationType,
      classificationConfidence: assignment.classificationConfidence,
      evidence: assignment.evidence.map(evidence),
    })),
    trainingFunctions: fact.trainingFunctions.map((assignment) => ({
      code: assignment.functionCode,
      relationType: assignment.relationType,
      evidence: assignment.evidence.map(evidence),
    })),
    derived: derived(fact),
    lineage: productLineage,
  };
}

function validateProductId(productId: number): void {
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new InvalidTrainingSemanticRequestError('productId must be a positive integer');
}

function validateExpectedSnapshotId(expectedSnapshotId: string | undefined): void {
  if (expectedSnapshotId !== undefined && !snapshotIdPattern.test(expectedSnapshotId)) {
    throw new InvalidTrainingSemanticRequestError('expectedSnapshotId must be a sha256 snapshot id');
  }
}

export class DefaultTrainingSemanticReadService implements TrainingSemanticReadService {
  constructor(
    private readonly reader: TrainingSemanticReadPort,
    private readonly registry: TrainingSemanticRegistryV2 = getTrainingSemanticRegistryV2(),
  ) {}

  getProduct(productId: number): PublicTrainingSemanticProduct {
    validateProductId(productId);
    const metadata = this.reader.getMetadata();
    if (!metadata) throw new TrainingSemanticsUnavailableError();
    const fact = this.reader.getProductTrainingSemanticFact(productId);
    if (!fact) throw new TrainingSemanticProductNotFoundError();
    return projectProduct(fact, lineage(metadata));
  }

  getProducts(productIds: readonly number[], expectedSnapshotId?: string): PublicTrainingSemanticBatchResponse {
    if (!Array.isArray(productIds) || productIds.length === 0) throw new InvalidTrainingSemanticRequestError('productIds must be a non-empty array');
    if (productIds.length > 500) throw new InvalidTrainingSemanticRequestError('productIds cannot contain more than 500 ids');
    productIds.forEach(validateProductId);
    validateExpectedSnapshotId(expectedSnapshotId);

    const metadata = this.reader.getMetadata();
    if (!metadata) throw new TrainingSemanticsUnavailableError();
    if (expectedSnapshotId !== undefined && expectedSnapshotId !== metadata.snapshotId) throw new TrainingSemanticSnapshotMismatchError();

    const productLineage = lineage(metadata);
    const products: PublicTrainingSemanticBatchResponse['products'][number][] = [];
    const missingProductIds: number[] = [];
    for (const productId of [...new Set(productIds)]) {
      const fact = this.reader.getProductTrainingSemanticFact(productId);
      if (fact) {
        const projected = projectProduct(fact, productLineage);
        const { schemaVersion: _schemaVersion, lineage: _lineage, ...batchProduct } = projected;
        products.push(batchProduct);
      }
      else missingProductIds.push(productId);
    }
    return { schemaVersion: '2', lineage: productLineage, products, missingProductIds };
  }

  getRegistry(): PublicTrainingSemanticRegistry {
    return {
      schemaVersion: this.registry.schemaVersion,
      registryVersion: this.registry.registryVersion,
      registryHash: this.registry.registryHash,
      status: this.registry.status,
      exerciseCapabilities: this.registry.exerciseCapabilities,
      trainingFunctions: this.registry.trainingFunctions,
      bodyRegions: this.registry.bodyRegions,
      muscleGroups: this.registry.muscleGroups,
      trainingPatterns: this.registry.trainingPatterns,
      exerciseDerivedRelations: this.registry.exerciseDerivedRelations,
      familyTrainingFunctionDerivations: this.registry.familyTrainingFunctionDerivations,
      semanticBoundaries: this.registry.semanticBoundaries,
    };
  }
}

export const defaultTrainingSemanticReadServiceFactory = (reader: TrainingSemanticReadPort): TrainingSemanticReadService => new DefaultTrainingSemanticReadService(reader);
