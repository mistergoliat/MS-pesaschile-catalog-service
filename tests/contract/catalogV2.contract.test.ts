import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogSearchResponseSchema, itemContextResponseSchema, productContextResponseSchema } from '../../src/domain/catalog/v2/contracts.js';

const fixtureDir = path.resolve('contracts/catalog/v2/fixtures');

describe('published Catalog v2 fixtures', () => {
  it('validates every search fixture against the executable schema', () => {
    for (const file of readdirSync(fixtureDir).filter((name) => name.startsWith('search-'))) {
      const parsed = catalogSearchResponseSchema.safeParse(JSON.parse(readFileSync(path.join(fixtureDir, file), 'utf8')));
      expect(parsed.success, file).toBe(true);
    }
  });

  it('validates every product context fixture against the executable schema', () => {
    for (const file of readdirSync(fixtureDir).filter((name) => name.startsWith('product-'))) {
      const parsed = productContextResponseSchema.safeParse(JSON.parse(readFileSync(path.join(fixtureDir, file), 'utf8')));
      expect(parsed.success, file).toBe(true);
    }
  });

  it('validates every sellable item fixture against the executable schema', () => {
    for (const file of readdirSync(fixtureDir).filter((name) => name.startsWith('item-'))) {
      const parsed = itemContextResponseSchema.safeParse(JSON.parse(readFileSync(path.join(fixtureDir, file), 'utf8')));
      expect(parsed.success, file).toBe(true);
    }
  });
});
