import { describe, expect, it, vi } from 'vitest';
import { createCustomerAffinityEvidenceProvider } from '../../src/bootstrap.js';
import {
  EmptyCustomerAffinityEvidenceProvider,
  UnavailableCustomerAffinityEvidenceProvider,
} from '../../src/infrastructure/recommendation/customerAffinityEvidenceProviders.js';
import { HttpCustomerAffinityEvidenceProvider } from '../../src/infrastructure/recommendation/httpCustomerAffinityEvidenceProvider.js';

const noopLogger = { info: () => undefined, error: () => undefined };

describe('createCustomerAffinityEvidenceProvider (bootstrap wiring)', () => {
  it('selects EmptyCustomerAffinityEvidenceProvider for mode=empty', () => {
    const provider = createCustomerAffinityEvidenceProvider('empty', {
      customerProfile: { baseUrl: null, timeoutMs: 2500 },
      logger: noopLogger,
    });
    expect(provider).toBeInstanceOf(EmptyCustomerAffinityEvidenceProvider);
  });

  it('selects UnavailableCustomerAffinityEvidenceProvider for mode=unavailable', () => {
    const provider = createCustomerAffinityEvidenceProvider('unavailable', {
      customerProfile: { baseUrl: null, timeoutMs: 2500 },
      logger: noopLogger,
    });
    expect(provider).toBeInstanceOf(UnavailableCustomerAffinityEvidenceProvider);
  });

  it('selects HttpCustomerAffinityEvidenceProvider for mode=http with a configured base URL', () => {
    const provider = createCustomerAffinityEvidenceProvider('http', {
      customerProfile: { baseUrl: 'http://customer-profile.internal:4020', timeoutMs: 2500 },
      logger: noopLogger,
    });
    expect(provider).toBeInstanceOf(HttpCustomerAffinityEvidenceProvider);
  });

  it('does not perform any fetch call while constructing the http provider', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    createCustomerAffinityEvidenceProvider('http', {
      customerProfile: { baseUrl: 'http://customer-profile.internal:4020', timeoutMs: 2500 },
      logger: noopLogger,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('throws defensively for mode=http when no base URL is configured', () => {
    expect(() =>
      createCustomerAffinityEvidenceProvider('http', {
        customerProfile: { baseUrl: null, timeoutMs: 2500 },
        logger: noopLogger,
      }),
    ).toThrow(/CUSTOMER_PROFILE_BASE_URL/);
  });
});
