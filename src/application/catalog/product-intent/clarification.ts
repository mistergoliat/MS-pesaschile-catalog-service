import type {
  ExplicitProductConstraints,
  ProductClarification,
  ProductClarificationBuilder,
  ProductIntentCatalogProduct,
  RankedProductIntentCandidate,
} from './contracts.js';
import { normalizeCatalogText } from './normalizer.js';

const MAX_OPTIONS = 5;

function text(product: ProductIntentCatalogProduct): string {
  return normalizeCatalogText([
    product.name,
    product.category,
    product.description,
    ...(product.attributes ?? []).map((attribute) => `${attribute.group} ${attribute.value}`),
  ].filter(Boolean).join(' '));
}

function firstMatch(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return match ? match[0].replace(/\s+/gu, ' ') : null;
}

function productType(value: string): string | null {
  if (value.includes('hexagonal')) return 'barra hexagonal';
  if (value.includes('barra z') || value.includes('curl bar')) return 'barra z';
  if (value.includes('olimpica') || value.includes('olimpico')) return 'barra olimpica';
  if (value.includes('bumper') || value.includes('rubber')) return 'disco bumper';
  if (value.includes('kettlebell')) return 'kettlebell';
  if (value.includes('extension') && value.includes('pierna')) return 'extension de piernas';
  if (value.includes('curl') && value.includes('femoral')) return 'curl femoral';
  return null;
}

function groupBy(
  candidates: readonly RankedProductIntentCandidate[],
  dimension: ProductClarification['dimension'],
  selector: (product: ProductIntentCatalogProduct) => string | null,
): ProductClarification | null {
  const groups = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const value = selector(candidate.product);
    if (!value) continue;
    const productIds = groups.get(value) ?? new Set<string>();
    productIds.add(candidate.product.productId);
    groups.set(value, productIds);
  }
  if (groups.size < 2) return null;
  return {
    dimension,
    options: [...groups.entries()].slice(0, MAX_OPTIONS).map(([value, productIds]) => ({
      value: value.replace(/\s+/gu, '_'),
      label: value,
      productIds: [...productIds].sort((left, right) => left.localeCompare(right)),
    })),
  };
}

export class DefaultProductClarificationBuilder implements ProductClarificationBuilder {
  build(
    candidates: readonly RankedProductIntentCandidate[],
    constraints: ExplicitProductConstraints,
  ): ProductClarification {
    const plausible = candidates.filter((candidate) => candidate.plausible).slice(0, MAX_OPTIONS);
    return (
      (constraints.productType === undefined ? groupBy(plausible, 'product_type', (product) => productType(text(product))) : null) ??
      (constraints.weight === undefined ? groupBy(plausible, 'weight', (product) => firstMatch(text(product), /\b\d+(?:[.,]\d+)? kg\b/u)) : null) ??
      (constraints.diameter === undefined ? groupBy(plausible, 'diameter', (product) => firstMatch(text(product), /\b\d+(?:[.,]\d+)? mm\b/u)) : null) ??
      (constraints.length === undefined ? groupBy(plausible, 'length', (product) => firstMatch(text(product), /\b\d+(?:[.,]\d+)? (?:cm|m)\b/u)) : null) ??
      groupBy(plausible, 'category', (product) => product.category ?? null) ??
      {
        dimension: 'unspecified',
        options: plausible.slice(0, MAX_OPTIONS).map((candidate) => ({
          value: candidate.product.productId,
          label: candidate.product.name,
          productIds: [candidate.product.productId],
        })),
      }
    );
  }
}
