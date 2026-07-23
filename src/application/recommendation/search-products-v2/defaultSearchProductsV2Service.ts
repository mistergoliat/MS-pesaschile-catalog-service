import { cloneJsonValue, deepFreeze } from '../../../domain/recommendation/relationship-engine/publication/canonicalJson.js';
import { createProductRuntimeIdentity } from '../../../domain/recommendation/relationship-engine/runtime/index.js';
import {
  DEFAULT_PRODUCT_RECOMMENDATION_SERVICE_PARAMETERS,
  ProductRecommendationError,
} from '../../../domain/recommendation/relationship-engine/recommendation/index.js';
import {
  recommendationEnrichmentCandidatesTotal,
  recommendationEnrichmentInactiveTotal,
  recommendationEnrichmentMissingTotal,
  recommendationEnrichmentOutOfStockTotal,
  recommendationEnrichmentReturnedTotal,
} from '../../../shared/metrics.js';
import { CustomerAffinityError } from '../../../domain/recommendation/customer-affinity/index.js';
import type {
  CustomerAffinityCustomerReference,
  CustomerProductAffinity,
  CustomerProductAffinityResult,
} from '../../../domain/recommendation/customer-affinity/index.js';
import { PersonalizedRecommendationError } from '../../../domain/recommendation/personalized-recommendation/index.js';
import type {
  PersonalizedRecommendationResult,
  PersonalizedRecommendationWarning,
} from '../../../domain/recommendation/personalized-recommendation/index.js';
import {
  DEFAULT_SEARCH_PRODUCTS_V2_SERVICE_PARAMETERS,
  type CatalogProductSummary,
  searchProductsV2RequestSchema,
  searchProductsV2ResultSchema,
  type SearchProductsV2Dependencies,
  type SearchProductsV2Execution,
  type SearchProductsV2Filters,
  type SearchProductsV2Request,
  type SearchProductsV2Result,
  type SearchProductsV2Service,
  type SearchProductsV2ServiceParameters,
  type SearchProductsV2Statistics,
  type SearchProductsV2Warning,
} from './contracts.js';
import { SearchProductsV2Error } from './errors.js';
import type {
  ProductRecommendationContext,
  ProductRecommendationRequest,
  ProductRecommendationResult,
} from '../../../domain/recommendation/relationship-engine/recommendation/index.js';
import type { ProductRelationshipProductReference } from '../../../domain/recommendation/relationship-engine/contracts.js';
import type {
  PersonalizedRecommendation,
  PersonalizedRecommendationExclusion,
} from '../../../domain/recommendation/personalized-recommendation/index.js';

type StageStatus = SearchProductsV2Execution['stages'];

type WarningSource = 't11' | 'commercial' | 'affinity' | 'personalization';

type WarningWithSource = SearchProductsV2Warning & {
  readonly source: WarningSource;
};

function validateParameters(parameters: SearchProductsV2ServiceParameters): SearchProductsV2ServiceParameters {
  if (
    !Number.isInteger(parameters.defaultLimit) ||
    !Number.isInteger(parameters.maximumLimit) ||
    !Number.isInteger(parameters.candidatePoolFactor) ||
    !Number.isInteger(parameters.maximumCandidatePoolSize) ||
    parameters.defaultLimit < 1 ||
    parameters.maximumLimit < parameters.defaultLimit ||
    parameters.candidatePoolFactor < 1 ||
    parameters.maximumCandidatePoolSize < parameters.maximumLimit
  ) {
    throw new SearchProductsV2Error('INTERNAL_CONFIGURATION_ERROR', 'SearchProducts V2 parameters are invalid', {
      stage: 'request',
    });
  }
  return parameters;
}

function warning(
  code: SearchProductsV2Warning['code'],
  source: WarningSource,
  product?: ProductRelationshipProductReference,
  details?: SearchProductsV2Warning['details'],
): WarningWithSource {
  return {
    code,
    source,
    ...(product === undefined ? {} : { product: cloneJsonValue(product) }),
    ...(details === undefined ? {} : { details }),
  };
}

const sourceOrder: WarningSource[] = ['t11', 'commercial', 'affinity', 'personalization'];

function warningKey(item: WarningWithSource): string {
  return [
    item.source,
    item.code,
    item.product === undefined ? '<global>' : createProductRuntimeIdentity(item.product),
  ].join('|');
}

function deduplicateWarnings(warnings: readonly WarningWithSource[]): SearchProductsV2Warning[] {
  const byKey = new Map<string, WarningWithSource>();
  for (const item of warnings) {
    const key = warningKey(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()]
    .sort((left, right) => (
      sourceOrder.indexOf(left.source) - sourceOrder.indexOf(right.source) ||
      (left.product === undefined ? '<global>' : createProductRuntimeIdentity(left.product)).localeCompare(
        right.product === undefined ? '<global>' : createProductRuntimeIdentity(right.product),
      ) ||
      left.code.localeCompare(right.code)
    ))
    .map(({ source: _source, ...item }) => item);
}

function candidatePoolSize(limit: number, parameters: SearchProductsV2ServiceParameters): number {
  return Math.min(
    parameters.maximumCandidatePoolSize,
    DEFAULT_PRODUCT_RECOMMENDATION_SERVICE_PARAMETERS.maximumLimit,
    Math.max(20, limit * parameters.candidatePoolFactor),
  );
}

function mapCommercialRequest(
  request: SearchProductsV2Request,
  requestedLimit: number,
  parameters: SearchProductsV2ServiceParameters,
): ProductRecommendationRequest {
  const context: ProductRecommendationContext = {
    ...(request.context?.intent === undefined ? {} : { intent: request.context.intent as ProductRecommendationContext['intent'] }),
    ...(request.context?.budget === undefined
      ? {}
      : { budget: { currency: request.context.budget.currency, maximum: request.context.budget.amount } }),
  };
  return {
    sourceProduct: cloneJsonValue(request.sourceProduct),
    ...(request.customer === undefined ? {} : { customerId: request.customer.customerId }),
    ...(request.context?.excludedProducts === undefined ? {} : { excludedProducts: cloneJsonValue(request.context.excludedProducts) }),
    limit: candidatePoolSize(requestedLimit, parameters),
    includeOutOfStock: request.filters?.inStockOnly === true ? false : undefined,
    recommendationContext: context,
  };
}

function mapPersonalizationContext(request: SearchProductsV2Request) {
  return {
    ...(request.customer === undefined ? {} : { customer: request.customer, customerIdentified: true }),
    ...(request.context?.intent === undefined ? {} : { intent: request.context.intent }),
    ...(request.context?.useCase === undefined ? {} : { useCase: request.context.useCase }),
    ...(request.context?.budget === undefined
      ? {}
      : { budget: { currency: request.context.budget.currency, maximum: request.context.budget.amount } }),
    ...(request.context?.preferredProducts === undefined ? {} : { preferredProductIds: cloneJsonValue(request.context.preferredProducts) }),
    ...(request.context?.excludedProducts === undefined ? {} : { excludedProductIds: cloneJsonValue(request.context.excludedProducts) }),
  };
}

function assertSupportedFilters(filters: SearchProductsV2Filters | undefined): void {
  if ((filters?.productIds?.length ?? 0) > 0) {
    throw new SearchProductsV2Error('INVALID_REQUEST', 'productIds filter is not supported by SearchProducts V2 V1', {
      stage: 'request',
      details: { filter: 'productIds' },
    });
  }
}

function validateCommercialResult(result: ProductRecommendationResult): void {
  const identities = new Set<string>();
  const ranks = new Set<number>();
  for (const recommendation of result.recommendations) {
    const identity = createProductRuntimeIdentity(recommendation.product);
    if (identities.has(identity)) {
      throw new SearchProductsV2Error('INVALID_COMMERCIAL_RESULT', 'T08 returned duplicated products', {
        stage: 'commercial',
        details: { productIdentity: identity },
      });
    }
    if (ranks.has(recommendation.rank)) {
      throw new SearchProductsV2Error('INVALID_COMMERCIAL_RESULT', 'T08 returned duplicated ranks', {
        stage: 'commercial',
      });
    }
    if (recommendation.productIdentity !== identity || recommendation.score.total < 0 || recommendation.score.total > 100) {
      throw new SearchProductsV2Error('INVALID_COMMERCIAL_RESULT', 'T08 returned an invalid recommendation', {
        stage: 'commercial',
        details: { productIdentity: identity },
      });
    }
    identities.add(identity);
    ranks.add(recommendation.rank);
  }
}

function createNeutralCustomerAffinityResult(
  customer: CustomerAffinityCustomerReference | undefined,
  products: readonly ProductRelationshipProductReference[],
  _reason: 'customer_not_identified' | 'technical_degradation',
): CustomerProductAffinityResult {
  const affinities: CustomerProductAffinity[] = products.map((product) => ({
    product: cloneJsonValue(product),
    score: 0,
    confidence: 'none',
    scoringVersion: 'customer-affinity-v1',
    signals: deepFreeze([]),
    evidence: deepFreeze([]),
    warnings: deepFreeze([]),
  }));
  return deepFreeze({
    ...(customer === undefined ? {} : { customer: cloneJsonValue(customer) }),
    affinities: deepFreeze(affinities),
    warnings: deepFreeze([]),
    statistics: {
      requestedProducts: products.length,
      deduplicatedProducts: products.length,
      duplicateProductsRemoved: 0,
      productsWithEvidence: 0,
      productsWithoutEvidence: products.length,
      positiveSignalsGenerated: 0,
      negativeSignalsGenerated: 0,
      warningsGenerated: 0,
      providerCalls: 0,
    },
  });
}

function mapAffinityWarningCode(code: string): SearchProductsV2Warning['code'] {
  if (code === 'CUSTOMER_NOT_IDENTIFIED') return 'CUSTOMER_NOT_IDENTIFIED';
  if (code === 'NO_CUSTOMER_HISTORY') return 'NO_CUSTOMER_HISTORY';
  if (code === 'PARTIAL_CUSTOMER_HISTORY') return 'PARTIAL_CUSTOMER_HISTORY';
  return 'UPSTREAM_AFFINITY_WARNING';
}

function mapPersonalizationWarningCode(code: PersonalizedRecommendationWarning['code']): SearchProductsV2Warning['code'] {
  if (code === 'CUSTOMER_NOT_IDENTIFIED') return 'CUSTOMER_NOT_IDENTIFIED';
  if (code === 'NO_CUSTOMER_HISTORY') return 'NO_CUSTOMER_HISTORY';
  if (code === 'PARTIAL_CUSTOMER_HISTORY') return 'PARTIAL_CUSTOMER_HISTORY';
  if (code === 'CUSTOMER_AFFINITY_UNAVAILABLE') return 'CUSTOMER_AFFINITY_UNAVAILABLE';
  if (code === 'AFFINITY_MISSING_FOR_PRODUCT') return 'AFFINITY_MISSING_FOR_PRODUCT';
  if (code === 'PERSONALIZATION_CONTEXT_PARTIALLY_APPLIED') return 'PERSONALIZATION_CONTEXT_PARTIALLY_APPLIED';
  return 'UPSTREAM_PERSONALIZATION_WARNING';
}

function deduplicateProductReferences(
  products: readonly ProductRelationshipProductReference[],
): ProductRelationshipProductReference[] {
  const deduplicated = new Map<string, ProductRelationshipProductReference>();
  for (const product of products) {
    const identity = createProductRuntimeIdentity(product);
    if (!deduplicated.has(identity)) {
      deduplicated.set(identity, cloneJsonValue(product));
    }
  }
  return [...deduplicated.values()];
}

function collectWarnings(input: {
  customerProvided: boolean;
  commercial: ProductRecommendationResult;
  affinity?: CustomerProductAffinityResult;
  personalization?: PersonalizedRecommendationResult;
  generated: readonly WarningWithSource[];
}): SearchProductsV2Warning[] {
  const commercialWarnings = input.commercial.recommendations.flatMap((recommendation) => (
    recommendation.warnings.map(() => warning('UPSTREAM_COMMERCIAL_WARNING', 'commercial'))
  ));
  const affinityWarnings = input.affinity === undefined
    ? []
    : [
        ...input.affinity.warnings.map((item) => warning(
          mapAffinityWarningCode(item.code),
          'affinity',
        )),
        ...input.affinity.affinities.flatMap((affinity) => affinity.warnings.map((item) => warning(
          mapAffinityWarningCode(item.code),
          'affinity',
        ))),
      ];
  const personalizationWarnings = input.personalization === undefined
    ? []
    : [
        ...input.personalization.warnings.map((item) => warning(mapPersonalizationWarningCode(item.code), 'personalization')),
        ...input.personalization.recommendations.flatMap((recommendation) => recommendation.warnings.map((item) => warning(
          mapPersonalizationWarningCode(item.code),
          'personalization',
        ))),
      ];
  return deduplicateWarnings([
    ...input.generated,
    ...commercialWarnings,
    ...affinityWarnings,
    ...personalizationWarnings,
  ].filter((item) => input.customerProvided || item.code !== 'CUSTOMER_NOT_IDENTIFIED'));
}

function stockPassesInStockFilter(product: CatalogProductSummary): boolean {
  return product.stock.available && (product.stock.status === 'in_stock' || product.stock.status === 'available_for_order');
}

function relationshipFor(recommendation: PersonalizedRecommendation) {
  const relationship = recommendation.commercialRecommendation.relationship;
  if (relationship.evidence.kind !== 'co_occurrence') {
    throw new SearchProductsV2Error('UPSTREAM_CONTRACT_MISMATCH', 'SearchProducts V2 only supports co-occurrence relationship evidence', {
      stage: 'response',
    });
  }
  return {
    type: relationship.relationshipType,
    reliability: relationship.reliability,
    evidence: {
      jointCount: relationship.evidence.jointCount,
      support: relationship.evidence.support,
      confidence: relationship.evidence.confidence,
      lift: relationship.evidence.lift,
    },
  };
}

function commercialReasonFor(recommendation: PersonalizedRecommendation) {
  if (recommendation.components.normalizedAffinityContribution > 0) {
    return {
      code: 'CUSTOMER_AFFINITY_MATCH' as const,
      label: 'Coincide con afinidad observada del cliente',
    };
  }
  if (recommendation.commercialRecommendation.relationship.relationshipType === 'same_order') {
    return {
      code: 'FREQUENTLY_BOUGHT_TOGETHER' as const,
      label: 'Comprado frecuentemente junto al producto consultado',
    };
  }
  return {
    code: 'RELATED_PRODUCT_FALLBACK' as const,
    label: 'Producto relacionado disponible para evaluación comercial',
  };
}

function globalCatalogWarnings(input: {
  missing: number;
  inactive: number;
  priceMissing: number;
  stockUnknown: number;
}): WarningWithSource[] {
  const warnings: WarningWithSource[] = [];
  if (input.missing > 0) {
    warnings.push(warning('CATALOG_PRODUCT_MISSING', 't11', undefined, { count: input.missing }));
  }
  if (input.inactive > 0) {
    warnings.push(warning('CATALOG_PRODUCT_INACTIVE', 't11', undefined, { count: input.inactive }));
  }
  if (input.priceMissing > 0) {
    warnings.push(warning('CATALOG_PRICE_UNAVAILABLE', 't11', undefined, { count: input.priceMissing }));
  }
  if (input.stockUnknown > 0) {
    warnings.push(warning('CATALOG_STOCK_UNKNOWN', 't11', undefined, { count: input.stockUnknown }));
  }
  return warnings;
}

function personalizationMetadata(input: {
  request: SearchProductsV2Request;
  affinityStage: StageStatus['customerAffinity'];
  warnings: readonly SearchProductsV2Warning[];
}) {
  if (!input.request.customer) {
    return {
      applied: false,
      reason: 'customer_not_provided' as const,
    };
  }
  if (input.affinityStage === 'degraded') {
    return {
      applied: false,
      reason: 'customer_affinity_unavailable' as const,
      customerId: input.request.customer.customerId,
    };
  }
  if (input.warnings.some((item) => item.code === 'NO_CUSTOMER_HISTORY')) {
    return {
      applied: false,
      reason: 'no_customer_history' as const,
      customerId: input.request.customer.customerId,
    };
  }
  return {
    applied: true,
    customerId: input.request.customer.customerId,
  };
}

function mapResult(input: {
  request: SearchProductsV2Request;
  correlationId: string;
  commercial: ProductRecommendationResult;
  sourceProduct: CatalogProductSummary;
  enrichedProducts: ReadonlyMap<string, CatalogProductSummary>;
  affinity?: CustomerProductAffinityResult;
  personalization?: PersonalizedRecommendationResult;
  generatedWarnings: readonly WarningWithSource[];
  affinityStage: StageStatus['customerAffinity'];
  stages: StageStatus;
  degraded: boolean;
  affinityCalls: 0 | 1;
  personalizationCalls: 0 | 1;
  requestedLimit: number;
}): SearchProductsV2Result {
  let missingProducts = 0;
  let inactiveProducts = 0;
  let outOfStockProducts = 0;
  let priceMissing = 0;
  let stockUnknown = 0;
  const kept: Array<{
    recommendation: PersonalizedRecommendation;
    product: CatalogProductSummary;
  }> = [];
  const enrichmentExcluded: Array<{
    product: ProductRelationshipProductReference;
    code: 'MISSING_CATALOG_PRODUCT' | 'INACTIVE_PRODUCT' | 'OUT_OF_STOCK_FILTERED';
  }> = [];

  for (const recommendation of input.personalization?.recommendations ?? []) {
    const identity = createProductRuntimeIdentity(recommendation.product);
    const product = input.enrichedProducts.get(identity);
    if (!product) {
      missingProducts += 1;
      enrichmentExcluded.push({ product: cloneJsonValue(recommendation.product), code: 'MISSING_CATALOG_PRODUCT' });
      continue;
    }
    if (!product.active) {
      inactiveProducts += 1;
      enrichmentExcluded.push({ product: cloneJsonValue(recommendation.product), code: 'INACTIVE_PRODUCT' });
      continue;
    }
    if (input.request.filters?.inStockOnly === true && !stockPassesInStockFilter(product)) {
      outOfStockProducts += 1;
      enrichmentExcluded.push({ product: cloneJsonValue(recommendation.product), code: 'OUT_OF_STOCK_FILTERED' });
      continue;
    }
    if (product.price === null) {
      priceMissing += 1;
    }
    if (product.stock.status === 'unknown') {
      stockUnknown += 1;
    }
    kept.push({ recommendation, product });
  }

  const returned = kept.slice(0, input.requestedLimit);
  const resultLimitExclusions = kept.slice(input.requestedLimit).map((item) => ({
    product: cloneJsonValue(item.recommendation.product),
    code: 'RESULT_LIMIT_TRUNCATION' as const,
  }));
  recommendationEnrichmentMissingTotal.inc(missingProducts);
  recommendationEnrichmentInactiveTotal.inc(inactiveProducts);
  recommendationEnrichmentOutOfStockTotal.inc(outOfStockProducts);
  recommendationEnrichmentReturnedTotal.inc(returned.length);

  const warnings = collectWarnings({
    customerProvided: input.request.customer !== undefined,
    commercial: input.commercial,
    affinity: input.affinity,
    personalization: input.personalization,
    generated: [
      ...input.generatedWarnings,
      ...globalCatalogWarnings({ missing: missingProducts, inactive: inactiveProducts, priceMissing, stockUnknown }),
    ],
  });
  const recommendations = returned.map(({ recommendation, product }, index) => ({
    product: cloneJsonValue(product),
    rank: index + 1,
    score: recommendation.personalizedScore,
    commercialScore: recommendation.components.commercialScore,
    affinityScore: recommendation.components.affinityScore,
    affinityConfidence: recommendation.affinityConfidence,
    ranking: {
      rank: index + 1,
      score: recommendation.personalizedScore,
    },
    relationship: relationshipFor(recommendation),
    commercialReason: commercialReasonFor(recommendation),
    reasons: recommendation.reasons.map((reason) => ({
      code: reason.code,
      source: reason.source,
    })),
    warnings: [],
  }));
  const personalizationExcluded = (input.personalization?.excluded ?? []).map((item: PersonalizedRecommendationExclusion) => ({
    product: cloneJsonValue(item.product),
    code: item.code,
  }));
  const excluded = [
    ...personalizationExcluded,
    ...enrichmentExcluded,
    ...resultLimitExclusions,
  ];
  const statistics: SearchProductsV2Statistics = {
    commercialCandidates: input.commercial.recommendations.length,
    affinityCandidates: input.affinity?.affinities.length ?? 0,
    personalizedRecommendations: recommendations.length,
    excludedRecommendations: excluded.length,
    customerAffinityCalls: input.affinityCalls,
    personalizationCalls: input.personalizationCalls,
    degradedStages: input.degraded ? 1 : 0,
    warningsGenerated: warnings.length,
  };
  const result: SearchProductsV2Result = {
    query: input.request.query?.trim() ?? null,
    sourceProduct: deepFreeze(cloneJsonValue(input.sourceProduct)),
    ...(input.request.customer === undefined ? {} : { customer: cloneJsonValue(input.request.customer) }),
    recommendations: deepFreeze(recommendations),
    excluded: deepFreeze(excluded),
    personalization: deepFreeze(personalizationMetadata({
      request: input.request,
      affinityStage: input.affinityStage,
      warnings,
    })),
    snapshot: deepFreeze({
      id: input.commercial.snapshot.snapshotId,
      modelVersion: input.commercial.snapshot.modelVersion,
    }),
    warnings: deepFreeze(warnings),
    statistics,
    execution: deepFreeze({
      correlationId: input.correlationId,
      degraded: input.degraded,
      degradationReasons: input.degraded ? ['CUSTOMER_AFFINITY_RETRYABLE_FAILURE'] : [],
      stages: input.stages,
    }),
  };
  searchProductsV2ResultSchema.parse(result);
  return deepFreeze(result);
}

function isRetryableAffinityError(error: unknown): boolean {
  return error instanceof CustomerAffinityError && error.retryable;
}

export class DefaultSearchProductsV2Service implements SearchProductsV2Service {
  private readonly parameters: SearchProductsV2ServiceParameters;

  constructor(private readonly dependencies: SearchProductsV2Dependencies) {
    this.parameters = validateParameters(dependencies.parameters ?? DEFAULT_SEARCH_PRODUCTS_V2_SERVICE_PARAMETERS);
  }

  async search(request: SearchProductsV2Request): Promise<SearchProductsV2Result> {
    const parsed = searchProductsV2RequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new SearchProductsV2Error('INVALID_REQUEST', 'SearchProducts V2 request is invalid', {
        stage: 'request',
        details: { issues: parsed.error.issues.length },
      });
    }
    assertSupportedFilters(parsed.data.filters);

    const correlationId = parsed.data.correlationId ?? this.dependencies.correlationIdProvider.generate();
    this.dependencies.logger?.info('search_products_v2_started', { correlationId, stage: 'request' });
    const requestedLimit = parsed.data.limit ?? this.parameters.defaultLimit;
    const commercialRequest = mapCommercialRequest(parsed.data, requestedLimit, this.parameters);

    let commercial: ProductRecommendationResult;
    try {
      commercial = await this.dependencies.commercialRecommendationService.recommend(commercialRequest);
    } catch (error) {
      this.dependencies.logger?.error('search_products_v2_failed', { correlationId, stage: 'commercial' });
      throw new SearchProductsV2Error('COMMERCIAL_RECOMMENDATION_UNAVAILABLE', 'Commercial recommendations are unavailable', {
        stage: 'commercial',
        retryable: error instanceof ProductRecommendationError,
        cause: error,
      });
    }
    validateCommercialResult(commercial);
    this.dependencies.logger?.info('commercial_recommendation_completed', {
      correlationId,
      stage: 'commercial',
      candidateCount: commercial.recommendations.length,
    });
    this.dependencies.logger?.info('relationship_candidates_loaded', {
      correlationId,
      stage: 'commercial',
      candidateCount: commercial.recommendations.length,
      snapshotId: commercial.snapshot.snapshotId,
    });

    const enrichmentReferences = deduplicateProductReferences([
      parsed.data.sourceProduct,
      ...commercial.recommendations.map((recommendation) => recommendation.product),
    ]);
    this.dependencies.logger?.info('source_product_lookup_started', {
      correlationId,
      stage: 'catalog',
      productIdentity: createProductRuntimeIdentity(parsed.data.sourceProduct),
    });
    this.dependencies.logger?.info('catalog_enrichment_requested', {
      correlationId,
      stage: 'catalog',
      productCount: enrichmentReferences.length,
    });
    recommendationEnrichmentCandidatesTotal.inc(commercial.recommendations.length);
    let enrichedProducts: ReadonlyMap<string, CatalogProductSummary>;
    try {
      enrichedProducts = await this.dependencies.catalogProductBatchReader.getProductsByReferences(enrichmentReferences);
    } catch (error) {
      this.dependencies.logger?.error('search_products_v2_failed', { correlationId, stage: 'catalog' });
      throw new SearchProductsV2Error('COMMERCIAL_RECOMMENDATION_UNAVAILABLE', 'Catalog enrichment is unavailable', {
        stage: 'catalog',
        retryable: true,
        cause: error,
      });
    }
    this.dependencies.logger?.info('catalog_products_resolved', {
      correlationId,
      stage: 'catalog',
      requested: enrichmentReferences.length,
      resolved: enrichedProducts.size,
    });
    const sourceIdentity = createProductRuntimeIdentity(parsed.data.sourceProduct);
    const sourceProduct = enrichedProducts.get(sourceIdentity);
    if (!sourceProduct) {
      throw new SearchProductsV2Error('SOURCE_PRODUCT_NOT_FOUND', 'Source product was not found in catalog', {
        stage: 'catalog',
        details: { productIdentity: sourceIdentity },
      });
    }
    if (!sourceProduct.active) {
      throw new SearchProductsV2Error('SOURCE_PRODUCT_INACTIVE', 'Source product is inactive in catalog', {
        stage: 'catalog',
        details: { productIdentity: sourceIdentity },
      });
    }

    if (commercial.recommendations.length === 0) {
      const result = mapResult({
        request: parsed.data,
        correlationId,
        commercial,
        sourceProduct,
        enrichedProducts,
        generatedWarnings: [warning('NO_COMMERCIAL_CANDIDATES', 't11')],
        affinityStage: 'skipped',
        stages: {
          commercialRecommendation: 'completed',
          customerAffinity: 'skipped',
          personalization: 'skipped',
        },
        degraded: false,
        affinityCalls: 0,
        personalizationCalls: 0,
        requestedLimit,
      });
      this.dependencies.logger?.info('search_products_v2_completed', { correlationId, degraded: false, resultCount: 0 });
      return result;
    }

    const products = commercial.recommendations.map((recommendation) => recommendation.product);
    let affinity: CustomerProductAffinityResult | undefined;
    let affinityCalls: 0 | 1 = 0;
    let affinityStage: StageStatus['customerAffinity'] = 'skipped';
    let degraded = false;
    const generatedWarnings: WarningWithSource[] = [];

    if (!parsed.data.customer) {
      affinity = createNeutralCustomerAffinityResult(undefined, products, 'customer_not_identified');
      affinityStage = 'skipped';
    } else {
      try {
        affinityCalls = 1;
        affinity = await this.dependencies.customerAffinityProvider.getAffinities({
          customer: parsed.data.customer,
          products,
          context: {
            ...(parsed.data.context?.intent === undefined ? {} : { intent: parsed.data.context.intent }),
            ...(parsed.data.context?.budget === undefined ? {} : { currency: parsed.data.context.budget.currency }),
          },
        });
        affinityStage = 'completed';
        this.dependencies.logger?.info('customer_affinity_completed', { correlationId, stage: 'affinity' });
      } catch (error) {
        if (!isRetryableAffinityError(error)) {
          this.dependencies.logger?.error('search_products_v2_failed', { correlationId, stage: 'affinity' });
          throw new SearchProductsV2Error('INVALID_AFFINITY_RESULT', 'Customer affinity failed with a non-degradable error', {
            stage: 'affinity',
            cause: error,
          });
        }
        degraded = true;
        affinityStage = 'degraded';
        affinity = createNeutralCustomerAffinityResult(parsed.data.customer, products, 'technical_degradation');
        generatedWarnings.push(warning('CUSTOMER_AFFINITY_UNAVAILABLE', 't11'));
        this.dependencies.logger?.info('customer_affinity_degraded', { correlationId, stage: 'affinity' });
      }
    }

    let personalization: PersonalizedRecommendationResult;
    try {
      personalization = this.dependencies.personalizedRecommendationService.personalize({
        commercialRecommendations: commercial,
        customerAffinities: affinity,
        context: mapPersonalizationContext(parsed.data),
        parameters: {
          maximumResults: candidatePoolSize(requestedLimit, this.parameters),
          commercialWeight: 0.7,
          affinityWeight: 0.3,
          affinityConfidenceNoneMultiplier: 0,
          affinityConfidenceLowMultiplier: 0.35,
          affinityConfidenceMediumMultiplier: 0.7,
          affinityConfidenceHighMultiplier: 1,
          explicitPreferenceBoost: 0.1,
          productRejectionPenalty: 1,
          categoryRejectionPenalty: 0.25,
          minimumPersonalizedScore: 0,
        },
      });
    } catch (error) {
      this.dependencies.logger?.error('search_products_v2_failed', { correlationId, stage: 'personalization' });
      throw new SearchProductsV2Error('INVALID_PERSONALIZATION_RESULT', 'Personalization failed', {
        stage: 'personalization',
        retryable: error instanceof PersonalizedRecommendationError && error.retryable,
        cause: error,
      });
    }
    this.dependencies.logger?.info('personalization_completed', {
      correlationId,
      stage: 'personalization',
      resultCount: personalization.recommendations.length,
    });

    const result = mapResult({
      request: parsed.data,
      correlationId,
      commercial,
      sourceProduct,
      enrichedProducts,
      affinity,
      personalization,
      generatedWarnings,
      affinityStage,
      stages: {
        commercialRecommendation: 'completed',
        customerAffinity: affinityStage,
        personalization: 'completed',
      },
      degraded,
      affinityCalls,
      personalizationCalls: 1,
      requestedLimit,
    });
    this.dependencies.logger?.info('inactive_products_discarded', {
      correlationId,
      stage: 'catalog',
      count: result.excluded.filter((item) => item.code === 'INACTIVE_PRODUCT').length,
    });
    this.dependencies.logger?.info('missing_products_discarded', {
      correlationId,
      stage: 'catalog',
      count: result.excluded.filter((item) => item.code === 'MISSING_CATALOG_PRODUCT').length,
    });
    this.dependencies.logger?.info('out_of_stock_products_discarded', {
      correlationId,
      stage: 'catalog',
      count: result.excluded.filter((item) => item.code === 'OUT_OF_STOCK_FILTERED').length,
    });
    this.dependencies.logger?.info('search_products_v2_completed', {
      correlationId,
      degraded,
      resultCount: result.recommendations.length,
    });
    return result;
  }
}

export const searchProductsV2Internals = {
  createNeutralCustomerAffinityResult,
  mapCommercialRequest,
  mapPersonalizationContext,
} as const;
