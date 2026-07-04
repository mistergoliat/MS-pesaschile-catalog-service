import type { Pool, RowDataPacket } from 'mysql2/promise';
import type {
  CatalogRepository,
  SearchCandidate,
  SpecificPriceRow,
} from '../../domain/catalog/ports.js';
import type { AttributeValue, CatalogScope, ProductCore, VariantSummary } from '../../domain/catalog/types.js';
import { config } from '../../shared/config.js';
import { stripHtml } from '../../shared/html.js';
import { runQuery } from '../database/queries.js';

type ProductCoreRow = RowDataPacket & {
  id_product: number;
  name: string;
  sku: string | null;
  description_short: string | null;
  description: string | null;
};

type VariantRow = RowDataPacket & {
  combinationId: number;
  sku: string | null;
  label: string | null;
  impactPrice: number;
  physicalQuantity: number;
  isDefault: number;
};

type SearchCandidateRow = RowDataPacket & SearchCandidate;

type StockRow = RowDataPacket & {
  combinationId: number;
  physicalQuantity: number;
  shopId: number;
};

function table(name: string): string {
  return `${config.prestashop.prefix}${name}`;
}

function normalizeSku(primary: string | null, fallback: string | null): string | null {
  return primary?.trim() || fallback?.trim() || null;
}

export class MySqlCatalogRepository implements CatalogRepository {
  constructor(
    private readonly pool: Pool,
    private readonly scope: CatalogScope = {
      shopId: config.prestashop.shopId,
      langId: config.prestashop.langId,
    },
    private readonly timeoutMs = config.db.queryTimeoutMs,
  ) {}

  async ping(): Promise<void> {
    await runQuery(this.pool, 'ping', 'SELECT 1', [], this.timeoutMs);
  }

  async getProductCore(productId: number): Promise<ProductCore | null> {
    const rows = await runQuery<ProductCoreRow[]>(
      this.pool,
      'product-core',
      `
        SELECT
          p.id_product,
          pl.name,
          NULLIF(TRIM(p.reference), '') AS sku,
          pl.description_short,
          pl.description
        FROM ${table('product')} p
        INNER JOIN ${table('product_lang')} pl
          ON pl.id_product = p.id_product
          AND pl.id_shop = ?
          AND pl.id_lang = ?
        WHERE p.id_product = ?
          AND p.active = 1
        LIMIT 1
      `,
      [this.scope.shopId, this.scope.langId, productId],
      this.timeoutMs,
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      productId: row.id_product,
      name: row.name,
      sku: normalizeSku(row.sku, null),
      shortDescription: stripHtml(row.description_short),
      longDescription: stripHtml(row.description),
      active: true,
    };
  }

  async getVariants(productId: number): Promise<VariantSummary[]> {
    const rows = await runQuery<VariantRow[]>(
      this.pool,
      'product-variants',
      `
        SELECT
          pa.id_product_attribute AS combinationId,
          NULLIF(TRIM(pa.reference), '') AS sku,
          GROUP_CONCAT(
            DISTINCT CONCAT(agl.name, ': ', al.name)
            ORDER BY agl.name, al.name
            SEPARATOR ' | '
          ) AS label,
          COALESCE(pas.price, pa.price, 0) AS impactPrice,
          sa.physical_quantity AS physicalQuantity,
          COALESCE(pa.default_on, 0) AS isDefault
        FROM ${table('product')} p
        INNER JOIN ${table('product_attribute')} pa
          ON pa.id_product = p.id_product
        LEFT JOIN ${table('product_attribute_shop')} pas
          ON pas.id_product_attribute = pa.id_product_attribute
          AND pas.id_shop = ?
        INNER JOIN ${table('stock_available')} sa
          ON sa.id_product = p.id_product
          AND sa.id_product_attribute = pa.id_product_attribute
          AND sa.id_shop = ?
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
        WHERE p.id_product = ?
          AND p.active = 1
        GROUP BY
          pa.id_product_attribute,
          pa.reference,
          pa.price,
          pas.price,
          sa.physical_quantity,
          pa.default_on
        ORDER BY pa.default_on DESC, pa.id_product_attribute ASC
      `,
      [this.scope.shopId, this.scope.shopId, this.scope.langId, this.scope.langId, productId],
      this.timeoutMs,
    );
    const attributesMap = await this.getVariantAttributesMap(productId);

    return rows.map((row) => ({
      combinationId: row.combinationId,
      sku: normalizeSku(row.sku, null),
      label: row.label ?? null,
      attributes: attributesMap.get(row.combinationId) ?? [],
      impactPrice: Number(row.impactPrice ?? 0),
      physicalQuantity: Number(row.physicalQuantity ?? 0),
      available: Number(row.physicalQuantity ?? 0) > 0,
      isDefault: Boolean(row.isDefault),
    }));
  }

  async getVariant(productId: number, combinationId: number): Promise<VariantSummary | null> {
    const variants = await this.getVariants(productId);
    return variants.find((variant) => variant.combinationId === combinationId) ?? null;
  }

  async getVariantAttributes(combinationId: number): Promise<AttributeValue[]> {
    if (combinationId === 0) {
      return [];
    }

    const rows = await runQuery<RowDataPacket[]>(
      this.pool,
      'variant-attributes',
      `
        SELECT
          agl.name AS \`group\`,
          al.name AS value
        FROM ${table('product_attribute_combination')} pac
        INNER JOIN ${table('attribute')} a
          ON a.id_attribute = pac.id_attribute
        INNER JOIN ${table('attribute_lang')} al
          ON al.id_attribute = a.id_attribute
          AND al.id_lang = ?
        INNER JOIN ${table('attribute_group_lang')} agl
          ON agl.id_attribute_group = a.id_attribute_group
          AND agl.id_lang = ?
        WHERE pac.id_product_attribute = ?
        ORDER BY agl.name ASC, al.name ASC
      `,
      [this.scope.langId, this.scope.langId, combinationId],
      this.timeoutMs,
    );

    return rows.map((row) => ({ group: String(row.group), value: String(row.value) }));
  }

  async getVariantAttributesMap(productId: number): Promise<Map<number, AttributeValue[]>> {
    const rows = await runQuery<RowDataPacket[]>(
      this.pool,
      'variant-attributes-map',
      `
        SELECT
          pac.id_product_attribute AS combinationId,
          agl.name AS \`group\`,
          al.name AS value
        FROM ${table('product_attribute')} pa
        INNER JOIN ${table('product_attribute_combination')} pac
          ON pac.id_product_attribute = pa.id_product_attribute
        INNER JOIN ${table('attribute')} a
          ON a.id_attribute = pac.id_attribute
        INNER JOIN ${table('attribute_lang')} al
          ON al.id_attribute = a.id_attribute
          AND al.id_lang = ?
        INNER JOIN ${table('attribute_group_lang')} agl
          ON agl.id_attribute_group = a.id_attribute_group
          AND agl.id_lang = ?
        WHERE pa.id_product = ?
        ORDER BY pac.id_product_attribute ASC, agl.name ASC, al.name ASC
      `,
      [this.scope.langId, this.scope.langId, productId],
      this.timeoutMs,
    );

    const map = new Map<number, AttributeValue[]>();
    for (const row of rows) {
      const combinationId = Number(row.combinationId);
      const list = map.get(combinationId) ?? [];
      list.push({ group: String(row.group), value: String(row.value) });
      map.set(combinationId, list);
    }
    return map;
  }

  async getSearchCandidates(
    query: string,
    includeOutOfStock: boolean,
    limit: number,
  ): Promise<SearchCandidate[]> {
    const normalized = query.trim();
    const like = `%${normalized}%`;
    const rows = await runQuery<SearchCandidateRow[]>(
      this.pool,
      'search-candidates',
      `
        SELECT
          p.id_product AS productId,
          COALESCE(pa.id_product_attribute, 0) AS combinationId,
          NULLIF(TRIM(p.reference), '') AS productSku,
          NULLIF(TRIM(pa.reference), '') AS combinationSku,
          pl.name AS productName,
          pl.description_short AS shortDescription,
          pl.description AS longDescription,
          GROUP_CONCAT(
            DISTINCT CONCAT(agl.name, ': ', al.name)
            ORDER BY agl.name, al.name
            SEPARATOR ' | '
          ) AS variantLabel,
          COALESCE(sa.physical_quantity, 0) AS physicalQuantity,
          CASE WHEN COUNT(pa.id_product_attribute) > 0 THEN 1 ELSE 0 END AS hasVariants,
          COALESCE(pa.default_on, 0) AS isDefault,
          p.active AS active
        FROM ${table('product')} p
        INNER JOIN ${table('product_lang')} pl
          ON pl.id_product = p.id_product
          AND pl.id_shop = ?
          AND pl.id_lang = ?
        LEFT JOIN ${table('product_attribute')} pa
          ON pa.id_product = p.id_product
        LEFT JOIN ${table('stock_available')} sa
          ON sa.id_product = p.id_product
          AND sa.id_product_attribute = COALESCE(pa.id_product_attribute, 0)
          AND sa.id_shop = ?
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
        WHERE p.active = 1
          AND (
            p.reference = ?
            OR pa.reference = ?
            OR pl.name = ?
            OR pl.name LIKE ?
            OR pl.description_short LIKE ?
            OR pl.description LIKE ?
          )
          ${includeOutOfStock ? '' : 'AND COALESCE(sa.physical_quantity, 0) > 0'}
        GROUP BY
          p.id_product,
          pa.id_product_attribute,
          p.reference,
          pa.reference,
          pl.name,
          pl.description_short,
          pl.description,
          sa.physical_quantity,
          pa.default_on,
          p.active
        ORDER BY p.id_product ASC, pa.default_on DESC, pa.id_product_attribute ASC
        LIMIT ?
      `,
      [this.scope.shopId, this.scope.langId, this.scope.shopId, this.scope.langId, this.scope.langId, normalized, normalized, normalized, like, like, like, Math.max(limit * 10, 50)],
      this.timeoutMs,
    );

    return rows.map((row) => ({
      productId: row.productId,
      combinationId: row.combinationId,
      productSku: normalizeSku(row.productSku, null),
      combinationSku: normalizeSku(row.combinationSku, null),
      productName: row.productName,
      shortDescription: stripHtml(row.shortDescription),
      longDescription: stripHtml(row.longDescription),
      variantLabel: row.variantLabel ?? null,
      physicalQuantity: Number(row.physicalQuantity ?? 0),
      hasVariants: Boolean(row.hasVariants),
      isDefault: Boolean(row.isDefault),
      active: Boolean(row.active),
    }));
  }

  async getBasePrices(
    productId: number,
    combinationId: number,
  ): Promise<{ productPrice: number; combinationImpact: number }> {
    const rows = await runQuery<RowDataPacket[]>(
      this.pool,
      'base-prices',
      `
        SELECT
          COALESCE(ps.price, p.price, 0) AS productPrice,
          COALESCE(pas.price, pa.price, 0) AS combinationImpact
        FROM ${table('product')} p
        LEFT JOIN ${table('product_shop')} ps
          ON ps.id_product = p.id_product
          AND ps.id_shop = ?
        LEFT JOIN ${table('product_attribute')} pa
          ON pa.id_product = p.id_product
          AND pa.id_product_attribute = ?
        LEFT JOIN ${table('product_attribute_shop')} pas
          ON pas.id_product_attribute = pa.id_product_attribute
          AND pas.id_shop = ?
        WHERE p.id_product = ?
          AND p.active = 1
        LIMIT 1
      `,
      [this.scope.shopId, combinationId, this.scope.shopId, productId],
      this.timeoutMs,
    );

    const row = rows[0];
    return {
      productPrice: Number(row?.productPrice ?? 0),
      combinationImpact: Number(row?.combinationImpact ?? 0),
    };
  }

  async getSpecificPrices(input: {
    productId: number;
    combinationId: number;
    quantity: number;
    shopId: number;
    currencyId: number;
    countryId: number;
    customerGroupId: number;
    customerId: number;
  }): Promise<SpecificPriceRow[]> {
    const rows = await runQuery<RowDataPacket[]>(
      this.pool,
      'specific-prices',
      `
        SELECT
          id_specific_price,
          id_product_attribute,
          id_shop,
          id_currency,
          id_country,
          id_group,
          id_customer,
          price,
          from_quantity,
          reduction,
          reduction_tax,
          reduction_type,
          \`from\`,
          \`to\`
        FROM ${table('specific_price')}
        WHERE id_product = ?
          AND id_cart = 0
          AND id_product_attribute IN (0, ?)
          AND id_shop IN (0, ?)
          AND id_currency IN (0, ?)
          AND id_country IN (0, ?)
          AND id_group IN (0, ?)
          AND id_customer IN (0, ?)
          AND from_quantity <= ?
          AND (\`from\` IS NULL OR \`from\` = '0000-00-00 00:00:00' OR \`from\` <= NOW())
          AND (\`to\` IS NULL OR \`to\` = '0000-00-00 00:00:00' OR \`to\` >= NOW())
      `,
      [
        input.productId,
        input.combinationId,
        input.shopId,
        input.currencyId,
        input.countryId,
        input.customerGroupId,
        input.customerId,
        input.quantity,
      ],
      this.timeoutMs,
    );

    return rows.map((row) => ({
      id_specific_price: Number(row.id_specific_price),
      id_product_attribute: Number(row.id_product_attribute),
      id_shop: Number(row.id_shop),
      id_currency: Number(row.id_currency),
      id_country: Number(row.id_country),
      id_group: Number(row.id_group),
      id_customer: Number(row.id_customer),
      price: Number(row.price),
      from_quantity: Number(row.from_quantity),
      reduction: Number(row.reduction),
      reduction_tax: Number(row.reduction_tax),
      reduction_type: row.reduction_type as 'amount' | 'percentage',
      from: row.from as string | Date | null,
      to: row.to as string | Date | null,
    }));
  }

  async getStock(
    productId: number,
    combinationId: number,
  ): Promise<{ physicalQuantity: number; shopId: number } | null> {
    const rows = await runQuery<StockRow[]>(
      this.pool,
      'stock',
      `
        SELECT
          sa.id_product_attribute AS combinationId,
          sa.physical_quantity AS physicalQuantity,
          sa.id_shop AS shopId
        FROM ${table('stock_available')} sa
        WHERE sa.id_product = ?
          AND sa.id_product_attribute = ?
          AND sa.id_shop = ?
        LIMIT 1
      `,
      [productId, combinationId, this.scope.shopId],
      this.timeoutMs,
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      physicalQuantity: Number(row.physicalQuantity ?? 0),
      shopId: Number(row.shopId ?? this.scope.shopId),
    };
  }

  async getStockForProduct(
    productId: number,
  ): Promise<Array<{ combinationId: number; physicalQuantity: number; shopId: number }>> {
    const rows = await runQuery<StockRow[]>(
      this.pool,
      'stock-for-product',
      `
        SELECT
          sa.id_product_attribute AS combinationId,
          sa.physical_quantity AS physicalQuantity,
          sa.id_shop AS shopId
        FROM ${table('stock_available')} sa
        WHERE sa.id_product = ?
          AND sa.id_shop = ?
        ORDER BY sa.id_product_attribute ASC
      `,
      [productId, this.scope.shopId],
      this.timeoutMs,
    );

    return rows.map((row) => ({
      combinationId: Number(row.combinationId ?? 0),
      physicalQuantity: Number(row.physicalQuantity ?? 0),
      shopId: Number(row.shopId ?? this.scope.shopId),
    }));
  }

  async getDefaultCombinationId(productId: number): Promise<number | null> {
    const rows = await runQuery<RowDataPacket[]>(
      this.pool,
      'default-combination',
      `
        SELECT pa.id_product_attribute AS combinationId
        FROM ${table('product_attribute')} pa
        INNER JOIN ${table('product')} p
          ON p.id_product = pa.id_product
        WHERE pa.id_product = ?
          AND p.active = 1
          AND COALESCE(pa.default_on, 0) = 1
        ORDER BY pa.id_product_attribute ASC
        LIMIT 1
      `,
      [productId],
      this.timeoutMs,
    );

    return rows[0] ? Number(rows[0].combinationId) : null;
  }
}
