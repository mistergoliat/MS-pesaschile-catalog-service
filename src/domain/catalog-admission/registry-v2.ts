import { deepFreeze, getOntologyTagsForAxis } from '../commercial-product-ontology/index.js';
import { trainingSemanticRuleCatalog } from '../training-semantic-classification/rules.js';
import { semanticObligationContract, computeSemanticObligationContractHash, validateSemanticObligationContract } from './registry.js';
import { semanticObligationContractV2Schema, supportedSpecKeys, supportedSpecSources, type SemanticObligationContractV2,
  type FamilyObligationV2, type DimensionRequirementV2 } from './contracts-v2.js';

const doc = 'docs/catalog-v2/P2_3B_FAMILY_APPLICABILITY_AND_OBLIGATIONS.md';
const trainingPolicy = 'docs/design/training-semantics/a00.6.4/training-semantic-ontology-expansion.md#general-equipment-family-adjudication';
const specSource = 'src/domain/catalog/projection-bundle.ts#buildSpecs';
// These exact rows explicitly reject generic family functions. They do not exempt positive source rules.
const noGenericFunction = new Set(['BARBELL', 'DUMBBELL', 'KETTLEBELL', 'WEIGHT_PLATE', 'BENCH', 'BAND_SUSPENSION', 'ROPE_SLED', 'MACHINE_ATTACHMENT']);
export function familyObligationStatus(family: FamilyObligationV2): 'ACTIVE' | 'PROVISIONAL' {
  const unresolved = [...family.dimensions, ...family.specRequirements].some(d => d.requirement === 'UNKNOWN'
    || d.requirement === 'CONDITIONAL' && d.whenFalse === 'UNKNOWN');
  return unresolved ? 'PROVISIONAL' : 'ACTIVE';
}
export function validateSemanticObligationContractV2(value: unknown): SemanticObligationContractV2 {
  const c = semanticObligationContractV2Schema.parse(value);
  if (c.contentHash !== computeSemanticObligationContractHash(c)) throw new Error('OBLIGATION_CONTRACT_HASH_MISMATCH');
  if ([...c.families, c.defaultFamily].some(f => f.dimensions.some(d => d.condition?.kind === 'TRAINING_ASSIGNMENTS_PRESENT'))) throw new Error('CIRCULAR_TRAINING_APPLICABILITY');
  // Reuse v1's ontology, scope, code and complete-dimension/surface checks without changing v1.
  const legacy = { ...c, schemaVersion: '1' as const, families: [...c.families, c.defaultFamily].map(f => {
    const { specRequirements: _specs, ...base } = f;
    return { ...base, dimensions: f.dimensions.map(d => {
      const { requiresNegativeEvidence: _negative, negativeEvidenceRationale: _rationale, ...dimension } = d;
      if (dimension.condition?.kind === 'TRAINING_SOURCE_RULE_MATCHES') dimension.condition = { kind: 'TRAINING_ASSIGNMENTS_PRESENT', dimension: dimension.condition.dimension };
      if (dimension.condition?.kind === 'SPEC_SOURCE_PRESENT') throw new Error('SPEC_SOURCE_CONDITION_ONLY_FOR_KEYS');
      return dimension;
    }) };
  }) };
  const defaultFamily = legacy.families.pop()!;
  const payload = { ...legacy, defaultFamily };
  validateSemanticObligationContract({ ...payload, contentHash: computeSemanticObligationContractHash(payload) });
  const codes = getOntologyTagsForAxis('PRODUCT_FAMILY', c.ontologyVersion as 'commercial-product-ontology-v3').filter(t => !t.residual).map(t => t.code).sort();
  if (JSON.stringify(c.families.map(f => f.productFamily).sort()) !== JSON.stringify(codes)) throw new Error('ALL_ONTOLOGY_FAMILIES_REQUIRED');
  for (const f of [...c.families, c.defaultFamily]) {
    if (f !== c.defaultFamily && f.status !== familyObligationStatus(f)) throw new Error('FAMILY_STATUS_CRITERIA');
    if (f !== c.defaultFamily && f.status === 'UNKNOWN') throw new Error('RECOGNIZED_FAMILY_CANNOT_BE_UNKNOWN');
    if (f.specRequirements.length !== supportedSpecKeys.length || new Set(f.specRequirements.map(s => s.specKey)).size !== supportedSpecKeys.length) throw new Error('SPEC_KEYS_MUST_BE_COMPLETE_UNIQUE');
    if (f.dimensions.some(d => d.dimension === 'SPECS' && d.requirement === 'REQUIRED') && !f.specRequirements.some(s => s.requirement === 'REQUIRED')) throw new Error('REQUIRED_SPECS_NEED_EXPLICIT_KEYS');
    for (const d of f.dimensions) {
      if (d.condition?.kind === 'TRAINING_SOURCE_RULE_MATCHES' && d.condition.dimension !== d.dimension) throw new Error('IMPOSSIBLE_TRAINING_CONDITION');
    }
    for (const s of f.specRequirements) {
      if (new Set(s.acceptedSourceIds).size !== s.acceptedSourceIds.length || s.acceptedSourceIds.some(id => !supportedSpecSources[s.specKey].includes(id))) throw new Error('UNSUPPORTED_SPEC_SOURCE');
      if (s.condition && (s.condition.kind !== 'SPEC_SOURCE_PRESENT' || JSON.stringify(s.condition.sourceIds) !== JSON.stringify(s.acceptedSourceIds))) throw new Error('IMPOSSIBLE_SPEC_CONDITION');
      if (s.requiresNegativeEvidence) throw new Error('NUMERIC_SPECS_HAVE_NO_NEGATIVE_TERMINAL');
    }
    if (f === c.defaultFamily && f.specRequirements.some(s => s.requirement !== 'UNKNOWN')) throw new Error('DEFAULT_MUST_REMAIN_UNKNOWN');
    if (f.status === 'ACTIVE' && f.surfacePolicies.some(p => ['SPEC_FILTERING', 'UNIFIED_RETRIEVAL'].includes(p.surface) && (p.status !== 'ACTIVE' || p.defaultDecision !== 'EVALUATE'))) throw new Error('ACTIVE_SURFACE_EFFECTS_UNDEFINED');
  }
  return c;
}
const families: FamilyObligationV2[] = semanticObligationContract.families.map(f => {
  const dimensions: DimensionRequirementV2[] = f.dimensions.map(d => {
    let dimension: DimensionRequirementV2 = { ...d, requiresNegativeEvidence: d.evidenceRequirement?.requiresNegativeEvidence ?? false,
      negativeEvidenceRationale: 'Assigned below.' };
    if (d.dimension.startsWith('TRAINING_') && d.requirement === 'CONDITIONAL') {
      const exercise = d.dimension === 'TRAINING_EXERCISE';
      const exemption = exercise ? (trainingSemanticRuleCatalog.nonApplicableFamilies as readonly string[]).includes(f.productFamily) : noGenericFunction.has(f.productFamily);
      dimension = { ...d, condition: { kind: 'TRAINING_SOURCE_RULE_MATCHES', dimension: d.dimension as 'TRAINING_EXERCISE' | 'TRAINING_FUNCTION' },
        whenFalse: exemption ? 'NOT_REQUIRED' : 'UNKNOWN',
        rationale: `Explicit accepted source rule activates the modeled ${exercise ? 'exercise' : 'function'} obligation before content evaluation. ${exemption ? 'The existing family policy exempts the generic obligation when no accepted source rule applies.' : 'No rule hit is not proof of exemption for this family; applicability remains unknown.'}`,
        sourceReferences: ['src/domain/training-semantic-classification/rules.ts#trainingSemanticRuleCatalog', 'src/domain/training-semantic-classification-v2/rules.ts#trainingSemanticV2RuleCatalog',
          'src/domain/training-semantic-classification-v2-1/rules.ts#trainingSemanticV21EnrichmentCatalog', ...(exercise ? ['src/domain/training-semantic-classification/classifier.ts#determineCoverageStatus'] : [trainingPolicy]), doc],
      } as DimensionRequirementV2;
    }
    const requiresNegativeEvidence = d.dimension !== 'SPECS' && !!d.resolutionCriteria?.terminalStates.includes('VERIFIED_NOT_APPLICABLE') && (d.evidenceRequirement?.requiresNegativeEvidence ?? false);
    return { ...dimension, ...(dimension.evidenceRequirement ? { evidenceRequirement: { ...dimension.evidenceRequirement, requiresNegativeEvidence } } : {}),
      ...(d.dimension === 'SPECS' && dimension.resolutionCriteria ? { resolutionCriteria: { ...dimension.resolutionCriteria, terminalStates: ['VERIFIED'] as const } } : {}),
      requiresNegativeEvidence,
      negativeEvidenceRationale: requiresNegativeEvidence ? 'A negative terminal offered to satisfy an active positive obligation needs an accepted source; no negative fact is demanded for contractual exemption.' : 'This dimension has no negative terminal to certify; contractual exemption does not assert a negative fact.' };
  });
  const result: FamilyObligationV2 = { ...f, dimensions, specRequirements: supportedSpecKeys.map(specKey => ({
    specKey, requirement: 'CONDITIONAL', condition: { kind: 'SPEC_SOURCE_PRESENT', sourceIds: [...supportedSpecSources[specKey]] }, whenFalse: 'NOT_REQUIRED', acceptedSourceIds: [...supportedSpecSources[specKey]],
    rationale: 'Only the supported normalization promise is in scope for this key: every present accepted source must publish a valid bound numeric fact. No source means this normalization promise is inactive; it does not exempt unknown family-wide technical needs.',
    sourceReferences: [specSource, 'docs/architecture/CAT-V2-P1.3-projection-bundle.md#initial-spec-projection', doc], requiresNegativeEvidence: false,
    negativeEvidenceRationale: 'Numeric normalization has no VERIFIED_NOT_APPLICABLE terminal; an inactive source promise is a contract decision.',
  })), surfacePolicies: f.surfacePolicies.map(p => p.surface === 'SPEC_FILTERING' ? { ...p, status: 'ACTIVE', defaultDecision: 'EVALUATE', excludeNonProduct: true,
    rationale: 'Offline filtering may evaluate explicitly selected supported keys whose source promise is active, independently of unknown global Specs applicability.', sourceReferences: [specSource, doc] } : p),
    rationale: 'Source-based Training applicability and key-level Specs promises; unresolved family-wide requirements stay explicit.', sourceReferences: [...f.sourceReferences, trainingPolicy, specSource, doc] };
  result.status = familyObligationStatus(result);
  return result;
});
const defaultFamily: FamilyObligationV2 = { ...semanticObligationContract.defaultFamily,
  surfacePolicies: semanticObligationContract.defaultFamily.surfacePolicies.map(p => p.surface === 'SPEC_FILTERING' ? { ...p, excludeNonProduct: true,
    rationale: 'Unrecognized family filtering stays undefined; historical and non-product scope exclusions apply before applicability evaluation.', sourceReferences: [...p.sourceReferences, doc] } : p),
  dimensions: semanticObligationContract.defaultFamily.dimensions.map(d => ({ ...d, requiresNegativeEvidence: false, negativeEvidenceRationale: 'No known obligation to demand negative evidence.' })),
  specRequirements: supportedSpecKeys.map(specKey => ({ specKey, requirement: 'UNKNOWN', acceptedSourceIds: [...supportedSpecSources[specKey]], rationale: 'Unrecognized family has no key-level applicability contract.', sourceReferences: [doc], requiresNegativeEvidence: false, negativeEvidenceRationale: 'Applicability is unknown.' })),
};
const content = { ...semanticObligationContract, schemaVersion: '2' as const, contractVersion: 'semantic-obligations-v2', families, defaultFamily };
export const semanticObligationContractV2 = deepFreeze(validateSemanticObligationContractV2({ ...content, contentHash: computeSemanticObligationContractHash(content) }));
export function contractInformationBurden(family: FamilyObligationV2) {
  const facts = [...family.dimensions.filter(d => d.dimension !== 'SPECS'), ...family.specRequirements];
  // Current evidence establishes conditional normalization only, never universal numeric minima.
  const ungroundedUniversalSpecs = family.specRequirements.some(s => s.requirement === 'REQUIRED');
  return { requiredFactCount: facts.filter(d => d.requirement === 'REQUIRED').length,
    conditionalFactCount: facts.filter(d => d.requirement === 'CONDITIONAL').length,
    unknownRequirementCount: [...family.dimensions, ...family.specRequirements].filter(d => d.requirement === 'UNKNOWN' || d.requirement === 'CONDITIONAL' && d.whenFalse === 'UNKNOWN').length,
    flags: ungroundedUniversalSpecs || facts.some(d => ['REQUIRED', 'NOT_REQUIRED'].includes(d.requirement) && !d.sourceReferences.length) ? ['POTENTIAL_OVERCONSTRAINT'] : [] };
}
