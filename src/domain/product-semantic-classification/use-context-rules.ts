// USE_CONTEXT classification rules (Section 9). Implements exactly the 6 registry USE_CONTEXT tags.
//
// The only STRUCTURED_FEATURE ever consulted is "Clasificación de Uso" — no rule in this module (or
// anywhere else in this domain module) reads the "Categoría" feature (Olímpico/Preolímpico); that
// feature is SEMANTIC-trust in the A00 feature trust map but is not referenced by any registry tag's
// `allowedEvidenceSources`/positive evidence, so it structurally cannot vote here (Section 11).
//
// HOME_GYM never fires on mere consumer-suitability plausibility (Section 9): the only three
// evidence paths below are the structured feature, the "Máquinas Home Gym" category, and literal
// "Home Gym" name text — there is no fallback "any product an individual could buy" rule.
// COMMERCIAL_GYM never reads `primaryProductFamilyCode` — it is intentionally absent from this
// module's match context.

import { CLINICAL_RECOVERY_CATEGORY_NAMES, HOME_GYM_CATEGORY_NAMES, matchesCategoryName } from './category-catalog.js';
import type { OntologyRuleMatch, ProductSemanticClassificationInputCategory, ProductSemanticClassificationInputFeature } from './contracts.js';
import { normalizeEvidenceValue } from './normalize.js';

export type UseContextMatchContext = {
  readonly rawProductName: string;
  readonly normalizedProductName: string;
  readonly categories: readonly ProductSemanticClassificationInputCategory[];
  readonly features: readonly ProductSemanticClassificationInputFeature[];
  readonly allowCategoryEvidence: boolean;
  readonly allowStructuredFeatureEvidence: boolean;
  readonly allowedCategoryTrustClasses: readonly string[];
};

type UsageTier = 'HOME' | 'SEMI_COMMERCIAL' | 'COMMERCIAL' | 'OUTDOOR_HIGH_TRAFFIC' | 'UNRECOGNIZED';

/** Normalizes the 14 observed raw "Clasificación de Uso" values into the 4 registry-meaningful tiers. */
export function classifyUsageFeatureValue(rawValue: string): UsageTier {
  const normalized = normalizeEvidenceValue(rawValue);
  if (normalized.includes('semi')) return 'SEMI_COMMERCIAL';
  if (normalized.includes('hogar')) return 'HOME';
  if (normalized.includes('interiores y exteriores')) return 'OUTDOOR_HIGH_TRAFFIC';
  if (normalized.includes('comercial')) return 'COMMERCIAL';
  if (normalized.includes('trafico alto')) return 'COMMERCIAL'; // indoor-only high traffic folds into COMMERCIAL_GYM
  return 'UNRECOGNIZED';
}

function findUsageFeature(ctx: UseContextMatchContext): ProductSemanticClassificationInputFeature | null {
  if (!ctx.allowStructuredFeatureEvidence) return null;
  return ctx.features.find((feature) => feature.featureName === 'Clasificación de Uso' && feature.trustClass === 'SEMANTIC') ?? null;
}

function categoryMatch(ctx: UseContextMatchContext, code: string, ruleId: string, table: readonly string[], confidence: 'EXPLICIT' | 'STRONGLY_INFERRED'): OntologyRuleMatch | null {
  if (!ctx.allowCategoryEvidence) return null;
  for (const category of ctx.categories) {
    if (!ctx.allowedCategoryTrustClasses.includes(category.trustClass)) continue;
    const normalizedCategoryName = normalizeEvidenceValue(category.name);
    if (matchesCategoryName(normalizedCategoryName, table)) {
      return {
        code,
        confidence,
        ruleId,
        sourceType: 'TRUSTED_CATEGORY',
        sourceId: category.categoryId,
        rawValue: category.name,
        normalizedValue: normalizedCategoryName,
      };
    }
  }
  return null;
}

/** Evaluates all 6 USE_CONTEXT tags independently and returns every tag that matched. */
export function matchUseContexts(ctx: UseContextMatchContext): readonly OntologyRuleMatch[] {
  const matches: (OntologyRuleMatch | null)[] = [];
  const usageFeature = findUsageFeature(ctx);
  const usageTier = usageFeature ? classifyUsageFeatureValue(usageFeature.value) : null;

  // HOME_GYM: structured feature (source A, EXPLICIT) > trusted category (source B, STRONGLY_INFERRED) > literal name (source C, STRONGLY_INFERRED).
  if (usageTier === 'HOME') {
    matches.push({
      code: 'HOME_GYM',
      confidence: 'EXPLICIT',
      ruleId: 'CTX_HOME_USE_CLASSIFICATION_V1',
      sourceType: 'STRUCTURED_FEATURE',
      sourceId: usageFeature!.featureId,
      rawValue: usageFeature!.value,
      normalizedValue: normalizeEvidenceValue(usageFeature!.value),
    });
  } else {
    matches.push(
      categoryMatch(ctx, 'HOME_GYM', 'CTX_HOME_CATEGORY_V1', HOME_GYM_CATEGORY_NAMES, 'STRONGLY_INFERRED') ??
        (/\bhome gym\b/.test(ctx.normalizedProductName)
          ? {
              code: 'HOME_GYM',
              confidence: 'STRONGLY_INFERRED',
              ruleId: 'CTX_HOME_NAME_V1',
              sourceType: 'NAME_TEXT',
              sourceId: 'NAME',
              rawValue: ctx.rawProductName,
              normalizedValue: ctx.normalizedProductName,
            }
          : null),
    );
  }

  // SMALL_SPACE: NAME_TEXT only, always after non-product exclusion (enforced upstream by the orchestrator).
  if (/\bmuro\b|\bplegable\b|\bpared\b/.test(ctx.normalizedProductName)) {
    matches.push({
      code: 'SMALL_SPACE',
      confidence: 'EXPLICIT',
      ruleId: 'CTX_SMALL_SPACE_NAME_V1',
      sourceType: 'NAME_TEXT',
      sourceId: 'NAME',
      rawValue: ctx.rawProductName,
      normalizedValue: ctx.normalizedProductName,
    });
  }

  // COMMERCIAL_GYM: structured feature or literal name — never machine family/type alone.
  if (usageTier === 'COMMERCIAL') {
    matches.push({
      code: 'COMMERCIAL_GYM',
      confidence: 'EXPLICIT',
      ruleId: 'CTX_COMMERCIAL_USE_CLASSIFICATION_V1',
      sourceType: 'STRUCTURED_FEATURE',
      sourceId: usageFeature!.featureId,
      rawValue: usageFeature!.value,
      normalizedValue: normalizeEvidenceValue(usageFeature!.value),
    });
  } else if (/\bcomercial\b/.test(ctx.normalizedProductName)) {
    matches.push({
      code: 'COMMERCIAL_GYM',
      confidence: 'EXPLICIT',
      ruleId: 'CTX_COMMERCIAL_NAME_V1',
      sourceType: 'NAME_TEXT',
      sourceId: 'NAME',
      rawValue: ctx.rawProductName,
      normalizedValue: ctx.normalizedProductName,
    });
  }

  // SEMI_COMMERCIAL_STUDIO: structured feature only.
  if (usageTier === 'SEMI_COMMERCIAL') {
    matches.push({
      code: 'SEMI_COMMERCIAL_STUDIO',
      confidence: 'EXPLICIT',
      ruleId: 'CTX_SEMI_COMMERCIAL_USE_CLASSIFICATION_V1',
      sourceType: 'STRUCTURED_FEATURE',
      sourceId: usageFeature!.featureId,
      rawValue: usageFeature!.value,
      normalizedValue: normalizeEvidenceValue(usageFeature!.value),
    });
  }

  // CLINICAL_RECOVERY: literal clinical wording (EXPLICIT) or dedicated clinical-device category (STRONGLY_INFERRED).
  if (/\brehabilitacion\b|\bclinico\b|\bclinica\b/.test(ctx.normalizedProductName)) {
    matches.push({
      code: 'CLINICAL_RECOVERY',
      confidence: 'EXPLICIT',
      ruleId: 'CTX_CLINICAL_RECOVERY_NAME_V1',
      sourceType: 'NAME_TEXT',
      sourceId: 'NAME',
      rawValue: ctx.rawProductName,
      normalizedValue: ctx.normalizedProductName,
    });
  } else {
    matches.push(categoryMatch(ctx, 'CLINICAL_RECOVERY', 'CTX_CLINICAL_RECOVERY_CATEGORY_V1', CLINICAL_RECOVERY_CATEGORY_NAMES, 'STRONGLY_INFERRED'));
  }

  // OUTDOOR_HIGH_TRAFFIC: structured feature only.
  if (usageTier === 'OUTDOOR_HIGH_TRAFFIC') {
    matches.push({
      code: 'OUTDOOR_HIGH_TRAFFIC',
      confidence: 'EXPLICIT',
      ruleId: 'CTX_OUTDOOR_HIGH_TRAFFIC_USE_CLASSIFICATION_V1',
      sourceType: 'STRUCTURED_FEATURE',
      sourceId: usageFeature!.featureId,
      rawValue: usageFeature!.value,
      normalizedValue: normalizeEvidenceValue(usageFeature!.value),
    });
  }

  return matches.filter((match): match is OntologyRuleMatch => match !== null);
}
