import { describe, expect, it } from 'vitest';
import type { CommercialHydrator } from '../../../src/application/catalog/discover-v0/commercialHydrator.js';
import type { CommercialObservation, DiscoverDiagnosticResponse } from '../../../src/application/catalog/discover-v0/contracts.js';
import { aggregateGroups, dispositionOf } from '../../../src/application/catalog/discover-v0/disposition.js';
import { discoverV0 } from '../../../src/application/catalog/discover-v0/discoverV0.js';
import { DISCOVER_V0_LEXICON } from '../../../src/application/catalog/discover-v0/lexicon.js';
import { DiscoverQueryInterpreter } from '../../../src/application/catalog/discover-v0/queryInterpreter.js';
import { commercialProductOntologyRegistryVersionV3, getOntologyTagsForAxis } from '../../../src/domain/commercial-product-ontology/index.js';
import { getTrainingSemanticRegistryV2 } from '../../../src/domain/training-semantics-v2/index.js';
import { doc, syntheticIndex } from './fixtures.js';

/*
 * CAT-DISCOVER-V0.2 — SYNTHETIC unit tests (invented products, never catalog records).
 */

const interpreter = new DiscoverQueryInterpreter();

const catalog = () => [
  doc({ id: 1, name: 'Soporte de Barra Accesorio Rack', family: 'MACHINE_ATTACHMENT', resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY',
    admission: { functionNegativeEvidence: 'PRESENT', exerciseNegativeEvidence: 'PRESENT' } }),
  doc({ id: 2, name: 'Rack Potencia Acero', family: 'RACK_CAGE', functions: [{ code: 'BARBELL_SUPPORT' }] }),
  doc({ id: 3, name: 'Barra Olimpica 20kg', family: 'BARBELL', resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY', admission: { functionNegativeEvidence: 'PRESENT' } }),
  doc({ id: 4, name: 'Rack Almacenamiento Discos', family: 'STORAGE' }),
  doc({ id: 5, name: 'Rack Almacenamiento Mancuernas', family: 'STORAGE' }),
  doc({ id: 6, name: 'Par Discos Goma 10kg', family: 'WEIGHT_PLATE', specs: [{ key: 'weight_kg', value: 10, rawValue: '10 kg. cada disco', qualifier: 'cada disco' }] }),
  doc({ id: 7, name: 'Par Discos Goma 5kg', family: 'WEIGHT_PLATE', specs: [{ key: 'weight_kg', value: 5, rawValue: '5 kg.' }] }),
  doc({ id: 8, name: 'Pack 100kg Discos Goma', family: 'WEIGHT_PLATE', specs: [{ key: 'weight_kg', value: 100, rawValue: '100 kg.' }] }),
  doc({ id: 9, name: 'Par Mancuernas Neopreno 0.8kg', family: 'DUMBBELL', specs: [{ key: 'weight_kg', value: 1.6, rawValue: '1,6 kg. (el par)', qualifier: 'el par' }] }),
  doc({ id: 10, name: 'Par Mancuernas Cromo 10kg', family: 'DUMBBELL', specs: [{ key: 'weight_kg', value: 20, rawValue: '20 kg.' }] }),
  doc({ id: 11, name: 'Par Mancuernas Hierro 10kg', family: 'DUMBBELL', specs: [{ key: 'weight_kg', value: 10, rawValue: '10 kg. cada mancuerna', qualifier: 'cada mancuerna' }] }),
  doc({ id: 12, name: 'Maquina Prensa Pesada', family: 'PLATE_LOADED_MACHINE', specs: [{ key: 'max_load_kg', value: 150, rawValue: '150 kg.' }] }),
  doc({ id: 13, name: 'Banco Plano Reforzado', family: 'BENCH', specs: [{ key: 'max_load_kg', value: 300, rawValue: '300 kg. (incluido peso de usuario)', qualifier: 'incluido peso de usuario' }] }),
  doc({ id: 14, name: 'Rack Dominadas Fondos', family: 'RACK_CAGE', exercises: [{ code: 'PULL_UP' }, { code: 'DIP' }],
    specs: [{ key: 'max_user_weight_kg', value: 150, rawValue: '150 kg (barra pull up)', qualifier: 'barra pull up' }] }),
  doc({ id: 15, name: 'Kettlebell Hierro 20kg', family: 'KETTLEBELL', specs: [{ key: 'weight_kg', value: 20, rawValue: '20 kg.' }] }),
  doc({ id: 16, name: 'Kettlebell Hierro 24kg', family: 'KETTLEBELL', specs: [{ key: 'weight_kg', value: 24, rawValue: '24 kg.' }] }),
  doc({ id: 17, name: 'Kettlebell Hierro 16kg', family: 'KETTLEBELL', specs: [{ key: 'weight_kg', value: 20, rawValue: '20 kg.' }] }),
  doc({ id: 18, name: 'Barra Pull Up Muro', family: 'BODYWEIGHT_GYMNASTICS', exercises: [{ code: 'PULL_UP' }], specs: [{ key: 'max_user_weight_kg', value: 100, rawValue: '100 kg.' }] }),
  doc({ id: 19, name: 'Barra Pull Up Puerta', family: 'BODYWEIGHT_GYMNASTICS', exercises: [{ code: 'PULL_UP' }], specs: [{ key: 'max_user_weight_kg', value: 130, rawValue: '130 kg.' }] }),
  doc({ id: 20, name: 'Barra Olimpica 8kg', family: 'BARBELL', specs: [{ key: 'weight_kg', value: 8, rawValue: '8 kg. Aprox. (No calibrada)', qualifier: 'aprox no calibrada' }] }),
  doc({ id: 21, name: 'Trotadora Hogar', family: 'CARDIO_MACHINE', disciplines: ['CARDIO_ENDURANCE'] }),
  doc({ id: 22, name: 'Cuerda Salto Cardio', family: 'ROPE_SLED' }),
];

const index = syntheticIndex(catalog());
const run = (need: string, extra: Partial<Parameters<typeof discoverV0>[1]> = {}) => discoverV0({ schemaVersion: 1, need }, { index, mode: 'HYBRID', ...extra });
const keys = (response: DiscoverDiagnosticResponse) => response.verified.map((candidate) => candidate.productKey);
const possible = (response: DiscoverDiagnosticResponse) => response.possible.map((candidate) => candidate.productKey);
const rejected = (response: DiscoverDiagnosticResponse) => response.rejected.map((candidate) => candidate.productKey);
const spec = (response: DiscoverDiagnosticResponse, key: string) => [...response.verified, ...response.possible].find((candidate) => candidate.productKey === key)
  ?.constraintResults.find((result) => result.kind === 'SPEC');

describe('Query Interpreter V0.2 — readings and ambiguity', () => {
  it('keeps "soporte de barra" and "soporte para barra" as two alternative readings, never a conjunction', () => {
    for (const query of ['soporte de barra', 'soporte para barra']) {
      const interpretation = interpreter.interpret(query);
      expect(interpretation.ambiguityGroups).toHaveLength(1);
      const [group] = interpretation.ambiguityGroups;
      expect(group!.readings.map((reading) => reading.role)).toEqual(['PRODUCT_ROLE', 'TRAINING_FUNCTION']);
      expect(interpretation.hardConstraints.every((constraint) => constraint.groupId === group!.groupId)).toBe(true);
      const span = interpretation.spans.find((item) => item.spanId === group!.spanId)!;
      expect(span).toMatchObject({ ambiguity: 'MATERIAL', resolution: 'UNRESOLVED', tokenStart: 0, tokenEnd: 3 });
      expect(span.unresolvedReasons[0]).toContain('PRODUCT_ROLE_VS_TRAINING_FUNCTION');
      expect(span.readings.every((reading) => reading.evidence.length > 0 && reading.derivedConstraintIds.length === 1)).toBe(true);
    }
  });

  it('reads "almacenamiento para discos" as a use purpose, not a compatibility', () => {
    const interpretation = interpreter.interpret('almacenamiento para discos');
    expect(interpretation.hardConstraints.map((constraint) => constraint.kind)).toEqual(['PRODUCT_TYPE']);
    expect(interpretation.hardConstraints[0]!.codes).toEqual(['STORAGE']);
    const purpose = interpretation.relevanceRequirements.find((requirement) => requirement.role === 'USE_PURPOSE')!;
    expect(purpose).toMatchObject({ gating: true, field: 'NAME' });
    expect(purpose.alternatives).toEqual(expect.arrayContaining([['disco']]));
    const span = interpretation.spans.find((item) => item.text === 'para discos')!;
    expect(span.readings.find((reading) => reading.role === 'RELATIONSHIP')?.status).toBe('CONSIDERED_REJECTED');
  });

  it('keeps "<family> para <family>" as COMPATIBILITY when the head does not serve objects', () => {
    expect(interpreter.interpret('disco para barra olimpica').hardConstraints.map((constraint) => constraint.kind)).toEqual(expect.arrayContaining(['COMPATIBILITY', 'PRODUCT_TYPE']));
  });

  it('distinguishes product identity, product role and training function in governed compounds', () => {
    const rack = interpreter.interpret('rack para sentadillas');
    expect(rack.hardConstraints).toEqual([expect.objectContaining({ kind: 'PRODUCT_TYPE', codes: ['RACK_CAGE'], role: 'PRODUCT_IDENTITY' })]);
    expect(rack.spans[0]!.readings.find((reading) => reading.role === 'USE_PURPOSE')?.status).toBe('CONSIDERED_REJECTED');
    const cable = interpreter.interpret('maquina de poleas');
    expect(cable.hardConstraints).toEqual([expect.objectContaining({ codes: ['CABLE_MACHINE'], role: 'PRODUCT_ROLE' })]);
    expect(cable.spans[0]!.readings.map((reading) => `${reading.role}:${reading.status}`)).toEqual(['PRODUCT_ROLE:SELECTED', 'TRAINING_FUNCTION:CONSIDERED_REJECTED']);
    const grip = interpreter.interpret('agarre para polea');
    expect(grip.hardConstraints.map((constraint) => constraint.kind)).toEqual(['PRODUCT_TYPE']);
    expect(grip.spans[0]!.readings.find((reading) => reading.role === 'RELATIONSHIP')?.status).toBe('CONSIDERED_REJECTED');
    const rope = interpreter.interpret('soga de triceps');
    expect(rope.hardConstraints).toEqual([expect.objectContaining({ codes: ['MACHINE_ATTACHMENT'], role: 'PRODUCT_IDENTITY' })]);
    expect(rope.hardConstraints.some((constraint) => constraint.kind === 'ANATOMY')).toBe(false);
  });

  it('reads "barra para dominadas" as the exercise, with the product wording as a non-gating preference', () => {
    const interpretation = interpreter.interpret('barra para dominadas');
    expect(interpretation.hardConstraints).toEqual([expect.objectContaining({ kind: 'EXERCISE', codes: ['PULL_UP'] })]);
    expect(interpretation.relevanceRequirements).toEqual([expect.objectContaining({ role: 'PRODUCT_IDENTITY', gating: false })]);
    expect(interpretation.spans[0]!.readings.find((reading) => reading.concepts.includes('PRODUCT_FAMILY:BARBELL'))?.status).toBe('CONSIDERED_REJECTED');
  });

  it('handles "equipo de cardio" as a material ambiguity between machine and purpose', () => {
    const interpretation = interpreter.interpret('equipo de cardio');
    expect(interpretation.ambiguityGroups[0]!.readings.map((reading) => reading.role)).toEqual(['PRODUCT_ROLE', 'USE_PURPOSE']);
  });

  it('keeps "rack multifuncional con dominadas y fondos" as a rack with two exercise capabilities', () => {
    const interpretation = interpreter.interpret('rack multifuncional con dominadas y fondos');
    expect(interpretation.hardConstraints.map((constraint) => `${constraint.kind}:${constraint.codes?.join('|')}`).sort()).toEqual(['EXERCISE:DIP', 'EXERCISE:PULL_UP', 'PRODUCT_TYPE:RACK_CAGE']);
    expect(interpretation.hardConstraints.some((constraint) => constraint.kind === 'BUNDLE_COMPONENT')).toBe(false);
    expect(interpretation.unrecognizedTerms).toContain('multifuncional');
  });

  it('derives the quantity scope of a requested weight from the wording', () => {
    const scope = (query: string) => interpreter.interpret(query).hardConstraints.find((constraint) => constraint.kind === 'SPEC');
    expect(scope('mancuernas de 10 kg')).toMatchObject({ quantityScope: 'PER_UNIT', quantityScopeRule: 'LOAD_ITEM_DEFAULT' });
    expect(scope('par de discos de 20 kg')).toMatchObject({ quantityScope: 'PER_UNIT', quantityScopeRule: 'PAIR_NAMING_CONVENTION' });
    expect(scope('pack de discos de 100 kg')).toMatchObject({ quantityScope: 'PACK_TOTAL' });
    expect(scope('discos 100 kg en total')).toMatchObject({ quantityScope: 'PACK_TOTAL', quantityScopeRule: 'QUERY_SAYS_TOTAL' });
  });
});

describe('governed lexicon V0.2', () => {
  it('maps every ambiguous reading to an existing registry code and keeps entries pending review', () => {
    const registry = getTrainingSemanticRegistryV2();
    const allowed: Record<string, Set<string>> = {
      PRODUCT_FAMILY: new Set(getOntologyTagsForAxis('PRODUCT_FAMILY', commercialProductOntologyRegistryVersionV3).map((tag) => tag.code)),
      DISCIPLINE: new Set(getOntologyTagsForAxis('DISCIPLINE', commercialProductOntologyRegistryVersionV3).map((tag) => tag.code)),
      TRAINING_FUNCTION: new Set(registry.trainingFunctions.map((definition) => definition.code)),
    };
    const ambiguous = DISCOVER_V0_LEXICON.filter((entry) => entry.type === 'AMBIGUOUS');
    expect(ambiguous.length).toBeGreaterThan(0);
    for (const entry of ambiguous) {
      expect(entry.reviewStatus).toBe('PENDING_DOMAIN_REVIEW');
      if (entry.type !== 'AMBIGUOUS') continue;
      for (const reading of entry.readings) expect(allowed[reading.axis]?.has(reading.code), `${entry.id}.${reading.readingId}`).toBe(true);
    }
  });
});

describe('catalog.discoverV0 V0.2 — disposition', () => {
  it('separates VERIFIED / POSSIBLE / REJECTED and never repeats a productKey across lists', async () => {
    const { response } = await run('pesa rusa de 20 kg');
    expect(keys(response)).toEqual(['P15']);
    expect(rejected(response)).toContain('P16');
    for (const candidate of response.verified) expect(candidate.disposition).toBe('VERIFIED_MATCH');
    for (const candidate of response.possible) expect(candidate.disposition).toBe('POSSIBLE_MATCH');
    const all = [...keys(response), ...possible(response), ...rejected(response)];
    expect(new Set(all).size).toBe(all.length);
  });

  it('does not exclude a product by a Training negative when the need is ambiguous (soporte de barra)', async () => {
    const { response } = await run('soporte de barra');
    expect(keys(response)).toEqual([]);
    expect(possible(response)).toEqual(expect.arrayContaining(['P1', 'P2']));
    const accessory = response.possible.find((candidate) => candidate.productKey === 'P1')!;
    expect(accessory.groupResults[0]).toMatchObject({ state: 'UNKNOWN', satisfiedUnder: ['A'] });
    expect(accessory.constraintResults.find((result) => result.readingId === 'B')).toMatchObject({ state: 'UNKNOWN', conflict: 'CONFLICTING_EVIDENCE' });
    expect(response.possible.find((candidate) => candidate.productKey === 'P2')!.groupResults[0]!.satisfiedUnder).toEqual(['B']);
    expect(response.completeness.noResultReason).toBe('AMBIGUOUS_NEED_UNRESOLVED');
    // Both readings are represented in the first possible matches (one reading never hides the other).
    expect(possible(response).slice(0, 2).sort()).toEqual(['P1', 'P2']);
  });

  it('rejects only when every reading of an ambiguous need fails', () => {
    const interpretation = interpreter.interpret('soporte de barra');
    const results = interpretation.hardConstraints.map((constraint) => ({ constraintId: constraint.id, kind: constraint.kind, domain: constraint.domain, hard: true,
      state: 'VIOLATED' as const, reason: 'TEST', groupId: constraint.groupId, readingId: constraint.readingId }));
    const allViolated = aggregateGroups(interpretation, results, () => true);
    expect(dispositionOf(results, allViolated).disposition).toBe('REJECTED');
    const oneUnknown = results.map((result, position) => (position === 0 ? { ...result, state: 'UNKNOWN' as const } : result));
    expect(dispositionOf(oneUnknown, aggregateGroups(interpretation, oneUnknown, () => true)).disposition).toBe('POSSIBLE_MATCH');
    const allSatisfied = results.map((result) => ({ ...result, state: 'SATISFIED' as const }));
    expect(dispositionOf(allSatisfied, aggregateGroups(interpretation, allSatisfied, () => true)).disposition).toBe('VERIFIED_MATCH');
  });

  it('keeps a PRESENT negative as VIOLATED when the interpretation is unambiguous and the name does not conflict', async () => {
    const { response } = await run('barra de dominadas');
    expect(rejected(response)).toContain('P1');
    expect(response.rejected.find((candidate) => candidate.productKey === 'P1')!.violated[0]!.reason).toBe('VERIFIED_NO_APPLICABLE_CAPABILITY/NEGATIVE_EVIDENCE_PRESENT');
    expect(keys(response)).toEqual(expect.arrayContaining(['P18', 'P19']));
  });

  it('records CONFLICTING_EVIDENCE between the product name and its classification and keeps it POSSIBLE', async () => {
    const conflicted = syntheticIndex([doc({ id: 40, name: 'Agarre Accesorio Polea Simple', family: 'CABLE_MACHINE' })]);
    const { response } = await discoverV0({ schemaVersion: 1, need: 'agarre para polea' }, { index: conflicted, mode: 'HYBRID' });
    expect(possible(response)).toEqual(['P40']);
    expect(response.possible[0]!.blocking[0]).toMatchObject({ state: 'UNKNOWN', conflict: 'CONFLICTING_EVIDENCE' });
    expect(response.possible[0]!.blocking[0]!.reason).toMatch(/^CLASSIFICATION_CONFLICTS_WITH_NAME/u);
  });

  it('serves a storage purpose from the product name, never from a certified relation', async () => {
    const { response } = await run('almacenamiento para discos');
    expect(keys(response)).toEqual(['P4']);
    expect([...keys(response), ...possible(response)]).not.toContain('P5');
    expect(response.verified[0]!.constraintResults.every((result) => result.kind !== 'COMPATIBILITY')).toBe(true);
  });
});

describe('QuantityScope V0.2 — per unit / pair / pack / capacity', () => {
  it('certifies an explicit per-disc weight and rejects the other per-disc weights', async () => {
    const { response } = await run('discos de 10 kg');
    expect(keys(response)).toEqual(['P6']);
    expect(spec(response, 'P6')!.quantity).toMatchObject({ scope: 'PER_UNIT', appliesTo: 'disco', status: 'INTERPRETED', rule: 'EXPLICIT_EACH' });
  });

  it('never reads an unqualified weight of a pair as a per-unit weight', async () => {
    const { response } = await run('discos de 5 kg');
    expect(keys(response)).not.toContain('P7');
    expect(spec(response, 'P7')).toMatchObject({ state: 'UNKNOWN', reason: 'QUANTITY_AMBIGUOUS:MULTI_UNIT_UNQUALIFIED' });
  });

  it('never reads a pack total as the weight of each component, but certifies it for a pack-total query', async () => {
    const perUnit = await run('discos de 100 kg');
    expect(keys(perUnit.response)).not.toContain('P8');
    expect(spec(perUnit.response, 'P8')).toMatchObject({ state: 'UNKNOWN', reason: 'PACK_TOTAL_NOT_PER_UNIT' });
    const total = await run('pack de discos de 100 kg');
    expect(keys(total.response)).toContain('P8');
    expect(spec(total.response, 'P8')!.quantity).toMatchObject({ scope: 'PACK_TOTAL', rule: 'PACK_NAME_TOTAL' });
  });

  it('distinguishes 10 kg per dumbbell from 10 kg per pair', async () => {
    const { response } = await run('mancuernas de 10 kg');
    expect(keys(response)).toEqual(['P11']);
    expect(spec(response, 'P10')).toMatchObject({ state: 'UNKNOWN', reason: 'QUANTITY_AMBIGUOUS:MULTI_UNIT_UNQUALIFIED' });
    const pair = await run('mancuernas de 0.8 kg');
    expect(keys(pair.response)).toEqual(['P9']);
    expect(spec(pair.response, 'P9')!.quantity).toMatchObject({ scope: 'PER_PAIR', derived: true, comparedValue: 0.8 });
  });

  it('flags a value contradicted by the product name as CONFLICTING_EVIDENCE', async () => {
    const { response } = await run('kettlebell de 20 kg');
    expect(keys(response)).toEqual(['P15']);
    expect(spec(response, 'P17')).toMatchObject({ state: 'UNKNOWN', conflict: 'CONFLICTING_EVIDENCE' });
  });

  it('does not confuse max_load_kg with weight_kg nor total load including the user with user capacity', async () => {
    const load = await run('maquina que soporte 150 kg');
    expect(load.response.interpretation.hardConstraints.find((constraint) => constraint.kind === 'SPEC')?.specKey).toBe('max_load_kg');
    const bench = await run('banco que soporte 300 kg');
    expect(keys(bench.response)).toEqual(['P13']);
    expect(spec(bench.response, 'P13')!.quantity).toMatchObject({ scope: 'PRODUCT_TOTAL', rule: 'INCLUDES_USER' });
    const user = await run('banco para una persona de 150 kg');
    expect(keys(user.response)).toEqual([]);
    expect(spec(user.response, 'P13')).toMatchObject({ state: 'UNKNOWN', reason: 'SPEC_MISSING' });
  });

  it('applies a subcomponent capacity only to the part the query asks about', async () => {
    const pullUp = await run('rack con dominadas para usuario de 140 kg');
    expect(keys(pullUp.response)).toContain('P14');
    expect(spec(pullUp.response, 'P14')!.quantity).toMatchObject({ scope: 'SUBCOMPONENT', appliesTo: 'barra pull up' });
    const rackOnly = await run('rack para persona de 140 kg');
    expect(spec(rackOnly.response, 'P14')).toMatchObject({ state: 'UNKNOWN', reason: 'SUBCOMPONENT_NOT_REQUESTED:barra pull up' });
  });

  it('never declares an approximate value conformant with an exact weight', async () => {
    const exact = await run('barra de 8 kg');
    expect(keys(exact.response)).not.toContain('P20');
    expect(spec(exact.response, 'P20')!.reason).toMatch(/^APPROXIMATE_VALUE/u);
  });
});

describe('Exact match V0.2 — entity resolution without constraint degradation', () => {
  it('returns the exact entity as a lookup and keeps the original constraints for related products', async () => {
    const result = await run('Kettlebell Hierro 20kg');
    expect(result.response.exactResolution).toMatchObject({ status: 'RESOLVED', kind: 'NAME', productKeys: ['P15'], relatedDiscovery: 'APPLIED' });
    expect(result.agent.exactMatch?.productKey).toBe('P15');
    expect(keys(result.response)).toEqual(['P15']);
    expect(rejected(result.response)).toContain('P16');
  });

  it('keeps the contradiction of an exact entity instead of certifying it', async () => {
    const result = await run('Kettlebell Hierro 16kg');
    expect(result.response.exactResolution.productKeys).toEqual(['P17']);
    const entity = result.response.exactResolution.entities[0]!;
    expect(entity.disposition).not.toBe('VERIFIED_MATCH');
    expect(result.agent.exactMatch).toMatchObject({ productKey: 'P17' });
    expect(result.agent.exactMatch!.unverified!.join(' ')).toContain('CONFLICTING_EVIDENCE');
  });

  it('resolves a productKey alone without related discovery', async () => {
    const result = await run('P2');
    expect(result.response.exactResolution).toMatchObject({ status: 'RESOLVED', kind: 'PRODUCT_KEY', relatedDiscovery: 'NOT_APPLICABLE' });
    expect(result.response.verified.map((candidate) => candidate.productKey)).toEqual(['P2']);
  });

  it('applies the user capacity to related pull-up bars', async () => {
    const { response } = await run('barra de dominadas para usuario de 120 kg');
    // P14 qualifies through its pull-up SUBCOMPONENT capacity (150 kg, "barra pull up"), P19 through its own capacity.
    expect([...keys(response)].sort()).toEqual(['P14', 'P19']);
    expect(rejected(response)).toContain('P18');
  });
});

describe('Commercial Truth V0.2 — typed doubles, never fabricated', () => {
  const observed = (overrides: Partial<Extract<CommercialObservation, { status: 'OBSERVED' }>>): CommercialObservation => ({
    status: 'OBSERVED', authority: 'test-owner', asOf: '2026-10-08T00:00:00.000Z', validUntil: '2026-10-08T00:15:00.000Z', finalGrossClp: 45000, sellability: 'sellable', ...overrides,
  });
  const hydrator = (byKey: Record<string, CommercialObservation>): CommercialHydrator => ({ label: 'test', hydrate: async (productKeys) => new Map(productKeys.map((key) => [key, byKey[key] ?? { status: 'NOT_OBSERVED', reason: 'TEST_ABSENT' }])) });
  const now = () => new Date('2026-10-08T00:05:00.000Z');
  const price = (response: DiscoverDiagnosticResponse, key: string) => [...response.verified, ...response.possible].find((candidate) => candidate.productKey === key)
    ?.constraintResults.find((result) => result.kind === 'COMMERCIAL_MAX_PRICE');

  it('separates price within and outside the budget, absent price and absent observation', async () => {
    const { response } = await run('kettlebell de 20 kg menos de 50 mil', { now, commercial: hydrator({ P15: observed({}), P17: observed({ finalGrossClp: null }) }) });
    expect(keys(response)).toEqual(['P15']);
    expect(price(response, 'P15')).toMatchObject({ state: 'SATISFIED', source: 'COMMERCIAL_TRUTH' });
    const outside = await run('kettlebell de 20 kg menos de 40 mil', { now, commercial: hydrator({ P15: observed({}) }) });
    expect(outside.response.rejected.map((candidate) => candidate.productKey)).toContain('P15');
    const absent = await run('kettlebell de 20 kg menos de 50 mil', { now, commercial: hydrator({}) });
    expect(price(absent.response, 'P15')!.reason).toMatch(/^COMMERCIAL_TRUTH_NOT_OBSERVED/u);
    expect(absent.agent.commercial).toEqual({ status: 'NOT_OBSERVED', reason: 'COMMERCIAL_TRUTH_NOT_OBSERVED' });
  });

  it('handles non-sellable, available and expired observations', async () => {
    const notSellable = await run('kettlebell de 20 kg disponible', { now, commercial: hydrator({ P15: observed({ sellability: 'not_sellable', availabilityReason: 'out_of_stock' }) }) });
    expect(notSellable.response.rejected.map((candidate) => candidate.productKey)).toContain('P15');
    const available = await run('kettlebell de 20 kg disponible', { now, commercial: hydrator({ P15: observed({}) }) });
    expect(keys(available.response)).toEqual(['P15']);
    expect(available.agent.verified.length + (available.agent.exactMatch ? 1 : 0)).toBeGreaterThan(0);
    const expired = await run('kettlebell de 20 kg disponible', { now: () => new Date('2026-10-09T00:00:00.000Z'), commercial: hydrator({ P15: observed({}) }) });
    expect(keys(expired.response)).toEqual([]);
    expect(expired.response.possible.find((candidate) => candidate.productKey === 'P15')!.constraintResults.find((result) => result.kind === 'COMMERCIAL_AVAILABILITY')!.reason)
      .toMatch(/^COMMERCIAL_OBSERVATION_EXPIRED/u);
  });

  it('degrades explicitly on a partial or total hydration failure without inventing values', async () => {
    const failing: CommercialHydrator = { label: 'failing', hydrate: async () => { throw new Error('owner down'); } };
    const { response, agent } = await run('kettlebell de 20 kg menos de 50 mil', { commercial: failing });
    expect(response.completeness.commercialHydration.failed).toBe(true);
    expect(response.completeness.degraded).toContain('COMMERCIAL_HYDRATION_FAILED');
    expect(agent.completeness.warnings).toContain('COMMERCIAL_HYDRATION_FAILED');
    expect(keys(response)).toEqual([]);
    const partial = await run('kettlebell de 20 kg menos de 50 mil', { now, commercial: hydrator({ P15: { status: 'NOT_OBSERVED', reason: 'COMMERCIAL_TRUTH_UNAVAILABLE' } }) });
    expect(price(partial.response, 'P15')!.reason).toBe('COMMERCIAL_TRUTH_NOT_OBSERVED:COMMERCIAL_TRUTH_UNAVAILABLE');
  });

  it('declares COMMERCIAL_TRUTH_NOT_OBSERVED offline and never emits price or stock', async () => {
    const { response, agent } = await run('kettlebell de 20 kg menos de 50 mil');
    expect(response.completeness.noResultReason).toBe('COMMERCIAL_TRUTH_NOT_OBSERVED');
    expect(agent.completeness.warnings).toContain('COMMERCIAL_TRUTH_NOT_OBSERVED');
    expect(JSON.stringify(agent)).not.toMatch(/"price"|"finalGross|"stock"/u);
  });
});

describe('ranking, bounds and output V0.2', () => {
  it('ranks deterministically and puts a violating candidate below conforming ones regardless of its name', async () => {
    const [first, second] = [await run('kettlebell 20kg'), await run('kettlebell 20kg')];
    expect(JSON.stringify(second.response)).toBe(JSON.stringify(first.response));
    expect(JSON.stringify(second.agent)).toBe(JSON.stringify(first.agent));
    const pool = first.diagnostics.pool;
    const firstRejected = pool.findIndex((item) => item.disposition === 'REJECTED');
    expect(pool.slice(firstRejected).every((item) => item.disposition === 'REJECTED')).toBe(true);
  });

  it('spends the commercial hydration budget on technically conforming candidates first', async () => {
    // Twelve lexically stronger products whose weight is only approximate (POSSIBLE) and one lexically weak,
    // technically verified product: by pure relevance (the V0 hydration order) it falls beyond the bound.
    const many = syntheticIndex([
      ...Array.from({ length: 12 }, (_value, offset) => doc({ id: 200 + offset, name: `Kettlebell Competencia 20kg Modelo ${offset + 1}`, family: 'KETTLEBELL',
        specs: [{ key: 'weight_kg', value: 20, rawValue: '20 kg. aprox', qualifier: 'aprox' }] })),
      doc({ id: 300, name: 'Pesa Hierro Basica', family: 'KETTLEBELL', specs: [{ key: 'weight_kg', value: 20 }] }),
    ]);
    const seen: string[] = [];
    const spy: CommercialHydrator = { label: 'spy', hydrate: async (productKeys) => { seen.push(...productKeys); return new Map(productKeys.map((key) => [key, { status: 'NOT_OBSERVED', reason: 'SPY' } as const])); } };
    const { diagnostics, response } = await discoverV0({ schemaVersion: 1, need: 'kettlebell de 20 kg menos de 50 mil' }, { index: many, mode: 'HYBRID', commercial: spy, hydrationBound: 3 });
    expect(diagnostics.hydration.verifiedPositionsInRelevanceOrder).toEqual([13]);
    expect(seen[0]).toBe('P300');
    expect(seen).toHaveLength(3);
    expect(response.completeness.commercialHydration).toMatchObject({ bound: 3, requested: 3, technicallyEligibleBeyondBound: 10 });
  });

  it('declares truncation instead of hiding it', async () => {
    const many = syntheticIndex(Array.from({ length: 30 }, (_value, offset) => doc({ id: 400 + offset, name: `Kettlebell Hierro Modelo ${offset + 1}`, family: 'KETTLEBELL' })));
    const { response, agent } = await discoverV0({ schemaVersion: 1, need: 'kettlebell', limit: 50 }, { index: many, mode: 'HYBRID' });
    expect(response.verified).toHaveLength(8);
    expect(response.completeness).toMatchObject({ truncated: true, verifiedCount: 30 });
    expect(agent.verified.length).toBeLessThanOrEqual(8);
    expect(agent.completeness).toMatchObject({ verified: 30, truncated: true });
  });

  it('produces a compact agent response from the same internal result', async () => {
    const { response, agent } = await run('soporte de barra');
    expect(agent.possible.length).toBeLessThanOrEqual(3);
    expect(agent.verified.length).toBeLessThanOrEqual(8);
    expect(agent.interpretation.ambiguities[0]!.readings).toHaveLength(2);
    expect(agent.completeness.warnings).toEqual(expect.arrayContaining(['AMBIGUOUS_NEED', 'COMMERCIAL_TRUTH_NOT_OBSERVED']));
    expect(agent.lineage).toEqual({ bundleId: response.lineage.bundleId, sourceExtractionId: response.lineage.sourceExtractionId, version: 'catalog-discover-v0.2', lexicon: response.lineage.lexiconVersion });
    const serialized = JSON.stringify(agent);
    expect(serialized).not.toMatch(/"signals"|"scoreComponents"|"entries"|"lexicalTokens"|"rawValue"|"evidence"/u);
    expect(agent.possible.every((candidate) => response.possible.some((item) => item.productKey === candidate.productKey))).toBe(true);
    expect(Buffer.byteLength(serialized)).toBeLessThan(Buffer.byteLength(JSON.stringify(response)));
  });

  it('degrades explicitly when a projection is unavailable', async () => {
    const withoutSpecs = syntheticIndex(catalog().map((item) => ({ ...item, specs: null })), { degraded: ['SPECS_UNAVAILABLE'] });
    const { response, agent } = await discoverV0({ schemaVersion: 1, need: 'discos de 10 kg' }, { index: withoutSpecs, mode: 'HYBRID' });
    expect(response.completeness.degraded).toContain('SPECS_UNAVAILABLE');
    expect(agent.completeness.degraded).toContain('SPECS_UNAVAILABLE');
    expect(keys(response)).toEqual([]);
    expect(spec(response, 'P6')!.reason).toBe('SPECS_UNAVAILABLE');
  });

  it('LEXICAL_PLUS keeps every technical constraint unevaluated (POSSIBLE only)', async () => {
    const { response } = await discoverV0({ schemaVersion: 1, need: 'discos de 10 kg' }, { index, mode: 'LEXICAL_PLUS' });
    expect(keys(response)).toEqual([]);
    expect(response.possible.flatMap((candidate) => candidate.constraintResults).every((result) => result.reason === 'NOT_EVALUATED_IN_LEXICAL_MODE')).toBe(true);
  });
});

describe('QuantityScope V0.2 — component counts from names', () => {
  it('counts units only from leading pair/pack/set wording, never from a capacity', async () => {
    const { componentCountFromName } = await import('../../../src/application/catalog/discover-v0/quantityScope.js');
    expect(componentCountFromName('Par Discos Goma 10kg')).toBe(2);
    expect(componentCountFromName('Pack 8 Pares de Mancuernas (2.5 a 20kg)')).toBe(16);
    expect(componentCountFromName('Pack 4 Palmetas de Caucho 50x50cm x 25mm')).toBe(4);
    expect(componentCountFromName('Soporte de Barra x2 Accesorio')).toBe(2);
    expect(componentCountFromName('Mancuerna Hexagonal 35kg (Unidad)')).toBe(1);
    expect(componentCountFromName('Rack de Almacenamiento Mancuernas 6 pares Vertical')).toBe(1);
    expect(componentCountFromName('Pack 150kg Classic Black')).toBeNull();
  });
});
