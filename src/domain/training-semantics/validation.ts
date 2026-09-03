import {
  bodyRegionCodes,
  muscleGroupCodes,
  trainingCapabilityCodes,
  trainingCapabilityStatuses,
  trainingClassificationConfidenceLevels,
  trainingCoverageStatuses,
  trainingRelationTypes,
  trainingReviewStates,
  trainingSemanticEvidenceKinds,
  trainingSemanticRegistryStatus,
  trainingSemanticRegistryVersion,
  trainingPatternCodes,
  type ProductTrainingCapabilityAssignment,
  type ProductTrainingSemanticCoverage,
  type TrainingSemanticRegistry,
} from './contracts.js';

const REGISTRY_KEYS = new Set(['registryVersion', 'status', 'createdFrom', 'capabilities', 'bodyRegions', 'muscleGroups', 'trainingPatterns']);
const CAPABILITY_KEYS = new Set([
  'code',
  'canonicalName',
  'description',
  'status',
  'derivedBodyRegions',
  'primaryMuscleGroups',
  'secondaryMuscleGroups',
  'trainingPatterns',
]);

const EXPECTED_CAPABILITY_CODES = new Set<string>(trainingCapabilityCodes);

function validateUnique(values: readonly string[], label: string, issues: string[]): void {
  if (new Set(values).size !== values.length) {
    issues.push(`${label}: duplicate code found`);
  }
}

function validateExactCodes(values: readonly string[], expected: readonly string[], label: string, issues: string[]): void {
  validateUnique(values, label, issues);
  const actual = new Set(values);
  const expectedSet = new Set(expected);
  for (const code of expectedSet) {
    if (!actual.has(code)) issues.push(`${label}: missing code "${code}"`);
  }
  for (const code of actual) {
    if (!expectedSet.has(code)) issues.push(`${label}: unknown code "${code}"`);
  }
}

function validateKnownReferences(values: readonly string[], expected: readonly string[], label: string, issues: string[]): void {
  validateUnique(values, label, issues);
  const known = new Set(expected);
  for (const value of values) {
    if (!known.has(value)) issues.push(`${label}: unknown code "${value}"`);
  }
}

export function validateTrainingSemanticRegistry(registry: TrainingSemanticRegistry): void {
  const issues: string[] = [];

  const unexpectedRegistryKeys = Object.keys(registry).filter((key) => !REGISTRY_KEYS.has(key));
  if (unexpectedRegistryKeys.length > 0) {
    issues.push(`registry: unsupported fields [${unexpectedRegistryKeys.join(', ')}]`);
  }
  if (registry.registryVersion !== trainingSemanticRegistryVersion) {
    issues.push(`registryVersion: expected "${trainingSemanticRegistryVersion}", got "${String(registry.registryVersion)}"`);
  }
  if (registry.status !== trainingSemanticRegistryStatus) {
    issues.push(`status: expected "${trainingSemanticRegistryStatus}", got "${String(registry.status)}"`);
  }
  if (!Array.isArray(registry.createdFrom) || registry.createdFrom.length === 0) {
    issues.push('createdFrom: must cite at least one source');
  }

  validateExactCodes(registry.bodyRegions, bodyRegionCodes, 'bodyRegions', issues);
  validateExactCodes(registry.muscleGroups, muscleGroupCodes, 'muscleGroups', issues);
  validateExactCodes(registry.trainingPatterns, trainingPatternCodes, 'trainingPatterns', issues);

  const capabilityCodes = registry.capabilities.map((definition) => definition.code);
  validateExactCodes(capabilityCodes, trainingCapabilityCodes, 'capabilities', issues);

  for (const definition of registry.capabilities) {
    const prefix = `capability ${String(definition.code)}`;
    const unexpectedKeys = Object.keys(definition).filter((key) => !CAPABILITY_KEYS.has(key));
    if (unexpectedKeys.length > 0) issues.push(`${prefix}: unsupported fields [${unexpectedKeys.join(', ')}]`);
    if (!EXPECTED_CAPABILITY_CODES.has(definition.code)) continue;
    if (!trainingCapabilityStatuses.includes(definition.status)) {
      issues.push(`${prefix}: unknown status "${String(definition.status)}"`);
    }
    if (definition.status !== 'ACTIVE') {
      issues.push(`${prefix}: V1 capability must be ACTIVE`);
    }
    if (definition.canonicalName.trim().length === 0) issues.push(`${prefix}: canonicalName must not be empty`);
    if (definition.description.trim().length === 0) issues.push(`${prefix}: description must not be empty`);

    validateKnownReferences(definition.derivedBodyRegions, bodyRegionCodes, `${prefix}.derivedBodyRegions`, issues);
    validateKnownReferences(definition.primaryMuscleGroups, muscleGroupCodes, `${prefix}.primaryMuscleGroups`, issues);
    validateKnownReferences(definition.secondaryMuscleGroups, muscleGroupCodes, `${prefix}.secondaryMuscleGroups`, issues);
    validateKnownReferences(definition.trainingPatterns, trainingPatternCodes, `${prefix}.trainingPatterns`, issues);

    const primary = new Set(definition.primaryMuscleGroups);
    for (const muscle of definition.secondaryMuscleGroups) {
      if (primary.has(muscle)) issues.push(`${prefix}: primary/secondary muscle sets overlap on "${muscle}"`);
    }
    if ((definition.code === 'ADDUCTOR' || definition.code === 'ABDUCTOR') &&
        (definition.primaryMuscleGroups.length > 0 || definition.secondaryMuscleGroups.length > 0)) {
      issues.push(`${prefix}: muscle mapping is intentionally pending in V1`);
    }
  }

  if (issues.length > 0) {
    throw new Error(`Training Semantic Registry validation failed:\n- ${issues.join('\n- ')}`);
  }
}

export function validateProductTrainingCapabilityAssignment(assignment: ProductTrainingCapabilityAssignment): void {
  const issues: string[] = [];
  if (!Number.isInteger(assignment.productId) || assignment.productId <= 0) issues.push('productId: must be a positive integer');
  if (!trainingCapabilityCodes.includes(assignment.capabilityCode)) issues.push(`capabilityCode: unknown code "${String(assignment.capabilityCode)}"`);
  if (!trainingRelationTypes.includes(assignment.relationType)) issues.push(`relationType: unknown value "${String(assignment.relationType)}"`);
  if (!trainingClassificationConfidenceLevels.includes(assignment.classificationConfidence)) issues.push(`classificationConfidence: unknown value "${String(assignment.classificationConfidence)}"`);
  if (!trainingReviewStates.includes(assignment.reviewState)) issues.push(`reviewState: unknown value "${String(assignment.reviewState)}"`);
  if (!Array.isArray(assignment.evidence) || assignment.evidence.length === 0) issues.push('evidence: at least one evidence item is required');
  for (const evidence of assignment.evidence) {
    if (!trainingSemanticEvidenceKinds.includes(evidence.kind)) issues.push(`evidence.kind: unknown value "${String(evidence.kind)}"`);
  }
  if (!assignment.provenance.classifierVersion?.trim()) issues.push('provenance.classifierVersion: must not be empty');
  if (!assignment.provenance.generatedAt?.trim()) issues.push('provenance.generatedAt: must not be empty');
  if (assignment.reviewState === 'MANUAL_OVERRIDE' && !assignment.provenance.overrideId?.trim()) {
    issues.push('provenance.overrideId: required for MANUAL_OVERRIDE');
  }
  if (issues.length > 0) throw new Error(`Product Training Capability Assignment validation failed:\n- ${issues.join('\n- ')}`);
}

export const validateTrainingSemanticAssignment = validateProductTrainingCapabilityAssignment;

export function validateProductTrainingSemanticCoverage(coverage: ProductTrainingSemanticCoverage): void {
  const issues: string[] = [];
  if (!Number.isInteger(coverage.productId) || coverage.productId <= 0) issues.push('productId: must be a positive integer');
  if (!trainingCoverageStatuses.includes(coverage.status)) issues.push(`status: unknown value "${String(coverage.status)}"`);
  if (coverage.note !== undefined && coverage.note.trim().length === 0) issues.push('note: must not be empty when provided');
  if (issues.length > 0) throw new Error(`Product Training Semantic Coverage validation failed:\n- ${issues.join('\n- ')}`);
}
