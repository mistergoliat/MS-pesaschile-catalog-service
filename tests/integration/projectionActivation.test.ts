import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivationService } from '../../src/domain/catalog/projection-activation.js';
import { FileProjectionActivationStore } from '../../src/infra/catalog/file-projection-activation-store.js';

const fixture = path.resolve('scripts/catalog-v2');
let base: string;
let store: FileProjectionActivationStore;
let service: ActivationService;
let b1: string;
let b2: string;
const actor = { type: 'manual' as const, identity: 'test' };
function script(name: string, args: string[]) {
  execFileSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.join(fixture, name), ...args], { cwd: process.cwd(), stdio: 'pipe' });
}
async function activeId() { return (await store.readActivePointer())?.activeProjectionBundleId ?? null; }

describe('projection activation control plane', () => {
  beforeAll(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'catalog-activation-'));
    const source = path.join(base, 'source');
    script('write-bundle-replay-fixture.ts', [source]);
    for (const ref of ['fixture-a', 'fixture-b']) script('build-projection-bundle.ts', [`--source-dir=${source}`, `--output-dir=${path.join(base, 'bundles')}`, `--code-ref=${ref}`]);
    const ids = (await readdir(path.join(base, 'bundles'))).filter((name) => /^[a-f0-9]{64}$/u.test(name)).sort();
    if (ids.length !== 2) throw new Error(`expected two bundles, got ${ids.length}`);
    b1 = `sha256:${ids[0]!}`;
    b2 = `sha256:${ids[1]!}`;
    store = new FileProjectionActivationStore(base, [source]);
    service = new ActivationService(store);
  }, 60000);
  afterAll(async () => { if (base) await rm(base, { recursive: true, force: true }); });

  it('validates real bundles, promotes atomically, uses CAS, and rolls back with retained history', async () => {
    expect((await service.candidate(b1)).manifest.projectionBundleId).toBe(b1);
    const first = await service.activate(b1, { actor, reason: 'initial', expectedActiveBundleId: null });
    expect(first.status).toBe('activated');
    expect((await service.activate(b1, { actor, reason: 'repeat' })).status).toBe('already_active');
    const second = await service.activate(b2, { actor, reason: 'promotion', expectedActiveBundleId: b1 });
    expect(second.status).toBe('activated');
    expect(second.active.activationId).not.toBe(first.active.activationId);
    await expect(service.activate(b1, { actor, reason: 'stale', expectedActiveBundleId: b1 })).rejects.toThrow('ACTIVATION_CONFLICT');
    expect(await activeId()).toBe(b2);
    const rolled = await service.rollback({ actor });
    expect(rolled.status).toBe('activated');
    expect(await activeId()).toBe(b1);
    const status = await service.status();
    expect(status.history.map((record) => [record.from, record.to])).toEqual([[b2, b1], [b1, b2], [null, b1]]);
    expect(new Set(status.history.map((record) => record.activationId)).size).toBe(3);
    expect(status.runtimeConsumption).toBe('NOT_YET_WIRED');
    expect(status.loadedProjectionBundleId).toBeNull();
    expect((await readdir(path.join(base, 'control', 'history'))).length).toBe(3);
  }, 30000);

  it('preserves active state after invalid candidates and rejects corrupt pointers', async () => {
    const missing = `sha256:${'f'.repeat(64)}`;
    await expect(service.activate(missing, { actor, reason: 'missing' })).rejects.toThrow('BUNDLE_NOT_FOUND');
    expect(await activeId()).toBe(b1);
    const corrupt = path.join(base, 'bundles', b2.slice(7), 'specs.json');
    const original = await readFile(corrupt);
    await writeFile(corrupt, '{}');
    await expect(service.activate(b2, { actor, reason: 'corrupt' })).rejects.toThrow('BUNDLE_INVALID');
    await expect(service.rollback({ to: b2, actor })).rejects.toThrow('ROLLBACK_TARGET_INVALID');
    expect(await activeId()).toBe(b1);
    await writeFile(corrupt, original);
    const manifestFile = path.join(base, 'bundles', b2.slice(7), 'manifest.json');
    const manifest = await readFile(manifestFile, 'utf8');
    await writeFile(manifestFile, manifest.replace('"schemaVersion": "1"', '"schemaVersion": "2"'));
    await expect(service.activate(b2, { actor, reason: 'schema' })).rejects.toThrow('BUNDLE_INVALID');
    expect(await activeId()).toBe(b1);
    const incompatible = JSON.parse(manifest) as { projections: { specs: { schemaVersion: string } } };
    incompatible.projections.specs.schemaVersion = '2';
    await writeFile(manifestFile, JSON.stringify(incompatible));
    await expect(service.activate(b2, { actor, reason: 'incompatible' })).rejects.toThrow('BUNDLE_RUNTIME_INCOMPATIBLE');
    expect(await activeId()).toBe(b1);
    await writeFile(manifestFile, manifest);
    const activeFile = path.join(base, 'control', 'active.json');
    const activeRaw = await readFile(activeFile, 'utf8');
    const pointer = JSON.parse(activeRaw) as { bundleManifestHash: string };
    pointer.bundleManifestHash = `sha256:${'0'.repeat(64)}`;
    await writeFile(activeFile, JSON.stringify(pointer));
    await expect(service.status()).rejects.toThrow('ACTIVE_POINTER_CORRUPT');
    await writeFile(activeFile, activeRaw);
    await writeFile(activeFile, '{');
    await expect(service.status()).rejects.toThrow('ACTIVE_POINTER_CORRUPT');
  }, 30000);

  it('rejects rollback without a previous activation', async () => {
    const isolated = path.join(base, 'isolated');
    await mkdir(path.join(isolated, 'bundles'), { recursive: true });
    await cp(path.join(base, 'bundles', b1.slice(7)), path.join(isolated, 'bundles', b1.slice(7)), { recursive: true });
    const local = new ActivationService(new FileProjectionActivationStore(isolated, [path.join(base, 'source')]));
    await expect(local.rollback({ actor })).rejects.toThrow('NO_ROLLBACK_TARGET');
    await local.activate(b1, { actor, reason: 'initial' });
    await expect(local.rollback({ actor })).rejects.toThrow('NO_ROLLBACK_TARGET');
    await writeFile(path.join(isolated, 'control', '.active-interrupted.tmp'), '{');
    expect((await local.status()).desiredProjectionBundleId).toBe(b1);
  }, 30000);

  it('serializes concurrent promotions without losing an update', async () => {
    const isolated = path.join(base, 'concurrent');
    await mkdir(path.join(isolated, 'bundles'), { recursive: true });
    for (const id of [b1, b2]) await cp(path.join(base, 'bundles', id.slice(7)), path.join(isolated, 'bundles', id.slice(7)), { recursive: true });
    const local = new ActivationService(new FileProjectionActivationStore(isolated, [path.join(base, 'source')]));
    const attempts = await Promise.allSettled([b1, b2].map((id) => local.activate(id, { actor, reason: 'concurrent', expectedActiveBundleId: null })));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await local.status()).history).toHaveLength(1);
  }, 30000);
});
