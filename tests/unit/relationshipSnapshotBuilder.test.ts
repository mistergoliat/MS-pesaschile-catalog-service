import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import {
  canonicalizeJson,
  createSnapshotIdentityPayload,
  DefaultProductRelationshipSnapshotBuilder,
  ProductRelationshipSnapshotBuildError,
  productRelationshipSnapshotSchema,
} from '../../src/domain/recommendation/relationship-engine/publication/index.js';
import type { ValidatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/validation/index.js';
import {
  clone,
  emptySnapshotMetadata,
  shuffledValidatedSnapshotRelationships,
  snapshotRelationshipAtoB,
  snapshotRelationshipAtoC,
  snapshotRelationshipBtoA,
  snapshotRelationshipDifferentModel,
  snapshotRelationshipDifferentWindow,
  snapshotRelationshipWithSourceCombination,
  snapshotRelationshipWithTargetCombination,
  validatedSnapshotRelationships,
  validatedWrapper,
} from '../fixtures/relationshipSnapshotPublisher.js';

function builder() {
  return new DefaultProductRelationshipSnapshotBuilder();
}

function build(relationships = validatedSnapshotRelationships) {
  return builder().build({ relationships });
}

function expectBuildError(action: () => unknown, code: ProductRelationshipSnapshotBuildError['code']): void {
  expect(action).toThrow(ProductRelationshipSnapshotBuildError);
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProductRelationshipSnapshotBuildError);
    expect((error as ProductRelationshipSnapshotBuildError).code).toBe(code);
  }
}

describe('DefaultProductRelationshipSnapshotBuilder basic construction', () => {
  it('builds a snapshot with validated relationships', () => {
    const result = build();
    expect(productRelationshipSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
  });

  it('copies modelVersion from relationships', () => {
    expect(build().snapshot.modelVersion).toBe('same-order.0');
  });

  it('copies evidenceWindow from relationships', () => {
    expect(build().snapshot.evidenceWindow).toEqual(snapshotRelationshipAtoB.evidenceWindow);
  });

  it('calculates relationshipCount', () => {
    expect(build().snapshot.relationshipCount).toBe(validatedSnapshotRelationships.length);
  });

  it('preserves complete calculated relationships', () => {
    const snapshot = build().snapshot;
    expect(snapshot.relationships).toContainEqual(snapshotRelationshipAtoB);
    expect(snapshot.relationships[0]).toHaveProperty('evidence');
  });

  it('does not add ranking', () => {
    expect(JSON.stringify(build().snapshot)).not.toContain('rank');
  });

  it('does not add hydrated product data', () => {
    expect(JSON.stringify(build().snapshot).toLowerCase()).not.toMatch(/price|stock|margin|name|image|category/u);
  });

  it('does not add a clock timestamp', () => {
    const snapshot = build().snapshot;
    expect(snapshot).not.toHaveProperty('publishedAt');
    expect(snapshot).not.toHaveProperty('createdAt');
  });

  it('uses schemaVersion 1', () => {
    expect(build().snapshot.schemaVersion).toBe('1');
  });
});

describe('DefaultProductRelationshipSnapshotBuilder homogeneity', () => {
  it('accepts relationships with the same model version', () => {
    expect(build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(snapshotRelationshipAtoC)]).snapshot.relationshipCount).toBe(2);
  });

  it('rejects mixed model versions', () => {
    expectBuildError(
      () => build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(snapshotRelationshipDifferentModel)]),
      'MIXED_MODEL_VERSIONS',
    );
  });

  it('accepts relationships with the same evidence window', () => {
    expect(build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(snapshotRelationshipBtoA)]).snapshot.relationshipCount).toBe(2);
  });

  it('rejects mixed evidence windows', () => {
    expectBuildError(
      () => build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(snapshotRelationshipDifferentWindow)]),
      'MIXED_EVIDENCE_WINDOWS',
    );
  });

  it('rejects wrapper model mismatch', () => {
    expectBuildError(
      () => build([{ relationship: snapshotRelationshipAtoB, validatedAtModelVersion: 'other' }]),
      'MODEL_VERSION_MISMATCH',
    );
  });

  it('rejects invalid wrapper shape', () => {
    expectBuildError(
      () => build([{ relationship: snapshotRelationshipAtoB } as unknown as ValidatedProductRelationship]),
      'INVALID_VALIDATED_WRAPPER',
    );
  });
});

describe('DefaultProductRelationshipSnapshotBuilder canonical order', () => {
  it('sorts by source productId', () => {
    const snapshot = build([validatedWrapper(snapshotRelationshipBtoA), validatedWrapper(snapshotRelationshipAtoB)]).snapshot;
    expect(snapshot.relationships.map((relationship) => relationship.sourceProduct.productId)).toEqual(['A', 'B']);
  });

  it('sorts by source combination with base first', () => {
    const snapshot = build([
      validatedWrapper(snapshotRelationshipWithSourceCombination),
      validatedWrapper(snapshotRelationshipAtoC),
    ]).snapshot;
    expect(snapshot.relationships[0]?.sourceProduct.combinationId).toBeUndefined();
    expect(snapshot.relationships[1]?.sourceProduct.combinationId).toBe('10');
  });

  it('sorts by target productId', () => {
    const snapshot = build([validatedWrapper(snapshotRelationshipAtoC), validatedWrapper(snapshotRelationshipAtoB)]).snapshot;
    expect(snapshot.relationships.map((relationship) => relationship.targetProduct.productId)).toEqual(['B', 'C']);
  });

  it('sorts by target combination with base first', () => {
    const snapshot = build([
      validatedWrapper(snapshotRelationshipWithTargetCombination),
      validatedWrapper(snapshotRelationshipAtoB),
    ]).snapshot;
    expect(snapshot.relationships[0]?.targetProduct.combinationId).toBeUndefined();
    expect(snapshot.relationships[1]?.targetProduct.combinationId).toBe('20');
  });

  it('sorts by relationshipType after product identity', () => {
    const manual: CalculatedProductRelationship = {
      ...snapshotRelationshipAtoB,
      relationshipType: 'manual',
      evidence: {
        kind: 'rule',
        ruleId: 'manual-A-B',
        ruleVersion: '2025-01',
      },
      reliability: 0.8,
    };
    const snapshot = build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(manual)]).snapshot;
    expect(snapshot.relationships.map((relationship) => relationship.relationshipType)).toEqual(['manual', 'same_order']);
  });

  it('same set in a different order produces the same snapshot', () => {
    expect(build().snapshot).toEqual(build(shuffledValidatedSnapshotRelationships).snapshot);
  });

  it('does not sort by reliability', () => {
    const highReliabilityB = { ...snapshotRelationshipBtoA, reliability: 0.99 };
    const lowReliabilityA = { ...snapshotRelationshipAtoB, reliability: 0.31 };
    const snapshot = build([validatedWrapper(highReliabilityB), validatedWrapper(lowReliabilityA)]).snapshot;
    expect(snapshot.relationships.map((relationship) => relationship.sourceProduct.productId)).toEqual(['A', 'B']);
  });
});

describe('DefaultProductRelationshipSnapshotBuilder hash behavior', () => {
  it('produces a sha256 snapshotId', () => {
    expect(build().snapshot.snapshotId).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('same content produces the same hash', () => {
    expect(build().snapshot.snapshotId).toBe(build().snapshot.snapshotId);
  });

  it('input order does not affect the hash', () => {
    expect(build().snapshot.snapshotId).toBe(build(shuffledValidatedSnapshotRelationships).snapshot.snapshotId);
  });

  it('relationship content changes the hash', () => {
    const changed = { ...snapshotRelationshipAtoB, targetProduct: { productId: 'D' } };
    expect(build([validatedWrapper(changed)]).snapshot.snapshotId).not.toBe(build([validatedWrapper(snapshotRelationshipAtoB)]).snapshot.snapshotId);
  });

  it('reliability changes the hash', () => {
    const changed = { ...snapshotRelationshipAtoB, reliability: 0.9 };
    expect(build([validatedWrapper(changed)]).snapshot.snapshotId).not.toBe(build([validatedWrapper(snapshotRelationshipAtoB)]).snapshot.snapshotId);
  });

  it('modelVersion changes the hash', () => {
    expect(build([validatedWrapper(snapshotRelationshipDifferentModel)]).snapshot.snapshotId).not.toBe(
      build([validatedWrapper(snapshotRelationshipAtoB)]).snapshot.snapshotId,
    );
  });

  it('evidence window changes the hash', () => {
    expect(build([validatedWrapper(snapshotRelationshipDifferentWindow)]).snapshot.snapshotId).not.toBe(
      build([validatedWrapper(snapshotRelationshipAtoB)]).snapshot.snapshotId,
    );
  });

  it('publishedAt does not affect the hash because it is outside the builder input', () => {
    expect(build().snapshot.snapshotId).toBe(build().snapshot.snapshotId);
  });

  it('hash matches the documented canonical content', () => {
    const snapshot = build().snapshot;
    const payload = createSnapshotIdentityPayload({
      modelVersion: snapshot.modelVersion,
      evidenceWindow: snapshot.evidenceWindow,
      relationships: snapshot.relationships,
    });
    const expected = `sha256:${createHash('sha256').update(canonicalizeJson(payload)).digest('hex')}`;
    expect(snapshot.snapshotId).toBe(expected);
  });
});

describe('canonicalizeJson', () => {
  it('sorts object keys', () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalizeJson([2, 1])).toBe('[2,1]');
  });

  it('serializes strings correctly', () => {
    expect(canonicalizeJson({ value: 'a"b' })).toBe('{"value":"a\\"b"}');
  });

  it('serializes null', () => {
    expect(canonicalizeJson({ value: null })).toBe('{"value":null}');
  });

  it('rejects NaN', () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow(TypeError);
  });

  it('rejects Infinity', () => {
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('rejects undefined', () => {
    expect(() => canonicalizeJson({ value: undefined })).toThrow(TypeError);
  });

  it('rejects functions', () => {
    expect(() => canonicalizeJson({ value: () => 1 })).toThrow(TypeError);
  });

  it('rejects symbols', () => {
    expect(() => canonicalizeJson({ value: Symbol('x') })).toThrow(TypeError);
  });

  it('rejects BigInt', () => {
    expect(() => canonicalizeJson({ value: BigInt(1) })).toThrow(TypeError);
  });

  it('rejects cycles', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => canonicalizeJson(value)).toThrow(TypeError);
  });

  it('is deterministic', () => {
    expect(canonicalizeJson({ z: [1, { b: true, a: false }] })).toBe(canonicalizeJson({ z: [1, { a: false, b: true }] }));
  });
});

describe('DefaultProductRelationshipSnapshotBuilder empty snapshots', () => {
  it('rejects empty snapshots by default', () => {
    expectBuildError(() => builder().build({ relationships: [] }), 'EMPTY_SNAPSHOT_NOT_ALLOWED');
  });

  it('allows empty snapshot when enabled', () => {
    const result = builder().build({
      relationships: [],
      parameters: { allowEmptySnapshot: true },
      emptySnapshotMetadata,
    });
    expect(result.snapshot.relationshipCount).toBe(0);
  });

  it('requires explicit metadata for empty snapshots', () => {
    expectBuildError(
      () => builder().build({ relationships: [], parameters: { allowEmptySnapshot: true } }),
      'EMPTY_SNAPSHOT_METADATA_REQUIRED',
    );
  });

  it('validates empty metadata modelVersion', () => {
    expectBuildError(
      () => builder().build({
        relationships: [],
        parameters: { allowEmptySnapshot: true },
        emptySnapshotMetadata: { ...emptySnapshotMetadata, modelVersion: '' },
      }),
      'INVALID_EMPTY_SNAPSHOT_METADATA',
    );
  });

  it('validates empty metadata evidence window', () => {
    expectBuildError(
      () => builder().build({
        relationships: [],
        parameters: { allowEmptySnapshot: true },
        emptySnapshotMetadata: {
          modelVersion: 'same-order.0',
          evidenceWindow: {
            from: '2026-01-01T00:00:00.000Z',
            to: '2025-01-01T00:00:00.000Z',
          },
        },
      }),
      'INVALID_EMPTY_SNAPSHOT_METADATA',
    );
  });

  it('emits EMPTY_SNAPSHOT_PUBLISHED', () => {
    const result = builder().build({
      relationships: [],
      parameters: { allowEmptySnapshot: true },
      emptySnapshotMetadata,
    });
    expect(result.warnings[0]?.code).toBe('EMPTY_SNAPSHOT_PUBLISHED');
  });

  it('calculates a deterministic hash for empty snapshots', () => {
    const first = builder().build({ relationships: [], parameters: { allowEmptySnapshot: true }, emptySnapshotMetadata });
    const second = builder().build({ relationships: [], parameters: { allowEmptySnapshot: true }, emptySnapshotMetadata });
    expect(second.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
  });
});

describe('DefaultProductRelationshipSnapshotBuilder duplicates', () => {
  it('rejects duplicate validated relationships', () => {
    expectBuildError(
      () => build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(clone(snapshotRelationshipAtoB))]),
      'DUPLICATE_VALIDATED_RELATIONSHIP',
    );
  });

  it('does not merge duplicates', () => {
    expectBuildError(
      () => build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(clone(snapshotRelationshipAtoB))]),
      'DUPLICATE_VALIDATED_RELATIONSHIP',
    );
  });

  it('does not select the duplicate with greater reliability', () => {
    const duplicate = { ...snapshotRelationshipAtoB, reliability: 0.99 };
    expectBuildError(
      () => build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(duplicate)]),
      'DUPLICATE_VALIDATED_RELATIONSHIP',
    );
  });

  it('accepts the inverse directed relationship', () => {
    expect(build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(snapshotRelationshipBtoA)]).snapshot.relationshipCount).toBe(2);
  });

  it('accepts directed relationships with different targets', () => {
    expect(build([validatedWrapper(snapshotRelationshipAtoB), validatedWrapper(snapshotRelationshipAtoC)]).snapshot.relationshipCount).toBe(2);
  });
});

describe('DefaultProductRelationshipSnapshotBuilder immutability', () => {
  it('does not modify input wrappers', () => {
    const input = clone(validatedSnapshotRelationships);
    const before = clone(input);
    builder().build({ relationships: input });
    expect(input).toEqual(before);
  });

  it('snapshot does not share mutable relationship references with input', () => {
    const input = clone(validatedSnapshotRelationships);
    const result = builder().build({ relationships: input });
    expect(result.snapshot.relationships[0]).not.toBe(input[0]?.relationship);
  });

  it('mutating input after build does not change snapshot', () => {
    const input = clone(validatedSnapshotRelationships);
    const result = builder().build({ relationships: input });
    input[0]!.relationship.targetProduct.productId = 'MUTATED';
    expect(result.snapshot.relationships.some((relationship) => relationship.targetProduct.productId === 'MUTATED')).toBe(false);
  });

  it('freezes the snapshot relationships array', () => {
    expect(Object.isFrozen(build().snapshot.relationships)).toBe(true);
  });

  it('freezes internal relationship objects', () => {
    const snapshot = build().snapshot;
    expect(Object.isFrozen(snapshot.relationships[0])).toBe(true);
    expect(Object.isFrozen(snapshot.relationships[0]?.sourceProduct)).toBe(true);
  });

  it('same input produces the same result', () => {
    expect(build()).toEqual(build());
  });
});

describe('DefaultProductRelationshipSnapshotBuilder statistics and compatibility', () => {
  it('counts relationships read', () => {
    expect(build().statistics.relationshipsRead).toBe(3);
  });

  it('counts relationships published', () => {
    expect(build().statistics.relationshipsPublished).toBe(3);
  });

  it('counts distinct source products', () => {
    expect(build().statistics.distinctSourceProducts).toBe(2);
  });

  it('counts distinct target products', () => {
    expect(build().statistics.distinctTargetProducts).toBe(3);
  });

  it('counts directed pairs', () => {
    expect(build().statistics.distinctDirectedPairs).toBe(3);
  });

  it('satisfies statistics invariants', () => {
    const result = build();
    expect(result.statistics.relationshipsRead).toBe(result.statistics.relationshipsPublished);
    expect(result.statistics.relationshipsPublished).toBe(result.snapshot.relationshipCount);
    expect(result.statistics.relationshipsPublished).toBe(result.snapshot.relationships.length);
  });

  it('accepts real T05-style output wrappers', () => {
    expect(build(validatedSnapshotRelationships).snapshot.relationshipCount).toBe(validatedSnapshotRelationships.length);
  });

  it('does not recalculate metrics', () => {
    const relationship = { ...snapshotRelationshipAtoB, reliability: 0.31 };
    const result = build([validatedWrapper(relationship)]);
    expect(result.snapshot.relationships[0]?.reliability).toBe(0.31);
  });
});
