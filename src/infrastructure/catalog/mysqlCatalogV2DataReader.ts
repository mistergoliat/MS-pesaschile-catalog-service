import type { Pool, RowDataPacket } from 'mysql2/promise';
import type {
  CatalogV2DataReader,
  CatalogV2Product,
  CatalogV2SpecificPrice,
  CatalogV2Variant,
} from '../../domain/catalog/v2/contracts.js';
import { DISCOVERY_EXCLUDED_PRODUCT_IDS } from '../../domain/catalog/discoveryExclusionPolicy.js';
import { selectMeaningfulCategory } from '../../domain/catalog/v2/meaningfulCategory.js';
import { significantTokens, sqlLikeFragments } from '../../domain/catalog/v2/nominalSearch.js';
import { config } from '../../shared/config.js';
import { wallTimeToIso } from '../../shared/zonedTime.js';
import { stripHtml } from '../../shared/html.js';
import { runQuery } from '../database/queries.js';

type ProductRow = RowDataPacket & {
  productId: number;
  name: string;
  sku: string | null;
  shortDescription: string | null;
  linkRewrite: string | null;
  weightKg: number | null;
  basePriceNet: number | null;
  active: number | null;
  listed: number | null;
  visibility: string | null;
  orderable: number | null;
  brand: string | null;
};

type CategoryRow = RowDataPacket & {
  productId: number;
  categoryId: number;
  categoryName: string | null;
  levelDepth: number | null;
};

type VariantRow = RowDataPacket & {
  productId: number;
  combinationId: number;
  sku: string | null;
  impactPriceNet: number | null;
  isDefault: number | null;
  availableQuantity: number | null;
  outOfStock: number | null;
};

type SimpleStockRow = RowDataPacket & {
  productId: number;
  availableQuantity: number | null;
  outOfStock: number | null;
};

type AttributeRow = RowDataPacket & {
  productId: number;
  combinationId: number;
  groupName: string | null;
  valueName: string | null;
};

type SpecificationRow = RowDataPacket & {
  productId: number;
  name: string | null;
  value: string | null;
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
  from: string | null;
  to: string | null;
};

type ConfigurationRow = RowDataPacket & { value: string | null };

function table(name: string): string {
  return `${config.prestashop.prefix}${name}`;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

// `!` rather than a backslash: `ESCAPE '\'` is a syntax error under the
// default sql_mode (the backslash escapes the closing quote), and `'\\'` is
// two characters under NO_BACKSLASH_ESCAPES. `!` is literal in both modes.
const LIKE_ESCAPE = '!';

function escapeLike(value: string): string {
  return value.replace(/[!%_]/gu, `${LIKE_ESCAPE}$&`);
}

export class MySqlCatalogV2DataReader implements CatalogV2DataReader {
  constructor(
    private readonly pool: Pool,
    private readonly scope = {
      shopId: config.prestashop.shopId,
      langId: config.prestashop.langId,
      timeZone: config.prestashop.timeZone,
    },
    private readonly timeoutMs = config.db.queryTimeoutMs,
  ) {}

  async readProducts(input: { productIds?: readonly number[]; query?: string }): Promise<{ products: CatalogV2Product[]; asOf: string }> {
    const asOf = new Date().toISOString();
    const productIds = input.productIds?.length
      ? [...new Set(input.productIds)].filter((id) => Number.isSafeInteger(id) && id > 0)
      : undefined;
    const query = input.query?.trim() || null;
    if (!productIds?.length && !query) return { products: [], asOf };

    const productRows = await this.readProductRows(productIds, query);
    const resolvedProductIds = productRows.map((row) => Number(row.productId));
    if (resolvedProductIds.length === 0) return { products: [], asOf };
    const [variantRows, simpleStockRows, attributeRows, specificationRows, specificPriceRows, globalBackorder, categoryRows] = await Promise.all([
      this.readVariants(resolvedProductIds),
      this.readSimpleStocks(resolvedProductIds),
      this.readAttributes(resolvedProductIds),
      this.readSpecifications(resolvedProductIds),
      this.readSpecificPrices(resolvedProductIds),
      this.readGlobalBackorderPolicy(),
      this.readCategories(resolvedProductIds),
    ]);

    const categoriesByProduct = new Map<number, Array<{ id: number; name: string; levelDepth: number | null }>>();
    for (const row of categoryRows) {
      if (!row.categoryName) continue;
      const list = categoriesByProduct.get(Number(row.productId)) ?? [];
      list.push({ id: Number(row.categoryId), name: String(row.categoryName), levelDepth: row.levelDepth === null ? null : Number(row.levelDepth) });
      categoriesByProduct.set(Number(row.productId), list);
    }

    const attributesByVariant = new Map<number, Array<{ group: string; value: string }>>();
    for (const row of attributeRows) {
      if (!row.groupName || !row.valueName) continue;
      const list = attributesByVariant.get(Number(row.combinationId)) ?? [];
      list.push({ group: String(row.groupName), value: String(row.valueName) });
      attributesByVariant.set(Number(row.combinationId), list);
    }

    const variantsByProduct = new Map<number, VariantRow[]>();
    for (const row of variantRows) {
      const list = variantsByProduct.get(Number(row.productId)) ?? [];
      list.push(row);
      variantsByProduct.set(Number(row.productId), list);
    }
    const simpleStockByProduct = new Map(simpleStockRows.map((row) => [Number(row.productId), row]));

    const specificationsByProduct = new Map<number, Array<{ name: string; value: string }>>();
    for (const row of specificationRows) {
      const name = row.name === null ? '' : String(row.name).trim();
      if (!name || row.value === null) continue;
      const list = specificationsByProduct.get(Number(row.productId)) ?? [];
      if (list.length < 40) list.push({ name, value: String(row.value) });
      specificationsByProduct.set(Number(row.productId), list);
    }

    const pricesByProduct = new Map<number, CatalogV2SpecificPrice[]>();
    for (const row of specificPriceRows) {
      const list = pricesByProduct.get(Number(row.id_product)) ?? [];
      list.push({
        idSpecificPrice: Number(row.id_specific_price),
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
        // Shop-local wall-clock time -> instant (B7: PRESTASHOP_TIMEZONE = PS_TIMEZONE).
        from: wallTimeToIso(row.from, this.scope.timeZone),
        to: wallTimeToIso(row.to, this.scope.timeZone),
      });
      pricesByProduct.set(Number(row.id_product), list);
    }

    const products = productRows.map((row) => {
      const productId = Number(row.productId);
      const shortDescription = row.shortDescription;
      const variants = (variantsByProduct.get(productId) ?? []).map((variant): CatalogV2Variant => ({
        combinationId: Number(variant.combinationId),
        sku: variant.sku?.trim() || null,
        attributes: attributesByVariant.get(Number(variant.combinationId)) ?? [],
        impactPriceNet: Number(variant.impactPriceNet ?? 0),
        isDefault: Boolean(variant.isDefault),
        availableQuantity: variant.availableQuantity === null ? null : Math.trunc(Number(variant.availableQuantity)),
        outOfStock: variant.outOfStock === null ? null : Number(variant.outOfStock),
      }));
      if (variants.length === 0) {
        const simpleStock = simpleStockByProduct.get(productId);
        variants.push({
          combinationId: 0,
          sku: row.sku?.trim() || null,
          attributes: [],
          impactPriceNet: 0,
          isDefault: true,
          availableQuantity: simpleStock?.availableQuantity === null || simpleStock?.availableQuantity === undefined
            ? null
            : Math.trunc(Number(simpleStock.availableQuantity)),
          outOfStock: simpleStock?.outOfStock === null || simpleStock?.outOfStock === undefined
            ? null
            : Number(simpleStock.outOfStock),
        });
      }
      return {
        productId,
        name: String(row.name),
        sku: row.sku?.trim() || null,
        shortDescription: shortDescription === null ? null : truncate(stripHtml(shortDescription) ?? '', 600),
        brand: row.brand?.trim() || null,
        weightKg: row.weightKg === null ? null : Number(row.weightKg),
        linkRewrite: row.linkRewrite?.trim() || null,
        category: selectMeaningfulCategory(categoriesByProduct.get(productId) ?? []),
        basePriceNet: row.basePriceNet === null ? null : Number(row.basePriceNet),
        active: row.active === null ? null : Boolean(row.active),
        listed: row.visibility === null ? null : String(row.visibility) !== 'none',
        orderable: row.orderable === null ? null : Boolean(row.orderable),
        variants,
        specifications: specificationsByProduct.get(productId) ?? [],
        globalBackorderAllowed: globalBackorder,
        specificPrices: pricesByProduct.get(productId) ?? [],
        asOf,
      } satisfies CatalogV2Product;
    });

    return { products, asOf };
  }

  private async readProductRows(productIds: readonly number[] | undefined, query: string | null): Promise<ProductRow[]> {
    const conditions: string[] = [`p.id_product NOT IN (${placeholders(DISCOVERY_EXCLUDED_PRODUCT_IDS)})`];
    const values: unknown[] = [...DISCOVERY_EXCLUDED_PRODUCT_IDS];
    if (productIds?.length) {
      conditions.push(`p.id_product IN (${placeholders(productIds)})`);
      values.push(...productIds);
    }
    if (query) {
      // Candidate retrieval (J1D-CAT-01): exact reference/name, the raw phrase,
      // OR every significant token in the name, OR every significant token in
      // the short description. A superset of the nominal match; the service
      // then matches and ranks it (nominalSearch.ts).
      const like = `%${escapeLike(query)}%`;
      const tokenLikes = significantTokens(query).map((token) => sqlLikeFragments(token).map((fragment) => `%${escapeLike(fragment)}%`));
      const allTokensIn = (column: string) => tokenLikes
        .map((fragments) => `(${fragments.map(() => `${column} LIKE ? ESCAPE '${LIKE_ESCAPE}'`).join(' OR ')})`)
        .join(' AND ');
      const tokenBranches = tokenLikes.length === 0
        ? ''
        : `
        OR (${allTokensIn('pl.name')})
        OR (${allTokensIn('pl.description_short')})`;
      conditions.push(`(
        LOWER(COALESCE(p.reference, '')) = LOWER(?)
        OR LOWER(COALESCE(pl.name, '')) = LOWER(?)
        OR pl.name LIKE ? ESCAPE '${LIKE_ESCAPE}'
        OR pl.description_short LIKE ? ESCAPE '${LIKE_ESCAPE}'
        OR EXISTS (
          SELECT 1 FROM ${table('product_attribute')} pa_search
          WHERE pa_search.id_product = p.id_product
            AND LOWER(COALESCE(pa_search.reference, '')) = LOWER(?)
        )${tokenBranches}
      )`);
      values.push(query, query, like, like, query, ...tokenLikes.flat(), ...tokenLikes.flat());
    }

    return runQuery<ProductRow[]>(
      this.pool,
      'catalog-v2-products',
      `
        SELECT
          p.id_product AS productId,
          pl.name AS name,
          NULLIF(TRIM(p.reference), '') AS sku,
          pl.description_short AS shortDescription,
          NULLIF(TRIM(pl.link_rewrite), '') AS linkRewrite,
          p.weight AS weightKg,
          COALESCE(ps.price, p.price) AS basePriceNet,
          COALESCE(ps.active, p.active) AS active,
          COALESCE(ps.visibility, 'both') AS visibility,
          COALESCE(ps.available_for_order, p.available_for_order) AS orderable,
          m.name AS brand,
          CASE WHEN COALESCE(ps.visibility, 'both') = 'none' THEN 0 ELSE 1 END AS listed
        FROM ${table('product')} p
        INNER JOIN ${table('product_lang')} pl
          ON pl.id_product = p.id_product
          AND pl.id_shop = ?
          AND pl.id_lang = ?
        LEFT JOIN ${table('product_shop')} ps
          ON ps.id_product = p.id_product
          AND ps.id_shop = ?
        LEFT JOIN ${table('manufacturer')} m
          ON m.id_manufacturer = p.id_manufacturer
        WHERE ${conditions.join('\n          AND ')}
      `,
      [this.scope.shopId, this.scope.langId, this.scope.shopId, ...values],
      this.timeoutMs,
    );
  }

  private async readVariants(productIds: readonly number[]): Promise<VariantRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [this.scope.shopId, this.scope.shopId];
    if (productIds.length) {
      conditions.push(`pa.id_product IN (${placeholders(productIds)})`);
      values.push(...productIds);
    }
    return runQuery<VariantRow[]>(
      this.pool,
      'catalog-v2-variants',
      `
        SELECT
          pa.id_product AS productId,
          pa.id_product_attribute AS combinationId,
          NULLIF(TRIM(pa.reference), '') AS sku,
          COALESCE(pas.price, pa.price, 0) AS impactPriceNet,
          COALESCE(pa.default_on, 0) AS isDefault,
          sa.quantity AS availableQuantity,
          sa.out_of_stock AS outOfStock
        FROM ${table('product_attribute')} pa
        LEFT JOIN ${table('product_attribute_shop')} pas
          ON pas.id_product_attribute = pa.id_product_attribute
          AND pas.id_shop = ?
        LEFT JOIN ${table('stock_available')} sa
          ON sa.id_product = pa.id_product
          AND sa.id_product_attribute = pa.id_product_attribute
          AND sa.id_shop = ?
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY pa.id_product ASC, pa.default_on DESC, pa.id_product_attribute ASC
      `,
      values,
      this.timeoutMs,
    );
  }

  private async readAttributes(productIds: readonly number[]): Promise<AttributeRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [this.scope.langId, this.scope.langId];
    if (productIds.length) {
      conditions.push(`pa.id_product IN (${placeholders(productIds)})`);
      values.push(...productIds);
    }
    return runQuery<AttributeRow[]>(
      this.pool,
      'catalog-v2-attributes',
      `
        SELECT
          pa.id_product AS productId,
          pac.id_product_attribute AS combinationId,
          agl.name AS groupName,
          al.name AS valueName
        FROM ${table('product_attribute')} pa
        INNER JOIN ${table('product_attribute_combination')} pac
          ON pac.id_product_attribute = pa.id_product_attribute
        INNER JOIN ${table('attribute')} a
          ON a.id_attribute = pac.id_attribute
        INNER JOIN ${table('attribute_lang')} al
          ON al.id_attribute = a.id_attribute AND al.id_lang = ?
        INNER JOIN ${table('attribute_group_lang')} agl
          ON agl.id_attribute_group = a.id_attribute_group AND agl.id_lang = ?
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY pa.id_product ASC, pac.id_product_attribute ASC, agl.name ASC, al.name ASC
      `,
      values,
      this.timeoutMs,
    );
  }

  private async readSimpleStocks(productIds: readonly number[]): Promise<SimpleStockRow[]> {
    return runQuery<SimpleStockRow[]>(
      this.pool,
      'catalog-v2-simple-stocks',
      `
        SELECT
          sa.id_product AS productId,
          sa.quantity AS availableQuantity,
          sa.out_of_stock AS outOfStock
        FROM ${table('stock_available')} sa
        WHERE sa.id_product IN (${placeholders(productIds)})
          AND sa.id_product_attribute = 0
          AND sa.id_shop = ?
      `,
      [...productIds, this.scope.shopId],
      this.timeoutMs,
    );
  }

  private async readSpecifications(productIds: readonly number[]): Promise<SpecificationRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [this.scope.langId, this.scope.langId];
    if (productIds.length) {
      conditions.push(`fp.id_product IN (${placeholders(productIds)})`);
      values.push(...productIds);
    }
    return runQuery<SpecificationRow[]>(
      this.pool,
      'catalog-v2-specifications',
      `
        SELECT
          fp.id_product AS productId,
          fl.name AS name,
          NULLIF(TRIM(fvl.value), '') AS value
        FROM ${table('feature_product')} fp
        INNER JOIN ${table('feature')} f ON f.id_feature = fp.id_feature
        INNER JOIN ${table('feature_lang')} fl
          ON fl.id_feature = f.id_feature AND fl.id_lang = ?
        INNER JOIN ${table('feature_value')} fv ON fv.id_feature_value = fp.id_feature_value
        LEFT JOIN ${table('feature_value_lang')} fvl
          ON fvl.id_feature_value = fv.id_feature_value AND fvl.id_lang = ?
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY fp.id_product ASC, f.position ASC, fl.name ASC
      `,
      values,
      this.timeoutMs,
    );
  }

  private async readSpecificPrices(productIds: readonly number[]): Promise<SpecificPriceRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (productIds.length) {
      conditions.push(`sp.id_product IN (${placeholders(productIds)})`);
      values.push(...productIds);
    }
    return runQuery<SpecificPriceRow[]>(
      this.pool,
      'catalog-v2-specific-prices',
      `
        SELECT
          sp.id_specific_price,
          sp.id_product,
          sp.id_product_attribute,
          sp.id_shop,
          sp.id_currency,
          sp.id_country,
          sp.id_group,
          sp.id_customer,
          sp.id_cart,
          sp.price,
          sp.from_quantity,
          sp.reduction,
          sp.reduction_tax,
          sp.reduction_type,
          -- PrestaShop stores an unbounded window as the zero datetime; the
          -- driver cannot represent it, so it is mapped to NULL (= unbounded) here.
          -- Read as text: the value is shop-local wall-clock time, converted
          -- with the configured zone, never reinterpreted by the driver.
          CAST(NULLIF(sp.\`from\`, '0000-00-00 00:00:00') AS CHAR) AS \`from\`,
          CAST(NULLIF(sp.\`to\`, '0000-00-00 00:00:00') AS CHAR) AS \`to\`
        FROM ${table('specific_price')} sp
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      `,
      values,
      this.timeoutMs,
    );
  }

  private async readCategories(productIds: readonly number[]): Promise<CategoryRow[]> {
    return runQuery<CategoryRow[]>(
      this.pool,
      'catalog-v2-categories',
      `
        SELECT
          cp.id_product AS productId,
          c.id_category AS categoryId,
          cl.name AS categoryName,
          c.level_depth AS levelDepth
        FROM ${table('category_product')} cp
        INNER JOIN ${table('category')} c
          ON c.id_category = cp.id_category
          AND c.active = 1
        INNER JOIN ${table('category_lang')} cl
          ON cl.id_category = c.id_category
          AND cl.id_shop = ?
          AND cl.id_lang = ?
        WHERE cp.id_product IN (${placeholders(productIds)})
        ORDER BY cp.id_product ASC, c.id_category ASC
      `,
      [this.scope.shopId, this.scope.langId, ...productIds],
      this.timeoutMs,
    );
  }

  private async readGlobalBackorderPolicy(): Promise<boolean | null> {
    const rows = await runQuery<ConfigurationRow[]>(
      this.pool,
      'catalog-v2-global-backorder-policy',
      `SELECT value FROM ${table('configuration')} WHERE name = 'PS_ORDER_OUT_OF_STOCK' LIMIT 1`,
      [],
      this.timeoutMs,
    );
    const value = rows[0]?.value;
    if (value === undefined || value === null || value === '') return null;
    if (value === '1' || value.toLowerCase() === 'true') return true;
    if (value === '0' || value.toLowerCase() === 'false') return false;
    return null;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
