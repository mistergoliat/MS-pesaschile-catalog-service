import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { discoverTokens } from '../../../src/application/catalog/discover-v0/text.js';

/*
 * CAT-DISCOVER held-out set validator (contract discover-heldout-contract-v1).
 * Read-only. It never creates queries or labels: it only checks that a file
 * collected by humans respects the independence and adjudication rules before it
 * is used for an official comparison.
 *
 *   npx tsx scripts/catalog-v2/discover-v0/heldout.ts --file=<heldout.json>
 */

const DEVELOPMENT_SET = 'scripts/catalog-v2/discover-v0/benchmark/benchmark_queries.v1.json';
const SOURCES = new Set(['AUTHORIZED_ANONYMIZED_COMMERCIAL_LOG', 'SALES_TEAM_ELICITATION']);
const PII = [/[\w.+-]+@[\w-]+\.[\w.]+/u, /\+?56\s?9\s?\d{4}\s?\d{4}/u, /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/u];

type HeldoutQuery = {
  queryId: string; query: string; source: string; sourceRef?: string; collectedAt?: string;
  adjudication?: { status: string; reviewers?: string[]; adjudicator?: string | null; relevantProductKeys?: string[] };
};
type HeldoutFile = { heldoutVersion: string; frozenAt: string; usedForTuning: boolean; catalogObservation?: string; queries: HeldoutQuery[] };

export function validateHeldout(file: HeldoutFile, developmentQueries: readonly string[]): string[] {
  const errors: string[] = [];
  const normalize = (text: string) => discoverTokens(text).join(' ');
  const development = new Set(developmentQueries.map(normalize));
  if (file.usedForTuning !== false) errors.push('USED_FOR_TUNING: a set used to change rules or weights is no longer held-out');
  if (!file.frozenAt || Number.isNaN(Date.parse(file.frozenAt))) errors.push('NOT_FROZEN: frozenAt is required');
  if (file.queries.length < 80 || file.queries.length > 100) errors.push(`SIZE: ${file.queries.length} queries (contract 80–100)`);
  const ids = new Set<string>();
  for (const query of file.queries) {
    if (ids.has(query.queryId)) errors.push(`DUPLICATE_ID:${query.queryId}`);
    ids.add(query.queryId);
    if (!SOURCES.has(query.source)) errors.push(`SOURCE_NOT_ALLOWED:${query.queryId}:${query.source}`);
    if (development.has(normalize(query.query))) errors.push(`OVERLAPS_DEVELOPMENT_SET:${query.queryId}`);
    if (PII.some((pattern) => pattern.test(query.query))) errors.push(`POSSIBLE_PII:${query.queryId}`);
    const adjudication = query.adjudication;
    if (adjudication?.status === 'ADJUDICATED') {
      const reviewers = adjudication.reviewers ?? [];
      if (reviewers.length !== 2 || reviewers[0] === reviewers[1]) errors.push(`ADJUDICATION_NEEDS_TWO_REVIEWERS:${query.queryId}`);
      if (adjudication.adjudicator && reviewers.includes(adjudication.adjudicator)) errors.push(`ADJUDICATOR_MUST_DIFFER:${query.queryId}`);
    } else if ((adjudication?.relevantProductKeys ?? []).length > 0) {
      errors.push(`LABELS_WITHOUT_ADJUDICATION:${query.queryId}`);
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
  if (!options.file) throw new Error('INVALID_ARGUMENT: --file is required');
  const bytes = await readFile(options.file);
  const file = JSON.parse(bytes.toString('utf8')) as HeldoutFile;
  const development = (JSON.parse(await readFile(DEVELOPMENT_SET, 'utf8')) as { queries: { query: string }[] }).queries.map((query) => query.query);
  const errors = validateHeldout(file, development);
  console.log(JSON.stringify({ file: options.file, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, queries: file.queries.length,
    adjudicated: file.queries.filter((query) => query.adjudication?.status === 'ADJUDICATED').length, valid: errors.length === 0, errors }, null, 2));
  if (errors.length > 0) process.exitCode = 2;
}

if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('scripts/catalog-v2/discover-v0/heldout.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
