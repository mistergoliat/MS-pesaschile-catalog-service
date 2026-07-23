import type { Pool, RowDataPacket } from 'mysql2/promise';
import type {
  CatalogCommercialContext,
  CatalogCommercialData,
  CatalogCommercialDataReader,
  CatalogCommercialProductReference,
  CatalogCommercialRawProduct,
} from '../../domain/catalog/commercial-truth/index.js';
import { config } from '../../shared/config.js';
import { stripHtml } from '../../shared/html.js';
import { runQuery } from '../database/queries.js';

type ProductRow = RowDataPacket & {
  productId: number;
  name: string;
  productReference: string | null;
  description: string | null;
  category: string | null;
  active: number | null;
  availableForOrder: number | null;
  productBasePriceNet: number | null;
};

type CombinationRow = RowDataPacket & {
  productId: number;
  combinationId: number;
  combinationReference: string | null;
  combinationImpactNet: number | null;
};

type StockRow = RowDataPacket & {
  productId: number;
  combinationId: number;
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

function normalizeReference(value: string | null): string | null {
  return value?.trim() || null;
}

function referenceKey(productId: number, combinationId: number): string {
  return `${productId}::${combinationId}`;
}

function parseReference(reference: CatalogCommercialProductReference): { productId: number; combinationId: number } | null {
  if (!/^\d+$/u.test(reference.productId)) return null;
  if (reference.combinationId !== undefined && !/^\d+$/u.test(reference.combinationId)) return null;
  const productId = Number(reference.productId);
  const combinationId = reference.combinationId === undefined ? 0 : Number(reference.combinationId);
  if (!Number.isSafeInteger(productId) || productId <= 0) return null;
  if (!Number.isSafeInteger(combinationId) || combinationId < 0) return null;
  return { productId, combinationId };
}

export class MySqlCatalogCommercialDataReader implements CatalogCommercialDataReader {
  constructor(
    private readonly pool: Pool,
    private readonly scope = {
      shopId: config.prestashop.shopId,
      langId: config.prestashop.langId,
    },
    private readonly timeoutMs = config.db.queryTimeoutMs,
  ) {}

  async read(input: {
    readonly products: readonly CatalogCommercialProductReference[];
    readonly context: CatalogCommercialContext;
  }): Promise<CatalogCommercialData> {
    const parsed = input.products
      .map(parseReference)
      .filter((item): item is { productId: number; combinationId: number } => item !== null);
    if (parsed.length === 0) {
      return { products: [], specificPrices: [] };
    }

    const productIds = [...new Set(parsed.map((item) => item.productId))].sort((left, right) => left - right);
    const combinationIds = [...new Set(parsed.map((item) => item.combinationId).filter((id) => id > 0))]
      .sort((left, right) => left - right);
    const requestedCombinationIds = [0, ...combinationIds];

    const [productRows, combinationRows, stockRows, specificPriceRows] = await Promise.all([
      this.readProducts(productIds),
      this.readCombinations(productIds, combinationIds),
      this.readStocks(productIds, requestedCombinationIds),
      this.readSpecificPrices(productIds, combinationIds, input.context),
    ]);

    const productsById = new Map(productRows.map((row) => [Number(row.productId), row]));
    const combinationsByKey = new Map(combinationRows.map((row) => [
      referenceKey(Number(row.productId), Number(row.combinationId)),
      row,
    ]));
    const stockByKey = new Map(stockRows.map((row) => [
      referenceKey(Number(row.productId), Number(row.combinationId)),
      row,
    ]));

    const products: CatalogCommercialRawProduct[] = [];
    for (const item of parsed) {
      const product = productsById.get(item.productId);
      if (!product) continue;
      const combination = item.combinationId > 0
        ? combinationsByKey.get(referenceKey(item.productId, item.combinationId))
        : null;
      if (item.combinationId > 0 && !combination) continue;
      const stock = stockByKey.get(referenceKey(item.productId, item.combinationId));
      products.push({
        productId: item.productId,
        combinationId: item.combinationId,
        name: product.name,
        productReference: normalizeReference(product.productReference),
        combinationReference: normalizeReference(combination?.combinationReference ?? null),
        description: stripHtml(product.description),
        category: product.category?.trim() || null,
        active: product.active === null ? null : Boolean(product.active),
        availableForOrder: product.availableForOrder === null ? null : Boolean(product.availableForOrder),
        productBasePriceNet: product.productBasePriceNet === null ? null : Number(product.productBasePriceNet),
        combinationImpactNet: item.combinationId > 0
          ? Number(combination?.combinationImpactNet ?? 0)
          : 0,
        stockQuantity: stock ? Number(stock.stockQuantity ?? 0) : null,
      });
    }

    return {
      products,
      specificPrices: specificPriceRows.map((row) => ({
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
      })),
    };
  }

  private async readProducts(productIds: readonly number[]): Promise<ProductRow[]> {
    return runQuery<ProductRow[]>(
      this.pool,
      'catalog-commercial-products',
      `
        SELECT
          p.id_product AS productId,
          pl.name AS name,
          NULLIF(TRIM(p.reference), '') AS productReference,
          pl.description_short AS description,
          cl.name AS category,
          p.active AS active,
          COALESCE(ps.available_for_order, p.available_for_order) AS availableForOrder,
          COALESCE(ps.price, p.price) AS productBasePriceNet
        FROM ${table('product')} p
        INNER JOIN ${table('product_lang')} pl
          ON pl.id_product = p.id_product
          AND pl.id_shop = ?
          AND pl.id_lang = ?
        LEFT JOIN ${table('product_shop')} ps
          ON ps.id_product = p.id_product
          AND ps.id_shop = ?
        LEFT JOIN ${table('category_lang')} cl
          ON cl.id_category = p.id_category_default
          AND cl.id_shop = ?
          AND cl.id_lang = ?
        WHERE p.id_product IN (${placeholders(productIds)})
      `,
      [this.scope.shopId, this.scope.langId, this.scope.shopId, this.scope.shopId, this.scope.langId, ...productIds],
      this.timeoutMs,
    );
  }

  private async readCombinations(
    productIds: readonly number[],
    combinationIds: readonly number[],
  ): Promise<CombinationRow[]> {
    if (combinationIds.length === 0) return [];
    return runQuery<CombinationRow[]>(
      this.pool,
      'catalog-commercial-combinations',
      `
        SELECT
          pa.id_product AS productId,
          pa.id_product_attribute AS combinationId,
          NULLIF(TRIM(pa.reference), '') AS combinationReference,
          COALESCE(pas.price, pa.price, 0) AS combinationImpactNet
        FROM ${table('product_attribute')} pa
        LEFT JOIN ${table('product_attribute_shop')} pas
          ON pas.id_product_attribute = pa.id_product_attribute
          AND pas.id_shop = ?
        WHERE pa.id_product IN (${placeholders(productIds)})
          AND pa.id_product_attribute IN (${placeholders(combinationIds)})
      `,
      [this.scope.shopId, ...productIds, ...combinationIds],
      this.timeoutMs,
    );
  }

  private async readStocks(
    productIds: readonly number[],
    combinationIds: readonly number[],
  ): Promise<StockRow[]> {
    return runQuery<StockRow[]>(
      this.pool,
      'catalog-commercial-stocks',
      `
        SELECT
          sa.id_product AS productId,
          sa.id_product_attribute AS combinationId,
          sa.physical_quantity AS stockQuantity
        FROM ${table('stock_available')} sa
        WHERE sa.id_product IN (${placeholders(productIds)})
          AND sa.id_product_attribute IN (${placeholders(combinationIds)})
          AND sa.id_shop = ?
      `,
      [...productIds, ...combinationIds, this.scope.shopId],
      this.timeoutMs,
    );
  }

  private async readSpecificPrices(
    productIds: readonly number[],
    combinationIds: readonly number[],
    context: CatalogCommercialContext,
  ): Promise<SpecificPriceRow[]> {
    return runQuery<SpecificPriceRow[]>(
      this.pool,
      'catalog-commercial-specific-prices',
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
          AND id_product_attribute IN (${placeholders([0, ...combinationIds])})
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
        0,
        ...combinationIds,
        context.shopId,
        context.currencyId,
        context.countryId,
        context.customerGroupId,
        context.customerId,
        context.quantity,
      ],
      this.timeoutMs,
    );
  }
}
