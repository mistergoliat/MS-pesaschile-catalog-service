import { readFile, writeFile } from 'node:fs/promises';

/*
 * CAT-DISCOVER-G1 — compare two integrity captures (integrity.ts) and list every
 * added / removed / changed file per area. Read-only; one create-only report.
 *
 *   npx tsx scripts/catalog-v2/discover-g1/compare-protected.ts --before=<json> --after=<json> --out=<json>
 */

type Capture = {
  git: { head: string; statusPorcelain: string[] };
  code: { aggregate: string; hashes: Record<string, string> };
  inputs: { aggregate: string; hashes: Record<string, string> };
  frozenV0Run: { aggregate: string };
  protectedCorpus: { aggregate: string; hashes: Record<string, string> };
};

function diff(before: Record<string, string>, after: Record<string, string>) {
  return {
    added: Object.keys(after).filter((file) => !(file in before)).sort(),
    removed: Object.keys(before).filter((file) => !(file in after)).sort(),
    changed: Object.keys(after).filter((file) => file in before && before[file] !== after[file]).sort(),
  };
}

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
  const before = JSON.parse(await readFile(options.before!, 'utf8')) as Capture;
  const after = JSON.parse(await readFile(options.after!, 'utf8')) as Capture;
  const corpus = diff(before.protectedCorpus.hashes, after.protectedCorpus.hashes);
  const code = diff(before.code.hashes, after.code.hashes);
  const inputs = diff(before.inputs.hashes, after.inputs.hashes);
  const statusBefore = new Set(before.git.statusPorcelain);
  const report = {
    headUnchanged: before.git.head === after.git.head, head: after.git.head,
    discoverCodeUnchanged: before.code.aggregate === after.code.aggregate, code,
    inputsUnchanged: before.inputs.aggregate === after.inputs.aggregate, inputs,
    frozenV0Unchanged: before.frozenV0Run.aggregate === after.frozenV0Run.aggregate,
    protectedCorpus: { filesBefore: Object.keys(before.protectedCorpus.hashes).length, filesAfter: Object.keys(after.protectedCorpus.hashes).length, ...corpus,
      preexistingChangedOrRemoved: corpus.changed.length + corpus.removed.length },
    gitStatus: { preexistingEntriesStillPresent: before.git.statusPorcelain.every((line) => after.git.statusPorcelain.includes(line)),
      newEntries: after.git.statusPorcelain.filter((line) => !statusBefore.has(line)) },
  };
  await writeFile(options.out!, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ...report, protectedCorpus: { ...report.protectedCorpus, added: report.protectedCorpus.added.length } }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
