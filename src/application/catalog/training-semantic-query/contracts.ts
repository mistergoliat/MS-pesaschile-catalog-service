import { z } from 'zod';

export const trainingSemanticQueryAxes = [
  'EXERCISE_CAPABILITY',
  'TRAINING_FUNCTION',
  'BODY_REGION',
  'MUSCLE_GROUP',
  'TRAINING_PATTERN',
] as const;
export type TrainingSemanticQueryAxis = (typeof trainingSemanticQueryAxes)[number];

export const trainingSemanticQueryModes = ['required', 'preferred'] as const;
export type TrainingSemanticQueryMode = (typeof trainingSemanticQueryModes)[number];

export const trainingSemanticQueryMatches = ['any', 'all'] as const;
export type TrainingSemanticQueryMatch = (typeof trainingSemanticQueryMatches)[number];

export const trainingSemanticQueryRelations = ['DIRECT', 'SUPPORTED', 'FAMILY_DERIVED'] as const;
export type TrainingSemanticQueryRelation = (typeof trainingSemanticQueryRelations)[number];

const snapshotIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const trainingSemanticQueryRequirementSchema = z.object({
  axis: z.enum(trainingSemanticQueryAxes),
  codes: z.array(z.string().trim().min(1)).min(1).max(24),
  mode: z.enum(trainingSemanticQueryModes),
  match: z.enum(trainingSemanticQueryMatches),
  relations: z.array(z.enum(trainingSemanticQueryRelations)).min(1).max(2).optional(),
}).strict();

export const trainingSemanticQueryRequestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  requirements: z.array(trainingSemanticQueryRequirementSchema).min(1).max(10),
  options: z.object({
    limit: z.number().int().min(1).max(100).default(20),
  }).strict().default({}),
  expectedSnapshotId: snapshotIdSchema.optional(),
}).strict();

export type TrainingSemanticQueryRequirement = z.infer<typeof trainingSemanticQueryRequirementSchema>;
export type TrainingSemanticQueryRequest = z.infer<typeof trainingSemanticQueryRequestSchema>;

export type PublicTrainingSemanticQueryEvidence = {
  readonly kind: string;
  readonly sourceId?: string;
  readonly matchedText?: string;
  readonly ruleId?: string;
  readonly note?: string;
};

export type PublicTrainingSemanticQueryExerciseCapability = {
  readonly code: string;
  readonly relationType: string;
  readonly classificationConfidence: string;
  readonly evidence: readonly PublicTrainingSemanticQueryEvidence[];
};

export type PublicTrainingSemanticQueryFunction = {
  readonly code: string;
  readonly relationType: string;
  readonly evidence: readonly PublicTrainingSemanticQueryEvidence[];
};

export type PublicTrainingSemanticQueryDerived = {
  readonly bodyRegions: readonly string[];
  readonly primaryMuscleGroups: readonly string[];
  readonly secondaryMuscleGroups: readonly string[];
  readonly trainingPatterns: readonly string[];
};

export type PublicTrainingSemanticQueryMatchedRequirement = {
  readonly axis: TrainingSemanticQueryAxis;
  readonly codes: readonly string[];
  readonly matchedCodes: readonly string[];
  readonly relationTypes: readonly string[];
  readonly mode: TrainingSemanticQueryMode;
  readonly match: TrainingSemanticQueryMatch;
  readonly reason: 'required_match' | 'preferred_match';
};

export type PublicTrainingSemanticQueryResult = {
  readonly productId: number;
  readonly resolutionState: string;
  readonly coverageStatus: string;
  readonly matchedRequirements: readonly PublicTrainingSemanticQueryMatchedRequirement[];
  readonly exerciseCapabilities: readonly PublicTrainingSemanticQueryExerciseCapability[];
  readonly trainingFunctions: readonly PublicTrainingSemanticQueryFunction[];
  readonly derived: PublicTrainingSemanticQueryDerived;
};

export type PublicTrainingSemanticQueryLineage = {
  readonly snapshotId: string;
  readonly semanticChecksum: string;
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly classifierVersion: string;
  readonly rulesHash: string;
};

export type PublicTrainingSemanticQueryResponse = {
  readonly schemaVersion: 1;
  readonly lineage: PublicTrainingSemanticQueryLineage;
  readonly query: {
    readonly requirements: readonly TrainingSemanticQueryRequirement[];
    readonly options: { readonly limit: number };
  };
  readonly results: readonly PublicTrainingSemanticQueryResult[];
  readonly totalMatches: number;
  readonly truncated: boolean;
};

export type TrainingSemanticQueryService = {
  query(request: unknown): PublicTrainingSemanticQueryResponse;
};
