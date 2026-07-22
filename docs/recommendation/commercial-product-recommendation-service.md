# Commercial Product Recommendation Service

## Purpose

T08 transforma relaciones publicadas en recomendaciones comerciales.

It consumes relationship candidates from T07 and applies explicit commercial context, eligibility rules, scoring, ranking, reasons, warnings, and rejections.

T08 no calcula nuevas relaciones entre productos.

T08 no consulta directamente bases operacionales.

T08 depende de puertos para obtener informacion comercial.

El scoring es deterministico y explicable.

La integracion con CRM, e-commerce y canales ocurre fuera de T08.

T08 puede probarse completamente con fixtures y adapters en memoria.

## Relationship vs Recommendation

A relationship says that two products are connected in published product knowledge.

A recommendation says that a target product is commercially suitable for the current request and context.

T08 does not discover new relationships. It turns already published relationships into ranked commercial recommendations.

## Dependency On T07

T08 retrieves candidates only through:

```ts
reader.findBySource({
  sourceProduct,
  relationshipTypes
});
```

It does not pass `limit` to T07, does not access the snapshot store, and does not rebuild runtime indexes.

T08 evaluates all relationship candidates and applies the final limit after deduplication, enrichment, eligibility, scoring, and ranking.

## Product Identity

All product comparisons reuse T07:

```ts
createProductRuntimeIdentity()
```

This is used for the source product, cart products, purchased products, excluded products, commercial records, and candidates.

Base products and combinations remain distinct.

## Request And Context

The request includes:

- source product;
- optional customer identifier;
- optional cart products;
- optional previously purchased products;
- optional explicit exclusions;
- optional relationship type filters;
- optional limit;
- optional out-of-stock inclusion;
- optional commercial context.

The commercial context can include channel, intent, and explicit budget.

T08 does not infer missing budget, customer history, channel intent, or commercial facts.

## Commercial Data Port

Commercial data is loaded through a batch port:

```ts
getCommercialData(products, context)
```

The service calls this once per request and only for deduplicated target products.

The port returns availability, sellability, active state, stock status, optional price, margin signal, and compatibility status.

T08 does not know whether those values come from PrestaShop, ERP, CRM, files, fixtures, or another adapter.

## Deduplication

When multiple relationships point to the same target product identity, T08 keeps one candidate.

V1 chooses by:

1. highest reliability;
2. highest lift;
3. highest confidence;
4. highest support;
5. highest joint count;
6. product identity.

T08 does not sum, average, or merge metrics. The selected relationship is preserved intact.

Removed duplicates are reported as rejected candidates with `DUPLICATE_TARGET`.

## Eligibility

Eligibility separates technically related products from commercially recommendable products.

Mandatory rejections include:

- source product;
- explicitly excluded product;
- inactive product;
- not sellable product;
- incompatible product;
- missing commercial data;
- invalid product identity.

Configurable policies control cart products, previous purchases, out-of-stock products, and unknown compatibility.

## Cart And Purchases

By default, products already in the cart are rejected.

When cart exclusion is disabled, the product may remain but receives `ALREADY_IN_CART`.

Previously purchased products are allowed by default and receive `ALREADY_PURCHASED`. They can be rejected by policy.

T08 V1 checks only presence by product identity. It does not infer replenishment, wear, quantity, or purchase frequency.

## Availability

Rules:

- inactive products are rejected;
- not sellable products are rejected;
- out-of-stock or unavailable products are rejected by default;
- out-of-stock products can be included when requested and receive a warning plus score penalty;
- unknown stock receives a warning.

## Compatibility

Compatibility comes from the commercial data provider.

`compatible` is positive.

`incompatible` is rejected.

`unknown` warns by default and can be rejected by policy.

T08 does not calculate compatibility.

## Budget

Budget is explicit.

If no budget exists, T08 does not filter by price.

If price is missing, T08 warns.

If currency does not match, T08 warns and does not compare.

If price exceeds `maximum`, T08 rejects with `ABOVE_BUDGET`.

If price is below `minimum`, T08 does not reject.

## Scoring

The V1 score is:

```text
relationship:
reliability * 45
confidence * 20
normalizedLift * 15
normalizedSupport * 10

availability:
in_stock +5
low_stock +2
unknown +0
out_of_stock -15

compatibility:
compatible +5
unknown +0

commercial:
margin high +3
margin medium +2
margin low/unknown +0

penalties:
already in cart -20
out of stock included -15
price unavailable -2
currency mismatch -2
```

Normalization:

```ts
normalizedLift = clamp((lift - 1) / 4, 0, 1)
normalizedSupport = clamp(support / 0.10, 0, 1)
```

The final score is clamped from 0 to 100.

T08 may use reliability as a score signal, but it does not recalculate or replace T04 reliability.

## Ranking

Ranking is deterministic:

1. score total descending;
2. reliability descending;
3. compatible before unknown;
4. in stock, low stock, unknown, out of stock;
5. confidence descending;
6. lift descending;
7. support descending;
8. joint count descending;
9. product identity ascending.

Ranks start at 1 and are contiguous.

## Reasons, Warnings, And Rejections

Reasons explain positive signals such as strong relationship, high confidence, high lift, availability, compatibility, margin signal, and budget fit.

Warnings explain caveats such as low stock, out of stock included, unknown stock, unknown compatibility, unavailable price, currency mismatch, cart presence, and previous purchase.

Rejections explain why a candidate did not become a recommendation.

T08 does not generate free-form commercial copy.

## Determinism And Immutability

The same snapshot, request, commercial data, and parameters produce the same result.

T08 does not use the clock, randomness, UUIDs, hidden weights, or undeclared data.

Outputs are deeply frozen. The service clones commercial data and relationships before returning them.

## V1 Limits

T08 V1 excludes dynamic promotions, complex margin rules, predictive personalization, LLM reasoning, conversation state, embedding cross-sell, campaign logic, pricing dynamics, automatic bundles, CRM integration, e-commerce integration, cart mutation, order creation, and end-to-end operational workflows.
