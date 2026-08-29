// Section 3/14: the canonical registry singletons and the pure domain API future consumers (A00.3
// classifier, A00.4 golden-set validation, semantic snapshot publication) must use instead of
// reaching into the tag data files directly.
//
// No database dependency. No network dependency. No environment dependency. Pure domain module.
//
// Two immutable, permanently-published versions coexist (CUSTOMER-INTELLIGENCE-R2-A00.3.1): v1 is
// never mutated once published; v2 changes ONLY `globalRules.nonProductExclusion` (see
// `global-rules-v2.ts`). Both versions share the exact same `axes`/`tags`/`deferredOrDroppedAxes`/
// `rejectedTags` array references — not merely equal by value, but the identical frozen objects —
// which is the strongest possible guarantee that the tag set itself is unchanged between versions.

import {
  commercialProductOntologyRegistryStatus,
  commercialProductOntologyRegistryVersion,
  commercialProductOntologyRegistryVersionV2,
  commercialProductOntologyRegistryVersionV3,
  ontologyAxes,
  type CommercialProductOntologyAxisDefinition,
  type CommercialProductOntologyRegistry,
  type CommercialProductOntologyRegistryVersion,
  type CommercialProductOntologyTag,
  type OntologyAxis,
  type OntologyEvidenceSourceType,
} from './contracts.js';
import { deferredOrDroppedAxes, rejectedOntologyTags } from './deferred-axes.js';
import { disciplineTags } from './discipline-tags.js';
import { globalRules } from './global-rules.js';
import { globalRulesV2 } from './global-rules-v2.js';
import { deepFreeze } from './immutable.js';
import { productFamilyTags } from './product-family-tags.js';
import { productFamilyTagsV3 } from './product-family-tags-v3.js';
import { useContextTags } from './use-context-tags.js';
import { validateCommercialProductOntologyRegistry } from './validate.js';

const axisDefinitions: readonly CommercialProductOntologyAxisDefinition[] = [
  { axis: 'PRODUCT_FAMILY', tags: productFamilyTags },
  { axis: 'DISCIPLINE', tags: disciplineTags },
  { axis: 'USE_CONTEXT', tags: useContextTags },
];
const flattenedTags: readonly CommercialProductOntologyTag[] = axisDefinitions.flatMap((a) => a.tags);

const axisDefinitionsV3: readonly CommercialProductOntologyAxisDefinition[] = [
  { axis: 'PRODUCT_FAMILY', tags: productFamilyTagsV3 },
  { axis: 'DISCIPLINE', tags: disciplineTags },
  { axis: 'USE_CONTEXT', tags: useContextTags },
];
const flattenedTagsV3: readonly CommercialProductOntologyTag[] = axisDefinitionsV3.flatMap((a) => a.tags);

const canonicalRegistryV1: CommercialProductOntologyRegistry = deepFreeze({
  registryVersion: commercialProductOntologyRegistryVersion,
  status: commercialProductOntologyRegistryStatus,
  createdFrom: [
    'ontology_registry_candidate_v1.json',
    'CUSTOMER-INTELLIGENCE-R2-A00.1C-ontology-review-closure.md',
    'CUSTOMER-INTELLIGENCE-R2-A00.1B-golden-set-simplified-ontology-review.md',
  ],
  axes: axisDefinitions,
  tags: flattenedTags,
  globalRules,
  deferredOrDroppedAxes,
  rejectedTags: rejectedOntologyTags,
});

// Fail fast at module load if a future edit to the tag data files breaks a registry invariant —
// this is the "startup validator" required by A00.2 Section 16, not only a test-time check.
validateCommercialProductOntologyRegistry(canonicalRegistryV1);

const canonicalRegistryV2: CommercialProductOntologyRegistry = deepFreeze({
  registryVersion: commercialProductOntologyRegistryVersionV2,
  status: commercialProductOntologyRegistryStatus,
  // v1's own createdFrom, plus the audit that produced v2 — v1's array is never mutated, only read.
  createdFrom: [...canonicalRegistryV1.createdFrom, 'CUSTOMER-INTELLIGENCE-R2-A00.3.1-non-product-universe-policy-correction.md'],
  axes: axisDefinitions,
  tags: flattenedTags,
  globalRules: globalRulesV2,
  deferredOrDroppedAxes,
  rejectedTags: rejectedOntologyTags,
});

validateCommercialProductOntologyRegistry(canonicalRegistryV2);

const canonicalRegistryV3: CommercialProductOntologyRegistry = deepFreeze({
  registryVersion: commercialProductOntologyRegistryVersionV3,
  status: commercialProductOntologyRegistryStatus,
  createdFrom: [...canonicalRegistryV2.createdFrom, 'CATALOG-INTELLIGENCE-A00.3.4-cable-machine-evidence-microvalidation.md'],
  axes: axisDefinitionsV3,
  tags: flattenedTagsV3,
  globalRules: globalRulesV2,
  deferredOrDroppedAxes,
  rejectedTags: rejectedOntologyTags,
});

validateCommercialProductOntologyRegistry(canonicalRegistryV3);

const registryByVersion = new Map<CommercialProductOntologyRegistryVersion, CommercialProductOntologyRegistry>([
  [commercialProductOntologyRegistryVersion, canonicalRegistryV1],
  [commercialProductOntologyRegistryVersionV2, canonicalRegistryV2],
  [commercialProductOntologyRegistryVersionV3, canonicalRegistryV3],
]);

/**
 * The canonical, immutable, versioned Commercial Product Ontology Registry. Defaults to v1
 * (unchanged call signature/behavior from A00.2) — pass `'commercial-product-ontology-v2'`
 * explicitly to get the A00.3.1 non-product-policy revision.
 */
export function getCommercialProductOntologyRegistry(version: CommercialProductOntologyRegistryVersion = commercialProductOntologyRegistryVersion): CommercialProductOntologyRegistry {
  const registry = registryByVersion.get(version);
  if (!registry) {
    throw new Error(`Unknown commercial-product-ontology registry version: "${String(version)}"`);
  }
  return registry;
}

/** Convenience accessor for the A00.3.1 registry — equivalent to `getCommercialProductOntologyRegistry('commercial-product-ontology-v2')`. */
export function getCommercialProductOntologyRegistryV2(): CommercialProductOntologyRegistry {
  return canonicalRegistryV2;
}

/** Convenience accessor for the A00.3.5 registry — equivalent to `getCommercialProductOntologyRegistry('commercial-product-ontology-v3')`. */
export function getCommercialProductOntologyRegistryV3(): CommercialProductOntologyRegistry {
  return canonicalRegistryV3;
}

export function getOntologyAxis(
  axis: OntologyAxis,
  version: CommercialProductOntologyRegistryVersion = commercialProductOntologyRegistryVersion,
): CommercialProductOntologyAxisDefinition {
  const registry = getCommercialProductOntologyRegistry(version);
  const axisDefinition = registry.axes.find((entry) => entry.axis === axis);
  if (!axisDefinition) throw new Error(`Unknown ontology axis: "${String(axis)}". Valid axes: ${ontologyAxes.join(', ')}`);
  return axisDefinition;
}

export function getOntologyTagsForAxis(
  axis: OntologyAxis,
  version: CommercialProductOntologyRegistryVersion = commercialProductOntologyRegistryVersion,
): readonly CommercialProductOntologyTag[] {
  return getOntologyAxis(axis, version).tags;
}

export function getOntologyTag(
  axis: OntologyAxis,
  code: string,
  version: CommercialProductOntologyRegistryVersion = commercialProductOntologyRegistryVersion,
): CommercialProductOntologyTag | undefined {
  return getOntologyTagsForAxis(axis, version).find((tag) => tag.code === code);
}

export function isValidOntologyTag(
  axis: OntologyAxis,
  code: string,
  version: CommercialProductOntologyRegistryVersion = commercialProductOntologyRegistryVersion,
): boolean {
  return getOntologyTag(axis, code, version) !== undefined;
}

export function isResidualOntologyTag(
  axis: OntologyAxis,
  code: string,
  version: CommercialProductOntologyRegistryVersion = commercialProductOntologyRegistryVersion,
): boolean {
  return getOntologyTag(axis, code, version)?.residual ?? false;
}

export function isAllowedEvidenceSource(
  axis: OntologyAxis,
  code: string,
  source: OntologyEvidenceSourceType,
  version: CommercialProductOntologyRegistryVersion = commercialProductOntologyRegistryVersion,
): boolean {
  const tag = getOntologyTag(axis, code, version);
  if (!tag) {
    return false;
  }
  return tag.allowedEvidenceSources.includes(source);
}
