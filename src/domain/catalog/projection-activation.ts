import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BundleError, bundleManifestSchema, validateBundle, type BundleManifest } from './projection-bundle.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const actor = z.object({ type: z.enum(['manual', 'automation']), identity: z.string().min(1).max(120) }).strict();
export const activePointerSchema = z.object({ schemaVersion: z.literal('1'), activeProjectionBundleId: hash,
  activatedAt: z.string().datetime(), activationId: z.string().uuid(), previousProjectionBundleId: hash.nullable(),
  previousActivationId: z.string().uuid().nullable(), actor, reason: z.string().min(1).max(500), bundleManifestHash: hash }).strict();
export type ActivePointer = z.infer<typeof activePointerSchema>;
export const activationRecordSchema = activePointerSchema.extend({ from: hash.nullable(), to: hash,
  candidateValidation: z.object({ status: z.literal('PASS') }).strict() }).strict();
export type ActivationRecord = z.infer<typeof activationRecordSchema>;
export interface VerifiedBundle { manifest: BundleManifest; manifestHash: string; files: Record<string, string> }
export interface ActivationStore {
  verifyBundle(id: string): Promise<VerifiedBundle>;
  readActivePointer(): Promise<ActivePointer | null>;
  readHistory(id: string): Promise<ActivationRecord>;
  promote(expectedActivationId: string | null, next: ActivePointer, record: ActivationRecord): Promise<void>;
}
export const runtimeCompatibility = { bundleManifestSchemas: ['1'], projections: {
  productSemantics: ['1'], trainingSemantics: ['1'], trainingSemanticsV2: ['2'], specs: ['1'], trustMaps: ['1'], relationships: [], capabilities: [],
} } as const;

export class ActivationService {
  constructor(private readonly store: ActivationStore) {}

  async candidate(id: string) {
    if (!hash.safeParse(id).success) throw new BundleError('BUNDLE_NOT_FOUND', 'invalid bundle id');
    const bundle = await this.store.verifyBundle(id);
    if (bundle.manifest.projectionBundleId !== id) throw new BundleError('BUNDLE_INVALID', 'directory and manifest identities differ');
    if (!bundleManifestSchema.safeParse(bundle.manifest).success) throw new BundleError('BUNDLE_INVALID', 'unsupported manifest schema');
    if (bundle.manifest.validation.status !== 'TECHNICALLY_VALID') throw new BundleError('BUNDLE_NOT_TECHNICALLY_VALID', id);
    for (const name of ['productSemantics', 'trainingSemantics', 'specs', 'trustMaps'] as const)
      if (bundle.manifest.projections[name].status !== 'present') throw new BundleError('BUNDLE_RUNTIME_INCOMPATIBLE', `${name} is required`);
    for (const [name, entry] of Object.entries(bundle.manifest.projections)) {
      if (entry?.status === 'present' && !(runtimeCompatibility.projections[name as keyof typeof runtimeCompatibility.projections] as readonly string[]).includes(entry.schemaVersion))
        throw new BundleError('BUNDLE_RUNTIME_INCOMPATIBLE', `${name} schema ${entry.schemaVersion}`);
    }
    try { validateBundle(bundle.manifest, bundle.files); }
    catch (error) { throw new BundleError('BUNDLE_INVALID', String(error)); }
    return bundle;
  }

  async status(candidateId?: string) {
    const active = await this.store.readActivePointer();
    const history = await this.history(active);
    let candidate: { projectionBundleId: string; validation: 'PASS' | 'FAIL'; runtimeCompatible: boolean; error?: string } | undefined;
    if (candidateId) try { await this.candidate(candidateId); candidate = { projectionBundleId: candidateId, validation: 'PASS', runtimeCompatible: true }; }
    catch (error) { candidate = { projectionBundleId: candidateId, validation: 'FAIL', runtimeCompatible: false, error: String(error) }; }
    return { desiredProjectionBundleId: active?.activeProjectionBundleId ?? null, loadedProjectionBundleId: null,
      runtimeConsumption: 'PROCESS_LOCAL_NOT_OBSERVABLE_FROM_CLI' as const, active, previousActivation: history[1] ?? null, history, candidate };
  }

  async history(active?: ActivePointer | null) {
    const records: ActivationRecord[] = [];
    const seen = new Set<string>();
    let pointer = active === undefined ? await this.store.readActivePointer() : active;
    while (pointer) {
      if (seen.has(pointer.activationId)) throw new BundleError('HISTORY_CORRUPT', 'cycle');
      seen.add(pointer.activationId);
      const record = await this.store.readHistory(pointer.activationId);
      if (record.to !== pointer.activeProjectionBundleId || record.from !== pointer.previousProjectionBundleId || record.previousActivationId !== pointer.previousActivationId
        || record.bundleManifestHash !== pointer.bundleManifestHash || record.activatedAt !== pointer.activatedAt || record.reason !== pointer.reason
        || JSON.stringify(record.actor) !== JSON.stringify(pointer.actor))
        throw new BundleError('HISTORY_CORRUPT', 'history and pointer disagree');
      records.push(record);
      if (!record.previousActivationId) break;
      const prior = await this.store.readHistory(record.previousActivationId);
      if (prior.to !== record.from) throw new BundleError('HISTORY_CORRUPT', 'history chain disagrees');
      pointer = prior;
    }
    return records;
  }

  async activate(id: string, options: { expectedActiveBundleId?: string | null; actor: ActivePointer['actor']; reason: string }) {
    const current = await this.store.readActivePointer();
    if (options.expectedActiveBundleId !== undefined && options.expectedActiveBundleId !== (current?.activeProjectionBundleId ?? null))
      throw new BundleError('ACTIVATION_CONFLICT', 'expected active bundle differs');
    if (current?.activeProjectionBundleId === id) return { status: 'already_active' as const, projectionBundleId: id, active: current };
    const started = performance.now();
    const bundle = await this.candidate(id);
    const validationDurationMs = Math.round(performance.now() - started);
    const next = activePointerSchema.parse({ schemaVersion: '1', activeProjectionBundleId: id, activatedAt: new Date().toISOString(),
      activationId: randomUUID(), previousProjectionBundleId: current?.activeProjectionBundleId ?? null,
      previousActivationId: current?.activationId ?? null, actor: options.actor, reason: options.reason, bundleManifestHash: bundle.manifestHash });
    const record = activationRecordSchema.parse({ ...next, from: next.previousProjectionBundleId, to: id, candidateValidation: { status: 'PASS' } });
    await this.store.promote(current?.activationId ?? null, next, record);
    return { status: 'activated' as const, projectionBundleId: id, active: next, validationDurationMs, totalDurationMs: Math.round(performance.now() - started) };
  }

  async rollback(options: { to?: string; actor: ActivePointer['actor']; expectedActiveBundleId?: string | null }) {
    const current = await this.store.readActivePointer();
    if (!current) throw new BundleError('NO_ROLLBACK_TARGET', 'no activation exists');
    const history = await this.history(current);
    const target = options.to ?? history[0]?.from;
    if (!target || !history.some((record) => record.from === target || record.to === target)) throw new BundleError('NO_ROLLBACK_TARGET', 'target is absent from committed history');
    try { return await this.activate(target, { actor: options.actor, reason: 'rollback', expectedActiveBundleId: options.expectedActiveBundleId ?? current.activeProjectionBundleId }); }
    catch (error) {
      if (error instanceof BundleError && ['BUNDLE_NOT_FOUND', 'BUNDLE_INVALID', 'BUNDLE_RUNTIME_INCOMPATIBLE'].includes(error.code))
        throw new BundleError('ROLLBACK_TARGET_INVALID', error.message);
      throw error;
    }
  }
}
