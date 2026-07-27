export type BuildProductPublicUrlInput = {
  readonly baseUrl: string;
  readonly productId: number;
  readonly linkRewrite: string | null | undefined;
};

export type BuildProductPublicUrlResult =
  | {
      readonly available: true;
      readonly canonicalUrl: string;
    }
  | {
      readonly available: false;
      readonly canonicalUrl: null;
      readonly reason: 'missing_link_rewrite' | 'invalid_product_id' | 'invalid_base_url';
    };

export function normalizePublicBaseUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString().replace(/\/+$/u, '');
  } catch {
    return null;
  }
}

export function buildProductPublicUrl(input: BuildProductPublicUrlInput): BuildProductPublicUrlResult {
  if (!Number.isSafeInteger(input.productId) || input.productId <= 0) {
    return {
      available: false,
      canonicalUrl: null,
      reason: 'invalid_product_id',
    };
  }

  const normalizedBaseUrl = normalizePublicBaseUrl(input.baseUrl);
  if (!normalizedBaseUrl) {
    return {
      available: false,
      canonicalUrl: null,
      reason: 'invalid_base_url',
    };
  }

  const linkRewrite = input.linkRewrite?.trim() ?? '';
  if (!linkRewrite) {
    return {
      available: false,
      canonicalUrl: null,
      reason: 'missing_link_rewrite',
    };
  }

  return {
    available: true,
    canonicalUrl: `${normalizedBaseUrl}/categories/${input.productId}-${linkRewrite}.html`,
  };
}
