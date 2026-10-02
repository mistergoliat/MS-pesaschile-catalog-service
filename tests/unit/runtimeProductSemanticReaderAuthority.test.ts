import { describe, expect, it, vi } from 'vitest';
import { RuntimeProductSemanticReader } from '../../src/domain/catalog/runtime-product-semantic-reader.js';
import type { RuntimeProjectionManager, RuntimeProjectionState } from '../../src/domain/catalog/runtime-projection.js';
import type { ActiveProductSemanticSnapshotReader } from '../../src/domain/product-semantic-snapshot/runtime/contracts.js';

const fact = { productId: '10', marker: 'semantics' } as never;
const metadata = { snapshotId: 'legacy-product-snapshot', schemaVersion: '1' } as never;

function manager(state: RuntimeProjectionState | null, reloadState: string) {
  return {
    forRequest: () => state,
    status: () => ({ reloadState }),
  } as unknown as RuntimeProjectionManager;
}

describe('RuntimeProductSemanticReader authority metadata', () => {
  it('identifies CAT-V2 and its bundle lineage when a runtime state is captured', () => {
    const state = {
      projectionBundleId: 'sha256:bundle',
      activationId: 'activation-b2',
      loadedAt: '2026-10-01T12:00:00.000Z',
      productSemantics: { snapshotId: 'product-snapshot-b2', schemaVersion: '1', factsByProductId: new Map([['10', fact]]) },
    } as unknown as RuntimeProjectionState;
    const legacy = { getActiveSnapshotMetadata: vi.fn(() => metadata), getProductSemanticFact: vi.fn(() => fact) } as unknown as ActiveProductSemanticSnapshotReader;
    const reader = new RuntimeProductSemanticReader(manager(state, 'READY'), legacy);
    expect(reader.readWithAuthority('10')).toMatchObject({
      status: 'available', authority: 'cat-v2-product-semantics', fallbackUsed: false,
      lineage: { projectionBundleId: 'sha256:bundle', activationId: 'activation-b2', loadedAt: '2026-10-01T12:00:00.000Z' },
    });
    expect(legacy.getProductSemanticFact).not.toHaveBeenCalled();
    expect(reader.getAuthorityStatus()).toMatchObject({ authority: 'cat-v2-product-semantics', status: 'READY', fallbackEnabled: true });
  });

  it('marks the allowed no-bundle fallback as legacy and counts it', () => {
    const legacy = { getActiveSnapshotMetadata: vi.fn(() => metadata), getProductSemanticFact: vi.fn(() => fact) } as unknown as ActiveProductSemanticSnapshotReader;
    const reader = new RuntimeProductSemanticReader(manager(null, 'NO_ACTIVE_BUNDLE'), legacy);
    expect(reader.readWithAuthority('10')).toMatchObject({
      status: 'available', authority: 'legacy-product-semantic-snapshot', fallbackUsed: true,
      lineage: { snapshotId: 'legacy-product-snapshot' },
    });
    expect(reader.getAuthorityStatus()).toMatchObject({ authority: 'legacy-product-semantic-snapshot', status: 'READY', fallbackEnabled: true, legacyFallbackReads: 1 });
  });

  it.each(['FAILED', 'CONTROL_PLANE_INVALID'])('never uses legacy when projection runtime is %s', (reloadState) => {
    const legacy = { getActiveSnapshotMetadata: vi.fn(() => metadata), getProductSemanticFact: vi.fn(() => fact) } as unknown as ActiveProductSemanticSnapshotReader;
    const reader = new RuntimeProductSemanticReader(manager(null, reloadState), legacy);
    expect(reader.readWithAuthority('10')).toMatchObject({
      status: 'unavailable', authority: 'cat-v2-product-semantics', fallbackUsed: false,
    });
    expect(legacy.getProductSemanticFact).not.toHaveBeenCalled();
    expect(reader.getAuthorityStatus()).toMatchObject({ status: 'UNAVAILABLE', fallbackEnabled: true, legacyFallbackReads: 0 });
  });
});
