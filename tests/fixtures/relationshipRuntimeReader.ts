import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import {
  DefaultProductRelationshipSnapshotBuilder,
  type ProductRelationshipSnapshot,
} from '../../src/domain/recommendation/relationship-engine/publication/index.js';
import {
  emptySnapshotMetadata,
  snapshotRelationshipAtoB,
  snapshotRelationshipAtoC,
  snapshotRelationshipBtoA,
  snapshotRelationshipWithSourceCombination,
  snapshotRelationshipWithTargetCombination,
  validatedSnapshotRelationships,
  validatedWrapper,
} from './relationshipSnapshotPublisher.js';

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildRuntimeSnapshot(
  relationships: readonly CalculatedProductRelationship[] = [
    snapshotRelationshipAtoB,
    snapshotRelationshipAtoC,
    snapshotRelationshipBtoA,
  ],
): ProductRelationshipSnapshot {
  return new DefaultProductRelationshipSnapshotBuilder().build({
    relationships: relationships.map((relationship) => validatedWrapper(relationship)),
  }).snapshot;
}

export function buildEmptyRuntimeSnapshot(): ProductRelationshipSnapshot {
  return new DefaultProductRelationshipSnapshotBuilder().build({
    relationships: [],
    parameters: { allowEmptySnapshot: true },
    emptySnapshotMetadata,
  }).snapshot;
}

export const runtimeSnapshot = buildRuntimeSnapshot();

export const runtimeCombinationSnapshot = buildRuntimeSnapshot([
  snapshotRelationshipAtoB,
  snapshotRelationshipWithTargetCombination,
  snapshotRelationshipWithSourceCombination,
]);

export const runtimeSecondSnapshot = buildRuntimeSnapshot([
  {
    ...snapshotRelationshipAtoB,
    targetProduct: { productId: 'D' },
    evidence: {
      kind: 'co_occurrence',
      jointCount: 8,
      sourceCount: 20,
      targetCount: 8,
      totalTransactions: 40,
      support: 0.2,
      confidence: 0.4,
      lift: 2,
    },
    reliability: 0.7,
  },
]);

export const runtimeRelationshipSet = {
  snapshotRelationshipAtoB,
  snapshotRelationshipAtoC,
  snapshotRelationshipBtoA,
  snapshotRelationshipWithSourceCombination,
  snapshotRelationshipWithTargetCombination,
  validatedSnapshotRelationships,
} as const;
