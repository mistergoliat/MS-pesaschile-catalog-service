import { createHash } from 'node:crypto';
import { computeTrainingSemanticClassifierRulesHash } from '../training-semantic-classification/rules.js';
import { normalizeTrainingText } from '../training-semantic-classification/normalize.js';
import type {
  TrainingClassificationConfidence,
  TrainingSemanticEvidence,
} from '../training-semantics/contracts.js';
import {
  getTrainingSemanticRegistryV2,
  type ExerciseCapabilityCodeV2,
  type TrainingFunctionCode,
  type TrainingFunctionEvidence,
  type TrainingFunctionRelationType,
} from '../training-semantics-v2/index.js';
import type { TrainingSemanticClassificationV2Input } from './contracts.js';

type ExerciseRule = {
  readonly code: ExerciseCapabilityCodeV2;
  readonly namePattern: RegExp;
  readonly categoryPattern?: RegExp;
  readonly featurePattern?: RegExp;
  readonly rejectPattern?: RegExp;
  readonly requiresDedicatedMachine: boolean;
  readonly requiresCategoryEvidence?: boolean;
  readonly ruleId: string;
};

type FunctionRule = {
  readonly code: TrainingFunctionCode;
  readonly namePattern: RegExp;
  readonly categoryPattern?: RegExp;
  readonly featurePattern?: RegExp;
  readonly rejectPattern?: RegExp;
  readonly ruleId: string;
};

export type TrainingSemanticV2ExerciseRuleMatch = {
  readonly code: ExerciseCapabilityCodeV2;
  readonly relationType: 'DIRECT';
  readonly confidence: TrainingClassificationConfidence;
  readonly evidence: readonly TrainingSemanticEvidence[];
  readonly ruleId: string;
};

export type TrainingSemanticV2FunctionRuleMatch = {
  readonly code: TrainingFunctionCode;
  readonly relationType: TrainingFunctionRelationType;
  readonly confidence: TrainingClassificationConfidence;
  readonly evidence: readonly TrainingFunctionEvidence[];
  readonly ruleId: string;
  readonly productFamily?: string;
};

const exerciseRules: readonly ExerciseRule[] = [
  { code: 'PULL_UP', namePattern: /\b(?:push\s*ups?|pull\s*ups?|dominadas?)\b/u, categoryPattern: /\b(?:pull\s*up|push\s*up|dominadas?)\b/u, requiresDedicatedMachine: false, requiresCategoryEvidence: true, ruleId: 'CATEGORY_PULL_UP_PUSH_UP_BARS_CLOSURE_V2' },
  { code: 'PEC_DECK', namePattern: /\b(?:pec\s+fly|pec\s+deck|multi\s+fly)\b/u, rejectPattern: /\b(?:attachment|accesor|cable\s+station|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_PEC_FLY_CLOSURE_V2' },
  { code: 'LEG_CURL', namePattern: /\b(?:curl\s+de\s+femoral|femoral\s+acostado)\b/u, rejectPattern: /\b(?:attachment|accesor|pad|banco|bench|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_LEG_CURL_DE_FEMORAL_CLOSURE_V2' },
  { code: 'ROW', namePattern: /\bt[- ]bar\s+row\b/u, rejectPattern: /\b(?:cardio|rower|erg[oó]metro|remo\s+indoor)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_T_BAR_ROW_CLOSURE_V2' },
  { code: 'HIP_THRUST', namePattern: /\b(?:hip\s+thruster|3d\s+hip\s+thruster)\b/u, rejectPattern: /\b(?:caj[oó]n|caja|box|pad|almohadilla|cintur[oó]n|barra|attachment|accesor)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_HIP_THRUSTER_CLOSURE_V2' },
  { code: 'HACK_SQUAT', namePattern: /\b(?:hack\s+squat|prensa\s+hack|v[- ]?squat|squat\s+machine)\b/u, rejectPattern: /\b(?:rack|smith|bench|accessor|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_HACK_SQUAT_DEDICATED_V2' },
  { code: 'LEG_PRESS', namePattern: /\b(?:leg\s+press|dual\s+prensa\s+hack|prensa\s+(?:de\s+piernas?|horizontal|inclinada|vertical|pivote))\b/u, rejectPattern: /\b(?:pendul|attachment|accesor|rack|smith|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_LEG_PRESS_DEDICATED_V2' },
  { code: 'CALF_RAISE', namePattern: /\b(?:calf\s+raise|elevaci[oó]n\s+de\s+talones|gemelos?|pantorrilla)\b/u, rejectPattern: /\b(?:attachment|accesor|pad|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_CALF_RAISE_DEDICATED_V2' },
  { code: 'REAR_DELT_FLY', namePattern: /\b(?:rear\s+delt|reverse\s+fly|pec\s+fly\s+rear\s+delt|multi\s+fly)\b/u, rejectPattern: /\b(?:attachment|accesor|cable\s+station|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_REAR_DELT_FLY_EXPLICIT_V2' },
  { code: 'BICEPS_CURL', namePattern: /\b(?:biceps?\s+curl|curl\s+de\s+b[ií]ceps?|dual\s+b[ií]ceps?)\b/u, rejectPattern: /\b(?:dumbbell|mancuerna|barbell|barra|bench|banco|attachment|accesor|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_BICEPS_CURL_EXPLICIT_V2' },
  { code: 'TRICEPS_EXTENSION', namePattern: /\b(?:triceps?\s+extension|extensi[oó]n\s+de\s+tr[ií]ceps?|dual\s+b[ií]ceps?\s+tr[ií]ceps?)\b/u, rejectPattern: /\b(?:press|cable\s+handle|rope|cuerda|attachment|accesor|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_TRICEPS_EXTENSION_EXPLICIT_V2' },
  { code: 'PENDULUM_SQUAT', namePattern: /\b(?:pendulum\s+squat|squat\s+pendulum|prensa\s+p[eé]ndulo)\b/u, rejectPattern: /\b(?:leg\s+press|prensa\s+de\s+piernas?|hack|rack|smith|attachment|accesor|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_PENDULUM_SQUAT_DEDICATED_V2' },
  { code: 'BELT_SQUAT', namePattern: /\bbelt\s+squat\b/u, rejectPattern: /\b(?:dip\s+belt|belt\s+accessor|cintur[oó]n\s+de\s+(?:dip|lastre)|attachment|accesor|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_BELT_SQUAT_DEDICATED_V2' },
  { code: 'REVERSE_HYPER', namePattern: /\breverse\s+hyper\b/u, rejectPattern: /\b(?:lower\s+back|lumbar|bench|banco|attachment|accesor|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_REVERSE_HYPER_DEDICATED_V2' },
  { code: 'DEADLIFT', namePattern: /\b(?:dead\s*lift|peso\s+muerto)\b/u, rejectPattern: /\b(?:jack|deadlift\s+jack|barbell|barra|strap|correa|platform|plataforma|attachment|accesor|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_DEADLIFT_DEDICATED_V2' },
  { code: 'PULLOVER', namePattern: /\b(?:pull\s*over|pullover)\b/u, rejectPattern: /\b(?:lat\s+pulldown|cable|polea|dumbbell|mancuerna|bench|banco|attachment|accesor|pack|set|kit)\b/u, requiresDedicatedMachine: true, ruleId: 'NAME_PULLOVER_DEDICATED_V2' },
];

const functionRules: readonly FunctionRule[] = [
  { code: 'MULTI_DIRECTIONAL_RESISTANCE', namePattern: /\b(?:crossover|dual\s+adjustable\s+pulley|multi[- ]?directional)\b/u, categoryPattern: /\b(?:crossover|dual\s+adjustable\s+pulley)\b/u, featurePattern: /\b(?:crossover|dual\s+adjustable\s+pulley|multi[- ]?directional)\b/u, ruleId: 'NAME_MULTI_DIRECTIONAL_RESISTANCE_EXPLICIT_V2' },
  { code: 'BODYWEIGHT_SUPPORT', namePattern: /\b(?:rampa|obstacle|obst[aá]culo|bodyweight\s+station|gymnastics\s+support)\b/u, categoryPattern: /\b(?:barras\s+(?:paralelas|push\s*up))\b/u, ruleId: 'NAME_BODYWEIGHT_SUPPORT_EXPLICIT_V2' },
  { code: 'BARBELL_SUPPORT', namePattern: /\b(?:rack|jaula|cage|atril|barbell\s+(?:stand|support)|squat\s+stand)\b/u, categoryPattern: /\b(?:rack|atril)\b/u, rejectPattern: /\b(?:smith|multipower|guided|guiad[oa])\b/u, ruleId: 'NAME_BARBELL_SUPPORT_EXPLICIT_V2' },
  { code: 'GUIDED_BARBELL_SUPPORT', namePattern: /\b(?:smith|multipower|guided\s+barbell|barra\s+guiada|guiad[oa])\b/u, categoryPattern: /\b(?:smith|multipower)\b/u, ruleId: 'NAME_GUIDED_BARBELL_SUPPORT_EXPLICIT_V2' },
  { code: 'CABLE_RESISTANCE', namePattern: /\b(?:cable\s+machine|cable\s+station|polea|m[aá]quina\s+con\s+poleas?)\b/u, categoryPattern: /\b(?:poleas?|cable)\b/u, featurePattern: /\b(?:relaci[oó]n\s+de\s+cable|cable)\b/u, rejectPattern: /\b(?:attachment|accesor|agarre|grip|handle)\b/u, ruleId: 'NAME_CABLE_RESISTANCE_EXPLICIT_V2' },
];

const machineFamilies = new Set(['CABLE_MACHINE', 'SELECTORIZED_MACHINE', 'PLATE_LOADED_MACHINE', 'RACK_CAGE']);
const nonMachineFamilies = new Set(['BARBELL', 'DUMBBELL', 'BENCH', 'MACHINE_ATTACHMENT', 'BAND', 'FLOORING', 'STORAGE', 'PROTECTIVE_GEAR']);

function trustedCategories(input: TrainingSemanticClassificationV2Input): readonly { readonly text: string; readonly strong: boolean }[] {
  return [...input.categories]
    .filter((category) => category.trustClass === 'SEMANTIC_STRONG' || category.trustClass === 'SEMANTIC_WEAK')
    .sort((left, right) => `${left.name}\u0000${left.categoryId}`.localeCompare(`${right.name}\u0000${right.categoryId}`))
    .map((category) => ({ text: normalizeTrainingText(category.name), strong: category.trustClass === 'SEMANTIC_STRONG' }));
}

function trustedFeatures(input: TrainingSemanticClassificationV2Input): readonly { readonly text: string; readonly featureId: string; readonly label: string }[] {
  return [...input.features]
    .filter((feature) => feature.trustClass === 'SEMANTIC')
    .sort((left, right) => `${left.featureName}\u0000${left.featureId}\u0000${left.value}`.localeCompare(`${right.featureName}\u0000${right.featureId}\u0000${right.value}`))
    .map((feature) => ({ text: normalizeTrainingText(`${feature.featureName} ${feature.value}`), featureId: feature.featureId, label: `${feature.featureName}: ${feature.value}` }));
}

function evidenceForExercise(rule: ExerciseRule, input: TrainingSemanticClassificationV2Input, normalizedName: string): readonly TrainingSemanticV2ExerciseRuleMatch[] {
  if (rule.rejectPattern?.test(normalizedName)) return [];
  const family = input.productFamily ?? '';
  if (nonMachineFamilies.has(family) || family === 'MACHINE_ATTACHMENT') return [];
  const categoryEvidence = trustedCategories(input).filter((category) => rule.categoryPattern?.test(category.text));
  const featureEvidence = trustedFeatures(input).filter((feature) => rule.featurePattern?.test(feature.text));
  const nameMatch = rule.namePattern.exec(normalizedName);
  if (rule.requiresCategoryEvidence && categoryEvidence.length === 0) return [];
  const machineName = /\b(?:machine|m[aá]quina|station|estaci[oó]n|series|beast|mo\s*2\.0|v8|zr|peach\s+builder)\b/u.test(normalizedName);
  if (rule.requiresDedicatedMachine && !machineName && !machineFamilies.has(family) && !nameMatch) return [];
  const matches: TrainingSemanticV2ExerciseRuleMatch[] = [];
  if (nameMatch) matches.push({ code: rule.code, relationType: 'DIRECT', confidence: 'EXPLICIT', ruleId: rule.ruleId, evidence: [{ kind: 'NAME', sourceId: 'NAME', matchedText: nameMatch[0], ruleId: rule.ruleId }] });
  for (const category of categoryEvidence) matches.push({ code: rule.code, relationType: 'DIRECT', confidence: category.strong ? 'HIGH' : 'MEDIUM', ruleId: `CATEGORY_${rule.ruleId}`, evidence: [{ kind: 'TRUSTED_CATEGORY', sourceId: 'CATEGORY', matchedText: category.text, ruleId: `CATEGORY_${rule.ruleId}`, note: category.strong ? 'SEMANTIC_STRONG' : 'SEMANTIC_WEAK' }] });
  for (const feature of featureEvidence) matches.push({ code: rule.code, relationType: 'DIRECT', confidence: 'HIGH', ruleId: `FEATURE_${rule.ruleId}`, evidence: [{ kind: 'STRUCTURED_FEATURE', sourceId: feature.featureId, matchedText: feature.label, ruleId: `FEATURE_${rule.ruleId}` }] });
  return matches;
}

function evidenceForFunction(rule: FunctionRule, input: TrainingSemanticClassificationV2Input, normalizedName: string): readonly TrainingSemanticV2FunctionRuleMatch[] {
  if (rule.rejectPattern?.test(normalizedName)) return [];
  const categoryEvidence = trustedCategories(input).filter((category) => rule.categoryPattern?.test(category.text));
  const featureEvidence = trustedFeatures(input).filter((feature) => rule.featurePattern?.test(feature.text));
  const nameMatch = rule.namePattern.exec(normalizedName);
  const matches: TrainingSemanticV2FunctionRuleMatch[] = [];
  if (nameMatch) matches.push({ code: rule.code, relationType: 'DIRECT', confidence: 'EXPLICIT', ruleId: rule.ruleId, evidence: [{ kind: 'NAME', sourceId: 'NAME', matchedText: nameMatch[0], ruleId: rule.ruleId }] });
  for (const category of categoryEvidence) matches.push({ code: rule.code, relationType: 'DIRECT', confidence: category.strong ? 'HIGH' : 'MEDIUM', ruleId: `CATEGORY_${rule.ruleId}`, evidence: [{ kind: 'TRUSTED_CATEGORY', sourceId: 'CATEGORY', matchedText: category.text, ruleId: `CATEGORY_${rule.ruleId}`, note: category.strong ? 'SEMANTIC_STRONG' : 'SEMANTIC_WEAK' }] });
  for (const feature of featureEvidence) matches.push({ code: rule.code, relationType: 'DIRECT', confidence: 'HIGH', ruleId: `FEATURE_${rule.ruleId}`, evidence: [{ kind: 'STRUCTURED_FEATURE', sourceId: feature.featureId, matchedText: feature.label, ruleId: `FEATURE_${rule.ruleId}` }] });
  return matches;
}

export function evaluateTrainingSemanticV2Rules(input: TrainingSemanticClassificationV2Input): {
  readonly exerciseMatches: readonly TrainingSemanticV2ExerciseRuleMatch[];
  readonly exerciseReviewCandidates: readonly TrainingSemanticV2ExerciseRuleMatch[];
  readonly functionMatches: readonly TrainingSemanticV2FunctionRuleMatch[];
  readonly functionReviewCandidates: readonly TrainingSemanticV2FunctionRuleMatch[];
} {
  const normalizedName = normalizeTrainingText(input.name);
  const exercise = exerciseRules.flatMap((rule) => evidenceForExercise(rule, input, normalizedName));
  const functions = functionRules.flatMap((rule) => evidenceForFunction(rule, input, normalizedName));
  if (input.productFamily === 'CABLE_MACHINE') {
    functions.push({
      code: 'CABLE_RESISTANCE',
      relationType: 'FAMILY_DERIVED',
      confidence: 'HIGH',
      ruleId: 'FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2',
      productFamily: input.productFamily,
      evidence: [{ kind: 'FAMILY_DERIVATION', sourceId: 'CABLE_MACHINE', matchedText: 'CABLE_MACHINE', ruleId: 'FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2', note: 'Explicitly approved by registry V2.' }],
    });
  }
  const bestByExercise = new Map<ExerciseCapabilityCodeV2, TrainingSemanticV2ExerciseRuleMatch[]>();
  for (const match of exercise) bestByExercise.set(match.code, [...(bestByExercise.get(match.code) ?? []), match]);
  const bestByFunction = new Map<TrainingFunctionCode, TrainingSemanticV2FunctionRuleMatch[]>();
  for (const match of functions) bestByFunction.set(match.code, [...(bestByFunction.get(match.code) ?? []), match]);
  const rank = { EXPLICIT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  const merge = <T extends { readonly confidence: TrainingClassificationConfidence; readonly ruleId: string; readonly evidence: readonly unknown[] }>(matches: readonly T[]): T => {
    const ordered = [...matches].sort((left, right) => rank[left.confidence] - rank[right.confidence] || left.ruleId.localeCompare(right.ruleId));
    return { ...ordered[0]!, evidence: ordered.flatMap((match) => match.evidence).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) } as T;
  };
  const mergedExercises = [...bestByExercise.values()].map(merge);
  const mergedFunctions = [...bestByFunction.values()].map(merge);
  return {
    exerciseMatches: mergedExercises.filter((match) => match.confidence === 'EXPLICIT' || match.confidence === 'HIGH').sort((left, right) => left.code.localeCompare(right.code)),
    exerciseReviewCandidates: mergedExercises.filter((match) => match.confidence === 'MEDIUM' || match.confidence === 'LOW').sort((left, right) => left.code.localeCompare(right.code)),
    functionMatches: mergedFunctions.filter((match) => match.confidence === 'EXPLICIT' || match.confidence === 'HIGH').sort((left, right) => left.code.localeCompare(right.code)),
    functionReviewCandidates: mergedFunctions.filter((match) => match.confidence === 'MEDIUM' || match.confidence === 'LOW').sort((left, right) => left.code.localeCompare(right.code)),
  };
}

export const trainingSemanticV2RuleCatalog = Object.freeze({
  v1RulesHash: computeTrainingSemanticClassifierRulesHash(),
  exerciseRules: exerciseRules.map(({ code, namePattern, categoryPattern, featurePattern, rejectPattern, requiresDedicatedMachine, requiresCategoryEvidence, ruleId }) => ({ code, namePattern: namePattern.source, categoryPattern: categoryPattern?.source, featurePattern: featurePattern?.source, rejectPattern: rejectPattern?.source, requiresDedicatedMachine, requiresCategoryEvidence, ruleId })),
  functionRules: functionRules.map(({ code, namePattern, categoryPattern, featurePattern, rejectPattern, ruleId }) => ({ code, namePattern: namePattern.source, categoryPattern: categoryPattern?.source, featurePattern: featurePattern?.source, rejectPattern: rejectPattern?.source, ruleId })),
  familyTrainingFunctionDerivations: getTrainingSemanticRegistryV2().familyTrainingFunctionDerivations,
  semanticBoundaries: getTrainingSemanticRegistryV2().semanticBoundaries,
  policy: { positiveNameAndDescription: 'NAME_ONLY_NO_DESCRIPTION', weakEvidence: 'REVIEW_ONLY', productFamilyExerciseInference: false },
});

export function computeTrainingSemanticClassifierV2RulesHash(): string {
  return createHash('sha256').update(JSON.stringify(trainingSemanticV2RuleCatalog)).digest('hex');
}
