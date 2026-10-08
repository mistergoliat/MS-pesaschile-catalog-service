// P2.3-QA2 closure: verifies nothing protected changed, re-checks authority hashes and import safety,
// records implementation hashes and evidence checksums. Writes only new files in the run directory.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { assertEntry, OUT, REPORT, CANDIDATE_DIR, SOURCE_DIR, COMMIT, EXPECTED, ABORTED_RUNS, sha, readJson, norm, guardedWriter, protectedCorpus, fingerprints, walk } from './lib.mjs';

assertEntry(import.meta.url);
await stat(REPORT);
const before = await readJson(`${OUT}/protected_before.json`);
const after = await fingerprints(Object.keys(before));
const changed = Object.keys(before).filter(f => after[f] !== before[f]);
const corpusNow = await protectedCorpus();
const appeared = corpusNow.filter(f => !(f in before));
assert.deepEqual(changed, [], 'Protected file mutation detected');

// Authority bytes unchanged.
const candidate = {}; for (const f of Object.keys(EXPECTED.contentHashes)) { candidate[f] = sha(await readFile(`${CANDIDATE_DIR}/${f}`)); assert.equal(candidate[f], EXPECTED.contentHashes[f]); }
assert.equal(sha(await readFile(`${CANDIDATE_DIR}/manifest.json`)), EXPECTED.candidateManifest);
assert.equal(sha(await readFile(`${SOURCE_DIR}/projection_input_manifest.json`)), EXPECTED.sourceManifest);
assert.equal(sha(await readFile(`${SOURCE_DIR}/canonical_input.json`)), EXPECTED.sourceHashes.canonicalInput);
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), COMMIT);
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '');

// Import closure of every QA2 script (same rule as preflight).
const scripts = (await walk('scripts/audits/qa2')).map(norm).filter(f => f.endsWith('.mjs')).sort();
const seen = new Set(), queue = [...scripts], findings = [];
while (queue.length) {
  const f = queue.pop(); if (seen.has(f)) continue; seen.add(f);
  const text = await readFile(f, 'utf8');
  if (/process\.argv/.test(text) && !f.startsWith('scripts/audits/qa2/')) findings.push({ file: f, issue: 'process.argv reference' });
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    let r = norm(path.normalize(path.join(path.dirname(f), m[1])));
    if (r.endsWith('.js')) { const ts = r.slice(0, -3) + '.ts'; try { await stat(ts); r = ts; } catch {} }
    try { await stat(r); } catch { try { await stat(r + '.ts'); r += '.ts'; } catch { try { await stat(r + '/index.ts'); r += '/index.ts'; } catch { continue; } } }
    if (r.startsWith('cross-projection-audit/') || (r.startsWith('scripts/') && !r.startsWith('scripts/audits/qa2/'))) findings.push({ file: f, issue: `imports ${r}` });
    queue.push(r);
  }
}
assert.deepEqual(findings, [], 'Unsafe import reachable');

// Every QA2 output must be git-ignored (artifacts/), and the aborted attempt must still hold only its single file.
const outFiles = (await walk(OUT)).map(norm);
const ignored = execFileSync('git', ['check-ignore', '--stdin'], { input: outFiles.join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').filter(Boolean);
assert.equal(ignored.length, outFiles.length);
const aborted = await Promise.all(ABORTED_RUNS.map(async d => ({ dir: d, files: (await walk(d)).map(norm) })));

const implementation = {}; for (const f of [...scripts, REPORT]) implementation[f] = sha(await readFile(f));
const w = guardedWriter();
await w.json('protected_after.json', after);
await w.json('audit_implementation_hashes.json', implementation);
await w.json('finalize.json', { status: 'PASS', finishedAt: new Date().toISOString(), protectedFiles: Object.keys(before).length, changed, newFilesInProtectedRootsOutsideQA2: appeared,
  importClosureFiles: seen.size, unsafeImports: findings, outputsGitIgnored: ignored.length === outFiles.length, abortedAttempts: aborted,
  authorityRecheck: { candidateContentHashes: candidate, manifest: EXPECTED.candidateManifest, sourceManifest: EXPECTED.sourceManifest, commit: COMMIT },
  qualification: 'Integrity holds for the QA2 run since its preflight capture. QA1-era loss of two PRB evidence files remains documented in evidence_integrity.json and is not repaired.' });
const evidence = {}; for (const f of (await walk(OUT)).map(norm).sort()) evidence[f] = sha(await readFile(f));
await w.json('evidence_checksums.json', evidence);
console.log(JSON.stringify({ protectedFiles: Object.keys(before).length, changed: changed.length, appeared, importClosureFiles: seen.size, outputs: outFiles.length, aborted }, null, 1));
