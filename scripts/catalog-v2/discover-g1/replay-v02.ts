import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/*
 * CAT-DISCOVER-G1 — replay catalog.discoverV0.2 exactly as frozen, in an ISOLATED tree.
 *
 *   tree = git archive <baseCommit>  +  byte overlay of <authority>/v02-code
 *   node_modules and artifacts/ are junctions to this repository (read by the run;
 *   the only writes are the create-only outputs under --replay-dir).
 *
 * The overlaid tree must reproduce the authority code hashes; then the official
 * benchmark-v02 runner (from the tree, not from this worktree) is executed with the
 * same relative input paths as run r2 and compared with r2 by compare-v02-runs.
 * Neither the repository index nor the worktree files are touched.
 *
 * Future versions: replay them the same way from their own frozen code, then diff
 * their results_v02.json against the r2 one (same queries, same inputs).
 *
 *   npx tsx scripts/catalog-v2/discover-g1/replay-v02.ts --authority-dir=<g1 run dir> --replay-dir=<dir under artifacts/> [--keep-tree]
 */

const R2 = 'artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2';
const V0_REPLAY = 'artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r1/v0-replay/v0-head-6469eca';
const sha = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function walk(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : entry.isFile() ? [path.relative(base, full).replaceAll('\\', '/')] : [];
  }))).flat().sort();
}

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z0-9-]+)(?:=(.*))?$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2] ?? 'true']));
  const authorityDir = options['authority-dir'];
  const replayDir = options['replay-dir'];
  if (!authorityDir || !replayDir) throw new Error('INVALID_ARGUMENT: --authority-dir and --replay-dir are required');
  if (!replayDir.replaceAll('\\', '/').startsWith('artifacts/')) throw new Error('INVALID_ARGUMENT: --replay-dir must be relative and under artifacts/ (resolved through the tree junction)');
  try { await stat(replayDir); throw new Error(`OUTPUT_EXISTS: ${replayDir}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const repo = process.cwd();
  const authority = JSON.parse(await readFile(path.join(authorityDir, 'v02_frozen_authority.json'), 'utf8')) as {
    git: { baseCommit: string }; code: { hashes: Record<string, string>; aggregate: string }; inputs: { productionBundle: { liveDir: string; archive: { dir: string } } };
  };
  const started = new Date().toISOString();
  const tree = await mkdtemp(path.join(os.tmpdir(), 'discover-v02-replay-'));
  const steps: string[] = [];
  try {
    const tar = path.join(tree, '..', `${path.basename(tree)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, authority.git.baseCommit], { cwd: repo });
    // Relative paths: GNU tar (Git Bash) reads "C:" in an absolute path as a remote host.
    execFileSync('tar', ['-xf', path.basename(tar), '-C', path.basename(tree)], { cwd: path.dirname(tree) });
    await rm(tar, { force: true });
    steps.push(`git archive ${authority.git.baseCommit} → ${tree}`);
    const codeDir = path.join(authorityDir, 'v02-code');
    await cp(codeDir, tree, { recursive: true, force: true });
    steps.push('overlay v02-code (byte copy)');
    // Files present in the base tree under the code roots but absent from the frozen code would be stale.
    const roots = [...new Set(Object.keys(authority.code.hashes).map((file) => file.split('/').slice(0, file.startsWith('src/') ? 4 : 3).join('/')))];
    const treeCode: Record<string, string> = {};
    for (const root of roots) {
      let files: string[] = [];
      try { files = await walk(path.join(tree, root)); } catch { files = []; }
      for (const file of files) treeCode[`${root}/${file}`] = sha(await readFile(path.join(tree, root, file)));
    }
    const sorted = Object.fromEntries(Object.entries(treeCode).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
    const treeMatches = JSON.stringify(sorted) === JSON.stringify(Object.fromEntries(Object.entries(authority.code.hashes).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))));
    if (!treeMatches) throw new Error('REPLAY_TREE_CODE_MISMATCH: the overlaid tree does not reproduce the authority code hashes');
    steps.push(`tree code hashes == authority (${Object.keys(sorted).length} files)`);
    await symlink(path.join(repo, 'node_modules'), path.join(tree, 'node_modules'), 'junction');
    await symlink(path.join(repo, 'artifacts'), path.join(tree, 'artifacts'), 'junction');
    steps.push('junctions: node_modules, artifacts');

    await mkdir(path.join(repo, replayDir), { recursive: true });
    const env = { ...process.env, DISCOVER_V0_PRODUCTION_BUNDLE_DIR: authority.inputs.productionBundle.liveDir };
    const tsx = path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const run = (args: string[]) => execFileSync(process.execPath, [tsx, ...args], { cwd: tree, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const benchmarkOut = run(['scripts/catalog-v2/discover-v0/benchmark-v02.ts', `--run-dir=${replayDir}`, `--v0=${V0_REPLAY}`]);
    steps.push('benchmark-v02 (from the tree) completed');
    const compareOut = run(['scripts/catalog-v2/discover-v0/compare-v02-runs.ts', `--left=${R2}`, `--right=${replayDir}`, `--out=${replayDir}/compare_with_r2.json`]);
    const comparison = JSON.parse(await readFile(path.join(repo, replayDir, 'compare_with_r2.json'), 'utf8')) as { reproduced: boolean; checks: Record<string, boolean> };
    const report = {
      replayVersion: 'discover-g1-v02-replay-v1', startedAt: started, finishedAt: new Date().toISOString(), node: process.version,
      baseCommit: authority.git.baseCommit, codeAggregate: authority.code.aggregate, treeCodeMatchesAuthority: treeMatches,
      productionBundleDir: env.DISCOVER_V0_PRODUCTION_BUNDLE_DIR, productionBundleArchive: path.join(authorityDir, authority.inputs.productionBundle.archive.dir).replaceAll('\\', '/'),
      reference: R2, replayDir, reproduced: comparison.reproduced, checks: comparison.checks, steps,
      benchmarkSummary: benchmarkOut.trim().split('\n').slice(-40).join('\n'), compareOutputBytes: compareOut.length,
      howToReplayAFutureVersion: 'Freeze its code the same way (freeze-v02-authority.ts on that worktree), replay it with this script, and diff its results_v02.json per query against R2 — the R2 run stays the V0.2 reference.',
    };
    await writeFile(path.join(authorityDir, 'v02_replay_check.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ reproduced: report.reproduced, checks: report.checks, treeCodeMatchesAuthority: treeMatches }, null, 2));
  } finally {
    // Remove the junctions FIRST (link only, never their targets); delete the tree only if both are gone.
    const links = ['node_modules', 'artifacts'].map((name) => path.join(tree, name));
    for (const link of links) await unlink(link).catch(() => rmdir(link)).catch(() => undefined);
    const remaining = (await Promise.all(links.map((link) => lstat(link).then(() => link, () => null)))).filter(Boolean);
    if (remaining.length > 0) console.error(`TREE_KEPT: junctions still present (${remaining.join(', ')}); remove ${tree} manually`);
    else if (options['keep-tree'] !== 'true') await rm(tree, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
