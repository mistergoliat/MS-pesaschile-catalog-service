import { describe, expect, it } from 'vitest';
import {
  DefaultProductClarificationBuilder,
  DefaultProductConstraintEvaluator,
  DefaultProductExplicitConstraintExtractor,
  DefaultProductIntentCandidateRanker,
  DefaultProductIntentResolutionPolicy,
  DefaultProductQueryNormalizer,
  StaticProductSearchSynonymProvider,
  type ExplicitProductConstraints,
  type ProductIntentCatalogProduct,
} from '../../src/application/catalog/product-intent/index.js';
import {
  buildProductIntentHarness,
  bumper20,
  curlBar,
  hexBar,
  hit,
  kettlebell16,
  olympicBar15,
  olympicBar20,
} from '../fixtures/productIntentResolution.js';

function expanded(query: string) {
  const normalized = new DefaultProductQueryNormalizer().normalize(query);
  return new StaticProductSearchSynonymProvider().expand(normalized);
}

function constraints(query: string): ExplicitProductConstraints {
  return new DefaultProductExplicitConstraintExtractor().extract(expanded(query));
}

function rank(query: string, products: readonly ProductIntentCatalogProduct[]) {
  const normalized = expanded(query);
  return new DefaultProductIntentCandidateRanker().rank(normalized, constraints(query), products);
}

function evaluation(query: string, product: ProductIntentCatalogProduct) {
  return new DefaultProductConstraintEvaluator().evaluate(constraints(query), product);
}

function rankedCandidate(product: ProductIntentCatalogProduct, patch: Partial<ReturnType<typeof rank>[number]> = {}) {
  return {
    product,
    score: 0.9,
    reasons: ['NAME_TOKEN_MATCH' as const],
    plausible: true,
    constraintEvaluation: {
      explicitConstraintCount: 0,
      matchedConstraintCount: 0,
      satisfiesAllExplicitConstraints: false,
      hasContradiction: false,
      constraints: [],
    },
    ...patch,
  };
}

describe('explicit product constraint calibration', () => {
  it('extracts weight in kg', () => {
    expect(constraints('barra olimpica 15 kg').weight).toMatchObject({ normalizedValue: 15, normalizedUnit: 'kg' });
  });

  it('extracts weight without space', () => {
    expect(constraints('barra olimpica 15kg').weight).toMatchObject({ normalizedValue: 15, normalizedUnit: 'kg' });
  });

  it('extracts weight from kilos word', () => {
    expect(constraints('barra olimpica 15 kilos').weight).toMatchObject({ normalizedValue: 15, normalizedUnit: 'kg' });
  });

  it('extracts diameter', () => {
    expect(constraints('collarines 50 mm').diameter).toMatchObject({ normalizedValue: 50, normalizedUnit: 'mm' });
  });

  it('extracts diameter in inches without converting unsafely', () => {
    expect(constraints('collarines 2 pulgadas').diameter).toMatchObject({ normalizedValue: 2, normalizedUnit: 'in' });
  });

  it('extracts length', () => {
    expect(constraints('barra olimpica 220cm').length).toMatchObject({ normalizedValue: 220, normalizedUnit: 'cm' });
  });

  it('converts meters to centimeters deterministically', () => {
    expect(constraints('barra olimpica 2.2 m').length).toMatchObject({ normalizedValue: 220, normalizedUnit: 'cm' });
  });

  it('extracts olympic bar type', () => {
    expect(constraints('barra olimpica').productType).toBe('olympic_bar');
  });

  it('extracts olympic bar type from sentadilla synonym', () => {
    expect(constraints('barra para hacer sentadillas').productType).toBe('olympic_bar');
  });

  it('extracts curl bar type', () => {
    expect(constraints('barra z').productType).toBe('curl_bar');
  });

  it('extracts hex bar type', () => {
    expect(constraints('barra hexagonal').productType).toBe('hex_bar');
  });

  it('extracts kettlebell type from synonym phrase', () => {
    expect(constraints('pesas rusas de 16 kg').productType).toBe('kettlebell');
  });

  it('does not force generic barra into a product type', () => {
    expect(constraints('barra').productType).toBeUndefined();
  });

  it('expands generic barra only for retrieval support', () => {
    const result = expanded('barra');
    expect(result.synonymTerms).toEqual(['barra olimpica', 'barra z', 'barra hexagonal']);
    expect(constraints('barra').productType).toBeUndefined();
  });

  it('classifies matching constraints as matched', () => {
    const result = evaluation('barra olimpica 15 kg', olympicBar15);
    expect(result.satisfiesAllExplicitConstraints).toBe(true);
    expect(result.constraints.map((item) => item.status)).toEqual(['matched', 'matched']);
  });

  it('classifies missing measurement as not_available', () => {
    const result = evaluation('barra olimpica 15 kg', { ...olympicBar15, name: 'Barra olimpica', description: undefined, attributes: [] });
    expect(result.constraints.find((item) => item.type === 'weight')?.status).toBe('not_available');
  });

  it('classifies wrong weight as contradicted', () => {
    expect(evaluation('barra olimpica 15 kg', olympicBar20).constraints.find((item) => item.type === 'weight')?.status).toBe('contradicted');
  });

  it('classifies wrong type as contradicted', () => {
    expect(evaluation('barra olimpica 15 kg', kettlebell16).constraints.find((item) => item.type === 'product_type')?.status).toBe('contradicted');
  });

  it('penalizes weight contradiction strongly', () => {
    const ranked = rank('barra olimpica 15 kg', [olympicBar15, olympicBar20]);
    expect(ranked[0]?.product.productId).toBe('29');
    expect(ranked.find((item) => item.product.productId === '30')?.plausible).toBe(false);
  });

  it('penalizes type contradiction strongly', () => {
    const ranked = rank('barra olimpica 15 kg', [kettlebell16, olympicBar15]);
    expect(ranked[0]?.product.productId).toBe('29');
    expect(ranked.find((item) => item.product.productId === '700')?.plausible).toBe(false);
  });

  it('description does not compensate explicit contradiction', () => {
    const wrong = { ...kettlebell16, description: 'barra olimpica 15 kg barra olimpica 15 kg' };
    const ranked = rank('barra olimpica 15 kg', [wrong, olympicBar15]);
    expect(ranked.find((item) => item.product.productId === '700')?.plausible).toBe(false);
    expect(ranked[0]?.product.productId).toBe('29');
  });

  it('synonym does not compensate explicit contradiction', () => {
    const wrong = { ...olympicBar15, productId: '999', name: 'Kettlebell 15 kg', description: 'pesa rusa' };
    const ranked = rank('pesas rusas de 16 kg', [wrong, kettlebell16]);
    expect(ranked.find((item) => item.product.productId === '999')?.plausible).toBe(false);
  });

  it('single full explicit match resolves', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15), hit(olympicBar20)] }).service.resolve({
      query: 'barra olimpica 15 kg',
      filters: { inStockOnly: true },
      limit: 5,
    });
    expect(result.resolution).toMatchObject({ status: 'resolved', sourceProduct: { productId: '29' } });
  });

  it('single kettlebell full explicit match resolves', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(kettlebell16), hit(olympicBar15)] }).service.resolve({
      query: 'pesas rusas de 16 kg',
      filters: { inStockOnly: true },
      limit: 5,
    });
    expect(result.resolution).toMatchObject({ status: 'resolved', sourceProduct: { productId: '700', combinationId: '160' } });
  });

  it('two full explicit matches require clarification', () => {
    const product31 = { ...olympicBar15, productId: '31', name: 'Barra olimpica 15 kg 200 cm' };
    const ranked = rank('barra olimpica 15 kg', [olympicBar15, product31, olympicBar20]);
    const decision = new DefaultProductIntentResolutionPolicy().resolve(ranked, constraints('barra olimpica 15 kg'));
    expect(decision.status).toBe('clarification_required');
  });

  it('all contradictory candidates produce no_match', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(kettlebell16), hit(olympicBar20)] }).service.resolve({
      query: 'barra olimpica 15 kg',
      filters: { inStockOnly: true },
      limit: 5,
    });
    expect(result.resolution.status).toBe('no_match');
    expect(result.candidates).toEqual([]);
  });

  it('partial type-only constraint does not resolve aggressively when alternatives remain', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15), hit(olympicBar20)] }).service.resolve({
      query: 'barra olimpica',
      filters: { inStockOnly: true },
      limit: 5,
    });
    expect(result.resolution.status).toBe('clarification_required');
  });

  it('clarification excludes already supplied weight', () => {
    const product31 = { ...olympicBar15, productId: '31', name: 'Barra olimpica 15 kg 200 cm' };
    const ranked = rank('barra olimpica 15 kg', [olympicBar15, product31]);
    const clarification = new DefaultProductClarificationBuilder().build(ranked, constraints('barra olimpica 15 kg'));
    expect(clarification.dimension).not.toBe('weight');
  });

  it('clarification uses only plausible candidates', () => {
    const clarification = new DefaultProductClarificationBuilder().build([
      rankedCandidate(olympicBar15),
      rankedCandidate(hexBar, { plausible: false }),
    ], constraints('barra olimpica'));
    expect(JSON.stringify(clarification)).not.toContain('818');
  });

  it('bumper 20 kg is plausible over bumper 10 kg and iron 20 kg', () => {
    const bumper10 = { ...bumper20, productId: '465', name: 'Disco bumper 10 kg', attributes: [{ group: 'Peso', value: '10 kg' }] };
    const iron20 = { ...bumper20, productId: '466', name: 'Disco hierro 20 kg', description: 'Disco de hierro', attributes: [{ group: 'Peso', value: '20 kg' }] };
    const ranked = rank('discos bumper 20 kg', [bumper10, iron20, bumper20]);
    expect(ranked[0]?.product.productId).toBe('464');
    expect(ranked.find((item) => item.product.productId === '465')?.plausible).toBe(false);
    expect(ranked.find((item) => item.product.productId === '466')?.plausible).toBe(false);
  });

  it('collarines 50 mm rejects other diameters', () => {
    const collar50 = { ...olympicBar15, productId: '501', name: 'Collarines olimpicos 50 mm', description: 'seguros barra 50 mm' };
    const collar25 = { ...olympicBar15, productId: '502', name: 'Collarines 25 mm', description: 'seguros barra 25 mm' };
    const ranked = rank('collarines 50 mm', [collar25, collar50]);
    expect(ranked[0]?.product.productId).toBe('501');
    expect(ranked.find((item) => item.product.productId === '502')?.plausible).toBe(false);
  });

  it('barra z does not prioritize straight olympic bars', () => {
    const ranked = rank('barra z', [olympicBar15, curlBar]);
    expect(ranked[0]?.product.productId).toBe('325');
    expect(ranked.find((item) => item.product.productId === '29')?.plausible).toBe(false);
  });

  it('barra hexagonal keeps only hexagonal candidates plausible', () => {
    const ranked = rank('barra hexagonal', [olympicBar15, hexBar]);
    expect(ranked[0]?.product.productId).toBe('818');
    expect(ranked.find((item) => item.product.productId === '29')?.plausible).toBe(false);
  });

  it('kettlebell unavailable weight does not become matched', () => {
    const product = { ...kettlebell16, name: 'Kettlebell', description: 'pesa rusa', attributes: [] };
    const result = evaluation('pesas rusas de 16 kg', product);
    expect(result.constraints.find((item) => item.type === 'weight')?.status).toBe('not_available');
  });

  it('kettlebell 99 kg produces no_match', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(kettlebell16)] }).service.resolve({
      query: 'kettlebell 99 kg',
      filters: { inStockOnly: true },
      limit: 5,
    });
    expect(result.resolution.status).toBe('no_match');
  });

  it('ranking remains deterministic', () => {
    expect(rank('barra olimpica 15 kg', [olympicBar20, olympicBar15])).toEqual(rank('barra olimpica 15 kg', [olympicBar20, olympicBar15]));
  });

  it('score remains between zero and one', () => {
    expect(rank('barra olimpica 15 kg', [olympicBar15, olympicBar20, kettlebell16]).every((item) => item.score >= 0 && item.score <= 1)).toBe(true);
  });

  it('provider order does not affect winner', () => {
    const first = rank('barra olimpica 15 kg', [olympicBar20, olympicBar15])[0]?.product.productId;
    const second = rank('barra olimpica 15 kg', [olympicBar15, olympicBar20])[0]?.product.productId;
    expect(second).toBe(first);
  });

  it('does not introduce extra enrichment calls', async () => {
    const harness = buildProductIntentHarness();
    await harness.service.resolve({ query: 'barra olimpica 15 kg', limit: 5 });
    expect(harness.catalog.calls).toHaveLength(1);
  });

  it('does not call T11.3 or snapshot collaborators', async () => {
    const harness = buildProductIntentHarness();
    await harness.service.resolve({ query: 'pesas rusas de 16 kg', limit: 5 });
    expect(harness.searcher.calls).toHaveLength(1);
    expect(harness.catalog.calls).toHaveLength(1);
  });

  it('logs do not include full query text', async () => {
    const harness = buildProductIntentHarness({ hits: [hit(olympicBar15)] });
    await harness.service.resolve({ query: 'barra olimpica 15 kg', limit: 5 });
    expect(JSON.stringify(harness.logger.events)).not.toContain('barra olimpica');
  });
});
