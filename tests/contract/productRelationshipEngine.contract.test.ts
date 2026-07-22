import { describe, expect, it } from 'vitest';
import {
  calculatedProductRelationshipSchema,
  productInteractionDatasetSchema,
  productRelationshipBuildInputSchema,
  productRelationshipBuildResultSchema,
  productRelationshipBuildStatisticsSchema,
  productRelationshipPublicationSchema,
  productRelationshipReadInputSchema,
  productRelationshipReadResultSchema,
  productRelationshipRuleSchema,
  productRelationshipValidationResultSchema,
  productTransactionSchema,
  relationshipBuildWarningSchema,
  transactionProductSchema,
} from '../../src/domain/recommendation/relationship-engine/contracts.js';
import {
  buildingPublication,
  coOccurrenceRelationship,
  duplicateRelationshipBuildResult,
  emptyBuildResult,
  emptyDataset,
  emptyReadResult,
  incompatibleEvidenceRelationship,
  inconsistentModelVersionBuildResult,
  invalidDuplicateProductTransaction,
  invalidQuantityTransaction,
  invalidSelfRule,
  invalidValidationResult,
  nonContiguousRanksReadResult,
  nonSerializableWarning,
  outOfWindowBuildResult,
  publishedPublication,
  publishedWithoutTimestamps,
  ruleRelationship,
  serializableWarning,
  sourceProduct,
  transitionRelationship,
  unpublishedReadResult,
  validBuildInput,
  validBuildResult,
  validCartTransaction,
  validDataset,
  validManualRule,
  validOrderTransaction,
  validReadInput,
  validReadResult,
  validTechnicalRule,
  validValidationResult,
  validatedPublication,
  window2025,
} from '../fixtures/productRelationshipEngine.js';

function expectValid(schema: { safeParse: (input: unknown) => { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(true);
}

function expectInvalid(schema: { safeParse: (input: unknown) => { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

describe('product relationship engine dataset contracts', () => {
  it('accepts an order transaction', () => {
    expectValid(productTransactionSchema, validOrderTransaction);
  });

  it('accepts a cart transaction', () => {
    expectValid(productTransactionSchema, validCartTransaction);
  });

  it('rejects empty transactionId', () => {
    expectInvalid(productTransactionSchema, { ...validOrderTransaction, transactionId: ' ' });
  });

  it('rejects invalid occurredAt timestamp', () => {
    expectInvalid(productTransactionSchema, { ...validOrderTransaction, occurredAt: '2025-01-01' });
  });

  it('rejects empty products', () => {
    expectInvalid(productTransactionSchema, { ...validOrderTransaction, products: [] });
  });

  it('rejects zero quantity', () => {
    expectInvalid(productTransactionSchema, invalidQuantityTransaction);
  });

  it('rejects decimal quantity', () => {
    expectInvalid(transactionProductSchema, { product: sourceProduct, quantity: 1.5 });
  });

  it('rejects repeated product identity inside a transaction', () => {
    expectInvalid(productTransactionSchema, invalidDuplicateProductTransaction);
  });

  it('rejects duplicate transactionId in a dataset', () => {
    expectInvalid(productInteractionDatasetSchema, {
      transactions: [validOrderTransaction, { ...validCartTransaction, transactionId: validOrderTransaction.transactionId }],
      rules: [],
    });
  });

  it('accepts an empty dataset', () => {
    expectValid(productInteractionDatasetSchema, emptyDataset);
  });

  it('accepts a valid dataset', () => {
    expectValid(productInteractionDatasetSchema, validDataset);
  });

  it('rejects empty customerKey when present', () => {
    expectInvalid(productTransactionSchema, { ...validOrderTransaction, customerKey: ' ' });
  });

  it('rejects empty productId', () => {
    expectInvalid(transactionProductSchema, { product: { productId: ' ' }, quantity: 1 });
  });

  it('rejects empty combinationId when present', () => {
    expectInvalid(transactionProductSchema, { product: { productId: '1001', combinationId: ' ' }, quantity: 1 });
  });
});

describe('product relationship engine rule contracts', () => {
  it('accepts a technical compatibility rule', () => {
    expectValid(productRelationshipRuleSchema, validTechnicalRule);
  });

  it('accepts a manual rule', () => {
    expectValid(productRelationshipRuleSchema, validManualRule);
  });

  it('rejects same_order as a rule relationship type', () => {
    expectInvalid(productRelationshipRuleSchema, { ...validTechnicalRule, relationshipType: 'same_order' });
  });

  it('rejects self-relation rules', () => {
    expectInvalid(productRelationshipRuleSchema, invalidSelfRule);
  });

  it('rejects rule reliability outside range', () => {
    expectInvalid(productRelationshipRuleSchema, { ...validTechnicalRule, reliability: 1.1 });
  });

  it('rejects inverted rule validity window', () => {
    expectInvalid(productRelationshipRuleSchema, {
      ...validTechnicalRule,
      validFrom: '2025-12-31T00:00:00.000Z',
      validTo: '2025-01-01T00:00:00.000Z',
    });
  });

  it('rejects duplicate rules in a dataset', () => {
    expectInvalid(productInteractionDatasetSchema, {
      transactions: [],
      rules: [validTechnicalRule, { ...validTechnicalRule }],
    });
  });
});

describe('product relationship engine build input contracts', () => {
  it('accepts a valid build input', () => {
    expectValid(productRelationshipBuildInputSchema, validBuildInput);
  });

  it('requires relationshipTypes', () => {
    expectInvalid(productRelationshipBuildInputSchema, { ...validBuildInput, relationshipTypes: [] });
  });

  it('rejects duplicate relationshipTypes', () => {
    expectInvalid(productRelationshipBuildInputSchema, {
      ...validBuildInput,
      relationshipTypes: ['same_cart', 'same_cart'],
    });
  });

  it('validates build parameters', () => {
    expectInvalid(productRelationshipBuildInputSchema, {
      ...validBuildInput,
      parameters: { ...validBuildInput.parameters, maximumDistinctProductsPerTransaction: 1 },
    });
  });

  it('rejects invalid minimumConfidence', () => {
    expectInvalid(productRelationshipBuildInputSchema, {
      ...validBuildInput,
      parameters: { ...validBuildInput.parameters, minimumConfidence: 1.1 },
    });
  });

  it('rejects negative minimumLift', () => {
    expectInvalid(productRelationshipBuildInputSchema, {
      ...validBuildInput,
      parameters: { ...validBuildInput.parameters, minimumLift: -1 },
    });
  });

  it('rejects empty modelVersion', () => {
    expectInvalid(productRelationshipBuildInputSchema, { ...validBuildInput, modelVersion: ' ' });
  });

  it('rejects empty publicationId', () => {
    expectInvalid(productRelationshipBuildInputSchema, { ...validBuildInput, publicationId: ' ' });
  });

  it('rejects inverted build dataWindow', () => {
    expectInvalid(productRelationshipBuildInputSchema, {
      ...validBuildInput,
      dataWindow: { from: window2025.to, to: window2025.from },
    });
  });
});

describe('calculated product relationship contracts', () => {
  it('accepts co-occurrence evidence with compatible type', () => {
    expectValid(calculatedProductRelationshipSchema, coOccurrenceRelationship);
  });

  it('accepts transition evidence with compatible type', () => {
    expectValid(calculatedProductRelationshipSchema, transitionRelationship);
  });

  it('accepts rule evidence with compatible type', () => {
    expectValid(calculatedProductRelationshipSchema, ruleRelationship);
  });

  it('rejects incompatible relationship evidence', () => {
    expectInvalid(calculatedProductRelationshipSchema, incompatibleEvidenceRelationship);
  });

  it('rejects self relationships', () => {
    expectInvalid(calculatedProductRelationshipSchema, {
      ...coOccurrenceRelationship,
      targetProduct: sourceProduct,
    });
  });

  it('rejects invalid reliability', () => {
    expectInvalid(calculatedProductRelationshipSchema, { ...coOccurrenceRelationship, reliability: -0.1 });
  });

  it('rejects non-finite metrics', () => {
    expectInvalid(calculatedProductRelationshipSchema, {
      ...coOccurrenceRelationship,
      evidence: { ...coOccurrenceRelationship.evidence, lift: Number.POSITIVE_INFINITY },
    });
  });

  it('rejects invalid evidence window', () => {
    expectInvalid(calculatedProductRelationshipSchema, {
      ...coOccurrenceRelationship,
      evidenceWindow: { from: '2025-01-02T00:00:00.000Z', to: '2025-01-01T00:00:00.000Z' },
    });
  });

  it('rejects runtime price fields on calculated relationships', () => {
    expectInvalid(calculatedProductRelationshipSchema, {
      ...coOccurrenceRelationship,
      price: { amount: 1000 },
    });
  });

  it('rejects runtime stock fields on calculated relationships', () => {
    expectInvalid(calculatedProductRelationshipSchema, {
      ...coOccurrenceRelationship,
      stock: { quantity: 10 },
    });
  });
});

describe('product relationship build result contracts', () => {
  it('accepts an empty build result', () => {
    expectValid(productRelationshipBuildResultSchema, emptyBuildResult);
  });

  it('accepts a valid build result', () => {
    expectValid(productRelationshipBuildResultSchema, validBuildResult);
  });

  it('rejects duplicate relationships', () => {
    expectInvalid(productRelationshipBuildResultSchema, duplicateRelationshipBuildResult);
  });

  it('rejects inconsistent relationship modelVersion', () => {
    expectInvalid(productRelationshipBuildResultSchema, inconsistentModelVersionBuildResult);
  });

  it('rejects evidenceWindow outside result dataWindow', () => {
    expectInvalid(productRelationshipBuildResultSchema, outOfWindowBuildResult);
  });

  it('validates coherent statistics', () => {
    expectValid(productRelationshipBuildStatisticsSchema, validBuildResult.statistics);
  });

  it('rejects incoherent transaction statistics', () => {
    expectInvalid(productRelationshipBuildStatisticsSchema, {
      ...validBuildResult.statistics,
      transactionsRead: 1,
      transactionsAccepted: 1,
      transactionsRejected: 1,
    });
  });

  it('rejects incoherent rule statistics', () => {
    expectInvalid(productRelationshipBuildStatisticsSchema, {
      ...validBuildResult.statistics,
      rulesRead: 1,
      rulesAccepted: 1,
      rulesRejected: 1,
    });
  });

  it('rejects incoherent relationship statistics', () => {
    expectInvalid(productRelationshipBuildStatisticsSchema, {
      ...validBuildResult.statistics,
      relationshipsGenerated: 1,
      relationshipsAccepted: 1,
      relationshipsRejected: 1,
    });
  });

  it('accepts warnings with serializable details', () => {
    expectValid(relationshipBuildWarningSchema, serializableWarning);
  });

  it('rejects warnings with non-serializable details', () => {
    expectInvalid(relationshipBuildWarningSchema, nonSerializableWarning);
  });

  it('rejects empty warning message', () => {
    expectInvalid(relationshipBuildWarningSchema, { ...serializableWarning, message: ' ' });
  });
});

describe('product relationship validation result contracts', () => {
  it('accepts valid=true without errors', () => {
    expectValid(productRelationshipValidationResultSchema, validValidationResult);
  });

  it('accepts valid=false with errors', () => {
    expectValid(productRelationshipValidationResultSchema, invalidValidationResult);
  });

  it('rejects valid=true with an error issue', () => {
    expectInvalid(productRelationshipValidationResultSchema, {
      ...invalidValidationResult,
      valid: true,
    });
  });

  it('rejects valid=false with only warnings', () => {
    expectInvalid(productRelationshipValidationResultSchema, {
      ...validValidationResult,
      valid: false,
    });
  });

  it('allows warnings with valid=true', () => {
    expectValid(productRelationshipValidationResultSchema, validValidationResult);
  });
});

describe('product relationship publication contracts', () => {
  it('accepts building publication', () => {
    expectValid(productRelationshipPublicationSchema, buildingPublication);
  });

  it('accepts validated publication', () => {
    expectValid(productRelationshipPublicationSchema, validatedPublication);
  });

  it('accepts published publication', () => {
    expectValid(productRelationshipPublicationSchema, publishedPublication);
  });

  it('rejects published without validatedAt', () => {
    expectInvalid(productRelationshipPublicationSchema, {
      ...publishedPublication,
      validatedAt: undefined,
    });
  });

  it('rejects published without publishedAt', () => {
    expectInvalid(productRelationshipPublicationSchema, publishedWithoutTimestamps);
  });

  it('rejects invalid timestamp ordering', () => {
    expectInvalid(productRelationshipPublicationSchema, {
      ...validatedPublication,
      validatedAt: '2026-07-22T11:00:00.000Z',
    });
  });

  it('rejects building with publishedAt', () => {
    expectInvalid(productRelationshipPublicationSchema, {
      ...buildingPublication,
      publishedAt: '2026-07-22T12:20:00.000Z',
    });
  });

  it('allows failed without additional timestamps', () => {
    expectValid(productRelationshipPublicationSchema, {
      ...buildingPublication,
      status: 'failed',
    });
  });
});

describe('product relationship runtime reader contracts', () => {
  it('accepts valid read input', () => {
    expectValid(productRelationshipReadInputSchema, validReadInput);
  });

  it('rejects empty sourceProducts', () => {
    expectInvalid(productRelationshipReadInputSchema, { ...validReadInput, sourceProducts: [] });
  });

  it('rejects duplicate sourceProducts', () => {
    expectInvalid(productRelationshipReadInputSchema, {
      ...validReadInput,
      sourceProducts: [sourceProduct, sourceProduct],
    });
  });

  it('rejects duplicate relationshipTypes', () => {
    expectInvalid(productRelationshipReadInputSchema, {
      ...validReadInput,
      relationshipTypes: ['same_cart', 'same_cart'],
    });
  });

  it('validates limitPerSource lower bound', () => {
    expectInvalid(productRelationshipReadInputSchema, { ...validReadInput, limitPerSource: 0 });
  });

  it('validates limitPerSource upper bound', () => {
    expectInvalid(productRelationshipReadInputSchema, { ...validReadInput, limitPerSource: 101 });
  });

  it('accepts an empty read result', () => {
    expectValid(productRelationshipReadResultSchema, emptyReadResult);
  });

  it('accepts a valid read result', () => {
    expectValid(productRelationshipReadResultSchema, validReadResult);
  });

  it('requires a published publication', () => {
    expectInvalid(productRelationshipReadResultSchema, unpublishedReadResult);
  });

  it('rejects inconsistent publicationId', () => {
    expectInvalid(productRelationshipReadResultSchema, {
      ...validReadResult,
      items: [{ ...validReadResult.items[0], publicationId: 'other-publication' }],
    });
  });

  it('rejects inconsistent modelVersion', () => {
    expectInvalid(productRelationshipReadResultSchema, {
      ...validReadResult,
      items: [{ ...validReadResult.items[0], modelVersion: 'other-model' }],
    });
  });

  it('rejects duplicate ranks per source', () => {
    expectInvalid(productRelationshipReadResultSchema, {
      ...validReadResult,
      items: [
        validReadResult.items[0],
        {
          ...validReadResult.items[1],
          rank: 1,
        },
      ],
    });
  });

  it('rejects non-contiguous ranks per source', () => {
    expectInvalid(productRelationshipReadResultSchema, nonContiguousRanksReadResult);
  });

  it('rejects incorrect item order per source', () => {
    expectInvalid(productRelationshipReadResultSchema, {
      ...validReadResult,
      items: [validReadResult.items[1], validReadResult.items[0]],
    });
  });

  it('rejects duplicate read items', () => {
    expectInvalid(productRelationshipReadResultSchema, {
      ...validReadResult,
      items: [
        validReadResult.items[0],
        {
          ...validReadResult.items[0],
          rank: 2,
        },
      ],
    });
  });

  it('rejects read item self relationships', () => {
    expectInvalid(productRelationshipReadResultSchema, {
      ...validReadResult,
      items: [{ ...validReadResult.items[0], targetProduct: sourceProduct }],
    });
  });

  it('rejects read item incompatible evidence', () => {
    expectInvalid(productRelationshipReadResultSchema, {
      ...validReadResult,
      items: [
        {
          ...validReadResult.items[0],
          relationshipType: 'manual',
          evidence: coOccurrenceRelationship.evidence,
        },
      ],
    });
  });
});
