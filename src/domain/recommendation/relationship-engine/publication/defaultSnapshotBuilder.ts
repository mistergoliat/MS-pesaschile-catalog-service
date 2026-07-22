import { createHash } from 'node:crypto';
import type { CalculatedProductRelationship } from '../contracts.js';
import {
  validatedProductRelationshipSchema,
  type ValidatedProductRelationship,
} from '../validation/contracts.js';
import {
  DEFAULT_PRODUCT_RELATIONSHIP_SNAPSHOT_PUBLICATION_PARAMETERS,
  emptyProductRelationshipSnapshotMetadataSchema,
  productRelationshipSnapshotBuildResultSchema,
  productRelationshipSnapshotSchema,
  productRelationshipSnapshotPublicationParametersSchema,
  type EmptyProductRelationshipSnapshotMetadata,
  type JsonValue,
  type ProductRelationshipSnapshot,
  type ProductRelationshipSnapshotBuildResult,
  type ProductRelationshipSnapshotBuildStatistics,
  type ProductRelationshipSnapshotBuildWarning,
  type ProductRelationshipSnapshotBuilder,
  type ProductRelationshipSnapshotPublicationParameters,
} from './contracts.js';
import { canonicalizeJson, cloneJsonValue, deepFreeze } from './canonicalJson.js';
import { ProductRelationshipSnapshotBuildError } from './errors.js';

const SCHEMA_VERSION = '1' as const;

function productIdentity(product: CalculatedProductRelationship['sourceProduct']): string {
  return JSON.stringify([product.productId, product.combinationId ?? null]);
}

function directedRelationshipIdentity(relationship: CalculatedProductRelationship): string {
  return [
    productIdentity(relationship.sourceProduct),
    productIdentity(relationship.targetProduct),
    relationship.relationshipType,
    relationship.modelVersion,
    relationship.evidenceWindow.from,
    relationship.evidenceWindow.to,
  ].join('|');
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareOptionalCombination(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return compareStrings(left, right);
}

export function compareRelationshipsCanonically(
  left: CalculatedProductRelationship,
  right: CalculatedProductRelationship,
): number {
  return (
    compareStrings(left.sourceProduct.productId, right.sourceProduct.productId) ||
    compareOptionalCombination(left.sourceProduct.combinationId, right.sourceProduct.combinationId) ||
    compareStrings(left.targetProduct.productId, right.targetProduct.productId) ||
    compareOptionalCombination(left.targetProduct.combinationId, right.targetProduct.combinationId) ||
    compareStrings(left.relationshipType, right.relationshipType) ||
    compareStrings(left.modelVersion, right.modelVersion) ||
    compareStrings(left.evidenceWindow.from, right.evidenceWindow.from) ||
    compareStrings(left.evidenceWindow.to, right.evidenceWindow.to)
  );
}

export function createSnapshotIdentityPayload(input: {
  modelVersion: string;
  evidenceWindow: ProductRelationshipSnapshot['evidenceWindow'];
  relationships: readonly CalculatedProductRelationship[];
}): JsonValue {
  return {
    schemaVersion: SCHEMA_VERSION,
    modelVersion: input.modelVersion,
    evidenceWindow: {
      from: input.evidenceWindow.from,
      to: input.evidenceWindow.to,
    },
    relationships: cloneJsonValue(input.relationships) as unknown as JsonValue,
  };
}

export function createProductRelationshipSnapshotId(input: {
  modelVersion: string;
  evidenceWindow: ProductRelationshipSnapshot['evidenceWindow'];
  relationships: readonly CalculatedProductRelationship[];
}): string {
  try {
    const canonicalContent = canonicalizeJson(createSnapshotIdentityPayload(input));
    return `sha256:${createHash('sha256').update(canonicalContent).digest('hex')}`;
  } catch (error) {
    throw new ProductRelationshipSnapshotBuildError(
      'SNAPSHOT_HASH_FAILURE',
      'Snapshot hash could not be calculated',
      {
        reason: error instanceof Error ? error.message : 'unknown',
      },
    );
  }
}

function createStatistics(relationships: readonly CalculatedProductRelationship[]): ProductRelationshipSnapshotBuildStatistics {
  return {
    relationshipsRead: relationships.length,
    relationshipsPublished: relationships.length,
    distinctSourceProducts: new Set(relationships.map((relationship) => productIdentity(relationship.sourceProduct))).size,
    distinctTargetProducts: new Set(relationships.map((relationship) => productIdentity(relationship.targetProduct))).size,
    distinctDirectedPairs: new Set(
      relationships.map((relationship) => `${productIdentity(relationship.sourceProduct)}->${productIdentity(relationship.targetProduct)}`),
    ).size,
  };
}

function assertSerializable(value: unknown, details: Record<string, JsonValue>): void {
  try {
    canonicalizeJson(value);
  } catch (error) {
    throw new ProductRelationshipSnapshotBuildError(
      'NON_SERIALIZABLE_SNAPSHOT_CONTENT',
      'Snapshot content is not JSON serializable',
      {
        ...details,
        reason: error instanceof Error ? error.message : 'unknown',
      },
    );
  }
}

function validateNonEmptyWrappers(
  wrappers: readonly ValidatedProductRelationship[],
): CalculatedProductRelationship[] {
  const relationships: CalculatedProductRelationship[] = [];
  const seen = new Set<string>();

  for (const [index, wrapper] of wrappers.entries()) {
    assertSerializable(wrapper, { index });

    if (
      typeof wrapper !== 'object' ||
      wrapper === null ||
      !('relationship' in wrapper) ||
      typeof wrapper.relationship !== 'object' ||
      wrapper.relationship === null ||
      !('validatedAtModelVersion' in wrapper) ||
      typeof wrapper.validatedAtModelVersion !== 'string'
    ) {
      throw new ProductRelationshipSnapshotBuildError('INVALID_VALIDATED_WRAPPER', 'Validated wrapper is invalid', { index });
    }

    if (wrapper.validatedAtModelVersion !== wrapper.relationship.modelVersion) {
      throw new ProductRelationshipSnapshotBuildError(
        'MODEL_VERSION_MISMATCH',
        'validatedAtModelVersion must match relationship.modelVersion',
        { index },
      );
    }

    if (!validatedProductRelationshipSchema.safeParse(wrapper).success) {
      throw new ProductRelationshipSnapshotBuildError('INVALID_VALIDATED_WRAPPER', 'Validated wrapper is invalid', { index });
    }

    const relationship = wrapper.relationship;
    const firstRelationship = relationships[0];
    if (firstRelationship && relationship.modelVersion !== firstRelationship.modelVersion) {
      throw new ProductRelationshipSnapshotBuildError('MIXED_MODEL_VERSIONS', 'All relationships must share modelVersion', {
        index,
        expected: firstRelationship.modelVersion,
        actual: relationship.modelVersion,
      });
    }
    if (
      firstRelationship &&
      (
        relationship.evidenceWindow.from !== firstRelationship.evidenceWindow.from ||
        relationship.evidenceWindow.to !== firstRelationship.evidenceWindow.to
      )
    ) {
      throw new ProductRelationshipSnapshotBuildError('MIXED_EVIDENCE_WINDOWS', 'All relationships must share evidenceWindow', {
        index,
        expectedFrom: firstRelationship.evidenceWindow.from,
        expectedTo: firstRelationship.evidenceWindow.to,
        actualFrom: relationship.evidenceWindow.from,
        actualTo: relationship.evidenceWindow.to,
      });
    }

    const identity = directedRelationshipIdentity(relationship);
    if (seen.has(identity)) {
      throw new ProductRelationshipSnapshotBuildError(
        'DUPLICATE_VALIDATED_RELATIONSHIP',
        'Duplicate validated relationship detected',
        { index },
      );
    }
    seen.add(identity);
    relationships.push(relationship);
  }

  return relationships;
}

function buildFrozenSnapshot(input: {
  modelVersion: string;
  evidenceWindow: ProductRelationshipSnapshot['evidenceWindow'];
  relationships: readonly CalculatedProductRelationship[];
}): ProductRelationshipSnapshot {
  const sortedRelationships = [...input.relationships]
    .sort(compareRelationshipsCanonically)
    .map((relationship) => cloneJsonValue(relationship));

  const snapshotId = createProductRelationshipSnapshotId({
    modelVersion: input.modelVersion,
    evidenceWindow: input.evidenceWindow,
    relationships: sortedRelationships,
  });

  const snapshot: ProductRelationshipSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId,
    modelVersion: input.modelVersion,
    evidenceWindow: cloneJsonValue(input.evidenceWindow),
    relationshipCount: sortedRelationships.length,
    relationships: sortedRelationships,
  };

  assertSerializable(snapshot, { snapshotId });
  productRelationshipSnapshotSchema.parse(snapshot);
  return deepFreeze(snapshot);
}

export class DefaultProductRelationshipSnapshotBuilder implements ProductRelationshipSnapshotBuilder {
  build(input: {
    relationships: readonly ValidatedProductRelationship[];
    parameters?: ProductRelationshipSnapshotPublicationParameters;
    emptySnapshotMetadata?: EmptyProductRelationshipSnapshotMetadata;
  }): ProductRelationshipSnapshotBuildResult {
    const parameters = productRelationshipSnapshotPublicationParametersSchema.parse(
      input.parameters ?? DEFAULT_PRODUCT_RELATIONSHIP_SNAPSHOT_PUBLICATION_PARAMETERS,
    );

    if (input.relationships.length === 0) {
      return this.buildEmptySnapshot(parameters, input.emptySnapshotMetadata);
    }

    const relationships = validateNonEmptyWrappers(input.relationships);
    const firstRelationship = relationships[0];
    if (!firstRelationship) {
      throw new ProductRelationshipSnapshotBuildError('EMPTY_SNAPSHOT_NOT_ALLOWED', 'Empty snapshots are not allowed by default');
    }

    const snapshot = buildFrozenSnapshot({
      modelVersion: firstRelationship.modelVersion,
      evidenceWindow: firstRelationship.evidenceWindow,
      relationships,
    });
    const result: ProductRelationshipSnapshotBuildResult = {
      snapshot,
      statistics: createStatistics(snapshot.relationships),
      warnings: [],
    };
    productRelationshipSnapshotBuildResultSchema.parse(result);
    return result;
  }

  private buildEmptySnapshot(
    parameters: ProductRelationshipSnapshotPublicationParameters,
    emptySnapshotMetadata: EmptyProductRelationshipSnapshotMetadata | undefined,
  ): ProductRelationshipSnapshotBuildResult {
    if (!parameters.allowEmptySnapshot) {
      throw new ProductRelationshipSnapshotBuildError('EMPTY_SNAPSHOT_NOT_ALLOWED', 'Empty snapshots are not allowed by default');
    }
    if (!emptySnapshotMetadata) {
      throw new ProductRelationshipSnapshotBuildError(
        'EMPTY_SNAPSHOT_METADATA_REQUIRED',
        'Empty snapshot metadata is required when publishing an empty snapshot',
      );
    }
    const parsedMetadata = emptyProductRelationshipSnapshotMetadataSchema.safeParse(emptySnapshotMetadata);
    if (!parsedMetadata.success) {
      throw new ProductRelationshipSnapshotBuildError(
        'INVALID_EMPTY_SNAPSHOT_METADATA',
        'Empty snapshot metadata is invalid',
      );
    }

    const snapshot = buildFrozenSnapshot({
      modelVersion: parsedMetadata.data.modelVersion,
      evidenceWindow: parsedMetadata.data.evidenceWindow,
      relationships: [],
    });
    const warnings: ProductRelationshipSnapshotBuildWarning[] = [
      {
        code: 'EMPTY_SNAPSHOT_PUBLISHED',
        message: 'An empty relationship snapshot was published explicitly',
      },
    ];
    const result: ProductRelationshipSnapshotBuildResult = {
      snapshot,
      statistics: createStatistics(snapshot.relationships),
      warnings,
    };
    productRelationshipSnapshotBuildResultSchema.parse(result);
    return result;
  }
}
