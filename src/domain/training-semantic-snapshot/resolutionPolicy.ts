import { trainingSemanticClassifierV21RulesHash, trainingSemanticClassifierV21Version } from '../training-semantic-classification-v2-1/index.js';
import { getTrainingSemanticRegistryV2 } from '../training-semantics-v2/index.js';
import { semanticObligationContractV2 } from '../catalog-admission/registry-v2.js';
import { hashTrainingSnapshotCanonical } from './canonicalJson.js';
import { trainingNegativeRuleCatalog } from '../training-semantic-classification/classifier.js';

const content = {
  version: 'training-resolution-policy-p2.3c-fix2-v1', builderVersion: 'training-semantic-builder-p2.3c-fix2-v1',
  previousPolicy: 'accepted-a00.6.7', previousPolicyFile: 'docs/audits/training-semantics/a00.6.7/post-closure-resolution-active.csv',
  reasonForChange: 'Require discriminating barbell-support evidence; suppress sold passive cable parts; retain unproven cable accessory modules as DATA_GAP instead of accepting V1 accessory wording as negative proof. Rebuild from frozen source without Product or V1 changes.',
  classifierVersion: trainingSemanticClassifierV21Version, classifierRulesHash: trainingSemanticClassifierV21RulesHash,
  registryHash: getTrainingSemanticRegistryV2().registryHash, obligationContractHash: semanticObligationContractV2.contentHash,
  negativeRules: trainingNegativeRuleCatalog,
  rules: {
    reconciliation: 'source missing -> DATA_GAP; review -> AMBIGUOUS; only deferred concepts outside ACTIVE vocabulary and explicit forbidden semantic boundaries may imply ONTOLOGY_GAP; assignments not reproduced -> DATA_GAP; missing source-required code -> RULE_GAP; empty unproven content -> DATA_GAP; otherwise surviving evaluated facts -> SEMANTIC_COMPLETE',
    assignmentPrecision: 'Material is not mechanism; passive attachment and host names are not own resistance/support; mixed category needs specificity; Product family derivation needs independent provenance; rejected rule evidence alone cannot create ontology gaps.',
    excludedAccessory: 'An accessory with forbidden generic deferred training language and no surviving ACTIVE facts stays DATA_GAP; exclusion cannot certify a negative or imply missing ontology.',
    validNegative: 'Preserve empty historical negative; evidence only from reproducible classifier negative rule; absence is not failure.',
    derivation: 'REQUIRED dimension + verified primary-family source (other Product axes may be partial) + ACTIVE registry family mapping + existing classifier rule; no exercise family inference.',
    unknown: 'Family applicability remains semantic-obligations-v2; content completeness never upgrades family obligations.',
    negativeEvidenceScope: 'Modeled snapshot coverage only; CLASSIFIER_NEGATIVE_RULE is not accepted admission evidence for a positive obligation.',
    cableAccessory: 'Sold passive cable parts may certify modeled negatives; accessory cable modules without explicit mechanism remain DATA_GAP even with own load, sleeve or structural evidence. No positive mechanism inferred from load or dimensions.',
    barbellSupport: 'Rack token alone is insufficient; require explicit open-support name, strong category or own barbell-support feature; retain Body Pump rack ambiguity.',
  },
};
export const trainingResolutionPolicy = Object.freeze({ ...content, contentHash: `sha256:${hashTrainingSnapshotCanonical(content)}` });
