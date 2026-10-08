// Historical FIX2 producer recipe. Hash physical bytes; never accept an expected codeRef.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export const recipeVersion = 'projection-code-identity-fix2-physical-bytes-v1';
export const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// A declared, host-independent ordering reproduces the historical producer's UTF-16 keys.
const legacyKey = name => name.replaceAll('/', '\\');
export function orderFix2(paths) {
  assert.equal(new Set(paths).size, paths.length);
  assert(paths.every(p => !p.includes('\\') && !p.startsWith('/') && !p.split('/').includes('..')));
  return [...paths].sort((a, b) => compare(legacyKey(a), legacyKey(b)));
}
async function walk(root, relative) {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = `${relative}/${entry.name}`;
    assert(!entry.isSymbolicLink(), `Unexpected symlink: ${name}`);
    if (entry.isDirectory()) result.push(...await walk(root, name));
    else if (entry.isFile() && name.endsWith('.ts')) result.push(name);
  }
  return result;
}
export async function deriveFix2CodeIdentity(root = process.cwd()) {
  const paths = (await Promise.all(['src', 'scripts'].map(p => walk(root, p)))).flat();
  const ordered = [...orderFix2(paths), 'package-lock.json'];
  assert.deepEqual(orderFix2(paths), orderFix2([...paths].reverse()));
  const entries = await Promise.all(ordered.map(async name => [name, sha256(await readFile(path.join(root, name)))]));
  // Arrays of string pairs have exactly the same bytes under JSON.stringify and canonicalJson.
  return { recipeVersion, codeRef: sha256(JSON.stringify(entries)), entryCount: entries.length, entries };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await deriveFix2CodeIdentity(process.argv[2] ?? process.cwd());
  console.log(JSON.stringify(result, null, 2));
}
