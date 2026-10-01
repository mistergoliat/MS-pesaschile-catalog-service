import { open, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { BundleError, bundleManifestSchema, type BundleManifest } from '../../domain/catalog/projection-bundle.js';
import { canonicalContent, contentHash, type CanonicalExtraction } from '../../domain/catalog/projection-input/canonical.js';
import { activePointerSchema, activationRecordSchema, type ActivationRecord, type ActivationStore, type ActivePointer, type VerifiedBundle } from '../../domain/catalog/projection-activation.js';

async function readJson(file: string, code: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new BundleError(code, `${file}: ${String(error)}`); }
}
async function durableWrite(file: string, value: unknown) {
  const handle = await open(file, 'wx');
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
function isMissing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
export class FileProjectionActivationStore implements ActivationStore {
  constructor(readonly root = path.resolve('artifacts/catalog-v2'), readonly sourceRoots = [path.resolve('artifacts/catalog-projection-input'), path.resolve('artifacts/catalog-v2/replay-source')]) {}
  private get control() { return path.join(this.root, 'control'); }
  private bundlePath(id: string) { return path.join(this.root, 'bundles', id.slice(7)); }

  async verifyBundle(id: string): Promise<VerifiedBundle> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(id)) throw new BundleError('BUNDLE_NOT_FOUND', 'invalid id');
    const dir = this.bundlePath(id);
    try { if (!(await stat(dir)).isDirectory()) throw new Error('not a directory'); }
    catch (error) { throw new BundleError('BUNDLE_NOT_FOUND', `${id}: ${String(error)}`); }
    const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8').catch((error: unknown) => { throw new BundleError('BUNDLE_INVALID', String(error)); });
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new BundleError('BUNDLE_INVALID', 'manifest JSON'); }
    if (value && typeof value === 'object' && 'projections' in value && value.projections && typeof value.projections === 'object')
      for (const [name, projection] of Object.entries(value.projections))
        if (projection && typeof projection === 'object' && 'status' in projection && projection.status === 'present'
          && 'schemaVersion' in projection && projection.schemaVersion !== '1')
          throw new BundleError('BUNDLE_RUNTIME_INCOMPATIBLE', `${name} schema ${String(projection.schemaVersion)}`);
    const parsed = bundleManifestSchema.safeParse(value);
    if (!parsed.success) throw new BundleError('BUNDLE_INVALID', parsed.error.message);
    const manifest: BundleManifest = parsed.data;
    if (manifest.projectionBundleId !== id) throw new BundleError('BUNDLE_INVALID', 'manifest ID differs from directory');
    const report = await readJson(path.join(dir, 'validation-report.json'), 'BUNDLE_NOT_TECHNICALLY_VALID') as { status?: string; projectionBundleId?: string };
    if (report.status !== 'PASS' || report.projectionBundleId !== id) throw new BundleError('BUNDLE_NOT_TECHNICALLY_VALID', 'validation report is not PASS');
    const files: Record<string, string> = {};
    for (const projection of Object.values(manifest.projections)) if (projection.status === 'present') {
      try { files[projection.artifact] = await readFile(path.join(dir, projection.artifact), 'utf8'); }
      catch (error) { throw new BundleError('BUNDLE_INVALID', String(error)); }
    }
    const source = await this.findSource(manifest.source.sourceExtractionId);
    return { manifest, manifestHash: contentHash(raw), files, source };
  }

  private async findSource(id: string): Promise<CanonicalExtraction> {
    for (const root of this.sourceRoots) {
      const dirs = [root];
      try { for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isDirectory()) dirs.push(path.join(root, entry.name)); }
      catch (error) { if (!isMissing(error)) throw error; }
      for (const dir of dirs) {
        try {
          const raw = await readFile(path.join(dir, 'canonical_input.json'), 'utf8');
          if (contentHash(raw) !== id) continue;
          const source = JSON.parse(raw) as CanonicalExtraction;
          if (raw !== canonicalContent(source)) throw new BundleError('BUNDLE_INVALID', 'source is not canonical');
          return source;
        } catch (error) { if (!isMissing(error)) throw error; }
      }
    }
    throw new BundleError('BUNDLE_INVALID', `verified canonical source ${id} unavailable`);
  }

  async readActivePointer(): Promise<ActivePointer | null> {
    let value: unknown;
    let raw: string;
    try { raw = await readFile(path.join(this.control, 'active.json'), 'utf8'); }
    catch (error) { if (isMissing(error)) return null; throw new BundleError('ACTIVE_POINTER_CORRUPT', String(error)); }
    try { value = JSON.parse(raw); }
    catch { throw new BundleError('ACTIVE_POINTER_CORRUPT', 'invalid JSON'); }
    const parsed = activePointerSchema.safeParse(value);
    if (!parsed.success) throw new BundleError('ACTIVE_POINTER_INVALID', parsed.error.message);
    const pointer = parsed.data;
    if ((pointer.previousActivationId === null) !== (pointer.previousProjectionBundleId === null))
      throw new BundleError('ACTIVE_POINTER_INVALID', 'previous activation and bundle must agree');
    const manifestFile = path.join(this.bundlePath(pointer.activeProjectionBundleId), 'manifest.json');
    let manifestRaw: string;
    try { manifestRaw = await readFile(manifestFile, 'utf8'); }
    catch (error) { throw new BundleError('ACTIVE_POINTER_CORRUPT', String(error)); }
    if (contentHash(manifestRaw) !== pointer.bundleManifestHash) throw new BundleError('ACTIVE_POINTER_CORRUPT', 'manifest hash differs');
    try { if (bundleManifestSchema.parse(JSON.parse(manifestRaw)).projectionBundleId !== pointer.activeProjectionBundleId) throw new Error('bundle ID differs'); }
    catch (error) { throw new BundleError('ACTIVE_POINTER_CORRUPT', String(error)); }
    return pointer;
  }

  async readHistory(id: string): Promise<ActivationRecord> {
    if (!/^[0-9a-f-]{36}$/u.test(id)) throw new BundleError('HISTORY_CORRUPT', 'invalid activation ID');
    const value = await readJson(path.join(this.control, 'history', `${id}.json`), 'HISTORY_CORRUPT');
    const parsed = activationRecordSchema.safeParse(value);
    if (!parsed.success || parsed.data.activationId !== id || parsed.data.from !== parsed.data.previousProjectionBundleId
      || parsed.data.to !== parsed.data.activeProjectionBundleId) throw new BundleError('HISTORY_CORRUPT', 'invalid record');
    return parsed.data;
  }

  async promote(expectedActivationId: string | null, next: ActivePointer, record: ActivationRecord) {
    await mkdir(this.control, { recursive: true });
    const lock = path.join(this.control, '.activation-lock');
    const start = Date.now();
    for (;;) {
      try { await mkdir(lock); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new BundleError('CONTROL_PLANE_WRITE_FAILED', String(error));
        if (Date.now() - start > 10000) throw new BundleError('ACTIVATION_CONFLICT', 'activation lock busy');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      const current = await this.readActivePointer();
      if ((current?.activationId ?? null) !== expectedActivationId) throw new BundleError('ACTIVATION_CONFLICT', 'active pointer changed');
      await mkdir(path.join(this.control, 'history'), { recursive: true });
      await durableWrite(path.join(this.control, 'history', `${record.activationId}.json`), record);
      const temp = path.join(this.control, `.active-${record.activationId}.tmp`);
      try { await durableWrite(temp, next); await rename(temp, path.join(this.control, 'active.json')); }
      finally { await rm(temp, { force: true }); }
    } catch (error) {
      if (error instanceof BundleError) throw error;
      throw new BundleError('CONTROL_PLANE_WRITE_FAILED', String(error));
    } finally { await rm(lock, { recursive: true, force: true }); }
  }
}
