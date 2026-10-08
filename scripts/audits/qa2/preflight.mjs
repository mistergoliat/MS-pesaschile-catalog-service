// P2.3-QA2 Phase 0: read-only preflight. Creates the exclusive run directory and writes only inside it.
import { readFile, mkdir, stat, access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { assertEntry, OUT, ABORTED_RUNS, CANDIDATE_DIR, REPLAY_DIRS, SOURCE_DIR, BASELINE_DIR, PRB_DIR, QA1_DIR, COMMIT, CANDIDATE_ID, BASELINE_ID, SOURCE_EXTRACTION_ID,
  SOURCE_AGGREGATE, EXPECTED, sha, readJson, norm, guardedWriter, protectedCorpus, fingerprints, walk, uniqueSorted, isOwnPath } from './lib.mjs';
import { bundleId, validateBundle, validateBundleForPublication } from '../../../src/domain/catalog/projection-bundle.ts';
import { canonicalContent, validateManifest, recordCounts } from '../../../src/domain/catalog/projection-input/canonical.ts';
import { getCommercialProductOntologyRegistryV3, computeCommercialProductOntologyRegistryHash } from '../../../src/domain/commercial-product-ontology/index.ts';
import { getTrainingSemanticRegistryV2 } from '../../../src/domain/training-semantics-v2/index.ts';
import { semanticObligationContractV2 } from '../../../src/domain/catalog-admission/index.ts';

assertEntry(import.meta.url);
const startedAt = new Date().toISOString();

// 1. Exclusive run directory: fail if it already exists (never reuse or overwrite a run).
try { await access(OUT); throw new Error(`QA2 run directory already exists: ${OUT}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const pending = {}; // evidence is written only after every read-only check has passed

// 2. Repository identity: tracked tree must equal the reviewed commit.
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const trackedChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
const untracked = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim().split('\n').filter(l => l.startsWith('??')).map(l => l.slice(3));
assert.equal(head, COMMIT); assert.equal(trackedChanges, '');

// 3. Static import-closure check: no audit script with top-level CLI blocks is reachable.
async function importClosure(entries) {
  const seen = new Set(), queue = [...entries], findings = [];
  while (queue.length) {
    const f = queue.pop(); if (seen.has(f)) continue; seen.add(f);
    const text = await readFile(f, 'utf8');
    if (/process\.argv/.test(text) && !f.startsWith('scripts/audits/qa2/')) findings.push({ file: f, issue: 'process.argv reference' });
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      let r = norm(path.normalize(path.join(path.dirname(f), m[1])));
      if (r.endsWith('.js')) { const ts = r.slice(0, -3) + '.ts'; try { await stat(ts); r = ts; } catch {} }
      try { await stat(r); } catch { try { await stat(r + '.ts'); r += '.ts'; } catch { try { await stat(r + '/index.ts'); r += '/index.ts'; } catch { continue; } } }
      if (r.startsWith('cross-projection-audit/') || (r.startsWith('scripts/') && !r.startsWith('scripts/audits/qa2/'))) findings.push({ file: f, issue: `imports audit/script module ${r}` });
      queue.push(r);
    }
  }
  return { files: [...seen].sort(), findings };
}
const qa2Scripts = (await walk('scripts/audits/qa2')).map(norm).filter(f => f.endsWith('.mjs'));
const closure = await importClosure(qa2Scripts);
assert.deepEqual(closure.findings, [], 'Unsafe import reachable from QA2 scripts');

// 4. Protected corpus fingerprints, captured before any analysis.
const corpus = await protectedCorpus();
const before = await fingerprints(corpus);
pending['protected_before.json'] = before;

// 5. Authority verification from physical bytes.
async function readBundle(dir) {
  const raw = await readFile(`${dir}/manifest.json`, 'utf8'), manifest = JSON.parse(raw), files = {}, hashes = {};
  for (const p of Object.values(manifest.projections)) if (p.status === 'present') {
    files[p.artifact] = await readFile(`${dir}/${p.artifact}`, 'utf8'); hashes[p.artifact] = sha(files[p.artifact]);
    assert.equal(hashes[p.artifact], p.contentHash, `${dir}/${p.artifact}`);
  }
  const report = await readFile(`${dir}/validation-report.json`, 'utf8').catch(() => null);
  return { raw, manifest, files, hashes, manifestHash: sha(raw), derivedBundleId: bundleId(manifest), validationReportHash: report === null ? null : sha(report) };
}
const names = { canonicalInput: 'canonical_input.json', compatibilityCsv: 'product_catalog_exploration.csv', categoryTrustMap: 'category_trust_map.csv', featureTrustMap: 'feature_trust_map.csv' };
const sourceHashes = {}; for (const [k, f] of Object.entries(names)) sourceHashes[k] = sha(await readFile(`${SOURCE_DIR}/${f}`));
const sourceManifestRaw = await readFile(`${SOURCE_DIR}/projection_input_manifest.json`, 'utf8');
const sourceManifest = validateManifest(JSON.parse(sourceManifestRaw), sourceHashes);
const source = await readJson(`${SOURCE_DIR}/canonical_input.json`);
assert.equal(await readFile(`${SOURCE_DIR}/canonical_input.json`, 'utf8'), canonicalContent(source));
assert.deepEqual(recordCounts(source), sourceManifest.recordCounts);
assert.deepEqual(sourceHashes, EXPECTED.sourceHashes); assert.equal(sha(sourceManifestRaw), EXPECTED.sourceManifest);
assert.equal(sourceManifest.sourceExtractionId, SOURCE_EXTRACTION_ID); assert.equal(sourceManifest.aggregateContentHash, SOURCE_AGGREGATE);

const C = await readBundle(CANDIDATE_DIR), A = await readBundle(BASELINE_DIR);
assert.equal(C.derivedBundleId, CANDIDATE_ID); assert.equal(C.manifest.projectionBundleId, CANDIDATE_ID); assert.equal(C.manifestHash, EXPECTED.candidateManifest);
assert.equal(A.derivedBundleId, BASELINE_ID); assert.equal(A.manifest.projectionBundleId, BASELINE_ID); assert.equal(A.manifestHash, EXPECTED.baselineManifest);
assert.deepEqual(C.hashes, EXPECTED.contentHashes);
assert.equal(C.manifest.source.sourceExtractionId, SOURCE_EXTRACTION_ID); assert.equal(A.manifest.source.sourceExtractionId, SOURCE_EXTRACTION_ID);
const validations = { candidatePublication: validateBundleForPublication(C.manifest, C.files, source), baseline: validateBundle(A.manifest, A.files, source) };
assert.equal(validations.candidatePublication.status, 'PASS'); assert.equal(validations.baseline.status, 'PASS');
const protectedProjectionEquality = {};
for (const k of ['productSemantics', 'trainingSemantics', 'specs', 'trustMaps']) {
  const a = C.manifest.projections[k].artifact; protectedProjectionEquality[k] = C.files[a] === A.files[a];
  assert.equal(protectedProjectionEquality[k], true, k);
}
const v2 = JSON.parse(C.files['trainingSemanticsV2.json']), ps = JSON.parse(C.files['productSemantics.json']);
assert.equal(v2.snapshot.snapshotId, EXPECTED.trainingV2InternalSnapshot); assert.equal(C.manifest.projections.trainingSemanticsV2.snapshotId, EXPECTED.trainingV2Wrapper);
const registries = {
  ontologyHashComputed: computeCommercialProductOntologyRegistryHash(getCommercialProductOntologyRegistryV3()), ontologyHashSnapshot: ps.snapshot.ontologyHash,
  trainingV2RegistryHash: getTrainingSemanticRegistryV2().registryHash, trainingV2SnapshotRegistryHash: v2.snapshot.registryHash,
  admissionContractHash: semanticObligationContractV2.contentHash,
};
assert.equal(registries.ontologyHashComputed, registries.ontologyHashSnapshot); assert.equal(registries.trainingV2RegistryHash, registries.trainingV2SnapshotRegistryHash);
assert.equal(registries.admissionContractHash, EXPECTED.admissionContract);

// Cross-attestation: two independent Linux replay copies and earlier review records.
const replayComparison = [];
for (const dir of REPLAY_DIRS) {
  const R = await readBundle(dir);
  // LR report: build.builtAt is the only manifest difference and is excluded from bundleId().
  const strip = m => ({ ...m, build: { ...m.build, builtAt: null } });
  const manifestDiff = JSON.stringify(strip(R.manifest)) === JSON.stringify(strip(C.manifest)) ? (R.raw === C.raw ? [] : ['/build/builtAt']) : ['OTHER'];
  replayComparison.push({ dir, derivedBundleId: R.derivedBundleId, manifestHash: R.manifestHash, manifestBytesIdentical: R.raw === C.raw, manifestDiff, builtAt: R.manifest.build.builtAt,
    files: Object.fromEntries(Object.keys(C.hashes).map(f => [f, R.hashes[f] === C.hashes[f]])), validationReportIdentical: R.validationReportHash === C.validationReportHash });
  assert.equal(R.derivedBundleId, CANDIDATE_ID); assert.notDeepEqual(manifestDiff, ['OTHER']);
  for (const f of Object.keys(C.hashes)) assert.equal(R.hashes[f], C.hashes[f]);
}
const finalReview = await readJson('artifacts/catalog-v2/p2-3c-final-review/local-validation.json');
const qa1Authority = await readJson(`${QA1_DIR}/authority.json`);
const attestations = {
  finalReviewBundleId: finalReview.bundleId, finalReviewManifestHash: finalReview.manifestHash, finalReviewPhysicalHashes: finalReview.physicalHashes,
  finalReviewMatches: finalReview.bundleId === CANDIDATE_ID && finalReview.manifestHash === EXPECTED.candidateManifest,
  qa1CandidateManifestMatches: JSON.stringify(qa1Authority.candidateManifest) === JSON.stringify(C.manifest),
  qa1SourceHashesMatch: JSON.stringify(qa1Authority.sourceHashes) === JSON.stringify(sourceHashes),
  qa1SourceManifestHashMatches: qa1Authority.sourceManifestHash === sha(sourceManifestRaw),
};
assert.equal(attestations.qa1CandidateManifestMatches, true); assert.equal(attestations.qa1SourceHashesMatch, true);

pending['authority_verification.json'] = ({ basis: 'MEASURED', startedAt, commit: head, trackedTreeClean: trackedChanges === '', untrackedFilesAtStart: untracked,
  candidate: { dir: CANDIDATE_DIR, bundleId: C.derivedBundleId, manifestHash: C.manifestHash, contentHashes: C.hashes, validationReportHash: C.validationReportHash, manifest: C.manifest },
  baseline: { dir: BASELINE_DIR, bundleId: A.derivedBundleId, manifestHash: A.manifestHash, contentHashes: A.hashes },
  source: { dir: SOURCE_DIR, hashes: sourceHashes, manifestHash: sha(sourceManifestRaw), sourceExtractionId: sourceManifest.sourceExtractionId,
    aggregateContentHash: sourceManifest.aggregateContentHash, recordCounts: sourceManifest.recordCounts, observedAt: sourceManifest.source?.observedAt ?? null, canonicalSerializationRoundTrip: true },
  validations, protectedProjectionEquality, trainingV2: { internalSnapshotId: v2.snapshot.snapshotId, wrapperProjectionId: C.manifest.projections.trainingSemanticsV2.snapshotId },
  registries, replayComparison, attestations, importClosure: closure });

// 6. QA1 non-conformance: what was overwritten, what survives with independent authority.
const prbFiles = ['preflight.json', 'protected-before.json', 'protected-after.json', 'hygiene.json', 'finalize.log', 'audit.json'];
const prbState = {};
for (const f of prbFiles) { const p = `${PRB_DIR}/${f}`, s = await stat(p); prbState[f] = { sha256: sha(await readFile(p)), mtime: s.mtime.toISOString(), bytes: s.size }; }
const qa1Before = await readJson(`${QA1_DIR}/protected_before.json`), qa1After = await readJson(`${QA1_DIR}/protected_after.json`);
const key = f => Object.keys(qa1Before).find(k => norm(k) === `${PRB_DIR}/${f}`);
const rewritten = ['preflight.json', 'protected-before.json'].map(f => ({ file: `${PRB_DIR}/${f}`, currentSha256: prbState[f].sha256, mtime: prbState[f].mtime,
  qa1Fingerprint: qa1Before[key(f)] ?? null, unchangedSinceQA1Capture: qa1Before[key(f)] === prbState[f].sha256 && qa1After[key(f)] === prbState[f].sha256,
  originalBytesAvailable: false, originalHashRecordedAnywhere: false }));
const prbAfter = await readJson(`${PRB_DIR}/protected-after.json`), rewrittenBefore = await readJson(`${PRB_DIR}/protected-before.json`);
const prbAfterNow = await fingerprints(Object.keys(prbAfter));
const prbCorpusUnchangedNow = Object.entries(prbAfter).filter(([f, h]) => prbAfterNow[norm(f)] !== h).map(([f]) => f);
const between = Object.entries(prbAfter).filter(([f, h]) => rewrittenBefore[f] !== undefined && rewrittenBefore[f] !== h).map(([f]) => f);
const missingInRewritten = Object.keys(prbAfter).filter(f => rewrittenBefore[f] === undefined);
const rewrittenPreflight = await readJson(`${PRB_DIR}/preflight.json`);
const prbAuditor = 'cross-projection-audit/production-baseline-rebuild.mjs';
const prbHygiene = await readJson(`${PRB_DIR}/hygiene.json`);
// Since-QA1 drift of the whole QA1 protected corpus (QA1 captured after the incident).
const qa1Now = {}, qa1Missing = [];
for (const f of Object.keys(qa1After)) { try { qa1Now[f] = sha(await readFile(f)); } catch (e) { if (e.code === 'ENOENT') qa1Missing.push(f); else throw e; } }
const sinceQA1Changed = Object.keys(qa1After).filter(f => qa1Now[f] !== undefined && qa1Now[f] !== qa1After[f]);
const newSinceQA1 = corpus.filter(f => !Object.keys(qa1After).some(k => norm(k) === f) && !isOwnPath(f));
pending['evidence_integrity.json'] = ({
  basis: 'MEASURED except fields marked INFERRED',
  qa1NonConformance: { source: `${QA1_DIR}/process_incident.json`, mechanism: `QA1 imported ${prbAuditor}; its top-level block 'if (process.argv[2] === "preflight")' executed because QA1 was itself invoked with argv[2]=preflight.`,
    prbPreflightWrites: ['mkdir(out)', 'write protected-before.json (fingerprints of artifacts, data, cross-projection-audit, production root)', 'write preflight.json (commit, verified source, production validation, protectedCount)'],
    otherPrbBlocksExecuted: 'NONE (audit/finalize/details/report blocks are guarded by distinct argv values)' },
  rewrittenFiles: rewritten,
  lostEvidence: [
    { item: 'Original bytes and SHA-256 of p2-3c-prb/preflight.json and protected-before.json', status: 'NOT_RECONSTRUCTIBLE', note: 'No later artifact recorded their hashes; searched p2-3c-lr, p2-3c-final-review and QA1 evidence.' },
    { item: `PRB-time fingerprint of ${prbAuditor} (captured in original protected-before, deliberately skipped by PRB finalize)`, status: 'NOT_RECONSTRUCTIBLE' },
    { item: 'Original protectedCount written by PRB preflight', status: 'INFERRED_ONLY', inferredValue: Object.keys(prbAfter).length + 1, note: 'protected-after has every original key except the auditor itself; value is an inference, not a recovered record.' },
    { item: 'PRB-time record of source verification and production validateBundle result', status: 'NOT_RECONSTRUCTIBLE_AS_HISTORICAL_RECORD', note: 'The same checks were re-executed by QA2 on unchanged bytes (authority_verification.json); this is new evidence, not a restoration.' },
  ],
  survivingIndependentAuthority: [
    { claim: 'PRB 385-file protected corpus unchanged during PRB', authority: 'p2-3c-prb/protected-after.json written by PRB finalize, which asserted changed=[] against the original protected-before (hygiene.json changed=[], finalize.log)', recordedProtectedFiles: prbHygiene.protectedFiles, qualification: 'These PRB outputs were not fingerprinted by anything between 13:53 and QA1 capture at 14:51; mtimes are consistent but weak.' },
    { claim: 'PRB 385-file corpus still identical now', status: prbCorpusUnchangedNow.length ? 'FAIL' : 'PASS', changed: prbCorpusUnchangedNow },
    { claim: 'Rewritten protected-before (QA1 time) equals PRB protected-after on shared keys', status: between.length ? 'FAIL' : 'PASS', differing: between, keysMissingFromRewritten: missingInRewritten,
      meaning: 'No file of the PRB corpus changed between PRB finalize and the accidental QA1-time rewrite.' },
    { claim: 'Candidate/source/baseline identities', status: 'PASS', authority: 'Recomputed by QA2 from bytes; matches two Linux replay copies, final-review record and QA1 authority.json' },
  ],
  rewrittenPreflightContentSummary: { commit: rewrittenPreflight.commit, protectedCount: rewrittenPreflight.protectedCount, productionValidationStatus: rewrittenPreflight.productionValidation?.status,
    note: 'Describes the QA1-time accidental re-execution, not the PRB-time preflight.' },
  sinceQA1Capture: { qa1ProtectedFiles: Object.keys(qa1After).length, changed: sinceQA1Changed, missing: qa1Missing, newFilesInQA2Corpus: newSinceQA1 },
  prbFileState: prbState,
  qa2Controls: ['Exclusive new run directory (non-recursive mkdir, fails if present)', 'Create-only writer (flag wx) confined to the run directory', 'Entry scripts throw when imported',
    'Static import closure checked: no cross-projection-audit or non-QA2 scripts module reachable; no process.argv in reachable src', 'Protected corpus fingerprinted before analysis and re-verified at finalize'],
});
pending['preflight.json'] = { phase: 'preflight', startedAt, finishedAt: new Date().toISOString(), protectedFiles: corpus.length, status: 'PASS',
  sinceQA1Changed: sinceQA1Changed.length, prbCorpusChangedNow: prbCorpusUnchangedNow.length, abortedAttempts: ABORTED_RUNS };
await mkdir(path.dirname(OUT), { recursive: true });
await mkdir(OUT); // non-recursive: throws EEXIST on a race
const w = guardedWriter();
for (const [f, v] of Object.entries(pending)) await w.json(f, v);
console.log(JSON.stringify({ protectedFiles: corpus.length, sinceQA1Changed, qa1Missing: qa1Missing.length, newSinceQA1: newSinceQA1.length, prbCorpusChangedNow: prbCorpusUnchangedNow, between: between.length, missingInRewritten: missingInRewritten.length, rewritten }, null, 1));
