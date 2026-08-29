// Section 16: startup/test-time registry validator. Fails hard (throws) if the registry violates any
// of its own invariants — this is meant to be called once at module load (so a future editing mistake
// in the tag data files breaks the build/tests immediately) and directly from tests.

import {
  ontologyAxes,
  ontologyConfidenceLevels,
  allowedOntologyEvidenceSourceTypes,
  categoryTrustClasses,
  commercialProductOntologyRegistryVersion,
  commercialProductOntologyRegistryVersionV2,
  commercialProductOntologyRegistryVersionV3,
  type CategoryTrustClass,
  type CommercialProductOntologyRegistry,
  type OntologyAxis,
} from './contracts.js';

const VALID_REGISTRY_VERSIONS: readonly string[] = [
  commercialProductOntologyRegistryVersion,
  commercialProductOntologyRegistryVersionV2,
  commercialProductOntologyRegistryVersionV3,
];

const EXPECTED_TAG_COUNT_BY_AXIS: Readonly<Record<OntologyAxis, number>> = {
  PRODUCT_FAMILY: 21,
  DISCIPLINE: 8,
  USE_CONTEXT: 6,
};

const EXPECTED_TOTAL_REAL_TAG_COUNT = 35;

export function validateCommercialProductOntologyRegistry(registry: CommercialProductOntologyRegistry): void {
  const issues: string[] = [];

  // -- registryVersion / status / createdFrom --
  if (!VALID_REGISTRY_VERSIONS.includes(registry.registryVersion)) {
    issues.push(`registryVersion: expected one of [${VALID_REGISTRY_VERSIONS.join(', ')}], got "${registry.registryVersion}"`);
  }
  if (registry.status !== 'PUBLISHED') {
    issues.push(`status: expected "PUBLISHED", got "${registry.status}"`);
  }
  if (registry.createdFrom.length === 0) {
    issues.push('createdFrom: must cite at least one source document');
  }

  // -- axis names unique and exactly the 3 approved axes, in canonical order --
  const axisNames = registry.axes.map((a) => a.axis);
  if (new Set(axisNames).size !== axisNames.length) {
    issues.push(`axes: duplicate axis name found among [${axisNames.join(', ')}]`);
  }
  if (axisNames.length !== ontologyAxes.length || !ontologyAxes.every((axis, i) => axisNames[i] === axis)) {
    issues.push(`axes: expected exactly [${ontologyAxes.join(', ')}] in that order, got [${axisNames.join(', ')}]`);
  }

  // -- deferred/dropped axes must never appear as active axes --
  for (const deferred of registry.deferredOrDroppedAxes) {
    if ((axisNames as readonly string[]).includes(deferred.axis)) {
      issues.push(`deferredOrDroppedAxes: "${deferred.axis}" is marked ${deferred.decision} but also appears as an active axis`);
    }
  }

  // -- flattened tags must exactly match the concatenation of axes[].tags, in order --
  const flattenedFromAxes = registry.axes.flatMap((a) => a.tags);
  if (flattenedFromAxes.length !== registry.tags.length || flattenedFromAxes.some((t, i) => registry.tags[i] !== t)) {
    issues.push('tags: flattened registry.tags does not match the concatenation of registry.axes[].tags in canonical order');
  }

  // -- per-axis tag code uniqueness, counts, and per-tag field validity --
  const seenAxisCodePairs = new Set<string>();
  let weightliftingFound = false;
  let residualTagCount = 0;

  for (const axisDef of registry.axes) {
    const codesInAxis = new Set<string>();
    let realTagCountInAxis = 0;

    for (const tag of axisDef.tags) {
      if (tag.axis !== axisDef.axis) {
        issues.push(`tag ${axisDef.axis}/${tag.code}: tag.axis ("${tag.axis}") does not match containing axis definition`);
      }

      if (codesInAxis.has(tag.code)) {
        issues.push(`axis ${axisDef.axis}: duplicate tag code "${tag.code}"`);
      }
      codesInAxis.add(tag.code);

      const pairKey = `${tag.axis}::${tag.code}`;
      if (seenAxisCodePairs.has(pairKey)) {
        issues.push(`registry: duplicate (axis, code) pair "${pairKey}" found across the flattened tag list`);
      }
      seenAxisCodePairs.add(pairKey);

      if (tag.code === 'WEIGHTLIFTING') {
        weightliftingFound = true;
      }

      if (tag.labelEs.trim().length === 0) {
        issues.push(`tag ${pairKey}: labelEs must not be empty`);
      }
      if (tag.definition.trim().length === 0) {
        issues.push(`tag ${pairKey}: definition must not be empty`);
      }

      for (const level of tag.confidencePolicy.allowedConfidenceLevels) {
        if (!ontologyConfidenceLevels.includes(level)) {
          issues.push(`tag ${pairKey}: confidencePolicy references unknown confidence level "${level}"`);
        }
      }
      for (const source of tag.allowedEvidenceSources) {
        if (!allowedOntologyEvidenceSourceTypes.includes(source)) {
          issues.push(`tag ${pairKey}: allowedEvidenceSources references unknown evidence source "${source}"`);
        }
      }

      if (tag.residual) {
        residualTagCount++;
        if (tag.axis !== 'PRODUCT_FAMILY') {
          issues.push(`tag ${pairKey}: residual=true is only permitted in PRODUCT_FAMILY, found in ${tag.axis}`);
        }
        if (tag.code !== 'OTHER') {
          issues.push(`tag ${pairKey}: the only permitted residual tag code is "OTHER", found "${tag.code}"`);
        }
        if (tag.status !== 'RESIDUAL') {
          issues.push(`tag ${pairKey}: residual tag must have status "RESIDUAL", got "${tag.status}"`);
        }
      } else {
        realTagCountInAxis++;
        if (tag.status !== 'ACTIVE') {
          issues.push(`tag ${pairKey}: non-residual tag must have status "ACTIVE", got "${tag.status}"`);
        }
        if (tag.confidencePolicy.allowedConfidenceLevels.length === 0) {
          issues.push(`tag ${pairKey}: active tag must declare at least one allowed confidence level`);
        }
      }
    }

    const expectedCount = EXPECTED_TAG_COUNT_BY_AXIS[axisDef.axis];
    if (realTagCountInAxis !== expectedCount) {
      issues.push(`axis ${axisDef.axis}: expected exactly ${expectedCount} real tags, found ${realTagCountInAxis}`);
    }
  }

  if (weightliftingFound) {
    issues.push('registry: tag code "WEIGHTLIFTING" must not appear anywhere in the registry (see rejectedOntologyTags)');
  }

  if (residualTagCount !== 1) {
    issues.push(`registry: expected exactly 1 residual tag (OTHER), found ${residualTagCount}`);
  }

  const totalRealTags = registry.tags.filter((t) => !t.residual).length;
  if (totalRealTags !== EXPECTED_TOTAL_REAL_TAG_COUNT) {
    issues.push(`registry: expected exactly ${EXPECTED_TOTAL_REAL_TAG_COUNT} real semantic tags total, found ${totalRealTags}`);
  }

  // -- category trust gate --
  const gate = registry.globalRules.categoryTrustGate;
  const expectedGate: Readonly<Record<OntologyAxis, readonly CategoryTrustClass[]>> = {
    PRODUCT_FAMILY: ['SEMANTIC_STRONG', 'SEMANTIC_WEAK'],
    DISCIPLINE: ['SEMANTIC_STRONG'],
    USE_CONTEXT: ['SEMANTIC_STRONG'],
  };
  for (const axis of ontologyAxes) {
    const actual = gate[axis];
    const expected = expectedGate[axis];
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const matches = actualSet.size === expectedSet.size && [...expectedSet].every((v) => actualSet.has(v));
    if (!matches) {
      issues.push(`categoryTrustGate.${axis}: expected [${expected.join(', ')}], got [${actual.join(', ')}]`);
    }
    for (const trustClass of actual) {
      if (!categoryTrustClasses.includes(trustClass)) {
        issues.push(`categoryTrustGate.${axis}: unknown category trust class "${trustClass}"`);
      }
    }
  }

  // -- non-product exclusion policy --
  const exclusion = registry.globalRules.nonProductExclusion;
  if (exclusion.knownExcludedProductIds.length === 0) {
    issues.push('nonProductExclusion.knownExcludedProductIds: must not be empty');
  }
  if (new Set(exclusion.knownExcludedProductIds).size !== exclusion.knownExcludedProductIds.length) {
    issues.push('nonProductExclusion.knownExcludedProductIds: contains duplicate ids');
  }
  for (const pattern of exclusion.normalizedNameExclusionPatterns) {
    try {
      new RegExp(pattern);
    } catch {
      issues.push(`nonProductExclusion.normalizedNameExclusionPatterns: "${pattern}" is not a valid regular expression`);
    }
  }

  // -- historical policy --
  const historicalPolicy = registry.globalRules.historicalPolicy;
  if (historicalPolicy.appliesToCatalogPresence !== 'historical_order_detail_only') {
    issues.push('globalRules.historicalPolicy.appliesToCatalogPresence: must be "historical_order_detail_only"');
  }
  if (historicalPolicy.notes.trim().length === 0) {
    issues.push('globalRules.historicalPolicy.notes: must not be empty');
  }
  if (historicalPolicy.automaticSuccessorMappingAllowed !== false) {
    issues.push('globalRules.historicalPolicy.automaticSuccessorMappingAllowed: must be false');
  }
  if (historicalPolicy.categoryOrFeatureInferenceAllowedWhenUnavailable !== false) {
    issues.push('globalRules.historicalPolicy.categoryOrFeatureInferenceAllowedWhenUnavailable: must be false');
  }

  if (issues.length > 0) {
    throw new Error(`Commercial Product Ontology Registry validation failed:\n- ${issues.join('\n- ')}`);
  }
}
