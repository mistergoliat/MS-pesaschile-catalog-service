import { describe, expect, it } from 'vitest';
import { CatalogRuntimeProductContextService } from '../../src/application/catalog/runtime-context/catalogRuntimeProductContextService.js';
import { CatalogContractService } from '../../src/application/catalog/v2/catalogContractService.js';
import type { RuntimeProjectionState } from '../../src/domain/catalog/runtime-projection.js';
import type { RuntimeProjectionManager } from '../../src/domain/catalog/runtime-projection.js';
import type { CatalogV2DataReader, CatalogV2Product } from '../../src/domain/catalog/v2/contracts.js';
import type { ActiveTrainingSemanticSnapshotV2Reader, TrainingSemanticRuntimeV2Fact } from '../../src/domain/training-semantic-snapshot/v2-contracts.js';
import type { ProductSemanticSnapshotFact } from '../../src/domain/product-semantic-snapshot/contracts.js';
import { RuntimeProductSemanticReader } from '../../src/domain/catalog/runtime-product-semantic-reader.js';

const baseProduct: CatalogV2Product = {
  productId: 10,
  basePriceNet: 100000,
  name: 'Barra olímpica',
  sku: 'BAR-10',
  shortDescription: 'Barra comercial',
  brand: 'Marca',
  weightKg: 20,
  linkRewrite: 'barra-olimpica',
  category: { id: '3', name: 'Barras' },
  active: true,
  listed: true,
  orderable: true,
  variants: [{ combinationId: 0, sku: 'BAR-10', attributes: [], impactPriceNet: 0, isDefault: true, availableQuantity: 12, outOfStock: 1 }],
  specifications: [{ name: 'Feature PrestaShop', value: 'peso 20 kg (raw)' }],
  globalBackorderAllowed: null,
  specificPrices: [],
  asOf: '2026-10-01T00:00:00.000Z',
};

const semanticFact = (marker: string) => ({ productId: 10, marker }) as unknown as ProductSemanticSnapshotFact;
const trainingV2Fact = (marker: string) => ({ productId: 10, marker }) as unknown as TrainingSemanticRuntimeV2Fact;

function state(input: { bundle: string; activation: string; loadedAt: string; normalizedValue: number; semanticMarker: string }): RuntimeProjectionState {
  return {
    projectionBundleId: input.bundle,
    activationId: input.activation,
    loadedAt: input.loadedAt,
    manifest: {} as RuntimeProjectionState['manifest'],
    productSemantics: {
      snapshotId: `snapshot-${input.bundle}`,
      schemaVersion: '1',
      factsByProductId: new Map([['10', semanticFact(input.semanticMarker)]]),
      facts: [semanticFact(input.semanticMarker)],
    } as unknown as RuntimeProjectionState['productSemantics'],
    trainingSemantics: { schemaVersion: '1', records: [{ productId: 10, marker: 'CAT-V2-TRAINING-V1' }] } as never,
    specs: { schemaVersion: '1', records: [{ productKey: 'P10', key: 'max_load_kg', value: input.normalizedValue, unit: 'kg', status: 'parsed' }] } as never,
    trustMaps: { schemaVersion: '1', sourceExtractionId: 'source', categoryHash: `category-${input.bundle}`, featureHash: 'feature' },
    relationships: { status: 'unavailable', reason: 'not_in_cat_v2' },
    capabilities: { status: 'unavailable', reason: 'not_in_cat_v2' },
  } as RuntimeProjectionState;
}

describe('CatalogRuntimeProductContextService', () => {
  it('keeps live commercial data and PrestaShop facts separate from bundle knowledge across B1→B2→B1', async () => {
    let now = new Date('2026-10-01T00:00:00.000Z');
    let liveProduct = { ...baseProduct };
    const reader: CatalogV2DataReader = {
      async readProducts() { return { products: [liveProduct], asOf: now.toISOString() }; },
    };
    const commercial = new CatalogContractService({ reader, clock: { now: () => now }, serviceBuildRef: 'catalog-service@test' });
    let activeState = state({ bundle: 'B1', activation: 'A1', loadedAt: '2026-10-01T00:00:00.000Z', normalizedValue: 100, semanticMarker: 'B1' });
    const manager = {
      forRequest: () => activeState,
      status: () => ({ reloadState: 'READY', desiredProjectionBundleId: activeState.projectionBundleId,
        desiredActivationId: activeState.activationId, loadedProjectionBundleId: activeState.projectionBundleId,
        loadedActivationId: activeState.activationId, loadedAt: activeState.loadedAt }),
    } as unknown as RuntimeProjectionManager;
    const productSemantics = new RuntimeProductSemanticReader(manager);
    const trainingV2 = {
      getMetadata: () => ({ schemaVersion: '2', snapshotId: 'legacy-training-v2-snapshot' }),
      getProductTrainingSemanticFact: () => trainingV2Fact('LEGACY-TRAINING-V2'),
    } as unknown as ActiveTrainingSemanticSnapshotV2Reader;
    const context = new CatalogRuntimeProductContextService({
      commercialReader: commercial,
      projectionRuntimeManager: manager,
      productSemanticReader: productSemantics,
      trainingSemanticSnapshotV2Reader: trainingV2,
      serviceBuildRef: 'catalog-service@test',
    });

    const b1 = await context.getProductContext({ productKey: 'P10', quantity: 1 });
    expect(b1?.knowledge.productSemantics).toMatchObject({ authority: 'cat-v2-product-semantics', fallbackUsed: false, value: { marker: 'B1' } });
    expect(b1?.knowledge.trainingSemanticsV1CatV2).toMatchObject({ authority: 'cat-v2-training-semantics-v1', value: { marker: 'CAT-V2-TRAINING-V1' } });
    expect(b1?.knowledge.trainingSemantics).toMatchObject({ authority: 'legacy-training-v2', migrationStatus: 'pending', value: { marker: 'LEGACY-TRAINING-V2' } });
    expect(b1?.facts.specifications).toEqual([{ name: 'Feature PrestaShop', value: 'peso 20 kg (raw)' }]);
    expect(b1?.knowledge.specs).toMatchObject({ authority: 'cat-v2-specs', value: [{ value: 100 }] });
    expect(b1?.provenance.facts.categorySelectionAuthority).toBe('static-category-trust-map');
    expect(b1?.knowledge.trustMaps).toMatchObject({ authority: 'cat-v2-trust-maps', value: { categoryHash: 'category-B1' } });
    expect(b1?.freshness.knowledge).toEqual({ projectionBundleId: 'B1', activationId: 'A1', loadedAt: '2026-10-01T00:00:00.000Z' });

    now = new Date('2026-10-01T00:00:16.000Z');
    liveProduct = { ...baseProduct, basePriceNet: 120000, specifications: [{ name: 'Feature PrestaShop', value: 'peso 22 kg (raw)' }], variants: [
      { ...baseProduct.variants[0]!, availableQuantity: 25 },
    ] };
    activeState = state({ bundle: 'B2', activation: 'A2', loadedAt: now.toISOString(), normalizedValue: 200, semanticMarker: 'B2' });
    // Deliberately attach commercial-looking fields to the fake bundle: the composer must never read them.
    (activeState as unknown as Record<string, unknown>).price = 1;
    (activeState as unknown as Record<string, unknown>).stock = 0;
    (activeState as unknown as Record<string, unknown>).sellability = 'not_sellable';
    const b2 = await context.getProductContext({ productKey: 'P10', quantity: 1 });
    expect(b2?.knowledge.productSemantics).toMatchObject({ value: { marker: 'B2' } });
    expect(b2?.knowledge.specs).toMatchObject({ value: [{ value: 200 }] });
    expect(b2?.facts.specifications).toEqual([{ name: 'Feature PrestaShop', value: 'peso 22 kg (raw)' }]);
    expect(b2?.commercial).not.toEqual(b1?.commercial);
    expect(b2?.commercial.availability.availableQuantity).toBe(25);
    expect(b2?.commercial.availability.sellability).toBe('sellable');
    expect(b2?.commercial.price.summary?.finalGross.amount).toBeGreaterThan(b1?.commercial.price.summary?.finalGross.amount ?? 0);
    expect(b2?.knowledge.trainingSemantics).toMatchObject({ value: { marker: 'LEGACY-TRAINING-V2' } });
    expect(b2?.knowledge.relationships).toMatchObject({ status: 'unavailable', authority: null });
    expect(b2?.knowledge.capabilities).toMatchObject({ status: 'unavailable', authority: null });

    activeState = state({ bundle: 'B1', activation: 'A3', loadedAt: '2026-10-01T00:00:17.000Z', normalizedValue: 100, semanticMarker: 'B1-rollback' });
    const rollback = await context.getProductContext({ productKey: 'P10', quantity: 1 });
    expect(rollback?.knowledge.specs).toMatchObject({ value: [{ value: 100 }], lineage: { projectionBundleId: 'B1', activationId: 'A3' } });
    expect(rollback?.commercial.availability.availableQuantity).toBe(25);
  });

  it('keeps projection lineage unavailable when no bundle is captured without changing commercial freshness', async () => {
    const reader: CatalogV2DataReader = { async readProducts() { return { products: [baseProduct], asOf: baseProduct.asOf }; } };
    const commercial = new CatalogContractService({ reader, serviceBuildRef: 'catalog-service@test' });
    const manager = {
      forRequest: () => null,
      status: () => ({ reloadState: 'NO_ACTIVE_BUNDLE' }),
    } as unknown as RuntimeProjectionManager;
    const productSemantics = new RuntimeProductSemanticReader(manager);
    const trainingV2 = { getMetadata: () => null } as unknown as ActiveTrainingSemanticSnapshotV2Reader;
    const context = new CatalogRuntimeProductContextService({ commercialReader: commercial, projectionRuntimeManager: manager,
      productSemanticReader: productSemantics, trainingSemanticSnapshotV2Reader: trainingV2, serviceBuildRef: 'catalog-service@test' });
    const result = await context.getProductContext({ productKey: 'P10', quantity: 1 });
    expect(result?.freshness.commercial.asOf).toBe(baseProduct.asOf);
    expect(result?.freshness.knowledge).toEqual({ projectionBundleId: null, activationId: null, loadedAt: null });
    expect(result?.knowledge.specs).toMatchObject({ status: 'unavailable', authority: 'cat-v2-specs' });
    expect(result?.knowledge.trainingSemantics).toMatchObject({ status: 'unavailable', authority: 'legacy-training-v2', migrationStatus: 'pending' });
  });
});
