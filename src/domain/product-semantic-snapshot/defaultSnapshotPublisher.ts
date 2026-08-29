import {
  productSemanticSnapshotPublicationResultSchema,
  type ProductSemanticSnapshotBuildParameters,
  type ProductSemanticSnapshotBuilder,
  type ProductSemanticSnapshotPublicationResult,
  type ProductSemanticSnapshotPublisher,
  type ProductSemanticSnapshotStore,
} from './contracts.js';
import type { ProductSemanticClassificationResult } from '../product-semantic-classification/index.js';

export class DefaultProductSemanticSnapshotPublisher implements ProductSemanticSnapshotPublisher {
  constructor(
    private readonly builder: ProductSemanticSnapshotBuilder,
    private readonly store: ProductSemanticSnapshotStore,
  ) {}

  async publish(input: {
    readonly results: readonly ProductSemanticClassificationResult[];
    readonly parameters: ProductSemanticSnapshotBuildParameters;
  }): Promise<ProductSemanticSnapshotPublicationResult> {
    const buildResult = this.builder.build({
      results: input.results,
      parameters: input.parameters,
    });
    const saveResult = await this.store.save(buildResult.snapshot);
    await this.store.activate(buildResult.snapshot.snapshotId);

    const result: ProductSemanticSnapshotPublicationResult = {
      snapshot: buildResult.snapshot,
      saveStatus: saveResult.status,
      activated: true,
      statistics: buildResult.statistics,
      warnings: buildResult.warnings,
    };
    productSemanticSnapshotPublicationResultSchema.parse(result);
    return result;
  }
}
