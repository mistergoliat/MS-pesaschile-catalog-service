import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ProductIntentResolutionError,
  type ProductIntentResolutionService,
  type ResolveProductIntentRequest,
} from '../../../application/catalog/product-intent/index.js';
import {
  productIntentClarificationTotal,
  productIntentCandidatesRetrieved,
  productIntentNoMatchTotal,
  productIntentRequestsTotal,
  productIntentResolutionDuration,
  productIntentResolvedTotal,
} from '../../../shared/metrics.js';

export type ResolveProductIntentControllerDependencies = {
  readonly service?: ProductIntentResolutionService;
};

export type ResolveProductIntentHttpError = {
  readonly statusCode: number;
  readonly payload: {
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
      readonly correlationId: string;
    };
  };
};

function isValidCorrelationId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function resolveCorrelationId(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  if (typeof header === 'string') {
    if (!isValidCorrelationId(header)) {
      throw new ProductIntentResolutionError('INVALID_REQUEST', 'Invalid correlation id header', {
        stage: 'request',
      });
    }
    return header;
  }
  const body = request.body as Partial<ResolveProductIntentRequest> | undefined;
  if (typeof body?.correlationId === 'string' && body.correlationId.trim().length > 0) {
    if (!isValidCorrelationId(body.correlationId)) {
      throw new ProductIntentResolutionError('INVALID_REQUEST', 'Invalid correlation id body value', {
        stage: 'request',
      });
    }
    return body.correlationId;
  }
  return request.id;
}

export function mapProductIntentErrorToHttp(error: unknown, correlationId: string): ResolveProductIntentHttpError {
  if (error instanceof ProductIntentResolutionError) {
    const statusCode = error.code === 'INVALID_REQUEST'
      ? 400
      : error.code === 'INVALID_CATALOG_RESULT'
        ? 422
        : error.code === 'CATALOG_SEARCH_UNAVAILABLE'
          ? 503
          : 500;
    return {
      statusCode,
      payload: {
        error: {
          code: error.code,
          message: statusCode === 500 ? 'Internal server error' : error.message,
          retryable: error.retryable,
          correlationId,
        },
      },
    };
  }

  return {
    statusCode: 500,
    payload: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        retryable: false,
        correlationId,
      },
    },
  };
}

export function createResolveProductIntentController(dependencies: ResolveProductIntentControllerDependencies) {
  return async function resolveProductIntentController(request: FastifyRequest, reply: FastifyReply) {
    const endTimer = productIntentResolutionDuration.startTimer();
    let correlationId = request.id;
    try {
      productIntentRequestsTotal.inc();
      correlationId = resolveCorrelationId(request);
      const validationError = (request as FastifyRequest & { validationError?: unknown }).validationError;
      if (validationError !== undefined) {
        throw new ProductIntentResolutionError('INVALID_REQUEST', 'Invalid product intent request', {
          stage: 'request',
        });
      }
      if (!dependencies.service) {
        throw new ProductIntentResolutionError('CATALOG_SEARCH_UNAVAILABLE', 'Product intent resolution is not configured', {
          stage: 'search',
          retryable: true,
        });
      }
      const body = request.body as ResolveProductIntentRequest;
      const result = await dependencies.service.resolve({
        ...body,
        correlationId,
      });
      if (result.resolution.status === 'resolved') productIntentResolvedTotal.inc();
      if (result.resolution.status === 'clarification_required') productIntentClarificationTotal.inc();
      if (result.resolution.status === 'no_match') productIntentNoMatchTotal.inc();
      productIntentCandidatesRetrieved.observe(result.statistics.retrieved);
      reply.header('x-correlation-id', result.correlationId);
      reply.type('application/json');
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = mapProductIntentErrorToHttp(error, correlationId);
      reply.header('x-correlation-id', correlationId);
      reply.type('application/json');
      return reply.code(mapped.statusCode).send(mapped.payload);
    } finally {
      endTimer();
    }
  };
}
