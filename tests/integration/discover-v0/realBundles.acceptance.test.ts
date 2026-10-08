import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConstraintVerifier } from '../../../src/application/catalog/discover-v0/constraintVerifier.js';
import { discoverV0 } from '../../../src/application/catalog/discover-v0/discoverV0.js';
import { ProductRetrievalDocumentBuilder } from '../../../src/application/catalog/discover-v0/retrievalDocument.js';
import { CANDIDATE_BUNDLE_ID, FROZEN_SOURCE_EXTRACTION_ID, PRODUCTION_BUNDLE_ID } from '../../../src/infrastructure/catalog/discover-v0/frozenInputLoader.js';
import { DISCOVER_V0_PATHS, loadWorkspace, runVariant, type Workspace } from '../../../scripts/catalog-v2/discover-v0/workspace.js';

/*
 * CAT-DISCOVER-V0 acceptance on the REAL frozen source and BOTH bundles (offline,
 * read-only). Skipped when the frozen inputs are not present on this machine.
 */

const available = [DISCOVER_V0_PATHS.source, DISCOVER_V0_PATHS.production, DISCOVER_V0_PATHS.candidate].every((dir) => existsSync(path.join(dir, dir === DISCOVER_V0_PATHS.source ? 'projection_input_manifest.json' : 'manifest.json')));
const CABLE_CONFLICT = ['P437', 'P454', 'P455', 'P462', 'P466', 'P1004', 'P1020', 'P1022', 'P1343', 'P1344', 'P1345', 'P1346', 'P1347', 'P1348', 'P1349', 'P1350', 'P1917', 'P1996', 'P2195', 'P2285'];

function fingerprints(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of [DISCOVER_V0_PATHS.source, DISCOVER_V0_PATHS.production, DISCOVER_V0_PATHS.candidate]) {
    for (const file of readdirSync(dir).sort()) out[`${dir}/${file}`] = createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex');
  }
  return out;
}

describe.skipIf(!available)('CAT-DISCOVER-V0 acceptance on frozen production inputs', () => {
  let workspace: Workspace;
  let before: Record<string, string>;
  const hybrid = (need: string, bundle: 'production' | 'candidate' = 'candidate') => discoverV0({ schemaVersion: 1, need }, { index: workspace.indexes[bundle], mode: 'HYBRID' });

  beforeAll(async () => {
    before = fingerprints();
    workspace = await loadWorkspace();
  }, 120_000);

  afterAll(() => {
    if (before) expect(fingerprints()).toEqual(before);
  });

  it('evaluates both bundles from verified bytes without any pointer or activation', () => {
    expect(workspace.production.input.bundleId).toBe(PRODUCTION_BUNDLE_ID);
    expect(workspace.candidate.input.bundleId).toBe(CANDIDATE_BUNDLE_ID);
    for (const bundle of [workspace.production, workspace.candidate]) {
      expect(bundle.input.lineageVerified).toBe(true);
      expect(bundle.verification).toMatchObject({ schemaValid: true, bundleIdMatches: true, sourceMatches: true });
    }
    expect(workspace.source.input.sourceExtractionId).toBe(FROZEN_SOURCE_EXTRACTION_ID);
    expect(workspace.indexes.production.lexicalFingerprint).toBe(workspace.indexes.candidate.lexicalFingerprint);
    expect(workspace.indexes.production.universe).toEqual(workspace.indexes.candidate.universe);
    expect(workspace.baseline.universeSize).toBe(workspace.indexes.candidate.universe.length);
  });

  it('reuses the real catalog.search for the baseline', async () => {
    const run = await runVariant(workspace, 'A', 'kettlebell 20 kg');
    expect(run.primary).toEqual(expect.arrayContaining(['P186', 'P196']));
    expect(run.primary).not.toContain('P187');
    expect(run.search?.response?.results.every((result) => result.priceSummary === null)).toBe(true);
  });

  // V0.2 INTENTIONAL CHANGE (§5): V0 asserted the exact product at primary[0] because it demoted every
  // constraint to a preference. V0.2 resolves the exact entity separately (always returned, rank 1 of the
  // comparable retrieval list) and no longer forces it into VERIFIED_MATCH: in LEXICAL_PLUS nothing technical
  // is verified, and an unadmitted entity (J-Cups P1807) keeps its UNKNOWN disposition.
  it('keeps exact name and productKey matches at rank 1 in every discover variant', async () => {
    for (const [need, key] of [['Kettlebell Acero 20kg | HWM®', 'P186'], ['Power Rack Alpha | HWM®', 'P1543'], ['P1124', 'P1124'], ['Par J-Cups Accesorio Delta | HWM®', 'P1807']] as const) {
      for (const variant of ['B', 'C', 'D'] as const) {
        const run = await runVariant(workspace, variant, need);
        expect(run.exact, `${variant} ${need}`).toEqual([key]);
        expect(run.retrieval[0], `${variant} ${need}`).toBe(key);
        expect(run.discover!.agent.exactMatch?.productKey, `${variant} ${need}`).toBe(key);
      }
    }
    expect((await runVariant(workspace, 'D', 'Par J-Cups Accesorio Delta | HWM®')).discover!.response.exactResolution.entities[0]!.disposition).toBe('POSSIBLE_MATCH');
  });

  it('never presents a candidate whose hard constraints are not all SATISFIED', async () => {
    const needs = ['pesa rusa de 20 kg', 'banco para una persona de 150 kg', 'barra de dominadas', 'maquina de poleas', 'algo para entrenar espalda', 'rack que soporte 400 kg', 'bumper 10 kg'];
    for (const bundle of ['production', 'candidate'] as const) {
      const verifier = new ConstraintVerifier(workspace.indexes[bundle]);
      for (const need of needs) {
        const { response } = await hybrid(need, bundle);
        for (const candidate of response.verified) {
          for (const constraint of response.interpretation.hardConstraints) {
            expect(verifier.verify(workspace.indexes[bundle].documents.get(candidate.productKey)!, constraint, true, 'HYBRID', candidate.commercial).state, `${bundle} ${need} ${candidate.productKey}`).toBe('SATISFIED');
          }
          expect(candidate.commercial.status).toBe('NOT_OBSERVED');
        }
        expect(response.lineage.bundleId).toBe(bundle === 'production' ? PRODUCTION_BUNDLE_ID : CANDIDATE_BUNDLE_ID);
      }
    }
  });

  it('does not certify passive pulley accessories or unadmitted J-Cups (QA2-R1/R5)', async () => {
    const cable = await hybrid('maquina de poleas');
    expect(cable.response.verified.map((candidate) => candidate.productKey).filter((key) => CABLE_CONFLICT.includes(key))).toEqual([]);
    const jcups = await hybrid('j cups');
    expect(jcups.response.verified.map((candidate) => candidate.productKey)).not.toEqual(expect.arrayContaining(['P1807']));
    expect(jcups.response.possible.map((candidate) => candidate.productKey)).toEqual(expect.arrayContaining(['P1807', 'P1997']));
  });

  it('never infers compatibility and never fabricates commercial truth', async () => {
    for (const need of ['collarines compatibles con barra olimpica', 'barra compatible con discos olimpicos', 'pesas rusas de 20 kg menos de 50 mil']) {
      const { response } = await hybrid(need);
      expect(response.verified).toEqual([]);
      expect(response.possible.length).toBeGreaterThan(0);
    }
  });

  it('attributes the pull-up module differences to FIX2 (C vs D)', async () => {
    const old = (await hybrid('barra de dominadas', 'production')).response.verified.map((candidate) => candidate.productKey);
    const fix2 = (await hybrid('barra de dominadas', 'candidate')).response.verified.map((candidate) => candidate.productKey);
    expect(fix2).toEqual(expect.arrayContaining(['P2007', 'P1810', 'P2017']));
    expect(old).not.toContain('P2007');
  });

  it('degrades explicitly when Training V2 is unavailable', async () => {
    const degraded = new ProductRetrievalDocumentBuilder().build(workspace.source.input, {
      ...workspace.candidate.input,
      trainingV2: { status: 'UNAVAILABLE', snapshotId: null, projectionId: null, records: null, reason: 'in-memory degradation test' },
    });
    expect(degraded.degraded).toContain('TRAINING_V2_UNAVAILABLE');
    const { response } = await discoverV0({ schemaVersion: 1, need: 'algo para hacer dominadas' }, { index: degraded, mode: 'HYBRID' });
    expect(response.completeness.degraded).toContain('TRAINING_V2_UNAVAILABLE');
    expect(response.verified).toEqual([]);
    expect(response.possible.length).toBeGreaterThan(0);
    // V0.2 INTENTIONAL CHANGE (§5): the exact lookup still resolves without Training V2, but its RACK_CAGE claim is
    // no longer certified by demotion; it is returned through exactResolution with its own disposition.
    const lexicalStillWorks = await discoverV0({ schemaVersion: 1, need: 'Power Rack Alpha | HWM®' }, { index: degraded, mode: 'HYBRID' });
    expect(lexicalStillWorks.response.exactResolution.entities[0]?.productKey).toBe('P1543');
    expect(lexicalStillWorks.agent.exactMatch?.productKey).toBe('P1543');
  }, 60_000);
});
