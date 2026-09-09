import {
  computeTrainingSemanticRegistryHash,
  getTrainingSemanticRegistry,
  type ProductTrainingCapabilityAssignment,
  type TrainingCoverageStatus,
  type TrainingSemanticEvidence,
} from '../training-semantics/index.js';
import {
  deterministicTrainingClassificationGeneratedAt,
  trainingSemanticClassifierVersion,
  type TrainingSemanticClassificationInput,
  type TrainingSemanticClassificationOptions,
  type TrainingSemanticClassificationResult,
} from './contracts.js';
import { computeTrainingSemanticClassifierRulesHash, evaluateTrainingSemanticRules, trainingSemanticRejectedBoundaryPatterns } from './rules.js';
import { normalizeTrainingText } from './normalize.js';
import { validateTrainingSemanticClassificationResult, validateTrainingSemanticAssignmentForClassifier } from './validation.js';

const registry = getTrainingSemanticRegistry();
const registryHash = computeTrainingSemanticRegistryHash(registry);
const rulesHash = computeTrainingSemanticClassifierRulesHash();

const clearlyNonApplicableFamilies = new Set(['FLOORING', 'BARBELL', 'DUMBBELL', 'BAND', 'STORAGE', 'PROTECTIVE_GEAR', 'BENCH']);
const clearlyNonApplicableNamePattern = new RegExp([
  '\\b(?:piso|palmeta|mancuerna|dumbbell|barbell|barra olimpica|banda de resistencia|bandas de resistencia|disco olimpico|disco bumper|rack de almacenamiento|porta discos|soporte para discos|accesorio de polea|agarre de polea)\\b',
  ...trainingSemanticRejectedBoundaryPatterns,
].join('|'));
const accessoryNamePattern = /\b(?:accesorio|attachment|agarre|grip|handle|pad|cinturon|rueda abdominal|abmat|correa|strap)\b/;
const machineFamilies = new Set(['CABLE_MACHINE', 'SELECTORIZED_MACHINE', 'PLATE_LOADED_MACHINE', 'RACK_CAGE', 'MACHINE_ATTACHMENT']);

function assignmentFromMatch(input: TrainingSemanticClassificationInput, match: ReturnType<typeof evaluateTrainingSemanticRules>['matches'][number], generatedAt: string, sourceCatalogExport?: string): ProductTrainingCapabilityAssignment {
  const assignment: ProductTrainingCapabilityAssignment = {
    productId: input.productId,
    capabilityCode: match.capabilityCode,
    relationType: match.relationType,
    classificationConfidence: match.confidence,
    evidence: match.evidence,
    reviewState: 'AUTO',
    provenance: {
      classifierVersion: trainingSemanticClassifierVersion,
      generatedAt,
      ...(sourceCatalogExport ? { sourceCatalogExport } : {}),
    },
  };
  validateTrainingSemanticAssignmentForClassifier(assignment);
  return assignment;
}

function hasCandidateLanguage(input: TrainingSemanticClassificationInput): boolean {
  const text = normalizeTrainingText(input.name);
  return /\b(?:abdominal|abs|core|crunch|remo|rowing|hip thrust|polea|press|pulldown|dominada|fondo|dip|aductor|abductor|curl|extension|cuadriceps|pectoral|hombro|shoulder|pec deck)\b/.test(text);
}

function determineCoverageStatus(input: TrainingSemanticClassificationInput, matches: readonly ProductTrainingCapabilityAssignment[], reviewCandidates: readonly ReturnType<typeof evaluateTrainingSemanticRules>['reviewCandidates'][number][], warnings: readonly string[]): TrainingCoverageStatus {
  if (reviewCandidates.length > 0 || matches.length > 6) return 'NEEDS_REVIEW';
  const normalizedName = normalizeTrainingText(input.name);
  if (matches.length === 0 && (clearlyNonApplicableFamilies.has(input.productFamily ?? '') || clearlyNonApplicableNamePattern.test(normalizedName))) return 'NO_CAPABILITY_APPLICABLE';
  if (matches.length === 0 && accessoryNamePattern.test(normalizedName)) return 'NO_CAPABILITY_APPLICABLE';
  if (matches.length === 0 && (hasCandidateLanguage(input) || warnings.length > 0)) return 'INSUFFICIENT_EVIDENCE';
  if (matches.length === 0 && (machineFamilies.has(input.productFamily ?? '') || input.productFamily === '')) return 'UNMODELED';
  if (matches.length === 0) return 'UNMODELED';
  return 'UNMODELED';
}

export function classifyTrainingSemanticProduct(
  input: TrainingSemanticClassificationInput,
  options: TrainingSemanticClassificationOptions = {},
): TrainingSemanticClassificationResult {
  const generatedAt = options.generatedAt ?? deterministicTrainingClassificationGeneratedAt;
  const evaluation = evaluateTrainingSemanticRules(input);
  const assignments = evaluation.matches.map((match) => assignmentFromMatch(input, match, generatedAt, options.sourceCatalogExport));
  const reviewCandidates = evaluation.reviewCandidates.map((match) => ({
    capabilityCode: match.capabilityCode,
    relationType: match.relationType,
    classificationConfidence: match.confidence,
    reviewState: 'HUMAN_REVIEW' as const,
    evidence: match.evidence,
    reason: match.evidence.map((evidence) => evidence.note).filter(Boolean).join('; ') || 'Boundary ambiguity requires human adjudication.',
  }));
  const warnings: string[] = [];
  if (assignments.length > 6) warnings.push('More than 6 direct/supported capabilities detected; human review is mandatory.');
  if (input.productFamily === 'CARDIO_MACHINE' && evaluation.reviewCandidates.some((candidate) => candidate.capabilityCode === 'ROW')) warnings.push('Cardio family conflicts with generic row wording; strength ROW is not auto-published.');
  if (assignments.some((assignment) => assignment.relationType === 'SUPPORTED')) warnings.push('SUPPORTED assignment requires explicit module/configuration evidence.');
  const coverageStatus = determineCoverageStatus(input, assignments, evaluation.reviewCandidates, warnings);
  const result: TrainingSemanticClassificationResult = {
    productId: input.productId,
    classifierVersion: trainingSemanticClassifierVersion,
    registryVersion: registry.registryVersion,
    registryHash,
    rulesHash,
    assignments: [...assignments].sort((a, b) => a.capabilityCode.localeCompare(b.capabilityCode)),
    coverageStatus,
    reviewCandidates,
    warnings,
    deferredFindings: evaluation.deferredFindings.map((finding) => ({ productId: input.productId, ...finding })),
  };
  validateTrainingSemanticClassificationResult(result);
  return result;
}

export const classifyTrainingSemantic = classifyTrainingSemanticProduct;
export const classifyTrainingProduct = classifyTrainingSemanticProduct;

export function classifyTrainingSemanticProducts(
  inputs: readonly TrainingSemanticClassificationInput[],
  options: TrainingSemanticClassificationOptions = {},
): readonly TrainingSemanticClassificationResult[] {
  return inputs.map((input) => classifyTrainingSemanticProduct(input, options));
}

export const classifyTrainingProducts = classifyTrainingSemanticProducts;
