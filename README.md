# Catalog Service

Read-only catalog and commercial recommendation microservice for Pesas Chile.

The service exposes product data sourced from PrestaShop and the Product Relationship Engine pipeline. It can serve active products, variants, prices, stock, product-product relationships, commercial recommendation candidates, customer affinity signals, personalized rankings, and the SearchProducts V2 HTTP capability.

This repository does not contain Sales Agent, cart, quote, checkout, order, CRM, Customer 360, LLM, or ML integrations.

## Main Capabilities

| Capability | Purpose |
| --- | --- |
| Catalog Search | Search active catalog products from the read-only catalog service. |
| Product Detail | Return product, variant, stock, commercial price data, and structured public link metadata. |
| Batch Product Lookup | Resolve multiple product references in one request. |
| Commercial Product Data | Apply configured shop, language, currency, country, and customer group context. |
| Product Relationship Engine | Build and publish product-product knowledge offline. |
| Commercial Recommendations | Convert published relationships into commercial candidates. |
| Customer Affinity | Evaluate explicit customer-product affinity evidence without deciding final recommendations. |
| Personalized Recommendations | Combine commercial candidates and affinity signals deterministically. |
| SearchProducts V2 | HTTP orchestration layer over T08, T09, and T10. |

## Architecture

```text
Operational source
-> T02 Normalizer
-> T03 Relationship Calculator
-> T04 Reliability Evaluator
-> T05 Validator
-> T06 Snapshot Publisher
-> T07 Runtime Reader
-> T08 Commercial Recommendation
-> T09 Customer Affinity
-> T10 Personalized Recommendation
-> T11 SearchProducts V2
```

Product relationships are calculated offline and published as versioned snapshots. Runtime readers do not recalculate relationships or metrics. T08 owns commercial recommendation candidates, T09 owns customer affinity, T10 owns personalized ranking and exclusions, and T11 only validates public input, orchestrates those layers, maps errors, and exposes HTTP.

## Endpoints

All non-health endpoints require `x-api-key`. Rate limiting is global and configured through environment variables.

| Method | Route | Purpose | Main Inputs | Conceptual Response |
| --- | --- | --- | --- | --- |
| `GET` | `/health/live` | Process liveness. | None. | `{ status: "ok", checks: {} }` |
| `GET` | `/health/ready` | Dependency readiness. | None. | `ok` or `degraded` with `database`, `redis` (when configured), and `relationshipSnapshot`. |
| `GET` | `/metrics` | Prometheus metrics. | API key unless disabled for metrics. | Prometheus text format. |
| `GET` | `/openapi.json` | OpenAPI document in non-production when docs are enabled. | None. | OpenAPI JSON. |
| `GET` | `/docs` | Swagger UI in non-production when docs are enabled. | None. | Interactive API documentation. |
| `GET` | `/v1/products/search` | Catalog product search. | `q`, optional `limit`, `includeOutOfStock`. | Matching catalog items. |
| `GET` | `/v1/products/:productId` | Product detail. | Product id plus optional combination, quantity, customer, group, currency, country context. | Product detail with price and stock. |
| `POST` | `/v1/products/batch` | Batch product lookup. | `items[]` with product id, optional combination and quantity. | Batch product details. |
| `POST` | `/api/v2/catalog/resolve-product-intent` | Resolve free text to a canonical catalog source product. | `query`, optional context and limit. | `resolved`, `clarification_required`, or `no_match`. |
| `POST` | `/api/v2/recommendations/search-products` | SearchProducts V2 orchestration. | `query`, `sourceProduct`, optional customer/context/filters/limit/correlation id. | Personalized recommendation response or mapped error. |

SearchProducts V2 requires `sourceProduct`. `query` is optional compatibility metadata: it can preserve the caller's commercial phrasing, but it never resolves or replaces `sourceProduct`. If the caller only has natural-language intent, call `POST /api/v2/catalog/resolve-product-intent` first to obtain the canonical source product and then call SearchProducts V2.

In the current composition root, `server.ts` injects SearchProducts V2 with T07, T08, T09, and T10 dependencies. The endpoint requires an active relationship snapshot loaded from `RELATIONSHIP_SNAPSHOT_DIR`; without one, readiness is degraded and valid recommendation requests return an operational `503` instead of a silent empty list.

## SearchProducts V2 Example

Request:

```http
POST /api/v2/recommendations/search-products
content-type: application/json
x-api-key: local-development-key
x-correlation-id: local-t11-smoke
```

```json
{
  "query": "productos complementarios para barra olimpica",
  "sourceProduct": {
    "productId": "123"
  },
  "customer": {
    "customerId": "customer-456"
  },
  "context": {
    "useCase": "home-gym",
    "budget": {
      "amount": 500000,
      "currency": "CLP"
    }
  },
  "filters": {
    "inStockOnly": true
  },
  "limit": 8
}
```

Reduced successful response shape:

```json
{
  "query": "productos complementarios para barra olimpica",
  "customer": {
    "customerId": "customer-456"
  },
  "recommendations": [
    {
      "product": {
        "productId": "456",
        "publicLink": {
          "canonicalUrl": "https://pesaschile.cl/categories/456-producto.html",
          "scope": "exact_product",
          "available": true,
          "requiresVariantSelection": false,
          "variantAttributeLabels": []
        }
      },
      "rank": 1,
      "score": 0.82,
      "commercialScore": 0.76,
      "affinityScore": 0.4,
      "affinityConfidence": "medium",
      "reasons": [
        {
          "code": "STRONG_COMMERCIAL_RELEVANCE",
          "source": "commercial"
        }
      ],
      "warnings": []
    }
  ],
  "excluded": [],
  "warnings": [],
  "statistics": {
    "commercialCandidates": 1,
    "affinityCandidates": 1,
    "personalizedRecommendations": 1,
    "excludedRecommendations": 0,
    "customerAffinityCalls": 1,
    "personalizationCalls": 1,
    "degradedStages": 0,
    "warningsGenerated": 0
  },
  "execution": {
    "correlationId": "local-t11-smoke",
    "degraded": false,
    "degradationReasons": [],
    "stages": {
      "commercialRecommendation": "completed",
      "customerAffinity": "completed",
      "personalization": "completed"
    }
  }
}
```

## Local Development

```bash
cp .env.example .env
npm ci
npm run typecheck
npm run lint
npm test
npm run dev
```

Production build/start validation:

```bash
npm run build
npm start
```

To exercise SearchProducts V2 locally, publish an active snapshot first:

```bash
npm run relationship:snapshot:build
npm run build
npm start
```

The runtime does not hot-reload snapshots. After publishing a new active snapshot, restart the process so T07 reloads `active.json`.

Available scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start `src/server.ts` with `tsx watch`. |
| `npm run build` | Compile TypeScript to `dist`. |
| `npm start` | Run the compiled server from `dist/src/server.js`. |
| `npm run typecheck` | Type-check without emitting files. |
| `npm run lint` | Run ESLint over TypeScript sources. |
| `npm test` | Run the Vitest suite. |
| `npm run test:integration` | Run integration tests. |
| `npm run smoke` | Exercise the live catalog client against a running service. |
| `npm run validate:prices` | Validate SQL price parity against configured cases. |

## Environment Variables

Use `.env.example` as the local template. Do not commit `.env` or real credentials.

| Variable | Required | Purpose | Safe Example |
| --- | --- | --- | --- |
| `NODE_ENV` | Optional | Runtime environment. | `development` |
| `HOST` | Optional | Host passed to Fastify listen. | `0.0.0.0` |
| `PORT` | Optional | HTTP port. | `4010` |
| `LOG_LEVEL` | Optional | Logger verbosity. | `info` |
| `API_KEY` | Required if `CATALOG_API_KEYS` absent | Single API key fallback. Ignored whenever `CATALOG_API_KEYS` is present and non-empty. | `replace-me` |
| `CATALOG_API_KEYS` | Required if `API_KEY` absent | Comma-separated API key allowlist. Takes precedence over `API_KEY`. An explicitly empty value still blocks fallback and causes startup failure. | `replace-me,rotate-me` |
| `CATALOG_PUBLIC_BASE_URL` | Optional | Public catalog base URL used to build product canonical links from `ps_product_lang.link_rewrite`; must be valid `http` or `https`. | `https://pesaschile.cl` |
| `PRESTASHOP_DB_PREFIX` | Optional | PrestaShop table prefix, strictly validated. | `ps_` |
| `PRESTASHOP_SHOP_ID` | Optional | Shop id; current service requires `1`. | `1` |
| `PRESTASHOP_LANG_ID` | Optional | Catalog language id. | `1` |
| `PRESTASHOP_CURRENCY_ID` | Optional | Currency id for price lookup. | `1` |
| `PRESTASHOP_CURRENCY_CODE` | Optional | Currency code exposed in responses. | `CLP` |
| `PRESTASHOP_COUNTRY_ID` | Optional | Country id for commercial context. | `0` |
| `PRESTASHOP_CUSTOMER_GROUP_ID` | Optional | Customer group id for commercial context. | `0` |
| `DB_HOST` | Required | Read-only PrestaShop database host. | `127.0.0.1` |
| `DB_PORT` | Optional | Database port. | `3306` |
| `DB_USER` | Required | Read-only database user. | `catalog_reader` |
| `DB_PASSWORD` | Required | Non-empty database password. Outer whitespace is trimmed during startup validation. | `replace-me` |
| `DB_NAME` | Required | Database name. | `prestashop` |
| `DB_CONNECTION_LIMIT` | Optional | MySQL pool size. | `10` |
| `DB_QUERY_TIMEOUT_MS` | Optional | Query timeout in milliseconds. | `3000` |
| `CACHE_DRIVER` | Optional | `memory` or `redis`. | `memory` |
| `REDIS_URL` | Required only with Redis cache | Redis connection URL. | empty |
| `SEARCH_CACHE_TTL_SECONDS` | Optional | Search cache TTL. | `300` |
| `PRODUCT_CACHE_TTL_SECONDS` | Optional | Product cache TTL. | `900` |
| `PRICE_CACHE_TTL_SECONDS` | Optional | Price cache TTL. | `60` |
| `STOCK_CACHE_TTL_SECONDS` | Optional | Stock cache TTL. | `15` |
| `BODY_LIMIT_BYTES` | Optional | HTTP body size limit. | `262144` |
| `RATE_LIMIT_MAX` | Optional | Max requests per rate window. | `120` |
| `RATE_LIMIT_TIME_WINDOW_MS` | Optional | Rate-limit window in milliseconds. | `60000` |
| `ENABLE_METRICS` | Optional | Register `/metrics` only when `true`. When `false`, the route does not exist and returns `404`. | `true` |
| `METRICS_REQUIRE_API_KEY` | Optional | Require API key on `/metrics` when metrics are enabled. | `true` |
| `TAX_RATE` | Optional | Tax rate for commercial price calculations. | `0.19` |
| `ENABLE_DOCS` | Optional | Enable OpenAPI and Swagger UI in non-production. | `true` |
| `RELATIONSHIP_SNAPSHOT_DIR` | Optional | Directory containing T06 snapshot files and the active snapshot pointer for T07 runtime loading. Prefer an absolute persistent path in production. | `data/relationship-snapshots` |
| `RELATIONSHIP_SOURCE_FROM_DATE` | Required for `relationship:snapshot:build` | Inclusive ISO-8601 lower bound for the offline relationship source query. | `2025-01-01T00:00:00.000Z` |
| `RELATIONSHIP_SOURCE_TO_DATE` | Optional | Inclusive ISO-8601 upper bound for the offline relationship source query. | empty |
| `RELATIONSHIP_SOURCE_ORDER_STATES` | Required for `relationship:snapshot:build` | Comma-separated PrestaShop order state ids accepted as completed source orders. | `2,3,4,5` |
| `RELATIONSHIP_SOURCE_EXCLUDED_PRODUCT_IDS` | Optional | Comma-separated administrative product ids excluded before normalization. | empty |
| `RELATIONSHIP_SOURCE_MAX_PRODUCTS_PER_ORDER` | Optional | Maximum distinct products allowed per order during normalization. | `50` |
| `CUSTOMER_AFFINITY_PROVIDER_MODE` | Optional | T09 evidence source mode: `unavailable` degrades retryably; `empty` returns neutral no-history evidence; `http` calls Customer Profile. | `unavailable` |
| `CUSTOMER_PROFILE_BASE_URL` | Required only when `CUSTOMER_AFFINITY_PROVIDER_MODE=http` | Absolute `http(s)` base URL for Customer Profile, without embedded credentials, query string, or fragment. | `http://customer-profile.internal:4020` |
| `CUSTOMER_PROFILE_TIMEOUT_MS` | Optional | Timeout for Customer Profile HTTP calls when mode=`http`. | `2500` |

Snapshots are stored outside Git under `data/relationship-snapshots` by default. Publish a T06 snapshot to the configured store before expecting SearchProducts V2 to return related products.

Operational notes:

- `/health/ready` checks MariaDB, Redis when `CACHE_DRIVER=redis`, and the loaded relationship snapshot state.
- `CATALOG_API_KEYS` takes precedence over `API_KEY`. If `CATALOG_API_KEYS=""`, startup fails instead of falling back.
- Incoming `x-api-key` values are compared byte-for-byte. Callers must send the exact configured key; outer whitespace is not trimmed from the request header.
- Customer Profile is a degradable T09 dependency. Its unavailability can degrade affinity, but it does not by itself turn SearchProducts V2 into a `503`.

## Security

- Protected routes require `x-api-key`; configured keys are trimmed once at startup, while incoming keys are compared byte-for-byte with a timing-safe helper.
- Fastify rate limiting is enabled globally.
- Request bodies, params, query strings, and recommendation contracts are validated with Zod or JSON Schema.
- Correlation IDs are accepted through `X-Correlation-Id` where supported and are returned to callers.
- Error responses avoid stack traces, SQL details, provider payloads, and internal causes.
- The service is read-only: it does not create carts, quotes, orders, customers, opportunities, or recommendation records.
- Payload size and recommendation limits are bounded.
- Relationship snapshot files and customer affinity sources are runtime dependencies; missing recommendation knowledge is reported explicitly.

## Testing

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run smoke
```

`npm run smoke` requires a running service, a valid local API key, and reachable dependencies for catalog endpoints. The full suite count should be taken from the latest local `npm test` run rather than assumed from this document.

## Current Status

| Task | Capability | Status |
| --- | --- | --- |
| T01B | Product Relationship Engine contracts | Implemented |
| T02 | Neutral Transaction Dataset Normalizer | Implemented |
| T03 | Same Order Relationship Calculator | Implemented |
| T04 | Relationship Reliability Evaluator | Implemented |
| T05 | Relationship Validator | Implemented |
| T06 | Versioned Relationship Snapshot Publisher | Implemented |
| T07 | Active Relationship Snapshot Runtime Reader | Implemented |
| T08 | Commercial Product Recommendation Service | Implemented |
| T09 | Customer Product Affinity Provider | Implemented |
| T10 | Personalized Recommendation Service | Implemented |
| T11 | SearchProducts V2 application and HTTP route | Implemented |

## Known Limits

- SearchProducts V2 requires `sourceProduct`; it does not infer source product identity from natural language.
- No Sales Agent integration is implemented in this repository.
- No public web integration is implemented in this repository.
- The service does not create carts, quotes, orders, checkouts, customers, or CRM records.
- The service does not query CRM or Customer 360 directly.
- Cart-level multi-product recommendation is not implemented.
- SearchProducts V2 still requires a caller-provided `sourceProduct`; Swagger does not infer it from free text.
- T09 currently supports neutral or retryable-unavailable affinity evidence modes; concrete CRM/Customer 360 evidence adapters are still outside this repository.
- Redis is optional and used only when `CACHE_DRIVER=redis`.
- Product public URLs point to the parent product page when combinations exist. Variant deep links, cart building and checkout remain outside this service.

## Additional Documentation

- [Product Relationship Engine contracts](docs/contracts/product-relationship-engine.md)
- [Neutral transaction normalization](docs/recommendation/product-relationship-transaction-normalization.md)
- [Same order relationship calculator](docs/recommendation/same-order-relationship-calculator.md)
- [Relationship reliability evaluator](docs/recommendation/relationship-reliability-evaluator.md)
- [Relationship validator](docs/recommendation/relationship-validator.md)
- [Versioned snapshot publisher](docs/recommendation/versioned-relationship-snapshot-publisher.md)
- [Active snapshot runtime reader](docs/recommendation/active-relationship-snapshot-runtime-reader.md)
- [Commercial product recommendation service](docs/recommendation/commercial-product-recommendation-service.md)
- [Customer product affinity provider](docs/recommendation/customer-product-affinity-provider.md)
- [Personalized recommendation service](docs/recommendation/personalized-recommendation-service.md)
- [SearchProducts V2](docs/recommendation/search-products-v2.md)
- [EC2 deployment runbook](docs/operations/catalog-service-ec2-deployment.md)
- [CAT-R1 runtime hardening release note](docs/releases/CAT-R1-runtime-hardening.md)
- [Manual index review](docs/index-recommendations.md)
