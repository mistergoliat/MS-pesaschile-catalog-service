import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
  DefaultCustomerAffinityEvaluator,
  customerAffinitySignalSchema,
  customerAffinityEvidenceSummarySchema,
  customerProductAffinityRequestSchema,
  customerAffinityCustomerReferenceSchema,
  customerAffinityParametersSchema,
  customerAffinityWarningSchema,
  customerProductAffinityResultSchema,
  productOwnershipEvidenceSchema,
} from '../../src/domain/recommendation/customer-affinity/index.js';
import {
  affinityContext,
  evidenceFor,
  productB,
  productBCombo,
} from '../fixtures/customerProductAffinity.js';

function evaluate(evidence = evidenceFor()) {
  return new DefaultCustomerAffinityEvaluator().evaluate(
    productB,
    evidence,
    {
      observedMinimumSpend: { currency: 'CLP', amount: 1000 },
      observedMaximumSpend: { currency: 'CLP', amount: 20000 },
      observedAverageSpend: { currency: 'CLP', amount: 10000 },
      orderCount: 5,
    },
    affinityContext,
    DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
  );
}

describe('customer affinity contracts', () => {
  it('accepts a valid request', () => {
    expect(customerProductAffinityRequestSchema.safeParse({ products: [productB] }).success).toBe(true);
  });

  it('accepts omitted customer', () => {
    expect(customerProductAffinityRequestSchema.safeParse({ products: [productB] }).success).toBe(true);
  });

  it('rejects empty customer', () => {
    expect(customerAffinityCustomerReferenceSchema.safeParse({ customerId: '' }).success).toBe(false);
  });

  it('rejects sentinel customer 0', () => {
    expect(customerAffinityCustomerReferenceSchema.safeParse({ customerId: '0' }).success).toBe(false);
  });

  it('rejects sentinel customer unknown', () => {
    expect(customerAffinityCustomerReferenceSchema.safeParse({ customerId: 'unknown' }).success).toBe(false);
  });

  it('accepts empty products', () => {
    expect(customerProductAffinityRequestSchema.safeParse({ products: [] }).success).toBe(true);
  });

  it('accepts duplicate products at request boundary for service deduplication', () => {
    expect(customerProductAffinityRequestSchema.safeParse({ products: [productB, productB] }).success).toBe(true);
  });

  it('distinguishes combination identity through valid product references', () => {
    expect(customerProductAffinityRequestSchema.safeParse({ products: [productB, productBCombo] }).success).toBe(true);
  });

  it('rejects invalid parameters', () => {
    expect(customerAffinityParametersSchema.safeParse({ ...DEFAULT_CUSTOMER_AFFINITY_PARAMETERS, recentInterestWindowDays: 0 }).success).toBe(false);
  });

  it('rejects invalid timestamps', () => {
    expect(customerProductAffinityRequestSchema.safeParse({ products: [productB], context: { referenceTime: 'bad' } }).success).toBe(false);
  });

  it('rejects invalid signal direction', () => {
    expect(customerAffinitySignalSchema.safeParse({ code: 'PRODUCT_REJECTION', direction: 'positive', strength: 1 }).success).toBe(false);
  });

  it('rejects strength outside range', () => {
    expect(customerAffinitySignalSchema.safeParse({ code: 'DIRECT_PRODUCT_PURCHASE', direction: 'positive', strength: 2 }).success).toBe(false);
  });

  it('rejects invalid evidence summary count', () => {
    expect(customerAffinityEvidenceSummarySchema.safeParse({ code: 'DIRECT_PRODUCT_PURCHASE', count: -1 }).success).toBe(false);
  });

  it('rejects invalid warning details', () => {
    expect(customerAffinityWarningSchema.safeParse({ code: 'CURRENCY_MISMATCH', details: { bad: Number.NaN } }).success).toBe(false);
  });

  it('rejects inconsistent statistics', () => {
    expect(customerProductAffinityResultSchema.safeParse({
      affinities: [],
      warnings: [],
      statistics: {
        requestedProducts: 2,
        deduplicatedProducts: 1,
        duplicateProductsRemoved: 0,
        productsWithEvidence: 0,
        productsWithoutEvidence: 0,
        positiveSignalsGenerated: 0,
        negativeSignalsGenerated: 0,
        warningsGenerated: 0,
        providerCalls: 0,
      },
    }).success).toBe(false);
  });
});

describe('productOwnershipEvidenceSchema', () => {
  it('accepts previouslyPurchased=false and exactVariantPreviouslyPurchased=false', () => {
    expect(productOwnershipEvidenceSchema.safeParse({
      previouslyPurchased: false,
      exactVariantPreviouslyPurchased: false,
    }).success).toBe(true);
  });

  it('accepts previouslyPurchased=true and exactVariantPreviouslyPurchased=false', () => {
    expect(productOwnershipEvidenceSchema.safeParse({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: false,
    }).success).toBe(true);
  });

  it('accepts previouslyPurchased=true and exactVariantPreviouslyPurchased=true', () => {
    expect(productOwnershipEvidenceSchema.safeParse({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: true,
    }).success).toBe(true);
  });

  it('rejects exactVariantPreviouslyPurchased=true without previouslyPurchased', () => {
    expect(productOwnershipEvidenceSchema.safeParse({
      previouslyPurchased: false,
      exactVariantPreviouslyPurchased: true,
    }).success).toBe(false);
  });

  it('rejects negative totalOrderCount', () => {
    expect(productOwnershipEvidenceSchema.safeParse({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: false,
      totalOrderCount: -1,
    }).success).toBe(false);
  });

  it('rejects an invalid timestamp', () => {
    expect(productOwnershipEvidenceSchema.safeParse({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: false,
      lastPurchasedAt: 'not-a-date',
    }).success).toBe(false);
  });

  it('rejects firstPurchasedAt after lastPurchasedAt', () => {
    expect(productOwnershipEvidenceSchema.safeParse({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: false,
      firstPurchasedAt: '2026-06-01T00:00:00.000Z',
      lastPurchasedAt: '2026-01-01T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('rejects additional fields', () => {
    expect(productOwnershipEvidenceSchema.safeParse({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: false,
      amount: 1000,
    }).success).toBe(false);
  });
});

describe('DefaultCustomerAffinityEvaluator signals', () => {
  it('does not generate a DIRECT_PRODUCT_PURCHASE signal from legacy directPurchases', () => {
    const result = evaluate(evidenceFor(productB, { directPurchases: [{ count: 3, occurredAt: '2026-06-01T00:00:00.000Z' }] }));
    expect(result.signals.some((signal) => signal.code === 'DIRECT_PRODUCT_PURCHASE')).toBe(false);
  });

  it('does not generate a DIRECT_PRODUCT_PURCHASE evidence summary from legacy directPurchases', () => {
    const result = evaluate(evidenceFor(productB, { directPurchases: [{ count: 3, occurredAt: '2026-06-01T00:00:00.000Z' }] }));
    expect(result.evidence.some((item) => item.code === 'DIRECT_PRODUCT_PURCHASE')).toBe(false);
  });

  it('derives ownership.previouslyPurchased from legacy directPurchases', () => {
    const result = evaluate(evidenceFor(productB, { directPurchases: [{ count: 1, occurredAt: '2026-06-01T00:00:00.000Z' }] }));
    expect(result.ownership).toMatchObject({ previouslyPurchased: true });
  });

  it('does not claim exact variant ownership for a base product candidate', () => {
    const result = evaluate(evidenceFor(productB, { directPurchases: [{ count: 1, occurredAt: '2026-06-01T00:00:00.000Z' }] }));
    expect(result.ownership?.exactVariantPreviouslyPurchased).toBe(false);
  });

  it('derives exact variant ownership when the candidate is a specific combination', () => {
    const result = new DefaultCustomerAffinityEvaluator().evaluate(
      productBCombo,
      evidenceFor(productBCombo, { directPurchases: [{ count: 1, occurredAt: '2026-06-01T00:00:00.000Z' }] }),
      undefined,
      affinityContext,
      DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
    );
    expect(result.ownership).toMatchObject({ previouslyPurchased: true, exactVariantPreviouslyPurchased: true });
  });

  it('derives totalOrderCount and first/last purchased timestamps from legacy directPurchases', () => {
    const result = evaluate(evidenceFor(productB, {
      directPurchases: [
        { count: 1, occurredAt: '2026-01-01T00:00:00.000Z' },
        { count: 2, occurredAt: '2026-06-01T00:00:00.000Z' },
      ],
    }));
    expect(result.ownership).toEqual({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: false,
      totalOrderCount: 3,
      firstPurchasedAt: '2026-01-01T00:00:00.000Z',
      lastPurchasedAt: '2026-06-01T00:00:00.000Z',
    });
  });

  it('leaves ownership absent when there is no directPurchases evidence and no explicit ownership', () => {
    const result = evaluate(evidenceFor(productB, { categoryPurchases: [{ count: 5 }] }));
    expect(result.ownership).toBeUndefined();
  });

  it('prefers explicit ownership evidence over derivation from legacy directPurchases', () => {
    const result = evaluate(evidenceFor(productB, {
      directPurchases: [{ count: 5, occurredAt: '2026-06-01T00:00:00.000Z' }],
      ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: true, totalOrderCount: 1 },
    }));
    expect(result.ownership).toEqual({ previouslyPurchased: true, exactVariantPreviouslyPurchased: true, totalOrderCount: 1 });
    expect(result.warnings).toEqual([]);
  });
});

describe('ownership versus legacy directPurchases contradiction (CP-R1-T10B3B correction)', () => {
  it('flags the contradiction when explicit ownership says false but directPurchases is non-empty', () => {
    const result = evaluate(evidenceFor(productB, {
      directPurchases: [{ count: 3, occurredAt: '2026-06-01T00:00:00.000Z' }],
      ownership: { previouslyPurchased: false, exactVariantPreviouslyPurchased: false },
    }));
    expect(result.ownership).toEqual({ previouslyPurchased: false, exactVariantPreviouslyPurchased: false });
    expect(result.warnings).toEqual([{
      code: 'INVALID_EVIDENCE_IGNORED',
      productIdentity: 'B::<base>',
      details: { field: 'directPurchases', reason: 'contradicts_explicit_ownership' },
    }]);
  });

  it('does not affect score/confidence-relevant fields for the contradictory case', () => {
    const result = evaluate(evidenceFor(productB, {
      directPurchases: [{ count: 3, occurredAt: '2026-06-01T00:00:00.000Z' }],
      ownership: { previouslyPurchased: false, exactVariantPreviouslyPurchased: false },
    }));
    expect(result.signals).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.validEvidenceCount).toBe(0);
  });

  it('does not duplicate the contradiction warning', () => {
    const result = evaluate(evidenceFor(productB, {
      directPurchases: [{ count: 1 }, { count: 2 }],
      ownership: { previouslyPurchased: false, exactVariantPreviouslyPurchased: false },
    }));
    expect(result.warnings).toHaveLength(1);
  });

  it('is deterministic for the same contradictory input', () => {
    const evidence = evidenceFor(productB, {
      directPurchases: [{ count: 3, occurredAt: '2026-06-01T00:00:00.000Z' }],
      ownership: { previouslyPurchased: false, exactVariantPreviouslyPurchased: false },
    });
    expect(evaluate(evidence)).toEqual(evaluate(evidence));
  });

  it('does not warn when ownership is true and directPurchases is empty', () => {
    const result = evaluate(evidenceFor(productB, {
      ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: false },
    }));
    expect(result.ownership).toEqual({ previouslyPurchased: true, exactVariantPreviouslyPurchased: false });
    expect(result.warnings).toEqual([]);
  });

  it('does not warn when ownership is true and directPurchases is present (not contradictory)', () => {
    const result = evaluate(evidenceFor(productB, {
      ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: false },
      directPurchases: [{ count: 2, occurredAt: '2026-06-01T00:00:00.000Z' }],
    }));
    expect(result.ownership).toEqual({ previouslyPurchased: true, exactVariantPreviouslyPurchased: false });
    expect(result.warnings).toEqual([]);
  });

  it('derives ownership from directPurchases when ownership is absent (no contradiction possible)', () => {
    const result = evaluate(evidenceFor(productB, {
      directPurchases: [{ count: 2, occurredAt: '2026-06-01T00:00:00.000Z' }],
    }));
    expect(result.ownership).toMatchObject({ previouslyPurchased: true });
    expect(result.warnings).toEqual([]);
  });
});

describe('DefaultCustomerAffinityEvaluator signals', () => {
  it('generates category purchase signal', () => {
    expect(evaluate(evidenceFor(productB, { categoryPurchases: [{ count: 5 }] })).signals).toContainEqual({
      code: 'CATEGORY_PURCHASE',
      direction: 'positive',
      strength: 1,
    });
  });

  it('generates brand purchase signal', () => {
    expect(evaluate(evidenceFor(productB, { brandPurchases: [{ count: 5 }] })).signals).toContainEqual({
      code: 'BRAND_PURCHASE',
      direction: 'positive',
      strength: 1,
    });
  });

  it('generates recent product interest signal', () => {
    expect(evaluate(evidenceFor(productB, { productInterests: [{ count: 1, occurredAt: '2026-07-10T00:00:00.000Z' }] })).signals[0]?.code).toBe('RECENT_PRODUCT_INTEREST');
  });

  it('ignores expired product interest', () => {
    expect(evaluate(evidenceFor(productB, { productInterests: [{ count: 1, occurredAt: '2025-01-10T00:00:00.000Z' }] })).signals).toHaveLength(0);
  });

  it('warns when reference time is missing for product interest', () => {
    const result = new DefaultCustomerAffinityEvaluator().evaluate(
      productB,
      evidenceFor(productB, { productInterests: [{ occurredAt: '2026-07-10T00:00:00.000Z' }] }),
      undefined,
      {},
      DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
    );
    expect(result.warnings[0]?.code).toBe('REFERENCE_TIME_UNAVAILABLE');
  });

  it('generates recent category interest signal', () => {
    expect(evaluate(evidenceFor(productB, { categoryInterests: [{ occurredAt: '2026-07-10T00:00:00.000Z' }] })).signals[0]?.code).toBe('RECENT_CATEGORY_INTEREST');
  });

  it('generates product rejection signal', () => {
    expect(evaluate(evidenceFor(productB, { productRejections: [{ occurredAt: '2026-07-10T00:00:00.000Z' }] })).signals).toContainEqual({
      code: 'PRODUCT_REJECTION',
      direction: 'negative',
      strength: 1,
    });
  });

  it('generates category rejection signal', () => {
    expect(evaluate(evidenceFor(productB, { categoryRejections: [{ occurredAt: '2026-07-10T00:00:00.000Z' }] })).signals[0]?.code).toBe('CATEGORY_REJECTION');
  });

  it('generates owned compatible product signal', () => {
    expect(evaluate(evidenceFor(productB, { ownedCompatibleProducts: [{ ownedProduct: { productId: 'A' } }] })).signals[0]?.code).toBe('OWNED_COMPATIBLE_PRODUCT');
  });

  it('generates observed spend fit signal', () => {
    expect(evaluate(evidenceFor(productB, { candidatePrice: { currency: 'CLP', amount: 9000 } })).signals[0]?.code).toBe('OBSERVED_SPEND_FIT');
  });

  it('warns on spend currency mismatch', () => {
    expect(evaluate(evidenceFor(productB, { candidatePrice: { currency: 'USD', amount: 20 } })).warnings[0]?.code).toBe('CURRENCY_MISMATCH');
  });

  it('warns when spend profile is missing', () => {
    const result = new DefaultCustomerAffinityEvaluator().evaluate(
      productB,
      evidenceFor(productB, { candidatePrice: { currency: 'CLP', amount: 9000 } }),
      undefined,
      affinityContext,
      DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
    );
    expect(result.warnings[0]?.code).toBe('SPEND_PROFILE_UNAVAILABLE');
  });

  it('warns when spend profile has no monetary observations', () => {
    const result = new DefaultCustomerAffinityEvaluator().evaluate(
      productB,
      evidenceFor(productB, { candidatePrice: { currency: 'CLP', amount: 9000 } }),
      { orderCount: 2 },
      affinityContext,
      DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
    );
    expect(result.warnings[0]?.code).toBe('SPEND_PROFILE_UNAVAILABLE');
  });

  it('omits spend fit without warning when price is outside observed range', () => {
    const result = evaluate(evidenceFor(productB, { candidatePrice: { currency: 'CLP', amount: 999999 } }));
    expect(result.signals.some((signal) => signal.code === 'OBSERVED_SPEND_FIT')).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('summarizes evidence counts', () => {
    expect(evaluate(evidenceFor(productB, { categoryPurchases: [{ count: 2 }] })).evidence[0]).toMatchObject({
      code: 'CATEGORY_PURCHASE',
      count: 2,
    });
  });

  it('preserves most recent timestamp in summaries', () => {
    expect(evaluate(evidenceFor(productB, {
      categoryPurchases: [
        { occurredAt: '2026-01-01T00:00:00.000Z' },
        { occurredAt: '2026-06-01T00:00:00.000Z' },
      ],
    })).evidence[0]?.mostRecentAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('ignores invalid evidence explicitly', () => {
    const result = evaluate({ product: productB, directPurchases: [{ count: -1 }] } as never);
    expect(result.warnings[0]?.code).toBe('INVALID_EVIDENCE_IGNORED');
  });

  it('returns no history warning when evidence is undefined', () => {
    const result = new DefaultCustomerAffinityEvaluator().evaluate(
      productB,
      undefined,
      undefined,
      affinityContext,
      DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
    );
    expect(result.warnings[0]?.code).toBe('NO_CUSTOMER_HISTORY');
  });
});

describe('DefaultCustomerAffinityEvaluator repeat purchase pattern', () => {
  it('does not activate below purchaseCount 2', () => {
    expect(evaluate(evidenceFor(productB, { repeatPurchasePattern: { purchaseCount: 1, lastPurchasedAt: '2026-06-01T00:00:00.000Z' } })).signals).toHaveLength(0);
  });

  it('does not activate without lastPurchasedAt even with referenceTime present', () => {
    const result = evaluate(evidenceFor(productB, { repeatPurchasePattern: { purchaseCount: 3, medianIntervalDays: 30 } }));
    expect(result.signals).toHaveLength(0);
    expect(result.warnings).toEqual([]);
  });

  it('does not activate without context.referenceTime and warns', () => {
    const result = new DefaultCustomerAffinityEvaluator().evaluate(
      productB,
      evidenceFor(productB, { repeatPurchasePattern: { purchaseCount: 3, lastPurchasedAt: '2026-06-01T00:00:00.000Z' } }),
      undefined,
      {},
      DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
    );
    expect(result.signals).toHaveLength(0);
    expect(result.warnings[0]).toMatchObject({ code: 'REFERENCE_TIME_UNAVAILABLE', details: { signal: 'REPEAT_PURCHASE_PATTERN' } });
  });

  it('activates within the configured window', () => {
    const result = evaluate(evidenceFor(productB, { repeatPurchasePattern: { purchaseCount: 3, lastPurchasedAt: '2026-06-01T00:00:00.000Z' } }));
    expect(result.signals[0]?.code).toBe('REPEAT_PURCHASE_PATTERN');
  });

  it('activates exactly at the window boundary (inclusive)', () => {
    const result = new DefaultCustomerAffinityEvaluator().evaluate(
      productB,
      evidenceFor(productB, { repeatPurchasePattern: { purchaseCount: 2, lastPurchasedAt: '2025-07-22T12:00:00.000Z' } }),
      undefined,
      { referenceTime: '2026-07-22T12:00:00.000Z' },
      DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
    );
    expect(result.signals[0]?.code).toBe('REPEAT_PURCHASE_PATTERN');
  });

  it('does not activate one second past the window boundary', () => {
    const result = new DefaultCustomerAffinityEvaluator().evaluate(
      productB,
      evidenceFor(productB, { repeatPurchasePattern: { purchaseCount: 2, lastPurchasedAt: '2025-07-22T11:59:59.000Z' } }),
      undefined,
      { referenceTime: '2026-07-22T12:00:00.000Z' },
      DEFAULT_CUSTOMER_AFFINITY_PARAMETERS,
    );
    expect(result.signals).toHaveLength(0);
  });

  it('does not activate for a lastPurchasedAt far outside the window', () => {
    const result = evaluate(evidenceFor(productB, { repeatPurchasePattern: { purchaseCount: 3, lastPurchasedAt: '2023-01-01T00:00:00.000Z' } }));
    expect(result.signals).toHaveLength(0);
  });

  it('does not activate for a lastPurchasedAt in the future relative to referenceTime', () => {
    const result = evaluate(evidenceFor(productB, { repeatPurchasePattern: { purchaseCount: 3, lastPurchasedAt: '2026-08-01T00:00:00.000Z' } }));
    expect(result.signals).toHaveLength(0);
  });

  it('is not influenced by ownership derived from legacy directPurchases', () => {
    const withoutOwnership = evaluate(evidenceFor(productB, { repeatPurchasePattern: { purchaseCount: 3, lastPurchasedAt: '2026-06-01T00:00:00.000Z' } }));
    const withOwnership = evaluate(evidenceFor(productB, {
      repeatPurchasePattern: { purchaseCount: 3, lastPurchasedAt: '2026-06-01T00:00:00.000Z' },
      directPurchases: [{ count: 5, occurredAt: '2026-06-01T00:00:00.000Z' }],
    }));
    expect(withOwnership.signals).toEqual(withoutOwnership.signals);
  });
});
