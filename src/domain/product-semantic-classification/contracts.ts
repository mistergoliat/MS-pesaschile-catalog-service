// Product Semantic Classification Pipeline — domain contracts (CUSTOMER-INTELLIGENCE-R2-A00.3).
//
// This module classifies A00-exported product evidence against the formal A00.2 registry
// (`commercial-product-ontology-v1`). It does not redefine ontology semantics — tag codes, axes,
// confidence levels, evidence source types, category trust classes, and global policies are all
// imported from `commercial-product-ontology`, never re-declared here.

import type { CategoryTrustClass, OntologyAxis, OntologyConfidence, OntologyEvidenceSourceType } from '../commercial-product-ontology/index.js';

export type CatalogPresence = 'current_catalog' | 'historical_order_detail_only';

/**
 * Trust classification for a PrestaShop structured feature, as established by the A00/A00.1
 * feature trust map. Distinct from `CategoryTrustClass` (a different source system) and from the
 * registry's `ForbiddenOntologyEvidenceSourceType` (which names source *categories* like
 * NOISE_FEATURE, not this per-feature trust label).
 */
export type FeatureTrustClass = 'SEMANTIC' | 'TECHNICAL' | 'NOISE' | 'PRESENTATION' | 'LOGISTICS' | 'UNKNOWN';

export type ProductSemanticClassificationInputCategory = {
  readonly categoryId: string;
  readonly name: string;
  readonly trustClass: CategoryTrustClass;
};

export type ProductSemanticClassificationInputFeature = {
  readonly featureId: string;
  readonly featureName: string;
  readonly value: string;
  readonly trustClass: FeatureTrustClass;
};

/**
 * Classifier input contract, independent of PrestaShop SQL (Section 3). A historical-only row is
 * valid with just `productId`/`productName`/`catalogPresence` and empty `categories`/`features`.
 */
export type ProductSemanticClassificationInput = {
  readonly productId: string;
  readonly productName: string;
  readonly catalogPresence: CatalogPresence;
  readonly activeStatus: boolean | null;
  readonly categories: readonly ProductSemanticClassificationInputCategory[];
  readonly features: readonly ProductSemanticClassificationInputFeature[];
};

/**
 * Internal rule-evaluation result shared by every axis's rule module (product-family-rules.ts,
 * discipline-rules.ts, use-context-rules.ts) before the orchestrator turns it into a
 * `ClassifiedOntologyTag` + `ClassificationEvidenceRecord` pair. `sourceId` is `'NAME'` for
 * NAME_TEXT evidence, a `categoryId` for TRUSTED_CATEGORY, a `featureId` for STRUCTURED_FEATURE, or
 * `FAMILY:<code>` for FAMILY_INFERENCE.
 */
export type OntologyRuleMatch = {
  readonly code: string;
  readonly confidence: OntologyConfidence;
  readonly ruleId: string;
  readonly sourceType: OntologyEvidenceSourceType;
  readonly sourceId: string;
  readonly rawValue: string;
  readonly normalizedValue: string;
};

/** One emitted axis/tag assignment. Confidence is per-tag, never a combined numeric score (Section 14). */
export type ClassifiedOntologyTag = {
  readonly axis: OntologyAxis;
  readonly code: string;
  readonly confidence: OntologyConfidence;
  readonly ruleId: string;
};

/** Bounded, deterministic evidence for one emitted tag (Section 15) — no free-text excerpts. */
export type ClassificationEvidenceRecord = {
  readonly axis: OntologyAxis;
  readonly code: string;
  readonly ruleId: string;
  readonly sourceType: OntologyEvidenceSourceType;
  readonly sourceId: string;
  readonly rawValue: string;
  readonly normalizedValue: string;
};

export type ProductSemanticClassificationStatus =
  | 'CLASSIFIED'
  | 'PARTIALLY_CLASSIFIED'
  | 'OTHER'
  | 'EXCLUDED_NON_PRODUCT'
  | 'NEEDS_REVIEW';

export const productSemanticClassificationStatuses: readonly ProductSemanticClassificationStatus[] = [
  'CLASSIFIED',
  'PARTIALLY_CLASSIFIED',
  'OTHER',
  'EXCLUDED_NON_PRODUCT',
  'NEEDS_REVIEW',
];

export type ProductSemanticClassificationResult = {
  readonly productId: string;
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly classificationStatus: ProductSemanticClassificationStatus;
  readonly primaryProductFamily: ClassifiedOntologyTag | null;
  readonly secondaryProductFamilies: readonly ClassifiedOntologyTag[];
  readonly disciplines: readonly ClassifiedOntologyTag[];
  readonly useContexts: readonly ClassifiedOntologyTag[];
  readonly evidence: readonly ClassificationEvidenceRecord[];
  readonly warnings: readonly string[];
  /** Populated only when classificationStatus === 'EXCLUDED_NON_PRODUCT'. */
  readonly exclusionReason: string | null;
  readonly matchedExclusionRule: string | null;
  /** Populated only when classificationStatus === 'NEEDS_REVIEW': the competing PRODUCT_FAMILY candidates. */
  readonly needsReviewCandidates: readonly ClassifiedOntologyTag[];
};
