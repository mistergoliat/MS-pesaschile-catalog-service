import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { CatalogCommercialTruthService } from '../../src/domain/catalog/commercial-truth/index.js';
import { classifyProduct, type ProductSemanticClassificationInput } from '../../src/domain/product-semantic-classification/index.js';
import {
  CatalogCommercialTruthPresenceSource,
  reconcileProductSemanticCatalogPresence,
} from '../../scripts/product-semantic-classification/lib/catalog-presence.js';
import { loadProductSemanticClassificationInputs } from '../../scripts/product-semantic-classification/lib/load-input.js';

function input(productId: string): ProductSemanticClassificationInput {
  return {
    productId,
    productName: 'Mancuerna Preolímpica 11.8kg Barbell',
    catalogPresence: 'current_catalog',
    activeStatus: true,
    categories: [],
    features: [],
  };
}

describe('product semantic catalog presence reconciliation', () => {
  it('overrides a stale current_catalog fixture when current commercial truth omits product 197', async () => {
    const classified = [classifyProduct(input('197'))];
    const commercialTruth = new CatalogCommercialTruthService({
      dataReader: {
        read: async () => ({ products: [], specificPrices: [] }),
      },
    });

    const reconciled = await reconcileProductSemanticCatalogPresence(
      classified,
      new CatalogCommercialTruthPresenceSource(commercialTruth, commercialContext()),
    );

    expect(reconciled[0]?.catalogPresence).toBe('historical_order_detail_only');
  });

  it('keeps a product current when current commercial truth resolves it', async () => {
    const classified = [classifyProduct(input('198'))];
    const commercialTruth = new CatalogCommercialTruthService({
      dataReader: {
        read: async () => ({
          products: [{
            productId: 198,
            combinationId: 0,
            name: 'Mancuerna Preolímpica 11.8kg Barbell',
            productReference: null,
            combinationReference: null,
            description: null,
            category: null,
            linkRewrite: 'mancuerna-198',
            hasCombinations: false,
            variantAttributeLabels: [],
            active: true,
            availableForOrder: true,
            productBasePriceNet: 1000,
            combinationImpactNet: 0,
            stockQuantity: 1,
          }],
          specificPrices: [],
        }),
      },
    });

    const reconciled = await reconcileProductSemanticCatalogPresence(
      classified,
      new CatalogCommercialTruthPresenceSource(commercialTruth, commercialContext()),
    );

    expect(reconciled[0]?.catalogPresence).toBe('current_catalog');
  });

  it('fails closed when the audit fixture contains an unknown catalogPresence', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'product-semantic-presence-'));
    const catalogCsvPath = path.join(directory, 'catalog.csv');
    const categoryTrustMapCsvPath = path.join(directory, 'categories.csv');
    const featureTrustMapCsvPath = path.join(directory, 'features.csv');
    await Promise.all([
      writeFile(catalogCsvPath, 'productId,catalogPresence,name,active,allCategoryIds,features_json\n197,unknown,Mancuerna,1,,\n', 'utf8'),
      writeFile(categoryTrustMapCsvPath, 'categoryId,categoryName,trustClass\n', 'utf8'),
      writeFile(featureTrustMapCsvPath, 'featureId,featureName,trustClass\n', 'utf8'),
    ]);

    const loaded = await loadProductSemanticClassificationInputs({
      catalogCsvPath,
      categoryTrustMapCsvPath,
      featureTrustMapCsvPath,
    });

    expect(loaded.inputs[0]?.catalogPresence).toBe('historical_order_detail_only');
    expect(loaded.warnings[0]).toContain('defaulting to historical_order_detail_only');
  });
});

function commercialContext() {
  return {
    shopId: 1,
    currencyId: 1,
    currencyCode: 'CLP',
    countryId: 0,
    customerGroupId: 0,
    customerId: 0,
    quantity: 1,
    taxRate: 0.19,
  } as const;
}
