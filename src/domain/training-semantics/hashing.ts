import { sha256Stable, stableStringify } from '../../shared/checksum.js';
import type { TrainingSemanticRegistry } from './contracts.js';

type CanonicalTrainingSemanticRegistry = {
  readonly capabilities: readonly {
    readonly code: string;
    readonly canonicalName: string;
    readonly description: string;
    readonly status: string;
    readonly derivedBodyRegions: readonly string[];
    readonly primaryMuscleGroups: readonly string[];
    readonly secondaryMuscleGroups: readonly string[];
    readonly trainingPatterns: readonly string[];
  }[];
  readonly bodyRegions: readonly string[];
  readonly muscleGroups: readonly string[];
  readonly trainingPatterns: readonly string[];
};

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

/**
 * Returns the semantic payload only. Provenance (`createdFrom`), status and
 * timestamps are deliberately excluded from the semantic hash.
 */
export function canonicalizeTrainingSemanticRegistry(registry: TrainingSemanticRegistry): CanonicalTrainingSemanticRegistry {
  return {
    capabilities: [...registry.capabilities]
      .sort((a, b) => a.code.localeCompare(b.code))
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
    bodyRegions: sorted(registry.bodyRegions),
    muscleGroups: sorted(registry.muscleGroups),
    trainingPatterns: sorted(registry.trainingPatterns),
  };
}

export function serializeTrainingSemanticRegistry(registry: TrainingSemanticRegistry): string {
  return stableStringify(canonicalizeTrainingSemanticRegistry(registry));
}

export function computeTrainingSemanticRegistryHash(registry: TrainingSemanticRegistry): string {
  return sha256Stable(canonicalizeTrainingSemanticRegistry(registry));
}
