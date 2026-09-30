import { describe, expect, it } from 'vitest';
import { MySqlCatalogV2DataReader } from '../../src/infrastructure/catalog/mysqlCatalogV2DataReader.js';

/**
 * SQL-level regressions found by running the v2 reader against a real
 * MariaDB with a PrestaShop schema (R4-J1C). The fake pool records the SQL
 * and answers one simple product.
 */
function recordingPool() {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const pool = {
    async query(options: { sql: string; values: unknown[] }) {
      queries.push({ sql: options.sql, values: options.values });
      if (options.sql.includes('AS basePriceNet')) {
        return [[{ productId: 10, name: 'Barra', sku: 'B-10', shortDescription: null, linkRewrite: null, weightKg: 1, basePriceNet: 1000, active: 1, listed: 1, visibility: 'both', orderable: 1, categoryId: null, categoryName: null, brand: null }], []];
      }
      if (options.sql.includes('AS name') && options.sql.includes('feature_product')) {
        return [[{ productId: 10, name: '   ', value: 'x' }, { productId: 10, name: ' Largo ', value: '220 cm' }], []];
      }
      return [[], []];
    },
  };
  return { pool, queries };
}

describe('MySqlCatalogV2DataReader SQL', () => {
  it('escapes LIKE wildcards with a sql_mode-independent escape character', async () => {
    const { pool, queries } = recordingPool();
    await new MySqlCatalogV2DataReader(pool as never).readProducts({ query: '50%_off!' });
    const products = queries.find((q) => q.sql.includes('AS basePriceNet'))!;
    // A backslash escape is a syntax error under the default sql_mode (it escapes the closing quote).
    expect(products.sql).not.toMatch(/ESCAPE '\\/u);
    expect(products.sql).toContain("ESCAPE '!'");
    expect(products.values).toContain('%50!%!_off!!%');
  });

  it('reads feature values only from feature_value_lang (ps_feature_value has no custom_value column)', async () => {
    const { pool, queries } = recordingPool();
    const { products } = await new MySqlCatalogV2DataReader(pool as never).readProducts({ productIds: [10] });
    const features = queries.find((q) => q.sql.includes('feature_product'))!;
    expect(features.sql).not.toContain('custom_value');
    // A whitespace-only feature name is not a specification; names are trimmed.
    expect(products[0]?.specifications).toEqual([{ name: 'Largo', value: '220 cm' }]);
  });

  it('maps the PrestaShop zero datetime of a specific price to an unbounded (NULL) window', async () => {
    const { pool, queries } = recordingPool();
    await new MySqlCatalogV2DataReader(pool as never).readProducts({ productIds: [10] });
    const prices = queries.find((q) => q.sql.includes('specific_price'))!;
    expect(prices.sql).toContain("NULLIF(sp.`from`, '0000-00-00 00:00:00') AS `from`");
    expect(prices.sql).toContain("NULLIF(sp.`to`, '0000-00-00 00:00:00') AS `to`");
  });
});
