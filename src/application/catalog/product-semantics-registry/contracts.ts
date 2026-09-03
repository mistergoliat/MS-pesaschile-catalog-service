import type {
  CommercialProductOntologyRegistryStatus,
  CommercialProductOntologyRegistryVersion,
  OntologyAxis,
  OntologyTagStatus,
} from '../../../domain/commercial-product-ontology/index.js';

export type PublicProductSemanticsRegistryValue = {
  readonly code: string;
  readonly labelEs: string;
  readonly definition: string;
  readonly status: OntologyTagStatus;
  readonly residual: boolean;
};

export type PublicProductSemanticsRegistryAxis = {
  readonly axis: OntologyAxis;
  readonly values: readonly PublicProductSemanticsRegistryValue[];
};

export type PublicProductSemanticsRegistry = {
  readonly schemaVersion: '1';
  readonly ontologyVersion: CommercialProductOntologyRegistryVersion;
  readonly ontologyHash: string;
  readonly status: CommercialProductOntologyRegistryStatus;
  readonly axes: readonly PublicProductSemanticsRegistryAxis[];
};

export type ProductSemanticsRegistryService = {
  getRegistry(): PublicProductSemanticsRegistry;
};
