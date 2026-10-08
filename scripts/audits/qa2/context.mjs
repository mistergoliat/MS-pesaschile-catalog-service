// Pure helpers that evaluate the authoritative Admission code on candidate records. No I/O on import.
import { evaluateAdmissionSnapshot, semanticObligationContractV2 } from '../../../src/domain/catalog-admission/index.ts';

export function admissionContext(L, p) {
  const trust = { categories: L.categories.map(r => ({ categoryId: Number(r.categoryId), trustClass: r.trustClass })),
    features: L.features.map(r => ({ featureId: Number(r.featureId), trustClass: r.trustClass })), sourceHashesVerified: true, consumedByCategorySelection: false };
  const specs = (L.specGroups.get(p.productId) ?? []).map(({ _index, ...r }) => r);
  return { canonical: p, productSemantics: L.product.get(p.productId), training: L.v2.get(p.productId), specs, trust,
    lineage: { productVerified: true, trainingVerified: true, specsVerified: true } };
}

export function evaluateAdmission(L, p) {
  const e = evaluateAdmissionSnapshot(admissionContext(L, p), semanticObligationContractV2);
  const dims = Object.fromEntries(e.consolidation.evaluatedDimensions.map(d => [d.dimension, d]));
  return {
    unified: e.admission.UNIFIED_RETRIEVAL.decision,
    surfaces: { product: e.admission.PRODUCT_SEMANTIC_DISCOVERY.decision, exercise: e.admission.TRAINING_DISCOVERY.decision, function: e.functionDiscovery.decision, specs: e.admission.SPEC_FILTERING.decision },
    specFilteringByKey: Object.fromEntries(Object.entries(e.specFilteringByKey).map(([k, v]) => [k, v.decision])),
    consolidation: e.consolidation.state,
    obligations: Object.fromEntries(Object.entries(dims).map(([k, d]) => [k, { effectiveRequirement: d.effectiveRequirement, resolution: d.resolution.state,
      evidenceCertified: d.evidenceCertified, terminalValid: d.terminalValid, negativeEvidenceState: d.resolution.negativeEvidenceState ?? null,
      reasons: d.reasons.map(r => r.code) }])),
    productDiscoveryReasons: e.admission.PRODUCT_SEMANTIC_DISCOVERY.reasons.map(r => r.code),
    functionDiscoveryReasons: e.functionDiscovery.reasons.map(r => r.code),
    contractHash: semanticObligationContractV2.contentHash,
  };
}
