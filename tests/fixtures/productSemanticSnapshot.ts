import { classifyProducts, type ProductSemanticClassificationInput, type ProductSemanticClassificationResult } from '../../src/domain/product-semantic-classification/index.js';
import {
  DefaultProductSemanticSnapshotBuilder,
  type ProductSemanticSnapshot,
} from '../../src/domain/product-semantic-snapshot/index.js';

function input(
  productId: string,
  productName: string,
  overrides: Partial<Omit<ProductSemanticClassificationInput, 'productId' | 'productName'>> = {},
): ProductSemanticClassificationInput {
  return {
    productId,
    productName,
    catalogPresence: 'current_catalog',
    activeStatus: true,
    categories: [],
    features: [],
    ...overrides,
  };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const semanticFixtureInputs: readonly ProductSemanticClassificationInput[] = [
  input('1', 'Barra Olimpica Recta 20kg'),
  input('2', 'Barra Olimpica Recta 20kg', { catalogPresence: 'historical_order_detail_only', activeStatus: null }),
  input('3', 'Producto Residual Sin Evidencia'),
  input('4', 'Instalacion de equipo funcional'),
];

export const semanticFixtureResults: readonly ProductSemanticClassificationResult[] = classifyProducts(semanticFixtureInputs);

export function buildRuntimeSemanticSnapshot(
  results: readonly ProductSemanticClassificationResult[] = semanticFixtureResults,
  builtAt = '2026-08-29T12:00:00.000Z',
): ProductSemanticSnapshot {
  return new DefaultProductSemanticSnapshotBuilder().build({
    results,
    parameters: {
      sourceProductCount: results.length,
      classifierVersion: 'product-semantic-classifier-v1',
      builtAt,
    },
  }).snapshot;
}

export const runtimeSemanticSnapshot = buildRuntimeSemanticSnapshot();

export const runtimeSecondSemanticSnapshot = buildRuntimeSemanticSnapshot(
  semanticFixtureResults.map((result, index) => (index === 0 ? { ...result, productId: '10' } : result)),
  '2026-08-29T13:00:00.000Z',
);
