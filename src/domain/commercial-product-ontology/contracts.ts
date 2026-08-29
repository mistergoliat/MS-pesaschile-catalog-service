// Commercial Product Ontology Registry — domain contracts (CUSTOMER-INTELLIGENCE-R2-A00.2, versioned
// by CUSTOMER-INTELLIGENCE-R2-A00.3.1).
//
// This is a pure, versioned semantic contract: which PRODUCT_FAMILY / DISCIPLINE / USE_CONTEXT tags
// exist, what evidence may legitimately assign them, and the historical/non-product policies that
// govern classification. It does not classify any product itself — that is A00.3's job.

/**
 * v1 is immutable and permanently published — see `registry.ts`'s `canonicalRegistryV1` singleton.
 * A00.3.1 added v2 (the non-product exclusion policy correction) alongside it, without mutating v1's
 * published semantics: same tag set, same evidence/confidence/historical policy, same category trust
 * gate. Only `globalRules.nonProductExclusion` differs between the two.
 */
export const commercialProductOntologyRegistryVersion = 'commercial-product-ontology-v1';
export const commercialProductOntologyRegistryVersionV2 = 'commercial-product-ontology-v2';
export const commercialProductOntologyRegistryVersionV3 = 'commercial-product-ontology-v3';
export type CommercialProductOntologyRegistryVersion =
  | typeof commercialProductOntologyRegistryVersion
  | typeof commercialProductOntologyRegistryVersionV2
  | typeof commercialProductOntologyRegistryVersionV3;

export const commercialProductOntologyRegistryStatus = 'PUBLISHED';
export type CommercialProductOntologyRegistryStatus = typeof commercialProductOntologyRegistryStatus;

export type OntologyAxis = 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT';

export const ontologyAxes: readonly OntologyAxis[] = ['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'];

export type OntologyConfidence = 'EXPLICIT' | 'STRONGLY_INFERRED';

export const ontologyConfidenceLevels: readonly OntologyConfidence[] = ['EXPLICIT', 'STRONGLY_INFERRED'];

/** Evidence source types a registry tag is allowed to declare. */
export type OntologyEvidenceSourceType = 'NAME_TEXT' | 'TRUSTED_CATEGORY' | 'STRUCTURED_FEATURE' | 'FAMILY_INFERENCE';

export const allowedOntologyEvidenceSourceTypes: readonly OntologyEvidenceSourceType[] = [
  'NAME_TEXT',
  'TRUSTED_CATEGORY',
  'STRUCTURED_FEATURE',
  'FAMILY_INFERENCE',
];

/**
 * Evidence source types that must never drive classification, documented (not just omitted) so
 * future classifier code cannot reintroduce them without visibly contradicting this registry.
 * See A00.1B/A00.1C: free-text description scanning produced double-digit false-positive rates on
 * DISCIPLINE tags (CROSSFIT, REHABILITATION) before being removed from the evidence model.
 */
export type ForbiddenOntologyEvidenceSourceType =
  | 'FREE_TEXT_DESCRIPTION'
  | 'CAMPAIGN_CATEGORY'
  | 'NAVIGATION_CATEGORY'
  | 'LEGACY_CATEGORY'
  | 'UNKNOWN_CATEGORY'
  | 'NOISE_FEATURE'
  | 'PRESENTATION_FEATURE'
  | 'LOGISTICS_FEATURE'
  | 'SAMPLING_METADATA';

export const forbiddenOntologyEvidenceSourceTypes: readonly ForbiddenOntologyEvidenceSourceType[] = [
  'FREE_TEXT_DESCRIPTION',
  'CAMPAIGN_CATEGORY',
  'NAVIGATION_CATEGORY',
  'LEGACY_CATEGORY',
  'UNKNOWN_CATEGORY',
  'NOISE_FEATURE',
  'PRESENTATION_FEATURE',
  'LOGISTICS_FEATURE',
  'SAMPLING_METADATA',
];

/** PrestaShop category trust classes, as established by the A00/A00.1 category trust map. */
export type CategoryTrustClass = 'SEMANTIC_STRONG' | 'SEMANTIC_WEAK' | 'CAMPAIGN' | 'NAVIGATION' | 'LEGACY' | 'UNKNOWN';

export const categoryTrustClasses: readonly CategoryTrustClass[] = [
  'SEMANTIC_STRONG',
  'SEMANTIC_WEAK',
  'CAMPAIGN',
  'NAVIGATION',
  'LEGACY',
  'UNKNOWN',
];

export type OntologyTagStatus = 'ACTIVE' | 'RESIDUAL';

export const ontologyTagStatuses: readonly OntologyTagStatus[] = ['ACTIVE', 'RESIDUAL'];

/** Which confidence levels a tag may legitimately be assigned with, plus the rationale. */
export type CommercialProductOntologyConfidence = {
  readonly allowedConfidenceLevels: readonly OntologyConfidence[];
  readonly notes: string;
};

/** Historical-only (`historical_order_detail_only`) classification behavior for one tag. */
export type CommercialProductOntologyHistoricalPolicy = {
  /** Whether the tag may ever be assigned to a historical-only row using name text alone. */
  readonly classifiableFromNameOnly: boolean;
  readonly notes: string;
};

/** One evidence source declaration on a tag, scoped to a single evidence source type. */
export type CommercialProductOntologyEvidenceSource = OntologyEvidenceSourceType;

export type CommercialProductOntologyTag = {
  readonly axis: OntologyAxis;
  readonly code: string;
  readonly labelEs: string;
  readonly definition: string;
  readonly positiveEvidence: readonly string[];
  readonly negativeEvidence: readonly string[];
  readonly allowedEvidenceSources: readonly CommercialProductOntologyEvidenceSource[];
  readonly confidencePolicy: CommercialProductOntologyConfidence;
  readonly historicalPolicy: CommercialProductOntologyHistoricalPolicy;
  readonly status: OntologyTagStatus;
  /** True only for the single PRODUCT_FAMILY residual bucket (OTHER). */
  readonly residual: boolean;
};

export type CommercialProductOntologyAxisDefinition = {
  readonly axis: OntologyAxis;
  readonly tags: readonly CommercialProductOntologyTag[];
};

/** Per-axis gate on which category trust classes may back TRUSTED_CATEGORY evidence. */
export type CategoryTrustGate = {
  readonly PRODUCT_FAMILY: readonly CategoryTrustClass[];
  readonly DISCIPLINE: readonly CategoryTrustClass[];
  readonly USE_CONTEXT: readonly CategoryTrustClass[];
};

export type NonProductExclusionPolicy = {
  readonly description: string;
  /**
   * PrestaShop productIds confirmed (by direct evidence review, not a heuristic) to be
   * service/installation/logistics line items rather than physical products. Application of this
   * list belongs to A00.3's classifier pipeline, not to this registry.
   */
  readonly knownExcludedProductIds: readonly string[];
  /**
   * Regex source strings, anchored to the start of the normalized (lowercased, accent-stripped)
   * product name, so a legitimate product whose description happens to mention "servicio" is never
   * caught — only products whose own name literally begins with one of these administrative terms.
   */
  readonly normalizedNameExclusionPatterns: readonly string[];
  readonly appliesToNote: string;
};

export type CommercialProductOntologyGlobalHistoricalPolicy = {
  readonly appliesToCatalogPresence: 'historical_order_detail_only';
  readonly productFamilyClassifiableFromNameOnly: boolean;
  readonly disciplineRequiresExplicitNameEvidence: boolean;
  readonly useContextRequiresExplicitNameEvidence: boolean;
  readonly missingMetadataIsUnknownNotNegative: boolean;
  readonly automaticSuccessorMappingAllowed: boolean;
  readonly categoryOrFeatureInferenceAllowedWhenUnavailable: boolean;
  readonly notes: string;
};

export type CommercialProductOntologyGlobalRules = {
  readonly allowedEvidenceSourceTypes: readonly OntologyEvidenceSourceType[];
  readonly forbiddenEvidenceSourceTypes: readonly ForbiddenOntologyEvidenceSourceType[];
  readonly categoryTrustGate: CategoryTrustGate;
  readonly nonProductExclusion: NonProductExclusionPolicy;
  readonly historicalPolicy: CommercialProductOntologyGlobalHistoricalPolicy;
};

export type DeferredOrDroppedAxisDecision = 'DEFER' | 'DROP';

export const deferredOrDroppedAxisDecisions: readonly DeferredOrDroppedAxisDecision[] = ['DEFER', 'DROP'];

/**
 * An ontology axis that was considered and explicitly not activated. Never appears in `ontologyAxes`
 * or `registry.axes` — this is metadata about a design decision, not an active axis definition.
 */
export type DeferredOrDroppedAxis = {
  readonly axis: string;
  readonly decision: DeferredOrDroppedAxisDecision;
  readonly reason: string;
};

/** A tag that was proposed and explicitly rejected, kept as a permanent design record. */
export type RejectedOntologyTag = {
  readonly axis: OntologyAxis;
  readonly code: string;
  readonly reason: string;
};

export type CommercialProductOntologyRegistry = {
  readonly registryVersion: CommercialProductOntologyRegistryVersion;
  readonly status: CommercialProductOntologyRegistryStatus;
  readonly createdFrom: readonly string[];
  readonly axes: readonly CommercialProductOntologyAxisDefinition[];
  /** Flattened view of every tag across every axis, in the same canonical order as `axes`. */
  readonly tags: readonly CommercialProductOntologyTag[];
  readonly globalRules: CommercialProductOntologyGlobalRules;
  readonly deferredOrDroppedAxes: readonly DeferredOrDroppedAxis[];
  readonly rejectedTags: readonly RejectedOntologyTag[];
};
