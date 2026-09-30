import { describe, expect, it } from 'vitest';
import { evaluateGoldSet, loadGoldSet, offlineSearch } from '../../scripts/catalog-v2/searchGold.js';

/**
 * R4-J1D §5 gate: nominal search Gold Set v0 over the committed production
 * export. Hard classes must be 100 %; typo is measured only. Per-class, never
 * one global score.
 */
describe('Catalog search Gold Set v0 (offline, production export)', () => {
  it('passes every hard class with deterministic ordering', async () => {
    const report = await evaluateGoldSet(loadGoldSet(), offlineSearch(), 'offline:production-export-2026-08-29');
    const failing = report.outcomes.filter((outcome) => !outcome.pass && report.classes[outcome.class]?.gate === 'hard');
    expect(failing).toEqual([]);
    expect(report.deterministic).toBe(true);
    for (const name of ['exact_sku', 'product_name', 'multi_token_nominal', 'unit_bearing', 'supported_synonyms']) {
      expect(report.classes[name]).toMatchObject({ gate: 'hard', passRate: 1, exclusionViolations: 0 });
    }
    expect(report.classes.typo?.gate).toBe('measured');
    expect(report.passed).toBe(true);
  }, 60_000);
});
