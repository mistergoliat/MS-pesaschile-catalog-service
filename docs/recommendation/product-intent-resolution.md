# T12 Product Intent Resolution

T12 resolves a bounded natural-language product intent into real catalog product candidates.

It exists because SearchProducts V2 recommendations require a known `sourceProduct.productId`, while customers normally describe products with phrases such as `barra para sentadillas`, `discos de goma 20 kg`, or `pesas rusas de 16 kg`.

T12 does not recommend related products. T12 does not execute T11.3. T12 does not converse. T12 does not use LLMs, embeddings, vectors, or generated commercial copy. T12 does not integrate the Sales Agent.

## Boundary

```text
customer phrase
  -> T12 Product Intent Resolution
  -> resolved sourceProduct | clarification_required | no_match
  -> caller may invoke T11.3 with sourceProduct
```

The catalog remains the authority for product existence, active status, name, reference, description, price, stock, and availability. Product relationship snapshots are not consulted by T12.

## Endpoint

```http
POST /api/v2/catalog/resolve-product-intent
```

Example:

```json
{
  "query": "barra olimpica 15 kg",
  "filters": {
    "inStockOnly": true
  },
  "limit": 5
}
```

The response always returns HTTP 200 for business outcomes:

```text
resolved
clarification_required
no_match
```

Invalid requests return 400. Invalid catalog/provider output returns 422. Catalog search/enrichment failures return 503.

## Output

When the top candidate is clear enough, T12 returns:

```json
{
  "resolution": {
    "status": "resolved",
    "confidence": 0.95,
    "sourceProduct": {
      "productId": "29"
    }
  }
}
```

`resolution.sourceProduct` is intentionally shaped so it can be copied into:

```http
POST /api/v2/recommendations/search-products
```

T12 does not perform that second call.

## Normalization

The normalizer preserves the original query and creates a deterministic search form:

- trim and collapse whitespace for comparison;
- lowercase;
- remove diacritics;
- tokenize;
- preserve meaningful units;
- normalize `20kg`, `20 kilos`, and `20 kilogramos` to `20 kg`;
- normalize `50mm` and `50 milimetros` to `50 mm`.

The original query is returned unchanged in `query.original`.

## Synonyms

Synonyms are centralized in `StaticProductSearchSynonymProvider`.

Initial V1 mappings include:

- `pesas rusas` -> `kettlebell`;
- `discos de goma` -> `discos bumper`, `discos rubber`;
- `barra para sentadilla` -> `barra olimpica`;
- `collarines` -> `cierres barra`, `seguros barra`;
- `maquina de cuadriceps` -> `extension de piernas`;
- `maquina femoral` -> `curl femoral`.

Synonyms expand retrieval terms. They do not force a resolution by themselves.

## Search And Enrichment

T12 uses a catalog searcher to retrieve an expanded pool before the public `limit`.

```text
public limit: 5
internal pool: max(limit * 4, 20), capped at 50
```

Then it enriches candidates through one logical batch call. Products missing from enrichment, inactive products, excluded product IDs, and products filtered by `inStockOnly` are not returned.

No N+1 enrichment is introduced by T12.

## Ranking

The ranker is deterministic and normalized between `0` and `1`.

Priority:

```text
exact reference
exact name
name token coverage
attribute/unit match
category match
synonym match
intended use match
description match
```

Reasons are structured:

```text
EXACT_REFERENCE_MATCH
EXACT_NAME_MATCH
NAME_TOKEN_MATCH
CATEGORY_MATCH
DESCRIPTION_MATCH
ATTRIBUTE_MATCH
INTENDED_USE_MATCH
SYNONYM_MATCH
```

Description matches have low weight so long descriptions cannot dominate product names.

## Resolution Policy

Default thresholds:

```text
resolved:
  topScore >= 0.82
  and top1-top2 gap >= 0.12

clarification_required:
  topScore >= 0.45
  and automatic resolution is not safe

no_match:
  no eligible candidates
  or topScore < 0.45
```

The policy is conservative: when candidates are plausible but close, T12 returns `clarification_required` instead of guessing.

## Clarification

Clarification is structured. T12 does not generate a conversational question.

Initial dimensions:

```text
product_type
weight
diameter
length
category
brand
variant
unspecified
```

Options are grouped, so multiple products with the same relevant characteristic can share one option.

## Stock And Price

Inactive products are excluded.

When `filters.inStockOnly` is `true`, products with `out_of_stock`, `unknown`, or `available = false` are excluded. `available_for_order` is treated as available according to the service's existing catalog semantics.

Price is never invented. Missing price is returned as `null` and emits one deduplicated global warning.

Stock is never invented. Unknown stock is returned explicitly as:

```json
{
  "status": "unknown",
  "available": false
}
```

## Warnings

Warnings are global and deduplicated:

```text
QUERY_NORMALIZED
RESULTS_TRUNCATED
CATALOG_PRICE_UNAVAILABLE
CATALOG_STOCK_UNKNOWN
SEARCH_PARTIALLY_DEGRADED
```

## Observability

T12 emits structured logs for:

```text
product_intent_resolution_started
product_intent_query_normalized
product_intent_catalog_search_completed
product_intent_candidates_enriched
product_intent_candidates_filtered
product_intent_candidates_ranked
product_intent_resolved
product_intent_clarification_required
product_intent_no_match
product_intent_resolution_failed
```

It also exposes Prometheus metrics using the existing metrics infrastructure.

## Swagger

Swagger documents copyable examples for:

- resolved: `barra olimpica 15 kg`;
- ambiguous: `quiero una barra`;
- no match: `producto inexistente xyz 987654`.

The Swagger documentation states that T12 searches real catalog products, does not generate products, may require clarification, does not execute T11.3, and does not use LLMs or embeddings in V1.

## V1 Limits

T12 resolves bounded product intent. It does not solve broad commercial needs such as:

```text
quiero armar un gimnasio para 30 personas
```

That remains Sales Agent orchestration work. The future flow is:

```text
T12 resolved
  -> caller obtains sourceProduct
  -> caller invokes T11.3
  -> Sales Agent presents recommendations commercially
```
