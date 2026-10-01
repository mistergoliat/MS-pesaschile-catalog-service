import type { ActiveProductSemanticSnapshotReader, ProductSemanticActiveSnapshotMetadata } from '../product-semantic-snapshot/runtime/index.js';
import { ProductSemanticRuntimeError } from '../product-semantic-snapshot/runtime/index.js';
import type { RuntimeProjectionManager } from './runtime-projection.js';

export class RuntimeProductSemanticReader implements ActiveProductSemanticSnapshotReader {
  constructor(private readonly manager: RuntimeProjectionManager, private readonly legacy?: ActiveProductSemanticSnapshotReader) {}
  private index() { return this.manager.forRequest()?.productSemantics ?? null; }
  private fallback() { return this.manager.status().desiredProjectionBundleId === null ? this.legacy : undefined; }
  async refresh() { return this.fallback()?.refresh() ?? { status: 'unchanged' as const, previousSnapshotId: this.index()?.snapshotId ?? null,
    activeSnapshotId: this.index()?.snapshotId ?? null, statistics: { recordsRead: this.index()?.recordCount ?? 0,
      indexedProducts: this.index()?.recordCount ?? 0, snapshotChanged: false } }; }
  getActiveSnapshotMetadata(): ProductSemanticActiveSnapshotMetadata | null {
    const index = this.index();
    if (!index) return this.fallback()?.getActiveSnapshotMetadata() ?? null;
    const { factsByProductId: _map, facts: _facts, ...metadata } = index;
    return metadata;
  }
  getStatus() {
    const metadata = this.getActiveSnapshotMetadata();
    return metadata ? { state: 'ready' as const, ...metadata } : { state: 'not_loaded' as const };
  }
  hasProduct(productId: string) { return this.index()?.factsByProductId.has(productId) ?? this.fallback()?.hasProduct(productId) ?? false; }
  getProductSemanticFact(productId: string) {
    if (typeof productId !== 'string' || !productId.trim()) throw new ProductSemanticRuntimeError('INVALID_RUNTIME_QUERY', 'productId must be a non-empty string');
    const index = this.index();
    if (index) return index.factsByProductId.get(productId) ?? null;
    if (this.fallback()) return this.fallback()!.getProductSemanticFact(productId);
    throw new ProductSemanticRuntimeError('RUNTIME_SNAPSHOT_NOT_LOADED', 'Projection runtime has no product semantics');
  }
  getAllProductSemanticFacts() {
    const index = this.index();
    if (index) return index.facts;
    if (this.fallback()) return this.fallback()!.getAllProductSemanticFacts();
    throw new ProductSemanticRuntimeError('RUNTIME_SNAPSHOT_NOT_LOADED', 'Projection runtime has no product semantics');
  }
}
