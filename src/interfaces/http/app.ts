import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { config } from '../../shared/config.js';
import { createCorrelationId, isApiKeyAuthorized } from '../../shared/crypto.js';
import { CatalogError, InternalError, InvalidInputError, RateLimitedError, UnauthorizedError } from '../../shared/errors.js';
import { errorsTotal, httpRequestDurationSeconds, httpRequestsTotal, metricsText } from '../../shared/metrics.js';
import { logger } from '../../shared/logger.js';
import { batchRequestSchema, errorResponseSchema, healthResponseSchema, productParamsSchema, productQuerySchema, productResponseSchema, searchQuerySchema, searchResponseSchema, batchResponseSchema } from '../../shared/contracts.js';
import { readCommercialContext } from '../../shared/requestContext.js';
import type { CatalogApplicationService } from '../../application/catalogService.js';
import type { ProductIntentResolutionService } from '../../application/catalog/product-intent/index.js';
import type { ExploreProductsService } from '../../application/catalog/explore-products/index.js';
import type { SearchProductsV2Service } from '../../application/recommendation/search-products-v2/index.js';
import type { CatalogRepository } from '../../domain/catalog/ports.js';
import type { BatchGetInput } from '../../domain/catalog/types.js';
import type { ActiveProductSemanticSnapshotReader } from '../../domain/product-semantic-snapshot/runtime/index.js';
import type { ProductSemanticsRegistryService } from '../../application/catalog/product-semantics-registry/index.js';
import type { TrainingSemanticReadService } from '../../application/catalog/training-semantic-read/index.js';
import type { TrainingSemanticQueryService } from '../../application/catalog/training-semantic-query/index.js';
import type { SemanticDiscoveryService } from '../../application/catalog/semantic-discovery/index.js';
import { registerSearchProductsV2Route } from './routes/searchProductsV2Route.js';
import { registerResolveProductIntentRoute } from './routes/resolveProductIntentRoute.js';
import { registerExploreProductsRoute } from './routes/exploreProductsRoute.js';
import { registerGetProductSemanticsRoute } from './routes/getProductSemanticsRoute.js';
import { registerGetProductSemanticsBatchRoute } from './routes/getProductSemanticsBatchRoute.js';
import { registerGetProductSemanticsRegistryRoute } from './routes/getProductSemanticsRegistryRoute.js';
import { registerGetTrainingSemanticProductRoute } from './routes/getTrainingSemanticProductRoute.js';
import { registerGetTrainingSemanticBatchRoute } from './routes/getTrainingSemanticBatchRoute.js';
import { registerGetTrainingSemanticRegistryRoute } from './routes/getTrainingSemanticRegistryRoute.js';
import { registerQueryTrainingSemanticsRoute } from './routes/queryTrainingSemanticsRoute.js';
import { registerSemanticDiscoveryQueryRoute } from './routes/semanticDiscoveryQueryRoute.js';
import { registerCatalogV2Routes } from './routes/catalogV2Routes.js';
import type { CatalogContractService } from '../../application/catalog/v2/catalogContractService.js';
import type { RuntimeProjectionManager } from '../../domain/catalog/runtime-projection.js';
import type { CatalogAuthoritySnapshot } from '../../domain/catalog/runtime-authority-contract.js';

export type AppDependencies = {
  service: CatalogApplicationService;
  exploreProductsService?: ExploreProductsService;
  productIntentResolutionService?: ProductIntentResolutionService;
  searchProductsV2Service?: SearchProductsV2Service;
  productSemanticSnapshotReader?: ActiveProductSemanticSnapshotReader;
  productSemanticsRegistryService?: ProductSemanticsRegistryService;
  trainingSemanticReadService?: TrainingSemanticReadService;
  trainingSemanticQueryService?: TrainingSemanticQueryService;
  semanticDiscoveryService?: SemanticDiscoveryService;
  catalogContractService?: CatalogContractService;
  projectionRuntimeManager?: RuntimeProjectionManager;
  catalogAuthoritySnapshot?: () => Promise<CatalogAuthoritySnapshot>;
  repository: CatalogRepository;
  readyCheck: () => Promise<{
    database: 'ok' | 'unavailable';
    redis?: 'ok' | 'unavailable';
    relationshipSnapshot?: 'ok' | 'unavailable';
    capabilities?: {
      commercialTruth: 'ok' | 'unavailable';
      relationships: 'ok' | 'unavailable';
      productSemantics: 'ok' | 'unavailable';
      trainingSemantics: 'ok' | 'unavailable';
    };
    projection?: { desiredProjectionBundleId: string | null; desiredActivationId: string | null; loadedProjectionBundleId: string | null;
      loadedAt: string | null; reloadState: string; lastReloadError: string | null;
      readiness: Record<string, 'READY' | 'DEGRADED' | 'UNAVAILABLE'> };
  }>;
};

const requestStartedAt = new WeakMap<object, bigint>();
const jsonSchemaCache = new Map<string, unknown>();

function jsonSchema(schema: unknown, name: string) {
  // Emit a self-contained OpenAPI schema so Swagger UI does not depend on
  // separately registered component schemas.
  const cached = jsonSchemaCache.get(name);
  if (cached) return cached;
  const converted = zodToJsonSchema(schema as never, { $refStrategy: 'none' });
  jsonSchemaCache.set(name, converted);
  return converted;
}

function errorPayload(error: CatalogError, correlationId: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      correlationId,
    },
  };
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: config.limits.bodyLimitBytes,
    genReqId: (request) => {
      const incoming = request.headers['x-correlation-id'];
      return typeof incoming === 'string' && incoming.trim() ? incoming : createCorrelationId();
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: config.limits.rateLimitMax,
    timeWindow: config.limits.rateLimitTimeWindowMs,
  });

  if (config.observability.enableDocs && config.env !== 'production') {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Catalog Service',
          description: 'Read-only PrestaShop catalog API',
          version: '1.0.0',
        },
        components: {
          securitySchemes: {
            apiKeyAuth: {
              type: 'apiKey',
              name: 'x-api-key',
              in: 'header',
            },
          },
        },
      },
    });
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        persistAuthorization: true,
      },
    });
    app.get('/openapi.json', async (_request, reply) => {
      reply.type('application/json');
      return reply.send(app.swagger());
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    requestStartedAt.set(request as object, process.hrtime.bigint());
    reply.header('x-correlation-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? request.raw.url ?? 'unknown';
    const method = request.method;
    const status = String(reply.statusCode);
    httpRequestsTotal.inc({ method, route, status });
    const startedAt = requestStartedAt.get(request as object);
    const elapsed = startedAt ? Number(process.hrtime.bigint() - startedAt) / 1e9 : 0;
    httpRequestDurationSeconds.observe({ method, route, status }, elapsed);
  });

  app.setErrorHandler(async (error, request, reply) => {
    const correlationId = request.id;
    if (error instanceof CatalogError) {
      errorsTotal.inc({ code: error.code });
      if ((request.routeOptions.url ?? '').startsWith('/v2/catalog')) {
        // v2 failure semantics: lowercase typed codes and an explicit retryable flag.
        return reply.code(error.statusCode).send({
          error: { code: error.code.toLowerCase(), message: error.message, correlationId, retryable: error.statusCode >= 500 },
        });
      }
      return reply.code(error.statusCode).send(errorPayload(error, correlationId));
    }

    const candidate = error as { statusCode?: number; validation?: unknown; code?: string };
    if (candidate.validation || candidate.code === 'FST_ERR_VALIDATION' || candidate.statusCode === 400) {
      if ((request.routeOptions.url ?? '').startsWith('/v2/catalog')) {
        errorsTotal.inc({ code: 'invalid_request' });
        return reply.code(400).send({
          error: { code: 'invalid_request', message: 'Invalid request', correlationId },
        });
      }
      const normalized = new InvalidInputError('Invalid request', candidate.validation);
      errorsTotal.inc({ code: normalized.code });
      return reply.code(400).send(errorPayload(normalized, correlationId));
    }

    if (candidate.statusCode === 429 || candidate.code === 'FST_ERR_RATE_LIMIT' || candidate.code === 'FST_RATE_LIMIT') {
      if ((request.routeOptions.url ?? '').startsWith('/v2/catalog')) {
        errorsTotal.inc({ code: 'rate_limited' });
        return reply.code(429).send({
          error: { code: 'rate_limited', message: 'Rate limit exceeded', correlationId, retryable: true },
        });
      }
      const normalized = new RateLimitedError();
      errorsTotal.inc({ code: normalized.code });
      return reply.code(429).send(errorPayload(normalized, correlationId));
    }

    errorsTotal.inc({ code: 'INTERNAL_ERROR' });
    request.log.error({ err: error, correlationId }, 'Unhandled error');
    return reply.code(500).send(errorPayload(new InternalError('Internal server error'), correlationId));
  });

  app.get('/health/live', {
    schema: {
      response: {
        200: jsonSchema(healthResponseSchema, 'HealthResponse'),
      },
    },
  }, async (_request, reply) => {
    return reply.send({ status: 'ok', checks: {} });
  });

  app.get('/health/ready', {
    schema: {
      response: {
        200: jsonSchema(healthResponseSchema, 'HealthResponse'),
        503: jsonSchema(healthResponseSchema, 'HealthResponse'),
      },
    },
  }, async (_request, reply) => {
    // J1D-CAT-05: only commercial-truth dependencies gate readiness. An
    // unavailable optional capability (relationships, semantics) is reported
    // as `degraded` with HTTP 200, so the commercial API stays in rotation.
    const checks = await deps.readyCheck();
    if (checks.database !== 'ok' || checks.redis === 'unavailable') {
      return reply.code(503).send({ status: 'unavailable', checks });
    }
    const optional = checks.capabilities
      ? [checks.capabilities.relationships, checks.capabilities.productSemantics, checks.capabilities.trainingSemantics]
      : [checks.relationshipSnapshot];
    return reply.send({ status: optional.includes('unavailable') || (checks.projection !== undefined && checks.projection.readiness.projectionRuntime !== 'READY') ? 'degraded' : 'ok', checks });
  });

  app.get('/health/projections', async (_request, reply) => reply.send(deps.projectionRuntimeManager?.status() ?? { reloadState: 'NOT_WIRED' }));

  app.get('/health/catalog-authority', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!deps.catalogAuthoritySnapshot) {
      return reply.code(503).send({ schemaVersion: 1, status: 'UNAVAILABLE', reason: 'authority_snapshot_not_wired' });
    }
    return reply.send(await deps.catalogAuthoritySnapshot());
  });

  app.addHook('onRequest', async () => { deps.projectionRuntimeManager?.captureRequest(); });

  app.addHook('preHandler', async (request) => {
    const path = request.routeOptions.url ?? '';
    if (path.startsWith('/health') || path.startsWith('/docs') || path === '/openapi.json') {
      return;
    }
    if (path === '/metrics' && config.observability.enableMetrics && !config.observability.metricsRequireApiKey) {
      return;
    }
    const apiKey = request.headers['x-api-key'];
    if (typeof apiKey !== 'string' || !isApiKeyAuthorized(apiKey, config.apiKeys)) {
      throw new UnauthorizedError();
    }
  });

  if (config.observability.enableMetrics) {
    app.get('/metrics', async (_request, reply) => {
      reply.type('text/plain; version=0.0.4');
      return reply.send(await metricsText());
    });
  }

  app.get('/v1/products/search', {
    schema: {
      security: [{ apiKeyAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', minLength: 2, maxLength: 120 },
          limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
          includeOutOfStock: { type: 'boolean', default: false },
        },
        required: ['q'],
        additionalProperties: false,
      },
      response: {
        200: jsonSchema(searchResponseSchema, 'SearchResponse'),
        400: jsonSchema(errorResponseSchema, 'ErrorResponse'),
        401: jsonSchema(errorResponseSchema, 'ErrorResponse'),
      },
    },
  }, async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new InvalidInputError('Invalid search parameters', parsed.error.flatten());
    }

    const result = await deps.service.searchProducts(
      parsed.data.q,
      parsed.data.limit,
      parsed.data.includeOutOfStock,
    );

    return reply.send(result);
  });

  app.get('/v1/products/:productId', {
    schema: {
      security: [{ apiKeyAuth: [] }],
      params: {
        type: 'object',
        properties: {
          productId: { type: 'integer', minimum: 1 },
        },
        required: ['productId'],
        additionalProperties: false,
      },
      querystring: {
        type: 'object',
        properties: {
          combinationId: { type: 'integer', minimum: 0, default: 0 },
          quantity: { type: 'integer', minimum: 1, maximum: 999, default: 1 },
          customerId: { type: 'integer', minimum: 0, default: 0 },
          customerGroupId: { type: 'integer', minimum: 0, default: 0 },
          currencyId: { type: 'integer', minimum: 0, default: 1 },
          countryId: { type: 'integer', minimum: 0, default: 0 },
        },
        required: [],
        additionalProperties: false,
      },
      response: {
        200: jsonSchema(productResponseSchema, 'ProductResponse'),
        400: jsonSchema(errorResponseSchema, 'ErrorResponse'),
        401: jsonSchema(errorResponseSchema, 'ErrorResponse'),
        404: jsonSchema(errorResponseSchema, 'ErrorResponse'),
      },
    },
  }, async (request, reply) => {
    const params = productParamsSchema.safeParse(request.params);
    const query = productQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      throw new InvalidInputError('Invalid product request', {
        params: params.success ? null : params.error.flatten(),
        query: query.success ? null : query.error.flatten(),
      });
    }

    const context = readCommercialContext(request);
    const product = await deps.service.getProduct({
      productId: params.data.productId,
      combinationId: query.data.combinationId,
      quantity: query.data.quantity,
      customerId: context.customerId,
      customerGroupId: context.customerGroupId,
      currencyId: context.currencyId,
      countryId: context.countryId,
    });

    return reply.send(product);
  });

  app.post('/v1/products/batch', {
    schema: {
      security: [{ apiKeyAuth: [] }],
      body: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            maxItems: 20,
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                productId: { type: 'integer', minimum: 1 },
                combinationId: { type: 'integer', minimum: 0, default: 0 },
                quantity: { type: 'integer', minimum: 1, maximum: 999, default: 1 },
              },
              required: ['productId'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
      response: {
        200: jsonSchema(batchResponseSchema, 'BatchResponse'),
        400: jsonSchema(errorResponseSchema, 'ErrorResponse'),
        401: jsonSchema(errorResponseSchema, 'ErrorResponse'),
      },
    },
  }, async (request, reply) => {
    const parsed = batchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new InvalidInputError('Invalid batch request', parsed.error.flatten());
    }

    const context = readCommercialContext(request);
    const result = await deps.service.batchGetProducts(
      parsed.data.items as BatchGetInput[],
      request.id,
      context,
    );

    return reply.send(result);
  });

  await registerResolveProductIntentRoute(app as unknown as FastifyInstance, deps.productIntentResolutionService);
  await registerSearchProductsV2Route(app as unknown as FastifyInstance, deps.searchProductsV2Service);
  await registerExploreProductsRoute(app as unknown as FastifyInstance, deps.exploreProductsService);
  await registerGetProductSemanticsRoute(app as unknown as FastifyInstance, deps.productSemanticSnapshotReader);
  await registerGetProductSemanticsBatchRoute(app as unknown as FastifyInstance, deps.productSemanticSnapshotReader);
  await registerGetProductSemanticsRegistryRoute(app as unknown as FastifyInstance, deps.productSemanticsRegistryService);
  await registerGetTrainingSemanticProductRoute(app as unknown as FastifyInstance, deps.trainingSemanticReadService);
  await registerGetTrainingSemanticBatchRoute(app as unknown as FastifyInstance, deps.trainingSemanticReadService);
  await registerGetTrainingSemanticRegistryRoute(app as unknown as FastifyInstance, deps.trainingSemanticReadService);
  await registerQueryTrainingSemanticsRoute(app as unknown as FastifyInstance, deps.trainingSemanticQueryService);
  await registerSemanticDiscoveryQueryRoute(app as unknown as FastifyInstance, deps.semanticDiscoveryService);
  await registerCatalogV2Routes(app as unknown as FastifyInstance, deps.catalogContractService);

  return app as unknown as FastifyInstance;
}
