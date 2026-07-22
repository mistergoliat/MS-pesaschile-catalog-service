import type {
  CalculatedProductRelationship,
  ProductInteractionDataset,
  ProductRelationshipBuildInput,
  ProductRelationshipBuildResult,
  ProductRelationshipPublication,
  ProductRelationshipReadInput,
  ProductRelationshipReadResult,
  ProductRelationshipRule,
  ProductTransaction,
  RelationshipBuildWarning,
  ProductRelationshipValidationResult,
} from '../../src/domain/recommendation/relationship-engine/contracts.js';

export const window2025 = {
  from: '2025-01-01T00:00:00.000Z',
  to: '2025-12-31T23:59:59.000Z',
};

export const sourceProduct = { productId: '1001' };
export const targetProduct = { productId: '1002' };
export const thirdProduct = { productId: '1003', combinationId: '2003' };

export const validOrderTransaction: ProductTransaction = {
  transactionId: 'order-001',
  transactionType: 'order',
  occurredAt: '2025-02-01T10:00:00.000Z',
  customerKey: 'customer-hash-001',
  products: [
    { product: sourceProduct, quantity: 1 },
    { product: targetProduct, quantity: 2 },
  ],
};

export const validCartTransaction: ProductTransaction = {
  transactionId: 'cart-001',
  transactionType: 'cart',
  occurredAt: '2025-02-02T10:00:00.000Z',
  products: [
    { product: sourceProduct, quantity: 1 },
    { product: thirdProduct, quantity: 1 },
  ],
};

export const invalidDuplicateProductTransaction = {
  ...validCartTransaction,
  products: [
    { product: sourceProduct, quantity: 1 },
    { product: sourceProduct, quantity: 1 },
  ],
};

export const invalidQuantityTransaction = {
  ...validCartTransaction,
  products: [{ product: sourceProduct, quantity: 0 }],
};

export const validTechnicalRule: ProductRelationshipRule = {
  sourceProduct,
  targetProduct,
  relationshipType: 'technical_compatibility',
  ruleId: 'compatibility-001',
  ruleVersion: '2026-07-01',
  reliability: 0.95,
  validFrom: '2025-01-01T00:00:00.000Z',
  validTo: '2025-12-31T23:59:59.000Z',
};

export const validManualRule: ProductRelationshipRule = {
  sourceProduct,
  targetProduct: thirdProduct,
  relationshipType: 'manual',
  ruleId: 'manual-001',
  ruleVersion: '2026-07-01',
  reliability: 0.8,
};

export const invalidSelfRule = {
  ...validTechnicalRule,
  targetProduct: sourceProduct,
};

export const validDataset: ProductInteractionDataset = {
  transactions: [validOrderTransaction, validCartTransaction],
  rules: [validTechnicalRule, validManualRule],
};

export const emptyDataset: ProductInteractionDataset = {
  transactions: [],
  rules: [],
};

export const validBuildInput: ProductRelationshipBuildInput = {
  publicationId: 'publication-2025-001',
  modelVersion: 'relationship-engine.0',
  dataWindow: window2025,
  relationshipTypes: ['same_cart', 'same_order', 'next_purchase', 'technical_compatibility', 'manual'],
  parameters: {
    minimumJointCount: 10,
    minimumConfidence: 0.1,
    minimumLift: 1,
    maximumRelationshipsPerSource: 50,
    maximumDistinctProductsPerTransaction: 20,
  },
};

export const coOccurrenceRelationship: CalculatedProductRelationship = {
  sourceProduct,
  targetProduct,
  relationshipType: 'same_cart',
  evidence: {
    kind: 'co_occurrence',
    jointCount: 24,
    support: 0.014,
    confidence: 0.32,
    lift: 2.1,
  },
  reliability: 0.68,
  evidenceWindow: window2025,
  modelVersion: 'relationship-engine.0',
};

export const transitionRelationship: CalculatedProductRelationship = {
  sourceProduct,
  targetProduct: thirdProduct,
  relationshipType: 'next_purchase',
  evidence: {
    kind: 'transition',
    transitionCount: 12,
    transitionProbability: 0.22,
    medianLagDays: 21,
  },
  reliability: 0.61,
  evidenceWindow: window2025,
  modelVersion: 'relationship-engine.0',
};

export const ruleRelationship: CalculatedProductRelationship = {
  sourceProduct,
  targetProduct,
  relationshipType: 'technical_compatibility',
  evidence: {
    kind: 'rule',
    ruleId: 'compatibility-001',
    ruleVersion: '2026-07-01',
  },
  reliability: 0.95,
  evidenceWindow: window2025,
  modelVersion: 'relationship-engine.0',
};

export const incompatibleEvidenceRelationship = {
  ...ruleRelationship,
  evidence: {
    kind: 'co_occurrence',
    jointCount: 24,
    support: 0.014,
    confidence: 0.32,
    lift: 2.1,
  },
};

export const serializableWarning: RelationshipBuildWarning = {
  code: 'PARTIAL_DATASET',
  message: 'Some transactions were ignored by the reader',
  transactionId: 'cart-outlier-001',
  sourceProduct,
  details: {
    reason: 'outlier threshold',
    excludedProducts: 219,
  },
};

export const nonSerializableWarning = {
  ...serializableWarning,
  details: {
    error: new Error('do not serialize errors'),
  },
};

export const validBuildResult: ProductRelationshipBuildResult = {
  publicationId: 'publication-2025-001',
  modelVersion: 'relationship-engine.0',
  dataWindow: window2025,
  relationships: [coOccurrenceRelationship, transitionRelationship],
  statistics: {
    transactionsRead: 2,
    transactionsAccepted: 2,
    transactionsRejected: 0,
    rulesRead: 2,
    rulesAccepted: 2,
    rulesRejected: 0,
    productsObserved: 3,
    relationshipsGenerated: 2,
    relationshipsAccepted: 2,
    relationshipsRejected: 0,
  },
  warnings: [serializableWarning],
};

export const emptyBuildResult: ProductRelationshipBuildResult = {
  ...validBuildResult,
  relationships: [],
  statistics: {
    transactionsRead: 0,
    transactionsAccepted: 0,
    transactionsRejected: 0,
    rulesRead: 0,
    rulesAccepted: 0,
    rulesRejected: 0,
    productsObserved: 0,
    relationshipsGenerated: 0,
    relationshipsAccepted: 0,
    relationshipsRejected: 0,
  },
  warnings: [],
};

export const duplicateRelationshipBuildResult = {
  ...validBuildResult,
  relationships: [
    coOccurrenceRelationship,
    {
      ...coOccurrenceRelationship,
      reliability: 0.7,
    },
  ],
};

export const inconsistentModelVersionBuildResult = {
  ...validBuildResult,
  relationships: [
    {
      ...coOccurrenceRelationship,
      modelVersion: 'relationship-engine.other',
    },
  ],
};

export const outOfWindowBuildResult = {
  ...validBuildResult,
  relationships: [
    {
      ...coOccurrenceRelationship,
      evidenceWindow: {
        from: '2024-12-31T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
      },
    },
  ],
};

export const validValidationResult: ProductRelationshipValidationResult = {
  valid: true,
  issues: [
    {
      code: 'INVALID_EVIDENCE',
      severity: 'warning',
      message: 'Relationship is below publication threshold',
      sourceProduct,
      targetProduct,
      relationshipType: 'same_cart',
    },
  ],
};

export const invalidValidationResult: ProductRelationshipValidationResult = {
  valid: false,
  issues: [
    {
      code: 'INVALID_EVIDENCE',
      severity: 'error',
      message: 'Evidence is incompatible with relationship type',
      sourceProduct,
      targetProduct,
      relationshipType: 'manual',
    },
  ],
};

export const buildingPublication: ProductRelationshipPublication = {
  publicationId: 'publication-2025-001',
  modelVersion: 'relationship-engine.0',
  status: 'building',
  dataWindow: window2025,
  createdAt: '2026-07-22T12:00:00.000Z',
};

export const validatedPublication: ProductRelationshipPublication = {
  ...buildingPublication,
  status: 'validated',
  validatedAt: '2026-07-22T12:10:00.000Z',
};

export const publishedPublication: ProductRelationshipPublication = {
  ...validatedPublication,
  status: 'published',
  publishedAt: '2026-07-22T12:20:00.000Z',
};

export const publishedWithoutTimestamps = {
  ...buildingPublication,
  status: 'published',
};

export const validReadInput: ProductRelationshipReadInput = {
  sourceProducts: [sourceProduct],
  relationshipTypes: ['same_cart', 'technical_compatibility'],
  limitPerSource: 10,
};

export const validReadResult: ProductRelationshipReadResult = {
  publication: publishedPublication,
  items: [
    {
      sourceProduct,
      targetProduct,
      relationshipType: 'same_cart',
      evidence: coOccurrenceRelationship.evidence,
      reliability: 0.68,
      rank: 1,
      evidenceWindow: window2025,
      publicationId: 'publication-2025-001',
      modelVersion: 'relationship-engine.0',
    },
    {
      sourceProduct,
      targetProduct: thirdProduct,
      relationshipType: 'technical_compatibility',
      evidence: ruleRelationship.evidence,
      reliability: 0.95,
      rank: 2,
      evidenceWindow: window2025,
      publicationId: 'publication-2025-001',
      modelVersion: 'relationship-engine.0',
    },
  ],
};

export const emptyReadResult: ProductRelationshipReadResult = {
  publication: publishedPublication,
  items: [],
};

export const nonContiguousRanksReadResult = {
  ...validReadResult,
  items: [
    validReadResult.items[0],
    {
      ...validReadResult.items[1],
      rank: 3,
    },
  ],
};

export const unpublishedReadResult = {
  ...validReadResult,
  publication: validatedPublication,
};

export const productRelationshipEngineFixtures = {
  validOrderTransaction,
  validCartTransaction,
  invalidDuplicateProductTransaction,
  invalidQuantityTransaction,
  validDataset,
  emptyDataset,
  validTechnicalRule,
  validManualRule,
  invalidSelfRule,
  validBuildInput,
  coOccurrenceRelationship,
  transitionRelationship,
  ruleRelationship,
  incompatibleEvidenceRelationship,
  validBuildResult,
  duplicateRelationshipBuildResult,
  inconsistentModelVersionBuildResult,
  outOfWindowBuildResult,
  validValidationResult,
  buildingPublication,
  validatedPublication,
  publishedPublication,
  publishedWithoutTimestamps,
  validReadInput,
  validReadResult,
  emptyReadResult,
  nonContiguousRanksReadResult,
  unpublishedReadResult,
  serializableWarning,
  nonSerializableWarning,
} as const;
