import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';

export const validatorEvidenceWindow = {
  from: '2025-01-01T00:00:00.000Z',
  to: '2025-12-31T23:59:59.000Z',
} as const;

export const baseValidatedRelationship: CalculatedProductRelationship = {
  sourceProduct: { productId: 'A' },
  targetProduct: { productId: 'B' },
  relationshipType: 'same_order',
  evidence: {
    kind: 'co_occurrence',
    jointCount: 12,
    sourceCount: 20,
    targetCount: 16,
    totalTransactions: 40,
    support: 0.3,
    confidence: 0.6,
    lift: 1.5,
  },
  reliability: 0.55,
  evidenceWindow: validatorEvidenceWindow,
  modelVersion: 'same-order.0',
};

export const inverseValidatedRelationship: CalculatedProductRelationship = {
  ...baseValidatedRelationship,
  sourceProduct: { productId: 'B' },
  targetProduct: { productId: 'A' },
  evidence: {
    kind: 'co_occurrence',
    jointCount: 12,
    sourceCount: 16,
    targetCount: 20,
    totalTransactions: 40,
    support: 0.3,
    confidence: 0.75,
    lift: 1.5,
  },
};

export const relationshipWithCombination: CalculatedProductRelationship = {
  ...baseValidatedRelationship,
  sourceProduct: { productId: 'A', combinationId: '10' },
  targetProduct: { productId: 'A', combinationId: '11' },
};

export const relationshipWithoutExtendedCounts: CalculatedProductRelationship = {
  ...baseValidatedRelationship,
  evidence: {
    kind: 'co_occurrence',
    jointCount: 12,
    support: 0.3,
    confidence: 0.6,
    lift: 1.5,
  },
};

export const manualValidatedRelationship: CalculatedProductRelationship = {
  sourceProduct: { productId: 'A' },
  targetProduct: { productId: 'B' },
  relationshipType: 'manual',
  evidence: {
    kind: 'rule',
    ruleId: 'manual-A-B',
    ruleVersion: '2025-01',
  },
  reliability: 0.8,
  evidenceWindow: validatorEvidenceWindow,
  modelVersion: 'manual.0',
};

export const relationshipValidatorBatch: CalculatedProductRelationship[] = [
  baseValidatedRelationship,
  {
    ...baseValidatedRelationship,
    sourceProduct: { productId: 'A' },
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
  },
  inverseValidatedRelationship,
];

export function relationshipWith(
  patch: Partial<CalculatedProductRelationship>,
): CalculatedProductRelationship {
  return {
    ...baseValidatedRelationship,
    ...patch,
  };
}

export const relationshipValidatorFixtures = {
  baseValidatedRelationship,
  inverseValidatedRelationship,
  manualValidatedRelationship,
  relationshipValidatorBatch,
  relationshipWithCombination,
  relationshipWithoutExtendedCounts,
  validatorEvidenceWindow,
} as const;
