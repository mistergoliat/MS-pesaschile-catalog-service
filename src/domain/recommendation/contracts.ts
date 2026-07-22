import { z } from 'zod';

const ISO_DATE_MESSAGE = 'Expected an ISO-8601 date-time string';
const SEARCH_PRODUCTS_V2_MAX_LIMIT = 20;

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

function isJsonSerializable(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonSerializable);
  }
  if (isPlainRecord(value)) {
    if (value instanceof Error) {
      return false;
    }
    return Object.values(value).every(isJsonSerializable);
  }
  return false;
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function addDuplicateIssue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
  });
}

const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = nonEmptyStringSchema.refine(isIsoDateTime, ISO_DATE_MESSAGE);
const finiteNonNegativeNumberSchema = z.number().finite().nonnegative();
const zeroToOneSchema = z.number().finite().min(0).max(1);
const positiveIntegerSchema = z.number().int().positive();

function uniqueStringArraySchema(minLength = 0) {
  const schema = z.array(nonEmptyStringSchema);
  return (minLength > 0 ? schema.min(minLength) : schema).superRefine((values, context) => {
    if (hasDuplicates(values)) {
      addDuplicateIssue(context, [], 'Array values must be unique');
    }
  });
}

const evidenceWindowSchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (Date.parse(window.from) > Date.parse(window.to)) {
      addDuplicateIssue(context, ['from'], 'Window from must be before or equal to to');
    }
  });

export const evidenceLevelSchema = z.enum(['none', 'summary', 'full']);
export const budgetScopeSchema = z.enum(['per_candidate', 'total_solution', 'additional_spend']);
export const constraintCodeSchema = z.enum([
  'BRAND',
  'DIMENSIONS',
  'WEIGHT_CAPACITY',
  'POWER_REQUIREMENT',
  'TECHNICAL_COMPATIBILITY',
  'DELIVERY_LOCATION',
]);
export const candidateTypeSchema = z.enum(['primary_fit', 'alternative', 'complement', 'upgrade']);
export const relationshipTypeSchema = z.enum([
  'same_cart',
  'same_order',
  'next_purchase',
  'customer_history',
  'technical_compatibility',
  'manual',
]);
export const recommendationReasonCodeSchema = z.enum([
  'EXACT_QUERY_MATCH',
  'SEMANTIC_NEED_MATCH',
  'CATEGORY_MATCH',
  'FREQUENTLY_ADDED_TOGETHER',
  'FREQUENTLY_PURCHASED_TOGETHER',
  'COMMON_NEXT_PURCHASE',
  'TECHNICALLY_COMPATIBLE',
  'HIGHER_CAPABILITY',
  'LOWER_PRICE_ALTERNATIVE',
  'OUT_OF_STOCK_SUBSTITUTE',
  'WITHIN_BUDGET',
  'AVAILABLE_NOW',
]);
export const limitationCodeSchema = z.enum([
  'PRICE_UNAVAILABLE',
  'STOCK_UNKNOWN',
  'OUT_OF_STOCK',
  'BACKORDER_ONLY',
  'PARTIAL_NEED_MATCH',
  'BUDGET_EXCEEDED',
  'COMPATIBILITY_UNVERIFIED',
  'LOW_RELATIONSHIP_EVIDENCE',
  'MISSING_PRODUCT_DATA',
  'VARIANT_NOT_RESOLVED',
  'SEMANTIC_RETRIEVAL_UNAVAILABLE',
  'NO_PUBLISHED_RELATIONSHIP_SNAPSHOT',
  'PARTIAL_PROVIDER_FAILURE',
]);
export const retrievalSourceSchema = z.enum(['keyword', 'semantic', 'relationship', 'manual_rule', 'hybrid']);
export const resultQualitySchema = z.enum(['high', 'medium', 'low', 'none']);
export const budgetFitSchema = z.enum(['within', 'over', 'unknown', 'not_applicable']);
export const availabilityStatusSchema = z.enum(['in_stock', 'out_of_stock', 'backorder', 'unknown']);
export const searchProductsErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'INVALID_CONSTRAINT',
  'UNSUPPORTED_CURRENCY',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'CATALOG_UNAVAILABLE',
  'RELATIONSHIP_DATA_UNAVAILABLE',
  'PRICE_RESOLUTION_FAILED',
  'CONTRACT_INCOMPATIBLE',
  'INTERNAL_ERROR',
]);

const constraintValueSchema = z.union([
  nonEmptyStringSchema,
  z.number().finite(),
  z.boolean(),
  uniqueStringArraySchema(1),
]);

const searchProductsNeedSchema = z
  .object({
    useCase: nonEmptyStringSchema.optional(),
    requestedCategory: nonEmptyStringSchema.optional(),
    requestedProductTypes: uniqueStringArraySchema(1).optional(),
    requiredFeatures: uniqueStringArraySchema(1).optional(),
    preferredFeatures: uniqueStringArraySchema(1).optional(),
    excludedFeatures: uniqueStringArraySchema(1).optional(),
  })
  .strict();

const sourceProductInputSchema = z
  .object({
    productId: nonEmptyStringSchema,
    combinationId: nonEmptyStringSchema.nullable().optional(),
  })
  .strict();

const budgetSchema = z
  .object({
    minAmount: finiteNonNegativeNumberSchema.optional(),
    maxAmount: finiteNonNegativeNumberSchema.optional(),
    currency: nonEmptyStringSchema,
    scope: budgetScopeSchema,
    required: z.boolean().optional(),
  })
  .strict()
  .superRefine((budget, context) => {
    if (
      budget.minAmount !== undefined &&
      budget.maxAmount !== undefined &&
      budget.minAmount > budget.maxAmount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Budget minAmount must be less than or equal to maxAmount',
        path: ['minAmount'],
      });
    }
  });

const searchProductsConstraintSchema = z
  .object({
    code: constraintCodeSchema,
    required: z.boolean(),
    value: constraintValueSchema,
  })
  .strict();

const searchProductsOptionsSchema = z
  .object({
    limit: z.number().int().min(1).max(SEARCH_PRODUCTS_V2_MAX_LIMIT).optional(),
    includeOutOfStock: z.boolean().optional(),
    includeComplements: z.boolean().optional(),
    includeAlternatives: z.boolean().optional(),
    includeUpgrades: z.boolean().optional(),
    evidenceLevel: evidenceLevelSchema.optional(),
  })
  .strict();

const commercialContextSchema = z
  .object({
    customerId: positiveIntegerSchema.optional(),
    customerGroupId: positiveIntegerSchema.optional(),
    currencyId: positiveIntegerSchema.optional(),
    countryId: positiveIntegerSchema.optional(),
    quantity: positiveIntegerSchema.optional(),
  })
  .strict();

function hasUsefulNeedSignal(need: z.infer<typeof searchProductsNeedSchema> | undefined): boolean {
  if (!need) {
    return false;
  }
  return Object.values(need).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return typeof value === 'string' && value.length > 0;
  });
}

function sourceProductKey(product: z.infer<typeof sourceProductInputSchema>): string {
  return `${product.productId}:${product.combinationId ?? ''}`;
}

function constraintKey(constraint: z.infer<typeof searchProductsConstraintSchema>): string {
  return `${constraint.required}:${JSON.stringify(constraint.value)}`;
}

export const searchProductsInputSchema = z
  .object({
    query: nonEmptyStringSchema.optional(),
    need: searchProductsNeedSchema.optional(),
    sourceProducts: z.array(sourceProductInputSchema).min(1).optional(),
    budget: budgetSchema.optional(),
    constraints: z.array(searchProductsConstraintSchema).optional(),
    options: searchProductsOptionsSchema.optional(),
    commercialContext: commercialContextSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const hasQuery = input.query !== undefined && input.query.length > 0;
    const hasNeed = hasUsefulNeedSignal(input.need);
    const hasSourceProducts = input.sourceProducts !== undefined && input.sourceProducts.length > 0;

    if (!hasQuery && !hasNeed && !hasSourceProducts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SearchProductsInput requires query, need, or sourceProducts',
        path: [],
      });
    }

    if (input.sourceProducts) {
      const keys = input.sourceProducts.map(sourceProductKey);
      if (hasDuplicates(keys)) {
        addDuplicateIssue(context, ['sourceProducts'], 'sourceProducts must be unique by productId and combinationId');
      }
    }

    if (input.constraints) {
      const constraintsByCode = new Map<string, string>();
      for (const [index, constraint] of input.constraints.entries()) {
        const existing = constraintsByCode.get(constraint.code);
        const current = constraintKey(constraint);
        if (existing !== undefined) {
          addDuplicateIssue(
            context,
            ['constraints', index],
            existing === current
              ? 'Constraints must not repeat the same code'
              : 'Constraints with the same code must not contain contradictory values',
          );
        }
        constraintsByCode.set(constraint.code, current);
      }
    }
  });

export const relationshipEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('co_occurrence'),
      jointCount: z.number().int().nonnegative(),
      support: finiteNonNegativeNumberSchema,
      confidence: zeroToOneSchema,
      lift: finiteNonNegativeNumberSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('transition'),
      transitionCount: z.number().int().nonnegative(),
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
]);

const coOccurrenceRelationshipTypes = new Set(['same_cart', 'same_order', 'customer_history']);
const transitionRelationshipTypes = new Set(['next_purchase']);
const ruleRelationshipTypes = new Set(['technical_compatibility', 'manual']);

function isEvidenceCompatible(
  relationshipType: z.infer<typeof relationshipTypeSchema>,
  evidence: z.infer<typeof relationshipEvidenceSchema>,
): boolean {
  if (evidence.kind === 'co_occurrence') {
    return coOccurrenceRelationshipTypes.has(relationshipType);
  }
  if (evidence.kind === 'transition') {
    return transitionRelationshipTypes.has(relationshipType);
  }
  return ruleRelationshipTypes.has(relationshipType);
}

const candidateRelationshipLinkSchema = z
  .object({
    sourceProductId: nonEmptyStringSchema,
    relationshipType: relationshipTypeSchema,
    evidence: relationshipEvidenceSchema.optional(),
    reliability: zeroToOneSchema,
    evidenceWindow: evidenceWindowSchema.optional(),
  })
  .strict()
  .superRefine((link, context) => {
    if (link.evidence && !isEvidenceCompatible(link.relationshipType, link.evidence)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relationshipType is incompatible with evidence kind',
        path: ['evidence'],
      });
    }
  });

function relationshipEvidenceKey(evidence: z.infer<typeof relationshipEvidenceSchema> | undefined): string {
  if (!evidence) {
    return 'summary';
  }
  if (evidence.kind === 'co_occurrence') {
    return [evidence.kind, evidence.jointCount, evidence.support, evidence.confidence, evidence.lift].join(':');
  }
  if (evidence.kind === 'transition') {
    return [
      evidence.kind,
      evidence.transitionCount,
      evidence.transitionProbability,
      evidence.medianLagDays ?? 'null',
    ].join(':');
  }
  return [evidence.kind, evidence.ruleId, evidence.ruleVersion].join(':');
}

export const candidateRelationshipSchema = z
  .object({
    links: z.array(candidateRelationshipLinkSchema).min(1),
    aggregateReliability: zeroToOneSchema,
  })
  .strict()
  .superRefine((relationship, context) => {
    const keys = relationship.links.map((link) => [
      link.sourceProductId,
      link.relationshipType,
      relationshipEvidenceKey(link.evidence),
    ].join('|'));
    if (hasDuplicates(keys)) {
      addDuplicateIssue(
        context,
        ['links'],
        'Relationship links must be unique by sourceProductId, relationshipType, and evidence',
      );
    }
  });

const scoreBreakdownSchema = z
  .object({
    searchRelevance: zeroToOneSchema.nullable(),
    relationshipStrength: zeroToOneSchema.nullable(),
    constraintFit: zeroToOneSchema.nullable(),
    availabilityFit: zeroToOneSchema.nullable(),
    budgetFit: zeroToOneSchema.nullable(),
  })
  .strict();

export const searchProductCandidateSchema = z
  .object({
    productId: nonEmptyStringSchema,
    combinationId: nonEmptyStringSchema.nullable(),
    rank: positiveIntegerSchema,
    score: zeroToOneSchema,
    scoreBreakdown: scoreBreakdownSchema.optional(),
    retrieval: z
      .object({
        source: retrievalSourceSchema,
        matchedTerms: uniqueStringArraySchema(),
      })
      .strict(),
    product: z
      .object({
        name: nonEmptyStringSchema,
        sku: nonEmptyStringSchema.nullable(),
        category: nonEmptyStringSchema.nullable(),
        shortDescription: nonEmptyStringSchema.nullable(),
        productUrl: nonEmptyStringSchema.nullable(),
        price: z
          .object({
            amount: finiteNonNegativeNumberSchema.nullable(),
            currency: nonEmptyStringSchema,
            taxIncluded: z.boolean().nullable(),
          })
          .strict(),
        availability: z
          .object({
            status: availabilityStatusSchema,
            quantity: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      })
      .strict(),
    relationship: candidateRelationshipSchema.optional(),
    recommendation: z
      .object({
        primaryCandidateType: candidateTypeSchema,
        secondaryCandidateTypes: z.array(candidateTypeSchema),
        reasonCodes: z.array(recommendationReasonCodeSchema),
        matchedNeedSignals: uniqueStringArraySchema(),
      })
      .strict(),
    budgetFit: budgetFitSchema,
    limitations: z.array(limitationCodeSchema),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.recommendation.secondaryCandidateTypes.includes(candidate.recommendation.primaryCandidateType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'secondaryCandidateTypes must not repeat primaryCandidateType',
        path: ['recommendation', 'secondaryCandidateTypes'],
      });
    }

    if (hasDuplicates(candidate.recommendation.secondaryCandidateTypes)) {
      addDuplicateIssue(context, ['recommendation', 'secondaryCandidateTypes'], 'secondaryCandidateTypes must be unique');
    }
    if (hasDuplicates(candidate.recommendation.reasonCodes)) {
      addDuplicateIssue(context, ['recommendation', 'reasonCodes'], 'reasonCodes must be unique');
    }
    if (hasDuplicates(candidate.recommendation.matchedNeedSignals)) {
      addDuplicateIssue(context, ['recommendation', 'matchedNeedSignals'], 'matchedNeedSignals must be unique');
    }
    if (hasDuplicates(candidate.limitations)) {
      addDuplicateIssue(context, ['limitations'], 'limitations must be unique');
    }
  });

function candidateKey(candidate: z.infer<typeof searchProductCandidateSchema>): string {
  return `${candidate.productId}:${candidate.combinationId ?? ''}`;
}

function validateConstraintStates(
  output: {
    appliedConstraints: string[];
    relaxedConstraints: string[];
    unsupportedConstraints: string[];
  },
  context: z.RefinementCtx,
): void {
  for (const [path, values] of [
    ['appliedConstraints', output.appliedConstraints],
    ['relaxedConstraints', output.relaxedConstraints],
    ['unsupportedConstraints', output.unsupportedConstraints],
  ] as const) {
    if (hasDuplicates(values)) {
      addDuplicateIssue(context, [path], `${path} must be unique`);
    }
  }

  const states = [
    ['appliedConstraints', output.appliedConstraints],
    ['relaxedConstraints', output.relaxedConstraints],
    ['unsupportedConstraints', output.unsupportedConstraints],
  ] as const;

  for (let leftIndex = 0; leftIndex < states.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < states.length; rightIndex += 1) {
      const [leftPath, leftValues] = states[leftIndex]!;
      const [rightPath, rightValues] = states[rightIndex]!;
      const overlap = leftValues.find((value) => rightValues.includes(value));
      if (overlap) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Constraint ${overlap} appears in both ${leftPath} and ${rightPath}`,
          path: [rightPath],
        });
      }
    }
  }
}

export const searchProductsResultSchema = z
  .object({
    candidates: z.array(searchProductCandidateSchema),
    resultQuality: resultQualitySchema,
    appliedConstraints: z.array(constraintCodeSchema),
    relaxedConstraints: z.array(constraintCodeSchema),
    unsupportedConstraints: z.array(constraintCodeSchema),
    rankingVersion: nonEmptyStringSchema,
    dataWindow: evidenceWindowSchema.optional(),
    provenance: z
      .object({
        source: nonEmptyStringSchema,
        generatedAt: isoDateTimeSchema,
        cached: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.candidates.length === 0 && result.resultQuality !== 'none') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Empty results must have resultQuality none',
        path: ['resultQuality'],
      });
    }
    if (result.candidates.length > 0 && result.resultQuality === 'none') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'resultQuality none requires zero candidates',
        path: ['resultQuality'],
      });
    }

    const ranks = result.candidates.map((candidate) => candidate.rank);
    if (new Set(ranks).size !== ranks.length) {
      addDuplicateIssue(context, ['candidates'], 'Candidate ranks must be unique');
    }
    const sortedRanks = [...ranks].sort((left, right) => left - right);
    for (const [index, rank] of sortedRanks.entries()) {
      if (rank !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Candidate ranks must be contiguous from 1',
          path: ['candidates'],
        });
        break;
      }
    }

    const rankOrderMatches = result.candidates.every((candidate, index) => candidate.rank === index + 1);
    if (!rankOrderMatches) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Candidates must be ordered by rank',
        path: ['candidates'],
      });
    }

    const candidateKeys = result.candidates.map(candidateKey);
    if (hasDuplicates(candidateKeys)) {
      addDuplicateIssue(context, ['candidates'], 'Candidates must be unique by productId and combinationId');
    }

    validateConstraintStates(result, context);
  });

export const searchProductsErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: searchProductsErrorCodeSchema,
        message: nonEmptyStringSchema,
        retryable: z.boolean(),
        correlationId: nonEmptyStringSchema,
        details: z.record(z.unknown()).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.error.details !== undefined && !isJsonSerializable(response.error.details)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'details must be JSON serializable and must not contain Error instances, functions, or non-finite values',
        path: ['error', 'details'],
      });
    }
  });

export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>;
export type BudgetScope = z.infer<typeof budgetScopeSchema>;
export type ConstraintCode = z.infer<typeof constraintCodeSchema>;
export type CandidateType = z.infer<typeof candidateTypeSchema>;
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;
export type RelationshipEvidence = z.infer<typeof relationshipEvidenceSchema>;
export type RecommendationReasonCode = z.infer<typeof recommendationReasonCodeSchema>;
export type LimitationCode = z.infer<typeof limitationCodeSchema>;
export type RetrievalSource = z.infer<typeof retrievalSourceSchema>;
export type ResultQuality = z.infer<typeof resultQualitySchema>;
export type BudgetFit = z.infer<typeof budgetFitSchema>;
export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>;
export type SearchProductsErrorCode = z.infer<typeof searchProductsErrorCodeSchema>;
export type SearchProductsInput = z.infer<typeof searchProductsInputSchema>;
export type SearchProductCandidate = z.infer<typeof searchProductCandidateSchema>;
export type SearchProductsResult = z.infer<typeof searchProductsResultSchema>;
export type SearchProductsErrorResponse = z.infer<typeof searchProductsErrorResponseSchema>;
