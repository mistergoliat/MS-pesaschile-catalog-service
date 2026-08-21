import 'dotenv/config';
import {
  batchGetProducts,
  getProduct,
  searchProducts,
} from '../client/catalogClient.js';

type SmokeStatus = 'pass' | 'fail' | 'info';
type SearchProductsV2State =
  | 'snapshot_unavailable'
  | 'no_commercial_candidates'
  | 'customer_affinity_degraded'
  | 'full_success';

type SmokeStepResult = {
  step: string;
  status: SmokeStatus;
  details: Record<string, unknown>;
};

function parseArgs(argv: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const [key, value = 'true'] = token.slice(2).split('=');
    if (!key) continue;
    parsed[key] = value;
  }
  return parsed;
}

function readOption(args: Record<string, string>, key: string, envKeys: readonly string[], fallback?: string): string | undefined {
  if (args[key] !== undefined) return args[key];
  for (const envKey of envKeys) {
    if (process.env[envKey] !== undefined) return process.env[envKey];
  }
  return fallback;
}

function readBoolean(args: Record<string, string>, key: string, envKeys: readonly string[], fallback = false): boolean {
  const raw = readOption(args, key, envKeys);
  if (raw === undefined) return fallback;
  return ['true', '1', 'yes', 'y', 'on'].includes(raw.trim().toLowerCase());
}

function readPositiveInteger(args: Record<string, string>, key: string, envKeys: readonly string[]): number | undefined {
  const raw = readOption(args, key, envKeys);
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function recordStep(results: SmokeStepResult[], step: string, status: SmokeStatus, details: Record<string, unknown>): void {
  results.push({ step, status, details });
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function requestJson(input: {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST';
  apiKey?: string;
  body?: unknown;
}): Promise<{ statusCode: number; body: unknown; headers: Headers }> {
  const headers = new Headers();
  if (input.apiKey) headers.set('x-api-key', input.apiKey);
  if (input.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(buildUrl(input.baseUrl, input.path), {
    method: input.method ?? 'GET',
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return {
    statusCode: response.status,
    body,
    headers: response.headers,
  };
}

function classifySearchProductsV2Response(response: { statusCode: number; body: any }): SearchProductsV2State {
  if (response.statusCode === 503 && response.body?.error?.code === 'COMMERCIAL_RECOMMENDATION_UNAVAILABLE') {
    return 'snapshot_unavailable';
  }

  if (response.statusCode === 200 && Array.isArray(response.body?.recommendations)) {
    const warnings = Array.isArray(response.body?.warnings)
      ? response.body.warnings.map((warning: { code?: unknown }) => warning.code)
      : [];

    if (response.body.recommendations.length === 0 && warnings.includes('NO_COMMERCIAL_CANDIDATES')) {
      return 'no_commercial_candidates';
    }

    if (response.body?.execution?.degraded === true && warnings.includes('CUSTOMER_AFFINITY_UNAVAILABLE')) {
      return 'customer_affinity_degraded';
    }

    if (response.body?.execution?.degraded === false && response.body.recommendations.length > 0) {
      return 'full_success';
    }
  }

  throw new Error(`Unexpected SearchProducts V2 response: HTTP ${response.statusCode}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = readOption(args, 'base-url', ['CATALOG_SERVICE_URL'], 'http://localhost:4010')!;
  const apiKey = readOption(args, 'api-key', ['CATALOG_SERVICE_API_KEY', 'API_KEY']);
  const query = readOption(args, 'query', ['SMOKE_QUERY'], 'barra')!;
  const allowDegradedReady = readBoolean(args, 'allow-degraded-ready', ['SMOKE_ALLOW_DEGRADED_READY'], false);
  const expectedV2State = readOption(
    args,
    'v2-expected-state',
    ['SMOKE_V2_EXPECTED_STATE'],
  ) as SearchProductsV2State | undefined;
  const explicitProductId = readPositiveInteger(args, 'product-id', ['SMOKE_PRODUCT_ID']);
  const explicitCombinationId = readPositiveInteger(args, 'combination-id', ['SMOKE_COMBINATION_ID']) ?? 0;
  const sourceProductId = readOption(args, 'source-product-id', ['SMOKE_SOURCE_PRODUCT_ID']);
  const sourceCombinationId = readOption(args, 'source-combination-id', ['SMOKE_SOURCE_COMBINATION_ID']);
  const customerId = readOption(args, 'customer-id', ['SMOKE_CUSTOMER_ID']);

  if (!apiKey) {
    throw new Error('Missing API key. Use --api-key, CATALOG_SERVICE_API_KEY, or API_KEY.');
  }

  const results: SmokeStepResult[] = [];
  let hasFailures = false;

  const live = await requestJson({ baseUrl, path: '/health/live' });
  const livePass = live.statusCode === 200;
  recordStep(results, 'health_live', livePass ? 'pass' : 'fail', { statusCode: live.statusCode });
  hasFailures ||= !livePass;

  const ready = await requestJson({ baseUrl, path: '/health/ready' });
  const readyChecks = typeof ready.body === 'object' && ready.body !== null ? (ready.body as { checks?: unknown }).checks : undefined;
  const readyPass = ready.statusCode === 200 || (allowDegradedReady && ready.statusCode === 503);
  recordStep(results, 'health_ready', readyPass ? 'pass' : 'fail', {
    statusCode: ready.statusCode,
    checks: readyChecks,
  });
  hasFailures ||= !readyPass;

  const authNegative = await requestJson({
    baseUrl,
    path: `/v1/products/search?q=${encodeURIComponent(query)}`,
  });
  const authNegativePass = authNegative.statusCode === 401;
  recordStep(results, 'auth_negative', authNegativePass ? 'pass' : 'fail', { statusCode: authNegative.statusCode });
  hasFailures ||= !authNegativePass;

  const search = await searchProducts({ query, limit: 5 }, { baseUrl, apiKey, timeoutMs: 8000 });
  const searchPass = Array.isArray(search.items);
  recordStep(results, 'catalog_search', searchPass ? 'pass' : 'fail', {
    query,
    items: search.items.length,
  });
  hasFailures ||= !searchPass;

  const selectedProductId = explicitProductId ?? search.items[0]?.productId;
  const selectedCombinationId = explicitProductId !== undefined
    ? explicitCombinationId
    : (search.items[0]?.combinationId ?? 0);
  if (!selectedProductId) {
    recordStep(results, 'product_selection', 'fail', {
      reason: 'catalog search returned zero items and no explicit --product-id was provided',
    });
    hasFailures = true;
  } else {
    const product = await getProduct(
      {
        productId: selectedProductId,
        combinationId: selectedCombinationId,
        quantity: 1,
      },
      { baseUrl, apiKey, timeoutMs: 8000 },
    );
    recordStep(results, 'product_detail', 'pass', {
      productId: selectedProductId,
      combinationId: selectedCombinationId,
      weightKg: product.weightKg,
    });

    const batch = await batchGetProducts(
      {
        items: [{
          productId: selectedProductId,
          combinationId: selectedCombinationId,
          quantity: 1,
        }],
      },
      { baseUrl, apiKey, timeoutMs: 8000 },
    );
    const batchFailures = batch.items.filter((item) => item.ok === false);
    const batchPass = batchFailures.length === 0;
    recordStep(results, 'batch', batchPass ? 'pass' : 'fail', {
      items: batch.items.length,
      failedItems: batchFailures.length,
    });
    hasFailures ||= !batchPass;
  }

  const v2SourceProductId = sourceProductId ?? (selectedProductId === undefined ? undefined : String(selectedProductId));
  if (!v2SourceProductId) {
    recordStep(results, 'search_products_v2', 'info', {
      skipped: true,
      reason: 'no source product id available',
    });
  } else {
    const v2Response = await requestJson({
      baseUrl,
      path: '/api/v2/recommendations/search-products',
      method: 'POST',
      apiKey,
      body: {
        query,
        sourceProduct: sourceCombinationId
          ? { productId: v2SourceProductId, combinationId: sourceCombinationId }
          : { productId: v2SourceProductId },
        ...(customerId ? { customer: { customerId } } : {}),
        limit: 5,
      },
    });
    const v2State = classifySearchProductsV2Response(v2Response);
    const expectationMatches = expectedV2State === undefined || expectedV2State === v2State;
    const readySnapshotUnavailable =
      ready.statusCode === 503 &&
      typeof readyChecks === 'object' &&
      readyChecks !== null &&
      (readyChecks as Record<string, unknown>).relationshipSnapshot === 'unavailable';

    if (v2State === 'snapshot_unavailable' && !readySnapshotUnavailable) {
      hasFailures = true;
      recordStep(results, 'search_products_v2', 'fail', {
        state: v2State,
        statusCode: v2Response.statusCode,
        reason: 'SearchProducts V2 reported snapshot unavailable but readiness did not report relationshipSnapshot=unavailable',
      });
    } else {
      recordStep(results, 'search_products_v2', expectationMatches ? 'pass' : 'fail', {
        state: v2State,
        statusCode: v2Response.statusCode,
        recommendations: Array.isArray((v2Response.body as any)?.recommendations)
          ? (v2Response.body as any).recommendations.length
          : null,
        degraded: (v2Response.body as any)?.execution?.degraded ?? null,
        warnings: Array.isArray((v2Response.body as any)?.warnings)
          ? (v2Response.body as any).warnings.map((warning: { code?: unknown }) => warning.code)
          : [],
      });
      hasFailures ||= !expectationMatches;
    }
  }

  console.log(JSON.stringify({
    baseUrl,
    query,
    expectedV2State: expectedV2State ?? null,
    results,
    overall: hasFailures ? 'fail' : 'pass',
  }, null, 2));

  if (hasFailures) {
    process.exitCode = 1;
  }
}

await main();
