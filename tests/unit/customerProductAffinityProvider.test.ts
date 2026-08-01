import { describe, expect, it } from 'vitest';
import {
  DefaultCustomerAffinityEvaluator,
  DefaultCustomerAffinityScorer,
  DefaultCustomerProductAffinityProvider,
  CustomerAffinityError,
} from '../../src/domain/recommendation/customer-affinity/index.js';
import {
  affinityContext,
  baseAffinityRequest,
  clone,
  customer,
  customAffinityParameters,
  evidenceFor,
  evidenceResult,
  FakeCustomerAffinityEvidenceProvider,
  productB,
  productBCombo,
  productC,
} from '../fixtures/customerProductAffinity.js';

function provider(fake = new FakeCustomerAffinityEvidenceProvider()) {
  return {
    fake,
    provider: new DefaultCustomerProductAffinityProvider(
      fake,
      new DefaultCustomerAffinityEvaluator(),
      new DefaultCustomerAffinityScorer(),
    ),
  };
}

async function expectAffinityError(action: () => Promise<unknown>, code: CustomerAffinityError['code']) {
  await expect(action()).rejects.toThrow(CustomerAffinityError);
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(CustomerAffinityError);
    expect((error as CustomerAffinityError).code).toBe(code);
  }
}

describe('DefaultCustomerProductAffinityProvider orchestration', () => {
  it('calls provider once when customer and products exist', async () => {
    const context = provider();
    await context.provider.getAffinities(baseAffinityRequest);
    expect(context.fake.calls).toHaveLength(1);
  });

  it('does not call provider without customer', async () => {
    const context = provider();
    await context.provider.getAffinities({ products: [productB] });
    expect(context.fake.calls).toHaveLength(0);
  });

  it('does not call provider without products', async () => {
    const context = provider();
    await context.provider.getAffinities({ customer, products: [] });
    expect(context.fake.calls).toHaveLength(0);
  });

  it('passes deduplicated products to provider', async () => {
    const context = provider();
    await context.provider.getAffinities({ customer, products: [productB, productB, productC] });
    expect(context.fake.calls[0]?.products).toEqual([productB, productC]);
  });

  it('passes context to provider', async () => {
    const context = provider();
    await context.provider.getAffinities(baseAffinityRequest);
    expect(context.fake.calls[0]?.context).toEqual(affinityContext);
  });

  it('maps provider failure', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider();
    fake.failWith = new Error('down');
    await expectAffinityError(() => provider(fake).provider.getAffinities(baseAffinityRequest), 'EVIDENCE_PROVIDER_FAILED');
  });

  it('marks provider failure as retryable', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider();
    fake.failWith = new Error('down');
    try {
      await provider(fake).provider.getAffinities(baseAffinityRequest);
    } catch (error) {
      expect((error as CustomerAffinityError).retryable).toBe(true);
    }
  });

  it('rejects response customer mismatch', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider({ ...evidenceResult(), customer: { customerId: 'other' } });
    await expectAffinityError(() => provider(fake).provider.getAffinities(baseAffinityRequest), 'INVALID_PROVIDER_RESPONSE');
  });

  it('rejects product evidence outside requested batch', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor({ productId: 'Z' })]));
    await expectAffinityError(() => provider(fake).provider.getAffinities(baseAffinityRequest), 'INVALID_PROVIDER_RESPONSE');
  });

  it('rejects duplicate product evidence', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB), evidenceFor(productB)]));
    await expectAffinityError(() => provider(fake).provider.getAffinities(baseAffinityRequest), 'INVALID_PROVIDER_RESPONSE');
  });

  it('accepts partial provider response', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { directPurchases: [{ count: 1 }] })]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.affinities).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.code === 'PARTIAL_CUSTOMER_HISTORY')).toBe(true);
  });

  it('accepts empty provider response', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings.some((warning) => warning.code === 'NO_CUSTOMER_HISTORY')).toBe(true);
  });
});

describe('DefaultCustomerProductAffinityProvider request handling', () => {
  it('rejects invalid customer reference', async () => {
    await expectAffinityError(
      () => provider().provider.getAffinities({ customer: { customerId: 'unknown' }, products: [productB] }),
      'INVALID_CUSTOMER_REFERENCE',
    );
  });

  it('rejects invalid product reference', async () => {
    await expectAffinityError(
      () => provider().provider.getAffinities({ customer, products: [{ productId: '' }] }),
      'INVALID_PRODUCT_REFERENCE',
    );
  });

  it('rejects invalid parameters', async () => {
    await expectAffinityError(
      () => provider().provider.getAffinities({
        customer,
        products: [productB],
        parameters: { ...customAffinityParameters, minimumEvidenceForHighConfidence: 1, minimumEvidenceForMediumConfidence: 3 },
      }),
      'INVALID_PARAMETERS',
    );
  });

  it('returns an empty result for empty products', async () => {
    const result = await provider().provider.getAffinities({ customer, products: [] });
    expect(result.affinities).toEqual([]);
  });

  it('deduplicates products with first wins', async () => {
    const result = await provider().provider.getAffinities({ products: [productB, productB, productC] });
    expect(result.affinities.map((affinity) => affinity.product.productId)).toEqual(['B', 'C']);
  });

  it('distinguishes combinations during deduplication', async () => {
    const result = await provider().provider.getAffinities({ products: [productB, productBCombo] });
    expect(result.affinities).toHaveLength(2);
  });

  it('does not modify request', async () => {
    const request = clone(baseAffinityRequest);
    const before = clone(request);
    await provider().provider.getAffinities(request);
    expect(request).toEqual(before);
  });
});

describe('DefaultCustomerProductAffinityProvider safe degradation', () => {
  it('returns neutral affinities without customer', async () => {
    const result = await provider().provider.getAffinities({ products: [productB] });
    expect(result.affinities[0]).toMatchObject({ score: 0, confidence: 'none', signals: [] });
  });

  it('adds global warning without customer', async () => {
    const result = await provider().provider.getAffinities({ products: [productB] });
    expect(result.warnings[0]?.code).toBe('CUSTOMER_NOT_IDENTIFIED');
  });

  it('returns neutral affinities without history', async () => {
    const result = await provider(new FakeCustomerAffinityEvidenceProvider(evidenceResult([]))).provider.getAffinities(baseAffinityRequest);
    expect(result.affinities.every((affinity) => affinity.score === 0 && affinity.confidence === 'none')).toBe(true);
  });

  it('adds per-product no-history warnings for missing evidence', async () => {
    const result = await provider(new FakeCustomerAffinityEvidenceProvider(evidenceResult([]))).provider.getAffinities(baseAffinityRequest);
    expect(result.affinities[0]?.warnings[0]?.code).toBe('NO_CUSTOMER_HISTORY');
  });

  it('does not treat missing product evidence as an error', async () => {
    await expect(provider(new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB)]))).provider.getAffinities(baseAffinityRequest)).resolves.toBeTruthy();
  });

  it('uses partial-history warning for products missing evidence when other history exists', async () => {
    const result = await provider(new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB)]))).provider.getAffinities(baseAffinityRequest);
    expect(result.affinities[1]?.warnings[0]?.code).toBe('PARTIAL_CUSTOMER_HISTORY');
    expect(result.affinities[1]?.warnings.some((warning) => warning.code === 'NO_CUSTOMER_HISTORY')).toBe(false);
  });
});

describe('DefaultCustomerProductAffinityProvider result generation', () => {
  it('preserves input order', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productC), evidenceFor(productB)]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB, productC] });
    expect(result.affinities.map((affinity) => affinity.product.productId)).toEqual(['B', 'C']);
  });

  it('returns one affinity per deduplicated product', async () => {
    const result = await provider().provider.getAffinities({ customer, products: [productB, productB, productC] });
    expect(result.affinities).toHaveLength(2);
  });

  it('does not generate score from legacy direct-purchase-only evidence', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { directPurchases: [{ count: 1 }] })]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(result.affinities[0]?.score).toBe(0);
  });

  it('does not generate score from three legacy direct purchases either', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { directPurchases: [{ count: 3 }] })]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(result.affinities[0]?.score).toBe(0);
  });

  it('does not generate a DIRECT_PRODUCT_PURCHASE signal from legacy direct purchases', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { directPurchases: [{ count: 3 }] })]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(result.affinities[0]?.signals).toEqual([]);
  });

  it('does not raise confidence from legacy direct-purchase-only evidence', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { directPurchases: [{ count: 3 }] })]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(result.affinities[0]?.confidence).toBe('none');
  });

  it('derives ownership from legacy direct purchases without touching score or confidence', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { directPurchases: [{ count: 3 }] })]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(result.affinities[0]).toMatchObject({
      score: 0,
      confidence: 'none',
      signals: [],
      ownership: { previouslyPurchased: true },
    });
  });

  it('generates confidence from evidence', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, {
      categoryPurchases: [{ count: 1 }],
      brandPurchases: [{ count: 1 }],
    })]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(result.affinities[0]?.confidence).toBe('medium');
  });

  it('does not change confidence when legacy direct purchases are added on top of real signals', async () => {
    const withoutDirectPurchases = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, {
      categoryPurchases: [{ count: 1 }],
      brandPurchases: [{ count: 1 }],
    })]));
    const withDirectPurchases = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, {
      categoryPurchases: [{ count: 1 }],
      brandPurchases: [{ count: 1 }],
      directPurchases: [{ count: 5 }],
    })]));
    const baseline = await provider(withoutDirectPurchases).provider.getAffinities({ customer, products: [productB] });
    const withOwnership = await provider(withDirectPurchases).provider.getAffinities({ customer, products: [productB] });
    expect(withOwnership.affinities[0]?.confidence).toBe(baseline.affinities[0]?.confidence);
    expect(withOwnership.affinities[0]?.score).toBe(baseline.affinities[0]?.score);
  });

  it('includes scoring version', async () => {
    const result = await provider().provider.getAffinities(baseAffinityRequest);
    expect(result.affinities[0]?.scoringVersion).toBe('customer-affinity-v2');
  });

  it('maps provider warnings to global warnings', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider({ ...evidenceResult([evidenceFor(productB)]), warnings: [{ code: 'UPSTREAM_PARTIAL' }] });
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(result.warnings[0]?.code).toBe('AFFINITY_PROVIDER_WARNING');
  });

  it('keeps evidence summaries structured', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { categoryPurchases: [{ count: 2 }] })]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(result.affinities[0]?.evidence[0]).toMatchObject({ code: 'CATEGORY_PURCHASE', count: 2 });
  });

  it('does not produce a DIRECT_PRODUCT_PURCHASE evidence summary from legacy direct purchases', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { directPurchases: [{ count: 2 }] })]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(result.affinities[0]?.evidence).toEqual([]);
  });
});

describe('DefaultCustomerProductAffinityProvider statistics and immutability', () => {
  it('counts requested products', async () => {
    expect((await provider().provider.getAffinities({ products: [productB, productB, productC] })).statistics.requestedProducts).toBe(3);
  });

  it('counts deduplicated products', async () => {
    expect((await provider().provider.getAffinities({ products: [productB, productB, productC] })).statistics.deduplicatedProducts).toBe(2);
  });

  it('counts duplicate products removed', async () => {
    expect((await provider().provider.getAffinities({ products: [productB, productB] })).statistics.duplicateProductsRemoved).toBe(1);
  });

  it('counts products with evidence', async () => {
    expect((await provider().provider.getAffinities({ customer, products: [productB] })).statistics.productsWithEvidence).toBe(1);
  });

  it('counts products without evidence', async () => {
    const result = await provider(new FakeCustomerAffinityEvidenceProvider(evidenceResult([]))).provider.getAffinities({ customer, products: [productB] });
    expect(result.statistics.productsWithoutEvidence).toBe(1);
  });

  it('counts positive signals', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { categoryPurchases: [{ count: 1 }] })]));
    expect((await provider(fake).provider.getAffinities({ customer, products: [productB] })).statistics.positiveSignalsGenerated).toBe(1);
  });

  it('does not count legacy direct purchases as a positive signal', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { directPurchases: [{ count: 1 }] })]));
    expect((await provider(fake).provider.getAffinities({ customer, products: [productB] })).statistics.positiveSignalsGenerated).toBe(0);
  });

  it('counts negative signals', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { productRejections: [{ count: 1 }] })]));
    expect((await provider(fake).provider.getAffinities({ customer, products: [productB] })).statistics.negativeSignalsGenerated).toBe(1);
  });

  it('counts warnings', async () => {
    expect((await provider().provider.getAffinities({ products: [productB] })).statistics.warningsGenerated).toBe(1);
  });

  it('counts provider calls', async () => {
    expect((await provider().provider.getAffinities(baseAffinityRequest)).statistics.providerCalls).toBe(1);
  });

  it('satisfies statistics invariants', async () => {
    const stats = (await provider().provider.getAffinities({ products: [productB, productB, productC] })).statistics;
    expect(stats.requestedProducts).toBe(stats.deduplicatedProducts + stats.duplicateProductsRemoved);
    expect(stats.productsWithEvidence + stats.productsWithoutEvidence).toBe(stats.deduplicatedProducts);
  });

  it('deep freezes affinities', async () => {
    expect(Object.isFrozen((await provider().provider.getAffinities(baseAffinityRequest)).affinities)).toBe(true);
  });

  it('deep freezes signals', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { categoryPurchases: [{ count: 1 }] })]));
    expect(Object.isFrozen((await provider(fake).provider.getAffinities({ customer, products: [productB] })).affinities[0]?.signals)).toBe(true);
  });

  it('deep freezes ownership', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB, { directPurchases: [{ count: 1 }] })]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productB] });
    expect(Object.isFrozen(result.affinities[0]?.ownership)).toBe(true);
  });

  it('does not leak provider object references', async () => {
    const productEvidence = evidenceFor(productB, { categoryPurchases: [{ count: 1 }] });
    const result = await provider(new FakeCustomerAffinityEvidenceProvider(evidenceResult([productEvidence]))).provider.getAffinities({ customer, products: [productB] });
    productEvidence.categoryPurchases = [{ count: 99 }];
    expect(result.affinities[0]?.evidence[0]?.count).toBe(1);
  });

  it('does not leak provider object references through ownership', async () => {
    const productEvidence = evidenceFor(productB, { directPurchases: [{ count: 1, occurredAt: '2026-01-01T00:00:00.000Z' }] });
    const result = await provider(new FakeCustomerAffinityEvidenceProvider(evidenceResult([productEvidence]))).provider.getAffinities({ customer, products: [productB] });
    productEvidence.directPurchases = [{ count: 99, occurredAt: '2026-06-01T00:00:00.000Z' }];
    expect(result.affinities[0]?.ownership?.totalOrderCount).toBe(1);
  });

  it('serializes result to JSON', async () => {
    const result = await provider().provider.getAffinities(baseAffinityRequest);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('is deterministic for same input', async () => {
    const first = await provider().provider.getAffinities(baseAffinityRequest);
    const second = await provider().provider.getAffinities(baseAffinityRequest);
    expect(second).toEqual(first);
  });

  it('does not expose SQL, Redis, CRM, Customer 360, PrestaShop, LLM, or E2E markers', async () => {
    const serialized = JSON.stringify(await provider().provider.getAffinities(baseAffinityRequest)).toLowerCase();
    expect(serialized).not.toMatch(/select |redis|crm|customer 360|prestashop|llm|e2e/u);
  });
});

describe('DefaultCustomerProductAffinityProvider variant identity isolation (CP-R1-T10B3B correction)', () => {
  const productBCombo11 = { productId: 'B', combinationId: '11' } as const;

  it('does not apply base-product evidence to a variant candidate in the same batch', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([
      evidenceFor(productB, { directPurchases: [{ count: 5, occurredAt: '2026-06-01T00:00:00.000Z' }] }),
    ]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productBCombo, productB] });
    const variantAffinity = result.affinities.find((affinity) => affinity.product.combinationId === '10');
    const baseAffinity = result.affinities.find((affinity) => affinity.product.combinationId === undefined);
    expect(variantAffinity?.ownership).toBeUndefined();
    expect(variantAffinity?.warnings.some((item) => item.code === 'PARTIAL_CUSTOMER_HISTORY')).toBe(true);
    expect(baseAffinity?.ownership).toMatchObject({ previouslyPurchased: true });
  });

  it('does not apply variant 10 evidence to variant 11 in the same batch', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([
      evidenceFor(productBCombo, { directPurchases: [{ count: 5, occurredAt: '2026-06-01T00:00:00.000Z' }] }),
    ]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productBCombo, productBCombo11] });
    const variant10Affinity = result.affinities.find((affinity) => affinity.product.combinationId === '10');
    const variant11Affinity = result.affinities.find((affinity) => affinity.product.combinationId === '11');
    expect(variant10Affinity?.ownership).toMatchObject({ previouslyPurchased: true, exactVariantPreviouslyPurchased: true });
    expect(variant11Affinity?.ownership).toBeUndefined();
    expect(variant11Affinity?.warnings.some((item) => item.code === 'PARTIAL_CUSTOMER_HISTORY')).toBe(true);
  });

  it('derives exactVariantPreviouslyPurchased=true only when evidence is matched to that exact variant', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([
      evidenceFor(productBCombo, { directPurchases: [{ count: 2, occurredAt: '2026-06-01T00:00:00.000Z' }] }),
    ]));
    const result = await provider(fake).provider.getAffinities({ customer, products: [productBCombo] });
    expect(result.affinities[0]?.ownership).toEqual({
      previouslyPurchased: true,
      exactVariantPreviouslyPurchased: true,
      totalOrderCount: 2,
      firstPurchasedAt: '2026-06-01T00:00:00.000Z',
      lastPurchasedAt: '2026-06-01T00:00:00.000Z',
    });
  });
});

describe('DefaultCustomerProductAffinityProvider customer history availability (CP-R1-T10B4A)', () => {
  it('maps customer_history_not_linked to a single global CUSTOMER_HISTORY_NOT_LINKED warning', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_history_not_linked' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings).toEqual([{ code: 'CUSTOMER_HISTORY_NOT_LINKED' }]);
  });

  it('does not add NO_CUSTOMER_HISTORY or AFFINITY_PROVIDER_WARNING alongside CUSTOMER_HISTORY_NOT_LINKED', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_history_not_linked' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings.some((item) => item.code === 'NO_CUSTOMER_HISTORY')).toBe(false);
    expect(result.warnings.some((item) => item.code === 'AFFINITY_PROVIDER_WARNING')).toBe(false);
  });

  it('does not add a per-product warning for CUSTOMER_HISTORY_NOT_LINKED', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_history_not_linked' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.affinities.every((affinity) => affinity.warnings.length === 0)).toBe(true);
  });

  it('keeps every candidate neutral for CUSTOMER_HISTORY_NOT_LINKED', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_history_not_linked' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.affinities.every((affinity) => (
      affinity.score === 0 && affinity.confidence === 'none' && affinity.signals.length === 0 && affinity.evidence.length === 0
    ))).toBe(true);
    expect(result.affinities.every((affinity) => affinity.ownership === undefined)).toBe(true);
  });

  it('maps customer_reference_not_found to a single global CUSTOMER_REFERENCE_NOT_FOUND warning', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_reference_not_found' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings).toEqual([{ code: 'CUSTOMER_REFERENCE_NOT_FOUND' }]);
  });

  it('does not add NO_CUSTOMER_HISTORY or AFFINITY_PROVIDER_WARNING alongside CUSTOMER_REFERENCE_NOT_FOUND', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_reference_not_found' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings.some((item) => item.code === 'NO_CUSTOMER_HISTORY')).toBe(false);
    expect(result.warnings.some((item) => item.code === 'AFFINITY_PROVIDER_WARNING')).toBe(false);
  });

  it('keeps every candidate neutral for CUSTOMER_REFERENCE_NOT_FOUND', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_reference_not_found' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.affinities.every((affinity) => affinity.score === 0 && affinity.confidence === 'none')).toBe(true);
    expect(result.affinities.every((affinity) => affinity.ownership === undefined)).toBe(true);
  });

  it('does not treat an unrecognized warning code as reserved even when it spells a T09-internal code', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'NO_CUSTOMER_HISTORY' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings.some((item) => item.code === 'AFFINITY_PROVIDER_WARNING')).toBe(true);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_HISTORY_NOT_LINKED')).toBe(false);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_REFERENCE_NOT_FOUND')).toBe(false);
    expect(result.warnings.some((item) => item.code === 'NO_CUSTOMER_HISTORY')).toBe(true);
  });

  it('normalizes peripheral whitespace around a reserved code, same as every other free-form string in this contract', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: '  customer_history_not_linked  ' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings).toEqual([{ code: 'CUSTOMER_HISTORY_NOT_LINKED' }]);
  });

  it('does not recognize an upper-case variant of a reserved code (case-sensitive whitelist)', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'CUSTOMER_HISTORY_NOT_LINKED' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_HISTORY_NOT_LINKED')).toBe(false);
    expect(result.warnings.some((item) => item.code === 'AFFINITY_PROVIDER_WARNING')).toBe(true);
  });

  it('does not recognize a reserved code spelled with internal spaces instead of underscores', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer history not linked' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings.some((item) => item.code === 'CUSTOMER_HISTORY_NOT_LINKED')).toBe(false);
    expect(result.warnings.some((item) => item.code === 'AFFINITY_PROVIDER_WARNING')).toBe(true);
  });

  it('deduplicates a reserved warning sent more than once into a single global entry', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [
      { code: 'customer_history_not_linked' },
      { code: 'customer_history_not_linked' },
    ]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings).toEqual([{ code: 'CUSTOMER_HISTORY_NOT_LINKED' }]);
    expect(result.statistics.warningsGenerated).toBe(1);
  });

  it('rejects a provider response declaring both reserved warnings at once', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [
      { code: 'customer_history_not_linked' },
      { code: 'customer_reference_not_found' },
    ]));
    await expectAffinityError(() => provider(fake).provider.getAffinities(baseAffinityRequest), 'INVALID_PROVIDER_RESPONSE');
  });

  it('rejects a reserved warning alongside actual product evidence', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([evidenceFor(productB)], [{ code: 'customer_history_not_linked' }]));
    await expectAffinityError(() => provider(fake).provider.getAffinities(baseAffinityRequest), 'INVALID_PROVIDER_RESPONSE');
  });

  it('does not include details on the reserved global warning', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_history_not_linked' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings[0]).toEqual({ code: 'CUSTOMER_HISTORY_NOT_LINKED' });
  });

  it('counts statistics correctly for a reserved-only response', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_reference_not_found' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.statistics.productsWithEvidence).toBe(0);
    expect(result.statistics.productsWithoutEvidence).toBe(2);
    expect(result.statistics.warningsGenerated).toBe(1);
  });

  it('still produces NO_CUSTOMER_HISTORY for a plain empty response without a reserved warning (unchanged)', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(result.warnings.some((item) => item.code === 'NO_CUSTOMER_HISTORY')).toBe(true);
    expect(result.warnings.some((item) => (
      item.code === 'CUSTOMER_HISTORY_NOT_LINKED' || item.code === 'CUSTOMER_REFERENCE_NOT_FOUND'
    ))).toBe(false);
  });

  it('deep freezes the result for a reserved warning response', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_history_not_linked' }]));
    const result = await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(Object.isFrozen(result.warnings)).toBe(true);
    expect(Object.isFrozen(result.affinities)).toBe(true);
  });

  it('does not mutate the provider warnings input array', async () => {
    const providerWarnings = [{ code: 'customer_history_not_linked' }];
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], providerWarnings));
    await provider(fake).provider.getAffinities(baseAffinityRequest);
    expect(providerWarnings).toEqual([{ code: 'customer_history_not_linked' }]);
  });

  it('does not expose provider payload markers, PII, or infrastructure identifiers for a reserved warning', async () => {
    const fake = new FakeCustomerAffinityEvidenceProvider(evidenceResult([], [{ code: 'customer_history_not_linked' }]));
    const serialized = JSON.stringify(await provider(fake).provider.getAffinities(baseAffinityRequest)).toLowerCase();
    expect(serialized).not.toMatch(/select |redis|crm|customer 360|prestashop|llm|e2e|mastercustomerid|prestashopcustomerid/u);
  });
});
