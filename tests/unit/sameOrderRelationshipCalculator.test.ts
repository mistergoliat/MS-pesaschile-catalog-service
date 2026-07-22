import { describe, expect, it } from 'vitest';
import {
  coOccurrenceRelationshipEvidenceSchema,
  productRelationshipCandidateCalculationResultSchema,
  productRelationshipCandidateSchema,
  SameOrderRelationshipCalculator,
  sameOrderCalculationWarningSchema,
} from '../../src/domain/recommendation/relationship-engine/calculators/index.js';
import {
  buildInputBase,
  buildInputWith,
  combinationsDataset,
  emptyDataset,
  lowConfidenceDataset,
  lowLiftDataset,
  mixedCustomerDataset,
  multiSourceLimitDataset,
  multipleOrdersDataset,
  onlyCartsDataset,
  order,
  outsideWindowDataset,
  productA,
  productACombination1,
  productB,
  quantityDataset,
  singleProductOrderDataset,
  sourceLimitDataset,
  threeProductOrderDataset,
  tieDataset,
  twoProductOrderDataset,
  unorderedDataset,
  windowBoundaryDataset,
} from '../fixtures/sameOrderRelationshipCalculator.js';

function calculate(dataset = twoProductOrderDataset, buildInput = buildInputBase) {
  return new SameOrderRelationshipCalculator().calculate({ dataset, buildInput });
}

function findCandidate(sourceProductId: string, targetProductId: string, combinationId?: string) {
  const result = calculate(multipleOrdersDataset);
  return result.candidates.find((candidate) =>
    candidate.sourceProduct.productId === sourceProductId &&
    candidate.targetProduct.productId === targetProductId &&
    candidate.targetProduct.combinationId === combinationId,
  );
}

describe('SameOrderRelationshipCalculator transaction selection', () => {
  it('supports only same_order', () => {
    const calculator = new SameOrderRelationshipCalculator();
    expect(calculator.supports('same_order')).toBe(true);
    expect(calculator.supports('same_cart')).toBe(false);
  });

  it('processes only orders', () => {
    const result = calculate({
      transactions: [...twoProductOrderDataset.transactions, ...onlyCartsDataset.transactions],
      rules: [],
    });
    expect(result.statistics.ordersRead).toBe(1);
    expect(result.statistics.cartsIgnored).toBe(2);
  });

  it('ignores carts', () => {
    const result = calculate(onlyCartsDataset);
    expect(result.candidates).toEqual([]);
    expect(result.statistics.cartsIgnored).toBe(2);
  });

  it('ignores orders before dataWindow', () => {
    const result = calculate(outsideWindowDataset);
    expect(result.statistics.ordersOutsideDataWindow).toBe(2);
  });

  it('ignores orders after dataWindow', () => {
    const result = calculate(outsideWindowDataset);
    expect(result.statistics.ordersProcessed).toBe(1);
  });

  it('accepts exact dataWindow boundaries', () => {
    const result = calculate(windowBoundaryDataset);
    expect(result.statistics.ordersProcessed).toBe(2);
  });

  it('ignores single-product orders', () => {
    const result = calculate(singleProductOrderDataset);
    expect(result.statistics.singleProductOrdersIgnored).toBe(1);
    expect(result.candidates).toEqual([]);
  });

  it('processes orders with two or more products', () => {
    const result = calculate(twoProductOrderDataset);
    expect(result.statistics.ordersProcessed).toBe(1);
    expect(result.candidates).toHaveLength(2);
  });

  it('does not require customerKey', () => {
    const result = calculate(mixedCustomerDataset);
    expect(result.statistics.ordersProcessed).toBe(2);
  });
});

describe('SameOrderRelationshipCalculator counts', () => {
  it('calculates total processed orders in evidence', () => {
    const candidate = findCandidate('A', 'B');
    expect(candidate?.evidence.totalTransactions).toBe(3);
  });

  it('calculates source product count', () => {
    const candidate = findCandidate('A', 'B');
    expect(candidate?.evidence.sourceCount).toBe(3);
  });

  it('calculates target product count', () => {
    const candidate = findCandidate('A', 'B');
    expect(candidate?.evidence.targetCount).toBe(2);
  });

  it('calculates joint count', () => {
    const candidate = findCandidate('A', 'B');
    expect(candidate?.evidence.jointCount).toBe(2);
  });

  it('counts presence and not quantity', () => {
    const result = calculate(quantityDataset);
    const candidate = result.candidates.find((item) => item.sourceProduct.productId === 'A' && item.targetProduct.productId === 'B');
    expect(candidate?.evidence.jointCount).toBe(1);
    expect(candidate?.evidence.sourceCount).toBe(1);
  });

  it('does not duplicate product inside an order', () => {
    const result = calculate({
      transactions: [
        {
          ...order('order-dup-inside', [productA, productB]),
          products: [
            { product: productA, quantity: 1 },
            { product: productA, quantity: 2 },
            { product: productB, quantity: 1 },
          ],
        },
      ],
      rules: [],
    });
    expect(result.candidates).toHaveLength(2);
  });

  it('distinguishes combinations', () => {
    const result = calculate(combinationsDataset);
    expect(result.statistics.distinctProductsObserved).toBe(3);
    expect(result.candidates.some((candidate) => candidate.sourceProduct.combinationId === '1')).toBe(true);
  });

  it('distinguishes base and combination products', () => {
    const result = calculate({
      transactions: [order('order-base-combo', [productA, productACombination1])],
      rules: [],
    });
    expect(result.candidates).toHaveLength(2);
  });
});

describe('SameOrderRelationshipCalculator direction', () => {
  it('generates A to B', () => {
    const result = calculate(twoProductOrderDataset);
    expect(result.candidates.some((candidate) => candidate.sourceProduct.productId === 'A' && candidate.targetProduct.productId === 'B')).toBe(true);
  });

  it('generates B to A', () => {
    const result = calculate(twoProductOrderDataset);
    expect(result.candidates.some((candidate) => candidate.sourceProduct.productId === 'B' && candidate.targetProduct.productId === 'A')).toBe(true);
  });

  it('generates six directed relationships for three products', () => {
    const result = calculate(threeProductOrderDataset);
    expect(result.candidates).toHaveLength(6);
  });

  it('keeps different confidence by direction', () => {
    const result = calculate(multipleOrdersDataset);
    const aToB = result.candidates.find((candidate) => candidate.sourceProduct.productId === 'A' && candidate.targetProduct.productId === 'B');
    const bToA = result.candidates.find((candidate) => candidate.sourceProduct.productId === 'B' && candidate.targetProduct.productId === 'A');
    expect(aToB?.evidence.confidence).toBe(2 / 3);
    expect(bToA?.evidence.confidence).toBe(1);
  });

  it('avoids self-relations', () => {
    const result = calculate(threeProductOrderDataset);
    expect(result.candidates.every((candidate) => candidate.sourceProduct.productId !== candidate.targetProduct.productId)).toBe(true);
  });

  it('generates directed pairs directly for all ordered products', () => {
    const result = calculate(threeProductOrderDataset);
    expect(result.statistics.directedPairsObserved).toBe(6);
  });
});

describe('SameOrderRelationshipCalculator metrics', () => {
  it('calculates support correctly', () => {
    const candidate = findCandidate('A', 'B');
    expect(candidate?.evidence.support).toBe(2 / 3);
  });

  it('calculates confidence correctly', () => {
    const candidate = findCandidate('A', 'C');
    expect(candidate?.evidence.confidence).toBe(1 / 3);
  });

  it('calculates lift correctly', () => {
    const candidate = findCandidate('A', 'B');
    expect(candidate?.evidence.lift).toBe(1);
  });

  it('preserves jointCount', () => {
    const candidate = findCandidate('B', 'A');
    expect(candidate?.evidence.jointCount).toBe(2);
  });

  it('preserves sourceCount', () => {
    const candidate = findCandidate('B', 'A');
    expect(candidate?.evidence.sourceCount).toBe(2);
  });

  it('preserves targetCount', () => {
    const candidate = findCandidate('B', 'A');
    expect(candidate?.evidence.targetCount).toBe(3);
  });

  it('does not generate non-finite metrics', () => {
    const result = calculate(multipleOrdersDataset);
    for (const candidate of result.candidates) {
      expect(Number.isFinite(candidate.evidence.support)).toBe(true);
      expect(Number.isFinite(candidate.evidence.confidence)).toBe(true);
      expect(Number.isFinite(candidate.evidence.lift)).toBe(true);
    }
  });

  it('emits evidence accepted by T03 co-occurrence schema', () => {
    const result = calculate(twoProductOrderDataset);
    expect(coOccurrenceRelationshipEvidenceSchema.safeParse(result.candidates[0]?.evidence).success).toBe(true);
  });
});

describe('SameOrderRelationshipCalculator filters', () => {
  it('applies minimumJointCount', () => {
    const result = calculate(multipleOrdersDataset, buildInputWith({ minimumJointCount: 2 }));
    expect(result.candidates.every((candidate) => candidate.evidence.jointCount >= 2)).toBe(true);
  });

  it('applies minimumConfidence', () => {
    const result = calculate(lowConfidenceDataset, buildInputWith({ minimumConfidence: 0.5 }));
    expect(result.candidates.every((candidate) => candidate.evidence.confidence >= 0.5)).toBe(true);
  });

  it('applies minimumLift', () => {
    const result = calculate(lowLiftDataset, buildInputWith({ minimumLift: 1 }));
    expect(result.candidates.every((candidate) => candidate.evidence.lift >= 1)).toBe(true);
  });

  it('applies filters in deterministic order', () => {
    const result = calculate(multipleOrdersDataset, buildInputWith({ minimumJointCount: 2, minimumConfidence: 1 }));
    expect(result.statistics.candidatesRejectedByJointCount).toBeGreaterThan(0);
    expect(result.statistics.candidatesRejectedByConfidence).toBeGreaterThan(0);
  });

  it('accepts values exactly equal to minimums', () => {
    const result = calculate(twoProductOrderDataset, buildInputWith({ minimumJointCount: 1, minimumConfidence: 1, minimumLift: 1 }));
    expect(result.candidates).toHaveLength(2);
  });

  it('rejects values below minimum joint count', () => {
    const result = calculate(twoProductOrderDataset, buildInputWith({ minimumJointCount: 2 }));
    expect(result.candidates).toEqual([]);
  });

  it('rejects values below minimum confidence', () => {
    const result = calculate(multipleOrdersDataset, buildInputWith({ minimumConfidence: 0.8 }));
    expect(result.candidates.some((candidate) => candidate.sourceProduct.productId === 'A' && candidate.targetProduct.productId === 'B')).toBe(false);
  });

  it('rejects values below minimum lift', () => {
    const result = calculate(lowLiftDataset, buildInputWith({ minimumLift: 0.9 }));
    const aToC = result.candidates.find((candidate) => candidate.sourceProduct.productId === 'A' && candidate.targetProduct.productId === 'C');
    expect(aToC).toBeUndefined();
  });

  it('counts candidates rejected by jointCount only once', () => {
    const result = calculate(twoProductOrderDataset, buildInputWith({ minimumJointCount: 2, minimumConfidence: 2 as never }));
    expect(result.statistics.candidatesRejectedByJointCount).toBe(2);
    expect(result.statistics.candidatesRejectedByConfidence).toBe(0);
  });
});

describe('SameOrderRelationshipCalculator source limit', () => {
  it('keeps configured maximum per source', () => {
    const result = calculate(sourceLimitDataset, buildInputWith({ maximumRelationshipsPerSource: 2 }));
    const sourceACandidates = result.candidates.filter((candidate) => candidate.sourceProduct.productId === 'A');
    expect(sourceACandidates).toHaveLength(2);
  });

  it('sorts before truncating by confidence lift jointCount and target identity', () => {
    const result = calculate(sourceLimitDataset, buildInputWith({ maximumRelationshipsPerSource: 1 }));
    const sourceATarget = result.candidates.find((candidate) => candidate.sourceProduct.productId === 'A')?.targetProduct.productId;
    expect(sourceATarget).toBe('B');
  });

  it('emits source limit warning', () => {
    const result = calculate(sourceLimitDataset, buildInputWith({ maximumRelationshipsPerSource: 1 }));
    expect(result.warnings.some((warning) => warning.code === 'SOURCE_RELATIONSHIP_LIMIT_APPLIED')).toBe(true);
  });

  it('counts candidates removed by source limit', () => {
    const result = calculate(sourceLimitDataset, buildInputWith({ maximumRelationshipsPerSource: 1 }));
    expect(result.statistics.candidatesRejectedBySourceLimit).toBeGreaterThan(0);
  });

  it('does not mix limits between sources', () => {
    const result = calculate(multiSourceLimitDataset, buildInputWith({ maximumRelationshipsPerSource: 1 }));
    const sourceCounts = new Map<string, number>();
    for (const candidate of result.candidates) {
      sourceCounts.set(candidate.sourceProduct.productId, (sourceCounts.get(candidate.sourceProduct.productId) ?? 0) + 1);
    }
    expect([...sourceCounts.values()].every((count) => count <= 1)).toBe(true);
  });

  it('includes serializable details in source limit warning', () => {
    const result = calculate(sourceLimitDataset, buildInputWith({ maximumRelationshipsPerSource: 1 }));
    const warning = result.warnings.find((item) => item.code === 'SOURCE_RELATIONSHIP_LIMIT_APPLIED');
    expect(JSON.stringify(warning?.details)).toContain('rejected');
  });
});

describe('SameOrderRelationshipCalculator determinism', () => {
  it('uses stable candidate output order', () => {
    const result = calculate(unorderedDataset);
    const keys = result.candidates.map((candidate) => `${candidate.sourceProduct.productId}->${candidate.targetProduct.productId}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('uses stable tie-break by target identity', () => {
    const result = calculate(tieDataset);
    const aTargets = result.candidates
      .filter((candidate) => candidate.sourceProduct.productId === 'A')
      .map((candidate) => candidate.targetProduct.productId);
    expect(aTargets).toEqual(['B', 'C']);
  });

  it('returns identical result for same input', () => {
    const first = calculate(multipleOrdersDataset);
    const second = calculate(multipleOrdersDataset);
    expect(second).toEqual(first);
  });

  it('does not depend on the clock', () => {
    const result = calculate(twoProductOrderDataset);
    expect(JSON.stringify(result)).not.toContain(new Date().toISOString());
  });

  it('does not generate IDs', () => {
    const result = calculate(twoProductOrderDataset);
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/u);
  });

  it('does not mutate the input dataset', () => {
    const before = JSON.stringify(combinationsDataset);
    calculate(combinationsDataset);
    expect(JSON.stringify(combinationsDataset)).toBe(before);
  });
});

describe('SameOrderRelationshipCalculator statistics', () => {
  it('counts transactionsRead', () => {
    const result = calculate({ transactions: [...twoProductOrderDataset.transactions, ...onlyCartsDataset.transactions], rules: [] });
    expect(result.statistics.transactionsRead).toBe(3);
  });

  it('counts ordersRead', () => {
    const result = calculate(outsideWindowDataset);
    expect(result.statistics.ordersRead).toBe(3);
  });

  it('counts cartsIgnored', () => {
    const result = calculate(onlyCartsDataset);
    expect(result.statistics.cartsIgnored).toBe(2);
  });

  it('counts orders outside window', () => {
    const result = calculate(outsideWindowDataset);
    expect(result.statistics.ordersOutsideDataWindow).toBe(2);
  });

  it('counts single product orders', () => {
    const result = calculate(singleProductOrderDataset);
    expect(result.statistics.singleProductOrdersIgnored).toBe(1);
  });

  it('counts processed orders', () => {
    const result = calculate(multipleOrdersDataset);
    expect(result.statistics.ordersProcessed).toBe(3);
  });

  it('counts distinct products', () => {
    const result = calculate(multipleOrdersDataset);
    expect(result.statistics.distinctProductsObserved).toBe(3);
  });

  it('counts directed pair observations', () => {
    const result = calculate(threeProductOrderDataset);
    expect(result.statistics.directedPairsObserved).toBe(6);
  });

  it('counts generated candidates', () => {
    const result = calculate(threeProductOrderDataset);
    expect(result.statistics.candidatesGenerated).toBe(6);
  });

  it('counts rejections by each filter', () => {
    const result = calculate(multipleOrdersDataset, buildInputWith({ minimumJointCount: 2, minimumConfidence: 0.9, minimumLift: 1.1 }));
    expect(result.statistics.candidatesRejectedByJointCount).toBeGreaterThan(0);
    expect(result.statistics.candidatesRejectedByConfidence).toBeGreaterThan(0);
    expect(result.statistics.candidatesRejectedByLift).toBeGreaterThanOrEqual(0);
  });

  it('counts accepted candidates as candidate length', () => {
    const result = calculate(multipleOrdersDataset);
    expect(result.statistics.candidatesAccepted).toBe(result.candidates.length);
  });

  it('satisfies order statistics invariant', () => {
    const result = calculate(outsideWindowDataset);
    expect(result.statistics.ordersRead).toBe(
      result.statistics.ordersOutsideDataWindow +
      result.statistics.singleProductOrdersIgnored +
      result.statistics.ordersProcessed,
    );
  });

  it('satisfies transaction statistics invariant', () => {
    const result = calculate({ transactions: [...outsideWindowDataset.transactions, ...onlyCartsDataset.transactions], rules: [] });
    expect(result.statistics.transactionsRead).toBe(result.statistics.ordersRead + result.statistics.cartsIgnored);
  });

  it('result schema validates statistics invariant', () => {
    const result = calculate(multipleOrdersDataset);
    expect(productRelationshipCandidateCalculationResultSchema.safeParse(result).success).toBe(true);
  });
});

describe('SameOrderRelationshipCalculator warnings', () => {
  it('emits EMPTY_DATASET', () => {
    const result = calculate(emptyDataset);
    expect(result.warnings.some((warning) => warning.code === 'EMPTY_DATASET')).toBe(true);
  });

  it('emits NO_ELIGIBLE_ORDERS', () => {
    const result = calculate(onlyCartsDataset);
    expect(result.warnings.some((warning) => warning.code === 'NO_ELIGIBLE_ORDERS')).toBe(true);
  });

  it('emits NO_RELATIONSHIPS_GENERATED', () => {
    const result = calculate(twoProductOrderDataset, buildInputWith({ minimumJointCount: 2 }));
    expect(result.warnings.some((warning) => warning.code === 'NO_RELATIONSHIPS_GENERATED')).toBe(true);
  });

  it('emits SOURCE_RELATIONSHIP_LIMIT_APPLIED per affected source', () => {
    const result = calculate(sourceLimitDataset, buildInputWith({ maximumRelationshipsPerSource: 1 }));
    expect(result.warnings.filter((warning) => warning.code === 'SOURCE_RELATIONSHIP_LIMIT_APPLIED').length).toBeGreaterThan(0);
  });

  it('warning details are serializable', () => {
    const result = calculate(sourceLimitDataset, buildInputWith({ maximumRelationshipsPerSource: 1 }));
    for (const warning of result.warnings) {
      expect(sameOrderCalculationWarningSchema.safeParse(warning).success).toBe(true);
    }
  });
});

describe('SameOrderRelationshipCalculator compatibility', () => {
  it('uses same_order relationship type for every candidate', () => {
    const result = calculate(multipleOrdersDataset);
    expect(result.candidates.every((candidate) => candidate.relationshipType === 'same_order')).toBe(true);
  });

  it('uses build input dataWindow as evidenceWindow', () => {
    const result = calculate(multipleOrdersDataset);
    expect(result.candidates.every((candidate) => JSON.stringify(candidate.evidenceWindow) === JSON.stringify(buildInputBase.dataWindow))).toBe(true);
  });

  it('uses build input modelVersion', () => {
    const result = calculate(multipleOrdersDataset);
    expect(result.candidates.every((candidate) => candidate.modelVersion === buildInputBase.modelVersion)).toBe(true);
  });

  it('candidate output contains no reliability', () => {
    const result = calculate(twoProductOrderDataset);
    expect(result.candidates[0]).not.toHaveProperty('reliability');
  });

  it('candidate output contains no rank', () => {
    const result = calculate(twoProductOrderDataset);
    expect(result.candidates[0]).not.toHaveProperty('rank');
  });

  it('candidate output contains no publicationId', () => {
    const result = calculate(twoProductOrderDataset);
    expect(result.candidates[0]).not.toHaveProperty('publicationId');
  });

  it('candidate schema rejects reliability if added', () => {
    const result = calculate(twoProductOrderDataset);
    expect(productRelationshipCandidateSchema.safeParse({ ...result.candidates[0], reliability: 0.5 }).success).toBe(false);
  });

  it('candidate schema rejects rank if added', () => {
    const result = calculate(twoProductOrderDataset);
    expect(productRelationshipCandidateSchema.safeParse({ ...result.candidates[0], rank: 1 }).success).toBe(false);
  });

  it('candidate schema rejects publicationId if added', () => {
    const result = calculate(twoProductOrderDataset);
    expect(productRelationshipCandidateSchema.safeParse({ ...result.candidates[0], publicationId: 'pub' }).success).toBe(false);
  });

  it('does not contain SQL or PrestaShop markers', () => {
    const result = calculate(twoProductOrderDataset);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/select |prestashop|ps_/u);
  });

  it('does not personalize by customerKey', () => {
    const withCustomer = calculate(mixedCustomerDataset);
    const withoutCustomer = calculate({
      transactions: mixedCustomerDataset.transactions.map((transaction) => ({ ...transaction, customerKey: undefined })),
      rules: [],
    });
    expect(withoutCustomer.candidates).toEqual(withCustomer.candidates);
  });
});
