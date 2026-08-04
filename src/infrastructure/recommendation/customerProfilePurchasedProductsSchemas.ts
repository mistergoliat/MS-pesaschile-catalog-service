import { z } from 'zod';

// Local, infrastructure-only schemas for Customer Profile's
// `GET /v1/customers/:masterCustomerId/purchased-products` response contract (CP-R1-T08). Deliberately not
// imported from the Customer Profile repository (read-only, separate service) so the two services stay
// independently deployable and independently versioned; this file is the single place that encodes what
// Catalog Service assumes about that contract, and it must be kept in sync by hand if the upstream contract
// changes.

function isIsoDateTimeString(value: string): boolean {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

const isoDateTimeSchema = z.string().trim().min(1).refine(isIsoDateTimeString, 'Expected an ISO-8601 date-time string');
// Validated but never used or exposed (see totalSpentTaxIncl below) — a legitimate merchant-side adjustment or
// partial credit can make this aggregate negative, so an optional leading '-' is accepted; still rejects NaN,
// Infinity, empty strings, and ambiguous separators (thousands separators, multiple signs, trailing dots).
const decimalMoneyStringSchema = z.string().trim().regex(/^-?\d+(\.\d+)?$/, 'Expected a decimal string');

export const purchasedProductRowSchema = z
  .object({
    productId: z.number().int().positive(),
    productAttributeId: z.number().int().nonnegative(),
    productName: z.string().trim().min(1),
    productReference: z.string().trim().min(1).nullable(),
    totalQuantityPurchased: z.number().int().nonnegative(),
    orderCount: z.number().int().positive(),
    firstPurchasedAt: isoDateTimeSchema,
    lastPurchasedAt: isoDateTimeSchema,
    totalSpentTaxIncl: decimalMoneyStringSchema,
    catalogStatus: z.enum(['linked', 'deleted_or_unavailable']),
  })
  .strict()
  .superRefine((row, context) => {
    if (Date.parse(row.firstPurchasedAt) > Date.parse(row.lastPurchasedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['firstPurchasedAt'],
        message: 'firstPurchasedAt must not be after lastPurchasedAt',
      });
    }
  });

export const purchasedProductsPaginationSchema = z
  .object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();

export const purchasedProductsAvailableResponseSchema = z
  .object({
    status: z.literal('available'),
    products: z.array(purchasedProductRowSchema),
    pagination: purchasedProductsPaginationSchema,
  })
  .strict()
  .superRefine((body, context) => {
    if (body.pagination.returned !== body.products.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pagination', 'returned'],
        message: 'pagination.returned must equal products.length',
      });
    }
  });

export const purchasedProductsCustomerNotFoundResponseSchema = z
  .object({ status: z.literal('customer_not_found') })
  .strict();

export const purchasedProductsCustomerNotLinkedResponseSchema = z
  .object({ status: z.literal('customer_not_linked') })
  .strict();

export const purchasedProductsDegradedResponseSchema = z
  .object({
    status: z.literal('degraded'),
    reason: z.enum(['prestashop_unavailable', 'prestashop_timeout']),
  })
  .strict();

export type PurchasedProductRow = z.infer<typeof purchasedProductRowSchema>;
export type PurchasedProductsPagination = z.infer<typeof purchasedProductsPaginationSchema>;
export type PurchasedProductsAvailableResponse = z.infer<typeof purchasedProductsAvailableResponseSchema>;
export type PurchasedProductsDegradedResponse = z.infer<typeof purchasedProductsDegradedResponseSchema>;
