import { createHash } from 'node:crypto';
import {
  type CommercialProductOntologyRegistryVersion,
  computeCommercialProductOntologyRegistryHash,
  getCommercialProductOntologyRegistry,
  getOntologyTag,
  isAllowedEvidenceSource,
  isResidualOntologyTag,
} from '../commercial-product-ontology/index.js';
import { computeClassificationChecksum } from '../product-semantic-classification/index.js';
import type { ProductSemanticClassificationResult } from '../product-semantic-classification/index.js';
import { canonicalizeJson, cloneJsonValue, deepFreeze } from './canonicalJson.js';
import {
  countProductSemanticClassificationStatuses,
  productIdComparator,
  productSemanticSnapshotBuildParametersSchema,
  productSemanticSnapshotBuildResultSchema,
  productSemanticSnapshotSchema,
  semanticFactCount,
  toSnapshotEvidence,
  toSnapshotTag,
  type JsonValue,
  type ProductSemanticSnapshot,
  type ProductSemanticSnapshotBuildParameters,
  type ProductSemanticSnapshotBuildResult,
  type ProductSemanticSnapshotBuilder,
  type ProductSemanticSnapshotFact,
} from './contracts.js';
import { ProductSemanticSnapshotBuildError } from './errors.js';

const SCHEMA_VERSION = '1' as const;

function assertSerializable(value: unknown, details: Record<string, JsonValue>): void {
  try {
    canonicalizeJson(value);
  } catch (error) {
    throw new ProductSemanticSnapshotBuildError(
      'NON_SERIALIZABLE_SNAPSHOT_CONTENT',
      'Snapshot content is not JSON serializable',
      {
        ...details,
        reason: error instanceof Error ? error.message : 'unknown',
      },
    );
  }
}

function assertOntologyConsistency(results: readonly ProductSemanticClassificationResult[]): {
  readonly ontologyVersion: CommercialProductOntologyRegistryVersion;
  readonly ontologyHash: string;
} {
  const first = results[0];
  if (!first) {
    throw new ProductSemanticSnapshotBuildError('EMPTY_SOURCE_PRODUCTS', 'Product semantic snapshot build requires at least one classification result');
  }
  const ontologyVersion = first.registryVersion as CommercialProductOntologyRegistryVersion;
  const ontologyHash = first.registryHash;
  const expectedHash = computeCommercialProductOntologyRegistryHash(getCommercialProductOntologyRegistry(ontologyVersion));
  if (expectedHash !== ontologyHash) {
    throw new ProductSemanticSnapshotBuildError(
      'ONTOLOGY_HASH_MISMATCH',
      'Classification results carry an ontology hash that does not match the active ontology registry',
      { ontologyVersion, expectedHash, actualHash: ontologyHash },
    );
  }

  for (const [index, result] of results.entries()) {
    if (result.registryVersion !== ontologyVersion) {
      throw new ProductSemanticSnapshotBuildError(
        'MIXED_ONTOLOGY_VERSIONS',
        'All classification results must share the same ontology version',
        { index, expected: ontologyVersion, actual: result.registryVersion },
      );
    }
    if (result.registryHash !== ontologyHash) {
      throw new ProductSemanticSnapshotBuildError(
        'MIXED_ONTOLOGY_HASHES',
        'All classification results must share the same ontology hash',
        { index, expected: ontologyHash, actual: result.registryHash },
      );
    }
  }

  return { ontologyVersion, ontologyHash };
}

function ensureKnownTag(
  result: ProductSemanticClassificationResult,
  tag: NonNullable<ProductSemanticClassificationResult['primaryProductFamily']>,
  index: number,
  path: string,
): void {
  const ontologyVersion = result.registryVersion as CommercialProductOntologyRegistryVersion;
  const ontologyTag = getOntologyTag(tag.axis, tag.code, ontologyVersion);
  if (!ontologyTag) {
    throw new ProductSemanticSnapshotBuildError(
      'UNKNOWN_ONTOLOGY_TAG',
      'Snapshot record references an ontology tag that does not exist in the active registry',
      { index, productId: result.productId, path, axis: tag.axis, code: tag.code },
    );
  }
  if (isResidualOntologyTag(tag.axis, tag.code, ontologyVersion)) {
    throw new ProductSemanticSnapshotBuildError(
      'INVALID_RESIDUAL_TAG',
      'Runtime product semantic snapshot must not publish residual ontology tags as durable assigned families',
      { index, productId: result.productId, path, axis: tag.axis, code: tag.code },
    );
  }
}

function validateResult(result: ProductSemanticClassificationResult, index: number): void {
  const seenEvidenceKeys = new Set<string>();
  const expectedEvidenceKeys = new Set<string>();
  const seenTagKeys = new Set<string>();

  const primary = result.primaryProductFamily;
  if (primary) {
    ensureKnownTag(result, primary, index, 'primaryProductFamily');
    seenTagKeys.add(`${primary.axis}:${primary.code}`);
    expectedEvidenceKeys.add(`${primary.axis}:${primary.code}:${primary.ruleId}`);
  }
  for (const [tagIndex, secondary] of result.secondaryProductFamilies.entries()) {
    ensureKnownTag(result, secondary, index, `secondaryProductFamilies[${tagIndex}]`);
    const key = `${secondary.axis}:${secondary.code}`;
    if (seenTagKeys.has(key)) {
      throw new ProductSemanticSnapshotBuildError(
        'INVALID_CLASSIFICATION_RESULT',
        'Duplicate semantic tag found in classification result',
        { index, productId: result.productId, axis: secondary.axis, code: secondary.code },
      );
    }
    seenTagKeys.add(key);
    expectedEvidenceKeys.add(`${secondary.axis}:${secondary.code}:${secondary.ruleId}`);
  }
  for (const [tagIndex, discipline] of result.disciplines.entries()) {
    ensureKnownTag(result, discipline, index, `disciplines[${tagIndex}]`);
    const key = `${discipline.axis}:${discipline.code}`;
    if (seenTagKeys.has(key)) {
      throw new ProductSemanticSnapshotBuildError(
        'INVALID_CLASSIFICATION_RESULT',
        'Duplicate semantic tag found in classification result',
        { index, productId: result.productId, axis: discipline.axis, code: discipline.code },
      );
    }
    seenTagKeys.add(key);
    expectedEvidenceKeys.add(`${discipline.axis}:${discipline.code}:${discipline.ruleId}`);
  }
  for (const [tagIndex, useContext] of result.useContexts.entries()) {
    ensureKnownTag(result, useContext, index, `useContexts[${tagIndex}]`);
    const key = `${useContext.axis}:${useContext.code}`;
    if (seenTagKeys.has(key)) {
      throw new ProductSemanticSnapshotBuildError(
        'INVALID_CLASSIFICATION_RESULT',
        'Duplicate semantic tag found in classification result',
        { index, productId: result.productId, axis: useContext.axis, code: useContext.code },
      );
    }
    seenTagKeys.add(key);
    expectedEvidenceKeys.add(`${useContext.axis}:${useContext.code}:${useContext.ruleId}`);
  }

  for (const [evidenceIndex, evidence] of result.evidence.entries()) {
    const ontologyVersion = result.registryVersion as CommercialProductOntologyRegistryVersion;
    const ontologyTag = getOntologyTag(evidence.axis, evidence.code, ontologyVersion);
    if (!ontologyTag) {
      throw new ProductSemanticSnapshotBuildError(
        'UNKNOWN_ONTOLOGY_TAG',
        'Snapshot evidence references an ontology tag that does not exist in the active registry',
        { index, evidenceIndex, productId: result.productId, axis: evidence.axis, code: evidence.code },
      );
    }
    if (!isAllowedEvidenceSource(evidence.axis, evidence.code, evidence.sourceType, ontologyVersion)) {
      throw new ProductSemanticSnapshotBuildError(
        'INVALID_EVIDENCE_PROVENANCE',
        'Snapshot evidence uses a source type that is not allowed by the active ontology registry',
        {
          index,
          evidenceIndex,
          productId: result.productId,
          axis: evidence.axis,
          code: evidence.code,
          sourceType: evidence.sourceType,
        },
      );
    }
    const key = `${evidence.axis}:${evidence.code}:${evidence.ruleId}`;
    if (seenEvidenceKeys.has(key)) {
      throw new ProductSemanticSnapshotBuildError(
        'INVALID_EVIDENCE_PROVENANCE',
        'Duplicate evidence provenance found in classification result',
        { index, evidenceIndex, productId: result.productId, key },
      );
    }
    seenEvidenceKeys.add(key);
  }

  const factCount = semanticFactCount(result);
  if (factCount > 0 && expectedEvidenceKeys.size !== result.evidence.length) {
    throw new ProductSemanticSnapshotBuildError(
      'INVALID_EVIDENCE_PROVENANCE',
      'Every emitted semantic fact must have one evidence provenance record',
      { index, productId: result.productId, factCount, evidenceCount: result.evidence.length },
    );
  }
  for (const key of expectedEvidenceKeys) {
    if (!seenEvidenceKeys.has(key)) {
      throw new ProductSemanticSnapshotBuildError(
        'INVALID_EVIDENCE_PROVENANCE',
        'Snapshot is missing provenance for an emitted semantic fact',
        { index, productId: result.productId, key },
      );
    }
  }

  if (result.classificationStatus === 'EXCLUDED_NON_PRODUCT') {
    if (
      result.primaryProductFamily !== null ||
      result.secondaryProductFamilies.length > 0 ||
      result.disciplines.length > 0 ||
      result.useContexts.length > 0 ||
      result.evidence.length > 0
    ) {
      throw new ProductSemanticSnapshotBuildError(
        'INVALID_CLASSIFICATION_RESULT',
        'Excluded non-product results must not carry semantic assignments or evidence',
        { index, productId: result.productId },
      );
    }
    if (!result.exclusionReason || !result.matchedExclusionRule) {
      throw new ProductSemanticSnapshotBuildError(
        'EXCLUSION_PROVENANCE_MISSING',
        'Excluded non-product results must preserve exclusion provenance',
        { index, productId: result.productId },
      );
    }
    return;
  }

  if (result.exclusionReason !== null || result.matchedExclusionRule !== null) {
    throw new ProductSemanticSnapshotBuildError(
      'INVALID_CLASSIFICATION_RESULT',
      'Non-excluded results must not carry exclusion provenance',
      { index, productId: result.productId },
    );
  }

  if ((result.classificationStatus === 'CLASSIFIED' || result.classificationStatus === 'PARTIALLY_CLASSIFIED') && !result.primaryProductFamily) {
    throw new ProductSemanticSnapshotBuildError(
      'INVALID_CLASSIFICATION_RESULT',
      'Classified results must carry a primary product family',
      { index, productId: result.productId, classificationStatus: result.classificationStatus },
    );
  }

  if (result.classificationStatus === 'OTHER' && result.primaryProductFamily !== null) {
    throw new ProductSemanticSnapshotBuildError(
      'INVALID_CLASSIFICATION_RESULT',
      'OTHER records must not persist a durable primary product family',
      { index, productId: result.productId },
    );
  }

  if (result.classificationStatus === 'NEEDS_REVIEW' && result.needsReviewCandidates.length === 0) {
    throw new ProductSemanticSnapshotBuildError(
      'INVALID_CLASSIFICATION_RESULT',
      'NEEDS_REVIEW records must preserve their competing product-family candidates',
      { index, productId: result.productId },
    );
  }
}

function toSnapshotFact(result: ProductSemanticClassificationResult): ProductSemanticSnapshotFact {
  return {
    productId: result.productId,
    classificationStatus: result.classificationStatus,
    primaryProductFamily: result.primaryProductFamily ? toSnapshotTag(result.primaryProductFamily) : null,
    secondaryProductFamilies: result.secondaryProductFamilies.map(toSnapshotTag),
    disciplines: result.disciplines.map(toSnapshotTag),
    useContexts: result.useContexts.map(toSnapshotTag),
    ontologyVersion: result.registryVersion,
    ontologyHash: result.registryHash,
    provenance: {
      evidence: result.evidence.map(toSnapshotEvidence),
      exclusion: result.classificationStatus === 'EXCLUDED_NON_PRODUCT'
        ? {
            ruleId: result.matchedExclusionRule as string,
            reason: result.exclusionReason as string,
          }
        : null,
    },
    needsReviewCandidates: result.needsReviewCandidates.map(toSnapshotTag),
  };
}

export function compareProductSemanticSnapshotFactsCanonically(
  left: ProductSemanticSnapshotFact,
  right: ProductSemanticSnapshotFact,
): number {
  return productIdComparator(left.productId, right.productId);
}

export function createProductSemanticSnapshotIdentityPayload(input: {
  readonly sourceProductCount: number;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly classifierVersion: string;
  readonly semanticChecksum: string;
  readonly classificationCounts: ProductSemanticSnapshot['classificationCounts'];
  readonly records: readonly ProductSemanticSnapshotFact[];
}): JsonValue {
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceProductCount: input.sourceProductCount,
    recordCount: input.records.length,
    ontologyVersion: input.ontologyVersion,
    ontologyHash: input.ontologyHash,
    classifierVersion: input.classifierVersion,
    semanticChecksum: input.semanticChecksum,
    classificationCounts: cloneJsonValue(input.classificationCounts) as unknown as JsonValue,
    records: cloneJsonValue(input.records) as unknown as JsonValue,
  };
}

export function createProductSemanticSnapshotId(input: Parameters<typeof createProductSemanticSnapshotIdentityPayload>[0]): string {
  try {
    const canonicalContent = canonicalizeJson(createProductSemanticSnapshotIdentityPayload(input));
    return `sha256:${createHash('sha256').update(canonicalContent).digest('hex')}`;
  } catch (error) {
    throw new ProductSemanticSnapshotBuildError(
      'SNAPSHOT_HASH_FAILURE',
      'Snapshot hash could not be calculated',
      {
        reason: error instanceof Error ? error.message : 'unknown',
      },
    );
  }
}

function buildFrozenSnapshot(input: {
  readonly builtAt: string;
  readonly sourceProductCount: number;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly classifierVersion: string;
  readonly semanticChecksum: string;
  readonly classificationCounts: ProductSemanticSnapshot['classificationCounts'];
  readonly records: readonly ProductSemanticSnapshotFact[];
}): ProductSemanticSnapshot {
  const records = [...input.records]
    .sort(compareProductSemanticSnapshotFactsCanonically)
    .map((record) => cloneJsonValue(record));

  const snapshotId = createProductSemanticSnapshotId({
    sourceProductCount: input.sourceProductCount,
    ontologyVersion: input.ontologyVersion,
    ontologyHash: input.ontologyHash,
    classifierVersion: input.classifierVersion,
    semanticChecksum: input.semanticChecksum,
    classificationCounts: input.classificationCounts,
    records,
  });

  const snapshot: ProductSemanticSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId,
    builtAt: input.builtAt,
    sourceProductCount: input.sourceProductCount,
    recordCount: records.length,
    ontologyVersion: input.ontologyVersion,
    ontologyHash: input.ontologyHash,
    classifierVersion: input.classifierVersion,
    semanticChecksum: input.semanticChecksum,
    classificationCounts: cloneJsonValue(input.classificationCounts),
    records,
  };

  assertSerializable(snapshot, { snapshotId });
  productSemanticSnapshotSchema.parse(snapshot);
  return deepFreeze(snapshot);
}

export class DefaultProductSemanticSnapshotBuilder implements ProductSemanticSnapshotBuilder {
  build(input: {
    readonly results: readonly ProductSemanticClassificationResult[];
    readonly parameters: ProductSemanticSnapshotBuildParameters;
  }): ProductSemanticSnapshotBuildResult {
    const parameters = productSemanticSnapshotBuildParametersSchema.parse(input.parameters);
    const results = [...input.results];

    if (results.length === 0) {
      throw new ProductSemanticSnapshotBuildError('EMPTY_SOURCE_PRODUCTS', 'Product semantic snapshot build requires at least one classification result');
    }
    if (parameters.sourceProductCount !== results.length) {
      throw new ProductSemanticSnapshotBuildError(
        'SOURCE_COUNT_MISMATCH',
        'Snapshot source product count must equal the number of classification results',
        { expected: parameters.sourceProductCount, actual: results.length },
      );
    }

    const seenProductIds = new Set<string>();
    for (const [index, result] of results.entries()) {
      if (seenProductIds.has(result.productId)) {
        throw new ProductSemanticSnapshotBuildError(
          'DUPLICATE_PRODUCT_ID',
          'Duplicate productId detected while building the semantic snapshot',
          { index, productId: result.productId },
        );
      }
      seenProductIds.add(result.productId);
      validateResult(result, index);
    }

    const { ontologyVersion, ontologyHash } = assertOntologyConsistency(results);
    const semanticChecksum = computeClassificationChecksum(results);
    const classificationCounts = countProductSemanticClassificationStatuses(results);
    const builtAt = parameters.builtAt ?? new Date().toISOString();
    const records = results.map(toSnapshotFact);

    const snapshot = buildFrozenSnapshot({
      builtAt,
      sourceProductCount: parameters.sourceProductCount,
      ontologyVersion,
      ontologyHash,
      classifierVersion: parameters.classifierVersion,
      semanticChecksum,
      classificationCounts,
      records,
    });

    const buildResult: ProductSemanticSnapshotBuildResult = {
      snapshot,
      statistics: {
        sourceProductsRead: parameters.sourceProductCount,
        snapshotRecordsPublished: snapshot.recordCount,
        classificationCounts,
      },
      warnings: [],
    };
    productSemanticSnapshotBuildResultSchema.parse(buildResult);
    return buildResult;
  }
}
