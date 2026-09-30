# CAT-HOTFIX-V1-ZERO-DATE-PROMOTIONS

Status: OPEN — analysed only; not fixed (explicitly out of scope of R4-J1D-R1).
Found: R4-J1D Step 5, 2026-09-30, production (Catalog `47875d5`).

## Symptom

`GET /v1/products/:id` and `POST /v1/products/batch` return every currently promoted product at
its regular price (`discountApplied: false`, `specificPriceId: null`). Production samples: P2340
13 990 (storefront 6 296, −55 %), P382 1 459 870 (storefront 1 240 890), P2264, P1136, P2338.

## Consumer impact

The live CRM WhatsApp agent (`native-whatsapp-turn-settle`) reads `/v1/products/:id` and
`/v1/products/batch` (Step 3 log evidence). Promotional products may be presented at the regular
(higher) price. All 227 public specific-price rows applicable today have an unbounded
(`0000-00-00 00:00:00`) end date, so every current promotion is affected. `/v2/catalog/*` and the
recommendations path are not affected.

## Cause

`MySqlCatalogRepository.getSpecificPrices` returns the raw `from`/`to` DATETIME columns; mysql2
turns `0000-00-00 00:00:00` into an `Invalid Date` object (not the string), and
`priceResolver.isValidDateWindow` / `isStillActive` only treat `null`/the string as unbounded, so
`new Date(invalid)` → `NaN` → the row is rejected. Pre-existing: neither function, the repository
query nor the pool changed in J1D (the only `priceResolver` change was the tie-break direction).

## Remediation boundary (for the hotfix task)

1. Map zero datetimes to "unbounded" at the source (as the v2 reader does:
   `CAST(NULLIF(col, '0000-00-00 00:00:00') AS CHAR)`), read windows as shop-local text and convert
   with `PRESTASHOP_TIMEZONE` (B7); the SQL `NOW()` pre-filter runs in the UTC session and is
   3 h off for dated windows.
2. Price through `src/domain/pricing/prestashopPrice.ts` (`prestashopUnitPrice`): `resolvePrice`
   still rounds once in exact decimals, so fixing only the dates would publish 1 CLP below the
   storefront on the 19 R4-J1D-R1 boundary units.
3. Regression: the 20 units of `tests/fixtures/prestashopStorefrontPricing.ts` through
   `SqlPricingProvider`, plus zero-date and dated windows.
4. The v1 response shape (`baseUnitPrice`, `effectiveUnitPrice`, `discountValue`) is consumed by the
   CRM; keep it.
