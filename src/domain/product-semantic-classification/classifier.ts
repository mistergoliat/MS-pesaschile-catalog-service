// Product Semantic Classification Pipeline orchestrator (CUSTOMER-INTELLIGENCE-R2-A00.3, default
// registry consumption updated to commercial-product-ontology-v3 by CATALOG-INTELLIGENCE-A00.3.5).
//
// Deterministic conflict-resolution precedence (Section 17), highest to lowest:
//   1. non-product exclusion (Section 5)
//   2. explicit "+" bundle split — PRODUCT_FAMILY primary/secondary (Section 7)
//   3. ordered NAME_TEXT rules, first match wins (Section 6 boundaries: STORAGE before generic
//      nouns, Smith-machine override, BODYWEIGHT_GYMNASTICS before BARBELL, CABLE_MACHINE before
//      ROPE_SLED/MACHINE_ATTACHMENT, FLOORING/BALL_BAG exclude yoga-pilates wording)
//   4. TRUSTED_CATEGORY vote fallback (current-catalog rows only)
//   5. OTHER (insufficient evidence) — or NEEDS_REVIEW if the category vote fallback produces more
//      than one distinct, non-hybrid family candidate with no NAME_TEXT evidence to break the tie
//
// DISCIPLINE and USE_CONTEXT are independent multi-label axes (not a single mutually-exclusive
// "primary" per product like PRODUCT_FAMILY) — every tag is evaluated on its own merits and all
// matches are kept.

import {
  commercialProductOntologyRegistryVersionV2,
  commercialProductOntologyRegistryVersionV3,
  getCommercialProductOntologyRegistry,
  computeCommercialProductOntologyRegistryHash,
  type CommercialProductOntologyRegistry,
  type CommercialProductOntologyRegistryVersion,
} from '../commercial-product-ontology/index.js';
import type {
  ClassificationEvidenceRecord,
  ClassifiedOntologyTag,
  OntologyRuleMatch,
  ProductSemanticClassificationInput,
  ProductSemanticClassificationResult,
  ProductSemanticClassificationStatus,
} from './contracts.js';
import { matchDisciplines } from './discipline-rules.js';
import { evaluateNonProductExclusion } from './non-product-exclusion.js';
import { normalizeProductName, splitExplicitBundleName } from './normalize.js';
import {
  matchGuardedCableMachineStructuredEvidence,
  matchGuardedExistingFamilyStructuredEvidence,
  matchProductFamilyByName,
  voteProductFamilyByCategory,
} from './product-family-rules.js';
import { matchUseContexts } from './use-context-rules.js';

const registryCache = new Map<CommercialProductOntologyRegistryVersion, { readonly registry: CommercialProductOntologyRegistry; readonly hash: string }>();

/**
 * A00.3.5: the classifier's standard/default registry consumption is now v3 (guarded
 * CABLE_MACHINE structured-evidence recovery) rather than v2. `registryVersion` remains explicit so
 * v1/v2/v3 comparison tooling can reuse this exact classifier rather than re-implementing it.
 */
function registryAndHash(registryVersion: CommercialProductOntologyRegistryVersion): { readonly registry: CommercialProductOntologyRegistry; readonly hash: string } {
  const cached = registryCache.get(registryVersion);
  if (cached) return cached;
  const registry = getCommercialProductOntologyRegistry(registryVersion);
  const hash = computeCommercialProductOntologyRegistryHash(registry);
  const entry = { registry, hash };
  registryCache.set(registryVersion, entry);
  return entry;
}

function toClassifiedTag(axis: 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT', match: OntologyRuleMatch): ClassifiedOntologyTag {
  return { axis, code: match.code, confidence: match.confidence, ruleId: match.ruleId };
}

function toEvidenceRecord(axis: 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT', match: OntologyRuleMatch): ClassificationEvidenceRecord {
  return {
    axis,
    code: match.code,
    ruleId: match.ruleId,
    sourceType: match.sourceType,
    sourceId: match.sourceId,
    rawValue: match.rawValue,
    normalizedValue: match.normalizedValue,
  };
}

type ProductFamilyResolution = {
  readonly primary: OntologyRuleMatch | null;
  readonly secondary: readonly OntologyRuleMatch[];
  readonly needsReviewCandidates: readonly OntologyRuleMatch[];
  readonly warnings: readonly string[];
};

function resolveProductFamily(
  normalizedName: string,
  rawName: string,
  input: ProductSemanticClassificationInput,
  registry: CommercialProductOntologyRegistry,
  allowCategoryEvidence: boolean,
  allowStructuredFeatureEvidence: boolean,
): ProductFamilyResolution {
  const bundleSplit = splitExplicitBundleName(normalizedName);
  const warnings: string[] = [];
  let resolution: ProductFamilyResolution;

  if (bundleSplit) {
    const leftMatch = matchProductFamilyByName(bundleSplit.left, rawName);
    const rightMatch = matchProductFamilyByName(bundleSplit.right, rawName);
    if (leftMatch && rightMatch && leftMatch.code !== rightMatch.code) {
      warnings.push(`secondary family "${rightMatch.code}" derived from explicit "+" bundle split (rule PF_EXPLICIT_BUNDLE_SPLIT_V1).`);
      resolution = { primary: leftMatch, secondary: [rightMatch], needsReviewCandidates: [], warnings };
      return applyGuardedCableMachineEnhancement(resolution, input, registry, allowStructuredFeatureEvidence);
    }
    if (leftMatch) {
      resolution = { primary: leftMatch, secondary: [], needsReviewCandidates: [], warnings };
      return applyGuardedCableMachineEnhancement(resolution, input, registry, allowStructuredFeatureEvidence);
    }
    // Left side matched nothing — fall through to whole-name evaluation below.
  }

  const wholeNameMatch = matchProductFamilyByName(normalizedName, rawName);
  if (wholeNameMatch) {
    resolution = { primary: wholeNameMatch, secondary: [], needsReviewCandidates: [], warnings };
    return applyGuardedCableMachineEnhancement(resolution, input, registry, allowStructuredFeatureEvidence);
  }

  const guardedStructuredNameMatch = allowStructuredFeatureEvidence
    ? matchGuardedExistingFamilyStructuredEvidence(normalizedName, rawName, input.features)
    : null;
  if (guardedStructuredNameMatch) {
    resolution = { primary: guardedStructuredNameMatch, secondary: [], needsReviewCandidates: [], warnings };
    return applyGuardedCableMachineEnhancement(resolution, input, registry, allowStructuredFeatureEvidence);
  }

  if (!allowCategoryEvidence) {
    resolution = { primary: null, secondary: [], needsReviewCandidates: [], warnings };
    return applyGuardedCableMachineEnhancement(resolution, input, registry, allowStructuredFeatureEvidence);
  }

  const categoryVotes = voteProductFamilyByCategory(input.categories, registry.globalRules.categoryTrustGate.PRODUCT_FAMILY);
  if (categoryVotes.length === 0) {
    resolution = { primary: null, secondary: [], needsReviewCandidates: [], warnings };
    return applyGuardedCableMachineEnhancement(resolution, input, registry, allowStructuredFeatureEvidence);
  }
  if (categoryVotes.length === 1) {
    resolution = { primary: categoryVotes[0]!, secondary: [], needsReviewCandidates: [], warnings };
    return applyGuardedCableMachineEnhancement(resolution, input, registry, allowStructuredFeatureEvidence);
  }
  warnings.push(
    `PRODUCT_FAMILY category vote produced ${categoryVotes.length} mutually-exclusive candidates with no approved hybrid rule and no NAME_TEXT evidence to break the tie: ${categoryVotes.map((vote) => vote.code).join(', ')}.`,
  );
  resolution = { primary: null, secondary: [], needsReviewCandidates: categoryVotes, warnings };
  return applyGuardedCableMachineEnhancement(resolution, input, registry, allowStructuredFeatureEvidence);
}

function applyGuardedCableMachineEnhancement(
  resolution: ProductFamilyResolution,
  input: ProductSemanticClassificationInput,
  registry: CommercialProductOntologyRegistry,
  allowStructuredFeatureEvidence: boolean,
): ProductFamilyResolution {
  if (!allowStructuredFeatureEvidence) return resolution;
  if (resolution.needsReviewCandidates.length > 0) return resolution;

  const guardedCableMatch = matchGuardedCableMachineStructuredEvidence(input, registry);
  if (!guardedCableMatch) return resolution;

  if (!resolution.primary) {
    return { ...resolution, primary: guardedCableMatch };
  }

  if (resolution.primary.code !== 'PLATE_LOADED_MACHINE') return resolution;
  if (resolution.secondary.some((match) => match.code === 'CABLE_MACHINE')) return resolution;

  return { ...resolution, secondary: [...resolution.secondary, guardedCableMatch] };
}

export function classifyProduct(
  input: ProductSemanticClassificationInput,
  registryVersion: CommercialProductOntologyRegistryVersion = commercialProductOntologyRegistryVersionV3,
): ProductSemanticClassificationResult {
  const { registry, hash } = registryAndHash(registryVersion);
  const warnings: string[] = [];

  const exclusion = evaluateNonProductExclusion(input.productId, input.productName, registry.globalRules.nonProductExclusion);
  if (exclusion.excluded) {
    return {
      productId: input.productId,
      registryVersion: registry.registryVersion,
      registryHash: hash,
      classificationStatus: 'EXCLUDED_NON_PRODUCT',
      primaryProductFamily: null,
      secondaryProductFamilies: [],
      disciplines: [],
      useContexts: [],
      evidence: [],
      warnings: [],
      exclusionReason: exclusion.exclusionReason,
      matchedExclusionRule: exclusion.matchedRule,
      needsReviewCandidates: [],
    };
  }

  const isHistorical = input.catalogPresence === 'historical_order_detail_only';
  const allowCategoryEvidence = !isHistorical;
  const allowStructuredFeatureEvidence = !isHistorical;

  const normalizedName = normalizeProductName(input.productName);
  const familyResolution = resolveProductFamily(normalizedName, input.productName, input, registry, allowCategoryEvidence, allowStructuredFeatureEvidence);
  warnings.push(...familyResolution.warnings);

  const disciplineMatches = matchDisciplines({
    rawProductName: input.productName,
    normalizedProductName: normalizedName,
    categories: input.categories,
    allowCategoryEvidence,
    allowedCategoryTrustClasses: registry.globalRules.categoryTrustGate.DISCIPLINE,
    primaryProductFamilyCode: familyResolution.primary?.code ?? null,
  });

  const useContextMatches = matchUseContexts({
    rawProductName: input.productName,
    normalizedProductName: normalizedName,
    categories: input.categories,
    features: input.features,
    allowCategoryEvidence,
    allowStructuredFeatureEvidence,
    allowedCategoryTrustClasses: registry.globalRules.categoryTrustGate.USE_CONTEXT,
  });

  const primaryTag = familyResolution.primary ? toClassifiedTag('PRODUCT_FAMILY', familyResolution.primary) : null;
  const secondaryTags = familyResolution.secondary.map((match) => toClassifiedTag('PRODUCT_FAMILY', match));
  const disciplineTags = disciplineMatches.map((match) => toClassifiedTag('DISCIPLINE', match));
  const useContextTags = useContextMatches.map((match) => toClassifiedTag('USE_CONTEXT', match));

  const evidence: ClassificationEvidenceRecord[] = [
    ...(familyResolution.primary ? [toEvidenceRecord('PRODUCT_FAMILY', familyResolution.primary)] : []),
    ...familyResolution.secondary.map((match) => toEvidenceRecord('PRODUCT_FAMILY', match)),
    ...disciplineMatches.map((match) => toEvidenceRecord('DISCIPLINE', match)),
    ...useContextMatches.map((match) => toEvidenceRecord('USE_CONTEXT', match)),
  ];

  const classificationStatus: ProductSemanticClassificationStatus = determineStatus(familyResolution, isHistorical);

  return {
    productId: input.productId,
    registryVersion: registry.registryVersion,
    registryHash: hash,
    classificationStatus,
    primaryProductFamily: primaryTag,
    secondaryProductFamilies: secondaryTags,
    disciplines: disciplineTags,
    useContexts: useContextTags,
    evidence,
    warnings,
    exclusionReason: null,
    matchedExclusionRule: null,
    needsReviewCandidates: familyResolution.needsReviewCandidates.map((match) => toClassifiedTag('PRODUCT_FAMILY', match)),
  };
}

function determineStatus(familyResolution: ProductFamilyResolution, isHistorical: boolean): ProductSemanticClassificationStatus {
  if (familyResolution.needsReviewCandidates.length > 0) return 'NEEDS_REVIEW';
  if (!familyResolution.primary) return 'OTHER';
  return isHistorical ? 'PARTIALLY_CLASSIFIED' : 'CLASSIFIED';
}

export function classifyProducts(
  inputs: readonly ProductSemanticClassificationInput[],
  registryVersion: CommercialProductOntologyRegistryVersion = commercialProductOntologyRegistryVersionV3,
): readonly ProductSemanticClassificationResult[] {
  return inputs.map((input) => classifyProduct(input, registryVersion));
}
