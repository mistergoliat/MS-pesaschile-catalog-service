# CAT-HOTFIX-ZERO-DATE-PROMOTIONS

Status: OPEN — analysed only; not fixed. Priority: immediately after R4-J1 closure (affects the live CRM).
Found: R4-J1D Step 5 (2026-09-30, Catalog `47875d5`); scope widened after the R1 rerun (Catalog `fea0dc5`).
Formerly `CAT-HOTFIX-V1-ZERO-DATE-PROMOTIONS` (v1 only).

Not part of the R4 ↔ Catalog contract gate: R4 consumes only `/v2/catalog/*`, which is correct
(storefront parity 20/20, J1D-R1).

## Affected paths (all legacy, all CRM consumers)

| Path | Code | Symptom (production) |
|---|---|---|
| `GET /v1/products/:id`, `POST /v1/products/batch` | `MySqlCatalogRepository.getSpecificPrices` → `priceResolver.isValidDateWindow` / `isStillActive` | every current promotion ignored (P2340, P382, P2264, P1136, P2338 at regular price) |
| `POST /api/v2/catalog/resolve-product-intent` | `CatalogCommercialTruthService` → `specificPriceSelector.parseDate` | 0/20 boundary units at the storefront price: regular price returned for every promoted unit |
| `POST /api/v2/recommendations/search-products` | same commercial-truth path (`catalogRecommendationCommercialDataProvider`) | promotions not applied to recommended products |

Consumers: the live CRM WhatsApp agent (`native-whatsapp-turn-settle`: `/v1/products/:id`, `/v1/products/batch`)
and the CRM search/recommendation flow (`resolve-product-intent`, `recommendations/search-products`).
Effect: promotional products may be presented at their regular (higher) price. All 227 public
specific-price rows applicable on 2026-09-30 have an unbounded (`0000-00-00 00:00:00`) end date.

## Cause

mysql2 returns `0000-00-00 00:00:00` as an `Invalid Date` object, not the string. `priceResolver`
(v1) treats it as a bounded-but-invalid window and rejects the row; `specificPriceSelector.parseDate`
(commercial truth) classifies it `'invalid'` and drops it. Pre-existing: neither function, the
repository/reader queries nor the pool changed in J1D or J1D-R1.

## Remediation boundary (shared rule for every path)

1. `0000-00-00` / `0000-00-00 00:00:00` → unbounded, mapped at the source as the v2 reader does
   (`CAST(NULLIF(col, '0000-00-00 00:00:00') AS CHAR)`); dated windows read as shop-local text and
   converted with `PRESTASHOP_TIMEZONE` (B7). The v1 SQL `NOW()` pre-filter runs in the UTC session and
   is 3 h off for dated windows.
2. Price through the shared primitive `src/domain/pricing/prestashopPrice.ts` (`prestashopUnitPrice`):
   `resolvePrice` still rounds once in exact decimals, so fixing only the dates would publish 1 CLP below
   the storefront on the 19 J1D-R1 boundary units. The commercial-truth calculator already uses it.
3. Regression: the 20 units of `tests/fixtures/prestashopStorefrontPricing.ts` through `SqlPricingProvider`,
   `CatalogCommercialTruthService` and the recommendations path; zero-date and dated windows.
4. Keep the legacy response shapes (`baseUnitPrice`, `effectiveUnitPrice`, `discountValue`,
   `baseGrossAmount`, `finalGrossAmount`): the CRM consumes them.
5. Verify in production: storefront parity on the same 20 units for each path, before/after.
