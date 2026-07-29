import { config } from '../../../shared/config.js';
import { resolvePrice } from '../../../infrastructure/pricing/priceResolver.js';
import type { SpecificPriceCandidate } from '../../../domain/pricing/types.js';
import { normalizeCatalogText, tokenizeCatalogText } from '../product-intent/normalizer.js';
import {
  CommercialAvailabilityResolver,
  type CatalogCommercialContext,
  type CatalogCommercialRawProduct,
  type CatalogCommercialSpecificPrice,
} from '../../../domain/catalog/commercial-truth/index.js';
import {
  catalogSourceUnavailable,
  categoryNotFound,
  ExploreProductsError,
  internalExploreError,
} from './errors.js';
import {
  parseExploreProductsRequest,
  type CatalogExploreDataReader,
  type ExploreCatalogProductRow,
  type ExploreProductsClassificationSource,
  type ExploreProductsRequest,
  type ExploreProductsResponse,
  type ExploreProductsService,
} from './contracts.js';

type RankedExploreProduct = ExploreProductsResponse['products'][number] & {
  readonly sortPrice: number | null;
  readonly sortStock: number | null;
  readonly source?: ExploreProductsClassificationSource;
};

type ProductTypeDefinition = {
  readonly categorySlugs: readonly string[];
  readonly categoryAliases: readonly string[];
  readonly attributeAliases: readonly string[];
  readonly rulePatterns: readonly RegExp[];
  readonly allowTextFallback: boolean;
};

const PRODUCT_TYPE_DEFINITIONS: Readonly<Record<string, ProductTypeDefinition>> = Object.freeze({
  machine: {
    categorySlugs: ['maquinas-con-carga-de-discos', 'maquinas-comerciales'],
    categoryAliases: [],
    attributeAliases: ['maquina', 'maquinas', 'machine'],
    rulePatterns: [],
    allowTextFallback: false,
  },
  bench: {
    categorySlugs: ['bancos', 'bancos-especiales', 'bancos-y-soportes', 'bancas'],
    categoryAliases: ['banca', 'bancas', 'banco', 'bancos', 'bench', 'benches'],
    attributeAliases: ['banca', 'banco', 'bench'],
    rulePatterns: [/\bbanca\b/u, /\bbancas\b/u, /\bbanco\b/u, /\bbancos\b/u, /\bbench\b/u],
    allowTextFallback: false,
  },
  banca: {
    categorySlugs: ['bancos', 'bancos-especiales', 'bancos-y-soportes', 'bancas'],
    categoryAliases: ['banca', 'bancas', 'banco', 'bancos', 'bench', 'benches'],
    attributeAliases: ['banca', 'banco', 'bench'],
    rulePatterns: [/\bbanca\b/u, /\bbancas\b/u, /\bbanco\b/u, /\bbancos\b/u, /\bbench\b/u],
    allowTextFallback: false,
  },
});

function includesAny(text: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => text.includes(normalizeCatalogText(alias)));
}

function productTypeDefinition(productType: string): ProductTypeDefinition {
  const normalized = normalizeCatalogText(productType);
  return PRODUCT_TYPE_DEFINITIONS[normalized] ?? {
    categorySlugs: [],
    categoryAliases: [normalized],
    attributeAliases: [normalized],
    rulePatterns: [],
    allowTextFallback: true,
  };
}

async function resolveCategoryIdsForSlugs(
  dataReader: CatalogExploreDataReader,
  slugs: readonly string[],
): Promise<string[]> {
  const ids = new Set<string>();
  for (const slug of slugs) {
    const resolved = await dataReader.resolveCategory({ categorySlug: slug });
    for (const id of resolved.categoryIds) ids.add(id);
  }
  return [...ids];
}

function rowText(row: ExploreCatalogProductRow): {
  readonly category: string;
  readonly attribute: string;
  readonly full: string;
} {
  const category = normalizeCatalogText([
    row.defaultCategoryName,
    row.defaultCategorySlug,
    ...row.categoryNames,
    ...row.categorySlugs,
  ].filter(Boolean).join(' '));
  const attribute = normalizeCatalogText([row.attributeText, row.featureText].filter(Boolean).join(' '));
  const full = normalizeCatalogText([
    row.name,
    row.reference,
    row.description,
    category,
    attribute,
  ].filter(Boolean).join(' '));
  return { category, attribute, full };
}

function classifyProductType(
  row: ExploreCatalogProductRow,
  productType: string,
): ExploreProductsClassificationSource | null {
  const definition = productTypeDefinition(productType);
  const texts = rowText(row);
  const categorySlugs = row.categorySlugs.map(normalizeCatalogText);
  if (definition.categorySlugs.some((slug) => categorySlugs.includes(normalizeCatalogText(slug)))) return 'category';
  if (definition.categoryAliases.length > 0 && includesAny(texts.category, definition.categoryAliases)) return 'category';
  if (includesAny(texts.attribute, definition.attributeAliases)) return 'attribute';
  if (definition.rulePatterns.some((pattern) => pattern.test(texts.full))) return 'rule';
  if (definition.allowTextFallback && texts.full.includes(normalizeCatalogText(productType))) return 'text_fallback';
  return null;
}

function strongestDisclosureSource(
  sources: readonly ExploreProductsClassificationSource[],
): ExploreProductsClassificationSource | undefined {
  const priority: readonly ExploreProductsClassificationSource[] = ['text_fallback', 'rule', 'attribute', 'category'];
  return priority.find((source) => sources.includes(source));
}

function matchesQuery(row: ExploreCatalogProductRow, query: string | undefined): boolean {
  if (!query) return true;
  const normalized = normalizeCatalogText(query);
  const tokens = tokenizeCatalogText(query);
  const full = rowText(row).full;
  return full.includes(normalized) || tokens.every((token) => full.includes(token));
}

function matchesCategory(row: ExploreCatalogProductRow, categoryIds: readonly string[] | undefined): boolean {
  if (!categoryIds || categoryIds.length === 0) return true;
  return categoryIds.some((id) => row.categoryIds.includes(id) || row.defaultCategoryId === id);
}

function commercialRawProduct(row: ExploreCatalogProductRow): CatalogCommercialRawProduct {
  const combinationId = row.defaultCombinationId === null ? 0 : Number(row.defaultCombinationId);
  return {
    productId: Number(row.productId),
    combinationId,
    name: row.name,
    productReference: row.reference,
    combinationReference: null,
    description: row.description,
    category: row.defaultCategoryName,
    linkRewrite: null,
    hasCombinations: row.hasCombinations,
    variantAttributeLabels: [],
    active: row.active,
    availableForOrder: row.availableForOrder,
    productBasePriceNet: row.productBasePriceNet,
    combinationImpactNet: row.combinationImpactNet ?? 0,
    stockQuantity: row.stockQuantity,
  };
}

function productSpecificPrices(
  prices: readonly CatalogCommercialSpecificPrice[],
  productId: number,
): SpecificPriceCandidate[] {
  return prices
    .filter((price) => price.productId === productId)
    .map((price) => ({
      id_specific_price: price.idSpecificPrice,
      id_product_attribute: price.combinationId,
      id_shop: price.shopId,
      id_currency: price.currencyId,
      id_country: price.countryId,
      id_group: price.groupId,
      id_customer: price.customerId,
      price: price.price,
      from_quantity: price.fromQuantity,
      reduction: price.reduction,
      reduction_tax: price.reductionTax,
      reduction_type: price.reductionType as 'amount' | 'percentage',
      from: price.from,
      to: price.to,
    }));
}

function effectivePrice(input: {
  readonly row: ExploreCatalogProductRow;
  readonly raw: CatalogCommercialRawProduct;
  readonly prices: readonly CatalogCommercialSpecificPrice[];
  readonly context: CatalogCommercialContext;
}): { readonly amount: number; readonly currency: string } | null {
  if (
    input.row.productBasePriceNet === null ||
    input.row.combinationImpactNet === null ||
    !Number.isFinite(input.row.productBasePriceNet) ||
    !Number.isFinite(input.row.combinationImpactNet) ||
    input.row.productBasePriceNet + input.row.combinationImpactNet < 0
  ) {
    return null;
  }
  const price = resolvePrice({
    baseProductPrice: input.row.productBasePriceNet,
    combinationImpact: input.row.combinationImpactNet,
    specificPrices: productSpecificPrices(input.prices, input.raw.productId),
  }, {
    productId: input.raw.productId,
    combinationId: input.raw.combinationId,
    quantity: input.context.quantity,
    shopId: input.context.shopId,
    currencyId: input.context.currencyId,
    countryId: input.context.countryId,
    customerGroupId: input.context.customerGroupId,
    customerId: input.context.customerId,
    currencyCode: input.context.currencyCode,
    taxRate: input.context.taxRate,
  });
  return {
    amount: price.effectiveUnitPrice,
    currency: price.currency,
  };
}

function compareProducts(
  left: RankedExploreProduct,
  right: RankedExploreProduct,
  request: ExploreProductsRequest,
): number {
  const direction = request.sort.direction === 'asc' ? 1 : -1;
  if (request.sort.by === 'price') {
    const diff = ((left.sortPrice ?? 0) - (right.sortPrice ?? 0)) * direction;
    if (diff !== 0) return diff;
  } else if (request.sort.by === 'stock') {
    const leftKnown = left.sortStock !== null;
    const rightKnown = right.sortStock !== null;
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    if (left.sortStock !== null && right.sortStock !== null) {
      const diff = (left.sortStock - right.sortStock) * direction;
      if (diff !== 0) return diff;
    }
  } else {
    const diff = left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }) * direction;
    if (diff !== 0) return diff;
  }
  return Number(left.productId) - Number(right.productId);
}

export class DefaultExploreProductsService implements ExploreProductsService {
  constructor(
    private readonly dependencies: {
      readonly dataReader: CatalogExploreDataReader;
      readonly availabilityResolver?: CommercialAvailabilityResolver;
      readonly clock?: { now(): Date };
    },
  ) {}

  async explore(input: unknown, context: CatalogCommercialContext): Promise<ExploreProductsResponse> {
    const requestOrError = parseExploreProductsRequest(input);
    if (requestOrError instanceof ExploreProductsError) throw requestOrError;
    const request = requestOrError;

    try {
      const category = request.categoryId || request.categorySlug
        ? await this.dependencies.dataReader.resolveCategory({
            categoryId: request.categoryId,
            categorySlug: request.categorySlug,
          })
        : { found: true, categoryIds: [] };
      if (!category.found) {
        throw categoryNotFound();
      }
      const productTypeScopeCategoryIds = request.productType
        ? await resolveCategoryIdsForSlugs(
            this.dependencies.dataReader,
            productTypeDefinition(request.productType).categorySlugs,
          )
        : [];
      const readCategoryIds = category.categoryIds.length > 0
        ? category.categoryIds
        : productTypeScopeCategoryIds.length > 0
          ? productTypeScopeCategoryIds
          : undefined;

      const data = await this.dependencies.dataReader.readProducts({
        categoryIds: readCategoryIds,
        context,
      });
      const availabilityResolver = this.dependencies.availabilityResolver ?? new CommercialAvailabilityResolver();
      const evaluatedAtDate = this.dependencies.clock?.now() ?? new Date();
      const evaluatedAt = evaluatedAtDate.toISOString();
      const products: RankedExploreProduct[] = [];
      const classificationSources: ExploreProductsClassificationSource[] = [];

      for (const row of data.products) {
        if (!matchesCategory(row, category.categoryIds)) continue;
        if (!matchesQuery(row, request.query)) continue;

        const classificationSource = request.productType
          ? classifyProductType(row, request.productType)
          : undefined;
        if (request.productType && classificationSource === null) continue;

        const raw = commercialRawProduct(row);
        const availability = availabilityResolver.resolve(raw, evaluatedAt);
        if (request.availability === 'available' && availability.status !== 'available') continue;
        if (request.availability === 'unavailable' && availability.status === 'available') continue;

        const price = effectivePrice({
          row,
          raw,
          prices: data.specificPrices,
          context,
        });

        const amount = price?.amount ?? null;
        if (request.price?.min !== undefined && (amount === null || amount < request.price.min)) continue;
        if (request.price?.max !== undefined && (amount === null || amount > request.price.max)) continue;
        if (request.sort.by === 'price' && amount === null) continue;

        if (classificationSource) classificationSources.push(classificationSource);
        products.push({
          productId: row.productId,
          name: row.name,
          price: amount,
          currency: price?.currency ?? context.currencyCode,
          stockQuantity: availability.stockQuantity,
          stockScope: row.hasCombinations ? 'product_aggregate' : 'product',
          availability: availability.status,
          sortPrice: amount,
          sortStock: availability.stockQuantity,
          ...(classificationSource ? { source: classificationSource } : {}),
        });
      }

      products.sort((left, right) => compareProducts(left, right, request));

      return {
        scope: {
          ...(request.query === undefined ? {} : { query: request.query }),
          ...(request.categoryId === undefined ? {} : { categoryId: request.categoryId }),
          ...(request.categorySlug === undefined ? {} : { categorySlug: request.categorySlug }),
          ...(request.productType === undefined ? {} : { productType: request.productType }),
          availability: request.availability,
        },
        sort: request.sort,
        totalMatched: products.length,
        exhaustiveForScope: data.exhaustiveForScope,
        ...(request.productType === undefined ? {} : { classificationSource: strongestDisclosureSource(classificationSources) ?? 'text_fallback' }),
        products: products.slice(0, request.limit).map(({ sortPrice: _sortPrice, sortStock: _sortStock, source: _source, ...product }) => product),
      };
    } catch (error) {
      if (error instanceof ExploreProductsError) throw error;
      if (error instanceof TypeError || error instanceof RangeError) throw internalExploreError();
      throw catalogSourceUnavailable();
    }
  }
}

export function defaultExploreCommercialContext(context: Partial<CatalogCommercialContext> = {}): CatalogCommercialContext {
  return {
    shopId: config.prestashop.shopId,
    currencyId: context.currencyId ?? config.prestashop.currencyId,
    currencyCode: context.currencyCode ?? config.prestashop.currencyCode,
    countryId: context.countryId ?? config.prestashop.countryId,
    customerGroupId: context.customerGroupId ?? config.prestashop.customerGroupId,
    customerId: context.customerId ?? 0,
    quantity: context.quantity ?? 1,
    taxRate: context.taxRate ?? config.pricing.taxRate,
  };
}
