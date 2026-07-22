import { describe, expect, it } from 'vitest';
import {
  DefaultProductRelationshipSnapshotBuilder,
  DefaultProductRelationshipSnapshotPublisher,
  InMemoryProductRelationshipSnapshotStore,
  ProductRelationshipSnapshotBuildError,
  ProductRelationshipSnapshotStoreError,
  type ProductRelationshipSnapshot,
  type ProductRelationshipSnapshotSaveResult,
  type ProductRelationshipSnapshotStore,
} from '../../src/domain/recommendation/relationship-engine/publication/index.js';
import { DefaultProductRelationshipValidator } from '../../src/domain/recommendation/relationship-engine/validation/index.js';
import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import {
  emptySnapshotMetadata,
  snapshotRelationshipAtoB,
  snapshotRelationshipAtoC,
  validatedSnapshotRelationships,
  validatedWrapper,
} from '../fixtures/relationshipSnapshotPublisher.js';

class FailingSaveStore implements ProductRelationshipSnapshotStore {
  activated = false;

  async save(): Promise<ProductRelationshipSnapshotSaveResult> {
    throw new ProductRelationshipSnapshotStoreError('INVALID_SNAPSHOT', 'save failed');
  }

  async activate(): Promise<void> {
    this.activated = true;
  }

  async getById(): Promise<ProductRelationshipSnapshot | null> {
    return null;
  }

  async getActive(): Promise<ProductRelationshipSnapshot | null> {
    return null;
  }
}

class FailingActivateStore extends InMemoryProductRelationshipSnapshotStore {
  override async activate(): Promise<void> {
    throw new ProductRelationshipSnapshotStoreError('SNAPSHOT_NOT_FOUND', 'activation failed');
  }
}

function publisher(store = new InMemoryProductRelationshipSnapshotStore()) {
  return {
    publisher: new DefaultProductRelationshipSnapshotPublisher(new DefaultProductRelationshipSnapshotBuilder(), store),
    store,
  };
}

describe('DefaultProductRelationshipSnapshotPublisher flow', () => {
  it('builds, saves, and activates a snapshot', async () => {
    const { publisher: snapshotPublisher, store } = publisher();
    const result = await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships });
    expect((await store.getActive())?.snapshotId).toBe(result.snapshot.snapshotId);
  });

  it('returns the snapshot', async () => {
    const { publisher: snapshotPublisher } = publisher();
    const result = await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships });
    expect(result.snapshot.relationshipCount).toBe(validatedSnapshotRelationships.length);
  });

  it('returns created save status for a new snapshot', async () => {
    const { publisher: snapshotPublisher } = publisher();
    expect((await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships })).saveStatus).toBe('created');
  });

  it('returns build statistics', async () => {
    const { publisher: snapshotPublisher } = publisher();
    const result = await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships });
    expect(result.statistics.relationshipsPublished).toBe(result.snapshot.relationshipCount);
  });

  it('returns build warnings', async () => {
    const { publisher: snapshotPublisher } = publisher();
    const result = await snapshotPublisher.publish({
      relationships: [],
      parameters: { allowEmptySnapshot: true },
      emptySnapshotMetadata,
    });
    expect(result.warnings[0]?.code).toBe('EMPTY_SNAPSHOT_PUBLISHED');
  });

  it('copies publishedAt from publication context', async () => {
    const { publisher: snapshotPublisher } = publisher();
    const result = await snapshotPublisher.publish({
      relationships: validatedSnapshotRelationships,
      publicationContext: { publishedAt: '2026-07-22T12:00:00.000Z' },
    });
    expect(result.publishedAt).toBe('2026-07-22T12:00:00.000Z');
  });

  it('does not generate publishedAt', async () => {
    const { publisher: snapshotPublisher } = publisher();
    const result = await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships });
    expect(result).not.toHaveProperty('publishedAt');
  });

  it('does not put publishedAt inside the snapshot', async () => {
    const { publisher: snapshotPublisher } = publisher();
    const result = await snapshotPublisher.publish({
      relationships: validatedSnapshotRelationships,
      publicationContext: { publishedAt: '2026-07-22T12:00:00.000Z' },
    });
    expect(result.snapshot).not.toHaveProperty('publishedAt');
  });
});

describe('DefaultProductRelationshipSnapshotPublisher idempotency', () => {
  it('publishing the same content twice returns already_exists on the second publish', async () => {
    const { publisher: snapshotPublisher } = publisher();
    await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships });
    expect((await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships })).saveStatus).toBe('already_exists');
  });

  it('publishing the same content twice produces the same snapshotId', async () => {
    const { publisher: snapshotPublisher } = publisher();
    const first = await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships });
    const second = await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships });
    expect(second.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
  });

  it('republishing leaves that snapshot active', async () => {
    const { publisher: snapshotPublisher, store } = publisher();
    const first = await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships });
    await snapshotPublisher.publish({ relationships: validatedSnapshotRelationships });
    expect((await store.getActive())?.snapshotId).toBe(first.snapshot.snapshotId);
  });

  it('publishing different content changes the active snapshot', async () => {
    const { publisher: snapshotPublisher, store } = publisher();
    const first = await snapshotPublisher.publish({ relationships: [validatedWrapper(snapshotRelationshipAtoB)] });
    const second = await snapshotPublisher.publish({ relationships: [validatedWrapper(snapshotRelationshipAtoC)] });
    expect(second.snapshot.snapshotId).not.toBe(first.snapshot.snapshotId);
    expect((await store.getActive())?.snapshotId).toBe(second.snapshot.snapshotId);
  });

  it('keeps previous snapshots available by ID', async () => {
    const { publisher: snapshotPublisher, store } = publisher();
    const first = await snapshotPublisher.publish({ relationships: [validatedWrapper(snapshotRelationshipAtoB)] });
    await snapshotPublisher.publish({ relationships: [validatedWrapper(snapshotRelationshipAtoC)] });
    expect(await store.getById(first.snapshot.snapshotId)).toEqual(first.snapshot);
  });

  it('different publishedAt values do not change snapshot identity', async () => {
    const { publisher: snapshotPublisher } = publisher();
    const first = await snapshotPublisher.publish({
      relationships: validatedSnapshotRelationships,
      publicationContext: { publishedAt: '2026-07-22T12:00:00.000Z' },
    });
    const second = await snapshotPublisher.publish({
      relationships: validatedSnapshotRelationships,
      publicationContext: { publishedAt: '2026-07-23T12:00:00.000Z' },
    });
    expect(second.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
  });
});

describe('DefaultProductRelationshipSnapshotPublisher errors', () => {
  it('propagates builder errors', async () => {
    const { publisher: snapshotPublisher } = publisher();
    await expect(snapshotPublisher.publish({ relationships: [] })).rejects.toThrow(ProductRelationshipSnapshotBuildError);
  });

  it('propagates store save errors', async () => {
    const store = new FailingSaveStore();
    const snapshotPublisher = new DefaultProductRelationshipSnapshotPublisher(new DefaultProductRelationshipSnapshotBuilder(), store);
    await expect(snapshotPublisher.publish({ relationships: validatedSnapshotRelationships })).rejects.toThrow(ProductRelationshipSnapshotStoreError);
  });

  it('does not activate if save fails', async () => {
    const store = new FailingSaveStore();
    const snapshotPublisher = new DefaultProductRelationshipSnapshotPublisher(new DefaultProductRelationshipSnapshotBuilder(), store);
    await expect(snapshotPublisher.publish({ relationships: validatedSnapshotRelationships })).rejects.toThrow(ProductRelationshipSnapshotStoreError);
    expect(store.activated).toBe(false);
  });

  it('propagates store activation errors', async () => {
    const store = new FailingActivateStore();
    const snapshotPublisher = new DefaultProductRelationshipSnapshotPublisher(new DefaultProductRelationshipSnapshotBuilder(), store);
    await expect(snapshotPublisher.publish({ relationships: validatedSnapshotRelationships })).rejects.toThrow(ProductRelationshipSnapshotStoreError);
  });

  it('rejects invalid publication context', async () => {
    const { publisher: snapshotPublisher } = publisher();
    await expect(snapshotPublisher.publish({
      relationships: validatedSnapshotRelationships,
      publicationContext: { publishedAt: '' },
    })).rejects.toThrow();
  });
});

describe('DefaultProductRelationshipSnapshotPublisher compatibility', () => {
  it('accepts output produced by T05 validator', async () => {
    const validation = new DefaultProductRelationshipValidator().validate({
      relationships: [snapshotRelationshipAtoB, snapshotRelationshipAtoC],
    });
    const { publisher: snapshotPublisher } = publisher();
    const result = await snapshotPublisher.publish({ relationships: validation.validRelationships });
    expect(result.snapshot.relationshipCount).toBe(2);
  });

  it('does not recalculate support', async () => {
    if (snapshotRelationshipAtoB.evidence.kind !== 'co_occurrence') {
      throw new Error('Expected co_occurrence evidence');
    }
    const relationship: CalculatedProductRelationship = {
      ...snapshotRelationshipAtoB,
      evidence: { ...snapshotRelationshipAtoB.evidence, support: 0.3 },
    };
    const result = await publisher().publisher.publish({ relationships: [validatedWrapper(relationship)] });
    expect(result.snapshot.relationships[0]?.evidence).toHaveProperty('support', 0.3);
  });

  it('does not recalculate reliability', async () => {
    const relationship = { ...snapshotRelationshipAtoB, reliability: 0.31 };
    const result = await publisher().publisher.publish({ relationships: [validatedWrapper(relationship)] });
    expect(result.snapshot.relationships[0]?.reliability).toBe(0.31);
  });

  it('does not create ranking data', async () => {
    const result = await publisher().publisher.publish({ relationships: validatedSnapshotRelationships });
    expect(JSON.stringify(result.snapshot)).not.toContain('rank');
  });

  it('does not expose runtime or storage adapter details in the snapshot', async () => {
    const result = await publisher().publisher.publish({ relationships: validatedSnapshotRelationships });
    expect(JSON.stringify(result.snapshot).toLowerCase()).not.toMatch(/runtime|redis|sql|store|adapter|endpoint/u);
  });

  it('returns an activated true flag', async () => {
    const result = await publisher().publisher.publish({ relationships: validatedSnapshotRelationships });
    expect(result.activated).toBe(true);
  });
});
