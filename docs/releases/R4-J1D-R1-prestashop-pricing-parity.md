# R4-J1D-R1 — PrestaShop pricing parity

Status: implemented locally (not committed, not deployed). Engine `catalog-commercial-v2.2.0`,
`schemaVersion` 1 unchanged.

## Problem

J1D Step 5 (2026-09-30) compared `catalog-commercial-v2.1.0` with the production storefront
(`https://pesaschile.cl`, shop 1): on the 20 promotional units whose price falls on a half-peso
boundary, Catalog published 1 CLP less than the storefront in 19/20 (evidence: R4
`docs/audits/r4-j1d-step5/pricing-parity.json`).

## PrestaShop rounding invariant (1.7.8.3)

Storefront price of a unit, tax-included display (all public groups `price_display_method = 0`,
`PS_TAX_DISPLAY = 0`), CLP `ps_currency.precision = 0`, `PS_PRICE_ROUND_MODE = 2` (half up):

```
p  = (float) price  [+ (float) attribute impact]          // fixed override replaces price
g  = p * (1 + rate / 100)                                  // TaxCalculator::addTaxes, double
f  = g - g * reduction                                     // percentage; amount: g - R (R·(1+rate) if reduction_tax=0)
f6 = round(f, 6)            ; if f6 < 0 then 0             // Product::priceCalculation, getPriceStatic($decimals = 6)
P  = round(f6, precision)                                  // Product::getProductProperties, ps_round(…, getComputingPrecision())
round = PHP 7 round(…, PHP_ROUND_HALF_UP)                  // Tools::ps_round → Tools::math_round
```

Source (tag `1.7.8.3`): `classes/Product.php` `priceCalculation` (tax, reduction, final
`Tools::ps_round($price, $decimals)`), `getProductProperties` (`$row['price'] =
Tools::ps_round(Product::getPriceStatic(…, 6, …), Context::getComputingPrecision())`),
`classes/Tools.php` `ps_round`/`math_round`/`round_helper`, `classes/tax/TaxCalculator.php`
`addTaxes`, `src/Core/Localization/CLDR/ComputingPrecision.php` (precision = currency
precision), `src/Adapter/Presenter/Product/ProductLazyArray.php` (`price_amount = $product['price']`,
the value of `itemprop="price"`). Production settings read with SELECT-only queries.

Verification: an IEEE-754 emulation of that path reproduces 21/21 discounted storefront samples
and the undiscounted ones. Ablation: without the 6-decimal stage 2/21; the stage is decisive.

## Why J1D differed

Both price paths computed in exact decimals and rounded **once** to CLP
(`round(net·(1−r)·1.19)`), dropping PrestaShop's intermediate 6-decimal rounding: a value like
6 295.4999999 (11 756.302521 × 1.19 × 0.45) is 6 295.500000 at 6 decimals, hence 6 296 on the
storefront, but 6 295 in one step. The pre-J1D legacy rule (round the gross to CLP first) matched
19/20 by coincidence and missed P2264.

## Change

- `src/domain/pricing/prestashopPrice.ts`: `phpRoundHalfUp` (PHP 7 `_php_math_round`, half up) and
  `prestashopUnitPrice` (the invariant above) — the single pricing primitive.
- `commercialEngine.calculatePrice` (v2) and `CommercialPriceCalculator` (commercial truth /
  recommendations) now both price through it; selection, OD-1/OD-2/OD-3 and field semantics are
  unchanged. The legacy calculator keeps `baseGrossAmount` = catalog base (its own contract).
- `CATALOG_V2_ENGINE_VERSION` → `catalog-commercial-v2.2.0`.
- Not changed: v1 `priceResolver` (third implementation, see `docs/audits/CAT-HOTFIX-ZERO-DATE-PROMOTIONS.md`).

## Evidence

`tests/fixtures/prestashopStorefrontPricing.ts` (20 production units),
`tests/unit/prestashopStorefrontPricing.test.ts`: before 38/40 failing (19 per path, P2264 passing),
after 54/54. Owner fixtures regenerated: only `engineVersion` changed (6 item fixtures + MANIFEST).
