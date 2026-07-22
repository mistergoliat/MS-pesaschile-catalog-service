import type { RelationshipType } from '../contracts.js';
import type {
  CalculatedProductRelationship,
  ProductInteractionDataset,
  ProductRelationshipBuildInput,
  ProductRelationshipBuildResult,
  ProductRelationshipPublication,
  ProductRelationshipReadInput,
  ProductRelationshipReadResult,
  ProductRelationshipValidationResult,
} from './contracts.js';

export interface ProductRelationshipDatasetReader {
  read(input: ProductRelationshipBuildInput): Promise<ProductInteractionDataset>;
}

export interface ProductRelationshipCalculator {
  supports(type: RelationshipType): boolean;

  calculate(input: {
    dataset: ProductInteractionDataset;
    buildInput: ProductRelationshipBuildInput;
  }): Promise<CalculatedProductRelationship[]>;
}

export interface RelationshipReliabilityEvaluator {
  evaluate(relationship: Omit<CalculatedProductRelationship, 'reliability'>): number;
}

export interface ProductRelationshipValidator {
  validate(result: ProductRelationshipBuildResult): ProductRelationshipValidationResult;
}

export interface ProductRelationshipPublisher {
  publish(result: ProductRelationshipBuildResult): Promise<ProductRelationshipPublication>;
}

export interface ProductRelationshipReader {
  findRelated(input: ProductRelationshipReadInput): Promise<ProductRelationshipReadResult>;
}

