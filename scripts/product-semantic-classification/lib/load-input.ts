// Builds `ProductSemanticClassificationInput[]` from the A00 product export + the A00.1 category
// and feature trust maps. This is the one place PrestaShop-shaped CSV columns get translated into
// the classifier's PrestaShop-independent input contract (Section 3) — the domain layer never
// parses a CSV or reads a raw database column.

import { readFile } from 'node:fs/promises';
import type { CategoryTrustClass } from '../../../src/domain/commercial-product-ontology/index.js';
import type {
  CatalogPresence,
  FeatureTrustClass,
  ProductSemanticClassificationInput,
} from '../../../src/domain/product-semantic-classification/index.js';
import { parseCsvRecords } from './csv.js';

const KNOWN_CATEGORY_TRUST_CLASSES: readonly CategoryTrustClass[] = ['SEMANTIC_STRONG', 'SEMANTIC_WEAK', 'CAMPAIGN', 'NAVIGATION', 'LEGACY', 'UNKNOWN'];
const KNOWN_FEATURE_TRUST_CLASSES: readonly FeatureTrustClass[] = ['SEMANTIC', 'TECHNICAL', 'NOISE', 'PRESENTATION', 'LOGISTICS'];

export type LoadedProductInputs = {
  readonly inputs: readonly ProductSemanticClassificationInput[];
  readonly warnings: readonly string[];
};

export async function loadProductSemanticClassificationInputs(args: {
  readonly catalogCsvPath: string;
  readonly categoryTrustMapCsvPath: string;
  readonly featureTrustMapCsvPath: string;
}): Promise<LoadedProductInputs> {
  const [catalogText, categoryTrustText, featureTrustText] = await Promise.all([
    readFile(args.catalogCsvPath, 'utf8'),
    readFile(args.categoryTrustMapCsvPath, 'utf8'),
    readFile(args.featureTrustMapCsvPath, 'utf8'),
  ]);

  const warnings: string[] = [];

  const categoryTrustById = new Map<string, { readonly name: string; readonly trustClass: CategoryTrustClass }>();
  for (const record of parseCsvRecords(categoryTrustText)) {
    const categoryId = record.categoryId ?? '';
    const trustClass = coerceCategoryTrustClass(record.trustClass ?? '', warnings, categoryId);
    categoryTrustById.set(categoryId, { name: record.categoryName ?? categoryId, trustClass });
  }

  const featureTrustById = new Map<string, FeatureTrustClass>();
  for (const record of parseCsvRecords(featureTrustText)) {
    const featureId = record.featureId ?? '';
    featureTrustById.set(featureId, coerceFeatureTrustClass(record.trustClass ?? '', warnings, featureId));
  }

  const inputs: ProductSemanticClassificationInput[] = [];
  for (const record of parseCsvRecords(catalogText)) {
    const productId = record.productId ?? '';
    const catalogPresence = coerceCatalogPresence(record.catalogPresence ?? '', warnings, productId);
    const categoryIds = record.allCategoryIds ? record.allCategoryIds.split('|').filter((id) => id.length > 0) : [];
    const categories = categoryIds.map((categoryId) => {
      const trustEntry = categoryTrustById.get(categoryId);
      if (!trustEntry) {
        warnings.push(`productId ${productId}: categoryId ${categoryId} not found in category trust map; treating as UNKNOWN trust.`);
      }
      return {
        categoryId,
        name: trustEntry?.name ?? categoryId,
        trustClass: trustEntry?.trustClass ?? ('UNKNOWN' as CategoryTrustClass),
      };
    });

    let rawFeatures: readonly { readonly featureId: number | string; readonly featureName: string | null; readonly value: string | null }[] = [];
    try {
      rawFeatures = record.features_json ? (JSON.parse(record.features_json) as typeof rawFeatures) : [];
    } catch {
      warnings.push(`productId ${productId}: features_json failed to parse; treating as no features.`);
    }
    const features = rawFeatures
      .filter((feature) => feature.featureName !== null && feature.featureName !== undefined)
      .map((feature) => {
        const featureId = String(feature.featureId);
        return {
          featureId,
          featureName: feature.featureName as string,
          value: feature.value ?? '',
          trustClass: featureTrustById.get(featureId) ?? ('UNKNOWN' as FeatureTrustClass),
        };
      });

    inputs.push({
      productId,
      productName: record.name ?? '',
      catalogPresence,
      activeStatus: record.active === '1' ? true : record.active === '0' ? false : null,
      categories,
      features,
    });
  }

  return { inputs, warnings };
}

function coerceCatalogPresence(raw: string, warnings: string[], productId: string): CatalogPresence {
  if (raw === 'current_catalog' || raw === 'historical_order_detail_only') return raw;
  warnings.push(`productId ${productId}: unrecognized catalogPresence "${raw}"; defaulting to current_catalog.`);
  return 'current_catalog';
}

function coerceCategoryTrustClass(raw: string, warnings: string[], categoryId: string): CategoryTrustClass {
  if ((KNOWN_CATEGORY_TRUST_CLASSES as readonly string[]).includes(raw)) return raw as CategoryTrustClass;
  warnings.push(`categoryId ${categoryId}: unrecognized trustClass "${raw}"; defaulting to UNKNOWN.`);
  return 'UNKNOWN';
}

function coerceFeatureTrustClass(raw: string, warnings: string[], featureId: string): FeatureTrustClass {
  if ((KNOWN_FEATURE_TRUST_CLASSES as readonly string[]).includes(raw)) return raw as FeatureTrustClass;
  warnings.push(`featureId ${featureId}: unrecognized trustClass "${raw}"; defaulting to UNKNOWN.`);
  return 'UNKNOWN';
}
