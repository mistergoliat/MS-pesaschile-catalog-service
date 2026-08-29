// DISCIPLINE classification rules (Section 8). Implements exactly the 8 active registry DISCIPLINE
// tags. WEIGHTLIFTING is not implemented and cannot be emitted — there is no rule anywhere in this
// module keyed to the "Categoría" feature (Olímpico/Preolímpico), which is the technical
// sleeve-diameter spec the registry's `rejectedOntologyTags` record documents as the reason
// WEIGHTLIFTING was dropped. `getOntologyTag('DISCIPLINE', 'WEIGHTLIFTING')` returns `undefined` by
// construction (see commercial-product-ontology-registry.test.ts), and this module never checks for
// a "Categoría" feature value at all — see `docs/releases/...A00.3...md` and
// `tests/unit/product-semantic-classification-discipline-rules.test.ts` (`DISC_WEIGHTLIFTING_IMPOSSIBLE`).
//
// DISCIPLINE tags are independent multi-label evidence, not a single mutually-exclusive axis like
// PRODUCT_FAMILY: a product may legitimately carry zero, one, or (rarely) more than one.

import { DISCIPLINE_CATEGORY_NAMES, REHABILITATION_CLINICAL_DEVICE_CATEGORY_NAMES, matchesCategoryName } from './category-catalog.js';
import type { OntologyRuleMatch, ProductSemanticClassificationInputCategory } from './contracts.js';
import { normalizeEvidenceValue } from './normalize.js';

function categoryVote(
  categories: readonly ProductSemanticClassificationInputCategory[],
  allowedTrustClasses: readonly string[],
  table: readonly string[],
): { readonly categoryId: string; readonly categoryName: string; readonly normalizedCategoryName: string } | null {
  for (const category of categories) {
    if (!allowedTrustClasses.includes(category.trustClass)) continue;
    const normalizedCategoryName = normalizeEvidenceValue(category.name);
    if (matchesCategoryName(normalizedCategoryName, table)) {
      return { categoryId: category.categoryId, categoryName: category.name, normalizedCategoryName };
    }
  }
  return null;
}

export type DisciplineMatchContext = {
  readonly rawProductName: string;
  readonly normalizedProductName: string;
  readonly categories: readonly ProductSemanticClassificationInputCategory[];
  readonly allowCategoryEvidence: boolean;
  readonly allowedCategoryTrustClasses: readonly string[];
  readonly primaryProductFamilyCode: string | null;
};

function nameMatch(ctx: DisciplineMatchContext, code: string, ruleId: string, pattern: RegExp): OntologyRuleMatch | null {
  if (!pattern.test(ctx.normalizedProductName)) return null;
  return {
    code,
    confidence: 'EXPLICIT',
    ruleId,
    sourceType: 'NAME_TEXT',
    sourceId: 'NAME',
    rawValue: ctx.rawProductName,
    normalizedValue: ctx.normalizedProductName,
  };
}

function categoryMatch(ctx: DisciplineMatchContext, code: string, ruleId: string): OntologyRuleMatch | null {
  if (!ctx.allowCategoryEvidence) return null;
  const table = DISCIPLINE_CATEGORY_NAMES[code] ?? [];
  const vote = categoryVote(ctx.categories, ctx.allowedCategoryTrustClasses, table);
  if (!vote) return null;
  return {
    code,
    confidence: 'EXPLICIT',
    ruleId,
    sourceType: 'TRUSTED_CATEGORY',
    sourceId: vote.categoryId,
    rawValue: vote.categoryName,
    normalizedValue: vote.normalizedCategoryName,
  };
}

/** Evaluates all 8 DISCIPLINE tags independently and returns every tag that matched. */
export function matchDisciplines(ctx: DisciplineMatchContext): readonly OntologyRuleMatch[] {
  const matches: (OntologyRuleMatch | null)[] = [];

  matches.push(nameMatch(ctx, 'CROSSFIT', 'DISC_CROSSFIT_NAME_V1', /\bcrossfit\b|\bwod\b/));
  matches.push(nameMatch(ctx, 'HYROX', 'DISC_HYROX_NAME_V1', /\bhyrox\b/) ?? categoryMatch(ctx, 'HYROX', 'DISC_HYROX_CATEGORY_V1'));
  matches.push(
    nameMatch(ctx, 'POWERLIFTING', 'DISC_POWERLIFTING_NAME_V1', /\bpowerlifting\b/) ?? categoryMatch(ctx, 'POWERLIFTING', 'DISC_POWERLIFTING_CATEGORY_V1'),
  );

  const calisthenicsDirect =
    nameMatch(ctx, 'CALISTHENICS', 'DISC_CALISTHENICS_NAME_V1', /\bcalistenia\b/) ??
    categoryMatch(ctx, 'CALISTHENICS', 'DISC_CALISTHENICS_CATEGORY_V1');
  if (calisthenicsDirect) {
    matches.push(calisthenicsDirect);
  } else if (ctx.primaryProductFamilyCode === 'BODYWEIGHT_GYMNASTICS') {
    // Allowed even for historical rows: when the family itself is known (whether from a
    // current-catalog category vote or, for historical rows, from name text alone), the family
    // code is already trustworthy — chaining a discipline off of it needs no further category
    // data. Confirmed against A00.1C's full-catalog counts: CALISTHENICS' historicalProducts (20)
    // equals BODYWEIGHT_GYMNASTICS' historicalProducts (20) exactly.
    matches.push({
      code: 'CALISTHENICS',
      confidence: 'STRONGLY_INFERRED',
      ruleId: 'DISC_CALISTHENICS_FAMILY_V1',
      sourceType: 'FAMILY_INFERENCE',
      sourceId: 'FAMILY:BODYWEIGHT_GYMNASTICS',
      rawValue: 'BODYWEIGHT_GYMNASTICS',
      normalizedValue: 'bodyweight_gymnastics',
    });
  }

  if (ctx.primaryProductFamilyCode === 'CARDIO_MACHINE') {
    matches.push({
      code: 'CARDIO_ENDURANCE',
      confidence: 'STRONGLY_INFERRED',
      ruleId: 'DISC_CARDIO_ENDURANCE_FAMILY_V1',
      sourceType: 'FAMILY_INFERENCE',
      sourceId: 'FAMILY:CARDIO_MACHINE',
      rawValue: 'CARDIO_MACHINE',
      normalizedValue: 'cardio_machine',
    });
  }

  matches.push(
    nameMatch(ctx, 'YOGA_PILATES', 'DISC_YOGA_PILATES_NAME_V1', /\byoga\b|\bpilates\b/) ?? categoryMatch(ctx, 'YOGA_PILATES', 'DISC_YOGA_PILATES_CATEGORY_V1'),
  );
  matches.push(nameMatch(ctx, 'BOXING_MMA', 'DISC_BOXING_MMA_NAME_V1', /\bboxeo\b|\bmma\b/) ?? categoryMatch(ctx, 'BOXING_MMA', 'DISC_BOXING_MMA_CATEGORY_V1'));

  const rehabName = nameMatch(ctx, 'REHABILITATION', 'DISC_REHABILITATION_NAME_V1', /\brehabilitacion\b|\bclinico\b|\bclinica\b/);
  if (rehabName) {
    matches.push(rehabName);
  } else if (ctx.allowCategoryEvidence && ctx.primaryProductFamilyCode === 'RECOVERY_TOOL') {
    const vote = categoryVote(ctx.categories, ctx.allowedCategoryTrustClasses, REHABILITATION_CLINICAL_DEVICE_CATEGORY_NAMES);
    if (vote) {
      matches.push({
        code: 'REHABILITATION',
        confidence: 'STRONGLY_INFERRED',
        ruleId: 'DISC_REHABILITATION_FAMILY_CATEGORY_V1',
        sourceType: 'TRUSTED_CATEGORY',
        sourceId: vote.categoryId,
        rawValue: vote.categoryName,
        normalizedValue: vote.normalizedCategoryName,
      });
    }
  }

  return matches.filter((match): match is OntologyRuleMatch => match !== null);
}
