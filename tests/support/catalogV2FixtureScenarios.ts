import { CatalogContractService } from '../../src/application/catalog/v2/catalogContractService.js';
import type {
  CatalogV2DataReader,
  CatalogV2Product,
  CatalogV2SpecificPrice,
  CatalogV2Variant,
  FrequentlyBoughtTogetherProvider,
} from '../../src/domain/catalog/v2/contracts.js';

/**
 * Deterministic inputs of the published Catalog v2 contract fixtures
 * (contracts/catalog/v2/fixtures). Every wire fixture is the exact output of
 * the real CatalogContractService (or the real HTTP app, for error bodies)
 * for one of these scenarios: `tests/contract/catalogV2Fixtures.contract.test.ts`
 * fails when a fixture and the service disagree, and regenerates them with
 * CATALOG_V2_WRITE_FIXTURES=1. Synthetic data only.
 */
export const FIXTURE_AS_OF = '2026-09-29T12:00:00.000Z';
export const FIXTURE_BUILD_REF = 'catalog-service@fixtures';
export const FIXTURE_PUBLIC_BASE_URL = 'https://pesaschile.cl';

const simpleVariant = (overrides: Partial<CatalogV2Variant> = {}): CatalogV2Variant => ({
  combinationId: 0,
  sku: null,
  attributes: [],
  impactPriceNet: 0,
  isDefault: true,
  availableQuantity: 4,
  outOfStock: 2,
  ...overrides,
});

const specificPrice = (overrides: Partial<CatalogV2SpecificPrice>): CatalogV2SpecificPrice => ({
  idSpecificPrice: 1,
  combinationId: 0,
  shopId: 0,
  currencyId: 0,
  countryId: 0,
  groupId: 0,
  customerId: 0,
  cartId: 0,
  price: -1,
  fromQuantity: 1,
  reduction: 0,
  reductionTax: 1,
  reductionType: 'amount',
  from: null,
  to: null,
  ...overrides,
});

function product(overrides: Partial<CatalogV2Product> & Pick<CatalogV2Product, 'productId' | 'name'>): CatalogV2Product {
  const sku = overrides.sku ?? `SKU-${overrides.productId}`;
  return {
    basePriceNet: 100000,
    sku,
    shortDescription: null,
    brand: null,
    weightKg: null,
    linkRewrite: `producto-${overrides.productId}`,
    category: { id: '3', name: 'Barras' },
    active: true,
    listed: true,
    orderable: true,
    variants: [simpleVariant({ sku })],
    specifications: [],
    globalBackorderAllowed: false,
    specificPrices: [],
    asOf: FIXTURE_AS_OF,
    ...overrides,
  };
}

export const FIXTURE_PRODUCTS: readonly CatalogV2Product[] = [
  product({ productId: 10, name: 'Barra olímpica', sku: 'BAR-10', shortDescription: 'Barra comercial', weightKg: 20, linkRewrite: 'barra-olimpica', specifications: [{ name: 'Largo', value: '220 cm' }] }),
  product({
    productId: 12,
    name: 'Barra técnica',
    sku: 'BAR-12',
    brand: 'Marca',
    specificPrices: [specificPrice({ idSpecificPrice: 50, reduction: 0.1, reductionType: 'percentage', to: '2026-10-15T03:00:00.000Z' })],
  }),
  product({
    productId: 20,
    name: 'Barra con opciones',
    sku: 'BAR-20',
    shortDescription: 'Variantes',
    weightKg: 20,
    linkRewrite: 'barra-con-opciones',
    variants: [
      { combinationId: 7, sku: 'BAR-20-XL', attributes: [{ group: 'Tamaño', value: 'XL' }], impactPriceNet: 10000, isDefault: true, availableQuantity: 2, outOfStock: 2 },
      { combinationId: 8, sku: 'BAR-20-L', attributes: [{ group: 'Tamaño', value: 'L' }], impactPriceNet: 0, isDefault: false, availableQuantity: 0, outOfStock: 2 },
    ],
  }),
  product({ productId: 40, name: 'Producto descontinuado', sku: 'OLD-40', category: null, active: false, variants: [simpleVariant({ sku: 'OLD-40', availableQuantity: 0 })] }),
  product({ productId: 41, name: 'Barra oculta', sku: 'HID-41', listed: false }),
  product({ productId: 50, name: 'Disco bumper', sku: 'DSC-50', category: { id: '4', name: 'Discos' }, variants: [simpleVariant({ sku: 'DSC-50', availableQuantity: null, outOfStock: null })] }),
  product({ productId: 51, name: 'Disco a pedido', sku: 'DSC-51', category: { id: '4', name: 'Discos' }, variants: [simpleVariant({ sku: 'DSC-51', availableQuantity: 0, outOfStock: 1 })] }),
  product({ productId: 52, name: 'Disco agotado', sku: 'DSC-52', category: { id: '4', name: 'Discos' }, variants: [simpleVariant({ sku: 'DSC-52', availableQuantity: 0, outOfStock: 0 })] }),
  product({ productId: 60, name: 'Accesorio sin precio', sku: 'ACC-60', basePriceNet: null }),
  product({ productId: 70, name: 'Barra corta', sku: 'BAR-70' }),
  product({ productId: 71, name: 'Barra hexagonal', sku: 'BAR-71' }),
  product({ productId: 72, name: 'Barra curva', sku: 'BAR-72' }),
];

const productsById = new Map(FIXTURE_PRODUCTS.map((item) => [item.productId, item]));

/** Answers exactly the requested ids; a query answers every fixture product (the service filters lexically). */
export const fixtureReader: CatalogV2DataReader = {
  async readProducts(input) {
    const products = input.productIds
      ? input.productIds.flatMap((id) => (productsById.has(id) ? [productsById.get(id)!] : []))
      : [...FIXTURE_PRODUCTS];
    return { products: structuredClone(products), asOf: FIXTURE_AS_OF };
  },
};

export const fixtureFrequentlyBoughtTogether: FrequentlyBoughtTogetherProvider = {
  getForProduct(productId) {
    if (productId !== 10) return null;
    return {
      snapshotId: 'same-order-2026-09-01',
      builtAt: '2026-09-01T00:00:00.000Z',
      items: [{ productId: 20, name: 'Barra con opciones', confidence: 0.4, jointCount: 12 }],
    };
  },
};

export function fixtureService(options: { frequentlyBoughtTogether?: boolean } = {}): CatalogContractService {
  return new CatalogContractService({
    reader: fixtureReader,
    clock: { now: () => new Date(FIXTURE_AS_OF) },
    publicBaseUrl: FIXTURE_PUBLIC_BASE_URL,
    serviceBuildRef: FIXTURE_BUILD_REF,
    ...(options.frequentlyBoughtTogether ? { frequentlyBoughtTogether: fixtureFrequentlyBoughtTogether } : {}),
  });
}

export type FixtureScenario =
  | { readonly file: string; readonly endpoint: 'search'; readonly request: { query: string; limit: number; sellableOnly?: boolean } }
  | { readonly file: string; readonly endpoint: 'productContext'; readonly productKey: string; readonly frequentlyBoughtTogether?: boolean }
  | { readonly file: string; readonly endpoint: 'itemContext'; readonly itemKey: string; readonly quantity: number };

/** One wire fixture per contract case consumers must handle. */
export const FIXTURE_SCENARIOS: readonly FixtureScenario[] = [
  { file: 'search-success.json', endpoint: 'search', request: { query: 'BAR-10', limit: 5 } },
  { file: 'search-with-variants.json', endpoint: 'search', request: { query: 'opciones', limit: 5 } },
  { file: 'search-zero-stock-visible.json', endpoint: 'search', request: { query: 'disco', limit: 5 } },
  { file: 'search-empty.json', endpoint: 'search', request: { query: 'kettlebell', limit: 5 } },
  { file: 'search-truncated.json', endpoint: 'search', request: { query: 'barra', limit: 2 } },
  { file: 'product-simple.json', endpoint: 'productContext', productKey: 'P10' },
  { file: 'product-with-fbt.json', endpoint: 'productContext', productKey: 'P10', frequentlyBoughtTogether: true },
  { file: 'product-with-variants.json', endpoint: 'productContext', productKey: 'P20' },
  { file: 'product-inactive.json', endpoint: 'productContext', productKey: 'P40' },
  { file: 'product-not-listed.json', endpoint: 'productContext', productKey: 'P41' },
  { file: 'product-not-found.json', endpoint: 'productContext', productKey: 'P999' },
  { file: 'item-simple.json', endpoint: 'itemContext', itemKey: 'P10', quantity: 1 },
  { file: 'item-variant.json', endpoint: 'itemContext', itemKey: 'P20-V7', quantity: 1 },
  { file: 'item-variant-required.json', endpoint: 'itemContext', itemKey: 'P20', quantity: 1 },
  { file: 'item-promotion.json', endpoint: 'itemContext', itemKey: 'P12', quantity: 2 },
  { file: 'item-backorder.json', endpoint: 'itemContext', itemKey: 'P51', quantity: 1 },
  { file: 'item-not-sellable.json', endpoint: 'itemContext', itemKey: 'P52', quantity: 1 },
  { file: 'item-stock-unknown.json', endpoint: 'itemContext', itemKey: 'P50', quantity: 1 },
  { file: 'item-pricing-unavailable.json', endpoint: 'itemContext', itemKey: 'P60', quantity: 1 },
  { file: 'item-not-found.json', endpoint: 'itemContext', itemKey: 'P10-V99', quantity: 1 },
];

export async function runScenario(scenario: FixtureScenario): Promise<unknown> {
  if (scenario.endpoint === 'search') {
    return fixtureService().search({ query: scenario.request.query, limit: scenario.request.limit, filters: { sellableOnly: scenario.request.sellableOnly ?? false } });
  }
  if (scenario.endpoint === 'productContext') {
    return fixtureService({ frequentlyBoughtTogether: scenario.frequentlyBoughtTogether === true }).getProductContext({ productKey: scenario.productKey, quantity: 1 });
  }
  return fixtureService().getItemContext({ itemKey: scenario.itemKey, quantity: scenario.quantity });
}
