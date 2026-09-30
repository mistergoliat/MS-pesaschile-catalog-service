/**
 * R4-J1D-R1 — production storefront price parity (PrestaShop 1.7.8.3, shop 1, CLP, 19 % VAT).
 *
 * The 20 sellable units whose promotional price falls on a rounding boundary, observed on
 * 2026-09-30 (J1D Step 5): `baseNet` is `ps_product_shop.price` exactly as stored
 * (DECIMAL(20,6), no combination impact), `reduction` the public, unbounded, shop 0/1
 * percentage specific price (`reduction_tax` = 1), `storefrontFinalGross` the price the
 * storefront product page publishes (`itemprop="price"`), `storefrontRegularGross` its
 * struck-through regular price where it was captured. `j1dFinalGross` is what Catalog
 * 47875d5 (catalog-commercial-v2.1.0) answered — the regression being fixed.
 * Public catalog prices only; no customer or order data.
 */
export type StorefrontPricingCase = {
  productKey: string;
  baseNet: string;
  reduction: string;
  storefrontFinalGross: number;
  storefrontRegularGross?: number;
  j1dFinalGross: number;
};

export const STOREFRONT_TAX_RATE = 0.19;

export const storefrontPricingCases: readonly StorefrontPricingCase[] = [
  { productKey: 'P382', baseNet: '1226781.512605', reduction: '0.150000', storefrontFinalGross: 1240890, storefrontRegularGross: 1459870, j1dFinalGross: 1240889 },
  { productKey: 'P435', baseNet: '688983.193277', reduction: '0.150000', storefrontFinalGross: 696907, storefrontRegularGross: 819890, j1dFinalGross: 696906 },
  { productKey: 'P1415', baseNet: '905789.915966', reduction: '0.150000', storefrontFinalGross: 916207, storefrontRegularGross: 1077890, j1dFinalGross: 916206 },
  { productKey: 'P1927', baseNet: '487352.941176', reduction: '0.150000', storefrontFinalGross: 492958, j1dFinalGross: 492957 },
  { productKey: 'P1928', baseNet: '326008.403361', reduction: '0.150000', storefrontFinalGross: 329758, j1dFinalGross: 329757 },
  { productKey: 'P1930', baseNet: '784831.932773', reduction: '0.150000', storefrontFinalGross: 793858, j1dFinalGross: 793857 },
  { productKey: 'P1931', baseNet: '324327.731092', reduction: '0.150000', storefrontFinalGross: 328058, j1dFinalGross: 328057 },
  { productKey: 'P1935', baseNet: '335252.100840', reduction: '0.150000', storefrontFinalGross: 339108, j1dFinalGross: 339107 },
  { productKey: 'P1936', baseNet: '298277.310924', reduction: '0.150000', storefrontFinalGross: 301708, j1dFinalGross: 301707 },
  { productKey: 'P1937', baseNet: '368008.403361', reduction: '0.150000', storefrontFinalGross: 372241, j1dFinalGross: 372240 },
  { productKey: 'P1939', baseNet: '452025.210084', reduction: '0.150000', storefrontFinalGross: 457224, j1dFinalGross: 457223 },
  { productKey: 'P1944', baseNet: '268865.546218', reduction: '0.150000', storefrontFinalGross: 271958, j1dFinalGross: 271957 },
  { productKey: 'P1948', baseNet: '998226.890756', reduction: '0.150000', storefrontFinalGross: 1009707, j1dFinalGross: 1009706 },
  { productKey: 'P2195', baseNet: '73084.033613', reduction: '0.150000', storefrontFinalGross: 73925, storefrontRegularGross: 86970, j1dFinalGross: 73924 },
  { productKey: 'P2264', baseNet: '151252.100800', reduction: '0.350000', storefrontFinalGross: 116993, storefrontRegularGross: 179990, j1dFinalGross: 116993 },
  { productKey: 'P2317', baseNet: '968008.403361', reduction: '0.150000', storefrontFinalGross: 979141, j1dFinalGross: 979140 },
  { productKey: 'P2319', baseNet: '495739.495798', reduction: '0.150000', storefrontFinalGross: 501441, j1dFinalGross: 501440 },
  { productKey: 'P2328', baseNet: '352932.773109', reduction: '0.450000', storefrontFinalGross: 230995, storefrontRegularGross: 419990, j1dFinalGross: 230994 },
  { productKey: 'P2337', baseNet: '80663.865546', reduction: '0.450000', storefrontFinalGross: 52795, storefrontRegularGross: 95990, j1dFinalGross: 52794 },
  { productKey: 'P2340', baseNet: '11756.302521', reduction: '0.550000', storefrontFinalGross: 6296, storefrontRegularGross: 13990, j1dFinalGross: 6295 },
];
