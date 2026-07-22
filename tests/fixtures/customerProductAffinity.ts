import type { ProductRelationshipProductReference } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import type {
  CustomerAffinityContext,
  CustomerAffinityEvidenceProvider,
  CustomerAffinityEvidenceResult,
  CustomerAffinityParameters,
  CustomerProductEvidence,
  CustomerProductAffinityRequest,
} from '../../src/domain/recommendation/customer-affinity/index.js';
import {
  DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
} from '../../src/domain/recommendation/customer-affinity/index.js';

export const customer = { customerId: 'customer-1' } as const;
export const productA = { productId: 'A' } as const;
export const productB = { productId: 'B' } as const;
export const productBCombo = { productId: 'B', combinationId: '10' } as const;
export const productC = { productId: 'C' } as const;

export const affinityContext: CustomerAffinityContext = {
  channel: 'web',
  intent: 'purchase',
  currency: 'CLP',
  referenceTime: '2026-07-22T12:00:00.000Z',
};

export const baseAffinityRequest: CustomerProductAffinityRequest = {
  customer,
  products: [productB, productC],
  context: affinityContext,
};

export function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function evidenceFor(
  product: ProductRelationshipProductReference = productB,
  patch: Partial<CustomerProductEvidence> = {},
): CustomerProductEvidence {
  return {
    product,
    ...patch,
  };
}

export function evidenceResult(
  productEvidence: CustomerProductEvidence[] = [evidenceFor(productB)],
): CustomerAffinityEvidenceResult {
  return {
    customer,
    productEvidence,
  };
}

export class FakeCustomerAffinityEvidenceProvider implements CustomerAffinityEvidenceProvider {
  calls: Array<{
    customer: typeof customer;
    products: readonly ProductRelationshipProductReference[];
    context?: CustomerAffinityContext;
  }> = [];

  failWith: Error | null = null;

  constructor(public result: CustomerAffinityEvidenceResult = evidenceResult()) {}

  async getEvidence(
    requestedCustomer: typeof customer,
    products: readonly ProductRelationshipProductReference[],
    context?: CustomerAffinityContext,
  ): Promise<CustomerAffinityEvidenceResult> {
    this.calls.push({ customer: requestedCustomer, products: clone(products), context: clone(context) });
    if (this.failWith) throw this.failWith;
    return this.result;
  }
}

export const customAffinityParameters: CustomerAffinityParameters = {
  ...DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
  directProductPurchaseWeight: 0.4,
  recentProductInterestWeight: 0.1,
};
