import { mkdir, writeFile } from 'node:fs/promises';

// Usage:
//   npx tsx scripts/catalog-v2/evaluate-search-gold.ts                      (offline, production export)
//   CATALOG_GOLD_BASE_URL=https://... CATALOG_GOLD_API_KEY=... npx tsx scripts/catalog-v2/evaluate-search-gold.ts
// Read-only in both modes. Writes the report to docs/audits/catalog-search-gold/.
// The offline source never opens a database; the service's config still
// requires connection settings, so placeholders are set for this process only.
for (const [name, value] of Object.entries({ DB_HOST: 'offline.invalid', DB_USER: 'offline', DB_PASSWORD: 'offline', DB_NAME: 'offline', CATALOG_API_KEYS: 'offline-gold-key' })) {
  process.env[name] ??= value;
}
const { evaluateGoldSet, httpSearch, loadGoldSet, offlineSearch } = await import('./searchGold.js');
const baseUrl = process.env.CATALOG_GOLD_BASE_URL;
const apiKey = process.env.CATALOG_GOLD_API_KEY;
const gold = loadGoldSet();
const source = baseUrl ? `http:${new URL(baseUrl).host}` : 'offline:production-export-2026-08-29';
const report = await evaluateGoldSet(gold, baseUrl && apiKey ? httpSearch(baseUrl, apiKey) : offlineSearch(), source);

for (const [name, cls] of Object.entries(report.classes)) {
  const pct = (value: number | null) => (value === null ? '   -  ' : `${(value * 100).toFixed(1).padStart(5)}%`);
  console.log(`${name.padEnd(22)} ${cls.gate.padEnd(8)} ${cls.passed}/${cls.cases}  hit@1 ${pct(cls.hitAt1)}  recall@${gold.limit} ${pct(cls.recallAtLimit)}  excl.viol ${cls.exclusionViolations}  ${cls.gatePassed ? 'PASS' : 'FAIL'}`);
}
for (const outcome of report.outcomes.filter((candidate) => !candidate.pass)) {
  console.log(`  ✗ ${outcome.id} "${outcome.query}" top1=${outcome.top1Hit} missing=[${outcome.missing}] excluded-present=[${outcome.exclusionViolations}] returned=[${outcome.returned}]`);
}
console.log(`deterministic ordering: ${report.deterministic}  →  GOLD ${report.goldSetVersion}: ${report.passed ? 'PASS' : 'FAIL'}`);

await mkdir('docs/audits/catalog-search-gold', { recursive: true });
const file = `docs/audits/catalog-search-gold/${report.goldSetVersion}-${source.replace(/[^a-z0-9.-]+/giu, '_')}.json`;
await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
console.log(`report: ${file}`);
process.exitCode = report.passed ? 0 : 1;
