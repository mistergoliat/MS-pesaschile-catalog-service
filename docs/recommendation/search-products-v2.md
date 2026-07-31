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
- `context.explicitRepurchaseProducts` (CP-R1-T10B3C)
- `filters.inStockOnly`
- `limit`
- `correlationId`

`context.explicitRepurchaseProducts` must not contain a product/variant identity also present in
`context.excludedProducts` in the same request — that combination fails validation as `400 INVALID_REQUEST`
instead of being resolved silently (see "Explicit Repurchase").

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

CP-R1-T10B3C widened this from "retryable failures only" to **evidence-provider integration failures**: any
failure attributable to talking to the customer affinity evidence provider degrades, not just network/timeout
errors. A failure in Catalog Service's own T09 request construction still fails hard.

Degrades to commercial ranking:

- `EVIDENCE_PROVIDER_FAILED` (`retryable: true` always — network, timeout, connection failure);
- `INVALID_PROVIDER_RESPONSE` (structurally invalid provider response: customer mismatch reported by the
  provider, products outside the requested batch, duplicated product evidence, corrupt/unparseable payload).

`execution.degradationReasons` (this correction round) reports which of the two actually happened instead of a
single hardcoded value — it is resolved explicitly from the caught `CustomerAffinityError`, never inferred after
the fact from the `degraded: boolean` flag alone:

- `CUSTOMER_AFFINITY_RETRYABLE_FAILURE` — `EVIDENCE_PROVIDER_FAILED`. Transient integration failure (network,
  timeout, connection). Safe to retry the same request later; it may succeed once the provider recovers.
- `CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID` — `INVALID_PROVIDER_RESPONSE`. The provider answered, but its
  response is structurally wrong (customer mismatch, evidence outside the batch, duplicated evidence, corrupt
  payload). Retrying the identical request reproduces the same failure — **consumers must not auto-retry on
  this reason alone**; it signals a provider-side data problem worth investigating, not a transient condition.

Both reasons degrade identically otherwise: commercial ranking preserved, neutral affinity, `200 OK`.

Does not degrade (fails hard, `INVALID_AFFINITY_RESULT`):

- `INVALID_CUSTOMER_REFERENCE`, `INVALID_PRODUCT_REFERENCE`, `INVALID_PARAMETERS`, `INVALID_REQUEST` from T09 —
  these mean Catalog Service built an invalid request to its own T09 module, a bug worth failing loudly rather
  than masking;
- any error that is not a `CustomerAffinityError` at all.

A structural T09 failure of this second kind must not be hidden.

Degradation of either kind creates an explicit neutral affinity result inside T11:

- one affinity per T08 candidate;
- score `0`;
- confidence `none`;
- no signals;
- no evidence;
- no ownership;
- no fake `NO_CUSTOMER_HISTORY`;
- public warning `CUSTOMER_AFFINITY_UNAVAILABLE`;
- `execution.degraded = true`;
- `customerAffinity` stage `degraded`.

`cause` and the raw provider payload are never serialized into the response or the warning; only the internal
structured logger receives the error code, for observability.

## Non-Degradable Errors

T11 fails instead of hiding:

- invalid request (including the `explicitRepurchaseProducts`/`excludedProducts` conflict above);
- customer mismatch at the request boundary (`context.customerId` vs. `customer.customerId`) — `400`;
- an internal T10 dependency mismatch between its context customer and its affinity customer — `409`,
  `CUSTOMER_MISMATCH`. This is a defensive path: T11's own request validation already guarantees both values
  come from the same `request.customer`, so this is unreachable through a validated request today. It stays
  wired so the documented `409` mapping is never a promise the code cannot keep (see the CP-R1-T10B3A/B audits'
  finding that this was previously dead code).
- invalid T08 result;
- duplicated T08 products;
- invalid T09 request-construction errors (see above);
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

Each enriched product may include structured public URL metadata from `CatalogCommercialTruthService`:

```json
{
  "publicLink": {
    "canonicalUrl": "https://pesaschile.cl/categories/123-producto.html",
    "scope": "parent_product",
    "available": true,
    "requiresVariantSelection": true,
    "variantAttributeLabels": ["Talla", "Color"]
  }
}
```

`canonicalUrl` is built from `ps_product_lang.id_product` and `ps_product_lang.link_rewrite` using `CATALOG_PUBLIC_BASE_URL`. It is never generated from product name. If `link_rewrite` is absent, `canonicalUrl` is `null`, `available=false`, and `unavailableReason=missing_link_rewrite`.

`scope=parent_product` means the product has combinations and the URL points to the parent product page. T11 does not build variant deep links. The consumer should tell the customer to select the required variant attributes before adding the product to the cart.

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
- structured public product link metadata when available;
- rank;
- personalized score;
- commercial score;
- affinity score;
- affinity confidence;
- relationship type, reliability, and co-occurrence evidence;
- deterministic commercial reason;
- structured reasons;
- neutral ownership (CP-R1-T10B3C, optional — see "Ownership");
- public warnings, scoped to that recommendation's own product (CP-R1-T10B3C).

T11.3 exposes relationship evidence from the snapshot. T11 does not expose raw customer evidence, provider payloads, SQL rows, catalog internals, or customer history.

## Ownership

`recommendation.ownership?: { previouslyPurchased: boolean; exactVariantPreviouslyPurchased: boolean;
totalOrderCount?: number; firstPurchasedAt?: string; lastPurchasedAt?: string }` is a neutral pass-through of
T09's `ProductOwnershipEvidence` for that exact candidate, unchanged from T10's own result (see
`docs/recommendation/personalized-recommendation-service.md`). Only booleans, an aggregate order count, and
historical dates — never amounts, names, raw Customer Profile responses, `masterCustomerId`,
`prestashopCustomerId`, or any other identifier.

It appears **only** on the specific recommendation T09 provided ownership for:

- absent on `sourceProduct` (T09 is never asked about the source product, only about T08's candidates);
- absent on `excluded[]` entries (that schema has no `ownership` field, and exclusion happens independently of
  ownership — an excluded product's ownership, if any, is simply not surfaced, matching how excluded items
  already omit most detail);
- never folded into global `warnings[]`;
- never influences `commercialReason`, `score`, `rank`, or which `reasons` codes appear — those all come from
  T10's scoring, which never reads `ownership` as an input (see CP-R1-T10B3B/T10B3C).

Ownership does not define recommendation strategy. It is a structural fact for the caller (typically a Sales
Agent) to phrase correctly — "you already have this" versus a generic pitch — not a signal Catalog Service
turns into ranking on its own.

## Explicit Repurchase

`context.explicitRepurchaseProducts?: ProductReference[]` (CP-R1-T10B3C) represents the customer's **current**
stated intent to buy an exact product or variant again. It is mapped 1:1 to T10's
`context.explicitRepurchaseProductIds` (see `mapPersonalizationContext`) and produces a dedicated,
non-substitutable score contribution (`explicitRepurchaseBoost`, default `0.15`) and reason code
(`EXPLICIT_REPURCHASE_INTENT`), distinct from `preferredProducts` (`explicitPreferenceBoost`, `0.10`,
`EXPLICIT_CONTEXT_PREFERENCE`).

It is never derived by Catalog Service from `ownership`, legacy `directPurchases`, `REPEAT_PURCHASE_PATTERN`, or
`preferredProducts` — populating it is entirely the caller's responsibility, sourced from what the customer said
in the current conversation, not from history. Validated like `preferredProducts`/`excludedProducts`: optional,
deduplicated by exact runtime product identity, `.strict()` schema.

**Conflict with `excludedProducts`**: the same request must not contain the same product/variant identity in
both `context.excludedProducts` and `context.explicitRepurchaseProducts` — that fails validation as
`400 INVALID_REQUEST` rather than silently picking a winner. `excludedProducts` retains maximum precedence
where no conflict is declared; explicit repurchase intent can never revert an active exclusion by itself.

## Product And Variant Semantics

Both `ownership.exactVariantPreviouslyPurchased` and explicit repurchase matching use the same
`createProductRuntimeIdentity` function used everywhere else in this codebase (T07 through T11):
`productId::combinationId`, or `productId::<base>` when there is no combination. Concretely:

- repurchasing the base product (`{ productId }`, no `combinationId`) does not boost any of its variants;
- repurchasing one variant does not boost a different variant of the same base product;
- `ownership` for a variant candidate is only ever present when T09's evidence was matched to that exact
  variant identity — a base-product-level fact never leaks into a variant's `ownership`, and one variant's
  ownership never leaks into a different variant (see T09's batch-matching guarantees, unchanged by this task).

## HTTP Error Mapping

- `400`: invalid request, including request-boundary customer mismatch (`context.customerId` vs.
  `customer.customerId`) and the `explicitRepurchaseProducts`/`excludedProducts` conflict.
- `404`: source product not found.
- `409`: inactive source product, or an internal T10 dependency customer mismatch (`CUSTOMER_MISMATCH` — see
  "Non-Degradable Errors"; defensive, unreachable through a validated request today).
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

Global warnings are deduplicated by `(code, product identity or "global")`. CP-R1-T10B3C attaches the specific
product to `UPSTREAM_COMMERCIAL_WARNING` entries derived from T08 (e.g. `ALREADY_PURCHASED`, `LOW_STOCK`)
instead of collapsing every product's warning into one anonymous global entry — two different products with the
same warning code now produce two distinct global entries. The same warning is also mirrored into that specific
recommendation's own `warnings[]` (see "Response"), matching the schema's pre-existing invariant that
`statistics.warningsGenerated` counts global warnings plus recommendation warnings, not just global ones. A
commercial warning (including `ALREADY_PURCHASED`) never excludes a product and never becomes a boost — it is
informational only.

Absence of `customerId` is represented as:

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

## Explicitly Out Of Scope (CP-R1-T10B3C)

This task propagates ownership to the public response and adds explicit repurchase. It deliberately does not
implement:

- a Customer Profile HTTP evidence adapter or `CUSTOMER_AFFINITY_PROVIDER_MODE=http`;
- `masterCustomerId` resolution or any CRM Customer 360 client;
- an Agent Tool Loop or natural-language resolution of repurchase intent — `explicitRepurchaseProducts` must
  already be a resolved product/variant reference by the time it reaches this endpoint;
- RFM, clustering, or lifecycle segmentation (those consume full Customer Profile history; SearchProducts V2
  remains the recommendation engine, not a second one built from that history);
- durable-versus-consumable classification;
- cart, quote, checkout, or order mutation.

## Next Task

CP-R1-T10B4 — Customer Profile Evidence Adapter.
