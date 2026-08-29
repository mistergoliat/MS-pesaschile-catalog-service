import type { ProductSemanticClassificationCounts } from '../../../src/domain/product-semantic-snapshot/index.js';

export const acceptedProductSemanticBaseline = Object.freeze({
  sourceProducts: 2011,
  ontologyVersion: 'commercial-product-ontology-v3',
  ontologyHash: 'f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955',
  semanticChecksum: 'dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e',
  classificationCounts: {
    CLASSIFIED: 1281,
    PARTIALLY_CLASSIFIED: 400,
    OTHER: 317,
    EXCLUDED_NON_PRODUCT: 13,
    NEEDS_REVIEW: 0,
  } satisfies ProductSemanticClassificationCounts,
  goldenSet: {
    PRODUCT_FAMILY: '200/200',
    DISCIPLINE: '200/200',
    USE_CONTEXT: '200/200',
  },
});
