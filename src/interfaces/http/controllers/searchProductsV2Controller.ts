import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  SearchProductsV2Request,
  SearchProductsV2Service,
} from '../../../application/recommendation/search-products-v2/index.js';
import { SearchProductsV2Error } from '../../../application/recommendation/search-products-v2/index.js';

export type SearchProductsV2ControllerDependencies = {
  readonly service?: SearchProductsV2Service;
};

export type SearchProductsV2HttpError = {
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
      throw new SearchProductsV2Error('INVALID_REQUEST', 'Invalid correlation id header', {
        stage: 'request',
      });
    }
    return header;
  }
  const body = request.body as Partial<SearchProductsV2Request> | undefined;
  if (typeof body?.correlationId === 'string' && body.correlationId.trim().length > 0) {
    if (!isValidCorrelationId(body.correlationId)) {
      throw new SearchProductsV2Error('INVALID_REQUEST', 'Invalid correlation id body value', {
        stage: 'request',
      });
    }
    return body.correlationId;
  }
  return request.id;
}

export function mapSearchProductsV2ErrorToHttp(error: unknown, correlationId: string): SearchProductsV2HttpError {
  if (error instanceof SearchProductsV2Error) {
    const statusCode = error.code === 'INVALID_REQUEST'
      ? 400
      : error.code === 'CUSTOMER_MISMATCH'
        ? 409
        : error.code === 'COMMERCIAL_RECOMMENDATION_UNAVAILABLE'
          ? 503
          : error.code === 'INTERNAL_CONFIGURATION_ERROR'
            ? 500
            : 422;
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

export function createSearchProductsV2Controller(dependencies: SearchProductsV2ControllerDependencies) {
  return async function searchProductsV2Controller(request: FastifyRequest, reply: FastifyReply) {
    let correlationId = request.id;
    try {
      correlationId = resolveCorrelationId(request);
      const validationError = (request as FastifyRequest & { validationError?: unknown }).validationError;
      if (validationError !== undefined) {
        throw new SearchProductsV2Error('INVALID_REQUEST', 'Invalid SearchProducts V2 request', {
          stage: 'request',
        });
      }
      if (!dependencies.service) {
        throw new SearchProductsV2Error('COMMERCIAL_RECOMMENDATION_UNAVAILABLE', 'SearchProducts V2 is not configured', {
          stage: 'commercial',
          retryable: true,
        });
      }
      const body = request.body as SearchProductsV2Request;
      const result = await dependencies.service.search({
        ...body,
        correlationId,
      });
      reply.header('x-correlation-id', result.execution.correlationId);
      reply.type('application/json');
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = mapSearchProductsV2ErrorToHttp(error, correlationId);
      reply.header('x-correlation-id', correlationId);
      reply.type('application/json');
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
  };
}
