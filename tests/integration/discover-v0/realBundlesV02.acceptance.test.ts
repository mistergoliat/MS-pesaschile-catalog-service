import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConstraintVerifier } from '../../../src/application/catalog/discover-v0/constraintVerifier.js';
import { discoverV0 } from '../../../src/application/catalog/discover-v0/discoverV0.js';
import { interpretSpecQuantity } from '../../../src/application/catalog/discover-v0/quantityScope.js';
import { CANDIDATE_BUNDLE_ID } from '../../../src/infrastructure/catalog/discover-v0/frozenInputLoader.js';
import { DISCOVER_V0_PATHS, loadWorkspace, type Workspace } from '../../../scripts/catalog-v2/discover-v0/workspace.js';

/*
 * CAT-DISCOVER-V0.2 acceptance on the REAL frozen source and the FIX2 candidate bundle
 * (offline, read-only). Skipped when the frozen inputs are not present on this machine.
 * Product ids below are observed catalog records used as assertions, never as rules.
 */

const available = [DISCOVER_V0_PATHS.source, DISCOVER_V0_PATHS.production, DISCOVER_V0_PATHS.candidate].every((dir) => existsSync(path.join(dir, dir === DISCOVER_V0_PATHS.source ? 'projection_input_manifest.json' : 'manifest.json')));
const QA2_COHORT = 'artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/specs_interpretation_risk.csv';

function fingerprints(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of [DISCOVER_V0_PATHS.source, DISCOVER_V0_PATHS.production, DISCOVER_V0_PATHS.candidate]) {
    for (const file of readdirSync(dir).sort()) out[`${dir}/${file}`] = createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex');
  }
  if (existsSync(QA2_COHORT)) out[QA2_COHORT] = createHash('sha256').update(readFileSync(QA2_COHORT)).digest('hex');
  return out;
}

describe.skipIf(!available)('CAT-DISCOVER-V0.2 acceptance on frozen production inputs (FIX2)', () => {
  let workspace: Workspace;
  let before: Record<string, string>;
  const hybrid = (need: string) => discoverV0({ schemaVersion: 1, need }, { index: workspace.indexes.candidate, mode: 'HYBRID' });

  beforeAll(async () => {
    before = fingerprints();
    workspace = await loadWorkspace();
  }, 120_000);

  afterAll(() => {
    if (before) expect(fingerprints()).toEqual(before);
  });

  it('no longer excludes the "Soporte de Barra" accessories on an ambiguous need (Q060)', async () => {
    for (const need of ['soporte de barra', 'soporte para barra']) {
      const { response } = await hybrid(need);
      const rejected = response.rejected.map((candidate) => candidate.productKey);
      for (const key of ['P2003', 'P1814', 'P2002', 'P1815']) expect(rejected, `${need} ${key}`).not.toContain(key);
      expect(response.possible.map((candidate) => candidate.productKey)).toEqual(expect.arrayContaining(['P2003', 'P1814']));
      expect(response.verified).toEqual([]);
      expect(response.interpretation.ambiguityGroups).toHaveLength(1);
    }
  });

  it('certifies plate storage by family and names the plates only as text (Q073)', async () => {
    const { response } = await hybrid('almacenamiento para discos');
    const verified = response.verified.map((candidate) => candidate.productKey);
    expect(verified).toEqual(expect.arrayContaining(['P479', 'P1510']));
    for (const key of verified) expect(workspace.indexes.candidate.documents.get(key)!.name.toLowerCase()).toMatch(/disco/u);
    expect(response.interpretation.hardConstraints.some((constraint) => constraint.kind === 'COMPATIBILITY')).toBe(false);
  });

  it('certifies explicitly per-disc bumper weights (Q081) and keeps packs unverified', async () => {
    const { response } = await hybrid('bumper 10 kg');
    expect(response.verified.map((candidate) => candidate.productKey)).toEqual(expect.arrayContaining(['P323', 'P824', 'P100']));
    for (const candidate of response.verified) {
      expect(candidate.constraintResults.find((result) => result.kind === 'SPEC')!.quantity).toMatchObject({ scope: 'PER_UNIT', appliesTo: 'disco' });
    }
    expect(response.verified.map((candidate) => candidate.productKey)).not.toContain('P1925');
  });

  it('keeps the original constraints for products related to an exact entity (EXACT_CONSTRAINT_REGRESSION)', async () => {
    const verifier = new ConstraintVerifier(workspace.indexes.candidate);
    for (const [need, exact] of [['P1543', 'P1543'], ['Kettlebell Acero 20kg | HWM®', 'P186'], ['kettlebell 20 kg', null], ['pesa rusa de 20 kg', null], ['barra de dominadas para usuario de 120 kg', null]] as const) {
      const { response, agent } = await hybrid(need);
      if (exact) {
        expect(response.exactResolution.productKeys, need).toEqual([exact]);
        expect(agent.exactMatch?.productKey, need).toBe(exact);
      } else {
        expect(response.exactResolution.status, need).toBe('NONE');
      }
      expect(response.interpretation.softPreferences.filter((constraint) => constraint.kind === 'SPEC' || constraint.kind === 'PRODUCT_TYPE'), need).toEqual([]);
      for (const candidate of response.verified) {
        for (const constraint of response.interpretation.hardConstraints) {
          const result = verifier.verify(workspace.indexes.candidate.documents.get(candidate.productKey)!, constraint, true, 'HYBRID', candidate.commercial, {
            requestedFamilies: response.interpretation.hardConstraints.filter((item) => item.kind === 'PRODUCT_TYPE').flatMap((item) => item.codes ?? []),
            requestedExercises: response.interpretation.hardConstraints.filter((item) => item.kind === 'EXERCISE').flatMap((item) => item.codes ?? []),
          });
          expect(result.state, `${need} ${candidate.productKey} ${constraint.id}`).toBe('SATISFIED');
        }
      }
    }
    const kettlebell = (await hybrid('Kettlebell Acero 20kg | HWM®')).response;
    expect(kettlebell.verified.map((candidate) => candidate.productKey)).not.toEqual(expect.arrayContaining(['P180']));
    expect(kettlebell.rejected.map((candidate) => candidate.productKey)).toContain('P180');
  });

  it('types every value of the QA2 qualified-spec cohort without silently resolving it', () => {
    if (!existsSync(QA2_COHORT)) return;
    const rows = readFileSync(QA2_COHORT, 'utf8').replace(/^﻿/u, '').trim().split(/\r?\n/u).slice(1)
      .map((line) => line.match(/"((?:[^"]|"")*)"/gu)!.map((cell) => cell.slice(1, -1).replaceAll('""', '"')));
    expect(rows).toHaveLength(88);
    const certification: Record<string, number> = {};
    for (const [productId, , key, , , rawValue] of rows) {
      const document = workspace.indexes.candidate.documents.get(`P${productId}`)!;
      const spec = document.specs!.find((item) => item.key === key && item.rawValue === rawValue)!;
      expect(spec, `${productId} ${key}`).toBeDefined();
      const quantity = interpretSpecQuantity(document, spec);
      certification[quantity.certification] = (certification[quantity.certification] ?? 0) + 1;
      expect(quantity.rule.length).toBeGreaterThan(0);
    }
    expect(Object.values(certification).reduce((sum, count) => sum + count, 0)).toBe(88);
    // Typing a qualifier never resolves the whole cohort: context-dependent and non-certifiable values remain.
    expect(certification.CERTIFIABLE ?? 0).toBeLessThan(88);
    expect((certification.CONDITIONAL ?? 0) + (certification.NOT_CERTIFIABLE ?? 0)).toBeGreaterThan(0);
  });

  it('keeps lineage, compact agent responses and determinism on the real bundle', async () => {
    for (const need of ['maquina de poleas', 'equipo de cardio', 'rack para sentadillas']) {
      const [first, second] = [await hybrid(need), await hybrid(need)];
      expect(JSON.stringify(second.response)).toBe(JSON.stringify(first.response));
      expect(first.agent.lineage.bundleId).toBe(CANDIDATE_BUNDLE_ID);
      expect(first.agent.possible.length).toBeLessThanOrEqual(3);
      expect(first.agent.verified.length).toBeLessThanOrEqual(8);
    }
  });
});
