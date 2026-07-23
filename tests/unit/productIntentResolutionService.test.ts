import { describe, expect, it } from 'vitest';
import {
  DefaultProductClarificationBuilder,
  DefaultProductIntentCandidateRanker,
  DefaultProductIntentResolutionService,
  DefaultProductIntentResolutionPolicy,
  DefaultProductQueryNormalizer,
  StaticProductSearchSynonymProvider,
  createProductIntentIdentity,
} from '../../src/application/catalog/product-intent/index.js';
import { ProductIntentResolutionError } from '../../src/application/catalog/product-intent/index.js';
import {
  baseResolveProductIntentRequest,
  buildProductIntentHarness,
  bumper20,
  curlBar,
  hexBar,
  hit,
  inactiveBar,
  kettlebell16,
  noPriceBar,
  olympicBar15,
  olympicBar20,
  outOfStockBar,
  unknownStockBar,
} from '../fixtures/productIntentResolution.js';

describe('Product Intent Resolution', () => {
  it('rejects empty query', async () => {
    await expect(buildProductIntentHarness().service.resolve({ query: ' ', limit: 5 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('normalizes redundant spaces', () => {
    const result = new DefaultProductQueryNormalizer().normalize('  Barra   Olimpica   ');
    expect(result.normalized).toBe('barra olimpica');
  });

  it('preserves original query text', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15)] }).service.resolve({
      ...baseResolveProductIntentRequest,
      query: '  Barra   Olimpica 15kg  ',
    });
    expect(result.query.original).toBe('  Barra   Olimpica 15kg  ');
  });

  it('normalizes accents and case', () => {
    const result = new DefaultProductQueryNormalizer().normalize('BARRA OLÍMPICA');
    expect(result.normalized).toBe('barra olimpica');
  });

  it('normalizes 20kg as 20 kg', () => {
    const result = new DefaultProductQueryNormalizer().normalize('discos de goma 20kg');
    expect(result.unitTokens).toContain('20 kg');
  });

  it('expands catalog synonyms centrally', () => {
    const normalizer = new DefaultProductQueryNormalizer();
    const expanded = new StaticProductSearchSynonymProvider().expand(normalizer.normalize('pesas rusas de 16 kg'));
    expect(expanded.synonymTerms).toContain('kettlebell');
  });

  it('resolves exact reference match', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15)] }).service.resolve({
      query: 'BAR-15',
      limit: 5,
    });
    expect(result.resolution).toMatchObject({ status: 'resolved', confidence: 1, sourceProduct: { productId: '29' } });
    expect(result.candidates[0]?.match.reasons).toContain('EXACT_REFERENCE_MATCH');
  });

  it('resolves exact name match', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15)] }).service.resolve({
      query: 'Barra olimpica 15 kg',
      limit: 5,
    });
    expect(result.resolution.status).toBe('resolved');
    expect(result.candidates[0]?.match.reasons).toContain('EXACT_NAME_MATCH');
  });

  it('recovers candidates for partial match', async () => {
    const result = await buildProductIntentHarness().service.resolve({ query: 'barra', limit: 5 });
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.candidates[0]?.match.reasons).toContain('NAME_TOKEN_MATCH');
  });

  it('synonym recovers kettlebell candidate', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(kettlebell16)] }).service.resolve({
      query: 'pesas rusas de 16 kg',
      limit: 5,
    });
    expect(result.candidates[0]?.product.productId).toBe('700');
    expect(result.candidates[0]?.match.reasons).toContain('SYNONYM_MATCH');
  });

  it('weight attribute affects ranking', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar20), hit(olympicBar15)] }).service.resolve({
      query: 'barra olimpica 15kg',
      limit: 5,
    });
    expect(result.candidates[0]?.product.productId).toBe('29');
    expect(result.candidates[0]?.match.reasons).toContain('ATTRIBUTE_MATCH');
  });

  it('category contributes to ranking', async () => {
    const ranked = new DefaultProductIntentCandidateRanker().rank(
      new DefaultProductQueryNormalizer().normalize('barra'),
      [bumper20, olympicBar15],
      { category: 'Barras' },
    );
    expect(ranked[0]?.product.productId).toBe('29');
    expect(ranked[0]?.reasons).toContain('CATEGORY_MATCH');
  });

  it('excludes inactive products', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(inactiveBar), hit(olympicBar15)], products: [inactiveBar, olympicBar15] }).service.resolve({
      query: 'barra',
      limit: 5,
    });
    expect(result.candidates.map((candidate) => candidate.product.productId)).not.toContain('99');
  });

  it('inStockOnly true excludes unavailable products', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(outOfStockBar), hit(olympicBar15)], products: [outOfStockBar, olympicBar15] }).service.resolve({
      query: 'barra',
      filters: { inStockOnly: true },
      limit: 5,
    });
    expect(result.candidates.map((candidate) => candidate.product.productId)).not.toContain('100');
  });

  it('inStockOnly false keeps out-of-stock products', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(outOfStockBar)], products: [outOfStockBar] }).service.resolve({
      query: 'barra sin stock',
      filters: { inStockOnly: false },
      limit: 5,
    });
    expect(result.candidates[0]?.product.stock.status).toBe('out_of_stock');
  });

  it('does not invent missing price', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(noPriceBar)], products: [noPriceBar] }).service.resolve({
      query: 'barra sin precio',
      limit: 5,
    });
    expect(result.candidates[0]?.product.price).toBeNull();
    expect(result.warnings.some((warning) => warning.code === 'CATALOG_PRICE_UNAVAILABLE')).toBe(true);
  });

  it('does not invent unknown stock', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(unknownStockBar)], products: [unknownStockBar] }).service.resolve({
      query: 'barra stock desconocido',
      filters: { inStockOnly: false },
      limit: 5,
    });
    expect(result.candidates[0]?.product.stock).toEqual({ status: 'unknown', available: false });
    expect(result.warnings.some((warning) => warning.code === 'CATALOG_STOCK_UNKNOWN')).toBe(true);
  });

  it('ranking is deterministic', async () => {
    const harness = buildProductIntentHarness();
    const first = await harness.service.resolve({ query: 'barra', limit: 5 });
    const second = await harness.service.resolve({ query: 'barra', limit: 5 });
    expect(second).toEqual(first);
  });

  it('tie does not depend on provider order', () => {
    const ranker = new DefaultProductIntentCandidateRanker();
    const query = new DefaultProductQueryNormalizer().normalize('barra');
    const first = ranker.rank(query, [hexBar, curlBar]).map((candidate) => candidate.product.productId);
    const second = ranker.rank(query, [curlBar, hexBar]).map((candidate) => candidate.product.productId);
    expect(second).toEqual(first);
  });

  it('scores remain between zero and one', () => {
    const ranked = new DefaultProductIntentCandidateRanker().rank(
      new DefaultProductQueryNormalizer().normalize('barra olimpica 15 kg'),
      [olympicBar15, olympicBar20, hexBar],
    );
    expect(ranked.every((candidate) => candidate.score >= 0 && candidate.score <= 1)).toBe(true);
  });

  it('top clearly superior produces resolved', () => {
    const decision = new DefaultProductIntentResolutionPolicy().resolve([
      { product: olympicBar15, score: 0.95, reasons: ['EXACT_NAME_MATCH'] },
      { product: olympicBar20, score: 0.6, reasons: ['NAME_TOKEN_MATCH'] },
    ]);
    expect(decision.status).toBe('resolved');
    expect(decision.sourceProduct).toEqual({ productId: '29' });
  });

  it('close candidates produce clarification_required', () => {
    const decision = new DefaultProductIntentResolutionPolicy().resolve([
      { product: olympicBar15, score: 0.84, reasons: ['NAME_TOKEN_MATCH'] },
      { product: olympicBar20, score: 0.78, reasons: ['NAME_TOKEN_MATCH'] },
    ]);
    expect(decision.status).toBe('clarification_required');
  });

  it('no candidates produce no_match', async () => {
    const result = await buildProductIntentHarness({ hits: [] }).service.resolve({ query: 'producto inexistente xyz', limit: 5 });
    expect(result.resolution.status).toBe('no_match');
    expect(result.candidates).toEqual([]);
  });

  it('low relevance produces no_match', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(bumper20)] }).service.resolve({ query: 'xyz 987654', limit: 5 });
    expect(result.resolution.status).toBe('no_match');
    expect(result.candidates).toEqual([]);
  });

  it('clarification distinguishes product type', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15), hit(hexBar), hit(curlBar)] }).service.resolve({
      query: 'barra',
      limit: 5,
    });
    expect(result.resolution.status).toBe('clarification_required');
    expect(result.clarification?.dimension).toBe('product_type');
  });

  it('clarification distinguishes weight', () => {
    const clarification = new DefaultProductClarificationBuilder().build([
      { product: olympicBar15, score: 0.7, reasons: ['NAME_TOKEN_MATCH'] },
      { product: olympicBar20, score: 0.7, reasons: ['NAME_TOKEN_MATCH'] },
    ]);
    expect(clarification.dimension).toBe('weight');
  });

  it('clarification groups equivalent products', () => {
    const clarification = new DefaultProductClarificationBuilder().build([
      { product: olympicBar15, score: 0.7, reasons: ['NAME_TOKEN_MATCH'] },
      { product: { ...olympicBar15, productId: '31' }, score: 0.69, reasons: ['NAME_TOKEN_MATCH'] },
      { product: olympicBar20, score: 0.68, reasons: ['NAME_TOKEN_MATCH'] },
    ]);
    expect(clarification.options.find((option) => option.label === '15 kg')?.productIds).toEqual(['29', '31']);
  });

  it('limits clarification options', () => {
    const clarification = new DefaultProductClarificationBuilder().build([
      olympicBar15,
      olympicBar20,
      hexBar,
      curlBar,
      bumper20,
      kettlebell16,
    ].map((product) => ({ product, score: 0.7, reasons: ['NAME_TOKEN_MATCH' as const] })));
    expect(clarification.options.length).toBeLessThanOrEqual(5);
  });

  it('preserves productId', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15)] }).service.resolve(baseResolveProductIntentRequest);
    expect(result.candidates[0]?.product.productId).toBe('29');
  });

  it('preserves combinationId when present', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(kettlebell16)] }).service.resolve({
      query: 'kettlebell 16 kg',
      limit: 5,
    });
    expect(result.candidates[0]?.product.combinationId).toBe('160');
  });

  it('does not call recommendation service or snapshot reader', async () => {
    const harness = buildProductIntentHarness({ hits: [hit(olympicBar15)] });
    await harness.service.resolve(baseResolveProductIntentRequest);
    expect(harness.searcher.calls).toHaveLength(1);
    expect(harness.catalog.calls).toHaveLength(1);
  });

  it('uses a single batch enrichment call', async () => {
    const harness = buildProductIntentHarness();
    await harness.service.resolve({ query: 'barra', limit: 5 });
    expect(harness.catalog.calls).toHaveLength(1);
    expect(harness.catalog.calls[0]?.references.length).toBeGreaterThan(1);
  });

  it('uses expanded pool before public limit', async () => {
    const harness = buildProductIntentHarness();
    await harness.service.resolve({ query: 'barra', limit: 3 });
    expect(harness.searcher.calls[0]?.limit).toBe(20);
  });

  it('deduplicates warnings globally', async () => {
    const productA = { ...noPriceBar, productId: '201' };
    const productB = { ...noPriceBar, productId: '202' };
    const result = await buildProductIntentHarness({ hits: [hit(productA), hit(productB)], products: [productA, productB] }).service.resolve({
      query: 'barra sin precio',
      limit: 5,
    });
    expect(result.warnings.filter((warning) => warning.code === 'CATALOG_PRICE_UNAVAILABLE')).toHaveLength(1);
  });

  it('uses header/body supplied correlation id in service request', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15)] }).service.resolve({
      ...baseResolveProductIntentRequest,
      correlationId: 'corr-explicit',
    });
    expect(result.correlationId).toBe('corr-explicit');
  });

  it('generates correlation id when absent', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15)] }).service.resolve({
      query: 'barra olimpica 15 kg',
      limit: 5,
    });
    expect(result.correlationId).toBe('corr-generated');
  });

  it('maps search failure to catalog unavailable', async () => {
    const harness = buildProductIntentHarness();
    harness.searcher.failWith = new Error('db down');
    await expect(harness.service.resolve(baseResolveProductIntentRequest)).rejects.toMatchObject({
      code: 'CATALOG_SEARCH_UNAVAILABLE',
      retryable: true,
    });
  });

  it('maps enrichment failure to catalog unavailable', async () => {
    const harness = buildProductIntentHarness();
    harness.catalog.failWith = new Error('db down');
    await expect(harness.service.resolve(baseResolveProductIntentRequest)).rejects.toMatchObject({
      code: 'CATALOG_SEARCH_UNAVAILABLE',
      retryable: true,
    });
  });

  it('excludes configured product ids', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15), hit(olympicBar20)] }).service.resolve({
      query: 'barra olimpica',
      context: { excludedProductIds: ['29'] },
      limit: 5,
    });
    expect(result.candidates.map((candidate) => candidate.product.productId)).not.toContain('29');
  });

  it('returns immutable output', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15)] }).service.resolve(baseResolveProductIntentRequest);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.candidates[0]?.product)).toBe(true);
  });

  it('creates stable product intent identity', () => {
    expect(createProductIntentIdentity({ productId: '1' })).toBe('1::<base>');
    expect(createProductIntentIdentity({ productId: '1', combinationId: '2' })).toBe('1::2');
  });

  it('does not expose internal attributes in public candidates', async () => {
    const result = await buildProductIntentHarness({ hits: [hit(olympicBar15)] }).service.resolve(baseResolveProductIntentRequest);
    expect(result.candidates[0]?.product).not.toHaveProperty('attributes');
  });

  it('emits structured lifecycle logs', async () => {
    const harness = buildProductIntentHarness({ hits: [hit(olympicBar15)] });
    await harness.service.resolve(baseResolveProductIntentRequest);
    expect(harness.logger.events.map((event) => event.event)).toContain('product_intent_resolved');
  });

  it('throws a typed configuration error for invalid parameters', () => {
    const harness = buildProductIntentHarness();
    expect(() => new DefaultProductIntentResolutionService({
      normalizer: new DefaultProductQueryNormalizer(),
      synonymProvider: new StaticProductSearchSynonymProvider(),
      searcher: harness.searcher,
      catalogReader: harness.catalog,
      ranker: new DefaultProductIntentCandidateRanker(),
      resolutionPolicy: new DefaultProductIntentResolutionPolicy(),
      clarificationBuilder: new DefaultProductClarificationBuilder(),
      correlationIdProvider: { generate: () => 'x' },
      parameters: { defaultLimit: 5, maximumLimit: 4, poolFactor: 1, maximumPoolSize: 5 },
    })).toThrow(ProductIntentResolutionError);
  });
});
