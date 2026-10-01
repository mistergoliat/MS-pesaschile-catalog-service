import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('replays a PII-free source in independent processes and refuses in-place mutation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'catalog-bundle-replay-'));
  const script = path.resolve('scripts/catalog-v2/build-projection-bundle.ts');
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', ...args], { cwd: process.cwd(), encoding: 'utf8' });
  try {
    const sourceDir = path.join(root, 'source');
    const fixture = run([path.resolve('scripts/catalog-v2/write-bundle-replay-fixture.ts'), sourceDir]);
    expect(fixture.status, fixture.stderr).toBe(0);
    const build = (name: string) => run([script, `--source-dir=${sourceDir}`, `--output-dir=${path.join(root, name)}`, '--code-ref=fixture-code-v1']);
    const a = build('a'), b = build('b');
    expect(a.status, a.stderr).toBe(0);
    expect(b.status, b.stderr).toBe(0);
    const left = JSON.parse(a.stdout), right = JSON.parse(b.stdout);
    expect(left.projectionBundleId).toBe(right.projectionBundleId);
    for (const name of ['productSemantics', 'trainingSemantics', 'specs', 'trustMaps']) {
      expect(left.projections[name].contentHash).toBe(right.projections[name].contentHash);
    }
    expect(left.validation.status).toBe('PASS');
    expect(JSON.parse(build('a').stdout).reused).toBe(true);
    const artifact = path.join(left.directory, 'specs.json');
    writeFileSync(artifact, `${readFileSync(artifact, 'utf8')}corrupt`);
    const conflict = build('a');
    expect(conflict.status).not.toBe(0);
    expect(JSON.parse(conflict.stderr).code).toBe('IMMUTABLE_ARTIFACT_CONFLICT');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
