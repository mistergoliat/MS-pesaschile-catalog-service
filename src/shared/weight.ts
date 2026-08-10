import { Decimal, decimal } from './money.js';

const WEIGHT_DECIMAL_PLACES = 3;

export function toWeightKg(value: number | string): number {
  return decimal(value).toDecimalPlaces(WEIGHT_DECIMAL_PLACES, Decimal.ROUND_HALF_UP).toNumber();
}
