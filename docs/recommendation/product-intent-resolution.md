# T12 Product Intent Resolution

T12 resolves a bounded natural-language product intent into real catalog product candidates.

It exists because SearchProducts V2 recommendations require a known `sourceProduct.productId`, while customers normally describe products with phrases such as `barra para sentadillas`, `discos de goma 20 kg`, or `pesas rusas de 16 kg`.

T12 does not recommend related products. T12 does not execute T11.3. T12 does not converse. T12 does not use LLMs, embeddings, vectors, or generated commercial copy. T12 does not integrate the Sales Agent.

Since T11.4, T12 enriches candidate products through the shared `CatalogCommercialTruthService`. That keeps product intent resolution aligned with SearchProducts V2 for active status, orderability, final gross price, specific-price discounts and stock availability.

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

T12.1 adds explicit constraint calibration. General lexical evidence and explicit constraints are different signals:

- general evidence helps retrieval and ordering;
- explicit constraints decide whether a candidate is plausible.

Examples of explicit constraints:

```text
product type
weight
diameter
length
reference
brand
variant
```

Supported product types in the first calibrated version:

```text
olympic_bar
straight_bar
curl_bar
hex_bar
kettlebell
bumper_plate
iron_plate
barbell_collar
leg_extension_machine
leg_curl_machine
```

Measurement extraction recognizes:

- weight: `15kg`, `15 kg`, `15 kilos`, `15 kilogramos`;
- diameter: `50mm`, `50 mm`, `2 pulgadas`;
- length: `220cm`, `220 cm`, `2.2 m`.

Meters are converted to centimeters deterministically. Inches are kept as inches; T12.1 does not compare incompatible measurement units as if they were equivalent.

Each candidate receives an internal constraint evaluation:

```text
matched
not_available
contradicted
```

`matched` means the catalog evidence agrees with the explicit query constraint.

`not_available` means the catalog does not expose enough information to verify the constraint. This is not automatically treated as a contradiction.

`contradicted` means the catalog evidence conflicts with the explicit query constraint. For example:

```text
query: barra olimpica 15 kg
candidate: barra olimpica 20 kg
-> weight contradicted
```

```text
query: barra olimpica 15 kg
candidate: kettlebell 15 kg
-> product_type contradicted
```

A lexical match cannot compensate for an explicit contradiction of type, weight, diameter, or length.

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
EXPLICIT_TYPE_MATCH
EXPLICIT_WEIGHT_MATCH
EXPLICIT_DIAMETER_MATCH
EXPLICIT_LENGTH_MATCH
EXPLICIT_REFERENCE_MATCH
```

Description matches have low weight so long descriptions cannot dominate product names.

Contradictions receive a severe internal penalty and mark the candidate as not plausible. Candidates that contradict explicit type or essential measurements are not used as equivalent options for clarification.

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

T12.1 updates the policy so explicit constraints have authority:

```text
if explicit constraints exist
  and exactly one plausible candidate satisfies all explicit constraints
  and its score is high enough
then resolved
```

If two or more candidates satisfy all explicit constraints, T12 returns `clarification_required`.

If every candidate contradicts explicit constraints, T12 returns `no_match`.

Examples:

```text
barra
-> clarification_required
```

```text
barra olimpica
-> clarification_required when multiple olympic bars are plausible
```

```text
barra olimpica 15 kg
-> resolved when exactly one eligible olympic bar of 15 kg exists
```

```text
kettlebell 99 kg
-> no_match when all retrieved kettlebells contradict the requested weight
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

T12.1 avoids redundant clarification. It does not ask again for a dimension the customer already specified.

Example:

```text
query: barra olimpica 15 kg
```

The clarification builder must not ask whether the customer wants `15 kg` or `20 kg`; `20 kg` contradicts the query. If multiple full matches remain, it should ask about another unresolved dimension such as length, variant, brand, or category.

Clarifications are built only from plausible candidates.

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
