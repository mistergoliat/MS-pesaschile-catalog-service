import { createHash } from 'node:crypto';
import { normalizeTrainingText } from '../training-semantic-classification/normalize.js';
import { trainingSemanticClassifierV2RulesHash } from '../training-semantic-classification-v2/index.js';
import type { TrainingSemanticClassificationV21Input } from './contracts.js';

export const trainingSemanticV21EnrichmentCatalog = Object.freeze({
  baseRulesHash: trainingSemanticClassifierV2RulesHash,
  enrichments: [
    {
      enrichmentId: 'V21_POLEA_CRUZADA_CABLE_GEOMETRY',
      target: 'MULTI_DIRECTIONAL_RESISTANCE',
      evidencePolicy: 'canonical NAME polea cruzada + CABLE_MACHINE + SEMANTIC_STRONG Máquinas con Poleas',
      sourceFields: ['name', 'productFamily', 'trustedCategory'],
      rationale: 'Polea Cruzada is the catalog canonical name for crossover geometry; the strong cable-machine category confirms equipment type.',
    },
    {
      enrichmentId: 'V21_DUAL_POLEA_ADJUSTABLE_GEOMETRY',
      target: 'MULTI_DIRECTIONAL_RESISTANCE',
      evidencePolicy: 'canonical NAME polea dual multifuncional + CABLE_MACHINE + SEMANTIC_STRONG Máquinas con Poleas + semantic feature 2:1 and 1:1',
      sourceFields: ['name', 'productFamily', 'trustedCategory', 'structuredFeature'],
      rationale: 'The dual pulley name and structured cable-ratio feature establish two independently usable cable paths without relying on marketing description.',
    },
    {
      enrichmentId: 'V21_DUAL_QUADRICEPS_FEMORAL_MODULES',
      target: 'LEG_EXTENSION|LEG_CURL',
      evidencePolicy: 'canonical NAME dual cuadriceps/femoral + SELECTORIZED_MACHINE + SEMANTIC_STRONG Máquinas Selectorizadas',
      sourceFields: ['name', 'productFamily', 'trustedCategory'],
      rationale: 'The canonical dual machine name identifies both leg-extension and leg-curl modules; each capability is emitted independently.',
    },
    {
      enrichmentId: 'V21_DUAL_PRESS_MODULES',
      target: 'CHEST_PRESS|SHOULDER_PRESS',
      evidencePolicy: 'canonical NAME dual press pectoral/hombros + SELECTORIZED_MACHINE + SEMANTIC_STRONG Máquinas Selectorizadas',
      sourceFields: ['name', 'productFamily', 'trustedCategory'],
      rationale: 'The canonical dual machine name identifies explicit pectoral and shoulder press modules; generic press names remain excluded.',
    },
  ],
  policy: {
    descriptionsArePositiveEvidence: false,
    weakEvidenceIsReviewOnly: true,
    productIdSpecificRules: false,
  },
});

export function computeTrainingSemanticClassifierV21RulesHash(): string {
  return createHash('sha256').update(JSON.stringify(trainingSemanticV21EnrichmentCatalog)).digest('hex');
}

export const trainingSemanticClassifierV21RulesHash = computeTrainingSemanticClassifierV21RulesHash();

function trustedCategory(input: TrainingSemanticClassificationV21Input, pattern: RegExp): { readonly name: string; readonly categoryId: string } | undefined {
  return input.categories
    .filter((category) => category.trustClass === 'SEMANTIC_STRONG')
    .map((category) => ({ name: normalizeTrainingText(category.name), categoryId: category.categoryId }))
    .sort((left, right) => `${left.name}\u0000${left.categoryId}`.localeCompare(`${right.name}\u0000${right.categoryId}`))
    .find((category) => pattern.test(category.name));
}

function semanticFeatures(input: TrainingSemanticClassificationV21Input): readonly { readonly featureId: string; readonly text: string; readonly label: string }[] {
  return input.features
    .filter((feature) => feature.trustClass === 'SEMANTIC')
    .map((feature) => ({ featureId: feature.featureId, text: normalizeTrainingText(`${feature.featureName} ${feature.value}`), label: `${feature.featureName}: ${feature.value}` }))
    .sort((left, right) => `${left.text}\u0000${left.featureId}`.localeCompare(`${right.text}\u0000${right.featureId}`));
}

export type TrainingSemanticV21EnrichmentMatch = {
  readonly functionCode?: 'MULTI_DIRECTIONAL_RESISTANCE';
  readonly exerciseCodes?: readonly ('LEG_EXTENSION' | 'LEG_CURL' | 'CHEST_PRESS' | 'SHOULDER_PRESS')[];
  readonly enrichmentId: string;
  readonly evidence: readonly { readonly kind: 'NAME' | 'TRUSTED_CATEGORY' | 'STRUCTURED_FEATURE'; readonly sourceId: string; readonly matchedText: string; readonly ruleId: string; readonly note?: string }[];
};

export function evaluateTrainingSemanticV21Enrichments(input: TrainingSemanticClassificationV21Input): readonly TrainingSemanticV21EnrichmentMatch[] {
  const normalizedName = normalizeTrainingText(input.name);
  const matches: TrainingSemanticV21EnrichmentMatch[] = [];
  const cableCategory = trustedCategory(input, /\bmaquinas\s+con\s+poleas\b/u);
  const selectorizadaCategory = trustedCategory(input, /\bmaquinas\s+selectorizadas\b/u);
  if (input.productFamily === 'CABLE_MACHINE' && cableCategory && /\bpolea\s+cruzada\b/u.test(normalizedName)) {
    matches.push({
      functionCode: 'MULTI_DIRECTIONAL_RESISTANCE',
      enrichmentId: 'V21_POLEA_CRUZADA_CABLE_GEOMETRY',
      evidence: [
        { kind: 'NAME', sourceId: 'NAME', matchedText: 'polea cruzada', ruleId: 'V21_POLEA_CRUZADA_CABLE_GEOMETRY' },
        { kind: 'TRUSTED_CATEGORY', sourceId: cableCategory.categoryId, matchedText: cableCategory.name, ruleId: 'V21_POLEA_CRUZADA_CABLE_GEOMETRY', note: 'SEMANTIC_STRONG' },
      ],
    });
  }
  const dualFeature = semanticFeatures(input).find((feature) => /\brelacion\s+de\s+cable\s+y\s+polea\b/u.test(feature.text) && /\b2\s+1\b/u.test(feature.text) && /\b1\s+1\b/u.test(feature.text));
  if (input.productFamily === 'CABLE_MACHINE' && cableCategory && /\bpolea\s+dual\s+multifuncional\b/u.test(normalizedName) && dualFeature) {
    matches.push({
      functionCode: 'MULTI_DIRECTIONAL_RESISTANCE',
      enrichmentId: 'V21_DUAL_POLEA_ADJUSTABLE_GEOMETRY',
      evidence: [
        { kind: 'NAME', sourceId: 'NAME', matchedText: 'polea dual multifuncional', ruleId: 'V21_DUAL_POLEA_ADJUSTABLE_GEOMETRY' },
        { kind: 'TRUSTED_CATEGORY', sourceId: cableCategory.categoryId, matchedText: cableCategory.name, ruleId: 'V21_DUAL_POLEA_ADJUSTABLE_GEOMETRY', note: 'SEMANTIC_STRONG' },
        { kind: 'STRUCTURED_FEATURE', sourceId: dualFeature.featureId, matchedText: dualFeature.label, ruleId: 'V21_DUAL_POLEA_ADJUSTABLE_GEOMETRY' },
      ],
    });
  }
  const dualLegs = /\bdual\s+cuadriceps\s+femoral\s+(sentado|acostado)\b/u.exec(normalizedName);
  if (input.productFamily === 'SELECTORIZED_MACHINE' && selectorizadaCategory && dualLegs) {
    matches.push({
      exerciseCodes: ['LEG_EXTENSION', 'LEG_CURL'],
      enrichmentId: 'V21_DUAL_QUADRICEPS_FEMORAL_MODULES',
      evidence: [
        { kind: 'NAME', sourceId: 'NAME', matchedText: dualLegs[0], ruleId: 'V21_DUAL_QUADRICEPS_FEMORAL_MODULES' },
        { kind: 'TRUSTED_CATEGORY', sourceId: selectorizadaCategory.categoryId, matchedText: selectorizadaCategory.name, ruleId: 'V21_DUAL_QUADRICEPS_FEMORAL_MODULES', note: 'SEMANTIC_STRONG' },
      ],
    });
  }
  const dualPress = /\bdual\s+press\s+pectoral\s+hombros\b/u.exec(normalizedName);
  if (input.productFamily === 'SELECTORIZED_MACHINE' && selectorizadaCategory && dualPress) {
    matches.push({
      exerciseCodes: ['CHEST_PRESS', 'SHOULDER_PRESS'],
      enrichmentId: 'V21_DUAL_PRESS_MODULES',
      evidence: [
        { kind: 'NAME', sourceId: 'NAME', matchedText: dualPress[0], ruleId: 'V21_DUAL_PRESS_MODULES' },
        { kind: 'TRUSTED_CATEGORY', sourceId: selectorizadaCategory.categoryId, matchedText: selectorizadaCategory.name, ruleId: 'V21_DUAL_PRESS_MODULES', note: 'SEMANTIC_STRONG' },
      ],
    });
  }
  return matches;
}
