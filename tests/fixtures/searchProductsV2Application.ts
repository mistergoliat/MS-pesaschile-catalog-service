import type {
  CommercialProductRecommendationService,
  ProductRecommendationRequest,
  ProductRecommendationResult,
} from '../../src/domain/recommendation/relationship-engine/recommendation/index.js';
import type {
  CustomerAffinityCustomerReference,
  CustomerProductAffinityProvider,
  CustomerProductAffinityRequest,
  CustomerProductAffinityResult,
} from '../../src/domain/recommendation/customer-affinity/index.js';
import type {
  PersonalizedRecommendationRequest,
  PersonalizedRecommendationResult,
  PersonalizedRecommendationService,
} from '../../src/domain/recommendation/personalized-recommendation/index.js';
import {
  DefaultPersonalizedRecommendationScorer,
  DefaultPersonalizedRecommendationService,
} from '../../src/domain/recommendation/personalized-recommendation/index.js';
import type {
  CorrelationIdProvider,
  SearchProductsV2Logger,
  SearchProductsV2Request,
} from '../../src/application/recommendation/search-products-v2/index.js';
import {
  DefaultSearchProductsV2Service,
} from '../../src/application/recommendation/search-products-v2/index.js';
import { CustomerAffinityError } from '../../src/domain/recommendation/customer-affinity/index.js';
import {
  affinityFor,
  affinityResultFor,
  commercialRecommendationFor,
  commercialResultFor,
  productB,
  productC,
  productD,
  productE,
  signal,
} from './personalizedRecommendation.js';
import { customer } from './customerProductAffinity.js';

export function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export const baseSearchProductsV2Request: SearchProductsV2Request = {
  query: 'rack para sentadillas',
  sourceProduct: { productId: 'A' },
  customer,
  limit: 3,
  correlationId: 'corr-body',
};

export class FakeCorrelationIdProvider implements CorrelationIdProvider {
  calls = 0;

  constructor(private readonly value = 'corr-generated') {}

  generate(): string {
    this.calls += 1;
    return this.value;
  }
}

export class FakeSearchProductsV2Logger implements SearchProductsV2Logger {
  events: Array<{ event: string; fields: Readonly<Record<string, unknown>>; level: 'info' | 'error' }> = [];

  info(event: string, fields: Readonly<Record<string, unknown>>): void {
    this.events.push({ event, fields, level: 'info' });
  }

  error(event: string, fields: Readonly<Record<string, unknown>>): void {
    this.events.push({ event, fields, level: 'error' });
  }
}

export class FakeCommercialRecommendationService implements CommercialProductRecommendationService {
  calls: ProductRecommendationRequest[] = [];

  failWith: Error | null = null;

  constructor(
    private readonly result: ProductRecommendationResult = commercialResultFor([
      commercialRecommendationFor(productB, 1, 80),
      commercialRecommendationFor(productC, 2, 70),
      commercialRecommendationFor(productD, 3, 60),
    ]),
    private readonly callOrder?: string[],
  ) {}

  async recommend(request: ProductRecommendationRequest): Promise<ProductRecommendationResult> {
    this.callOrder?.push('T08');
    this.calls.push(clone(request));
    if (this.failWith) throw this.failWith;
    return this.result;
  }
}

export class FakeCustomerProductAffinityProvider implements CustomerProductAffinityProvider {
  calls: CustomerProductAffinityRequest[] = [];

  failWith: Error | null = null;

  constructor(
    private readonly result: CustomerProductAffinityResult = affinityResultFor([
      affinityFor(productB, 0.8, 'high'),
      affinityFor(productC, 0.3, 'low', [signal('CATEGORY_PURCHASE', 0.5)]),
      affinityFor(productD, 0, 'none', []),
    ]),
    private readonly callOrder?: string[],
  ) {}

  async getAffinities(request: CustomerProductAffinityRequest): Promise<CustomerProductAffinityResult> {
    this.callOrder?.push('T09');
    this.calls.push(clone(request));
    if (this.failWith) throw this.failWith;
    return this.result;
  }
}

export class FakePersonalizedRecommendationService implements PersonalizedRecommendationService {
  calls: PersonalizedRecommendationRequest[] = [];

  failWith: Error | null = null;

  private readonly delegate = new DefaultPersonalizedRecommendationService(new DefaultPersonalizedRecommendationScorer());

  constructor(private readonly callOrder?: string[]) {}

  personalize(request: PersonalizedRecommendationRequest): PersonalizedRecommendationResult {
    this.callOrder?.push('T10');
    this.calls.push(clone(request));
    if (this.failWith) throw this.failWith;
    return this.delegate.personalize(request);
  }
}

export function retryableAffinityFailure(): CustomerAffinityError {
  return new CustomerAffinityError('EVIDENCE_PROVIDER_FAILED', 'timeout', { retryable: true });
}

export function structuralAffinityFailure(): CustomerAffinityError {
  return new CustomerAffinityError('INVALID_PROVIDER_RESPONSE', 'invalid provider response');
}

export function buildSearchProductsV2Harness(options: {
  commercialResult?: ProductRecommendationResult;
  affinityResult?: CustomerProductAffinityResult;
  customerReference?: CustomerAffinityCustomerReference;
  callOrder?: string[];
} = {}) {
  const callOrder = options.callOrder ?? [];
  const commercial = new FakeCommercialRecommendationService(options.commercialResult, callOrder);
  const affinity = new FakeCustomerProductAffinityProvider(options.affinityResult, callOrder);
  const personalization = new FakePersonalizedRecommendationService(callOrder);
  const correlation = new FakeCorrelationIdProvider();
  const logger = new FakeSearchProductsV2Logger();
  const service = new DefaultSearchProductsV2Service({
    commercialRecommendationService: commercial,
    customerAffinityProvider: affinity,
    personalizedRecommendationService: personalization,
    correlationIdProvider: correlation,
    logger,
  });
  return {
    service,
    commercial,
    affinity,
    personalization,
    correlation,
    logger,
    callOrder,
  };
}

export const searchProductsV2UnknownAffinityResult = affinityResultFor([
  affinityFor(productB, 0.8, 'high'),
  affinityFor(productE, 0.9, 'high'),
]);
