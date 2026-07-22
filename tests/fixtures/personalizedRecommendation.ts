import type { ProductRelationshipProductReference } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import type {
  ProductRecommendation,
  ProductRecommendationResult,
} from '../../src/domain/recommendation/relationship-engine/recommendation/index.js';
import { createProductRuntimeIdentity } from '../../src/domain/recommendation/relationship-engine/runtime/index.js';
import type {
  CustomerAffinitySignal,
  CustomerProductAffinity,
  CustomerProductAffinityResult,
} from '../../src/domain/recommendation/customer-affinity/index.js';
import { customer } from './customerProductAffinity.js';
import { commercialDataFor, relationshipTo } from './productRecommendation.js';
import { runtimeSnapshot } from './relationshipRuntimeReader.js';

export const sourceProduct = { productId: 'A' } as const;
export const productB = { productId: 'B' } as const;
export const productBCombo = { productId: 'B', combinationId: '10' } as const;
export const productC = { productId: 'C' } as const;
export const productD = { productId: 'D' } as const;
export const productE = { productId: 'E' } as const;

export function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function commercialRecommendationFor(
  product: ProductRelationshipProductReference,
  rank = 1,
  total = 80,
  patch: Partial<ProductRecommendation> = {},
): ProductRecommendation {
  const relationship = relationshipTo(product.productId, { targetProduct: product });
  return {
    product,
    productIdentity: createProductRuntimeIdentity(product),
    relationship,
    commercialData: commercialDataFor(product.productId, { product }),
    reasons: [{ code: 'STRONG_RELATIONSHIP', contribution: 0.5 }],
    warnings: [],
    score: {
      total,
      components: {
        relationship: total,
        availability: 0,
        compatibility: 0,
        commercial: 0,
        penalties: 0,
      },
    },
    rank,
    ...patch,
  };
}

export function commercialResultFor(
  recommendations: readonly ProductRecommendation[] = [
    commercialRecommendationFor(productB, 1, 80),
    commercialRecommendationFor(productC, 2, 70),
    commercialRecommendationFor(productD, 3, 60),
  ],
): ProductRecommendationResult {
  return {
    snapshot: {
      snapshotId: runtimeSnapshot.snapshotId,
      schemaVersion: runtimeSnapshot.schemaVersion,
      modelVersion: runtimeSnapshot.modelVersion,
      evidenceWindow: runtimeSnapshot.evidenceWindow,
      relationshipCount: runtimeSnapshot.relationshipCount,
      sourceCount: 1,
    },
    sourceIdentity: createProductRuntimeIdentity(sourceProduct),
    recommendations,
    rejectedCandidates: [],
    statistics: {
      relationshipsRead: recommendations.length,
      deduplicatedCandidates: recommendations.length,
      duplicatesRemoved: 0,
      commercialRecordsRequested: recommendations.length,
      eligibleCandidates: recommendations.length,
      rejectedCandidates: 0,
      scoredCandidates: recommendations.length,
      recommendationsReturned: recommendations.length,
    },
  };
}

export function signal(code: CustomerAffinitySignal['code'], strength = 1): CustomerAffinitySignal {
  return {
    code,
    direction: code === 'PRODUCT_REJECTION' || code === 'CATEGORY_REJECTION' ? 'negative' : 'positive',
    strength,
  };
}

export function affinityFor(
  product: ProductRelationshipProductReference,
  score = 0.8,
  confidence: CustomerProductAffinity['confidence'] = 'high',
  signals: readonly CustomerAffinitySignal[] = [signal('DIRECT_PRODUCT_PURCHASE')],
  patch: Partial<CustomerProductAffinity> = {},
): CustomerProductAffinity {
  return {
    product,
    score,
    confidence,
    scoringVersion: 'customer-affinity-v1',
    signals,
    evidence: signals.map((item) => ({ code: item.code, count: 1 })),
    warnings: [],
    ...patch,
  };
}

export function affinityResultFor(
  affinities: readonly CustomerProductAffinity[] = [
    affinityFor(productB, 0.8, 'high'),
    affinityFor(productC, 0.3, 'low', [signal('CATEGORY_PURCHASE', 0.5)]),
  ],
): CustomerProductAffinityResult {
  return {
    customer,
    affinities,
    warnings: [],
    statistics: {
      requestedProducts: affinities.length,
      deduplicatedProducts: affinities.length,
      duplicateProductsRemoved: 0,
      productsWithEvidence: affinities.length,
      productsWithoutEvidence: 0,
      positiveSignalsGenerated: affinities.reduce((count, affinity) => (
        count + affinity.signals.filter((item) => item.direction === 'positive').length
      ), 0),
      negativeSignalsGenerated: affinities.reduce((count, affinity) => (
        count + affinity.signals.filter((item) => item.direction === 'negative').length
      ), 0),
      warningsGenerated: affinities.reduce((count, affinity) => count + affinity.warnings.length, 0),
      providerCalls: 1,
    },
  };
}

export const basePersonalizedRequest = {
  commercialRecommendations: commercialResultFor(),
  customerAffinities: affinityResultFor(),
} as const;
