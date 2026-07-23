# SearchProducts V2

## Purpose

T11 orchestrates T08, T09, and T10. T11.3 adds product recommendation enrichment for human-readable and commercially usable responses.

T11.4 adds a shared Catalog Commercial Truth layer used by T11.3 and T12. Relationship evidence still comes from the snapshot; active status, orderability, final gross price, discounts, stock and display data come from the operational catalog through `CatalogCommercialTruthService`.

T11 does not calculate commercial relevance, customer affinity, or personalized ranking.

It exposes a single HTTP capability for internal consumers that need product recommendations composed from commercial candidates, optional customer affinity, and personalized ranking.

## Architectural Boundary

T08 remains the authority for commercial candidates and ranking inputs.

T09 remains the authority for customer affinity.

T10 remains the authority for personalized ranking and exclusions.

The active relationship snapshot remains the authority for relationship evidence: relationship type, `jointCount`, `support`, `confidence`, `lift`, `reliability`, model version, and snapshot id.

The operational catalog remains the authority for commercial product data: existence, active state, name, reference/SKU, price, currency, stock, availability, description, URL, image, and category when available.

T11 is an application and transport layer. It validates public input, resolves a correlation ID, executes the stages in order, enriches source and candidate products in batch, maps the output to a stable response, and maps errors to HTTP.

## Endpoint

```http
POST /api/v2/recommendations/search-products
```

The route is registered in the existing Fastify app and reuses the existing API key middleware, rate limit, correlation header handling, and OpenAPI plumbing.

## Request

T11.3 requires:

- `sourceProduct`: canonical product reference used to call T08, because T08 V1 is relationship-source based and does not consume free text directly.

Optional fields:

- `query`
- `customer`
- `context.customerId`
- `context.intent`
- `context.useCase`
- `context.budget`
- `context.preferredProducts`
- `context.excludedProducts`
- `filters.inStockOnly`
- `limit`
- `correlationId`

`query` is compatibility metadata. It does not resolve, replace, or modify `sourceProduct.productId`.

`filters.productIds` is rejected in V1 because T08 cannot apply it directly and T11 must not silently ignore unsupported filters.

Copyable Swagger request:

```json
{
  "sourceProduct": {
    "productId": "173"
  },
  "filters": {
    "inStockOnly": true
  },
  "limit": 5
}
```

## Correlation ID

Precedence:

1. `X-Correlation-Id` header.
2. `correlationId` in body.
3. generated request ID from HTTP infrastructure.

The resolved ID is passed to the application service and returned in the response body and header.

## Execution Flow

```text
validate request
resolve correlation ID
map to T08 request
execute T08 once
extract T08 candidates
execute T09 at most once
degrade retryable T09 failures when allowed
execute T10 once
enrich source and candidate products in one logical catalog batch
discard missing, inactive, and filtered products
recalculate final rank only
map public response
validate output
```

The order is always:

```text
T08 -> T09 -> T10
```

## Zero Candidates

If T08 returns zero candidates, T11 returns `200 OK` with empty `recommendations` and `excluded`, warning `NO_COMMERCIAL_CANDIDATES`, and does not call T09 or T10.

## T09 Degradation

A retryable technical failure in T09 may degrade to commercial ranking.

A structural T09 failure must not be hidden.

Retryable T09 failures create an explicit neutral affinity result inside T11:

- one affinity per T08 candidate;
- score `0`;
- confidence `none`;
- no signals;
- no evidence;
- no fake `NO_CUSTOMER_HISTORY`;
- public warning `CUSTOMER_AFFINITY_UNAVAILABLE`;
- `execution.degraded = true`;
- `customerAffinity` stage `degraded`.

## Non-Degradable Errors

T11 fails instead of hiding:

- invalid request;
- customer mismatch;
- invalid T08 result;
- duplicated T08 products;
- invalid T09 result;
- `INVALID_PROVIDER_RESPONSE`;
- invalid T10 result;
- unexpected non-retryable failures.

## Enrichment

T11.3 uses an injected `CatalogProductBatchReader`:

```ts
getProductsByReferences(references)
```

The reader must receive the source product and the candidate pool in one logical batch. T11.3 must not perform N+1 product lookups.

When the source product is missing or inactive, the endpoint fails explicitly:

- `SOURCE_PRODUCT_NOT_FOUND`
- `SOURCE_PRODUCT_INACTIVE`

When a recommended product is missing or inactive, it is excluded from recommendations and represented through exclusion statistics/warnings. T11.3 never returns a recommendation that only contains `productId`.

`filters.inStockOnly = true` excludes products whose enriched stock is `out_of_stock`, `unknown`, or `available = false`.

Missing prices are not invented. They are returned as `price: null` and summarized by one global warning.

Unknown stock is not invented. It is returned as `stock.status = "unknown"` and summarized by one global warning.

## Response

The public response contains:

- `query`
- enriched `sourceProduct`
- optional `customer`
- enriched recommendations
- exclusions
- personalization metadata
- snapshot metadata
- structured warnings
- statistics
- execution metadata

Recommendations expose:

- product identity and commercial summary;
- rank;
- personalized score;
- commercial score;
- affinity score;
- affinity confidence;
- relationship type, reliability, and co-occurrence evidence;
- deterministic commercial reason;
- structured reasons;
- public warnings.

T11.3 exposes relationship evidence from the snapshot. T11 does not expose raw customer evidence, provider payloads, SQL rows, catalog internals, or customer history.

## HTTP Error Mapping

- `400`: invalid request.
- `404`: source product not found.
- `409`: customer mismatch or inactive source product.
- `422`: invalid upstream/result contract.
- `503`: mandatory commercial recommendation knowledge is unavailable, for example because no active relationship snapshot is loaded.
- `500`: unexpected internal error.

Responses do not serialize `cause`, stack traces, SQL messages, provider payloads, or infrastructure internals.

## Warnings

Supported public warning codes:

- `NO_COMMERCIAL_CANDIDATES`
- `CUSTOMER_NOT_IDENTIFIED`
- `NO_CUSTOMER_HISTORY`
- `PARTIAL_CUSTOMER_HISTORY`
- `CUSTOMER_AFFINITY_UNAVAILABLE`
- `AFFINITY_MISSING_FOR_PRODUCT`
- `PERSONALIZATION_CONTEXT_PARTIALLY_APPLIED`
- `RESULTS_TRUNCATED`
- `CATALOG_PRODUCT_MISSING`
- `CATALOG_PRODUCT_INACTIVE`
- `CATALOG_PRICE_UNAVAILABLE`
- `CATALOG_STOCK_UNKNOWN`
- `UPSTREAM_COMMERCIAL_WARNING`
- `UPSTREAM_AFFINITY_WARNING`
- `UPSTREAM_PERSONALIZATION_WARNING`

Warnings are global and deduplicated. Absence of `customerId` is represented as:

```json
{
  "personalization": {
    "applied": false,
    "reason": "customer_not_provided"
  }
}
```

It must not create one `CUSTOMER_NOT_IDENTIFIED` warning per recommendation.

## Statistics

Statistics include:

- commercial candidates;
- affinity candidates;
- personalized recommendations;
- excluded recommendations;
- customer affinity calls;
- personalization calls;
- degraded stages;
- warnings generated.

Invariant:

```text
personalizedRecommendations + excludedRecommendations = commercialCandidates
```

`warningsGenerated` counts global warnings plus recommendation warnings exactly once.

## Determinism

T11 does not use implicit clocks, random values, UUIDs, direct T07 lookup, providers outside injected capabilities, SQL, Redis, CRM, Customer 360, PrestaShop, LLM, ML, or hidden retries.

The correlation ID does not affect scoring, ranking, exclusions, or warnings.

## Immutability

The application result is cloned and deeply frozen. T11 does not mutate requests or upstream T08, T09, or T10 results.

## Observability

An optional structured logger can receive:

- `search_products_v2_started`
- `commercial_recommendation_completed`
- `relationship_candidates_loaded`
- `source_product_lookup_started`
- `catalog_enrichment_requested`
- `catalog_products_resolved`
- `inactive_products_discarded`
- `missing_products_discarded`
- `out_of_stock_products_discarded`
- `customer_affinity_completed`
- `customer_affinity_degraded`
- `personalization_completed`
- `search_products_v2_completed`
- `search_products_v2_failed`

Logged fields are limited to correlation ID, stage, counts, degradation, and error classification. T11 does not log raw customer history.

## Security And Privacy

The endpoint reuses existing API key middleware. T11 does not resolve identity, create customers, store recommendations, persist conversations, expose raw history, generate sales copy, or mutate commerce state.

## V1 Limits

T11.3 does not implement Sales Agent integration, tool prompts, WhatsApp messages, carts, checkout, quotes, orders, opportunity writes, recommendation persistence, CRM, Customer 360, PrestaShop direct access, SQL, migrations, Redis, events, campaigns, promotions, ML, LLM, embeddings, or external E2E integration.

T12 - Product Intent Resolution is the next checkpoint:

```text
natural-language customer message
-> real catalog candidates
-> resolution or clarification
-> known productId
-> T11.3 enriched recommendations
```

T12 is explicitly out of scope for T11.3.
