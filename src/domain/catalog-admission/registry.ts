import { getOntologyTagsForAxis, getCommercialProductOntologyRegistry, computeCommercialProductOntologyRegistryHash, deepFreeze } from '../commercial-product-ontology/index.js';
import { getTrainingSemanticRegistryV2 } from '../training-semantics-v2/index.js';
import { sha256Stable } from '../../shared/checksum.js';
import type { AdmissionContract } from './contracts-v2.js';
import { semanticObligationContractSchema, semanticDimensions, admissionSurfaces, type SemanticObligationContract,
  type SemanticDimensionRequirement, type EvidenceRequirement, type SurfaceAdmissionPolicy, type ProductFamilyObligation } from './contracts.js';

const productSource = 'src/domain/product-semantic-classification/classifier.ts#determineStatus';
const trainingSource = 'src/domain/training-semantic-snapshot/v2-contracts.ts';
const specsSource = 'src/domain/catalog/projection-bundle.ts#buildSpecs';
const contractSource = 'docs/catalog-v2/P2_3A_SEMANTIC_OBLIGATIONS_AND_ADMISSION.md';
const evidence: EvidenceRequirement = { acceptedEvidenceKinds: ['NAME_TEXT', 'NAME', 'STRUCTURED_FEATURE', 'TRUSTED_CATEGORY', 'FAMILY_INFERENCE', 'FAMILY_DERIVATION', 'MANUAL_OVERRIDE'],
  minimumEvidenceStrength: 'STRONG', requiresNegativeEvidence: true };
const surface = (surface: SurfaceAdmissionPolicy['surface'], requiredDimensions: SurfaceAdmissionPolicy['requiredDimensions'], rationale: string,
  source: string, options: Partial<SurfaceAdmissionPolicy> = {}): SurfaceAdmissionPolicy => ({ surface, requiredDimensions, status: 'ACTIVE',
  requireKnownGlobalObligations: false, currentOnly: true, excludeNonProduct: false, defaultDecision: 'EVALUATE', rationale, sourceReferences: [source, contractSource], ...options });
export const surfacePolicies: readonly SurfaceAdmissionPolicy[] = deepFreeze([
  surface('LEXICAL_SEARCH', [], 'Existing lexical scope: current active and listed; no semantic completeness prerequisite.', 'src/application/catalog/v2/catalogContractService.ts#search'),
  surface('PRODUCT_CONTEXT', [], 'Current product existence permits context, including inactive and incomplete semantics.', 'src/application/catalog/v2/catalogContractService.ts#getProductContext'),
  surface('COMMERCIAL_PURCHASE', [], 'Only live Commercial Truth can establish priced offerable units; active alone never does.', 'src/domain/catalog/v2/commercialEngine.ts#deriveSellability'),
  surface('PRODUCT_SEMANTIC_DISCOVERY', ['PRODUCT_SEMANTICS'], 'Current non-product exclusion and evidence-backed family/facts; preserves conservative audit scope.',
    'src/application/catalog/semantic-discovery/defaultSemanticDiscoveryService.ts#addProductFacts', { excludeNonProduct: true }),
  surface('TRAINING_DISCOVERY', ['TRAINING_EXERCISE'], 'Explicit COMPLETE plus resolved exercise; function queries select TRAINING_FUNCTION separately. Current/non-product gates are admission decisions, not query edits.',
    'src/application/catalog/training-semantic-query/defaultTrainingSemanticQueryService.ts#buildIndex', { excludeNonProduct: true }),
  surface('SPEC_FILTERING', ['SPECS'], 'No family spec-filter applicability/admission contract; supported-source validation does not establish one.', specsSource,
    { status: 'UNDEFINED', defaultDecision: 'UNKNOWN' }),
  surface('UNIFIED_RETRIEVAL', [...semanticDimensions], 'All obligations must be known, terminal, evidence-backed and cross-validated; no universal relationship/capability requirement.',
    contractSource, { requireKnownGlobalObligations: true, excludeNonProduct: true }),
]);
const unknownDimension = (dimension: SemanticDimensionRequirement['dimension']): SemanticDimensionRequirement => ({ dimension, requirement: 'UNKNOWN',
  rationale: 'No sufficiently grounded obligation for this unrecognized/residual family. Unknown is never an exemption.', sourceReferences: [contractSource] });
const defaultFamily: ProductFamilyObligation = { productFamily: 'UNKNOWN', dimensions: semanticDimensions.map(unknownDimension),
  surfacePolicies: [...surfacePolicies], status: 'UNKNOWN', rationale: 'Conservative default for absent, new and residual families.', sourceReferences: [contractSource] };
const requirementsForFamily = (family: string): SemanticDimensionRequirement[] => {
  const base: SemanticDimensionRequirement[] = [
    { dimension: 'PRODUCT_SEMANTICS', requirement: 'REQUIRED', resolutionCriteria: { terminalStates: ['VERIFIED', 'VERIFIED_NOT_APPLICABLE'], scope: 'PRODUCT_FAMILY_AND_EMITTED_TAGS' },
      evidenceRequirement: { ...evidence, acceptedEvidenceKinds: ['NAME_TEXT', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'FAMILY_INFERENCE'] },
      rationale: 'A recognized family and every emitted Product fact must satisfy its existing ontology/evidence contract; empty optional axes are not declared negative.', sourceReferences: [productSource, 'src/domain/product-semantic-snapshot/defaultSnapshotBuilder.ts', contractSource] },
    ...(['TRAINING_EXERCISE', 'TRAINING_FUNCTION'] as const).map(dimension => ({ dimension, requirement: 'CONDITIONAL' as const,
      condition: { kind: 'TRAINING_ASSIGNMENTS_PRESENT' as const, dimension }, whenFalse: 'UNKNOWN' as const,
      resolutionCriteria: { terminalStates: ['VERIFIED', 'VERIFIED_NOT_APPLICABLE'] as ('VERIFIED' | 'VERIFIED_NOT_APPLICABLE')[], scope: 'MODELED_ASSIGNMENTS' as const },
      evidenceRequirement: { ...evidence, acceptedEvidenceKinds: dimension === 'TRAINING_EXERCISE'
        ? ['NAME', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'MANUAL_OVERRIDE'] as EvidenceRequirement['acceptedEvidenceKinds']
        : ['NAME', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'FAMILY_DERIVATION', 'MANUAL_OVERRIDE'] as EvidenceRequirement['acceptedEvidenceKinds'] },
      rationale: 'Published modeled assignments require certification. No assignments establishes neither inapplicability nor an exercise/function obligation for the family.',
      sourceReferences: [trainingSource, 'src/domain/training-semantics-v2/contracts.ts', contractSource] })),
    { dimension: 'SPECS', requirement: 'CONDITIONAL', condition: { kind: 'SUPPORTED_SPEC_SOURCE_PRESENT' }, whenFalse: 'UNKNOWN',
      resolutionCriteria: { terminalStates: ['VERIFIED', 'VERIFIED_NOT_APPLICABLE'], scope: 'SUPPORTED_SPEC_SOURCES' },
      evidenceRequirement: { ...evidence, acceptedEvidenceKinds: ['STRUCTURED_FEATURE'] },
      rationale: 'Existing supported source features must resolve the numeric facts buildSpecs promises to publish. This does not assert exhaustive technical attributes by fitness knowledge. Absence leaves applicability unknown.', sourceReferences: [specsSource, contractSource] },
    { dimension: 'TRUST', requirement: 'CONDITIONAL', condition: { kind: 'TRUST_EVIDENCE_USED' }, whenFalse: 'NOT_REQUIRED',
      resolutionCriteria: { terminalStates: ['VERIFIED'], scope: 'TRUST_AUTHORITY' }, evidenceRequirement: { ...evidence, requiresNegativeEvidence: false },
      rationale: 'Category/structured-feature evidence requires verified trust authority. Name-only rules explicitly operate independently of trust maps; exemption applies to unused semantic trust, never to unknown sources.',
      sourceReferences: ['src/domain/product-semantic-classification/product-family-rules.ts', 'src/domain/catalog/runtime-authority-contract.ts', contractSource] },
  ];
  const mapping = getTrainingSemanticRegistryV2().familyTrainingFunctionDerivations.filter(d => d.productFamily === family && d.status === 'ACTIVE');
  if (mapping.length) {
    const { condition: _condition, whenFalse: _whenFalse, ...functionRequirement } = base[2]!;
    base[2] = { ...functionRequirement, requirement: 'REQUIRED',
    resolutionCriteria: { terminalStates: ['VERIFIED'], scope: 'MODELED_ASSIGNMENTS', requiredCodes: mapping.map(d => d.trainingFunctionCode) },
    rationale: mapping.map(d => d.rationale).join(' '), sourceReferences: ['src/domain/training-semantics-v2/registry.ts#familyTrainingFunctionDerivations', contractSource] };
  }
  return base;
};
export function computeSemanticObligationContractHash(contract: object & { contentHash?: string }): string {
  const { contentHash: _hash, ...content } = contract as SemanticObligationContract;
  return `sha256:${sha256Stable(JSON.parse(JSON.stringify(content)))}`;
}
export function validateSemanticObligationContract(value: unknown): SemanticObligationContract {
  const contract = semanticObligationContractSchema.parse(value);
  if (contract.contentHash !== computeSemanticObligationContractHash(contract)) throw new Error('OBLIGATION_CONTRACT_HASH_MISMATCH');
  const names = contract.families.map(f => f.productFamily);
  if (new Set(names).size !== names.length) throw new Error('DUPLICATE_FAMILY');
  if (names.includes(contract.defaultFamily.productFamily)) throw new Error('DEFAULT_FAMILY_COLLISION');
  if (contract.ontologyVersion !== 'commercial-product-ontology-v1' && contract.ontologyVersion !== 'commercial-product-ontology-v2' && contract.ontologyVersion !== 'commercial-product-ontology-v3') throw new Error('UNKNOWN_CONTRACT_ONTOLOGY');
  const ontology = getCommercialProductOntologyRegistry(contract.ontologyVersion);
  if (computeCommercialProductOntologyRegistryHash(ontology) !== contract.ontologyHash) throw new Error('CONTRACT_ONTOLOGY_HASH_MISMATCH');
  for (const family of [...contract.families, contract.defaultFamily]) {
    if (new Set(family.dimensions.map(d => d.dimension)).size !== semanticDimensions.length
      || family.dimensions.length !== semanticDimensions.length) throw new Error('DIMENSIONS_MUST_BE_UNIQUE_AND_COMPLETE');
    if (new Set(family.surfacePolicies.map(p => p.surface)).size !== admissionSurfaces.length
      || family.surfacePolicies.length !== admissionSurfaces.length) throw new Error('SURFACES_MUST_BE_UNIQUE_AND_COMPLETE');
    for (const d of family.dimensions) {
      const scope = { PRODUCT_SEMANTICS: 'PRODUCT_FAMILY_AND_EMITTED_TAGS', TRAINING_EXERCISE: 'MODELED_ASSIGNMENTS', TRAINING_FUNCTION: 'MODELED_ASSIGNMENTS', SPECS: 'SUPPORTED_SPEC_SOURCES', TRUST: 'TRUST_AUTHORITY' }[d.dimension];
      if (d.resolutionCriteria && d.resolutionCriteria.scope !== scope) throw new Error('IMPOSSIBLE_RESOLUTION_SCOPE');
      if (d.condition?.kind === 'TRAINING_ASSIGNMENTS_PRESENT' && d.condition.dimension !== d.dimension) throw new Error('IMPOSSIBLE_TRAINING_CONDITION');
      if (d.condition?.kind === 'SUPPORTED_SPEC_SOURCE_PRESENT' && d.dimension !== 'SPECS') throw new Error('IMPOSSIBLE_SPEC_CONDITION');
      if (d.condition?.kind === 'TRUST_EVIDENCE_USED' && d.dimension !== 'TRUST') throw new Error('IMPOSSIBLE_TRUST_CONDITION');
      if (d.resolutionCriteria?.requiredCodes?.some(code => d.dimension === 'TRAINING_FUNCTION' ? !getTrainingSemanticRegistryV2().trainingFunctions.some(f => f.code === code)
        : d.dimension === 'TRAINING_EXERCISE' ? !getTrainingSemanticRegistryV2().exerciseCapabilities.some(e => e.code === code) : true)) throw new Error('UNKNOWN_REQUIRED_CODE');
    }
    for (const p of family.surfacePolicies) if (new Set(p.requiredDimensions).size !== p.requiredDimensions.length) throw new Error('DUPLICATE_SURFACE_DIMENSION');
  }
  if (contract.defaultFamily.status !== 'UNKNOWN' || contract.defaultFamily.dimensions.some(d => d.requirement !== 'UNKNOWN')) throw new Error('DEFAULT_MUST_REMAIN_UNKNOWN');
  return contract;
}
const ontology = getCommercialProductOntologyRegistry('commercial-product-ontology-v3');
const content: Omit<SemanticObligationContract, 'contentHash'> = {
  schemaVersion: '1', contractVersion: 'semantic-obligations-v1', ontologyVersion: ontology.registryVersion,
  ontologyHash: computeCommercialProductOntologyRegistryHash(ontology),
  families: getOntologyTagsForAxis('PRODUCT_FAMILY', 'commercial-product-ontology-v3').filter(t => !t.residual).map(t => ({
    productFamily: t.code, dimensions: requirementsForFamily(t.code), surfacePolicies: [...surfacePolicies], status: 'PROVISIONAL',
    rationale: 'Existing family; only emitted facts/supported-source obligations are grounded. Absent training/spec applicability remains explicitly unknown.',
    sourceReferences: ['src/domain/commercial-product-ontology/product-family-tags-v3.ts', productSource, contractSource],
  })), defaultFamily,
};
export const semanticObligationContract: SemanticObligationContract = deepFreeze(validateSemanticObligationContract({ ...content, contentHash: computeSemanticObligationContractHash(content) }));
export function getProductFamilyObligation(family: string | null | undefined, contract: AdmissionContract = semanticObligationContract): AdmissionContract['families'][number] {
  return contract.families.find(f => f.productFamily === family) ?? contract.defaultFamily;
}
