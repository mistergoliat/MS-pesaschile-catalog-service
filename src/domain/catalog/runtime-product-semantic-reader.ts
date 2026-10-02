import type { ActiveProductSemanticSnapshotReader, ProductSemanticActiveSnapshotMetadata } from '../product-semantic-snapshot/runtime/index.js';
import { ProductSemanticRuntimeError } from '../product-semantic-snapshot/runtime/index.js';
import type { RuntimeProjectionManager } from './runtime-projection.js';
import { productSemanticLegacyFallbackTotal } from '../../shared/metrics.js';
import type { ProductSemanticSnapshotFact } from '../product-semantic-snapshot/contracts.js';
import type { AuthorityValue } from './runtime-authority-contract.js';

export type ProductSemanticAuthorityStatus = {
  authority: string | null;
  status: 'READY' | 'UNAVAILABLE';
  fallbackEnabled: boolean;
  legacyFallbackReads: number;
};

export class RuntimeProductSemanticReader implements ActiveProductSemanticSnapshotReader {
  private legacyFallbackReads = 0;

  constructor(private readonly manager: RuntimeProjectionManager, private readonly legacy?: ActiveProductSemanticSnapshotReader) {}
  private index() { return this.manager.forRequest()?.productSemantics ?? null; }
  private fallbackReader() {
    if (this.manager.status().reloadState !== 'NO_ACTIVE_BUNDLE' || !this.legacy) return undefined;
    return this.legacy;
  }
  private fallback() {
    const reader = this.fallbackReader();
    if (!reader) return undefined;
    this.recordFallbackUse();
    return reader;
  }

  private recordFallbackUse() {
    this.legacyFallbackReads += 1;
    productSemanticLegacyFallbackTotal.inc();
  }

  /** Reports the effective process/request authority without counting metadata inspection as a fallback read. */
  getAuthorityStatus(): ProductSemanticAuthorityStatus {
    const index = this.index();
    if (index) {
      return { authority: 'cat-v2-product-semantics', status: 'READY', fallbackEnabled: this.legacy !== undefined,
        legacyFallbackReads: this.legacyFallbackReads };
    }
    if (this.manager.status().reloadState === 'NO_ACTIVE_BUNDLE' && this.legacy?.getActiveSnapshotMetadata()) {
      return { authority: 'legacy-product-semantic-snapshot', status: 'READY', fallbackEnabled: true,
        legacyFallbackReads: this.legacyFallbackReads };
    }
    return { authority: 'cat-v2-product-semantics', status: 'UNAVAILABLE', fallbackEnabled: this.legacy !== undefined,
      legacyFallbackReads: this.legacyFallbackReads };
  }

  /** Reads one product fact with the exact authority and lineage that supplied it. */
  readWithAuthority(productId: string): AuthorityValue<ProductSemanticSnapshotFact> {
    if (typeof productId !== 'string' || !productId.trim()) {
      throw new ProductSemanticRuntimeError('INVALID_RUNTIME_QUERY', 'productId must be a non-empty string');
    }
    const state = this.manager.forRequest();
    if (state) {
      const fact = state.productSemantics.factsByProductId.get(productId);
      const lineage = { projectionBundleId: state.projectionBundleId, activationId: state.activationId, loadedAt: state.loadedAt,
        snapshotId: state.productSemantics.snapshotId, schemaVersion: state.productSemantics.schemaVersion };
      return fact
        ? { status: 'available', authority: 'cat-v2-product-semantics', value: fact, fallbackUsed: false, lineage }
        : { status: 'unavailable', authority: 'cat-v2-product-semantics', reason: 'product_semantics_product_not_present', fallbackUsed: false, lineage };
    }

    const canFallback = this.manager.status().reloadState === 'NO_ACTIVE_BUNDLE' && this.legacy !== undefined;
    if (canFallback) {
      const metadata = this.legacy!.getActiveSnapshotMetadata();
      if (!metadata) {
        return { status: 'unavailable', authority: 'legacy-product-semantic-snapshot', reason: 'legacy_snapshot_unavailable', fallbackUsed: false };
      }
      this.recordFallbackUse();
      const value = this.legacy!.getProductSemanticFact(productId);
      const lineage = { snapshotId: metadata.snapshotId, schemaVersion: metadata.schemaVersion };
      return value
        ? { status: 'available', authority: 'legacy-product-semantic-snapshot', value, fallbackUsed: true, lineage }
        : { status: 'unavailable', authority: 'legacy-product-semantic-snapshot', reason: 'product_semantics_product_not_present', fallbackUsed: true, lineage };
    }

    const status = this.manager.status();
    return { status: 'unavailable', authority: 'cat-v2-product-semantics', reason: `projection_${status.reloadState.toLowerCase()}`,
      fallbackUsed: false };
  }

  async refresh() { return this.fallback()?.refresh() ?? { status: 'unchanged' as const, previousSnapshotId: this.index()?.snapshotId ?? null,
    activeSnapshotId: this.index()?.snapshotId ?? null, statistics: { recordsRead: this.index()?.recordCount ?? 0,
      indexedProducts: this.index()?.recordCount ?? 0, snapshotChanged: false } }; }
  getActiveSnapshotMetadata(): ProductSemanticActiveSnapshotMetadata | null {
    const index = this.index();
    if (!index) return this.fallbackReader()?.getActiveSnapshotMetadata() ?? null;
    const { factsByProductId: _map, facts: _facts, ...metadata } = index;
    return metadata;
  }
  getStatus() {
    const metadata = this.getActiveSnapshotMetadata();
    return metadata ? { state: 'ready' as const, ...metadata } : { state: 'not_loaded' as const };
  }
  hasProduct(productId: string) {
    const index = this.index();
    if (index) return index.factsByProductId.has(productId);
    return this.fallback()?.hasProduct(productId) ?? false;
  }
  getProductSemanticFact(productId: string) {
    if (typeof productId !== 'string' || !productId.trim()) throw new ProductSemanticRuntimeError('INVALID_RUNTIME_QUERY', 'productId must be a non-empty string');
    const index = this.index();
    if (index) return index.factsByProductId.get(productId) ?? null;
    const legacy = this.fallback();
    if (legacy) return legacy.getProductSemanticFact(productId);
    throw new ProductSemanticRuntimeError('RUNTIME_SNAPSHOT_NOT_LOADED', 'Projection runtime has no product semantics');
  }
  getAllProductSemanticFacts() {
    const index = this.index();
    if (index) return index.facts;
    const legacy = this.fallback();
    if (legacy) return legacy.getAllProductSemanticFacts();
    throw new ProductSemanticRuntimeError('RUNTIME_SNAPSHOT_NOT_LOADED', 'Projection runtime has no product semantics');
  }
}
