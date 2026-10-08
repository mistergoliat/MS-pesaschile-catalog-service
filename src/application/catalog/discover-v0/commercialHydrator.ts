import type { ProductContextResponse } from '../../../domain/catalog/v2/contracts.js';
import type { CommercialObservation } from './contracts.js';

/*
 * Commercial data is never computed by retrieval. It is either hydrated from the
 * real Commercial Truth owner (CatalogContractService.getProductContext, engine
 * catalog-commercial-v2) or explicitly NOT_OBSERVED — never zero, never stale.
 */

export type CommercialHydrator = {
  readonly label: string;
  hydrate(productKeys: readonly string[]): Promise<Map<string, CommercialObservation>>;
};

export const OFFLINE_COMMERCIAL_NOT_OBSERVED: CommercialHydrator = {
  label: 'offline-not-observed',
  async hydrate(productKeys) {
    return new Map(productKeys.map((key) => [key, { status: 'NOT_OBSERVED', reason: 'OFFLINE_RUN_NO_COMMERCIAL_TRUTH' } as const]));
  },
};

export function commercialTruthHydrator(owner: { getProductContext(input: { productKey: string; quantity: number }): Promise<ProductContextResponse> }): CommercialHydrator {
  return {
    label: 'catalog-commercial-truth-v2',
    async hydrate(productKeys) {
      const entries = await Promise.all(productKeys.map(async (productKey): Promise<[string, CommercialObservation]> => {
        try {
          const context = await owner.getProductContext({ productKey, quantity: 1 });
          if (context.status !== 'found') return [productKey, { status: 'NOT_OBSERVED', reason: `PRODUCT_CONTEXT_${context.status.toUpperCase()}` }];
          return [productKey, {
            status: 'OBSERVED',
            authority: 'catalog-commercial-truth-v2',
            asOf: context.freshness.asOf,
            validUntil: context.freshness.validUntil ?? null,
            finalGrossClp: context.derived.priceSummary?.finalGross.amount ?? null,
            sellability: context.derived.availability.sellability,
            ...(context.derived.availability.reason ? { availabilityReason: context.derived.availability.reason } : {}),
          }];
        } catch {
          return [productKey, { status: 'NOT_OBSERVED', reason: 'COMMERCIAL_TRUTH_UNAVAILABLE' }];
        }
      }));
      return new Map(entries);
    },
  };
}
