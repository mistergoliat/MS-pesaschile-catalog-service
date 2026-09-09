import { z } from 'zod';

/**
 * The planner-facing vocabulary is intentionally duplicated only for the
 * finite axis names. Codes are loaded from Catalog registries at runtime.
 */
export const semanticDiscoveryProductAxes = ['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'] as const;
export const semanticDiscoveryTrainingAxes = [
  'EXERCISE_CAPABILITY',
  'TRAINING_FUNCTION',
  'BODY_REGION',
  'MUSCLE_GROUP',
  'TRAINING_PATTERN',
] as const;
export const semanticDiscoveryAxes = [
  ...semanticDiscoveryProductAxes,
  ...semanticDiscoveryTrainingAxes,
] as const;

export type SemanticDiscoveryAxis = (typeof semanticDiscoveryAxes)[number];
export type SemanticDiscoverySource = 'PRODUCT_SEMANTICS' | 'TRAINING_SEMANTICS';
export type SemanticDiscoveryMode = 'required' | 'preferred';
export type SemanticDiscoveryMatch = 'any' | 'all';
export type SemanticDiscoveryRelation = 'DIRECT' | 'SUPPORTED' | 'FAMILY_DERIVED';

export const semanticDiscoveryRelations = ['DIRECT', 'SUPPORTED', 'FAMILY_DERIVED'] as const;

export const semanticDiscoveryIntentRequirementSchema = z.object({
  axis: z.enum(semanticDiscoveryAxes),
  codes: z.array(z.string().trim().min(1)).min(1).max(24),
  mode: z.enum(['required', 'preferred']),
  match: z.enum(['any', 'all']),
  relations: z.array(z.enum(semanticDiscoveryRelations)).min(1).max(2).optional(),
}).strict();

/**
 * This is deliberately not the Catalog HTTP request. `limit` is the only
 * execution option exposed to the planner; schemaVersion, options and
 * snapshot pins belong to the infrastructure adapter.
 */
export const semanticDiscoveryIntentSchema = z.object({
  requirements: z.array(semanticDiscoveryIntentRequirementSchema).min(1).max(10),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();

export type SemanticDiscoveryRequirement = z.infer<typeof semanticDiscoveryIntentRequirementSchema>;
export type SemanticDiscoveryIntent = z.infer<typeof semanticDiscoveryIntentSchema>;
export type SemanticDiscoveryIntentInput = z.input<typeof semanticDiscoveryIntentSchema>;

const snapshotIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const productSemanticLineageSchema = z.object({
  snapshotId: snapshotIdSchema,
  semanticChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  ontologyVersion: z.string().trim().min(1),
  ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  classifierVersion: z.string().trim().min(1),
}).strict();

const trainingSemanticLineageSchema = z.object({
  snapshotId: snapshotIdSchema,
  semanticChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  registryVersion: z.string().trim().min(1),
  registryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  classifierVersion: z.string().trim().min(1),
  rulesHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

const matchedRequirementSchema = z.object({
  axis: z.enum(semanticDiscoveryAxes),
  requestedCodes: z.array(z.string().trim().min(1)),
  matchedCodes: z.array(z.string().trim().min(1)),
  source: z.enum(['PRODUCT_SEMANTICS', 'TRAINING_SEMANTICS']),
  mode: z.enum(['required', 'preferred']),
  match: z.enum(['any', 'all']),
  relationTypes: z.array(z.string().trim().min(1)).optional(),
  confidenceLevels: z.array(z.string().trim().min(1)).optional(),
  reason: z.enum(['required_match', 'preferred_match']),
}).strict();

const productSemanticTagSchema = z.object({
  code: z.string().trim().min(1),
  confidence: z.string().trim().min(1),
}).passthrough();

const productSemanticFactSchema = z.object({
  productId: z.number().int().positive(),
  classificationStatus: z.string().trim().min(1),
  primaryProductFamily: productSemanticTagSchema.nullable(),
  secondaryProductFamilies: z.array(productSemanticTagSchema),
  disciplines: z.array(productSemanticTagSchema),
  useContexts: z.array(productSemanticTagSchema),
  ontologyVersion: z.string().trim().min(1),
  ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  classifierVersion: z.string().trim().min(1),
}).passthrough();

const trainingExerciseCapabilitySchema = z.object({
  code: z.string().trim().min(1),
  relationType: z.string().trim().min(1),
  classificationConfidence: z.string().trim().min(1),
}).passthrough();

const trainingFunctionSchema = z.object({
  code: z.string().trim().min(1),
  relationType: z.string().trim().min(1),
}).passthrough();

const trainingSemanticFactSchema = z.object({
  productId: z.number().int().positive(),
  resolutionState: z.string().trim().min(1),
  coverageStatus: z.string().trim().min(1),
  exerciseCapabilities: z.array(trainingExerciseCapabilitySchema),
  trainingFunctions: z.array(trainingFunctionSchema),
  derived: z.object({
    bodyRegions: z.array(z.string()),
    primaryMuscleGroups: z.array(z.string()),
    secondaryMuscleGroups: z.array(z.string()),
    trainingPatterns: z.array(z.string()),
  }).strict(),
}).passthrough();

const semanticDiscoveryResultSchema = z.object({
  productId: z.number().int().positive(),
  matchedRequirements: z.array(matchedRequirementSchema),
  productSemantics: productSemanticFactSchema.nullable(),
  trainingSemantics: trainingSemanticFactSchema.nullable(),
}).strict();

export const semanticDiscoveryResponseSchema = z.object({
  schemaVersion: z.literal(1),
  lineage: z.object({
    productSemantics: productSemanticLineageSchema.nullable(),
    trainingSemantics: trainingSemanticLineageSchema.nullable(),
  }).strict(),
  query: z.object({
    requirements: z.array(semanticDiscoveryIntentRequirementSchema),
    options: z.object({ limit: z.number().int().min(1).max(100) }).strict(),
  }).strict(),
  results: z.array(semanticDiscoveryResultSchema),
  totalMatches: z.number().int().min(0),
  truncated: z.boolean(),
}).strict();

export type SemanticDiscoveryCatalogResponse = z.infer<typeof semanticDiscoveryResponseSchema>;
export type SemanticDiscoveryCatalogResult = SemanticDiscoveryCatalogResponse['results'][number];

const productRegistryValueSchema = z.object({
  code: z.string().trim().min(1),
  labelEs: z.string(),
  definition: z.string(),
  status: z.enum(['ACTIVE', 'RESIDUAL']),
  residual: z.boolean(),
}).strict();

const productRegistryAxisSchema = z.object({
  axis: z.enum(semanticDiscoveryProductAxes),
  values: z.array(productRegistryValueSchema),
}).strict();

export const semanticDiscoveryProductRegistrySchema = z.object({
  schemaVersion: z.literal('1'),
  ontologyVersion: z.string().trim().min(1),
  ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.literal('PUBLISHED'),
  axes: z.array(productRegistryAxisSchema),
}).strict();

const trainingRegistryDefinitionSchema = z.object({
  code: z.string().trim().min(1),
  status: z.string().trim().min(1),
}).passthrough();

export const semanticDiscoveryTrainingRegistrySchema = z.object({
  schemaVersion: z.literal('2'),
  registryVersion: z.string().trim().min(1),
  registryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.literal('PUBLISHED'),
  exerciseCapabilities: z.array(trainingRegistryDefinitionSchema),
  trainingFunctions: z.array(trainingRegistryDefinitionSchema),
  bodyRegions: z.array(z.string().trim().min(1)),
  muscleGroups: z.array(z.string().trim().min(1)),
  trainingPatterns: z.array(z.string().trim().min(1)),
  exerciseDerivedRelations: z.array(z.unknown()),
  familyTrainingFunctionDerivations: z.array(z.unknown()),
  semanticBoundaries: z.record(z.unknown()),
}).passthrough();

export type SemanticDiscoveryProductRegistry = z.infer<typeof semanticDiscoveryProductRegistrySchema>;
export type SemanticDiscoveryTrainingRegistry = z.infer<typeof semanticDiscoveryTrainingRegistrySchema>;
export type SemanticDiscoveryRegistry = {
  readonly product: SemanticDiscoveryProductRegistry;
  readonly training: SemanticDiscoveryTrainingRegistry;
};

/**
 * The planner receives this compact projection. Full snapshot lineage stays
 * available as machine-readable metadata, while classifier evidence and
 * commercial fields are not copied into the prompt-facing result.
 */
export type SemanticDiscoveryCapabilityResult = {
  readonly results: readonly SemanticDiscoveryCapabilityResultItem[];
  readonly totalMatches: number;
  readonly truncated: boolean;
  readonly lineage: SemanticDiscoveryCatalogResponse['lineage'];
};

type SemanticDiscoveryTrainingFact = NonNullable<SemanticDiscoveryCatalogResult['trainingSemantics']>;

export type SemanticDiscoveryCapabilityResultItem = {
  readonly productId: number;
  readonly matchedRequirements: readonly SemanticDiscoveryCatalogResult['matchedRequirements'][number][];
  readonly productSemantics: {
    readonly classificationStatus: string;
    readonly primaryProductFamily: unknown;
    readonly secondaryProductFamilies: readonly unknown[];
    readonly disciplines: readonly unknown[];
    readonly useContexts: readonly unknown[];
  } | null;
  readonly trainingSemantics: {
    readonly resolutionState: string;
    readonly coverageStatus: string;
    readonly exerciseCapabilities: readonly Pick<
      z.infer<typeof trainingExerciseCapabilitySchema>,
      'code' | 'relationType' | 'classificationConfidence'
    >[];
    readonly trainingFunctions: readonly Pick<
      z.infer<typeof trainingFunctionSchema>,
      'code' | 'relationType'
    >[];
    readonly derived: SemanticDiscoveryTrainingFact['derived'];
  } | null;
};
