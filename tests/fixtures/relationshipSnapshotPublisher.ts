import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import type { ValidatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/validation/index.js';
import {
  baseValidatedRelationship,
  inverseValidatedRelationship,
  relationshipWithCombination,
} from './relationshipValidator.js';

export function validatedWrapper(relationship: CalculatedProductRelationship): ValidatedProductRelationship {
  return {
    relationship,
    validatedAtModelVersion: relationship.modelVersion,
  };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const snapshotRelationshipAtoB = baseValidatedRelationship;

export const snapshotRelationshipAtoC: CalculatedProductRelationship = {
  ...baseValidatedRelationship,
  targetProduct: { productId: 'C' },
  evidence: {
    kind: 'co_occurrence',
    jointCount: 10,
    sourceCount: 20,
    targetCount: 10,
    totalTransactions: 40,
    support: 0.25,
    confidence: 0.5,
    lift: 2,
  },
  reliability: 0.62,
};

export const snapshotRelationshipBtoA = inverseValidatedRelationship;

export const snapshotRelationshipWithSourceCombination: CalculatedProductRelationship = {
  ...relationshipWithCombination,
  sourceProduct: { productId: 'A', combinationId: '10' },
  targetProduct: { productId: 'C' },
};

export const snapshotRelationshipWithTargetCombination: CalculatedProductRelationship = {
  ...baseValidatedRelationship,
  sourceProduct: { productId: 'A' },
  targetProduct: { productId: 'B', combinationId: '20' },
};

export const snapshotRelationshipDifferentModel: CalculatedProductRelationship = {
  ...baseValidatedRelationship,
  modelVersion: 'same-order.1',
};

export const snapshotRelationshipDifferentWindow: CalculatedProductRelationship = {
  ...baseValidatedRelationship,
  evidenceWindow: {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-12-31T23:59:59.000Z',
  },
};

export const validatedSnapshotRelationships: ValidatedProductRelationship[] = [
  validatedWrapper(snapshotRelationshipAtoB),
  validatedWrapper(snapshotRelationshipAtoC),
  validatedWrapper(snapshotRelationshipBtoA),
];

export const shuffledValidatedSnapshotRelationships: ValidatedProductRelationship[] = [
  validatedWrapper(snapshotRelationshipBtoA),
  validatedWrapper(snapshotRelationshipAtoC),
  validatedWrapper(snapshotRelationshipAtoB),
];

export const emptySnapshotMetadata = {
  modelVersion: 'same-order.0',
  evidenceWindow: {
    from: '2025-01-01T00:00:00.000Z',
    to: '2025-12-31T23:59:59.000Z',
  },
} as const;

export const relationshipSnapshotPublisherFixtures = {
  emptySnapshotMetadata,
  shuffledValidatedSnapshotRelationships,
  snapshotRelationshipAtoB,
  snapshotRelationshipAtoC,
  snapshotRelationshipBtoA,
  snapshotRelationshipDifferentModel,
  snapshotRelationshipDifferentWindow,
  snapshotRelationshipWithSourceCombination,
  snapshotRelationshipWithTargetCombination,
  validatedSnapshotRelationships,
} as const;
