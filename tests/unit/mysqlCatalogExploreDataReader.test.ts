import { describe, expect, it } from 'vitest';
import { MySqlCatalogExploreDataReader } from '../../src/infrastructure/catalog/mysqlCatalogExploreDataReader.js';
import type { CatalogCommercialContext } from '../../src/domain/catalog/commercial-truth/index.js';

type QueryCall = {
  readonly sql: string;
  readonly values: readonly unknown[];
};

function poolWithRows(rows: readonly unknown[][]) {
  const calls: QueryCall[] = [];
  return {
    calls,
    pool: {
      async query(options: { sql: string; values: readonly unknown[] }) {
        calls.push({ sql: options.sql, values: options.values });
        return [rows[calls.length - 1] ?? [], undefined];
      },
    },
  };
}

const context: CatalogCommercialContext = {
  shopId: 1,
  currencyId: 1,
  currencyCode: 'CLP',
  countryId: 0,
  customerGroupId: 0,
  customerId: 0,
  quantity: 1,
  taxRate: 0.19,
};

describe('MySqlCatalogExploreDataReader', () => {
  it('resolves category slugs in the configured shop and language', async () => {
    const fake = poolWithRows([[{ categoryId: 22 }]]);
    const reader = new MySqlCatalogExploreDataReader(fake.pool as never);

    const result = await reader.resolveCategory({ categorySlug: 'maquinas' });

    expect(result).toEqual({ found: true, categoryIds: ['22'] });
    expect(fake.calls[0]?.sql).toContain('cl.id_shop = ?');
    expect(fake.calls[0]?.sql).toContain('cl.id_lang = ?');
    expect(fake.calls[0]?.values).toEqual([1, 1, 'maquinas']);
  });

  it('reads explore products without pagination or active filtering', async () => {
    const fake = poolWithRows([
      [
        {
          productId: 173,
          name: 'Maquina',
          reference: 'M-173',
          description: '<p>Texto</p>',
          defaultCategoryId: 22,
          defaultCategoryName: 'Maquinas',
          defaultCategorySlug: 'maquinas',
          categoryIds: '22|23',
          categoryNames: 'Maquinas|Ofertas',
          categorySlugs: 'maquinas|ofertas',
          attributeText: 'Linea Profesional',
          featureText: 'Uso Comercial',
          hasCombinations: 0,
          defaultCombinationId: null,
          productBasePriceNet: 1000,
          combinationImpactNet: 0,
          active: 1,
          availableForOrder: 1,
          stockQuantity: 7,
        },
      ],
      [],
    ]);
    const reader = new MySqlCatalogExploreDataReader(fake.pool as never);

    const result = await reader.readProducts({ context });

    expect(fake.calls[0]?.sql).not.toMatch(/\bLIMIT\b/iu);
    expect(fake.calls[0]?.sql).not.toContain('p.active = 1');
    expect(result.exhaustiveForScope).toBe(true);
    expect(result.products[0]).toMatchObject({
      productId: '173',
      description: 'Texto',
      categoryIds: ['22', '23'],
      categoryNames: ['Maquinas', 'Ofertas'],
      categorySlugs: ['maquinas', 'ofertas'],
      stockQuantity: 7,
    });
  });

  it('pushes category scope into the complete product read', async () => {
    const fake = poolWithRows([[], []]);
    const reader = new MySqlCatalogExploreDataReader(fake.pool as never);

    await reader.readProducts({ categoryIds: ['22', '23'], context });

    expect(fake.calls[0]?.sql).toContain('p.id_product NOT IN (?, ?)');
    expect(fake.calls[0]?.values.slice(-4)).toEqual([444, 505, 22, 23]);
    expect(fake.calls[0]?.sql).toContain('cpf.id_category IN (?, ?)');
  });

  it('reads compatible specific prices for all scoped products', async () => {
    const fake = poolWithRows([
      [
        {
          productId: 173,
          name: 'Maquina',
          reference: null,
          description: null,
          defaultCategoryId: 22,
          defaultCategoryName: 'Maquinas',
          defaultCategorySlug: 'maquinas',
          categoryIds: '22',
          categoryNames: 'Maquinas',
          categorySlugs: 'maquinas',
          attributeText: null,
          featureText: null,
          hasCombinations: 0,
          defaultCombinationId: null,
          productBasePriceNet: 1000,
          combinationImpactNet: 0,
          active: 1,
          availableForOrder: 1,
          stockQuantity: 7,
        },
      ],
      [
        {
          id_specific_price: 10,
          id_product: 173,
          id_product_attribute: 0,
          id_shop: 0,
          id_currency: 0,
          id_country: 0,
          id_group: 0,
          id_customer: 0,
          id_cart: 0,
          price: -1,
          from_quantity: 1,
          reduction: 0.1,
          reduction_tax: 1,
          reduction_type: 'percentage',
          from: null,
          to: null,
        },
      ],
    ]);
    const reader = new MySqlCatalogExploreDataReader(fake.pool as never);

    const result = await reader.readProducts({ context });

    expect(fake.calls[1]?.sql).toContain('id_product IN (?)');
    expect(result.specificPrices[0]).toMatchObject({
      idSpecificPrice: 10,
      productId: 173,
      reductionType: 'percentage',
    });
  });
});
