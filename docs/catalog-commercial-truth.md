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

Legacy `/v1/products/:productId` and `/v1/products/batch` also expose `publicLink` from their existing product core and variant hydration path. That path selects `ps_product_lang.link_rewrite` with the same configured shop/language and uses the already-loaded variant list for `scope` and attribute labels, so it does not add a per-product public-link query.

## Batch Reader

`MySqlCatalogCommercialDataReader` reads the requested product references in a bounded batch:

- products and product shop data;
- requested combinations;
- stock rows;
- compatible specific prices;
- variant attribute group labels.

It does not filter inactive products in SQL. Inactive products are read and classified by the commercial availability resolver.

Specific price dates are not evaluated with SQL `NOW()`. The selector evaluates date windows with the injected clock so one request uses one deterministic `evaluatedAt`.

The product batch query is also the source for public product URLs. It reads:

```sql
ps_product_lang.id_product
ps_product_lang.id_lang
ps_product_lang.id_shop
ps_product_lang.link_rewrite
```

using the same configured `PRESTASHOP_LANG_ID` and `PRESTASHOP_SHOP_ID` used for name, description and category hydration. The query filters by both fields and does not use an arbitrary `LIMIT 1`, so multiple language/shop rows cannot duplicate products.

Variant selection metadata is read in one batch from:

```sql
ps_product_attribute
ps_product_attribute_combination
ps_attribute
ps_attribute_group
ps_attribute_group_lang
```

Attribute group names use the configured commercial language. Duplicates are removed in memory while preserving SQL order by product, group position and group id.

## Public Product Link

Every `CatalogCommercialProduct` includes `publicLink`:

```ts
type ProductPublicLink = {
  canonicalUrl: string | null;
  scope: "exact_product" | "parent_product";
  available: boolean;
  unavailableReason?: "missing_link_rewrite" | "invalid_product_id" | "invalid_base_url";
  requiresVariantSelection: boolean;
  variantAttributeLabels: string[];
};
```

The public URL is built from `CATALOG_PUBLIC_BASE_URL`, `id_product` and `link_rewrite`:

```text
https://pesaschile.cl/categories/{id_product}-{link_rewrite}.html
```

`CATALOG_PUBLIC_BASE_URL` must be a valid `http` or `https` URL. Trailing slashes are removed before appending `/categories/...`, so `https://pesaschile.cl/` produces the same canonical URL as `https://pesaschile.cl`.

The builder is pure and explicit:

- positive integer `productId` is required;
- blank or missing `link_rewrite` returns `available=false` and `unavailableReason=missing_link_rewrite`;
- invalid base URL returns `unavailableReason=invalid_base_url`;
- invalid product id returns `unavailableReason=invalid_product_id`;
- it never generates a slug from product name.

Semantics:

- `scope=exact_product` means the URL points to a simple product with no detected combinations.
- `scope=parent_product` means the URL points to the parent product page because combinations exist.
- `requiresVariantSelection=true` means the consumer should tell the customer to select the variant before adding the product to the cart.

La URL entregada para productos con combinaciones apunta a la ficha del producto padre. El consumidor debe indicar al cliente que seleccione la variante correspondiente antes de agregar el producto al carrito.

This version intentionally does not build deep links for specific combinations.

Example simple product:

```json
{
  "productId": "123",
  "name": "Producto simple",
  "publicLink": {
    "canonicalUrl": "https://pesaschile.cl/categories/123-producto-simple.html",
    "scope": "exact_product",
    "available": true,
    "requiresVariantSelection": false,
    "variantAttributeLabels": []
  }
}
```

Example product with combinations:

```json
{
  "productId": "123",
  "combinationId": "456",
  "name": "Producto con variantes",
  "publicLink": {
    "canonicalUrl": "https://pesaschile.cl/categories/123-producto-con-variantes.html",
    "scope": "parent_product",
    "available": true,
    "requiresVariantSelection": true,
    "variantAttributeLabels": ["Talla", "Color"]
  }
}
```

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
- `CATALOG_PUBLIC_LINK_UNAVAILABLE`;
- `CATALOG_COMMERCIAL_STATUS_UNKNOWN`;
- `SPECIFIC_PRICE_INVALID_DATE`;
- `SPECIFIC_PRICE_INVALID_REDUCTION`;
- `SPECIFIC_PRICE_UNSUPPORTED_REDUCTION_TYPE`;
- `SPECIFIC_PRICE_EXCEEDS_BASE_PRICE`;
- `SPECIFIC_PRICE_CONTEXT_UNSUPPORTED`;
- `SPECIFIC_PRICE_SELECTION_AMBIGUOUS`.

Warnings are technical and deterministic. They do not invent price, stock, availability or product identity.

Minimal observability logs are emitted for missing `link_rewrite`, invalid public base URL, products with combinations but no attribute labels, and language/shop scope inconsistencies. Successful URL construction is not logged per product.

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
- `availability.evaluatedAt`;
- `publicLink.canonicalUrl`;
- `publicLink.scope`;
- `publicLink.available`;
- `publicLink.requiresVariantSelection`;
- `publicLink.variantAttributeLabels`.

The legacy `price.amount` is derived from `pricing.finalGrossAmount`.

Manual validation:

```bash
npm run typecheck
npm test
```

For a running local service:

```bash
curl -H "x-api-key: $API_KEY" "http://localhost:4010/openapi.json"
```

For direct SQL inspection against a read-only catalog connection:

```sql
SELECT p.id_product, pl.name, pl.link_rewrite
FROM ps_product p
JOIN ps_product_lang pl
  ON pl.id_product = p.id_product
 AND pl.id_shop = 1
 AND pl.id_lang = 1
WHERE p.id_product = 123;
```

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
