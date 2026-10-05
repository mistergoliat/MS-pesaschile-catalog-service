import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    const audit = path.resolve('scripts/catalog-v2/audit-product-semantics-authority.ts');
    const auditArgs = [audit, `--projection-root=${root}`, `--bundle-id=${left.projectionBundleId}`, '--replay-accepted-baseline=true'];
    // The activation store expects <root>/bundles/<id>; use the already published fixture directory.
    const auditRoot = path.join(root, 'audit-runtime');
    cpSync(path.join(root, 'a'), path.join(auditRoot, 'bundles'), { recursive: true });
    auditArgs[1] = `--projection-root=${auditRoot}`;
    const reportA = path.join(root, 'parity-a.json'), reportB = path.join(root, 'parity-b.json');
    const diffA = run([...auditArgs, `--output=${reportA}`]), diffB = run([...auditArgs, `--output=${reportB}`]);
    expect(diffA.status, diffA.stderr).toBe(2);
    expect(diffB.status, diffB.stderr).toBe(2);
    expect(readFileSync(reportA, 'utf8')).toBe(readFileSync(reportB, 'utf8'));
    const parity = JSON.parse(readFileSync(reportA, 'utf8'));
    expect(parity.inputs.legacy.presenceVerified).toBe(false);
    expect(parity.coverage.legacy.recordCount).toBe(2011);
    expect(parity.status).toBe('RETIREMENT_BLOCKED');
    const artifact = path.join(left.directory, 'specs.json');
    writeFileSync(artifact, `${readFileSync(artifact, 'utf8')}corrupt`);
    const conflict = build('a');
    expect(conflict.status).not.toBe(0);
    expect(JSON.parse(conflict.stderr).code).toBe('IMMUTABLE_ARTIFACT_CONFLICT');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);
