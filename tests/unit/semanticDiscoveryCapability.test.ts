import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSemanticDiscoveryCapability,
  getSemanticDiscoveryRegistry,
  searchProductsBySemantics,
  searchProductsBySemanticsWithDetails,
  type SemanticDiscoveryRegistry,
} from '../../client/index.js';

afterEach(() => vi.unstubAllGlobals());

const context = {
  baseUrl: 'http://catalog.local/',
  apiKey: 'server-only-secret',
  correlationId: 'r3-run-1',
};

const productRegistry = {
  schemaVersion: '1' as const,
  ontologyVersion: 'commercial-product-ontology-v3',
  ontologyHash: 'a'.repeat(64),
  status: 'PUBLISHED' as const,
  axes: [
    { axis: 'PRODUCT_FAMILY' as const, values: [{ code: 'RACK_CAGE', labelEs: 'Rack', definition: 'Rack', status: 'ACTIVE' as const, residual: false }] },
    { axis: 'DISCIPLINE' as const, values: [{ code: 'POWERLIFTING', labelEs: 'Powerlifting', definition: 'Powerlifting', status: 'ACTIVE' as const, residual: false }] },
    { axis: 'USE_CONTEXT' as const, values: [{ code: 'HOME_GYM', labelEs: 'Home gym', definition: 'Home gym', status: 'ACTIVE' as const, residual: false }] },
  ],
};

const trainingRegistry = {
  schemaVersion: '2' as const,
  registryVersion: 'training-semantic-registry-v2',
  registryHash: 'b'.repeat(64),
  status: 'PUBLISHED' as const,
  exerciseCapabilities: [{ code: 'LEG_PRESS', status: 'ACTIVE' }],
  trainingFunctions: [{ code: 'BARBELL_SUPPORT', status: 'ACTIVE' }],
  bodyRegions: ['LOWER_BODY'],
  muscleGroups: ['CHEST'],
  trainingPatterns: ['PUSH'],
  exerciseDerivedRelations: [],
  familyTrainingFunctionDerivations: [],
  semanticBoundaries: {},
};

const registry: SemanticDiscoveryRegistry = { product: productRegistry, training: trainingRegistry };

const productResult = {
  productId: 1273,
  matchedRequirements: [{
    axis: 'USE_CONTEXT', requestedCodes: ['HOME_GYM'], matchedCodes: ['HOME_GYM'],
    source: 'PRODUCT_SEMANTICS', mode: 'required', match: 'any',
    confidenceLevels: ['EXPLICIT'], reason: 'required_match',
  }],
  productSemantics: {
    productId: 1273,
    classificationStatus: 'CLASSIFIED',
    primaryProductFamily: { code: 'RACK_CAGE', confidence: 'EXPLICIT' },
    secondaryProductFamilies: [], disciplines: [], useContexts: [{ code: 'HOME_GYM', confidence: 'EXPLICIT' }],
    ontologyVersion: 'commercial-product-ontology-v3', ontologyHash: 'a'.repeat(64), classifierVersion: 'v1',
  },
  trainingSemantics: null,
};

const responseFor = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  lineage: {
    productSemantics: {
      snapshotId: `sha256:${'c'.repeat(64)}`,
      semanticChecksum: 'd'.repeat(64),
      ontologyVersion: 'commercial-product-ontology-v3',
      ontologyHash: 'a'.repeat(64),
      classifierVersion: 'v1',
    },
    trainingSemantics: null,
  },
  query: {
    requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }],
    options: { limit: 20 },
  },
  results: [productResult],
  totalMatches: 1,
  truncated: false,
  ...overrides,
});

function okResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify(responseFor(overrides)), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'r3-run-1' },
  });
}

describe('search_products_by_semantics capability contract', () => {
  it('validates against Catalog registry, maps the planner input, and returns a compact result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchProductsBySemantics({
      requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }],
    }, context, { registry });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://catalog.local/v1/products/semantic-discovery/query');
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('x-api-key')).toBe('server-only-secret');
    expect(JSON.parse(String(init.body))).toEqual({
      schemaVersion: 1,
      requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }],
      options: { limit: 20 },
    });
    expect(result).toMatchObject({ totalMatches: 1, truncated: false, lineage: responseFor().lineage });
    expect(result.results[0]).toMatchObject({
      productId: 1273,
      productSemantics: { classificationStatus: 'CLASSIFIED' },
    });
    expect(result.results[0]?.productSemantics).not.toHaveProperty('ontologyHash');
  });

  it('rejects an unknown code before semantic query and rejects non-semantic axes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchProductsBySemantics({
      requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME'], mode: 'required', match: 'any' }],
    }, context, { registry })).rejects.toMatchObject({
      code: 'CAPABILITY_INPUT_ERROR', category: 'input_error', retryable: false,
    });
    await expect(searchProductsBySemantics({
      requirements: [{ axis: 'TRAINING_GOAL' as never, codes: ['STRENGTH'], mode: 'required', match: 'any' }],
    }, context, { registry })).rejects.toMatchObject({ code: 'CAPABILITY_INPUT_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows only axis-specific relations and preserves required/preferred any/all semantics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchProductsBySemantics({
      requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], relations: ['DIRECT'], mode: 'preferred', match: 'any' }],
    }, context, { registry })).rejects.toMatchObject({ code: 'CAPABILITY_INPUT_ERROR' });
    await expect(searchProductsBySemantics({
      requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['LEG_PRESS'], relations: ['FAMILY_DERIVED'], mode: 'required', match: 'all' }],
    }, context, { registry })).rejects.toMatchObject({ code: 'CAPABILITY_INPUT_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps Catalog failures without exposing HTTP details to the planner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'INVALID_SEMANTIC_DISCOVERY_REQUEST', message: 'raw catalog detail', correlationId: 'corr-400' },
    }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchProductsBySemantics({
      requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }],
    }, context, { registry })).rejects.toMatchObject({ code: 'CAPABILITY_INPUT_ERROR', category: 'input_error', retryable: false });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH', message: 'raw catalog detail' },
    }), { status: 409 })));
    await expect(searchProductsBySemantics({
      requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }],
    }, context, { registry })).rejects.toMatchObject({ code: 'SEMANTIC_VERSION_MISMATCH', category: 'snapshot_mismatch', retryable: true });
  });

  it('maps source unavailability to a retryable temporary capability failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'TRAINING_SEMANTICS_UNAVAILABLE', message: 'raw catalog detail' },
    }), { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchProductsBySemantics({
      requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }],
    }, context, { registry })).rejects.toMatchObject({
      code: 'CAPABILITY_TEMPORARILY_UNAVAILABLE', category: 'temporarily_unavailable', retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats zero matches as a successful capability result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ results: [], totalMatches: 0 })));
    const result = await searchProductsBySemantics({
      requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }],
    }, context, { registry });
    expect(result).toMatchObject({ results: [], totalMatches: 0, truncated: false });
  });

  it('optionally pins lineage and retries one 409 with the same constraints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH', message: 'mismatch' },
      }), { status: 409 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const capability = createSemanticDiscoveryCapability(context, { registry, pinLineage: true });
    await capability.execute({ requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).not.toHaveProperty('expectedSnapshots');
  });
});

describe('semantic registry synchronization and two-stage orchestration', () => {
  it('loads both authoritative Catalog registries and validates their combined shape', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/v1/products/semantics/registry')) return Promise.resolve(new Response(JSON.stringify(productRegistry), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify(trainingRegistry), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getSemanticDiscoveryRegistry(context);
    expect(result.product.axes.map((axis) => axis.axis)).toEqual(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']);
    expect(result.training.exerciseCapabilities.map((definition) => definition.code)).toEqual(['LEG_PRESS']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('hydrates semantic ids through the existing batch commercial capability only in stage two', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/semantic-discovery/query')) return Promise.resolve(okResponse());
      if (url.endsWith('/products/batch')) return Promise.resolve(new Response(JSON.stringify({ items: [{
        ok: false,
        input: { productId: 1273, combinationId: 0, quantity: 1 },
        error: { code: 'PRODUCT_NOT_FOUND', message: 'not found in test', correlationId: 'r3-run-1' },
      }] }), { status: 200 }));
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await searchProductsBySemanticsWithDetails({
      requirements: [{ axis: 'USE_CONTEXT', codes: ['HOME_GYM'], mode: 'required', match: 'any' }],
    }, context, { registry });
    expect(result.semanticDiscovery.totalMatches).toBe(1);
    expect(result.productDetails.items[0]).toMatchObject({ ok: false, input: { productId: 1273 } });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://catalog.local/v1/products/semantic-discovery/query',
      'http://catalog.local/v1/products/batch',
    ]);
  });
});
