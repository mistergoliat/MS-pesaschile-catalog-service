import { z } from 'zod';
import type {
  CatalogCommercialContext,
  CatalogCommercialSpecificPrice,
} from '../../../domain/catalog/commercial-truth/index.js';
import {
  invalidLimit,
  invalidPriceRange,
  invalidRequest,
  invalidSort,
  type ExploreProductsError,
} from './errors.js';

const nonEmptyStringSchema = z.string().trim().min(1);

export const exploreProductsAvailabilitySchema = z.enum(['available', 'unavailable', 'all']);
export const exploreProductsSortBySchema = z.enum(['price', 'stock', 'name']);
export const exploreProductsSortDirectionSchema = z.enum(['asc', 'desc']);
export const exploreProductsClassificationSourceSchema = z.enum(['category', 'attribute', 'rule', 'text_fallback']);
export const exploreProductsStockScopeSchema = z.enum(['product', 'product_aggregate']);

export const exploreProductsRequestSchema = z
  .object({
    query: nonEmptyStringSchema.max(240).optional(),
    categoryId: nonEmptyStringSchema.max(64).regex(/^\d+$/u).optional(),
    categorySlug: nonEmptyStringSchema.max(160).optional(),
    productType: nonEmptyStringSchema.max(120).optional(),
    price: z
      .object({
        min: z.number().finite().nonnegative().optional(),
        max: z.number().finite().nonnegative().optional(),
      })
      .strict()
      .optional(),
    availability: exploreProductsAvailabilitySchema.default('all'),
    sort: z
      .object({
        by: exploreProductsSortBySchema,
        direction: exploreProductsSortDirectionSchema,
      })
      .strict(),
    limit: z.number().int().min(1).max(10),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.price?.min !== undefined &&
      request.price.max !== undefined &&
      request.price.max < request.price.min
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: 'price.max must be greater than or equal to price.min',
      });
    }
  });

export const exploreProductsProductSchema = z
  .object({
    productId: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    price: z.number().finite().nonnegative().nullable(),
    currency: nonEmptyStringSchema,
    stockQuantity: z.number().int().nullable(),
    stockScope: exploreProductsStockScopeSchema,
    availability: nonEmptyStringSchema,
  })
  .strict();

export const exploreProductsResponseSchema = z
  .object({
    scope: z
      .object({
        query: nonEmptyStringSchema.optional(),
        categoryId: nonEmptyStringSchema.optional(),
        categorySlug: nonEmptyStringSchema.optional(),
        productType: nonEmptyStringSchema.optional(),
        availability: exploreProductsAvailabilitySchema,
      })
      .strict(),
    sort: z
      .object({
        by: exploreProductsSortBySchema,
        direction: exploreProductsSortDirectionSchema,
      })
      .strict(),
    totalMatched: z.number().int().nonnegative(),
    exhaustiveForScope: z.boolean(),
    classificationSource: exploreProductsClassificationSourceSchema.optional(),
    products: z.array(exploreProductsProductSchema).max(10),
  })
  .strict();

export type ExploreProductsAvailability = z.infer<typeof exploreProductsAvailabilitySchema>;
export type ExploreProductsSortBy = z.infer<typeof exploreProductsSortBySchema>;
export type ExploreProductsSortDirection = z.infer<typeof exploreProductsSortDirectionSchema>;
export type ExploreProductsClassificationSource = z.infer<typeof exploreProductsClassificationSourceSchema>;
export type ExploreProductsStockScope = z.infer<typeof exploreProductsStockScopeSchema>;
export type ExploreProductsRequest = z.infer<typeof exploreProductsRequestSchema>;
export type ExploreProductsResponse = z.infer<typeof exploreProductsResponseSchema>;

export type ExploreCatalogProductRow = {
  readonly productId: string;
  readonly name: string;
  readonly reference: string | null;
  readonly description: string | null;
  readonly defaultCategoryId: string | null;
  readonly defaultCategoryName: string | null;
  readonly defaultCategorySlug: string | null;
  readonly categoryIds: readonly string[];
  readonly categoryNames: readonly string[];
  readonly categorySlugs: readonly string[];
  readonly attributeText: string | null;
  readonly featureText: string | null;
  readonly hasCombinations: boolean;
  readonly defaultCombinationId: string | null;
  readonly productBasePriceNet: number | null;
  readonly combinationImpactNet: number | null;
  readonly active: boolean | null;
  readonly availableForOrder: boolean | null;
  readonly stockQuantity: number | null;
};

export type ExploreCatalogData = {
  readonly products: readonly ExploreCatalogProductRow[];
  readonly specificPrices: readonly CatalogCommercialSpecificPrice[];
  readonly exhaustiveForScope: boolean;
};

export interface CatalogExploreDataReader {
  resolveCategory(input: {
    readonly categoryId?: string;
    readonly categorySlug?: string;
  }): Promise<{ readonly found: boolean; readonly categoryIds: readonly string[] }>;

  readProducts(input: {
    readonly categoryIds?: readonly string[];
    readonly context: CatalogCommercialContext;
  }): Promise<ExploreCatalogData>;
}

export interface ExploreProductsService {
  explore(input: unknown, context: CatalogCommercialContext): Promise<ExploreProductsResponse>;
}

function issuePath(error: z.ZodError, pathSegment: string): boolean {
  return error.issues.some((issue) => issue.path[0] === pathSegment);
}

export function parseExploreProductsRequest(input: unknown): ExploreProductsRequest | ExploreProductsError {
  const parsed = exploreProductsRequestSchema.safeParse(input);
  if (!parsed.success) {
    if (issuePath(parsed.error, 'limit')) return invalidLimit();
    if (issuePath(parsed.error, 'sort')) return invalidSort();
    if (issuePath(parsed.error, 'price')) return invalidPriceRange();
    return invalidRequest();
  }
  return parsed.data;
}
