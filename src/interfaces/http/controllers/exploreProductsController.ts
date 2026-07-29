import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../../shared/config.js';
import { readCommercialContext } from '../../../shared/requestContext.js';
import {
  defaultExploreCommercialContext,
  ExploreProductsError,
  type ExploreProductsService,
} from '../../../application/catalog/explore-products/index.js';

export type ExploreProductsControllerDependencies = {
  readonly service?: ExploreProductsService;
};

function errorPayload(error: ExploreProductsError, correlationId: string) {
  return {
    error: {
      code: error.code,
      message: error.statusCode === 500 ? 'Internal server error' : error.message,
      retryable: error.retryable,
      correlationId,
    },
  };
}

function mapUnknownError(error: unknown): ExploreProductsError {
  if (error instanceof ExploreProductsError) return error;
  return new ExploreProductsError('internal_error', 'Internal server error', 500);
}

export function createExploreProductsController(dependencies: ExploreProductsControllerDependencies) {
  return async function exploreProductsController(request: FastifyRequest, reply: FastifyReply) {
    const correlationId = request.id;
    try {
      if (!dependencies.service) {
        throw new ExploreProductsError('catalog_source_unavailable', 'Catalog source is unavailable', 503, true);
      }
      const context = readCommercialContext(request);
      const result = await dependencies.service.explore(request.body, defaultExploreCommercialContext({
        shopId: config.prestashop.shopId,
        currencyId: context.currencyId,
        currencyCode: config.prestashop.currencyCode,
        countryId: context.countryId,
        customerGroupId: context.customerGroupId,
        customerId: context.customerId,
        quantity: 1,
        taxRate: config.pricing.taxRate,
      }));
      reply.header('x-correlation-id', correlationId);
      reply.type('application/json');
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = mapUnknownError(error);
      reply.header('x-correlation-id', correlationId);
      reply.type('application/json');
      return reply.code(mapped.statusCode).send(errorPayload(mapped, correlationId));
    }
  };
}
