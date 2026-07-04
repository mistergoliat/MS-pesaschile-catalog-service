import { describe, expect, it, vi } from 'vitest';
import { MemoryCacheProvider } from '../../src/infrastructure/cache/memory.js';
import { RequestCoalescer } from '../../src/shared/coalescer.js';
import { priceCacheKey, productCacheKey, searchCacheKey, stockCacheKey } from '../../src/shared/cacheKeys.js';

describe('MemoryCacheProvider', () => {
  it('stores, reads and expires values', async () => {
    const cache = new MemoryCacheProvider();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    await cache.set('key', { value: 1 }, 1);
    expect(await cache.get('key')).toEqual({ value: 1 });

    vi.setSystemTime(new Date('2026-01-01T00:00:01.500Z'));
    expect(await cache.get('key')).toBeNull();
    vi.useRealTimers();
  });

  it('reports ping true', async () => {
    const cache = new MemoryCacheProvider();
    expect(await cache.ping()).toBe(true);
  });
});

describe('RequestCoalescer', () => {
  it('deduplicates concurrent work for the same key', async () => {
    const coalescer = new RequestCoalescer();
    const loader = vi.fn().mockResolvedValue('value');

    const [a, b] = await Promise.all([coalescer.run('k', loader), coalescer.run('k', loader)]);

    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(loader).toHaveBeenCalledOnce();
  });
});

describe('cache keys', () => {
  it('include the search context', () => {
    expect(searchCacheKey({ query: 'Disco', limit: 5, includeOutOfStock: false })).toBe(
      'search:disco:5:0',
    );
  });

  it('include product context', () => {
    const key = productCacheKey({
      shopId: 1,
      productId: 10,
      combinationId: 20,
      quantity: 2,
      customerId: 3,
      customerGroupId: 4,
      currencyId: 5,
      countryId: 6,
    });

    expect(key).toBe('product:1:10:20:2:3:4:5:6');
  });

  it('include price context', () => {
    const key = priceCacheKey({
      shopId: 1,
      productId: 10,
      combinationId: 20,
      quantity: 2,
      customerId: 3,
      customerGroupId: 4,
      currencyId: 5,
      countryId: 6,
    });

    expect(key).toBe('price:1:10:20:2:3:4:5:6');
  });

  it('include stock context', () => {
    expect(stockCacheKey({ shopId: 1, productId: 10, combinationId: 20 })).toBe('stock:1:10:20');
  });
});
