import { z } from 'zod';
import {
  relationshipTypeSchema,
  type RelationshipType,
} from '../contracts.js';

const ISO_DATE_MESSAGE = 'Expected an ISO-8601 date-time string';

function isIsoDateTime(value: string): boolean {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return new Date(timestamp).toISOString() === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonSerializable(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return false;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return value.every((item) => isJsonSerializable(item, seen));
  }
  if (isPlainRecord(value)) {
    if (value instanceof Error || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return Object.values(value).every((item) => isJsonSerializable(item, seen));
  }
  return false;
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function addIssue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
  });
}

const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = nonEmptyStringSchema.refine(isIsoDateTime, ISO_DATE_MESSAGE);
const zeroToOneSchema = z.number().finite().min(0).max(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const finiteNonNegativeNumberSchema = z.number().finite().nonnegative();

export const relationshipTransactionTypeSchema = z.enum(['cart', 'order']);
export const relationshipPublicationStatusSchema = z.enum(['building', 'validated', 'published', 'failed']);
export const relationshipBuildWarningCodeSchema = z.enum([
  'EMPTY_DATASET',
  'TRANSACTION_REJECTED',
  'PRODUCT_REJECTED',
  'RELATIONSHIP_REJECTED',
  'UNSUPPORTED_RELATIONSHIP_TYPE',
  'INSUFFICIENT_EVIDENCE',
  'DATA_WINDOW_MISMATCH',
  'PARTIAL_DATASET',
]);
export const relationshipValidationIssueCodeSchema = z.enum([
  'SELF_RELATIONSHIP',
  'DUPLICATE_RELATIONSHIP',
  'INVALID_EVIDENCE',
  'INVALID_RELIABILITY',
  'INVALID_DATA_WINDOW',
  'INVALID_PRODUCT_REFERENCE',
  'INCOMPATIBLE_RELATIONSHIP_EVIDENCE',
  'NON_FINITE_METRIC',
]);
export const relationshipValidationSeveritySchema = z.enum(['warning', 'error']);

export const productRelationshipProductReferenceSchema = z
  .object({
    productId: nonEmptyStringSchema,
    combinationId: nonEmptyStringSchema.optional(),
  })
  .strict();

function productIdentity(product: z.infer<typeof productRelationshipProductReferenceSchema>): string {
  return `${product.productId}:${product.combinationId ?? ''}`;
}

function productsAreEqual(
  left: z.infer<typeof productRelationshipProductReferenceSchema>,
  right: z.infer<typeof productRelationshipProductReferenceSchema>,
): boolean {
  return productIdentity(left) === productIdentity(right);
}

export const relationshipDataWindowSchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (Date.parse(window.from) > Date.parse(window.to)) {
      addIssue(context, ['from'], 'Window from must be before or equal to to');
    }
  });

function windowContains(
  outer: z.infer<typeof relationshipDataWindowSchema>,
  inner: z.infer<typeof relationshipDataWindowSchema>,
): boolean {
  return Date.parse(outer.from) <= Date.parse(inner.from) && Date.parse(inner.to) <= Date.parse(outer.to);
}

export const transactionProductSchema = z
  .object({
    product: productRelationshipProductReferenceSchema,
    quantity: positiveIntegerSchema,
  })
  .strict();

export const productTransactionSchema = z
  .object({
    transactionId: nonEmptyStringSchema,
    transactionType: relationshipTransactionTypeSchema,
    occurredAt: isoDateTimeSchema,
    customerKey: nonEmptyStringSchema.optional(),
    products: z.array(transactionProductSchema).min(1),
  })
  .strict()
  .superRefine((transaction, context) => {
    const productKeys = transaction.products.map((item) => productIdentity(item.product));
    if (hasDuplicates(productKeys)) {
      addIssue(context, ['products'], 'Transaction products must be unique by product identity');
    }
  });

export const productRelationshipRuleSchema = z
  .object({
    sourceProduct: productRelationshipProductReferenceSchema,
    targetProduct: productRelationshipProductReferenceSchema,
    relationshipType: z.enum(['technical_compatibility', 'manual']),
    ruleId: nonEmptyStringSchema,
    ruleVersion: nonEmptyStringSchema,
    reliability: zeroToOneSchema,
    validFrom: isoDateTimeSchema.optional(),
    validTo: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (productsAreEqual(rule.sourceProduct, rule.targetProduct)) {
      addIssue(context, ['targetProduct'], 'Rule source and target products must be different');
    }
    if (rule.validFrom && rule.validTo && Date.parse(rule.validFrom) > Date.parse(rule.validTo)) {
      addIssue(context, ['validFrom'], 'validFrom must be before or equal to validTo');
    }
  });

function relationshipRuleKey(rule: z.infer<typeof productRelationshipRuleSchema>): string {
  return [
    productIdentity(rule.sourceProduct),
    productIdentity(rule.targetProduct),
    rule.relationshipType,
    rule.ruleId,
    rule.ruleVersion,
  ].join('|');
}

export const productInteractionDatasetSchema = z
  .object({
    transactions: z.array(productTransactionSchema),
    rules: z.array(productRelationshipRuleSchema),
  })
  .strict()
  .superRefine((dataset, context) => {
    const transactionIds = dataset.transactions.map((transaction) => transaction.transactionId);
    if (hasDuplicates(transactionIds)) {
      addIssue(context, ['transactions'], 'transactionId values must be unique');
    }

    const ruleKeys = dataset.rules.map(relationshipRuleKey);
    if (hasDuplicates(ruleKeys)) {
      addIssue(context, ['rules'], 'Rules must be unique by source, target, type, ruleId, and ruleVersion');
    }
  });

export const relationshipBuildParametersSchema = z
  .object({
    minimumJointCount: nonNegativeIntegerSchema,
    minimumConfidence: zeroToOneSchema,
    minimumLift: finiteNonNegativeNumberSchema,
    maximumRelationshipsPerSource: z.number().int().min(1).max(500),
    maximumDistinctProductsPerTransaction: z.number().int().min(2).max(500),
  })
  .strict();

export const productRelationshipBuildInputSchema = z
  .object({
    publicationId: nonEmptyStringSchema,
    modelVersion: nonEmptyStringSchema,
    dataWindow: relationshipDataWindowSchema,
    relationshipTypes: z.array(relationshipTypeSchema).min(1),
    parameters: relationshipBuildParametersSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (hasDuplicates(input.relationshipTypes)) {
      addIssue(context, ['relationshipTypes'], 'relationshipTypes must be unique');
    }
  });

const coOccurrenceRelationshipTypes = new Set<RelationshipType>(['same_cart', 'same_order', 'customer_history']);
const transitionRelationshipTypes = new Set<RelationshipType>(['next_purchase']);
const ruleRelationshipTypes = new Set<RelationshipType>(['technical_compatibility', 'manual']);

export const relationshipEngineRelationshipEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('co_occurrence'),
      jointCount: nonNegativeIntegerSchema,
      sourceCount: nonNegativeIntegerSchema.optional(),
      targetCount: nonNegativeIntegerSchema.optional(),
      totalTransactions: nonNegativeIntegerSchema.optional(),
      support: finiteNonNegativeNumberSchema,
      confidence: zeroToOneSchema,
      lift: finiteNonNegativeNumberSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('transition'),
      transitionCount: nonNegativeIntegerSchema,
      transitionProbability: zeroToOneSchema,
      medianLagDays: finiteNonNegativeNumberSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rule'),
      ruleId: nonEmptyStringSchema,
      ruleVersion: nonEmptyStringSchema,
    })
    .strict(),
]).superRefine((evidence, context) => {
  if (evidence.kind !== 'co_occurrence' || evidence.jointCount <= 0) {
    return;
  }
  if (evidence.sourceCount !== undefined && evidence.sourceCount === 0) {
    addIssue(context, ['sourceCount'], 'sourceCount must be greater than zero when jointCount is positive');
  }
  if (evidence.targetCount !== undefined && evidence.targetCount === 0) {
    addIssue(context, ['targetCount'], 'targetCount must be greater than zero when jointCount is positive');
  }
  if (evidence.totalTransactions !== undefined && evidence.totalTransactions === 0) {
    addIssue(context, ['totalTransactions'], 'totalTransactions must be greater than zero when jointCount is positive');
  }
});

function isEvidenceCompatible(
  relationshipType: RelationshipType,
  evidence: z.infer<typeof relationshipEngineRelationshipEvidenceSchema>,
): boolean {
  if (evidence.kind === 'co_occurrence') {
    return coOccurrenceRelationshipTypes.has(relationshipType);
  }
  if (evidence.kind === 'transition') {
    return transitionRelationshipTypes.has(relationshipType);
  }
  return ruleRelationshipTypes.has(relationshipType);
}

export const calculatedProductRelationshipSchema = z
  .object({
    sourceProduct: productRelationshipProductReferenceSchema,
    targetProduct: productRelationshipProductReferenceSchema,
    relationshipType: relationshipTypeSchema,
    evidence: relationshipEngineRelationshipEvidenceSchema,
    reliability: zeroToOneSchema,
    evidenceWindow: relationshipDataWindowSchema,
    modelVersion: nonEmptyStringSchema,
  })
  .strict()
  .superRefine((relationship, context) => {
    if (productsAreEqual(relationship.sourceProduct, relationship.targetProduct)) {
      addIssue(context, ['targetProduct'], 'Relationship source and target products must be different');
    }
    if (!isEvidenceCompatible(relationship.relationshipType, relationship.evidence)) {
      addIssue(context, ['evidence'], 'relationshipType is incompatible with evidence kind');
    }
  });

function calculatedRelationshipKey(relationship: z.infer<typeof calculatedProductRelationshipSchema>): string {
  return [
    productIdentity(relationship.sourceProduct),
    productIdentity(relationship.targetProduct),
    relationship.relationshipType,
  ].join('|');
}

export const productRelationshipBuildStatisticsSchema = z
  .object({
    transactionsRead: nonNegativeIntegerSchema,
    transactionsAccepted: nonNegativeIntegerSchema,
    transactionsRejected: nonNegativeIntegerSchema,
    rulesRead: nonNegativeIntegerSchema,
    rulesAccepted: nonNegativeIntegerSchema,
    rulesRejected: nonNegativeIntegerSchema,
    productsObserved: nonNegativeIntegerSchema,
    relationshipsGenerated: nonNegativeIntegerSchema,
    relationshipsAccepted: nonNegativeIntegerSchema,
    relationshipsRejected: nonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((statistics, context) => {
    if (statistics.transactionsAccepted + statistics.transactionsRejected > statistics.transactionsRead) {
      addIssue(context, ['transactionsAccepted'], 'Accepted plus rejected transactions must not exceed transactionsRead');
    }
    if (statistics.rulesAccepted + statistics.rulesRejected > statistics.rulesRead) {
      addIssue(context, ['rulesAccepted'], 'Accepted plus rejected rules must not exceed rulesRead');
    }
    if (statistics.relationshipsAccepted + statistics.relationshipsRejected > statistics.relationshipsGenerated) {
      addIssue(context, ['relationshipsAccepted'], 'Accepted plus rejected relationships must not exceed relationshipsGenerated');
    }
  });

export const relationshipBuildWarningSchema = z
  .object({
    code: relationshipBuildWarningCodeSchema,
    message: nonEmptyStringSchema,
    transactionId: nonEmptyStringSchema.optional(),
    ruleId: nonEmptyStringSchema.optional(),
    sourceProduct: productRelationshipProductReferenceSchema.optional(),
    targetProduct: productRelationshipProductReferenceSchema.optional(),
    details: z.unknown().optional(),
  })
  .strict()
  .superRefine((warning, context) => {
    if (warning.details !== undefined && !isJsonSerializable(warning.details)) {
      addIssue(context, ['details'], 'details must be JSON serializable');
    }
  });

export const productRelationshipBuildResultSchema = z
  .object({
    publicationId: nonEmptyStringSchema,
    modelVersion: nonEmptyStringSchema,
    dataWindow: relationshipDataWindowSchema,
    relationships: z.array(calculatedProductRelationshipSchema),
    statistics: productRelationshipBuildStatisticsSchema,
    warnings: z.array(relationshipBuildWarningSchema),
  })
  .strict()
  .superRefine((result, context) => {
    const relationshipKeys = result.relationships.map(calculatedRelationshipKey);
    if (hasDuplicates(relationshipKeys)) {
      addIssue(context, ['relationships'], 'Relationships must be unique by source, target, and relationshipType');
    }

    for (const [index, relationship] of result.relationships.entries()) {
      if (relationship.modelVersion !== result.modelVersion) {
        addIssue(context, ['relationships', index, 'modelVersion'], 'Relationship modelVersion must match result modelVersion');
      }
      if (!windowContains(result.dataWindow, relationship.evidenceWindow)) {
        addIssue(context, ['relationships', index, 'evidenceWindow'], 'Relationship evidenceWindow must be contained in result dataWindow');
      }
    }
  });

export const relationshipValidationIssueSchema = z
  .object({
    code: relationshipValidationIssueCodeSchema,
    severity: relationshipValidationSeveritySchema,
    message: nonEmptyStringSchema,
    sourceProduct: productRelationshipProductReferenceSchema.optional(),
    targetProduct: productRelationshipProductReferenceSchema.optional(),
    relationshipType: relationshipTypeSchema.optional(),
  })
  .strict();

export const productRelationshipValidationResultSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(relationshipValidationIssueSchema),
  })
  .strict()
  .superRefine((result, context) => {
    const hasError = result.issues.some((issue) => issue.severity === 'error');
    if (result.valid === hasError) {
      addIssue(context, ['valid'], 'valid must be true if and only if no error issues exist');
    }
  });

export const productRelationshipPublicationSchema = z
  .object({
    publicationId: nonEmptyStringSchema,
    modelVersion: nonEmptyStringSchema,
    status: relationshipPublicationStatusSchema,
    dataWindow: relationshipDataWindowSchema,
    createdAt: isoDateTimeSchema,
    validatedAt: isoDateTimeSchema.optional(),
    publishedAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((publication, context) => {
    const createdAt = Date.parse(publication.createdAt);
    if (publication.validatedAt && Date.parse(publication.validatedAt) < createdAt) {
      addIssue(context, ['validatedAt'], 'validatedAt must not be before createdAt');
    }
    if (publication.publishedAt && Date.parse(publication.publishedAt) < createdAt) {
      addIssue(context, ['publishedAt'], 'publishedAt must not be before createdAt');
    }
    if (publication.status === 'validated' && !publication.validatedAt) {
      addIssue(context, ['validatedAt'], 'validated status requires validatedAt');
    }
    if (publication.status === 'published') {
      if (!publication.validatedAt) {
        addIssue(context, ['validatedAt'], 'published status requires validatedAt');
      }
      if (!publication.publishedAt) {
        addIssue(context, ['publishedAt'], 'published status requires publishedAt');
      }
    }
    if (publication.status === 'building' && publication.publishedAt) {
      addIssue(context, ['publishedAt'], 'building status must not contain publishedAt');
    }
  });

export const productRelationshipReadInputSchema = z
  .object({
    sourceProducts: z.array(productRelationshipProductReferenceSchema).min(1),
    relationshipTypes: z.array(relationshipTypeSchema).min(1).optional(),
    limitPerSource: z.number().int().min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const sourceKeys = input.sourceProducts.map(productIdentity);
    if (hasDuplicates(sourceKeys)) {
      addIssue(context, ['sourceProducts'], 'sourceProducts must be unique');
    }
    if (input.relationshipTypes && hasDuplicates(input.relationshipTypes)) {
      addIssue(context, ['relationshipTypes'], 'relationshipTypes must be unique');
    }
  });

export const productRelationshipReadItemSchema = z
  .object({
    sourceProduct: productRelationshipProductReferenceSchema,
    targetProduct: productRelationshipProductReferenceSchema,
    relationshipType: relationshipTypeSchema,
    evidence: relationshipEngineRelationshipEvidenceSchema,
    reliability: zeroToOneSchema,
    rank: positiveIntegerSchema,
    evidenceWindow: relationshipDataWindowSchema,
    publicationId: nonEmptyStringSchema,
    modelVersion: nonEmptyStringSchema,
  })
  .strict()
  .superRefine((item, context) => {
    if (productsAreEqual(item.sourceProduct, item.targetProduct)) {
      addIssue(context, ['targetProduct'], 'Read item source and target products must be different');
    }
    if (!isEvidenceCompatible(item.relationshipType, item.evidence)) {
      addIssue(context, ['evidence'], 'relationshipType is incompatible with evidence kind');
    }
  });

function readItemKey(item: z.infer<typeof productRelationshipReadItemSchema>): string {
  return [productIdentity(item.sourceProduct), productIdentity(item.targetProduct), item.relationshipType].join('|');
}

export const productRelationshipReadResultSchema = z
  .object({
    items: z.array(productRelationshipReadItemSchema),
    publication: productRelationshipPublicationSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.publication.status !== 'published') {
      addIssue(context, ['publication', 'status'], 'Runtime read results require a published publication');
    }

    const itemKeys = result.items.map(readItemKey);
    if (hasDuplicates(itemKeys)) {
      addIssue(context, ['items'], 'Read items must be unique by source, target, and relationshipType');
    }

    const itemsBySource = new Map<string, Array<{ item: z.infer<typeof productRelationshipReadItemSchema>; index: number }>>();
    for (const [index, item] of result.items.entries()) {
      if (item.publicationId !== result.publication.publicationId) {
        addIssue(context, ['items', index, 'publicationId'], 'Item publicationId must match publication');
      }
      if (item.modelVersion !== result.publication.modelVersion) {
        addIssue(context, ['items', index, 'modelVersion'], 'Item modelVersion must match publication');
      }
      const sourceKey = productIdentity(item.sourceProduct);
      const sourceItems = itemsBySource.get(sourceKey) ?? [];
      sourceItems.push({ item, index });
      itemsBySource.set(sourceKey, sourceItems);
    }

    for (const sourceItems of itemsBySource.values()) {
      const ranks = sourceItems.map(({ item }) => item.rank);
      if (new Set(ranks).size !== ranks.length) {
        addIssue(context, ['items'], 'Ranks must be unique per source');
      }

      const sortedRanks = [...ranks].sort((left, right) => left - right);
      for (const [index, rank] of sortedRanks.entries()) {
        if (rank !== index + 1) {
          addIssue(context, ['items'], 'Ranks must be contiguous from 1 per source');
          break;
        }
      }

      for (let index = 1; index < sourceItems.length; index += 1) {
        const previous = sourceItems[index - 1]!;
        const current = sourceItems[index]!;
        if (current.item.rank < previous.item.rank) {
          addIssue(context, ['items', current.index, 'rank'], 'Items must be ordered by rank per source');
          break;
        }
      }
    }
  });

export type RelationshipTransactionType = z.infer<typeof relationshipTransactionTypeSchema>;
export type RelationshipPublicationStatus = z.infer<typeof relationshipPublicationStatusSchema>;
export type RelationshipBuildWarningCode = z.infer<typeof relationshipBuildWarningCodeSchema>;
export type RelationshipValidationIssueCode = z.infer<typeof relationshipValidationIssueCodeSchema>;
export type RelationshipValidationSeverity = z.infer<typeof relationshipValidationSeveritySchema>;
export type ProductRelationshipProductReference = z.infer<typeof productRelationshipProductReferenceSchema>;
export type TransactionProduct = z.infer<typeof transactionProductSchema>;
export type ProductTransaction = z.infer<typeof productTransactionSchema>;
export type ProductRelationshipRule = z.infer<typeof productRelationshipRuleSchema>;
export type ProductInteractionDataset = z.infer<typeof productInteractionDatasetSchema>;
export type RelationshipDataWindow = z.infer<typeof relationshipDataWindowSchema>;
export type RelationshipBuildParameters = z.infer<typeof relationshipBuildParametersSchema>;
export type ProductRelationshipBuildInput = z.infer<typeof productRelationshipBuildInputSchema>;
export type RelationshipEngineRelationshipEvidence = z.infer<typeof relationshipEngineRelationshipEvidenceSchema>;
export type CalculatedProductRelationship = z.infer<typeof calculatedProductRelationshipSchema>;
export type ProductRelationshipBuildStatistics = z.infer<typeof productRelationshipBuildStatisticsSchema>;
export type RelationshipBuildWarning = z.infer<typeof relationshipBuildWarningSchema>;
export type ProductRelationshipBuildResult = z.infer<typeof productRelationshipBuildResultSchema>;
export type RelationshipValidationIssue = z.infer<typeof relationshipValidationIssueSchema>;
export type ProductRelationshipValidationResult = z.infer<typeof productRelationshipValidationResultSchema>;
export type ProductRelationshipPublication = z.infer<typeof productRelationshipPublicationSchema>;
export type ProductRelationshipReadInput = z.infer<typeof productRelationshipReadInputSchema>;
export type ProductRelationshipReadItem = z.infer<typeof productRelationshipReadItemSchema>;
export type ProductRelationshipReadResult = z.infer<typeof productRelationshipReadResultSchema>;
