import { describe, expect, it } from 'vitest';
import {
  EmptyCustomerAffinityEvidenceProvider,
  UnavailableCustomerAffinityEvidenceProvider,
} from '../../src/infrastructure/recommendation/customerAffinityEvidenceProviders.js';
import { CustomerAffinityError } from '../../src/domain/recommendation/customer-affinity/index.js';
import { customer, productB } from '../fixtures/customerProductAffinity.js';

describe('EmptyCustomerAffinityEvidenceProvider', () => {
  it('returns empty product evidence without inventing ownership', async () => {
    const result = await new EmptyCustomerAffinityEvidenceProvider().getEvidence(customer, [productB]);
    expect(result.productEvidence).toEqual([]);
  });

  it('echoes back the requested customer', async () => {
    const result = await new EmptyCustomerAffinityEvidenceProvider().getEvidence(customer, [productB]);
    expect(result.customer).toEqual(customer);
  });
});

describe('UnavailableCustomerAffinityEvidenceProvider', () => {
  it('throws a retryable EVIDENCE_PROVIDER_FAILED error', async () => {
    const provider = new UnavailableCustomerAffinityEvidenceProvider();
    try {
      await provider.getEvidence();
      throw new Error('expected getEvidence to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CustomerAffinityError);
      expect((error as CustomerAffinityError).code).toBe('EVIDENCE_PROVIDER_FAILED');
      expect((error as CustomerAffinityError).retryable).toBe(true);
    }
  });
});
