import type {
  ProductInteractionDataset,
  ProductRelationshipBuildInput,
  ProductRelationshipProductReference,
  ProductTransaction,
  TransactionProduct,
} from '../contracts.js';
import type { RelationshipType } from '../../contracts.js';
import {
  productRelationshipCandidateCalculationResultSchema,
  type CoOccurrenceRelationshipEvidence,
  type ProductRelationshipCandidate,
  type ProductRelationshipCandidateCalculationResult,
  type ProductRelationshipCandidateCalculator,
  type SameOrderCalculationStatistics,
  type SameOrderCalculationWarning,
} from './contracts.js';

type ProductEntry = {
  identity: string;
  product: ProductRelationshipProductReference;
};

type PairCounts = {
  source: ProductRelationshipProductReference;
  target: ProductRelationshipProductReference;
  jointCount: number;
};

function productIdentity(product: ProductRelationshipProductReference): string {
  return `${product.productId}:${product.combinationId ?? ''}`;
}

function compareProductReference(
  left: ProductRelationshipProductReference,
  right: ProductRelationshipProductReference,
): number {
  const productCompare = left.productId.localeCompare(right.productId);
  if (productCompare !== 0) {
    return productCompare;
  }
  if (left.combinationId === undefined && right.combinationId !== undefined) {
    return -1;
  }
  if (left.combinationId !== undefined && right.combinationId === undefined) {
    return 1;
  }
  return (left.combinationId ?? '').localeCompare(right.combinationId ?? '');
}

function compareProductEntries(left: ProductEntry, right: ProductEntry): number {
  return compareProductReference(left.product, right.product);
}

function isWithinWindow(transaction: ProductTransaction, buildInput: ProductRelationshipBuildInput): boolean {
  const occurredAt = Date.parse(transaction.occurredAt);
  return (
    Number.isFinite(occurredAt) &&
    occurredAt >= Date.parse(buildInput.dataWindow.from) &&
    occurredAt <= Date.parse(buildInput.dataWindow.to)
  );
}

function uniqueProducts(products: TransactionProduct[]): ProductEntry[] {
  const byIdentity = new Map<string, ProductRelationshipProductReference>();
  for (const item of products) {
    byIdentity.set(productIdentity(item.product), item.product);
  }
  return [...byIdentity.entries()]
    .map(([identity, product]) => ({ identity, product }))
    .sort(compareProductEntries);
}

function makePairKey(sourceIdentity: string, targetIdentity: string): string {
  return `${sourceIdentity}|${targetIdentity}`;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function compareCandidateForSourceLimit(
  left: ProductRelationshipCandidate,
  right: ProductRelationshipCandidate,
): number {
  return (
    right.evidence.confidence - left.evidence.confidence ||
    right.evidence.lift - left.evidence.lift ||
    right.evidence.jointCount - left.evidence.jointCount ||
    compareProductReference(left.targetProduct, right.targetProduct)
  );
}

function compareCandidateOutput(left: ProductRelationshipCandidate, right: ProductRelationshipCandidate): number {
  return (
    compareProductReference(left.sourceProduct, right.sourceProduct) ||
    right.evidence.confidence - left.evidence.confidence ||
    right.evidence.lift - left.evidence.lift ||
    right.evidence.jointCount - left.evidence.jointCount ||
    compareProductReference(left.targetProduct, right.targetProduct)
  );
}

export class SameOrderRelationshipCalculator implements ProductRelationshipCandidateCalculator {
  supports(type: RelationshipType): boolean {
    return type === 'same_order';
  }

  calculate(input: {
    dataset: ProductInteractionDataset;
    buildInput: ProductRelationshipBuildInput;
  }): ProductRelationshipCandidateCalculationResult {
    const statistics: SameOrderCalculationStatistics = {
      transactionsRead: input.dataset.transactions.length,
      ordersRead: 0,
      cartsIgnored: 0,
      ordersOutsideDataWindow: 0,
      singleProductOrdersIgnored: 0,
      ordersProcessed: 0,
      distinctProductsObserved: 0,
      directedPairsObserved: 0,
      candidatesGenerated: 0,
      candidatesRejectedByJointCount: 0,
      candidatesRejectedByConfidence: 0,
      candidatesRejectedByLift: 0,
      candidatesRejectedBySourceLimit: 0,
      candidatesAccepted: 0,
    };
    const warnings: SameOrderCalculationWarning[] = [];
    const productCounts = new Map<string, number>();
    const productsByIdentity = new Map<string, ProductRelationshipProductReference>();
    const pairCounts = new Map<string, PairCounts>();

    if (input.dataset.transactions.length === 0) {
      warnings.push({
        code: 'EMPTY_DATASET',
        message: 'Dataset has no transactions',
      });
    }

    for (const transaction of input.dataset.transactions) {
      if (transaction.transactionType === 'cart') {
        statistics.cartsIgnored += 1;
        continue;
      }

      statistics.ordersRead += 1;

      if (!isWithinWindow(transaction, input.buildInput)) {
        statistics.ordersOutsideDataWindow += 1;
        continue;
      }

      const products = uniqueProducts(transaction.products);
      if (products.length < 2) {
        statistics.singleProductOrdersIgnored += 1;
        continue;
      }

      statistics.ordersProcessed += 1;

      for (const entry of products) {
        increment(productCounts, entry.identity);
        productsByIdentity.set(entry.identity, entry.product);
      }

      for (const source of products) {
        for (const target of products) {
          if (source.identity === target.identity) {
            continue;
          }
          const pairKey = makePairKey(source.identity, target.identity);
          const existing = pairCounts.get(pairKey);
          if (existing) {
            existing.jointCount += 1;
          } else {
            pairCounts.set(pairKey, {
              source: source.product,
              target: target.product,
              jointCount: 1,
            });
          }
        }
      }
    }

    statistics.distinctProductsObserved = productsByIdentity.size;
    statistics.directedPairsObserved = [...pairCounts.values()].reduce((sum, pair) => sum + pair.jointCount, 0);

    if (input.dataset.transactions.length > 0 && statistics.ordersProcessed === 0) {
      warnings.push({
        code: 'NO_ELIGIBLE_ORDERS',
        message: 'No eligible orders were available for same_order calculation',
      });
    }

    const candidatesBySource = new Map<string, ProductRelationshipCandidate[]>();
    const totalOrders = statistics.ordersProcessed;

    for (const pair of [...pairCounts.values()].sort((left, right) =>
      compareProductReference(left.source, right.source) || compareProductReference(left.target, right.target),
    )) {
      const sourceCount = productCounts.get(productIdentity(pair.source)) ?? 0;
      const targetCount = productCounts.get(productIdentity(pair.target)) ?? 0;
      const evidence = this.createEvidence(pair.jointCount, sourceCount, targetCount, totalOrders);
      statistics.candidatesGenerated += 1;

      if (evidence.jointCount < input.buildInput.parameters.minimumJointCount) {
        statistics.candidatesRejectedByJointCount += 1;
        continue;
      }
      if (evidence.confidence < input.buildInput.parameters.minimumConfidence) {
        statistics.candidatesRejectedByConfidence += 1;
        continue;
      }
      if (evidence.lift < input.buildInput.parameters.minimumLift) {
        statistics.candidatesRejectedByLift += 1;
        continue;
      }

      const candidate: ProductRelationshipCandidate = {
        sourceProduct: pair.source,
        targetProduct: pair.target,
        relationshipType: 'same_order',
        evidence,
        evidenceWindow: input.buildInput.dataWindow,
        modelVersion: input.buildInput.modelVersion,
      };
      const sourceKey = productIdentity(pair.source);
      const candidates = candidatesBySource.get(sourceKey) ?? [];
      candidates.push(candidate);
      candidatesBySource.set(sourceKey, candidates);
    }

    const limitedCandidates: ProductRelationshipCandidate[] = [];
    for (const [sourceKey, candidates] of [...candidatesBySource.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const sorted = [...candidates].sort(compareCandidateForSourceLimit);
      const accepted = sorted.slice(0, input.buildInput.parameters.maximumRelationshipsPerSource);
      const rejected = sorted.length - accepted.length;
      statistics.candidatesRejectedBySourceLimit += rejected;
      if (rejected > 0) {
        warnings.push({
          code: 'SOURCE_RELATIONSHIP_LIMIT_APPLIED',
          message: 'maximumRelationshipsPerSource removed one or more same_order candidates',
          sourceProduct: accepted[0]?.sourceProduct ?? candidates[0]!.sourceProduct,
          details: {
            sourceIdentity: sourceKey,
            rejected,
            limit: input.buildInput.parameters.maximumRelationshipsPerSource,
          },
        });
      }
      limitedCandidates.push(...accepted);
    }

    const outputCandidates = limitedCandidates.sort(compareCandidateOutput);
    statistics.candidatesAccepted = outputCandidates.length;

    if (statistics.ordersProcessed > 0 && outputCandidates.length === 0) {
      warnings.push({
        code: 'NO_RELATIONSHIPS_GENERATED',
        message: 'No same_order relationships passed configured filters',
      });
    }

    return productRelationshipCandidateCalculationResultSchema.parse({
      candidates: outputCandidates,
      statistics,
      warnings,
    });
  }

  private createEvidence(
    jointCount: number,
    sourceCount: number,
    targetCount: number,
    totalTransactions: number,
  ): CoOccurrenceRelationshipEvidence {
    const support = totalTransactions > 0 ? jointCount / totalTransactions : 0;
    const confidence = sourceCount > 0 ? jointCount / sourceCount : 0;
    const targetProbability = totalTransactions > 0 ? targetCount / totalTransactions : 0;
    const lift = targetProbability > 0 ? confidence / targetProbability : 0;

    return {
      kind: 'co_occurrence',
      jointCount,
      sourceCount,
      targetCount,
      totalTransactions,
      support,
      confidence,
      lift,
    };
  }
}

