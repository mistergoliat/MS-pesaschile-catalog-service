import { describe, expect, it } from 'vitest';
import { batchRequestSchema, productQuerySchema, searchQuerySchema } from '../../src/shared/contracts.js';

describe('validation schemas', () => {
  it('accepts search inputs and normalizes booleans', () => {
    const parsed = searchQuerySchema.parse({ q: 'disco bumper', limit: '5', includeOutOfStock: 'false' });
    expect(parsed).toMatchObject({ q: 'disco bumper', limit: 5, includeOutOfStock: false });
  });

  it('accepts product detail inputs', () => {
    const parsed = productQuerySchema.parse({ combinationId: '20', quantity: '2' });
    expect(parsed).toMatchObject({ combinationId: 20, quantity: 2 });
  });

  it('accepts batch inputs', () => {
    const parsed = batchRequestSchema.parse({ items: [{ productId: 1, quantity: 2 }] });
    expect(parsed.items[0]?.combinationId).toBe(0);
    expect(parsed.items[0]?.quantity).toBe(2);
  });
});
