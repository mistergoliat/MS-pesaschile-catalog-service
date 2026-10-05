import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { semanticObligationContract, semanticObligationContractV2, supportedSpecKeys, getProductFamilyObligation,
  validateSemanticObligationContractV2, computeSemanticObligationContractHash, familyObligationStatus,
  evaluateProductDimensions, evaluateSpecRequirements, evaluateProductConsolidation, evaluateProductAdmission,
  evaluateSemanticCondition, trainingSourceObligations, mapSpecs, mapTrainingExercise, type AdmissionContextV2,
  contractInformationBurden, evaluateAdmissionSnapshot, admissionSurfaces, type FamilyObligationV2, type SemanticObligationContractV2 } from '../../src/domain/catalog-admission/index.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/catalog-admission/contexts.json', import.meta.url), 'utf8')).fixtures as Record<string, AdmissionContextV2>;
const fixture = (key: string): AdmissionContextV2 => structuredClone(fixtures[key]!);
const contract = semanticObligationContractV2;
const family = (code: string): FamilyObligationV2 => contract.families.find(f => f.productFamily === code)!;
const resign = (c: SemanticObligationContractV2) => ({ ...c, contentHash: computeSemanticObligationContractHash(c) });
const newProduct = (code?: string): AdmissionContextV2 => ({ canonical: { productId: 90000001, name: 'P_NEW', catalogPresence: 'current_catalog', active: true, categoryIds: [], features: [] }, ...(code ? { declaredProductFamily: code } : {}) });
const dim = (c: AdmissionContextV2, dimension: string) => evaluateProductDimensions(c, contract).find(d => d.dimension === dimension)!;

describe('P2.3B versioned family adjudication', () => {
  it('preserves the published v1 identity and evaluator default', () => {
    expect(semanticObligationContract.contentHash).toBe('sha256:640d5f3f9015b79ceeb405eb0b54269da9849e37f5184eb8c56954d7030e805f');
    expect(evaluateProductAdmission(fixture('classified'), 'PRODUCT_CONTEXT').contractVersion).toBe('semantic-obligations-v1');
    expect(contract.contractVersion).toBe('semantic-obligations-v2');
    expect(contract.schemaVersion).toBe('2');
  });
  it.each(contract.families.map(f => f.productFamily))('adjudicates %s with explicit sources, negative policy and six real spec keys', code => {
    const f = family(code);
    expect(f.dimensions).toHaveLength(5);
    expect(f.status).toBe(familyObligationStatus(f));
    expect(f.dimensions.every(d => d.rationale && d.sourceReferences.length && typeof d.requiresNegativeEvidence === 'boolean' && d.negativeEvidenceRationale)).toBe(true);
    expect(f.specRequirements.map(s => s.specKey)).toEqual([...supportedSpecKeys]);
    expect(f.dimensions.filter(d => d.condition?.kind === 'TRAINING_ASSIGNMENTS_PRESENT')).toEqual([]);
    expect(f.dimensions.find(d => d.dimension === 'PRODUCT_SEMANTICS')!.requirement).toBe('REQUIRED');
    expect(f.dimensions.find(d => d.dimension === 'SPECS')!.requiresNegativeEvidence).toBe(false);
    expect(f.dimensions.find(d => d.dimension === 'TRUST')!.requiresNegativeEvidence).toBe(false);
    if (code === 'CABLE_MACHINE') expect(f.dimensions.find(d => d.dimension === 'TRAINING_FUNCTION')!.requiresNegativeEvidence).toBe(false);
  });
  it.each([null, undefined, 'OTHER', 'BAND', 'NEW_FAMILY'])('retains default UNKNOWN for %s', code => {
    const f = getProductFamilyObligation(code, contract) as FamilyObligationV2;
    expect(f.status).toBe('UNKNOWN');
    expect(f.dimensions.every(d => d.requirement === 'UNKNOWN')).toBe(true);
    expect(f.specRequirements.every(s => s.requirement === 'UNKNOWN')).toBe(true);
  });
  it('rejects ACTIVE promotion while material applicability is UNKNOWN', () => {
    const c = structuredClone(contract); c.families[0]!.status = 'ACTIVE';
    expect(() => validateSemanticObligationContractV2(resign(c))).toThrow('FAMILY_STATUS_CRITERIA');
    const f = structuredClone(family('BARBELL'));
    f.dimensions = f.dimensions.map(d => d.requirement === 'UNKNOWN' ? { ...d, requirement: 'NOT_REQUIRED' as const }
      : d.requirement === 'CONDITIONAL' ? { ...d, whenFalse: 'NOT_REQUIRED' as const } : d);
    expect(familyObligationStatus(f)).toBe('ACTIVE');
    const active = structuredClone(contract); f.status = 'ACTIVE'; active.families[0] = f;
    expect(validateSemanticObligationContractV2(resign(active)).families[0]!.status).toBe('ACTIVE');
    active.families[0]!.surfacePolicies.find(p => p.surface === 'SPEC_FILTERING')!.status = 'UNDEFINED';
    expect(() => validateSemanticObligationContractV2(resign(active))).toThrow('ACTIVE_SURFACE_EFFECTS_UNDEFINED');
  });
  it('rejects invalid key/source/condition, absent family and inconsistent negative policy', () => {
    const c = structuredClone(contract); c.families[0]!.specRequirements[0]!.acceptedSourceIds = [3];
    expect(() => validateSemanticObligationContractV2(resign(c))).toThrow('UNSUPPORTED_SPEC_SOURCE');
    const duplicate = structuredClone(contract); duplicate.families[0]!.specRequirements[1] = duplicate.families[0]!.specRequirements[0]!;
    expect(() => validateSemanticObligationContractV2(resign(duplicate))).toThrow('SPEC_KEYS_MUST_BE_COMPLETE_UNIQUE');
    const missing = structuredClone(contract); missing.families.pop();
    expect(() => validateSemanticObligationContractV2(resign(missing))).toThrow('ALL_ONTOLOGY_FAMILIES_REQUIRED');
    const negative = structuredClone(contract); negative.families[0]!.dimensions[0]!.requiresNegativeEvidence = false;
    expect(() => validateSemanticObligationContractV2(resign(negative))).toThrow();
    const circular = structuredClone(contract); circular.families[0]!.dimensions[1]!.condition = { kind: 'TRAINING_ASSIGNMENTS_PRESENT', dimension: 'TRAINING_EXERCISE' };
    expect(() => validateSemanticObligationContractV2(resign(circular))).toThrow('CIRCULAR_TRAINING_APPLICABILITY');
  });
  it('hashes deterministically, independently of object property order', () => {
    expect(computeSemanticObligationContractHash(JSON.parse(JSON.stringify(contract)))).toBe(contract.contentHash);
    expect(computeSemanticObligationContractHash(Object.fromEntries(Object.entries(contract).reverse()))).toBe(contract.contentHash);
    expect(Object.isFrozen(contract.families[0]!.specRequirements)).toBe(true);
    const changed = structuredClone(contract); changed.families[0]!.specRequirements[0]!.rationale += ' changed';
    expect(computeSemanticObligationContractHash(changed)).not.toBe(contract.contentHash);
  });
  it('reports universal numeric requirements with no existing authority as potential overconstraint', () => {
    const f = structuredClone(family('BARBELL')); f.specRequirements[0]!.requirement = 'REQUIRED';
    expect(contractInformationBurden(f).flags).toContain('POTENTIAL_OVERCONSTRAINT');
    expect(contractInformationBurden(family('BARBELL')).flags).toEqual([]);
  });
});

describe('source applicability precedes content', () => {
  it('does not read emitted assignments or COMPLETE to decide Training source obligations', () => {
    const c = fixture('training'), expected = trainingSourceObligations(c);
    delete c.training;
    expect(trainingSourceObligations(c)).toEqual(expected);
    expect(evaluateSemanticCondition({ kind: 'TRAINING_SOURCE_RULE_MATCHES', dimension: 'TRAINING_EXERCISE' }, c)).toBe(true);
    expect(dim(c, 'TRAINING_EXERCISE').effectiveRequirement).toBe('REQUIRED');
    expect(dim(c, 'TRAINING_EXERCISE').resolution.state).toBe('DATA_GAP');
    expect(dim(c, 'TRAINING_FUNCTION').resolution.state).toBe('DATA_GAP');
  });
  it('requires every source-established code, including separate dual modules', () => {
    const c = fixture('training'); c.training!.exerciseCapabilities = [];
    c.training!.resolutionState = 'SEMANTIC_COMPLETE';
    expect(dim(c, 'TRAINING_EXERCISE').reasons.some(r => r.code === 'REQUIRED_ASSIGNMENT_MISSING')).toBe(true);
    expect(dim(c, 'TRAINING_EXERCISE').resolution.state).toBe('DATA_GAP');
    expect(dim(c, 'TRAINING_FUNCTION').terminalValid).toBe(true);
  });
  it('treats conditional false as exemption only for explicitly grounded families', () => {
    const exempt = newProduct('BARBELL');
    expect(dim(exempt, 'TRAINING_EXERCISE').effectiveRequirement).toBe('NOT_REQUIRED');
    expect(dim(exempt, 'TRAINING_EXERCISE').resolution.state).not.toBe('DATA_GAP');
    expect(dim(newProduct('APPAREL'), 'TRAINING_EXERCISE').effectiveRequirement).toBe('UNKNOWN');
    expect(evaluateProductConsolidation(newProduct('APPAREL'), contract).obligationsKnown).toBe(false);
  });
  it('propagates non-evaluable conditions instead of granting exemption', () => {
    const c = fixture('training'); delete c.trust;
    expect(evaluateSemanticCondition({ kind: 'TRAINING_SOURCE_RULE_MATCHES', dimension: 'TRAINING_EXERCISE' }, c)).toBe(null);
    expect(dim(c, 'TRAINING_EXERCISE').effectiveRequirement).toBe('UNKNOWN');
    expect(dim(c, 'TRAINING_EXERCISE').reasons.some(r => r.code === 'CONDITION_NOT_EVALUABLE')).toBe(true);
    const missingValue = newProduct('BARBELL');
    missingValue.canonical!.features = [{ featureId: 80001, featureValueId: 1, name: 'Declaración semántica', value: null }];
    missingValue.trust = { categories: [], features: [{ featureId: 80001, trustClass: 'SEMANTIC' }], sourceHashesVerified: true, consumedByCategorySelection: false };
    expect(dim(missingValue, 'TRAINING_EXERCISE').effectiveRequirement).toBe('UNKNOWN');
    expect(dim(missingValue, 'TRAINING_FUNCTION').effectiveRequirement).toBe('UNKNOWN');
  });
  it('does not silently exempt a family when weak source evidence needs review', () => {
    const c = newProduct('BARBELL'); c.canonical!.name = 'Remo'; c.trust = { categories: [], features: [], sourceHashesVerified: true, consumedByCategorySelection: false };
    expect(trainingSourceObligations(c)!.exerciseReview).toBe(true);
    expect(dim(c, 'TRAINING_EXERCISE').effectiveRequirement).toBe('UNKNOWN');
  });
  it('preserves valid negatives with ABSENT evidence and blocks invalid assignments', () => {
    const negative = fixture('negative');
    expect(mapTrainingExercise(negative).state).toBe('VERIFIED_NOT_APPLICABLE');
    expect(mapTrainingExercise(negative).negativeEvidenceState).toBe('ABSENT');
    expect(dim(negative, 'TRAINING_EXERCISE').evidenceCertified).toBe(false);
    expect(evaluateProductAdmission(fixture('invalid'), 'TRAINING_DISCOVERY', contract).decision).toBe('BLOCKED');
  });
  it('keeps exercise and function discovery independent', () => {
    const c = fixture('functionOnly');
    expect(dim(c, 'TRAINING_FUNCTION').effectiveRequirement).toBe('REQUIRED');
    expect(dim(c, 'TRAINING_EXERCISE').effectiveRequirement).toBe('NOT_REQUIRED');
    expect(evaluateProductAdmission({ ...c, trainingDiscoveryDimension: 'TRAINING_FUNCTION' }, 'TRAINING_DISCOVERY', contract).decision).toBe('ADMITTED');
    expect(evaluateProductAdmission(c, 'TRAINING_DISCOVERY', contract).decision).toBe('NOT_APPLICABLE');
  });
  it('requires Trust only when semantic evidence uses it, never because a map exists', () => {
    const c = fixture('classified');
    expect(dim(c, 'TRUST').effectiveRequirement).toBe('NOT_REQUIRED');
    const used = fixture('combinedEvidence');
    expect(dim(used, 'TRUST').effectiveRequirement).toBe('REQUIRED');
    expect(dim(used, 'TRUST').evidenceCertified).toBe(false);
    delete used.training;
    // The source rule already used governed evidence, even though its Training fact is absent.
    expect(dim(used, 'TRUST').effectiveRequirement).toBe('REQUIRED');
    delete used.trust;
    expect(dim(used, 'TRUST').effectiveRequirement).toBe('UNKNOWN');
  });
});

describe('key-level Specs dependencies and scope', () => {
  it('does not infer exhaustive family needs from absence of supported features', () => {
    const c = newProduct('BARBELL'); c.specs = [];
    const specs = evaluateSpecRequirements(c, family('BARBELL'));
    expect(specs.every(s => s.effectiveRequirement === 'NOT_REQUIRED' && s.resolution.state !== 'DATA_GAP')).toBe(true);
    expect(dim(c, 'SPECS').effectiveRequirement).toBe('UNKNOWN');
    expect(evaluateProductAdmission({ ...c, specFilteringKeys: ['weight_kg'] }, 'SPEC_FILTERING', contract).decision).toBe('NOT_APPLICABLE');
    expect(evaluateProductAdmission(c, 'SPEC_FILTERING', contract).decision).toBe('UNKNOWN');
  });
  it('reports missing required key as DATA_GAP while optional missing keys do not create gaps', () => {
    const c = newProduct('BARBELL');
    c.canonical!.features = [{ featureId: 3, featureValueId: 10, name: 'Peso', value: '20 kg' }]; c.specs = [];
    const specs = evaluateSpecRequirements(c, family('BARBELL'));
    expect(specs.find(s => s.specKey === 'weight_kg')!.resolution.state).toBe('DATA_GAP');
    expect(specs.find(s => s.specKey === 'max_load_kg')!.resolution.state).not.toBe('DATA_GAP');
    expect(evaluateProductAdmission(c, 'SPEC_FILTERING', contract).decision).toBe('BLOCKED');
  });
  it('isolates conflicts to the requested key and preserves additional available knowledge', () => {
    const c = fixture('specConflict');
    expect(mapSpecs(c).state).toBe('SOURCE_CONFLICT');
    const evaluated = evaluateSpecRequirements(c, family('CABLE_MACHINE'));
    const safe = evaluated.find(s => s.effectiveRequirement === 'REQUIRED' && s.terminalValid && s.evidenceCertified)!;
    const conflicting = evaluated.find(s => s.resolution.state === 'SOURCE_CONFLICT')!;
    expect(safe).toBeDefined(); expect(conflicting).toBeDefined();
    const before = structuredClone(c.specs);
    expect(evaluateProductAdmission({ ...c, specFilteringKeys: [safe.specKey] }, 'SPEC_FILTERING', contract).decision).toBe('ADMITTED');
    expect(evaluateProductAdmission({ ...c, specFilteringKeys: [conflicting.specKey] }, 'SPEC_FILTERING', contract).decision).toBe('BLOCKED');
    expect(evaluateProductAdmission(c, 'PRODUCT_CONTEXT', contract).decision).toBe('ADMITTED');
    expect(evaluateProductAdmission(c, 'PRODUCT_SEMANTIC_DISCOVERY', contract).decision).toBe('ADMITTED');
    expect(evaluateProductAdmission(c, 'UNIFIED_RETRIEVAL', contract).decision).toBe('BLOCKED');
    expect(c.specs).toEqual(before);
    const undefinedSurface = structuredClone(contract);
    undefinedSurface.families.find(f => f.productFamily === 'CABLE_MACHINE')!.surfacePolicies.find(p => p.surface === 'SPEC_FILTERING')!.status = 'UNDEFINED';
    expect(evaluateProductAdmission(c, 'SPEC_FILTERING', validateSemanticObligationContractV2(resign(undefinedSurface))).decision).toBe('UNKNOWN');
  });
  it('retains a conflicting available fact while exempting its obligation from unrelated consolidation dependencies', () => {
    const c = fixture('specConflict'), edited = structuredClone(contract);
    const f = edited.families.find(f => f.productFamily === 'CABLE_MACHINE')!;
    const conflicts = evaluateSpecRequirements(c, f).filter(s => s.resolution.state === 'SOURCE_CONFLICT').map(s => s.specKey);
    f.specRequirements = f.specRequirements.map(s => {
      if (!conflicts.includes(s.specKey)) return s;
      const { condition: _condition, whenFalse: _whenFalse, ...spec } = s;
      return { ...spec, requirement: 'NOT_REQUIRED', rationale: 'Explicit test-only exemption for consolidation; available facts retained.', sourceReferences: ['test:reviewed-key-exemption'] };
    });
    const validated = validateSemanticObligationContractV2(resign(edited));
    expect(mapSpecs(c).state).toBe('SOURCE_CONFLICT');
    expect(evaluateProductDimensions(c, validated).find(d => d.dimension === 'SPECS')!.resolution.state).not.toBe('SOURCE_CONFLICT');
    expect(evaluateProductAdmission(c, 'UNIFIED_RETRIEVAL', validated).decision).not.toBe('BLOCKED');
    expect(evaluateProductConsolidation(c, validated).state).not.toBe('BLOCKED_BY_CONFLICT');
  });
  it.each(['historical', 'nonProduct'])('preserves %s exclusion independently of available facts', name => {
    const c = fixture(name);
    expect(evaluateProductAdmission(c, 'TRAINING_DISCOVERY', contract).decision).toBe('NOT_APPLICABLE');
    expect(evaluateProductAdmission(c, 'SPEC_FILTERING', contract).decision).toBe('NOT_APPLICABLE');
    expect(evaluateProductAdmission(c, 'UNIFIED_RETRIEVAL', contract).decision).toBe('NOT_APPLICABLE');
  });
  it.each(contract.families.map(f => f.productFamily))('simulates P_NEW known %s with explicit missing vs unknown requirements', code => {
    const c = newProduct(code), evaluated = evaluateProductDimensions(c, contract);
    expect(evaluated[0]!.effectiveRequirement).toBe('REQUIRED');
    expect(evaluated[0]!.resolution.state).toBe('DATA_GAP');
    expect(evaluateProductConsolidation(c, contract).highestCertifiedLevel).toBe('L1_STRUCTURALLY_VALID');
    expect(evaluateProductAdmission(c, 'PRODUCT_CONTEXT', contract).decision).toBe('ADMITTED');
  });
  it('keeps unknown P_NEW conservative and the evaluator deterministic', () => {
    const c = newProduct('NEW_FAMILY'), original = structuredClone(c);
    const first = evaluateProductConsolidation(c, contract);
    expect(first.evaluatedDimensions.every(d => d.effectiveRequirement === 'UNKNOWN')).toBe(true);
    expect(first).toEqual(evaluateProductConsolidation(c, contract)); expect(c).toEqual(original);
    const residual = fixture('training'); residual.productSemantics!.primaryProductFamily!.code = 'OTHER';
    expect(dim(residual, 'TRUST').declaredRequirement).toBe('UNKNOWN');
    expect(dim(residual, 'TRUST').conditionResult).toBe(null);
  });
  it('fails closed on malformed canonical input before evaluating source conditions or spec keys', () => {
    const c = newProduct('BARBELL'); Reflect.set(c.canonical!, 'features', 'malformed');
    expect(evaluateProductConsolidation(c, contract).state).toBe('INVALID');
    expect(evaluateProductAdmission(c, 'SPEC_FILTERING', contract).decision).toBe('BLOCKED');
    expect(evaluateSemanticCondition({ kind: 'TRAINING_SOURCE_RULE_MATCHES', dimension: 'TRAINING_EXERCISE' }, c)).toBe(null);
  });
  it('returns the same decisions when the offline audit shares a single dimension evaluation', () => {
    for (const c of [fixture('training'), fixture('specConflict'), newProduct('BARBELL')]) {
      const snapshot = evaluateAdmissionSnapshot(c, contract);
      expect(snapshot.consolidation).toEqual(evaluateProductConsolidation(c, contract));
      for (const surface of admissionSurfaces) expect(snapshot.admission[surface]).toEqual(evaluateProductAdmission(c, surface, contract));
    }
  });
});
