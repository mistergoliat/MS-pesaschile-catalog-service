import { sha256Stable, stableStringify } from '../../shared/checksum.js';
import type { TrainingSemanticRegistryV2 } from './contracts.js';

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

/**
 * Canonical semantic payload. Provenance and the generated registryHash are
 * intentionally excluded; filesystem order and source timestamps cannot
 * change the identity of a semantic registry.
 */
export function canonicalizeTrainingSemanticRegistryV2(registry: TrainingSemanticRegistryV2) {
  return {
    schemaVersion: registry.schemaVersion,
    registryVersion: registry.registryVersion,
    status: registry.status,
    exerciseCapabilities: [...registry.exerciseCapabilities]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((definition) => ({
        code: definition.code,
        canonicalName: definition.canonicalName,
        description: definition.description,
        status: definition.status,
        derivedBodyRegions: sorted(definition.derivedBodyRegions),
        primaryMuscleGroups: sorted(definition.primaryMuscleGroups),
        secondaryMuscleGroups: sorted(definition.secondaryMuscleGroups),
        trainingPatterns: sorted(definition.trainingPatterns),
      })),
    trainingFunctions: [...registry.trainingFunctions]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((definition) => ({
        code: definition.code,
        canonicalName: definition.canonicalName,
        description: definition.description,
        status: definition.status,
        allowedRelationTypes: sorted(definition.allowedRelationTypes),
        allowedEvidenceKinds: sorted(definition.allowedEvidenceKinds),
      })),
    bodyRegions: sorted(registry.bodyRegions),
    muscleGroups: sorted(registry.muscleGroups),
    trainingPatterns: sorted(registry.trainingPatterns),
    exerciseDerivedRelations: [...registry.exerciseDerivedRelations]
      .sort((left, right) => left.capabilityCode.localeCompare(right.capabilityCode))
      .map((relation) => ({
        capabilityCode: relation.capabilityCode,
        bodyRegions: sorted(relation.bodyRegions),
        primaryMuscleGroups: sorted(relation.primaryMuscleGroups),
        secondaryMuscleGroups: sorted(relation.secondaryMuscleGroups),
        trainingPatterns: sorted(relation.trainingPatterns),
      })),
    familyTrainingFunctionDerivations: [...registry.familyTrainingFunctionDerivations]
      .sort((left, right) => `${left.productFamily}\u0000${left.trainingFunctionCode}`.localeCompare(`${right.productFamily}\u0000${right.trainingFunctionCode}`))
      .map((derivation) => ({ ...derivation })),
    semanticBoundaries: registry.semanticBoundaries,
  };
}

export function serializeTrainingSemanticRegistryV2(registry: TrainingSemanticRegistryV2): string {
  return stableStringify(canonicalizeTrainingSemanticRegistryV2(registry));
}

export function computeTrainingSemanticRegistryV2Hash(registry: TrainingSemanticRegistryV2): string {
  return sha256Stable(canonicalizeTrainingSemanticRegistryV2(registry));
}

