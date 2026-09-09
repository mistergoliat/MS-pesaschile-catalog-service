import type { TrainingSemanticEvidence } from '../training-semantics/contracts.js';
import type { ProductTrainingExerciseCapabilityAssignment, ProductTrainingFunctionAssignment, TrainingFunctionEvidence } from '../training-semantics-v2/contracts.js';
import { classifyTrainingSemanticProductV2 } from '../training-semantic-classification-v2/index.js';
import { deterministicTrainingClassificationV2GeneratedAt } from '../training-semantic-classification-v2/contracts.js';
import { trainingSemanticClassifierV21Version, type TrainingSemanticClassificationV21Input, type TrainingSemanticClassificationV21Options, type TrainingSemanticClassificationV21Result } from './contracts.js';
import { computeTrainingSemanticClassifierV21RulesHash, evaluateTrainingSemanticV21Enrichments } from './rules.js';
import { validateTrainingSemanticClassificationV21Result } from './validation.js';

const rulesHash = computeTrainingSemanticClassifierV21RulesHash();

function exerciseAssignment(input: TrainingSemanticClassificationV21Input, code: ProductTrainingExerciseCapabilityAssignment['capabilityCode'], evidence: readonly TrainingSemanticEvidence[], generatedAt: string, sourceCatalogExport?: string): ProductTrainingExerciseCapabilityAssignment {
  return {
    productId: input.productId,
    capabilityCode: code,
    relationType: 'DIRECT',
    classificationConfidence: 'EXPLICIT',
    evidence,
    reviewState: 'AUTO',
    provenance: { classifierVersion: trainingSemanticClassifierV21Version, generatedAt, ...(sourceCatalogExport ? { sourceCatalogExport } : {}) },
  };
}

function functionAssignment(input: TrainingSemanticClassificationV21Input, evidence: readonly TrainingFunctionEvidence[], generatedAt: string, sourceCatalogExport?: string): ProductTrainingFunctionAssignment {
  return {
    productId: input.productId,
    functionCode: 'MULTI_DIRECTIONAL_RESISTANCE',
    relationType: 'DIRECT',
    classificationConfidence: 'HIGH',
    evidence,
    reviewState: 'AUTO',
    provenance: { classifierVersion: trainingSemanticClassifierV21Version, generatedAt, ...(sourceCatalogExport ? { sourceCatalogExport } : {}) },
  };
}

function dedupeExercises(assignments: readonly ProductTrainingExerciseCapabilityAssignment[]): readonly ProductTrainingExerciseCapabilityAssignment[] {
  const byCode = new Map<string, ProductTrainingExerciseCapabilityAssignment>();
  for (const assignment of assignments) if (!byCode.has(assignment.capabilityCode)) byCode.set(assignment.capabilityCode, assignment);
  return [...byCode.values()].sort((left, right) => left.capabilityCode.localeCompare(right.capabilityCode));
}

function dedupeFunctions(assignments: readonly ProductTrainingFunctionAssignment[]): readonly ProductTrainingFunctionAssignment[] {
  const byCode = new Map<string, ProductTrainingFunctionAssignment>();
  for (const assignment of assignments) if (!byCode.has(assignment.functionCode)) byCode.set(assignment.functionCode, assignment);
  return [...byCode.values()].sort((left, right) => left.functionCode.localeCompare(right.functionCode));
}

export function classifyTrainingSemanticProductV21(input: TrainingSemanticClassificationV21Input, options: TrainingSemanticClassificationV21Options = {}): TrainingSemanticClassificationV21Result {
  const base = classifyTrainingSemanticProductV2(input, options);
  const generatedAt = options.generatedAt ?? deterministicTrainingClassificationV2GeneratedAt;
  const enrichments = evaluateTrainingSemanticV21Enrichments(input);
  const exerciseAdditions = enrichments.flatMap((match) => (match.exerciseCodes ?? []).map((code) => exerciseAssignment(input, code, match.evidence, generatedAt, options.sourceCatalogExport)));
  const functionAdditions = enrichments.filter((match) => match.functionCode === 'MULTI_DIRECTIONAL_RESISTANCE').map((match) => functionAssignment(input, match.evidence, generatedAt, options.sourceCatalogExport));
  const result: TrainingSemanticClassificationV21Result = {
    ...base,
    classifierVersion: trainingSemanticClassifierV21Version,
    rulesHash,
    exerciseCapabilities: dedupeExercises([...base.exerciseCapabilities, ...exerciseAdditions]),
    trainingFunctions: dedupeFunctions([...base.trainingFunctions, ...functionAdditions]),
  };
  validateTrainingSemanticClassificationV21Result(result);
  return result;
}

export function classifyTrainingSemanticProductsV21(inputs: readonly TrainingSemanticClassificationV21Input[], options: TrainingSemanticClassificationV21Options = {}): readonly TrainingSemanticClassificationV21Result[] {
  return inputs.map((input) => classifyTrainingSemanticProductV21(input, options));
}

export const classifyTrainingSemanticV21 = classifyTrainingSemanticProductV21;
