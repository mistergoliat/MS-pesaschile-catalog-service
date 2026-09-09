import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DefaultActiveTrainingSemanticSnapshotReader,
  DefaultTrainingSemanticSnapshotBuilder,
  InMemoryTrainingSemanticSnapshotStore,
  TrainingSemanticSnapshotError,
} from '../../src/domain/training-semantic-snapshot/index.js';
import { FileTrainingSemanticSnapshotStore } from '../../src/infrastructure/training-semantic/fileTrainingSemanticSnapshotStore.js';
import { classifyTrainingSemanticProduct, classifyTrainingSemanticProducts } from '../../src/domain/training-semantic-classification/index.js';
import { loadTrainingSemanticClassificationInputs } from '../../scripts/training-semantic-classification/lib/load-input.js';
import { resolveProductSemanticInputPaths } from '../../scripts/product-semantic-classification/lib/fixture-paths.js';

function product(productId: number, name: string) {
  return { productId, name, productFamily: null, categories: [], features: [] } as const;
}

describe('training semantic snapshot A00.5', () => {
  it('canonicalizes input order and excludes timestamps from identity', () => {
    const first = classifyTrainingSemanticProduct(product(2, 'Dual Abductor / Adductor'));
    const second = classifyTrainingSemanticProduct(product(1, 'Leg Extension'));
    const builder = new DefaultTrainingSemanticSnapshotBuilder();
    const left = builder.build({ results: [first, second], parameters: { sourceProductCount: 2, generatedAt: '2026-01-01T00:00:00.000Z' } });
    const right = builder.build({ results: [second, first], parameters: { sourceProductCount: 2, generatedAt: '2027-01-01T00:00:00.000Z' } });
    expect(right.semanticChecksum).toBe(left.semanticChecksum);
    expect(right.snapshotId).toBe(left.snapshotId);
  });

  it('changes identity when a semantic fact, registry hash or rules hash changes', () => {
    const source = classifyTrainingSemanticProduct(product(1, 'Leg Extension'));
    const builder = new DefaultTrainingSemanticSnapshotBuilder();
    const changedFact = { ...source, assignments: source.assignments.map((assignment) => ({ ...assignment, evidence: assignment.evidence.map((evidence) => ({ ...evidence, matchedText: 'changed' })) })) };
    const baseline = builder.build({ results: [source], parameters: { sourceProductCount: 1 } });
    const changed = builder.build({ results: [changedFact], parameters: { sourceProductCount: 1 } });
    expect(changed.snapshotId).not.toBe(baseline.snapshotId);
    expect(() => builder.build({ results: [{ ...source, registryHash: '0'.repeat(64) }], parameters: { sourceProductCount: 1 } })).toThrow(TrainingSemanticSnapshotError);
    expect(() => builder.build({ results: [{ ...source, rulesHash: '0'.repeat(64) }], parameters: { sourceProductCount: 1 } })).toThrow(TrainingSemanticSnapshotError);
  });

  it('preserves coverage distinctions and derives registry semantics at read time', async () => {
    const results = classifyTrainingSemanticProducts([
      product(1, 'Palmeta de Caucho'),
      product(2, 'Cable Machine Genérica'),
      product(3, 'Polea de Muro'),
      product(4, 'Leg Extension'),
    ]);
    const snapshot = new DefaultTrainingSemanticSnapshotBuilder().build({ results, parameters: { sourceProductCount: 4 } });
    const store = new InMemoryTrainingSemanticSnapshotStore();
    await store.save(snapshot);
    await store.activate(snapshot.snapshotId);
    const reader = new DefaultActiveTrainingSemanticSnapshotReader(store);
    await reader.refresh();
    expect(reader.getProductTrainingSemanticFact(1)).toMatchObject({ coverageStatus: 'NO_CAPABILITY_APPLICABLE', assignments: [] });
    expect(reader.getProductTrainingSemanticFact(2)).toMatchObject({ coverageStatus: 'UNMODELED', assignments: [] });
    expect(reader.getProductTrainingSemanticFact(3)).toMatchObject({ coverageStatus: 'INSUFFICIENT_EVIDENCE', assignments: [] });
    expect(reader.getProductTrainingSemanticFact(999)).toBeNull();
    expect(reader.getProductTrainingSemanticFact(4)?.assignments[0]?.derivedSemantics).toMatchObject({ capabilityCode: 'LEG_EXTENSION', trainingPatterns: ['KNEE_EXTENSION'] });
  });

  it('distinguishes unavailable snapshot from a product without an assignment', async () => {
    const reader = new DefaultActiveTrainingSemanticSnapshotReader(new InMemoryTrainingSemanticSnapshotStore());
    await reader.refresh();
    expect(reader.getMetadata()).toBeNull();
    expect(() => reader.getProductTrainingSemanticFact(1)).toThrow(/unavailable/i);
  });

  it('publishes an immutable file and updates the pointer atomically/idempotently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'training-semantic-snapshot-'));
    const store = new FileTrainingSemanticSnapshotStore(root);
    const snapshot = new DefaultTrainingSemanticSnapshotBuilder().build({ results: [classifyTrainingSemanticProduct(product(1, 'Chest Press'))], parameters: { sourceProductCount: 1, generatedAt: '2026-01-01T00:00:00.000Z' } });
    expect(await store.save(snapshot)).toMatchObject({ status: 'created' });
    expect(await store.save(new DefaultTrainingSemanticSnapshotBuilder().build({ results: [classifyTrainingSemanticProduct(product(1, 'Chest Press'))], parameters: { sourceProductCount: 1, generatedAt: '2027-01-01T00:00:00.000Z' } }))).toMatchObject({ status: 'already_exists' });
    await store.activate(snapshot.snapshotId);
    const pointer = JSON.parse(await readFile(path.join(root, 'active.json'), 'utf8')) as Record<string, unknown>;
    expect(pointer).toMatchObject({ snapshotId: snapshot.snapshotId, semanticChecksum: snapshot.semanticChecksum, registryHash: snapshot.registryHash, rulesHash: snapshot.rulesHash });
    expect(pointer).not.toHaveProperty('records');
  });

  it('reproduces the accepted 2011-product baseline', async () => {
    const inputPaths = await resolveProductSemanticInputPaths();
    const { inputs } = await loadTrainingSemanticClassificationInputs(inputPaths);
    const results = classifyTrainingSemanticProducts(inputs);
    const snapshot = new DefaultTrainingSemanticSnapshotBuilder().build({ results, parameters: { sourceProductCount: inputs.length } });
    expect(snapshot.counts).toMatchObject({ sourceProducts: 2011, assignmentCount: 180, directAssignments: 157, supportedAssignments: 23, multiAssignmentProducts: 23, coverageCounts: { NO_CAPABILITY_APPLICABLE: 881, UNMODELED: 1086, INSUFFICIENT_EVIDENCE: 44, NEEDS_REVIEW: 0 }, assignmentCountsByCapability: { ABDUCTOR: 9, ADDUCTOR: 7, CHEST_PRESS: 7, DIP: 21, HIP_THRUST: 18, LAT_PULLDOWN: 24, LEG_CURL: 20, LEG_EXTENSION: 11, PEC_DECK: 1, PULL_UP: 31, ROW: 25, SHOULDER_PRESS: 6, ABDOMINAL_CRUNCH: 0 } });
  }, 30_000);
});
