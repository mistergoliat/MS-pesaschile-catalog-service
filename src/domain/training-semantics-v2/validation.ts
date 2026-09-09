import { bodyRegionCodes, muscleGroupCodes, trainingPatternCodes } from '../training-semantics/contracts.js';
import { getTrainingSemanticRegistry } from '../training-semantics/registry.js';
import { computeTrainingSemanticRegistryV2Hash } from './hashing.js';
import {
  exerciseCapabilityCodesV2,
  trainingFunctionCodesV2,
  trainingFunctionEvidenceKinds,
  trainingFunctionRelationTypes,
  trainingSemanticRegistryV2SchemaVersion,
  trainingSemanticRegistryV2Status,
  trainingSemanticRegistryV2Version,
  trainingSemanticV2Statuses,
  type ExerciseCapabilityDefinitionV2,
  type ProductTrainingFunctionAssignment,
  type TrainingSemanticRegistryV2,
} from './contracts.js';

const REGISTRY_KEYS = new Set([
  'schemaVersion', 'registryVersion', 'registryHash', 'status', 'createdFrom',
  'exerciseCapabilities', 'trainingFunctions', 'bodyRegions', 'muscleGroups',
  'trainingPatterns', 'exerciseDerivedRelations', 'familyTrainingFunctionDerivations',
  'semanticBoundaries',
]);
const EXERCISE_KEYS = new Set([
  'code', 'canonicalName', 'description', 'status', 'derivedBodyRegions',
  'primaryMuscleGroups', 'secondaryMuscleGroups', 'trainingPatterns',
]);
const FUNCTION_KEYS = new Set([
  'code', 'canonicalName', 'description', 'status', 'allowedRelationTypes', 'allowedEvidenceKinds',
]);
const FUNCTION_ASSIGNMENT_KEYS = new Set(['productId', 'functionCode', 'relationType', 'productFamily', 'evidence', 'provenance']);
const FUNCTION_EVIDENCE_KEYS = new Set(['kind', 'sourceId', 'matchedText', 'ruleId', 'note']);
const ANATOMY_KEYS = new Set([
  'bodyRegion', 'bodyRegions', 'derivedBodyRegions', 'muscleGroup', 'muscleGroups',
  'primaryMuscleGroups', 'secondaryMuscleGroups', 'trainingPattern', 'trainingPatterns',
  'trainingGoal', 'trainingGoals',
]);

function validateUnique(values: readonly string[], label: string, issues: string[]): void {
  if (new Set(values).size !== values.length) issues.push(`${label}: duplicate code found`);
}

function validateExactCodes(values: readonly string[], expected: readonly string[], label: string, issues: string[]): void {
  validateUnique(values, label, issues);
  const actual = new Set(values);
  const expectedSet = new Set(expected);
  for (const code of expectedSet) if (!actual.has(code)) issues.push(`${label}: missing code "${code}"`);
  for (const code of actual) if (!expectedSet.has(code)) issues.push(`${label}: unknown code "${code}"`);
}

function validateKnownReferences(values: readonly string[], expected: readonly string[], label: string, issues: string[]): void {
  validateUnique(values, label, issues);
  const known = new Set(expected);
  for (const value of values) if (!known.has(value)) issues.push(`${label}: unknown code "${value}"`);
}

function validateExerciseDefinition(definition: ExerciseCapabilityDefinitionV2, issues: string[]): void {
  const prefix = `exerciseCapability ${String(definition.code)}`;
  for (const key of Object.keys(definition)) if (!EXERCISE_KEYS.has(key)) issues.push(`${prefix}: unsupported field "${key}"`);
  if (!trainingSemanticV2Statuses.includes(definition.status)) issues.push(`${prefix}: unknown status`);
  if (!definition.canonicalName?.trim()) issues.push(`${prefix}: canonicalName must not be empty`);
  if (!definition.description?.trim()) issues.push(`${prefix}: description must not be empty`);
  validateKnownReferences(definition.derivedBodyRegions, bodyRegionCodes, `${prefix}.derivedBodyRegions`, issues);
  validateKnownReferences(definition.primaryMuscleGroups, muscleGroupCodes, `${prefix}.primaryMuscleGroups`, issues);
  validateKnownReferences(definition.secondaryMuscleGroups, muscleGroupCodes, `${prefix}.secondaryMuscleGroups`, issues);
  validateKnownReferences(definition.trainingPatterns, trainingPatternCodes, `${prefix}.trainingPatterns`, issues);
  const primary = new Set(definition.primaryMuscleGroups);
  for (const muscle of definition.secondaryMuscleGroups) {
    if (primary.has(muscle)) issues.push(`${prefix}: primary/secondary muscle sets overlap on "${muscle}"`);
  }
}

function validateV1Compatibility(registry: TrainingSemanticRegistryV2, issues: string[]): void {
  const v1 = getTrainingSemanticRegistry();
  for (const definition of v1.capabilities) {
    const v2 = registry.exerciseCapabilities.find((candidate) => candidate.code === definition.code);
    if (!v2) continue;
    const fields = ['canonicalName', 'description', 'status', 'derivedBodyRegions', 'primaryMuscleGroups', 'secondaryMuscleGroups', 'trainingPatterns'] as const;
    for (const field of fields) {
      if (JSON.stringify(v2[field]) !== JSON.stringify(definition[field])) {
        issues.push(`V1 compatibility: ${definition.code}.${field} changed`);
      }
    }
  }
}

export function validateTrainingSemanticRegistryV2(registry: TrainingSemanticRegistryV2): void {
  const issues: string[] = [];
  for (const key of Object.keys(registry)) if (!REGISTRY_KEYS.has(key)) issues.push(`registry: unsupported field "${key}"`);
  if (registry.schemaVersion !== trainingSemanticRegistryV2SchemaVersion) issues.push(`schemaVersion: expected "${trainingSemanticRegistryV2SchemaVersion}"`);
  if (registry.registryVersion !== trainingSemanticRegistryV2Version) issues.push(`registryVersion: expected "${trainingSemanticRegistryV2Version}"`);
  if (registry.status !== trainingSemanticRegistryV2Status) issues.push(`status: expected "${trainingSemanticRegistryV2Status}"`);
  if (!/^[a-f0-9]{64}$/u.test(registry.registryHash)) issues.push('registryHash: must be a SHA-256 hex string');
  if (!Array.isArray(registry.createdFrom) || registry.createdFrom.length === 0) issues.push('createdFrom: must cite at least one source');

  validateExactCodes(registry.bodyRegions, bodyRegionCodes, 'bodyRegions', issues);
  validateExactCodes(registry.muscleGroups, muscleGroupCodes, 'muscleGroups', issues);
  validateExactCodes(registry.trainingPatterns, trainingPatternCodes, 'trainingPatterns', issues);

  const exerciseCodes = registry.exerciseCapabilities.map((definition) => definition.code);
  validateExactCodes(exerciseCodes, exerciseCapabilityCodesV2, 'exerciseCapabilities', issues);
  const functionCodes = registry.trainingFunctions.map((definition) => definition.code);
  validateExactCodes(functionCodes, trainingFunctionCodesV2, 'trainingFunctions', issues);
  const collision = new Set(exerciseCodes.filter((code) => functionCodes.includes(code as never)));
  if (collision.size > 0) issues.push(`semantic type code collision: ${[...collision].join(', ')}`);
  if (registry.exerciseCapabilities.filter((definition) => definition.status === 'ACTIVE').length !== 24) issues.push('exerciseCapabilities: expected exactly 24 active capabilities');
  if (registry.trainingFunctions.filter((definition) => definition.status === 'ACTIVE').length !== 5) issues.push('trainingFunctions: expected exactly 5 active training functions');
  if (exerciseCodes.includes('SQUAT' as never)) issues.push('exerciseCapabilities: generic SQUAT is forbidden');
  if (exerciseCodes.includes('GLUTE_KICKBACK' as never)) issues.push('exerciseCapabilities: GLUTE_KICKBACK is not approved');

  for (const definition of registry.exerciseCapabilities) validateExerciseDefinition(definition, issues);

  const functionByCode = new Set(functionCodes);
  for (const definition of registry.trainingFunctions) {
    const prefix = `trainingFunction ${String(definition.code)}`;
    for (const key of Object.keys(definition)) {
      if (!FUNCTION_KEYS.has(key)) issues.push(`${prefix}: unsupported field "${key}"`);
      if (ANATOMY_KEYS.has(key)) issues.push(`${prefix}: anatomy derivation is forbidden`);
    }
    if (!trainingSemanticV2Statuses.includes(definition.status)) issues.push(`${prefix}: unknown status`);
    if (!definition.canonicalName?.trim()) issues.push(`${prefix}: canonicalName must not be empty`);
    if (!definition.description?.trim()) issues.push(`${prefix}: description must not be empty`);
    validateKnownReferences(definition.allowedRelationTypes, trainingFunctionRelationTypes, `${prefix}.allowedRelationTypes`, issues);
    validateKnownReferences(definition.allowedEvidenceKinds, trainingFunctionEvidenceKinds, `${prefix}.allowedEvidenceKinds`, issues);
  }

  const relationCodes = registry.exerciseDerivedRelations.map((relation) => relation.capabilityCode);
  validateExactCodes(relationCodes, exerciseCapabilityCodesV2, 'exerciseDerivedRelations', issues);
  for (const relation of registry.exerciseDerivedRelations) {
    validateKnownReferences(relation.bodyRegions, bodyRegionCodes, `exerciseDerivedRelations.${relation.capabilityCode}.bodyRegions`, issues);
    validateKnownReferences(relation.primaryMuscleGroups, muscleGroupCodes, `exerciseDerivedRelations.${relation.capabilityCode}.primaryMuscleGroups`, issues);
    validateKnownReferences(relation.secondaryMuscleGroups, muscleGroupCodes, `exerciseDerivedRelations.${relation.capabilityCode}.secondaryMuscleGroups`, issues);
    validateKnownReferences(relation.trainingPatterns, trainingPatternCodes, `exerciseDerivedRelations.${relation.capabilityCode}.trainingPatterns`, issues);
    const definition = registry.exerciseCapabilities.find((candidate) => candidate.code === relation.capabilityCode);
    if (definition) {
      if (JSON.stringify(relation.bodyRegions) !== JSON.stringify(definition.derivedBodyRegions) ||
          JSON.stringify(relation.primaryMuscleGroups) !== JSON.stringify(definition.primaryMuscleGroups) ||
          JSON.stringify(relation.secondaryMuscleGroups) !== JSON.stringify(definition.secondaryMuscleGroups) ||
          JSON.stringify(relation.trainingPatterns) !== JSON.stringify(definition.trainingPatterns)) {
        issues.push(`${relation.capabilityCode}: derived relation disagrees with definition`);
      }
    }
  }

  const families = new Set<string>();
  for (const derivation of registry.familyTrainingFunctionDerivations) {
    const key = `${derivation.productFamily}\u0000${derivation.trainingFunctionCode}`;
    if (families.has(key)) issues.push(`familyTrainingFunctionDerivations: duplicate mapping "${key}"`);
    families.add(key);
    if (!derivation.productFamily?.trim()) issues.push('familyTrainingFunctionDerivations: productFamily must not be empty');
    if (!functionByCode.has(derivation.trainingFunctionCode)) issues.push(`familyTrainingFunctionDerivations: unknown training function "${derivation.trainingFunctionCode}"`);
    if (derivation.relationType !== 'FAMILY_DERIVED' || derivation.evidenceKind !== 'FAMILY_DERIVATION') issues.push(`familyTrainingFunctionDerivations.${key}: invalid relation policy`);
    const definition = registry.trainingFunctions.find((candidate) => candidate.code === derivation.trainingFunctionCode);
    if (definition && !definition.allowedRelationTypes.includes('FAMILY_DERIVED')) issues.push(`familyTrainingFunctionDerivations.${key}: function does not allow FAMILY_DERIVED`);
  }

  if (registry.semanticBoundaries.deadlift.familyDerived !== false) issues.push('semanticBoundaries.deadlift: DEADLIFT cannot be family-derived');
  if (registry.semanticBoundaries.squat.forbiddenGenericCode !== 'SQUAT') issues.push('semanticBoundaries.squat: generic SQUAT guard is missing');
  if (JSON.stringify(registry.semanticBoundaries.squat.explicitCapabilities) !== JSON.stringify(['HACK_SQUAT', 'PENDULUM_SQUAT', 'BELT_SQUAT'])) issues.push('semanticBoundaries.squat: explicit capability boundary changed');
  if (computeTrainingSemanticRegistryV2Hash(registry) !== registry.registryHash) issues.push('registryHash: does not match canonical semantic content');
  validateV1Compatibility(registry, issues);

  if (issues.length > 0) throw new Error(`Training Semantic Registry V2 validation failed:\n- ${issues.join('\n- ')}`);
}

export function validateProductTrainingFunctionAssignment(assignment: ProductTrainingFunctionAssignment): void {
  const issues: string[] = [];
  for (const key of Object.keys(assignment)) if (!FUNCTION_ASSIGNMENT_KEYS.has(key)) issues.push(`assignment: unsupported field "${key}"`);
  if (!Number.isInteger(assignment.productId) || assignment.productId <= 0) issues.push('productId: must be a positive integer');
  const definition = [...trainingFunctionCodesV2].includes(assignment.functionCode);
  if (!definition) issues.push(`functionCode: unknown code "${String(assignment.functionCode)}"`);
  if (!trainingFunctionRelationTypes.includes(assignment.relationType)) issues.push(`relationType: unknown value "${String(assignment.relationType)}"`);
  if (!Array.isArray(assignment.evidence) || assignment.evidence.length === 0) issues.push('evidence: at least one evidence item is required');
  for (const evidence of assignment.evidence ?? []) {
    for (const key of Object.keys(evidence)) if (!FUNCTION_EVIDENCE_KEYS.has(key)) issues.push(`evidence: unsupported field "${key}"`);
    if (!trainingFunctionEvidenceKinds.includes(evidence.kind)) issues.push(`evidence.kind: unknown value "${String(evidence.kind)}"`);
    if (Object.keys(evidence).some((key) => ANATOMY_KEYS.has(key))) issues.push('evidence: anatomy derivation is forbidden');
  }
  if (!assignment.provenance?.classifierVersion?.trim()) issues.push('provenance.classifierVersion: must not be empty');
  if (!assignment.provenance?.generatedAt?.trim()) issues.push('provenance.generatedAt: must not be empty');
  if (assignment.relationType === 'FAMILY_DERIVED') {
    if (!assignment.productFamily?.trim()) issues.push('productFamily: required for FAMILY_DERIVED');
    if (!assignment.evidence.some((evidence) => evidence.kind === 'FAMILY_DERIVATION')) issues.push('evidence: FAMILY_DERIVATION required for FAMILY_DERIVED');
    if (!getFamilyMapping(assignment.productFamily, assignment.functionCode)) issues.push('productFamily: no approved family derivation exists for this function');
  } else if (assignment.evidence.some((evidence) => evidence.kind === 'FAMILY_DERIVATION')) {
    issues.push('evidence: FAMILY_DERIVATION is only valid for FAMILY_DERIVED');
  }
  if (issues.length > 0) throw new Error(`Product Training Function Assignment validation failed:\n- ${issues.join('\n- ')}`);
}

function getFamilyMapping(productFamily: string | undefined, functionCode: string): boolean {
  if (!productFamily) return false;
  return productFamily === 'CABLE_MACHINE' && functionCode === 'CABLE_RESISTANCE';
}

export const validateTrainingFunctionAssignment = validateProductTrainingFunctionAssignment;
