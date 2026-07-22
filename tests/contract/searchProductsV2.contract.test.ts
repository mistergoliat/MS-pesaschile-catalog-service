import { describe, expect, it } from 'vitest';
import { catalogToolDefinition } from '../../client/types.js';
import { searchResponseSchema } from '../../src/shared/contracts.js';
import {
  candidateRelationshipSchema,
  relationshipEvidenceSchema,
  searchProductCandidateSchema,
  searchProductsErrorResponseSchema,
  searchProductsInputSchema,
  searchProductsResultSchema,
} from '../../src/domain/recommendation/contracts.js';
import {
  complementSummaryCandidate,
  fullRelationshipCandidate,
  invalidBudgetCurrency,
  invalidBudgetRange,
  invalidDuplicateCandidate,
  invalidEmptyRequest,
  invalidRanks,
  invalidRelationshipEvidence,
  invalidResultQuality,
  primaryFitCandidate,
  validComplementSummaryResult,
  validEmptyResult,
  validErrorResponse,
  validFullRelationshipResult,
  validFullRequest,
  validNeedOnlyRequest,
  validPrimaryFitResult,
  validQueryOnlyRequest,
  validSourceProductsRequest,
} from '../fixtures/searchProductsV2.js';

function expectValid(schema: { safeParse: (input: unknown) => { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(true);
}

function expectInvalid(schema: { safeParse: (input: unknown) => { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

describe('search-products-v2 input contract', () => {
  it('accepts a request with only query', () => {
    expectValid(searchProductsInputSchema, validQueryOnlyRequest);
  });

  it('accepts a request with only need', () => {
    expectValid(searchProductsInputSchema, validNeedOnlyRequest);
  });

  it('accepts a request with only sourceProducts', () => {
    expectValid(searchProductsInputSchema, validSourceProductsRequest);
  });

  it('accepts a full request', () => {
    expectValid(searchProductsInputSchema, validFullRequest);
  });

  it('rejects an empty request', () => {
    expectInvalid(searchProductsInputSchema, invalidEmptyRequest);
  });

  it('rejects an empty query', () => {
    expectInvalid(searchProductsInputSchema, { query: '   ' });
  });

  it('rejects empty need as the only useful signal', () => {
    expectInvalid(searchProductsInputSchema, { need: {} });
  });

  it('rejects empty sourceProducts as the only useful signal', () => {
    expectInvalid(searchProductsInputSchema, { sourceProducts: [] });
  });

  it('rejects duplicate sourceProducts', () => {
    expectInvalid(searchProductsInputSchema, {
      sourceProducts: [
        { productId: '1001', combinationId: null },
        { productId: '1001', combinationId: null },
      ],
    });
  });

  it('rejects negative budget amounts', () => {
    expectInvalid(searchProductsInputSchema, {
      query: 'rack',
      budget: { minAmount: -1, currency: 'CLP', scope: 'per_candidate' },
    });
  });

  it('rejects budget min greater than max', () => {
    expectInvalid(searchProductsInputSchema, invalidBudgetRange);
  });

  it('rejects invalid budget currency', () => {
    expectInvalid(searchProductsInputSchema, invalidBudgetCurrency);
  });

  it('rejects invalid BudgetScope', () => {
    expectInvalid(searchProductsInputSchema, {
      query: 'rack',
      budget: { maxAmount: 100000, currency: 'CLP', scope: 'per_item' },
    });
  });

  it('rejects customerId 0', () => {
    expectInvalid(searchProductsInputSchema, {
      query: 'rack',
      commercialContext: { customerId: 0 },
    });
  });

  it('accepts omitted customerId with positive technical identifiers', () => {
    expectValid(searchProductsInputSchema, {
      query: 'rack',
      commercialContext: {
        customerGroupId: 1,
        currencyId: 1,
        countryId: 44,
        quantity: 1,
      },
    });
  });

  it('rejects non-positive quantity', () => {
    expectInvalid(searchProductsInputSchema, {
      query: 'rack',
      commercialContext: { quantity: 0 },
    });
  });

  it('rejects contradictory duplicate constraints', () => {
    expectInvalid(searchProductsInputSchema, {
      query: 'rack',
      constraints: [
        { code: 'BRAND', required: true, value: 'Brand A' },
        { code: 'BRAND', required: true, value: 'Brand B' },
      ],
    });
  });

  it('rejects repeated constraints with the same code', () => {
    expectInvalid(searchProductsInputSchema, {
      query: 'rack',
      constraints: [
        { code: 'BRAND', required: true, value: 'Brand A' },
        { code: 'BRAND', required: true, value: 'Brand A' },
      ],
    });
  });

  it('rejects enums outside the closed vocabulary', () => {
    expectInvalid(searchProductsInputSchema, {
      query: 'rack',
      constraints: [{ code: 'CATEGORY', required: true, value: 'Racks' }],
    });
  });
});

describe('search-products-v2 relationship evidence contract', () => {
  it('accepts valid co_occurrence evidence', () => {
    expectValid(relationshipEvidenceSchema, {
      kind: 'co_occurrence',
      jointCount: 10,
      support: 0.02,
      confidence: 0.4,
      lift: 1.5,
    });
  });

  it('accepts valid transition evidence', () => {
    expectValid(relationshipEvidenceSchema, {
      kind: 'transition',
      transitionCount: 8,
      transitionProbability: 0.25,
      medianLagDays: 14,
    });
  });

  it('accepts valid rule evidence', () => {
    expectValid(relationshipEvidenceSchema, {
      kind: 'rule',
      ruleId: 'compatibility-001',
      ruleVersion: '2026-07-01',
    });
  });

  it('rejects transition fields in co_occurrence evidence', () => {
    expectInvalid(relationshipEvidenceSchema, {
      kind: 'co_occurrence',
      jointCount: 10,
      support: 0.02,
      confidence: 0.4,
      lift: 1.5,
      medianLagDays: 14,
    });
  });

  it('rejects co_occurrence fields in rule evidence', () => {
    expectInvalid(relationshipEvidenceSchema, {
      kind: 'rule',
      ruleId: 'compatibility-001',
      ruleVersion: '2026-07-01',
      support: 0.02,
    });
  });

  it('rejects evidence kind incompatible with relationshipType', () => {
    expectInvalid(searchProductsResultSchema, invalidRelationshipEvidence);
  });

  it('rejects confidence greater than 1', () => {
    expectInvalid(relationshipEvidenceSchema, {
      kind: 'co_occurrence',
      jointCount: 10,
      support: 0.02,
      confidence: 1.1,
      lift: 1.5,
    });
  });

  it('rejects transitionProbability greater than 1', () => {
    expectInvalid(relationshipEvidenceSchema, {
      kind: 'transition',
      transitionCount: 8,
      transitionProbability: 1.1,
      medianLagDays: null,
    });
  });

  it('rejects reliability outside range', () => {
    expectInvalid(candidateRelationshipSchema, {
      links: [
        {
          sourceProductId: '1001',
          relationshipType: 'same_cart',
          reliability: 1.2,
        },
      ],
      aggregateReliability: 0.5,
    });
  });

  it('rejects relationship objects without links', () => {
    expectInvalid(candidateRelationshipSchema, {
      links: [],
      aggregateReliability: 0.5,
    });
  });

  it('rejects inverted evidence windows', () => {
    expectInvalid(candidateRelationshipSchema, {
      links: [
        {
          sourceProductId: '1001',
          relationshipType: 'same_cart',
          reliability: 0.5,
          evidenceWindow: {
            from: '2025-12-31T23:59:59.000Z',
            to: '2025-01-01T00:00:00.000Z',
          },
        },
      ],
      aggregateReliability: 0.5,
    });
  });
});

describe('search-products-v2 candidate contract', () => {
  it('accepts a valid primary fit candidate', () => {
    expectValid(searchProductCandidateSchema, primaryFitCandidate);
  });

  it('accepts a complement with relationship summary', () => {
    expectValid(searchProductCandidateSchema, complementSummaryCandidate);
  });

  it('accepts a candidate with full relationship evidence', () => {
    expectValid(searchProductCandidateSchema, fullRelationshipCandidate);
  });

  it('rejects score outside range', () => {
    expectInvalid(searchProductCandidateSchema, { ...primaryFitCandidate, score: 1.1 });
  });

  it('rejects non-positive rank', () => {
    expectInvalid(searchProductCandidateSchema, { ...primaryFitCandidate, rank: 0 });
  });

  it('rejects secondary candidate type duplicating primary', () => {
    expectInvalid(searchProductCandidateSchema, {
      ...primaryFitCandidate,
      recommendation: {
        ...primaryFitCandidate.recommendation,
        secondaryCandidateTypes: ['primary_fit'],
      },
    });
  });

  it('rejects duplicate reason codes', () => {
    expectInvalid(searchProductCandidateSchema, {
      ...primaryFitCandidate,
      recommendation: {
        ...primaryFitCandidate.recommendation,
        reasonCodes: ['AVAILABLE_NOW', 'AVAILABLE_NOW'],
      },
    });
  });

  it('rejects duplicate limitations', () => {
    expectInvalid(searchProductCandidateSchema, {
      ...primaryFitCandidate,
      limitations: ['PRICE_UNAVAILABLE', 'PRICE_UNAVAILABLE'],
    });
  });

  it('rejects an empty productId', () => {
    expectInvalid(searchProductCandidateSchema, { ...primaryFitCandidate, productId: ' ' });
  });
});

describe('search-products-v2 result contract', () => {
  it('accepts a complete result', () => {
    expectValid(searchProductsResultSchema, validFullRelationshipResult);
  });

  it('accepts an empty result with quality none', () => {
    expectValid(searchProductsResultSchema, validEmptyResult);
  });

  it('rejects quality none with candidates', () => {
    expectInvalid(searchProductsResultSchema, {
      ...validPrimaryFitResult,
      resultQuality: 'none',
    });
  });

  it('rejects an empty result with low quality', () => {
    expectInvalid(searchProductsResultSchema, invalidResultQuality);
  });

  it('rejects duplicate ranks', () => {
    expectInvalid(searchProductsResultSchema, {
      ...validComplementSummaryResult,
      candidates: [
        primaryFitCandidate,
        {
          ...complementSummaryCandidate,
          rank: 1,
        },
      ],
    });
  });

  it('rejects non-contiguous ranks', () => {
    expectInvalid(searchProductsResultSchema, invalidRanks);
  });

  it('rejects duplicate candidates', () => {
    expectInvalid(searchProductsResultSchema, invalidDuplicateCandidate);
  });

  it('rejects constraints present in more than one state', () => {
    expectInvalid(searchProductsResultSchema, {
      ...validPrimaryFitResult,
      appliedConstraints: ['BRAND'],
      relaxedConstraints: ['BRAND'],
    });
  });

  it('rejects empty rankingVersion', () => {
    expectInvalid(searchProductsResultSchema, {
      ...validPrimaryFitResult,
      rankingVersion: ' ',
    });
  });

  it('rejects invalid generatedAt', () => {
    expectInvalid(searchProductsResultSchema, {
      ...validPrimaryFitResult,
      provenance: {
        ...validPrimaryFitResult.provenance,
        generatedAt: '2026-07-22',
      },
    });
  });

  it('rejects inverted dataWindow', () => {
    expectInvalid(searchProductsResultSchema, {
      ...validPrimaryFitResult,
      dataWindow: {
        from: '2025-12-31T23:59:59.000Z',
        to: '2025-01-01T00:00:00.000Z',
      },
    });
  });

  it('serializes and parses stably', () => {
    const serialized = JSON.stringify(validFullRelationshipResult);
    const parsed = searchProductsResultSchema.parse(JSON.parse(serialized));
    const reparsed = searchProductsResultSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });
});

describe('search-products-v2 error response contract', () => {
  it('accepts a valid error response', () => {
    expectValid(searchProductsErrorResponseSchema, validErrorResponse);
  });

  it('rejects an unknown error code', () => {
    expectInvalid(searchProductsErrorResponseSchema, {
      error: {
        ...validErrorResponse.error,
        code: 'DATABASE_DOWN',
      },
    });
  });

  it('rejects an empty correlationId', () => {
    expectInvalid(searchProductsErrorResponseSchema, {
      error: {
        ...validErrorResponse.error,
        correlationId: ' ',
      },
    });
  });

  it('rejects an empty message', () => {
    expectInvalid(searchProductsErrorResponseSchema, {
      error: {
        ...validErrorResponse.error,
        message: '',
      },
    });
  });

  it('requires retryable', () => {
    const errorWithoutRetryable: Partial<typeof validErrorResponse.error> = { ...validErrorResponse.error };
    delete errorWithoutRetryable.retryable;
    expectInvalid(searchProductsErrorResponseSchema, {
      error: errorWithoutRetryable,
    });
  });

  it('rejects non-serializable details', () => {
    expectInvalid(searchProductsErrorResponseSchema, {
      error: {
        ...validErrorResponse.error,
        details: {
          cause: new Error('must not leak stack traces'),
        },
      },
    });
  });
});

describe('search-products-v2 compatibility guard', () => {
  it('keeps v1 search schema separate and compatible', () => {
    expectValid(searchResponseSchema, {
      query: 'disco bumper',
      items: [
        {
          productId: 1,
          combinationId: 0,
          sku: 'BUMPER',
          name: 'Disco bumper',
          variantLabel: null,
          shortDescription: 'Disco olimpico',
          physicalQuantity: 8,
          available: true,
          matchType: 'partial_name',
        },
      ],
      freshness: {
        cached: false,
        generatedAt: '2026-07-22T12:00:00.000Z',
      },
    });
    expect(catalogToolDefinition.name).toBe('catalog');
  });
});
