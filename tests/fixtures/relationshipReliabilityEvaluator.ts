import type { ProductRelationshipCandidate } from '../../src/domain/recommendation/relationship-engine/calculators/contracts.js';

export const baseReliabilityCandidate: ProductRelationshipCandidate = {
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
  evidenceWindow: {
    from: '2025-01-01T00:00:00.000Z',
    to: '2025-12-31T23:59:59.000Z',
  },
  modelVersion: 'same-order.0',
};

export const lowReliabilityCandidate: ProductRelationshipCandidate = {
  ...baseReliabilityCandidate,
  evidence: {
    kind: 'co_occurrence',
    jointCount: 1,
    sourceCount: 20,
    targetCount: 20,
    totalTransactions: 100,
    support: 0.01,
    confidence: 0.05,
    lift: 0.25,
  },
};

export const highReliabilityCandidate: ProductRelationshipCandidate = {
  ...baseReliabilityCandidate,
  evidence: {
    kind: 'co_occurrence',
    jointCount: 40,
    sourceCount: 50,
    targetCount: 45,
    totalTransactions: 100,
    support: 0.4,
    confidence: 0.8,
    lift: 1.7777777777777777,
  },
};

export function candidateWithEvidence(
  evidence: ProductRelationshipCandidate['evidence'],
): ProductRelationshipCandidate {
  return {
    ...baseReliabilityCandidate,
    evidence,
  };
}

export const reliabilityCandidateBatch: ProductRelationshipCandidate[] = [
  baseReliabilityCandidate,
  {
    ...highReliabilityCandidate,
    sourceProduct: { productId: 'A' },
    targetProduct: { productId: 'C' },
  },
  {
    ...lowReliabilityCandidate,
    sourceProduct: { productId: 'B' },
    targetProduct: { productId: 'A' },
  },
];

export const relationshipReliabilityEvaluatorFixtures = {
  baseReliabilityCandidate,
  lowReliabilityCandidate,
  highReliabilityCandidate,
  reliabilityCandidateBatch,
} as const;

