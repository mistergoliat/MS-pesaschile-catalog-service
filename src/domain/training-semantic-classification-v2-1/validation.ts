import { validateTrainingSemanticClassificationV2Result } from '../training-semantic-classification-v2/validation.js';
import type { TrainingSemanticClassificationV21Result } from './contracts.js';
import { trainingSemanticClassifierV21RulesHash } from './rules.js';

export function validateTrainingSemanticClassificationV21Result(result: TrainingSemanticClassificationV21Result): void {
  validateTrainingSemanticClassificationV2Result({ ...result, classifierVersion: 'training-semantic-classifier-v2' });
  if (result.rulesHash !== trainingSemanticClassifierV21RulesHash) throw new Error('Training Semantic Classification V2.1 validation failed: rulesHash mismatch');
}
