# Catalog Discovery Exclusion Policy

`search_products` and `explore_catalog` apply a centralized discovery denylist for known internal products:

| productId | Name | Reason |
| --- | --- | --- |
| `444` | Servicio vendedor Pesas Chile | Known internal product |
| `505` | Costo logistico | Known internal product |

This policy is intentionally narrow. It is an explicit denylist for internal products already observed in discovery/ranking results, not a general definition of `commerciallySellable`, `publiclyVisible`, or public catalog eligibility.

The denylist applies only to discovery surfaces:

- `GET /v1/products/search`;
- `POST /v1/products/explore`.

Direct hydration remains allowed:

- `GET /v1/products/:productId`;
- `POST /v1/products/batch`.

The exclusion must happen before downstream filtering, `totalMatched`, sorting, and `limit` so internal rows cannot occupy ranking slots or inflate matched counts.
