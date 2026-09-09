import type { TrainingSemanticClassificationInput, TrainingSemanticClassificationOptions } from '../training-semantic-classification/contracts.js';
import type { TrainingSemanticClassificationV2Result } from '../training-semantic-classification-v2/contracts.js';

export const trainingSemanticClassifierV21Version = 'training-semantic-classifier-v2.1' as const;
export type TrainingSemanticClassifierV21Version = typeof trainingSemanticClassifierV21Version;

export type TrainingSemanticClassificationV21Input = TrainingSemanticClassificationInput;
export type TrainingSemanticClassificationV21Options = TrainingSemanticClassificationOptions;
export type TrainingSemanticClassificationV21Result = Omit<TrainingSemanticClassificationV2Result, 'classifierVersion'> & {
  readonly classifierVersion: TrainingSemanticClassifierV21Version;
};
