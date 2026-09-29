import { decimal, Decimal, toCurrencyInteger } from '../../../shared/money.js';
import type {
  CatalogV2Product,
  CatalogV2SpecificPrice,
  CatalogV2Variant,
} from './contracts.js';

export const CATALOG_V2_ENGINE_VERSION = 'catalog-commercial-v2.0.0';

export type Sellability = 'sellable' | 'backorder' | 'not_sellable' | 'check_with_staff';
export type SellabilityReason =
  | 'in_stock'
  | 'backorder_allowed'
  | 'inactive'
  | 'not_listed'
  | 'not_orderable'
  | 'out_of_stock'
  | 'stock_unknown'
  | 'variant_required'
  | 'backorder_policy_unknown';

export type SellabilityResult = {
  sellability: Sellability;
  reason: SellabilityReason;
};

export type PriceResult = {
  regularGross: number;
  finalGross: number;
  discounted: boolean;
  promotion: {
    discountType: 'amount' | 'percentage';
    discountValue: number;
    validUntil: string | null;
  } | null;
};

export type PublicPriceContext = {
  quantity: number;
  shopId: number;
  currencyId: number;
  countryId: number;
  customerGroupId: number;
  customerId: number;
  currencyCode: 'CLP';
  taxRate: number;
};

export function buildProductKey(productId: number): string {
  return `P${productId}`;
}

export function buildItemKey(productId: number, variantId: number | null): string {
  return variantId === null ? buildProductKey(productId) : `${buildProductKey(productId)}-V${variantId}`;
}

export function parseCatalogItemKey(itemKey: string): { productId: number; variantId: number | null } | null {
  const match = /^P(\d+)(?:-V(\d+))?$/u.exec(itemKey);
  if (!match) return null;
  const productId = Number(match[1]);
  const variantId = match[2] === undefined ? null : Number(match[2]);
  if (!Number.isSafeInteger(productId) || productId <= 0) return null;
  if (variantId !== null && (!Number.isSafeInteger(variantId) || variantId <= 0)) return null;
  return { productId, variantId };
}

export function deriveSellability(input: {
  product: Pick<CatalogV2Product, 'active' | 'listed' | 'orderable' | 'globalBackorderAllowed'>;
  availableQuantity: number | null;
  requireVariant: boolean;
}): SellabilityResult {
  if (input.requireVariant) return { sellability: 'check_with_staff', reason: 'variant_required' };
  if (input.product.active !== true) return { sellability: 'not_sellable', reason: 'inactive' };
  if (input.product.listed !== true) return { sellability: 'not_sellable', reason: 'not_listed' };
  if (input.product.orderable !== true) return { sellability: 'not_sellable', reason: 'not_orderable' };
  if (input.availableQuantity === null || !Number.isFinite(input.availableQuantity)) {
    return { sellability: 'check_with_staff', reason: 'stock_unknown' };
  }
  if (input.availableQuantity > 0) return { sellability: 'sellable', reason: 'in_stock' };
  if (input.product.globalBackorderAllowed === true) return { sellability: 'backorder', reason: 'backorder_allowed' };
  if (input.product.globalBackorderAllowed === false) return { sellability: 'not_sellable', reason: 'out_of_stock' };
  return { sellability: 'check_with_staff', reason: 'backorder_policy_unknown' };
}

export function selectSpecificPrice(
  rows: readonly CatalogV2SpecificPrice[],
  input: PublicPriceContext & { combinationId: number },
  now: Date,
): CatalogV2SpecificPrice | null {
  const compatible = rows.filter((row) => {
    if (row.cartId !== 0 || row.fromQuantity > input.quantity) return false;
    if (row.combinationId !== 0 && row.combinationId !== input.combinationId) return false;
    if (row.shopId !== 0 && row.shopId !== input.shopId) return false;
    if (row.currencyId !== 0 && row.currencyId !== input.currencyId) return false;
    if (row.countryId !== 0 && row.countryId !== input.countryId) return false;
    if (row.groupId !== 0 && row.groupId !== input.customerGroupId) return false;
    if (row.customerId !== 0 && row.customerId !== input.customerId) return false;
    return isActiveDateWindow(row, now);
  });

  return [...compatible].sort((left, right) => {
    const leftScore = specificityScore(left, input);
    const rightScore = specificityScore(right, input);
    for (let index = 0; index < leftScore.length; index += 1) {
      const diff = rightScore[index]! - leftScore[index]!;
      if (diff !== 0) return diff;
    }
    return 0;
  })[0] ?? null;
}

function specificityScore(row: CatalogV2SpecificPrice, input: PublicPriceContext & { combinationId: number }): number[] {
  return [
    row.combinationId === input.combinationId && input.combinationId > 0 ? 1 : 0,
    row.shopId === input.shopId ? 1 : 0,
    row.currencyId === input.currencyId ? 1 : 0,
    row.countryId === input.countryId ? 1 : 0,
    row.groupId === input.customerGroupId ? 1 : 0,
    row.customerId === input.customerId ? 1 : 0,
    row.fromQuantity,
    dateTime(row.from),
    row.idSpecificPrice,
  ];
}

function dateTime(value: string | Date | null): number {
  if (value === null || value === '0000-00-00 00:00:00') return 0;
  const result = value instanceof Date ? value : new Date(value);
  return Number.isNaN(result.getTime()) ? 0 : result.getTime();
}

function isActiveDateWindow(row: CatalogV2SpecificPrice, now: Date): boolean {
  const from = dateTime(row.from);
  const to = dateTime(row.to);
  if (row.from !== null && row.from !== '0000-00-00 00:00:00' && from === 0) return false;
  if (row.to !== null && row.to !== '0000-00-00 00:00:00' && to === 0) return false;
  const nowMs = now.getTime();
  return (from === 0 || from <= nowMs) && (to === 0 || to >= nowMs);
}

export function calculatePrice(input: {
  product: CatalogV2Product;
  variant: CatalogV2Variant;
  specificPrices: readonly CatalogV2SpecificPrice[];
  context: PublicPriceContext;
  now: Date;
}): PriceResult | null {
  const baseNet = Number(input.product.basePriceNet ?? Number.NaN) + input.variant.impactPriceNet;
  if (!Number.isFinite(baseNet) || baseNet < 0) return null;

  const selected = selectSpecificPrice(
    input.specificPrices,
    { ...input.context, combinationId: input.variant.combinationId },
    input.now,
  );
  const selectedBaseNet = selected && selected.price >= 0
    ? selected.price + input.variant.impactPriceNet
    : baseNet;
  let finalNet = Decimal.max(selectedBaseNet, 0);
  const regularGross = toCurrencyInteger(decimal(baseNet).mul(decimal(1).plus(input.context.taxRate)));
  let promotion: PriceResult['promotion'] = null;

  if (selected && Number.isFinite(selected.reduction) && selected.reduction > 0) {
    if (selected.reductionType === 'percentage' && selected.reduction <= 1) {
      finalNet = finalNet.mul(decimal(1).minus(selected.reduction));
      promotion = {
        discountType: 'percentage',
        discountValue: selected.reduction,
        validUntil: validUntil(selected.to),
      };
    } else if (selected.reductionType === 'amount') {
      // PrestaShop defines reduction_tax=0 as a tax-excluded amount. This is
      // deliberately applied in net space; reduction_tax=1 is gross and is
      // converted back to net before the final tax calculation.
      const reductionNet = selected.reductionTax === 1
        ? decimal(selected.reduction).div(decimal(1).plus(input.context.taxRate))
        : decimal(selected.reduction);
      finalNet = finalNet.minus(reductionNet);
      promotion = {
        discountType: 'amount',
        discountValue: selected.reduction,
        validUntil: validUntil(selected.to),
      };
    }
  }

  const finalGross = toCurrencyInteger(Decimal.max(finalNet, 0).mul(decimal(1).plus(input.context.taxRate)));
  return {
    regularGross,
    finalGross,
    discounted: finalGross < regularGross,
    promotion,
  };
}

function validUntil(value: string | Date | null): string | null {
  if (value === null || value === '0000-00-00 00:00:00') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function aggregateAvailableQuantity(product: CatalogV2Product): number | null {
  if (product.variants.length === 0) return null;
  if (product.variants.some((variant) => variant.availableQuantity === null)) return null;
  return product.variants.reduce((total, variant) => total + (variant.availableQuantity ?? 0), 0);
}

export function chooseBestSellability(results: readonly SellabilityResult[]): SellabilityResult {
  const priority: Record<Sellability, number> = {
    sellable: 0,
    backorder: 1,
    check_with_staff: 2,
    not_sellable: 3,
  };
  return [...results].sort((left, right) => priority[left.sellability] - priority[right.sellability])[0]
    ?? { sellability: 'check_with_staff', reason: 'stock_unknown' };
}

// The product base is intentionally not part of the public identity when
// variants exist. It is used only as an internal aggregate for product search.
export function productPriceVariants(product: CatalogV2Product): CatalogV2Variant[] {
  if (product.variants.length > 0) return product.variants;
  return [{
    combinationId: 0,
    sku: product.sku,
    attributes: [],
    impactPriceNet: 0,
    isDefault: true,
    availableQuantity: null,
    outOfStock: null,
  }];
}
