import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProductSemanticsRegistry } from '../../client/catalogClient.js';

afterEach(() => vi.unstubAllGlobals());

describe('Catalog semantic registry client', () => {
  it('calls the registry endpoint, sends auth, and parses the typed contract', async () => {
    const response = {
      schemaVersion: '1',
      ontologyVersion: 'commercial-product-ontology-v3',
      ontologyHash: 'f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955',
      status: 'PUBLISHED',
      axes: [{
        axis: 'PRODUCT_FAMILY',
        values: [{ code: 'DUMBBELL', labelEs: 'Mancuernas', definition: 'Fixed dumbbells.', status: 'ACTIVE', residual: false }],
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getProductSemanticsRegistry({
      baseUrl: 'http://catalog.local/',
      apiKey: 'secret',
      correlationId: 'corr-1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://catalog.local/v1/products/semantics/registry');
    expect(init.method).toBe('GET');
    expect((init.headers as Headers).get('x-api-key')).toBe('secret');
    expect(result.schemaVersion).toBe('1');
    expect(result.ontologyVersion).toBe('commercial-product-ontology-v3');
    expect(result.ontologyHash).toBe(response.ontologyHash);
    expect(result.axes[0]?.values[0]?.code).toBe('DUMBBELL');
  });

  it('rejects a response that exposes classifier internals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: '1',
      ontologyVersion: 'commercial-product-ontology-v3',
      ontologyHash: 'f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955',
      status: 'PUBLISHED',
      axes: [{
        axis: 'DISCIPLINE',
        values: [{
          code: 'HYROX', labelEs: 'HYROX', definition: 'Explicit HYROX positioning.', status: 'ACTIVE', residual: false,
          positiveEvidence: ['literal name'],
        }],
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProductSemanticsRegistry({ baseUrl: 'http://catalog.local', apiKey: 'secret' })).rejects.toThrow();
  });
});
