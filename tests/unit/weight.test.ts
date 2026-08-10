import { describe, expect, it } from 'vitest';
import { toWeightKg } from '../../src/shared/weight.js';

describe('toWeightKg', () => {
  it('passes through a whole-number decimal cleanly', () => {
    expect(toWeightKg(20)).toBe(20);
  });

  it('preserves a small decimal', () => {
    expect(toWeightKg(0.1)).toBe(0.1);
  });

  it('rounds down at the 4th decimal below the half-up boundary', () => {
    expect(toWeightKg(20.1234)).toBe(20.123);
  });

  it('rounds up at the 4th decimal exactly at the half-up boundary', () => {
    expect(toWeightKg(20.1235)).toBe(20.124);
  });

  it('preserves a literal zero', () => {
    expect(toWeightKg(0)).toBe(0);
  });
});
