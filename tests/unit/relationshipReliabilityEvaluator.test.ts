import { describe, expect, it } from 'vitest';
import {
  calculatedProductRelationshipSchema,
  type CalculatedProductRelationship,
} from '../../src/domain/recommendation/relationship-engine/contracts.js';
import {
  calculateEvidenceReliability,
  defaultReliabilityEvaluationParameters,
  EvidenceBasedRelationshipReliabilityEvaluator,
  reliabilityEvaluationParametersSchema,
  relationshipReliabilityScoreSchema,
  UnsupportedRelationshipReliabilityEvidenceError,
} from '../../src/domain/recommendation/relationship-engine/reliability/index.js';
import {
  baseReliabilityCandidate,
  candidateWithEvidence,
  highReliabilityCandidate,
  lowReliabilityCandidate,
  reliabilityCandidateBatch,
} from '../fixtures/relationshipReliabilityEvaluator.js';

function evaluator() {
  return new EvidenceBasedRelationshipReliabilityEvaluator();
}

function scoreFor(candidate = baseReliabilityCandidate): number {
  return evaluator().evaluateCandidate(candidate).reliability;
}

describe('EvidenceBasedRelationshipReliabilityEvaluator conversion', () => {
  it('converts a ProductRelationshipCandidate into CalculatedProductRelationship', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(calculatedProductRelationshipSchema.safeParse(relationship).success).toBe(true);
  });

  it('preserves sourceProduct', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(relationship.sourceProduct).toEqual(baseReliabilityCandidate.sourceProduct);
  });

  it('preserves targetProduct', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(relationship.targetProduct).toEqual(baseReliabilityCandidate.targetProduct);
  });

  it('preserves relationshipType', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(relationship.relationshipType).toBe('same_order');
  });

  it('preserves complete evidence', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(relationship.evidence).toEqual(baseReliabilityCandidate.evidence);
    expect(relationship.evidence).toHaveProperty('sourceCount', 20);
    expect(relationship.evidence).toHaveProperty('targetCount', 16);
    expect(relationship.evidence).toHaveProperty('totalTransactions', 40);
  });

  it('preserves evidenceWindow', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(relationship.evidenceWindow).toEqual(baseReliabilityCandidate.evidenceWindow);
  });

  it('preserves modelVersion', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(relationship.modelVersion).toBe(baseReliabilityCandidate.modelVersion);
  });

  it('adds finite reliability', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(Number.isFinite(relationship.reliability)).toBe(true);
  });

  it('keeps reliability between 0 and 1', () => {
    expect(relationshipReliabilityScoreSchema.safeParse(scoreFor()).success).toBe(true);
  });

  it('does not add rank', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(relationship).not.toHaveProperty('rank');
  });

  it('does not add publicationId', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(relationship).not.toHaveProperty('publicationId');
  });

  it('does not mutate the candidate', () => {
    const before = JSON.stringify(baseReliabilityCandidate);
    evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(JSON.stringify(baseReliabilityCandidate)).toBe(before);
  });
});

describe('EvidenceBasedRelationshipReliabilityEvaluator formula', () => {
  it('matches the documented weighted formula', () => {
    const expected =
      0.5 * 0.6 +
      0.25 * (1 - 1 / 1.5) +
      0.1 * 0.3 +
      0.15 * (1 - Math.exp(-12 / 10));
    expect(scoreFor()).toBe(expected);
  });

  it('uses parameters whose weights sum to one', () => {
    expect(reliabilityEvaluationParametersSchema.safeParse(defaultReliabilityEvaluationParameters).success).toBe(true);
  });

  it('rejects parameter weights that do not sum to one', () => {
    expect(() => new EvidenceBasedRelationshipReliabilityEvaluator({
      ...defaultReliabilityEvaluationParameters,
      confidenceWeight: 0.6,
    })).toThrow();
  });

  it('rejects non-positive jointCountScale', () => {
    expect(() => new EvidenceBasedRelationshipReliabilityEvaluator({
      ...defaultReliabilityEvaluationParameters,
      jointCountScale: 0,
    })).toThrow();
  });

  it('higher confidence increases reliability when other evidence is fixed', () => {
    const low = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, confidence: 0.2 });
    const high = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, confidence: 0.8 });
    expect(scoreFor(high)).toBeGreaterThan(scoreFor(low));
  });

  it('higher lift increases reliability when other evidence is fixed', () => {
    const low = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, lift: 1 });
    const high = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, lift: 2 });
    expect(scoreFor(high)).toBeGreaterThan(scoreFor(low));
  });

  it('does not reward lift below one', () => {
    const belowOne = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, lift: 0.5 });
    const exactlyOne = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, lift: 1 });
    expect(scoreFor(belowOne)).toBe(scoreFor(exactlyOne));
  });

  it('scores lift two as a 0.5 lift contribution before weighting', () => {
    const candidate = candidateWithEvidence({
      ...baseReliabilityCandidate.evidence,
      confidence: 0,
      support: 0,
      jointCount: 0,
      lift: 2,
    });
    expect(scoreFor(candidate)).toBe(0.25 * 0.5);
  });

  it('scores lift four as a 0.75 lift contribution before weighting', () => {
    const candidate = candidateWithEvidence({
      ...baseReliabilityCandidate.evidence,
      confidence: 0,
      support: 0,
      jointCount: 0,
      lift: 4,
    });
    expect(scoreFor(candidate)).toBe(0.25 * 0.75);
  });

  it('higher support increases reliability when other evidence is fixed', () => {
    const low = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, support: 0.1 });
    const high = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, support: 0.5 });
    expect(scoreFor(high)).toBeGreaterThan(scoreFor(low));
  });

  it('higher jointCount increases reliability with diminishing returns', () => {
    const low = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, jointCount: 2 });
    const high = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, jointCount: 30 });
    expect(scoreFor(high)).toBeGreaterThan(scoreFor(low));
  });

  it('uses the configured jointCountScale', () => {
    const candidate = candidateWithEvidence({
      ...baseReliabilityCandidate.evidence,
      confidence: 0,
      lift: 1,
      support: 0,
      jointCount: 10,
    });
    expect(scoreFor(candidate)).toBe(0.15 * (1 - Math.exp(-1)));
  });

  it('allows overriding jointCountScale', () => {
    const candidate = candidateWithEvidence({
      ...baseReliabilityCandidate.evidence,
      confidence: 0,
      lift: 1,
      support: 0,
      jointCount: 10,
    });
    const custom = new EvidenceBasedRelationshipReliabilityEvaluator({
      ...defaultReliabilityEvaluationParameters,
      jointCountScale: 20,
    });
    expect(custom.evaluateCandidate(candidate).reliability).toBe(0.15 * (1 - Math.exp(-0.5)));
  });

  it('low evidence produces lower reliability than high evidence', () => {
    expect(scoreFor(highReliabilityCandidate)).toBeGreaterThan(scoreFor(lowReliabilityCandidate));
  });

  it('zero evidence stays non-negative', () => {
    const zero = candidateWithEvidence({
      kind: 'co_occurrence',
      jointCount: 0,
      sourceCount: 0,
      targetCount: 0,
      totalTransactions: 0,
      support: 0,
      confidence: 0,
      lift: 0,
    });
    expect(scoreFor(zero)).toBe(0);
  });

  it('very high lift is bounded by 1', () => {
    const highLift = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, lift: 1000 });
    expect(scoreFor(highLift)).toBeLessThanOrEqual(1);
  });

  it('does not recalculate support', () => {
    const candidate = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, support: 0.99 });
    const relationship = evaluator().evaluateCandidate(candidate);
    expect(relationship.evidence.kind).toBe('co_occurrence');
    if (relationship.evidence.kind !== 'co_occurrence') throw new Error('Expected co_occurrence evidence');
    expect(relationship.evidence.support).toBe(0.99);
  });

  it('does not recalculate confidence', () => {
    const candidate = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, confidence: 0.33 });
    const relationship = evaluator().evaluateCandidate(candidate);
    expect(relationship.evidence.kind).toBe('co_occurrence');
    if (relationship.evidence.kind !== 'co_occurrence') throw new Error('Expected co_occurrence evidence');
    expect(relationship.evidence.confidence).toBe(0.33);
  });

  it('does not recalculate lift', () => {
    const candidate = candidateWithEvidence({ ...baseReliabilityCandidate.evidence, lift: 3.25 });
    const relationship = evaluator().evaluateCandidate(candidate);
    expect(relationship.evidence.kind).toBe('co_occurrence');
    if (relationship.evidence.kind !== 'co_occurrence') throw new Error('Expected co_occurrence evidence');
    expect(relationship.evidence.lift).toBe(3.25);
  });

  it('uses only evidence for numeric evaluation', () => {
    const first = evaluator().evaluateCandidate({
      ...baseReliabilityCandidate,
      sourceProduct: { productId: 'X' },
      targetProduct: { productId: 'Y' },
    });
    const second = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(first.reliability).toBe(second.reliability);
  });
});

describe('EvidenceBasedRelationshipReliabilityEvaluator batch behavior', () => {
  it('evaluates candidates in batch', () => {
    const relationships = evaluator().evaluateCandidates(reliabilityCandidateBatch);
    expect(relationships).toHaveLength(3);
  });

  it('preserves batch order', () => {
    const relationships = evaluator().evaluateCandidates(reliabilityCandidateBatch);
    expect(relationships.map((relationship) => relationship.targetProduct.productId)).toEqual(['B', 'C', 'A']);
  });

  it('returns schema-valid relationships in batch', () => {
    const relationships = evaluator().evaluateCandidates(reliabilityCandidateBatch);
    expect(relationships.every((relationship) => calculatedProductRelationshipSchema.safeParse(relationship).success)).toBe(true);
  });

  it('is deterministic for same input', () => {
    const first = evaluator().evaluateCandidates(reliabilityCandidateBatch);
    const second = evaluator().evaluateCandidates(reliabilityCandidateBatch);
    expect(second).toEqual(first);
  });
});

describe('EvidenceBasedRelationshipReliabilityEvaluator compatibility', () => {
  it('implements numeric RelationshipReliabilityEvaluator contract', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    const withoutReliability: Omit<CalculatedProductRelationship, 'reliability'> = {
      sourceProduct: relationship.sourceProduct,
      targetProduct: relationship.targetProduct,
      relationshipType: relationship.relationshipType,
      evidence: relationship.evidence,
      evidenceWindow: relationship.evidenceWindow,
      modelVersion: relationship.modelVersion,
    };
    expect(evaluator().evaluate(withoutReliability)).toBe(relationship.reliability);
  });

  it('accepts complete same_order evidence in CalculatedProductRelationship schema', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(calculatedProductRelationshipSchema.safeParse(relationship).success).toBe(true);
  });

  it('rejects incompatible calculated relationship evidence', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    const invalid: CalculatedProductRelationship = {
      ...relationship,
      relationshipType: 'manual',
    };
    expect(calculatedProductRelationshipSchema.safeParse(invalid).success).toBe(false);
  });

  it('does not output SQL or PrestaShop markers', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(JSON.stringify(relationship).toLowerCase()).not.toMatch(/select |prestashop|ps_/u);
  });

  it('does not output runtime publication fields', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(relationship).not.toHaveProperty('publishedAt');
    expect(relationship).not.toHaveProperty('publication');
  });

  it('does not personalize by customer', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    expect(JSON.stringify(relationship).toLowerCase()).not.toContain('customer');
  });
});

describe('calculateEvidenceReliability helper', () => {
  it('calculates co_occurrence reliability directly', () => {
    expect(calculateEvidenceReliability(baseReliabilityCandidate.evidence)).toBe(scoreFor());
  });

  it('rejects transition evidence through the generic evaluator', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    const unsupportedRelationship: Omit<CalculatedProductRelationship, 'reliability'> = {
      sourceProduct: relationship.sourceProduct,
      targetProduct: relationship.targetProduct,
      relationshipType: 'next_purchase',
      evidence: {
        kind: 'transition',
        transitionCount: 5,
        transitionProbability: 0.4,
        medianLagDays: 10,
      },
      evidenceWindow: relationship.evidenceWindow,
      modelVersion: relationship.modelVersion,
    };
    expect(() => evaluator().evaluate(unsupportedRelationship)).toThrow(UnsupportedRelationshipReliabilityEvidenceError);
  });

  it('rejects rule evidence through the generic evaluator', () => {
    const relationship = evaluator().evaluateCandidate(baseReliabilityCandidate);
    const unsupportedRelationship: Omit<CalculatedProductRelationship, 'reliability'> = {
      sourceProduct: relationship.sourceProduct,
      targetProduct: relationship.targetProduct,
      relationshipType: 'manual',
      evidence: {
        kind: 'rule',
        ruleId: 'manual-001',
        ruleVersion: '2026-07-01',
      },
      evidenceWindow: relationship.evidenceWindow,
      modelVersion: relationship.modelVersion,
    };
    expect(() => evaluator().evaluate(unsupportedRelationship)).toThrow(UnsupportedRelationshipReliabilityEvidenceError);
  });
});
