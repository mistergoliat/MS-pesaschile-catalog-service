import { classifyTrainingSemanticProductV21 } from '../training-semantic-classification-v2-1/index.js';
import type { TrainingSemanticClassificationInput } from '../training-semantic-classification/index.js';
import { explainTrainingNegativeRule } from '../training-semantic-classification/classifier.js';
import { hasUnresolvedCableAccessory, isPassiveCableAttachment } from '../training-semantic-classification-v2/rules.js';
import { normalizeTrainingText } from '../training-semantic-classification/normalize.js';
import { evaluateProductDimensions, trainingSourceObligations, mapProductSemantics, type AdmissionContextV2 } from '../catalog-admission/index.js';
import { semanticObligationContractV2 } from '../catalog-admission/registry-v2.js';
import { getTrainingSemanticRegistryV2 } from '../training-semantics-v2/index.js';
import { hashTrainingSnapshotCanonical, canonicalizeTrainingSnapshotJson } from './canonicalJson.js';
import { trainingResolutionPolicy } from './resolutionPolicy.js';
import type { TrainingSemanticSnapshotV2Record, TrainingSemanticResolutionState } from './v2-contracts.js';

export function trainingSourceEvidenceId(input: TrainingSemanticClassificationInput): string { return `sha256:${hashTrainingSnapshotCanonical(input)}`; }
export type TrainingGapClassification = 'SAFE_DERIVABLE' | 'MISSING_SOURCE_DATA' | 'POLICY_UNKNOWN' | 'ALREADY_SATISFIED';

/** ACTIVE concepts are rule gaps; deliberately excluded generic concepts are not ontology gaps. */
export function trainingOntologyGapFindings(findings: readonly { candidateCode: string; matchedText: string; reason: string }[]) {
  const registry = getTrainingSemanticRegistryV2();
  const active = new Set<string>([...registry.exerciseCapabilities, ...registry.trainingFunctions].filter(c => c.status === 'ACTIVE').map(c => c.code));
  const forbidden = new Set<string>([registry.semanticBoundaries.squat.forbiddenGenericCode]);
  return findings.filter(f => !active.has(f.candidateCode) && !forbidden.has(f.candidateCode));
}

/** Pure finalizer: it inspects sources and rules, never product IDs or historical frequencies. */
export function reconcileTrainingResolution(before: TrainingSemanticSnapshotV2Record, source: TrainingSemanticClassificationInput | undefined, context?: AdmissionContextV2, rebuildFromSource = false) {
  if (source && source.productId !== before.productId || context?.canonical && context.canonical.productId !== before.productId) throw new Error('TRAINING_SOURCE_ID_MISMATCH');
  const record = structuredClone(before);
  const fresh = source && rebuildFromSource ? classifyTrainingSemanticProductV21(source, { sourceCatalogExport: 'product_catalog_exploration.csv' }) : null;
  if (fresh) {
    const wire = <T extends { productId: number; evidence: readonly unknown[]; provenance: { generatedAt: string; classifierVersion: string; sourceCatalogExport?: string } }>(a: T) => {
      const { productId: _id, provenance: { generatedAt: _time, ...provenance }, ...assignment } = a;
      return JSON.parse(JSON.stringify({ ...assignment, provenance })) as Omit<T, 'productId' | 'provenance'> & { provenance: Omit<T['provenance'], 'generatedAt'> };
    };
    record.exerciseCapabilities = fresh.exerciseCapabilities.map(wire) as TrainingSemanticSnapshotV2Record['exerciseCapabilities'];
    record.trainingFunctions = fresh.trainingFunctions.map(wire) as TrainingSemanticSnapshotV2Record['trainingFunctions'];
    record.coverageStatus = fresh.coverageStatus;
    record.warnings = [...fresh.warnings].sort();
  }
  const gaps: { dimension: string; code: string | null; classification: TrainingGapClassification; policyRule: string; sourceEvidence: unknown }[] = [];
  const required = context ? evaluateProductDimensions(context, semanticObligationContractV2).filter(d => d.dimension.startsWith('TRAINING_')) : [];
  const obligations = context ? trainingSourceObligations(context) : null;
  const family = context?.productSemantics?.primaryProductFamily?.code;
  const sourceBound = !!source && source.name === context?.canonical?.name
    && source.categories.every(c => context?.canonical?.categoryIds?.some(r => String(r.categoryId) === c.categoryId && (r.name ?? '') === c.name))
    && source.features.every(f => context?.canonical?.features?.some(r => String(r.featureId) === f.featureId && (r.value ?? '') === f.value));
  const productResolution = context ? mapProductSemantics(context) : undefined;
  const authority = context?.lineage?.productVerified === true && !!productResolution && ['VERIFIED', 'PARTIAL'].includes(productResolution.state)
    && !!productResolution.evidenceFacts[0]?.length && productResolution.evidenceFacts[0].every(e => e.acceptable && ['STRONG', 'EXPLICIT'].includes(e.strength))
    && !!context.productSemantics?.provenance.evidence.some(e => e.axis === 'PRODUCT_FAMILY' && e.code === family);
  for (const dimension of required) {
    const mappings = getTrainingSemanticRegistryV2().familyTrainingFunctionDerivations.filter(d => d.status === 'ACTIVE' && d.productFamily === family);
    const codes = dimension.dimension === 'TRAINING_EXERCISE' ? obligations?.exercise : [...new Set([...(obligations?.function ?? []), ...mappings.map(d => d.trainingFunctionCode)])];
    if (dimension.effectiveRequirement === 'UNKNOWN') {
      gaps.push({ dimension: dimension.dimension, code: null, classification: 'POLICY_UNKNOWN', policyRule: 'semantic-obligations-v2', sourceEvidence: dimension.sourceReferences });
      continue;
    }
    if (dimension.effectiveRequirement !== 'REQUIRED') continue;
    for (const code of codes?.length ? codes : [null]) {
      const satisfied = dimension.dimension === 'TRAINING_EXERCISE' ? record.exerciseCapabilities.some(a => a.capabilityCode === code) : record.trainingFunctions.some(a => a.functionCode === code);
      const mapping = getTrainingSemanticRegistryV2().familyTrainingFunctionDerivations.find(d => d.status === 'ACTIVE' && d.productFamily === family && d.trainingFunctionCode === code);
      const derived = !satisfied && source && sourceBound && authority && mapping && dimension.dimension === 'TRAINING_FUNCTION'
        ? classifyTrainingSemanticProductV21({ ...source, productFamily: family, productFamilyEvidence: context?.productSemantics?.provenance.evidence }, { sourceCatalogExport: 'product_catalog_exploration.csv' }).trainingFunctions.find(a => a.functionCode === code) : undefined;
      const classification: TrainingGapClassification = satisfied ? 'ALREADY_SATISFIED' : derived ? 'SAFE_DERIVABLE' : !source || !sourceBound || !obligations || !authority ? 'MISSING_SOURCE_DATA' : 'POLICY_UNKNOWN';
      if (derived) {
        const { productId: _id, provenance, ...assignment } = derived;
        const { generatedAt: _time, ...lineage } = provenance;
        record.trainingFunctions.push({ ...assignment, evidence: [...assignment.evidence], provenance: lineage });
      }
      gaps.push({ dimension: dimension.dimension, code, classification, policyRule: derived?.evidence[0]?.ruleId ?? 'semantic-obligations-v2', sourceEvidence: derived?.evidence ?? dimension.sourceReferences });
    }
  }
  const hasAssignments = record.exerciseCapabilities.length + record.trainingFunctions.length > 0;
  const unresolvedCableAccessory = !hasAssignments && !!source && hasUnresolvedCableAccessory(source);
  const unresolvedExcludedAccessory = !!fresh && !hasAssignments
    && fresh.deferredFindings.some(f => f.candidateCode === getTrainingSemanticRegistryV2().semanticBoundaries.squat.forbiddenGenericCode)
    && /\b(?:accesorios?|attachments?|accessor(?:y|ies)?)\b/u.test(normalizeTrainingText(source?.name));
  const changedAssignments = canonicalizeTrainingSnapshotJson([record.exerciseCapabilities, record.trainingFunctions]) !== canonicalizeTrainingSnapshotJson([before.exerciseCapabilities, before.trainingFunctions]);
  let rule = 'PRESERVE_COHERENT_STATE';
  let assessment: object | null = null;
  let state: TrainingSemanticResolutionState = record.resolutionState!;
  if ((state === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && hasAssignments) || changedAssignments
    || unresolvedCableAccessory || unresolvedExcludedAccessory || fresh && (state === 'SEMANTIC_COMPLETE' || hasAssignments || fresh.reviewCandidates.length > 0 || state === 'ONTOLOGY_GAP' && fresh.deferredFindings.length > 0 && !trainingOntologyGapFindings(fresh.deferredFindings).length)) {
    const replay = source ? classifyTrainingSemanticProductV21(changedAssignments && family ? { ...source, productFamily: family } : source, { sourceCatalogExport: 'product_catalog_exploration.csv' }) : null;
    const evidenceKey = (evidence: readonly unknown[]) => canonicalizeTrainingSnapshotJson(evidence.map(e => canonicalizeTrainingSnapshotJson(e)).sort());
    const reproduced = replay && record.exerciseCapabilities.every(a => replay.exerciseCapabilities.some(r => r.capabilityCode === a.capabilityCode && r.relationType === a.relationType
      && r.classificationConfidence === a.classificationConfidence && r.reviewState === a.reviewState && r.moduleId === a.moduleId
      && canonicalizeTrainingSnapshotJson(r.modifierCodes ?? []) === canonicalizeTrainingSnapshotJson(a.modifierCodes ?? []) && evidenceKey(r.evidence) === evidenceKey(a.evidence)))
      && record.trainingFunctions.every(a => replay.trainingFunctions.some(r => r.functionCode === a.functionCode && r.relationType === a.relationType
        && r.classificationConfidence === a.classificationConfidence && r.reviewState === a.reviewState && r.productFamily === a.productFamily && evidenceKey(r.evidence) === evidenceKey(a.evidence)));
    const sourceRequirementsSatisfied = !!replay && replay.exerciseCapabilities.every(a => record.exerciseCapabilities.some(r => r.capabilityCode === a.capabilityCode))
      && replay.trainingFunctions.every(a => record.trainingFunctions.some(r => r.functionCode === a.functionCode))
      && (!obligations || obligations.exercise.every(code => record.exerciseCapabilities.some(a => a.capabilityCode === code))
        && obligations.function.every(code => record.trainingFunctions.some(a => a.functionCode === code)));
    assessment = { classifierVersion: replay?.classifierVersion ?? null, rulesHash: replay?.rulesHash ?? null,
      reviewCandidates: replay?.reviewCandidates ?? [], deferredFindings: replay ? trainingOntologyGapFindings(replay.deferredFindings) : [], excludedDeferredFindings: replay?.deferredFindings.filter(f => !trainingOntologyGapFindings([f]).length) ?? [], assignmentsReproduced: !!reproduced, sourceRequirementsSatisfied };
    state = !source || !replay ? 'DATA_GAP' : replay.reviewCandidates.length ? 'AMBIGUOUS'
      : trainingOntologyGapFindings(replay.deferredFindings).length ? 'ONTOLOGY_GAP' : !reproduced ? 'DATA_GAP'
      : !hasAssignments ? replay.coverageStatus === 'NO_CAPABILITY_APPLICABLE' && !unresolvedExcludedAccessory && !unresolvedCableAccessory ? 'VERIFIED_NO_APPLICABLE_CAPABILITY' : 'DATA_GAP'
      : !sourceRequirementsSatisfied ? 'RULE_GAP' : 'SEMANTIC_COMPLETE';
    rule = `FINAL_SOURCE_RECONCILIATION_${state}`;
  }
  let negativeEvidenceState: 'NEGATIVE_EVIDENCE_PRESENT' | 'NEGATIVE_EVIDENCE_ABSENT' | 'NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE' | 'NOT_REQUIRED' = 'NOT_REQUIRED';
  if (state === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && !hasAssignments) {
    const replay = source ? classifyTrainingSemanticProductV21(source) : null;
    const negative = source && !hasUnresolvedCableAccessory(source)
      ? explainTrainingNegativeRule(source) ?? (isPassiveCableAttachment(source) ? 'V2_PASSIVE_CABLE_ATTACHMENT' : undefined) : undefined;
    negativeEvidenceState = !source ? 'NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE' : negative && replay?.exerciseCapabilities.length === 0 && replay.trainingFunctions.length === 0 && replay.reviewCandidates.length === 0 ? 'NEGATIVE_EVIDENCE_PRESENT' : 'NEGATIVE_EVIDENCE_ABSENT';
    if (negativeEvidenceState === 'NEGATIVE_EVIDENCE_PRESENT') {
      rule = negative!;
      record.resolutionEvidence = [{ kind: 'CLASSIFIER_NEGATIVE_RULE', sourceId: trainingSourceEvidenceId(source!), note: canonicalizeTrainingSnapshotJson({ ruleId: rule, policyHash: trainingResolutionPolicy.contentHash, scope: 'MODELED_SNAPSHOT_COVERAGE', sourceFile: 'src/domain/training-semantic-classification/classifier.ts#determineCoverageStatus' }) }];
    }
  }
  if (state !== before.resolutionState || (changedAssignments || fresh && hasAssignments) && state !== 'VERIFIED_NO_APPLICABLE_CAPABILITY') {
    record.resolutionEvidence = source ? [{ kind: 'TRAINING_RECONCILIATION', sourceId: trainingSourceEvidenceId(source), note: canonicalizeTrainingSnapshotJson({ ruleId: rule, policyHash: trainingResolutionPolicy.contentHash, previousState: before.resolutionState, requiredAssignments: obligations, assessment }) }] : undefined;
  }
  record.resolutionState = state;
  record.resolved = ['SEMANTIC_COMPLETE', 'VERIFIED_NO_APPLICABLE_CAPABILITY'].includes(state);
  record.trainingFunctions.sort((a, b) => a.functionCode.localeCompare(b.functionCode));
  return { record, reason: rule, policyRule: rule, sourceEvidence: source ? { sourceId: trainingSourceEvidenceId(source), source, requiredAssignments: obligations, assessment } : null, negativeEvidenceState, gaps };
}
