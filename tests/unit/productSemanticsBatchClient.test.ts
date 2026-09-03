import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProductSemanticsBatch } from '../../client/catalogClient.js';

afterEach(() => vi.unstubAllGlobals());

const response = {
  schemaVersion: '1', snapshotId: `sha256:${'a'.repeat(64)}`, ontologyVersion: 'commercial-product-ontology-v3',
  ontologyHash: 'b'.repeat(64), classifierVersion: 'product-semantic-classifier-v1', semanticChecksum: 'c'.repeat(64),
  products: [{ productId: 29, classificationStatus: 'CLASSIFIED', primaryProductFamily: { code: 'BARBELL', confidence: 'EXPLICIT' }, secondaryProductFamilies: [], disciplines: [], useContexts: [] }],
  missingProductIds: [],
};

describe('Catalog semantic batch client', () => {
  it('uses the dedicated endpoint, API key, and preserves lineage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200, headers: { 'x-correlation-id': 'corr-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await getProductSemanticsBatch({ productIds: [29], expectedSnapshotId: response.snapshotId }, { baseUrl: 'http://catalog.local/', apiKey: 'secret', correlationId: 'corr-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://catalog.local/v1/products/semantics/batch');
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('x-api-key')).toBe('secret');
    expect(JSON.parse(String(init.body))).toEqual({ productIds: [29], expectedSnapshotId: response.snapshotId });
    expect(result.snapshotId).toBe(response.snapshotId);
    expect(result.products[0]?.primaryProductFamily?.code).toBe('BARBELL');
  });

  it('maps snapshot mismatch without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH', message: 'mismatch', correlationId: 'corr-2' } }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getProductSemanticsBatch({ productIds: [29] }, { baseUrl: 'http://catalog.local', apiKey: 'secret' })).rejects.toMatchObject({ statusCode: 409, code: 'PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH', retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
