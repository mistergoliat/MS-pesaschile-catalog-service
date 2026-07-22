import { describe, expect, it } from 'vitest';
import type { CalculatedProductRelationship } from '../../src/domain/recommendation/relationship-engine/contracts.js';
import {
  DEFAULT_RELATIONSHIP_VALIDATION_PARAMETERS,
  DefaultProductRelationshipValidator,
  productRelationshipValidationResultSchema,
  relationshipValidationParametersSchema,
  type ProductRelationshipValidationRejectionCode,
  type RelationshipValidationParameters,
} from '../../src/domain/recommendation/relationship-engine/validation/index.js';
import {
  baseValidatedRelationship,
  inverseValidatedRelationship,
  manualValidatedRelationship,
  relationshipValidatorBatch,
  relationshipWith,
  relationshipWithCombination,
  relationshipWithoutExtendedCounts,
} from '../fixtures/relationshipValidator.js';

const permissiveParameters = {
  minimumReliability: 0,
  rejectNegativeAssociation: false,
} satisfies RelationshipValidationParameters;

function validator() {
  return new DefaultProductRelationshipValidator();
}

function validate(
  relationships: unknown[],
  parameters: RelationshipValidationParameters = DEFAULT_RELATIONSHIP_VALIDATION_PARAMETERS,
) {
  return validator().validate({
    relationships: relationships as CalculatedProductRelationship[],
    parameters,
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function coOccurrenceWith(
  patch: Partial<Extract<CalculatedProductRelationship['evidence'], { kind: 'co_occurrence' }>>,
): CalculatedProductRelationship {
  if (baseValidatedRelationship.evidence.kind !== 'co_occurrence') {
    throw new Error('Expected co_occurrence fixture');
  }
  return relationshipWith({
    evidence: {
      ...baseValidatedRelationship.evidence,
      ...patch,
    },
  });
}

function coOccurrenceWithoutCountsWith(
  patch: Partial<Extract<CalculatedProductRelationship['evidence'], { kind: 'co_occurrence' }>>,
): CalculatedProductRelationship {
  if (relationshipWithoutExtendedCounts.evidence.kind !== 'co_occurrence') {
    throw new Error('Expected co_occurrence fixture');
  }
  return {
    ...relationshipWithoutExtendedCounts,
    evidence: {
      ...relationshipWithoutExtendedCounts.evidence,
      ...patch,
    },
  };
}

function expectSingleRejection(relationship: unknown, code: ProductRelationshipValidationRejectionCode): void {
  const result = validate([relationship], permissiveParameters);
  expect(result.validRelationships).toHaveLength(0);
  expect(result.rejections).toHaveLength(1);
  expect(result.rejections[0]?.code).toBe(code);
}

describe('DefaultProductRelationshipValidator input behavior', () => {
  it('accepts an empty array', () => {
    const result = validate([]);
    expect(result.validRelationships).toEqual([]);
    expect(result.rejections).toEqual([]);
  });

  it('emits EMPTY_INPUT for an empty array', () => {
    expect(validate([]).warnings.map((warning) => warning.code)).toEqual(['EMPTY_INPUT']);
  });

  it('does not modify the input array', () => {
    const input = [clone(baseValidatedRelationship)];
    const before = clone(input);
    validate(input);
    expect(input).toEqual(before);
  });

  it('does not modify nested relationship values', () => {
    const input = [clone(baseValidatedRelationship)];
    const before = clone(input[0]);
    validate(input);
    expect(input[0]).toEqual(before);
  });

  it('preserves relative order of valid relationships', () => {
    const result = validate(relationshipValidatorBatch);
    expect(result.validRelationships.map((item) => item.relationship.targetProduct.productId)).toEqual(['B', 'C', 'A']);
  });

  it('preserves the original relationship object inside the validated wrapper', () => {
    const result = validate([baseValidatedRelationship]);
    expect(result.validRelationships[0]?.relationship).toBe(baseValidatedRelationship);
  });

  it('copies modelVersion into validatedAtModelVersion', () => {
    const result = validate([baseValidatedRelationship]);
    expect(result.validRelationships[0]?.validatedAtModelVersion).toBe(baseValidatedRelationship.modelVersion);
  });
});

describe('DefaultProductRelationshipValidator product rules', () => {
  it('accepts valid products', () => {
    expect(validate([baseValidatedRelationship]).validRelationships).toHaveLength(1);
  });

  it('rejects invalid source product', () => {
    expectSingleRejection(relationshipWith({ sourceProduct: { productId: '' } }), 'INVALID_SOURCE_PRODUCT');
  });

  it('rejects invalid target product', () => {
    expectSingleRejection(relationshipWith({ targetProduct: { productId: '' } }), 'INVALID_TARGET_PRODUCT');
  });

  it('rejects self relationship by composed identity', () => {
    expectSingleRejection(
      relationshipWith({ sourceProduct: { productId: 'A' }, targetProduct: { productId: 'A' } }),
      'SELF_RELATIONSHIP',
    );
  });

  it('distinguishes combinations in product identity', () => {
    expect(validate([relationshipWithCombination]).validRelationships).toHaveLength(1);
  });

  it('accepts the same base product with different combinations', () => {
    const relationship = relationshipWith({
      sourceProduct: { productId: 'A', combinationId: '10' },
      targetProduct: { productId: 'A', combinationId: '11' },
    });
    expect(validate([relationship]).validRelationships).toHaveLength(1);
  });

  it('does not treat base product and combination as the same identity', () => {
    const relationship = relationshipWith({
      sourceProduct: { productId: 'A' },
      targetProduct: { productId: 'A', combinationId: '10' },
    });
    expect(validate([relationship]).validRelationships).toHaveLength(1);
  });
});

describe('DefaultProductRelationshipValidator contracts', () => {
  it('accepts same_order with co_occurrence evidence', () => {
    expect(validate([baseValidatedRelationship]).validRelationships).toHaveLength(1);
  });

  it('rejects incompatible evidence', () => {
    expectSingleRejection(
      relationshipWith({
        relationshipType: 'same_order',
        evidence: {
          kind: 'transition',
          transitionCount: 2,
          transitionProbability: 0.2,
          medianLagDays: 7,
        },
      }),
      'EVIDENCE_TYPE_MISMATCH',
    );
  });

  it('rejects unsupported relationship type', () => {
    expectSingleRejection(
      relationshipWith({ relationshipType: 'related' as CalculatedProductRelationship['relationshipType'] }),
      'UNSUPPORTED_RELATIONSHIP_TYPE',
    );
  });

  it('rejects empty modelVersion', () => {
    expectSingleRejection(relationshipWith({ modelVersion: '' }), 'INVALID_MODEL_VERSION');
  });

  it('rejects inverted evidence window', () => {
    expectSingleRejection(
      relationshipWith({
        evidenceWindow: {
          from: '2025-12-31T23:59:59.000Z',
          to: '2025-01-01T00:00:00.000Z',
        },
      }),
      'INVALID_EVIDENCE_WINDOW',
    );
  });

  it('accepts equal temporal boundaries', () => {
    const relationship = relationshipWith({
      evidenceWindow: {
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-01T00:00:00.000Z',
      },
    });
    expect(validate([relationship]).validRelationships).toHaveLength(1);
  });
});

describe('DefaultProductRelationshipValidator metric ranges', () => {
  it('accepts support between 0 and 1', () => {
    expect(validate([coOccurrenceWithoutCountsWith({ support: 0.5 })]).validRelationships).toHaveLength(1);
  });

  it('rejects negative support', () => {
    expectSingleRejection(coOccurrenceWithoutCountsWith({ support: -0.1 }), 'INVALID_SUPPORT');
  });

  it('rejects support greater than 1', () => {
    expectSingleRejection(coOccurrenceWithoutCountsWith({ support: 1.1 }), 'INVALID_SUPPORT');
  });

  it('rejects negative confidence', () => {
    expectSingleRejection(coOccurrenceWithoutCountsWith({ confidence: -0.1 }), 'INVALID_CONFIDENCE');
  });

  it('rejects confidence greater than 1', () => {
    expectSingleRejection(coOccurrenceWithoutCountsWith({ confidence: 1.1 }), 'INVALID_CONFIDENCE');
  });

  it('accepts lift equal to zero structurally when policy allows it', () => {
    const result = validate([coOccurrenceWithoutCountsWith({ lift: 0 })], permissiveParameters);
    expect(result.validRelationships).toHaveLength(1);
  });

  it('rejects negative lift', () => {
    expectSingleRejection(coOccurrenceWithoutCountsWith({ lift: -0.1 }), 'INVALID_LIFT');
  });

  it('rejects negative reliability', () => {
    expectSingleRejection(relationshipWith({ reliability: -0.1 }), 'INVALID_RELIABILITY');
  });

  it('rejects reliability greater than 1', () => {
    expectSingleRejection(relationshipWith({ reliability: 1.1 }), 'INVALID_RELIABILITY');
  });

  it('rejects NaN', () => {
    expectSingleRejection(coOccurrenceWithoutCountsWith({ support: Number.NaN }), 'NON_SERIALIZABLE_RELATIONSHIP');
  });

  it('rejects Infinity', () => {
    expectSingleRejection(coOccurrenceWithoutCountsWith({ confidence: Number.POSITIVE_INFINITY }), 'NON_SERIALIZABLE_RELATIONSHIP');
  });

  it('rejects -Infinity', () => {
    expectSingleRejection(relationshipWith({ reliability: Number.NEGATIVE_INFINITY }), 'NON_SERIALIZABLE_RELATIONSHIP');
  });
});

describe('DefaultProductRelationshipValidator evidence counts', () => {
  it('accepts coherent counts', () => {
    expect(validate([baseValidatedRelationship]).validRelationships).toHaveLength(1);
  });

  it('rejects non-integer jointCount', () => {
    expectSingleRejection(coOccurrenceWithoutCountsWith({ jointCount: 1.5 }), 'INVALID_JOINT_COUNT');
  });

  it('rejects jointCount equal to zero for same_order', () => {
    expectSingleRejection(coOccurrenceWithoutCountsWith({ jointCount: 0 }), 'INVALID_JOINT_COUNT');
  });

  it('rejects invalid sourceCount', () => {
    expectSingleRejection(coOccurrenceWith({ sourceCount: 0 }), 'INVALID_EVIDENCE_COUNTS');
  });

  it('rejects invalid targetCount', () => {
    expectSingleRejection(coOccurrenceWith({ targetCount: 0 }), 'INVALID_EVIDENCE_COUNTS');
  });

  it('rejects invalid totalTransactions', () => {
    expectSingleRejection(coOccurrenceWith({ totalTransactions: 0 }), 'INVALID_EVIDENCE_COUNTS');
  });

  it('rejects jointCount greater than sourceCount', () => {
    expectSingleRejection(coOccurrenceWith({ jointCount: 21, support: 0.525, confidence: 0.9, lift: 2.25 }), 'INCONSISTENT_EVIDENCE_COUNTS');
  });

  it('rejects jointCount greater than targetCount', () => {
    expectSingleRejection(coOccurrenceWith({ jointCount: 17, support: 0.425, confidence: 0.85, lift: 2.125 }), 'INCONSISTENT_EVIDENCE_COUNTS');
  });

  it('rejects sourceCount greater than totalTransactions', () => {
    expectSingleRejection(coOccurrenceWith({ sourceCount: 41, confidence: 12 / 41 }), 'INCONSISTENT_EVIDENCE_COUNTS');
  });

  it('rejects targetCount greater than totalTransactions', () => {
    expectSingleRejection(coOccurrenceWith({ targetCount: 41, lift: 0.6 / (41 / 40) }), 'INCONSISTENT_EVIDENCE_COUNTS');
  });
});

describe('DefaultProductRelationshipValidator mathematical consistency', () => {
  it('accepts consistent support', () => {
    expect(validate([coOccurrenceWith({ support: 12 / 40 })]).validRelationships).toHaveLength(1);
  });

  it('rejects inconsistent support', () => {
    expectSingleRejection(coOccurrenceWith({ support: 0.31 }), 'INCONSISTENT_SUPPORT');
  });

  it('accepts consistent confidence', () => {
    expect(validate([coOccurrenceWith({ confidence: 12 / 20 })]).validRelationships).toHaveLength(1);
  });

  it('rejects inconsistent confidence', () => {
    expectSingleRejection(coOccurrenceWith({ confidence: 0.61 }), 'INCONSISTENT_CONFIDENCE');
  });

  it('accepts consistent lift', () => {
    expect(validate([coOccurrenceWith({ lift: 0.6 / (16 / 40) })]).validRelationships).toHaveLength(1);
  });

  it('rejects inconsistent lift', () => {
    expectSingleRejection(coOccurrenceWith({ lift: 1.6 }), 'INCONSISTENT_LIFT');
  });

  it('respects numeric tolerance', () => {
    expect(validate([coOccurrenceWith({ support: 0.3 + 5e-13 })]).validRelationships).toHaveLength(1);
  });

  it('does not recalculate values', () => {
    const relationship = coOccurrenceWith({ support: 0.3, confidence: 0.6, lift: 1.5 });
    const result = validate([relationship]);
    expect(result.validRelationships[0]?.relationship.evidence).toEqual(relationship.evidence);
  });

  it('does not round metrics', () => {
    const relationship = relationshipWith({
      evidence: {
        kind: 'co_occurrence',
        jointCount: 1,
        sourceCount: 3,
        targetCount: 3,
        totalTransactions: 9,
        support: 1 / 9,
        confidence: 1 / 3,
        lift: 1,
      },
      reliability: 0.3,
    });
    const result = validate([relationship], { minimumReliability: 0.3, rejectNegativeAssociation: false });
    expect(result.validRelationships[0]?.relationship.evidence).toEqual(relationship.evidence);
  });
});

describe('DefaultProductRelationshipValidator publication policies', () => {
  it('rejects lift lower than 1 when policy is active', () => {
    const relationship = coOccurrenceWithoutCountsWith({ lift: 0.8 });
    expect(validate([relationship]).rejections[0]?.code).toBe('NON_POSITIVE_ASSOCIATION');
  });

  it('rejects lift equal to 1 when policy is active', () => {
    const relationship = coOccurrenceWithoutCountsWith({ lift: 1 });
    expect(validate([relationship]).rejections[0]?.code).toBe('NON_POSITIVE_ASSOCIATION');
  });

  it('accepts lift greater than 1', () => {
    expect(validate([coOccurrenceWithoutCountsWith({ lift: 1.01 })]).validRelationships).toHaveLength(1);
  });

  it('allows lift lower than or equal to 1 when policy is disabled', () => {
    expect(validate([coOccurrenceWithoutCountsWith({ lift: 0.8 })], permissiveParameters).validRelationships).toHaveLength(1);
  });

  it('rejects reliability below the minimum', () => {
    const relationship = relationshipWith({ reliability: 0.29 });
    expect(validate([relationship]).rejections[0]?.code).toBe('RELIABILITY_BELOW_MINIMUM');
  });

  it('accepts reliability equal to the minimum', () => {
    const relationship = relationshipWith({ reliability: 0.3 });
    expect(validate([relationship]).validRelationships).toHaveLength(1);
  });

  it('accepts reliability over the minimum', () => {
    expect(validate([baseValidatedRelationship]).validRelationships).toHaveLength(1);
  });

  it('validates parameters with Zod', () => {
    expect(relationshipValidationParametersSchema.safeParse(DEFAULT_RELATIONSHIP_VALIDATION_PARAMETERS).success).toBe(true);
  });

  it('rejects invalid minimumReliability', () => {
    expect(() => validate([baseValidatedRelationship], {
      minimumReliability: 1.1,
      rejectNegativeAssociation: true,
    })).toThrow();
  });

  it('rejects non-boolean rejectNegativeAssociation', () => {
    expect(() => validate([baseValidatedRelationship], {
      minimumReliability: 0.3,
      rejectNegativeAssociation: 'true' as unknown as boolean,
    })).toThrow();
  });
});

describe('DefaultProductRelationshipValidator duplicates', () => {
  it('rejects an exact duplicate', () => {
    const duplicate = clone(baseValidatedRelationship);
    const result = validate([baseValidatedRelationship, duplicate]);
    expect(result.rejections[0]?.code).toBe('DUPLICATE_RELATIONSHIP');
  });

  it('keeps the first occurrence of a duplicate pair', () => {
    const duplicate = clone(baseValidatedRelationship);
    const result = validate([baseValidatedRelationship, duplicate]);
    expect(result.validRelationships).toHaveLength(1);
    expect(result.validRelationships[0]?.relationship).toBe(baseValidatedRelationship);
  });

  it('accepts the inverse relationship', () => {
    expect(validate([baseValidatedRelationship, inverseValidatedRelationship]).validRelationships).toHaveLength(2);
  });

  it('accepts the same pair with another model version', () => {
    const otherVersion = relationshipWith({ modelVersion: 'same-order.1' });
    expect(validate([baseValidatedRelationship, otherVersion]).validRelationships).toHaveLength(2);
  });

  it('accepts the same pair with another evidence window', () => {
    const otherWindow = relationshipWith({
      evidenceWindow: {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-12-31T23:59:59.000Z',
      },
    });
    expect(validate([baseValidatedRelationship, otherWindow]).validRelationships).toHaveLength(2);
  });

  it('accepts the same pair with another relationship type', () => {
    expect(validate([baseValidatedRelationship, manualValidatedRelationship]).validRelationships).toHaveLength(2);
  });
});

describe('DefaultProductRelationshipValidator serialization', () => {
  it('accepts JSON-serializable evidence', () => {
    expect(validate([manualValidatedRelationship]).validRelationships).toHaveLength(1);
  });

  it('rejects BigInt values', () => {
    const relationship = relationshipWith({ evidence: { ...baseValidatedRelationship.evidence, hidden: BigInt(1) } as never });
    expectSingleRejection(relationship, 'NON_SERIALIZABLE_RELATIONSHIP');
  });

  it('rejects function values', () => {
    const relationship = relationshipWith({ evidence: { ...baseValidatedRelationship.evidence, fn: () => 1 } as never });
    expectSingleRejection(relationship, 'NON_SERIALIZABLE_RELATIONSHIP');
  });

  it('rejects symbol values', () => {
    const relationship = relationshipWith({ evidence: { ...baseValidatedRelationship.evidence, marker: Symbol('x') } as never });
    expectSingleRejection(relationship, 'NON_SERIALIZABLE_RELATIONSHIP');
  });

  it('rejects circular references', () => {
    const relationship = clone(baseValidatedRelationship) as CalculatedProductRelationship & { loop?: unknown };
    relationship.loop = relationship;
    expectSingleRejection(relationship, 'NON_SERIALIZABLE_RELATIONSHIP');
  });

  it('handles reasonably deep serializable objects', () => {
    const relationship = relationshipWith({
      evidence: {
        kind: 'rule',
        ruleId: 'manual-deep',
        ruleVersion: '2025-01',
      },
      relationshipType: 'manual',
      reliability: 0.7,
    });
    expect(validate([relationship]).validRelationships).toHaveLength(1);
  });

  it('rejects undefined properties because JSON would drop them', () => {
    const relationship = relationshipWith({ evidence: { ...baseValidatedRelationship.evidence, missing: undefined } as never });
    expectSingleRejection(relationship, 'NON_SERIALIZABLE_RELATIONSHIP');
  });
});

describe('DefaultProductRelationshipValidator statistics', () => {
  it('counts read relationships', () => {
    expect(validate(relationshipValidatorBatch).statistics.relationshipsRead).toBe(3);
  });

  it('counts accepted relationships', () => {
    expect(validate(relationshipValidatorBatch).statistics.relationshipsAccepted).toBe(3);
  });

  it('counts rejected relationships', () => {
    const result = validate([baseValidatedRelationship, relationshipWith({ reliability: 0.1 })]);
    expect(result.statistics.relationshipsRejected).toBe(1);
  });

  it('counts rejections by code', () => {
    const result = validate([
      relationshipWith({ reliability: 0.1 }),
      relationshipWith({ sourceProduct: { productId: '' } }),
    ]);
    expect(result.statistics.rejectedByCode.RELIABILITY_BELOW_MINIMUM).toBe(1);
    expect(result.statistics.rejectedByCode.INVALID_SOURCE_PRODUCT).toBe(1);
  });

  it('counts distinct accepted source products', () => {
    expect(validate(relationshipValidatorBatch).statistics.distinctSourceProductsAccepted).toBe(2);
  });

  it('counts distinct accepted target products', () => {
    expect(validate(relationshipValidatorBatch).statistics.distinctTargetProductsAccepted).toBe(3);
  });

  it('satisfies statistics invariants', () => {
    const result = validate([baseValidatedRelationship, relationshipWith({ reliability: 0.1 })]);
    expect(result.statistics.relationshipsRead).toBe(
      result.statistics.relationshipsAccepted + result.statistics.relationshipsRejected,
    );
    expect(result.statistics.relationshipsAccepted).toBe(result.validRelationships.length);
    expect(result.statistics.relationshipsRejected).toBe(result.rejections.length);
  });

  it('sums rejectedByCode to rejected count', () => {
    const result = validate([
      relationshipWith({ reliability: 0.1 }),
      relationshipWith({ sourceProduct: { productId: '' } }),
    ]);
    const total = Object.values(result.statistics.rejectedByCode).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(result.statistics.relationshipsRejected);
  });
});

describe('DefaultProductRelationshipValidator warnings', () => {
  it('emits EMPTY_INPUT', () => {
    expect(validate([]).warnings[0]?.code).toBe('EMPTY_INPUT');
  });

  it('emits NO_VALID_RELATIONSHIPS', () => {
    expect(validate([relationshipWith({ reliability: 0.1 })]).warnings[0]?.code).toBe('NO_VALID_RELATIONSHIPS');
  });

  it('emits PARTIAL_VALIDATION_SUCCESS', () => {
    const result = validate([baseValidatedRelationship, relationshipWith({ reliability: 0.1 })]);
    expect(result.warnings[0]?.code).toBe('PARTIAL_VALIDATION_SUCCESS');
  });

  it('does not emit warnings on complete success', () => {
    expect(validate(relationshipValidatorBatch).warnings).toEqual([]);
  });

  it('keeps warning details JSON serializable', () => {
    const result = validate([baseValidatedRelationship, relationshipWith({ reliability: 0.1 })]);
    expect(productRelationshipValidationResultSchema.safeParse(result).success).toBe(true);
  });
});

describe('DefaultProductRelationshipValidator determinism and boundaries', () => {
  it('produces the same result for the same input', () => {
    const first = validate([baseValidatedRelationship, relationshipWith({ reliability: 0.1 })]);
    const second = validate([baseValidatedRelationship, relationshipWith({ reliability: 0.1 })]);
    expect(second).toEqual(first);
  });

  it('uses the first error to determine rejection code', () => {
    const relationship = relationshipWith({
      sourceProduct: { productId: '' },
      targetProduct: { productId: '' },
      reliability: 0.1,
    });
    expect(validate([relationship]).rejections[0]?.code).toBe('INVALID_SOURCE_PRODUCT');
  });

  it('rejects each bad relationship only once', () => {
    const result = validate([relationshipWith({ reliability: 0.1 })]);
    expect(result.rejections).toHaveLength(1);
  });

  it('does not use the clock', () => {
    const wrapper = validate([baseValidatedRelationship]).validRelationships[0];
    expect(wrapper).toHaveProperty('validatedAtModelVersion', baseValidatedRelationship.modelVersion);
    expect(wrapper).not.toHaveProperty('validatedAt');
    expect(wrapper).not.toHaveProperty('createdAt');
    expect(wrapper).not.toHaveProperty('publishedAt');
  });

  it('does not generate IDs', () => {
    const result = validate([baseValidatedRelationship]);
    expect(result.validRelationships[0]).not.toHaveProperty('id');
    expect(result.validRelationships[0]?.relationship).not.toHaveProperty('publicationId');
  });

  it('does not perform I/O or expose runtime markers', () => {
    const serialized = JSON.stringify(validate([baseValidatedRelationship])).toLowerCase();
    expect(serialized).not.toMatch(/select |insert |prestashop|ps_|redis|neo4j|endpoint|runtime/u);
  });
});
