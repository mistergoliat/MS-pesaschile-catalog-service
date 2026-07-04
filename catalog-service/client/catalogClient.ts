import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import {
  batchResponseSchema,
  errorResponseSchema,
  productResponseSchema,
  searchResponseSchema,
} from '../src/shared/contracts.js';
import type {
  BatchGetProductsResult,
  CatalogToolInput,
  GetProductResult,
  SearchProductsResult,
} from './types.js';

export type CatalogClientContext = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  correlationId?: string;
  customerId?: number;
  customerGroupId?: number;
  currencyId?: number;
  countryId?: number;
};

export class CatalogClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly correlationId?: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'CatalogClientError';
  }
}

function normalizeTransportError(error: unknown, context: CatalogClientContext): CatalogClientError {
  if (error instanceof CatalogClientError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new CatalogClientError('Request timed out', 408, 'TIMEOUT', context.correlationId, false);
  }
  return new CatalogClientError('Network error', 503, 'NETWORK_ERROR', context.correlationId, false);
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

function attachContextHeaders(headers: HeadersInit, context: CatalogClientContext): HeadersInit {
  const normalized = new Headers(headers);
  normalized.set('x-api-key', context.apiKey);
  normalized.set('x-correlation-id', context.correlationId ?? randomUUID());
  if (context.customerId !== undefined) {
    normalized.set('x-customer-id', String(context.customerId));
  }
  if (context.customerGroupId !== undefined) {
    normalized.set('x-customer-group-id', String(context.customerGroupId));
  }
  if (context.currencyId !== undefined) {
    normalized.set('x-currency-id', String(context.currencyId));
  }
  if (context.countryId !== undefined) {
    normalized.set('x-country-id', String(context.countryId));
  }
  return normalized;
}

async function fetchOnce(
  context: CatalogClientContext,
  input: string,
  init: RequestInit,
): Promise<Response> {
  const timeoutMs = context.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: attachContextHeaders(init.headers ?? {}, context),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson<T>(
  context: CatalogClientContext,
  input: string,
  init: RequestInit,
  validator: ZodType<T>,
  retryable: boolean,
): Promise<T> {
  const attempt = async (): Promise<T> => {
    const response = await fetchOnce(context, input, init);
    const correlationId = response.headers.get('x-correlation-id') ?? context.correlationId;
    const bodyText = await response.text();
    let payload: unknown = null;
    if (bodyText) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        throw new CatalogClientError('Invalid JSON response', response.status, 'INVALID_RESPONSE', correlationId);
      }
    }

    if (!response.ok) {
      const parsed = errorResponseSchema.safeParse(payload);
      const error = parsed.success
        ? parsed.data.error
        : { code: 'CATALOG_QUERY_FAILED', message: `HTTP ${response.status}`, correlationId: correlationId ?? '' };
      throw new CatalogClientError(
        error.message,
        response.status,
        error.code,
        error.correlationId || correlationId || undefined,
        response.status >= 500,
      );
    }

    return validator.parse(payload);
  };

  try {
    return await attempt();
  } catch (error) {
    if (retryable) {
      if (error instanceof CatalogClientError) {
        if (error.statusCode >= 500 && error.statusCode < 600) {
          try {
            return await attempt();
          } catch (retryError) {
            throw normalizeTransportError(retryError, context);
          }
        }
      } else if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TypeError')
      ) {
        try {
          return await attempt();
        } catch (retryError) {
          throw normalizeTransportError(retryError, context);
        }
      }
    }
    throw normalizeTransportError(error, context);
  }
}

export async function searchProducts(
  input: { query: string; limit?: number; includeOutOfStock?: boolean },
  context: CatalogClientContext,
): Promise<SearchProductsResult> {
  const url = new URL(buildUrl(context.baseUrl, '/v1/products/search'));
  url.searchParams.set('q', input.query);
  if (input.limit !== undefined) url.searchParams.set('limit', String(input.limit));
  if (input.includeOutOfStock !== undefined) {
    url.searchParams.set('includeOutOfStock', String(input.includeOutOfStock));
  }

  return requestJson(context, url.toString(), { method: 'GET' }, searchResponseSchema, true);
}

export async function getProduct(
  input: { productId: number; combinationId?: number; quantity?: number },
  context: CatalogClientContext,
): Promise<GetProductResult> {
  const url = new URL(buildUrl(context.baseUrl, `/v1/products/${input.productId}`));
  if (input.combinationId !== undefined) url.searchParams.set('combinationId', String(input.combinationId));
  if (input.quantity !== undefined) url.searchParams.set('quantity', String(input.quantity));

  return requestJson(context, url.toString(), { method: 'GET' }, productResponseSchema, true);
}

export async function batchGetProducts(
  input: { items: Array<{ productId: number; combinationId?: number; quantity?: number }> },
  context: CatalogClientContext,
): Promise<BatchGetProductsResult> {
  return requestJson(
    context,
    buildUrl(context.baseUrl, '/v1/products/batch'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: input.items.map((item) => ({
          productId: item.productId,
          combinationId: item.combinationId ?? 0,
          quantity: item.quantity ?? 1,
        })),
      }),
    },
    batchResponseSchema,
    true,
  ) as Promise<BatchGetProductsResult>;
}

export async function executeCatalogTool(
  input: CatalogToolInput,
  context: CatalogClientContext,
): Promise<SearchProductsResult | GetProductResult | BatchGetProductsResult> {
  switch (input.operation) {
    case 'search':
      return searchProducts(
        { query: input.query, limit: input.limit, includeOutOfStock: input.includeOutOfStock },
        context,
      );
    case 'get_product':
      return getProduct(
        { productId: input.productId, combinationId: input.combinationId, quantity: input.quantity },
        context,
      );
    case 'batch_get':
      return batchGetProducts({ items: input.items }, context);
  }
}
