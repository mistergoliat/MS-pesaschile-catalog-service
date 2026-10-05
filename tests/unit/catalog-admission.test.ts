import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { admissionSurfaces, semanticDimensions, normalizedResolutionStates, semanticObligationContract,
  computeSemanticObligationContractHash, validateSemanticObligationContract, getProductFamilyObligation,
  mapProductSemantics, mapTrainingExercise, mapTrainingFunction, mapSpecs, mapTrust, isTerminalValidResolution,
  certifyResolutionEvidence, evaluateSemanticCondition, evaluateProductAdmission, evaluateProductConsolidation,
  evaluateProductDimensions, admissionDecisionMetrics, consolidationStateMetric,
  type ProductAdmissionContext, type SemanticObligationContract, type SemanticDimensionRequirement } from '../../src/domain/catalog-admission/index.js';

const data = JSON.parse(readFileSync(new URL('../fixtures/catalog-admission/contexts.json', import.meta.url), 'utf8')) as {
  fixtures: Record<'classified' | 'training' | 'negative' | 'invalid' | 'specConflict' | 'ambiguous' | 'historical' | 'nonProduct' | 'functionOnly' | 'inactive' | 'parsedSpecs' | 'combinedEvidence', ProductAdmissionContext>;
};
const fixture = (name: keyof typeof data.fixtures): ProductAdmissionContext => structuredClone(data.fixtures[name]);
const cloneContract = (): SemanticObligationContract => structuredClone(semanticObligationContract);
const resign = (contract: SemanticObligationContract): SemanticObligationContract => ({ ...contract, contentHash: computeSemanticObligationContractHash(contract) });
const mutate = (fn: (contract: SemanticObligationContract) => void): SemanticObligationContract => { const contract = cloneContract(); fn(contract); return resign(contract); };
const newProduct = (): ProductAdmissionContext => ({ canonical: { productId: 90000001, name: 'P_NEW', catalogPresence: 'current_catalog', active: true, categoryIds: [], features: [] } });
// Counterfactual contractual exemptions are test-only. No production family receives these exemptions.
const knownContract = (): SemanticObligationContract => validateSemanticObligationContract(mutate(contract => {
  const family = contract.families.find(f => f.productFamily === 'BAND_SUSPENSION')!;
  family.dimensions = family.dimensions.map(d => d.dimension === 'PRODUCT_SEMANTICS' ? d : {
    dimension: d.dimension, requirement: 'NOT_REQUIRED', rationale: 'Explicit test-only exemption, never inferred from absent facts.', sourceReferences: ['test:reviewed-exemption'],
  });
}));

describe('semantic obligations registry integrity', () => {
  it('has 21 real provisional families, deterministic JSON-roundtrip hash and immutable content', () => {
    expect(semanticObligationContract.families).toHaveLength(21);
    expect(semanticObligationContract.families.every(f => f.status === 'PROVISIONAL')).toBe(true);
    expect(Object.isFrozen(semanticObligationContract.families[0]!.dimensions)).toBe(true);
    expect(computeSemanticObligationContractHash(cloneContract())).toBe(semanticObligationContract.contentHash);
    expect(computeSemanticObligationContractHash(JSON.parse(JSON.stringify(semanticObligationContract)))).toBe(semanticObligationContract.contentHash);
    const reversed = Object.fromEntries(Object.entries(cloneContract()).reverse()) as SemanticObligationContract;
    expect(computeSemanticObligationContractHash(reversed)).toBe(semanticObligationContract.contentHash);
    expect(validateSemanticObligationContract(cloneContract())).toEqual(semanticObligationContract);
  });
  it.each([null, undefined, 'NEW_FAMILY', 'OTHER', 'BAND'])('keeps every obligation UNKNOWN for %s', family => {
    const entry = getProductFamilyObligation(family);
    expect(entry.status).toBe('UNKNOWN');
    expect(entry.dimensions.map(d => d.requirement)).toEqual(Array(5).fill('UNKNOWN'));
  });
  it('rejects stale hashes', () => { const contract = cloneContract(); contract.families[0]!.rationale += ' changed'; expect(() => validateSemanticObligationContract(contract)).toThrow('HASH_MISMATCH'); });
  it('rejects duplicate families', () => expect(() => validateSemanticObligationContract(mutate(c => c.families.push(c.families[0]!)))).toThrow('DUPLICATE_FAMILY'));
  it('rejects REQUIRED without resolution criteria', () => expect(() => validateSemanticObligationContract(mutate(c => delete c.families[0]!.dimensions[0]!.resolutionCriteria))).toThrow());
  it.each(['rationale', 'sourceReferences'] as const)('rejects NOT_REQUIRED without %s', key => {
    const contract = knownContract(), dimension = contract.families.find(f => f.productFamily === 'BAND_SUSPENSION')!.dimensions[1]!;
    Reflect.deleteProperty(dimension, key);
    expect(() => validateSemanticObligationContract(resign(contract))).toThrow();
  });
  it('rejects UNKNOWN declaring terminal criteria and unsafe defaults', () => {
    expect(() => validateSemanticObligationContract(mutate(c => c.defaultFamily.dimensions[0]!.resolutionCriteria = c.families[0]!.dimensions[0]!.resolutionCriteria))).toThrow();
    expect(() => validateSemanticObligationContract(mutate(c => c.defaultFamily.dimensions[0]!.requirement = 'NOT_REQUIRED'))).toThrow('DEFAULT_MUST_REMAIN_UNKNOWN');
  });
  it.each([
    (c: SemanticObligationContract) => Reflect.set(c.families[0]!.dimensions[0]!, 'dimension', 'DESCRIPTION'),
    (c: SemanticObligationContract) => Reflect.set(c.families[0]!.surfacePolicies[0]!, 'surface', 'SEARCH_ALL'),
    (c: SemanticObligationContract) => c.families[0]!.dimensions[0]!.evidenceRequirement!.acceptedEvidenceKinds.push('DESCRIPTION' as never),
    (c: SemanticObligationContract) => Reflect.set(c.families[0]!.surfacePolicies[0]!, 'defaultDecision', 'ADMITTED'),
    (c: SemanticObligationContract) => Reflect.set(c.families[0]!.dimensions[1]!, 'condition', 'eval("true")'),
    (c: SemanticObligationContract) => Reflect.set(c.families[0]!.dimensions[1]!, 'condition', { kind: 'FEATURE_PRESENT', featureId: -1 }),
    (c: SemanticObligationContract) => Reflect.set(c.families[0]!.dimensions[1]!, 'condition', { kind: 'TRAINING_ASSIGNMENTS_PRESENT', dimension: 'TRAINING_FUNCTION' }),
    (c: SemanticObligationContract) => Reflect.set(c.families[0]!.dimensions[1]!, 'condition', { kind: 'SUPPORTED_SPEC_SOURCE_PRESENT' }),
  ])('rejects invalid dimensions/surfaces/evidence/static admission/conditions %#', edit => expect(() => validateSemanticObligationContract(mutate(edit))).toThrow());
  it('has only the existing CABLE_MACHINE function derivation as an unconditional Training obligation', () => {
    const required = semanticObligationContract.families.flatMap(f => f.dimensions.filter(d => d.requirement === 'REQUIRED' && d.dimension.startsWith('TRAINING')).map(d => [f.productFamily, d.resolutionCriteria!.requiredCodes]));
    expect(required).toEqual([['CABLE_MACHINE', ['CABLE_RESISTANCE']]]);
  });
  it('rejects mismatched ontology lineage, impossible scopes and unknown required assignment codes', () => {
    expect(() => validateSemanticObligationContract(mutate(c => c.ontologyHash = '0'.repeat(64)))).toThrow('CONTRACT_ONTOLOGY_HASH_MISMATCH');
    expect(() => validateSemanticObligationContract(mutate(c => c.families[0]!.dimensions[0]!.resolutionCriteria!.scope = 'TRUST_AUTHORITY'))).toThrow('IMPOSSIBLE_RESOLUTION_SCOPE');
    expect(() => validateSemanticObligationContract(mutate(c => c.families[0]!.dimensions[1]!.resolutionCriteria!.requiredCodes = ['UNKNOWN_EXERCISE']))).toThrow('UNKNOWN_REQUIRED_CODE');
  });
});

describe('projection resolution adapters', () => {
  it.each(normalizedResolutionStates)('terminality is explicit for %s', state => expect(isTerminalValidResolution(state)).toBe(['VERIFIED', 'VERIFIED_NOT_APPLICABLE'].includes(state)));
  it.each([
    ['CLASSIFIED', 'VERIFIED'], ['PARTIALLY_CLASSIFIED', 'PARTIAL'], ['OTHER', 'UNKNOWN'], ['NEEDS_REVIEW', 'AMBIGUOUS'], ['EXCLUDED_NON_PRODUCT', 'VERIFIED_NOT_APPLICABLE'],
  ] as const)('maps Product %s to %s', (status, expected) => {
    const context = fixture('classified'); context.productSemantics!.classificationStatus = status;
    expect(mapProductSemantics(context).state).toBe(expected);
  });
  it('verifies a real non-product exclusion and historical scope conflict separately', () => {
    expect(mapProductSemantics(fixture('nonProduct')).negativeEvidenceState).toBe('PRESENT');
    const context = fixture('classified'); context.productSemantics!.catalogPresence = 'historical_order_detail_only';
    expect(mapProductSemantics(context).state).toBe('SOURCE_CONFLICT');
  });
  it('does not certify weak category evidence as strong', () => {
    const context = fixture('classified'), evidence = context.productSemantics!.provenance.evidence[0]!;
    const cat = { categoryId: 123, name: 'test category' }; context.canonical!.categoryIds!.push(cat);
    context.trust!.categories = [{ categoryId: cat.categoryId, trustClass: 'SEMANTIC_WEAK' }];
    evidence.sourceType = 'TRUSTED_CATEGORY'; evidence.sourceId = String(cat.categoryId);
    expect(mapProductSemantics(context).state).toBe('PARTIAL');
    expect(evaluateProductAdmission(context, 'PRODUCT_SEMANTIC_DISCOVERY').decision).toBe('PARTIAL');
  });
  it.each(['SEMANTIC_PARTIAL', 'RULE_GAP', 'AMBIGUOUS', 'NEEDS_REVIEW', 'DATA_GAP', 'ONTOLOGY_GAP'] as const)('maps both Training dimensions for %s', status => {
    const context = fixture('training'); context.training!.resolutionState = status; context.training!.resolved = false;
    const expected = { SEMANTIC_PARTIAL: 'PARTIAL', RULE_GAP: 'PARTIAL', AMBIGUOUS: 'AMBIGUOUS', NEEDS_REVIEW: 'AMBIGUOUS', DATA_GAP: 'DATA_GAP', ONTOLOGY_GAP: 'ONTOLOGY_GAP' }[status];
    expect(mapTrainingExercise(context).state).toBe(expected); expect(mapTrainingFunction(context).state).toBe(expected);
  });
  it('splits function-only COMPLETE from exercise resolution', () => {
    const context = fixture('functionOnly');
    expect(mapTrainingFunction(context).state).toBe('VERIFIED');
    expect(mapTrainingExercise(context).state).toBe('UNKNOWN');
    expect(mapTrainingExercise(context).negativeEvidenceState).toBe('NOT_REQUIRED');
  });
  it('preserves a valid empty negative while evidence certification is incomplete', () => {
    const resolution = mapTrainingExercise(fixture('negative'));
    expect(resolution.state).toBe('VERIFIED_NOT_APPLICABLE'); expect(resolution.negativeEvidenceState).toBe('ABSENT');
    expect(isTerminalValidResolution(resolution.state)).toBe(true);
    const requirement = getProductFamilyObligation('BAND_SUSPENSION').dimensions.find(d => d.dimension === 'TRAINING_EXERCISE')!.evidenceRequirement;
    expect(certifyResolutionEvidence(resolution, requirement)).toBe(false);
  });
  it.each(['exercise', 'function'] as const)('rejects negative plus %s assignments in both dimensions', kind => {
    const context = fixture(kind === 'exercise' ? 'invalid' : 'functionOnly');
    context.training!.resolutionState = 'VERIFIED_NO_APPLICABLE_CAPABILITY'; context.training!.resolved = true;
    expect(mapTrainingExercise(context).state).toBe('INVALID_STATE'); expect(mapTrainingFunction(context).state).toBe('INVALID_STATE');
    expect(evaluateProductAdmission(context, 'TRAINING_DISCOVERY').decision).toBe('BLOCKED');
    expect(evaluateProductAdmission({ ...context, trainingDiscoveryDimension: 'TRAINING_FUNCTION' }, 'TRAINING_DISCOVERY').decision).toBe('BLOCKED');
  });
  it('rejects COMPLETE without any assignment and contradictory resolved flags', () => {
    const context = fixture('negative'); context.training!.resolutionState = 'SEMANTIC_COMPLETE';
    expect(mapTrainingExercise(context).state).toBe('INVALID_STATE'); context.training!.resolutionState = 'DATA_GAP';
    expect(mapTrainingFunction(context).state).toBe('INVALID_STATE');
  });
  it('recognizes real raw numeric conflicts after builder demotion, without mutating records', () => {
    const context = fixture('specConflict'), before = JSON.stringify(context.specs);
    expect(mapSpecs(context).state).toBe('SOURCE_CONFLICT');
    expect(mapSpecs(context).reasons.some(r => r.code === 'SPEC_SOURCE_CONFLICT')).toBe(true);
    expect(JSON.stringify(context.specs)).toBe(before);
  });
  it('distinguishes parsed, ambiguous, unsupported, missing, and unavailable Specs', () => {
    expect(mapSpecs(fixture('parsedSpecs')).state).toBe('VERIFIED'); expect(mapSpecs(fixture('ambiguous')).state).toBe('AMBIGUOUS');
    const context = fixture('parsedSpecs'); context.specs = context.specs!.map(s => ({ ...s, status: 'unsupported', value: null }));
    expect(mapSpecs(context).state).toBe('DATA_GAP'); expect(mapSpecs(context).sourceStatuses).toEqual(['UNSUPPORTED']);
    context.specs = []; expect(mapSpecs(context).state).toBe('UNKNOWN'); expect(mapSpecs(context).sourceStatuses).toEqual(['MISSING']);
    context.specs = null; expect(mapSpecs(context).state).toBe('UNAVAILABLE_PROJECTION');
  });
  it('keeps Trust publication separate from runtime authority', () => {
    const context = fixture('classified'); expect(mapTrust(context).state).toBe('PARTIAL');
    expect(mapTrust(context).warnings[0]!.code).toBe('TRUST_RUNTIME_AUTHORITY_SEPARATE');
    context.trust!.consumedByCategorySelection = true; expect(mapTrust(context).state).toBe('VERIFIED');
    context.trust!.features = []; context.canonical!.features!.push({ featureId: 999, featureValueId: 999, name: 'missing', value: 'x' });
    expect(mapTrust(context).state).toBe('DATA_GAP'); expect(mapTrust({ ...context, trust: null }).state).toBe('UNAVAILABLE_PROJECTION');
    expect(mapTrust(fixture('historical')).state).toBe('UNKNOWN');
  });
  it('rejects corrupt or duplicate trust authority definitions', () => {
    const context = fixture('classified'); context.trust!.categories.push(context.trust!.categories[0]!);
    expect(mapTrust(context).state).toBe('INVALID_STATE');
  });
  it('detects missing supported Specs keys independently of family applicability', () => {
    const context = fixture('parsedSpecs'); context.specs = [];
    const dimension = evaluateProductDimensions(context).find(d => d.dimension === 'SPECS')!;
    expect(dimension.effectiveRequirement).toBe('REQUIRED'); expect(dimension.resolution.state).toBe('DATA_GAP');
  });
  it('maps unavailable projections without making up negative resolutions', () => {
    const context = newProduct();
    expect([mapProductSemantics(context), mapTrainingExercise(context), mapTrainingFunction(context), mapSpecs(context), mapTrust(context)].every(r => r.state === 'UNAVAILABLE_PROJECTION')).toBe(true);
  });
  it('rejects cross-product projection identities and malformed schemas', () => {
    const context = fixture('classified'); context.training!.productId = 999; expect(mapTrainingExercise(context).state).toBe('INVALID_STATE');
    context.productSemantics!.productId = '999'; expect(mapProductSemantics(context).state).toBe('INVALID_STATE');
    Reflect.set(context.productSemantics!, 'classificationStatus', 'FORCED'); expect(mapProductSemantics(context).state).toBe('INVALID_STATE');
  });
});

describe('surface admission and consolidation', () => {
  it('Product Context accepts current existence independently, including inactive/invalid semantics', () => {
    for (const name of ['inactive', 'invalid', 'ambiguous', 'negative'] as const) expect(evaluateProductAdmission(fixture(name), 'PRODUCT_CONTEXT').decision).toBe('ADMITTED');
    expect(evaluateProductAdmission({ canonical: null }, 'PRODUCT_CONTEXT').decision).toBe('BLOCKED');
    expect(evaluateProductAdmission(fixture('historical'), 'PRODUCT_CONTEXT').decision).toBe('NOT_APPLICABLE');
  });
  it('Product Discovery accepts evidence-backed Product facts without requiring Training/Specs', () => {
    expect(evaluateProductAdmission(fixture('classified'), 'PRODUCT_SEMANTIC_DISCOVERY').decision).toBe('ADMITTED');
    const context = fixture('classified'); context.lineage!.productVerified = false;
    expect(evaluateProductAdmission(context, 'PRODUCT_SEMANTIC_DISCOVERY').decision).toBe('BLOCKED');
  });
  it('preserves the real guarded category + feature evidence without treating it as a bare value', () => {
    const context = fixture('combinedEvidence');
    expect(evaluateProductAdmission(context, 'PRODUCT_SEMANTIC_DISCOVERY').decision).toBe('ADMITTED');
    context.trust!.sourceHashesVerified = false;
    expect(evaluateProductAdmission(context, 'PRODUCT_SEMANTIC_DISCOVERY').decision).toBe('BLOCKED');
    context.trust!.sourceHashesVerified = true;
    context.trust!.categories = [];
    expect(evaluateProductAdmission(context, 'PRODUCT_SEMANTIC_DISCOVERY').decision).toBe('BLOCKED');
  });
  it('Training Discovery requires COMPLETE and its selected dimension; functions do not imply exercise', () => {
    expect(evaluateProductAdmission(fixture('training'), 'TRAINING_DISCOVERY').decision).toBe('ADMITTED');
    expect(evaluateProductAdmission(fixture('functionOnly'), 'TRAINING_DISCOVERY').decision).toBe('REVIEW_REQUIRED');
    expect(evaluateProductAdmission({ ...fixture('functionOnly'), trainingDiscoveryDimension: 'TRAINING_FUNCTION' }, 'TRAINING_DISCOVERY').decision).toBe('ADMITTED');
    const context = fixture('training'); context.training!.resolutionState = 'SEMANTIC_PARTIAL'; context.training!.resolved = false;
    expect(evaluateProductAdmission(context, 'TRAINING_DISCOVERY').reasons.some(r => r.code === 'TRAINING_COMPLETE_REQUIRED')).toBe(true);
  });
  it.each([['historical', 'HISTORICAL_SCOPE_EXCLUDED'], ['nonProduct', 'NON_PRODUCT_EXCLUDED']] as const)('blocks %s from both Training scopes', (name, code) => {
    const context = fixture(name);
    for (const trainingDiscoveryDimension of ['TRAINING_EXERCISE', 'TRAINING_FUNCTION'] as const) {
      const decision = evaluateProductAdmission({ ...context, trainingDiscoveryDimension }, 'TRAINING_DISCOVERY');
      expect(decision.decision).toBe('NOT_APPLICABLE'); expect(decision.reasons.some(r => r.code === code)).toBe(true);
    }
  });
  it('keeps Spec Filtering undefined even if Specs are parsed and applicability obligations known', () => {
    const decision = evaluateProductAdmission(fixture('parsedSpecs'), 'SPEC_FILTERING');
    expect(decision.decision).toBe('UNKNOWN'); expect(decision.reasons.some(r => r.code === 'SURFACE_CONTRACT_UNDEFINED')).toBe(true);
  });
  it('preserves UNKNOWN obligations and only conditionally exempts unused semantic Trust', () => {
    const dimensions = evaluateProductDimensions(fixture('classified'));
    expect(dimensions.find(d => d.dimension === 'TRAINING_EXERCISE')!.effectiveRequirement).toBe('UNKNOWN');
    expect(dimensions.find(d => d.dimension === 'SPECS')!.effectiveRequirement).toBe('UNKNOWN');
    expect(dimensions.find(d => d.dimension === 'TRUST')!.effectiveRequirement).toBe('NOT_REQUIRED');
    expect(evaluateProductAdmission(fixture('classified'), 'UNIFIED_RETRIEVAL').decision).toBe('REVIEW_REQUIRED');
    expect(evaluateSemanticCondition({ kind: 'FEATURE_PRESENT', featureId: 3 }, fixture('historical'))).toBe(null);
  });
  it('keeps lexical listing and commercial offerability tied to actual authority', () => {
    const context = fixture('classified'); expect(evaluateProductAdmission(context, 'LEXICAL_SEARCH').decision).toBe('UNKNOWN');
    context.listing = true; expect(evaluateProductAdmission(context, 'LEXICAL_SEARCH').decision).toBe('ADMITTED');
    context.listing = false; expect(evaluateProductAdmission(context, 'LEXICAL_SEARCH').decision).toBe('BLOCKED');
    expect(evaluateProductAdmission(context, 'COMMERCIAL_PURCHASE').decision).toBe('UNKNOWN');
    context.commercial = { authority: 'prestashop-v2-commercial-runtime', sellability: 'backorder', priceAvailable: true };
    expect(evaluateProductAdmission(context, 'COMMERCIAL_PURCHASE').decision).toBe('ADMITTED');
    context.commercial.priceAvailable = false; expect(evaluateProductAdmission(context, 'COMMERCIAL_PURCHASE').decision).toBe('BLOCKED');
    expect(evaluateProductAdmission(fixture('inactive'), 'COMMERCIAL_PURCHASE').decision).toBe('BLOCKED');
  });
  it('P_NEW reaches L1 but never skips UNKNOWN obligations or auto-admits to Training/Unified', () => {
    const context = newProduct(), consolidation = evaluateProductConsolidation(context);
    expect(consolidation.state).toBe('UNKNOWN_OBLIGATIONS'); expect(consolidation.highestCertifiedLevel).toBe('L1_STRUCTURALLY_VALID');
    expect(consolidation.nextBlockedLevel).toBe('L2_REQUIRED_SEMANTICALLY_RESOLVED');
    expect(consolidation.evaluatedDimensions.every(d => d.effectiveRequirement === 'UNKNOWN')).toBe(true);
    expect(evaluateProductAdmission(context, 'PRODUCT_CONTEXT').decision).toBe('ADMITTED');
    expect(evaluateProductAdmission(context, 'UNIFIED_RETRIEVAL').decision).toBe('REVIEW_REQUIRED');
    expect(evaluateProductAdmission(context, 'TRAINING_DISCOVERY').decision).toBe('BLOCKED');
  });
  it('reports malformed source data instead of evaluating impossible conditions or skipping structure', () => {
    const context = fixture('classified'); Reflect.set(context.canonical!, 'features', 'malformed');
    const result = evaluateProductConsolidation(context);
    expect(result.state).toBe('INVALID'); expect(result.highestCertifiedLevel).toBe('L0_PRESENT');
    expect(result.nextBlockedLevel).toBe('L1_STRUCTURALLY_VALID');
    expect(evaluateProductAdmission(context, 'PRODUCT_CONTEXT').decision).toBe('BLOCKED');
  });
  it('keeps Product Context independent when a present semantic projection fails its schema', () => {
    const context = fixture('classified'); Reflect.set(context.training!, 'exerciseCapabilities', null);
    expect(evaluateProductAdmission(context, 'PRODUCT_CONTEXT').decision).toBe('ADMITTED');
    expect(evaluateProductConsolidation(context).state).toBe('INVALID');
    expect(evaluateSemanticCondition({ kind: 'TRAINING_ASSIGNMENTS_PRESENT', dimension: 'TRAINING_EXERCISE' }, context)).toBe(null);
  });
  it('an explicit resolution alone never admits an unknown family to Training', () => {
    const context = fixture('training'); context.productSemantics = null;
    expect(evaluateProductAdmission(context, 'TRAINING_DISCOVERY').decision).toBe('REVIEW_REQUIRED');
    expect(evaluateProductAdmission(context, 'UNIFIED_RETRIEVAL').decision).not.toBe('ADMITTED');
  });
  it('certification levels are cumulative through evidence, cross-validation and designated surface', () => {
    const contract = knownContract(), context = fixture('classified');
    expect(evaluateProductConsolidation(context, contract).highestCertifiedLevel).toBe('L5_DESIGNATED_SURFACE_ADMITTED');
    expect(evaluateProductConsolidation(context, contract).state).toBe('CONSOLIDATED');
    context.lineage!.productVerified = false; expect(evaluateProductConsolidation(context, contract).highestCertifiedLevel).toBe('L2_REQUIRED_SEMANTICALLY_RESOLVED');
    context.lineage!.productVerified = true; context.crossProjectionIssues = [{ dimension: 'PRODUCT_SEMANTICS', code: 'CROSS_PROJECTION_CONFLICT', detail: 'explicit audited conflict' }];
    expect(evaluateProductConsolidation(context, contract).highestCertifiedLevel).toBe('L3_REQUIRED_EVIDENCE_BACKED');
    context.crossProjectionIssues = []; context.designatedSurface = 'SPEC_FILTERING';
    expect(evaluateProductConsolidation(context, contract).highestCertifiedLevel).toBe('L4_REQUIRED_CROSS_VALIDATED');
    const levels = evaluateProductConsolidation(context, contract).levels.map(l => l.certified);
    expect(levels).toEqual([true, true, true, true, true, false]);
  });
  it('can certify an explicitly required, evidence-backed negative without converting absence to exemption', () => {
    const contract = knownContract(), family = contract.families.find(f => f.productFamily === 'BAND_SUSPENSION')!;
    const exercise = getProductFamilyObligation('BAND_SUSPENSION').dimensions.find(d => d.dimension === 'TRAINING_EXERCISE')!;
    const { condition: _condition, whenFalse: _whenFalse, ...criteria } = exercise;
    family.dimensions[1] = { ...criteria, requirement: 'REQUIRED' } satisfies SemanticDimensionRequirement;
    const context = fixture('negative');
    expect(evaluateProductConsolidation(context, resign(contract)).highestCertifiedLevel).toBe('L2_REQUIRED_SEMANTICALLY_RESOLVED');
    context.training!.resolutionEvidence = [{ kind: 'MANUAL_OVERRIDE', sourceId: 'test:reviewed-negative-1', note: 'Explicit fixture-only reviewed negative' }];
    const result = evaluateProductConsolidation(context, resign(contract));
    expect(result.state).toBe('CONSOLIDATED_WITH_NOT_APPLICABLE'); expect(result.highestCertifiedLevel).toBe('L5_DESIGNATED_SURFACE_ADMITTED');
  });
  it('invalid Training remains visible even alongside unknown obligations', () => {
    const result = evaluateProductConsolidation(fixture('invalid')); expect(result.state).toBe('INVALID');
    expect(result.highestCertifiedLevel).toBe('L1_STRUCTURALLY_VALID');
    expect(evaluateProductConsolidation(fixture('specConflict')).state).toBe('BLOCKED_BY_CONFLICT');
  });
  it('is deterministic and leaves caller facts intact for every surface', () => {
    for (const context of Object.values(data.fixtures)) {
      const before = JSON.stringify(context);
      for (const surface of admissionSurfaces) expect(evaluateProductAdmission(context, surface)).toEqual(evaluateProductAdmission(context, surface));
      expect(evaluateProductConsolidation(context)).toEqual(evaluateProductConsolidation(context));
      expect(JSON.stringify(context)).toBe(before);
    }
  });
  it('exports typed, bounded metric labels without product identities', () => {
    const context = fixture('invalid'), decision = evaluateProductAdmission(context, 'TRAINING_DISCOVERY');
    for (const metric of admissionDecisionMetrics(decision)) expect(Object.keys(metric.labels).sort()).toEqual(['decision', 'reason', 'surface']);
    const metric = consolidationStateMetric(evaluateProductConsolidation(context), 'arbitrary-new-family');
    expect(metric.labels.family).toBe('UNKNOWN'); expect(Object.keys(metric.labels).sort()).toEqual(['family', 'state']);
    expect(semanticDimensions).toHaveLength(5);
  });
});
