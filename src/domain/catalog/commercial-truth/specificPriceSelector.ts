import type {
  CatalogCommercialContext,
  CatalogCommercialProductReference,
  CatalogCommercialSpecificPrice,
  CatalogCommercialWarning,
} from './contracts.js';

type SelectionInput = {
  readonly product: CatalogCommercialProductReference;
  readonly combinationId: number;
  readonly specificPrices: readonly CatalogCommercialSpecificPrice[];
  readonly context: CatalogCommercialContext;
  readonly evaluatedAt: Date;
};

type ScoredSpecificPrice = {
  readonly row: CatalogCommercialSpecificPrice;
  readonly score: readonly number[];
};

export type SpecificPriceSelection = {
  readonly selected: CatalogCommercialSpecificPrice | null;
  readonly warnings: readonly CatalogCommercialWarning[];
};

export class SpecificPriceSelector {
  select(input: SelectionInput): SpecificPriceSelection {
    const warnings: CatalogCommercialWarning[] = [];
    const compatible: ScoredSpecificPrice[] = [];

    for (const row of input.specificPrices) {
      const dateWindow = activeDateWindow(row, input.evaluatedAt);
      if (dateWindow === 'invalid') {
        warnings.push(warning('SPECIFIC_PRICE_INVALID_DATE', input.product, { specificPriceId: row.idSpecificPrice }));
        continue;
      }
      if (dateWindow === 'inactive') continue;
      if (!isCompatible(row, input)) continue;
      compatible.push({ row, score: specificityScore(row, input) });
    }

    compatible.sort(compareScoredSpecificPrices);
    const selected = compatible[0]?.row ?? null;
    const second = compatible[1];
    if (selected && second && compareScoreWithoutId(compatible[0]!.score, second.score) === 0) {
      warnings.push(warning('SPECIFIC_PRICE_SELECTION_AMBIGUOUS', input.product, {
        selectedSpecificPriceId: selected.idSpecificPrice,
        alternativeSpecificPriceId: second.row.idSpecificPrice,
      }));
    }

    return { selected, warnings };
  }
}

function warning(
  code: CatalogCommercialWarning['code'],
  product: CatalogCommercialProductReference,
  details?: CatalogCommercialWarning['details'],
): CatalogCommercialWarning {
  return details === undefined ? { code, product } : { code, product, details };
}

function parseDate(value: string | Date | null): Date | null | 'invalid' {
  if (value === null || value === '0000-00-00 00:00:00') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

function activeDateWindow(
  row: CatalogCommercialSpecificPrice,
  evaluatedAt: Date,
): 'active' | 'inactive' | 'invalid' {
  const from = parseDate(row.from);
  const to = parseDate(row.to);
  if (from === 'invalid' || to === 'invalid') return 'invalid';
  if (from && from.getTime() > evaluatedAt.getTime()) return 'inactive';
  if (to && to.getTime() < evaluatedAt.getTime()) return 'inactive';
  return 'active';
}

function isCompatible(row: CatalogCommercialSpecificPrice, input: SelectionInput): boolean {
  return (
    row.cartId === 0 &&
    row.fromQuantity <= input.context.quantity &&
    (row.combinationId === 0 || row.combinationId === input.combinationId) &&
    (row.shopId === 0 || row.shopId === input.context.shopId) &&
    (row.currencyId === 0 || row.currencyId === input.context.currencyId) &&
    (row.countryId === 0 || row.countryId === input.context.countryId) &&
    (row.groupId === 0 || row.groupId === input.context.customerGroupId) &&
    (row.customerId === 0 || row.customerId === input.context.customerId)
  );
}

function fromTime(row: CatalogCommercialSpecificPrice): number {
  const from = parseDate(row.from);
  return from instanceof Date ? from.getTime() : 0;
}

function specificityScore(row: CatalogCommercialSpecificPrice, input: SelectionInput): readonly number[] {
  const contextSpecificity = [
    row.currencyId === input.context.currencyId ? 1 : 0,
    row.countryId === input.context.countryId ? 1 : 0,
    row.groupId === input.context.customerGroupId ? 1 : 0,
    row.customerId === input.context.customerId ? 1 : 0,
  ].reduce((total, value) => total + value, 0);

  return [
    row.combinationId === input.combinationId && input.combinationId > 0 ? 1 : 0,
    row.shopId === input.context.shopId ? 1 : 0,
    row.fromQuantity,
    contextSpecificity,
    fromTime(row),
    row.idSpecificPrice,
  ];
}

function compareScoredSpecificPrices(left: ScoredSpecificPrice, right: ScoredSpecificPrice): number {
  for (let index = 0; index < left.score.length; index += 1) {
    const diff = right.score[index]! - left.score[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function compareScoreWithoutId(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length - 1; index += 1) {
    const diff = right[index]! - left[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}
