import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DISCOVER_V0_PATHS } from './workspace.js';

/*
 * CAT-DISCOVER-V0.2 integrity capture (read-only except for the one output file,
 * written create-only). Records the git state, the hashes of the Discover code,
 * the protected corpus (artifacts, data snapshots, QA docs/scripts, frozen V0
 * evidence) and the frozen source/bundle files, so a later capture can prove that
 * nothing protected changed.
 *
 *   npx tsx scripts/catalog-v2/discover-v0/integrity.ts --out=<file.json> [--exclude=<dir>]
 */

const sha = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function walk(dir: string, skip: (file: string) => boolean): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name).replaceAll('\\', '/');
    if (skip(full)) return [];
    return entry.isDirectory() ? walk(full, skip) : entry.isFile() ? [full] : [];
  }));
  return files.flat();
}

async function hashAll(files: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of [...files].sort()) out[file] = sha(await readFile(file));
  return out;
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();

export const CODE_ROOTS = ['src/application/catalog/discover-v0', 'src/infrastructure/catalog/discover-v0', 'scripts/catalog-v2/discover-v0', 'tests/unit/discover-v0', 'tests/integration/discover-v0'];
export const PROTECTED_ROOTS = ['artifacts/catalog-v2', 'data', 'docs/catalog-v2', 'docs/architecture', 'scripts/audits', 'cross-projection-audit'];
export const FROZEN_V0_RUN = 'artifacts/catalog-v2/discover-v0/run-20261008-discover-v0-r1';

export async function captureIntegrity(exclude: readonly string[]): Promise<Record<string, unknown>> {
  const normalizedExclude = exclude.map((dir) => dir.replaceAll('\\', '/').replace(/\/$/u, ''));
  const skip = (file: string) => normalizedExclude.some((dir) => file === dir || file.startsWith(`${dir}/`));
  const protectedFiles = [...new Set((await Promise.all(PROTECTED_ROOTS.map((root) => walk(root, skip)))).flat())];
  const inputFiles = [...new Set((await Promise.all([DISCOVER_V0_PATHS.source, DISCOVER_V0_PATHS.production, DISCOVER_V0_PATHS.candidate].map((root) => walk(root, () => false)))).flat())];
  const code = await hashAll((await Promise.all(CODE_ROOTS.map((root) => walk(root, () => false)))).flat());
  const corpus = await hashAll(protectedFiles);
  const inputs = await hashAll(inputFiles);
  const frozenV0 = Object.fromEntries(Object.entries(corpus).filter(([file]) => file.startsWith(`${FROZEN_V0_RUN}/`)));
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> };
  return {
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    git: { head: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), statusPorcelain: git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean),
      diffStat: git('diff', '--stat').split('\n').filter(Boolean) },
    npmScripts: Object.fromEntries(Object.entries(packageJson.scripts).filter(([name]) => name.startsWith('catalog:discover'))),
    excludedFromCorpus: normalizedExclude,
    code: { files: Object.keys(code).length, aggregate: sha(JSON.stringify(code)), hashes: code },
    inputs: { paths: DISCOVER_V0_PATHS, files: Object.keys(inputs).length, aggregate: sha(JSON.stringify(inputs)), hashes: inputs },
    frozenV0Run: { dir: FROZEN_V0_RUN, files: Object.keys(frozenV0).length, aggregate: sha(JSON.stringify(frozenV0)) },
    protectedCorpus: { roots: PROTECTED_ROOTS, files: Object.keys(corpus).length, aggregate: sha(JSON.stringify(corpus)), hashes: corpus },
  };
}

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
  if (!options.out) throw new Error('INVALID_ARGUMENT: --out is required');
  try { await stat(options.out); throw new Error(`OUTPUT_EXISTS: ${options.out}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const exclude = (options.exclude ?? '').split(',').filter(Boolean);
  const capture = await captureIntegrity(exclude);
  await writeFile(options.out, `${JSON.stringify(capture, null, 2)}\n`, { flag: 'wx' });
  const summary = capture as { code: { files: number; aggregate: string }; protectedCorpus: { files: number; aggregate: string }; inputs: { files: number; aggregate: string }; frozenV0Run: { files: number; aggregate: string } };
  console.log(JSON.stringify({ out: options.out, code: [summary.code.files, summary.code.aggregate], corpus: [summary.protectedCorpus.files, summary.protectedCorpus.aggregate],
    inputs: [summary.inputs.files, summary.inputs.aggregate], frozenV0: [summary.frozenV0Run.files, summary.frozenV0Run.aggregate] }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]).replaceAll('\\', '/').endsWith('scripts/catalog-v2/discover-v0/integrity.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
