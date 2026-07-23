# T11.4 Catalog Commercial Truth

T11.4 centralizes the commercial facts used by product intent resolution and enriched recommendations.

The relationship snapshot remains the authority for product-product evidence. The operational catalog remains the authority for product existence, active status, orderability, current price, discounts, stock and human-readable product data.

## Flow

```text
Product references
  -> CatalogCommercialTruthService
  -> CatalogCommercialDataReader
  -> CommercialAvailabilityResolver
  -> SpecificPriceSelector
  -> CommercialPriceCalculator
  -> commercial product summaries
```

`SearchProducts V2` and `Product Intent Resolution` now use the same commercial truth service for enrichment. This avoids divergent price or availability rules between T11.3 and T12.

## Batch Reader

`MySqlCatalogCommercialDataReader` reads the requested product references in a bounded batch:

- products and product shop data;
- requested combinations;
- stock rows;
- compatible specific prices.

It does not filter inactive products in SQL. Inactive products are read and classified by the commercial availability resolver.

Specific price dates are not evaluated with SQL `NOW()`. The selector evaluates date windows with the injected clock so one request uses one deterministic `evaluatedAt`.

## Availability

The availability resolver fails closed:

- `active = 0` -> `inactive`, `purchasable = false`;
- `active = 1` and `available_for_order = 0` -> `unavailable_for_order`, `purchasable = false`;
- active, orderable, and stock greater than zero -> `available`, `purchasable = true`;
- active and orderable without stock -> `out_of_stock`, `purchasable = false`;
- unknown status or unknown stock -> `unknown`, `purchasable = false`.

## Pricing

The price rule is explicit:

```text
net catalog price + combination impact
  -> gross base price using configured IVA
  -> active specific price discount over gross
  -> final gross CLP integer
```

`specific_price.price >= 0` replaces the net base before IVA. Negative specific prices keep the catalog base.

Percentage reductions must be between `0` and `1` and are applied over gross price.

Amount reductions are treated as gross CLP amounts. T11.4 does not use `reduction_tax` to add or remove IVA from amount reductions.

Specific prices are selected deterministically:

- exact combination over base product;
- exact shop over global;
- highest compatible `from_quantity`;
- more specific context;
- more recent `from`;
- higher `id_specific_price` as final tie break.

Discount rows with invalid dates, invalid reductions or unsupported reduction types are ignored or applied without the invalid discount and produce warnings.

## Warnings

Commercial warnings use stable codes, including:

- `CATALOG_PRICE_UNAVAILABLE`;
- `CATALOG_INVALID_BASE_PRICE`;
- `CATALOG_COMMERCIAL_STATUS_UNKNOWN`;
- `SPECIFIC_PRICE_INVALID_DATE`;
- `SPECIFIC_PRICE_INVALID_REDUCTION`;
- `SPECIFIC_PRICE_UNSUPPORTED_REDUCTION_TYPE`;
- `SPECIFIC_PRICE_EXCEEDS_BASE_PRICE`;
- `SPECIFIC_PRICE_CONTEXT_UNSUPPORTED`;
- `SPECIFIC_PRICE_SELECTION_AMBIGUOUS`.

Warnings are technical and deterministic. They do not invent price, stock, availability or product identity.

## Public Compatibility

Existing public fields remain:

- `price.amount`;
- `price.currency`;
- `stock.status`;
- `stock.available`;
- `active`.

T11.4 adds explicit commercial fields:

- `pricing.baseGrossAmount`;
- `pricing.finalGrossAmount`;
- `pricing.discountApplied`;
- `pricing.specificPriceId`;
- `availability.status`;
- `availability.purchasable`;
- `availability.availableForOrder`;
- `availability.evaluatedAt`.

The legacy `price.amount` is derived from `pricing.finalGrossAmount`.

## Boundaries

T11.4 does not calculate relationships, does not change snapshots, does not implement cart, checkout, CRM, Sales Agent, LLM, migrations or writes to PrestaShop.

T12 remains responsible for:

```text
natural language -> real catalog candidates -> productId or clarification
```

T11.3 remains responsible for:

```text
known productId -> related products -> enriched commercial response
```
