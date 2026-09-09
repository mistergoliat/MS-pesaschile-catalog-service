import { z } from 'zod';

export const semanticDiscoveryProductAxes = ['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'] as const;
export const semanticDiscoveryTrainingAxes = ['EXERCISE_CAPABILITY', 'TRAINING_FUNCTION', 'BODY_REGION', 'MUSCLE_GROUP', 'TRAINING_PATTERN'] as const;
export const semanticDiscoveryAxes = [...semanticDiscoveryProductAxes, ...semanticDiscoveryTrainingAxes] as const;
export type SemanticDiscoveryAxis = (typeof semanticDiscoveryAxes)[number];
export type SemanticDiscoverySource = 'PRODUCT_SEMANTICS' | 'TRAINING_SEMANTICS';

export const semanticDiscoveryModes = ['required', 'preferred'] as const;
export const semanticDiscoveryMatches = ['any', 'all'] as const;
export const semanticDiscoveryRelations = ['DIRECT', 'SUPPORTED', 'FAMILY_DERIVED'] as const;

const snapshotIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const semanticDiscoveryRequirementSchema = z.object({
  axis: z.enum(semanticDiscoveryAxes),
  codes: z.array(z.string().trim().min(1)).min(1).max(24),
  mode: z.enum(semanticDiscoveryModes),
  match: z.enum(semanticDiscoveryMatches),
  relations: z.array(z.enum(semanticDiscoveryRelations)).min(1).max(2).optional(),
}).strict();

export const semanticDiscoveryRequestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  requirements: z.array(semanticDiscoveryRequirementSchema).min(1).max(10),
  options: z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict().default({}),
  expectedSnapshots: z.object({
    productSemanticSnapshotId: snapshotIdSchema.optional(),
    trainingSemanticSnapshotId: snapshotIdSchema.optional(),
  }).strict().default({}),
}).strict();

export type SemanticDiscoveryRequirement = z.infer<typeof semanticDiscoveryRequirementSchema>;
export type SemanticDiscoveryRequest = z.infer<typeof semanticDiscoveryRequestSchema>;

export type PublicSemanticDiscoveryProductLineage = {
  readonly snapshotId: string;
  readonly semanticChecksum: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly classifierVersion: string;
};

export type PublicSemanticDiscoveryTrainingLineage = {
  readonly snapshotId: string;
  readonly semanticChecksum: string;
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly classifierVersion: string;
  readonly rulesHash: string;
};

export type PublicSemanticDiscoveryProductFact = {
  readonly productId: number;
  readonly classificationStatus: string;
  readonly primaryProductFamily: unknown;
  readonly secondaryProductFamilies: readonly unknown[];
  readonly disciplines: readonly unknown[];
  readonly useContexts: readonly unknown[];
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly classifierVersion: string;
};

export type PublicSemanticDiscoveryTrainingFact = {
  readonly productId: number;
  readonly resolutionState: string;
  readonly coverageStatus: string;
  readonly exerciseCapabilities: readonly unknown[];
  readonly trainingFunctions: readonly unknown[];
  readonly derived: {
    readonly bodyRegions: readonly string[];
    readonly primaryMuscleGroups: readonly string[];
    readonly secondaryMuscleGroups: readonly string[];
    readonly trainingPatterns: readonly string[];
  };
};

export type PublicSemanticDiscoveryMatchedRequirement = {
  readonly axis: SemanticDiscoveryAxis;
  readonly requestedCodes: readonly string[];
  readonly matchedCodes: readonly string[];
  readonly source: SemanticDiscoverySource;
  readonly mode: 'required' | 'preferred';
  readonly match: 'any' | 'all';
  readonly relationTypes?: readonly string[];
  readonly confidenceLevels?: readonly string[];
  readonly reason: 'required_match' | 'preferred_match';
};

export type PublicSemanticDiscoveryResult = {
  readonly productId: number;
  readonly matchedRequirements: readonly PublicSemanticDiscoveryMatchedRequirement[];
  readonly productSemantics: PublicSemanticDiscoveryProductFact | null;
  readonly trainingSemantics: PublicSemanticDiscoveryTrainingFact | null;
};

export type PublicSemanticDiscoveryResponse = {
  readonly schemaVersion: 1;
  readonly lineage: {
    readonly productSemantics: PublicSemanticDiscoveryProductLineage | null;
    readonly trainingSemantics: PublicSemanticDiscoveryTrainingLineage | null;
  };
  readonly query: {
    readonly requirements: readonly SemanticDiscoveryRequirement[];
    readonly options: { readonly limit: number };
  };
  readonly results: readonly PublicSemanticDiscoveryResult[];
  readonly totalMatches: number;
  readonly truncated: boolean;
};

export type SemanticDiscoveryService = {
  query(request: unknown): PublicSemanticDiscoveryResponse;
};
