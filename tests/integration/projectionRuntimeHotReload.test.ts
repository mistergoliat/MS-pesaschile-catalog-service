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
import { aggregateContentHash, canonicalContent, contentHash, type CanonicalExtraction } from '../../src/domain/catalog/projection-input/canonical.js';
import { compatibilityCsv } from '../../scripts/catalog-v2/extractionArtifacts.js';
import { RuntimeTrainingSemanticV2Reader } from '../../src/domain/catalog/runtime-training-semantic-v2-reader.js';
import { DefaultTrainingSemanticReadService } from '../../src/application/catalog/training-semantic-read/index.js';
import { DefaultTrainingSemanticQueryService } from '../../src/application/catalog/training-semantic-query/index.js';
import { DefaultSemanticDiscoveryService } from '../../src/application/catalog/semantic-discovery/index.js';
import { getCatalogAuthoritySnapshot } from '../../src/application/catalog/runtime-context/catalogAuthoritySnapshot.js';
import { bundleId, canonicalJson, semanticHash, validateBundle, type BundleManifest } from '../../src/domain/catalog/projection-bundle.js';
import { recomputeTrainingSemanticSnapshotV2Identity } from '../../src/domain/training-semantic-snapshot/v2SnapshotBuilder.js';
import type { TrainingSemanticsV2Projection } from '../../src/domain/catalog/training-semantics-v2-projection.js';

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
    for (const ref of ['runtime-a', 'runtime-b', 'runtime-c']) {
      if (ref !== 'runtime-c') {
        const canonical = JSON.parse(await readFile(path.join(source, 'canonical_input.json'), 'utf8')) as CanonicalExtraction;
        if (ref === 'runtime-b') canonical.products.find((product) => product.productId === 101)!.name = 'Barra de prueba';
        canonical.products.find((product) => product.productId === 102)!.name = ref === 'runtime-a' ? 'Maquina Leg Press de prueba' : 'Maquina Seated Row de prueba';
        const raw = canonicalContent(canonical), csv = compatibilityCsv(canonical);
        const manifestFile = path.join(source, 'projection_input_manifest.json');
        const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
        manifest.artifacts.canonicalInput = contentHash(raw);
        manifest.artifacts.compatibilityCsv = contentHash(csv);
        manifest.sourceExtractionId = manifest.artifacts.canonicalInput;
        manifest.aggregateContentHash = aggregateContentHash(manifest.artifacts);
        await writeFile(path.join(source, 'canonical_input.json'), raw);
        await writeFile(path.join(source, 'product_catalog_exploration.csv'), csv);
        await writeFile(manifestFile, JSON.stringify(manifest));
      }
      script('build-projection-bundle.ts', [`--source-dir=${source}`, `--output-dir=${path.join(base, 'published')}`, `--code-ref=${ref}`]);
    }
    const manifests = await Promise.all((await readdir(path.join(base, 'published'))).filter((name) => /^[a-f0-9]{64}$/u.test(name))
      .map(async (name) => JSON.parse(await readFile(path.join(base, 'published', name, 'manifest.json'), 'utf8'))));
    ids = manifests.sort((a, b) => a.build.codeRef.localeCompare(b.build.codeRef)).map((manifest) => manifest.projectionBundleId);
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
    const trainingReader = new RuntimeTrainingSemanticV2Reader(manager);
    const app = await buildApp({ service: { searchProducts: vi.fn(), getProduct: vi.fn(), batchGetProducts: vi.fn() } as never,
      repository: createRepositoryStub(), productSemanticSnapshotReader: reader, projectionRuntimeManager: manager,
      trainingSemanticReadService: new DefaultTrainingSemanticReadService(trainingReader),
      trainingSemanticQueryService: new DefaultTrainingSemanticQueryService(trainingReader),
      semanticDiscoveryService: new DefaultSemanticDiscoveryService(reader, trainingReader),
      catalogAuthoritySnapshot: () => getCatalogAuthoritySnapshot({ projectionRuntimeManager: manager, productSemanticReader: reader,
        trainingSemanticSnapshotV2Reader: trainingReader, relationshipSnapshotReader: { getActiveSnapshotMetadata: () => null } as never,
        serviceBuildRef: 'p2.2b-test', getCommercialV2Status: async () => 'READY' }),
      readyCheck: () => collectRuntimeReadinessChecks({ repository: { ping: async () => undefined }, cache: { ping: async () => true },
        cacheDriver: 'memory', relationshipSnapshotReader: { getStatus: () => ({ state: 'not_loaded' }) },
        productSemanticSnapshotReader: reader, projectionRuntimeManager: manager }) });
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    let requestEntered!: () => void;
    const entered = new Promise<void>((resolve) => { requestEntered = resolve; });
    app.get('/health/projection-capture-test', async () => {
      const firstBundleId = manager.forRequest()?.projectionBundleId;
      const firstTrainingId = trainingReader.getMetadata()?.snapshotId;
      requestEntered(); await requestGate;
      return { firstBundleId, secondBundleId: manager.forRequest()?.projectionBundleId,
        firstTrainingId, secondTrainingId: trainingReader.getMetadata()?.snapshotId,
        capturedCapabilities: trainingReader.getProductTrainingSemanticFact(102)?.exerciseCapabilities.map((assignment) => assignment.capabilityCode) };
    });
    expect(manager.status()).toMatchObject({ desiredProjectionBundleId: b1, loadedProjectionBundleId: b1, reloadState: 'READY' });
    const startupMetrics = manager.status().lastAttemptMetrics;
    expect((await app.inject({ method: 'GET', url: '/health/projections' })).json().loadedProjectionBundleId).toBe(b1);
    const first = manager.current()!;
    expect(first.productSemantics.recordCount).toBe(3);
    expect(first.relationships.status).toBe('unavailable');
    const semanticResponse = await app.inject({ method: 'GET', url: '/v1/products/101/semantics', headers: { 'x-api-key': 'test-api-key' } });
    expect(semanticResponse.statusCode).toBe(200);
    const s1 = semanticResponse.json();
    expect(s1.primaryProductFamily.code).toBe('BENCH');
    const headers = { 'x-api-key': 'test-api-key' };
    const t1 = (await app.inject({ method: 'GET', url: '/v1/products/102/training-semantics', headers })).json();
    expect(t1).toMatchObject({ schemaVersion: '2', resolutionState: 'SEMANTIC_COMPLETE', exerciseCapabilities: [expect.objectContaining({ code: 'LEG_PRESS' })] });
    const trainingQuery = { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['LEG_PRESS'], mode: 'required', match: 'any' }] };
    const q1 = (await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', headers, payload: trainingQuery })).json();
    expect(q1.results.map((result: { productId: number }) => result.productId)).toEqual([102]);
    const d1 = (await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers, payload: trainingQuery })).json();
    expect(d1.results.map((result: { productId: number }) => result.productId)).toEqual([102]);
    const h1 = (await app.inject({ method: 'GET', url: '/health/catalog-authority' })).json();
    expect(h1.authorities.trainingSemanticsV2).toMatchObject({ authority: 'cat-v2-training-semantics-v2', status: 'READY', migrationStatus: 'COMPLETE',
      snapshotId: t1.lineage.snapshotId, projectionBundleId: b1, activationId: first.activationId });
    const inFlight = app.inject({ method: 'GET', url: '/health/projection-capture-test' });
    await entered;
    const promoted = await activation.activate(b2!, { actor, reason: 'promotion', expectedActiveBundleId: b1 });
    await waitFor(() => manager.status().loadedProjectionBundleId === b2);
    const promotionMetrics = manager.status().lastAttemptMetrics;
    const promotionConvergenceMs = Date.parse(manager.status().loadedAt!) - Date.parse(promoted.active.activatedAt);
    releaseRequest();
    expect((await inFlight).json()).toMatchObject({ firstBundleId: b1, secondBundleId: b1, firstTrainingId: t1.lineage.snapshotId,
      secondTrainingId: t1.lineage.snapshotId, capturedCapabilities: ['LEG_PRESS'] });
    expect((await app.inject({ method: 'GET', url: '/health/projection-capture-test' })).json()).toMatchObject({ firstBundleId: b2, secondBundleId: b2, capturedCapabilities: ['ROW'] });
    expect(manager.current()).not.toBe(first);
    const s2 = (await app.inject({ method: 'GET', url: '/v1/products/101/semantics', headers: { 'x-api-key': 'test-api-key' } })).json();
    expect(s2.primaryProductFamily.code).toBe('BARBELL');
    expect(s2.snapshotId).not.toBe(s1.snapshotId);
    const t2 = (await app.inject({ method: 'GET', url: '/v1/products/102/training-semantics', headers })).json();
    expect(t2.exerciseCapabilities.map((assignment: { code: string }) => assignment.code)).toEqual(['ROW']);
    expect(t2.lineage.snapshotId).not.toBe(t1.lineage.snapshotId);
    const q2 = (await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', headers, payload: trainingQuery })).json();
    expect(q2.results).toEqual([]);
    expect(q2.lineage.snapshotId).toBe(t2.lineage.snapshotId);
    const d2 = (await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers, payload: trainingQuery })).json();
    expect(d2.results).toEqual([]);
    expect(d2.lineage.trainingSemantics.snapshotId).toBe(t2.lineage.snapshotId);
    const pinned = await app.inject({ method: 'POST', url: '/v1/products/training-semantics/batch', headers,
      payload: { productIds: [102], expectedSnapshotId: t1.lineage.snapshotId } });
    expect(pinned.statusCode).toBe(409);
    const missing = await app.inject({ method: 'GET', url: '/v1/products/999999/training-semantics', headers });
    expect(missing.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/health/catalog-authority' })).json().authorities.trainingSemanticsV2)
      .toMatchObject({ snapshotId: t2.lineage.snapshotId, projectionBundleId: b2, activationId: promoted.active.activationId });
    expect((await app.inject({ method: 'GET', url: '/health/projections' })).json()).toMatchObject({ desiredProjectionBundleId: b2, loadedProjectionBundleId: b2, reloadState: 'READY' });
    const rolled = await activation.rollback({ actor });
    await waitFor(() => manager.status().loadedProjectionBundleId === b1);
    const rollbackMetrics = manager.status().lastAttemptMetrics;
    const rollbackConvergenceMs = Date.parse(manager.status().loadedAt!) - Date.parse(rolled.active.activatedAt);
    console.log('P1.5_DRILL_METRICS', JSON.stringify({ startupMetrics, promotionMetrics, rollbackMetrics, promotionConvergenceMs, rollbackConvergenceMs }));
    expect(manager.status()).toMatchObject({ desiredProjectionBundleId: b1, loadedProjectionBundleId: b1, reloadState: 'READY' });
    expect((await app.inject({ method: 'GET', url: '/v1/products/101/semantics', headers: { 'x-api-key': 'test-api-key' } })).json()).toEqual(s1);
    expect((await app.inject({ method: 'GET', url: '/v1/products/102/training-semantics', headers })).json()).toEqual(t1);
    expect((await app.inject({ method: 'POST', url: '/v1/products/training-semantics/query', headers, payload: trainingQuery })).json()).toEqual(q1);
    expect((await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers, payload: trainingQuery })).json()).toEqual(d1);
    expect((await app.inject({ method: 'GET', url: '/health/catalog-authority' })).json().authorities.trainingSemanticsV2)
      .toMatchObject({ snapshotId: t1.lineage.snapshotId, projectionId: h1.authorities.trainingSemanticsV2.projectionId,
        projectionBundleId: b1, activationId: rolled.active.activationId });
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
    const spec = path.join(root, 'bundles', b2!.slice(7), 'trainingSemanticsV2.json');
    const original = await readFile(spec);
    await writeFile(spec, '{}');
    await manager.reconcile();
    expect(manager.status()).toMatchObject({ desiredProjectionBundleId: b2, loadedProjectionBundleId: b1, reloadState: 'FAILED',
      readiness: { projectionRuntime: 'DEGRADED', productSemantics: 'READY', specs: 'READY', trainingSemanticsV2: 'READY' } });
    expect(new RuntimeTrainingSemanticV2Reader(manager).getProductTrainingSemanticFact(102)?.exerciseCapabilities.map((assignment) => assignment.capabilityCode)).toEqual(['LEG_PRESS']);
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
    const spec = path.join(root, 'bundles', b1!.slice(7), 'trainingSemanticsV2.json');
    await writeFile(spec, '{}');
    await manager.reconcile();
    expect(manager.status()).toMatchObject({ reloadState: 'FAILED', loadedProjectionBundleId: null,
      readiness: { productSemantics: 'UNAVAILABLE' } });
    const trainingReader = new RuntimeTrainingSemanticV2Reader(manager);
    expect(trainingReader.getMetadata()).toBeNull();
    expect(() => trainingReader.getAllProductTrainingSemanticFacts()).toThrow('RUNTIME_SNAPSHOT_UNAVAILABLE');
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

  it('keeps Phase 1 bundles valid while V2 consumers report unavailable without fallback', async () => {
    for (const explicitUnavailable of [false, true]) {
      const { root, store, activation } = await isolated(`phase1-${explicitUnavailable}`, [ids[0]!]);
      const original = await store.verifyBundle(ids[0]!);
      const manifest = structuredClone(original.manifest);
      const files = { ...original.files };
      delete files['trainingSemanticsV2.json'];
      delete manifest.projections.trainingSemanticsV2;
      delete manifest.build.builderVersions.trainingSemanticsV2;
      if (explicitUnavailable) manifest.projections.trainingSemanticsV2 = { status: 'unavailable', reason: 'phase1' };
      manifest.projectionBundleId = bundleId(manifest);
      const report = validateBundle(manifest, files);
      const directory = path.join(root, 'bundles', manifest.projectionBundleId.slice(7));
      await mkdir(directory);
      for (const [file, raw] of Object.entries(files)) await writeFile(path.join(directory, file), raw);
      await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
      await writeFile(path.join(directory, 'validation-report.json'), JSON.stringify(report));
      await activation.activate(manifest.projectionBundleId, { actor, reason: 'Phase 1 compatibility' });
      const manager = new RuntimeProjectionManager(store);
      await manager.reconcile();
      expect(manager.current()?.trainingSemantics.schemaVersion).toBe('1');
      expect(manager.current()?.trainingSemanticsV2).toBeNull();
      expect(manager.status()).toMatchObject({ reloadState: 'READY', readiness: { trainingSemantics: 'READY', trainingSemanticsV2: 'UNAVAILABLE' } });
      const training = new RuntimeTrainingSemanticV2Reader(manager);
      const product = new RuntimeProductSemanticReader(manager);
      const app = await buildApp({ service: { searchProducts: vi.fn(), getProduct: vi.fn(), batchGetProducts: vi.fn() } as never,
        repository: createRepositoryStub(), projectionRuntimeManager: manager,
        trainingSemanticReadService: new DefaultTrainingSemanticReadService(training),
        trainingSemanticQueryService: new DefaultTrainingSemanticQueryService(training),
        semanticDiscoveryService: new DefaultSemanticDiscoveryService(product, training),
        catalogAuthoritySnapshot: () => getCatalogAuthoritySnapshot({ projectionRuntimeManager: manager, productSemanticReader: product,
          trainingSemanticSnapshotV2Reader: training, relationshipSnapshotReader: { getActiveSnapshotMetadata: () => null } as never,
          serviceBuildRef: 'phase1-test', getCommercialV2Status: async () => 'READY' }),
        readyCheck: async () => ({ database: 'ok', redis: 'ok' }) });
      try {
        const headers = { 'x-api-key': 'test-api-key' };
        expect((await app.inject({ method: 'GET', url: '/v1/products/102/training-semantics', headers })).statusCode).toBe(503);
        const payload = { requirements: [{ axis: 'EXERCISE_CAPABILITY', codes: ['LEG_PRESS'], mode: 'required', match: 'any' }] };
        for (const url of ['/v1/products/training-semantics/query', '/v1/products/semantic-discovery/query']) {
          expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(503);
        }
        const productOnly = await app.inject({ method: 'POST', url: '/v1/products/semantic-discovery/query', headers,
          payload: { requirements: [{ axis: 'PRODUCT_FAMILY', codes: ['BENCH'], mode: 'required', match: 'any' }] } });
        expect(productOnly.statusCode).toBe(200);
        expect((await app.inject({ method: 'GET', url: '/health/catalog-authority' })).json().authorities.trainingSemanticsV2)
          .toMatchObject({ status: 'UNAVAILABLE', authority: 'cat-v2-training-semantics-v2', migrationStatus: 'COMPLETE',
            snapshotId: null, projectionId: null, projectionBundleId: null, activationId: null });
        expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
      } finally { await app.close(); }
    }
  }, 30000);

  it('rejects invalid V2 content, registry, rules and V1 lineage even with recomputed container hashes', async () => {
    const { store } = await isolated('v2-validation', [ids[0]!]);
    const original = await store.verifyBundle(ids[0]!);
    const change = (mutate: (projection: TrainingSemanticsV2Projection) => void, expectedError: string) => {
      const manifest = structuredClone(original.manifest), files = { ...original.files };
      const projection = JSON.parse(files['trainingSemanticsV2.json']!) as TrainingSemanticsV2Projection;
      mutate(projection);
      const raw = `${canonicalJson(projection)}\n`;
      files['trainingSemanticsV2.json'] = raw;
      const entry = manifest.projections.trainingSemanticsV2!;
      if (entry.status !== 'present') throw new Error('fixture must contain V2');
      entry.contentHash = contentHash(raw); entry.snapshotId = semanticHash(projection);
      manifest.projectionBundleId = bundleId(manifest);
      expect(() => validateBundle(manifest, files)).toThrow(expectedError);
    };
    change((p) => { p.snapshot.registryHash = '0'.repeat(64); }, 'registry hash mismatch');
    change((p) => { (p.snapshot as unknown as Record<string, unknown>).registryVersion = 'training-semantic-registry-v3'; }, 'INVALID_PROJECTION_SCHEMA');
    change((p) => { p.snapshot.classifierV2RulesHash = '0'.repeat(64); }, 'rules hash mismatch');
    change((p) => { p.snapshot.counts.resolvedCount!++; }, 'counts are inconsistent');
    change((p) => { p.snapshot.sourceV1SnapshotId = `sha256:${'0'.repeat(64)}`;
      Object.assign(p.snapshot, recomputeTrainingSemanticSnapshotV2Identity(p.snapshot)); }, 'snapshot link mismatch');
    change((p) => { p.sourceExtractionId = `sha256:${'0'.repeat(64)}`; }, 'SOURCE_LINEAGE_INVALID');
    change((p) => { p.codeRef = 'wrong-code'; }, 'SOURCE_LINEAGE_INVALID');
    const files = { ...original.files }; delete files['trainingSemanticsV2.json'];
    expect(() => validateBundle(original.manifest, files)).toThrow('missing trainingSemanticsV2.json');
    const unsupported = structuredClone(original.manifest);
    (unsupported.projections.trainingSemanticsV2 as unknown as Record<string, unknown>).schemaVersion = '3';
    expect(() => validateBundle(unsupported, original.files)).toThrow('INVALID_BUNDLE_MANIFEST');
    // B2 has a V1 ROW assignment. Altering its evidence must not pass the preserved-assignment gate.
    const b2 = await isolated('v1-assignment-validation', [ids[1]!]);
    const bundle = await b2.store.verifyBundle(ids[1]!);
    const manifest: BundleManifest = structuredClone(bundle.manifest), alteredFiles = { ...bundle.files };
    const projection = JSON.parse(alteredFiles['trainingSemanticsV2.json']!) as TrainingSemanticsV2Projection;
    projection.snapshot.records.find((record) => record.productId === 102)!.exerciseCapabilities[0]!.evidence[0]!.matchedText = 'altered evidence';
    Object.assign(projection.snapshot, recomputeTrainingSemanticSnapshotV2Identity(projection.snapshot));
    alteredFiles['trainingSemanticsV2.json'] = `${canonicalJson(projection)}\n`;
    if (manifest.projections.trainingSemanticsV2?.status !== 'present') throw new Error('fixture');
    manifest.projections.trainingSemanticsV2.contentHash = contentHash(alteredFiles['trainingSemanticsV2.json']);
    manifest.projections.trainingSemanticsV2.snapshotId = semanticHash(projection);
    manifest.projectionBundleId = bundleId(manifest);
    expect(() => validateBundle(manifest, alteredFiles)).toThrow('V1 projection drift');
  }, 30000);
});
