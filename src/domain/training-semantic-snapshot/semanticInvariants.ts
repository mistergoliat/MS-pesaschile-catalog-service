import { getTrainingSemanticRegistryV2 } from '../training-semantics-v2/index.js';
import { trainingSemanticSnapshotV2RecordSchema, type TrainingSemanticSnapshotV2Record } from './v2-contracts.js';
import { trainingSemanticRuleCatalog } from '../training-semantic-classification/rules.js';
import { trainingSemanticV2RuleCatalog, trainingRuleEvidenceDomain, hasCableFamilyAuthority, isTrainingCableMechanismEvidence, hasUnresolvedCableAccessory } from '../training-semantic-classification-v2/rules.js';
import { normalizeTrainingText } from '../training-semantic-classification/normalize.js';
import { trainingSemanticV21EnrichmentCatalog } from '../training-semantic-classification-v2-1/rules.js';
import type { TrainingSemanticClassificationInput } from '../training-semantic-classification/contracts.js';
import { trainingResolutionPolicy } from './resolutionPolicy.js';

const baseRuleIds = [...trainingSemanticRuleCatalog.directNameRules.map(r => r.id), ...trainingSemanticRuleCatalog.specialRules.map(r => r.id),
  ...trainingSemanticV2RuleCatalog.exerciseRules.map(r => r.ruleId), ...trainingSemanticV2RuleCatalog.functionRules.map(r => r.ruleId)];
const knownRules = new Set([...baseRuleIds.flatMap(id => [id, `FEATURE_${id}`, `CATEGORY_${id}`, `${id}_SUPPORTED`]),
  ...trainingSemanticV21EnrichmentCatalog.enrichments.map(r => r.enrichmentId), 'FAMILY_CABLE_MACHINE_CABLE_RESISTANCE_V2']);

/** Publication gate, independent of historical parity and classification. Historical readers remain compatible. */
export function validateTrainingSemanticInvariants(snapshot: { records: readonly TrainingSemanticSnapshotV2Record[] }, evidenceReferences?: ReadonlySet<string>, sources?: ReadonlyMap<number, TrainingSemanticClassificationInput>): void {
  const registry = getTrainingSemanticRegistryV2();
  const ids = new Set<number>();
  for (const record of snapshot.records) {
    if (ids.has(record.productId)) throw new Error(`TRAINING_DUPLICATE_PRODUCT: ${record.productId}`);
    ids.add(record.productId);
    trainingSemanticSnapshotV2RecordSchema.parse(record); // Codes, relations, evidence shape; rejects persisted anatomy.
    if (record.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && record.exerciseCapabilities.length + record.trainingFunctions.length > 0) throw new Error(`TRAINING_NEGATIVE_WITH_ASSIGNMENTS: ${record.productId}`);
    if (!record.resolutionState || record.resolved !== ['SEMANTIC_COMPLETE', 'VERIFIED_NO_APPLICABLE_CAPABILITY'].includes(record.resolutionState)) throw new Error(`TRAINING_RESOLVED_STATE_MISMATCH: ${record.productId}`);
    if (record.resolutionState === 'SEMANTIC_COMPLETE' && !record.exerciseCapabilities.length && !record.trainingFunctions.length) throw new Error(`TRAINING_EMPTY_COMPLETE: ${record.productId}`);
    const source = sources?.get(record.productId);
    if (source && record.resolutionState === 'VERIFIED_NO_APPLICABLE_CAPABILITY' && hasUnresolvedCableAccessory(source)) throw new Error(`TRAINING_UNPROVEN_CABLE_NEGATIVE: ${record.productId}`);
    for (const assignment of [...record.exerciseCapabilities, ...record.trainingFunctions]) {
      const code = 'functionCode' in assignment ? assignment.functionCode : assignment.capabilityCode;
      if (code === 'PULL_UP' && assignment.evidence.some(e => e.ruleId?.includes('CATEGORY_PULL_UP_PUSH_UP_BARS_CLOSURE_V2'))
        && !assignment.evidence.some(e => /\b(?:pull\s*ups?|dominadas?)\b/u.test(normalizeTrainingText(e.matchedText))
          && (e.kind === 'NAME' || e.kind === 'TRUSTED_CATEGORY' && !/\bpush\s*ups?\b/u.test(normalizeTrainingText(e.matchedText))))) throw new Error(`TRAINING_MIXED_CATEGORY_WITHOUT_SPECIFICITY: ${record.productId}`);
      if (source && assignment.evidence.some(e => e.ruleId?.endsWith('_V2')) && !trainingRuleEvidenceDomain(source, code)) throw new Error(`TRAINING_EVIDENCE_DOMAIN_INVALID: ${record.productId}/${code}`);
      for (const evidence of assignment.evidence) {
        if (code === 'CABLE_RESISTANCE' && evidence.kind === 'STRUCTURED_FEATURE' && /\b(?:material|composition|composicion)\b/iu.test((evidence.matchedText ?? '').split(':')[0]!)) throw new Error(`TRAINING_MATERIAL_AS_MECHANISM: ${record.productId}`);
        if (code === 'CABLE_RESISTANCE' && evidence.kind === 'STRUCTURED_FEATURE' && !isTrainingCableMechanismEvidence(evidence.matchedText ?? '')) throw new Error(`TRAINING_MECHANISM_EVIDENCE_INVALID: ${record.productId}`);
        if (evidence.ruleId && !knownRules.has(evidence.ruleId)) throw new Error(`TRAINING_RULE_REFERENCE_INVALID: ${record.productId}`);
        if (evidence.sourceId && ((evidence.kind === 'NAME' && evidence.sourceId !== 'NAME')
          || (evidence.kind === 'TRUSTED_CATEGORY' && evidence.sourceId !== 'CATEGORY' && !/^\d+$/u.test(evidence.sourceId))
          || (evidence.kind === 'STRUCTURED_FEATURE' && !/^\d+$/u.test(evidence.sourceId)))) throw new Error(`TRAINING_SOURCE_REFERENCE_INVALID: ${record.productId}`);
        if (source && evidence.sourceId && ((evidence.kind === 'STRUCTURED_FEATURE' && !source.features.some(f => f.featureId === evidence.sourceId))
          || (evidence.kind === 'TRUSTED_CATEGORY' && evidence.sourceId !== 'CATEGORY' && !source.categories.some(c => c.categoryId === evidence.sourceId)))) throw new Error(`TRAINING_SOURCE_BINDING_INVALID: ${record.productId}`);
      }
    }
    for (const assignment of record.trainingFunctions) {
      if (source && assignment.relationType === 'FAMILY_DERIVED' && !hasCableFamilyAuthority(source)) throw new Error(`TRAINING_FAMILY_AUTHORITY_INSUFFICIENT: ${record.productId}`);
      const definition = registry.trainingFunctions.find(f => f.code === assignment.functionCode)!;
      if (!definition.allowedRelationTypes.includes(assignment.relationType) || assignment.evidence.some(e => !definition.allowedEvidenceKinds.includes(e.kind))) throw new Error(`TRAINING_FUNCTION_POLICY_INVALID: ${record.productId}`);
      if (assignment.relationType === 'FAMILY_DERIVED' && (!assignment.evidence.some(e => e.kind === 'FAMILY_DERIVATION' && e.sourceId === assignment.productFamily)
        || !registry.familyTrainingFunctionDerivations.some(d => d.status === 'ACTIVE' && d.productFamily === assignment.productFamily && d.trainingFunctionCode === assignment.functionCode))) throw new Error(`TRAINING_FAMILY_DERIVATION_INVALID: ${record.productId}`);
      if (assignment.relationType !== 'FAMILY_DERIVED' && assignment.evidence.some(e => e.kind === 'FAMILY_DERIVATION')) throw new Error(`TRAINING_FAMILY_EVIDENCE_INVALID: ${record.productId}`);
    }
    for (const evidence of record.resolutionEvidence ?? []) {
      if (!evidence.sourceId || (evidenceReferences && !evidenceReferences.has(evidence.sourceId))
        || ['CLASSIFIER_NEGATIVE_RULE', 'TRAINING_RECONCILIATION'].includes(evidence.kind) && !/^sha256:[a-f0-9]{64}$/u.test(evidence.sourceId)) throw new Error(`TRAINING_EVIDENCE_REFERENCE_INVALID: ${record.productId}`);
      if (['CLASSIFIER_NEGATIVE_RULE', 'TRAINING_RECONCILIATION'].includes(evidence.kind)) {
        let note;
        try { note = JSON.parse(evidence.note ?? ''); } catch { throw new Error(`TRAINING_EVIDENCE_NOTE_INVALID: ${record.productId}`); }
        if (!note || typeof note.ruleId !== 'string' || note.policyHash !== trainingResolutionPolicy.contentHash) throw new Error(`TRAINING_EVIDENCE_POLICY_INVALID: ${record.productId}`);
      }
    }
  }
}
