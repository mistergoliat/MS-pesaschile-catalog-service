import DecimalJs from 'decimal.js';

type DecimalValue = string | number | bigint;

export type DecimalInstance = {
  plus(value: DecimalValue | DecimalInstance): DecimalInstance;
  minus(value: DecimalValue | DecimalInstance): DecimalInstance;
  mul(value: DecimalValue | DecimalInstance): DecimalInstance;
  div(value: DecimalValue | DecimalInstance): DecimalInstance;
  max(value: DecimalValue | DecimalInstance): DecimalInstance;
  toDecimalPlaces(decimalPlaces: number, rounding?: number): DecimalInstance;
  toNumber(): number;
  toString(): string;
};

type DecimalStatic = {
  new (value: DecimalValue | DecimalInstance): DecimalInstance;
  set(options: { precision: number; rounding: number }): void;
  ROUND_HALF_UP: number;
  max(...values: Array<DecimalValue | DecimalInstance>): DecimalInstance;
};

export const Decimal = DecimalJs as unknown as DecimalStatic;

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export function decimal(value: DecimalValue | DecimalInstance): DecimalInstance {
  return new Decimal(value);
}

export function toCurrencyInteger(value: DecimalValue | DecimalInstance): number {
  return decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function toPercent(value: DecimalValue | DecimalInstance): number {
  return Number(decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString());
}
