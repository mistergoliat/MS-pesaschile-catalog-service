import { createHash } from 'node:crypto';
import type {
  TrainingCapabilityCode,
  TrainingClassificationConfidence,
  TrainingRelationType,
  TrainingSemanticEvidence,
} from '../training-semantics/index.js';
import type {
  TrainingSemanticClassificationInput,
  TrainingSemanticClassificationFeature,
} from './contracts.js';
import { normalizeTrainingText } from './normalize.js';

export type TrainingSemanticRuleMatch = {
  readonly capabilityCode: TrainingCapabilityCode;
  readonly relationType: TrainingRelationType;
  readonly confidence: TrainingClassificationConfidence;
  readonly evidence: readonly TrainingSemanticEvidence[];
  readonly ruleId: string;
};

type EvidenceHit = {
  readonly kind: TrainingSemanticEvidence['kind'];
  readonly sourceId?: string;
  readonly matchedText: string;
  readonly ruleId: string;
  readonly note?: string;
};

type RuleDefinition = {
  readonly id: string;
  readonly capabilityCode: TrainingCapabilityCode;
  readonly relationType: TrainingRelationType;
  readonly confidence: TrainingClassificationConfidence;
  readonly pattern: RegExp;
};

const directNameRules: readonly RuleDefinition[] = [
  { id: 'NAME_LEG_EXTENSION_EXPLICIT_V1', capabilityCode: 'LEG_EXTENSION', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:leg extension|extension(?: de)? cuadriceps|extension de piernas?)\b/ },
  { id: 'NAME_LEG_CURL_EXPLICIT_V1', capabilityCode: 'LEG_CURL', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:leg curl|curl femoral)\b/ },
  { id: 'NAME_HIP_THRUST_EXPLICIT_V1', capabilityCode: 'HIP_THRUST', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\bhip thrust\b/ },
  { id: 'NAME_CHEST_PRESS_EXPLICIT_V1', capabilityCode: 'CHEST_PRESS', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:chest press|press de pectoral|press de pecho|press pecho)\b/ },
  { id: 'NAME_PEC_DECK_EXPLICIT_V1', capabilityCode: 'PEC_DECK', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:pec deck|contractora(?: de pectoral| pectoral)?|contractor(?:a)? pectoral)\b/ },
  { id: 'NAME_LAT_PULLDOWN_EXPLICIT_V1', capabilityCode: 'LAT_PULLDOWN', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:lat pulldown|pulldown|jalon al pecho|polea alta)\b/ },
  { id: 'NAME_ROW_EXPLICIT_V1', capabilityCode: 'ROW', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:seated row|remo sentado|low row|t row|t rowing|remo bajo|remo contrapeso|polea alta remo)\b/ },
  { id: 'NAME_SHOULDER_PRESS_EXPLICIT_V1', capabilityCode: 'SHOULDER_PRESS', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:shoulder press|press de hombro|press hombro)\b/ },
  { id: 'NAME_PULL_UP_DIRECT_EXPLICIT_V1', capabilityCode: 'PULL_UP', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:barra pull ?ups?|pull ?up bar|barra de dominadas|estacion de dominadas|pull ?up station|dominadas?)\b/ },
  { id: 'NAME_DIP_DIRECT_EXPLICIT_V1', capabilityCode: 'DIP', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:dip station|barra paralela|paralelas|fondos dedicados?|fondos|pull ?up dip bar)\b/ },
  { id: 'NAME_ABDOMINAL_CRUNCH_EXPLICIT_V1', capabilityCode: 'ABDOMINAL_CRUNCH', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:abdominal crunch|crunch machine|estacion abdominal de crunch|maquina abdominal)\b/ },
  { id: 'NAME_ADDUCTOR_EXPLICIT_V1', capabilityCode: 'ADDUCTOR', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:adductor|aductor)(?:a)?(?: machine| maquina| station| estacion)?\b/ },
  { id: 'NAME_ABDUCTOR_EXPLICIT_V1', capabilityCode: 'ABDUCTOR', relationType: 'DIRECT', confidence: 'EXPLICIT', pattern: /\b(?:abductor|abductora)(?: machine| maquina| station| estacion)?\b/ },
];

const deferredRules: readonly { readonly code: string; readonly pattern: RegExp; readonly reason: string }[] = [
  { code: 'LEG_PRESS', pattern: /\bleg press|prensa de piernas?\b/, reason: 'Candidate capability is deferred from Training Semantics V1.' },
  { code: 'SQUAT', pattern: /\bsquat|sentadilla\b/, reason: 'Candidate capability is deferred from Training Semantics V1.' },
  { code: 'BENCH_PRESS', pattern: /\bbench press|press de banca\b/, reason: 'Candidate capability is deferred from Training Semantics V1; do not map to CHEST_PRESS.' },
  { code: 'DEADLIFT', pattern: /\bdeadlift|peso muerto\b/, reason: 'Candidate capability is deferred from Training Semantics V1.' },
  { code: 'BICEPS_CURL', pattern: /\bbiceps curl|curl de biceps\b/, reason: 'Candidate capability is deferred from Training Semantics V1.' },
  { code: 'TRICEPS_EXTENSION', pattern: /\btriceps extension|extension de triceps\b/, reason: 'Candidate capability is deferred from Training Semantics V1.' },
  { code: 'GLUTE_KICKBACK', pattern: /\bglute kickback|patada de gluteo\b/, reason: 'Candidate capability is deferred from Training Semantics V1.' },
  { code: 'CALF_RAISE', pattern: /\bcalf raise|gemelo|pantorrilla\b/, reason: 'Candidate capability is deferred from Training Semantics V1.' },
  { code: 'BACK_EXTENSION', pattern: /\bback extension|extension lumbar\b/, reason: 'Candidate capability is deferred from Training Semantics V1.' },
];

const accessoryTokens = ['accesorio', 'attachment', 'agarre', 'grip', 'handle', 'pad', 'cinturon', 'cinturon', 'rueda', 'abmat', 'strap', 'correa', 'soporte para'] as const;
export const trainingSemanticRejectedBoundaryPatterns = [
  '\\bbanco abdominal\\b',
  '(?:\\b(?:cajon|caja|box)\\b.*\\bhip thrust\\b|\\bhip thrust\\b.*\\b(?:cajon|caja|box)\\b)',
  '\\balmohadilla hip thrust\\b',
] as const;
const nonApplicableFamilies = ['FLOORING', 'BARBELL', 'DUMBBELL', 'BAND', 'STORAGE', 'PROTECTIVE_GEAR', 'BENCH'] as const;
const machineFamilies = ['CABLE_MACHINE', 'SELECTORIZED_MACHINE', 'PLATE_LOADED_MACHINE', 'RACK_CAGE', 'MACHINE_ATTACHMENT'] as const;

function evidenceFromHit(hit: EvidenceHit): TrainingSemanticEvidence {
  return {
    kind: hit.kind,
    ...(hit.sourceId ? { sourceId: hit.sourceId } : {}),
    matchedText: hit.matchedText,
    ruleId: hit.ruleId,
    ...(hit.note ? { note: hit.note } : {}),
  };
}

function sortedCategories(input: TrainingSemanticClassificationInput) {
  return [...input.categories].sort((a, b) => `${a.name}\u0000${a.categoryId}`.localeCompare(`${b.name}\u0000${b.categoryId}`));
}

function sortedFeatures(input: TrainingSemanticClassificationInput): readonly TrainingSemanticClassificationFeature[] {
  return [...input.features].sort((a, b) => `${a.featureName}\u0000${a.featureId}\u0000${a.value}`.localeCompare(`${b.featureName}\u0000${b.featureId}\u0000${b.value}`));
}

function isAccessoryLike(name: string): boolean {
  return accessoryTokens.some((token) => name.includes(token));
}

function isPackLike(name: string, categories: readonly string[]): boolean {
  return /\b(?:pack|set|kit|duo|trio|combo|multi)\b/.test(name) || categories.some((value) => /\b(?:pack|packs|set|kits)\b/.test(value));
}

function isCardioRow(input: TrainingSemanticClassificationInput, normalizedName: string): boolean {
  return input.productFamily === 'CARDIO_MACHINE' || /\b(?:ergometro|ergometer|air rower|rower cardio|remo cardio|remo indoor)\b/.test(normalizedName);
}

function hasRackOrStationContext(input: TrainingSemanticClassificationInput, normalizedName: string): boolean {
  return /\b(?:rack|jaula|cage|crossover|estacion|station|dual|multifuncional)\b/.test(normalizedName) || input.productFamily === 'RACK_CAGE';
}

function explicitFeatureMatches(input: TrainingSemanticClassificationInput, normalizedName: string): readonly TrainingSemanticRuleMatch[] {
  const matches: TrainingSemanticRuleMatch[] = [];
  if (isAccessoryLike(normalizedName)) return matches;
  const features = sortedFeatures(input);
  for (const feature of features) {
    if (feature.trustClass !== 'SEMANTIC') continue;
    const value = normalizeTrainingText(`${feature.featureName} ${feature.value}`);
    if (!value) continue;
    const featureRules = directNameRules.filter((rule) => rule.pattern.test(value));
    for (const rule of featureRules) {
      if (rule.capabilityCode === 'ROW' && isCardioRow(input, normalizedName)) continue;
      if (rule.capabilityCode === 'PULL_UP' || rule.capabilityCode === 'DIP') {
        if (!hasRackOrStationContext(input, normalizedName)) continue;
        matches.push({
          capabilityCode: rule.capabilityCode,
          relationType: 'SUPPORTED',
          confidence: 'HIGH',
          ruleId: `FEATURE_${rule.id}`,
          evidence: [evidenceFromHit({ kind: 'STRUCTURED_FEATURE', sourceId: feature.featureId, matchedText: `${feature.featureName}: ${feature.value}`, ruleId: `FEATURE_${rule.id}`, note: 'Explicit module/configuration evidence; supported relation.' })],
        });
        continue;
      }
      matches.push({
        capabilityCode: rule.capabilityCode,
        relationType: rule.relationType,
        confidence: 'HIGH',
        ruleId: `FEATURE_${rule.id}`,
        evidence: [evidenceFromHit({ kind: 'STRUCTURED_FEATURE', sourceId: feature.featureId, matchedText: `${feature.featureName}: ${feature.value}`, ruleId: `FEATURE_${rule.id}` })],
      });
    }
  }
  return matches;
}

function trustedCategoryMatches(input: TrainingSemanticClassificationInput, normalizedName: string): readonly TrainingSemanticRuleMatch[] {
  const matches: TrainingSemanticRuleMatch[] = [];
  if (isAccessoryLike(normalizedName)) return matches;
  for (const category of sortedCategories(input)) {
    const normalizedCategory = normalizeTrainingText(category.name);
    if (category.trustClass !== 'SEMANTIC_STRONG' && category.trustClass !== 'SEMANTIC_WEAK') continue;
    for (const rule of directNameRules) {
      if (!rule.pattern.test(normalizedCategory)) continue;
      if (rule.capabilityCode === 'ROW' && isCardioRow(input, normalizedName)) continue;
      const confidence = category.trustClass === 'SEMANTIC_STRONG' ? 'HIGH' : 'MEDIUM';
      matches.push({
        capabilityCode: rule.capabilityCode,
        relationType: rule.relationType,
        confidence,
        ruleId: `CATEGORY_${rule.id}`,
        evidence: [evidenceFromHit({ kind: 'TRUSTED_CATEGORY', sourceId: category.categoryId, matchedText: category.name, ruleId: `CATEGORY_${rule.id}`, note: category.trustClass })],
      });
    }
  }
  return matches;
}

function nameMatches(input: TrainingSemanticClassificationInput, normalizedName: string): readonly TrainingSemanticRuleMatch[] {
  const matches: TrainingSemanticRuleMatch[] = [];
  const categoryNames = sortedCategories(input).map((category) => normalizeTrainingText(category.name));
  const accessory = isAccessoryLike(normalizedName);
  const pack = isPackLike(normalizedName, categoryNames);
  for (const rule of directNameRules) {
    const match = rule.pattern.exec(normalizedName);
    if (!match) continue;
    if (rule.capabilityCode === 'ROW' && isCardioRow(input, normalizedName)) continue;
    if (rule.capabilityCode === 'HIP_THRUST' && (
      /\b(?:cajon|caja|box|pad|almohadilla|cinturon|barra)\b/.test(normalizedName) ||
      input.productFamily === 'BARBELL' ||
      input.productFamily === 'MACHINE_ATTACHMENT'
    )) continue;
    if (rule.capabilityCode === 'ABDOMINAL_CRUNCH' && /\b(?:rueda|wheel|abmat|banco)\b/.test(normalizedName)) continue;
    if (rule.capabilityCode === 'DIP' && (match[0] === 'fondo' || match[0] === 'fondos') && !hasRackOrStationContext(input, normalizedName) && !/\b(?:dedicado|dedicada|paralelas|dip)\b/.test(normalizedName)) continue;
    if (accessory) continue;
    if (pack && !['LEG_EXTENSION', 'LEG_CURL', 'ADDUCTOR', 'ABDUCTOR'].includes(rule.capabilityCode)) continue;
    if ((rule.capabilityCode === 'PULL_UP' || rule.capabilityCode === 'DIP') && hasRackOrStationContext(input, normalizedName) && !/\b(?:barra|bar|station|estacion|paralelas|dedicado|dedicada)\b/.test(normalizedName)) {
      matches.push({
        capabilityCode: rule.capabilityCode,
        relationType: 'SUPPORTED',
        confidence: 'EXPLICIT',
        ruleId: `${rule.id}_SUPPORTED`,
        evidence: [evidenceFromHit({ kind: 'NAME', sourceId: 'NAME', matchedText: match[0], ruleId: `${rule.id}_SUPPORTED`, note: 'Explicit module/configuration on a rack or multifunction station.' })],
      });
      continue;
    }
    matches.push({
      capabilityCode: rule.capabilityCode,
      relationType: rule.relationType,
      confidence: rule.confidence,
      ruleId: rule.id,
      evidence: [evidenceFromHit({ kind: 'NAME', sourceId: 'NAME', matchedText: match[0], ruleId: rule.id })],
    });
  }
  return matches;
}

function specialNameMatches(input: TrainingSemanticClassificationInput, normalizedName: string): readonly TrainingSemanticRuleMatch[] {
  const matches: TrainingSemanticRuleMatch[] = [];
  if (/\b(?:mariposa|fly)\b/.test(normalizedName) && (normalizedName.includes('pectoral') || normalizedName.includes('pecho') || input.categories.some((category) => /contractora|pectoral|pecho/.test(normalizeTrainingText(category.name))))) {
    matches.push({
      capabilityCode: 'PEC_DECK',
      relationType: 'DIRECT',
      confidence: 'EXPLICIT',
      ruleId: 'NAME_PEC_DECK_MARIPOSA_CONTEXT_V1',
      evidence: [evidenceFromHit({ kind: 'NAME', sourceId: 'NAME', matchedText: 'mariposa/fly', ruleId: 'NAME_PEC_DECK_MARIPOSA_CONTEXT_V1', note: 'Dataset-backed synonym accepted only with pectoral context.' })],
    });
  }
  if (/\b(?:remo|rowing)\b/.test(normalizedName) && !/\b(?:sentado|bajo|t row|t rowing|contrapeso|polea)\b/.test(normalizedName) && !isCardioRow(input, normalizedName)) {
    matches.push({
      capabilityCode: 'ROW',
      relationType: 'DIRECT',
      confidence: 'MEDIUM',
      ruleId: 'NAME_ROW_GENERIC_REVIEW_V1',
      evidence: [evidenceFromHit({ kind: 'NAME', sourceId: 'NAME', matchedText: 'remo/rowing', ruleId: 'NAME_ROW_GENERIC_REVIEW_V1', note: 'Generic row wording needs strength-vs-cardio adjudication.' })],
    });
  }
  return matches;
}

export function evaluateTrainingSemanticRules(input: TrainingSemanticClassificationInput): {
  readonly matches: readonly TrainingSemanticRuleMatch[];
  readonly reviewCandidates: readonly TrainingSemanticRuleMatch[];
  readonly deferredFindings: readonly { readonly candidateCode: string; readonly matchedText: string; readonly reason: string }[];
} {
  const normalizedName = normalizeTrainingText(input.name);
  const categories = sortedCategories(input);
  const nameResults = nameMatches(input, normalizedName);
  const featureResults = explicitFeatureMatches(input, normalizedName);
  const categoryResults = trustedCategoryMatches(input, normalizedName);
  const specialResults = specialNameMatches(input, normalizedName);
  const all = [...nameResults, ...featureResults, ...categoryResults, ...specialResults];
  const byCapability = new Map<TrainingCapabilityCode, TrainingSemanticRuleMatch[]>();
  for (const match of all) {
    const list = byCapability.get(match.capabilityCode) ?? [];
    list.push(match);
    byCapability.set(match.capabilityCode, list);
  }
  const merged: TrainingSemanticRuleMatch[] = [];
  const reviewCandidates: TrainingSemanticRuleMatch[] = [];
  for (const [capabilityCode, matches] of byCapability) {
    const ordered = [...matches].sort((a, b) => {
      const confidenceRank = { EXPLICIT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
      return confidenceRank[a.confidence] - confidenceRank[b.confidence] || a.relationType.localeCompare(b.relationType) || a.ruleId.localeCompare(b.ruleId);
    });
    const best = ordered[0]!;
    const evidence = ordered.flatMap((match) => match.evidence).sort((a, b) => `${a.kind}\u0000${a.sourceId ?? ''}\u0000${a.ruleId}`.localeCompare(`${b.kind}\u0000${b.sourceId ?? ''}\u0000${b.ruleId}`));
    const relationType: TrainingRelationType = ordered.some((match) => match.relationType === 'DIRECT') ? 'DIRECT' : 'SUPPORTED';
    const mergedMatch = { ...best, relationType, evidence };
    if (best.confidence === 'MEDIUM' || best.confidence === 'LOW') reviewCandidates.push(mergedMatch);
    else merged.push(mergedMatch);
  }

  const deferredFindings = deferredRules.flatMap((rule) => {
    const match = rule.pattern.exec(normalizedName);
    return match ? [{ candidateCode: rule.code, matchedText: match[0], reason: rule.reason }] : [];
  });

  // Generic family/category context is intentionally a guard only. It never creates a match.
  if (input.productFamily && !machineFamilies.includes(input.productFamily as typeof machineFamilies[number]) && !nonApplicableFamilies.includes(input.productFamily as typeof nonApplicableFamilies[number])) {
    // Deliberately no positive inference from product family.
  }
  return { matches: merged.sort((a, b) => a.capabilityCode.localeCompare(b.capabilityCode)), reviewCandidates: reviewCandidates.sort((a, b) => a.capabilityCode.localeCompare(b.capabilityCode)), deferredFindings };
}

export const trainingSemanticRuleCatalog = Object.freeze({
  directNameRules: directNameRules.map(({ id, capabilityCode, relationType, confidence, pattern }) => ({ id, capabilityCode, relationType, confidence, pattern: pattern.source })),
  specialRules: [
    { id: 'NAME_PEC_DECK_MARIPOSA_CONTEXT_V1', pattern: 'mariposa|fly + pectoral context' },
    { id: 'NAME_ROW_GENERIC_REVIEW_V1', pattern: 'generic remo/rowing' },
  ],
  deferredRules: deferredRules.map(({ code, pattern, reason }) => ({ code, pattern: pattern.source, reason })),
  policy: {
    accessoryPositiveAssignments: false,
    accessoryCategoryEvidence: false,
    accessoryFeatureEvidence: false,
    productFamilyPositiveInference: false,
    descriptionEvidence: false,
  },
  rejectedBoundaryPatterns: trainingSemanticRejectedBoundaryPatterns,
  accessoryTokens,
  nonApplicableFamilies,
  machineFamilies,
});

export function computeTrainingSemanticClassifierRulesHash(): string {
  return createHash('sha256').update(JSON.stringify(trainingSemanticRuleCatalog)).digest('hex');
}
