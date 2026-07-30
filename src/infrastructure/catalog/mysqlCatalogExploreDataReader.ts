import type { Pool, RowDataPacket } from 'mysql2/promise';
import type {
  CatalogCommercialContext,
  CatalogCommercialSpecificPrice,
} from '../../domain/catalog/commercial-truth/index.js';
import type {
  CatalogExploreDataReader,
  ExploreCatalogData,
  ExploreCatalogProductRow,
} from '../../application/catalog/explore-products/index.js';
import { DISCOVERY_EXCLUDED_PRODUCT_IDS } from '../../domain/catalog/discoveryExclusionPolicy.js';
import { config } from '../../shared/config.js';
import { stripHtml } from '../../shared/html.js';
import { runQuery } from '../database/queries.js';

type CategoryRow = RowDataPacket & {
  categoryId: number;
};

type ProductRow = RowDataPacket & {
  productId: number;
  name: string;
  reference: string | null;
  description: string | null;
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  defaultCategorySlug: string | null;
  categoryIds: string | null;
  categoryNames: string | null;
  categorySlugs: string | null;
  attributeText: string | null;
  featureText: string | null;
  hasCombinations: number;
  defaultCombinationId: number | null;
  productBasePriceNet: number | null;
  combinationImpactNet: number | null;
  active: number | null;
  availableForOrder: number | null;
  stockQuantity: number | null;
};

type SpecificPriceRow = RowDataPacket & {
  id_specific_price: number;
  id_product: number;
  id_product_attribute: number;
  id_shop: number;
  id_currency: number;
  id_country: number;
  id_group: number;
  id_customer: number;
  id_cart: number;
  price: number;
  from_quantity: number;
  reduction: number;
  reduction_tax: number;
  reduction_type: string;
  from: string | Date | null;
  to: string | Date | null;
};

function table(name: string): string {
  return `${config.prestashop.prefix}${name}`;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function splitAggregated(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split('|').map((item) => item.trim()).filter(Boolean))];
}

function normalizeNullableNumber(value: number | null): number | null {
  return value === null || !Number.isFinite(Number(value)) ? null : Number(value);
}

export class MySqlCatalogExploreDataReader implements CatalogExploreDataReader {
  constructor(
    private readonly pool: Pool,
    private readonly scope = {
      shopId: config.prestashop.shopId,
      langId: config.prestashop.langId,
    },
    private readonly timeoutMs = config.db.queryTimeoutMs,
  ) {}

  async resolveCategory(input: {
    readonly categoryId?: string;
    readonly categorySlug?: string;
  }): Promise<{ readonly found: boolean; readonly categoryIds: readonly string[] }> {
    const clauses: string[] = [];
    const params: unknown[] = [this.scope.shopId, this.scope.langId];
    if (input.categoryId !== undefined) {
      clauses.push('c.id_category = ?');
      params.push(Number(input.categoryId));
    }
    if (input.categorySlug !== undefined) {
      clauses.push('cl.link_rewrite = ?');
      params.push(input.categorySlug);
    }
    if (clauses.length === 0) {
      return { found: true, categoryIds: [] };
    }

    const rows = await runQuery<CategoryRow[]>(
      this.pool,
      'catalog-explore-category',
      `
        SELECT c.id_category AS categoryId
        FROM ${table('category')} c
        INNER JOIN ${table('category_lang')} cl
          ON cl.id_category = c.id_category
          AND cl.id_shop = ?
          AND cl.id_lang = ?
        WHERE ${clauses.join(' AND ')}
      `,
      params,
      this.timeoutMs,
    );

    const categoryIds = rows.map((row) => String(row.categoryId));
    return {
      found: categoryIds.length > 0,
      categoryIds,
    };
  }

  async readProducts(input: {
    readonly categoryIds?: readonly string[];
    readonly context: CatalogCommercialContext;
  }): Promise<ExploreCatalogData> {
    const productRows = await this.readProductRows(input.categoryIds);
    const productIds = productRows.map((row) => Number(row.productId));
    const specificPrices = productIds.length === 0
      ? []
      : await this.readSpecificPrices(productIds, input.context);

    return {
      products: productRows.map((row) => ({
        productId: String(row.productId),
        name: String(row.name),
        reference: row.reference?.trim() || null,
        description: stripHtml(row.description),
        defaultCategoryId: row.defaultCategoryId === null ? null : String(row.defaultCategoryId),
        defaultCategoryName: row.defaultCategoryName?.trim() || null,
        defaultCategorySlug: row.defaultCategorySlug?.trim() || null,
        categoryIds: splitAggregated(row.categoryIds),
        categoryNames: splitAggregated(row.categoryNames),
        categorySlugs: splitAggregated(row.categorySlugs),
        attributeText: row.attributeText?.trim() || null,
        featureText: row.featureText?.trim() || null,
        hasCombinations: Boolean(row.hasCombinations),
        defaultCombinationId: row.defaultCombinationId === null ? null : String(row.defaultCombinationId),
        productBasePriceNet: normalizeNullableNumber(row.productBasePriceNet),
        combinationImpactNet: normalizeNullableNumber(row.combinationImpactNet),
        active: row.active === null ? null : Boolean(row.active),
        availableForOrder: row.availableForOrder === null ? null : Boolean(row.availableForOrder),
        stockQuantity: normalizeNullableNumber(row.stockQuantity),
      } satisfies ExploreCatalogProductRow)),
      specificPrices,
      exhaustiveForScope: true,
    };
  }

  private async readProductRows(categoryIds: readonly string[] | undefined): Promise<ProductRow[]> {
    const categoryFilter = categoryIds && categoryIds.length > 0
      ? `AND EXISTS (
          SELECT 1
          FROM ${table('category_product')} cpf
          WHERE cpf.id_product = p.id_product
            AND cpf.id_category IN (${placeholders(categoryIds)})
        )`
      : '';

    return runQuery<ProductRow[]>(
      this.pool,
      'catalog-explore-products',
      `
        SELECT
          p.id_product AS productId,
          pl.name AS name,
          NULLIF(TRIM(p.reference), '') AS reference,
          pl.description_short AS description,
          p.id_category_default AS defaultCategoryId,
          NULLIF(TRIM(default_cl.name), '') AS defaultCategoryName,
          NULLIF(TRIM(default_cl.link_rewrite), '') AS defaultCategorySlug,
          category_agg.categoryIds AS categoryIds,
          category_agg.categoryNames AS categoryNames,
          category_agg.categorySlugs AS categorySlugs,
          attribute_agg.attributeText AS attributeText,
          feature_agg.featureText AS featureText,
          CASE WHEN combo_agg.combinationCount > 0 THEN 1 ELSE 0 END AS hasCombinations,
          defpa.id_product_attribute AS defaultCombinationId,
          COALESCE(ps.price, p.price) AS productBasePriceNet,
          COALESCE(defpas.price, defpa.price, 0) AS combinationImpactNet,
          p.active AS active,
          COALESCE(ps.available_for_order, p.available_for_order) AS availableForOrder,
          stock_agg.stockQuantity AS stockQuantity
        FROM ${table('product')} p
        INNER JOIN ${table('product_lang')} pl
          ON pl.id_product = p.id_product
          AND pl.id_shop = ?
          AND pl.id_lang = ?
        LEFT JOIN ${table('product_shop')} ps
          ON ps.id_product = p.id_product
          AND ps.id_shop = ?
        LEFT JOIN ${table('category_lang')} default_cl
          ON default_cl.id_category = p.id_category_default
          AND default_cl.id_shop = ?
          AND default_cl.id_lang = ?
        LEFT JOIN (
          SELECT
            cp.id_product,
            GROUP_CONCAT(DISTINCT cp.id_category ORDER BY cp.id_category SEPARATOR '|') AS categoryIds,
            GROUP_CONCAT(DISTINCT NULLIF(TRIM(cl.name), '') ORDER BY cp.id_category SEPARATOR '|') AS categoryNames,
            GROUP_CONCAT(DISTINCT NULLIF(TRIM(cl.link_rewrite), '') ORDER BY cp.id_category SEPARATOR '|') AS categorySlugs
          FROM ${table('category_product')} cp
          LEFT JOIN ${table('category_lang')} cl
            ON cl.id_category = cp.id_category
            AND cl.id_shop = ?
            AND cl.id_lang = ?
          GROUP BY cp.id_product
        ) category_agg
          ON category_agg.id_product = p.id_product
        LEFT JOIN (
          SELECT
            pa.id_product,
            COUNT(DISTINCT pa.id_product_attribute) AS combinationCount
          FROM ${table('product_attribute')} pa
          GROUP BY pa.id_product
        ) combo_agg
          ON combo_agg.id_product = p.id_product
        LEFT JOIN (
          SELECT
            pa.id_product,
            GROUP_CONCAT(
              DISTINCT NULLIF(TRIM(CONCAT(COALESCE(agl.name, ''), ' ', COALESCE(al.name, ''))), '')
              ORDER BY agl.name, al.name
              SEPARATOR ' | '
            ) AS attributeText
          FROM ${table('product_attribute')} pa
          LEFT JOIN ${table('product_attribute_combination')} pac
            ON pac.id_product_attribute = pa.id_product_attribute
          LEFT JOIN ${table('attribute')} a
            ON a.id_attribute = pac.id_attribute
          LEFT JOIN ${table('attribute_lang')} al
            ON al.id_attribute = a.id_attribute
            AND al.id_lang = ?
          LEFT JOIN ${table('attribute_group_lang')} agl
            ON agl.id_attribute_group = a.id_attribute_group
            AND agl.id_lang = ?
          GROUP BY pa.id_product
        ) attribute_agg
          ON attribute_agg.id_product = p.id_product
        LEFT JOIN (
          SELECT
            fp.id_product,
            GROUP_CONCAT(
              DISTINCT NULLIF(TRIM(CONCAT(COALESCE(fgl.name, ''), ' ', COALESCE(fvl.value, ''))), '')
              ORDER BY fgl.name, fvl.value
              SEPARATOR ' | '
            ) AS featureText
          FROM ${table('feature_product')} fp
          LEFT JOIN ${table('feature_lang')} fgl
            ON fgl.id_feature = fp.id_feature
            AND fgl.id_lang = ?
          LEFT JOIN ${table('feature_value_lang')} fvl
            ON fvl.id_feature_value = fp.id_feature_value
            AND fvl.id_lang = ?
          GROUP BY fp.id_product
        ) feature_agg
          ON feature_agg.id_product = p.id_product
        LEFT JOIN (
          SELECT pa_default.id_product, MIN(pa_default.id_product_attribute) AS id_product_attribute
          FROM ${table('product_attribute')} pa_default
          WHERE COALESCE(pa_default.default_on, 0) = 1
          GROUP BY pa_default.id_product
        ) default_combo
          ON default_combo.id_product = p.id_product
        LEFT JOIN ${table('product_attribute')} defpa
          ON defpa.id_product_attribute = default_combo.id_product_attribute
        LEFT JOIN ${table('product_attribute_shop')} defpas
          ON defpas.id_product_attribute = defpa.id_product_attribute
          AND defpas.id_shop = ?
        LEFT JOIN (
          SELECT
            sa.id_product,
            CASE
              WHEN MAX(CASE WHEN sa.id_product_attribute > 0 THEN 1 ELSE 0 END) = 1
                THEN SUM(CASE WHEN sa.id_product_attribute > 0 THEN COALESCE(sa.physical_quantity, 0) ELSE 0 END)
              ELSE MAX(CASE WHEN sa.id_product_attribute = 0 THEN sa.physical_quantity ELSE NULL END)
            END AS stockQuantity
          FROM ${table('stock_available')} sa
          WHERE sa.id_shop = ?
          GROUP BY sa.id_product
        ) stock_agg
          ON stock_agg.id_product = p.id_product
        WHERE 1 = 1
          AND p.id_product NOT IN (${placeholders(DISCOVERY_EXCLUDED_PRODUCT_IDS)})
          ${categoryFilter}
        ORDER BY p.id_product ASC
      `,
      [
        this.scope.shopId,
        this.scope.langId,
        this.scope.shopId,
        this.scope.shopId,
        this.scope.langId,
        this.scope.shopId,
        this.scope.langId,
        this.scope.langId,
        this.scope.langId,
        this.scope.langId,
        this.scope.langId,
        this.scope.shopId,
        this.scope.shopId,
        ...DISCOVERY_EXCLUDED_PRODUCT_IDS,
        ...(categoryIds ?? []).map((id) => Number(id)),
      ],
      this.timeoutMs,
    );
  }

  private async readSpecificPrices(
    productIds: readonly number[],
    context: CatalogCommercialContext,
  ): Promise<CatalogCommercialSpecificPrice[]> {
    const rows = await runQuery<SpecificPriceRow[]>(
      this.pool,
      'catalog-explore-specific-prices',
      `
        SELECT
          id_specific_price,
          id_product,
          id_product_attribute,
          id_shop,
          id_currency,
          id_country,
          id_group,
          id_customer,
          id_cart,
          price,
          from_quantity,
          reduction,
          reduction_tax,
          reduction_type,
          \`from\`,
          \`to\`
        FROM ${table('specific_price')}
        WHERE id_product IN (${placeholders(productIds)})
          AND id_shop IN (0, ?)
          AND id_currency IN (0, ?)
          AND id_country IN (0, ?)
          AND id_group IN (0, ?)
          AND id_customer IN (0, ?)
          AND id_cart = 0
          AND from_quantity <= ?
      `,
      [
        ...productIds,
        context.shopId,
        context.currencyId,
        context.countryId,
        context.customerGroupId,
        context.customerId,
        context.quantity,
      ],
      this.timeoutMs,
    );

    return rows.map((row) => ({
      idSpecificPrice: Number(row.id_specific_price),
      productId: Number(row.id_product),
      combinationId: Number(row.id_product_attribute),
      shopId: Number(row.id_shop),
      currencyId: Number(row.id_currency),
      countryId: Number(row.id_country),
      groupId: Number(row.id_group),
      customerId: Number(row.id_customer),
      cartId: Number(row.id_cart),
      price: Number(row.price),
      fromQuantity: Number(row.from_quantity),
      reduction: Number(row.reduction),
      reductionTax: Number(row.reduction_tax),
      reductionType: String(row.reduction_type),
      from: row.from,
      to: row.to,
    }));
  }
}
