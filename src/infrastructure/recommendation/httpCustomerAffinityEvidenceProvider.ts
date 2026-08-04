import { createProductRuntimeIdentity } from '../../domain/recommendation/relationship-engine/runtime/index.js';
import type { ProductRelationshipProductReference } from '../../domain/recommendation/relationship-engine/contracts.js';
import type {
  CustomerAffinityContext,
  CustomerAffinityCustomerReference,
  CustomerAffinityEvidenceProvider,
  CustomerAffinityEvidenceResult,
  CustomerProductEvidence,
} from '../../domain/recommendation/customer-affinity/index.js';
import {
  purchasedProductsAvailableResponseSchema,
  purchasedProductsCustomerNotFoundResponseSchema,
  purchasedProductsCustomerNotLinkedResponseSchema,
  purchasedProductsDegradedResponseSchema,
  type PurchasedProductRow,
} from './customerProfilePurchasedProductsSchemas.js';

// CP-R1-T10B4B: real CustomerAffinityEvidenceProvider backed by Customer Profile's
// `GET /v1/customers/:masterCustomerId/purchased-products`. In this mode, `customer.customerId` (the neutral T09
// contract field) is interpreted specifically as Customer Profile's `masterCustomerId` — never a PrestaShop
// `id_customer`, email, phone, or DNI. That interpretation is local to this adapter; T09's own
// `CustomerAffinityCustomerReference` contract is unchanged and stays opaque to every other provider.

const PAGE_LIMIT = 100;
// Guards against a runaway/misbehaving upstream (stuck hasMore=true, or a genuinely enormous history), not
// against real candidate volume (T11 caps candidates at 60 well before this adapter is ever called).
const MAX_PAGES = 200;
const MAX_TOTAL_HISTORICAL_ROWS = 20_000;

const MASTER_CUSTOMER_ID_PATTERN = /^[0-9]+$/;
const MASTER_CUSTOMER_ID_MAX_LENGTH = 20;

export type HttpCustomerAffinityEvidenceProviderFailureReason =
  | 'invalid_customer_identity'
  | 'network_error'
  | 'timeout'
  | 'auth_or_config_error'
  | 'bad_request'
  | 'prestashop_unavailable'
  | 'prestashop_timeout'
  | 'unexpected_http_status'
  | 'invalid_response_body'
  | 'invalid_response_schema'
  | 'pagination_inconsistent'
  | 'pagination_limit_exceeded'
  | 'duplicate_identity';

export class HttpCustomerAffinityEvidenceProviderError extends Error {
  readonly reason: HttpCustomerAffinityEvidenceProviderFailureReason;

  readonly httpStatus?: number;

  constructor(
    reason: HttpCustomerAffinityEvidenceProviderFailureReason,
    message: string,
    options?: { httpStatus?: number; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HttpCustomerAffinityEvidenceProviderError';
    this.reason = reason;
    this.httpStatus = options?.httpStatus;
  }
}

export type HttpCustomerAffinityEvidenceProviderLogger = {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
};

export type HttpCustomerAffinityEvidenceProviderDependencies = {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: HttpCustomerAffinityEvidenceProviderLogger;
};

type AvailablePage = {
  readonly kind: 'available';
  readonly products: readonly PurchasedProductRow[];
  readonly hasMore: boolean;
};
type NotFoundPage = { readonly kind: 'customer_not_found' };
type NotLinkedPage = { readonly kind: 'customer_not_linked' };
type Page = AvailablePage | NotFoundPage | NotLinkedPage;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export class HttpCustomerAffinityEvidenceProvider implements CustomerAffinityEvidenceProvider {
  private readonly baseUrl: string;

  private readonly timeoutMs: number;

  private readonly fetchImpl: typeof fetch;

  private readonly logger?: HttpCustomerAffinityEvidenceProviderLogger;

  constructor(deps: HttpCustomerAffinityEvidenceProviderDependencies) {
    this.baseUrl = deps.baseUrl;
    this.timeoutMs = deps.timeoutMs;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.logger = deps.logger;
  }

  async getEvidence(
    customer: CustomerAffinityCustomerReference,
    products: readonly ProductRelationshipProductReference[],
    _context?: CustomerAffinityContext,
  ): Promise<CustomerAffinityEvidenceResult> {
    if (products.length === 0) {
      return { customer, productEvidence: [], warnings: [] };
    }

    const masterCustomerId = toMasterCustomerId(customer.customerId);
    const candidatesByIdentity = new Map<string, ProductRelationshipProductReference>(
      products.map((product) => [createProductRuntimeIdentity(product), product]),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    let pagesFetched = 0;

    try {
      const rowsByIdentity = new Map<string, PurchasedProductRow>();
      let offset = 0;
      let isFirstPage = true;

      while (true) {
        pagesFetched += 1;
        if (pagesFetched > MAX_PAGES) {
          throw new HttpCustomerAffinityEvidenceProviderError(
            'pagination_limit_exceeded',
            'Customer Profile pagination exceeded the maximum allowed number of pages',
          );
        }

        const page = await this.fetchPage(masterCustomerId, offset, controller.signal);

        if (isFirstPage && page.kind === 'customer_not_found') {
          this.logSuccess('customer_not_found', { durationMs: Date.now() - startedAt, pages: pagesFetched });
          return { customer, productEvidence: [], warnings: [{ code: 'customer_reference_not_found' }] };
        }
        if (isFirstPage && page.kind === 'customer_not_linked') {
          this.logSuccess('customer_not_linked', { durationMs: Date.now() - startedAt, pages: pagesFetched });
          return { customer, productEvidence: [], warnings: [{ code: 'customer_history_not_linked' }] };
        }
        if (page.kind !== 'available') {
          throw new HttpCustomerAffinityEvidenceProviderError(
            'pagination_inconsistent',
            'Customer Profile changed customer history availability status mid-pagination',
          );
        }

        isFirstPage = false;

        for (const row of page.products) {
          const identity = createProductRuntimeIdentity(
            row.productAttributeId > 0
              ? { productId: String(row.productId), combinationId: String(row.productAttributeId) }
              : { productId: String(row.productId) },
          );
          if (rowsByIdentity.has(identity)) {
            throw new HttpCustomerAffinityEvidenceProviderError(
              'duplicate_identity',
              'Customer Profile returned the same product/variant identity more than once across pages',
            );
          }
          rowsByIdentity.set(identity, row);
          if (rowsByIdentity.size > MAX_TOTAL_HISTORICAL_ROWS) {
            throw new HttpCustomerAffinityEvidenceProviderError(
              'pagination_limit_exceeded',
              'Customer Profile returned more historical rows than the configured guard allows',
            );
          }
        }

        if (!page.hasMore) {
          break;
        }
        offset += PAGE_LIMIT;
      }

      const productEvidence: CustomerProductEvidence[] = [];
      for (const [identity, row] of rowsByIdentity) {
        const candidate = candidatesByIdentity.get(identity);
        if (!candidate) {
          continue;
        }
        productEvidence.push({
          product: candidate,
          ownership: {
            previouslyPurchased: true,
            exactVariantPreviouslyPurchased: candidate.combinationId !== undefined,
            totalOrderCount: row.orderCount,
            firstPurchasedAt: row.firstPurchasedAt,
            lastPurchasedAt: row.lastPurchasedAt,
          },
        });
      }

      this.logSuccess('available', {
        durationMs: Date.now() - startedAt,
        pages: pagesFetched,
        historicalProducts: rowsByIdentity.size,
        matches: productEvidence.length,
      });
      return { customer, productEvidence, warnings: [] };
    } catch (error) {
      this.logFailure(error, { durationMs: Date.now() - startedAt, pages: pagesFetched });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPageUrl(masterCustomerId: string, offset: number): URL {
    const url = new URL(this.baseUrl);
    const trimmedPath = url.pathname.replace(/\/+$/, '');
    url.pathname = `${trimmedPath}/v1/customers/${encodeURIComponent(masterCustomerId)}/purchased-products`;
    url.search = '';
    url.hash = '';
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));
    return url;
  }

  private async fetchPage(masterCustomerId: string, offset: number, signal: AbortSignal): Promise<Page> {
    const url = this.buildPageUrl(masterCustomerId, offset);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new HttpCustomerAffinityEvidenceProviderError('timeout', 'Customer Profile request timed out', {
          cause: error,
        });
      }
      throw new HttpCustomerAffinityEvidenceProviderError('network_error', 'Customer Profile request failed', {
        cause: error,
      });
    }

    if (response.status === 200) {
      return this.parseAvailablePage(response, offset);
    }
    if (response.status === 404) {
      return this.parseNotFoundOrNotLinkedPage(response);
    }
    if (response.status === 503) {
      return this.parseDegradedPage(response);
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpCustomerAffinityEvidenceProviderError(
        'auth_or_config_error',
        'Customer Profile rejected the request as unauthorized',
        { httpStatus: response.status },
      );
    }
    if (response.status === 400) {
      throw new HttpCustomerAffinityEvidenceProviderError(
        'bad_request',
        'Customer Profile rejected the request as malformed',
        { httpStatus: response.status },
      );
    }
    throw new HttpCustomerAffinityEvidenceProviderError(
      'unexpected_http_status',
      'Customer Profile returned an unexpected HTTP status',
      { httpStatus: response.status },
    );
  }

  private async readJsonBody(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      // The shared AbortController's signal is attached to the fetch() call that produced this Response, so
      // aborting it while the body is still streaming rejects response.json() with an AbortError too — this is
      // not a malformed payload, it is the total timeout firing mid-parse, and must be classified as such.
      if (isAbortError(error)) {
        throw new HttpCustomerAffinityEvidenceProviderError('timeout', 'Customer Profile request timed out', {
          cause: error,
        });
      }
      throw new HttpCustomerAffinityEvidenceProviderError(
        'invalid_response_body',
        'Customer Profile returned a non-JSON body',
        { httpStatus: response.status, cause: error },
      );
    }
  }

  private async parseAvailablePage(response: Response, requestedOffset: number): Promise<AvailablePage> {
    const body = await this.readJsonBody(response);
    const parsed = purchasedProductsAvailableResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpCustomerAffinityEvidenceProviderError(
        'invalid_response_schema',
        'Customer Profile available response failed schema validation',
        { httpStatus: response.status },
      );
    }
    if (parsed.data.pagination.offset !== requestedOffset) {
      throw new HttpCustomerAffinityEvidenceProviderError(
        'pagination_inconsistent',
        'Customer Profile pagination offset does not match the requested offset',
        { httpStatus: response.status },
      );
    }
    if (parsed.data.pagination.limit !== PAGE_LIMIT) {
      throw new HttpCustomerAffinityEvidenceProviderError(
        'pagination_inconsistent',
        'Customer Profile pagination limit does not match the requested limit',
        { httpStatus: response.status },
      );
    }
    // hasMore=true asserts "there is at least one more row past this page" — the real reader can only make that
    // claim by fetching limit+1 rows, which means a page reporting hasMore=true always returns exactly `limit`
    // rows. A page that claims more data exists while returning fewer rows than its own limit is inconsistent:
    // accepting it would silently skip the unread rows in between once offset advances by PAGE_LIMIT.
    if (parsed.data.pagination.hasMore && parsed.data.pagination.returned !== PAGE_LIMIT) {
      throw new HttpCustomerAffinityEvidenceProviderError(
        'pagination_inconsistent',
        'Customer Profile reported hasMore=true for an incomplete page',
        { httpStatus: response.status },
      );
    }
    return { kind: 'available', products: parsed.data.products, hasMore: parsed.data.pagination.hasMore };
  }

  private async parseNotFoundOrNotLinkedPage(response: Response): Promise<NotFoundPage | NotLinkedPage> {
    const body = await this.readJsonBody(response);
    const notFound = purchasedProductsCustomerNotFoundResponseSchema.safeParse(body);
    if (notFound.success) {
      return { kind: 'customer_not_found' };
    }
    const notLinked = purchasedProductsCustomerNotLinkedResponseSchema.safeParse(body);
    if (notLinked.success) {
      return { kind: 'customer_not_linked' };
    }
    throw new HttpCustomerAffinityEvidenceProviderError(
      'invalid_response_schema',
      'Customer Profile 404 response failed schema validation',
      { httpStatus: response.status },
    );
  }

  private async parseDegradedPage(response: Response): Promise<never> {
    const body = await this.readJsonBody(response);
    const parsed = purchasedProductsDegradedResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpCustomerAffinityEvidenceProviderError(
        'invalid_response_schema',
        'Customer Profile degraded response failed schema validation',
        { httpStatus: response.status },
      );
    }
    if (parsed.data.reason === 'prestashop_unavailable') {
      throw new HttpCustomerAffinityEvidenceProviderError(
        'prestashop_unavailable',
        'Customer Profile reported PrestaShop as unavailable',
        { httpStatus: response.status },
      );
    }
    throw new HttpCustomerAffinityEvidenceProviderError(
      'prestashop_timeout',
      'Customer Profile reported a PrestaShop timeout',
      { httpStatus: response.status },
    );
  }

  private logSuccess(
    outcome: 'available' | 'customer_not_linked' | 'customer_not_found',
    fields: { durationMs: number; pages: number; historicalProducts?: number; matches?: number },
  ): void {
    this.logger?.info('customer_affinity_http_evidence_lookup', {
      outcome,
      durationMs: fields.durationMs,
      pages: fields.pages,
      historicalProducts: fields.historicalProducts ?? null,
      matches: fields.matches ?? null,
    });
  }

  private logFailure(error: unknown, fields: { durationMs: number; pages: number }): void {
    const reason = error instanceof HttpCustomerAffinityEvidenceProviderError ? error.reason : 'unexpected_error';
    const httpStatus = error instanceof HttpCustomerAffinityEvidenceProviderError ? (error.httpStatus ?? null) : null;
    this.logger?.error('customer_affinity_http_evidence_lookup_failed', {
      reason,
      httpStatus,
      durationMs: fields.durationMs,
      pages: fields.pages,
    });
  }
}

function toMasterCustomerId(customerId: string): string {
  const trimmed = customerId.trim();
  if (!MASTER_CUSTOMER_ID_PATTERN.test(trimmed)) {
    throw new HttpCustomerAffinityEvidenceProviderError(
      'invalid_customer_identity',
      'customerId is not a valid Customer Profile masterCustomerId for the http provider mode',
    );
  }
  if (trimmed.length > MASTER_CUSTOMER_ID_MAX_LENGTH) {
    throw new HttpCustomerAffinityEvidenceProviderError(
      'invalid_customer_identity',
      'customerId exceeds the maximum masterCustomerId length',
    );
  }
  // Rejects '0', '00', '000', ... (all numerically zero regardless of leading-zero padding). Does not reject
  // '001', '010', etc. — those are non-zero and preserved verbatim (never normalized to '1') since there is no
  // confirmed contract for how Customer Profile treats a zero-padded positive masterCustomerId.
  if (/^0+$/.test(trimmed)) {
    throw new HttpCustomerAffinityEvidenceProviderError(
      'invalid_customer_identity',
      'customerId must not be the sentinel value "0"',
    );
  }
  return trimmed;
}
