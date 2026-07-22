import type {
  SearchProductCandidate,
  SearchProductsErrorResponse,
  SearchProductsInput,
  SearchProductsResult,
} from '../../src/domain/recommendation/contracts.js';

const generatedAt = '2026-07-22T12:00:00.000Z';

export const validQueryOnlyRequest: SearchProductsInput = {
  query: 'disco bumper',
};

export const validNeedOnlyRequest: SearchProductsInput = {
  need: {
    useCase: 'home gym strength training',
    requestedProductTypes: ['rack'],
  },
};

export const validSourceProductsRequest: SearchProductsInput = {
  sourceProducts: [
    {
      productId: '1001',
      combinationId: null,
    },
  ],
};

export const validFullRequest: SearchProductsInput = {
  query: 'barra olimpica',
  need: {
    useCase: 'equipar box funcional',
    requestedCategory: 'barras',
    requestedProductTypes: ['barra olimpica'],
    requiredFeatures: ['20 kg'],
    preferredFeatures: ['rodamientos'],
    excludedFeatures: ['zinc negro'],
  },
  sourceProducts: [
    {
      productId: '2001',
      combinationId: '3001',
    },
  ],
  budget: {
    minAmount: 50000,
    maxAmount: 200000,
    currency: 'CLP',
    scope: 'per_candidate',
    required: false,
  },
  constraints: [
    {
      code: 'BRAND',
      required: false,
      value: 'PesasChile',
    },
    {
      code: 'DELIVERY_LOCATION',
      required: true,
      value: 'Santiago',
    },
  ],
  options: {
    limit: 10,
    includeOutOfStock: false,
    includeComplements: true,
    includeAlternatives: true,
    includeUpgrades: false,
    evidenceLevel: 'summary',
  },
  commercialContext: {
    customerGroupId: 1,
    currencyId: 1,
    countryId: 44,
    quantity: 1,
  },
};

export const primaryFitCandidate: SearchProductCandidate = {
  productId: '1001',
  combinationId: '2001',
  rank: 1,
  score: 0.92,
  retrieval: {
    source: 'keyword',
    matchedTerms: ['disco', 'bumper'],
  },
  product: {
    name: 'Disco bumper olimpico 20 kg',
    sku: 'BUMPER-20',
    category: 'Discos',
    shortDescription: 'Disco bumper de caucho para entrenamiento olimpico.',
    productUrl: 'https://pesaschile.example/products/disco-bumper-20',
    price: {
      amount: 59990,
      currency: 'CLP',
      taxIncluded: true,
    },
    availability: {
      status: 'in_stock',
      quantity: 8,
    },
  },
  recommendation: {
    primaryCandidateType: 'primary_fit',
    secondaryCandidateTypes: [],
    reasonCodes: ['EXACT_QUERY_MATCH', 'CATEGORY_MATCH', 'WITHIN_BUDGET', 'AVAILABLE_NOW'],
    matchedNeedSignals: ['query:disco bumper', 'category:Discos'],
  },
  budgetFit: 'within',
  limitations: [],
};

export const complementSummaryCandidate: SearchProductCandidate = {
  productId: '1002',
  combinationId: null,
  rank: 2,
  score: 0.74,
  retrieval: {
    source: 'relationship',
    matchedTerms: [],
  },
  product: {
    name: 'Collar olimpico par',
    sku: 'COLLAR-OLY',
    category: 'Accesorios',
    shortDescription: 'Par de collares para barra olimpica.',
    productUrl: null,
    price: {
      amount: 19990,
      currency: 'CLP',
      taxIncluded: true,
    },
    availability: {
      status: 'in_stock',
      quantity: 14,
    },
  },
  relationship: {
    links: [
      {
        sourceProductId: '1001',
        relationshipType: 'same_cart',
        reliability: 0.68,
      },
    ],
    aggregateReliability: 0.68,
  },
  recommendation: {
    primaryCandidateType: 'complement',
    secondaryCandidateTypes: [],
    reasonCodes: ['FREQUENTLY_ADDED_TOGETHER', 'AVAILABLE_NOW'],
    matchedNeedSignals: ['sourceProduct:1001'],
  },
  budgetFit: 'within',
  limitations: [],
};

export const fullRelationshipCandidate: SearchProductCandidate = {
  ...complementSummaryCandidate,
  scoreBreakdown: {
    searchRelevance: null,
    relationshipStrength: 0.68,
    constraintFit: 1,
    availabilityFit: 1,
    budgetFit: 1,
  },
  relationship: {
    links: [
      {
        sourceProductId: '1001',
        relationshipType: 'same_cart',
        evidence: {
          kind: 'co_occurrence',
          jointCount: 24,
          support: 0.014,
          confidence: 0.32,
          lift: 2.1,
        },
        reliability: 0.68,
        evidenceWindow: {
          from: '2025-01-01T00:00:00.000Z',
          to: '2025-12-31T23:59:59.000Z',
        },
      },
      {
        sourceProductId: '1001',
        relationshipType: 'manual',
        evidence: {
          kind: 'rule',
          ruleId: 'manual-collar-compatibility',
          ruleVersion: '2026-07-01',
        },
        reliability: 0.9,
      },
    ],
    aggregateReliability: 0.79,
  },
};

export const validEmptyResult: SearchProductsResult = {
  candidates: [],
  resultQuality: 'none',
  appliedConstraints: [],
  relaxedConstraints: [],
  unsupportedConstraints: [],
  rankingVersion: 'search-products-v2-ranking.0',
  provenance: {
    source: 'contract-fixture',
    generatedAt,
    cached: false,
  },
};

export const validPrimaryFitResult: SearchProductsResult = {
  candidates: [primaryFitCandidate],
  resultQuality: 'high',
  appliedConstraints: ['BRAND'],
  relaxedConstraints: [],
  unsupportedConstraints: [],
  rankingVersion: 'search-products-v2-ranking.0',
  provenance: {
    source: 'contract-fixture',
    generatedAt,
    cached: false,
  },
};

export const validComplementSummaryResult: SearchProductsResult = {
  candidates: [primaryFitCandidate, complementSummaryCandidate],
  resultQuality: 'medium',
  appliedConstraints: [],
  relaxedConstraints: ['DELIVERY_LOCATION'],
  unsupportedConstraints: [],
  rankingVersion: 'search-products-v2-ranking.0',
  dataWindow: {
    from: '2025-01-01T00:00:00.000Z',
    to: '2025-12-31T23:59:59.000Z',
  },
  provenance: {
    source: 'contract-fixture',
    generatedAt,
    cached: false,
  },
};

export const validFullRelationshipResult: SearchProductsResult = {
  candidates: [primaryFitCandidate, { ...fullRelationshipCandidate, rank: 2 }],
  resultQuality: 'high',
  appliedConstraints: ['BRAND'],
  relaxedConstraints: [],
  unsupportedConstraints: [],
  rankingVersion: 'search-products-v2-ranking.0',
  dataWindow: {
    from: '2025-01-01T00:00:00.000Z',
    to: '2025-12-31T23:59:59.000Z',
  },
  provenance: {
    source: 'contract-fixture',
    generatedAt,
    cached: false,
  },
};

export const validErrorResponse: SearchProductsErrorResponse = {
  error: {
    code: 'INVALID_REQUEST',
    message: 'Invalid search products request',
    retryable: false,
    correlationId: 'corr-contract-1',
    details: {
      field: 'query',
      issue: 'required signal missing',
    },
  },
};

export const invalidEmptyRequest = {};

export const invalidBudgetRange = {
  query: 'disco bumper',
  budget: {
    minAmount: 200000,
    maxAmount: 100000,
    currency: 'CLP',
    scope: 'per_candidate',
  },
};

export const invalidBudgetCurrency = {
  query: 'disco bumper',
  budget: {
    maxAmount: 100000,
    currency: '',
    scope: 'per_candidate',
  },
};

export const invalidRelationshipEvidence = {
  ...validPrimaryFitResult,
  candidates: [
    {
      ...primaryFitCandidate,
      relationship: {
        links: [
          {
            sourceProductId: '1001',
            relationshipType: 'technical_compatibility',
            evidence: {
              kind: 'co_occurrence',
              jointCount: 10,
              support: 0.1,
              confidence: 0.5,
              lift: 1.2,
            },
            reliability: 0.7,
          },
        ],
        aggregateReliability: 0.7,
      },
    },
  ],
};

export const invalidRanks = {
  ...validComplementSummaryResult,
  candidates: [
    primaryFitCandidate,
    {
      ...complementSummaryCandidate,
      rank: 3,
    },
  ],
};

export const invalidDuplicateCandidate = {
  ...validComplementSummaryResult,
  candidates: [
    primaryFitCandidate,
    {
      ...primaryFitCandidate,
      rank: 2,
    },
  ],
};

export const invalidResultQuality = {
  ...validEmptyResult,
  resultQuality: 'low',
};

export const searchProductsV2Fixtures = {
  'valid-query-only-request': validQueryOnlyRequest,
  'valid-need-only-request': validNeedOnlyRequest,
  'valid-source-products-request': validSourceProductsRequest,
  'valid-full-request': validFullRequest,
  'valid-empty-result': validEmptyResult,
  'valid-primary-fit-result': validPrimaryFitResult,
  'valid-complement-summary-result': validComplementSummaryResult,
  'valid-full-relationship-result': validFullRelationshipResult,
  'valid-error-response': validErrorResponse,
  'invalid-empty-request': invalidEmptyRequest,
  'invalid-budget-range': invalidBudgetRange,
  'invalid-budget-currency': invalidBudgetCurrency,
  'invalid-relationship-evidence': invalidRelationshipEvidence,
  'invalid-ranks': invalidRanks,
  'invalid-duplicate-candidate': invalidDuplicateCandidate,
  'invalid-result-quality': invalidResultQuality,
} as const;

