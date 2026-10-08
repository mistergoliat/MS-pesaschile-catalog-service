import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COMMERCIAL_HYDRATION_BOUND } from '../../../src/application/catalog/discover-v0/discoverV0.js';
import { DISCOVER_V0_RETRIEVAL_VERSION } from '../../../src/application/catalog/discover-v0/contracts.js';
import { DISCOVER_V0_LEXICON, DISCOVER_V0_LEXICON_VERSION } from '../../../src/application/catalog/discover-v0/lexicon.js';
import { QUANTITY_RULES, QUANTITY_SCOPE_VERSION } from '../../../src/application/catalog/discover-v0/quantityScope.js';
import { DISCOVER_V0_DOCUMENT_RULES_VERSION } from '../../../src/application/catalog/discover-v0/retrievalDocument.js';
import { CANDIDATE_BUNDLE_ID, FROZEN_SOURCE_AGGREGATE, FROZEN_SOURCE_EXTRACTION_ID, PRODUCTION_BUNDLE_ID } from '../../../src/infrastructure/catalog/discover-v0/frozenInputLoader.js';
import { CODE_ROOTS, FROZEN_V0_RUN } from '../discover-v0/integrity.js';
import { DISCOVER_V0_PATHS } from '../discover-v0/workspace.js';

/*
 * CAT-DISCOVER-G1 — freeze the authority of catalog.discoverV0.2 AS IMPLEMENTED in
 * this worktree (uncommitted on top of 6469eca) without committing anything.
 *
 * Writes, create-only, into --out-dir:
 *   v02_frozen_authority.json   git state, every changed/new file with sha256, module
 *                               hashes, versions, inputs, V0 identity, V0.2 evidence hashes
 *   v02_worktree.patch          binary git diff 6469eca → worktree for the Discover code
 *                               roots, INCLUDING untracked files (built through a temporary
 *                               index file: the repository index, refs and objects are untouched)
 *   v02-code/                   byte copy of every file in the Discover code roots
 *   inputs/production-bundle/   byte copy of the production bundle, which today exists only
 *                               under a Windows Temp directory (hash-verified, never rebuilt)
 *
 *   npx tsx scripts/catalog-v2/discover-g1/freeze-v02-authority.ts --out-dir=<dir>
 */

const BASE_COMMIT = '6469eca2009a0cbdd897d43deadb1a7ff0d10c2c';
const V02_RUNS = { official: 'artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2', superseded: 'artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r1' };
const V0_REPLAY = 'artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r1/v0-replay/v0-head-6469eca';
const BENCHMARK = 'scripts/catalog-v2/discover-v0/benchmark/benchmark_queries.v1.json';
const HELDOUT_CONTRACT = 'scripts/catalog-v2/discover-v0/benchmark/heldout/heldout_contract.v1.json';
const REPORT = 'docs/catalog-v2/CAT_DISCOVER_V0_2_IMPLEMENTATION_AND_REGRESSION_REPORT.md';
const PATCH_PATHS = [...CODE_ROOTS, REPORT];

const sha = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const git = (args: string[], env: NodeJS.ProcessEnv = process.env) => execFileSync('git', args, { encoding: 'buffer', env, maxBuffer: 256 * 1024 * 1024 });
const gitText = (...args: string[]) => git(args).toString('utf8').trimEnd();

async function walk(dir: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  return (await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name).replaceAll('\\', '/');
    return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : [];
  }))).flat().sort();
}
const hashFiles = async (files: readonly string[]) => Object.fromEntries(await Promise.all(files.map(async (file) => [file, sha(await readFile(file))] as const)));

async function main(): Promise<void> {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => /^--([a-z0-9-]+)=(.*)$/u.exec(arg)).filter((match): match is RegExpExecArray => match !== null).map((match) => [match[1]!, match[2]!]));
  const outDir = options['out-dir'];
  if (!outDir) throw new Error('INVALID_ARGUMENT: --out-dir is required');
  for (const file of ['v02_frozen_authority.json', 'v02_worktree.patch', 'v02-code', 'inputs']) {
    try { await stat(path.join(outDir, file)); throw new Error(`OUTPUT_EXISTS: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const head = gitText('rev-parse', 'HEAD');
  if (head !== BASE_COMMIT) throw new Error(`HEAD_MOVED: ${head} (expected ${BASE_COMMIT})`);
  const porcelain = gitText('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);
  // Files this G1 session adds are kept apart: they are not part of the V0.2 authority.
  const g1Paths = /^(scripts\/catalog-v2\/discover-g1\/|tests\/unit\/discover-g1\/|docs\/catalog-v2\/CAT_DISCOVER_G1_)/u;
  const allChanged = porcelain.map((line) => ({ status: line.slice(0, 2).trim(), file: line.slice(3).replace(/^"|"$/gu, '') }));
  const changed = allChanged.filter((item) => !g1Paths.test(item.file));

  // ---- patch through a throw-away index (never the repository index) ------------------
  const tempIndex = path.join(os.tmpdir(), `discover-g1-index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
  git(['read-tree', BASE_COMMIT], env);
  git(['add', '--all', '--', ...PATCH_PATHS], env);
  const patch = git(['diff', '--cached', '--binary', '--full-index', BASE_COMMIT, '--', ...PATCH_PATHS], env);
  const patchFiles = git(['diff', '--cached', '--name-status', BASE_COMMIT, '--', ...PATCH_PATHS], env).toString('utf8').trim().split('\n').filter(Boolean)
    .map((line) => { const [status, ...rest] = line.split('\t'); return { status: status!, file: rest.join('\t') }; });
  const { rm } = await import('node:fs/promises');
  await rm(tempIndex, { force: true });

  // ---- code snapshot --------------------------------------------------------------------
  const codeFiles = (await Promise.all(CODE_ROOTS.map(walk))).flat().sort();
  const code = await hashFiles(codeFiles);
  await mkdir(path.join(outDir, 'v02-code'), { recursive: false }).catch(() => undefined);
  for (const file of codeFiles) {
    await mkdir(path.join(outDir, 'v02-code', path.dirname(file)), { recursive: true });
    await copyFile(file, path.join(outDir, 'v02-code', file));
  }
  const reportBytes = await readFile(REPORT);
  await mkdir(path.join(outDir, 'v02-code', path.dirname(REPORT)), { recursive: true });
  await copyFile(REPORT, path.join(outDir, 'v02-code', REPORT));

  // ---- inputs ---------------------------------------------------------------------------
  const inputHashes = async (dir: string) => hashFiles(await walk(dir));
  const source = await inputHashes(DISCOVER_V0_PATHS.source);
  const production = await inputHashes(DISCOVER_V0_PATHS.production);
  const candidate = await inputHashes(DISCOVER_V0_PATHS.candidate);
  const r2Authority = JSON.parse(await readFile(path.join(V02_RUNS.official, 'input_authority.json'), 'utf8')) as {
    bundles: Record<'production' | 'candidate', { dir: string; fileHashes: Record<string, string>; lineage: Record<string, unknown>; indexFingerprint: string; lexicalFingerprint: string }>;
    source: { fileHashes: Record<string, string> };
  };
  const matches = (current: Record<string, string>, dir: string, recorded: Record<string, string>) => Object.entries(recorded).every(([file, hash]) => current[`${dir.replaceAll('\\', '/')}/${file}`] === hash);
  const productionArchive = path.join(outDir, 'inputs', 'production-bundle', PRODUCTION_BUNDLE_ID.slice('sha256:'.length));
  await mkdir(productionArchive, { recursive: true });
  for (const file of Object.keys(production)) await copyFile(file, path.join(productionArchive, path.basename(file)));
  const archived = await inputHashes(productionArchive.replaceAll('\\', '/'));
  const archiveMatches = Object.keys(production).every((file) => archived[`${productionArchive.replaceAll('\\', '/')}/${path.basename(file)}`] === production[file]);

  // ---- V0.2 evidence and V0 identity ------------------------------------------------------
  const official = await inputHashes(V02_RUNS.official);
  const recordedChecksums = JSON.parse(await readFile(path.join(V02_RUNS.official, 'evidence_checksums_benchmark.json'), 'utf8')) as Record<string, string>;
  const evidenceIntact = Object.entries(recordedChecksums).every(([file, hash]) => official[`${V02_RUNS.official}/${file}`] === hash);
  const frozenV0 = await inputHashes(FROZEN_V0_RUN);
  const v0Replay = await inputHashes(V0_REPLAY);
  const benchmarkBytes = await readFile(BENCHMARK);
  const benchmark = JSON.parse(benchmarkBytes.toString('utf8')) as { benchmarkVersion: string; queries: unknown[] };
  const lexiconSha = sha(JSON.stringify(DISCOVER_V0_LEXICON));
  const fileSha = (file: string) => code[file] ?? null;

  const authority = {
    authorityVersion: 'discover-g1-v02-authority-v1',
    capturedAt: new Date().toISOString(),
    node: process.version, platform: `${process.platform}/${process.arch}`,
    statement: 'catalog.discoverV0.2 is defined as BASE_COMMIT + v02_worktree.patch (equivalently, the byte copy in v02-code/). Nothing was committed; the worktree changes are preserved as found.',
    git: {
      baseCommit: BASE_COMMIT, head, branch: gitText('rev-parse', '--abbrev-ref', 'HEAD'), headSubject: gitText('log', '-1', '--format=%s'),
      statusPorcelain: porcelain.filter((line) => !g1Paths.test(line.slice(3))),
      addedByG1Session: allChanged.filter((item) => g1Paths.test(item.file)).map((item) => item.file),
      modified: changed.filter((item) => item.status === 'M').map((item) => item.file),
      untracked: changed.filter((item) => item.status === '??').map((item) => item.file),
      diffStat: gitText('diff', '--stat').split('\n').filter(Boolean),
    },
    patch: { file: 'v02_worktree.patch', sha256: sha(patch), bytes: patch.length, paths: PATCH_PATHS, files: patchFiles,
      construction: 'GIT_INDEX_FILE=<temp> git read-tree BASE; git add --all -- <paths>; git diff --cached --binary --full-index BASE -- <paths>. Repository index/refs untouched.',
      apply: 'git archive BASE | tar -x -C <tree>; (cd <tree> && git apply --binary <patch>)' },
    code: { roots: CODE_ROOTS, files: Object.keys(code).length, aggregate: sha(JSON.stringify(code)), hashes: code, snapshotDir: 'v02-code/' },
    modules: {
      contracts: fileSha('src/application/catalog/discover-v0/contracts.ts'), queryInterpreter: fileSha('src/application/catalog/discover-v0/queryInterpreter.ts'),
      lexicon: fileSha('src/application/catalog/discover-v0/lexicon.ts'), quantityScope: fileSha('src/application/catalog/discover-v0/quantityScope.ts'),
      constraintVerifier: fileSha('src/application/catalog/discover-v0/constraintVerifier.ts'), disposition: fileSha('src/application/catalog/discover-v0/disposition.ts'),
      ranker: fileSha('src/application/catalog/discover-v0/ranker.ts'), generators: fileSha('src/application/catalog/discover-v0/generators.ts'),
      commercialHydrator: fileSha('src/application/catalog/discover-v0/commercialHydrator.ts'), resultAssembler: fileSha('src/application/catalog/discover-v0/resultAssembler.ts'),
      discoverV0: fileSha('src/application/catalog/discover-v0/discoverV0.ts'), retrievalDocument: fileSha('src/application/catalog/discover-v0/retrievalDocument.ts'),
      evaluation: fileSha('src/application/catalog/discover-v0/evaluation.ts'), benchmarkV02: fileSha('scripts/catalog-v2/discover-v0/benchmark-v02.ts'),
      heldoutValidator: fileSha('scripts/catalog-v2/discover-v0/heldout.ts'), heldoutContract: fileSha(HELDOUT_CONTRACT),
    },
    versions: {
      retrieval: DISCOVER_V0_RETRIEVAL_VERSION,
      interpreter: { version: `bound to retrieval ${DISCOVER_V0_RETRIEVAL_VERSION} (no separate constant)`, fileSha256: fileSha('src/application/catalog/discover-v0/queryInterpreter.ts') },
      lexicon: { version: DISCOVER_V0_LEXICON_VERSION, entries: DISCOVER_V0_LEXICON.length, sha256: lexiconSha,
        pendingDomainReview: DISCOVER_V0_LEXICON.filter((entry) => entry.reviewStatus === 'PENDING_DOMAIN_REVIEW').length },
      quantityScope: { version: QUANTITY_SCOPE_VERSION, rules: Object.keys(QUANTITY_RULES).length, rulesSha256: sha(JSON.stringify(QUANTITY_RULES)), approximateMargin: 0.1 },
      ranking: { version: 'UNVERSIONED (no constant in ranker.ts) — identified by file hash', fileSha256: fileSha('src/application/catalog/discover-v0/ranker.ts'),
        weights: 'R = 0.5·L + 0.5·C (+0.15·preference share); order: disposition → exact tier → 0.7·R + 0.2·F + 0.1·P', tuned: false },
      documentRules: DISCOVER_V0_DOCUMENT_RULES_VERSION, commercialHydrationBound: COMMERCIAL_HYDRATION_BOUND,
    },
    inputs: {
      sourceExtractionId: FROZEN_SOURCE_EXTRACTION_ID, sourceAggregate: FROZEN_SOURCE_AGGREGATE, sourceDir: DISCOVER_V0_PATHS.source,
      sourceMatchesR2: matches(source, DISCOVER_V0_PATHS.source, r2Authority.source.fileHashes), sourceHashes: source,
      productionBundle: { bundleId: PRODUCTION_BUNDLE_ID, liveDir: DISCOVER_V0_PATHS.production, matchesR2: matches(production, DISCOVER_V0_PATHS.production, r2Authority.bundles.production.fileHashes),
        lineage: r2Authority.bundles.production.lineage, indexFingerprint: r2Authority.bundles.production.indexFingerprint, lexicalFingerprint: r2Authority.bundles.production.lexicalFingerprint, hashes: production,
        risk: 'The live directory is under the OS Temp folder and can be purged. A byte copy was archived (not rebuilt, not published).',
        archive: { dir: path.relative(outDir, productionArchive).replaceAll('\\', '/'), identicalBytes: archiveMatches, useWith: 'DISCOVER_V0_PRODUCTION_BUNDLE_DIR=<archive dir>' } },
      candidateFix2Bundle: { bundleId: CANDIDATE_BUNDLE_ID, dir: DISCOVER_V0_PATHS.candidate, matchesR2: matches(candidate, DISCOVER_V0_PATHS.candidate, r2Authority.bundles.candidate.fileHashes),
        lineage: r2Authority.bundles.candidate.lineage, indexFingerprint: r2Authority.bundles.candidate.indexFingerprint, lexicalFingerprint: r2Authority.bundles.candidate.lexicalFingerprint, hashes: candidate },
    },
    v0: {
      code: `commit ${BASE_COMMIT}`, benchmark: { version: benchmark.benchmarkVersion, file: BENCHMARK, sha256: sha(benchmarkBytes), queries: benchmark.queries.length, use: 'DEVELOPMENT/REGRESSION SET — never held-out, never gold' },
      frozenRun: { dir: FROZEN_V0_RUN, files: Object.keys(frozenV0).length, aggregate: sha(JSON.stringify(frozenV0)) },
      replayFromHead: { dir: V0_REPLAY, files: Object.keys(v0Replay).length, aggregate: sha(JSON.stringify(v0Replay)), note: 'byte-identical to the frozen run except timings (v0_baseline_reproduction.json of r2)' },
    },
    v02Evidence: {
      officialRun: V02_RUNS.official, supersededRun: V02_RUNS.superseded,
      files: Object.keys(official).length, aggregate: sha(JSON.stringify(official)), hashes: official,
      recordedChecksumsIntact: evidenceIntact, report: { file: REPORT, sha256: sha(reportBytes) },
    },
    referenceCommitProposal: {
      status: 'PROPOSED_NOT_EXECUTED',
      proposal: `Create branch "ref/catalog-discover-v0.2" from ${BASE_COMMIT}, apply v02_worktree.patch, commit as "feat(catalog): catalog.discoverV0.2 offline prototype (authority freeze G1)" and tag "catalog-discover-v0.2-r2". The resulting tree must reproduce code.aggregate; the replay check (v02_replay_check.json) must pass on it before tagging.`,
      reason: 'The worktree is the only carrier of V0.2. A tag makes the authority durable and lets future versions diff against it in Git rather than against a patch file.',
      owner: 'Repository owner decision — this agent does not commit or push.',
    },
  };
  await writeFile(path.join(outDir, 'v02_worktree.patch'), patch, { flag: 'wx' });
  await writeFile(path.join(outDir, 'v02_frozen_authority.json'), `${JSON.stringify(authority, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ head, modified: authority.git.modified.length, untracked: authority.git.untracked.length, patch: [authority.patch.sha256, patchFiles.length],
    code: [authority.code.files, authority.code.aggregate], sourceMatchesR2: authority.inputs.sourceMatchesR2, productionMatchesR2: authority.inputs.productionBundle.matchesR2,
    candidateMatchesR2: authority.inputs.candidateFix2Bundle.matchesR2, productionArchiveIdentical: archiveMatches, v02EvidenceIntact: evidenceIntact }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
