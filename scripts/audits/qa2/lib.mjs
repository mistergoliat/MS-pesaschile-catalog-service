// P2.3-QA2 shared library. Pure exports only: importing this module performs no I/O.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Attempt 1 (run-20261008-qa2-bddf7f) aborted in preflight after protected_before.json; kept untouched as evidence.
export const ABORTED_RUNS = ['artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f'];
export const RUN_ID = 'run-20261008-qa2-bddf7f-r2';
export const OUT = `artifacts/catalog-v2/qa2/${RUN_ID}`;
export const CANDIDATE_ID = 'sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f';
export const BASELINE_ID = 'sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8';
export const SOURCE_EXTRACTION_ID = 'sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9';
export const SOURCE_AGGREGATE = 'sha256:2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26';
export const COMMIT = '3c1e9c4a17469e9beac4c8cb242aac820635d817';
export const CANDIDATE_DIR = 'artifacts/catalog-v2/p2-3c-prb/candidate-1/bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f';
export const REPLAY_DIRS = ['artifacts/catalog-v2/p2-3c-lr/replay-1/candidate/bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f',
  'artifacts/catalog-v2/p2-3c-lr/replay-2/candidate/bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f'];
export const PRODUCTION_ROOT = 'C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/production-baseline';
export const SOURCE_DIR = `${PRODUCTION_ROOT}/2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26`;
export const BASELINE_DIR = `${PRODUCTION_ROOT}/84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8`;
export const QA1_DIR = 'artifacts/catalog-v2/qa1/run-20261008-bddf7f';
export const PRB_DIR = 'artifacts/catalog-v2/p2-3c-prb';
export const REPORT = 'docs/catalog-v2/P2_3_QA2_SEMANTIC_ACCURACY_AUDIT.md';
// Paths QA2 itself creates; everything else that pre-exists is protected.
export const QA2_OWN_PREFIXES = [OUT + '/', 'scripts/audits/qa2/'];
export const QA2_OWN_FILES = [REPORT];
// Expected identities attested by earlier, independent evidence (PRB script constants, LR report, QA1 authority).
export const EXPECTED = {
  candidateManifest: 'sha256:6b5fc8aec02583c46f24e84921917ff1d878e83978459e0dc6b8fe5c243cf850',
  baselineManifest: 'sha256:c1605f9e311fe0ee79164d1c849a93dd1f64e3a5eca172098d4d4015667bd8b6',
  sourceManifest: 'sha256:e25120e2c5dd519707dfe8f16012fd5000073492caca76227119ffd5008b7a6b',
  sourceHashes: {
    canonicalInput: 'sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9',
    compatibilityCsv: 'sha256:e4f83e5513803e714089a2ad9f7590ffaea1f0b4373203cefc0559054fb7a442',
    categoryTrustMap: 'sha256:01ac8a64b5aa20975d0e781eda618890bb7604219963eaf81ffaaed00db278fd',
    featureTrustMap: 'sha256:88bde84b077f86d21c04b419885f11cfb15c9f1a7ecf082942ef88d7e5dfd2c8',
  },
  trainingV2InternalSnapshot: 'sha256:10cd9a355399eee0d761baacde062d4d74d64aa4e5c326e1337be673795c90c6',
  trainingV2Wrapper: 'sha256:b315f13b1b63001ef5bfe4d4ff2b8f947748cede781b53cbc084c5fe2a009b77',
  admissionContract: 'sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94',
  contentHashes: {
    'productSemantics.json': 'sha256:1c665a75468dfb520133973c7371b0a9bc0597282586480c48d89144df22c465',
    'trainingSemantics.json': 'sha256:a53ddeb2ea2650dd2bf0fd4cdf8e74665f2c7b0a83538068426a941ea6ab3e45',
    'specs.json': 'sha256:f0a1d85409758fb652bb371f0400d12f9ac1c9c9ee4f3b9d05bc529323e8cee2',
    'trustMaps.json': 'sha256:3c7c2a7f35bec8ffe001e80ab09069e5d408176580c6583ec6886cd8807fc437',
    'trainingSemanticsV2.json': 'sha256:28f4b01fe50f9e9f61bee2e69e560b93e7f8211ec092ba2cbd8d6ecb1229e7db',
  },
};

export const sha = buf => 'sha256:' + createHash('sha256').update(buf).digest('hex');
export const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
export const norm = f => f.replaceAll('\\', '/');
export const countBy = (rows, fn) => rows.reduce((a, r) => { const k = fn(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});
export const uniqueSorted = a => [...new Set(a)].sort();

// Entry scripts call this first: importing an entry script by mistake throws before any I/O.
export function assertEntry(metaUrl) {
  if (!process.argv[1] || pathToFileURL(path.resolve(process.argv[1])).href !== metaUrl)
    throw new Error('QA2 entry script imported as a module; refusing to run side effects.');
}

export function isOwnPath(f) {
  const p = norm(f);
  return QA2_OWN_PREFIXES.some(x => p.startsWith(x)) || QA2_OWN_FILES.includes(p);
}

// Create-only writer confined to the QA2 run directory. Never overwrites, never writes elsewhere.
export function guardedWriter(outDir = OUT) {
  const root = path.resolve(outDir) + path.sep;
  async function target(rel) {
    const abs = path.resolve(outDir, rel);
    if (!abs.startsWith(root)) throw new Error(`Refusing write outside QA2 run dir: ${rel}`);
    try { await stat(abs); throw Object.assign(new Error(`Refusing to overwrite existing file: ${rel}`), { code: 'EEXIST_QA2' }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await mkdir(path.dirname(abs), { recursive: true });
    return abs;
  }
  return {
    json: async (rel, value) => writeFile(await target(rel), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }),
    text: async (rel, value) => writeFile(await target(rel), value, { flag: 'wx' }),
    csv: async (rel, rows, columns = Object.keys(rows[0] ?? {})) => writeFile(await target(rel), toCsv(rows, columns), { flag: 'wx' }),
  };
}

export function toCsv(rows, columns) {
  const cell = x => '"' + String(x === undefined || x === null ? '' : typeof x === 'object' ? JSON.stringify(x) : x).replaceAll('"', '""') + '"';
  return '\ufeff' + [columns.map(cell).join(','), ...rows.map(r => columns.map(k => cell(r[k])).join(','))].join('\r\n') + '\r\n';
}

// RFC 4180 parser (quoted fields, embedded commas/newlines); avoids importing audit-script helpers.
export function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  const s = text.replace(/^\ufeff/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1 || r[0] !== '');
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export async function walk(dir) {
  try {
    return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : e.isSymbolicLink() ? [] : [path.join(dir, e.name)]))).flat();
  } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

export async function fingerprints(files) {
  const out = {};
  for (const f of files) out[norm(f)] = sha(await readFile(f));
  return out;
}

// Protected corpus: every pre-existing file in these roots, minus paths QA2 owns.
export const PROTECTED_ROOTS = ['artifacts', 'data', 'src', 'scripts', 'tests', 'docs', 'contracts', 'client', 'cross-projection-audit', PRODUCTION_ROOT];
export const PROTECTED_FILES = ['package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', 'vitest.config.ts', 'eslint.config.js'];
export async function protectedCorpus() {
  const files = (await Promise.all(PROTECTED_ROOTS.map(walk))).flat().map(norm).filter(f => !isOwnPath(f));
  return uniqueSorted([...files, ...PROTECTED_FILES]);
}

// Deterministic, published pseudo-random rank (no Math.random): digest of seed and productId.
export const rankKey = (seed, productId) => createHash('sha256').update(`${seed}:${productId}`).digest('hex');
export function rankIds(seed, ids) {
  return [...ids].sort((a, b) => { const x = rankKey(seed, a), y = rankKey(seed, b); return x < y ? -1 : x > y ? 1 : a - b; });
}

export async function loadAuthoritative() {
  const [src, ps, t1, t2, specs, trust] = await Promise.all([
    readJson(`${SOURCE_DIR}/canonical_input.json`), readJson(`${CANDIDATE_DIR}/productSemantics.json`), readJson(`${CANDIDATE_DIR}/trainingSemantics.json`),
    readJson(`${CANDIDATE_DIR}/trainingSemanticsV2.json`), readJson(`${CANDIDATE_DIR}/specs.json`), readJson(`${CANDIDATE_DIR}/trustMaps.json`)]);
  const categories = parseCsv(await readFile(`${SOURCE_DIR}/category_trust_map.csv`, 'utf8'));
  const features = parseCsv(await readFile(`${SOURCE_DIR}/feature_trust_map.csv`, 'utf8'));
  const byId = rows => new Map(rows.map(r => [Number(r.productId), r]));
  const specGroups = new Map();
  for (const [i, r] of specs.records.entries()) { const id = Number(r.productKey.slice(1)); if (!specGroups.has(id)) specGroups.set(id, []); specGroups.get(id).push({ ...r, _index: i }); }
  assert.equal(src.products.length, 2048);
  return { src, ps, t1, t2, specs, trust, categories, features, product: byId(ps.snapshot.records), v1: byId(t1.snapshot.records), v2: byId(t2.snapshot.records), specGroups,
    categoryTrust: new Map(categories.map(r => [Number(r.categoryId), r.trustClass])), featureTrust: new Map(features.map(r => [Number(r.featureId), r.trustClass])),
    sourceIndex: new Map(src.products.map((p, i) => [p.productId, i])), productIndex: new Map(ps.snapshot.records.map((r, i) => [Number(r.productId), i])),
    v2Index: new Map(t2.snapshot.records.map((r, i) => [Number(r.productId), i])) };
}

export const factsOf = r => [...r.exerciseCapabilities.map(a => ({ kind: 'EXERCISE', code: a.capabilityCode, relationType: a.relationType, evidence: a.evidence })),
  ...r.trainingFunctions.map(a => ({ kind: 'FUNCTION', code: a.functionCode, relationType: a.relationType, evidence: a.evidence }))];
