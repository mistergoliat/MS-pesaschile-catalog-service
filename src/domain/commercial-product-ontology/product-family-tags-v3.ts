import type { CommercialProductOntologyTag } from './contracts.js';
import { productFamilyTags } from './product-family-tags.js';

export const productFamilyTagsV3: readonly CommercialProductOntologyTag[] = productFamilyTags.map((tag) =>
  tag.axis === 'PRODUCT_FAMILY' && tag.code === 'CABLE_MACHINE'
    ? {
        ...tag,
        positiveEvidence: [
          ...tag.positiveEvidence,
          'trusted category "Máquinas con Poleas" plus explicit structured cable-machine feature evidence',
        ],
        negativeEvidence: [
          ...tag.negativeEvidence,
          'trusted category "Máquinas con Poleas" by itself',
          'trusted category "Accesorios de Polea" (category 451)',
        ],
        allowedEvidenceSources: ['NAME_TEXT', 'STRUCTURED_FEATURE'],
        confidencePolicy: {
          allowedConfidenceLevels: ['EXPLICIT', 'STRONGLY_INFERRED'],
          notes:
            'EXPLICIT by name; STRONGLY_INFERRED only from the v3 guarded structured-evidence rule: trusted category "Máquinas con Poleas" plus an accepted cable-specific structured feature.',
        },
      }
    : tag,
);
