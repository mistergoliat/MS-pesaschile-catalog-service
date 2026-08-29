// PRODUCT_FAMILY classification rules (Section 6). Implements the 21 registry PRODUCT_FAMILY tags'
// evidence rules, in the deterministic precedence order documented in `docs/releases/
// CUSTOMER-INTELLIGENCE-R2-A00.3-product-semantic-classification-pipeline.md` (Section "Rule
// precedence"). Every rule only uses an `OntologyEvidenceSourceType` the corresponding registry tag
// actually declares in `allowedEvidenceSources` — this module never invents a source type.

import type { CommercialProductOntologyRegistry } from '../commercial-product-ontology/index.js';
import { PRODUCT_FAMILY_CATEGORY_NAMES, matchesCategoryName } from './category-catalog.js';
import type {
  OntologyRuleMatch,
  ProductSemanticClassificationInput,
  ProductSemanticClassificationInputCategory,
  ProductSemanticClassificationInputFeature,
} from './contracts.js';
import { normalizeEvidenceValue } from './normalize.js';

export type ProductFamilyNameRule = {
  readonly ruleId: string;
  readonly code: string;
  readonly test: (normalizedName: string) => boolean;
};

/**
 * Pass 1 (NAME_TEXT), in fixed precedence order. First match wins — this is the deterministic
 * conflict-resolution mechanism (Section 17), not incidental array order. Boundaries called out by
 * the task are annotated inline.
 */
export const PRODUCT_FAMILY_NAME_RULES: readonly ProductFamilyNameRule[] = [
  // STORAGE before any generic equipment noun (STORAGE for barbells/dumbbells/plates must never be
  // misfiled as that product's own family).
  { ruleId: 'PF_STORAGE_NAME_V1', code: 'STORAGE', test: (n) => /\balmacenamiento\b|\brack vertical\b|\brack para\b|\brack (organizador|colgador)\b/.test(n) },
  // Smith-machine naming overrides RACK_CAGE ("jaula") and generic multifuncional wording.
  { ruleId: 'PF_SMITH_OVERRIDE_V1', code: 'PLATE_LOADED_MACHINE', test: (n) => /\bsmith\b/.test(n) },
  // A00.4.2 exact closures: only the adjudicated cardio phrases, never broad "remo", "air", or
  // "escalera" tokens.
  { ruleId: 'PF_CARDIO_MACHINE_ERG_EXACT_NAME_V1', code: 'CARDIO_MACHINE', test: (n) => /\b(rowerg|bikeerg|skierg)\b/.test(n) },
  { ruleId: 'PF_CARDIO_MACHINE_ROWER_EXACT_NAME_V1', code: 'CARDIO_MACHINE', test: (n) => /\bremo de (aire|agua)\b/.test(n) },
  { ruleId: 'PF_CARDIO_MACHINE_BIKE_EXACT_NAME_V1', code: 'CARDIO_MACHINE', test: (n) => /\bair (cycle|bike)\b/.test(n) },
  { ruleId: 'PF_CARDIO_MACHINE_STAIR_EXACT_NAME_V1', code: 'CARDIO_MACHINE', test: (n) => /\bescalera (home led|led)\b/.test(n) },
  // CABLE_MACHINE before BODYWEIGHT_GYMNASTICS/BARBELL/RACK_CAGE/ROPE_SLED/MACHINE_ATTACHMENT: a
  // cable/pulley product or accessory named under its own pulley wording ("Soga de Tríceps -
  // Accesorio Polea", "Polea Rack Lite Accesorio Delta") is CABLE_MACHINE, never misfiled as a
  // generic RACK_CAGE ("rack") or accessory ("accesorio") match later in the ordered pass.
  { ruleId: 'PF_CABLE_MACHINE_NAME_V1', code: 'CABLE_MACHINE', test: (n) => /\bpoleas?\b|\bcrossover\b|\blat pulldown\b|\bcables?\b/.test(n) },
  // Mount hardware (registry definition: "collars, J-cups, spotter arms, ankle straps, mount
  // hardware") before BARBELL/RACK_CAGE/WEIGHT_PLATE/BENCH: a bar/plate *holder* or rack/bench mount
  // accessory ("Soporte de Barra Accesorio Delta", "Par de Soportes Para Discos Olímpicos") is
  // MACHINE_ATTACHMENT, not the BARBELL/WEIGHT_PLATE/RACK_CAGE it merely holds.
  {
    ruleId: 'PF_MACHINE_ATTACHMENT_NAME_V1',
    code: 'MACHINE_ATTACHMENT',
    test: (n) =>
      // "anclaje" (anchor/mount) is deliberately excluded — it also names BAND_SUSPENSION anchor
      // hardware ("X-Mount Anclaje Banda de Suspensión"), which must win via its own more specific pattern.
      // "collarin(es)" (barbell collar clamps, a distinct word form from "collar/collares") and
      // "ankle straps" (English cable-attachment strap SKUs) are the same mount-hardware concept.
      /\bcollar(es)?\b|\bcollarin(es)?\b|\bj-?cups?\b|\bspotter arms?\b|\bsoporte (de|para) (barra|discos?)\b|\bpar de soportes\b|\blandmines?\b|\bsafety straps?\b|\bankle straps?\b|\bdip horns?\b|\bbulgarian squat\b|\bjammer\b|\bporta discos\b/.test(
        n,
      ),
  },
  // BODYWEIGHT_GYMNASTICS before the generic BARBELL pattern (a pull-up/parallel bar is not a BARBELL).
  { ruleId: 'PF_BODYWEIGHT_GYMNASTICS_NAME_V1', code: 'BODYWEIGHT_GYMNASTICS', test: (n) => /\bparalelas\b|\bdominadas\b|\bpull ?ups?\b|\banillas\b|\brampa caminata de manos\b/.test(n) },
  { ruleId: 'PF_BARBELL_NAME_V1', code: 'BARBELL', test: (n) => /\bbarras?\b/.test(n) },
  // "atril" (plate/squat stand) is filed under the registry's own "Racks" category hierarchy
  // (Atriles); checked before WEIGHT_PLATE so "Atril de Discos Olímpicos" is the stand, not the plates.
  // "Rack Organizador"/"Rack Colgador" are storage/hanging holders, not training racks.
  {
    ruleId: 'PF_RACK_CAGE_NAME_V1',
    code: 'RACK_CAGE',
    test: (n) => (/\bpower rack\b|\bsquat rack\b|\bjaula\b|\brack\b|\batril(es)?\b/.test(n)) && !/\brack (organizador|colgador)\b/.test(n),
  },
  // Excludes "disco de equilibrio" (a wobble/balance board) — a bare "disco" match but not a weight plate.
  { ruleId: 'PF_WEIGHT_PLATE_NAME_V1', code: 'WEIGHT_PLATE', test: (n) => (/\bdiscos?\b|\bbumper\b|\bfraccional(es)?\b/.test(n)) && !/\bequilibrio\b/.test(n) },
  { ruleId: 'PF_DUMBBELL_NAME_V1', code: 'DUMBBELL', test: (n) => /\bmancuernas?\b/.test(n) },
  { ruleId: 'PF_KETTLEBELL_NAME_V1', code: 'KETTLEBELL', test: (n) => /\bkettlebells?\b|\bpesas? rusas?\b|\bclubbells?\b/.test(n) },
  // "cajon hip thrust" (a padded hip-thrust box) is a bench-like product; bare "hip thrust" alone is
  // excluded because it also names standalone hip-thrust machines, belts, and pads elsewhere in the
  // catalog that are not benches at all.
  { ruleId: 'PF_BENCH_NAME_V1', code: 'BENCH', test: (n) => /\bbancos?\b|\bghd\b|\bcajon hip thrust\b/.test(n) },
  { ruleId: 'PF_PLATE_LOADED_MACHINE_EXACT_NAME_V1', code: 'PLATE_LOADED_MACHINE', test: (n) => /\b(linear leg press|hack squat|hip thrust machine|standing leg curl)\b/.test(n) },
  { ruleId: 'PF_PLATE_LOADED_MACHINE_NAME_V1', code: 'PLATE_LOADED_MACHINE', test: (n) => /\bprensa\b|\bcarga de discos\b/.test(n) },
  { ruleId: 'PF_SELECTORIZED_MACHINE_EXACT_NAME_V1', code: 'SELECTORIZED_MACHINE', test: (n) => /\b(seated leg curl|prone leg curl|dual leg curl extension)\b/.test(n) },
  { ruleId: 'PF_SELECTORIZED_MACHINE_NAME_V1', code: 'SELECTORIZED_MACHINE', test: (n) => /\bselectorizad\w*\b|\bpila de stack\b|\bdual (cuadriceps|femoral|abductor|aductor)\b/.test(n) },
  // Deliberately does NOT match bare "remo" (row): in this catalog "Remo Bajo/Sentado" names a
  // SELECTORIZED_MACHINE seated/low-row resistance machine, not a cardio rowing ergometer — "remo"
  // alone is ambiguous between the two, so only the unambiguous English "rower"/"row" wording is used.
  { ruleId: 'PF_CARDIO_MACHINE_NAME_V1', code: 'CARDIO_MACHINE', test: (n) => /\btrotadoras?\b|\bbicicletas?\b|\bspinning\b|\bairbikes?\b|\bair ski\b|\belipticas?\b|\bescaladoras?\b|\browers?\b|\bair rows?\b/.test(n) },
  // FLOORING vs YOGA_PILATES: generic mats/tiles are FLOORING only when the name does not itself say yoga/pilates.
  { ruleId: 'PF_FLOORING_TURF_NAME_V1', code: 'FLOORING', test: (n) => /\bpasto sintetico\b/.test(n) },
  { ruleId: 'PF_FLOORING_NAME_V1', code: 'FLOORING', test: (n) => (/\bpalmetas?\b|\bpisos?\b|\btatamis?\b|\bcolchonetas?\b|\bplataforma(s)? de levantamiento\b/.test(n)) && !/\byoga\b|\bpilates\b/.test(n) },
  // "sand ?bag" tolerates both "Sandbag" (one word) and "Sand Bag" (two words); "saco bulgaro"
  // (Bulgarian bag) is the same training-sack concept under a different brand/name.
  { ruleId: 'PF_BALL_BAG_NAME_V1', code: 'BALL_BAG', test: (n) => (/\bbalon(es)? medicinal(es)?\b|\bslam balls?\b|\bsand ?bags?\b|\bbosu\b|\bsaco bulgaro\b/.test(n)) && !/\bpilates\b/.test(n) },
  // "rope" (English) covers jump-rope SKUs branded as "Speed Rope"/"Heavy Speed Rope".
  { ruleId: 'PF_ROPE_SLED_NAME_V1', code: 'ROPE_SLED', test: (n) => /\bsogas?\b|\bcuerdas?\b|\btrineos?\b|\bsleds?\b|\bropes?\b/.test(n) },
  // "tubo(s)" and the English synonyms "expander"/"tube" cover the same physical product
  // ("Expander Tube Soft Rojo") the registry's Spanish-only example list did not literally include.
  { ruleId: 'PF_BAND_SUSPENSION_NAME_V1', code: 'BAND_SUSPENSION', test: (n) => /\bbandas?\b|\bsuspension\b|\btubos? elasticos?\b|\bx-?mount\b|\bexpander\b|\btubes?\b/.test(n) },
  { ruleId: 'PF_PROTECTIVE_GEAR_NAME_V1', code: 'PROTECTIVE_GEAR', test: (n) => /\bcinturon(es)?\b|\brodilleras?\b|\bmu[nñ]equeras?\b|\bcalleras?\b|\bguantes?\b|\bvendas?\b|\bvendaje\b/.test(n) },
  { ruleId: 'PF_RECOVERY_TOOL_NAME_V1', code: 'RECOVERY_TOOL', test: (n) => /\bfoam rollers?\b|\bmasajeador(a|es)?\b|\bcamaras? hiperbaricas?\b|\bbotas? de compresion\b|\bpresoterapia\b|\bpistolas? de masaje\b|\bbolas? de masaje\b|\bmassage guns?\b/.test(n) },
  { ruleId: 'PF_YOGA_PILATES_NAME_V1', code: 'YOGA_PILATES', test: (n) => /\byoga\b|\bpilates\b/.test(n) },
  // "poleron(es)" (not "polerones?", which does not match the singular "polerón"); "crop" alone
  // (not just "crop top") covers "Crop Manga Larga..." apparel SKUs; "morral"/"mochila" (bag/backpack
  // merch) is the same "Clothing/merch" concept the tag definition names, under a term the
  // registry's illustrative keyword list omitted.
  { ruleId: 'PF_APPAREL_NAME_V1', code: 'APPAREL', test: (n) => /\bpoleras?\b|\bcrops?\b|\bbuzos?\b|\bpoleron(es)?\b|\bgorras?\b|\bmorral(es)?\b|\bmochilas?\b/.test(n) },
];

/**
 * Runs the ordered NAME_TEXT pass over one normalized name substring. First match wins — every
 * PRODUCT_FAMILY tag with a NAME_TEXT rule allows EXPLICIT confidence, so a name match is always
 * EXPLICIT (verified against every tag's `confidencePolicy` in `product-family-tags.ts`).
 */
export function matchProductFamilyByName(normalizedNameSubstring: string, rawProductName: string): OntologyRuleMatch | null {
  for (const rule of PRODUCT_FAMILY_NAME_RULES) {
    if (rule.test(normalizedNameSubstring)) {
      return {
        code: rule.code,
        confidence: 'EXPLICIT',
        ruleId: rule.ruleId,
        sourceType: 'NAME_TEXT',
        sourceId: 'NAME',
        rawValue: rawProductName,
        normalizedValue: normalizedNameSubstring,
      };
    }
  }
  return null;
}

const CATEGORY_RULE_ID_BY_CODE: Readonly<Record<string, string>> = {
  WEIGHT_PLATE: 'PF_WEIGHT_PLATE_CATEGORY_V1',
  DUMBBELL: 'PF_DUMBBELL_CATEGORY_V1',
  PLATE_LOADED_MACHINE: 'PF_PLATE_LOADED_MACHINE_CATEGORY_V1',
  SELECTORIZED_MACHINE: 'PF_SELECTORIZED_MACHINE_CATEGORY_V1',
  STORAGE: 'PF_STORAGE_CATEGORY_V1',
  PROTECTIVE_GEAR: 'PF_PROTECTIVE_GEAR_CATEGORY_V1',
  MACHINE_ATTACHMENT: 'PF_MACHINE_ATTACHMENT_CATEGORY_V1',
  YOGA_PILATES: 'PF_YOGA_PILATES_CATEGORY_V1',
};

/** Fixed iteration order for the category-vote pass, so tie-break reporting is deterministic. */
const CATEGORY_VOTE_FAMILY_ORDER: readonly string[] = [
  'WEIGHT_PLATE',
  'DUMBBELL',
  'PLATE_LOADED_MACHINE',
  'SELECTORIZED_MACHINE',
  'STORAGE',
  'PROTECTIVE_GEAR',
  'MACHINE_ATTACHMENT',
  'YOGA_PILATES',
];

/** PRODUCT_FAMILY tags whose confidencePolicy allows only EXPLICIT — even when matched via category. */
export const PRODUCT_FAMILY_EXPLICIT_ONLY_CODES: ReadonlySet<string> = new Set(['STORAGE', 'YOGA_PILATES']);

const GUARDED_CABLE_MACHINE_CATEGORY_ID = '290';
const GUARDED_CABLE_MACHINE_CATEGORY_NAME = normalizeEvidenceValue('Máquinas con Poleas');
const ACCEPTED_GUARDED_CABLE_FEATURE_TRUST_CLASSES = new Set(['SEMANTIC', 'TECHNICAL']);

type GuardedCableMachineFeatureConcept =
  | 'RELACION_DE_CABLE_Y_POLEA'
  | 'PILA_DE_STACK'
  | 'PESO_MAXIMO_DE_CARGA_POLEA'
  | 'LARGO_DE_LA_MANGA_POLEA';

type GuardedCableMachineFeatureMatch = {
  readonly feature: ProductSemanticClassificationInputFeature;
  readonly concept: GuardedCableMachineFeatureConcept;
  readonly normalizedFeatureName: string;
  readonly normalizedFeatureValue: string;
};

/**
 * Pass 2 (TRUSTED_CATEGORY), only reached when Pass 1 found nothing and only for current-catalog
 * rows (Section 12: category evidence is structurally unavailable for historical-only rows).
 * `allowedCategoryTrustClasses` is the registry's `categoryTrustGate.PRODUCT_FAMILY`
 * (SEMANTIC_STRONG + SEMANTIC_WEAK) — enforced by the caller, not re-declared here. Returns every
 * distinct matching family code found (deduplicated, first-seen wins per code) so the caller can
 * detect a genuine multi-family conflict (Section 17).
 */
export function voteProductFamilyByCategory(
  categories: readonly ProductSemanticClassificationInputCategory[],
  allowedCategoryTrustClasses: readonly string[],
): readonly OntologyRuleMatch[] {
  const votesByCode = new Map<string, OntologyRuleMatch>();
  for (const category of categories) {
    if (!allowedCategoryTrustClasses.includes(category.trustClass)) continue;
    const normalizedCategoryName = normalizeEvidenceValue(category.name);
    for (const code of CATEGORY_VOTE_FAMILY_ORDER) {
      if (votesByCode.has(code)) continue;
      const table = PRODUCT_FAMILY_CATEGORY_NAMES[code] ?? [];
      if (matchesCategoryName(normalizedCategoryName, table)) {
        votesByCode.set(code, {
          code,
          confidence: PRODUCT_FAMILY_EXPLICIT_ONLY_CODES.has(code) ? 'EXPLICIT' : 'STRONGLY_INFERRED',
          ruleId: CATEGORY_RULE_ID_BY_CODE[code]!,
          sourceType: 'TRUSTED_CATEGORY',
          sourceId: category.categoryId,
          rawValue: category.name,
          normalizedValue: normalizedCategoryName,
        });
      }
    }
  }
  return Array.from(votesByCode.values());
}

export function matchGuardedCableMachineStructuredEvidence(
  input: ProductSemanticClassificationInput,
  registry: CommercialProductOntologyRegistry,
): OntologyRuleMatch | null {
  const cableMachineTag = registry.axes
    .find((axisDefinition) => axisDefinition.axis === 'PRODUCT_FAMILY')
    ?.tags.find((tag) => tag.code === 'CABLE_MACHINE');
  if (!cableMachineTag?.allowedEvidenceSources.includes('STRUCTURED_FEATURE')) return null;

  const category = input.categories.find(
    (candidate) =>
      candidate.categoryId === GUARDED_CABLE_MACHINE_CATEGORY_ID &&
      candidate.trustClass === 'SEMANTIC_STRONG' &&
      registry.globalRules.categoryTrustGate.PRODUCT_FAMILY.includes(candidate.trustClass) &&
      normalizeEvidenceValue(candidate.name) === GUARDED_CABLE_MACHINE_CATEGORY_NAME,
  );
  if (!category) return null;

  const featureMatch = input.features
    .filter((feature) => ACCEPTED_GUARDED_CABLE_FEATURE_TRUST_CLASSES.has(feature.trustClass))
    .map((feature) => matchGuardedCableMachineFeature(feature))
    .find((match): match is GuardedCableMachineFeatureMatch => match !== null);
  if (!featureMatch) return null;

  const rawValue = `category[${category.categoryId}] ${category.name} | feature[${featureMatch.feature.featureId}] ${featureMatch.feature.featureName}: ${featureMatch.feature.value}`;
  return {
    code: 'CABLE_MACHINE',
    confidence: 'STRONGLY_INFERRED',
    ruleId: 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3',
    sourceType: 'STRUCTURED_FEATURE',
    sourceId: featureMatch.feature.featureId,
    rawValue,
    normalizedValue: normalizeEvidenceValue(rawValue),
  };
}

const GUARDED_PLATE_LOADED_NAME_PATTERNS: readonly RegExp[] = [/\bshoulder press\b/, /\bchest press\b/, /\bleg extension\b/, /\bpulldown\b/, /\blow row\b/];
const GUARDED_SELECTORIZED_NAME_PATTERNS: readonly RegExp[] = [/\bextension de cuadriceps\b/, /\bchest press\b/, /\bshoulder press\b/, /\bleg extension\b/, /\bseated row\b/, /\bseated leg press\b/];

export function matchGuardedExistingFamilyStructuredEvidence(
  normalizedName: string,
  rawProductName: string,
  features: readonly ProductSemanticClassificationInputFeature[],
): OntologyRuleMatch | null {
  const plateLoadedMatch = matchGuardedPlateLoadedName(normalizedName, rawProductName, features);
  const selectorizedMatch = matchGuardedSelectorizedName(normalizedName, rawProductName, features);
  if (plateLoadedMatch && selectorizedMatch) return null;
  return plateLoadedMatch ?? selectorizedMatch;
}

function matchGuardedPlateLoadedName(
  normalizedName: string,
  rawProductName: string,
  features: readonly ProductSemanticClassificationInputFeature[],
): OntologyRuleMatch | null {
  if (!GUARDED_PLATE_LOADED_NAME_PATTERNS.some((pattern) => pattern.test(normalizedName))) return null;
  if (/\b(crossover|cable|polea|lat pulldown)\b/.test(normalizedName)) return null;
  if (!hasPlateLoadedStructuredGuard(features)) return null;
  return {
    code: 'PLATE_LOADED_MACHINE',
    confidence: 'EXPLICIT',
    ruleId: 'PF_PLATE_LOADED_MACHINE_GUARDED_NAME_V1',
    sourceType: 'NAME_TEXT',
    sourceId: 'NAME',
    rawValue: rawProductName,
    normalizedValue: normalizedName,
  };
}

function matchGuardedSelectorizedName(
  normalizedName: string,
  rawProductName: string,
  features: readonly ProductSemanticClassificationInputFeature[],
): OntologyRuleMatch | null {
  if (!GUARDED_SELECTORIZED_NAME_PATTERNS.some((pattern) => pattern.test(normalizedName))) return null;
  if (!hasSelectorizedStructuredGuard(features)) return null;
  return {
    code: 'SELECTORIZED_MACHINE',
    confidence: 'EXPLICIT',
    ruleId: 'PF_SELECTORIZED_MACHINE_GUARDED_NAME_V1',
    sourceType: 'NAME_TEXT',
    sourceId: 'NAME',
    rawValue: rawProductName,
    normalizedValue: normalizedName,
  };
}

function hasPlateLoadedStructuredGuard(features: readonly ProductSemanticClassificationInputFeature[]): boolean {
  const normalized = features
    .filter((feature) => feature.trustClass === 'SEMANTIC' || feature.trustClass === 'TECHNICAL')
    .map((feature) => ({
      name: normalizeEvidenceValue(feature.featureName),
      value: normalizeEvidenceValue(feature.value),
    }));

  const hasOlympicCategory = normalized.some((feature) => feature.name === 'categoria' && /\bolimpic\w*\b/.test(feature.value));
  const hasSleeveDiameter50 = normalized.some((feature) => feature.name === 'diametro de manga' && /\b50\b/.test(feature.value));
  const hasSleeveLength = normalized.some((feature) => feature.name === 'largo de la manga' && feature.value.length > 0);
  const hasPerSideLoad = normalized.some((feature) => feature.name === 'peso maximo de carga' && /\bpor lado\b/.test(feature.value));

  const supportingSignals = [hasOlympicCategory, hasSleeveLength || hasPerSideLoad].filter(Boolean).length;
  return hasSleeveDiameter50 && supportingSignals >= 1;
}

function hasSelectorizedStructuredGuard(features: readonly ProductSemanticClassificationInputFeature[]): boolean {
  return features.some(
    (feature) =>
      (feature.trustClass === 'SEMANTIC' || feature.trustClass === 'TECHNICAL') &&
      normalizeEvidenceValue(feature.featureName) === 'pila de stack' &&
      normalizeEvidenceValue(feature.value).length > 0,
  );
}

function matchGuardedCableMachineFeature(feature: ProductSemanticClassificationInputFeature): GuardedCableMachineFeatureMatch | null {
  const normalizedFeatureName = normalizeEvidenceValue(feature.featureName);
  const normalizedFeatureValue = normalizeEvidenceValue(feature.value);
  if (normalizedFeatureName === 'relacion de cable y polea') {
    return { feature, concept: 'RELACION_DE_CABLE_Y_POLEA', normalizedFeatureName, normalizedFeatureValue };
  }
  if (normalizedFeatureName === 'pila de stack') {
    return { feature, concept: 'PILA_DE_STACK', normalizedFeatureName, normalizedFeatureValue };
  }
  if (normalizedFeatureName === 'peso maximo de carga' && /\bpoleas?\b/.test(normalizedFeatureValue)) {
    return { feature, concept: 'PESO_MAXIMO_DE_CARGA_POLEA', normalizedFeatureName, normalizedFeatureValue };
  }
  if (normalizedFeatureName === 'largo de la manga' && /\bpoleas?\b/.test(normalizedFeatureValue)) {
    return { feature, concept: 'LARGO_DE_LA_MANGA_POLEA', normalizedFeatureName, normalizedFeatureValue };
  }
  return null;
}
