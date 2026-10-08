import { writeFile } from 'node:fs/promises';
import type { DiscoverCandidate } from '../../../src/application/catalog/discover-v0/contracts.js';
import { loadWorkspace, nameOf, runVariant, VARIANT_NAMES, VARIANTS, type Variant, type VariantRun, type Workspace } from './workspace.js';

/*
 * CAT-DISCOVER-V0 offline demo (no R4, no LLM, no network, no writes to inputs).
 *
 *   npm run catalog:discover:spike -- --query="pesa rusa de 20 kg" --mode=hybrid --bundle=candidate
 *   npm run catalog:discover:spike -- --query="pesa rusa de 20 kg" --compare
 *   npm run catalog:discover:spike -- --benchmark [--run-id=<id>]
 *   options: --mode=search|lexical|hybrid  --bundle=production|candidate  --variant=A|B|C|D
 *            --format=text|json  --out=<file.json>
 */

const options: Record<string, string> = {};
const flags = new Set<string>();
for (const arg of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/u.exec(arg);
  if (match) options[match[1]!] = match[2]!;
  else if (/^--[a-z-]+$/u.test(arg)) flags.add(arg.slice(2));
  else throw new Error(`INVALID_ARGUMENT: ${arg}`);
}

function variantFromOptions(): Variant {
  if (options.variant) {
    if (!(VARIANTS as readonly string[]).includes(options.variant)) throw new Error(`INVALID_ARGUMENT: --variant=${options.variant}`);
    return options.variant as Variant;
  }
  const mode = options.mode ?? 'hybrid';
  if (mode === 'search') return 'A';
  if (mode === 'lexical') return 'B';
  if (mode !== 'hybrid') throw new Error(`INVALID_ARGUMENT: --mode=${mode}`);
  const bundle = options.bundle ?? 'candidate';
  if (bundle !== 'candidate' && bundle !== 'production') throw new Error(`INVALID_ARGUMENT: --bundle=${bundle}`);
  return bundle === 'production' ? 'C' : 'D';
}

function line(candidate: DiscoverCandidate): string[] {
  const constraints = candidate.constraintResults.map((result) => `${result.hard ? 'H' : 's'}:${result.kind}=${result.state}${result.state === 'SATISFIED' ? '' : `(${result.reason})`}`);
  return [
    `  ${String(candidate.rank).padStart(2)}. ${candidate.productKey.padEnd(6)} ${candidate.name}`,
    `      score=${candidate.score.toFixed(3)} [exact=${candidate.scoreComponents.exactTier ?? '-'} L=${candidate.scoreComponents.lexical.toFixed(3)} S=${candidate.scoreComponents.structured.toFixed(3)} P=${candidate.scoreComponents.softPreferences.toFixed(2)}]`,
    `      matchedBy: ${candidate.matchedBy.join(', ')}`,
    ...candidate.whyMatched.map((why) => `      · ${why}`),
    ...(constraints.length ? [`      constraints: ${constraints.join('  ')}`] : []),
    `      price/stock: ${candidate.commercial.status}${candidate.commercial.status === 'NOT_OBSERVED' ? ` (${candidate.commercial.reason})` : ''}`,
  ];
}

function render(workspace: Workspace, run: VariantRun, query: string): string {
  const out = [`=== ${run.variant} ${VARIANT_NAMES[run.variant]} — "${query}"  (${(run.timings.total ?? 0).toFixed(1)} ms offline, ${run.bytes} bytes)`];
  if (run.search) {
    out.push(`  status=${run.search.status} totalMatches=${run.search.totalMatches} truncated=${run.search.truncated}  price/stock: NOT_OBSERVED (offline)`);
    run.search.productKeys.forEach((key, position) => out.push(`  ${String(position + 1).padStart(2)}. ${key.padEnd(6)} ${nameOf(workspace, key)}  [match=${run.search!.matchTypes[position]}]`));
    if (run.search.productKeys.length === 0) out.push('  (no results)');
    return out.join('\n');
  }
  const response = run.discover!.response;
  const interpretation = response.interpretation;
  out.push(`  recognized: ${interpretation.recognizedConcepts.join(', ') || '-'}   unrecognized: ${interpretation.unrecognizedTerms.join(', ') || '-'}`);
  out.push(`  hard: ${interpretation.hardConstraints.map((constraint) => `${constraint.kind}${constraint.codes ? `[${constraint.codes.join('|')}]` : ''}${constraint.specKey ? `[${constraint.specKey} ${constraint.operator} ${constraint.value}]` : ''}${constraint.target ? `[target ${constraint.target}]` : ''}${constraint.value !== undefined && !constraint.specKey ? `[${constraint.value}]` : ''}`).join(', ') || '-'}`);
  out.push(`  soft: ${interpretation.softPreferences.map((constraint) => `${constraint.kind}${constraint.codes ? `[${constraint.codes.join('|')}]` : ''}`).join(', ') || '-'}`);
  for (const entry of interpretation.entries.filter((item) => item.state === 'UNKNOWN')) out.push(`  UNKNOWN "${entry.text}": ${entry.note ?? ''}`);
  const completeness = response.completeness;
  out.push(`  completeness: pool=${completeness.candidateCount} eligible=${completeness.verifiedCount} unverified=${completeness.possibleCount} excluded=${completeness.rejectedCount} returned=${completeness.returnedCount} truncated=${completeness.truncated} degraded=[${completeness.degraded.join(',')}] noResult=${completeness.noResultReason ?? '-'}`);
  out.push('  CANDIDATES (all hard constraints SATISFIED):');
  out.push(...(response.verified.length ? response.verified.flatMap(line) : ['    (none)']));
  out.push('  UNVERIFIED (potentially relevant; some hard constraint UNKNOWN/UNSUPPORTED — not conforming recommendations):');
  out.push(...(response.possible.length ? response.possible.flatMap(line) : ['    (none)']));
  out.push(`  lineage: bundle=${response.lineage.bundleId} source=${response.lineage.sourceExtractionId} retrieval=${response.lineage.retrievalVersion} lexicon=${response.lineage.lexiconVersion}`);
  return out.join('\n');
}

async function main(): Promise<void> {
  if (flags.has('benchmark')) {
    const { runBenchmark } = await import('./benchmark.js');
    await runBenchmark({ runId: options['run-id'], queriesFile: options.queries });
    return;
  }
  const query = options.query;
  if (!query) throw new Error('INVALID_ARGUMENT: --query is required (or --benchmark)');
  const workspace = await loadWorkspace();
  const variants: Variant[] = flags.has('compare') ? [...VARIANTS] : [variantFromOptions()];
  const runs: VariantRun[] = [];
  for (const variant of variants) runs.push(await runVariant(workspace, variant, query));
  if (options.format === 'json' || options.out) {
    const payload = runs.map((run) => ({ variant: run.variant, name: VARIANT_NAMES[run.variant], primary: run.primary, unverified: run.unverified, retrieval: run.retrieval,
      response: run.discover?.response ?? run.search?.response ?? null, timingsMs: run.timings, serializedBytes: run.bytes }));
    if (options.out) await writeFile(options.out, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
    if (options.format === 'json') console.log(JSON.stringify(payload, null, 2));
  }
  if (flags.has('brief')) {
    const first = runs.find((run) => run.discover)?.discover?.response.interpretation;
    if (first) console.log(`"${query}" hard=${JSON.stringify(first.hardConstraints.map((c) => [c.kind, c.codes ?? c.specKey ?? c.target, c.operator, c.value].filter((x) => x !== undefined)))} soft=${JSON.stringify(first.softPreferences.map((c) => [c.kind, c.codes ?? c.specKey]))} unknown=${JSON.stringify(first.unrecognizedTerms)}`);
    for (const run of runs) {
      const label = (keys: string[]) => keys.map((key) => `${key}:${nameOf(workspace, key).slice(0, 38)}`).join(' | ') || '-';
      const c = run.discover?.response.completeness;
      console.log(`  ${run.variant} primary   ${label(run.primary)}`);
      if (run.variant !== 'A') console.log(`  ${run.variant} unverified ${label(run.unverified)}  [elig=${c?.verifiedCount} unv=${c?.possibleCount} excl=${c?.rejectedCount} noResult=${c?.noResultReason ?? '-'}]`);
    }
    return;
  }
  if (options.format !== 'json') {
    for (const run of runs) console.log(render(workspace, run, query));
    if (runs.length > 1) {
      console.log('\n=== Top-8 comparison (retrieval lists)');
      for (const run of runs) console.log(`  ${run.variant} ${VARIANT_NAMES[run.variant].padEnd(18)} ${run.retrieval.join(' ') || '(none)'}`);
      console.log('=== Eligible candidates (C/D verified; A/B never verify constraints)');
      for (const run of runs) console.log(`  ${run.variant} ${VARIANT_NAMES[run.variant].padEnd(18)} ${run.primary.join(' ') || '(none)'}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
