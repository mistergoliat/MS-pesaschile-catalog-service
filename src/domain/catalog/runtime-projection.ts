import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { deepFreeze } from '../product-semantic-snapshot/canonicalJson.js';
import { DefaultProductSemanticRuntimeIndexBuilder, type ProductSemanticRuntimeIndex } from '../product-semantic-snapshot/runtime/index.js';
import type { TrainingSemanticSnapshot } from '../training-semantic-snapshot/contracts.js';
import type { TrainingSemanticsV2Projection } from './training-semantics-v2-projection.js';
import { BundleError, type BundleManifest, type SpecsArtifact } from './projection-bundle.js';
import { ActivationService, type ActivePointer, type ActivationStore } from './projection-activation.js';

export type RuntimeProjectionState = Readonly<{
  projectionBundleId: string;
  activationId: string;
  loadedAt: string;
  manifest: BundleManifest;
  productSemantics: ProductSemanticRuntimeIndex;
  trainingSemantics: TrainingSemanticSnapshot;
  trainingSemanticsV2: TrainingSemanticsV2Projection | null;
  specs: SpecsArtifact;
  trustMaps: Readonly<{ schemaVersion: '1'; sourceExtractionId: string; categoryHash: string; featureHash: string }>;
  relationships: { status: 'unavailable'; reason: string };
  capabilities: { status: 'unavailable'; reason: string };
}>;
export type ReloadState = 'NO_ACTIVE_BUNDLE' | 'CONTROL_PLANE_INVALID' | 'LOADING' | 'READY' | 'FAILED';
export type ProjectionCapabilityState = 'READY' | 'DEGRADED' | 'UNAVAILABLE';
export type RuntimeProjectionStatus = {
  desiredProjectionBundleId: string | null;
  desiredActivationId: string | null;
  loadedProjectionBundleId: string | null;
  loadedActivationId: string | null;
  loadedAt: string | null;
  reloadState: ReloadState;
  lastReloadAttemptAt: string | null;
  lastReloadError: { code: string; message: string; retryable: boolean } | null;
  readiness: Record<'projectionRuntime' | 'productSemantics' | 'trainingSemantics' | 'trainingSemanticsV2' | 'specs' | 'trustMaps' | 'relationships' | 'capabilities', ProjectionCapabilityState>;
  lastAttemptMetrics: { validationMs: number; constructionMs: number; swapMs: number; totalMs: number; artifactBytes: number; heapBefore: number; heapCandidate: number; heapAfter: number; rssBefore: number; rssCandidate: number; rssAfter: number } | null;
};
type AttemptEvent = { activationId: string; desiredBundleId: string; loadedBundleIdBefore: string | null; loadedBundleIdAfter: string | null;
  result: 'READY' | 'FAILED' | 'STALE_RELOAD'; failureClass?: string; metrics?: RuntimeProjectionStatus['lastAttemptMetrics'] };

export class RuntimeProjectionManager {
  private readonly activation: ActivationService;
  private readonly requestState = new AsyncLocalStorage<RuntimeProjectionState | null>();
  private loaded: RuntimeProjectionState | null = null;
  private desired: ActivePointer | null = null;
  private reloadState: ReloadState = 'NO_ACTIVE_BUNDLE';
  private lastReloadAttemptAt: string | null = null;
  private lastReloadError: RuntimeProjectionStatus['lastReloadError'] = null;
  private lastAttemptMetrics: RuntimeProjectionStatus['lastAttemptMetrics'] = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private pending = false;
  private nextRetryAt = 0;
  private failures = 0;
  private failedActivationId: string | null = null;
  constructor(private readonly store: ActivationStore, private readonly options: {
    pollIntervalMs?: number; retryBaseMs?: number; retryMaxMs?: number;
    onAttempt?: (event: AttemptEvent) => void;
    load?: (pointer: ActivePointer) => Promise<RuntimeProjectionState>;
  } = {}) { this.activation = new ActivationService(store); }

  current() { return this.loaded; }
  forRequest() { const captured = this.requestState.getStore(); return captured === undefined ? this.loaded : captured; }
  captureRequest() { this.requestState.enterWith(this.loaded); }
  withCapturedState<T>(work: () => Promise<T> | T): Promise<T> | T { return this.requestState.run(this.loaded, work); }

  status(): RuntimeProjectionStatus {
    const hasState = this.loaded !== null;
    const converged = hasState && this.loaded!.activationId === this.desired?.activationId;
    return { desiredProjectionBundleId: this.desired?.activeProjectionBundleId ?? null, desiredActivationId: this.desired?.activationId ?? null,
      loadedProjectionBundleId: this.loaded?.projectionBundleId ?? null, loadedActivationId: this.loaded?.activationId ?? null,
      loadedAt: this.loaded?.loadedAt ?? null, reloadState: this.reloadState, lastReloadAttemptAt: this.lastReloadAttemptAt,
      lastReloadError: this.lastReloadError,
      readiness: { projectionRuntime: converged ? 'READY' : hasState ? 'DEGRADED' : 'UNAVAILABLE',
        productSemantics: hasState ? 'READY' : 'UNAVAILABLE', trainingSemantics: hasState ? 'READY' : 'UNAVAILABLE',
        trainingSemanticsV2: this.loaded?.trainingSemanticsV2 ? 'READY' : 'UNAVAILABLE',
        specs: hasState ? 'READY' : 'UNAVAILABLE', trustMaps: hasState ? 'READY' : 'UNAVAILABLE',
        relationships: 'UNAVAILABLE', capabilities: 'UNAVAILABLE' }, lastAttemptMetrics: this.lastAttemptMetrics };
  }

  async start() {
    await this.reconcile();
    if (!this.timer) {
      const pollMs = this.options.pollIntervalMs ?? 1000;
      if (!Number.isFinite(pollMs) || pollMs < 100) throw new Error('INVALID_PROJECTION_POLL_INTERVAL');
      this.timer = setInterval(() => { void this.reconcile(); }, pollMs);
      this.timer.unref();
    }
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  reconcile(): Promise<void> {
    if (this.inFlight) { this.pending = true; return this.inFlight; }
    this.inFlight = this.run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async run() {
    do {
      this.pending = false;
      let pointer: ActivePointer | null;
      try { pointer = await this.store.readActivePointer(); }
      catch (error) { this.fail('CONTROL_PLANE_INVALID', error); return; }
      this.desired = pointer;
      if (!pointer) { this.reloadState = this.loaded ? 'FAILED' : 'NO_ACTIVE_BUNDLE'; return; }
      if (this.loaded?.activationId === pointer.activationId) { this.reloadState = 'READY'; this.lastReloadError = null; return; }
      if (this.loaded?.projectionBundleId === pointer.activeProjectionBundleId) {
        this.loaded = Object.freeze({ ...this.loaded, activationId: pointer.activationId, loadedAt: new Date().toISOString() });
        this.reloadState = 'READY'; this.lastReloadError = null; return;
      }
      if (this.failedActivationId === pointer.activationId && Date.now() < this.nextRetryAt) return;
      if (this.failedActivationId !== pointer.activationId) this.failures = 0;
      this.reloadState = 'LOADING';
      this.lastReloadAttemptAt = new Date().toISOString();
      const before = this.loaded?.projectionBundleId ?? null;
      const started = performance.now();
      const memoryBefore = process.memoryUsage();
      try {
        const candidate = await (this.options.load?.(pointer) ?? this.load(pointer));
        if (candidate.projectionBundleId !== pointer.activeProjectionBundleId || candidate.activationId !== pointer.activationId)
          throw new BundleError('RUNTIME_BUNDLE_INVALID', 'candidate identity differs from desired activation');
        const latest = await this.store.readActivePointer();
        this.desired = latest;
        if (latest?.activationId !== pointer.activationId) {
          this.options.onAttempt?.({ activationId: pointer.activationId, desiredBundleId: pointer.activeProjectionBundleId,
            loadedBundleIdBefore: before, loadedBundleIdAfter: before, result: 'STALE_RELOAD' });
          this.pending = true;
          continue;
        }
        const swapStarted = performance.now();
        this.loaded = candidate;
        const swapMs = performance.now() - swapStarted;
        this.reloadState = 'READY'; this.lastReloadError = null; this.failures = 0; this.nextRetryAt = 0; this.failedActivationId = null;
        this.lastAttemptMetrics = { ...(this.lastAttemptMetrics ?? { validationMs: 0, constructionMs: 0, artifactBytes: 0,
          heapBefore: 0, heapCandidate: 0, heapAfter: 0, rssBefore: 0, rssCandidate: 0, rssAfter: 0 }),
          swapMs, totalMs: performance.now() - started, heapAfter: process.memoryUsage().heapUsed, rssAfter: process.memoryUsage().rss };
        this.options.onAttempt?.({ activationId: pointer.activationId, desiredBundleId: pointer.activeProjectionBundleId,
          loadedBundleIdBefore: before, loadedBundleIdAfter: candidate.projectionBundleId, result: 'READY', metrics: this.lastAttemptMetrics });
      } catch (error) {
        try {
          const latest = await this.store.readActivePointer();
          if (latest?.activationId !== pointer.activationId) {
            this.desired = latest;
            this.options.onAttempt?.({ activationId: pointer.activationId, desiredBundleId: pointer.activeProjectionBundleId,
              loadedBundleIdBefore: before, loadedBundleIdAfter: before, result: 'STALE_RELOAD' });
            this.pending = true;
            continue;
          }
        } catch { /* Preserve the last loaded state and report the load failure below. */ }
        this.fail('FAILED', error);
        this.failedActivationId = pointer.activationId;
        this.failures += 1;
        this.nextRetryAt = this.lastReloadError?.retryable
          ? Date.now() + Math.min(this.options.retryMaxMs ?? 30000, (this.options.retryBaseMs ?? 1000) * 2 ** Math.min(this.failures - 1, 10))
          : Number.POSITIVE_INFINITY;
        const memory = process.memoryUsage();
        this.lastAttemptMetrics = { validationMs: performance.now() - started, constructionMs: 0, swapMs: 0,
          totalMs: performance.now() - started, artifactBytes: 0, heapBefore: memoryBefore.heapUsed,
          heapCandidate: memory.heapUsed, heapAfter: memory.heapUsed, rssBefore: memoryBefore.rss,
          rssCandidate: memory.rss, rssAfter: memory.rss };
        this.options.onAttempt?.({ activationId: pointer.activationId, desiredBundleId: pointer.activeProjectionBundleId,
          loadedBundleIdBefore: before, loadedBundleIdAfter: before, result: 'FAILED', failureClass: this.lastReloadError?.code,
          metrics: this.lastAttemptMetrics });
      }
    } while (this.pending);
  }

  private fail(state: ReloadState, error: unknown) {
    this.reloadState = state;
    const code = error instanceof BundleError ? error.code : 'RUNTIME_LOAD_FAILED';
    this.lastReloadError = { code, message: String(error), retryable: !['BUNDLE_RUNTIME_INCOMPATIBLE', 'ACTIVE_POINTER_INVALID'].includes(code) };
  }

  private async load(pointer: ActivePointer): Promise<RuntimeProjectionState> {
    const heapBefore = process.memoryUsage();
    const started = performance.now();
    const bundle = await this.activation.candidate(pointer.activeProjectionBundleId);
    if (bundle.manifestHash !== pointer.bundleManifestHash) throw new BundleError('RUNTIME_BUNDLE_INVALID', 'manifest changed after activation');
    const validationMs = performance.now() - started;
    const manifest = bundle.manifest;
    const get = (name: 'productSemantics' | 'trainingSemantics' | 'specs' | 'trustMaps') => {
      const entry = manifest.projections[name];
      if (entry.status !== 'present') throw new BundleError('RUNTIME_BUNDLE_INCOMPATIBLE', `${name} unavailable`);
      return JSON.parse(bundle.files[entry.artifact]!) as Record<string, unknown>;
    };
    const product = get('productSemantics');
    const training = get('trainingSemantics');
    const trainingV2Entry = manifest.projections.trainingSemanticsV2;
    const trainingSemanticsV2 = trainingV2Entry?.status === 'present'
      ? deepFreeze(JSON.parse(bundle.files[trainingV2Entry.artifact]!) as TrainingSemanticsV2Projection) : null;
    const productSemantics = new DefaultProductSemanticRuntimeIndexBuilder().build(product.snapshot as Parameters<DefaultProductSemanticRuntimeIndexBuilder['build']>[0]);
    const state: RuntimeProjectionState = Object.freeze({ projectionBundleId: pointer.activeProjectionBundleId, activationId: pointer.activationId,
      loadedAt: new Date().toISOString(), manifest: deepFreeze(manifest), productSemantics,
      trainingSemantics: deepFreeze(training.snapshot as TrainingSemanticSnapshot), specs: deepFreeze(get('specs') as SpecsArtifact),
      trainingSemanticsV2,
      trustMaps: deepFreeze(get('trustMaps') as RuntimeProjectionState['trustMaps']),
      relationships: deepFreeze(manifest.projections.relationships as RuntimeProjectionState['relationships']),
      capabilities: deepFreeze(manifest.projections.capabilities as RuntimeProjectionState['capabilities']) });
    const candidateMemory = process.memoryUsage();
    this.lastAttemptMetrics = { validationMs, constructionMs: performance.now() - started - validationMs, swapMs: 0, totalMs: 0,
      artifactBytes: Object.values(bundle.files).reduce((sum, file) => sum + Buffer.byteLength(file), 0),
      heapBefore: heapBefore.heapUsed, heapCandidate: candidateMemory.heapUsed, heapAfter: 0,
      rssBefore: heapBefore.rss, rssCandidate: candidateMemory.rss, rssAfter: 0 };
    return state;
  }
}
