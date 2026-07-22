import {
  productRelationshipSnapshotPublicationContextSchema,
  productRelationshipSnapshotPublicationResultSchema,
  type EmptyProductRelationshipSnapshotMetadata,
  type ProductRelationshipSnapshotBuilder,
  type ProductRelationshipSnapshotPublicationContext,
  type ProductRelationshipSnapshotPublicationParameters,
  type ProductRelationshipSnapshotPublicationResult,
  type ProductRelationshipSnapshotPublisher,
  type ProductRelationshipSnapshotStore,
} from './contracts.js';
import type { ValidatedProductRelationship } from '../validation/contracts.js';

export class DefaultProductRelationshipSnapshotPublisher implements ProductRelationshipSnapshotPublisher {
  constructor(
    private readonly builder: ProductRelationshipSnapshotBuilder,
    private readonly store: ProductRelationshipSnapshotStore,
  ) {}

  async publish(input: {
    relationships: readonly ValidatedProductRelationship[];
    parameters?: ProductRelationshipSnapshotPublicationParameters;
    emptySnapshotMetadata?: EmptyProductRelationshipSnapshotMetadata;
    publicationContext?: ProductRelationshipSnapshotPublicationContext;
  }): Promise<ProductRelationshipSnapshotPublicationResult> {
    const publicationContext = productRelationshipSnapshotPublicationContextSchema.parse(input.publicationContext ?? {});
    const buildResult = this.builder.build({
      relationships: input.relationships,
      parameters: input.parameters,
      emptySnapshotMetadata: input.emptySnapshotMetadata,
    });
    const saveResult = await this.store.save(buildResult.snapshot);
    await this.store.activate(buildResult.snapshot.snapshotId);

    const result: ProductRelationshipSnapshotPublicationResult = {
      snapshot: buildResult.snapshot,
      saveStatus: saveResult.status,
      activated: true,
      ...(publicationContext.publishedAt ? { publishedAt: publicationContext.publishedAt } : {}),
      statistics: buildResult.statistics,
      warnings: buildResult.warnings,
    };
    productRelationshipSnapshotPublicationResultSchema.parse(result);
    return result;
  }
}
