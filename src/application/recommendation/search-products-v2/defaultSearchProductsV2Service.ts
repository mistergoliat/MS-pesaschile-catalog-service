import { cloneJsonValue, deepFreeze } from '../../../domain/recommendation/relationship-engine/publication/canonicalJson.js';
import { createProductRuntimeIdentity } from '../../../domain/recommendation/relationship-engine/runtime/index.js';
import { ProductRecommendationError } from '../../../domain/recommendation/relationship-engine/recommendation/index.js';
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
    Math.max(limit, limit * parameters.candidatePoolFactor),
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
  reason: 'customer_not_identified' | 'technical_degradation',
): CustomerProductAffinityResult {
  const affinities: CustomerProductAffinity[] = products.map((product) => ({
    product: cloneJsonValue(product),
    score: 0,
    confidence: 'none',
    scoringVersion: 'customer-affinity-v1',
    signals: deepFreeze([]),
    evidence: deepFreeze([]),
    warnings: deepFreeze(reason === 'customer_not_identified' ? [{ code: 'CUSTOMER_NOT_IDENTIFIED' as const }] : []),
  }));
  const productWarnings = affinities.reduce((count, item) => count + item.warnings.length, 0);
  return deepFreeze({
    ...(customer === undefined ? {} : { customer: cloneJsonValue(customer) }),
    affinities: deepFreeze(affinities),
    warnings: deepFreeze(reason === 'customer_not_identified' ? [{ code: 'CUSTOMER_NOT_IDENTIFIED' as const }] : []),
    statistics: {
      requestedProducts: products.length,
      deduplicatedProducts: products.length,
      duplicateProductsRemoved: 0,
      productsWithEvidence: 0,
      productsWithoutEvidence: products.length,
      positiveSignalsGenerated: 0,
      negativeSignalsGenerated: 0,
      warningsGenerated: reason === 'customer_not_identified' ? productWarnings + 1 : 0,
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

function productByIdentity(products: readonly ProductRelationshipProductReference[]): ReadonlyMap<string, ProductRelationshipProductReference> {
  return new Map(products.map((product) => [createProductRuntimeIdentity(product), product]));
}

function collectWarnings(input: {
  commercial: ProductRecommendationResult;
  affinity?: CustomerProductAffinityResult;
  personalization?: PersonalizedRecommendationResult;
  generated: readonly WarningWithSource[];
}): SearchProductsV2Warning[] {
  const commercialWarnings = input.commercial.recommendations.flatMap((recommendation) => (
    recommendation.warnings.map(() => warning('UPSTREAM_COMMERCIAL_WARNING', 'commercial', recommendation.product))
  ));
  const products = productByIdentity(input.commercial.recommendations.map((recommendation) => recommendation.product));
  const affinityWarnings = input.affinity === undefined
    ? []
    : [
        ...input.affinity.warnings.map((item) => warning(
          mapAffinityWarningCode(item.code),
          'affinity',
          item.productIdentity === undefined ? undefined : products.get(item.productIdentity),
        )),
        ...input.affinity.affinities.flatMap((affinity) => affinity.warnings.map((item) => warning(
          mapAffinityWarningCode(item.code),
          'affinity',
          affinity.product,
        ))),
      ];
  const personalizationWarnings = input.personalization === undefined
    ? []
    : [
        ...input.personalization.warnings.map((item) => warning(mapPersonalizationWarningCode(item.code), 'personalization')),
        ...input.personalization.recommendations.flatMap((recommendation) => recommendation.warnings.map((item) => warning(
          mapPersonalizationWarningCode(item.code),
          'personalization',
          recommendation.product,
        ))),
      ];
  return deduplicateWarnings([
    ...input.generated,
    ...commercialWarnings,
    ...affinityWarnings,
    ...personalizationWarnings,
  ]);
}

function mapResult(input: {
  request: SearchProductsV2Request;
  correlationId: string;
  commercial: ProductRecommendationResult;
  affinity?: CustomerProductAffinityResult;
  personalization?: PersonalizedRecommendationResult;
  generatedWarnings: readonly WarningWithSource[];
  stages: StageStatus;
  degraded: boolean;
  affinityCalls: 0 | 1;
  personalizationCalls: 0 | 1;
}): SearchProductsV2Result {
  const warnings = collectWarnings({
    commercial: input.commercial,
    affinity: input.affinity,
    personalization: input.personalization,
    generated: input.generatedWarnings,
  });
  const recommendations = (input.personalization?.recommendations ?? []).map((recommendation) => ({
    product: cloneJsonValue(recommendation.product),
    rank: recommendation.personalizedRank,
    score: recommendation.personalizedScore,
    commercialScore: recommendation.components.commercialScore,
    affinityScore: recommendation.components.affinityScore,
    affinityConfidence: recommendation.affinityConfidence,
    reasons: recommendation.reasons.map((reason) => ({
      code: reason.code,
      source: reason.source,
    })),
    warnings: deduplicateWarnings(recommendation.warnings.map((item) => warning(
      mapPersonalizationWarningCode(item.code),
      'personalization',
      recommendation.product,
    ))),
  }));
  const excluded = (input.personalization?.excluded ?? []).map((item) => ({
    product: cloneJsonValue(item.product),
    code: item.code,
  }));
  const productWarnings = recommendations.reduce((count, item) => count + item.warnings.length, 0);
  const statistics: SearchProductsV2Statistics = {
    commercialCandidates: input.commercial.recommendations.length,
    affinityCandidates: input.affinity?.affinities.length ?? 0,
    personalizedRecommendations: recommendations.length,
    excludedRecommendations: excluded.length,
    customerAffinityCalls: input.affinityCalls,
    personalizationCalls: input.personalizationCalls,
    degradedStages: input.degraded ? 1 : 0,
    warningsGenerated: warnings.length + productWarnings,
  };
  const result: SearchProductsV2Result = {
    query: input.request.query.trim(),
    ...(input.request.customer === undefined ? {} : { customer: cloneJsonValue(input.request.customer) }),
    recommendations: deepFreeze(recommendations),
    excluded: deepFreeze(excluded),
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

    if (commercial.recommendations.length === 0) {
      const result = mapResult({
        request: parsed.data,
        correlationId,
        commercial,
        generatedWarnings: [warning('NO_COMMERCIAL_CANDIDATES', 't11')],
        stages: {
          commercialRecommendation: 'completed',
          customerAffinity: 'skipped',
          personalization: 'skipped',
        },
        degraded: false,
        affinityCalls: 0,
        personalizationCalls: 0,
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
          maximumResults: requestedLimit,
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
      affinity,
      personalization,
      generatedWarnings,
      stages: {
        commercialRecommendation: 'completed',
        customerAffinity: affinityStage,
        personalization: 'completed',
      },
      degraded,
      affinityCalls,
      personalizationCalls: 1,
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
