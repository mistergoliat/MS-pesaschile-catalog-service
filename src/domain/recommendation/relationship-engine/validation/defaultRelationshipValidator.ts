import {
  calculatedProductRelationshipSchema,
  productRelationshipProductReferenceSchema,
  relationshipDataWindowSchema,
  type CalculatedProductRelationship,
  type ProductRelationshipProductReference,
} from '../contracts.js';
import {
  DEFAULT_RELATIONSHIP_VALIDATION_PARAMETERS,
  RELATIONSHIP_METRIC_TOLERANCE,
  productRelationshipValidationResultSchema,
  relationshipValidationParametersSchema,
  type ProductRelationshipValidationRejection,
  type ProductRelationshipValidationRejectionCode,
  type ProductRelationshipValidationResult,
  type ProductRelationshipValidationStatistics,
  type ProductRelationshipValidationWarning,
  type ProductRelationshipValidator,
  type RelationshipValidationParameters,
  type ValidatedProductRelationship,
} from './contracts.js';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonSerializable(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return false;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return value.every((item) => isJsonSerializable(item, seen));
  }
  if (isPlainRecord(value)) {
    if (value instanceof Error || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return Object.values(value).every((item) => isJsonSerializable(item, seen));
  }
  return false;
}

function productIdentity(product: ProductRelationshipProductReference): string {
  return `${product.productId}:${product.combinationId ?? ''}`;
}

function evidenceWindowIdentity(relationship: CalculatedProductRelationship): string {
  return `${relationship.evidenceWindow.from}:${relationship.evidenceWindow.to}`;
}

function duplicateIdentity(relationship: CalculatedProductRelationship): string {
  return [
    productIdentity(relationship.sourceProduct),
    productIdentity(relationship.targetProduct),
    relationship.relationshipType,
    relationship.modelVersion,
    evidenceWindowIdentity(relationship),
  ].join('|');
}

function isSupportedRelationshipType(value: unknown): boolean {
  return [
    'same_cart',
    'same_order',
    'next_purchase',
    'customer_history',
    'technical_compatibility',
    'manual',
  ].includes(String(value));
}

function evidenceKindMatches(relationship: CalculatedProductRelationship): boolean {
  const evidence = relationship.evidence as unknown;
  if (!isPlainRecord(evidence) || typeof evidence.kind !== 'string') {
    return false;
  }
  if (evidence.kind === 'co_occurrence') {
    return ['same_cart', 'same_order', 'customer_history'].includes(String(relationship.relationshipType));
  }
  if (evidence.kind === 'transition') {
    return relationship.relationshipType === 'next_purchase';
  }
  if (evidence.kind === 'rule') {
    return ['technical_compatibility', 'manual'].includes(String(relationship.relationshipType));
  }
  return false;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= RELATIONSHIP_METRIC_TOLERANCE;
}

function reject(
  index: number,
  code: ProductRelationshipValidationRejectionCode,
  message: string,
  relationship?: CalculatedProductRelationship,
  details?: unknown,
): ProductRelationshipValidationRejection {
  return {
    index,
    code,
    message,
    ...(relationship ? { relationship } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

export class DefaultProductRelationshipValidator implements ProductRelationshipValidator {
  validate(input: {
    relationships: CalculatedProductRelationship[];
    parameters?: RelationshipValidationParameters;
  }): ProductRelationshipValidationResult {
    const parameters = relationshipValidationParametersSchema.parse(
      input.parameters ?? DEFAULT_RELATIONSHIP_VALIDATION_PARAMETERS,
    );
    const validRelationships: ValidatedProductRelationship[] = [];
    const rejections: ProductRelationshipValidationRejection[] = [];
    const warnings: ProductRelationshipValidationWarning[] = [];
    const seenRelationships = new Set<string>();

    for (const [index, relationship] of input.relationships.entries()) {
      const rejection = this.validateOne(index, relationship, parameters, seenRelationships);
      if (rejection) {
        rejections.push(rejection);
        continue;
      }

      seenRelationships.add(duplicateIdentity(relationship));
      validRelationships.push({
        relationship,
        validatedAtModelVersion: relationship.modelVersion,
      });
    }

    if (input.relationships.length === 0) {
      warnings.push({
        code: 'EMPTY_INPUT',
        message: 'No relationships were provided for validation',
      });
    } else if (validRelationships.length === 0) {
      warnings.push({
        code: 'NO_VALID_RELATIONSHIPS',
        message: 'No relationships passed validation',
      });
    } else if (rejections.length > 0) {
      warnings.push({
        code: 'PARTIAL_VALIDATION_SUCCESS',
        message: 'Some relationships passed validation and some were rejected',
        details: {
          accepted: validRelationships.length,
          rejected: rejections.length,
        },
      });
    }

    const statistics = this.createStatistics(input.relationships.length, validRelationships, rejections);
    const result: ProductRelationshipValidationResult = {
      validRelationships,
      rejections,
      warnings,
      statistics,
    };
    productRelationshipValidationResultSchema.parse(result);
    return result;
  }

  private validateOne(
    index: number,
    relationship: CalculatedProductRelationship,
    parameters: RelationshipValidationParameters,
    seenRelationships: Set<string>,
  ): ProductRelationshipValidationRejection | null {
    if (!isJsonSerializable(relationship)) {
      return reject(index, 'NON_SERIALIZABLE_RELATIONSHIP', 'Relationship is not JSON serializable');
    }

    if (!productRelationshipProductReferenceSchema.safeParse(relationship.sourceProduct).success) {
      return reject(index, 'INVALID_SOURCE_PRODUCT', 'sourceProduct is invalid', undefined, {
        sourceProduct: relationship.sourceProduct,
      });
    }

    if (!productRelationshipProductReferenceSchema.safeParse(relationship.targetProduct).success) {
      return reject(index, 'INVALID_TARGET_PRODUCT', 'targetProduct is invalid', undefined, {
        targetProduct: relationship.targetProduct,
      });
    }

    if (productIdentity(relationship.sourceProduct) === productIdentity(relationship.targetProduct)) {
      return reject(index, 'SELF_RELATIONSHIP', 'Relationship source and target must be different', relationship);
    }

    if (!isSupportedRelationshipType(relationship.relationshipType)) {
      return reject(index, 'UNSUPPORTED_RELATIONSHIP_TYPE', 'relationshipType is not supported', undefined, {
        relationshipType: relationship.relationshipType,
      });
    }

    if (!evidenceKindMatches(relationship)) {
      return reject(index, 'EVIDENCE_TYPE_MISMATCH', 'Evidence kind is incompatible with relationshipType', relationship);
    }

    if (!relationshipDataWindowSchema.safeParse(relationship.evidenceWindow).success) {
      return reject(index, 'INVALID_EVIDENCE_WINDOW', 'evidenceWindow is invalid', undefined, {
        evidenceWindow: relationship.evidenceWindow,
      });
    }

    if (typeof relationship.modelVersion !== 'string' || relationship.modelVersion.trim().length === 0) {
      return reject(index, 'INVALID_MODEL_VERSION', 'modelVersion must be non-empty', undefined, {
        modelVersion: relationship.modelVersion,
      });
    }

    const numericRejection = this.validateNumericEvidence(index, relationship);
    if (numericRejection) {
      return numericRejection;
    }

    const consistencyRejection = this.validateConsistency(index, relationship);
    if (consistencyRejection) {
      return consistencyRejection;
    }

    if (
      parameters.rejectNegativeAssociation &&
      relationship.evidence.kind === 'co_occurrence' &&
      relationship.evidence.lift <= 1
    ) {
      return reject(index, 'NON_POSITIVE_ASSOCIATION', 'co_occurrence lift must be greater than 1', relationship);
    }

    if (relationship.reliability < parameters.minimumReliability) {
      return reject(index, 'RELIABILITY_BELOW_MINIMUM', 'reliability is below configured minimum', relationship, {
        minimumReliability: parameters.minimumReliability,
      });
    }

    if (seenRelationships.has(duplicateIdentity(relationship))) {
      return reject(index, 'DUPLICATE_RELATIONSHIP', 'Duplicate relationship was rejected', relationship);
    }

    if (!calculatedProductRelationshipSchema.safeParse(relationship).success) {
      return reject(index, 'NON_SERIALIZABLE_RELATIONSHIP', 'Relationship does not satisfy calculated relationship contract');
    }

    return null;
  }

  private validateNumericEvidence(
    index: number,
    relationship: CalculatedProductRelationship,
  ): ProductRelationshipValidationRejection | null {
    if (!Number.isFinite(relationship.reliability) || relationship.reliability < 0 || relationship.reliability > 1) {
      return reject(index, 'INVALID_RELIABILITY', 'reliability must be between 0 and 1', undefined, {
        reliability: relationship.reliability,
      });
    }

    const evidence = relationship.evidence;
    if (evidence.kind !== 'co_occurrence') {
      return null;
    }

    if (!Number.isFinite(evidence.support) || evidence.support < 0 || evidence.support > 1) {
      return reject(index, 'INVALID_SUPPORT', 'support must be between 0 and 1', undefined, {
        support: evidence.support,
      });
    }
    if (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1) {
      return reject(index, 'INVALID_CONFIDENCE', 'confidence must be between 0 and 1', undefined, {
        confidence: evidence.confidence,
      });
    }
    if (!Number.isFinite(evidence.lift) || evidence.lift < 0) {
      return reject(index, 'INVALID_LIFT', 'lift must be finite and non-negative', undefined, {
        lift: evidence.lift,
      });
    }
    if (!Number.isInteger(evidence.jointCount) || evidence.jointCount < 0) {
      return reject(index, 'INVALID_JOINT_COUNT', 'jointCount must be an integer >= 0', undefined, {
        jointCount: evidence.jointCount,
      });
    }
    if (relationship.relationshipType === 'same_order' && evidence.jointCount === 0) {
      return reject(index, 'INVALID_JOINT_COUNT', 'same_order jointCount must be greater than zero', relationship);
    }

    for (const countKey of ['sourceCount', 'targetCount', 'totalTransactions'] as const) {
      const value = evidence[countKey];
      if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
        return reject(index, 'INVALID_EVIDENCE_COUNTS', `${countKey} must be a positive integer`, undefined, {
          [countKey]: value,
        });
      }
    }

    return null;
  }

  private validateConsistency(
    index: number,
    relationship: CalculatedProductRelationship,
  ): ProductRelationshipValidationRejection | null {
    const evidence = relationship.evidence;
    if (
      evidence.kind !== 'co_occurrence' ||
      evidence.sourceCount === undefined ||
      evidence.targetCount === undefined ||
      evidence.totalTransactions === undefined
    ) {
      return null;
    }

    if (
      evidence.jointCount > evidence.sourceCount ||
      evidence.jointCount > evidence.targetCount ||
      evidence.sourceCount > evidence.totalTransactions ||
      evidence.targetCount > evidence.totalTransactions
    ) {
      return reject(index, 'INCONSISTENT_EVIDENCE_COUNTS', 'Evidence counts are mathematically inconsistent', relationship);
    }

    const expectedSupport = evidence.jointCount / evidence.totalTransactions;
    if (!approximatelyEqual(evidence.support, expectedSupport)) {
      return reject(index, 'INCONSISTENT_SUPPORT', 'support is inconsistent with jointCount and totalTransactions', relationship, {
        expectedSupport,
        actualSupport: evidence.support,
      });
    }

    const expectedConfidence = evidence.jointCount / evidence.sourceCount;
    if (!approximatelyEqual(evidence.confidence, expectedConfidence)) {
      return reject(index, 'INCONSISTENT_CONFIDENCE', 'confidence is inconsistent with jointCount and sourceCount', relationship, {
        expectedConfidence,
        actualConfidence: evidence.confidence,
      });
    }

    const targetProbability = evidence.targetCount / evidence.totalTransactions;
    if (targetProbability > 0) {
      const expectedLift = evidence.confidence / targetProbability;
      if (!approximatelyEqual(evidence.lift, expectedLift)) {
        return reject(index, 'INCONSISTENT_LIFT', 'lift is inconsistent with confidence and target probability', relationship, {
          expectedLift,
          actualLift: evidence.lift,
        });
      }
    }

    return null;
  }

  private createStatistics(
    relationshipsRead: number,
    validRelationships: ValidatedProductRelationship[],
    rejections: ProductRelationshipValidationRejection[],
  ): ProductRelationshipValidationStatistics {
    const rejectedByCode: ProductRelationshipValidationStatistics['rejectedByCode'] = {};
    for (const rejection of rejections) {
      rejectedByCode[rejection.code] = (rejectedByCode[rejection.code] ?? 0) + 1;
    }

    return {
      relationshipsRead,
      relationshipsAccepted: validRelationships.length,
      relationshipsRejected: rejections.length,
      rejectedByCode,
      distinctSourceProductsAccepted: new Set(
        validRelationships.map((item) => productIdentity(item.relationship.sourceProduct)),
      ).size,
      distinctTargetProductsAccepted: new Set(
        validRelationships.map((item) => productIdentity(item.relationship.targetProduct)),
      ).size,
    };
  }
}
