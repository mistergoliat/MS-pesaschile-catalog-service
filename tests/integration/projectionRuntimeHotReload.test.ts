import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ActivationService } from '../../src/domain/catalog/projection-activation.js';
import { RuntimeProjectionManager, type RuntimeProjectionState } from '../../src/domain/catalog/runtime-projection.js';
import { RuntimeProductSemanticReader } from '../../src/domain/catalog/runtime-product-semantic-reader.js';
import { FileProjectionActivationStore } from '../../src/infra/catalog/file-projection-activation-store.js';
import { buildApp } from '../../src/interfaces/http/app.js';
import { collectRuntimeReadinessChecks } from '../../src/shared/readiness.js';
import { createRepositoryStub } from '../support/fakes.js';

let base: string;
let ids: string[];
const actor = { type: 'manual' as const, identity: 'p15-test' };
function script(name: string, args: string[]) {
  execFileSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('scripts/catalog-v2', name), ...args], { stdio: 'pipe' });
}
async function isolated(name: string, bundles: string[] = ids) {
  const root = path.join(base, name);
  await mkdir(path.join(root, 'bundles'), { recursive: true });
  for (const id of bundles) await cp(path.join(base, 'published', id.slice(7)), path.join(root, 'bundles', id.slice(7)), { recursive: true });
  const store = new FileProjectionActivationStore(root);
  return { root, store, activation: new ActivationService(store) };
}
async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) { if (Date.now() > deadline) throw new Error('convergence timeout'); await new Promise((resolve) => setTimeout(resolve, 25)); }
}

describe('CAT-V2 runtime projection hot reload', () => {
  beforeAll(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'catalog-runtime-'));
    const source = path.join(base, 'source');
    script('write-bundle-replay-fixture.ts', [source]);
    for (const ref of ['runtime-a', 'runtime-b', 'runtime-c'])
      script('build-projection-bundle.ts', [`--source-dir=${source}`, `--output-dir=${path.join(base, 'published')}`, `--code-ref=${ref}`]);
    ids = (await readdir(path.join(base, 'published'))).filter((name) => /^[a-f0-9]{64}$/u.test(name)).sort().map((name) => `sha256:${name}`);
    if (ids.length !== 3) throw new Error('expected three published bundles');
    await rm(source, { recursive: true }); // Archived build input must not block activation or load.
  }, 60000);
  afterAll(async () => { if (base) await rm(base, { recursive: true, force: true }); });

  it('loads B1 at startup, hot reloads B2 and rollback B1 through one live API instance', async () => {
    const [b1, b2] = ids;
    const { store, activation } = await isolated('positive');
    await activation.activate(b1!, { actor, reason: 'initial' });
    const manager = new RuntimeProjectionManager(store, { pollIntervalMs: 100 });
    await manager.start();
    const reader = new RuntimeProductSemanticReader(manager);
    const app = await buildApp({ service: { searchProducts: vi.fn(), getProduct: vi.fn(), batchGetProducts: vi.fn() } as never,
      repository: createRepositoryStub(), productSemanticSnapshotReader: reader, projectionRuntimeManager: manager,
      readyCheck: () => collectRuntimeReadinessChecks({ repository: { ping: async () => undefined }, cache: { ping: async () => true },
        cacheDriver: 'memory', relationshipSnapshotReader: { getStatus: () => ({ state: 'not_loaded' }) },
        productSemanticSnapshotReader: reader, projectionRuntimeManager: manager }) });
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    let requestEntered!: () => void;
    const entered = new Promise<void>((resolve) => { requestEntered = resolve; });
    app.get('/health/projection-capture-test', async () => {
      const firstBundleId = manager.forRequest()?.projectionBundleId;
      requestEntered(); await requestGate;
      return { firstBundleId, secondBundleId: manager.forRequest()?.projectionBundleId };
    });
    expect(manager.status()).toMatchObject({ desiredProjectionBundleId: b1, loadedProjectionBundleId: b1, reloadState: 'READY' });
    const startupMetrics = manager.status().lastAttemptMetrics;
    expect((await app.inject({ method: 'GET', url: '/health/projections' })).json().loadedProjectionBundleId).toBe(b1);
    const first = manager.current()!;
    expect(first.productSemantics.recordCount).toBe(3);
    expect(first.relationships.status).toBe('unavailable');
    const semanticResponse = await app.inject({ method: 'GET', url: '/v1/products/101/semantics', headers: { 'x-api-key': 'test-api-key' } });
    expect(semanticResponse.statusCode).toBe(200);
    const inFlight = app.inject({ method: 'GET', url: '/health/projection-capture-test' });
    await entered;
    const promoted = await activation.activate(b2!, { actor, reason: 'promotion', expectedActiveBundleId: b1 });
    await waitFor(() => manager.status().loadedProjectionBundleId === b2);
    const promotionMetrics = manager.status().lastAttemptMetrics;
    const promotionConvergenceMs = Date.parse(manager.status().loadedAt!) - Date.parse(promoted.active.activatedAt);
    releaseRequest();
    expect((await inFlight).json()).toEqual({ firstBundleId: b1, secondBundleId: b1 });
    expect((await app.inject({ method: 'GET', url: '/health/projection-capture-test' })).json()).toEqual({ firstBundleId: b2, secondBundleId: b2 });
    expect(manager.current()).not.toBe(first);
    expect((await app.inject({ method: 'GET', url: '/health/projections' })).json()).toMatchObject({ desiredProjectionBundleId: b2, loadedProjectionBundleId: b2, reloadState: 'READY' });
    const rolled = await activation.rollback({ actor });
    await waitFor(() => manager.status().loadedProjectionBundleId === b1);
    const rollbackMetrics = manager.status().lastAttemptMetrics;
    const rollbackConvergenceMs = Date.parse(manager.status().loadedAt!) - Date.parse(rolled.active.activatedAt);
    console.log('P1.5_DRILL_METRICS', JSON.stringify({ startupMetrics, promotionMetrics, rollbackMetrics, promotionConvergenceMs, rollbackConvergenceMs }));
    expect(manager.status()).toMatchObject({ desiredProjectionBundleId: b1, loadedProjectionBundleId: b1, reloadState: 'READY' });
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    manager.stop(); await app.close();
  }, 30000);

  it('keeps B1 loaded and commercial truth ready when desired B2 cannot load', async () => {
    const [b1, b2] = ids;
    const { root, store, activation } = await isolated('failure', [b1!, b2!]);
    await activation.activate(b1!, { actor, reason: 'initial' });
    const manager = new RuntimeProjectionManager(store, { retryBaseMs: 1000, pollIntervalMs: 100 });
    await manager.start();
    await activation.activate(b2!, { actor, reason: 'promotion' });
    const spec = path.join(root, 'bundles', b2!.slice(7), 'specs.json');
    const original = await readFile(spec);
    await writeFile(spec, '{}');
    await manager.reconcile();
    expect(manager.status()).toMatchObject({ desiredProjectionBundleId: b2, loadedProjectionBundleId: b1, reloadState: 'FAILED',
      readiness: { projectionRuntime: 'DEGRADED', productSemantics: 'READY', specs: 'READY' } });
    const checks = await collectRuntimeReadinessChecks({ repository: { ping: async () => undefined }, cache: { ping: async () => true },
      cacheDriver: 'memory', relationshipSnapshotReader: { getStatus: () => ({ state: 'not_loaded' }) }, projectionRuntimeManager: manager });
    expect(checks.projection?.readiness.commercialTruth).toBe('READY');
    expect(checks.projection?.readiness.projectionRuntime).toBe('DEGRADED');
    const attempts = manager.status().lastReloadAttemptAt;
    await manager.reconcile();
    expect(manager.status().lastReloadAttemptAt).toBe(attempts); // bounded retry
    await writeFile(spec, original);
    manager.stop();
  }, 30000);

  it('fences a stale B2 attempt and converges on B3 without parallel loaders', async () => {
    const [b1, b2, b3] = ids;
    const { store, activation } = await isolated('rapid');
    await activation.activate(b1!, { actor, reason: 'initial' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let activeLoads = 0; let maximumLoads = 0;
    const events: string[] = [];
    let template: RuntimeProjectionState;
    const seed = new RuntimeProjectionManager(store);
    await seed.reconcile(); template = seed.current()!;
    const manager = new RuntimeProjectionManager(store, { pollIntervalMs: 100, load: async (pointer) => {
      activeLoads += 1; maximumLoads = Math.max(maximumLoads, activeLoads);
      try { if (pointer.activeProjectionBundleId === b2) await gate;
        return Object.freeze({ ...template, projectionBundleId: pointer.activeProjectionBundleId, activationId: pointer.activationId }); }
      finally { activeLoads -= 1; }
    }, onAttempt: (event) => events.push(event.result) });
    await manager.start();
    await activation.activate(b2!, { actor, reason: 'second' });
    const loading = manager.reconcile();
    await waitFor(() => manager.status().reloadState === 'LOADING');
    await activation.activate(b3!, { actor, reason: 'third' });
    release(); await loading;
    await waitFor(() => manager.status().loadedProjectionBundleId === b3);
    expect(manager.status()).toMatchObject({ desiredProjectionBundleId: b3, loadedProjectionBundleId: b3, reloadState: 'READY' });
    expect(events).toContain('STALE_RELOAD');
    expect(maximumLoads).toBe(1);
    manager.stop();
  }, 30000);

  it('reports no pointer, corrupt pointer and failed startup distinctly', async () => {
    const [b1] = ids;
    const { root, store, activation } = await isolated('startup', [b1!]);
    const manager = new RuntimeProjectionManager(store);
    await manager.reconcile();
    expect(manager.status()).toMatchObject({ reloadState: 'NO_ACTIVE_BUNDLE', loadedProjectionBundleId: null,
      readiness: { projectionRuntime: 'UNAVAILABLE' } });
    const legacy = { getProductSemanticFact: () => ({ productId: '101' }) } as never;
    const reader = new RuntimeProductSemanticReader(manager, legacy);
    expect(reader.getProductSemanticFact('101')).toEqual({ productId: '101' });
    await activation.activate(b1!, { actor, reason: 'initial' });
    const spec = path.join(root, 'bundles', b1!.slice(7), 'specs.json');
    await writeFile(spec, '{}');
    await manager.reconcile();
    expect(manager.status()).toMatchObject({ reloadState: 'FAILED', loadedProjectionBundleId: null,
      readiness: { productSemantics: 'UNAVAILABLE' } });
    await writeFile(path.join(root, 'control', 'active.json'), '{');
    await manager.reconcile();
    expect(manager.status()).toMatchObject({ reloadState: 'CONTROL_PLANE_INVALID', loadedProjectionBundleId: null });
    expect(() => reader.getProductSemanticFact('101')).toThrow('Projection runtime has no product semantics');
  }, 30000);

  it('reports a missing desired bundle as invalid control state at startup', async () => {
    const [b1] = ids;
    const { root, store, activation } = await isolated('missing-desired', [b1!]);
    await activation.activate(b1!, { actor, reason: 'initial' });
    await rm(path.join(root, 'bundles', b1!.slice(7)), { recursive: true });
    const manager = new RuntimeProjectionManager(store);
    await manager.reconcile();
    expect(manager.status()).toMatchObject({ reloadState: 'CONTROL_PLANE_INVALID', loadedProjectionBundleId: null,
      lastReloadError: { code: 'ACTIVE_POINTER_CORRUPT' } });
  }, 30000);
});
