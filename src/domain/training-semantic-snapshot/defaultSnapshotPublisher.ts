import { trainingSemanticSnapshotPublicationResultSchema, type TrainingSemanticSnapshotBuildParameters, type TrainingSemanticSnapshotBuilder, type TrainingSemanticSnapshotPublicationResult, type TrainingSemanticSnapshotPublisher, type TrainingSemanticSnapshotStore } from './contracts.js';
import { validateTrainingSemanticSnapshot } from './defaultSnapshotBuilder.js';

export class DefaultTrainingSemanticSnapshotPublisher implements TrainingSemanticSnapshotPublisher {
  constructor(private readonly builder: TrainingSemanticSnapshotBuilder, private readonly store: TrainingSemanticSnapshotStore) {}

  async publish(input: { readonly results: Parameters<TrainingSemanticSnapshotBuilder['build']>[0]['results']; readonly parameters: TrainingSemanticSnapshotBuildParameters }): Promise<TrainingSemanticSnapshotPublicationResult> {
    const snapshot = this.builder.build(input);
    const saved = await this.store.save(snapshot);
    const persisted = await this.store.getById(snapshot.snapshotId);
    if (!persisted) throw new Error('Persisted training semantic snapshot could not be read');
    validateTrainingSemanticSnapshot(persisted);
    await this.store.activate(snapshot.snapshotId);
    const result: TrainingSemanticSnapshotPublicationResult = { snapshot, saveStatus: saved.status, activated: true };
    trainingSemanticSnapshotPublicationResultSchema.parse(result);
    return result;
  }
}
