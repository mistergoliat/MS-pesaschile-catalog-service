import {
  commercialProductOntologyRegistryVersionV3,
  computeCommercialProductOntologyRegistryHash,
  getCommercialProductOntologyRegistry,
} from '../../../domain/commercial-product-ontology/index.js';
import type { PublicProductSemanticsRegistry, ProductSemanticsRegistryService } from './contracts.js';

const PUBLIC_SCHEMA_VERSION = '1' as const;

/**
 * Projects the explicitly published v3 ontology into the public discovery contract.
 * The projection intentionally omits classifier evidence and policy internals.
 */
export function projectPublicProductSemanticsRegistry(): PublicProductSemanticsRegistry {
  const registry = getCommercialProductOntologyRegistry(commercialProductOntologyRegistryVersionV3);

  return {
    schemaVersion: PUBLIC_SCHEMA_VERSION,
    ontologyVersion: registry.registryVersion,
    ontologyHash: computeCommercialProductOntologyRegistryHash(registry),
    status: registry.status,
    axes: registry.axes.map(({ axis, tags }) => ({
      axis,
      values: tags.map(({ code, labelEs, definition, status, residual }) => ({
        code,
        labelEs,
        definition,
        status,
        residual,
      })),
    })),
  };
}

export const defaultProductSemanticsRegistryService: ProductSemanticsRegistryService = {
  getRegistry: projectPublicProductSemanticsRegistry,
};
