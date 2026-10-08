import { describe, expect, it } from 'vitest';
import { commercialTruthHydrator, type CommercialHydrator } from '../../../src/application/catalog/discover-v0/commercialHydrator.js';
import type { DiscoverV0Response } from '../../../src/application/catalog/discover-v0/contracts.js';
import { discoverV0 } from '../../../src/application/catalog/discover-v0/discoverV0.js';
import { compareLists, ndcgAtK, percentile, precisionAtK, recallAtK, reciprocalRank } from '../../../src/application/catalog/discover-v0/evaluation.js';
import { specQualifier } from '../../../src/application/catalog/discover-v0/retrievalDocument.js';
import { doc, SYNTHETIC_BUNDLE_ID, SYNTHETIC_SOURCE_ID, syntheticCatalog, syntheticIndex } from './fixtures.js';

const index = syntheticIndex(syntheticCatalog());
const run = (need: string, mode: 'HYBRID' | 'LEXICAL_PLUS' = 'HYBRID', extra: Partial<Parameters<typeof discoverV0>[1]> = {}) =>
  discoverV0({ schemaVersion: 1, need }, { index, mode, ...extra });
const keys = (response: DiscoverV0Response) => response.verified.map((candidate) => candidate.productKey);
const unverified = (response: DiscoverV0Response) => response.possible.map((candidate) => candidate.productKey);

describe('catalog.discoverV0 — contract invariants (synthetic)', () => {
  it('is deterministic for identical inputs', async () => {
    for (const need of ['pesa rusa de 20 kg', 'barra de dominadas', 'agarre para polea', 'algo para entrenar espalda']) {
      const [first, second] = [await run(need), await run(need)];
      expect(JSON.stringify(second.response)).toBe(JSON.stringify(first.response));
      expect(second.diagnostics.pool).toEqual(first.diagnostics.pool);
    }
  });

  it('never returns more than eight candidates per list nor duplicate productKeys', async () => {
    const many = syntheticIndex(Array.from({ length: 30 }, (_value, offset) => doc({ id: 100 + offset, name: `Kettlebell Hierro ${offset + 1}kg`, family: 'KETTLEBELL' })));
    const { response } = await discoverV0({ schemaVersion: 1, need: 'kettlebell', limit: 50 }, { index: many, mode: 'HYBRID' });
    expect(response.verified.length).toBe(8);
    expect(response.completeness.truncated).toBe(true);
    const all = [...keys(response), ...unverified(response)];
    expect(new Set(all).size).toBe(all.length);
  });

  // V0.2 INTENTIONAL CHANGE (CAT-DISCOVER-V0.2 §5): V0 demoted every hard constraint to a preference on an
  // exact name match. V0.2 resolves the exact entity separately and keeps the ORIGINAL constraints for
  // related products. New expectation: exact entities still dominate rank 1, constraints stay hard.
  it('lets exact productKey and exact name matches dominate without demoting their constraints', async () => {
    const byKey = await run('P2');
    expect(keys(byKey.response)[0]).toBe('P2');
    const byName = await run('Kettlebell Hierro 24kg');
    expect(byName.diagnostics.exactResolution).toMatchObject({ status: 'RESOLVED', kind: 'NAME', productKeys: ['P2'] });
    expect(keys(byName.response)[0]).toBe('P2');
    expect(byName.response.interpretation.hardConstraints.map((constraint) => constraint.kind).sort()).toEqual(['PRODUCT_TYPE', 'SPEC']);
    expect(byName.response.interpretation.softPreferences).toEqual([]);
  });

  it('only presents candidates whose every hard constraint is SATISFIED; UNKNOWN goes to unverified', async () => {
    const { response } = await run('pesa rusa de 20 kg');
    expect(keys(response)).toEqual(['P1']);
    for (const candidate of response.verified) expect(candidate.constraintResults.filter((result) => result.hard).every((result) => result.state === 'SATISFIED')).toBe(true);
    expect(unverified(response)).toEqual(expect.arrayContaining(['P3', 'P4', 'P5']));
    const reasons = Object.fromEntries(response.possible.map((candidate) => [candidate.productKey, candidate.constraintResults.find((result) => result.kind === 'SPEC')!.reason]));
    expect(reasons.P3).toBe('SPEC_MISSING');
    // V0.2 INTENTIONAL CHANGE (§6): the qualifier is now typed. "Aprox. (No calibrada)" is an approximate
    // value that never satisfies an exact (EQ) constraint, instead of a generic contextual qualifier.
    expect(reasons.P4).toMatch(/^APPROXIMATE_VALUE/u);
    expect(reasons.P5).toMatch(/^SPEC_FILTERING_NOT_ADMITTED/u);
    expect([...keys(response), ...unverified(response)]).not.toContain('P2');
    expect(response.completeness.rejectedCount).toBeGreaterThan(0);
  });

  it('never lets a name/text match certify a technical condition', async () => {
    const { response } = await run('pesa rusa de 20 kg');
    const vinyl = response.possible.find((candidate) => candidate.productKey === 'P3')!;
    expect(vinyl.matchedBy.some((signal) => signal.startsWith('LEXICAL:'))).toBe(true);
    expect(vinyl.constraintResults.find((result) => result.kind === 'SPEC')!.state).toBe('UNKNOWN');
  });

  // V0.2 INTENTIONAL CHANGE (§6, "Bumper de 10 kg"): V0 kept every qualified value UNKNOWN. A value the
  // source states explicitly per disc ("20 kg. cada disco"), on a plate product whose name agrees, now
  // satisfies a PER_UNIT weight constraint; the scope is reported with the result.
  it('certifies an explicit per-disc weight for a per-unit query and reports its scope', async () => {
    const { response } = await run('disco de 20 kg');
    expect(keys(response)).toContain('P7');
    const plate = response.verified.find((candidate) => candidate.productKey === 'P7')!;
    expect(plate.constraintResults.find((result) => result.kind === 'SPEC')).toMatchObject({ state: 'SATISFIED', quantity: { scope: 'PER_UNIT', appliesTo: 'disco', derived: false } });
  });

  it('treats an ABSENT negative as UNKNOWN and a PRESENT negative as VIOLATED for a modeled exercise', async () => {
    const { response } = await run('algo para hacer dominadas');
    expect(keys(response)).toContain('P10');
    expect(keys(response)).not.toContain('P11');
    const accessory = response.possible.find((candidate) => candidate.productKey === 'P11');
    expect(accessory?.constraintResults[0]!.reason).toMatch(/^ASSIGNED_BUT_NOT_ADMITTED/u);
    expect(keys(response)).not.toContain('P12');
  });

  it('does not certify a family whose own obligation contract is unmet (passive pulley accessory)', async () => {
    const { response } = await run('maquina de poleas');
    expect(keys(response)).toEqual(['P21']);
    const grip = response.possible.find((candidate) => candidate.productKey === 'P20');
    expect(grip?.constraintResults[0]!.reason).toBe('FAMILY_OBLIGATION_UNMET:TRAINING_FUNCTION');
  });

  it('keeps classified-but-not-admitted products (J-cups) unverified and drops off-target family members', async () => {
    const { response, diagnostics } = await run('j cups');
    expect(keys(response)).toEqual([]);
    expect(unverified(response)).toEqual(['P22']);
    expect(diagnostics.offTargetDropped).toBeGreaterThan(0);
    expect(response.completeness.noResultReason).toBe('ONLY_UNVERIFIABLE_CANDIDATES');
  });

  it('never infers compatibility from names or families', async () => {
    const { response } = await run('collarines compatibles con barra olimpica');
    expect(keys(response)).toEqual([]);
    for (const candidate of response.possible) {
      expect(candidate.constraintResults.find((result) => result.kind === 'COMPATIBILITY')!.state).toBe('UNSUPPORTED');
    }
    expect(response.completeness.noResultReason).toBe('HARD_CONSTRAINT_UNSUPPORTED');
  });

  it('never fabricates price or stock offline and leaves commercial constraints UNKNOWN', async () => {
    const { response } = await run('pesa rusa de 20 kg menos de 50 mil');
    expect(keys(response)).toEqual([]);
    for (const candidate of [...response.verified, ...response.possible]) {
      expect(candidate.commercial).toEqual({ status: 'NOT_OBSERVED', reason: 'OFFLINE_RUN_NO_COMMERCIAL_TRUTH' });
      expect(JSON.stringify(candidate)).not.toMatch(/"finalGross|"price"|"stock"/u);
    }
    expect(response.completeness.noResultReason).toBe('COMMERCIAL_TRUTH_NOT_OBSERVED');
  });

  it('uses commercial data only when a Commercial Truth hydrator observed it', async () => {
    const hydrator: CommercialHydrator = { label: 'test', hydrate: async (productKeys) => new Map(productKeys.map((key) => [key, key === 'P1'
      ? { status: 'OBSERVED', authority: 'test-owner', asOf: '2026-10-08T00:00:00.000Z', finalGrossClp: 45000, sellability: 'sellable' } as const
      : { status: 'NOT_OBSERVED', reason: 'TEST' } as const])) };
    const { response } = await run('pesa rusa de 20 kg menos de 50 mil', 'HYBRID', { commercial: hydrator });
    expect(keys(response)).toEqual(['P1']);
    expect(response.verified[0]!.constraintResults.find((result) => result.kind === 'COMMERCIAL_MAX_PRICE')).toMatchObject({ state: 'SATISFIED', source: 'COMMERCIAL_TRUTH' });
  });

  it('maps a real ProductContext response through the commercial truth hydrator without inventing values', async () => {
    const hydrator = commercialTruthHydrator({
      getProductContext: async ({ productKey }) => (productKey === 'P1'
        ? { status: 'found', freshness: { asOf: '2026-10-08T00:00:00.000Z' }, derived: { priceSummary: { finalGross: { amount: 39990 } }, availability: { sellability: 'not_sellable' } } }
        : { schemaVersion: 1, status: 'not_found', productKey }) as never,
    });
    const observed = await hydrator.hydrate(['P1', 'P2']);
    expect(observed.get('P1')).toMatchObject({ status: 'OBSERVED', finalGrossClp: 39990, sellability: 'not_sellable' });
    expect(observed.get('P2')).toEqual({ status: 'NOT_OBSERVED', reason: 'PRODUCT_CONTEXT_NOT_FOUND' });
  });

  it('degrades explicitly when an optional projection is unavailable', async () => {
    const withoutTraining = syntheticIndex(syntheticCatalog().map((item) => ({ ...item, training: null })), { degraded: ['TRAINING_V2_UNAVAILABLE'] });
    const { response } = await discoverV0({ schemaVersion: 1, need: 'barra de dominadas' }, { index: withoutTraining, mode: 'HYBRID' });
    expect(response.completeness.degraded).toContain('TRAINING_V2_UNAVAILABLE');
    expect(keys(response)).toEqual([]);
    expect(unverified(response).length).toBeGreaterThan(0);
    expect(response.possible[0]!.constraintResults[0]!.reason).toBe('TRAINING_V2_UNAVAILABLE');
  });

  it('reports bundle and source lineage of the index it ran on', async () => {
    const { response } = await run('kettlebell');
    // V0.2 INTENTIONAL CHANGE: retrieval version bumped to catalog-discover-v0.2 (lineage must name the code that ran).
    expect(response.lineage).toMatchObject({ bundleId: SYNTHETIC_BUNDLE_ID, sourceExtractionId: SYNTHETIC_SOURCE_ID, retrievalVersion: 'catalog-discover-v0.2' });
    expect(response.lineage.indexFingerprint).toMatch(/^sha256:/u);
  });

  it('excludes products outside the universe (inactive) from every list', async () => {
    const { response } = await run('kettlebell 20kg');
    expect([...keys(response), ...unverified(response)]).not.toContain('P30');
  });

  it('LEXICAL_PLUS never verifies technical constraints', async () => {
    const { response } = await run('pesa rusa de 20 kg', 'LEXICAL_PLUS');
    expect(keys(response)).toEqual([]);
    expect(unverified(response)).toContain('P1');
    expect(response.possible.flatMap((candidate) => candidate.constraintResults).every((result) => result.reason === 'NOT_EVALUATED_IN_LEXICAL_MODE')).toBe(true);
    expect(response.completeness.strategy).toEqual(['EXACT', 'LEXICAL']);
  });

  it('marks partial text matches of uninterpreted queries as unverified (weak-match penalty)', async () => {
    const { response } = await run('bicicleta de ruta');
    expect(keys(response)).toEqual([]);
    expect(unverified(response)).toEqual(['P32']);
  });

  it('keeps bundle components (packs) unverified instead of widening the family', async () => {
    const { response } = await run('pack de mancuernas con rack');
    expect(keys(response)).toEqual([]);
    expect(unverified(response)).toEqual(['P31']);
  });
});

describe('spec qualifier policy', () => {
  it('flags contextual qualifiers and accepts plain values and dimension labels', () => {
    expect(specQualifier('weight_kg', '20 kg.')).toBeNull();
    expect(specQualifier('weight_kg', '10 kg. cada disco')).toBe('cada disco');
    expect(specQualifier('weight_kg', '1,6 kg. (el par)')).toBe('el par');
    expect(specQualifier('max_load_kg', '300 kg. (Incluido el peso de usuario)')).toBe('incluido el peso de usuario');
    expect(specQualifier('assembled_height_cm', 'Largo: 120 cm.  Ancho: 84 cm. Alto: 79 cm.')).toBeNull();
    expect(specQualifier('assembled_length_cm', 'Largo: 68 cm. Ancho: 28 cm. Alto nivel 1: 10 cm.')).toBe('nivel');
  });
});

describe('evaluation metrics (only for adjudicated gold)', () => {
  const relevant = new Set(['P1', 'P3']);
  it('computes P@3, R@8, MRR and nDCG@8', () => {
    expect(precisionAtK(['P2', 'P1', 'P3'], relevant, 3)).toBeCloseTo(2 / 3);
    expect(recallAtK(['P2', 'P1'], relevant, 8)).toBe(0.5);
    expect(reciprocalRank(['P2', 'P1'], relevant)).toBe(0.5);
    expect(ndcgAtK(['P1', 'P3'], relevant, 8)).toBeCloseTo(1);
    expect(recallAtK(['P1'], new Set(), 8)).toBeNull();
  });
  it('compares ranked lists without a gold', () => {
    expect(compareLists(['P1', 'P2'], ['P2', 'P3'])).toMatchObject({ overlap: 1, added: ['P3'], removed: ['P1'], top1Changed: true, meanAbsRankShift: 1 });
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });
});
