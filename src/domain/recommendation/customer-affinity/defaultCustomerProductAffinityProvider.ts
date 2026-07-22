import { productRelationshipProductReferenceSchema } from '../relationship-engine/contracts.js';
import { cloneJsonValue, deepFreeze } from '../relationship-engine/publication/canonicalJson.js';
import { createProductRuntimeIdentity } from '../relationship-engine/runtime/index.js';
import {
  DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
  customerAffinityCustomerReferenceSchema,
  customerAffinityEvidenceResultSchema,
  customerAffinityParametersSchema,
  customerProductAffinityRequestSchema,
  customerProductAffinityResultSchema,
  type CustomerAffinityEvaluator,
  type CustomerAffinityEvidenceProvider,
  type CustomerAffinityEvidenceResult,
  type CustomerAffinityScorer,
  type CustomerAffinityStatistics,
  type CustomerAffinityWarning,
  type CustomerProductAffinity,
  type CustomerProductAffinityProvider,
  type CustomerProductAffinityRequest,
  type CustomerProductAffinityResult,
  type CustomerProductEvidence,
} from './contracts.js';
import { CustomerAffinityError } from './errors.js';

function deduplicateProducts(products: CustomerProductAffinityRequest['products']): {
  products: CustomerProductAffinityRequest['products'];
  duplicateProductsRemoved: number;
} {
  const seen = new Set<string>();
  const deduplicated = [];
  let duplicateProductsRemoved = 0;
  for (const product of products) {
    const identity = createProductRuntimeIdentity(product);
    if (seen.has(identity)) {
      duplicateProductsRemoved += 1;
      continue;
    }
    seen.add(identity);
    deduplicated.push(product);
  }
  return { products: deduplicated, duplicateProductsRemoved };
}

function neutralAffinity(product: CustomerProductAffinityRequest['products'][number], warning?: CustomerAffinityWarning): CustomerProductAffinity {
  return {
    product: cloneJsonValue(product),
    score: 0,
    confidence: 'none',
    scoringVersion: 'customer-affinity-v1',
    signals: deepFreeze([]),
    evidence: deepFreeze([]),
    warnings: warning ? deepFreeze([warning]) : deepFreeze([]),
  };
}

function warning(code: CustomerAffinityWarning['code'], productIdentity?: string): CustomerAffinityWarning {
  return {
    code,
    ...(productIdentity === undefined ? {} : { productIdentity }),
  };
}

function createStatistics(input: {
  requestedProducts: number;
  deduplicatedProducts: number;
  duplicateProductsRemoved: number;
  productsWithEvidence: number;
  positiveSignalsGenerated: number;
  negativeSignalsGenerated: number;
  warningsGenerated: number;
  providerCalls: 0 | 1;
}): CustomerAffinityStatistics {
  return {
    requestedProducts: input.requestedProducts,
    deduplicatedProducts: input.deduplicatedProducts,
    duplicateProductsRemoved: input.duplicateProductsRemoved,
    productsWithEvidence: input.productsWithEvidence,
    productsWithoutEvidence: input.deduplicatedProducts - input.productsWithEvidence,
    positiveSignalsGenerated: input.positiveSignalsGenerated,
    negativeSignalsGenerated: input.negativeSignalsGenerated,
    warningsGenerated: input.warningsGenerated,
    providerCalls: input.providerCalls,
  };
}

export class DefaultCustomerProductAffinityProvider implements CustomerProductAffinityProvider {
  constructor(
    private readonly evidenceProvider: CustomerAffinityEvidenceProvider,
    private readonly evaluator: CustomerAffinityEvaluator,
    private readonly scorer: CustomerAffinityScorer,
  ) {}

  async getAffinities(request: CustomerProductAffinityRequest): Promise<CustomerProductAffinityResult> {
    if (request.customer !== undefined && !customerAffinityCustomerReferenceSchema.safeParse(request.customer).success) {
      throw new CustomerAffinityError('INVALID_CUSTOMER_REFERENCE', 'Customer reference is invalid');
    }
    if (request.products.some((product) => !productRelationshipProductReferenceSchema.safeParse(product).success)) {
      throw new CustomerAffinityError('INVALID_PRODUCT_REFERENCE', 'Product reference is invalid');
    }
    const parsedParameters = customerAffinityParametersSchema.safeParse(
      request.parameters ?? DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
    );
    if (!parsedParameters.success) {
      throw new CustomerAffinityError('INVALID_PARAMETERS', 'Customer affinity parameters are invalid');
    }
    const parsedRequest = customerProductAffinityRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new CustomerAffinityError('INVALID_REQUEST', 'Customer affinity request is invalid');
    }
    const parameters = parsedParameters.data;
    const deduplicated = deduplicateProducts(parsedRequest.data.products);

    if (deduplicated.products.length === 0) {
      return this.buildResult({
        customer: parsedRequest.data.customer,
        affinities: [],
        warnings: [],
        requestedProducts: parsedRequest.data.products.length,
        duplicateProductsRemoved: deduplicated.duplicateProductsRemoved,
        providerCalls: 0,
      });
    }

    if (!parsedRequest.data.customer) {
      const globalWarnings = [warning('CUSTOMER_NOT_IDENTIFIED')];
      return this.buildResult({
        affinities: deduplicated.products.map((product) => neutralAffinity(product)),
        warnings: globalWarnings,
        requestedProducts: parsedRequest.data.products.length,
        duplicateProductsRemoved: deduplicated.duplicateProductsRemoved,
        providerCalls: 0,
      });
    }

    let evidenceResult: CustomerAffinityEvidenceResult;
    try {
      evidenceResult = await this.evidenceProvider.getEvidence(
        parsedRequest.data.customer,
        deduplicated.products,
        parsedRequest.data.context,
      );
    } catch (error) {
      throw new CustomerAffinityError('EVIDENCE_PROVIDER_FAILED', 'Customer affinity evidence provider failed', {
        retryable: true,
        cause: error,
      });
    }

    const validatedEvidence = this.validateProviderResponse(
      evidenceResult,
      parsedRequest.data.customer,
      deduplicated.products,
    );
    const evidenceByProduct = new Map<string, CustomerProductEvidence>();
    for (const productEvidence of validatedEvidence.productEvidence) {
      evidenceByProduct.set(createProductRuntimeIdentity(productEvidence.product), productEvidence);
    }

    const affinities: CustomerProductAffinity[] = [];
    const productsWithEvidence = evidenceByProduct.size;
    for (const product of deduplicated.products) {
      const productIdentity = createProductRuntimeIdentity(product);
      const productEvidence = evidenceByProduct.get(productIdentity);
      if (!productEvidence && productsWithEvidence > 0) {
        affinities.push(neutralAffinity(product, warning('PARTIAL_CUSTOMER_HISTORY', productIdentity)));
        continue;
      }
      const evaluation = this.evaluator.evaluate(
        product,
        productEvidence,
        validatedEvidence.customerProfile,
        parsedRequest.data.context,
        parameters,
      );
      const score = this.scorer.score(evaluation, parameters);
      affinities.push({
        product: cloneJsonValue(product),
        score: score.score,
        confidence: score.confidence,
        scoringVersion: score.scoringVersion,
        signals: deepFreeze(cloneJsonValue(evaluation.signals)),
        evidence: deepFreeze(cloneJsonValue(evaluation.evidence)),
        warnings: deepFreeze(cloneJsonValue(evaluation.warnings)),
      });
    }

    const globalWarnings: CustomerAffinityWarning[] = [
      ...(validatedEvidence.warnings ?? []).map(() => warning('AFFINITY_PROVIDER_WARNING')),
    ];
    if (productsWithEvidence === 0) {
      globalWarnings.push(warning('NO_CUSTOMER_HISTORY'));
    } else if (productsWithEvidence < deduplicated.products.length) {
      globalWarnings.push(warning('PARTIAL_CUSTOMER_HISTORY'));
    }

    return this.buildResult({
      customer: parsedRequest.data.customer,
      affinities,
      warnings: globalWarnings,
      requestedProducts: parsedRequest.data.products.length,
      duplicateProductsRemoved: deduplicated.duplicateProductsRemoved,
      productsWithEvidence,
      providerCalls: 1,
    });
  }

  private validateProviderResponse(
    response: CustomerAffinityEvidenceResult,
    customer: NonNullable<CustomerProductAffinityRequest['customer']>,
    products: CustomerProductAffinityRequest['products'],
  ): CustomerAffinityEvidenceResult {
    const parsed = customerAffinityEvidenceResultSchema.safeParse(response);
    if (!parsed.success) {
      throw new CustomerAffinityError('INVALID_PROVIDER_RESPONSE', 'Customer affinity provider response is invalid');
    }
    if (parsed.data.customer.customerId !== customer.customerId) {
      throw new CustomerAffinityError('INVALID_PROVIDER_RESPONSE', 'Customer affinity provider returned a different customer');
    }

    const requested = new Set(products.map((product) => createProductRuntimeIdentity(product)));
    const returned = parsed.data.productEvidence.map((productEvidence) => createProductRuntimeIdentity(productEvidence.product));
    if (new Set(returned).size !== returned.length) {
      throw new CustomerAffinityError('INVALID_PROVIDER_RESPONSE', 'Customer affinity provider returned duplicate product evidence');
    }
    if (returned.some((identity) => !requested.has(identity))) {
      throw new CustomerAffinityError('INVALID_PROVIDER_RESPONSE', 'Customer affinity provider returned evidence for a product outside the batch');
    }

    return cloneJsonValue(parsed.data);
  }

  private buildResult(input: {
    customer?: CustomerProductAffinityRequest['customer'];
    affinities: readonly CustomerProductAffinity[];
    warnings: readonly CustomerAffinityWarning[];
    requestedProducts: number;
    duplicateProductsRemoved: number;
    productsWithEvidence?: number;
    providerCalls: 0 | 1;
  }): CustomerProductAffinityResult {
    const positiveSignalsGenerated = input.affinities.reduce(
      (count, affinity) => count + affinity.signals.filter((signal) => signal.direction === 'positive').length,
      0,
    );
    const negativeSignalsGenerated = input.affinities.reduce(
      (count, affinity) => count + affinity.signals.filter((signal) => signal.direction === 'negative').length,
      0,
    );
    const productWarnings = input.affinities.reduce((count, affinity) => count + affinity.warnings.length, 0);
    const statistics = createStatistics({
      requestedProducts: input.requestedProducts,
      deduplicatedProducts: input.affinities.length,
      duplicateProductsRemoved: input.duplicateProductsRemoved,
      productsWithEvidence: input.productsWithEvidence ?? input.affinities.filter((affinity) => affinity.evidence.length > 0).length,
      positiveSignalsGenerated,
      negativeSignalsGenerated,
      warningsGenerated: input.warnings.length + productWarnings,
      providerCalls: input.providerCalls,
    });
    const result: CustomerProductAffinityResult = {
      ...(input.customer === undefined ? {} : { customer: cloneJsonValue(input.customer) }),
      affinities: deepFreeze(cloneJsonValue(input.affinities)),
      warnings: deepFreeze(cloneJsonValue(input.warnings)),
      statistics,
    };
    customerProductAffinityResultSchema.parse(result);
    return deepFreeze(result);
  }
}
