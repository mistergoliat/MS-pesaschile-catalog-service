import { describe, expect, it } from 'vitest';
import { validateHeldout } from '../../../scripts/catalog-v2/discover-v0/heldout.js';

/* SYNTHETIC: structural checks of the held-out contract; the queries are placeholders, not a held-out set. */

const queries = (count: number) => Array.from({ length: count }, (_value, offset) => ({ queryId: `H${String(offset + 1).padStart(3, '0')}`, query: `consulta placeholder ${offset + 1}`,
  source: 'SALES_TEAM_ELICITATION', adjudication: { status: 'NOT_ADJUDICATED' } }));

describe('held-out contract validator', () => {
  it('accepts a frozen, untouched, independent set of 80–100 queries', () => {
    expect(validateHeldout({ heldoutVersion: 'h1', frozenAt: '2026-10-08T00:00:00.000Z', usedForTuning: false, queries: queries(80) }, ['pesa rusa de 20 kg'])).toEqual([]);
  });

  it('rejects tuning use, wrong size, development overlap, PII and unadjudicated labels', () => {
    const items = queries(10);
    items[0] = { ...items[0]!, query: 'Pesa rusa de 20 KG' };
    items[1] = { ...items[1]!, query: 'escribir a cliente@example.com' };
    items[2] = { ...items[2]!, adjudication: { status: 'NOT_ADJUDICATED', relevantProductKeys: ['P1'] } as never };
    items[3] = { ...items[3]!, adjudication: { status: 'ADJUDICATED', reviewers: ['R1'], adjudicator: 'R1' } as never };
    const errors = validateHeldout({ heldoutVersion: 'h1', frozenAt: '2026-10-08T00:00:00.000Z', usedForTuning: true, queries: items }, ['pesa rusa de 20 kg']);
    expect(errors).toEqual(expect.arrayContaining(['USED_FOR_TUNING: a set used to change rules or weights is no longer held-out', 'SIZE: 10 queries (contract 80–100)',
      'OVERLAPS_DEVELOPMENT_SET:H001', 'POSSIBLE_PII:H002', 'LABELS_WITHOUT_ADJUDICATION:H003', 'ADJUDICATION_NEEDS_TWO_REVIEWERS:H004', 'ADJUDICATOR_MUST_DIFFER:H004']));
  });
});
