import {
  DEFAULT_PRODUCT_INTENT_RESOLUTION_PARAMETERS,
  resolveProductIntentRequestSchema,
  resolveProductIntentResultSchema,
  type ProductIntentCatalogProduct,
  type ProductIntentReference,
  type ProductIntentResolutionParameters,
  type ProductIntentResolutionService,
  type ProductIntentResolutionServiceDependencies,
  type ProductIntentWarning,
  type ResolveProductIntentRequest,
  type ResolveProductIntentResult,
} from './contracts.js';
import { ProductIntentResolutionError } from './errors.js';
import { createProductIntentIdentity } from './productIntentIdentity.js';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function deduplicateReferences(references: readonly ProductIntentReference[]): ProductIntentReference[] {
  const seen = new Set<string>();
  const result: ProductIntentReference[] = [];
  for (const reference of references) {
    const key = createProductIntentIdentity(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
}

function publicProduct(product: ProductIntentCatalogProduct): ResolveProductIntentResult['candidates'][number]['product'] {
  return {
    productId: product.productId,
    ...(product.combinationId === undefined ? {} : { combinationId: product.combinationId }),
    name: product.name,
    ...(product.reference === undefined ? {} : { reference: product.reference }),
    ...(product.description === undefined ? {} : { description: product.description }),
    ...(product.category === undefined ? {} : { category: product.category }),
    active: product.active,
    price: product.price,
    stock: product.stock,
    ...(product.productUrl === undefined ? {} : { productUrl: product.productUrl }),
    ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
  };
}

function candidatePoolSize(limit: number, parameters: ProductIntentResolutionParameters): number {
  return Math.min(parameters.maximumPoolSize, Math.max(limit * parameters.poolFactor, 20));
}

function warning(code: ProductIntentWarning['code'], details?: ProductIntentWarning['details']): ProductIntentWarning {
  return details === undefined ? { code } : { code, details };
}

function deduplicateWarnings(warnings: readonly ProductIntentWarning[]): ProductIntentWarning[] {
  const seen = new Set<string>();
  const result: ProductIntentWarning[] = [];
  for (const item of warnings) {
    const key = `${item.code}:${JSON.stringify(item.details ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function isAvailable(product: ProductIntentCatalogProduct): boolean {
  return product.stock.available && (product.stock.status === 'in_stock' || product.stock.status === 'available_for_order');
}

export class DefaultProductIntentResolutionService implements ProductIntentResolutionService {
  private readonly parameters: ProductIntentResolutionParameters;

  constructor(private readonly dependencies: ProductIntentResolutionServiceDependencies) {
    this.parameters = dependencies.parameters ?? DEFAULT_PRODUCT_INTENT_RESOLUTION_PARAMETERS;
    if (
      this.parameters.defaultLimit < 1 ||
      this.parameters.maximumLimit < this.parameters.defaultLimit ||
      this.parameters.poolFactor < 1 ||
      this.parameters.maximumPoolSize < this.parameters.maximumLimit
    ) {
      throw new ProductIntentResolutionError('INTERNAL_CONFIGURATION_ERROR', 'Invalid product intent parameters', {
        stage: 'request',
      });
    }
  }

  async resolve(request: ResolveProductIntentRequest): Promise<ResolveProductIntentResult> {
    const parsed = resolveProductIntentRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ProductIntentResolutionError('INVALID_REQUEST', 'Invalid product intent request', {
        stage: 'request',
        details: { issues: parsed.error.issues.length },
      });
    }

    const correlationId = parsed.data.correlationId ?? this.dependencies.correlationIdProvider.generate();
    const limit = parsed.data.limit ?? this.parameters.defaultLimit;
    const includeOutOfStock = parsed.data.filters?.inStockOnly !== true;
    const normalized = this.dependencies.synonymProvider.expand(this.dependencies.normalizer.normalize(parsed.data.query));
    const warnings: ProductIntentWarning[] = [];
    if (normalized.normalized !== parsed.data.query) {
      warnings.push(warning('QUERY_NORMALIZED'));
    }

    this.dependencies.logger?.info('product_intent_resolution_started', {
      correlationId,
      queryLength: parsed.data.query.length,
    });
    this.dependencies.logger?.info('product_intent_query_normalized', {
      correlationId,
      tokenCount: normalized.tokens.length,
    });

    let searchHits;
    try {
      searchHits = await this.dependencies.searcher.search({
        query: normalized,
        limit: candidatePoolSize(limit, this.parameters),
        includeOutOfStock,
      });
    } catch (error) {
      this.dependencies.logger?.error('product_intent_resolution_failed', {
        correlationId,
        errorClass: 'catalog_search_unavailable',
      });
      throw new ProductIntentResolutionError('CATALOG_SEARCH_UNAVAILABLE', 'Catalog product intent search failed', {
        stage: 'search',
        retryable: true,
        cause: error,
      });
    }

    this.dependencies.logger?.info('product_intent_catalog_search_completed', {
      correlationId,
      candidatesRetrieved: searchHits.length,
    });

    const references = deduplicateReferences(searchHits.map((hit) => hit.product));
    let productsByIdentity;
    try {
      productsByIdentity = await this.dependencies.catalogReader.getProductsByReferences(references, correlationId);
    } catch (error) {
      throw new ProductIntentResolutionError('CATALOG_SEARCH_UNAVAILABLE', 'Catalog product enrichment failed', {
        stage: 'catalog',
        retryable: true,
        cause: error,
      });
    }

    this.dependencies.logger?.info('product_intent_candidates_enriched', {
      correlationId,
      candidatesResolved: productsByIdentity.size,
    });

    const excludedProductIds = new Set(parsed.data.context?.excludedProductIds ?? []);
    const products = references
      .map((reference) => productsByIdentity.get(createProductIntentIdentity(reference)))
      .filter((product): product is ProductIntentCatalogProduct => product !== undefined);
    const eligible = products.filter((product) => (
      product.active &&
      !excludedProductIds.has(product.productId) &&
      (parsed.data.filters?.inStockOnly === true ? isAvailable(product) : true)
    ));

    this.dependencies.logger?.info('product_intent_candidates_filtered', {
      correlationId,
      candidatesEligible: eligible.length,
    });

    const ranked = this.dependencies.ranker.rank(normalized, eligible, parsed.data.context);
    this.dependencies.logger?.info('product_intent_candidates_ranked', {
      correlationId,
      candidatesRanked: ranked.length,
      topScore: ranked[0]?.score ?? 0,
      topGap: ranked[1] ? ranked[0]!.score - ranked[1].score : 1,
    });

    const decision = this.dependencies.resolutionPolicy.resolve(ranked);
    if (decision.status === 'resolved') {
      this.dependencies.logger?.info('product_intent_resolved', {
        correlationId,
        topScore: decision.confidence,
      });
    } else if (decision.status === 'clarification_required') {
      this.dependencies.logger?.info('product_intent_clarification_required', {
        correlationId,
        topScore: decision.confidence,
      });
    } else {
      this.dependencies.logger?.info('product_intent_no_match', {
        correlationId,
      });
    }

    const visibleRanked = decision.status === 'no_match' ? [] : ranked;
    const publicCandidates = visibleRanked.slice(0, limit).map((candidate, index) => ({
      product: publicProduct(candidate.product),
      match: {
        rank: index + 1,
        score: candidate.score,
        reasons: [...candidate.reasons],
      },
    }));

    if (visibleRanked.length > limit) warnings.push(warning('RESULTS_TRUNCATED'));
    if (publicCandidates.some((candidate) => candidate.product.price === null)) warnings.push(warning('CATALOG_PRICE_UNAVAILABLE'));
    if (publicCandidates.some((candidate) => candidate.product.stock.status === 'unknown')) warnings.push(warning('CATALOG_STOCK_UNKNOWN'));

    const result: ResolveProductIntentResult = {
      query: {
        original: normalized.original,
        normalized: normalized.normalized,
      },
      resolution: {
        status: decision.status,
        confidence: decision.confidence,
        ...(decision.status === 'resolved' && decision.sourceProduct
          ? { sourceProduct: decision.sourceProduct }
          : {}),
      },
      candidates: publicCandidates,
      ...(decision.status === 'clarification_required'
        ? { clarification: this.dependencies.clarificationBuilder.build(ranked) }
        : {}),
      statistics: {
        retrieved: searchHits.length,
        eligible: ranked.length,
        returned: publicCandidates.length,
      },
      warnings: deduplicateWarnings(warnings),
      correlationId,
    };

    const validated = resolveProductIntentResultSchema.safeParse(result);
    if (!validated.success) {
      throw new ProductIntentResolutionError('INVALID_CATALOG_RESULT', 'Invalid product intent response', {
        stage: 'response',
        details: { issues: validated.error.issues.length },
      });
    }

    return deepFreeze(cloneJson(validated.data));
  }
}
