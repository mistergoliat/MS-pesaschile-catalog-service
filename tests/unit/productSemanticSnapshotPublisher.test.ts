import { describe, expect, it } from 'vitest';
import type { ProductSemanticSnapshot, ProductSemanticSnapshotSaveResult, ProductSemanticSnapshotStore } from '../../src/domain/product-semantic-snapshot/index.js';
import {
  DefaultProductSemanticSnapshotBuilder,
  DefaultProductSemanticSnapshotPublisher,
  InMemoryProductSemanticSnapshotStore,
  ProductSemanticSnapshotStoreError,
} from '../../src/domain/product-semantic-snapshot/index.js';
import { semanticFixtureResults } from '../fixtures/productSemanticSnapshot.js';

class FailingSaveStore implements ProductSemanticSnapshotStore {
  activated = false;

  async save(): Promise<ProductSemanticSnapshotSaveResult> {
    throw new ProductSemanticSnapshotStoreError('INVALID_SNAPSHOT', 'save failed');
  }

  async activate(): Promise<void> {
    this.activated = true;
  }

  async getById(): Promise<ProductSemanticSnapshot | null> {
    return null;
  }

  async getActive(): Promise<ProductSemanticSnapshot | null> {
    return null;
  }
}

function publisher(store = new InMemoryProductSemanticSnapshotStore()) {
  return {
    publisher: new DefaultProductSemanticSnapshotPublisher(new DefaultProductSemanticSnapshotBuilder(), store),
    store,
  };
}

describe('DefaultProductSemanticSnapshotPublisher', () => {
  it('builds, saves, and activates a semantic snapshot', async () => {
    const { publisher: snapshotPublisher, store } = publisher();
    const result = await snapshotPublisher.publish({
      results: semanticFixtureResults,
      parameters: {
        sourceProductCount: semanticFixtureResults.length,
        classifierVersion: 'product-semantic-classifier-v1',
        builtAt: '2026-08-29T12:00:00.000Z',
      },
    });
    expect((await store.getActive())?.snapshotId).toBe(result.snapshot.snapshotId);
    expect(result.activated).toBe(true);
  });

  it('publishing the same semantic content twice returns already_exists on the second publish', async () => {
    const { publisher: snapshotPublisher } = publisher();
    await snapshotPublisher.publish({
      results: semanticFixtureResults,
      parameters: {
        sourceProductCount: semanticFixtureResults.length,
        classifierVersion: 'product-semantic-classifier-v1',
        builtAt: '2026-08-29T12:00:00.000Z',
      },
    });
    const second = await snapshotPublisher.publish({
      results: semanticFixtureResults,
      parameters: {
        sourceProductCount: semanticFixtureResults.length,
        classifierVersion: 'product-semantic-classifier-v1',
        builtAt: '2026-08-29T13:00:00.000Z',
      },
    });
    expect(second.saveStatus).toBe('already_exists');
  });

  it('publishing the same semantic content twice preserves snapshot identity', async () => {
    const { publisher: snapshotPublisher } = publisher();
    const first = await snapshotPublisher.publish({
      results: semanticFixtureResults,
      parameters: {
        sourceProductCount: semanticFixtureResults.length,
        classifierVersion: 'product-semantic-classifier-v1',
        builtAt: '2026-08-29T12:00:00.000Z',
      },
    });
    const second = await snapshotPublisher.publish({
      results: semanticFixtureResults,
      parameters: {
        sourceProductCount: semanticFixtureResults.length,
        classifierVersion: 'product-semantic-classifier-v1',
        builtAt: '2026-08-29T13:00:00.000Z',
      },
    });
    expect(second.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
  });

  it('does not activate if save fails', async () => {
    const store = new FailingSaveStore();
    const snapshotPublisher = new DefaultProductSemanticSnapshotPublisher(new DefaultProductSemanticSnapshotBuilder(), store);
    await expect(snapshotPublisher.publish({
      results: semanticFixtureResults,
      parameters: {
        sourceProductCount: semanticFixtureResults.length,
        classifierVersion: 'product-semantic-classifier-v1',
        builtAt: '2026-08-29T12:00:00.000Z',
      },
    })).rejects.toThrow(ProductSemanticSnapshotStoreError);
    expect(store.activated).toBe(false);
  });
});
